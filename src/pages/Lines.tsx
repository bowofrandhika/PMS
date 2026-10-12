import { useMemo, useState } from 'react'
import {
  Activity,
  ArrowRight,
  Boxes,
  Cpu,
  Factory,
  Gauge as GaugeIcon,
  GaugeCircle,
  Radio,
  RotateCw,
  ShieldCheck,
  Thermometer,
  Timer,
  Users,
  Vibrate,
  Wrench,
  Waves,
  Zap,
} from 'lucide-react'
import { Chip, Gauge, InfoRow, Meter, Modal, Panel, PanelHeader, SectionTitle, Stat, StatusDot } from '../components/ui'
import { AreaLineChart, Sparkline } from '../components/charts'
import { usePlant } from '../store/plant'
import { cn, dateTime, healthTone, LINE_META, oeeTone, STATUS_META, toneColor } from '../lib/utils'
import type { Machine } from '../lib/types'

const STATUS_LIST: Machine['status'][] = ['running', 'idle', 'setup', 'maintenance', 'down']

const STATUS_OPTIONS: Array<{ value: Machine['status']; label: string }> = [
  { value: 'running', label: 'Running' },
  { value: 'idle', label: 'Idle' },
  { value: 'setup', label: 'Setup' },
  { value: 'maintenance', label: 'Maintenance' },
  { value: 'down', label: 'Down' },
]

