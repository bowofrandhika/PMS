import type {
  Alert,
  DefectReason,
  DowntimeReason,
  InventoryItem,
  Line,
  LineStatus,
  Machine,
  MachineStatus,
  MaintenanceTask,
  OeePoint,
  Operator,
  OutputPoint,
  PlantState,
  Shift,
  SpcSample,
  TaskStatus,
  WorkOrder,
} from './types'
import { clamp, mulberry32 } from './utils'

const rng = mulberry32(20261012)
const between = (a: number, b: number) => a + rng() * (b - a)
const pick = <T,>(arr: T[]): T => arr[Math.floor(rng() * arr.length)]

/* ------------------------------------------------------------------ lines -- */
interface LineSeed {
  id: string
  code: string
  name: string
  leader: string
  product: string
  machineNames: string[]
  base: number
}

const LINE_SEEDS: LineSeed[] = [
  {
    id: 'ln-01',
    code: 'LN-01',
    name: 'Alpha Assembly',
    leader: 'R. Hartono',
    product: 'NX-220 Control Module',
    machineNames: ['Solder Jet', 'Pick & Place', 'Reflow Oven', 'AOI Scanner'],
    base: 92,
  },
  {
    id: 'ln-02',
    code: 'LN-02',
    name: 'Bravo Assembly',
    leader: 'M. Kusuma',
    product: 'HS-40 Haptic Sensor',
    machineNames: ['Dispenser R2', 'Torque Cell', 'Leak Tester', 'Laser Marker'],
    base: 86,
  },
  {
    id: 'ln-03',
    code: 'LN-03',
    name: 'Charlie SMT',
    leader: 'D. Prasetyo',
    product: 'LB-9 Logic Board',
    machineNames: ['Stencil Printer', 'Mount Head 1', 'Mount Head 2', 'X-Ray Inspect'],
    base: 81,
  },
  {
    id: 'ln-04',
    code: 'LN-04',
    name: 'Delta Molding',
    leader: 'S. Wijaya',
    product: 'PH-12 Polymer Housing',
    machineNames: ['Injection Press', 'Cooling Tunnel', 'Trim Robot', 'Vision Inspector'],
    base: 74,
  },
  {
    id: 'ln-05',
    code: 'LN-05',
    name: 'Echo Packing',
    leader: 'A. Lestari',
    product: 'RP-77 Retail Pack',
    machineNames: ['Cartoner', 'Label Printer', 'Seal Checker', 'Palletizer'],
    base: 89,
  },
  {
    id: 'ln-06',
    code: 'LN-06',
    name: 'Foxtrot CNC',
    leader: 'B. Nugroho',
    product: 'AB-31 Alloy Bracket',
    machineNames: ['CNC Mill X1', 'CNC Mill X2', 'Deburr Station', 'CMM Gauge'],
    base: 68,
  },
]

const BASE_TELEMETRY: Record<string, { temp: number; vibration: number; rpm: number; pressure: number }> = {
  'Solder Jet': { temp: 246, vibration: 1.1, rpm: 180, pressure: 4.2 },
  'Pick & Place': { temp: 42, vibration: 2.4, rpm: 7200, pressure: 5.8 },
  'Reflow Oven': { temp: 238, vibration: 0.4, rpm: 60, pressure: 3.1 },
  'AOI Scanner': { temp: 33, vibration: 0.6, rpm: 420, pressure: 2.4 },
  'Dispenser R2': { temp: 38, vibration: 1.7, rpm: 900, pressure: 6.1 },
  'Torque Cell': { temp: 44, vibration: 3.2, rpm: 1450, pressure: 7.4 },
  'Leak Tester': { temp: 29, vibration: 0.9, rpm: 260, pressure: 8.6 },
  'Laser Marker': { temp: 51, vibration: 0.7, rpm: 120, pressure: 2.2 },
  'Stencil Printer': { temp: 36, vibration: 1.4, rpm: 640, pressure: 4.8 },
  'Mount Head 1': { temp: 40, vibration: 2.9, rpm: 9600, pressure: 6.4 },
  'Mount Head 2': { temp: 41, vibration: 3.1, rpm: 9400, pressure: 6.2 },
  'X-Ray Inspect': { temp: 27, vibration: 0.3, rpm: 90, pressure: 1.9 },
  'Injection Press': { temp: 182, vibration: 4.1, rpm: 240, pressure: 12.4 },
  'Cooling Tunnel': { temp: 96, vibration: 1.2, rpm: 300, pressure: 5.2 },
  'Trim Robot': { temp: 47, vibration: 2.6, rpm: 2100, pressure: 6.8 },
  'Vision Inspector': { temp: 31, vibration: 0.5, rpm: 180, pressure: 2.1 },
  Cartoner: { temp: 34, vibration: 2.1, rpm: 1250, pressure: 4.4 },
  'Label Printer': { temp: 39, vibration: 1.3, rpm: 480, pressure: 3.3 },
  'Seal Checker': { temp: 30, vibration: 0.8, rpm: 220, pressure: 5.6 },
  Palletizer: { temp: 43, vibration: 3.4, rpm: 860, pressure: 6.9 },
  'CNC Mill X1': { temp: 68, vibration: 5.2, rpm: 12500, pressure: 9.8 },
  'CNC Mill X2': { temp: 71, vibration: 5.6, rpm: 12200, pressure: 10.1 },
  'Deburr Station': { temp: 45, vibration: 3.8, rpm: 3200, pressure: 7.1 },
  'CMM Gauge': { temp: 22, vibration: 0.2, rpm: 60, pressure: 1.4 },
}

