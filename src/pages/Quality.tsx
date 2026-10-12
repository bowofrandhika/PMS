import { useMemo, useState } from 'react'
import {
  BadgeCheck,
  Beaker,
  ClipboardCheck,
  FileWarning,
  FlaskConical,
  Microscope,
  Recycle,
  ScanLine,
  ShieldAlert,
  ShieldCheck,
  Sigma,
  Sparkles,
  TrendingDown,
} from 'lucide-react'
import { AreaLineChart, Donut, HBars, Radar, SpcChart } from '../components/charts'
import { Chip, Gauge, Meter, Panel, PanelHeader, SectionTitle, Stat } from '../components/ui'
import { usePlant } from '../store/plant'
import { cn, num } from '../lib/utils'

const LOTS = [
  { lot: 'LOT-88412', sku: 'NX-220', line: 'LN-01', size: 640, checked: 64, defects: 1, aql: 'pass', inspector: 'Bella Kartika' },
  { lot: 'LOT-88413', sku: 'HS-40', line: 'LN-02', size: 420, checked: 42, defects: 4, aql: 'review', inspector: 'Hana Pertiwi' },
  { lot: 'LOT-88414', sku: 'LB-9', line: 'LN-03', size: 880, checked: 88, defects: 0, aql: 'pass', inspector: 'Nanda Pratama' },
  { lot: 'LOT-88415', sku: 'PH-12', line: 'LN-04', size: 1200, checked: 120, defects: 9, aql: 'fail', inspector: 'Oktavia Rini' },
  { lot: 'LOT-88416', sku: 'RP-77', line: 'LN-05', size: 2400, checked: 96, defects: 2, aql: 'pass', inspector: 'Qori Amelia' },
  { lot: 'LOT-88417', sku: 'AB-31', line: 'LN-06', size: 520, checked: 52, defects: 3, aql: 'review', inspector: 'Rangga Setiawan' },
]

const CAPA = [
  { id: 'CAPA-231', title: 'Reflow profile drift', owner: 'Process Eng.', status: 'in review', due: '2026-10-15', severity: 'high' },
  { id: 'CAPA-232', title: 'Sink mark on PH-12 housing', owner: 'Tooling', status: 'action open', due: '2026-10-13', severity: 'critical' },
  { id: 'CAPA-233', title: 'Laser mark contrast', owner: 'Automation', status: 'verification', due: '2026-10-19', severity: 'medium' },
  { id: 'CAPA-234', title: 'Label skew on RP-77 bulk', owner: 'Packaging', status: 'closed', due: '2026-10-08', severity: 'low' },
]

