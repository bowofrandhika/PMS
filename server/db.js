'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { PERMISSIONS, ROLES } = require('./rbac');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_roles (
  user_id INTEGER NOT NULL REFERENCES users(id),
  role_code TEXT NOT NULL,
  PRIMARY KEY (user_id, role_code)
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_code TEXT NOT NULL,
  permission TEXT NOT NULL,
  PRIMARY KEY (role_code, permission)
);

CREATE TABLE IF NOT EXISTS roles (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  last_seen TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  user_id INTEGER,
  username TEXT,
  role TEXT,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  record_id TEXT,
  old_value TEXT,
  new_value TEXT,
  reason TEXT,
  device TEXT
);

-- ===== Master data =====
CREATE TABLE IF NOT EXISTS equipment (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  type TEXT NOT NULL,            -- DRYER | PRESS | PRESS_CHAMBER | MD | SCALE | SHREDDER | VORTEX_PUMP | FORKLIFT | FLOW_METER | THERMOMETER | FURNACE
  parent_code TEXT,
  location TEXT,
  compartments INTEGER,
  active INTEGER NOT NULL DEFAULT 1,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS trolleys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'AVAILABLE/EMPTY',
  location TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  condition TEXT,
  batch_id INTEGER REFERENCES batches(id),
  last_movement TEXT
);

CREATE TABLE IF NOT EXISTS batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  process TEXT NOT NULL DEFAULT 'DRY_PRODUCTION', -- proses: DRY_PRODUCTION (sekarang); produksi basah/raw material/finished good menyusul
  work_order TEXT,
  product TEXT,
  grade TEXT,
  material_source TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  effective_date TEXT
);

CREATE TABLE IF NOT EXISTS reason_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL,        -- DOWNTIME | ABNORMALITY | CORRECTION | HOLD_REJECT | MOVEMENT
  code TEXT NOT NULL,
  description TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  approval_required INTEGER NOT NULL DEFAULT 0,
  UNIQUE (category, code)
);

CREATE TABLE IF NOT EXISTS validated_settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product TEXT NOT NULL,
  dryer_code TEXT NOT NULL,
  b1_temp REAL,
  b2_temp REAL,
  timer_min REAL NOT NULL,
  run_type TEXT NOT NULL DEFAULT 'STEADY_WIP',
  effective_date TEXT NOT NULL,
  approved_by TEXT,
  revision INTEGER NOT NULL DEFAULT 1,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS consumables (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  category TEXT NOT NULL,        -- PACKAGING | PROCESS_AID | ENERGY
  uom TEXT NOT NULL,
  standard_rule TEXT,            -- deskripsi standard awal (editable)
  standard_qty REAL,             -- standard per unit driver (editable)
  standard_driver TEXT,          -- PALLET_UNIT | BALE | PRODUCTION_DAY | DRYER_RUN | NONE
  minimum_stock REAL NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS consumable_prices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  consumable_id INTEGER NOT NULL REFERENCES consumables(id),
  price REAL NOT NULL,
  currency TEXT NOT NULL DEFAULT 'IDR',
  effective_start TEXT NOT NULL,
  effective_end TEXT,
  source TEXT,
  approved_by TEXT,
  created_at TEXT NOT NULL
);

-- ===== Periode / tutup buku (nomor Nomor Produksi berlanjut dalam satu periode) =====
CREATE TABLE IF NOT EXISTS fiscal_periods (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT,
  status TEXT NOT NULL DEFAULT 'OPEN',   -- OPEN | CLOSED
  last_seq INTEGER NOT NULL DEFAULT 0,   -- penomoran tidak pernah dipakai ulang dalam periode
  closed_by TEXT,
  closed_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS period_exports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  period_id INTEGER NOT NULL REFERENCES fiscal_periods(id),
  exported_by TEXT,
  exported_at TEXT NOT NULL,
  table_count INTEGER,
  row_count INTEGER
);

