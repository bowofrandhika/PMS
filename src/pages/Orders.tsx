import { useMemo, useState } from 'react'
import {
  BarChart4,
  CalendarClock,
  CheckCircle2,
  ClipboardList,
  Filter,
  Gauge,
  Layers,
  ListFilter,
  Package,
  Plus,
  Search,
  Sparkles,
  Timer,
  TrendingUp,
  Truck,
} from 'lucide-react'
import { Chip, Meter, Modal, Panel, PanelHeader, SectionTitle, Stat } from '../components/ui'
import { HBars, Sparkline } from '../components/charts'
import { usePlant } from '../store/plant'
import { cn, duration, num, ORDER_META, PRIORITY_META } from '../lib/utils'
import type { OrderStatus, Priority, WorkOrder } from '../lib/types'

const STATUS_FILTERS: Array<{ value: OrderStatus | 'all'; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'running', label: 'In progress' },
  { value: 'queued', label: 'Queued' },
  { value: 'quality', label: 'Quality hold' },
  { value: 'blocked', label: 'Blocked' },
  { value: 'done', label: 'Complete' },
]

const DAYS = Array.from({ length: 14 }, (_, i) => {
  const d = new Date(Date.UTC(2026, 9, 6 + i))
  return { iso: d.toISOString().slice(0, 10), label: d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) }
})