export default function Lines() {
  const { state, dispatch } = usePlant()
  const [activeLine, setActiveLine] = useState<string>(state.lines[0]?.id ?? '')
  const [selected, setSelected] = useState<Machine | null>(null)

  const line = state.lines.find((l) => l.id === activeLine) ?? state.lines[0]
  const machines = useMemo(
    () => state.machines.filter((m) => m.lineId === line?.id).sort((a, b) => a.station - b.station),
    [state.machines, line?.id],
  )

  // Keep the modal in sync with live telemetry.
  const liveSelected = selected ? state.machines.find((m) => m.id === selected.id) ?? selected : null

  const statusCounts = useMemo(() => {
    const c: Record<string, number> = {}
    machines.forEach((m) => (c[m.status] = (c[m.status] ?? 0) + 1))
    return c
  }, [machines])

  if (!line) return null
  const meta = LINE_META[line.status]
  const progress = (line.output / Math.max(1, line.target)) * 100

  return (
    <div className="space-y-5">
      <SectionTitle
        eyebrow="Shop Floor"
        title="Production Line Monitor"
        description="Digital twin of the assembly floor — every station reports temperature, vibration, spindle speed and health in real time."
        actions={
          <>
            <Chip tone={line.status === 'critical' ? 'rose' : 'cyan'} dot>
              {line.code} · {meta.label}
            </Chip>
            <button
              type="button"
              className="btn"
              onClick={() => {
                const idx = state.lines.findIndex((l) => l.id === line.id)
                setActiveLine(state.lines[(idx + 1) % state.lines.length].id)
              }}
            >
              <RotateCw size={13} /> Next line
            </button>
          </>
        }
      />

      {/* line selector */}
      <div className="flex flex-wrap gap-2">
        {state.lines.map((l) => {
          const m = LINE_META[l.status]
          const active = l.id === line.id
          return (
            <button
              key={l.id}
              type="button"
              onClick={() => setActiveLine(l.id)}
              className={cn(
                'group relative flex items-center gap-2.5 overflow-hidden rounded-xl border px-3 py-2 text-left transition-all duration-300',
                active
                  ? 'border-transparent bg-gradient-to-r from-cyan-400/18 to-violet-500/12 shadow-[0_0_30px_-14px_rgba(34,211,238,0.9)]'
                  : 'border-white/8 bg-white/3 hover:border-white/16 hover:bg-white/6',
              )}
              style={active ? { boxShadow: `inset 0 0 0 1px ${m.color}66, 0 0 34px -18px ${m.color}` } : undefined}
            >
              <span className="size-2 rounded-full" style={{ background: m.color, boxShadow: `0 0 10px ${m.color}` }} />
              <span className="mono text-[11px] text-haze-100">{l.code}</span>
              <span className="hidden text-[11px] text-haze-500 sm:inline">{l.name}</span>
              <span className="mono text-[10.5px]" style={{ color: m.color }}>
                {l.oee.toFixed(0)}%
              </span>
              {active && <span className="absolute inset-x-0 bottom-0 h-[2px]" style={{ background: m.color, boxShadow: `0 0 12px ${m.color}` }} />}
            </button>
          )
        })}
      </div>

      {/* line summary */}
      <Panel beam className="!p-5">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1.4fr)] lg:items-center">
          <div>
            <div className="flex items-center gap-2">
              <span className="mono text-[11px] text-cyan-300">{line.code}</span>
              <span className={cn('chip', meta.bg, meta.ring, meta.text)}>
                <StatusDot color={meta.color} /> {meta.label}
              </span>
            </div>
            <h2 className="mt-2 text-[20px] font-semibold tracking-tight text-haze-100">{line.name}</h2>
            <p className="text-[12px] text-haze-500">
              {line.product} · built for {line.operators} operators
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Chip tone="haze" icon={Users}>
                {line.leader}
              </Chip>
              <Chip tone="cyan" icon={Timer}>
                {line.shift}
              </Chip>
              <Chip tone="violet" icon={Boxes}>
                {machines.length} stations
              </Chip>
            </div>
          </div>

          <div className="flex justify-center">
            <Gauge value={line.oee} tone={oeeTone(line.oee)} size={142} label="Line OEE" sublabel={`scrap ${line.scrap.toFixed(2)}%`} />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <div className="mb-1.5 flex items-center justify-between text-[11px]">
                <span className="label-cap text-haze-500">Output vs plan</span>
                <span className="mono text-haze-200">
                  {line.output.toLocaleString()} / {line.target.toLocaleString()}
                </span>
              </div>
              <Meter value={progress} tone={progress >= 95 ? 'emerald' : progress >= 80 ? 'cyan' : 'amber'} />
              <div className="mt-3 grid grid-cols-2 gap-3">
                <div>
                  <span className="label-cap text-haze-500">Throughput</span>
                  <p className="mono text-[15px] text-haze-100">{line.throughput.toLocaleString()} u/h</p>
                </div>
                <div>
                  <span className="label-cap text-haze-500">Energy</span>
                  <p className="mono text-[15px] text-haze-100">{line.energyKwh.toLocaleString()} kWh</p>
                </div>
              </div>
            </div>
            <div className="space-y-2">
              <span className="label-cap text-haze-500">Station mix</span>
              {STATUS_LIST.map((s) => {
                const m = STATUS_META[s]
                return (
                  <div key={s} className="flex items-center gap-2">
                    <span className="size-1.5 rounded-full" style={{ background: m.color }} />
                    <span className="text-[11px] text-haze-400">{m.label}</span>
                    <span className="mono ml-auto text-[11px] text-haze-200">{statusCounts[s] ?? 0}</span>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </Panel>

      {/* floor map */}
      <Panel>
        <span className="line-sweep" />
        <PanelHeader
          title={`${line.name} · station sequence`}
          subtitle="Material flows left to right — click any station for the full telemetry dossier"
          icon={Factory}
          accent={meta.color}
          actions={
            <Chip tone="emerald" dot>
              conveying
            </Chip>
          }
        />
        <div className="overflow-x-auto pb-2">
          <div className="flex min-w-max items-stretch gap-0">
            {machines.map((m, i) => {
              const sm = STATUS_META[m.status]
              return (
                <div key={m.id} className="flex items-stretch">
                  <button
                    type="button"
                    onClick={() => setSelected(m)}
                    className="rise lift group relative w-[186px] overflow-hidden rounded-2xl border border-white/8 bg-void-950/50 p-3 text-left"
                    style={{ animationDelay: `${i * 70}ms` }}
                  >
                    <span
                      className="pointer-events-none absolute inset-x-0 top-0 h-[2px] opacity-80"
                      style={{ background: `linear-gradient(90deg, transparent, ${sm.color}, transparent)` }}
                    />
                    <span
                      className="pointer-events-none absolute -right-8 -top-10 size-24 rounded-full opacity-45 blur-2xl transition group-hover:opacity-80"
                      style={{ background: `radial-gradient(circle, ${sm.color}66, transparent 70%)` }}
                    />
                    <div className="relative flex items-start justify-between">
                      <div>
                        <p className="mono text-[10.5px] text-cyan-300">ST-{String(m.station).padStart(2, '0')}</p>
                        <p className="mt-0.5 text-[12.5px] font-semibold leading-tight text-haze-100">{m.name}</p>
                        <p className="mono mt-0.5 text-[9.5px] text-haze-500">{m.code}</p>
                      </div>
                      <span
                        className="grid size-7 place-items-center rounded-lg border"
                        style={{ borderColor: `${sm.color}44`, background: `${sm.color}18`, color: sm.color }}
                      >
                        <Cpu size={13} />
                      </span>
                    </div>

                    <div className="relative mt-2.5 flex items-center gap-1.5">
                      <StatusDot color={sm.color} pulse={m.status === 'running'} />
                      <span className="text-[10.5px]" style={{ color: sm.color }}>
                        {sm.label}
                      </span>
                      <span className="mono ml-auto text-[9.5px] text-haze-500">{m.sinceMin.toFixed(0)}m</span>
                    </div>

                    <div className="relative mt-2 h-7">
                      <Sparkline data={m.telemetry.vibSeries} tone={m.status === 'down' ? 'rose' : 'cyan'} height={28} />
                    </div>

                    <div className="relative mt-2 grid grid-cols-2 gap-1.5 border-t border-white/8 pt-2">
                      <span className="mono flex items-center gap-1 text-[9.5px] text-haze-400">
                        <Thermometer size={9.5} /> {m.telemetry.temp.toFixed(1)}°
                      </span>
                      <span className="mono flex items-center gap-1 text-[9.5px] text-haze-400">
                        <Vibrate size={9.5} /> {m.telemetry.vibration.toFixed(2)}g
                      </span>
                    </div>
                    <div className="relative mt-1.5">
                      <Meter value={m.health} tone={healthTone(m.health)} height={4} />
                    </div>
                  </button>

                  {i < machines.length - 1 && (
                    <div className="flex w-14 flex-col items-center justify-center gap-1.5">
                      <div className="belt w-full" data-running={m.status === 'running'} />
                      <span className="mono flex items-center gap-0.5 text-[9px] text-haze-500">
                        <ArrowRight size={9} className="flow-x" />
                      </span>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </Panel>

      {/* stats + trend */}
      <div className="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="Availability (line)"
          value={(100 - (statusCounts.down ?? 0) * 12).toFixed(1)}
          unit="%"
          icon={Activity}
          tone="emerald"
          progress={100 - (statusCounts.down ?? 0) * 12}
          hint={`${statusCounts.down ?? 0} stations halted`}
        />
        <Stat
          label="Avg Health"
          value={(machines.reduce((s, m) => s + m.health, 0) / machines.length).toFixed(1)}
          unit="%"
          icon={ShieldCheck}
          tone={healthTone(machines.reduce((s, m) => s + m.health, 0) / machines.length)}
          progress={machines.reduce((s, m) => s + m.health, 0) / machines.length}
          hint="Weighted across all stations"
        />
        <Stat
          label="Avg Cycle Time"
          value={(machines.reduce((s, m) => s + m.cycleTime, 0) / machines.length).toFixed(1)}
          unit="s"
          icon={Timer}
          tone="blue"
          hint="Recipe target 12.4s"
        />
        <Stat
          label="Scrap Rate"
          value={line.scrap.toFixed(2)}
          unit="%"
          delta={-0.14}
          invertDelta
          icon={Waves}
          tone="amber"
          progress={line.scrap * 12}
          hint="Control limit 3.5%"
        />
      </div>

      <Panel>
        <PanelHeader
          title="Line OEE trajectory"
          subtitle={`${line.code} · rolling efficiency against the 85% world-class target`}
          icon={GaugeIcon}
          actions={<Chip tone="cyan">32 samples</Chip>}
        />
        <AreaLineChart
          series={[
            { key: `l-${line.id}`, label: 'Line efficiency', color: meta.color, values: line.efficiencySeries },
            {
              key: `lt-${line.id}`,
              label: 'Plant average',
              color: '#818cf8',
              dashed: true,
              area: false,
              values: line.efficiencySeries.map((v, i) => Math.max(40, v - 4 + Math.sin(i / 2) * 2.5)),
            },
          ]}
          labels={line.efficiencySeries.map((_, i) => `${i + 1}`)}
          height={230}
          target={85}
          unit="%"
        />
      </Panel>

      {/* station table */}
      <Panel>
        <PanelHeader title="Station register" subtitle="Complete asset list for the selected line" icon={GaugeCircle} />
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>Station</th>
                <th>Asset</th>
                <th>Status</th>
                <th>Health</th>
                <th>OEE</th>
                <th>Temp</th>
                <th>Vibration</th>
                <th>RPM</th>
                <th>Output</th>
                <th>Cycle</th>
                <th>Firmware</th>
              </tr>
            </thead>
            <tbody>
              {machines.map((m) => {
                const sm = STATUS_META[m.status]
                return (
                  <tr key={m.id} onClick={() => setSelected(m)} className="cursor-pointer">
                    <td className="mono text-cyan-300">ST-{String(m.station).padStart(2, '0')}</td>
                    <td>
                      <div className="flex items-center gap-2">
                        <span className="text-haze-100">{m.name}</span>
                        <span className="mono text-[10px] text-haze-500">{m.code}</span>
                      </div>
                    </td>
                    <td>
                      <span className={cn('chip', sm.bg, sm.ring, sm.text)}>
                        <span className="size-1.5 rounded-full bg-current" />
                        {sm.label}
                      </span>
                    </td>
                    <td>
                      <div className="flex items-center gap-2">
                        <span className="mono text-[11px]" style={{ color: toneColor(healthTone(m.health)) }}>
                          {m.health.toFixed(0)}%
                        </span>
                        <div className="w-16">
                          <Meter value={m.health} tone={healthTone(m.health)} height={4} />
                        </div>
                      </div>
                    </td>
                    <td className="mono text-haze-200">{m.oee.toFixed(1)}%</td>
                    <td className="mono text-haze-300">{m.telemetry.temp.toFixed(1)}°C</td>
                    <td className="mono text-haze-300">{m.telemetry.vibration.toFixed(2)}</td>
                    <td className="mono text-haze-300">{Math.round(m.telemetry.rpm).toLocaleString()}</td>
                    <td className="mono text-haze-200">
                      {m.outputToday.toLocaleString()}
                      <span className="text-haze-500">/{m.targetToday.toLocaleString()}</span>
                    </td>
                    <td className="mono text-haze-300">{m.cycleTime}s</td>
                    <td className="mono text-[10.5px] text-haze-500">{m.firmware}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Panel>

      {/* machine dossier */}
      <Modal
        open={!!liveSelected}
        onClose={() => setSelected(null)}
        title={liveSelected ? `${liveSelected.code} · ${liveSelected.name}` : ''}
        subtitle={liveSelected ? `${line.name} · station ${liveSelected.station} · firmware ${liveSelected.firmware}` : ''}
        icon={Cpu}
        width="max-w-4xl"
        footer={
          liveSelected && (
            <>
              <button
                type="button"
                className="btn"
                onClick={() => dispatch({ type: 'PUSH_TOAST', toast: { id: `t-${Date.now()}`, title: 'Work request raised', detail: `Preventive ticket created for ${liveSelected.code}.`, tone: 'info' } })}
              >
                <Wrench size={13} /> Raise work request
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  dispatch({ type: 'SET_MACHINE_STATUS', id: liveSelected.id, status: 'running' })
                  setSelected(null)
                }}
              >
                <Radio size={13} /> Return to production
              </button>
            </>
          )
        }
      >
        {liveSelected && (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-4">
              {[
                { label: 'Status', value: STATUS_META[liveSelected.status].label, tone: STATUS_META[liveSelected.status].color },
                { label: 'Health score', value: `${liveSelected.health.toFixed(0)}%`, tone: '#34d399' },
                { label: 'OEE', value: `${liveSelected.oee.toFixed(1)}%`, tone: '#22d3ee' },
                { label: 'Scrap', value: `${liveSelected.scrapRate.toFixed(2)}%`, tone: '#fbbf24' },
              ].map((k) => (
                <div key={k.label} className="rounded-xl border border-white/8 bg-void-950/50 p-3">
                  <span className="label-cap text-haze-500">{k.label}</span>
                  <p className="mono mt-1.5 text-[18px] font-semibold" style={{ color: k.tone }}>
                    {k.value}
                  </p>
                </div>
              ))}
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              {[
                { label: 'Temperature', data: liveSelected.telemetry.tempSeries, value: liveSelected.telemetry.temp, unit: '°C', tone: 'orange', icon: Thermometer },
                { label: 'Vibration RMS', data: liveSelected.telemetry.vibSeries, value: liveSelected.telemetry.vibration, unit: 'g', tone: 'violet', icon: Vibrate },
                { label: 'Spindle speed', data: liveSelected.telemetry.rpmSeries, value: liveSelected.telemetry.rpm, unit: 'rpm', tone: 'cyan', icon: RotateCw },
              ].map((t) => {
                const Icon = t.icon
                return (
                  <div key={t.label} className="rounded-xl border border-white/8 bg-void-950/50 p-3">
                    <div className="flex items-center justify-between">
                      <span className="label-cap flex items-center gap-1 text-haze-500">
                        <Icon size={11} /> {t.label}
                      </span>
                      <span className="mono text-[12px] text-haze-100">
                        {t.value.toFixed(2)} <span className="text-[10px] text-haze-500">{t.unit}</span>
                      </span>
                    </div>
                    <div className="mt-2 h-16">
                      <Sparkline data={t.data} tone={t.tone} height={64} />
                    </div>
                  </div>
                )
              })}
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-xl border border-white/8 bg-void-950/40 p-3.5">
                <p className="label-cap mb-2 text-haze-500">Asset record</p>
                <InfoRow label="Asset code" value={liveSelected.code} />
                <InfoRow label="Line" value={`${line.code} · ${line.name}`} />
                <InfoRow label="Cycle time" value={`${liveSelected.cycleTime}s`} />
                <InfoRow label="Output today" value={`${liveSelected.outputToday.toLocaleString()} / ${liveSelected.targetToday.toLocaleString()}`} />
                <InfoRow label="Cumulative uptime" value={`${liveSelected.uptimeHours.toLocaleString()} h`} />
                <InfoRow label="Pressure" value={`${liveSelected.telemetry.pressure} bar`} />
                <InfoRow label="Current draw" value={`${liveSelected.telemetry.current} A`} />
                <InfoRow label="Last service" value={liveSelected.lastService} />
                <InfoRow label="Next service" value={`in ${liveSelected.nextService}`} />
                <InfoRow label="Status since" value={dateTime(new Date(Date.now() - liveSelected.sinceMin * 60_000))} />
              </div>

              <div className="space-y-3">
                <div className="rounded-xl border border-white/8 bg-void-950/40 p-3.5">
                  <p className="label-cap mb-2.5 text-haze-500">Status override · HMI control</p>
                  <div className="flex flex-wrap gap-2">
                    {STATUS_OPTIONS.map((o) => {
                      const sm = STATUS_META[o.value]
                      const active = liveSelected.status === o.value
                      return (
                        <button
                          key={o.value}
                          type="button"
                          onClick={() => dispatch({ type: 'SET_MACHINE_STATUS', id: liveSelected.id, status: o.value })}
                          className={cn(
                            'flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11.5px] transition',
                            active ? 'border-transparent font-semibold' : 'border-white/10 text-haze-400 hover:text-haze-100',
                          )}
                          style={active ? { background: `${sm.color}22`, color: sm.color, boxShadow: `inset 0 0 0 1px ${sm.color}55` } : undefined}
                        >
                          <span className="size-1.5 rounded-full" style={{ background: sm.color }} />
                          {o.label}
                        </button>
                      )
                    })}
                  </div>
                  <p className="mt-2.5 text-[10.5px] leading-snug text-haze-500">
                    Overrides are written to the audit trail and broadcast to the HMI tablets on the floor.
                  </p>
                </div>

                <div className="rounded-xl border border-white/8 bg-void-950/40 p-3.5">
                  <div className="flex items-center justify-between">
                    <p className="label-cap text-haze-500">Load vs capacity</p>
                    <span className="mono text-[10.5px] text-haze-400">{(liveSelected.oee / 100).toFixed(2)} ×</span>
                  </div>
                  <div className="mt-2.5 flex items-center gap-3">
                    <Gauge
                      value={liveSelected.oee}
                      tone={oeeTone(liveSelected.oee)}
                      size={104}
                      thickness={8}
                      sublabel={undefined}
                    />
                    <div className="flex-1 space-y-2 text-[11px]">
                      <div className="flex justify-between">
                        <span className="text-haze-500">Ideal cycle</span>
                        <span className="mono text-haze-200">{(liveSelected.cycleTime * 0.86).toFixed(2)}s</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-haze-500">Actual cycle</span>
                        <span className="mono text-haze-200">{liveSelected.cycleTime.toFixed(2)}s</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-haze-500">Perf. loss</span>
                        <span className="mono text-amber-300">{(liveSelected.cycleTime * 0.14).toFixed(2)}s</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-haze-500">Energy / unit</span>
                        <span className="mono text-haze-200">
                          {(liveSelected.telemetry.current * 0.42).toFixed(3)} kWh
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-white/8 bg-void-950/40 p-3.5">
              <div className="mb-2 flex items-center justify-between">
                <p className="label-cap text-haze-500">OEE contribution vs fleet</p>
                <Chip tone="violet" icon={Zap}>
                  model throughput
                </Chip>
              </div>
              <AreaLineChart
                series={[
                  { key: 'm-oee', label: liveSelected.code, color: '#22d3ee', values: line.efficiencySeries.map((v) => Math.max(30, v - 4 + Math.sin(v / 4) * 6)) },
                  { key: 'm-tgt', label: 'Line mean', color: '#a855f7', values: line.efficiencySeries, area: false, dashed: true },
                ]}
                labels={line.efficiencySeries.map((_, i) => `${i + 1}`)}
                height={190}
                target={85}
                unit="%"
                showLegend
              />
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
