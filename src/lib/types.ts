/* ------------------------------------------------------------------------- */
/* Domain model for the Production Management System                         */
/* ------------------------------------------------------------------------- */

export type MachineStatus = 'running' | 'idle' | 'setup' | 'maintenance' | 'down'
export type LineStatus = 'optimal' | 'nominal' | 'attention' | 'critical' | 'offline'
export type Priority = 'critical' | 'high' | 'medium' | 'low'
export type OrderStatus = 'queued' | 'running' | 'blocked' | 'quality' | 'done'
export type Severity = 'critical' | 'warning' | 'info' | 'success'
export type TaskKind = 'preventive' | 'corrective' | 'predictive'
export type TaskStatus = 'scheduled' | 'in-progress' | 'awaiting-parts' | 'done'

export interface Telemetry {
  temp: number
  vibration: number
  rpm: number
  pressure: number
  current: number
  tempSeries: number[]
  vibSeries: number[]
  rpmSeries: number[]
}

export interface Machine {
  id: string
  code: string
  name: string
  lineId: string
  station: number
  status: MachineStatus
  health: number
  oee: number
  outputToday: number
  targetToday: number
  cycleTime: number
  scrapRate: number
  uptimeHours: number
  lastService: string
  nextService: string
  firmware: string
  telemetry: Telemetry
  sinceMin: number
}

export interface Line {
  id: string
  code: string
  name: string
  leader: string
  product: string
  shift: string
  status: LineStatus
  target: number
  output: number
  oee: number
  scrap: number
  throughput: number
  efficiencySeries: number[]
  operators: number
  energyKwh: number
}

export interface WorkOrder {
  id: string
  sku: string
  product: string
  lineId: string
  qty: number
  completed: number
  status: OrderStatus
  priority: Priority
  dueDate: string
  startedAt: string
  owner: string
  yieldRate: number
  notes: string
}

export interface Alert {
  id: string
  severity: Severity
  title: string
  detail: string
  source: string
  timestamp: number
  acknowledged: boolean
}

export interface InventoryItem {
  sku: string
  name: string
  category: string
  stock: number
  min: number
  max: number
  unit: string
  location: string
  supplier: string
  leadTimeDays: number
  consumedToday: number
  status: 'ok' | 'low' | 'critical' | 'excess'
}

export interface MaintenanceTask {
  id: string
  asset: string
  machineCode: string
  kind: TaskKind
  status: TaskStatus
  priority: Priority
  assignee: string
  due: string
  dayOffset: number
  durationHours: number
  healthScore: number
  note: string
}

export interface DefectReason {
  name: string
  count: number
  category: string
}

export interface DowntimeReason {
  reason: string
  minutes: number
  category: 'planned' | 'unplanned'
}

export interface OeePoint {
  label: string
  oee: number
  availability: number
  performance: number
  quality: number
  target: number
}

export interface OutputPoint {
  label: string
  actual: number
  target: number
  scrap: number
}

export interface Shift {
  id: string
  name: string
  window: string
  supervisor: string
  headcount: number
  output: number
  target: number
  oee: number
  active: boolean
}

export interface Operator {
  id: string
  name: string
  role: string
  lineId: string
  shift: string
  efficiency: number
  attendance: number
  certifications: number
}

export interface Toast {
  id: string
  title: string
  detail: string
  tone: Severity
  createdAt: number
}

export interface SpcSample {
  index: number
  value: number
  mean: number
  ucl: number
  lcl: number
}

export interface PlantState {
  tick: number
  running: boolean
  speed: number
  lines: Line[]
  machines: Machine[]
  workOrders: WorkOrder[]
  alerts: Alert[]
  inventory: InventoryItem[]
  maintenance: MaintenanceTask[]
  defects: DefectReason[]
  downtime: DowntimeReason[]
  oeeHistory: OeePoint[]
  outputHistory: OutputPoint[]
  shifts: Shift[]
  operators: Operator[]
  spc: SpcSample[]
  toasts: Toast[]
  uptimeSeconds: number
}