export default function Quality() {
  const { state } = usePlant()

  const totalDefects = useMemo(() => state.defects.reduce((s, d) => s + d.count, 0), [state.defects])
  const inspectionVolume = useMemo(() => LOTS.reduce((s, l) => s + l.checked, 0), [])

  const fpyTrend = useMemo(
    () => state.outputHistory.map((p, i) => 99.6 - (p.scrap / p.target) * 100 - Math.sin(i / 2) * 0.35),
    [state.outputHistory],
  )

  const defectTrend = useMemo(
    () => state.oeeHistory.map((p, i) => 3.6 - (100 - p.quality) * 0.9 + Math.sin(i / 2.2) * 0.4),
    [state.oeeHistory],
  )

  const categoryMix = useMemo(() => {
    const map = new Map<string, number>()
    state.defects.forEach((d) => map.set(d.category, (map.get(d.category) ?? 0) + d.count))
    const palette = ['#22d3ee', '#a855f7', '#fbbf24', '#fb7185', '#34d399', '#60a5fa']
    return [...map.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([label, value], i) => ({ label, value, color: palette[i % palette.length] }))
  }, [state.defects])

  const [auditScore] = useState(96.4)

  const ppm = (totalDefects / Math.max(1, state.machines.reduce((s, m) => s + m.outputToday, 0))) * 1_000_000

  return (
    <div className="space-y-5">
      <SectionTitle
        eyebrow="Quality Assurance"
        title="Quality Lab & Defect Intelligence"
        description="Incoming inspection, in-process controls and final audit — defect data is classified automatically and fed back to the recipe engine."
        actions={
          <>
            <Chip tone="emerald" icon={BadgeCheck}>
              IATF 16949 audited {auditScore}%
            </Chip>
            <button type="button" className="btn btn-primary">
              <ScanLine size={13} /> New inspection
            </button>
          </>
        }
      />

      <div className="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="First Pass Yield"
          value={fpyTrend[fpyTrend.length - 1].toFixed(2)}
          unit="%"
          delta={0.42}
          icon={ShieldCheck}
          tone="emerald"
          progress={fpyTrend[fpyTrend.length - 1]}
          hint="Target ≥ 98.5% FPY"
        />
        <Stat
          label="Defect Rate"
          value={ppm.toFixed(0)}
          unit="ppm"
          delta={-38}
          invertDelta
          icon={FileWarning}
          tone="amber"
          progress={Math.min(100, ppm / 200)}
          hint={`${totalDefects} defects logged this shift`}
        />
        <Stat
          label="Lots Inspected"
          value={LOTS.length}
          unit={`· ${inspectionVolume} samples`}
          icon={Microscope}
          tone="cyan"
          progress={72}
          hint={`${LOTS.filter((l) => l.aql === 'fail').length} on hold · ${LOTS.filter((l) => l.aql === 'review').length} in review`}
        />
        <Stat
          label="Rework Hours"
          value="31.5"
          unit="h"
          delta={-4.2}
          invertDelta
          icon={Recycle}
          tone="rose"
          progress={38}
          hint="2.1% of total labour hours"
        />
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <Panel>
          <PanelHeader
            title="Defect Pareto"
            subtitle="Top failure modes with cumulative contribution"
            icon={Sigma}
            accent="#fbbf24"
            actions={<Chip tone="amber">Pareto 80/20</Chip>}
          />
          <HBars
            items={state.defects.map((d, i) => ({
              label: d.name,
              value: d.count,
              tone: i < 2 ? 'rose' : i < 4 ? 'amber' : 'cyan',
              hint: d.category,
            }))}
          />
          <div className="mt-4 rounded-xl border border-amber-400/20 bg-amber-500/6 p-3">
            <p className="flex items-center gap-1.5 text-[11.5px] text-amber-200">
              <Sparkles size={13} /> Top two modes drive{' '}
              {(((state.defects[0].count + state.defects[1].count) / totalDefects) * 100).toFixed(0)}% of all defects
            </p>
            <p className="mt-1 text-[10.5px] text-haze-400">
              Focused action on solder bridging and placement offset would recover an estimated{' '}
              {num(state.defects[0].count + state.defects[1].count)} units of capacity this month.
            </p>
          </div>
        </Panel>

        <Panel>
          <PanelHeader
            title="Defect mix by category"
            subtitle="Where quality loss originates"
            icon={Beaker}
            accent="#22d3ee"
          />
          <div className="flex flex-col items-center gap-4 sm:flex-row sm:justify-between">
            <Donut segments={categoryMix} size={168} thickness={15} centerValue={`${totalDefects}`} centerLabel="defects" />
            <div className="w-full space-y-2 sm:w-auto">
              {categoryMix.map((c) => (
                <div key={c.label} className="flex items-center gap-2 text-[11.5px]">
                  <span className="size-2 rounded-full" style={{ background: c.color, boxShadow: `0 0 9px ${c.color}` }} />
                  <span className="text-haze-300">{c.label}</span>
                  <span className="mono ml-auto text-haze-500">{((c.value / totalDefects) * 100).toFixed(0)}%</span>
                </div>
              ))}
            </div>
          </div>
        </Panel>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel>
          <PanelHeader
            title="Yield trajectory"
            subtitle="First pass yield vs defect rate (per mille)"
            icon={TrendingDown}
            accent="#34d399"
          />
          <AreaLineChart
            series={[
              { key: 'fpy', label: 'First pass yield', color: '#34d399', values: fpyTrend },
              {
                key: 'def',
                label: 'Defect rate ‰',
                color: '#fb7185',
                area: false,
                values: defectTrend,
              },
            ]}
            labels={state.outputHistory.map((p) => p.label)}
            height={230}
            target={98.5}
            targetLabel="FPY target"
            unit="%"
            digits={2}
          />
        </Panel>

        <Panel>
          <PanelHeader
            title="Process capability radar"
            subtitle="Quality dimensions against the internal standard"
            icon={FlaskConical}
            accent="#a855f7"
          />
          <div className="flex flex-col items-center gap-2 sm:flex-row sm:justify-between">
            <Radar
              axes={['Precision', 'Accuracy', 'Stability', 'Traceability', 'Cleanliness', 'Consistency']}
              series={[
                {
                  label: 'Current',
                  color: '#22d3ee',
                  values: [92, 88, 81, 96, 84, 90],
                },
                {
                  label: 'Last month',
                  color: '#a855f7',
                  values: [86, 84, 78, 90, 80, 85],
                },
              ]}
              size={244}
            />
            <div className="space-y-2.5">
              <Gauge value={91.4} tone="cyan" size={104} thickness={8} label="Quality index" />
              <div className="flex items-center gap-2 text-[11.5px]">
                <span className="size-2 rounded-full bg-cyan-300" />
                <span className="text-haze-300">Current</span>
              </div>
              <div className="flex items-center gap-2 text-[11.5px]">
                <span className="size-2 rounded-full bg-violet-400" />
                <span className="text-haze-300">Last month</span>
              </div>
            </div>
          </div>
        </Panel>
      </div>

      <Panel>
        <PanelHeader
          title="Inspection register"
          subtitle="Sampling plan per lot against the AQL acceptance criteria"
          icon={ClipboardCheck}
          accent="#60a5fa"
          actions={<Chip tone="haze">ISO 2859-1 · level II</Chip>}
        />
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>Lot</th>
                <th>SKU</th>
                <th>Line</th>
                <th>Lot size</th>
                <th>Samples</th>
                <th>Defects</th>
                <th>Defect rate</th>
                <th>AQL verdict</th>
                <th>Inspector</th>
              </tr>
            </thead>
            <tbody>
              {LOTS.map((l) => {
                const rate = (l.defects / l.checked) * 100
                const verdict =
                  l.aql === 'pass'
                    ? { tone: 'emerald', label: 'Accept', color: '#34d399' }
                    : l.aql === 'review'
                      ? { tone: 'amber', label: 'Review', color: '#fbbf24' }
                      : { tone: 'rose', label: 'Reject', color: '#fb7185' }
                return (
                  <tr key={l.lot}>
                    <td className="mono text-cyan-300">{l.lot}</td>
                    <td className="mono text-haze-200">{l.sku}</td>
                    <td className="mono text-[11px] text-haze-400">{l.line}</td>
                    <td className="mono text-haze-300">{num(l.size)}</td>
                    <td className="mono text-haze-300">{l.checked}</td>
                    <td className="mono text-haze-300">{l.defects}</td>
                    <td>
                      <div className="flex items-center gap-2">
                        <span className="mono text-[11px] text-haze-200">{rate.toFixed(2)}%</span>
                        <div className="w-16">
                          <Meter value={Math.min(100, rate * 20)} tone={rate > 4 ? 'rose' : rate > 2 ? 'amber' : 'emerald'} height={4} />
                        </div>
                      </div>
                    </td>
                    <td>
                      <Chip tone={verdict.tone as 'emerald' | 'amber' | 'rose'} dot>
                        {verdict.label}
                      </Chip>
                    </td>
                    <td className="text-[11px] text-haze-300">{l.inspector}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Panel>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <Panel>
          <PanelHeader
            title="Corrective & preventive actions"
            subtitle="CAPA board with owner and due dates"
            icon={ShieldAlert}
            accent="#fb7185"
          />
          <div className="space-y-2.5">
            {CAPA.map((c) => {
              const tone = c.severity === 'critical' ? 'rose' : c.severity === 'high' ? 'orange' : c.severity === 'medium' ? 'cyan' : 'haze'
              return (
                <div key={c.id} className="rounded-xl border border-white/7 bg-void-950/40 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="mono text-[10.5px] text-cyan-300">{c.id}</span>
                        <Chip tone={tone as 'rose' | 'orange' | 'cyan' | 'haze'}>{c.severity}</Chip>
                      </div>
                      <p className="mt-1 text-[12px] text-haze-100">{c.title}</p>
                    </div>
                    <span className="mono shrink-0 text-[10px] text-haze-500">due {c.due}</span>
                  </div>
                  <div className="mt-2 flex items-center justify-between text-[10.5px]">
                    <span className="text-haze-500">Owner · {c.owner}</span>
                    <span className={cn('mono', c.status === 'closed' ? 'text-emerald-300' : 'text-amber-300')}>{c.status}</span>
                  </div>
                </div>
              )
            })}
          </div>
        </Panel>

        <Panel>
          <PanelHeader
            title="Control chart · critical dimension"
            subtitle="Continuous sampling with rule-based violation detection"
            icon={Microscope}
            actions={<Chip tone="cyan">auto-sampled</Chip>}
          />
          <SpcChart samples={state.spc} height={236} />
          <div className="mt-3 grid grid-cols-3 gap-3 border-t border-white/8 pt-3 text-[11px]">
            <div>
              <span className="label-cap text-haze-500">Control rule</span>
              <p className="mono mt-1 text-haze-100">Western Electric</p>
            </div>
            <div>
              <span className="label-cap text-haze-500">Sampling</span>
              <p className="mono mt-1 text-haze-100">n=5 / 15 min</p>
            </div>
            <div>
              <span className="label-cap text-haze-500">Gauge R&R</span>
              <p className="mono mt-1 text-emerald-300">7.4%</p>
            </div>
          </div>
        </Panel>
      </div>
    </div>
  )
}