const STATUS_CYCLE: MachineStatus[] = ['running', 'running', 'running', 'running', 'idle', 'setup', 'maintenance', 'down']

function buildMachines(): Machine[] {
  const machines: Machine[] = []
  LINE_SEEDS.forEach((seed, li) => {
    seed.machineNames.forEach((name, mi) => {
      const base = BASE_TELEMETRY[name] ?? { temp: 40, vibration: 1.5, rpm: 800, pressure: 4 }
      let status: MachineStatus = rng() > 0.22 ? 'running' : pick(STATUS_CYCLE)
      // Guarantee some interesting exceptions across the plant.
      if (seed.code === 'LN-06' && mi === 3) status = 'maintenance'
      if (seed.code === 'LN-04' && mi === 0) status = 'idle'
      if (seed.code === 'LN-02' && mi === 1) status = 'down'

      const health = clamp(
        status === 'down' ? between(28, 48) : status === 'maintenance' ? between(52, 70) : between(74, 99),
        0,
        100,
      )
      const target = Math.round(between(1050, 1900))
      const running = status === 'running'
      const output = running ? Math.round(target * between(0.62, 0.96)) : Math.round(target * between(0.05, 0.4))

      machines.push({
        id: `${seed.id}-m${mi + 1}`,
        code: `M-${li + 1}0${mi + 1}`,
        name,
        lineId: seed.id,
        station: mi + 1,
        status,
        health,
        oee: clamp(between(58, 94)),
        outputToday: output,
        targetToday: target,
        cycleTime: Number(between(3.4, 18.6).toFixed(1)),
        scrapRate: Number(between(0.4, 4.6).toFixed(2)),
        uptimeHours: Math.round(between(120, 5400)),
        lastService: `${Math.round(between(2, 46))}d ago`,
        nextService: `${Math.round(between(3, 40))}d`,
        firmware: `v${Math.floor(between(2, 5))}.${Math.floor(between(0, 9))}.${Math.floor(between(0, 9))}`,
        telemetry: {
          temp: base.temp + between(-3, 3),
          vibration: Math.max(0.1, base.vibration + between(-0.5, 0.6)),
          rpm: Math.round(base.rpm + between(-160, 160)),
          pressure: Number((base.pressure + between(-0.6, 0.6)).toFixed(1)),
          current: Number(between(4.5, 32).toFixed(1)),
          tempSeries: Array.from({ length: 40 }, () => base.temp + between(-2.5, 2.5)),
          vibSeries: Array.from({ length: 40 }, () => Math.max(0.1, base.vibration + between(-0.4, 0.5))),
          rpmSeries: Array.from({ length: 40 }, () => base.rpm + between(-140, 140)),
        },
        sinceMin: Math.round(between(4, 420)),
      })
    })
  })
  return machines
}

