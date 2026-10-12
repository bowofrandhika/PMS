import { useMemo } from 'react'
import {
  Activity,
  AlertTriangle,
  Boxes,
  CircleGauge,
  Clock4,
  Flame,
  Gauge as GaugeIcon,
  Layers,
  Package,
  Percent,
  Radio,
  Recycle,
  ShieldCheck,
  Timer,
  TrendingUp,
  Wrench,
  Zap,
} from 'lucide-react'
import { AreaLineChart, Donut, HBars, Heatmap, Sparkline } from '../components/charts'
import { Chip, Gauge, Meter, Panel, PanelHeader, SectionTitle, Stat, StatusDot } from '../components/ui'
import { useKpis, usePlant } from '../store/plant'
import {
  cn,
  duration,
  healthTone,
  LINE_META,
  oeeTone,
  SEVERITY_META,
  STATUS_META,
  timeAgo,
} from '../lib/utils'
import { clockTime } from '../lib/utils'
import { useClock } from '../components/shell'

const HOURS = ['06', '07', '08', '09', '10', '11', '12', '13', '14', '15', '16', '17']

export default function Dashboard({ onNavigate }: { onNavigate: (id: string) => void }) {
  const { state, dispatch } = usePlant()
  const kpis = useKpis()
  const now = useClock()

  const statusBreakdown = useMemo(() => {
    const map = new Map<string, number>()
    state.machines.forEach((m) => map.set(m.status, (map.get(m.status) ?? 0) + 1))
    return [...map.entries()].map(([status, value]) => ({
      label: STATUS_META[status as keyof typeof STATUS_META].label,
      value,
      color: STATUS_META[status as keyof typeof STATUS_META].color,
    }))
  }, [state.machines])

  const oeeSeries = useMemo(
    () => [
      {
        key: 'oee',
        label: 'OEE',
        color: '#22d3ee',
        values: state.oeeHistory.map((p) => p.oee),
      },
      {
        key: 'availability',
        label: 'Availability',
        color: '#a855f7',
        values: state.oeeHistory.map((p) => p.availability),
        area: false,
      },
      {
        key: 'performance',
        label: 'Performance',
        color: '#60a5fa',
        values: state.oeeHistory.map((p) => p.performance),
        area: false,
      },
      {
        key: 'quality',
        label: 'Quality',
        color: '#34d399',
        values: state.oeeHistory.map((p) => p.quality),
        area: false,
      },
    ],
    [state.oeeHistory],
  )

  const heatValues = useMemo(
    () =>
      state.lines.map((l) =>
        HOURS.map((_, i) => {
          const base = l.oee
          return Math.max(35, Math.min(100, base + Math.sin((i + l.throughput % 7) / 1.7) * 9 - 2))
        }),
      ),
    [state.lines],
  )

  const activeOrders = useMemo(
    () => state.workOrders.filter((wo) => wo.status === 'running').slice(0, 5),
    [state.workOrders],
  )

  const unacked = state.alerts.filter((a) => !a.acknowledged).slice(0, 6)

  return (
    <div className="space-y-5">
      <SectionTitle
        eyebrow="Command Center"
        title="Plant Overview"
        description="Unified supervision layer across 6 production lines, 24 stations and 3 shifts — streaming live from the shop floor."
        actions={
          <>
            <Chip tone="cyan" icon={Radio} dot>
              {state.machines.length} stations linked
            </Chip>
            <Chip tone={kpis.criticalAlerts ? 'rose' : 'emerald'} icon={AlertTriangle}>
              {kpis.openAlerts} open alerts
            </Chip>
            <button type="button" className="btn btn-primary" onClick={() => onNavigate('lines')}>
              <Layers size={13} /> Open floor view
            </button>
          </>
        }
      />

      {/* ---------------------------------------------------------- hero --- */}
      <Panel beam className="!p-5">
        <div
          className="pointer-events-none absolute inset-0 opacity-70"
          style={{
            background:
              'radial-gradient(120% 120% at 0% 0%, rgba(34,211,238,0.13), transparent 45%), radial-gradient(100% 100% at 100% 0%, rgba(168,85,247,0.14), transparent 50%)',
          }}
        />
        <span className="line-sweep" style={{ animationDelay: '0.6s' }} />
        <div className="relative grid gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)_minmax(0,1.1fr)]">
          {/* OEE cluster */}
          <div className="flex items-center gap-5">
            <Gauge value={kpis.oee} tone={oeeTone(kpis.oee)} size={158} label="Overall OEE" sublabel={`target 85%`} />
            <div className="min-w-0 flex-1 space-y-3">
              <div className="flex items-center gap-2">
                <StatusDot color={state.running ? '#34d399' : '#fbbf24'} />
                <span className="label-cap text-haze-400">{state.running ? 'Live telemetry' : 'Feed paused'}</span>
                <span className="mono ml-auto text-[10.5px] text-haze-500">{clockTime(now)}</span>
              </div>
              {[
                { label: 'Availability', value: kpis.availability, tone: 'violet' },
                { label: 'Performance', value: kpis.performance, tone: 'blue' },
                { label: 'Quality', value: kpis.quality, tone: 'emerald' },
              ].map((row) => (
                <div key={row.label}>
                  <div className="mb-1 flex items-center justify-between text-[11px]">
                    <span className="text-haze-400">{row.label}</span>
                    <span className="mono text-haze-200">{row.value.toFixed(1)}%</span>
                  </div>
                  <Meter value={row.value} tone={row.tone} height={5} />
                </div>
              ))}
              <div className="flex items-center gap-2 pt-1">
                <Chip tone={kpis.oeeDelta >= 0 ? 'emerald' : 'rose'} icon={TrendingUp}>
                  {kpis.oeeDelta >= 0 ? '+' : ''}
                  {kpis.oeeDelta.toFixed(1)}% last hour
                </Chip>
                <button type="button" className="btn btn-ghost" onClick={() => onNavigate('analytics')}>
                  Deep dive
                </button>
              </div>
            </div>
          </div>

          {/* Output cluster */}
          <div className="rounded-2xl border border-white/8 bg-void-950/40 p-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="label-cap text-haze-500">Today's Output</p>
                <p className="mono mt-1.5 text-[30px] font-semibold leading-none text-haze-100">
                  {kpis.output.toLocaleString()}
                </p>
                <p className="mono mt-1 text-[11px] text-haze-500">
                  of {kpis.target.toLocaleString()} units planned
                </p>
              </div>
              <div className="text-right">
                <Chip tone={kpis.attainment >= 95 ? 'emerald' : kpis.attainment >= 85 ? 'amber' : 'rose'}>
                  {kpis.attainment.toFixed(1)}% attainment
                </Chip>
                <p className="mono mt-1.5 text-[10.5px] text-haze-500">Δ {kpis.outputDelta >= 0 ? '+' : ''}{kpis.outputDelta} u/h</p>
              </div>
            </div>
            <div className="mt-3.5 h-14">
              <Sparkline data={state.outputHistory.map((p) => p.actual)} tone="cyan" height={56} />
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2.5 border-t border-white/8 pt-3">
              {[
                { label: 'Throughput', value: `${kpis.throughput.toLocaleString()}`, unit: 'u/h', icon: Activity, tone: 'cyan' },
                { label: 'FPY', value: kpis.firstPassYield.toFixed(1), unit: '%', icon: ShieldCheck, tone: 'emerald' },
                { label: 'Scrap', value: kpis.scrapRate.toFixed(2), unit: '%', icon: Recycle, tone: 'amber' },
              ].map((m) => {
                const Icon = m.icon
                return (
                  <div key={m.label}>
                    <span className="label-cap flex items-center gap-1 text-haze-500">
                      <Icon size={10.5} /> {m.label}
                    </span>
                    <p className="mono mt-1 text-[15px] font-semibold text-haze-100">
                      {m.value}
                      <span className="ml-0.5 text-[10px] text-haze-500">{m.unit}</span>
                    </p>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Fleet cluster */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl border border-white/8 bg-void-950/40 p-3.5">
              <p className="label-cap text-haze-500">Fleet Status</p>
              <div className="mt-2">
                <Donut
                  segments={statusBreakdown}
                  size={132}
                  thickness={13}
                  centerValue={`${kpis.machinesRunning}/${kpis.machinesTotal}`}
                  centerLabel="running"
                />
              </div>
              <div className="mt-2 grid grid-cols-2 gap-1.5">
                {statusBreakdown.slice(0, 4).map((s) => (
                  <span key={s.label} className="mono flex items-center gap-1.5 text-[10px] text-haze-400">
                    <span className="size-1.5 rounded-full" style={{ background: s.color, boxShadow: `0 0 8px ${s.color}` }} />
                    {s.label} {s.value}
                  </span>
                ))}
              </div>
            </div>

            <div className="space-y-3">
              <div className="rounded-2xl border border-white/8 bg-void-950/40 p-3.5">
                <div className="flex items-center justify-between">
                  <span className="label-cap text-haze-500">Avg Machine Health</span>
                  <Wrench size={12} className="text-haze-500" />
                </div>
                <div className="mt-1.5 flex items-end gap-2">
                  <span className="mono text-[24px] font-semibold leading-none" style={{ color: '#34d399' }}>
                    {kpis.avgHealth.toFixed(1)}
                    <span className="text-[11px] text-haze-500">%</span>
                  </span>
                </div>
                <div className="mt-2.5">
                  <Meter value={kpis.avgHealth} tone={healthTone(kpis.avgHealth)} height={5} />
                </div>
                <p className="mono mt-2 text-[10px] text-haze-500">
                  {state.maintenance.filter((t) => t.kind === 'predictive').length} predictive flags active
                </p>
              </div>
              <div className="rounded-2xl border border-white/8 bg-void-950/40 p-3.5">
                <span className="label-cap text-haze-500">Energy Draw</span>
                <div className="mt-1.5 flex items-end gap-1.5">
                  <span className="mono text-[24px] font-semibold leading-none text-haze-100">{kpis.energy.toLocaleString()}</span>
                  <span className="mono text-[11px] text-haze-500">kWh</span>
                </div>
                <div className="mt-2.5">
                  <Meter value={(kpis.energy / 4000) * 100} tone="orange" height={5} />
                </div>
                <p className="mono mt-2 text-[10px] text-haze-500">
                  {(kpis.energy / Math.max(1, kpis.output) * 1000).toFixed(3)} kWh / 1k units
                </p>
              </div>
            </div>
          </div>
        </div>
      </Panel>

      {/* -------------------------------------------------------- KPI row --- */}
      <div className="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-6">
        <Stat
          label="OEE"
          value={kpis.oee.toFixed(1)}
          unit="%"
          delta={kpis.oeeDelta}
          icon={CircleGauge}
          tone={oeeTone(kpis.oee)}
          progress={kpis.oee}
          hint="World-class threshold at 85%"
          spark={<Sparkline data={state.oeeHistory.map((p) => p.oee)} tone={oeeTone(kpis.oee)} />}
        />
        <Stat
          label="Output vs Plan"
          value={`${kpis.attainment.toFixed(0)}`}
          unit="%"
          delta={Number(((kpis.outputDelta / Math.max(1, kpis.throughput)) * 100).toFixed(1))}
          icon={Package}
          tone="cyan"
          progress={kpis.attainment}
          hint={`${kpis.output.toLocaleString()} units produced`}
        />
        <Stat
          label="First Pass Yield"
          value={kpis.firstPassYield.toFixed(1)}
          unit="%"
          delta={0.4}
          icon={ShieldCheck}
          tone="emerald"
          progress={kpis.firstPassYield}
          hint={`Scrap at ${kpis.scrapRate.toFixed(2)}%`}
        />
        <Stat
          label="Throughput"
          value={kpis.throughput.toLocaleString()}
          unit="u/h"
          icon={Activity}
          tone="blue"
          progress={(kpis.throughput / 6000) * 100}
          hint="Rolling hourly rate across lines"
        />
        <Stat
          label="Work In Progress"
          value={kpis.wip.toLocaleString()}
          unit="units"
          icon={Boxes}
          tone="violet"
          progress={(kpis.wip / 24000) * 100}
          hint={`${activeOrders.length} orders in progress`}
        />
        <Stat
          label="Maintenance Due"
          value={kpis.maintenanceDue}
          unit="tasks"
          delta={-1}
          invertDelta
          icon={Wrench}
          tone={kpis.maintenanceDue > 3 ? 'rose' : 'amber'}
          progress={(kpis.maintenanceDue / 8) * 100}
          hint={`${kpis.dueToday} orders due today`}
        />
      </div>

      {/* ----------------------------------------------------- main grid ---- */}
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
        <div className="space-y-5">
          <Panel>
            <PanelHeader
              title="OEE Decomposition · current shift"
              subtitle="Availability × Performance × Quality — recomputed every production hour"
              icon={TrendingUp}
              actions={
                <>
                  <Chip tone="cyan">live</Chip>
                  <button type="button" className="btn btn-ghost" onClick={() => onNavigate('analytics')}>
                    Full analytics
                  </button>
                </>
              }
            />
            <AreaLineChart series={oeeSeries} labels={state.oeeHistory.map((p) => p.label)} height={248} target={85} unit="%" />
          </Panel>

          <Panel>
            <PanelHeader
              title="Line Performance Matrix"
              subtitle="OEE by line against the hour of the shift — darker means healthy"
              icon={Layers}
              actions={<Chip tone="violet">6 lines × 12 hours</Chip>}
            />
            <Heatmap
              rows={state.lines.map((l) => l.code)}
              cols={HOURS}
              values={heatValues}
              unitLabel="% OEE"
              scale={['#3b0764', '#22d3ee', '#a3e635']}
            />
            <div className="mt-3 flex items-center justify-between">
              <span className="mono text-[10px] text-haze-500">35%</span>
              <div
                className="h-1.5 flex-1 mx-3 rounded-full"
                style={{ background: 'linear-gradient(90deg,#3b0764,#22d3ee,#a3e635)' }}
              />
              <span className="mono text-[10px] text-haze-500">100%</span>
            </div>
          </Panel>
        </div>

        <div className="space-y-5">
          <Panel>
            <PanelHeader
              title="Live Alert Stream"
              subtitle={`${kpis.openAlerts} unacknowledged · auto-triaged by severity`}
              icon={AlertTriangle}
              accent="#fb7185"
              actions={
                <button type="button" className="btn btn-ghost" onClick={() => dispatch({ type: 'ACK_ALL' })}>
                  Ack all
                </button>
              }
            />
            <div className="-mx-1 space-y-1">
              {unacked.length === 0 && (
                <div className="grid place-items-center rounded-xl border border-dashed border-emerald-400/25 bg-emerald-500/5 py-6">
                  <ShieldCheck size={20} className="text-emerald-400" />
                  <p className="mt-1.5 text-[12px] text-emerald-300">All alerts acknowledged</p>
                </div>
              )}
              {unacked.map((a, i) => {
                const meta = SEVERITY_META[a.severity]
                return (
                  <div
                    key={a.id}
                    className="rise group relative flex gap-3 rounded-xl border border-white/6 bg-white/2 p-2.5 transition hover:border-white/14 hover:bg-white/5"
                    style={{ animationDelay: `${i * 45}ms` }}
                  >
                    <span
                      className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-lg"
                      style={{ background: `${meta.color}22`, color: meta.color, boxShadow: `inset 0 0 12px ${meta.color}33` }}
                    >
                      <AlertTriangle size={12} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <p className="truncate text-[12px] font-medium text-haze-100">{a.title}</p>
                        <span className="mono shrink-0 text-[9.5px] text-haze-500">{timeAgo(a.timestamp, now.getTime())}</span>
                      </div>
                      <p className="mt-0.5 line-clamp-2 text-[10.5px] leading-snug text-haze-500">{a.detail}</p>
                      <div className="mt-1.5 flex items-center justify-between">
                        <span className="mono text-[9.5px] text-cyan-300/70">{a.source}</span>
                        <button
                          type="button"
                          onClick={() => dispatch({ type: 'ACK_ALERT', id: a.id })}
                          className="text-[10px] text-haze-500 opacity-0 transition group-hover:opacity-100 hover:text-haze-100"
                        >
                          acknowledge →
                        </button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </Panel>

          <Panel>
            <PanelHeader
              title="Downtime Pareto"
              subtitle="Minutes lost this shift by root cause"
              icon={Clock4}
              accent="#fbbf24"
            />
            <HBars
              items={state.downtime.slice(0, 6).map((d) => ({
                label: d.reason,
                value: d.minutes,
                tone: d.category === 'planned' ? 'blue' : 'rose',
                hint: 'min',
              }))}
              unit=""
            />
            <div className="mt-3.5 grid grid-cols-2 gap-2.5 border-t border-white/8 pt-3">
              <div>
                <span className="label-cap text-haze-500">Unplanned</span>
                <p className="mono mt-1 text-[15px] text-rose-300">
                  {duration(state.downtime.filter((d) => d.category === 'unplanned').reduce((s, d) => s + d.minutes, 0))}
                </p>
              </div>
              <div>
                <span className="label-cap text-haze-500">Planned</span>
                <p className="mono mt-1 text-[15px] text-blue-300">
                  {duration(state.downtime.filter((d) => d.category === 'planned').reduce((s, d) => s + d.minutes, 0))}
                </p>
              </div>
            </div>
          </Panel>
        </div>
      </div>

      {/* ------------------------------------------------- line strip ------ */}
      <Panel>
        <PanelHeader
          title="Production Lines"
          subtitle="Tap a line to inspect every station on the floor"
          icon={GaugeIcon}
          actions={
            <button type="button" className="btn btn-ghost" onClick={() => onNavigate('lines')}>
              Floor map →
            </button>
          }
        />
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {state.lines.map((line, i) => {
            const meta = LINE_META[line.status]
            const progress = (line.output / Math.max(1, line.target)) * 100
            return (
              <button
                key={line.id}
                type="button"
                onClick={() => onNavigate('lines')}
                className={cn(
                  'rise lift group relative overflow-hidden rounded-xl border border-white/8 bg-void-950/40 p-3.5 text-left',
                )}
                style={{ animationDelay: `${i * 55}ms` }}
              >
                <span
                  className="pointer-events-none absolute -right-8 -top-10 size-28 rounded-full opacity-50 blur-2xl transition-opacity group-hover:opacity-90"
                  style={{ background: `radial-gradient(circle, ${meta.color}55, transparent 70%)` }}
                />
                <div className="relative flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="mono text-[11px] text-cyan-300">{line.code}</span>
                      <span className={cn('chip', meta.bg, meta.ring, meta.text)}>
                        <span className="size-1.5 rounded-full bg-current" />
                        {meta.label}
                      </span>
                    </div>
                    <p className="mt-1.5 text-[13px] font-semibold text-haze-100">{line.name}</p>
                    <p className="text-[10.5px] text-haze-500">{line.product}</p>
                  </div>
                  <div className="text-right">
                    <p className="mono text-[18px] font-semibold leading-none" style={{ color: meta.color }}>
                      {line.oee.toFixed(1)}
                      <span className="text-[10px] text-haze-500">%</span>
                    </p>
                    <p className="label-cap mt-1 text-haze-500">OEE</p>
                  </div>
                </div>

                <div className="relative mt-3 h-8">
                  <Sparkline data={line.efficiencySeries} tone={line.status === 'critical' ? 'rose' : 'cyan'} height={32} />
                </div>

                <div className="relative mt-2.5 flex items-center justify-between text-[10.5px]">
                  <span className="mono text-haze-300">
                    {line.output.toLocaleString()}
                    <span className="text-haze-500"> / {line.target.toLocaleString()}</span>
                  </span>
                  <span className="mono text-haze-500">{progress.toFixed(0)}%</span>
                </div>
                <div className="relative mt-1.5">
                  <Meter value={progress} tone={line.status === 'critical' ? 'rose' : 'cyan'} height={5} />
                </div>

                <div className="relative mt-3 grid grid-cols-3 gap-2 border-t border-white/8 pt-2.5">
                  <div>
                    <span className="label-cap text-haze-500">Leader</span>
                    <p className="truncate text-[10.5px] text-haze-200">{line.leader}</p>
                  </div>
                  <div>
                    <span className="label-cap text-haze-500">Operators</span>
                    <p className="mono text-[10.5px] text-haze-200">{line.operators}</p>
                  </div>
                  <div>
                    <span className="label-cap text-haze-500">Scrap</span>
                    <p className="mono text-[10.5px] text-haze-200">{line.scrap.toFixed(2)}%</p>
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      </Panel>

      {/* ------------------------------------------------- orders + spc ----- */}
      <div className="grid gap-5 lg:grid-cols-2">
        <Panel>
          <PanelHeader
            title="Active Work Orders"
            subtitle="Shop-floor execution right now"
            icon={Timer}
            accent="#60a5fa"
            actions={
              <button type="button" className="btn btn-ghost" onClick={() => onNavigate('orders')}>
                All orders →
              </button>
            }
          />
          <div className="space-y-2.5">
            {activeOrders.map((wo) => {
              const progress = (wo.completed / wo.qty) * 100
              return (
                <div key={wo.id} className="rounded-xl border border-white/7 bg-void-950/40 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="mono text-[11px] text-cyan-300">{wo.id}</span>
                        <span className="mono rounded-md border border-white/10 bg-white/5 px-1.5 py-0.5 text-[9.5px] text-haze-400">
                          {wo.sku}
                        </span>
                      </div>
                      <p className="mt-1 truncate text-[12px] text-haze-100">{wo.product}</p>
                      <p className="mono mt-0.5 text-[10px] text-haze-500">
                        {state.lines.find((l) => l.id === wo.lineId)?.code} · owner {wo.owner} · due {wo.dueDate}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="mono text-[12px] text-haze-100">
                        {wo.completed.toLocaleString()}
                        <span className="text-haze-500">/{wo.qty.toLocaleString()}</span>
                      </p>
                      <p className="mono mt-0.5 text-[10px] text-emerald-300">yield {wo.yieldRate}%</p>
                    </div>
                  </div>
                  <div className="mt-2.5">
                    <Meter value={progress} tone={progress > 70 ? 'emerald' : 'cyan'} height={5} />
                  </div>
                </div>
              )
            })}
          </div>
        </Panel>

        <Panel>
          <PanelHeader
            title="Shift Scoreboard"
            subtitle="Output, OEE and staffing per shift block"
            icon={Flame}
            accent="#fb923c"
          />
          <div className="space-y-3">
            {state.shifts.map((s) => {
              const progress = (s.output / s.target) * 100
              return (
                <div
                  key={s.id}
                  className={cn(
                    'relative overflow-hidden rounded-xl border p-3.5',
                    s.active ? 'border-cyan-400/30 bg-cyan-500/6' : 'border-white/7 bg-void-950/40',
                  )}
                >
                  {s.active && (
                    <span className="absolute right-3 top-3 flex items-center gap-1.5 text-[10px] text-cyan-300">
                      <StatusDot color="#22d3ee" /> on duty
                    </span>
                  )}
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-[13px] font-semibold text-haze-100">{s.name}</p>
                      <p className="mono text-[10.5px] text-haze-500">
                        {s.window} · {s.supervisor}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="mono text-[16px] font-semibold" style={{ color: s.active ? '#22d3ee' : '#a9b4d0' }}>
                        {s.oee.toFixed(1)}%
                      </p>
                      <p className="label-cap text-haze-500">OEE</p>
                    </div>
                  </div>
                  <div className="mt-2.5 flex items-center justify-between text-[10.5px] text-haze-400">
                    <span className="mono">
                      {s.output.toLocaleString()} / {s.target.toLocaleString()}
                    </span>
                    <span className="mono">{progress.toFixed(0)}%</span>
                  </div>
                  <div className="mt-1.5">
                    <Meter value={progress} tone={s.active ? 'cyan' : 'blue'} height={5} />
                  </div>
                  <div className="mt-2.5 flex gap-4 border-t border-white/8 pt-2 text-[10.5px]">
                    <span className="text-haze-500">
                      Headcount <span className="mono text-haze-200">{s.headcount}</span>
                    </span>
                    <span className="text-haze-500">
                      Labour h/unit <span className="mono text-haze-200">{(s.headcount / Math.max(1, s.output / 1000)).toFixed(2)}</span>
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
          <div className="mt-3.5 grid grid-cols-3 gap-2 border-t border-white/8 pt-3">
            <div>
              <span className="label-cap flex items-center gap-1 text-haze-500">
                <Percent size={10} /> Attainment
              </span>
              <p className="mono mt-1 text-[15px] text-haze-100">{kpis.attainment.toFixed(1)}%</p>
            </div>
            <div>
              <span className="label-cap flex items-center gap-1 text-haze-500">
                <Zap size={10} /> Energy
              </span>
              <p className="mono mt-1 text-[15px] text-haze-100">{kpis.energy.toLocaleString()} kWh</p>
            </div>
            <div>
              <span className="label-cap flex items-center gap-1 text-haze-500">
                <Clock4 size={10} /> Uptime
              </span>
              <p className="mono mt-1 text-[15px] text-haze-100">{(state.uptimeSeconds / 3600).toFixed(0)}h</p>
            </div>
          </div>
        </Panel>
      </div>
    </div>
  )
}
