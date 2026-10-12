'use strict';

const express = require('express');
const { nowIso } = require('../db');
const { badRequest, notFound, conflict, audit, requireString, requireNumber, requireEnum } = require('../http');
const D = require('../domain');

// Nilai kalor provisional (Dokumen 11.4). Bersifat editable; belum divalidasi Process Owner.
const LHV = { liter: { mjPerUnit: 35.9, label: 'Diesel (solar) 35,9 MJ/liter' }, kg: { mjPerUnit: 17, label: 'Cangkang 17 MJ/kg' } };

// Batas moisture cangkang (Dokumen 11.4): PASS <=15%, Monitoring >15-18%, Hold/Review >18%.
function classifyMoisture(pct) {
  const v = Number(pct);
  if (!Number.isFinite(v) || v < 0 || v > 100) return { status: 'INVALID' };
  if (v <= 15) return { status: 'PASS' };
  if (v <= 18) return { status: 'MONITORING' };
  return { status: 'HOLD_REVIEW' };
}

const CORRECTABLE = {
  bale_events: ['remark', 'chamber_code'],
  dryer_events: ['remark'],
  cake_samples: ['remark', 'p0', 'mv', 'pri'],
  mandor_events: ['remark'],
};

function csvEscape(v) {
  if (v === null || v === undefined) return '';
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function buildRouter(db, { requireAuth, requirePerm, loadPlan }) {
  const r = express.Router();
  r.exposed = {};

  const planOf = (id) => (id ? loadPlan(Number(id)) : null);

  function priceAsOf(consumableId, date) {
    return db.prepare(`SELECT * FROM consumable_prices WHERE consumable_id = ? AND effective_start <= ?
      AND (effective_end IS NULL OR effective_end >= ?) ORDER BY effective_start DESC, id DESC LIMIT 1`).get(consumableId, date, date) || null;
  }

  // ---------- Dashboard ----------
  r.get('/dashboard', requireAuth, requirePerm('dashboard.view'), (req, res) => {
    const planId = req.query.plan_id ? Number(req.query.plan_id) : null;
    const plan = planId ? loadPlan(planId) : D.parsePlan(db.prepare("SELECT * FROM production_plans WHERE status = 'ACTIVE' ORDER BY id DESC LIMIT 1").get());
    const pending = {
      plans_not_started: db.prepare("SELECT COUNT(*) AS n FROM production_plans WHERE status = 'DRAFT'").get().n,
      cutoffs_awaiting_action: db.prepare("SELECT COUNT(*) AS n FROM batch_cutoffs WHERE status != 'VERIFIED'").get().n,
      adjustments_awaiting_approval: db.prepare("SELECT COUNT(*) AS n FROM process_adjustments WHERE status = 'REQUESTED'").get().n,
      corrections_awaiting_approval: db.prepare("SELECT COUNT(*) AS n FROM corrections WHERE status = 'PENDING'").get().n,
      qc_exceptions_pending: db.prepare('SELECT COUNT(*) AS n FROM quality_exceptions WHERE qc_decision IS NULL').get().n,
    };
    const trolleyByStatus = db.prepare('SELECT status, COUNT(*) AS n FROM trolleys WHERE active = 1 GROUP BY status ORDER BY status').all();
    const base = {
      plan: plan ? { id: plan.id, plan_no: plan.plan_no, version: plan.version, status: plan.status, product: plan.product, dryers: plan.dryers } : null,
      pending,
      trolley_status: trolleyByStatus,
      generated_at: nowIso(),
      note: 'Item bertanda INCOMPLETE atau pending approval tidak disembunyikan pada dashboard (RPT-003).',
    };
    if (!plan) return res.json({ ...base, bales: null });
    const bales = db.prepare('SELECT category, COUNT(*) AS n, SUM(gross_qty) AS gross FROM bale_events WHERE plan_id = ? GROUP BY category').all(plan.id);
    const pallets = db.prepare('SELECT status, COUNT(*) AS n FROM pallets WHERE plan_id = ? GROUP BY status').all(plan.id);
    const runs = db.prepare('SELECT dryer_code, status, COUNT(*) AS n FROM dryer_runs WHERE plan_id = ? GROUP BY dryer_code, status').all(plan.id);
    const md = db.prepare('SELECT COUNT(*) AS n FROM md_sessions WHERE plan_id = ? AND stopped_at IS NULL').get(plan.id).n;
    const oee = {};
    for (const d of plan.dryers) oee[d] = oeeFor(plan, d, null).status;
    const sampleCompliance = db.prepare('SELECT COUNT(*) AS total, SUM(ad_hoc) AS ad_hoc FROM cake_samples WHERE plan_id = ?').get(plan.id);
    res.json({
      ...base,
      bales,
      pallets,
      dryer_runs: runs,
      md_running: md > 0,
      md_active_batch: null,
      samples: sampleCompliance,
      oee_status: oee,
    });
  });

  // ---------- OEE Dryer (pilot) ----------
  // A = Actual Timer ON / Planned Timer ON; P = Actual Trolley OUT / Ideal Trolley; Q = Good / Gross (basis bale, provisional).
  function oeeFor(plan, dryer, plannedMin) {
    const runs = db.prepare('SELECT * FROM dryer_runs WHERE plan_id = ? AND dryer_code = ?').all(plan.id, dryer);
    const actualTimer = runs.reduce((sum, run) => sum + (run.status === 'CLOSED' ? run.timer_on_min : 0), 0);
    const openTimer = runs.filter((x) => x.status !== 'CLOSED').length;
    const outCount = db.prepare(`SELECT COUNT(*) AS n FROM dryer_events e JOIN dryer_runs r ON r.id = e.run_id
      WHERE r.plan_id = ? AND r.dryer_code = ? AND e.kind = 'TROLLEY_OUT'`).get(plan.id, dryer).n;
    let ideal = 0;
    for (const run of runs) {
      const vs = db.prepare('SELECT timer_min FROM validated_settings WHERE id = ?').get(run.validated_setting_id);
      if (vs && vs.timer_min > 0 && run.status === 'CLOSED') ideal += run.timer_on_min / vs.timer_min;
    }
    const a = plannedMin && plannedMin > 0 && openTimer === 0 ? actualTimer / plannedMin : null;
    const p = ideal > 0 && openTimer === 0 ? outCount / ideal : null;
    // Gross/Good dihitung dari jumlah Bale (gross_qty), bukan jumlah baris event (count OK bisa berisi banyak Bale).
    const gross = db.prepare('SELECT COALESCE(SUM(gross_qty), 0) AS n FROM bale_events WHERE plan_id = ?').get(plan.id).n;
    const good = db.prepare("SELECT COALESCE(SUM(gross_qty), 0) AS n FROM bale_events WHERE plan_id = ? AND category = 'OK'").get(plan.id).n
      + db.prepare("SELECT COALESCE(SUM(be.gross_qty), 0) AS n FROM quality_exceptions qe JOIN bale_events be ON be.id = qe.bale_event_id WHERE be.plan_id = ? AND qe.qc_decision = 'RELEASE_GOOD'").get(plan.id).n;
    const qcDecisions = db.prepare('SELECT COUNT(*) AS n FROM quality_exceptions qe JOIN bale_events be ON be.id = qe.bale_event_id WHERE be.plan_id = ? AND qe.qc_decision IS NOT NULL').get(plan.id).n;
    const q = gross > 0 && qcDecisions > 0 ? good / gross : null;
    const missing = [];
    if (!plannedMin) missing.push('Planned Timer ON (input SPV)');
    if (openTimer) missing.push('Dryer Run belum CLOSED');
    if (!ideal) missing.push('Ideal Trolley (validated Timer)');
    if (q === null) missing.push('QC Release (Q)');
    const complete = a !== null && p !== null && q !== null;
    return {
      dryer,
      status: complete ? 'OK' : 'INCOMPLETE',
      missing,
      actual_timer_on_min: Math.round(actualTimer * 100) / 100,
      planned_timer_on_min: plannedMin || null,
      A: a === null ? null : Math.round(a * 1000) / 10,
      trolley_out: outCount,
      ideal_trolley: Math.round(ideal * 100) / 100,
      P: p === null ? null : Math.round(p * 1000) / 10,
      gross_bale: gross,
      good_bale: good,
      Q: q === null ? null : Math.round(q * 1000) / 10,
      OEE: complete ? Math.round(a * p * q * 1000) / 10 : null,
      note: 'Q berbasis count Bale (kg belum tersedia). Press OEE tidak dihitung pada MVP. Metode agregat Dryer A+B belum ditetapkan (OI-10).',
    };
  }

  r.get('/kpi/oee', requireAuth, requirePerm('dashboard.view'), (req, res) => {
    const plan = planOf(req.query.plan_id) || loadPlan(db.prepare("SELECT id FROM production_plans WHERE status = 'ACTIVE' ORDER BY id DESC LIMIT 1").get()?.id);
    const planned = req.query.planned_min ? Number(req.query.planned_min) : null;
    const dryers = req.query.dryer ? [String(req.query.dryer)] : plan.dryers;
    res.json({ plan_id: plan.id, items: dryers.map((d) => oeeFor(plan, d, planned)) });
  });

  // ---------- Consumable & energy ----------
  r.get('/consumables', requireAuth, requirePerm('dashboard.view'), (req, res) => {
    const today = D.jakartaDate();
    const items = db.prepare('SELECT * FROM consumables WHERE active = 1 ORDER BY id').all().map((c) => {
      const price = priceAsOf(c.id, today);
      return { ...c, current_price: price ? price.price : null, price_status: price ? 'OK' : 'PRICE NOT SET' };
    });
    res.json({ items });
  });

  r.post('/consumables/:id/prices', requireAuth, requirePerm('consumable.price'), (req, res) => {
    const c = db.prepare('SELECT * FROM consumables WHERE id = ?').get(Number(req.params.id));
    if (!c) throw notFound('Consumable');
    const b = req.body || {};
    const price = requireNumber(b, 'price', { min: 0 });
    const start = requireString(b, 'effective_start', { max: 10 });
    const end = b.effective_end ? String(b.effective_end) : null;
    if (end && end < start) throw badRequest('effective_end tidak boleh sebelum effective_start');
    // Harga lama ditutup, bukan ditimpa (histori tetap ada).
    db.prepare('UPDATE consumable_prices SET effective_end = ? WHERE consumable_id = ? AND effective_end IS NULL AND effective_start < ?')
      .run(new Date(new Date(start).getTime() - 86400000).toISOString().slice(0, 10), c.id, start);
    const info = db.prepare(`INSERT INTO consumable_prices (consumable_id, price, currency, effective_start, effective_end, source, approved_by, created_at)
      VALUES (?, ?, 'IDR', ?, ?, ?, ?, ?)`).run(c.id, price, start, end, b.source || null, req.user.username, nowIso());
    audit(db, req.user, { action: 'CREATE', entity: 'consumable_prices', recordId: Number(info.lastInsertRowid), newValue: { consumable: c.code, price, start, end } });
    res.status(201).json({ item: db.prepare('SELECT * FROM consumable_prices WHERE id = ?').get(Number(info.lastInsertRowid)) });
  });

  r.post('/consumables/transactions', requireAuth, requirePerm('consumable.write'), (req, res) => {
    const b = req.body || {};
    const c = db.prepare('SELECT * FROM consumables WHERE id = ?').get(requireNumber(b, 'consumable_id', { integer: true, min: 1 }));
    if (!c) throw notFound('Consumable');
    const type = requireEnum(b, 'type', ['RECEIPT', 'ISSUE', 'USE', 'RETURN', 'WASTE', 'ADJUSTMENT']);
    const qty = requireNumber(b, 'qty', { min: 0.0001 });
    const reason = b.reason ? String(b.reason).slice(0, 300) : null;
    if (type === 'ADJUSTMENT' && !reason) throw badRequest('ADJUSTMENT wajib alasan');
    const info = db.prepare(`INSERT INTO consumable_transactions (consumable_id, plan_id, dryer_run_id, type, qty, reason, reference, at, by, role)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(c.id, b.plan_id ? Number(b.plan_id) : null, b.dryer_run_id ? Number(b.dryer_run_id) : null,
      type, qty, reason, b.reference || null, nowIso(), req.user.username, req.user.roles.join(','));
    res.status(201).json({ item: db.prepare('SELECT * FROM consumable_transactions WHERE id = ?').get(Number(info.lastInsertRowid)) });
  });

  r.get('/consumables/summary', requireAuth, requirePerm('dashboard.view'), (req, res) => {
    const plan = planOf(req.query.plan_id);
    if (!plan) throw badRequest('plan_id wajib');
    const drivers = {
      PALLET_UNIT: db.prepare("SELECT COUNT(*) AS n FROM pallets WHERE plan_id = ? AND slot_count > 0").get(plan.id).n,
      BALE: db.prepare("SELECT COUNT(*) AS n FROM bale_events WHERE plan_id = ? AND category = 'OK'").get(plan.id).n,
      PRODUCTION_DAY: db.prepare('SELECT COUNT(DISTINCT shift_date) AS n FROM shifts WHERE plan_id = ?').get(plan.id).n,
      DRYER_RUN: db.prepare('SELECT COUNT(*) AS n FROM dryer_runs WHERE plan_id = ?').get(plan.id).n,
      NONE: 0,
    };
    const rows = db.prepare('SELECT * FROM consumables WHERE active = 1 ORDER BY id').all().map((c) => {
      const actual = db.prepare(`SELECT
          COALESCE(SUM(CASE WHEN type IN ('USE','ISSUE','WASTE') THEN qty WHEN type = 'RETURN' THEN -qty ELSE 0 END), 0) AS used
        FROM consumable_transactions WHERE consumable_id = ? AND plan_id = ?`).get(c.id, plan.id).used;
      const expected = c.standard_qty == null ? null : c.standard_qty * (drivers[c.standard_driver] || 0);
      const price = priceAsOf(c.id, plan.plan_date);
      const energy = c.category === 'ENERGY' && LHV[c.uom] ? { mj: Math.round(actual * LHV[c.uom].mjPerUnit * 100) / 100, basis: LHV[c.uom].label } : null;
      return {
        code: c.code, name: c.name, category: c.category, uom: c.uom,
        driver: c.standard_driver, driver_count: drivers[c.standard_driver] || 0,
        expected: expected === null ? 'STANDARD NOT SET' : Math.round(expected * 100) / 100,
        actual: Math.round(actual * 100) / 100,
        variance: expected === null ? null : Math.round((actual - expected) * 100) / 100,
        unit_price: price ? price.price : null,
        cost: price ? Math.round(actual * price.price) : 'PRICE NOT SET',
        energy,
      };
    });
    res.json({ plan_id: plan.id, items: rows, note: 'Solar dan cangkang ditampilkan terpisah. Cost KPI tidak dihitung jika harga belum ada.' });
  });

  r.get('/consumables/moisture-rule', requireAuth, requirePerm('dashboard.view'), (req, res) => {
    if (req.query.pct === undefined) return res.json({ rule: { PASS: '<=15%', MONITORING: '>15-18%', HOLD_REVIEW: '>18%' } });
    res.json({ pct: Number(req.query.pct), ...classifyMoisture(req.query.pct) });
  });

  // ---------- Correction (no hard delete; approval SPV) ----------
  r.get('/corrections', requireAuth, requirePerm('dashboard.view'), (req, res) => {
    res.json({ items: db.prepare('SELECT * FROM corrections ORDER BY id DESC LIMIT 300').all() });
  });

  r.post('/corrections', requireAuth, requirePerm('correction.request'), (req, res) => {
    const b = req.body || {};
    const entity = requireEnum(b, 'entity', Object.keys(CORRECTABLE));
    const field = requireEnum(b, 'field', CORRECTABLE[entity]);
    const recordId = requireNumber(b, 'record_id', { integer: true, min: 1 });
    const reason = requireString(b, 'reason', { max: 500 });
    const row = db.prepare(`SELECT * FROM ${entity} WHERE id = ?`).get(recordId);
    if (!row) throw notFound('Record');
    const newValue = b.new_value == null ? null : String(b.new_value);
    const info = db.prepare(`INSERT INTO corrections (entity, record_id, field, old_value, new_value, reason, status, requested_by, requested_at)
      VALUES (?, ?, ?, ?, ?, ?, 'PENDING', ?, ?)`).run(entity, recordId, field, row[field] == null ? null : String(row[field]), newValue, reason, req.user.username, nowIso());
    audit(db, req.user, { action: 'REQUEST_CORRECTION', entity, recordId, oldValue: { [field]: row[field] }, newValue: { [field]: newValue }, reason });
    res.status(201).json({ item: db.prepare('SELECT * FROM corrections WHERE id = ?').get(Number(info.lastInsertRowid)) });
  });

  r.post('/corrections/:id/decide', requireAuth, requirePerm('correction.approve'), (req, res) => {
    const c = db.prepare('SELECT * FROM corrections WHERE id = ?').get(Number(req.params.id));
    if (!c) throw notFound('Correction');
    if (c.status !== 'PENDING') throw conflict(`Koreksi berstatus ${c.status}`);
    if (c.requested_by === req.user.username) throw conflict('Approver tidak boleh sama dengan pemohon (maker-checker)');
    const decision = requireEnum(req.body || {}, 'decision', ['APPROVED', 'REJECTED']);
    if (decision === 'APPROVED') {
      // Nilai lama tetap tersimpan di corrections dan audit; baris asal diperbarui hanya pada field yang diizinkan.
      db.prepare(`UPDATE ${c.entity} SET ${c.field} = ? WHERE id = ?`).run(c.new_value, c.record_id);
    }
    db.prepare('UPDATE corrections SET status = ?, decided_by = ?, decided_at = ? WHERE id = ?').run(decision, req.user.username, nowIso(), c.id);
    audit(db, req.user, { action: decision === 'APPROVED' ? 'APPROVE_CORRECTION' : 'REJECT_CORRECTION', entity: c.entity, recordId: c.record_id, oldValue: { [c.field]: c.old_value }, newValue: { [c.field]: c.new_value }, reason: c.reason });
    res.json({ item: db.prepare('SELECT * FROM corrections WHERE id = ?').get(c.id) });
  });

  // ---------- Reports (export CSV Excel-compatible / halaman print A4) ----------
  const REPORTS = {
    plans: {
      title: 'Production Plan',
      sql: `SELECT id, plan_no, version, status, plan_date, shift_code, work_order, product, target_bale, target_kg, dryers, presses, created_by, approved_by, activated_by
        FROM production_plans WHERE (? IS NULL OR id = ?) AND plan_date BETWEEN ? AND ? ORDER BY plan_date, id`,
    },
    shifts: {
      title: 'Shift & Mandor Events',
      sql: `SELECT s.shift_date, s.shift_code, s.status AS shift_status, e.kind, e.batch_id, e.trolley_code, e.qty_kg, e.from_loc, e.to_loc, e.forklift_code, e.remark, e.at, e.by
        FROM shifts s LEFT JOIN mandor_events e ON e.shift_id = s.id WHERE (? IS NULL OR s.plan_id = ?) AND s.shift_date BETWEEN ? AND ? ORDER BY s.shift_date, s.id, e.id`,
    },
    'dryer-runs': {
      title: 'Dryer Run',
      sql: `SELECT r.id, r.plan_id, r.dryer_code, r.run_type, r.status, r.started_at, r.started_by, r.closed_at, r.timer_on_min
        FROM dryer_runs r JOIN production_plans p ON p.id = r.plan_id WHERE (? IS NULL OR r.plan_id = ?) AND date(r.started_at) BETWEEN ? AND ? ORDER BY r.id`,
    },
    'cake-samples': {
      title: 'Sampling Cake',
      sql: `SELECT id, run_id, plan_id, trolley_code, trolley_seq, planned_at, actual_at, ad_hoc, reason, p0, mv, pri, remark, by
        FROM cake_samples WHERE (? IS NULL OR plan_id = ?) AND date(actual_at) BETWEEN ? AND ? ORDER BY id`,
    },
    exceptions: {
      title: 'Exception Reject / Hold (Bale OK tidak dilaporkan per-Bale)',
      sql: `SELECT be.id, be.plan_id, be.batch_code, be.category, be.chamber_code, be.metal_type, be.pallet_id, be.location, be.at, be.by,
          qe.qc_decision, qe.qc_reason, qe.qc_by
        FROM bale_events be LEFT JOIN quality_exceptions qe ON qe.bale_event_id = be.id
        WHERE be.category != 'OK' AND (? IS NULL OR be.plan_id = ?) AND date(be.at) BETWEEN ? AND ? ORDER BY be.id`,
    },
    pallets: {
      title: 'Pallet',
      sql: `SELECT id, plan_id, manual_no, forming_box_code, status, status_category, location, slot_count, max_bale, created_by, created_at, closed_at
        FROM pallets WHERE (? IS NULL OR plan_id = ?) AND date(created_at) BETWEEN ? AND ? ORDER BY id`,
    },
    cutoffs: {
      title: 'Batch Cutoff',
      sql: `SELECT id, plan_id, old_batch_code, new_batch_code, boundary_count, off_plan, status, requested_by, spv_approved_by, verified_by, verified_at
        FROM batch_cutoffs WHERE (? IS NULL OR plan_id = ?) AND date(requested_at) BETWEEN ? AND ? ORDER BY id`,
    },
    downtime: {
      title: 'Downtime (non-Dryer / Press)',
      sql: `SELECT d.id, d.shift_id, d.equipment_code, d.start_at, d.end_at, rc.code AS reason_code, d.line_impact, d.absorbed_by_wip, d.status, d.created_by, d.verified_by
        FROM downtime_events d LEFT JOIN reason_codes rc ON rc.id = d.reason_code_id WHERE date(d.start_at) BETWEEN ? AND ? ORDER BY d.id`,
      args: (q) => [q.from, q.to],
    },
    audit: {
      title: 'Audit Trail',
      sql: `SELECT ts, username, role, action, entity, record_id, old_value, new_value, reason FROM audit_logs WHERE date(ts) BETWEEN ? AND ? ORDER BY id`,
      args: (q) => [q.from, q.to],
      perm: 'audit.view',
    },
  };

  r.get('/reports', requireAuth, requirePerm('report.view'), (req, res) => {
    res.json({ items: Object.entries(REPORTS).map(([key, v]) => ({ key, title: v.title })) });
  });

  r.get('/reports/:type', requireAuth, requirePerm('report.view'), (req, res) => {
    const rep = REPORTS[req.params.type];
    if (!rep) throw notFound('Laporan');
    if (rep.perm && !req.user.permissions.includes(rep.perm)) return res.status(403).json({ error: 'Akses ditolak', code: 'FORBIDDEN' });
    const q = req.query;
    const from = q.from || '1900-01-01';
    const to = q.to || '2999-12-31';
    const planId = q.plan_id ? Number(q.plan_id) : null;
    const args = rep.args ? rep.args({ from, to }) : [planId, planId, from, to];
    const rows = db.prepare(rep.sql).all(...args);
    const format = q.format || 'json';
    if (format === 'json') return res.json({ title: rep.title, count: rows.length, items: rows });
    if (!req.user.permissions.includes('report.export')) return res.status(403).json({ error: 'Export tidak diizinkan untuk role ini', code: 'FORBIDDEN' });
    audit(db, req.user, { action: 'EXPORT', entity: 'report', recordId: req.params.type, newValue: { format, from, to, plan_id: planId, rows: rows.length } });
    const cols = rows.length ? Object.keys(rows[0]) : [];
    if (format === 'csv') {
      const lines = [cols.join(',')];
      for (const row of rows) lines.push(cols.map((c) => csvEscape(row[c])).join(','));
      // BOM agar Excel membaca UTF-8 dengan benar; kolom dipisah koma (standar CSV).
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${req.params.type}-${from}-${to}.csv"`);
      return res.send('\uFEFF' + lines.join('\r\n') + '\r\n');
    }
    if (format === 'print') {
      const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
      const head = cols.map((c) => `<th>${esc(c)}</th>`).join('');
      const body = rows.map((row) => `<tr>${cols.map((c) => `<td>${esc(row[c])}</td>`).join('')}</tr>`).join('');
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.send(`<!doctype html><html lang="id"><head><meta charset="utf-8"><title>${esc(rep.title)}</title>
<style>@page{size:A4 landscape;margin:12mm}body{font-family:Arial,sans-serif;font-size:9pt;color:#123}
header{display:flex;align-items:center;gap:12px;border-bottom:2px solid #1b5e8c;padding-bottom:6px;margin-bottom:10px}
header img{height:42px}h1{font-size:13pt;margin:0}table{border-collapse:collapse;width:100%}th,td{border:1px solid #9bb;padding:3px 4px;text-align:left;vertical-align:top}
th{background:#e6f0f7}.meta{font-size:8pt;color:#456;margin-bottom:6px}</style></head><body>
<header><img src="/logo.svg?v=5" alt="PBS"><div><h1>${esc(rep.title)}</h1><div class="meta">PT Potensi Bumi Sakti · Periode ${esc(from)} s/d ${esc(to)} · Dicetak oleh ${esc(req.user.username)} · ${esc(nowIso())} · ${rows.length} baris</div></div></header>
<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>
<script>window.addEventListener('load',()=>window.print());</script></body></html>`);
    }
    throw badRequest('format tidak dikenal (json|csv|print)');
  });

  r.exposed.oeeFor = oeeFor;
  return r;
}

module.exports = { buildRouter, classifyMoisture };
