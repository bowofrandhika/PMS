import { useMemo, useState } from 'react'
import {
  Activity,
  AlarmClock,
  Ban,
  BrainCircuit,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  Cog,
  Gauge as GaugeIcon,
  Package,
  PlayCircle,
  ShieldPlus,
  Sparkles,
  Timer,
  TrendingUp,
  Wrench,
} from 'lucide-react'
import { AreaLineChart, HBars, Sparkline } from '../components/charts'
import { Chip, Gauge, InfoRow, Meter, Modal, Panel, PanelHeader, SectionTitle, Stat } from '../components/ui'
import { usePlant } from '../store/plant'
import { cn, healthTone, PRIORITY_META } from '../lib/utils'
import type { MaintenanceTask } from '../lib/types'

const KIND_META: Record<MaintenanceTask['kind'], { label: string; color: string; icon: typeof Cog }> = {
  preventive: { label: 'Preventive', color: '#22d3ee', icon: CalendarDays },
  corrective: { label: 'Corrective', color: '#fb7185', icon: Wrench },
  predictive: { label: 'Predictive', color: '#a855f7', icon: BrainCircuit },
}

const STATUS_TONE: Record<MaintenanceTask['status'], { label: string; tone: string }> = {
  scheduled: { label: 'Scheduled', tone: 'cyan' },
  'in-progress': { label: 'In progress', tone: 'blue' },
  'awaiting-parts': { label: 'Awaiting parts', tone: 'amber' },
  done: { label: 'Completed', tone: 'emerald' },
}

const DAYS = Array.from({ length: 14 }, (_, i) => {
  const d = new Date(Date.UTC(2026, 9, 6 + i))
  return { iso: d.toISOString().slice(0, 10), day: d.getUTCDate() }
})

