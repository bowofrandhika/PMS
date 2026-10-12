import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  type Dispatch,
  type ReactNode,
} from 'react'
import type {
  Alert,
  Line,
  LineStatus,
  Machine,
  MachineStatus,
  PlantState,
  Severity,
  Toast,
  WorkOrder,
} from '../lib/types'
import { createInitialState } from '../lib/data'
import { clamp } from '../lib/utils'

/* ------------------------------------------------------------------ action -- */
export type Action =
  | { type: 'TICK'; now: number }
  | { type: 'SET_RUNNING'; running: boolean }
  | { type: 'SET_SPEED'; speed: number }
  | { type: 'ACK_ALERT'; id: string }
  | { type: 'ACK_ALL' }
  | { type: 'PUSH_TOAST'; toast: Omit<Toast, 'createdAt'> }
  | { type: 'DISMISS_TOAST'; id: string }
  | { type: 'SET_MACHINE_STATUS'; id: string; status: MachineStatus }
  | { type: 'CREATE_ORDER'; order: WorkOrder }
  | { type: 'ADVANCE_ORDER'; id: string; amount: number }

const rand = (a: number, b: number) => a + Math.random() * (b - a)

const STATUS_WEIGHTS: Array<[MachineStatus, number]> = [
  ['running', 0.62],
  ['idle', 0.16],
  ['setup', 0.1],
  ['maintenance', 0.07],
  ['down', 0.05],
]

function rollStatus(): MachineStatus {
  const r = Math.random()
  let acc = 0
  for (const [status, weight] of STATUS_WEIGHTS) {
    acc += weight
    if (r <= acc) return status
  }
  return 'running'
}

const ALERT_POOL: Array<Omit<Alert, 'id' | 'timestamp' | 'acknowledged'>> = [
  { severity: 'critical', title: 'Emergency stop engaged', detail: 'Light curtain tripped at station 2 — operator reset required.', source: 'Floor' },
  { severity: 'warning', title: 'Cycle time drift detected', detail: 'Cycle time trending 8% above the recipe baseline over 30 min.', source: 'Analytics' },
  { severity: 'warning', title: 'Scrap rate threshold breached', detail: 'Scrap crossed the 3.5% control limit for the current hour.', source: 'Quality' },
  { severity: 'info', title: 'Predictive alert: tool wear', detail: 'Tool wear model predicts end-of-life within 240 units.', source: 'Predictive AI' },
  { severity: 'success', title: 'KPI milestone reached', detail: 'Consecutive hours above 85% OEE record extended.', source: 'Analytics' },
  { severity: 'info', title: 'Operator scan verified', detail: 'Material lot scanned and matched to work order routing.', source: 'MES' },
  { severity: 'warning', title: 'Energy spike on line', detail: 'Compressed air draw up 14% against the 7-day baseline.', source: 'Energy' },
  { severity: 'info', title: 'Auto-backup complete', detail: 'Machine recipes and parameters archived to the plant vault.', source: 'System' },
]

function pushToast(state: PlantState, toast: Omit<Toast, 'createdAt'>, now: number): Toast[] {
  return [{ ...toast, createdAt: now }, ...state.toasts].slice(0, 4)
}

function deriveLineStatus(machines: Machine[], fallback: LineStatus): LineStatus {
  const down = machines.filter((m) => m.status === 'down').length
  const maint = machines.filter((m) => m.status === 'maintenance').length
  const running = machines.filter((m) => m.status === 'running').length / machines.length
  if (down >= 2 || running < 0.4) return 'critical'
  if (down >= 1 || maint >= 2) return 'attention'
  if (running > 0.7) return 'optimal'
  if (running > 0.5) return 'nominal'
  return fallback === 'offline' ? 'offline' : 'attention'
}

