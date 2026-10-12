'use strict';

const express = require('express');
const { nowIso } = require('../db');
const {
  badRequest, notFound, conflict, unprocessable, audit, requireString, requireNumber, requireEnum,
  optionalTime,
} = require('../http');
const D = require('../domain');
const { hardDelete } = require('../archive');

function buildRouter(db, { requireAuth, requirePerm }) {
  const r = express.Router();
  r.exposed = {};

  const getPlanRow = (id) => db.prepare('SELECT * FROM production_plans WHERE id = ?').get(id);
  const loadPlan = (id) => {
    const row = getPlanRow(id);
    if (!row) throw notFound('Production Plan');
    return D.parsePlan(row);
  };
  const loadShift = (id) => {
    const row = db.prepare('SELECT * FROM shifts WHERE id = ?').get(id);
    if (!row) throw notFound('Shift');
    return row;
  };

  // ---------- Production Plan ----------
  r.get('/plans', requireAuth, requirePerm('plan.view'), (req, res) => {
    const rows = db.prepare('SELECT * FROM production_plans ORDER BY plan_date DESC, id DESC').all();
    res.json({ items: rows.map(D.parsePlan) });
  });

  r.get('/plans/:id', requireAuth, requirePerm('plan.view'), (req, res) => {
    const plan = loadPlan(Number(req.params.id));
    const missing = D.planMissingFields(plan, db);
    const history = db.prepare('SELECT id, plan_no, version, status, created_at FROM production_plans WHERE plan_no = ? ORDER BY version').all(plan.plan_no);
    res.json({ item: plan, missing_fields: missing, versions: history });
  });

  r.post('/plans', requireAuth, requirePerm('plan.write'), (req, res) => {
    const body = req.body || {};
    const norm = D.normalizePlanInput(db, body, { HttpError: null, badRequest });
    if (!norm.plan_date) throw badRequest('plan_date wajib diisi');
    if (!norm.shift_code) throw badRequest('shift_code wajib diisi');
    // Nomor Produksi dibuat otomatis: DP-DDMMYY-NNN (input dari user diabaikan).
    const planNo = D.productionNo(db, norm.plan_date, norm.shift_code);
    const info = db.prepare(`INSERT INTO production_plans
      (plan_no, version, status, plan_date, shift_code, work_order, product, target_bale, target_kg, target_trolley,
       dryers, presses, sampling_rules, cake_interval_min, batch_sequence, notes, created_by, created_at)
      VALUES (?, 1, 'DRAFT', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      planNo, norm.plan_date, norm.shift_code, norm.work_order, norm.product, norm.target_bale, norm.target_kg, norm.target_trolley,
      JSON.stringify(norm.dryers || []), JSON.stringify(norm.presses || []), JSON.stringify(norm.sampling_rules || []),
      norm.cake_interval_min || 60, JSON.stringify(norm.batch_sequence || []), norm.notes, req.user.username, nowIso());
    const plan = loadPlan(Number(info.lastInsertRowid));
    audit(db, req.user, { action: 'CREATE', entity: 'production_plans', recordId: plan.id, newValue: plan });
    res.status(201).json({ item: plan });
  });

  r.patch('/plans/:id', requireAuth, requirePerm('plan.write'), (req, res) => {
    const plan = loadPlan(Number(req.params.id));
    if (plan.status !== 'DRAFT') throw conflict('Plan yang sudah APPROVED/ACTIVE tidak dapat diubah langsung. Gunakan revisi plan (versi baru).');
    const norm = D.normalizePlanInput(db, req.body || {}, { HttpError: null, badRequest });
    // Hanya field yang benar-benar dikirim pada revisi yang menimpa nilai versi sebelumnya.
    // Target Bale dan kg saling mengisi: jika salah satunya diubah, keduanya ikut dihitung ulang.
    const targetTouched = req.body.target_bale !== undefined || req.body.target_kg !== undefined;
    const provided = Object.fromEntries(Object.entries(norm).filter(([k]) => req.body[k] !== undefined || (targetTouched && (k === 'target_bale' || k === 'target_kg'))));
    const merged = { ...plan, ...provided };
    db.prepare(`UPDATE production_plans SET plan_date=?, shift_code=?, work_order=?, product=?, target_bale=?, target_kg=?, target_trolley=?,
      dryers=?, presses=?, sampling_rules=?, cake_interval_min=?, batch_sequence=?, notes=? WHERE id=?`).run(
      merged.plan_date, merged.shift_code, merged.work_order, merged.product, merged.target_bale, merged.target_kg, merged.target_trolley,
      JSON.stringify(merged.dryers), JSON.stringify(merged.presses), JSON.stringify(merged.sampling_rules),
      merged.cake_interval_min, JSON.stringify(merged.batch_sequence), merged.notes, plan.id);
    const after = loadPlan(plan.id);
    audit(db, req.user, { action: 'UPDATE', entity: 'production_plans', recordId: plan.id, oldValue: plan, newValue: after });
    res.json({ item: after });
  });

  // ---------- Hard delete Nomor Produksi (hanya DRAFT; yang sudah disetujui harus direvisi/ditutup) ----------
  r.delete('/plans/:id', requireAuth, requirePerm('hard.delete'), (req, res) => {
    const plan = loadPlan(Number(req.params.id));
    if (plan.status !== 'DRAFT') throw conflict(`Nomor Produksi berstatus ${plan.status}; hanya DRAFT yang dapat dihapus permanen`);
    const reason = requireString(req.body || {}, 'reason', { max: 300 });
    hardDelete(db, req.user, { entity: 'production_plans', table: 'production_plans', id: plan.id, label: `${plan.plan_no} v${plan.version}`, reason });
    res.json({ ok: true, note: 'Nomor Produksi DRAFT dihapus permanen (tercatat di riwayat).' });
  });

  // ---------- Work Order (WO) ----------
  // WO per buyer (contoh WO-BELL-001 Bellshina 500 ton). Dikelola SPV, Manager, Direktur, Admin web.
  // Tidak ada hard delete: WO dinonaktifkan (status NONAKTIF).
  function loadWo(id) {
    const wo = db.prepare('SELECT * FROM work_orders WHERE id = ?').get(id);
    if (!wo) throw notFound(`Work Order #${id}`);
    return wo;
  }
  function woFields(b, { partial = false } = {}) {
    const out = {};
    if (!partial || b.buyer !== undefined) out.buyer = requireString(b, 'buyer', { max: 120 });
    if (!partial || b.target_ton !== undefined) {
      out.target_ton = requireNumber(b, 'target_ton', { min: 0.001, max: 1000000 });
      out.target_kg = Math.round(out.target_ton * 1000 * 1000) / 1000;
    }
    if (!partial || b.notes !== undefined) out.notes = b.notes ? String(b.notes).slice(0, 500) : null;
    return out;
  }

  // Progres WO: produksi = jumlah Bale output (OK + Hold + Reject) x 35 kg, dari semua versi Nomor Produksi
  // yang memakai WO tersebut. Dihitung dari transaksi Bale, bukan input manual.
  r.get('/work-orders', requireAuth, requirePerm('plan.view'), (req, res) => {
    const wos = db.prepare('SELECT * FROM work_orders ORDER BY status, wo_no').all();
    const plans = db.prepare(`SELECT p.id, p.plan_no, p.version, p.plan_date, p.shift_code, p.status, p.work_order, p.product,
        (SELECT COALESCE(SUM(b.gross_qty), 0) FROM bale_events b WHERE b.plan_id = p.id) AS bale
      FROM production_plans p WHERE p.work_order IS NOT NULL ORDER BY p.plan_date, p.id`).all();
    const items = wos.map((w) => {
      const byNo = new Map();
      for (const p of plans.filter((x) => x.work_order === w.wo_no)) {
        const cur = byNo.get(p.plan_no);
        if (!cur) byNo.set(p.plan_no, { ...p });
        else { cur.bale += p.bale; if (p.version > cur.version) Object.assign(cur, { ...p, bale: cur.bale }); }
      }
      const list = [...byNo.values()].map((p) => ({ ...p, kg: p.bale * D.BALE_KG }));
      const bale = list.reduce((s, p) => s + p.bale, 0);
      const kg = bale * D.BALE_KG;
      return { ...w, plans: list, produced_bale: bale, produced_kg: kg, progress_pct: w.target_kg ? Math.round((kg / w.target_kg) * 1000) / 10 : null };
    });
    res.json({ items });
  });

  // Hard delete WO: hanya jika belum dipakai Nomor Produksi.
  r.delete('/work-orders/:id', requireAuth, requirePerm('hard.delete'), (req, res) => {
    const wo = loadWo(Number(req.params.id));
    const used = db.prepare('SELECT COUNT(*) AS n FROM production_plans WHERE work_order = ?').get(wo.wo_no).n;
    if (used) throw conflict(`WO ${wo.wo_no} sudah dipakai ${used} Nomor Produksi; nonaktifkan saja`);
    const reason = requireString(req.body || {}, 'reason', { max: 300 });
    hardDelete(db, req.user, { entity: 'work_orders', table: 'work_orders', id: wo.id, label: wo.wo_no, reason });
    res.json({ ok: true, note: 'WO dihapus permanen (tercatat di riwayat).' });
  });

  r.post('/work-orders', requireAuth, requirePerm('wo.write'), (req, res) => {
    const b = req.body || {};
    const woNo = requireString(b, 'wo_no', { max: 40 }).toUpperCase();
    if (!/^WO-[A-Z0-9-]+$/.test(woNo)) throw badRequest('Nomor WO harus diawali WO- (huruf besar, angka, tanda -)');
    const f = woFields(b);
    if (db.prepare('SELECT id FROM work_orders WHERE wo_no = ?').get(woNo)) throw conflict(`Work Order ${woNo} sudah ada`);
    const at = nowIso();
    const info = db.prepare(`INSERT INTO work_orders (wo_no, buyer, target_ton, target_kg, status, notes, created_by, created_at)
      VALUES (?, ?, ?, ?, 'ACTIVE', ?, ?, ?)`).run(woNo, f.buyer, f.target_ton, f.target_kg, f.notes ?? null, req.user.username, at);
    const item = loadWo(Number(info.lastInsertRowid));
    audit(db, req.user, { action: 'CREATE', entity: 'work_orders', recordId: item.id, newValue: item });
    res.status(201).json({ item });
  });

  r.patch('/work-orders/:id', requireAuth, requirePerm('wo.write'), (req, res) => {
    const wo = loadWo(Number(req.params.id));
    const f = woFields(req.body || {}, { partial: true });
    const merged = { ...wo, ...f };
    if (f.target_ton !== undefined) merged.target_kg = f.target_kg;
    db.prepare('UPDATE work_orders SET buyer = ?, target_ton = ?, target_kg = ?, notes = ?, updated_by = ?, updated_at = ? WHERE id = ?')
      .run(merged.buyer, merged.target_ton, merged.target_kg, merged.notes, req.user.username, nowIso(), wo.id);
    const after = loadWo(wo.id);
    audit(db, req.user, { action: 'UPDATE', entity: 'work_orders', recordId: wo.id, oldValue: wo, newValue: after });
    res.json({ item: after });
  });

  r.post('/work-orders/:id/toggle', requireAuth, requirePerm('wo.write'), (req, res) => {
    const wo = loadWo(Number(req.params.id));
    const next = wo.status === 'ACTIVE' ? 'NONAKTIF' : 'ACTIVE';
    db.prepare('UPDATE work_orders SET status = ?, updated_by = ?, updated_at = ? WHERE id = ?').run(next, req.user.username, nowIso(), wo.id);
    const after = loadWo(wo.id);
    audit(db, req.user, { action: 'UPDATE', entity: 'work_orders', recordId: wo.id, oldValue: wo, newValue: after });
    res.json({ item: after, note: next === 'NONAKTIF' ? 'WO dinonaktifkan; Nomor Produksi lama tetap menyimpan WO ini.' : 'WO diaktifkan kembali.' });
  });

  r.post('/plans/:id/approve', requireAuth, requirePerm('plan.approve'), (req, res) => {
    const plan = loadPlan(Number(req.params.id));
    if (plan.status !== 'DRAFT') throw conflict(`Plan berstatus ${plan.status}, hanya DRAFT yang dapat di-approve`);
    const missing = D.planMissingFields(plan, db);
    if (missing.length) throw unprocessable(`Plan belum lengkap: ${missing.join('; ')}`);
    if (plan.created_by === req.user.username) throw conflict('Pembuat plan tidak boleh meng-approve plan sendiri (maker-checker)');
    db.prepare("UPDATE production_plans SET status = 'APPROVED', approved_by = ?, approved_at = ? WHERE id = ?").run(req.user.username, nowIso(), plan.id);
    const after = loadPlan(plan.id);
    audit(db, req.user, { action: 'APPROVE', entity: 'production_plans', recordId: plan.id, oldValue: { status: plan.status }, newValue: { status: 'APPROVED' } });
    res.json({ item: after });
  });

  r.post('/plans/:id/activate', requireAuth, requirePerm('plan.approve'), (req, res) => {
    const plan = loadPlan(Number(req.params.id));
    if (plan.status !== 'APPROVED') throw conflict(`Plan berstatus ${plan.status}, hanya APPROVED yang dapat diaktifkan`);
    const missing = D.planMissingFields(plan, db);
    if (missing.length) throw unprocessable(`Plan tidak dapat diaktifkan, field wajib belum lengkap: ${missing.join('; ')}`);
    // Hanya satu plan ACTIVE pada satu waktu. Plan ACTIVE lain (bukan induk revisi) harus ditutup lebih dulu.
    const otherActive = db.prepare("SELECT id, plan_no, version FROM production_plans WHERE status = 'ACTIVE' AND id != ? AND id IS NOT ?").get(plan.id, plan.supersedes_id ?? null);
    if (otherActive) {
      throw conflict(`Plan #${otherActive.id} (${otherActive.plan_no} v${otherActive.version}) masih ACTIVE. Tutup plan tersebut terlebih dahulu sebelum mengaktifkan plan ini.`);
    }
    // Versi induk yang direvisi menjadi SUPERSEDED (data lama tidak ditimpa).
    if (plan.supersedes_id) {
      const old = getPlanRow(plan.supersedes_id);
      db.prepare("UPDATE production_plans SET status = 'SUPERSEDED' WHERE id = ?").run(plan.supersedes_id);
      audit(db, req.user, { action: 'SUPERSEDE', entity: 'production_plans', recordId: plan.supersedes_id, oldValue: { status: old.status }, newValue: { status: 'SUPERSEDED', superseded_by: plan.id } });
    }
    db.prepare("UPDATE production_plans SET status = 'ACTIVE', activated_by = ?, activated_at = ? WHERE id = ?").run(req.user.username, nowIso(), plan.id);
    audit(db, req.user, { action: 'ACTIVATE', entity: 'production_plans', recordId: plan.id, newValue: { status: 'ACTIVE' } });
    res.json({ item: loadPlan(plan.id) });
  });

  r.post('/plans/:id/revise', requireAuth, requirePerm('plan.write'), (req, res) => {
    const plan = loadPlan(Number(req.params.id));
    if (!['APPROVED', 'ACTIVE'].includes(plan.status)) throw conflict('Revisi hanya dapat dibuat dari plan APPROVED atau ACTIVE');
    const reason = requireString(req.body || {}, 'reason', { max: 500 });
    const norm = D.normalizePlanInput(db, req.body || {}, { HttpError: null, badRequest });
    // Hanya field yang benar-benar dikirim pada revisi yang menimpa nilai versi sebelumnya.
    // Target Bale dan kg saling mengisi: jika salah satunya diubah, keduanya ikut dihitung ulang.
    const targetTouched = req.body.target_bale !== undefined || req.body.target_kg !== undefined;
    const provided = Object.fromEntries(Object.entries(norm).filter(([k]) => req.body[k] !== undefined || (targetTouched && (k === 'target_bale' || k === 'target_kg'))));
    const merged = { ...plan, ...provided };
    const info = db.prepare(`INSERT INTO production_plans
      (plan_no, version, supersedes_id, status, plan_date, shift_code, work_order, product, target_bale, target_kg, target_trolley,
       dryers, presses, sampling_rules, cake_interval_min, batch_sequence, notes, revision_reason, created_by, created_at)
      VALUES (?, ?, ?, 'DRAFT', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      plan.plan_no, plan.version + 1, plan.id, merged.plan_date, merged.shift_code, merged.work_order, merged.product,
      merged.target_bale, merged.target_kg, merged.target_trolley, JSON.stringify(merged.dryers), JSON.stringify(merged.presses),
      JSON.stringify(merged.sampling_rules), merged.cake_interval_min, JSON.stringify(merged.batch_sequence), merged.notes,
      reason, req.user.username, nowIso());
    const created = loadPlan(Number(info.lastInsertRowid));
    audit(db, req.user, { action: 'REVISE', entity: 'production_plans', recordId: created.id, oldValue: { id: plan.id, version: plan.version }, newValue: { id: created.id, version: created.version }, reason });
    res.status(201).json({ item: created });
  });

  r.post('/plans/:id/close', requireAuth, requirePerm('plan.approve'), (req, res) => {
    const plan = loadPlan(Number(req.params.id));
    if (plan.status !== 'ACTIVE') throw conflict('Hanya plan ACTIVE yang dapat ditutup');
    const openShift = db.prepare("SELECT id FROM shifts WHERE plan_id = ? AND status = 'OPEN'").get(plan.id);
    if (openShift) throw conflict('Masih ada shift yang OPEN untuk plan ini');
    db.prepare("UPDATE production_plans SET status = 'CLOSED', closed_at = ? WHERE id = ?").run(nowIso(), plan.id);
    audit(db, req.user, { action: 'CLOSE', entity: 'production_plans', recordId: plan.id, oldValue: { status: 'ACTIVE' }, newValue: { status: 'CLOSED' } });
    res.json({ item: loadPlan(plan.id) });
  });

  // ---------- Equipment status ----------
  r.get('/equipment/status', requireAuth, (req, res) => {
    const planId = req.query.plan_id ? Number(req.query.plan_id) : null;
    let parsed = null;
    if (planId) {
      parsed = loadPlan(planId);
    } else {
      const row = db.prepare("SELECT * FROM production_plans WHERE status = 'ACTIVE' ORDER BY id DESC LIMIT 1").get();
      parsed = row ? D.parsePlan(row) : null;
    }
    const map = D.equipmentStatusMap(db, parsed);
    const items = db.prepare('SELECT code, name, type, parent_code FROM equipment WHERE active = 1 ORDER BY code').all()
      .map((e) => ({ ...e, status: map[e.code] }));
    res.json({ plan_id: parsed ? parsed.id : null, items });
  });

  // ---------- Shift (Mandor) ----------
  r.get('/shifts', requireAuth, (req, res) => {
    const rows = req.query.plan_id
      ? db.prepare('SELECT * FROM shifts WHERE plan_id = ? ORDER BY id DESC').all(Number(req.query.plan_id))
      : db.prepare('SELECT * FROM shifts ORDER BY id DESC LIMIT 100').all();
    res.json({ items: rows });
  });

  r.post('/shifts', requireAuth, requirePerm('shift.write'), (req, res) => {
    const plan = loadPlan(Number(requireNumber(req.body || {}, 'plan_id', { integer: true, min: 1 })));
    if (plan.status !== 'ACTIVE') throw conflict('Shift hanya dapat dibuka untuk plan ACTIVE');
    const shiftDate = req.body.shift_date ? String(req.body.shift_date) : plan.plan_date;
    const shiftCode = plan.shift_code;
    const exists = db.prepare("SELECT id FROM shifts WHERE plan_id = ? AND shift_date = ? AND shift_code = ? AND status = 'OPEN'").get(plan.id, shiftDate, shiftCode);
    if (exists) throw conflict('Shift yang sama sudah OPEN');
    const info = db.prepare('INSERT INTO shifts (plan_id, shift_date, shift_code, opened_by, opened_at) VALUES (?, ?, ?, ?, ?)')
      .run(plan.id, shiftDate, shiftCode, req.user.username, nowIso());
    const id = Number(info.lastInsertRowid);
    audit(db, req.user, { action: 'CREATE', entity: 'shifts', recordId: id, newValue: { plan_id: plan.id, shift_date: shiftDate, shift_code: shiftCode } });
    res.status(201).json({ item: loadShift(id) });
  });

  r.get('/shifts/:id', requireAuth, (req, res) => {
    const shift = loadShift(Number(req.params.id));
    res.json({
      item: shift,
      events: db.prepare('SELECT * FROM mandor_events WHERE shift_id = ? ORDER BY id').all(shift.id),
      cake_weights: db.prepare('SELECT * FROM cake_weight_logs WHERE shift_id = ? ORDER BY monitored_at').all(shift.id),
      downtime: db.prepare('SELECT * FROM downtime_events WHERE shift_id = ? ORDER BY id').all(shift.id),
      handover: db.prepare('SELECT * FROM handovers WHERE shift_id = ? ORDER BY id DESC LIMIT 1').get(shift.id) || null,
    });
  });

  const requireOpenShift = (shift) => {
    if (shift.status !== 'OPEN') throw conflict('Shift sudah CLOSED; catatan baru tidak dapat ditambahkan');
  };

  const MANDOR_KINDS = ['HARVEST', 'TRANSFER_BLANKET', 'SHREDDER_START', 'SHREDDER_STOP', 'FILLING', 'MOVEMENT'];
  r.post('/shifts/:id/events', requireAuth, requirePerm('shift.write'), (req, res) => {
    const shift = loadShift(Number(req.params.id));
    requireOpenShift(shift);
    const b = req.body || {};
    const kind = requireEnum(b, 'kind', MANDOR_KINDS);
    let batchId = null;
    if (b.batch_code) {
      const batch = db.prepare('SELECT id FROM batches WHERE code = ?').get(String(b.batch_code));
      if (!batch) throw badRequest(`Batch tidak ditemukan: ${b.batch_code}`);
      batchId = batch.id;
    }
    if (['HARVEST', 'TRANSFER_BLANKET', 'FILLING'].includes(kind) && !batchId) throw badRequest(`${kind} wajib menyertakan batch_code`);
    if (kind === 'FILLING' && !b.trolley_code) throw badRequest('FILLING wajib menyertakan trolley_code');
    if (kind === 'MOVEMENT' && (!b.from_loc || !b.to_loc)) throw badRequest('MOVEMENT wajib menyertakan from_loc dan to_loc');
    const qty = b.qty_kg == null || b.qty_kg === '' ? null : requireNumber(b, 'qty_kg', { min: 0, max: 1e7 });
    const at = optionalTime(b, 'at');
    if (b.trolley_code && !db.prepare('SELECT id FROM trolleys WHERE code = ?').get(String(b.trolley_code))) throw badRequest(`Trolley tidak ditemukan: ${b.trolley_code}`);

    if (kind === 'FILLING') {
      // Filling otomatis mengubah trolley menjadi FILLING dengan Batch terkait.
      // Divalidasi dulu (transisi status) sebelum event dicatat.
      setTrolleyStatus(req.user, String(b.trolley_code), 'FILLING', { batchCode: String(b.batch_code), remark: `Filling oleh Mandor (shift ${shift.id})` });
    }
    const info = db.prepare(`INSERT INTO mandor_events (shift_id, kind, batch_id, trolley_code, qty_kg, from_loc, to_loc, forklift_code, remark, at, by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(shift.id, kind, batchId, b.trolley_code || null, qty,
      b.from_loc || null, b.to_loc || null, b.forklift_code || null, b.remark || null, at, req.user.username);
    const created = db.prepare('SELECT * FROM mandor_events WHERE id = ?').get(Number(info.lastInsertRowid));
    audit(db, req.user, { action: 'CREATE', entity: 'mandor_events', recordId: created.id, newValue: created });
    res.status(201).json({ item: created });
  });

  r.post('/shifts/:id/cake-weights', requireAuth, requirePerm('cake.write'), (req, res) => {
    const shift = loadShift(Number(req.params.id));
    requireOpenShift(shift);
    const b = req.body || {};
    const plan = loadPlan(shift.plan_id);
    const avg = requireNumber(b, 'avg_kg', { min: 0.01, max: 1000 });
    const dryer = b.dryer_code ? String(b.dryer_code) : null;
    if (dryer && !plan.dryers.includes(dryer)) throw unprocessable(`${dryer} tidak dipilih pada plan`);
    const at = optionalTime(b, 'monitored_at');
    const info = db.prepare(`INSERT INTO cake_weight_logs (shift_id, dryer_code, trolley_code, avg_kg, monitored_at, remark, at, by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(shift.id, dryer, b.trolley_code || null, avg, at, b.remark || null, nowIso(), req.user.username);
    const created = db.prepare('SELECT * FROM cake_weight_logs WHERE id = ?').get(Number(info.lastInsertRowid));
    audit(db, req.user, { action: 'CREATE', entity: 'cake_weight_logs', recordId: created.id, newValue: created });
    res.status(201).json({ item: created, note: 'Hanya nilai rata-rata. Berat individual Cake tidak dicatat pada MVP (BR-003).' });
  });

  r.post('/shifts/:id/downtime', requireAuth, requirePerm('downtime.write'), (req, res) => {
    const shift = loadShift(Number(req.params.id));
    requireOpenShift(shift);
    const b = req.body || {};
    const plan = loadPlan(shift.plan_id);
    const code = requireString(b, 'equipment_code', { max: 40 });
    const eq = db.prepare('SELECT * FROM equipment WHERE code = ? AND active = 1').get(code);
    if (!eq) throw badRequest(`Equipment tidak ditemukan: ${code}`);
    if (D.PLANNED_EQUIPMENT_TYPES.includes(eq.type)) {
      const planned = eq.type === 'DRYER' ? plan.dryers.includes(eq.code)
        : eq.type === 'PRESS' ? plan.presses.includes(eq.code)
          : plan.presses.includes(eq.parent_code);
      if (!planned) throw unprocessable(`${code} berstatus NOT PLANNED pada plan ini. Equipment NOT PLANNED bukan downtime (BR-005).`);
    }
    const reason = b.reason_code_id ? db.prepare("SELECT * FROM reason_codes WHERE id = ? AND category = 'DOWNTIME' AND active = 1").get(Number(b.reason_code_id)) : null;
    if (!reason) throw badRequest('reason_code_id wajib berupa reason code DOWNTIME yang aktif');
    const start = optionalTime(b, 'start_at');
    const info = db.prepare(`INSERT INTO downtime_events (shift_id, equipment_code, start_at, reason_code_id, line_impact, absorbed_by_wip, action, status, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'OPEN', ?, ?)`).run(shift.id, code, start, reason.id, b.line_impact || null,
      b.absorbed_by_wip ? 1 : 0, b.action || null, req.user.username, nowIso());
    const created = db.prepare('SELECT * FROM downtime_events WHERE id = ?').get(Number(info.lastInsertRowid));
    audit(db, req.user, { action: 'CREATE', entity: 'downtime_events', recordId: created.id, newValue: created });
    res.status(201).json({ item: created });
  });

  r.post('/downtime/:id/end', requireAuth, requirePerm('downtime.write'), (req, res) => {
    const d = db.prepare('SELECT * FROM downtime_events WHERE id = ?').get(Number(req.params.id));
    if (!d) throw notFound('Downtime');
    if (d.status !== 'OPEN') throw conflict('Downtime sudah berakhir');
    const end = optionalTime(req.body || {}, 'end_at');
    if (new Date(end) < new Date(d.start_at)) throw badRequest('end_at tidak boleh sebelum start_at');
    db.prepare("UPDATE downtime_events SET end_at = ?, status = 'ENDED' WHERE id = ?").run(end, d.id);
    audit(db, req.user, { action: 'UPDATE', entity: 'downtime_events', recordId: d.id, oldValue: { end_at: null, status: 'OPEN' }, newValue: { end_at: end, status: 'ENDED' } });
    res.json({ item: db.prepare('SELECT * FROM downtime_events WHERE id = ?').get(d.id) });
  });

  r.post('/downtime/:id/verify', requireAuth, requirePerm('downtime.verify'), (req, res) => {
    const d = db.prepare('SELECT * FROM downtime_events WHERE id = ?').get(Number(req.params.id));
    if (!d) throw notFound('Downtime');
    if (d.status === 'OPEN') throw conflict('Downtime harus diakhiri sebelum diverifikasi');
    if (d.status === 'VERIFIED') throw conflict('Downtime sudah diverifikasi');
    if (d.created_by === req.user.username) throw conflict('Verifikasi harus dilakukan oleh user lain (maker-checker)');
    db.prepare("UPDATE downtime_events SET status = 'VERIFIED', verified_by = ?, verified_at = ? WHERE id = ?").run(req.user.username, nowIso(), d.id);
    audit(db, req.user, { action: 'VERIFY', entity: 'downtime_events', recordId: d.id, oldValue: { status: d.status }, newValue: { status: 'VERIFIED' } });
    res.json({ item: db.prepare('SELECT * FROM downtime_events WHERE id = ?').get(d.id) });
  });

  r.post('/shifts/:id/handover', requireAuth, requirePerm('handover.write'), (req, res) => {
    const shift = loadShift(Number(req.params.id));
    requireOpenShift(shift);
    const b = req.body || {};
    const info = db.prepare(`INSERT INTO handovers (shift_id, wip_summary, partial_pallets, open_issues, carry_over, next_action, outgoing_user, incoming_user, at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(shift.id, b.wip_summary || null, b.partial_pallets || null, b.open_issues || null,
      b.carry_over || null, requireString(b, 'next_action', { max: 1000 }), req.user.username, b.incoming_user || null, nowIso());
    const created = db.prepare('SELECT * FROM handovers WHERE id = ?').get(Number(info.lastInsertRowid));
    audit(db, req.user, { action: 'CREATE', entity: 'handovers', recordId: created.id, newValue: created });
    res.status(201).json({ item: created });
  });

  r.post('/shifts/:id/close', requireAuth, requirePerm('shift.write'), (req, res) => {
    const shift = loadShift(Number(req.params.id));
    requireOpenShift(shift);
    const openDt = db.prepare("SELECT COUNT(*) AS n FROM downtime_events WHERE shift_id = ? AND status = 'OPEN'").get(shift.id).n;
    if (openDt) throw conflict('Masih ada downtime yang belum diakhiri');
    const handover = db.prepare('SELECT id FROM handovers WHERE shift_id = ?').get(shift.id);
    if (!handover) throw conflict('Shift belum memiliki handover. Catat handover sebelum menutup shift (bagian 3, langkah 12).');
    db.prepare("UPDATE shifts SET status = 'CLOSED', closed_by = ?, closed_at = ? WHERE id = ?").run(req.user.username, nowIso(), shift.id);
    audit(db, req.user, { action: 'CLOSE', entity: 'shifts', recordId: shift.id, oldValue: { status: 'OPEN' }, newValue: { status: 'CLOSED' } });
    res.json({ item: loadShift(shift.id) });
  });

  // ---------- Trolley ----------
  r.get('/trolleys', requireAuth, (req, res) => {
    const rows = req.query.status
      ? db.prepare('SELECT t.*, b.code AS batch_code FROM trolleys t LEFT JOIN batches b ON b.id = t.batch_id WHERE t.status = ? ORDER BY t.code').all(String(req.query.status))
      : db.prepare('SELECT t.*, b.code AS batch_code FROM trolleys t LEFT JOIN batches b ON b.id = t.batch_id ORDER BY t.code').all();
    res.json({ items: rows, statuses: D.TROLLEY_STATUS });
  });

  r.post('/trolleys/:code/status', requireAuth, requirePerm('trolley.write'), (req, res) => {
    const b = req.body || {};
    const status = requireEnum(b, 'status', D.TROLLEY_STATUS);
    const batchCode = b.batch_code ? String(b.batch_code) : null;
    const trolley = setTrolleyStatus(req.user, req.params.code, status, { batchCode, remark: b.remark || null });
    res.json({ item: trolley });
  });

  // Digunakan juga oleh Dryer Board dan Mandor Filling. Memastikan transisi valid dan tidak ganda.
  function setTrolleyStatus(user, code, toStatus, { batchCode = null, remark = null, allowDryer = false } = {}) {
    const t = db.prepare('SELECT * FROM trolleys WHERE code = ?').get(String(code));
    if (!t) throw notFound(`Trolley ${code}`);
    if (!t.active) throw conflict(`Trolley ${code} tidak aktif`);
    const from = t.status;
    if (from === toStatus) throw conflict(`Trolley ${code} sudah berstatus ${toStatus}`);
    if (!allowDryer && (from === 'IN DRYER' || toStatus === 'IN DRYER')) {
      throw conflict('Perpindahan ke/dari IN DRYER hanya melalui Dryer Board (trolley IN/OUT)');
    }
    const allowed = D.TROLLEY_TRANSITIONS[from] || [];
    if (!allowDryer && !allowed.includes(toStatus)) {
      throw conflict(`Transisi trolley ${code} dari ${from} ke ${toStatus} tidak diizinkan`);
    }
    let batchId = t.batch_id;
    if (batchCode) {
      const batch = db.prepare('SELECT id FROM batches WHERE code = ?').get(batchCode);
      if (!batch) throw badRequest(`Batch tidak ditemukan: ${batchCode}`);
      batchId = batch.id;
    }
    if (toStatus === 'FILLING' && !batchId) throw badRequest('Trolley FILLING wajib memiliki Batch');
    if (toStatus === 'AVAILABLE/EMPTY') batchId = null;
    db.prepare('UPDATE trolleys SET status = ?, batch_id = ?, last_movement = ? WHERE id = ?').run(toStatus, batchId, nowIso(), t.id);
    db.prepare('INSERT INTO trolley_events (trolley_code, batch_code, from_status, to_status, remark, at, by) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(t.code, batchCode, from, toStatus, remark, nowIso(), user.username);
    const after = db.prepare('SELECT t.*, b.code AS batch_code FROM trolleys t LEFT JOIN batches b ON b.id = t.batch_id WHERE t.id = ?').get(t.id);
    audit(db, user, { action: 'UPDATE', entity: 'trolleys', recordId: t.id, oldValue: { status: from }, newValue: { status: toStatus, batch: after.batch_code } });
    return after;
  }

  r.exposed.setTrolleyStatus = setTrolleyStatus;
  r.exposed.loadPlan = loadPlan;
  r.exposed.loadShift = loadShift;
  return r;
}

module.exports = { buildRouter };
