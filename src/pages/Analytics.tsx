import { useMemo, useState } from 'react'
import {
  Activity,
  ChartSpline,
  CircleGauge,
  Crosshair,
  Flame,
  Gauge as GaugeIcon,
  Layers3,
  Percent,
  Sigma,
  Target,
  Timer,
  TrendingUp,
  Zap,
} from 'lucide-react'
import { AreaLineChart, BarChart, Heatmap, Radar, SpcChart } from '../components/charts'
import { Chip, Gauge, Meter, Panel, PanelHeader, SectionTitle, Seg, Stat } from '../components/ui'
import { useKpis, usePlant } from '../store/plant'
import { cn, healthTone, num, oeeTone } from '../lib/utils'

const HOURS = ['06', '08', '10', '12', '14', '16', '18', '20']
const RANGE_OPTIONS = [
  { value: 'shift' as const, label: 'This shift' },
  { value: 'day' as const, label: '24 h' },
  { value: 'week' as const, label: '7 days' },
]

export default function Analytics() {
  const { state } = usePlant()
  const kpis = useKpis()
  const [range, setRange] = useState<'shift' | 'day' | 'week'>('shift')

  const oeeSeries = useMemo(
    () => [
      { key: 'a-oee', label: 'OEE', color: '#22d3ee', values: state.oeeHistory.map((p) => p.oee) },
      { key: 'a-av', label: 'Availability', color: '#a855f7', values: state.oeeHistory.map((p) => p.availability), area: false },
      { key: 'a-pe', label: 'Performance', color: '#60a5fa', values: state.oeeHistory.map((p) => p.performance), area: false },
      { key: 'a-qu', label: 'Quality', color: '#34d399', values: state.oeeHistory.map((p) => p.quality), area: false },
    ],
    [state.oeeHistory],
  )

  const lossTree = useMemo(() => {
    const losses = [
      { label: 'Breakdown losses', value: 412, tone: 'rose', cause: 'Unplanned stops' },
      { label: 'Setup & changeover', value: 318, tone: 'orange', cause: 'Tool & recipe swaps' },
      { label: 'Minor stops', value: 246, tone: 'amber', cause: 'Jams, starved stations' },
      { label: 'Reduced speed', value: 188, tone: 'blue', cause: 'Cycle time drift' },
      { label: 'Process defects', value: 134, tone: 'violet', cause: 'Scrap & rework' },
      { label: 'Startup rejects', value: 76, tone: 'pink', cause: 'Warm-up variance' },
    ]
    const peak = Math.max(...losses.map((l) => l.value))
    return { losses, peak, total: losses.reduce((s, l) => s + l.value, 0) }
  }, [])

  const machineHeat = useMemo(
    () =>
      state.lines.map((l) =>
        HOURS.map((_, i) => {
          const own = state.machines.filter((m) => m.lineId === l.id)
          const base = own.reduce((s, m) => s + m.health, 0) / Math.max(1, own.length)
          return Math.max(25, Math.min(100, base - 8 + Math.sin((i + l.throughput % 5) / 1.9) * 10))
        }),
      ),
    [state.lines, state.machines],
  )

  const radarLines = useMemo(() => {
    const palette = ['#22d3ee', '#a855f7', '#fbbf24']
    return state.lines.slice(0, 3).map((l, i) => ({
      label: l.code,
      color: palette[i],
      values: [
        l.oee,
        Math.max(30, 100 - l.scrap * 11),
        Math.max(35, 100 - (l.efficiencySeries.length % 11) * 4),
        Math.max(30, l.oee - 9),
        Math.max(40, l.throughput / 13),
        Math.max(35, 100 - Math.abs(85 - l.oee) * 1.6),
      ],
    }))
  }, [state.lines])

  const spcStats = useMemo(() => {
    const values = state.spc.map((s) => s.value)
    const mean = values.reduce((s, v) => s + v, 0) / values.length
    const sd = Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length)
    const cpk = Math.min((14.1 - mean) / (3 * sd), (mean - 10.7) / (3 * sd))
    return { mean, sd, cpk, outOfSpec: values.filter((v) => v > 14.1 || v < 10.7).length }
  }, [state.spc])

  const scale = range === 'shift' ? 1 : range === 'day' ? 0.98 : 0.94

  return (
    <div className="space-y-5">
      <SectionTitle
        eyebrow="Performance Intelligence"
        title="OEE Analytics & Loss Accounting"
        description="Every point of lost availability, speed and quality is quantified — so improvement effort lands where the value actually is."
        actions={
          <>
            <Seg options={RANGE_OPTIONS} value={range} onChange={setRange} />
            <button type="button" className="btn btn-ghost">
              Export CSV
            </button>
          </>
        }
      />

      {/* hero gauges */}
      <Panel beam className="!p-5">
        <div className="grid gap-5 lg:grid-cols-[auto_minmax(0,1fr)] lg:items-center">
          <div className="flex flex-wrap items-center justify-center gap-5">
            <Gauge value={kpis.oee} tone={oeeTone(kpis.oee)} size={150} label="OEE" sublabel="target 85%" />
            {[
              { label: 'Availability', value: kpis.availability, tone: 'violet' },
              { label: 'Performance', value: kpis.performance, tone: 'blue' },
              { label: 'Quality', value: kpis.quality, tone: 'emerald' },
            ].map((g) => (
              <Gauge key={g.label} value={g.value} tone={g.tone} size={116} thickness={8} label={g.label} />
            ))}
          </div>

          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-xl border border-white/8 bg-void-950/50 p-3">
                <span className="label-cap flex items-center gap-1 text-haze-500">
                  <Crosshair size={10} /> Gap to world class
                </span>
                <p className={cn('mono mt-1.5 text-[19px] font-semibold', kpis.oee >= 85 ? 'text-emerald-300' : 'text-amber-300')}>
                  {(85 - kpis.oee).toFixed(1)} pts
                </p>
                <p className="mt-1 text-[10.5px] text-haze-500">
                  ≈ {num(Math.max(0, (85 - kpis.oee) * 42))} units recoverable / shift
                </p>
              </div>
              <div className="rounded-xl border border-white/8 bg-void-950/50 p-3">
                <span className="label-cap flex items-center gap-1 text-haze-500">
                  <Sigma size={10} /> Total loss
                </span>
                <p className="mono mt-1.5 text-[19px] font-semibold text-rose-300">
                  {lossTree.total.toLocaleString()} min
                </p>
                <p className="mt-1 text-[10.5px] text-haze-500">across the six big losses</p>
              </div>
              <div className="rounded-xl border border-white/8 bg-void-950/50 p-3">
                <span className="label-cap flex items-center gap-1 text-haze-500">
                  <GaugeIcon size={10} /> Process capability
                </span>
                <p className={cn('mono mt-1.5 text-[19px] font-semibold', spcStats.cpk > 1.33 ? 'text-emerald-300' : 'text-amber-300')}>
                  Cpk {spcStats.cpk.toFixed(2)}
                </p>
                <p className="mt-1 text-[10.5px] text-haze-500">{spcStats.outOfSpec} out-of-spec samples</p>
              </div>
            </div>

            <div className="rounded-xl border border-white/8 bg-void-950/40 p-3.5">
              <div className="flex items-center justify-between">
                <span className="label-cap text-haze-500">Constraint analysis</span>
                <Chip tone="rose" icon={Flame}>
                  LN-06 constrains the plant
                </Chip>
              </div>
              <div className="mt-3 space-y-2.5">
                {state.lines
                  .slice()
                  .sort((a, b) => a.oee - b.oee)
                  .slice(0, 4)
                  .map((l) => (
                    <div key={l.id}>
                      <div className="mb-1 flex items-center justify-between text-[11px]">
                        <span className="text-haze-400">
                          <span className="mono text-cyan-300">{l.code}</span> · {l.name}
                        </span>
                        <span className="mono text-haze-200">{l.oee.toFixed(1)}%</span>
                      </div>
                      <Meter value={l.oee} tone={oeeTone(l.oee)} height={5} />
                    </div>
                  ))}
              </div>
            </div>
          </div>
        </div>
      </Panel>

      <div className="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="Units Produced"
          value={num(kpis.output)}
          unit="units"
          delta={kpis.outputDelta}
          deltaSuffix=" u/h"
          icon={Activity}
          tone="cyan"
          progress={kpis.attainment}
          hint={`${kpis.attainment.toFixed(1)}% of plan`}
        />
        <Stat
          label="Scrap Cost Proxy"
          value={num(Math.round(kpis.output * (kpis.scrapRate / 100)))}
          unit="units"
          delta={-2.4}
          invertDelta
          icon={Percent}
          tone="amber"
          progress={kpis.scrapRate * 14}
          hint={`scrap rate ${kpis.scrapRate.toFixed(2)}%`}
        />
        <Stat
          label="Energy Intensity"
          value={(kpis.energy / Math.max(1, kpis.output / 1000)).toFixed(2)}
          unit="kWh/1k"
          icon={Zap}
          tone="orange"
          progress={40}
          hint="Target ≤ 95 kWh per 1k units"
        />
        <Stat
          label="Avg Machine Health"
          value={kpis.avgHealth.toFixed(1)}
          unit="%"
          delta={-0.6}
          invertDelta
          icon={CircleGauge}
          tone={healthTone(kpis.avgHealth)}
          progress={kpis.avgHealth}
          hint="Predictive model confidence 92%"
        />
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <Panel>
          <PanelHeader
            title="OEE decomposition trend"
            subtitle={`Rolling ${range === 'shift' ? 'shift hours' : range === 'day' ? '24-hour buckets' : 'daily rollups'} with the 85% target line`}
            icon={TrendingUp}
            actions={<Chip tone="cyan">live·{state.tick}</Chip>}
          />
          <AreaLineChart
            series={oeeSeries.map((s, i) => ({
              ...s,
              values: s.values.map((v) => Number((v * scale + (i === 0 ? 0 : 0.4)).toFixed(1))),
            }))}
            labels={state.oeeHistory.map((p) => p.label)}
            height={252}
            target={85}
            unit="%"
          />
        </Panel>

        <Panel>
          <PanelHeader
            title="Six big losses"
            subtitle="Minutes of theoretical production capacity destroyed"
            icon={Sigma}
            accent="#fb7185"
            actions={<Chip tone="rose">{lossTree.total} min</Chip>}
          />
          <div className="space-y-2.5">
            {lossTree.losses.map((l, i) => (
              <div key={l.label} className="rise" style={{ animationDelay: `${i * 50}ms` }}>
                <div className="flex items-center justify-between text-[11.5px]">
                  <span className="text-haze-300">{l.label}</span>
                  <span className="mono text-haze-100">{l.value} min</span>
                </div>
                <div className="mt-1">
                  <Meter value={(l.value / lossTree.peak) * 100} tone={l.tone} height={6} />
                </div>
                <p className="mt-1 text-[10px] text-haze-500">{l.cause}</p>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel>
          <PanelHeader
            title="Output vs target"
            subtitle="Hourly buckets with scrap overlay"
            icon={Target}
            accent="#34d399"
          />
          <BarChart
            labels={state.outputHistory.map((p) => p.label)}
            series={[
              { key: 'actual', label: 'Produced', color: '#22d3ee', values: state.outputHistory.map((p) => p.actual) },
              { key: 'target', label: 'Planned', color: '#818cf8', values: state.outputHistory.map((p) => p.target) },
              { key: 'scrap', label: 'Scrap', color: '#fb7185', values: state.outputHistory.map((p) => p.scrap) },
            ]}
            height={232}
          />
        </Panel>

        <Panel>
          <PanelHeader
            title="Multi-axis line comparison"
            subtitle="Six-dimension scorecard for the top three lines"
            icon={Layers3}
            accent="#a855f7"
          />
          <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-center sm:justify-between">
            <Radar
              axes={['OEE', 'Quality', 'Delivery', 'Speed', 'Volume', 'Flexibility']}
              series={radarLines}
              size={252}
            />
            <div className="space-y-2">
              {radarLines.map((s) => (
                <div key={s.label} className="flex items-center gap-2 text-[11.5px]">
                  <span className="size-2 rounded-full" style={{ background: s.color, boxShadow: `0 0 9px ${s.color}` }} />
                  <span className="text-haze-300">{s.label}</span>
                  <span className="mono ml-auto text-haze-500">{s.values[0].toFixed(1)}%</span>
                </div>
              ))}
              <p className="max-w-[190px] pt-1 text-[10.5px] leading-snug text-haze-500">
                Volume and speed indices are normalised against the best-performing line of the week.
              </p>
            </div>
          </div>
        </Panel>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <Panel>
          <PanelHeader
            title="Statistical process control"
            subtitle="Housing diameter Ø12.40 mm · X̄ chart with 3σ limits"
            icon={ChartSpline}
            accent="#22d3ee"
            actions={<Chip tone={spcStats.cpk > 1.33 ? 'emerald' : 'amber'}>Cpk {spcStats.cpk.toFixed(2)}</Chip>}
          />
          <SpcChart samples={state.spc} height={214} />
          <div className="mt-3 grid grid-cols-4 gap-3 border-t border-white/8 pt-3 text-[11px]">
            <div>
              <span className="label-cap text-haze-500">X̄</span>
              <p className="mono mt-1 text-haze-100">{spcStats.mean.toFixed(3)}</p>
            </div>
            <div>
              <span className="label-cap text-haze-500">σ</span>
              <p className="mono mt-1 text-haze-100">{spcStats.sd.toFixed(3)}</p>
            </div>
            <div>
              <span className="label-cap text-haze-500">UCL / LCL</span>
              <p className="mono mt-1 text-haze-100">14.10 / 10.70</p>
            </div>
            <div>
              <span className="label-cap text-haze-500">Violations</span>
              <p className={cn('mono mt-1', spcStats.outOfSpec ? 'text-rose-300' : 'text-emerald-300')}>{spcStats.outOfSpec}</p>
            </div>
          </div>
        </Panel>

        <Panel>
          <PanelHeader
            title="Utilisation heatmap"
            subtitle="Line health index by hour of day"
            icon={Timer}
            accent="#fbbf24"
          />
          <Heatmap
            rows={state.lines.map((l) => l.code)}
            cols={HOURS}
            values={machineHeat}
            unitLabel="% health"
            scale={['#7f1d1d', '#fbbf24', '#34d399']}
          />
          <div className="mt-4 space-y-2 border-t border-white/8 pt-3">
            {[
              { label: 'Best window', value: '14:00 — 16:00', tone: 'text-emerald-300' },
              { label: 'Weakest window', value: '10:00 — 11:00', tone: 'text-rose-300' },
              { label: 'Changeover density', value: '2.4 / shift', tone: 'text-haze-200' },
            ].map((r) => (
              <div key={r.label} className="flex items-center justify-between text-[11.5px]">
                <span className="text-haze-500">{r.label}</span>
                <span className={cn('mono', r.tone)}>{r.value}</span>
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  )
}