-- ===== Riwayat hard delete (arsip; tidak pernah dihapus) =====
CREATE TABLE IF NOT EXISTS deleted_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity TEXT NOT NULL,
  table_name TEXT NOT NULL,
  record_id INTEGER NOT NULL,
  label TEXT,
  data TEXT NOT NULL,        -- isi lengkap baris sebelum dihapus (JSON)
  reason TEXT NOT NULL,
  deleted_by TEXT,
  deleted_at TEXT NOT NULL
);

-- ===== Work Order (WO) per buyer =====
CREATE TABLE IF NOT EXISTS work_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  wo_no TEXT NOT NULL UNIQUE,            -- contoh WO-BELL-001
  buyer TEXT NOT NULL,
  target_ton REAL NOT NULL,
  target_kg REAL NOT NULL,               -- = target_ton x 1000
  status TEXT NOT NULL DEFAULT 'ACTIVE', -- ACTIVE | NONAKTIF (tidak ada hard delete)
  notes TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_by TEXT,
  updated_at TEXT
);

-- ===== Production Plan =====
CREATE TABLE IF NOT EXISTS production_plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_no TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  supersedes_id INTEGER REFERENCES production_plans(id),
  status TEXT NOT NULL DEFAULT 'DRAFT',  -- DRAFT | APPROVED | ACTIVE | CLOSED | SUPERSEDED
  period_id INTEGER REFERENCES fiscal_periods(id),
  seq_no INTEGER,                        -- nomor urut dalam periode (NNN pada DPS-DDMMYY-NNN)
  plan_date TEXT NOT NULL,
  shift_code TEXT NOT NULL,
  work_order TEXT,
  product TEXT,
  target_bale INTEGER,
  target_kg REAL,
  target_trolley INTEGER,
  dryers TEXT NOT NULL DEFAULT '[]',       -- JSON array kode Dryer aktif
  presses TEXT NOT NULL DEFAULT '[]',      -- JSON array kode Press aktif
  sampling_rules TEXT NOT NULL DEFAULT '[]', -- JSON array rule sampling
  cake_interval_min INTEGER NOT NULL DEFAULT 60,
  batch_sequence TEXT NOT NULL DEFAULT '[]', -- JSON [{batch_code, seq, planned_kg}]
  notes TEXT,
  revision_reason TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL,
  approved_by TEXT,
  approved_at TEXT,
  activated_by TEXT,
  activated_at TEXT,
  closed_at TEXT
);

-- ===== Shift & Mandor =====
CREATE TABLE IF NOT EXISTS shifts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id INTEGER NOT NULL REFERENCES production_plans(id),
  shift_date TEXT NOT NULL,
  shift_code TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'OPEN',   -- OPEN | CLOSED
  opened_by TEXT NOT NULL,
  opened_at TEXT NOT NULL,
  closed_by TEXT,
  closed_at TEXT
);

CREATE TABLE IF NOT EXISTS mandor_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shift_id INTEGER NOT NULL REFERENCES shifts(id),
  kind TEXT NOT NULL,            -- HARVEST | TRANSFER_BLANKET | SHREDDER_START | SHREDDER_STOP | FILLING | MOVEMENT
  batch_id INTEGER REFERENCES batches(id),
  trolley_code TEXT,
  qty_kg REAL,
  from_loc TEXT,
  to_loc TEXT,
  forklift_code TEXT,
  remark TEXT,
  at TEXT NOT NULL,
  by TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS trolley_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trolley_code TEXT NOT NULL,
  batch_code TEXT,
  from_status TEXT,
  to_status TEXT NOT NULL,
  remark TEXT,
  at TEXT NOT NULL,
  by TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cake_weight_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shift_id INTEGER NOT NULL REFERENCES shifts(id),
  dryer_code TEXT,
  trolley_code TEXT,
  avg_kg REAL NOT NULL,
  monitored_at TEXT NOT NULL,
  remark TEXT,
  at TEXT NOT NULL,
  by TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS downtime_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shift_id INTEGER REFERENCES shifts(id),
  equipment_code TEXT NOT NULL,
  start_at TEXT NOT NULL,
  end_at TEXT,
  reason_code_id INTEGER REFERENCES reason_codes(id),
  line_impact TEXT,
  absorbed_by_wip INTEGER NOT NULL DEFAULT 0,
  action TEXT,
  status TEXT NOT NULL DEFAULT 'OPEN',  -- OPEN | ENDED | VERIFIED
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  verified_by TEXT,
  verified_at TEXT
);

