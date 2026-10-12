'use strict';

// Aturan domain bersama (status, transisi, normalisasi input).
// Nama status mengikuti bagian 9.2 dokumen Rev.02.

const TROLLEY_STATUS = [
  'AVAILABLE/EMPTY', 'FILLING', 'FILLED/READY', 'IN DRYER', 'DRYER OUT/CAKE WIP', 'HOLD', 'CLEANING', 'REPAIR',
];

// Transisi manual yang boleh dilakukan Mandor. Perpindahan ke/dari IN DRYER dilakukan lewat
// endpoint Dryer Board (trolley-in / trolley-out) agar konsisten dengan posisi kompartemen.
const TROLLEY_TRANSITIONS = {
  'AVAILABLE/EMPTY': ['FILLING', 'CLEANING', 'REPAIR'],
  FILLING: ['FILLED/READY', 'AVAILABLE/EMPTY', 'HOLD'],
  'FILLED/READY': ['HOLD', 'FILLING'],
  'IN DRYER': [],
  'DRYER OUT/CAKE WIP': ['AVAILABLE/EMPTY', 'HOLD', 'CLEANING'],
  HOLD: ['AVAILABLE/EMPTY', 'REPAIR', 'CLEANING'],
  CLEANING: ['AVAILABLE/EMPTY'],
  REPAIR: ['AVAILABLE/EMPTY', 'HOLD'],
};

const PLANNED_EQUIPMENT_TYPES = ['DRYER', 'PRESS', 'PRESS_CHAMBER'];
const CHAMBER_CODES = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
const PRESS_CODES = ['PRS-A', 'PRS-B', 'PRS-C'];
const DRYER_CODES = ['DRY-A', 'DRY-B'];
const SAMPLING_RULE_TYPES = ['TIME_INTERVAL', 'TROLLEY_INTERVAL', 'SPECIFIC_TROLLEY', 'RANDOM'];
// Konstanta produksi (keputusan user 12 Okt 2026).
const BALE_KG = 35;                       // 1 Bale = 35 kg
const GRADES = ['SIR20', 'SIR10'];        // grade produk kering
const BATCH_CODES = ['B-0001', 'B-0002', 'B-0003'];
const WO_STATUS = ['ACTIVE', 'NONAKTIF'];

// Nomor Produksi (DryProduction): DP-DDMMYY-NNN, NNN = nomor urut per tanggal produksi.
function productionNo(db, planDate) {
  const [y, m, d] = String(planDate).split('-');
  const prefix = `DP-${d}${m}${y.slice(2)}-`;
  const rows = db.prepare('SELECT DISTINCT plan_no FROM production_plans WHERE plan_no LIKE ?').all(`${prefix}%`);
  let max = 0;
  for (const r of rows) {
    const n = Number(r.plan_no.slice(prefix.length));
    if (Number.isInteger(n) && n > max) max = n;
  }
  return `${prefix}${String(max + 1).padStart(3, '0')}`;
}

const DRYER_COMPARTMENTS = 23;
const PALLET_MAX_BALE = 36;

const BALE_CATEGORIES = ['OK', 'REJECT_METAL', 'HOLD_CONTAMINATION', 'HOLD_WS', 'HOLD_OTHER', 'REJECT_OTHER'];
const STATUS_CATEGORY_OF = {
  OK: 'OK',
  HOLD_CONTAMINATION: 'HOLD_CONTAMINATION',
  HOLD_WS: 'HOLD_WS',
  HOLD_OTHER: 'HOLD_OTHER',
};
const EXCEPTION_CATEGORIES = ['REJECT_METAL', 'HOLD_CONTAMINATION', 'HOLD_WS', 'HOLD_OTHER', 'REJECT_OTHER'];

function jakartaDate(d = new Date()) {
  // YYYY-MM-DD menurut zona waktu perusahaan (Asia/Jakarta, bagian 4.4).
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d);
  const get = (t) => parts.find((p) => p.type === t).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function parseJson(text, fallback) {
  try {
    return text == null ? fallback : JSON.parse(text);
  } catch (e) {
    return fallback;
  }
}

