'use strict';

// Periode (tutup buku) dan penomoran Nomor Produksi berkelanjutan.
// Nomor urut (seq) hanya naik dalam satu periode dan tidak pernah dipakai ulang,
// meskipun Nomor Produksi DRAFT dihapus permanen.

function openPeriod(db) {
  const p = db.prepare("SELECT * FROM fiscal_periods WHERE status = 'OPEN' ORDER BY id DESC LIMIT 1").get();
  if (!p) throw new Error('Tidak ada periode aktif');
  return p;
}

function nextSeq(db, periodId) {
  db.exec('BEGIN');
  try {
    db.prepare('UPDATE fiscal_periods SET last_seq = last_seq + 1 WHERE id = ?').run(periodId);
    const row = db.prepare('SELECT last_seq FROM fiscal_periods WHERE id = ?').get(periodId);
    db.exec('COMMIT');
    return row.last_seq;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

module.exports = { openPeriod, nextSeq };
