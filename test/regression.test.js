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
    plan_no: no, plan_date: '2026-10-12', shift_code: '1', work_order: `WO-${no}`, product: 'Produk Kering',
    target_bale: 200, dryers: ['DRY-A'], presses: ['PRS-A'], cake_interval_min: 30,
    batch_sequence: [{ batch_code: 'B-2610-001', seq: 1 }],
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
  for (const u of ['spv', 'spv2', 'opmd', 'opdryer', 'mandor']) {
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
  const otherId = db.prepare("SELECT id FROM production_plans WHERE plan_no = 'REG-OEE'").get().id;  // sudah CLOSED
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
  const bale = await call('POST', '/md/bales', 'opmd', { plan_id: planId, pallet_id: ok.data.item.id, batch_code: 'B-2610-001', qty: 2 });
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