function parsePlan(row) {
  if (!row) return null;
  return {
    ...row,
    dryers: parseJson(row.dryers, []),
    presses: parseJson(row.presses, []),
    sampling_rules: parseJson(row.sampling_rules, []),
    batch_sequence: parseJson(row.batch_sequence, []),
  };
}

// Validasi kelengkapan field wajib plan sebelum approval/aktivasi (PLAN-001).
function planMissingFields(plan, db) {
  const missing = [];
  if (!plan.plan_date) missing.push('tanggal plan');
  if (!plan.shift_code) missing.push('shift');
  if (!plan.work_order) missing.push('Work Order');
  if (!plan.product) missing.push('product/grade');
  if (!plan.target_bale && !plan.target_kg) missing.push('target (Bale atau kg)');
  if (!plan.dryers.length) missing.push('Dryer aktif');
  if (!plan.presses.length) missing.push('Press aktif');
  if (!plan.sampling_rules.length) missing.push('sampling rule');
  if (!plan.batch_sequence.length) missing.push('urutan Batch / material');
  if (![30, 60].includes(Number(plan.cake_interval_min))) missing.push('interval monitoring berat Cake (30/60 menit)');
  for (const dryer of plan.dryers) {
    const vs = db.prepare('SELECT id FROM validated_settings WHERE product = ? AND dryer_code = ? AND active = 1 ORDER BY id DESC LIMIT 1').get(plan.product, dryer);
    if (!vs) missing.push(`validated setting B1/B2/Timer untuk ${dryer} (${plan.product})`);
  }
  return missing;
}