function lineStatusFromMachines(machines: Machine[], base: number): LineStatus {
  const down = machines.filter((m) => m.status === 'down').length
  const maint = machines.filter((m) => m.status === 'maintenance').length
  const runningRatio = machines.filter((m) => m.status === 'running').length / machines.length
  if (down >= 2 || runningRatio < 0.4) return 'critical'
  if (down >= 1 || maint >= 2) return 'attention'
  if (base >= 88 && runningRatio > 0.7) return 'optimal'
  if (runningRatio > 0.5) return 'nominal'
  return 'attention'
}

function buildLines(machines: Machine[]): Line[] {
  return LINE_SEEDS.map((seed) => {
    const own = machines.filter((m) => m.lineId === seed.id)
    const target = own.reduce((s, m) => s + m.targetToday, 0)
    const output = own.reduce((s, m) => s + m.outputToday, 0)
    return {
      id: seed.id,
      code: seed.code,
      name: seed.name,
      leader: seed.leader,
      product: seed.product,
      shift: rng() > 0.5 ? 'Shift A' : 'Shift B',
      status: lineStatusFromMachines(own, seed.base),
      target,
      output,
      oee: clamp(between(seed.base - 8, seed.base + 5)),
      scrap: Number(between(0.6, 4.2).toFixed(2)),
      throughput: Math.round(between(320, 1240)),
      efficiencySeries: Array.from({ length: 32 }, (_, i) => clamp(seed.base + Math.sin(i / 3) * 5 + between(-5, 5))),
      operators: Math.round(between(8, 26)),
      energyKwh: Math.round(between(180, 920)),
    }
  })
}

/* ------------------------------------------------------------ work orders -- */
const PRODUCTS = [
  { sku: 'NX-220', name: 'Control Module', line: 'ln-01' },
  { sku: 'NX-220R', name: 'Control Module Rev2', line: 'ln-01' },
  { sku: 'HS-40', name: 'Haptic Sensor', line: 'ln-02' },
  { sku: 'HS-40L', name: 'Haptic Sensor Lite', line: 'ln-02' },
  { sku: 'LB-9', name: 'Logic Board', line: 'ln-03' },
  { sku: 'LB-9A', name: 'Logic Board Auto', line: 'ln-03' },
  { sku: 'PH-12', name: 'Polymer Housing', line: 'ln-04' },
  { sku: 'PH-12G', name: 'Polymer Housing Gloss', line: 'ln-04' },
  { sku: 'RP-77', name: 'Retail Pack', line: 'ln-05' },
  { sku: 'RP-77B', name: 'Retail Pack Bulk', line: 'ln-05' },
  { sku: 'AB-31', name: 'Alloy Bracket', line: 'ln-06' },
  { sku: 'AB-31S', name: 'Alloy Bracket Slim', line: 'ln-06' },
]

const OWNERS = ['R. Hartono', 'M. Kusuma', 'D. Prasetyo', 'S. Wijaya', 'A. Lestari', 'B. Nugroho', 'L. Santoso']
const ORDER_STATUSES: WorkOrder['status'][] = ['running', 'running', 'running', 'queued', 'queued', 'quality', 'blocked', 'done']

function buildWorkOrders(): WorkOrder[] {
  return Array.from({ length: 22 }, (_, i) => {
    const product = PRODUCTS[i % PRODUCTS.length]
    const qty = Math.round(between(800, 6400) / 100) * 100
    const status = i < 3 ? 'running' : pick(ORDER_STATUSES)
    const completed =
      status === 'done' ? qty : status === 'queued' ? 0 : Math.round(qty * between(0.12, 0.88))
    const day = Math.round(between(-3, 12))
    const due = new Date(Date.UTC(2026, 9, 12 + day))
    return {
      id: `WO-${(48210 + i * 7).toString()}`,
      sku: product.sku,
      product: product.name,
      lineId: product.line,
      qty,
      completed,
      status,
      priority: pick<WorkOrder['priority']>(['critical', 'high', 'high', 'medium', 'medium', 'medium', 'low']),
      dueDate: due.toISOString().slice(0, 10),
      startedAt: status === 'queued' ? '—' : `2026-10-${String(Math.max(1, 12 - Math.round(between(0, 9)))).padStart(2, '0')}`,
      owner: pick(OWNERS),
      yieldRate: Number(between(92.4, 99.6).toFixed(1)),
      notes: pick([
        'Customer priority — expedite',
        'Requires extra AOI sampling',
        'Awaiting resin lot release',
        'Standard run',
        'Tooling changeover at midpoint',
        'Packaging artwork revision C',
      ]),
    }
  })
}

