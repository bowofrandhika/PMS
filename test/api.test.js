'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { openDatabase } = require('../server/db');
const { createApp } = require('../server/app');
const { classifyMoisture } = require('../server/routes/reports');

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
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('json') ? await res.json() : await res.text();
  return { status: res.status, data, headers: res.headers };
}

async function login(username) {
  const r = await call('POST', '/auth/login', null, { username, password: PASSWORD });
  assert.equal(r.status, 200, `login ${username}: ${JSON.stringify(r.data)}`);
  tokens[username] = r.data.token;
}

before(async () => {
  process.env.PMS_DEMO_PASSWORD = PASSWORD;
  db = openDatabase(':memory:');
  const app = createApp(db);
  server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  for (const u of ['spv', 'spv2', 'mandor', 'opdryer', 'opmd', 'qc', 'manager', 'auditor', 'admin']) await login(u);
});

after(() => { if (server) server.close(); if (db) db.close(); });

test('login: username tidak peka huruf besar/kecil', async () => {
  const r = await call('POST', '/auth/login', null, { username: ' SPV ', password: PASSWORD });
  assert.equal(r.status, 200, JSON.stringify(r.data));
});

test('login gagal dengan password salah dan tanpa token ditolak', async () => {
  const bad = await call('POST', '/auth/login', null, { username: 'spv', password: 'salah' });
  assert.equal(bad.status, 401);
  const noTok = await call('GET', '/plans', null);
  assert.equal(noTok.status, 401);
});

test('RBAC: operator MD tidak dapat membuat Production Plan; QC tidak dapat start MD', async () => {
  const r = await call('POST', '/plans', 'opmd', { plan_no: 'X' });
  assert.equal(r.status, 403);
  const s = await call('POST', '/md/start', 'qc', { plan_id: 1 });
  assert.equal(s.status, 403);
});

let planId;
test('plan: DRAFT dibuat, approver tidak boleh sama dengan pembuat (maker-checker), lalu ACTIVE', async () => {
  const c = await call('POST', '/plans', 'spv', {
    plan_no: 'PLN-2610-001', plan_date: '2026-10-12', shift_code: '1', work_order: 'WO-2610-001', product: 'Produk Kering',
    target_bale: 200, dryers: ['DRY-A'], presses: ['PRS-A'], cake_interval_min: 30,
    batch_sequence: [{ batch_code: 'B-2610-001', seq: 1 }], sampling_rules: [{ type: 'TIME_INTERVAL', interval_min: 30 }, { type: 'TROLLEY_INTERVAL', n: 5 }],
  });
  assert.equal(c.status, 201, JSON.stringify(c.data));
  planId = c.data.item.id;
  assert.equal(c.data.item.status, 'DRAFT');

  const self = await call('POST', `/plans/${planId}/approve`, 'spv', {});
  assert.equal(self.status, 409, 'pembuat tidak boleh approve sendiri');

  const ap = await call('POST', `/plans/${planId}/approve`, 'spv2', {});
  assert.equal(ap.status, 200, JSON.stringify(ap.data));
  const act = await call('POST', `/plans/${planId}/activate`, 'spv2', {});
  assert.equal(act.status, 200, JSON.stringify(act.data));
  assert.equal(act.data.item.status, 'ACTIVE');
});

test('plan: revisi membuat versi baru dan induk menjadi SUPERSEDED (tidak ditimpa)', async () => {
  const rev = await call('POST', `/plans/${planId}/revise`, 'spv', { reason: 'Tambah target', target_bale: 220 });
  assert.equal(rev.status, 201, JSON.stringify(rev.data));
  const newId = rev.data.item.id;
  const ap = await call('POST', `/plans/${newId}/approve`, 'spv2', {});
  assert.equal(ap.status, 200);
  const act = await call('POST', `/plans/${newId}/activate`, 'spv2', {});
  assert.equal(act.status, 200, JSON.stringify(act.data));
  const old = await call('GET', `/plans/${planId}`, 'spv');
  assert.equal(old.data.item.status, 'SUPERSEDED');
  planId = newId;
});

