'use strict';

const express = require('express');
const { nowIso } = require('../db');
const { badRequest, notFound, conflict, unprocessable, audit, requireString, requireNumber, requireEnum, optionalTime } = require('../http');
const D = require('../domain');

const CHALLENGE_TESTS = ['FE_2_5', 'NONFE_2_5', 'SS_2_5'];

function buildRouter(db, { requireAuth, requirePerm, loadPlan }) {
  const r = express.Router();
  r.exposed = {};
  const palletMax = Number(db.prepare("SELECT value FROM settings WHERE key = 'bale_per_pallet_max'").get().value) || D.PALLET_MAX_BALE;

  const loadPallet = (id) => {
    const p = db.prepare('SELECT * FROM pallets WHERE id = ?').get(id);
    if (!p) throw notFound('Pallet');
    return p;
  };

  // Batch aktif = Batch hasil Batch Cutoff terakhir yang sudah VERIFIED, atau urutan pertama plan.
  function activeBatch(plan) {
    const cut = db.prepare("SELECT new_batch_code FROM batch_cutoffs WHERE plan_id = ? AND status = 'VERIFIED' ORDER BY id DESC LIMIT 1").get(plan.id);
    if (cut) return cut.new_batch_code;
    return plan.batch_sequence.length ? plan.batch_sequence[0].batch_code : null;
  }

  // Challenge Metal Detector: Fe/Non-Fe/SS 2.5 harus PASS sebelum start dan setelah restart (MD-001, BR-014).
  function challengeStatus(plan) {
    const lastStop = db.prepare('SELECT stopped_at FROM md_sessions WHERE plan_id = ? AND stopped_at IS NOT NULL ORDER BY id DESC LIMIT 1').get(plan.id);
    const since = lastStop ? lastStop.stopped_at : '';
    const tests = CHALLENGE_TESTS.map((t) => {
      const last = db.prepare('SELECT * FROM md_challenges WHERE plan_id = ? AND test_type = ? AND at > ? ORDER BY id DESC LIMIT 1').get(plan.id, t, since);
      return { test_type: t, result: last ? last.result : null, at: last ? last.at : null, by: last ? last.by : null };
    });
    return { tests, allPass: tests.every((t) => t.result === 'PASS') };
  }

  const openSession = (planId) => db.prepare('SELECT * FROM md_sessions WHERE plan_id = ? AND stopped_at IS NULL ORDER BY id DESC LIMIT 1').get(planId);

  const requireActivePlan = (plan) => {
    if (plan.status !== 'ACTIVE') throw conflict('Aksi ini hanya untuk plan ACTIVE');
  };

  // ---------- Metal Detector ----------
  r.get('/md/status', requireAuth, requirePerm('plan.view'), (req, res) => {
    const plan = loadPlan(Number(req.query.plan_id));
    const session = openSession(plan.id);
    const ch = challengeStatus(plan);
    res.json({
      plan_id: plan.id,
      running: !!session,
      session,
      challenges: ch.tests,
      can_start: !session && ch.allPass,
      active_batch: activeBatch(plan),
    });
  });

  r.post('/md/challenges', requireAuth, requirePerm('md.challenge'), (req, res) => {
    const b = req.body || {};
    const plan = loadPlan(requireNumber(b, 'plan_id', { integer: true, min: 1 }));
    requireActivePlan(plan);
    const test = requireEnum(b, 'test_type', CHALLENGE_TESTS);
    const result = requireEnum(b, 'result', ['PASS', 'FAIL']);
    const context = requireEnum(b, 'context', ['START', 'RESTART']);
    const at = nowIso();
    const info = db.prepare('INSERT INTO md_challenges (plan_id, test_type, result, context, at, by) VALUES (?, ?, ?, ?, ?, ?)')
      .run(plan.id, test, result, context, at, req.user.username);
    const created = db.prepare('SELECT * FROM md_challenges WHERE id = ?').get(Number(info.lastInsertRowid));
    audit(db, req.user, { action: 'CREATE', entity: 'md_challenges', recordId: created.id, newValue: created });
    res.status(201).json({ item: created, status: challengeStatus(plan) });
  });

  r.post('/md/start', requireAuth, requirePerm('md.run'), (req, res) => {
    const plan = loadPlan(requireNumber(req.body || {}, 'plan_id', { integer: true, min: 1 }));
    requireActivePlan(plan);
    if (openSession(plan.id)) throw conflict('Metal Detector sudah berjalan');
    const ch = challengeStatus(plan);
    if (!ch.allPass) {
      const failing = ch.tests.filter((t) => t.result !== 'PASS').map((t) => `${t.test_type}${t.result ? ` (${t.result})` : ' (belum ada)'}`);
      throw conflict(`Produksi tidak dapat start: challenge belum PASS untuk ${failing.join(', ')} (MD-001)`);
    }
    const info = db.prepare('INSERT INTO md_sessions (plan_id, started_at, started_by) VALUES (?, ?, ?)').run(plan.id, nowIso(), req.user.username);
    audit(db, req.user, { action: 'START', entity: 'md_sessions', recordId: Number(info.lastInsertRowid), newValue: { plan_id: plan.id } });
    res.status(201).json({ item: openSession(plan.id) });
  });

  r.post('/md/stop', requireAuth, requirePerm('md.run'), (req, res) => {
    const plan = loadPlan(requireNumber(req.body || {}, 'plan_id', { integer: true, min: 1 }));
    const session = openSession(plan.id);
    if (!session) throw conflict('Metal Detector tidak sedang berjalan');
    db.prepare('UPDATE md_sessions SET stopped_at = ?, stopped_by = ? WHERE id = ?').run(nowIso(), req.user.username, session.id);
    audit(db, req.user, { action: 'STOP', entity: 'md_sessions', recordId: session.id, oldValue: { running: true }, newValue: { running: false } });
    res.json({ ok: true, note: 'Restart memerlukan challenge Fe/Non-Fe/SS 2.5 PASS kembali.' });
  });

  // ---------- Pallet / Forming Box ----------
  // Pallet aktif sesuai kategori: Bale OK hanya ke pallet OK; Hold hanya ke pallet Hold dengan kategori yang sama
  // (mixed status dilarang, PAL-004). Pallet kosong (status_category NULL) dapat dipakai oleh kategori apa pun.
  function currentPallet(plan, category = 'OK') {
    const statuses = category === 'OK' ? ['OPEN', 'PARTIAL'] : ['OPEN', 'PARTIAL', 'HOLD/REJECT'];
    const placeholders = statuses.map(() => '?').join(',');
    return db.prepare(`SELECT * FROM pallets WHERE plan_id = ? AND status IN (${placeholders})
      AND (status_category = ? OR status_category IS NULL) ORDER BY (status_category IS NULL), id DESC LIMIT 1`)
      .get(plan.id, ...statuses, category) || null;
  }

  function createPallet(plan, user, { manualNo = null, location = null, formingBox = null } = {}) {
    const info = db.prepare(`INSERT INTO pallets (plan_id, manual_no, forming_box_code, status, location, max_bale, created_at, created_by)
      VALUES (?, ?, ?, 'OPEN', ?, ?, ?, ?)`).run(plan.id, manualNo, formingBox, location, palletMax, nowIso(), user.username);
    const p = loadPallet(Number(info.lastInsertRowid));
    audit(db, user, { action: 'CREATE', entity: 'pallets', recordId: p.id, newValue: p });
    return p;
  }

  r.get('/md/pallets', requireAuth, requirePerm('plan.view'), (req, res) => {
    const planId = Number(req.query.plan_id);
    const pallets = db.prepare('SELECT * FROM pallets WHERE plan_id = ? ORDER BY id').all(planId);
    const items = pallets.map((p) => ({
      ...p,
      compositions: db.prepare('SELECT batch_code, status_category, qty FROM pallet_compositions WHERE pallet_id = ? ORDER BY batch_code').all(p.id),
    }));
    res.json({ items, max_bale: palletMax });
  });

  r.post('/md/pallets', requireAuth, requirePerm('pallet.write'), (req, res) => {
    const b = req.body || {};
    const plan = loadPlan(requireNumber(b, 'plan_id', { integer: true, min: 1 }));
    requireActivePlan(plan);
    const p = createPallet(plan, req.user, {
      manualNo: b.manual_no ? String(b.manual_no).slice(0, 60) : null,
      location: b.location ? String(b.location).slice(0, 120) : 'Area Palletizing',
      formingBox: b.forming_box_code ? String(b.forming_box_code).slice(0, 60) : null,
    });
    res.status(201).json({ item: p, note: 'Instance ID internal dibuat; nomor manual dapat digunakan ulang tanpa menimpa histori (PAL-002).' });
  });

  r.get('/md/pallets/:id', requireAuth, requirePerm('plan.view'), (req, res) => {
    const p = loadPallet(Number(req.params.id));
    res.json({
      item: p,
      compositions: db.prepare('SELECT * FROM pallet_compositions WHERE pallet_id = ? ORDER BY batch_code').all(p.id),
      bales: db.prepare('SELECT * FROM bale_events WHERE pallet_id = ? ORDER BY id').all(p.id),
      movements: db.prepare('SELECT * FROM pallet_movements WHERE pallet_id = ? ORDER BY id').all(p.id),
    });
  });

  r.post('/md/pallets/:id/close', requireAuth, requirePerm('pallet.write'), (req, res) => {
    const p = loadPallet(Number(req.params.id));
    if (p.status === 'MOVED' || p.status === 'RELEASED' || p.status === 'SHIPPED') throw conflict(`Pallet berstatus ${p.status}`);
    const hasHold = db.prepare("SELECT COUNT(*) AS n FROM pallet_compositions WHERE pallet_id = ? AND status_category != 'OK' AND qty > 0").get(p.id).n > 0;
    let status;
    if (hasHold) status = 'HOLD/REJECT';
    else if (p.ok_count >= p.max_bale) status = 'FULL';
    else status = 'PARTIAL';
    db.prepare('UPDATE pallets SET status = ?, closed_at = ? WHERE id = ?').run(status, nowIso(), p.id);
    audit(db, req.user, { action: 'UPDATE', entity: 'pallets', recordId: p.id, oldValue: { status: p.status }, newValue: { status } });
    res.json({ item: loadPallet(p.id), note: status === 'PARTIAL' ? 'Partial pallet disimpan dan dilanjutkan shift berikut (PAL-006).' : null });
  });

  r.post('/md/pallets/:id/move', requireAuth, requirePerm('movement.write'), (req, res) => {
    const p = loadPallet(Number(req.params.id));
    const b = req.body || {};
    const to = requireString(b, 'to_loc', { max: 120 });
    if (p.status === 'SHIPPED') throw conflict('Pallet sudah SHIPPED');
    db.prepare("INSERT INTO pallet_movements (pallet_id, from_loc, to_loc, forklift_code, at, by) VALUES (?, ?, ?, ?, ?, ?)")
      .run(p.id, p.location, to, b.forklift_code || null, optionalTime(b, 'at'), req.user.username);
    db.prepare("UPDATE pallets SET location = ?, status = CASE WHEN status IN ('OPEN','PARTIAL') THEN 'MOVED' ELSE status END WHERE id = ?").run(to, p.id);
    audit(db, req.user, { action: 'UPDATE', entity: 'pallets', recordId: p.id, oldValue: { location: p.location }, newValue: { location: to } });
    res.json({ item: loadPallet(p.id) });
  });

  // ---------- Bale (count normal & exception) ----------
  r.get('/md/bales', requireAuth, requirePerm('plan.view'), (req, res) => {
    const rows = db.prepare('SELECT * FROM bale_events WHERE plan_id = ? ORDER BY id DESC LIMIT 500').all(Number(req.query.plan_id));
    res.json({ items: rows });
  });

  r.post('/md/bales', requireAuth, requirePerm('bale.write'), (req, res) => {
    const b = req.body || {};
    const plan = loadPlan(requireNumber(b, 'plan_id', { integer: true, min: 1 }));
    requireActivePlan(plan);
    if (!openSession(plan.id)) throw conflict('Metal Detector tidak berjalan. Start dengan challenge PASS terlebih dahulu.');
    const qty = b.qty == null || b.qty === '' ? 1 : requireNumber(b, 'qty', { integer: true, min: 1, max: palletMax });
    const batch = activeBatch(plan);
    if (b.batch_code && String(b.batch_code) !== batch) {
      throw conflict(`Batch aktif adalah ${batch}. Pergantian Batch harus melalui Batch Cutoff yang diverifikasi Mandor.`);
    }
    let pallet = b.pallet_id ? loadPallet(Number(b.pallet_id)) : currentPallet(plan, 'OK');
    if (!pallet) pallet = createPallet(plan, req.user, { location: 'Area Palletizing' });
    if (!['OPEN', 'PARTIAL'].includes(pallet.status)) throw conflict(`Pallet ${pallet.id} berstatus ${pallet.status}; buat pallet baru`);
    if (pallet.ok_count + qty > pallet.max_bale) {
      throw conflict(`Pallet penuh/melebihi kapasitas ${pallet.max_bale} Bale (sisa ${pallet.max_bale - pallet.ok_count}). Bale berikutnya diblokir sebelum pallet ditutup (PAL-001).`);
    }
    if (pallet.status_category && pallet.status_category !== 'OK') {
      throw conflict(`Pallet ${pallet.id} berstatus ${pallet.status_category}; mixed status tidak diizinkan (PAL-004)`);
    }
    const at = nowIso();
    db.prepare(`INSERT INTO bale_events (plan_id, pallet_id, batch_code, category, gross_qty, reject_qty, location, at, by) VALUES (?, ?, ?, 'OK', ?, 0, ?, ?, ?)`)
      .run(plan.id, pallet.id, batch, qty, pallet.location, at, req.user.username);
    db.prepare(`INSERT INTO pallet_compositions (pallet_id, batch_code, qty, status_category) VALUES (?, ?, ?, 'OK')
      ON CONFLICT(pallet_id, batch_code, status_category) DO UPDATE SET qty = qty + excluded.qty`).run(pallet.id, batch, qty);
    const newCount = pallet.ok_count + qty;
    const newStatus = newCount >= pallet.max_bale ? 'FULL' : (pallet.status === 'PARTIAL' ? 'PARTIAL' : 'OPEN');
    db.prepare('UPDATE pallets SET ok_count = ?, status = ?, status_category = ? WHERE id = ?').run(newCount, newStatus, 'OK', pallet.id);
    audit(db, req.user, { action: 'CREATE', entity: 'bale_events', recordId: pallet.id, newValue: { batch, qty, category: 'OK' } });
    res.status(201).json({ pallet: loadPallet(pallet.id), batch, qty, note: 'Count normal tanpa detail per Bale (MD-002).' });
  });

  r.post('/md/exceptions', requireAuth, requirePerm('exception.write'), (req, res) => {
    const b = req.body || {};
    const plan = loadPlan(requireNumber(b, 'plan_id', { integer: true, min: 1 }));
    requireActivePlan(plan);
    const category = requireEnum(b, 'category', ['REJECT_METAL', 'REJECT_OTHER', 'HOLD_CONTAMINATION', 'HOLD_WS', 'HOLD_OTHER']);
    // MD-004: Code Press/chamber wajib untuk exception Reject/Hold (bukan Bale OK).
    const chamber = requireEnum(b, 'chamber_code', D.CHAMBER_CODES);
    let metal = null;
    if (category === 'REJECT_METAL') metal = requireEnum(b, 'metal_type', ['FE', 'NONFE', 'SS']);
    const batch = activeBatch(plan);
    const at = nowIso();
    const isReject = category.startsWith('REJECT');
    const location = isReject ? 'Area Reject (segregasi)' : (b.location ? String(b.location).slice(0, 120) : 'Area Hold');

    let pallet = null;
    if (!isReject) {
      // Hold tetap mengisi slot pallet (PAL-005) dengan composition status Hold.
      pallet = b.pallet_id ? loadPallet(Number(b.pallet_id)) : currentPallet(plan, category);
      if (!pallet) pallet = createPallet(plan, req.user, { location: 'Area Hold' });
      if (!['OPEN', 'PARTIAL', 'HOLD/REJECT'].includes(pallet.status)) throw conflict(`Pallet ${pallet.id} berstatus ${pallet.status}`);
      if (pallet.status === 'HOLD/REJECT' && pallet.status_category !== category && pallet.status_category !== null) {
        throw conflict(`Pallet ${pallet.id} berisi Hold ${pallet.status_category}; buat pallet terpisah untuk ${category}`);
      }
      if (pallet.ok_count + 1 > pallet.max_bale) throw conflict(`Pallet ${pallet.id} sudah penuh (${pallet.max_bale} Bale)`);
      if (pallet.status_category && pallet.status_category !== category) {
        throw conflict(`Pallet ${pallet.id} berstatus ${pallet.status_category}; mixed status ${category} diblokir (PAL-004)`);
      }
    }

    const info = db.prepare(`INSERT INTO bale_events (plan_id, pallet_id, batch_code, category, gross_qty, reject_qty, chamber_code, metal_type, location, remark, at, by)
      VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?)`).run(plan.id, pallet ? pallet.id : null, batch, category, isReject ? 1 : 0,
      chamber, metal, location, b.remark || null, at, req.user.username);
    const eventId = Number(info.lastInsertRowid);
    if (pallet) {
      db.prepare(`INSERT INTO pallet_compositions (pallet_id, batch_code, qty, status_category) VALUES (?, ?, 1, ?)
        ON CONFLICT(pallet_id, batch_code, status_category) DO UPDATE SET qty = qty + 1`).run(pallet.id, batch, category);
      db.prepare("UPDATE pallets SET ok_count = ok_count + 1, status_category = ?, status = 'HOLD/REJECT' WHERE id = ?").run(category, pallet.id);
    }
    db.prepare('INSERT INTO quality_exceptions (bale_event_id) VALUES (?)').run(eventId);
    const created = db.prepare('SELECT * FROM bale_events WHERE id = ?').get(eventId);
    audit(db, req.user, { action: 'CREATE', entity: 'bale_events', recordId: eventId, newValue: created });
    // OI-04: threshold alert pola berurutan per chamber bersifat configurable (setting chamber_repeat_alert).
    // Hasilnya indikasi untuk diverifikasi, bukan kesimpulan (BR-011).
    const threshold = Number(db.prepare("SELECT value FROM settings WHERE key = 'chamber_repeat_alert'").get().value) || 0;
    let alert = null;
    if (threshold > 0) {
      const recent = db.prepare("SELECT chamber_code FROM bale_events WHERE plan_id = ? AND category != 'OK' ORDER BY id DESC LIMIT 50").all(plan.id);
      let run = 0;
      for (const row of recent) {
        if (row.chamber_code === chamber) run += 1; else break;
      }
      if (run >= threshold) alert = `Indikasi: ${run} Reject/Hold berurutan dari chamber ${chamber}. Perlu verifikasi, belum merupakan kesimpulan kerusakan.`;
    }
    res.status(201).json({ item: created, alert, note: 'Reject langsung dipisahkan; tidak ada fungsi recheck (MD-006).' });
  });

  // ---------- Batch Cutoff ----------
  r.get('/md/cutoffs', requireAuth, requirePerm('plan.view'), (req, res) => {
    res.json({ items: db.prepare('SELECT * FROM batch_cutoffs WHERE plan_id = ? ORDER BY id DESC').all(Number(req.query.plan_id)) });
  });

  r.post('/md/cutoffs', requireAuth, requirePerm('cutoff.request'), (req, res) => {
    const b = req.body || {};
    const plan = loadPlan(requireNumber(b, 'plan_id', { integer: true, min: 1 }));
    requireActivePlan(plan);
    const newBatch = requireString(b, 'new_batch_code', { max: 40 });
    const oldBatch = activeBatch(plan);
    if (newBatch === oldBatch) throw unprocessable('Batch baru sama dengan Batch aktif');
    if (!db.prepare('SELECT id FROM batches WHERE code = ?').get(newBatch)) throw badRequest(`Batch tidak ditemukan: ${newBatch}`);
    const boundary = requireNumber(b, 'boundary_count', { integer: true, min: 0 });
    const offPlan = !plan.batch_sequence.some((x) => x.batch_code === newBatch);
    const info = db.prepare(`INSERT INTO batch_cutoffs (plan_id, pallet_id, old_batch_code, new_batch_code, boundary_count, off_plan, status, requested_by, requested_at)
      VALUES (?, ?, ?, ?, ?, ?, 'REQUESTED', ?, ?)`).run(plan.id, b.pallet_id ? Number(b.pallet_id) : null, oldBatch, newBatch, boundary, offPlan ? 1 : 0, req.user.username, nowIso());
    const created = db.prepare('SELECT * FROM batch_cutoffs WHERE id = ?').get(Number(info.lastInsertRowid));
    audit(db, req.user, { action: 'CREATE', entity: 'batch_cutoffs', recordId: created.id, newValue: created });
    res.status(201).json({ item: created, note: offPlan ? 'Batch di luar plan: perlu approval SPV sebelum verifikasi Mandor (CUT-003).' : null });
  });

  r.post('/md/cutoffs/:id/approve', requireAuth, requirePerm('cutoff.approve'), (req, res) => {
    const c = db.prepare('SELECT * FROM batch_cutoffs WHERE id = ?').get(Number(req.params.id));
    if (!c) throw notFound('Batch Cutoff');
    if (c.status !== 'REQUESTED') throw conflict(`Cutoff berstatus ${c.status}`);
    if (!c.off_plan) throw conflict('Cutoff ini sesuai plan; approval SPV tidak diperlukan');
    db.prepare("UPDATE batch_cutoffs SET status = 'SPV_APPROVED', spv_approved_by = ? WHERE id = ?").run(req.user.username, c.id);
    audit(db, req.user, { action: 'APPROVE', entity: 'batch_cutoffs', recordId: c.id, oldValue: { status: 'REQUESTED' }, newValue: { status: 'SPV_APPROVED' } });
    res.json({ item: db.prepare('SELECT * FROM batch_cutoffs WHERE id = ?').get(c.id) });
  });

  r.post('/md/cutoffs/:id/verify', requireAuth, requirePerm('cutoff.verify'), (req, res) => {
    const c = db.prepare('SELECT * FROM batch_cutoffs WHERE id = ?').get(Number(req.params.id));
    if (!c) throw notFound('Batch Cutoff');
    if (c.status === 'VERIFIED') throw conflict('Cutoff sudah diverifikasi (final, tidak dapat diedit tanpa correction/audit trail, CUT-005)');
    if (c.off_plan && c.status !== 'SPV_APPROVED') throw conflict('Batch di luar plan: menunggu approval SPV');
    if (c.requested_by === req.user.username) throw conflict('Verifikasi harus dilakukan oleh user lain (maker-checker)');
    db.prepare("UPDATE batch_cutoffs SET status = 'VERIFIED', verified_by = ?, verified_at = ? WHERE id = ?").run(req.user.username, nowIso(), c.id);
    audit(db, req.user, { action: 'VERIFY', entity: 'batch_cutoffs', recordId: c.id, oldValue: { status: c.status }, newValue: { status: 'VERIFIED', new_batch: c.new_batch_code } });
    res.json({ item: db.prepare('SELECT * FROM batch_cutoffs WHERE id = ?').get(c.id) });
  });

  // ---------- Quality interface (QC only) ----------
  r.get('/quality/exceptions', requireAuth, requirePerm('dashboard.view'), (req, res) => {
    const where = req.query.plan_id ? 'AND be.plan_id = ?' : '';
    const vals = req.query.plan_id ? [Number(req.query.plan_id)] : [];
    const rows = db.prepare(`SELECT qe.*, be.category, be.batch_code, be.chamber_code, be.metal_type, be.pallet_id, be.location, be.at, be.by, be.plan_id
      FROM quality_exceptions qe JOIN bale_events be ON be.id = qe.bale_event_id WHERE 1=1 ${where} ORDER BY qe.id DESC LIMIT 300`).all(...vals);
    res.json({ items: rows });
  });

  r.post('/quality/exceptions/:id/release', requireAuth, requirePerm('quality.release'), (req, res) => {
    const qe = db.prepare('SELECT * FROM quality_exceptions WHERE id = ?').get(Number(req.params.id));
    if (!qe) throw notFound('Exception');
    if (qe.qc_decision) throw conflict(`Exception sudah diputuskan QC: ${qe.qc_decision}`);
    const b = req.body || {};
    const decision = requireEnum(b, 'decision', ['RELEASE_GOOD', 'REJECT_FINAL', 'KEEP_HOLD']);
    const reason = requireString(b, 'reason', { max: 500 });
    db.prepare('UPDATE quality_exceptions SET qc_decision = ?, qc_reason = ?, qc_by = ?, qc_at = ? WHERE id = ?')
      .run(decision, reason, req.user.username, nowIso(), qe.id);
    audit(db, req.user, { action: 'RELEASE', entity: 'quality_exceptions', recordId: qe.id, oldValue: { qc_decision: null }, newValue: { qc_decision: decision }, reason });
    res.json({ item: db.prepare('SELECT * FROM quality_exceptions WHERE id = ?').get(qe.id) });
  });

  r.exposed.activeBatch = activeBatch;
  r.exposed.challengeStatus = challengeStatus;
  r.exposed.currentPallet = currentPallet;
  return r;
}

module.exports = { buildRouter, CHALLENGE_TESTS };
