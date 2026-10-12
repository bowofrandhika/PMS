'use strict';

// Backup konsisten database SQLite (aman saat server berjalan, mode WAL).
// Pemakaian: node scripts/backup.js [file_tujuan]
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const src = process.env.PMS_DB || path.join(__dirname, '..', 'data', 'pms.db');
const dir = path.join(__dirname, '..', 'data', 'backups');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const dest = process.argv[2] || path.join(dir, `pms-${stamp}.db`);

if (!fs.existsSync(src)) {
  console.error(`Database tidak ditemukan: ${src}`);
  process.exit(1);
}
fs.mkdirSync(path.dirname(dest), { recursive: true });
if (fs.existsSync(dest)) {
  console.error(`File tujuan sudah ada: ${dest}`);
  process.exit(1);
}
const db = new DatabaseSync(src);
db.exec(`VACUUM INTO '${dest.replace(/'/g, "''")}'`);
db.close();
const check = new DatabaseSync(dest);
const n = check.prepare('SELECT COUNT(*) AS n FROM audit_logs').get().n;
check.close();
console.log(`Backup berhasil: ${dest} (audit_logs: ${n} baris)`);