test('Shift Mandor: buka shift, FILLING mengubah trolley, handover, lalu tutup', async () => {
  const sh = await call('POST', '/shifts', 'mandor', { plan_id: planId, shift_date: '2026-10-12', shift_code: '1' });
  assert.equal(sh.status, 201, JSON.stringify(sh.data));
  const sid = sh.data.item.id;
  const h = await call('POST', `/shifts/${sid}/events`, 'mandor', { kind: 'HARVEST', batch_code: 'B-2610-001', qty_kg: 500 });
  assert.equal(h.status, 201, JSON.stringify(h.data));
  const f = await call('POST', `/shifts/${sid}/events`, 'mandor', { kind: 'FILLING', batch_code: 'B-2610-001', trolley_code: 'TRL-01', qty_kg: 120 });
  assert.equal(f.status, 201, JSON.stringify(f.data));
  const t = await db.prepare("SELECT status FROM trolleys WHERE code = 'TRL-01'").get();
  assert.equal(t.status, 'FILLING');
  const ready = await call('POST', '/trolleys/TRL-01/status', 'mandor', { status: 'FILLED/READY' });
  assert.equal(ready.status, 200, JSON.stringify(ready.data));
  const bad = await call('POST', '/trolleys/TRL-01/status', 'mandor', { status: 'CLEANING' });
  assert.equal(bad.status, 409, 'transisi tidak valid harus ditolak');
  const noHo = await call('POST', `/shifts/${sid}/close`, 'mandor', {});
  assert.equal(noHo.status, 409, 'shift tanpa handover tidak boleh ditutup');
  const ho = await call('POST', `/shifts/${sid}/handover`, 'mandor', { next_action: 'Lanjutkan Dryer', incoming_user: 'opdryer' });
  assert.equal(ho.status, 201, JSON.stringify(ho.data));
  const cl = await call('POST', `/shifts/${sid}/close`, 'mandor', {});
  assert.equal(cl.status, 200, JSON.stringify(cl.data));
  // shift kedua untuk operasi berikutnya
});

let runId;
test('Dryer: run dibuka, trolley IN/OUT, board 23 kompartemen, stop/resume, sampling, close', async () => {
  const r = await call('POST', '/dryer/runs', 'opdryer', { plan_id: planId, dryer_code: 'DRY-A', run_type: 'STEADY_WIP' });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  runId = r.data.item.id;
  const notPlanned = await call('POST', '/dryer/runs', 'opdryer', { plan_id: planId, dryer_code: 'DRY-B', run_type: 'STEADY_WIP' });
  assert.equal(notPlanned.status, 422, 'DRY-B tidak dipilih pada plan');

  const tin = await call('POST', `/dryer/runs/${runId}/trolley-in`, 'opdryer', { compartment: 1, trolley_code: 'TRL-01' });
  assert.equal(tin.status, 201, JSON.stringify(tin.data));
  assert.equal(tin.data.board.length, 23);
  assert.equal(tin.data.board[0].trolley_code, 'TRL-01');
  const dup = await call('POST', `/dryer/runs/${runId}/trolley-in`, 'opdryer', { compartment: 1, trolley_code: 'TRL-01' });
  assert.equal(dup.status, 409);

  const rd = await call('POST', `/dryer/runs/${runId}/readings`, 'opdryer', { b1_temp: 120, b2_temp: 110, ref_temp: 95 });
  assert.equal(rd.status, 201);
  const sp = await call('POST', `/dryer/runs/${runId}/samples`, 'opdryer', { trolley_code: 'TRL-01', p0: 3.1, mv: 9.2, pri: 2.2 });
  assert.equal(sp.status, 201, JSON.stringify(sp.data));
  const adhoc = await call('POST', `/dryer/runs/${runId}/samples`, 'opdryer', { trolley_code: 'TRL-01', ad_hoc: true });
  assert.equal(adhoc.status, 400, 'AD HOC wajib alasan');

  const stop = await call('POST', `/dryer/runs/${runId}/stop`, 'spv', { remark: 'Cek burner' });
  assert.equal(stop.status, 200, JSON.stringify(stop.data));
  const res = await call('POST', `/dryer/runs/${runId}/restart`, 'opdryer', {});
  assert.equal(res.status, 200);

  const comp = await call('GET', `/dryer/runs/${runId}/sampling-compliance`, 'spv');
  assert.equal(comp.status, 200);
  assert.ok(Array.isArray(comp.data.rules));

  const earlyClose = await call('POST', `/dryer/runs/${runId}/close`, 'opdryer', {});
  assert.equal(earlyClose.status, 409, 'board harus kosong sebelum close');
  const out = await call('POST', `/dryer/runs/${runId}/trolley-out`, 'opdryer', { compartment: 1 });
  assert.equal(out.status, 201, JSON.stringify(out.data));
  const cls = await call('POST', `/dryer/runs/${runId}/close`, 'opdryer', {});
  assert.equal(cls.status, 200, JSON.stringify(cls.data));
  assert.equal(cls.data.item.status, 'CLOSED');
});