// Mengubah input mentah menjadi bentuk plan yang sudah dinormalisasi. Melempar error jika tidak valid.
function normalizePlanInput(db, b, { HttpError, badRequest }) {
  const out = {};
  const str = (f, max = 200) => (b[f] == null || b[f] === '' ? null : String(b[f]).trim().slice(0, max));
  const num = (f) => (b[f] == null || b[f] === '' ? null : Number(b[f]));

  if (b.plan_date != null && b.plan_date !== '') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(b.plan_date))) throw badRequest('plan_date harus berformat YYYY-MM-DD');
    out.plan_date = String(b.plan_date);
  }
  if (b.shift_code != null && b.shift_code !== '') {
    if (!['1', '2', '3'].includes(String(b.shift_code))) throw badRequest('shift_code harus 1, 2, atau 3');
    out.shift_code = String(b.shift_code);
  }
  out.work_order = str('work_order', 60);
  if (out.work_order) {
    const wo = db.prepare('SELECT status FROM work_orders WHERE wo_no = ?').get(out.work_order);
    if (!wo) throw badRequest(`Work Order tidak ditemukan: ${out.work_order}`);
    if (wo.status !== 'ACTIVE') throw badRequest(`Work Order ${out.work_order} tidak aktif`);
  }
  out.product = str('product', 120);
  if (out.product && !GRADES.includes(out.product)) throw badRequest(`Grade harus salah satu dari: ${GRADES.join(', ')}`);
  out.notes = str('notes', 1000);

  // Target Bale dan target kg saling mengisi: 1 Bale = 35 kg.
  // Jika keduanya dikirim harus konsisten; jika salah satu saja, yang lain dihitung di server.
  let tb = num('target_bale');
  if (tb != null && (!Number.isInteger(tb) || tb < 0)) throw badRequest('target_bale harus bilangan bulat >= 0');
  let tk = num('target_kg');
  if (tk != null && (!Number.isFinite(tk) || tk < 0)) throw badRequest('target_kg harus angka >= 0');
  if (tb != null && tk != null) {
    if (tk !== tb * BALE_KG) throw badRequest(`target_kg harus ${tb} Bale x ${BALE_KG} kg = ${tb * BALE_KG} kg`);
  } else if (tk != null) {
    if (tk % BALE_KG !== 0) throw badRequest(`target_kg harus kelipatan ${BALE_KG} kg (1 Bale = ${BALE_KG} kg)`);
    tb = tk / BALE_KG;
  } else if (tb != null) {
    tk = tb * BALE_KG;
  }
  out.target_bale = tb;
  out.target_kg = tk;
  out.target_derived = tb != null && (num('target_bale') == null || num('target_kg') == null);
  const tt = num('target_trolley');
  if (tt != null && (!Number.isInteger(tt) || tt < 0)) throw badRequest('target_trolley harus bilangan bulat >= 0');
  out.target_trolley = tt;

  if (b.cake_interval_min != null && b.cake_interval_min !== '') {
    if (![30, 60].includes(Number(b.cake_interval_min))) throw badRequest('cake_interval_min harus 30 atau 60 menit');
    out.cake_interval_min = Number(b.cake_interval_min);
  }

  if (b.dryers != null) {
    if (!Array.isArray(b.dryers)) throw badRequest('dryers harus berupa array');
    for (const d of b.dryers) if (!DRYER_CODES.includes(d)) throw badRequest(`Dryer tidak dikenal: ${d}`);
    out.dryers = [...new Set(b.dryers)];
  }
  if (b.presses != null) {
    if (!Array.isArray(b.presses)) throw badRequest('presses harus berupa array');
    for (const p of b.presses) if (!PRESS_CODES.includes(p)) throw badRequest(`Press tidak dikenal: ${p}`);
    out.presses = [...new Set(b.presses)];
  }

  if (b.sampling_rules != null) {
    if (!Array.isArray(b.sampling_rules)) throw badRequest('sampling_rules harus berupa array');
    out.sampling_rules = b.sampling_rules.map((rule) => {
      if (!rule || typeof rule !== 'object') throw badRequest('Setiap sampling rule harus berupa objek');
      if (!SAMPLING_RULE_TYPES.includes(rule.type)) throw badRequest(`Tipe sampling tidak dikenal: ${rule.type}`);
      if (rule.type === 'TIME_INTERVAL') {
        const interval = Number(rule.interval_min);
        if (!Number.isFinite(interval) || interval <= 0) throw badRequest('TIME_INTERVAL membutuhkan interval_min > 0');
        return { type: rule.type, interval_min: interval };
      }
      if (rule.type === 'TROLLEY_INTERVAL') {
        const n = Number(rule.n);
        if (!Number.isInteger(n) || n <= 0) throw badRequest('TROLLEY_INTERVAL membutuhkan n (bilangan bulat > 0)');
        return { type: rule.type, n };
      }
      if (rule.type === 'SPECIFIC_TROLLEY') {
        if (!Array.isArray(rule.trolleys) || !rule.trolleys.length) throw badRequest('SPECIFIC_TROLLEY membutuhkan daftar trolley');
        return { type: rule.type, trolleys: rule.trolleys.map(String) };
      }
      const target = Number(rule.target);
      if (!Number.isInteger(target) || target <= 0) throw badRequest('RANDOM membutuhkan target (bilangan bulat > 0)');
      return { type: rule.type, target };
    });
  }

  if (b.batch_sequence != null) {
    if (!Array.isArray(b.batch_sequence)) throw badRequest('batch_sequence harus berupa array');
    const seen = new Set();
    out.batch_sequence = b.batch_sequence.map((item, idx) => {
      if (!item || typeof item !== 'object') throw badRequest('Setiap item batch_sequence harus berupa objek');
      const code = String(item.batch_code || '').trim();
      if (!BATCH_CODES.includes(code)) throw badRequest(`batch_code harus salah satu dari: ${BATCH_CODES.join(', ')}`);
      if (seen.has(code)) throw badRequest(`batch_code ${code} duplikat dalam urutan batch`);
      seen.add(code);
      if (!db.prepare('SELECT id FROM batches WHERE code = ?').get(code)) throw badRequest(`Batch tidak ditemukan: ${code}`);
      return { batch_code: code, seq: idx + 1, planned_kg: item.planned_kg == null || item.planned_kg === '' ? null : Number(item.planned_kg) };
    });
  }
  return out;
}

