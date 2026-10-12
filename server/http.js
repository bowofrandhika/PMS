'use strict';

const crypto = require('node:crypto');
const { nowIso } = require('./db');

class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

const badRequest = (msg, details) => new HttpError(400, msg, details);
const forbidden = (msg = 'Anda tidak memiliki hak akses untuk aksi ini') => new HttpError(403, msg);
const notFound = (what = 'Data') => new HttpError(404, `${what} tidak ditemukan`);
const conflict = (msg) => new HttpError(409, msg);
const unprocessable = (msg) => new HttpError(422, msg);

function settingNumber(db, key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? Number(row.value) : null;
}

function setting(db, key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : null;
}

function loadUserContext(db, userId) {
  const user = db.prepare('SELECT id, username, full_name, active FROM users WHERE id = ?').get(userId);
  if (!user) return null;
  const roles = db.prepare('SELECT role_code FROM user_roles WHERE user_id = ? ORDER BY role_code').all(userId).map((r) => r.role_code);
  const perms = new Set();
  if (roles.length) {
    const placeholders = roles.map(() => '?').join(',');
    db.prepare(`SELECT DISTINCT permission FROM role_permissions WHERE role_code IN (${placeholders})`)
      .all(...roles).forEach((r) => perms.add(r.permission));
  }
  return { id: user.id, username: user.username, fullName: user.full_name, active: !!user.active, roles, permissions: [...perms] };
}

const SESSION_COOKIE = 'pms_session';

function readCookie(req, name) {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const idx = part.indexOf('=');
    if (idx > 0 && part.slice(0, idx).trim() === name) {
      try { return decodeURIComponent(part.slice(idx + 1).trim()) || null; } catch (e) { return null; }
    }
  }
  return null;
}

function sessionCookie(token, maxAgeSec) {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}`;
}

function createAuth(db) {
  // Middleware: memastikan token valid, tidak timeout, dan memuat konteks user.
  function requireAuth(req, res, next) {
    const header = req.headers.authorization || '';
    // Token diterima dari Authorization: Bearer, atau header kustom X-PMS-Token (tahan terhadap proxy yang menyaring Authorization).
    let token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token && req.headers['x-pms-token']) token = String(req.headers['x-pms-token']).trim();
    // Cadangan terakhir: cookie HttpOnly 'pms_session' yang diset saat login.
    if (!token) token = readCookie(req, SESSION_COOKIE);
    if (!token) return next(new HttpError(401, 'Silakan login terlebih dahulu'));
    const session = db.prepare('SELECT token, user_id, last_seen FROM sessions WHERE token = ?').get(token);
    if (!session) return next(new HttpError(401, 'Sesi tidak valid, silakan login ulang'));
    const timeoutMs = (settingNumber(db, 'session_timeout_min') || 30) * 60 * 1000;
    if (Date.now() - new Date(session.last_seen).getTime() > timeoutMs) {
      db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
      return next(new HttpError(401, 'Sesi berakhir karena tidak ada aktivitas (session timeout). Silakan login ulang.'));
    }
    const ctx = loadUserContext(db, session.user_id);
    if (!ctx || !ctx.active) return next(new HttpError(401, 'Akun tidak aktif'));
    db.prepare('UPDATE sessions SET last_seen = ? WHERE token = ?').run(nowIso(), token);
    req.user = ctx;
    req.token = token;
    next();
  }

  function requirePerm(...perms) {
    return (req, res, next) => {
      if (!req.user) return next(new HttpError(401, 'Silakan login terlebih dahulu'));
      const ok = perms.every((p) => req.user.permissions.includes(p));
      if (!ok) return next(forbidden());
      next();
    };
  }

  return { requireAuth, requirePerm };
}

function hasPerm(user, perm) {
  return !!user && user.permissions.includes(perm);
}

function hasRole(user, ...roles) {
  return !!user && roles.some((r) => user.roles.includes(r));
}

// Audit trail: setiap create/edit/correction/verify/approve/export dicatat (BR-026, bagian 9.3).
function audit(db, user, entry) {
  db.prepare(`INSERT INTO audit_logs (ts, user_id, username, role, action, entity, record_id, old_value, new_value, reason, device)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    nowIso(),
    user ? user.id : null,
    user ? user.username : 'system',
    user ? user.roles.join(',') : null,
    entry.action,
    entry.entity,
    entry.recordId == null ? null : String(entry.recordId),
    entry.oldValue === undefined || entry.oldValue === null ? null : JSON.stringify(entry.oldValue),
    entry.newValue === undefined || entry.newValue === null ? null : JSON.stringify(entry.newValue),
    entry.reason || null,
    entry.device || null,
  );
}

function requireString(body, field, { max = 500, optional = false } = {}) {
  const v = body[field];
  if (v === undefined || v === null || v === '') {
    if (optional) return null;
    throw badRequest(`Field "${field}" wajib diisi`);
  }
  const s = String(v).trim();
  if (!s) {
    if (optional) return null;
    throw badRequest(`Field "${field}" wajib diisi`);
  }
  if (s.length > max) throw badRequest(`Field "${field}" maksimal ${max} karakter`);
  return s;
}

function requireNumber(body, field, { min = -Infinity, max = Infinity, optional = false, integer = false } = {}) {
  const v = body[field];
  if (v === undefined || v === null || v === '') {
    if (optional) return null;
    throw badRequest(`Field "${field}" wajib diisi`);
  }
  const n = Number(v);
  if (!Number.isFinite(n)) throw badRequest(`Field "${field}" harus berupa angka`);
  if (integer && !Number.isInteger(n)) throw badRequest(`Field "${field}" harus berupa bilangan bulat`);
  if (n < min || n > max) throw badRequest(`Field "${field}" di luar rentang ${min}..${max}`);
  return n;
}

function requireEnum(body, field, values, { optional = false } = {}) {
  const v = body[field];
  if (v === undefined || v === null || v === '') {
    if (optional) return null;
    throw badRequest(`Field "${field}" wajib diisi`);
  }
  if (!values.includes(v)) throw badRequest(`Field "${field}" harus salah satu dari: ${values.join(', ')}`);
  return v;
}

function isIsoDateTime(v) {
  return typeof v === 'string' && !Number.isNaN(Date.parse(v));
}

function optionalTime(body, field) {
  const v = body[field];
  if (v === undefined || v === null || v === '') return nowIso();
  if (!isIsoDateTime(v)) throw badRequest(`Field "${field}" harus berupa tanggal/waktu ISO 8601`);
  return new Date(v).toISOString();
}

function newId() {
  return crypto.randomUUID();
}

module.exports = {
  HttpError, badRequest, forbidden, notFound, conflict, unprocessable,
  createAuth, loadUserContext, hasPerm, hasRole, audit, setting, settingNumber, sessionCookie, SESSION_COOKIE,
  requireString, requireNumber, requireEnum, optionalTime, isIsoDateTime, newId,
};