test('Process Adjustment: maker-checker, lalu dilaksanakan oleh Operator Dryer', async () => {
  const req = await call('POST', `/plans/${planId}/adjustments`, 'opdryer', { instruction: 'Naikkan B1 5°C', run_id: runId });
  assert.equal(req.status, 201, JSON.stringify(req.data));
  const self = await call('POST', `/adjustments/${req.data.item.id}/approve`, 'opdryer', {});
  assert.equal(self.status, 403, 'operator tidak boleh menyetujui adjustment');
  const ok = await call('POST', `/adjustments/${req.data.item.id}/approve`, 'spv', {});
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  const ex = await call('POST', `/adjustments/${req.data.item.id}/execute`, 'opdryer', { result: 'Dilaksanakan' });
  assert.equal(ex.status, 200);
});

test('MD: challenge wajib PASS sebelum start; count Bale; exception wajib chamber', async () => {
  const early = await call('POST', '/md/start', 'opmd', { plan_id: planId });
  assert.equal(early.status, 409, 'start tanpa challenge harus ditolak');
  for (const t of ['FE_2_5', 'NONFE_2_5', 'SS_2_5']) {
    const c = await call('POST', '/md/challenges', 'opmd', { plan_id: planId, test_type: t, result: 'PASS', context: 'START' });
    assert.equal(c.status, 201, JSON.stringify(c.data));
  }
  const st = await call('POST', '/md/start', 'opmd', { plan_id: planId });
  assert.equal(st.status, 201, JSON.stringify(st.data));

  const bale = await call('POST', '/md/bales', 'opmd', { plan_id: planId, qty: 3 });
  assert.equal(bale.status, 201, JSON.stringify(bale.data));
  assert.equal(bale.data.pallet.ok_count, 3);
  assert.equal(bale.data.batch, 'B-2610-001');

  const noChamber = await call('POST', '/md/exceptions', 'opmd', { plan_id: planId, category: 'REJECT_METAL', metal_type: 'FE' });
  assert.equal(noChamber.status, 400, 'chamber wajib untuk exception');
  const rej = await call('POST', '/md/exceptions', 'opmd', { plan_id: planId, category: 'REJECT_METAL', chamber_code: 'A1', metal_type: 'FE' });
  assert.equal(rej.status, 201, JSON.stringify(rej.data));
  const hold = await call('POST', '/md/exceptions', 'opmd', { plan_id: planId, category: 'HOLD_WS', chamber_code: 'B2' });
  assert.equal(hold.status, 201, JSON.stringify(hold.data));

  const pals = await call('GET', `/md/pallets?plan_id=${planId}`, 'opmd');
  const okPal = pals.data.items[0];
  const holdPal = pals.data.items[1];
  assert.equal(okPal.status_category, 'OK');
  assert.equal(okPal.ok_count, 3, 'Reject tidak mengisi slot pallet');
  assert.equal(holdPal.status, 'HOLD/REJECT', 'Hold dipisah ke pallet sendiri (mixed status dilarang)');
  assert.equal(holdPal.ok_count, 1, 'Hold mengisi slot pallet');
  assert.equal(holdPal.status_category, 'HOLD_WS');
  const more = await call('POST', '/md/bales', 'opmd', { plan_id: planId, qty: 1 });
  assert.equal(more.status, 201, 'Bale OK berikutnya tetap masuk pallet OK, bukan pallet Hold');
  assert.equal(more.data.pallet.id, okPal.id);
});