/* ----------------------------------------------------------------- reducer -- */
function simulate(state: PlantState, now: number): PlantState {
  const downEvents: Array<{ title: string; detail: string; source: string }> = []

  const machines: Machine[] = state.machines.map((m) => {
    let status = m.status
    // ~1.1% chance per tick of a status change keeps the floor visibly alive.
    if (Math.random() < 0.011) {
      const next = rollStatus()
      if (next !== status) {
        if (next === 'down') {
          downEvents.push({
            title: `${m.name} stopped producing`,
            detail: `Unexpected stop registered on ${m.code}. Root-cause capture started automatically.`,
            source: m.code,
          })
        }
        status = next
      }
    }

    const running = status === 'running'
    const t = m.telemetry
    const tempTarget = t.tempSeries.reduce((s, v) => s + v, 0) / t.tempSeries.length
    const temp = clamp(
      t.temp + (tempTarget - t.temp) * 0.05 + rand(-0.35, 0.35) + (running ? 0.06 : -0.22),
      15,
      320,
    )
    const vibration = Math.max(0.05, t.vibration + rand(-0.055, 0.055) + (running ? 0.006 : -0.01))
    const rpm = Math.max(
      0,
      t.rpm + rand(-26, 26) + (running ? (Math.random() - 0.45) * 30 : -30),
    )

    const tempSeries = [...t.tempSeries.slice(1), temp]
    const vibSeries = [...t.vibSeries.slice(1), vibration]
    const rpmSeries = [...t.rpmSeries.slice(1), Math.round(rpm)]

    const output = running
      ? Math.min(m.targetToday, m.outputToday + Math.round(rand(0.4, 3.2)))
      : m.outputToday

    const health = clamp(m.health + rand(-0.06, 0.045) + (status === 'down' ? -0.05 : 0), 5, 100)

    return {
      ...m,
      status,
      health,
      outputToday: output,
      cycleTime: running
        ? Number(Math.max(1.5, m.cycleTime + rand(-0.055, 0.055)).toFixed(2))
        : m.cycleTime,
      scrapRate: Number(clamp(m.scrapRate + rand(-0.02, 0.02), 0.1, 9).toFixed(2)),
      oee: Number(clamp(m.oee + rand(-0.09, 0.09), 40, 99).toFixed(1)),
      telemetry: { ...t, temp, vibration, rpm, rpmSeries, tempSeries, vibSeries },
      sinceMin: status === m.status ? m.sinceMin + 1 / 60 : 0,
    }
  })

  const lines: Line[] = state.lines.map((line) => {
    const own = machines.filter((m) => m.lineId === line.id)
    const output = own.reduce((s, m) => s + m.outputToday, 0)
    const target = own.reduce((s, m) => s + m.targetToday, 0)
    const ratio = target ? output / target : 0
    const oee = Number(clamp(line.oee * 0.99 + (ratio * 100 * 0.01) + rand(-0.08, 0.08), 45, 99).toFixed(1))
    const efficiencySeries = [...line.efficiencySeries.slice(1), oee]
    return {
      ...line,
      output,
      target,
      oee,
      efficiencySeries,
      throughput: Math.max(0, Math.round(line.throughput + rand(-14, 14))),
      scrap: Number(clamp(line.scrap + rand(-0.03, 0.03), 0.1, 8).toFixed(2)),
      energyKwh: Math.max(40, Math.round(line.energyKwh + rand(-6, 6))),
      status: deriveLineStatus(own, line.status),
    }
  })

  // Time-series rollups: refresh the most recent bucket so charts drift live.
  const oeeHistory =
    state.tick % 12 === 0
      ? state.oeeHistory.map((p, i, arr) =>
          i === arr.length - 1
            ? {
                ...p,
                availability: Number(clamp(p.availability + rand(-0.5, 0.5), 55, 99.5).toFixed(1)),
                performance: Number(clamp(p.performance + rand(-0.6, 0.6), 50, 99.5).toFixed(1)),
                quality: Number(clamp(p.quality + rand(-0.25, 0.25), 80, 99.9).toFixed(1)),
                oee: Number(clamp(p.oee + rand(-0.7, 0.7), 45, 99).toFixed(1)),
              }
            : p,
        )
      : state.oeeHistory

  const outputHistory =
    state.tick % 9 === 0
      ? state.outputHistory.map((p, i, arr) =>
          i === arr.length - 1
            ? { ...p, actual: Math.max(0, p.actual + Math.round(rand(-40, 60))), scrap: Math.max(0, p.scrap + Math.round(rand(-4, 4))) }
            : p,
        )
      : state.outputHistory

  const spcLast = state.spc[state.spc.length - 1]
  const spc =
    state.tick % 7 === 0
      ? [
          ...state.spc.slice(1),
          {
            index: (spcLast?.index ?? 0) + 1,
            value: Number((12.4 + rand(-0.95, 0.95)).toFixed(2)),
            mean: 12.4,
            ucl: 14.1,
            lcl: 10.7,
          },
        ]
      : state.spc

  const workOrders =
    state.tick % 4 === 0
      ? state.workOrders.map((wo) => {
          if (wo.status !== 'running') return wo
          const next = Math.min(wo.qty, wo.completed + Math.round(rand(0.5, 4)))
          if (next >= wo.qty) {
            return { ...wo, completed: wo.qty, status: 'done' as WorkOrder['status'] }
          }
          return {
            ...wo,
            completed: next,
            yieldRate: Number(clamp(wo.yieldRate + rand(-0.04, 0.04), 88, 99.9).toFixed(1)),
          }
        })
      : state.workOrders

  let alerts = state.alerts
  if (downEvents.length) {
    const created = downEvents.slice(0, 2).map((e, i) => ({
      id: `AL-${now}-${i}`,
      severity: 'critical' as Severity,
      acknowledged: false,
      timestamp: now,
      ...e,
    }))
    alerts = [...created, ...alerts].slice(0, 60)
  } else if (Math.random() < 0.014) {
    const seed = ALERT_POOL[Math.floor(Math.random() * ALERT_POOL.length)]
    alerts = [
      { ...seed, id: `AL-${now}-r`, acknowledged: false, timestamp: now },
      ...alerts,
    ].slice(0, 60)
  }

  const expired = state.toasts.filter((t) => now - t.createdAt < 9_000)

  return {
    ...state,
    tick: state.tick + 1,
    uptimeSeconds: state.uptimeSeconds + Math.max(1, Math.round(state.speed)),
    machines,
    lines,
    oeeHistory,
    outputHistory,
    spc,
    workOrders,
    alerts,
    toasts: expired,
  }
}