CREATE TABLE IF NOT EXISTS equipment_status_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  equipment_code TEXT NOT NULL,
  status TEXT NOT NULL,
  at TEXT NOT NULL,
  by TEXT
);

CREATE TABLE IF NOT EXISTS handovers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shift_id INTEGER NOT NULL REFERENCES shifts(id),
  wip_summary TEXT,
  partial_pallets TEXT,
  open_issues TEXT,
  carry_over TEXT,
  next_action TEXT,
  outgoing_user TEXT NOT NULL,
  incoming_user TEXT,
  at TEXT NOT NULL
);

-- ===== Dryer =====
CREATE TABLE IF NOT EXISTS dryer_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id INTEGER NOT NULL REFERENCES production_plans(id),
  dryer_code TEXT NOT NULL,
  run_type TEXT NOT NULL DEFAULT 'STEADY_WIP',  -- STARTUP_EMPTY | STEADY_WIP
  validated_setting_id INTEGER REFERENCES validated_settings(id),
  status TEXT NOT NULL DEFAULT 'RUNNING',       -- RUNNING | STOPPED | CLOSED
  started_at TEXT NOT NULL,
  started_by TEXT NOT NULL,
  closed_at TEXT,
  timer_on_min REAL NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS dryer_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER NOT NULL REFERENCES dryer_runs(id),
  kind TEXT NOT NULL,   -- TROLLEY_IN | TROLLEY_OUT | READING | START | STOP | RESTART | CARRY_OVER | SAMPLE | ADJUSTMENT_EXECUTED
  compartment INTEGER,
  trolley_code TEXT,
  b1_temp REAL,
  b2_temp REAL,
  ref_temp REAL,
  timer_min REAL,
  remark TEXT,
  at TEXT NOT NULL,
  by TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cake_samples (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER NOT NULL REFERENCES dryer_runs(id),
  plan_id INTEGER NOT NULL REFERENCES production_plans(id),
  trolley_code TEXT NOT NULL,
  trolley_seq INTEGER,
  planned_at TEXT,
  actual_at TEXT NOT NULL,
  ad_hoc INTEGER NOT NULL DEFAULT 0,
  reason TEXT,
  rule_type TEXT,
  p0 REAL,
  mv REAL,
  pri REAL,
  remark TEXT,
  by TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS process_adjustments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id INTEGER NOT NULL REFERENCES production_plans(id),
  run_id INTEGER REFERENCES dryer_runs(id),
  instruction TEXT NOT NULL,
  trigger_reason TEXT,
  before_setting TEXT,
  after_setting TEXT,
  status TEXT NOT NULL DEFAULT 'REQUESTED',  -- REQUESTED | APPROVED | EXECUTED | REJECTED
  requested_by TEXT NOT NULL,
  requested_at TEXT NOT NULL,
  approved_by TEXT,
  approved_at TEXT,
  executed_by TEXT,
  executed_at TEXT,
  result TEXT
);

-- ===== Metal Detector, Bale, Pallet =====
CREATE TABLE IF NOT EXISTS md_challenges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id INTEGER NOT NULL REFERENCES production_plans(id),
  test_type TEXT NOT NULL,      -- FE_2_5 | NONFE_2_5 | SS_2_5
  result TEXT NOT NULL,         -- PASS | FAIL
  context TEXT NOT NULL,        -- START | RESTART
  at TEXT NOT NULL,
  by TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS md_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id INTEGER NOT NULL REFERENCES production_plans(id),
  started_at TEXT NOT NULL,
  started_by TEXT NOT NULL,
  stopped_at TEXT,
  stopped_by TEXT
);