test('OI-04: indikasi pola Reject/Hold berurutan per chamber (configurable, bukan kesimpulan)', async () => {
  const h1 = await call('POST', '/md/exceptions', 'opmd', { plan_id: planId, category: 'HOLD_WS', chamber_code: 'B2' });
  assert.equal(h1.status, 201, JSON.stringify(h1.data));
  const h2 = await call('POST', '/md/exceptions', 'opmd', { plan_id: planId, category: 'HOLD_WS', chamber_code: 'B2' });
  assert.equal(h2.status, 201, JSON.stringify(h2.data));
  assert.ok(h2.data.alert && /Perlu verifikasi/.test(h2.data.alert), 'alert muncul pada threshold 3 (B2 berurutan)');
  assert.equal(h1.data.alert, null);
});

test('Pallet: batas 36 Bale ditegakkan', async () => {
  const p = await call('POST', '/md/pallets', 'opmd', { plan_id: planId });
  assert.equal(p.status, 201);
  const big = await call('POST', '/md/bales', 'opmd', { plan_id: planId, qty: 37, pallet_id: p.data.item.id });
  assert.equal(big.status, 400, 'qty di luar rentang ditolak');
  const ok = await call('POST', '/md/bales', 'opmd', { plan_id: planId, qty: 36, pallet_id: p.data.item.id });
  assert.equal(ok.status, 201, JSON.stringify(ok.data));
  const over = await call('POST', '/md/bales', 'opmd', { plan_id: planId, qty: 1, pallet_id: p.data.item.id });
  assert.equal(over.status, 409);
  const closed = await call('POST', `/md/pallets/${p.data.item.id}/close`, 'opmd', {});
  assert.equal(closed.data.item.status, 'FULL');
});

test('Batch Cutoff: di luar plan memerlukan approval SPV sebelum verifikasi Mandor', async () => {
  const req = await call('POST', '/md/cutoffs', 'opmd', { plan_id: planId, new_batch_code: 'B-2610-003', boundary_count: 4 });
  assert.equal(req.status, 201, JSON.stringify(req.data));
  assert.equal(req.data.item.off_plan, 1);
  const cid = req.data.item.id;
  const v0 = await call('POST', `/md/cutoffs/${cid}/verify`, 'mandor', {});
  assert.equal(v0.status, 409);
  const ap = await call('POST', `/md/cutoffs/${cid}/approve`, 'spv', {});
  assert.equal(ap.status, 200);
  const v1 = await call('POST', `/md/cutoffs/${cid}/verify`, 'mandor', {});
  assert.equal(v1.status, 200, JSON.stringify(v1.data));
  const st = await call('GET', `/md/status?plan_id=${planId}`, 'opmd');
  assert.equal(st.data.active_batch, 'B-2610-003');
});

test('QC Release: hanya QC; keputusan final satu kali', async () => {
  const q = await call('GET', `/quality/exceptions?plan_id=${planId}`, 'qc');
  assert.equal(q.status, 200);
  const hold = q.data.items.find((x) => x.category === 'HOLD_WS');
  assert.ok(hold);
  const denied = await call('POST', `/quality/exceptions/${hold.id}/release`, 'opmd', { decision: 'RELEASE_GOOD', reason: 'x' });
  assert.equal(denied.status, 403);
  const rel = await call('POST', `/quality/exceptions/${hold.id}/release`, 'qc', { decision: 'RELEASE_GOOD', reason: 'Lolos uji lab' });
  assert.equal(rel.status, 200, JSON.stringify(rel.data));
  const again = await call('POST', `/quality/exceptions/${hold.id}/release`, 'qc', { decision: 'REJECT_FINAL', reason: 'x' });
  assert.equal(again.status, 409);
});

test('Koreksi: tanpa hard delete, nilai lama/baru tersimpan, approval SPV', async () => {
  const bale = await db.prepare("SELECT id FROM bale_events WHERE category = 'OK' LIMIT 1").get();
  const c = await call('POST', '/corrections', 'opmd', { entity: 'bale_events', record_id: bale.id, field: 'remark', new_value: 'Koreksi catatan', reason: 'Typo' });
  assert.equal(c.status, 201, JSON.stringify(c.data));
  const self = await call('POST', `/corrections/${c.data.item.id}/decide`, 'opmd', { decision: 'APPROVED' });
  assert.equal(self.status, 403);
  const ok = await call('POST', `/corrections/${c.data.item.id}/decide`, 'spv', { decision: 'APPROVED' });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  const row = await db.prepare('SELECT remark FROM bale_events WHERE id = ?').get(bale.id);
  assert.equal(row.remark, 'Koreksi catatan');
});