function planEquipmentExists(db, codes) {
  for (const code of codes) {
    if (!db.prepare('SELECT id FROM equipment WHERE code = ? AND active = 1').get(code)) return false;
  }
  return true;
}

// Status equipment (bagian 9.2 dan 5.2):
// - NOT PLANNED: Dryer/Press tidak dipilih pada plan ACTIVE. Bukan downtime.
// - Press: REDUCED CAPACITY jika sebagian chamber down; DOWNTIME jika semua chamber down.
function equipmentStatusMap(db, plan) {
  const result = {};
  const equipment = db.prepare('SELECT * FROM equipment WHERE active = 1 ORDER BY code').all();
  const lastStatus = (code) => {
    const row = db.prepare('SELECT status FROM equipment_status_events WHERE equipment_code = ? ORDER BY id DESC LIMIT 1').get(code);
    return row ? row.status : null;
  };
  const openDowntime = new Set(db.prepare("SELECT equipment_code FROM downtime_events WHERE status = 'OPEN'").all().map((r) => r.equipment_code));
  for (const eq of equipment) {
    if (eq.type === 'DRYER') {
      if (!plan || !plan.dryers.includes(eq.code)) { result[eq.code] = 'NOT PLANNED'; continue; }
      if (openDowntime.has(eq.code)) { result[eq.code] = 'DOWNTIME'; continue; }
      const runState = db.prepare("SELECT status FROM dryer_runs WHERE dryer_code = ? AND status IN ('RUNNING','STOPPED') ORDER BY id DESC LIMIT 1").get(eq.code);
      result[eq.code] = runState ? (runState.status === 'RUNNING' ? 'RUNNING' : 'STOPPED') : 'PLANNED ACTIVE';
    } else if (eq.type === 'PRESS') {
      if (!plan || !plan.presses.includes(eq.code)) { result[eq.code] = 'NOT PLANNED'; continue; }
      const chambers = db.prepare("SELECT code FROM equipment WHERE type = 'PRESS_CHAMBER' AND parent_code = ? AND active = 1").all(eq.code).map((c) => c.code);
      const down = chambers.filter((c) => openDowntime.has(c) || lastStatus(c) === 'DOWNTIME');
      if (chambers.length && down.length === chambers.length) result[eq.code] = 'DOWNTIME';
      else if (down.length) result[eq.code] = 'REDUCED CAPACITY';
      else result[eq.code] = 'PLANNED ACTIVE';
    } else if (eq.type === 'PRESS_CHAMBER') {
      const parent = eq.parent_code;
      if (!plan || !plan.presses.includes(parent)) { result[eq.code] = 'NOT PLANNED'; continue; }
      result[eq.code] = openDowntime.has(eq.code) || lastStatus(eq.code) === 'DOWNTIME' ? 'DOWNTIME' : 'PLANNED ACTIVE';
    } else {
      result[eq.code] = openDowntime.has(eq.code) ? 'DOWNTIME' : (lastStatus(eq.code) || 'RUNNING');
    }
  }
  return result;
}

module.exports = {
  TROLLEY_STATUS, TROLLEY_TRANSITIONS, PLANNED_EQUIPMENT_TYPES, CHAMBER_CODES, PRESS_CODES, DRYER_CODES,
  SAMPLING_RULE_TYPES, DRYER_COMPARTMENTS, PALLET_MAX_BALE, BALE_CATEGORIES, STATUS_CATEGORY_OF, EXCEPTION_CATEGORIES,
  jakartaDate, parseJson, parsePlan, planMissingFields, normalizePlanInput, planEquipmentExists, equipmentStatusMap,
  BALE_KG, GRADES, BATCH_CODES, WO_STATUS, productionNo,
};