export default function Maintenance() {
  const { state, dispatch } = usePlant()
  const [selected, setSelected] = useState<MaintenanceTask | null>(null)
  const [kindFilter, setKindFilter] = useState<MaintenanceTask['kind'] | 'all'>('all')

  const tasks = useMemo(
    () => state.maintenance.filter((t) => (kindFilter === 'all' ? true : t.kind === kindFilter)),
    [state.maintenance, kindFilter],
  )

  const kpis = useMemo(() => {
    const open = state.maintenance.filter((t) => t.status !== 'done')
    return {
      open: open.length,
      overdue: open.filter((t) => t.dayOffset < 0).length,
      predictive: state.maintenance.filter((t) => t.kind === 'predictive').length,
      compliance: 92.6,
      mtbf: 184,
      mttr: 42,
      availability: 94.2,
      plannedHours: state.maintenance.reduce((s, t) => s + t.durationHours, 0),
    }
  }, [state.maintenance])

  const riskRanked = useMemo(
    () =>
      state.machines
        .slice()
        .sort((a, b) => a.health - b.health)
        .slice(0, 8),
    [state.machines],
  )

  const startTask = (task: MaintenanceTask) => {
    dispatch({
      type: 'PUSH_TOAST',
      toast: {
        id: `t-${Date.now()}`,
        title: `${task.id} dispatched`,
        detail: `${task.assignee} assigned to ${task.asset} — work order sent to the maintenance tablet.`,
        tone: 'info',
      },
    })
    setSelected(null)
  }

  return (
    <div className="space-y-5">
      <SectionTitle
        eyebrow="Asset Care"
        title="Predictive Maintenance Command"
        description="Sensor-driven health indices, failure forecasting and a rolling 14-day maintenance calendar — intervention before breakdown."
        actions={
          <>
            <Chip tone="violet" icon={BrainCircuit} dot>
              {kpis.predictive} predictive flags
            </Chip>
            <Chip tone={kpis.overdue ? 'rose' : 'emerald'} icon={AlarmClock}>
              {kpis.overdue} overdue
            </Chip>
            <button type="button" className="btn btn-primary">
              <ShieldPlus size={13} /> Plan maintenance
            </button>
          </>
        }
      />

      <div className="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-6">
        <Stat label="MTBF" value={kpis.mtbf} unit="h" delta={4.2} icon={TrendingUp} tone="emerald" progress={72} hint="Mean time between failures" />
        <Stat label="MTTR" value={kpis.mttr} unit="min" delta={-6.1} invertDelta icon={Timer} tone="cyan" progress={58} hint="Mean time to repair" />
        <Stat label="PM Compliance" value={kpis.compliance} unit="%" delta={1.4} icon={ClipboardList} tone="blue" progress={kpis.compliance} hint="Planned vs executed work" />
        <Stat
          label="Open Tasks"
          value={kpis.open}
          unit="orders"
          icon={Cog}
          tone="amber"
          progress={(kpis.open / 20) * 100}
          hint={`${kpis.plannedHours} engineered hours queued`}
        />
        <Stat label="Asset Availability" value={kpis.availability} unit="%" delta={0.8} icon={GaugeIcon} tone="violet" progress={kpis.availability} hint="Fleet uptime, rolling 7 days" />
        <Stat label="Spare Parts Risk" value="3" unit="items" icon={Package} tone="rose" progress={37} hint="Items below reorder point" />
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        <Panel>
          <PanelHeader
            title="Asset risk ranking"
            subtitle="Lowest health indices first — model estimates remaining useful life"
            icon={Activity}
            accent="#fb7185"
            actions={<Chip tone="violet">ML v4.2</Chip>}
          />
          <div className="space-y-2.5">
            {riskRanked.map((m, i) => {
              const tone = healthTone(m.health)
              const rul = Math.max(3, Math.round(m.health * 2.4))
              return (
                <div
                  key={m.id}
                  className="rise flex items-center gap-3 rounded-xl border border-white/7 bg-void-950/40 p-2.5"
                  style={{ animationDelay: `${i * 45}ms` }}
                >
                  <span className="mono w-6 text-[11px] text-haze-500">#{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-[12px] text-haze-100">
                        <span className="mono text-cyan-300">{m.code}</span> · {m.name}
                      </span>
                      <span className="mono shrink-0 text-[11px]" style={{ color: tone === 'rose' ? '#fb7185' : tone === 'amber' ? '#fbbf24' : '#34d399' }}>
                        {m.health.toFixed(0)}%
                      </span>
                    </div>
                    <div className="mt-1.5">
                      <Meter value={m.health} tone={tone} height={5} />
                    </div>
                    <div className="mt-1.5 flex items-center justify-between text-[10px] text-haze-500">
                      <span className="mono">
                        RUL ≈ {rul}h · vib {m.telemetry.vibration.toFixed(2)}g · {m.telemetry.temp.toFixed(0)}°C
                      </span>
                      <span>{state.lines.find((l) => l.id === m.lineId)?.code}</span>
                    </div>
                  </div>
                  <div className="hidden h-8 w-16 shrink-0 sm:block">
                    <Sparkline data={m.telemetry.vibSeries} tone={tone === 'rose' ? 'rose' : tone === 'amber' ? 'amber' : 'emerald'} height={32} />
                  </div>
                </div>
              )
            })}
          </div>
        </Panel>

        <div className="space-y-5">
          <Panel>
            <PanelHeader
              title="Maintenance calendar"
              subtitle="Engineered work scheduled across the next two weeks"
              icon={CalendarDays}
              accent="#22d3ee"
              actions={<Chip tone="haze">14 days</Chip>}
            />
            <div className="overflow-x-auto">
              <div className="min-w-[560px]">
                <div className="grid grid-cols-[120px_1fr] gap-2">
                  <span />
                  <div className="grid grid-cols-14 gap-1">
                    {DAYS.map((d) => (
                      <span key={d.iso} className="mono text-center text-[8.5px] text-haze-500">
                        {d.day}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="mt-1.5 space-y-1.5">
                  {state.maintenance.slice(0, 10).map((t) => {
                    const meta = KIND_META[t.kind]
                    const idx = Math.max(0, DAYS.findIndex((d) => d.iso >= t.due))
                    return (
                      <div key={t.id} className="grid grid-cols-[120px_1fr] items-center gap-2">
                        <span className="mono truncate text-[10px] text-haze-400">
                          {t.machineCode} · {meta.label.slice(0, 4)}
                        </span>
                        <div className="relative h-5 rounded-md border border-white/6 bg-white/2">
                          <button
                            type="button"
                            onClick={() => setSelected(t)}
                            className="absolute inset-y-[3px] w-[calc(100%/14-4px)] rounded-[5px] transition hover:brightness-125"
                            style={{
                              left: `calc(${idx} * (100% / 14) + 2px)`,
                              background: `linear-gradient(90deg, ${meta.color}cc, ${meta.color}44)`,
                              boxShadow: `0 0 12px -2px ${meta.color}`,
                            }}
                            title={`${t.id} · ${t.asset}`}
                          />
                          {t.durationHours > 4 && (
                            <span
                              className="pointer-events-none absolute inset-y-[3px] rounded-[5px] opacity-40"
                              style={{
                                left: `calc(${idx} * (100% / 14) + 2px)`,
                                width: `calc(${Math.min(3, t.durationHours / 3)} * (100% / 14) - 4px)`,
                                background: meta.color,
                              }}
                            />
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-white/8 pt-3">
              {(Object.keys(KIND_META) as Array<keyof typeof KIND_META>).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setKindFilter(kindFilter === k ? 'all' : k)}
                  className={cn(
                    'flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[10.5px] transition',
                    kindFilter === k ? 'border-white/20 bg-white/8 text-haze-100' : 'border-white/8 text-haze-400 hover:text-haze-100',
                  )}
                >
                  <span className="size-2 rounded-sm" style={{ background: KIND_META[k].color }} />
                  {KIND_META[k].label}
                </button>
              ))}
              {kindFilter !== 'all' && (
                <button type="button" className="text-[10.5px] text-cyan-300" onClick={() => setKindFilter('all')}>
                  clear filter
                </button>
              )}
            </div>
          </Panel>

          <Panel>
            <PanelHeader
              title="Failure mode forecast"
              subtitle="Weeks at risk, by detected degradation signature"
              icon={Sparkles}
              accent="#a855f7"
            />
            <HBars
              items={[
                { label: 'Spindle bearing wear', value: 78, tone: 'rose', hint: '% risk in 2w' },
                { label: 'Hydraulic seal leak', value: 62, tone: 'amber', hint: '% risk in 3w' },
                { label: 'Belt slippage (conveyor)', value: 48, tone: 'amber', hint: '% risk in 4w' },
                { label: 'Thermocouple drift', value: 34, tone: 'cyan', hint: '% risk in 5w' },
                { label: 'Servo encoder noise', value: 21, tone: 'emerald', hint: '% risk in 6w' },
              ]}
              unit="%"
            />
          </Panel>
        </div>
      </div>

      <Panel>
        <PanelHeader
          title="Work order register"
          subtitle="Full maintenance backlog with owners, priority and effort"
          icon={Wrench}
          accent="#60a5fa"
          actions={<Chip tone={kindFilter === 'all' ? 'haze' : 'cyan'}>{kindFilter === 'all' ? 'all types' : KIND_META[kindFilter].label}</Chip>}
        />
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Asset</th>
                <th>Type</th>
                <th>Status</th>
                <th>Priority</th>
                <th>Assignee</th>
                <th>Due</th>
                <th>Effort</th>
                <th>Health</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {tasks.map((t) => {
                const kind = KIND_META[t.kind]
                const pm = PRIORITY_META[t.priority]
                const st = STATUS_TONE[t.status]
                return (
                  <tr key={t.id}>
                    <td className="mono text-cyan-300">{t.id}</td>
                    <td>
                      <div className="flex flex-col">
                        <span className="text-haze-100">{t.asset}</span>
                        <span className="mono text-[10px] text-haze-500">{t.machineCode}</span>
                      </div>
                    </td>
                    <td>
                      <span className="chip" style={{ background: `${kind.color}1f`, color: kind.color, borderColor: `${kind.color}44` }}>
                        <kind.icon size={11} /> {kind.label}
                      </span>
                    </td>
                    <td>
                      <Chip tone={st.tone as 'cyan' | 'blue' | 'amber' | 'emerald'} dot>
                        {st.label}
                      </Chip>
                    </td>
                    <td>
                      <span className={cn('chip', pm.bg, pm.ring, pm.text)}>{pm.label}</span>
                    </td>
                    <td className="text-[11px] text-haze-300">{t.assignee}</td>
                    <td className="mono text-[11px] text-haze-300">{t.due}</td>
                    <td className="mono text-[11px] text-haze-300">{t.durationHours}h</td>
                    <td>
                      <div className="flex items-center gap-2">
                        <span className="mono text-[11px] text-haze-200">{t.healthScore}%</span>
                        <div className="w-14">
                          <Meter value={t.healthScore} tone={healthTone(t.healthScore)} height={4} />
                        </div>
                      </div>
                    </td>
                    <td>
                      <button type="button" className="btn btn-ghost !px-2 !py-1 text-[10.5px]" onClick={() => setSelected(t)}>
                        detail
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel>
        <PanelHeader
          title="Reliability trend"
          subtitle="MTBF improvement against MTTR reduction programme"
          icon={TrendingUp}
          accent="#34d399"
        />
        <AreaLineChart
          series={[
            { key: 'mtbf', label: 'MTBF (h)', color: '#34d399', values: Array.from({ length: 12 }, (_, i) => 150 + i * 3.2 + Math.sin(i) * 6) },
            { key: 'mttr', label: 'MTTR (min ×4)', color: '#fb7185', area: false, values: Array.from({ length: 12 }, (_, i) => 190 - i * 6 + Math.cos(i) * 7) },
          ]}
          labels={state.oeeHistory.map((p) => p.label)}
          height={214}
          digits={1}
          showLegend
        />
      </Panel>

      <Modal
        open={!!selected}
        onClose={() => setSelected(null)}
        title={selected ? `${selected.id} · ${selected.asset}` : ''}
        subtitle={selected ? `${KIND_META[selected.kind].label} work · ${selected.machineCode}` : ''}
        icon={Wrench}
        footer={
          selected && (
            <>
              <button type="button" className="btn" onClick={() => setSelected(null)}>
                <Ban size={13} /> Defer
              </button>
              <button type="button" className="btn" onClick={() => startTask(selected)}>
                <PlayCircle size={13} /> Dispatch technician
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  dispatch({
                    type: 'PUSH_TOAST',
                    toast: {
                      id: `t-${Date.now()}`,
                      title: `${selected.id} closed`,
                      detail: `${selected.asset} returned to production with health index reset.`,
                      tone: 'success',
                    },
                  })
                  setSelected(null)
                }}
              >
                <CheckCircle2 size={13} /> Mark complete
              </button>
            </>
          )
        }
      >
        {selected && (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-xl border border-white/8 bg-void-950/40 p-3.5">
              <p className="label-cap mb-2 text-haze-500">Work order detail</p>
              <InfoRow label="Asset" value={selected.machineCode} />
              <InfoRow label="Type" value={KIND_META[selected.kind].label} />
              <InfoRow label="Status" value={STATUS_TONE[selected.status].label} />
              <InfoRow label="Priority" value={PRIORITY_META[selected.priority].label} />
              <InfoRow label="Assignee" value={selected.assignee} />
              <InfoRow label="Due date" value={selected.due} />
              <InfoRow label="Engineered effort" value={`${selected.durationHours} h`} />
              <InfoRow label="Health score" value={`${selected.healthScore}%`} />
            </div>
            <div className="space-y-3">
              <div className="rounded-xl border border-white/8 bg-void-950/40 p-3.5">
                <p className="label-cap mb-2 text-haze-500">Scope of work</p>
                <p className="text-[12px] leading-relaxed text-haze-300">{selected.note}</p>
              </div>
              <div className="rounded-xl border border-violet-400/20 bg-violet-500/6 p-3.5">
                <p className="flex items-center gap-1.5 text-[11.5px] text-violet-200">
                  <BrainCircuit size={13} /> Predicted impact if deferred 7 days
                </p>
                <p className="mt-1.5 text-[11px] text-haze-400">
                  Failure probability rises to {Math.min(96, selected.healthScore + 22)}% with an expected{' '}
                  {Math.round(selected.durationHours * 3.4)} h of unplanned downtime.
                </p>
                <div className="mt-2.5 flex items-center gap-2">
                  <Gauge value={Math.min(96, selected.healthScore + 22)} tone="rose" size={82} thickness={7} />
                  <div className="text-[10.5px] text-haze-400">
                    <p>
                      Risk score <span className="mono text-rose-300">{Math.min(96, selected.healthScore + 22)}</span>
                    </p>
                    <p className="mt-1">Confidence 0.91</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
