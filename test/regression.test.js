'use strict';

// Tes regresi untuk bug hasil review 12 Oktober 2026 (lihat docs/REVIEW-2026-10-12.md).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDatabase } = require('../server/db');
const { createApp } = require('../server/app');

const PASSWORD = 'Password123!';
let server;
let base;
let db;
const tokens = {};

async function call(method, path, user, body) {
  const headers = {};
  if (user) headers.Authorization = `Bearer ${tokens[user]}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(base + '/api' + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

async function login(username, password = PASSWORD) {
  return call('POST', '/auth/login', null, { username, password });
}

function planBody(no, extra = {}) {
  return {
    plan_date: '2026-10-12', shift_code: '1', work_order: 'WO-BELL-001', product: 'SIR20',
    target_bale: 200, dryers: ['DRY-A'], presses: ['PRS-A'], cake_interval_min: 30,
    batch_sequence: [{ batch_code: 'B-0001', seq: 1 }],
    sampling_rules: [{ type: 'TIME_INTERVAL', interval_min: 30 }],
    ...extra,
  };
}

async function createActivePlan(no) {
  const c = await call('POST', '/plans', 'spv', planBody(no));
  assert.equal(c.status, 201, JSON.stringify(c.data));
  const id = c.data.item.id;
  assert.equal((await call('POST', `/plans/${id}/approve`, 'spv2', {})).status, 200);
  const a = await call('POST', `/plans/${id}/activate`, 'spv2', {});
  assert.equal(a.status, 200, JSON.stringify(a.data));
  return id;
}

before(async () => {
  process.env.PMS_DEMO_PASSWORD = PASSWORD;
  db = openDatabase(':memory:');
  const app = createApp(db);
  server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  for (const u of ['spv', 'spv2', 'opmd', 'opdryer', 'mandor', 'admin']) {
    const r = await login(u);
    tokens[u] = r.data.token;
  }
});

after(() => { if (server) server.close(); if (db) db.close(); });

test('B-01 OEE: gross/good dihitung dari jumlah Bale (gross_qty), bukan jumlah baris event', async () => {
  const planId = await createActivePlan('REG-OEE');
  for (const t of ['FE_2_5', 'NONFE_2_5', 'SS_2_5']) {
    await call('POST', '/md/challenges', 'opmd', { plan_id: planId, test_type: t, result: 'PASS' });
  }
  assert.equal((await call('POST', '/md/start', 'opmd', { plan_id: planId })).status, 201);
  assert.equal((await call('POST', '/md/bales', 'opmd', { plan_id: planId, qty: 10 })).status, 201);
  assert.equal((await call('POST', '/md/exceptions', 'opmd', { plan_id: planId, category: 'REJECT_METAL', chamber_code: 'A1', metal_type: 'FE' })).status, 201);

  const dash = await call('GET', `/dashboard?plan_id=${planId}`, 'spv');
  const gross = dash.data.bales.reduce((s, b) => s + b.gross, 0);
  const oee = await call('GET', `/kpi/oee?plan_id=${planId}`, 'spv');
  assert.equal(oee.data.items[0].gross_bale, gross, 'gross OEE harus sama dengan dashboard');
  assert.equal(oee.data.items[0].gross_bale, 11);
  assert.equal(oee.data.items[0].good_bale, 10, 'Bale OK 10; Reject belum Good');
});

test('B-02: plan kedua tidak dapat diaktifkan selama plan lain masih ACTIVE', async () => {
  // Tutup semua plan ACTIVE yang tersisa dari tes sebelumnya.
  for (const row of db.prepare("SELECT id FROM production_plans WHERE status = 'ACTIVE'").all()) {
    assert.equal((await call('POST', `/plans/${row.id}/close`, 'spv2', {})).status, 200);
  }
  const first = await createActivePlan('REG-ACT-1');
  const firstRow = db.prepare('SELECT id FROM production_plans WHERE id = ?').get(first);
  assert.ok(firstRow);
  const c = await call('POST', '/plans', 'spv', planBody('REG-ACT-2'));
  const second = c.data.item.id;
  await call('POST', `/plans/${second}/approve`, 'spv2', {});
  const blocked = await call('POST', `/plans/${second}/activate`, 'spv2', {});
  assert.equal(blocked.status, 409, JSON.stringify(blocked.data));
  assert.match(blocked.data.error, /masih ACTIVE/);

  assert.equal((await call('POST', `/plans/${first}/close`, 'spv2', {})).status, 200);
  const ok = await call('POST', `/plans/${second}/activate`, 'spv2', {});
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
});

test('B-03: lock yang sudah kedaluwarsa tidak langsung mengunci lagi pada satu kesalahan', async () => {
  for (let i = 0; i < 5; i++) await login('opdryer', 'salah');
  assert.equal((await login('opdryer')).status, 423);
  db.prepare("UPDATE users SET locked_until = ? WHERE username = 'opdryer'").run(new Date(Date.now() - 60000).toISOString());
  const r = await login('opdryer', 'salah');
  assert.equal(r.status, 401);
  const row = db.prepare("SELECT failed_attempts, locked_until FROM users WHERE username = 'opdryer'").get();
  assert.equal(row.failed_attempts, 1);
  assert.equal(row.locked_until, null);
  assert.equal((await login('opdryer')).status, 200, 'login benar tetap berhasil');
});

test('B-08: akun nonaktif dengan password salah dijawab 401 (status akun tidak bocor)', async () => {
  db.prepare("UPDATE users SET active = 0 WHERE username = 'opdryer'").run();
  try {
    assert.equal((await login('opdryer', 'salah')).status, 401);
    const right = await login('opdryer');
    assert.equal(right.status, 403);
  } finally {
    db.prepare("UPDATE users SET active = 1 WHERE username = 'opdryer'").run();
  }
});

test('B-04: dashboard menghitung semua plan DRAFT yang menunggu approval, tanpa batas tanggal', async () => {
  const before = (await call('GET', '/dashboard', 'spv')).data.pending.plans_awaiting_approval;
  const c = await call('POST', '/plans', 'spv', planBody('REG-OLD', { plan_date: '2026-01-01' }));
  assert.equal(c.status, 201);
  const after = (await call('GET', '/dashboard', 'spv')).data.pending.plans_awaiting_approval;
  assert.equal(after, before + 1);
});

test('B-05/B-07: exception Reject menyimpan pallet milik plan yang sama; pallet plan lain ditolak', async () => {
  // Plan aktif saat ini adalah REG-ACT-2 (hasil tes B-02).
  const planId = db.prepare("SELECT id FROM production_plans WHERE status = 'ACTIVE'").get().id;
  for (const t of ['FE_2_5', 'NONFE_2_5', 'SS_2_5']) {
    await call('POST', '/md/challenges', 'opmd', { plan_id: planId, test_type: t, result: 'PASS' });
  }
  assert.equal((await call('POST', '/md/start', 'opmd', { plan_id: planId })).status, 201);
  const own = await call('POST', '/md/pallets', 'opmd', { plan_id: planId, location: 'Area Palletizing' });
  assert.equal(own.status, 201);
  const ok = await call('POST', '/md/exceptions', 'opmd', {
    plan_id: planId, category: 'REJECT_METAL', chamber_code: 'B1', metal_type: 'SS', pallet_id: own.data.item.id,
  });
  assert.equal(ok.status, 201, JSON.stringify(ok.data));
  assert.equal(ok.data.item.pallet_id, own.data.item.id);
  // B-09: Reject adalah Bale output yang mengisi slot pallet (slot_count), tetapi tidak masuk komposisi OK.
  const pal = db.prepare('SELECT slot_count FROM pallets WHERE id = ?').get(own.data.item.id);
  assert.equal(pal.slot_count, 1);
  const comp = db.prepare("SELECT COUNT(*) AS n FROM pallet_compositions WHERE pallet_id = ? AND status_category = 'OK'").get(own.data.item.id);
  assert.equal(comp.n, 0);

  // Pallet milik plan lain (plan sudah CLOSED, dibuat langsung di database untuk skenario ini).
  const otherId = db.prepare("SELECT id FROM production_plans WHERE status = 'CLOSED' ORDER BY id LIMIT 1").get().id;  // sudah CLOSED
  const otherPallet = db.prepare(`INSERT INTO pallets (plan_id, manual_no, forming_box_code, status, location, max_bale, created_at, created_by)
    VALUES (?, NULL, NULL, 'OPEN', 'Area Palletizing', 36, ?, 'test')`).run(otherId, new Date().toISOString());
  const otherPalletId = Number(otherPallet.lastInsertRowid);
  const cross = await call('POST', '/md/exceptions', 'opmd', {
    plan_id: planId, category: 'HOLD_OTHER', chamber_code: 'A2', pallet_id: otherPalletId,
  });
  assert.equal(cross.status, 400, JSON.stringify(cross.data));
  const crossCut = await call('POST', '/md/cutoffs', 'opmd', {
    plan_id: planId, new_batch_code: 'B-2610-002', boundary_count: 0, pallet_id: otherPalletId,
  });
  assert.equal(crossCut.status, 400, JSON.stringify(crossCut.data));
});

test('B-10: input sampling_rules/batch_sequence berisi null ditolak 400, bukan error server', async () => {
  const a = await call('POST', '/plans', 'spv', planBody('REG-NULL-1', { sampling_rules: [null] }));
  assert.equal(a.status, 400);
  const b = await call('POST', '/plans', 'spv', planBody('REG-NULL-2', { batch_sequence: [null] }));
  assert.equal(b.status, 400);
});

test('B-09: slot_count menghitung semua Bale output (OK + Hold) dan kolom ok_count dimigrasikan', async () => {
  const planId = db.prepare("SELECT id FROM production_plans WHERE status = 'ACTIVE'").get().id;
  const ok = await call('POST', '/md/pallets', 'opmd', { plan_id: planId, location: 'Area Palletizing' });
  assert.equal(ok.status, 201);
  const bale = await call('POST', '/md/bales', 'opmd', { plan_id: planId, pallet_id: ok.data.item.id, batch_code: 'B-0001', qty: 2 });
  assert.equal(bale.status, 201, JSON.stringify(bale.data));
  assert.equal(db.prepare('SELECT slot_count FROM pallets WHERE id = ?').get(ok.data.item.id).slot_count, 2);
  // Hold tidak boleh dicampur ke pallet OK (PAL-004); pallet terpisah.
  const hp = await call('POST', '/md/pallets', 'opmd', { plan_id: planId, location: 'Area Hold' });
  const hold = await call('POST', '/md/exceptions', 'opmd', { plan_id: planId, category: 'HOLD_OTHER', chamber_code: 'A2', pallet_id: hp.data.item.id });
  assert.equal(hold.status, 201, JSON.stringify(hold.data));
  assert.equal(db.prepare('SELECT slot_count FROM pallets WHERE id = ?').get(hp.data.item.id).slot_count, 1);
  const cols = db.prepare('PRAGMA table_info(pallets)').all().map((c) => c.name);
  assert.ok(cols.includes('slot_count') && !cols.includes('ok_count'));
});

test('B-12: konteks challenge MD ditentukan server; setelah STOP menjadi RESTART', async () => {
  const planId = db.prepare("SELECT id FROM production_plans WHERE status = 'ACTIVE'").get().id;
  const before = await call('POST', '/md/challenges', 'opmd', { plan_id: planId, test_type: 'FE_2_5', result: 'PASS', context: 'RESTART' });
  assert.equal(before.status, 201, JSON.stringify(before.data));
  assert.equal(before.data.item.context, 'START');
  await call('POST', '/md/stop', 'opmd', { plan_id: planId, reason: 'uji' });
  const after = await call('POST', '/md/challenges', 'opmd', { plan_id: planId, test_type: 'FE_2_5', result: 'PASS' });
  assert.equal(after.status, 201, JSON.stringify(after.data));
  assert.equal(after.data.item.context, 'RESTART');
});

test('B-11: STARTUP_EMPTY menomori trolley menurut urutan masuk; carry-over keluar lalu masuk kembali', async () => {
  const planId = db.prepare("SELECT id FROM production_plans WHERE status = 'ACTIVE'").get().id;
  const run = await call('POST', '/dryer/runs', 'opdryer', { plan_id: planId, dryer_code: 'DRY-A', run_type: 'STARTUP_EMPTY' });
  assert.equal(run.status, 201, JSON.stringify(run.data));
  const rid = run.data.item.id;
  for (const code of ['TRL-01', 'TRL-02', 'TRL-03']) {
    assert.equal((await call('POST', `/trolleys/${code}/status`, 'mandor', { status: 'FILLING', batch_code: 'B-2610-001' })).status, 200);
    assert.equal((await call('POST', `/trolleys/${code}/status`, 'mandor', { status: 'FILLED/READY' })).status, 200);
  }
  for (const [comp, code] of [[1, 'TRL-01'], [2, 'TRL-02'], [3, 'TRL-03']]) {
    const r = await call('POST', `/dryer/runs/${rid}/trolley-in`, 'opdryer', { compartment: comp, trolley_code: code });
    assert.equal(r.status, 201, JSON.stringify(r.data));
  }
  const comp = await call('GET', `/dryer/runs/${rid}/sampling-compliance`, 'opdryer');
  assert.equal(comp.status, 200, JSON.stringify(comp.data));
  assert.equal(comp.data.sequence_basis, 'MASUK');
  assert.equal(comp.data.trolleys_sequenced, 3);
  // Carry-over keluar tidak mengubah trolley jadi keluar Dryer; trolley tetap IN DRYER.
  const co = await call('POST', `/dryer/runs/${rid}/carry-over`, 'opdryer', { trolley_code: 'TRL-03' });
  assert.equal(co.status, 201, JSON.stringify(co.data));
  assert.equal(db.prepare("SELECT status FROM trolleys WHERE code = 'TRL-03'").get().status, 'IN DRYER');
  // Masuk kembali ke kompartemen 4 pada papan run yang sama.
  const ci = await call('POST', `/dryer/runs/${rid}/carry-in`, 'opdryer', { compartment: 4, trolley_code: 'TRL-03' });
  assert.equal(ci.status, 201, JSON.stringify(ci.data));
  const board = ci.data.board;
  assert.equal(board[3].trolley_code, 'TRL-03');
  assert.equal(board[2].trolley_code, null);
});

test('B-09 migrasi: database lama (kolom ok_count) dibuka dan kolom diganti slot_count', () => {
  const file = path.join(os.tmpdir(), `pms-mig-${process.pid}-${Date.now()}.db`);
  try {
    let d = openDatabase(file);
    d.exec('ALTER TABLE pallets RENAME COLUMN slot_count TO ok_count');
    d.exec("UPDATE pallets SET ok_count = 0");
    d.close();
    d = openDatabase(file);
    const cols = d.prepare('PRAGMA table_info(pallets)').all().map((c) => c.name);
    assert.ok(cols.includes('slot_count'));
    assert.ok(!cols.includes('ok_count'));
    d.close();
  } finally {
    for (const f of [file, `${file}-wal`, `${file}-shm`]) fs.rmSync(f, { force: true });
  }
});

test('Nomor Produksi: format DPS-DDMMYY-NNN, nomor urut berlanjut lintas tanggal dan shift, input plan_no diabaikan', async () => {
  const a = await call('POST', '/plans', 'spv', planBody('IGNORED-1', { plan_date: '2026-10-12', target_bale: 10 }));
  assert.equal(a.status, 201, JSON.stringify(a.data));
  assert.match(a.data.item.plan_no, /^DP1-121026-\d{3}$/);
  const b = await call('POST', '/plans', 'spv', planBody('IGNORED-2', { plan_date: '2026-10-12', shift_code: '2', target_bale: 10 }));
  assert.equal(b.status, 201);
  assert.match(b.data.item.plan_no, /^DP2-121026-\d{3}$/);
  const c = await call('POST', '/plans', 'spv', planBody('IGNORED-3', { plan_date: '2026-10-13', target_bale: 10 }));
  assert.match(c.data.item.plan_no, /^DP1-131026-\d{3}$/);
  const na = Number(a.data.item.plan_no.slice(-3));
  assert.equal(Number(b.data.item.plan_no.slice(-3)), na + 1);
  assert.equal(Number(c.data.item.plan_no.slice(-3)), na + 2);
});

test('Target Bale dan kg saling mengisi (1 Bale = 35 kg); yang diisi duluan yang dipakai', async () => {
  const byBale = await call('POST', '/plans', 'spv', planBody('T-1', { target_bale: 1000, target_kg: undefined }));
  assert.equal(byBale.status, 201, JSON.stringify(byBale.data));
  assert.equal(byBale.data.item.target_kg, 35000);
  const byKg = await call('POST', '/plans', 'spv', planBody('T-2', { target_bale: undefined, target_kg: 7000 }));
  assert.equal(byKg.status, 201, JSON.stringify(byKg.data));
  assert.equal(byKg.data.item.target_bale, 200);
  const mismatch = await call('POST', '/plans', 'spv', planBody('T-3', { target_bale: 10, target_kg: 999 }));
  assert.equal(mismatch.status, 400);
  const notMultiple = await call('POST', '/plans', 'spv', planBody('T-4', { target_bale: undefined, target_kg: 1000 }));
  assert.equal(notMultiple.status, 400);
  // PATCH: mengubah target kg menghitung ulang target Bale.
  const patched = await call('PATCH', `/plans/${byBale.data.item.id}`, 'spv', { target_kg: 3500 });
  assert.equal(patched.status, 200, JSON.stringify(patched.data));
  assert.equal(patched.data.item.target_bale, 100);
});

test('Grade hanya SIR20 atau SIR10; urutan batch hanya B-0001..B-0003 tanpa duplikat', async () => {
  assert.equal((await call('POST', '/plans', 'spv', planBody('G-1', { product: 'Produk Kering' }))).status, 400);
  assert.equal((await call('POST', '/plans', 'spv', planBody('G-2', { product: 'SIR10' }))).status, 201);
  assert.equal((await call('POST', '/plans', 'spv', planBody('G-3', { batch_sequence: [{ batch_code: 'B-2610-001', seq: 1 }] }))).status, 400);
  assert.equal((await call('POST', '/plans', 'spv', planBody('G-4', { batch_sequence: [{ batch_code: 'B-0001', seq: 1 }, { batch_code: 'B-0001', seq: 2 }] }))).status, 400);
  const ok = await call('POST', '/plans', 'spv', planBody('G-5', { batch_sequence: [{ batch_code: 'B-0001', seq: 1 }, { batch_code: 'B-0002', seq: 2 }, { batch_code: 'B-0003', seq: 3 }] }));
  assert.equal(ok.status, 201, JSON.stringify(ok.data));
});

test('Work Order: dibuat oleh SPV, nomor unik, WO nonaktif tidak bisa dipakai plan, tidak ada hard delete', async () => {
  const list = await call('GET', '/work-orders', 'spv');
  assert.equal(list.status, 200);
  assert.ok(list.data.items.some((w) => w.wo_no === 'WO-BELL-001' && w.target_ton === 500));
  const created = await call('POST', '/work-orders', 'spv', { wo_no: 'wo-test-900', buyer: 'Uji', target_ton: 12.5 });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  assert.equal(created.data.item.wo_no, 'WO-TEST-900');
  assert.equal(created.data.item.target_kg, 12500);
  assert.equal((await call('POST', '/work-orders', 'spv', { wo_no: 'WO-TEST-900', buyer: 'Uji', target_ton: 1 })).status, 409);
  assert.equal((await call('POST', '/work-orders', 'opmd', { wo_no: 'WO-TEST-901', buyer: 'Uji', target_ton: 1 })).status, 403);
  const id = created.data.item.id;
  const off = await call('POST', `/work-orders/${id}/toggle`, 'spv', {});
  assert.equal(off.data.item.status, 'NONAKTIF');
  assert.equal((await call('POST', '/plans', 'spv', planBody('WO-OFF', { work_order: 'WO-TEST-900' }))).status, 400);
  const on = await call('POST', `/work-orders/${id}/toggle`, 'spv', {});
  assert.equal(on.data.item.status, 'ACTIVE');
  const upd = await call('PATCH', `/work-orders/${id}`, 'spv', { target_ton: 20 });
  assert.equal(upd.data.item.target_kg, 20000);
});

test('Nomor Produksi: shift 2 melanjutkan nomor urut yang sama (tidak per shift)', async () => {
  const a = await call('POST', '/plans', 'spv', planBody('S-1', { plan_date: '2026-10-20', shift_code: '1', target_bale: 10 }));
  const b = await call('POST', '/plans', 'spv', planBody('S-2', { plan_date: '2026-10-20', shift_code: '2', target_bale: 10 }));
  const na = Number(a.data.item.plan_no.slice(-3));
  assert.equal(a.data.item.plan_no.slice(0, 4), 'DP1-');
  assert.equal(b.data.item.plan_no, `DP2-201026-${String(na + 1).padStart(3, '0')}`);
});

test('Hard delete: DRAFT dihapus permanen, isi tersimpan di riwayat; plan non-DRAFT ditolak', async () => {
  const d = await call('POST', '/plans', 'spv', planBody('HD-1', { target_bale: 10 }));
  const id = d.data.item.id;
  const noReason = await call('DELETE', `/plans/${id}`, 'spv', {});
  assert.equal(noReason.status, 400);
  const del = await call('DELETE', `/plans/${id}`, 'spv', { reason: 'salah input uji' });
  assert.equal(del.status, 200, JSON.stringify(del.data));
  assert.equal(db.prepare('SELECT id FROM production_plans WHERE id = ?').get(id), undefined);
  const hist = db.prepare("SELECT * FROM deleted_records WHERE entity = 'production_plans' AND record_id = ?").get(id);
  assert.ok(hist, 'riwayat harus ada');
  assert.equal(hist.reason, 'salah input uji');
  assert.equal(JSON.parse(hist.data).plan_no, d.data.item.plan_no);
  const list = await call('GET', '/deleted-records', 'admin');
  assert.equal(list.status, 200);
  assert.ok(list.data.items.some((x) => x.record_id === id));
  // plan yang sudah ACTIVE tidak boleh dihapus permanen
  const activeId = db.prepare("SELECT id FROM production_plans WHERE status = 'ACTIVE' LIMIT 1").get().id;
  const blocked = await call('DELETE', `/plans/${activeId}`, 'spv', { reason: 'uji' });
  assert.equal(blocked.status, 409);
});

test('Hard delete WO: ditolak bila sudah dipakai Nomor Produksi; WO baru bisa dihapus', async () => {
  const w = await call('POST', '/work-orders', 'spv', { wo_no: 'WO-HD-1', buyer: 'Uji', target_ton: 5 });
  const del = await call('DELETE', `/work-orders/${w.data.item.id}`, 'spv', { reason: 'uji hapus' });
  assert.equal(del.status, 200, JSON.stringify(del.data));
  const used = await call('DELETE', '/work-orders/1', 'spv', { reason: 'uji' });
  assert.equal(used.status, 409);
  const denied = await call('DELETE', '/work-orders/1', 'opmd', { reason: 'uji' });
  assert.equal(denied.status, 403);
});

test('Progres WO: produksi dihitung dari Bale output x 35 kg, per Nomor Produksi', async () => {
  const list = await call('GET', '/work-orders', 'spv');
  const bell = list.data.items.find((w) => w.wo_no === 'WO-BELL-001');
  assert.ok(bell.plans.length >= 1);
  assert.equal(bell.produced_kg, bell.produced_bale * 35);
  assert.ok(bell.progress_pct >= 0);
});

test('Kode batch B-NNNN: B-0023 dan B-0024 diterima dan dibuat di master batch otomatis', async () => {
  const p = await call('POST', '/plans', 'spv', planBody('BATCH-23', { batch_sequence: [{ batch_code: 'B-0023', seq: 1 }, { batch_code: 'B-0024', seq: 2 }] }));
  assert.equal(p.status, 201, JSON.stringify(p.data));
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM batches WHERE code IN ('B-0023','B-0024')").get().n, 2);
  assert.equal((await call('POST', '/plans', 'spv', planBody('BATCH-X', { batch_sequence: [{ batch_code: 'B-23', seq: 1 }] }))).status, 400);
});

test('Kesiapan alat: Dryer tidak dipilih di plan = TIDAK SIAP dengan alasan; MD butuh challenge PASS', async () => {
  const planId = db.prepare("SELECT id FROM production_plans WHERE status = 'ACTIVE' LIMIT 1").get().id;
  const r = await call('GET', `/equipment/readiness?plan_id=${planId}`, 'opdryer');
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const dryB = r.data.items.find((x) => x.code === 'DRY-B');
  assert.equal(dryB.ready, false);
  assert.ok(dryB.reasons.some((x) => x.includes('Tidak dipilih')));
  const md = r.data.items.find((x) => x.code === 'MD');
  assert.ok(md, 'MD harus ada');
  assert.equal(typeof md.ready, 'boolean');
  assert.ok(r.data.items.every((x) => ['DRYER', 'PRESS', 'PRESS_CHAMBER', 'MD'].includes(x.type)));
});

test('Master batch: kode B-NNNN dan proses DRY_PRODUCTION; format lain ditolak', async () => {
  const ok = await call('POST', '/master/batches', 'admin', { code: 'B-0099', process: 'DRY_PRODUCTION' });
  assert.equal(ok.status, 201, JSON.stringify(ok.data));
  assert.equal(ok.data.item.process, 'DRY_PRODUCTION');
  assert.equal((await call('POST', '/master/batches', 'admin', { code: 'B-99' })).status, 400);
  assert.equal((await call('POST', '/master/batches', 'admin', { code: 'B-0100', process: 'WET_PRODUCTION' })).status, 400);
});

test('Tutup buku: wajib export; setelah tutup buku nomor mulai dari 001 pada periode baru', async () => {
  const { openDatabase: open2 } = require('../server/db');
  const { createApp: app2fn } = require('../server/app');
  const db2 = open2(':memory:');
  const srv = app2fn(db2).listen(0, '127.0.0.1');
  await new Promise((r) => srv.once('listening', r));
  const base2 = `http://127.0.0.1:${srv.address().port}/api`;
  const req = async (method, path, user, body) => {
    const headers = {};
    if (user) headers.Authorization = `Bearer ${tokens2[user]}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetch(base2 + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
    return { status: res.status, data: await res.json().catch(() => null) };
  };
  const tokens2 = {};
  for (const u of ['admin', 'spv', 'spv2']) tokens2[u] = (await req('POST', '/auth/login', null, { username: u, password: PASSWORD })).data.token;
  try {
    const a = await req('POST', '/plans', 'spv', planBody('X', { plan_date: '2026-10-12', target_bale: 10 }));
    assert.equal(a.status, 201, JSON.stringify(a.data));
    assert.equal(a.data.item.plan_no, 'DP1-121026-001');
    // Tutup buku tanpa export ditolak.
    const noExport = await req('POST', '/periods/close', 'admin', { confirm: 'TUTUP BUKU' });
    assert.equal(noExport.status, 409);
    // Plan DRAFT masih ada: tutup buku ditolak meski sudah export.
    assert.equal((await req('GET', '/periods/current/export', 'admin')).status, 200);
    const draftBlock = await req('POST', '/periods/close', 'admin', { confirm: 'TUTUP BUKU' });
    assert.equal(draftBlock.status, 409);
    // Hapus DRAFT (hard delete), lalu tutup buku.
    assert.equal((await req('DELETE', `/plans/${a.data.item.id}`, 'spv', { reason: 'uji tutup buku' })).status, 200);
    const wrongText = await req('POST', '/periods/close', 'admin', { confirm: 'ya' });
    assert.equal(wrongText.status, 400);
    const closed = await req('POST', '/periods/close', 'admin', { confirm: 'TUTUP BUKU' });
    assert.equal(closed.status, 200, JSON.stringify(closed.data));
    // Nomor baru mulai dari 001 pada periode baru, dan tidak pernah dipakai ulang di periode lama.
    const b = await req('POST', '/plans', 'spv', planBody('Y', { plan_date: '2026-12-31', target_bale: 10 }));
    assert.equal(b.data.item.plan_no, 'DP1-311226-001');
    const periods = (await req('GET', '/periods', 'admin')).data.items;
    assert.equal(periods.length, 2);
    assert.equal(periods.find((p) => p.status === 'CLOSED').export_count, 1);
  } finally {
    srv.close();
  }
});

test('Edit: plan DRAFT dan WO diubah SPV; operator ditolak; plan non-DRAFT tidak bisa diubah langsung', async () => {
  const c = await call('POST', '/plans', 'spv', planBody('EDIT-1', { target_bale: 10 }));
  const id = c.data.item.id;
  const ok = await call('PATCH', `/plans/${id}`, 'spv', { target_bale: 50, batch_sequence: [{ batch_code: 'B-0031', seq: 1 }] });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.equal(ok.data.item.target_kg, 1750);
  assert.equal(ok.data.item.batch_sequence[0].batch_code, 'B-0031');
  assert.equal((await call('PATCH', `/plans/${id}`, 'opdryer', { target_bale: 5 })).status, 403);
  assert.equal((await call('PATCH', `/plans/${id}`, 'mandor', { target_bale: 5 })).status, 403);
  const activeId = db.prepare("SELECT id FROM production_plans WHERE status = 'ACTIVE' LIMIT 1").get().id;
  assert.equal((await call('PATCH', `/plans/${activeId}`, 'spv', { target_bale: 5 })).status, 409);
  const w = await call('POST', '/work-orders', 'spv', { wo_no: 'WO-EDIT-1', buyer: 'Awal', target_ton: 10 });
  const wu = await call('PATCH', `/work-orders/${w.data.item.id}`, 'admin', { buyer: 'Baru', target_ton: 15 });
  assert.equal(wu.status, 200, JSON.stringify(wu.data));
  assert.equal(wu.data.item.target_kg, 15000);
  assert.equal((await call('PATCH', `/work-orders/${w.data.item.id}`, 'opmd', { buyer: 'X' })).status, 403);
});

test('Riwayat: SPV boleh melihat; operator ditolak; pencarian, paginasi, dan riwayat per data', async () => {
  const { ROLES } = require('../server/rbac');
  assert.equal(ROLES.AUDITOR, undefined, 'peran AUDITOR sudah dihapus');
  const c = await call('POST', '/plans', 'spv', planBody('HIST-1', { target_bale: 10 }));
  const id = c.data.item.id;
  const del = await call('DELETE', `/plans/${id}`, 'spv', { reason: 'uji riwayat' });
  assert.equal(del.status, 200);
  const spvList = await call('GET', '/deleted-records?limit=1&page=1', 'spv');
  assert.equal(spvList.status, 200);
  assert.equal(spvList.data.items.length, 1);
  assert.equal(spvList.data.limit, 1);
  assert.ok(spvList.data.pages >= 1);
  assert.equal((await call('GET', '/deleted-records', 'opdryer')).status, 403);
  const srch = await call('GET', '/deleted-records?q=' + encodeURIComponent('uji riwayat'), 'spv');
  assert.ok(srch.data.items.some((x) => x.record_id === id));
  const h = await call('GET', `/history?entity=production_plans&record_id=${id}`, 'spv');
  assert.equal(h.status, 200);
  assert.equal(h.data.deleted.length, 1);
  assert.ok(h.data.audit.some((x) => x.action === 'CREATE'));
  assert.equal((await call('GET', '/history?entity=production_plans', 'spv')).status, 400);
});
