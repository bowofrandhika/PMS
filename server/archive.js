'use strict';

// Hard delete dengan arsip. Baris dihapus dari tabel aktif, tetapi isi lengkapnya
// disimpan di deleted_records (tidak pernah dihapus) dan dicatat di audit trail.
// Riwayat dipertahankan sampai reset/tutup buku tahunan.
const { nowIso } = require('./db');
const { conflict, notFound, audit } = require('./http');

function hardDelete(db, user, { entity, table, id, label, reason }) {
  const row = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);
  if (!row) throw notFound(label || entity);
  db.exec('BEGIN');
  try {
    db.prepare('INSERT INTO deleted_records (entity, table_name, record_id, label, data, reason, deleted_by, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(entity, table, id, label || String(id), JSON.stringify(row), reason, user.username, nowIso());
    db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    if (/constraint|FOREIGN KEY/i.test(String(err.message))) {
      throw conflict(`${label || entity} masih dipakai oleh data lain dan tidak dapat dihapus. Nonaktifkan saja.`);
    }
    throw err;
  }
  audit(db, user, { action: 'DELETE', entity, recordId: id, oldValue: row, reason });
  return row;
}

module.exports = { hardDelete };