CREATE TABLE IF NOT EXISTS pallets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id INTEGER NOT NULL REFERENCES production_plans(id),
  manual_no TEXT,
  forming_box_code TEXT,
  status TEXT NOT NULL DEFAULT 'OPEN',   -- OPEN | PARTIAL | FULL | MOVED | HOLD/REJECT | RELEASED | SHIPPED
  location TEXT,
  slot_count INTEGER NOT NULL DEFAULT 0,   -- Bale yang mengisi slot pallet (OK + Hold)
  max_bale INTEGER NOT NULL DEFAULT 36,
  status_category TEXT,                  -- OK | HOLD_METAL | HOLD_CONTAMINATION | HOLD_WS | HOLD_OTHER
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  closed_at TEXT
);

CREATE TABLE IF NOT EXISTS pallet_compositions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pallet_id INTEGER NOT NULL REFERENCES pallets(id),
  batch_code TEXT NOT NULL,
  qty INTEGER NOT NULL DEFAULT 0,
  status_category TEXT NOT NULL,
  UNIQUE (pallet_id, batch_code, status_category)
);

CREATE TABLE IF NOT EXISTS bale_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id INTEGER NOT NULL REFERENCES production_plans(id),
  pallet_id INTEGER REFERENCES pallets(id),
  batch_code TEXT NOT NULL,
  category TEXT NOT NULL,      -- OK | REJECT_METAL | HOLD_CONTAMINATION | HOLD_WS | HOLD_OTHER | REJECT_OTHER
  gross_qty INTEGER NOT NULL DEFAULT 1,
  reject_qty INTEGER NOT NULL DEFAULT 0,
  chamber_code TEXT,
  metal_type TEXT,
  location TEXT,
  remark TEXT,
  at TEXT NOT NULL,
  by TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS batch_cutoffs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id INTEGER NOT NULL REFERENCES production_plans(id),
  pallet_id INTEGER REFERENCES pallets(id),
  old_batch_code TEXT NOT NULL,
  new_batch_code TEXT NOT NULL,
  boundary_count INTEGER NOT NULL,
  off_plan INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'REQUESTED',  -- REQUESTED | SPV_APPROVED | VERIFIED
  requested_by TEXT NOT NULL,
  requested_at TEXT NOT NULL,
  spv_approved_by TEXT,
  verified_by TEXT,
  verified_at TEXT
);

CREATE TABLE IF NOT EXISTS pallet_movements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pallet_id INTEGER NOT NULL REFERENCES pallets(id),
  from_loc TEXT,
  to_loc TEXT,
  forklift_code TEXT,
  at TEXT NOT NULL,
  by TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS quality_exceptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bale_event_id INTEGER NOT NULL REFERENCES bale_events(id),
  qc_decision TEXT,             -- NULL = belum ada QC Release
  qc_reason TEXT,
  qc_by TEXT,
  qc_at TEXT
);

-- ===== Consumable & energy =====
CREATE TABLE IF NOT EXISTS consumable_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  consumable_id INTEGER NOT NULL REFERENCES consumables(id),
  plan_id INTEGER REFERENCES production_plans(id),
  dryer_run_id INTEGER REFERENCES dryer_runs(id),
  type TEXT NOT NULL,           -- RECEIPT | ISSUE | USE | RETURN | WASTE | ADJUSTMENT
  qty REAL NOT NULL,
  reason TEXT,
  reference TEXT,
  at TEXT NOT NULL,
  by TEXT NOT NULL,
  role TEXT
);