/* ---------------------------------------------------------------- alerts -- */
const ALERT_SEEDS: Array<Pick<Alert, 'severity' | 'title' | 'detail' | 'source'>> = [
  { severity: 'critical', title: 'Torque Cell B2 spindle stall', detail: 'Spindle torque exceeded 42 Nm for 90s — line halted automatically.', source: 'LN-02 · M-202' },
  { severity: 'critical', title: 'Injection Press hydraulic pressure drop', detail: 'Pressure fell 18% below setpoint during shot #4412.', source: 'LN-04 · M-401' },
  { severity: 'warning', title: 'Reflow Oven zone 3 drift', detail: 'Zone 3 holding +7.4°C above profile. Verify thermocouple TC-3.', source: 'LN-01 · M-103' },
  { severity: 'warning', title: 'Solder paste viscosity trending low', detail: 'Predictive model flags a 12% deviation within the next 6 hours.', source: 'LN-01 · M-101' },
  { severity: 'warning', title: 'CNC Mill X2 vibration rising', detail: 'RMS vibration up 24% week-over-week. Bearing inspection advised.', source: 'LN-06 · M-602' },
  { severity: 'info', title: 'Changeover sequence started', detail: 'HS-40L → HS-40 tooling swap on stations 1-4.', source: 'LN-02' },
  { severity: 'info', title: 'Shift B handover confirmed', detail: 'All 6 lines signed over with no open safety items.', source: 'Plant' },
  { severity: 'success', title: 'First-pass yield record', detail: 'LN-05 achieved 99.4% FPY across the 06:00–14:00 window.', source: 'LN-05' },
  { severity: 'warning', title: 'Resin lot RM-8841 expiry window', detail: 'Lot expires in 3 days with 42% remaining — schedule consumption.', source: 'Warehouse A' },
  { severity: 'success', title: 'Preventive maintenance closed', detail: 'PM-3311 completed 4h ahead of plan on LN-03 mount heads.', source: 'LN-03 · M-303' },
]

function buildAlerts(now: number): Alert[] {
  return ALERT_SEEDS.map((a, i) => ({
    ...a,
    id: `AL-${900 + i}`,
    timestamp: now - Math.round(between(1, 340)) * 60_000,
    acknowledged: i > 5,
  }))
}

/* ------------------------------------------------------------- inventory -- */
const INV_SEEDS: Array<[string, string, string, string, string, number, number]> = [
  ['RM-1102', 'FR4 Substrate 1.6mm', 'Substrate', 'Rack A-01', 'PT Nusantara Laminate', 18400, 6000],
  ['RM-1188', 'SAC305 Solder Paste', 'Consumable', 'Cold Store C-2', 'Indium Corp', 142, 160],
  ['RM-2210', 'Haptic Actuator HA-9', 'Component', 'Rack B-14', 'Samsung EM', 8600, 2000],
  ['RM-2288', 'MCU Cortex-X4 Chipset', 'Component', 'ESD Vault D-1', 'NXP Semicon', 640, 900],
  ['RM-3301', 'ABS Resin FR-White', 'Polymer', 'Silo 3', 'Chandra Asri', 18400, 5000],
  ['RM-3302', 'PC/ABS Blend Black', 'Polymer', 'Silo 4', 'Chandra Asri', 4200, 5000],
  ['RM-4410', 'Retail Carton RP-77', 'Packaging', 'Rack E-08', 'PT Karya Print', 62000, 20000],
  ['RM-4415', 'Tamper Seal Label', 'Packaging', 'Rack E-11', 'Avery Dennison', 12000, 15000],
  ['RM-5501', 'Alloy Billet 6061', 'Metal', 'Yard F-1', 'Krakatau Steel', 8600, 3000],
  ['RM-5502', 'Carbide End Mill 6mm', 'Tooling', 'Tool Crib G-2', 'Sandvik Coromant', 38, 30],
  ['RM-6610', 'Anti-Static Trays', 'Consumable', 'Rack D-04', 'PT Plastik Jaya', 5400, 1500],
  ['RM-6690', 'Thermal Interface Gel', 'Consumable', 'Cold Store C-4', 'Henkel', 88, 60],
  ['RM-7712', 'M12 Stainless Fastener', 'Hardware', 'Rack H-02', 'PT Baut Sejahtera', 42000, 12000],
  ['RM-7780', 'Conformal Coating', 'Consumable', 'Cold Store C-1', 'Electrolube', 64, 80],
]