export default function Orders() {
  const { state, dispatch } = usePlant()
  const [status, setStatus] = useState<OrderStatus | 'all'>('all')
  const [lineFilter, setLineFilter] = useState<string>('all')
  const [query, setQuery] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [form, setForm] = useState({
    sku: 'NX-220',
    product: 'Control Module',
    lineId: state.lines[0]?.id ?? '',
    qty: 2400,
    priority: 'medium' as Priority,
    dueDate: '2026-10-22',
    owner: 'R. Hartono',
    notes: 'Standard run',
  })

  const orders = useMemo(() => {
    return state.workOrders
      .filter((wo) => (status === 'all' ? true : wo.status === status))
      .filter((wo) => (lineFilter === 'all' ? true : wo.lineId === lineFilter))
      .filter((wo) =>
        query
          ? `${wo.id} ${wo.sku} ${wo.product} ${wo.owner}`.toLowerCase().includes(query.toLowerCase())
          : true,
      )
      .sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1))
  }, [state.workOrders, status, lineFilter, query])

  const kpis = useMemo(() => {
    const all = state.workOrders
    const open = all.filter((wo) => wo.status !== 'done')
    return {
      total: all.length,
      running: all.filter((wo) => wo.status === 'running').length,
      blocked: all.filter((wo) => wo.status === 'blocked').length,
      quality: all.filter((wo) => wo.status === 'quality').length,
      units: open.reduce((s, wo) => s + (wo.qty - wo.completed), 0),
      completedUnits: all.reduce((s, wo) => s + wo.completed, 0),
      onTime: 94.2,
      avgYield: all.reduce((s, wo) => s + wo.yieldRate, 0) / (all.length || 1),
    }
  }, [state.workOrders])

  const loadByLine = useMemo(
    () =>
      state.lines.map((l) => ({
        label: l.code,
        value: state.workOrders.filter((wo) => wo.lineId === l.id && wo.status !== 'done').reduce((s, wo) => s + wo.qty - wo.completed, 0),
        tone: l.status === 'critical' ? 'rose' : l.status === 'attention' ? 'amber' : 'cyan',
        hint: 'units',
      })),
    [state.lines, state.workOrders],
  )

  const schedule = useMemo(
    () =>
      orders
        .filter((wo) => wo.status !== 'done')
        .slice(0, 9)
        .map((wo) => {
          const startIdx = Math.max(0, DAYS.findIndex((d) => d.iso >= wo.startedAt))
          const start = wo.startedAt === '—' ? 2 : startIdx === -1 ? 0 : startIdx
          const endIdx = DAYS.findIndex((d) => d.iso >= wo.dueDate)
          const span = Math.max(2, (endIdx === -1 ? DAYS.length : endIdx) - start)
          return { wo, start, span }
        }),
    [orders],
  )

  const createOrder = () => {
    const order: WorkOrder = {
      id: `WO-${Math.floor(50000 + Math.random() * 9999)}`,
      sku: form.sku,
      product: form.product,
      lineId: form.lineId,
      qty: Number(form.qty),
      completed: 0,
      status: 'queued',
      priority: form.priority,
      dueDate: form.dueDate,
      startedAt: '—',
      owner: form.owner,
      yieldRate: 98.5,
      notes: form.notes,
    }
    dispatch({ type: 'CREATE_ORDER', order })
    setCreateOpen(false)
  }

  return (
    <div className="space-y-5">
      <SectionTitle
        eyebrow="Production Control"
        title="Work Order Management"
        description="Release, sequence and track every manufacturing order — routed to lines, linked to SKUs and synchronised with the shop-floor execution layer."
        actions={
          <>
            <Chip tone="cyan" icon={ClipboardList}>
              {kpis.total} orders
            </Chip>
            <button type="button" className="btn btn-primary" onClick={() => setCreateOpen(true)}>
              <Plus size={14} /> Release order
            </button>
          </>
        }
      />

      <div className="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="Orders In Flight"
          value={kpis.running}
          unit={`of ${kpis.total}`}
          icon={Layers}
          tone="cyan"
          progress={(kpis.running / Math.max(1, kpis.total)) * 100}
          hint={`${kpis.blocked} blocked · ${kpis.quality} on quality hold`}
        />
        <Stat
          label="Open Volume"
          value={num(kpis.units)}
          unit="units"
          icon={Package}
          tone="violet"
          progress={(kpis.units / 60000) * 100}
          hint={`${num(kpis.completedUnits)} units completed to date`}
        />
        <Stat
          label="On-Time Delivery"
          value={kpis.onTime.toFixed(1)}
          unit="%"
          delta={1.8}
          icon={Truck}
          tone="emerald"
          progress={kpis.onTime}
          hint="Rolling 30-day schedule adherence"
        />
        <Stat
          label="Average Yield"
          value={kpis.avgYield.toFixed(1)}
          unit="%"
          delta={0.3}
          icon={CheckCircle2}
          tone="blue"
          progress={kpis.avgYield}
          hint="Weighted across released orders"
        />
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Panel>
          <PanelHeader
            title="Order register"
            subtitle="Live shop-floor execution state, refreshed every tick"
            icon={ListFilter}
            actions={<Chip tone="haze">{orders.length} shown</Chip>}
          />

          <div className="mb-3.5 flex flex-wrap items-center gap-2">
            <div className="relative min-w-[200px] flex-1">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-haze-500" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search order, SKU, owner…"
                className="field !pl-8"
              />
            </div>
            <div className="flex items-center gap-1.5 rounded-xl border border-white/10 bg-void-950/50 px-2 py-1.5">
              <Filter size={12} className="text-haze-500" />
              <select
                value={lineFilter}
                onChange={(e) => setLineFilter(e.target.value)}
                className="bg-transparent text-[11.5px] outline-none"
              >
                <option value="all">All lines</option>
                {state.lines.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.code} · {l.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="seg flex-wrap">
              {STATUS_FILTERS.map((f) => (
                <button
                  key={f.value}
                  type="button"
                  className="seg-item"
                  data-active={status === f.value}
                  onClick={() => setStatus(f.value)}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          <div className="max-h-[560px] overflow-auto rounded-xl border border-white/6">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Order</th>
                  <th>SKU / Product</th>
                  <th>Line</th>
                  <th>Progress</th>
                  <th>Status</th>
                  <th>Priority</th>
                  <th>Due</th>
                  <th>Owner</th>
                  <th>Yield</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {orders.map((wo) => {
                  const sm = ORDER_META[wo.status]
                  const pm = PRIORITY_META[wo.priority]
                  const progress = (wo.completed / wo.qty) * 100
                  const overdue = wo.dueDate < '2026-10-12' && wo.status !== 'done'
                  return (
                    <tr key={wo.id}>
                      <td className="mono text-cyan-300">{wo.id}</td>
                      <td>
                        <div className="flex flex-col">
                          <span className="text-haze-100">{wo.product}</span>
                          <span className="mono text-[10px] text-haze-500">{wo.sku}</span>
                        </div>
                      </td>
                      <td className="mono text-[11px] text-haze-300">{state.lines.find((l) => l.id === wo.lineId)?.code}</td>
                      <td>
                        <div className="w-[110px]">
                          <div className="mb-1 flex items-center justify-between text-[10px]">
                            <span className="mono text-haze-300">{num(wo.completed)}</span>
                            <span className="mono text-haze-500">{progress.toFixed(0)}%</span>
                          </div>
                          <Meter value={progress} tone={progress > 70 ? 'emerald' : progress > 35 ? 'cyan' : 'amber'} height={4} />
                        </div>
                      </td>
                      <td>
                        <span className={cn('chip', sm.bg, sm.ring, sm.text)}>
                          <span className="size-1.5 rounded-full bg-current" />
                          {sm.label}
                        </span>
                      </td>
                      <td>
                        <span className={cn('chip', pm.bg, pm.ring, pm.text)}>{pm.label}</span>
                      </td>
                      <td>
                        <span className={cn('mono text-[11px]', overdue ? 'text-rose-300' : 'text-haze-300')}>{wo.dueDate}</span>
                      </td>
                      <td className="text-[11px] text-haze-300">{wo.owner}</td>
                      <td className="mono text-[11px] text-emerald-300">{wo.yieldRate}%</td>
                      <td>
                        <button
                          type="button"
                          onClick={() => dispatch({ type: 'ADVANCE_ORDER', id: wo.id, amount: Math.round(wo.qty * 0.12) })}
                          className="btn btn-ghost !px-2 !py-1 text-[10.5px]"
                          title="Log production progress"
                        >
                          +12%
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Panel>

        <div className="space-y-5">
          <Panel>
            <PanelHeader
              title="Capacity load by line"
              subtitle="Remaining units queued against each line"
              icon={Gauge}
              accent="#a855f7"
            />
            <HBars items={loadByLine} />
            <div className="mt-3.5 grid grid-cols-2 gap-3 border-t border-white/8 pt-3">
              <div>
                <span className="label-cap text-haze-500">Avg lead time</span>
                <p className="mono mt-1 text-[15px] text-haze-100">{duration(86)}</p>
              </div>
              <div>
                <span className="label-cap text-haze-500">Schedule adherence</span>
                <p className="mono mt-1 text-[15px] text-emerald-300">{kpis.onTime}%</p>
              </div>
            </div>
          </Panel>

          <Panel>
            <PanelHeader
              title="14-day schedule"
              subtitle="Committed runway per order"
              icon={CalendarClock}
              accent="#60a5fa"
            />
            <div className="space-y-1.5">
              <div className="grid grid-cols-[86px_1fr] gap-2">
                <span />
                <div className="grid grid-cols-7 gap-1">
                  {DAYS.filter((_, i) => i % 2 === 0).map((d) => (
                    <span key={d.iso} className="mono text-[8.5px] text-haze-500">
                      {d.label.split(' ')[0]}
                    </span>
                  ))}
                </div>
              </div>
              {schedule.map(({ wo, start, span }) => {
                const pm = PRIORITY_META[wo.priority]
                return (
                  <div key={wo.id} className="grid grid-cols-[86px_1fr] items-center gap-2">
                    <span className="mono truncate text-[10px] text-haze-400">{wo.id}</span>
                    <div className="relative h-5 rounded-md border border-white/6 bg-white/2">
                      <div
                        className="absolute inset-y-[3px] rounded-[5px] transition-all duration-500"
                        style={{
                          left: `${(start / DAYS.length) * 100}%`,
                          width: `${(span / DAYS.length) * 100}%`,
                          background: `linear-gradient(90deg, ${pm.color}cc, ${pm.color}55)`,
                          boxShadow: `0 0 14px -2px ${pm.color}`,
                        }}
                      >
                        <span className="mono absolute inset-0 flex items-center justify-center text-[9px] text-void-950">
                          {wo.qty >= 1000 ? `${(wo.qty / 1000).toFixed(1)}k` : wo.qty}
                        </span>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
            <div className="mt-3 flex items-center gap-3 border-t border-white/8 pt-3 text-[10px] text-haze-500">
              <span className="flex items-center gap-1.5">
                <span className="size-2 rounded-sm bg-rose-400" /> critical
              </span>
              <span className="flex items-center gap-1.5">
                <span className="size-2 rounded-sm bg-orange-400" /> high
              </span>
              <span className="flex items-center gap-1.5">
                <span className="size-2 rounded-sm bg-cyan-400" /> medium
              </span>
              <span className="flex items-center gap-1.5">
                <span className="size-2 rounded-sm bg-haze-300" /> low
              </span>
            </div>
          </Panel>

          <Panel>
            <PanelHeader
              title="Throughput pulse"
              subtitle="Plant-wide units produced per hour bucket"
              icon={TrendingUp}
              accent="#34d399"
            />
            <div className="h-20">
              <Sparkline data={state.outputHistory.map((p) => p.actual)} tone="emerald" height={80} />
            </div>
            <div className="mt-2.5 flex items-center justify-between text-[10.5px]">
              <span className="text-haze-500">Target band</span>
              <span className="mono text-haze-300">
                {num(state.outputHistory[state.outputHistory.length - 1]?.target ?? 0)} u/h
              </span>
            </div>
          </Panel>
        </div>
      </div>

      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Release a new work order"
        subtitle="The order is queued to the selected line and pushed to the MES routing engine"
        icon={Sparkles}
        footer={
          <>
            <button type="button" className="btn" onClick={() => setCreateOpen(false)}>
              Cancel
            </button>
            <button type="button" className="btn btn-primary" onClick={createOrder}>
              <Plus size={13} /> Release to floor
            </button>
          </>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="space-y-1.5">
            <span className="label-cap text-haze-500">Product</span>
            <select
              className="field"
              value={form.sku}
              onChange={(e) => {
                const opt = PRODUCT_OPTIONS.find((p) => p.sku === e.target.value)
                setForm((f) => ({ ...f, sku: e.target.value, product: opt?.product ?? f.product, lineId: opt?.lineId ?? f.lineId }))
              }}
            >
              {PRODUCT_OPTIONS.map((p) => (
                <option key={p.sku} value={p.sku}>
                  {p.sku} — {p.product}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1.5">
            <span className="label-cap text-haze-500">Production line</span>
            <select className="field" value={form.lineId} onChange={(e) => setForm((f) => ({ ...f, lineId: e.target.value }))}>
              {state.lines.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.code} · {l.name}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1.5">
            <span className="label-cap text-haze-500">Quantity</span>
            <input
              type="number"
              className="field"
              value={form.qty}
              min={100}
              step={100}
              onChange={(e) => setForm((f) => ({ ...f, qty: Number(e.target.value) }))}
            />
          </label>
          <label className="space-y-1.5">
            <span className="label-cap text-haze-500">Priority</span>
            <select
              className="field"
              value={form.priority}
              onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value as Priority }))}
            >
              {(['critical', 'high', 'medium', 'low'] as Priority[]).map((p) => (
                <option key={p} value={p}>
                  {PRIORITY_META[p].label}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1.5">
            <span className="label-cap text-haze-500">Due date</span>
            <input type="date" className="field" value={form.dueDate} onChange={(e) => setForm((f) => ({ ...f, dueDate: e.target.value }))} />
          </label>
          <label className="space-y-1.5">
            <span className="label-cap text-haze-500">Owner</span>
            <select className="field" value={form.owner} onChange={(e) => setForm((f) => ({ ...f, owner: e.target.value }))}>
              {['R. Hartono', 'M. Kusuma', 'D. Prasetyo', 'S. Wijaya', 'A. Lestari', 'B. Nugroho'].map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1.5 sm:col-span-2">
            <span className="label-cap text-haze-500">Production notes</span>
            <textarea
              className="field min-h-[74px] resize-none"
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            />
          </label>
          <div className="rounded-xl border border-cyan-400/20 bg-cyan-500/6 p-3 sm:col-span-2">
            <p className="flex items-center gap-1.5 text-[11.5px] text-cyan-200">
              <BarChart4 size={13} /> Estimated run {duration(form.qty / 240)} · projected yield 98.2%
            </p>
            <p className="mt-1 flex items-center gap-1.5 text-[10.5px] text-haze-400">
              <Timer size={12} /> Material check: all bills of material are available in stock.
            </p>
          </div>
        </div>
      </Modal>
    </div>
  )
}

const PRODUCT_OPTIONS = [
  { sku: 'NX-220', product: 'Control Module', lineId: 'ln-01' },
  { sku: 'NX-220R', product: 'Control Module Rev2', lineId: 'ln-01' },
  { sku: 'HS-40', product: 'Haptic Sensor', lineId: 'ln-02' },
  { sku: 'HS-40L', product: 'Haptic Sensor Lite', lineId: 'ln-02' },
  { sku: 'LB-9', product: 'Logic Board', lineId: 'ln-03' },
  { sku: 'LB-9A', product: 'Logic Board Auto', lineId: 'ln-03' },
  { sku: 'PH-12', product: 'Polymer Housing', lineId: 'ln-04' },
  { sku: 'PH-12G', product: 'Polymer Housing Gloss', lineId: 'ln-04' },
  { sku: 'RP-77', product: 'Retail Pack', lineId: 'ln-05' },
  { sku: 'RP-77B', product: 'Retail Pack Bulk', lineId: 'ln-05' },
  { sku: 'AB-31', product: 'Alloy Bracket', lineId: 'ln-06' },
  { sku: 'AB-31S', product: 'Alloy Bracket Slim', lineId: 'ln-06' },
]