test('Consumable & OEE: harga belum ada = PRICE NOT SET; OEE INCOMPLETE tanpa QC/planned timer', async () => {
  const sum = await call('GET', `/consumables/summary?plan_id=${planId}`, 'spv');
  assert.equal(sum.status, 200);
  const plastik = sum.data.items.find((x) => x.code === 'PLASTIK-SIR');
  assert.equal(plastik.cost, 'PRICE NOT SET');
  const tx = await call('POST', '/consumables/transactions', 'mandor', { consumable_id: 1, type: 'USE', qty: 2, plan_id: planId });
  assert.equal(tx.status, 201, JSON.stringify(tx.data));
  const price = await call('POST', '/consumables/1/prices', 'manager', { price: 15000, effective_start: '2026-10-01' });
  assert.equal(price.status, 201, JSON.stringify(price.data));
  const oee = await call('GET', `/kpi/oee?plan_id=${planId}&dryer=DRY-A`, 'spv');
  assert.equal(oee.data.items[0].status, 'INCOMPLETE');
  assert.ok(oee.data.items[0].missing.length > 0);
  const oee2 = await call('GET', `/kpi/oee?plan_id=${planId}&dryer=DRY-A&planned_min=600`, 'spv');
  assert.equal(oee2.data.items[0].A !== null, true);
});

test('Laporan: CSV kompatibel Excel (BOM), halaman print A4, audit dibatasi', async () => {
  const rawRes = await fetch(`${base}/api/reports/exceptions?plan_id=${planId}&format=csv`, { headers: { Authorization: `Bearer ${tokens.spv}` } });
  assert.equal(rawRes.status, 200);
  assert.match(rawRes.headers.get('content-type'), /text\/csv/);
  const bytes = new Uint8Array(await rawRes.arrayBuffer());
  assert.deepEqual([...bytes.slice(0, 3)], [0xef, 0xbb, 0xbf], 'BOM UTF-8 untuk Excel');
  const pr = await call('GET', `/reports/pallets?plan_id=${planId}&format=print`, 'manager');
  assert.match(pr.headers.get('content-type'), /text\/html/);
  assert.match(pr.data, /@page\{size:A4/);
  const auditDenied = await call('GET', '/reports/audit?format=json', 'mandor');
  assert.equal(auditDenied.status, 403);
  const auditOk = await call('GET', '/reports/audit?format=json', 'auditor');
  assert.equal(auditOk.status, 200);
  assert.ok(auditOk.data.count > 0);
  const dash = await call('GET', `/dashboard?plan_id=${planId}`, 'manager');
  assert.equal(dash.status, 200);
  assert.ok(dash.data.pending.qc_exceptions_pending >= 0);
});

test('Audit trail: aksi tercatat tanpa hard delete', async () => {
  const a = await call('GET', '/audit?limit=500', 'auditor');
  assert.equal(a.status, 200);
  assert.ok(a.data.items.some((x) => x.action === 'APPROVE' && x.entity === 'process_adjustments'));
  assert.ok(a.data.items.some((x) => x.action === 'VERIFY' && x.entity === 'batch_cutoffs'));
});

test('Klasifikasi moisture cangkang sesuai dokumen 11.4', () => {
  assert.equal(classifyMoisture(14).status, 'PASS');
  assert.equal(classifyMoisture(15).status, 'PASS');
  assert.equal(classifyMoisture(16).status, 'MONITORING');
  assert.equal(classifyMoisture(18).status, 'MONITORING');
  assert.equal(classifyMoisture(18.1).status, 'HOLD_REVIEW');
});

test('Halaman statis & logo tersedia; endpoint tidak dikenal memberi JSON 404', async () => {
  const idx = await fetch(base + '/');
  assert.equal(idx.status, 200);
  assert.match(await idx.text(), /PMS Produksi Kering/);
  const logo = await fetch(base + '/logo.svg');
  assert.equal(logo.status, 200);
  const nf = await call('GET', '/tidak-ada', null);
  assert.equal(nf.status, 404);
});