function buildInventory(): InventoryItem[] {
  return INV_SEEDS.map(([sku, name, category, location, supplier, stock, min]) => {
    const max = Math.round(min * between(3.2, 5.5))
    const ratio = stock / min
    const status: InventoryItem['status'] =
      ratio < 0.75 ? 'critical' : ratio < 1.15 ? 'low' : stock > max * 0.94 ? 'excess' : 'ok'
    return {
      sku,
      name,
      category,
      stock,
      min,
      max,
      unit: 'pcs',
      location,
      supplier,
      leadTimeDays: Math.round(between(3, 42)),
      consumedToday: Math.round(between(120, 2400)),
      status,
    }
  })
}

/* ----------------------------------------------------------- maintenance -- */
const TECHS = ['I. Firmansyah', 'Y. Halim', 'T. Rahman', 'N. Oktaviani', 'E. Saputra', 'W. Anggara']

function buildMaintenance(machines: Machine[]): MaintenanceTask[] {
  const kinds: MaintenanceTask['kind'][] = ['preventive', 'preventive', 'predictive', 'corrective', 'predictive']
  return Array.from({ length: 14 }, (_, i) => {
    const m = machines[(i * 5 + 3) % machines.length]
    const kind: MaintenanceTask['kind'] = i < 4 ? 'predictive' : pick(kinds)
    const dayOffset = Math.round(between(-2, 13))
    const due = new Date(Date.UTC(2026, 9, 12 + dayOffset))
    return {
      id: `PM-${3300 + i * 11}`,
      asset: m.name,
      machineCode: m.code,
      kind,
      status: dayOffset < 0 ? 'done' : dayOffset < 2 ? pick<TaskStatus>(['in-progress', 'scheduled', 'awaiting-parts']) : 'scheduled',
      priority: pick<MaintenanceTask['priority']>(['critical', 'high', 'high', 'medium', 'medium', 'low']),
      assignee: pick(TECHS),
      due: due.toISOString().slice(0, 10),
      dayOffset,
      durationHours: Math.round(between(1, 9)),
      healthScore: Math.round(between(38, 96)),
      note: pick([
        'Replace bearing set + rebalance spindle',
        'Thermocouple calibration against master probe',
        'Hydraulic fluid flush and filter swap',
        'Belt tension check and alignment',
        'Firmware update to v4.2.1 with rollback plan',
        'Nozzle clean, paste height verification',
        'Vibration analysis baseline after service',
      ]),
    }
  })
}

/* --------------------------------------------------------------- series -- */
const OEE_LABELS = ['06:00', '07:00', '08:00', '09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00']

function buildOeeHistory(): OeePoint[] {
  return OEE_LABELS.map((label, i) => {
    const avail = clamp(88 + Math.sin(i / 2.4) * 7 + between(-3, 3), 60, 99)
    const perf = clamp(87 + Math.cos(i / 3.1) * 8 + between(-3, 3), 55, 99)
    const qual = clamp(96 + Math.sin(i / 4.2) * 2.6 + between(-1.4, 1.4), 80, 99.8)
    return {
      label,
      availability: Number(avail.toFixed(1)),
      performance: Number(perf.toFixed(1)),
      quality: Number(qual.toFixed(1)),
      oee: Number(((avail * perf * qual) / 10000).toFixed(1)),
      target: 85,
    }
  })
}

function buildOutputHistory(): OutputPoint[] {
  return OEE_LABELS.map((label) => {
    const target = Math.round(between(4200, 5200))
    return {
      label,
      target,
      actual: Math.round(target * between(0.72, 1.11)),
      scrap: Math.round(target * between(0.01, 0.05)),
    }
  })
}

