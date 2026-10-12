'use strict';

const path = require('node:path');
const { openDatabase } = require('./db');
const { createApp } = require('./app');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const DB_FILE = process.env.PMS_DB || path.join(__dirname, '..', 'data', 'pms.db');

const db = openDatabase(DB_FILE);
const app = createApp(db);

const server = app.listen(PORT, HOST, () => {
  console.log(`PMS Produksi Kering berjalan di http://${HOST}:${PORT} (db: ${DB_FILE})`);
});

function shutdown() {
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 2000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