function reducer(state: PlantState, action: Action): PlantState {
  switch (action.type) {
    case 'TICK':
      return state.running ? simulate(state, action.now) : { ...state, tick: state.tick + 1 }
    case 'SET_RUNNING':
      return {
        ...state,
        running: action.running,
        toasts: pushToast(
          state,
          {
            id: `t-${Date.now()}`,
            title: action.running ? 'Live feed resumed' : 'Live feed paused',
            detail: action.running
              ? 'Telemetry streaming from all 24 stations.'
              : 'Charts are frozen at the last captured sample.',
            tone: action.running ? 'success' : 'warning',
          },
          Date.now(),
        ),
      }
    case 'SET_SPEED':
      return { ...state, speed: action.speed }
    case 'ACK_ALERT':
      return {
        ...state,
        alerts: state.alerts.map((a) => (a.id === action.id ? { ...a, acknowledged: true } : a)),
      }
    case 'ACK_ALL':
      return { ...state, alerts: state.alerts.map((a) => ({ ...a, acknowledged: true })) }
    case 'PUSH_TOAST':
      return { ...state, toasts: pushToast(state, action.toast, Date.now()) }
    case 'DISMISS_TOAST':
      return { ...state, toasts: state.toasts.filter((t) => t.id !== action.id) }
    case 'SET_MACHINE_STATUS':
      return {
        ...state,
        machines: state.machines.map((m) =>
          m.id === action.id
            ? { ...m, status: action.status, sinceMin: 0 }
            : m,
        ),
        toasts: pushToast(
          state,
          {
            id: `t-${Date.now()}`,
            title: `Station set to ${action.status}`,
            detail: 'Status override recorded in the audit trail.',
            tone: action.status === 'down' ? 'critical' : 'info',
          },
          Date.now(),
        ),
      }
    case 'CREATE_ORDER':
      return {
        ...state,
        workOrders: [action.order, ...state.workOrders],
        toasts: pushToast(
          state,
          {
            id: `t-${Date.now()}`,
            title: `Work order ${action.order.id} released`,
            detail: `${action.order.product} · ${action.order.qty.toLocaleString()} units routed.`,
            tone: 'success',
          },
          Date.now(),
        ),
      }
    case 'ADVANCE_ORDER':
      return {
        ...state,
        workOrders: state.workOrders.map((wo) => {
          if (wo.id !== action.id) return wo
          const completed = Math.min(wo.qty, wo.completed + action.amount)
          return {
            ...wo,
            completed,
            status: completed >= wo.qty ? 'done' : wo.status === 'queued' ? 'running' : wo.status,
          }
        }),
      }
    default:
      return state
  }
}

/* ----------------------------------------------------------------- context -- */
interface PlantContextValue {
  state: PlantState
  dispatch: Dispatch<Action>
}