function buildShifts(): Shift[] {
  return [
    { id: 'sh-1', name: 'Shift A', window: '06:00 — 14:00', supervisor: 'R. Hartono', headcount: 84, output: 41260, target: 44000, oee: 87.4, active: false },
    { id: 'sh-2', name: 'Shift B', window: '14:00 — 22:00', supervisor: 'M. Kusuma', headcount: 79, output: 33840, target: 42000, oee: 84.1, active: true },
    { id: 'sh-3', name: 'Shift C', window: '22:00 — 06:00', supervisor: 'W. Anggara', headcount: 46, output: 18420, target: 26000, oee: 76.8, active: false },
  ]
}

function buildOperators(): Operator[] {
  const names = [
    'Andi Saputra', 'Bella Kartika', 'Candra Wijaya', 'Dewi Anggraini', 'Eko Prasetyo', 'Fitri Handayani',
    'Gilang Ramadhan', 'Hana Pertiwi', 'Irfan Maulana', 'Joko Susilo', 'Kartika Sari', 'Lukman Hakim',
    'Maya Sinta', 'Nanda Pratama', 'Oktavia Rini', 'Putra Wibowo', 'Qori Amelia', 'Rangga Setiawan',
  ]
  const roles = ['Line Operator', 'QC Inspector', 'Technician', 'Material Handler', 'Team Lead']
  return names.map((name, i) => ({
    id: `op-${i + 1}`,
    name,
    role: pick(roles),
    lineId: LINE_SEEDS[i % LINE_SEEDS.length].id,
    shift: i % 3 === 0 ? 'Shift A' : i % 3 === 1 ? 'Shift B' : 'Shift C',
    efficiency: Number(between(78, 99).toFixed(1)),
    attendance: Number(between(88, 100).toFixed(1)),
    certifications: Math.round(between(2, 7)),
  }))
}

function buildDefects(): DefectReason[] {
  const raw: Array<[string, number, string]> = [
    ['Solder bridge', 148, 'Assembly'],
    ['Component offset', 112, 'Placement'],
    ['Flux residue', 76, 'Assembly'],
    ['Sink mark', 64, 'Molding'],
    ['Dimension out of spec', 58, 'Machining'],
    ['Laser code unreadable', 41, 'Marking'],
    ['Seal leak', 33, 'Packaging'],
    ['Label misalign', 22, 'Packaging'],
  ]
  return raw
    .sort((a, b) => b[1] - a[1])
    .map(([name, count, category]) => ({ name, count, category }))
}

function buildDowntime(): DowntimeReason[] {
  return [
    { reason: 'Unplanned machine fault', minutes: 214, category: 'unplanned' },
    { reason: 'Changeover / setup', minutes: 186, category: 'planned' },
    { reason: 'Material starvation', minutes: 142, category: 'unplanned' },
    { reason: 'Quality hold & rework', minutes: 96, category: 'unplanned' },
    { reason: 'Scheduled maintenance', minutes: 88, category: 'planned' },
    { reason: 'Operator break / shift handover', minutes: 62, category: 'planned' },
    { reason: 'Tooling replacement', minutes: 47, category: 'planned' },
  ]
}

function buildSpc(): SpcSample[] {
  const mean = 12.4
  const values = Array.from({ length: 34 }, () => mean + between(-0.9, 0.9))
  values[17] = mean + 2.6
  values[27] = mean - 2.4
  return values.map((value, index) => ({
    index: index + 1,
    value: Number(value.toFixed(2)),
    mean,
    ucl: mean + 1.7,
    lcl: mean - 1.7,
  }))
}

export function createInitialState(now = Date.now()): PlantState {
  const machines = buildMachines()
  return {
    tick: 0,
    running: true,
    speed: 1,
    lines: buildLines(machines),
    machines,
    workOrders: buildWorkOrders(),
    alerts: buildAlerts(now),
    inventory: buildInventory(),
    maintenance: buildMaintenance(machines),
    defects: buildDefects(),
    downtime: buildDowntime(),
    oeeHistory: buildOeeHistory(),
    outputHistory: buildOutputHistory(),
    shifts: buildShifts(),
    operators: buildOperators(),
    spc: buildSpc(),
    toasts: [],
    uptimeSeconds: 412_320,
  }
}

export const LINE_LOOKUP = LINE_SEEDS
