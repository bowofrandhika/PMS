'use strict';

const path = require('node:path');
const express = require('express');
const { openDatabase } = require('./db');
const { createAuth, HttpError } = require('./http');
const core = require('./routes/core');
const production = require('./routes/production');
const dryer = require('./routes/dryer');
const md = require('./routes/md');
const reports = require('./routes/reports');

function createApp(db) {
  const { requireAuth, requirePerm } = createAuth(db);
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));

  const api = express.Router();
  // Log ringkas setiap request /api (metode, path, status, durasi, ada-tidaknya header auth).
  // Nilai token/password TIDAK pernah dicatat. Dipakai untuk diagnosis login dari sisi server.
  api.use((req, res, next) => {
    const started = Date.now();
    res.on('finish', () => {
      const hasAuth = Boolean(req.headers.authorization || req.headers['x-pms-token']);
      console.log(`[api] ${new Date().toISOString()} ${req.method} ${req.originalUrl.split('?')[0]} ${res.statusCode} ${Date.now() - started}ms auth=${hasAuth ? 'yes' : 'no'}`);
    });
    next();
  });
  api.get('/health', (req, res) => res.json({ ok: true, app: 'Production Management System', tz: 'Asia/Jakarta' }));
  api.use(core.buildRouter(db, { requireAuth, requirePerm }));

  const prod = production.buildRouter(db, { requireAuth, requirePerm });
  const ctx = { requireAuth, requirePerm, loadPlan: prod.exposed.loadPlan, setTrolleyStatus: prod.exposed.setTrolleyStatus };
  api.use(prod);
  api.use(dryer.buildRouter(db, ctx));
  api.use(md.buildRouter(db, ctx));
  api.use(reports.buildRouter(db, ctx));

  api.use((req, res) => res.status(404).json({ error: 'Endpoint tidak ditemukan', code: 'NOT_FOUND' }));
  app.use('/api', api);

  // Aset SPA tidak boleh di-cache heuristik oleh browser (penyebab umum 'kode lama' setelah perbaikan).
  app.use(express.static(path.join(__dirname, '..', 'public'), {
    index: 'index.html',
    extensions: ['html'],
    setHeaders(res, filePath) {
      if (/\.(html|js|css|svg)$/.test(filePath)) res.setHeader('Cache-Control', 'no-cache');
    },
  }));
  app.use((req, res) => res.status(404).type('text/plain').send('Not found'));

  // Penanganan error terpusat: pesan jelas dalam Bahasa Indonesia, tidak membocorkan stack.
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof HttpError) {
      return res.status(err.status).json({ error: err.message, details: err.details || null, code: statusCode(err.status) });
    }
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Format JSON tidak valid', code: 'BAD_JSON' });
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Payload terlalu besar', code: 'TOO_LARGE' });
    console.error('[PMS] error tidak tertangani:', err);
    res.status(500).json({ error: 'Terjadi kesalahan pada server. Hubungi Admin Sistem.', code: 'INTERNAL' });
  });

  return app;
}

function statusCode(status) {
  return ({ 400: 'BAD_REQUEST', 401: 'UNAUTHORIZED', 403: 'FORBIDDEN', 404: 'NOT_FOUND', 409: 'CONFLICT', 422: 'UNPROCESSABLE' })[status] || 'ERROR';
}

module.exports = { createApp, openDatabase };