const PlantContext = createContext<PlantContextValue | null>(null)

export function PlantProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, () => createInitialState())

  useEffect(() => {
    if (!state.running) return
    const interval = window.setInterval(() => {
      dispatch({ type: 'TICK', now: Date.now() })
    }, Math.max(320, 1000 / state.speed))
    return () => window.clearInterval(interval)
  }, [state.running, state.speed])

  const value = useMemo(() => ({ state, dispatch }), [state])
  return <PlantContext.Provider value={value}>{children}</PlantContext.Provider>
}

export function usePlant() {
  const ctx = useContext(PlantContext)
  if (!ctx) throw new Error('usePlant must be used inside <PlantProvider>')
  return ctx
}

/* --------------------------------------------------------------- selectors -- */
export interface Kpis {
  oee: number
  availability: number
  performance: number
  quality: number
  output: number
  target: number
  attainment: number
  scrapRate: number
  firstPassYield: number
  throughput: number
  energy: number
  openAlerts: number
  criticalAlerts: number
  machinesRunning: number
  machinesTotal: number
  machinesDown: number
  avgHealth: number
  wip: number
  dueToday: number
  maintenanceDue: number
  lastOee: number
  oeeDelta: number
  outputDelta: number
}

export function useKpis(): Kpis {
  const { state } = usePlant()
  return useMemo(() => {
    const { machines, lines, alerts, workOrders, maintenance, oeeHistory, outputHistory } = state

    const availability = machines.length
      ? (machines.filter((m) => m.status === 'running' || m.status === 'setup').length / machines.length) * 100
      : 0
    const performance = machines.length
      ? (machines.reduce((s, m) => s + clamp((m.targetToday ? m.outputToday / m.targetToday : 0) * 100, 0, 100), 0) /
          machines.length)
      : 0
    const quality = machines.length
      ? 100 - machines.reduce((s, m) => s + m.scrapRate, 0) / machines.length
      : 0
    const oee = (availability * performance * quality) / 10_000

    const output = lines.reduce((s, l) => s + l.output, 0)
    const target = lines.reduce((s, l) => s + l.target, 0)
    const throughput = lines.reduce((s, l) => s + l.throughput, 0)
    const energy = lines.reduce((s, l) => s + l.energyKwh, 0)
    const lastOee = oeeHistory[oeeHistory.length - 1]?.oee ?? oee
    const prevOee = oeeHistory[oeeHistory.length - 2]?.oee ?? lastOee
    const lastOut = outputHistory[outputHistory.length - 1]
    const prevOut = outputHistory[outputHistory.length - 2]

    return {
      oee: Number(oee.toFixed(1)),
      availability: Number(availability.toFixed(1)),
      performance: Number(performance.toFixed(1)),
      quality: Number(quality.toFixed(1)),
      output,
      target,
      attainment: target ? Number(((output / target) * 100).toFixed(1)) : 0,
      scrapRate: Number((100 - quality).toFixed(2)),
      firstPassYield: Number(clamp(quality - 0.4, 0, 100).toFixed(1)),
      throughput,
      energy,
      openAlerts: alerts.filter((a) => !a.acknowledged).length,
      criticalAlerts: alerts.filter((a) => !a.acknowledged && a.severity === 'critical').length,
      machinesRunning: machines.filter((m) => m.status === 'running').length,
      machinesTotal: machines.length,
      machinesDown: machines.filter((m) => m.status === 'down').length,
      avgHealth: Number((machines.reduce((s, m) => s + m.health, 0) / (machines.length || 1)).toFixed(1)),
      wip: workOrders.filter((wo) => wo.status === 'running').reduce((s, wo) => s + (wo.qty - wo.completed), 0),
      dueToday: workOrders.filter((wo) => wo.status !== 'done' && wo.dueDate <= '2026-10-12').length,
      maintenanceDue: maintenance.filter((t) => t.status !== 'done' && t.dayOffset <= 2).length,
      lastOee,
      oeeDelta: Number((lastOee - prevOee).toFixed(1)),
      outputDelta: lastOut && prevOut ? lastOut.actual - prevOut.actual : 0,
    }
  }, [state])
}

export function useLineById(id: string | null) {
  const { state } = usePlant()
  return useMemo(() => state.lines.find((l) => l.id === id) ?? null, [state.lines, id])
}
