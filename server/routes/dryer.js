'use strict';

const express = require('express');
const { nowIso } = require('../db');
const { badRequest, notFound, conflict, unprocessable, audit, requireString, requireNumber, requireEnum, optionalTime, isIsoDateTime } = require('../http');
const D = require('../domain');

function buildRouter(db, { requireAuth, requirePerm, setTrolleyStatus, loadPlan }) {
  const r = express.Router();
  r.exposed = {};
  const compartments = Number(db.prepare("SELECT value FROM settings WHERE key = 'dryer_compartments'").get().value) || D.DRYER_COMPARTMENTS;

  const loadRun = (id) => {
    const run = db.prepare('SELECT * FROM dryer_runs WHERE id = ?').get(id);
    if (!run) throw notFound('Dryer Run');
    return run;
  };
  const requireRunningOrStopped = (run) => {
    if (run.status === 'CLOSED') throw conflict('Dryer Run sudah CLOSED');
  };

  // Posisi kompartemen dihitung dari event board (sumber kebenaran event).
  // TROLLEY_IN / CARRY_IN = trolley masuk papan; TROLLEY_OUT / CARRY_OUT = trolley keluar papan.
  // CARRY_* hanya memindahkan trolley WIP antar-run; tidak dihitung sebagai keluar Dryer (BR-022).
  const BOARD_IN = ['TROLLEY_IN', 'CARRY_IN'];
  const BOARD_OUT = ['TROLLEY_OUT', 'CARRY_OUT'];
  function boardState(run) {
    const slots = Array.from({ length: compartments }, (_, i) => ({ compartment: i + 1, trolley_code: null, since: null }));
    const events = db.prepare("SELECT * FROM dryer_events WHERE run_id = ? AND kind IN ('TROLLEY_IN','TROLLEY_OUT','CARRY_IN','CARRY_OUT') ORDER BY id").all(run.id);
    for (const e of events) {
      const slot = slots[e.compartment - 1];
      if (!slot) continue;
      if (BOARD_IN.includes(e.kind)) { slot.trolley_code = e.trolley_code; slot.since = e.at; }
      else if (BOARD_OUT.includes(e.kind)) { slot.trolley_code = null; slot.since = null; }
    }
    return slots;
  }

  // Nomor urut trolley (B-11), dibedakan menurut jenis run:
  // - STARTUP_EMPTY (mulai kosong, tanpa WIP): urutan MASUK (TROLLEY_IN pertama per trolley).
  // - STEADY_WIP (mulai dengan WIP di dalam): urutan KELUAR (TROLLEY_OUT pertama per trolley).
  // Trolley WIP hasil carry-in tidak mendapat urutan masuk pada run tersebut.
  function trolleySequence(run) {
    const kind = run.run_type === 'STEADY_WIP' ? 'TROLLEY_OUT' : 'TROLLEY_IN';
    const rows = db.prepare('SELECT trolley_code FROM dryer_events WHERE run_id = ? AND kind = ? ORDER BY id').all(run.id, kind);
    const seq = new Map();
    for (const r of rows) if (!seq.has(r.trolley_code)) seq.set(r.trolley_code, seq.size + 1);
    return seq;
  }

  // Timer ON = akumulasi interval RUNNING (START/RESTART sampai STOP). Interval terbuka dihitung sampai sekarang.
  function timerOnMinutes(run) {
    const evs = db.prepare("SELECT * FROM dryer_events WHERE run_id = ? AND kind IN ('START','STOP','RESTART') ORDER BY id").all(run.id);
    let total = 0;
    let runningSince = null;
    for (const e of evs) {
      if (e.kind === 'START' || e.kind === 'RESTART') runningSince = new Date(e.at).getTime();
      else if (e.kind === 'STOP' && runningSince) { total += (new Date(e.at).getTime() - runningSince); runningSince = null; }
    }
    if (runningSince && run.status === 'RUNNING') total += Date.now() - runningSince;
    return Math.round((total / 60000) * 100) / 100;
  }

  const logRunEvent = (run, user, kind, fields = {}) => {
    db.prepare(`INSERT INTO dryer_events (run_id, kind, compartment, trolley_code, b1_temp, b2_temp, ref_temp, timer_min, remark, at, by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(run.id, kind, fields.compartment || null, fields.trolley_code || null,
      fields.b1_temp ?? null, fields.b2_temp ?? null, fields.ref_temp ?? null, fields.timer_min ?? null, fields.remark || null,
      fields.at || nowIso(), user.username);
  };

  // ---------- Dryer Run ----------
  r.get('/dryer/runs', requireAuth, requirePerm('dryer.view'), (req, res) => {
    const rows = req.query.plan_id
      ? db.prepare('SELECT * FROM dryer_runs WHERE plan_id = ? ORDER BY id DESC').all(Number(req.query.plan_id))
      : db.prepare('SELECT * FROM dryer_runs ORDER BY id DESC LIMIT 100').all();
    res.json({ items: rows.map((run) => ({ ...run, timer_on_min: timerOnMinutes(run) })) });
  });

  r.post('/dryer/runs', requireAuth, requirePerm('dryer.write'), (req, res) => {
    const b = req.body || {};
    const plan = loadPlan(requireNumber(b, 'plan_id', { integer: true, min: 1 }));
    if (plan.status !== 'ACTIVE') throw conflict('Dryer Run hanya dapat dibuka untuk plan ACTIVE');
    const dryer = requireEnum(b, 'dryer_code', D.DRYER_CODES);
    // DRY-001: Dryer yang tidak dipilih pada plan tidak dapat digunakan tanpa plan revision.
    if (!plan.dryers.includes(dryer)) throw unprocessable(`${dryer} tidak dipilih pada plan. Aktivasi di luar plan memerlukan Production Plan revision oleh SPV (DRY-001).`);
    const open = db.prepare("SELECT id FROM dryer_runs WHERE dryer_code = ? AND status IN ('RUNNING','STOPPED')").get(dryer);
    if (open) throw conflict(`${dryer} masih memiliki Dryer Run yang belum CLOSED (#${open.id})`);
    const runType = requireEnum(b, 'run_type', ['STARTUP_EMPTY', 'STEADY_WIP']);
    const vs = db.prepare('SELECT id FROM validated_settings WHERE product = ? AND dryer_code = ? AND active = 1 ORDER BY id DESC LIMIT 1').get(plan.product, dryer);
    if (!vs) throw unprocessable(`Validated setting untuk ${dryer} (${plan.product}) belum tersedia`);
    const startedAt = nowIso();
    const info = db.prepare('INSERT INTO dryer_runs (plan_id, dryer_code, run_type, validated_setting_id, status, started_at, started_by) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(plan.id, dryer, runType, vs.id, 'RUNNING', startedAt, req.user.username);
    const run = loadRun(Number(info.lastInsertRowid));
    logRunEvent(run, req.user, 'START', { at: startedAt, remark: `Run ${runType}` });
    db.prepare('INSERT INTO equipment_status_events (equipment_code, status, at, by) VALUES (?, ?, ?, ?)').run(dryer, 'RUNNING', startedAt, req.user.username);
    audit(db, req.user, { action: 'CREATE', entity: 'dryer_runs', recordId: run.id, newValue: run });
    res.status(201).json({ item: run });
  });

  r.get('/dryer/runs/:id', requireAuth, requirePerm('dryer.view'), (req, res) => {
    const run = loadRun(Number(req.params.id));
    const plan = loadPlan(run.plan_id);
    res.json({
      item: { ...run, timer_on_min: timerOnMinutes(run) },
      plan: { id: plan.id, plan_no: plan.plan_no, version: plan.version, status: plan.status, product: plan.product, dryers: plan.dryers },
      compartments: boardState(run),
      events: db.prepare('SELECT * FROM dryer_events WHERE run_id = ? ORDER BY id').all(run.id),
      samples: db.prepare('SELECT * FROM cake_samples WHERE run_id = ? ORDER BY id').all(run.id),
      adjustments: db.prepare('SELECT * FROM process_adjustments WHERE run_id = ? OR (run_id IS NULL AND plan_id = ?) ORDER BY id DESC').all(run.id, run.plan_id),
    });
  });

  r.post('/dryer/runs/:id/trolley-in', requireAuth, requirePerm('dryer.write'), (req, res) => {
    const run = loadRun(Number(req.params.id));
    requireRunningOrStopped(run);
    if (run.status !== 'RUNNING') throw conflict('Dryer sedang STOPPED; trolley IN tidak dapat dicatat');
    const b = req.body || {};
    const comp = requireNumber(b, 'compartment', { integer: true, min: 1, max: compartments });
    const code = requireString(b, 'trolley_code', { max: 40 });
    const slot = boardState(run)[comp - 1];
    if (slot.trolley_code) throw conflict(`Kompartemen ${comp} masih terisi trolley ${slot.trolley_code}`);
    const at = optionalTime(b, 'at');
    const trolley = db.prepare('SELECT * FROM trolleys WHERE code = ?').get(code);
    if (!trolley) throw badRequest(`Trolley tidak ditemukan: ${code}`);
    if (!['FILLED/READY', 'DRYER OUT/CAKE WIP'].includes(trolley.status)) {
      throw conflict(`Trolley ${code} berstatus ${trolley.status}; hanya FILLED/READY yang dapat masuk Dryer`);
    }
    setTrolleyStatus(req.user, code, 'IN DRYER', { allowDryer: true, remark: `Masuk ${run.dryer_code} kompartemen ${comp}` });
    logRunEvent(run, req.user, 'TROLLEY_IN', { compartment: comp, trolley_code: code, at });
    audit(db, req.user, { action: 'CREATE', entity: 'dryer_events', recordId: run.id, newValue: { kind: 'TROLLEY_IN', compartment: comp, trolley: code } });
    res.status(201).json({ board: boardState(run) });
  });

  r.post('/dryer/runs/:id/trolley-out', requireAuth, requirePerm('dryer.write'), (req, res) => {
    const run = loadRun(Number(req.params.id));
    requireRunningOrStopped(run);
    const b = req.body || {};
    const comp = requireNumber(b, 'compartment', { integer: true, min: 1, max: compartments });
    const slot = boardState(run)[comp - 1];
    if (!slot.trolley_code) throw conflict(`Kompartemen ${comp} kosong`);
    const at = optionalTime(b, 'at');
    setTrolleyStatus(req.user, slot.trolley_code, 'DRYER OUT/CAKE WIP', { allowDryer: true, remark: `Keluar ${run.dryer_code} kompartemen ${comp}` });
    logRunEvent(run, req.user, 'TROLLEY_OUT', { compartment: comp, trolley_code: slot.trolley_code, at });
    audit(db, req.user, { action: 'CREATE', entity: 'dryer_events', recordId: run.id, newValue: { kind: 'TROLLEY_OUT', compartment: comp, trolley: slot.trolley_code } });
    res.status(201).json({ board: boardState(run) });
  });

  r.post('/dryer/runs/:id/readings', requireAuth, requirePerm('dryer.write'), (req, res) => {
    const run = loadRun(Number(req.params.id));
    requireRunningOrStopped(run);
    const b = req.body || {};
    const fields = {
      b1_temp: b.b1_temp == null || b.b1_temp === '' ? null : requireNumber(b, 'b1_temp', { min: 0, max: 400 }),
      b2_temp: b.b2_temp == null || b.b2_temp === '' ? null : requireNumber(b, 'b2_temp', { min: 0, max: 400 }),
      ref_temp: b.ref_temp == null || b.ref_temp === '' ? null : requireNumber(b, 'ref_temp', { min: 0, max: 400 }),
      timer_min: b.timer_min == null || b.timer_min === '' ? null : requireNumber(b, 'timer_min', { min: 0, max: 100000 }),
      remark: b.remark || null,
    };
    if (fields.b1_temp == null && fields.b2_temp == null && fields.ref_temp == null && fields.timer_min == null) {
      throw badRequest('Isi minimal satu pembacaan (B1, B2, reference temperature, atau Timer)');
    }
    logRunEvent(run, req.user, 'READING', fields);
    res.status(201).json({ ok: true, recorded_at: nowIso() });
  });

  r.post('/dryer/runs/:id/stop', requireAuth, requirePerm('dryer.stop'), (req, res) => {
    const run = loadRun(Number(req.params.id));
    if (run.status !== 'RUNNING') throw conflict('Dryer tidak sedang RUNNING');
    const remark = req.body && req.body.remark ? String(req.body.remark) : null;
    logRunEvent(run, req.user, 'STOP', { remark });
    db.prepare("UPDATE dryer_runs SET status = 'STOPPED' WHERE id = ?").run(run.id);
    db.prepare('INSERT INTO equipment_status_events (equipment_code, status, at, by) VALUES (?, ?, ?, ?)').run(run.dryer_code, 'STOPPED', nowIso(), req.user.username);
    audit(db, req.user, { action: 'UPDATE', entity: 'dryer_runs', recordId: run.id, oldValue: { status: 'RUNNING' }, newValue: { status: 'STOPPED' }, reason: remark });
    res.json({ item: loadRun(run.id) });
  });

  r.post('/dryer/runs/:id/restart', requireAuth, requirePerm('dryer.stop'), (req, res) => {
    const run = loadRun(Number(req.params.id));
    if (run.status !== 'STOPPED') throw conflict('Dryer tidak sedang STOPPED');
    logRunEvent(run, req.user, 'RESTART', { remark: req.body && req.body.remark ? String(req.body.remark) : null });
    db.prepare("UPDATE dryer_runs SET status = 'RUNNING' WHERE id = ?").run(run.id);
    db.prepare('INSERT INTO equipment_status_events (equipment_code, status, at, by) VALUES (?, ?, ?, ?)').run(run.dryer_code, 'RUNNING', nowIso(), req.user.username);
    audit(db, req.user, { action: 'UPDATE', entity: 'dryer_runs', recordId: run.id, oldValue: { status: 'STOPPED' }, newValue: { status: 'RUNNING' } });
    res.json({ item: loadRun(run.id) });
  });

  r.post('/dryer/runs/:id/carry-over', requireAuth, requirePerm('dryer.write'), (req, res) => {
    const run = loadRun(Number(req.params.id));
    requireRunningOrStopped(run);
    const b = req.body || {};
    const code = requireString(b, 'trolley_code', { max: 40 });
    const onBoard = boardState(run).some((s) => s.trolley_code === code);
    if (!onBoard) throw conflict(`Trolley ${code} tidak berada di Dryer ${run.dryer_code}`);
    // Trolley tetap IN DRYER; hanya dilepas dari papan run ini agar run dapat ditutup. Bukan keluar Dryer.
    const slot = boardState(run).find((x) => x.trolley_code === code);
    logRunEvent(run, req.user, 'CARRY_OUT', { trolley_code: code, compartment: slot.compartment, remark: b.remark || 'Carry-over ke run/shift berikut (tidak dihitung ulang sebagai output, BR-022)' });
    audit(db, req.user, { action: 'CREATE', entity: 'dryer_events', recordId: run.id, newValue: { kind: 'CARRY_OUT', trolley: code } });
    res.status(201).json({ ok: true, board: boardState(run) });
  });

  // Trolley WIP dari run sebelumnya dimasukkan kembali ke papan run ini (CARRY_IN).
  r.post('/dryer/runs/:id/carry-in', requireAuth, requirePerm('dryer.write'), (req, res) => {
    const run = loadRun(Number(req.params.id));
    if (run.status !== 'RUNNING') throw conflict('Dryer harus RUNNING untuk memasukkan carry-over ke papan');
    const b = req.body || {};
    const comp = requireNumber(b, 'compartment', { integer: true, min: 1, max: compartments });
    const code = requireString(b, 'trolley_code', { max: 40 });
    if (boardState(run)[comp - 1].trolley_code) throw conflict(`Kompartemen ${comp} masih terisi`);
    const trolley = db.prepare('SELECT * FROM trolleys WHERE code = ?').get(code);
    if (!trolley) throw badRequest(`Trolley tidak ditemukan: ${code}`);
    if (trolley.status !== 'IN DRYER') throw conflict(`Trolley ${code} berstatus ${trolley.status}; carry-in hanya untuk trolley IN DRYER`);
    // Trolley tidak boleh masih berada di papan run lain yang terbuka.
    const otherOpen = db.prepare("SELECT * FROM dryer_runs WHERE dryer_code = ? AND id != ? AND status IN ('RUNNING','STOPPED')").all(run.dryer_code, run.id);
    for (const o of otherOpen) {
      if (boardState(o).some((x) => x.trolley_code === code)) throw conflict(`Trolley ${code} masih di papan Dryer Run #${o.id}. Lakukan carry-over dari run tersebut terlebih dahulu.`);
    }
    const at = optionalTime(b, 'at');
    logRunEvent(run, req.user, 'CARRY_IN', { compartment: comp, trolley_code: code, at, remark: 'Carry-over masuk dari run sebelumnya' });
    audit(db, req.user, { action: 'CREATE', entity: 'dryer_events', recordId: run.id, newValue: { kind: 'CARRY_IN', compartment: comp, trolley: code } });
    res.status(201).json({ board: boardState(run) });
  });

  r.post('/dryer/runs/:id/close', requireAuth, requirePerm('dryer.write'), (req, res) => {
    const run = loadRun(Number(req.params.id));
    if (run.status === 'CLOSED') throw conflict('Dryer Run sudah CLOSED');
    const onBoard = boardState(run).filter((s) => s.trolley_code);
    if (onBoard.length) {
      throw conflict(`Masih ada ${onBoard.length} trolley di dalam Dryer. Gunakan trolley OUT atau catat carry-over sebelum menutup run.`);
    }
    const timer = timerOnMinutes(run);
    if (run.status === 'RUNNING') logRunEvent(run, req.user, 'STOP', { remark: 'Penutupan Dryer Run' });
    db.prepare("UPDATE dryer_runs SET status = 'CLOSED', closed_at = ?, timer_on_min = ? WHERE id = ?").run(nowIso(), timer, run.id);
    db.prepare('INSERT INTO equipment_status_events (equipment_code, status, at, by) VALUES (?, ?, ?, ?)').run(run.dryer_code, 'PLANNED ACTIVE', nowIso(), req.user.username);
    audit(db, req.user, { action: 'CLOSE', entity: 'dryer_runs', recordId: run.id, oldValue: { status: run.status }, newValue: { status: 'CLOSED', timer_on_min: timer } });
    res.json({ item: loadRun(run.id) });
  });

  // ---------- Sampling Cake (rule per plan, tidak di-hardcode 30 menit) ----------
  r.post('/dryer/runs/:id/samples', requireAuth, requirePerm('sampling.write'), (req, res) => {
    const run = loadRun(Number(req.params.id));
    requireRunningOrStopped(run);
    const b = req.body || {};
    const code = requireString(b, 'trolley_code', { max: 40 });
    const adHoc = !!b.ad_hoc;
    const reason = b.reason ? String(b.reason).slice(0, 300) : null;
    if (adHoc && !reason) throw badRequest('Sampling AD HOC wajib menyertakan alasan (adjustment/abnormality)');
    const entered = db.prepare("SELECT id FROM dryer_events WHERE run_id = ? AND kind IN ('TROLLEY_IN','CARRY_IN') AND trolley_code = ? LIMIT 1").get(run.id, code);
    if (!entered) throw conflict(`Trolley ${code} belum pernah masuk Dryer Run ini`);
    const trolleySeq = trolleySequence(run).get(code) ?? null;
    if (b.planned_at && !isIsoDateTime(b.planned_at)) throw badRequest('planned_at harus berupa tanggal/waktu ISO 8601');
    const planned = b.planned_at ? new Date(b.planned_at).toISOString() : null;
    const actual = optionalTime(b, 'actual_at');
    const info = db.prepare(`INSERT INTO cake_samples (run_id, plan_id, trolley_code, trolley_seq, planned_at, actual_at, ad_hoc, reason, p0, mv, pri, remark, by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(run.id, run.plan_id, code, trolleySeq, planned, actual, adHoc ? 1 : 0, reason,
      b.p0 == null || b.p0 === '' ? null : Number(b.p0), b.mv == null || b.mv === '' ? null : Number(b.mv),
      b.pri == null || b.pri === '' ? null : Number(b.pri), b.remark || null, req.user.username);
    logRunEvent(run, req.user, 'SAMPLE', { trolley_code: code, at: actual, remark: adHoc ? `AD HOC: ${reason}` : (b.remark || null) });
    const created = db.prepare('SELECT * FROM cake_samples WHERE id = ?').get(Number(info.lastInsertRowid));
    audit(db, req.user, { action: 'CREATE', entity: 'cake_samples', recordId: created.id, newValue: created });
    res.status(201).json({ item: created });
  });

  r.get('/dryer/runs/:id/sampling-compliance', requireAuth, requirePerm('dryer.view'), (req, res) => {
    const run = loadRun(Number(req.params.id));
    const plan = loadPlan(run.plan_id);
    const now = Date.now();
    const samples = db.prepare('SELECT * FROM cake_samples WHERE run_id = ?').all(run.id);
    const planned = samples.filter((s) => !s.ad_hoc);
    const adHoc = samples.filter((s) => s.ad_hoc).length;
    const entered = db.prepare("SELECT DISTINCT trolley_code FROM dryer_events WHERE run_id = ? AND kind IN ('TROLLEY_IN','CARRY_IN')").all(run.id).map((x) => x.trolley_code);
    const seqMap = trolleySequence(run);
    const sequenced = seqMap.size;
    const results = (plan.sampling_rules || []).map((rule) => {
      if (rule.type === 'TIME_INTERVAL') {
        const intervalMs = rule.interval_min * 60000;
        const elapsed = now - new Date(run.started_at).getTime();
        const due = Math.max(0, Math.floor(elapsed / intervalMs));
        const done = planned.length;
        return { type: rule.type, detail: `setiap ${rule.interval_min} menit`, due, done, status: done >= due ? 'ON_TRACK' : 'OVERDUE' };
      }
      if (rule.type === 'TROLLEY_INTERVAL') {
        // Trolley ke-N mengikuti basis nomor urut run (STARTUP_EMPTY = masuk, STEADY_WIP = keluar).
        const due = Math.floor(sequenced / rule.n);
        const doneSeq = new Set(planned.map((s) => seqMap.get(s.trolley_code)).filter((q) => q && q % rule.n === 0));
        return { type: rule.type, detail: `setiap ${rule.n} trolley (urutan ${run.run_type === 'STEADY_WIP' ? 'keluar' : 'masuk'})`, due, done: doneSeq.size, status: doneSeq.size >= due ? 'ON_TRACK' : 'OVERDUE' };
      }
      if (rule.type === 'SPECIFIC_TROLLEY') {
        const done = new Set(planned.map((s) => s.trolley_code));
        const missing = rule.trolleys.filter((t) => entered.includes(t) && !done.has(t));
        return { type: rule.type, detail: `trolley ${rule.trolleys.join(', ')}`, due: rule.trolleys.filter((t) => entered.includes(t)).length, done: rule.trolleys.filter((t) => done.has(t)).length, status: missing.length ? 'OVERDUE' : 'ON_TRACK', missing };
      }
      // RANDOM
      return { type: rule.type, detail: `target ${rule.target} sampel`, due: rule.target, done: planned.length, status: planned.length >= rule.target ? 'ON_TRACK' : 'PENDING' };
    });
    res.json({
      run_id: run.id,
      run_type: run.run_type,
      sequence_basis: run.run_type === 'STEADY_WIP' ? 'KELUAR' : 'MASUK',
      rules: results,
      ad_hoc_count: adHoc,
      trolleys_in: entered.length,
      trolleys_sequenced: sequenced,
      note: 'Compliance dihitung berdasarkan rule pada Production Plan aktif. Nomor urut trolley: STARTUP_EMPTY = urutan masuk; STEADY_WIP = urutan keluar. Sampling AD HOC dicatat terpisah dengan alasan.',
    });
  });

  // ---------- Process Adjustment (SPV memutuskan, Operator Dryer melaksanakan) ----------
  r.get('/adjustments', requireAuth, requirePerm('dryer.view'), (req, res) => {
    const rows = req.query.plan_id
      ? db.prepare('SELECT * FROM process_adjustments WHERE plan_id = ? ORDER BY id DESC').all(Number(req.query.plan_id))
      : db.prepare('SELECT * FROM process_adjustments ORDER BY id DESC LIMIT 100').all();
    res.json({ items: rows });
  });

  r.post('/plans/:id/adjustments', requireAuth, requirePerm('adjustment.request'), (req, res) => {
    const plan = loadPlan(Number(req.params.id));
    if (plan.status !== 'ACTIVE') throw conflict('Process Adjustment hanya untuk plan ACTIVE');
    const b = req.body || {};
    const runId = b.run_id ? Number(b.run_id) : null;
    if (runId) loadRun(runId);
    const info = db.prepare(`INSERT INTO process_adjustments (plan_id, run_id, instruction, trigger_reason, before_setting, after_setting, status, requested_by, requested_at)
      VALUES (?, ?, ?, ?, ?, ?, 'REQUESTED', ?, ?)`).run(plan.id, runId, requireString(b, 'instruction', { max: 1000 }),
      b.trigger_reason || null, b.before_setting || null, b.after_setting || null, req.user.username, nowIso());
    const created = db.prepare('SELECT * FROM process_adjustments WHERE id = ?').get(Number(info.lastInsertRowid));
    audit(db, req.user, { action: 'CREATE', entity: 'process_adjustments', recordId: created.id, newValue: created });
    res.status(201).json({ item: created });
  });

  const loadAdj = (id) => {
    const adj = db.prepare('SELECT * FROM process_adjustments WHERE id = ?').get(id);
    if (!adj) throw notFound('Process Adjustment');
    return adj;
  };

  r.post('/adjustments/:id/approve', requireAuth, requirePerm('adjustment.approve'), (req, res) => {
    const adj = loadAdj(Number(req.params.id));
    if (adj.status !== 'REQUESTED') throw conflict(`Adjustment berstatus ${adj.status}`);
    if (adj.requested_by === req.user.username) throw conflict('Approver tidak boleh sama dengan pembuat instruksi (maker-checker)');
    db.prepare("UPDATE process_adjustments SET status = 'APPROVED', approved_by = ?, approved_at = ? WHERE id = ?").run(req.user.username, nowIso(), adj.id);
    audit(db, req.user, { action: 'APPROVE', entity: 'process_adjustments', recordId: adj.id, oldValue: { status: adj.status }, newValue: { status: 'APPROVED' } });
    res.json({ item: loadAdj(adj.id) });
  });

  r.post('/adjustments/:id/reject', requireAuth, requirePerm('adjustment.approve'), (req, res) => {
    const adj = loadAdj(Number(req.params.id));
    if (adj.status !== 'REQUESTED') throw conflict(`Adjustment berstatus ${adj.status}`);
    const reason = requireString(req.body || {}, 'reason', { max: 500 });
    db.prepare("UPDATE process_adjustments SET status = 'REJECTED', approved_by = ?, approved_at = ?, result = ? WHERE id = ?").run(req.user.username, nowIso(), reason, adj.id);
    audit(db, req.user, { action: 'REJECT', entity: 'process_adjustments', recordId: adj.id, oldValue: { status: adj.status }, newValue: { status: 'REJECTED' }, reason });
    res.json({ item: loadAdj(adj.id) });
  });

  r.post('/adjustments/:id/execute', requireAuth, requirePerm('adjustment.execute'), (req, res) => {
    const adj = loadAdj(Number(req.params.id));
    if (adj.status !== 'APPROVED') throw conflict('Adjustment harus APPROVED oleh SPV sebelum dilaksanakan');
    const result = requireString(req.body || {}, 'result', { max: 1000 });
    db.prepare("UPDATE process_adjustments SET status = 'EXECUTED', executed_by = ?, executed_at = ?, result = ? WHERE id = ?").run(req.user.username, nowIso(), result, adj.id);
    if (adj.run_id) logRunEvent(loadRun(adj.run_id), req.user, 'ADJUSTMENT_EXECUTED', { remark: `Adjustment #${adj.id}: ${result}` });
    audit(db, req.user, { action: 'EXECUTE', entity: 'process_adjustments', recordId: adj.id, oldValue: { status: 'APPROVED' }, newValue: { status: 'EXECUTED', result } });
    res.json({ item: loadAdj(adj.id) });
  });

  r.exposed.boardState = boardState;
  r.exposed.timerOnMinutes = timerOnMinutes;
  return r;
}

module.exports = { buildRouter };