-- ===== Correction (no hard delete) =====
CREATE TABLE IF NOT EXISTS corrections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity TEXT NOT NULL,
  record_id INTEGER NOT NULL,
  field TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',  -- PENDING | APPROVED | REJECTED
  requested_by TEXT NOT NULL,
  requested_at TEXT NOT NULL,
  decided_by TEXT,
  decided_at TEXT
);
`;

const DEFAULT_SETTINGS = {
  session_timeout_min: '30',
  lockout_threshold: '5',
  lockout_minutes: '15',
  bale_per_pallet_max: '36',
  chamber_repeat_alert: '3',
  dryer_compartments: '23',
  trolley_count_provisional: '40',
  timezone: 'Asia/Jakarta',
};

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

function verifyPassword(password, stored) {
  const [scheme, salt, hash] = String(stored).split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const candidate = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return expected.length === candidate.length && crypto.timingSafeEqual(expected, candidate);
}

function nowIso() {
  return new Date().toISOString();
}

function seedRbac(db) {
  const insRole = db.prepare('INSERT OR IGNORE INTO roles (code, name) VALUES (?, ?)');
  const insPerm = db.prepare('INSERT OR IGNORE INTO role_permissions (role_code, permission) VALUES (?, ?)');
  for (const [code, role] of Object.entries(ROLES)) {
    insRole.run(code, role.name);
    for (const perm of role.perms) insPerm.run(code, perm);
  }
  return PERMISSIONS;
}

function seedMasterData(db) {
  const count = (table) => db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
  if (count('equipment') === 0) {
    const eq = db.prepare(`INSERT INTO equipment (code, name, type, parent_code, location, compartments, notes) VALUES (?, ?, ?, ?, ?, ?, ?)`);
    eq.run('SHRED-01', 'Shredder', 'SHREDDER', null, 'Area Shredder', null, 'Status/downtime dicatat Mandor');
    eq.run('VORTEX-01', 'Vortex Pump', 'VORTEX_PUMP', null, 'Area Shredder', null, 'Transfer crumb ke Filling');
    eq.run('DRY-A', 'Dryer A', 'DRYER', null, 'Dryer Line', 23, 'Burner 1 belakang, Burner 2 depan');
    eq.run('DRY-B', 'Dryer B', 'DRYER', null, 'Dryer Line', 23, 'Burner 1 belakang, Burner 2 depan');
    eq.run('SCALE-CAKE', 'Cake Scale', 'SCALE', null, 'Cake Handling', null, 'Master/calibration; tidak ada input berat Cake individual');
    for (const p of ['A', 'B', 'C']) {
      eq.run(`PRS-${p}`, `Press ${p}`, 'PRESS', null, 'Press Area', null, `Sub-unit ${p}1 dan ${p}2`);
      for (const c of [1, 2]) {
        eq.run(`PRS-${p}${c}`, `Press ${p}${c}`, 'PRESS_CHAMBER', `PRS-${p}`, 'Press Area', null, 'Chamber');
      }
    }
    eq.run('SCALE-BALE', 'Bale Scale', 'SCALE', null, 'Bale Area', null, 'Master/calibration; tidak ada input berat Bale individual');
    eq.run('MD-01', 'Metal Detector', 'MD', null, 'Packing Line', null, 'Challenge Fe/Non-Fe/SS 2.5 dan event exception');
    eq.run('FLOW-SOLAR', 'Solar Flow Meter', 'FLOW_METER', null, 'Dryer Line', null, 'Manual reading awal; integrasi future');
    eq.run('TC-REF', 'Reference Thermometer/TC', 'THERMOMETER', null, 'Dryer Line', null, 'Temperature verification');
    eq.run('FORKLIFT-01', 'Forklift', 'FORKLIFT', null, 'Warehouse', null, 'Movement dicatat Mandor; tidak masuk OEE Dry Line awal');
    eq.run('FURNACE-01', 'Furnace', 'FURNACE', null, 'Furnace', null, 'Future equipment - diaktifkan setelah commissioning');
  }

  if (count('trolleys') === 0) {
    const n = Number(DEFAULT_SETTINGS.trolley_count_provisional);
    const ins = db.prepare('INSERT INTO trolleys (code, status, location) VALUES (?, ?, ?)');
    for (let i = 1; i <= n; i++) ins.run(`TRL-${String(i).padStart(2, '0')}`, 'AVAILABLE/EMPTY', 'Area Filling');
  }

  if (count('reason_codes') === 0) {
    const ins = db.prepare('INSERT INTO reason_codes (category, code, description, approval_required) VALUES (?, ?, ?, ?)');
    ins.run('DOWNTIME', 'MECH', 'Gangguan mekanik', 0);
    ins.run('DOWNTIME', 'ELEC', 'Gangguan elektrikal', 0);
    ins.run('DOWNTIME', 'MATERIAL', 'Kekurangan material / menunggu material', 0);
    ins.run('DOWNTIME', 'CLEAN', 'Cleaning / sanitasi terjadwal', 0);
    ins.run('ABNORMALITY', 'JAM', 'Macet / jam pada transfer', 0);
    ins.run('ABNORMALITY', 'MAGNET', 'Benda asing terdeteksi magnet', 0);
    ins.run('CORRECTION', 'TYPO', 'Salah input', 1);
    ins.run('HOLD_REJECT', 'METAL_FE', 'Reject metal Fe', 0);
    ins.run('HOLD_REJECT', 'METAL_NONFE', 'Reject metal Non-Fe', 0);
    ins.run('HOLD_REJECT', 'METAL_SS', 'Reject metal SS', 0);
    ins.run('MOVEMENT', 'TRANSFER', 'Transfer pallet / material', 0);
  }

  if (count('batches') === 0) {
    const ins = db.prepare('INSERT INTO batches (code, work_order, product, grade, material_source, effective_date) VALUES (?, ?, ?, ?, ?, ?)');
    const today = new Date().toISOString().slice(0, 10);
    ins.run('B-2610-001', 'WO-2610-001', 'Produk Kering', 'Grade A', 'Blanket - Sumber 1', today);
    ins.run('B-2610-002', 'WO-2610-002', 'Produk Kering', 'Grade A', 'Blanket - Sumber 2', today);
    ins.run('B-2610-003', 'WO-2610-003', 'Produk Kering', 'Grade B', 'Blanket - Sumber 1', today);
  }

  // Kode batch produksi B-0001..B-0003 (urutan batch pada Nomor Produksi).
  for (const code of ['B-0001', 'B-0002', 'B-0003']) {
    const exists = db.prepare('SELECT id FROM batches WHERE code = ?').get(code);
    if (!exists) {
      db.prepare('INSERT INTO batches (code, product, grade, status, effective_date) VALUES (?, ?, ?, ?, ?)')
        .run(code, 'SIR20', 'SIR20', 'ACTIVE', new Date().toISOString().slice(0, 10));
    }
  }

  // Contoh WO dari user (sample data; dapat dinonaktifkan atau diubah di menu Work Order).
  if (count('work_orders') === 0) {
    const now = new Date().toISOString();
    const ins = db.prepare('INSERT INTO work_orders (wo_no, buyer, target_ton, target_kg, status, notes, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    ins.run('WO-BELL-001', 'Bellshina', 500, 500000, 'ACTIVE', 'Contoh data awal', 'seed', now);
    ins.run('WO-GY-001', 'Goodyear', 300, 300000, 'ACTIVE', 'Contoh data awal', 'seed', now);
  }

  if (count('validated_settings') === 0) {
    const ins = db.prepare('INSERT INTO validated_settings (product, dryer_code, b1_temp, b2_temp, timer_min, run_type, effective_date, approved_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    const today = new Date().toISOString().slice(0, 10);
    ins.run('Produk Kering', 'DRY-A', 120, 110, 180, 'STEADY_WIP', today, 'SPV Produksi Kering');
    ins.run('Produk Kering', 'DRY-B', 120, 110, 180, 'STEADY_WIP', today, 'SPV Produksi Kering');

  }

  // Grade SIR20 dan SIR10 perlu validated setting per Dryer agar Nomor Produksi bisa diaktifkan.
  for (const product of ['SIR20', 'SIR10']) {
    const n = db.prepare('SELECT COUNT(*) AS n FROM validated_settings WHERE product = ?').get(product).n;
    if (n === 0) {
      const ins = db.prepare('INSERT INTO validated_settings (product, dryer_code, b1_temp, b2_temp, timer_min, run_type, effective_date, approved_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
      const today = new Date().toISOString().slice(0, 10);
      ins.run(product, 'DRY-A', 120, 110, 180, 'STEADY_WIP', today, 'SPV Produksi Kering');
      ins.run(product, 'DRY-B', 120, 110, 180, 'STEADY_WIP', today, 'SPV Produksi Kering');
    }
  }

  if (count('consumables') === 0) {
    const ins = db.prepare('INSERT INTO consumables (code, name, category, uom, standard_rule, standard_qty, standard_driver, minimum_stock) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    ins.run('PALLET', 'Pallet', 'PACKAGING', 'unit', 'Expected 1 unit per Pallet Unit', 1, 'PALLET_UNIT', 10);
    ins.run('PLASTIK-SIR', 'Plastik SIR', 'PACKAGING', 'lembar', 'Expected 1 per Bale wrapped (36 per pallet penuh)', 1, 'BALE', 100);
    ins.run('PLASTIK-INTERLAYER', 'Plastik Interlayer', 'PACKAGING', 'lembar', 'Expected 1,5 lembar per Pallet Unit', 1.5, 'PALLET_UNIT', 50);
    ins.run('MINYAK-MAKAN', 'Minyak Makan', 'PROCESS_AID', 'liter', 'Expected 1 liter per hari produksi', 1, 'PRODUCTION_DAY', 5);
    ins.run('SOLAR', 'Solar', 'ENERGY', 'liter', 'Per Dryer Run (editable, provisional)', null, 'DRYER_RUN', 0);
    ins.run('CANGKANG', 'Cangkang / Biomass', 'ENERGY', 'kg', 'Future - setelah commissioning Furnace', null, 'NONE', 0);
  }
}

function seedUsers(db) {
  const existing = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  if (existing > 0) return;
  const demo = [
    ['admin', 'Administrator Sistem', 'ADMIN'],
    ['spv', 'SPV Produksi Kering', 'SPV'],
    ['mandor', 'Mandor Produksi', 'MANDOR'],
    ['opdryer', 'Operator Dryer', 'OP_DRYER'],
    ['opmd', 'Operator Metal Detector', 'OP_MD'],
    ['qc', 'QC Produksi', 'QC'],
    ['manager', 'Manager Produksi', 'MANAGER'],
    ['spv2', 'SPV Produksi Kering (Approver)', 'SPV'],
    ['direktur', 'Direktur', 'DIREKTUR'],
  ];
  const password = process.env.PMS_DEMO_PASSWORD || 'Password123!';
  const ins = db.prepare('INSERT INTO users (username, full_name, password_hash, created_at) VALUES (?, ?, ?, ?)');
  const link = db.prepare('INSERT INTO user_roles (user_id, role_code) VALUES (?, ?)');
  for (const [username, fullName, role] of demo) {
    const info = ins.run(username, fullName, hashPassword(password), nowIso());
    link.run(Number(info.lastInsertRowid), role);
  }
}

// Penyesuaian satu kali untuk database yang sudah berjalan:
// - peran AUDITOR dihapus dari sistem (akun auditor dihapus, atau dinonaktifkan bila sudah punya jejak audit);
// - hak melihat riwayat (deleted.view) diberikan ke SPV, Manager, Direktur, dan Admin;
// - akun direktur disediakan.
function reconcileRbacAndAccounts(db) {
  const flag = 'migrasi_riwayat_v1';
  if (db.prepare('SELECT 1 FROM settings WHERE key = ?').get(flag)) return;
  const aud = db.prepare("SELECT id FROM users WHERE username = 'auditor'").get();
  if (aud) {
    db.prepare('DELETE FROM user_roles WHERE user_id = ?').run(aud.id);
    const used = db.prepare('SELECT COUNT(*) AS n FROM audit_logs WHERE user_id = ?').get(aud.id).n;
    if (used === 0) db.prepare('DELETE FROM users WHERE id = ?').run(aud.id);
    else db.prepare('UPDATE users SET active = 0 WHERE id = ?').run(aud.id);
  }
  db.prepare("DELETE FROM user_roles WHERE role_code = 'AUDITOR'").run();
  db.prepare("DELETE FROM role_permissions WHERE role_code = 'AUDITOR'").run();
  db.prepare("DELETE FROM roles WHERE code = 'AUDITOR'").run();
  const perm = db.prepare('INSERT OR IGNORE INTO role_permissions (role_code, permission) VALUES (?, ?)');
  for (const code of ['SPV', 'MANAGER', 'DIREKTUR', 'ADMIN']) perm.run(code, 'deleted.view');
  if (!db.prepare("SELECT id FROM users WHERE username = 'direktur'").get()) {
    const password = process.env.PMS_DEMO_PASSWORD || 'Password123!';
    const info = db.prepare('INSERT INTO users (username, full_name, password_hash, created_at) VALUES (?, ?, ?, ?)')
      .run('direktur', 'Direktur', hashPassword(password), nowIso());
    db.prepare('INSERT OR IGNORE INTO user_roles (user_id, role_code) VALUES (?, ?)').run(Number(info.lastInsertRowid), 'DIREKTUR');
  }
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(flag, 'done');
}

function seedSettings(db) {
  const ins = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) ins.run(k, v);
}

// Migrasi ringan untuk database yang dibuat sebelum perubahan skema.
// ok_count -> slot_count: kolom ini menghitung Bale yang mengisi slot pallet (OK + Hold), bukan OK saja.
function migrate(db) {
  const colsOf = (t) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
  if (!colsOf('production_plans').includes('period_id')) db.exec('ALTER TABLE production_plans ADD COLUMN period_id INTEGER REFERENCES fiscal_periods(id)');
  if (!colsOf('production_plans').includes('seq_no')) db.exec('ALTER TABLE production_plans ADD COLUMN seq_no INTEGER');
  if (!colsOf('batches').includes('process')) db.exec("ALTER TABLE batches ADD COLUMN process TEXT NOT NULL DEFAULT 'DRY_PRODUCTION'");
  // Periode aktif wajib ada; Nomor Produksi lama dimasukkan ke periode ini dengan urutan sesuai dibuat.
  let open = db.prepare("SELECT * FROM fiscal_periods WHERE status = 'OPEN' ORDER BY id DESC LIMIT 1").get();
  if (!open) {
    const today = new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
    const info = db.prepare("INSERT INTO fiscal_periods (name, start_date, status, last_seq, created_at) VALUES (?, ?, 'OPEN', 0, ?)")
      .run(`Periode ${today.slice(0, 4)} (1)`, today, new Date().toISOString());
    open = db.prepare('SELECT * FROM fiscal_periods WHERE id = ?').get(Number(info.lastInsertRowid));
  }
  const orphan = db.prepare('SELECT id FROM production_plans WHERE period_id IS NULL ORDER BY id').all();
  if (orphan.length) {
    let seq = db.prepare('SELECT COALESCE(MAX(seq_no), 0) AS m FROM production_plans WHERE period_id = ?').get(open.id).m;
    const upd = db.prepare('UPDATE production_plans SET period_id = ?, seq_no = ? WHERE id = ?');
    for (const p of orphan) { seq += 1; upd.run(open.id, seq, p.id); }
    db.prepare('UPDATE fiscal_periods SET last_seq = ? WHERE id = ?').run(seq, open.id);
  }
  const cols = db.prepare('PRAGMA table_info(pallets)').all().map((c) => c.name);
  if (cols.includes('ok_count') && !cols.includes('slot_count')) {
    db.exec('ALTER TABLE pallets RENAME COLUMN ok_count TO slot_count');
  }
}

function openDatabase(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON;');
  if (file !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);
  migrate(db);
  seedRbac(db);
  seedSettings(db);
  seedMasterData(db);
  seedUsers(db);
  reconcileRbacAndAccounts(db);
  return db;
}

module.exports = { openDatabase, hashPassword, verifyPassword, nowIso, DEFAULT_SETTINGS };
