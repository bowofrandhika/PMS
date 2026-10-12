import { useMemo, useState } from 'react'
import {
  Award,
  CalendarClock,
  GraduationCap,
  HardHat,
  IdCard,
  Layers,
  ShieldCheck,
  Star,
  Timer,
  TrendingUp,
  UserCheck,
  Users,
} from 'lucide-react'
import { AreaLineChart, Heatmap, HBars } from '../components/charts'
import { Chip, Meter, Panel, PanelHeader, SectionTitle, Stat } from '../components/ui'
import { usePlant } from '../store/plant'
import { cn } from '../lib/utils'

const SKILLS = ['Assembly', 'SMT', 'Molding', 'CNC', 'Inspection', 'Packaging', 'Robot', 'QA Docs']

export default function Workforce() {
  const { state } = usePlant()
  const [shiftFilter, setShiftFilter] = useState<'all' | 'Shift A' | 'Shift B' | 'Shift C'>('all')

  const operators = useMemo(
    () => state.operators.filter((o) => (shiftFilter === 'all' ? true : o.shift === shiftFilter)),
    [state.operators, shiftFilter],
  )

  const kpis = useMemo(() => {
    const ops = state.operators
    return {
      headcount: ops.length,
      attendance: ops.reduce((s, o) => s + o.attendance, 0) / ops.length,
      efficiency: ops.reduce((s, o) => s + o.efficiency, 0) / ops.length,
      certifications: ops.reduce((s, o) => s + o.certifications, 0),
      topPerformer: [...ops].sort((a, b) => b.efficiency - a.efficiency)[0],
      overtimeHours: 186,
    }
  }, [state.operators])

  const skillMatrix = useMemo(
    () =>
      state.operators.slice(0, 10).map((o, oi) =>
        SKILLS.map((_, si) => {
          const seeded = (o.name.charCodeAt(0) * 7 + oi * 13 + si * 29) % 100
          return 42 + seeded * 0.56
        }),
      ),
    [state.operators],
  )

  const shiftPerformance = useMemo(
    () =>
      state.shifts.map((s) => ({
        label: s.name,
        value: Number(s.oee.toFixed(1)),
        tone: s.active ? 'cyan' : 'blue',
        hint: '% OEE',
      })),
    [state.shifts],
  )

  const outputTrend = useMemo(
    () => state.outputHistory.map((p, i) => Math.max(60, (p.actual / p.target) * 100 + Math.sin(i / 2) * 2)),
    [state.outputHistory],
  )

  return (
    <div className="space-y-5">
      <SectionTitle
        eyebrow="People & Skills"
        title="Workforce Operations"
        description="Shift roster, certification coverage and productivity indices for every operator on the floor — balanced in real time against line demand."
        actions={
          <>
            <Chip tone="cyan" icon={HardHat}>
              {kpis.headcount} operators on roster
            </Chip>
            <div className="seg">
              {(['all', 'Shift A', 'Shift B', 'Shift C'] as const).map((s) => (
                <button key={s} type="button" className="seg-item" data-active={shiftFilter === s} onClick={() => setShiftFilter(s)}>
                  {s === 'all' ? 'All shifts' : s}
                </button>
              ))}
            </div>
          </>
        }
      />

      <div className="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="Average Efficiency"
          value={kpis.efficiency.toFixed(1)}
          unit="%"
          delta={1.6}
          icon={TrendingUp}
          tone="emerald"
          progress={kpis.efficiency}
          hint="Standard work rate achievement"
        />
        <Stat
          label="Attendance"
          value={kpis.attendance.toFixed(1)}
          unit="%"
          delta={-0.4}
          invertDelta
          icon={UserCheck}
          tone="cyan"
          progress={kpis.attendance}
          hint="Rolling 7-day presence rate"
        />
        <Stat
          label="Certifications"
          value={kpis.certifications}
          unit="active"
          icon={GraduationCap}
          tone="violet"
          progress={(kpis.certifications / 120) * 100}
          hint="Machine-specific skill tickets"
        />
        <Stat
          label="Overtime"
          value={kpis.overtimeHours}
          unit="h"
          delta={12}
          invertDelta
          icon={Timer}
          tone="amber"
          progress={(kpis.overtimeHours / 300) * 100}
          hint="Approaching the 220 h monthly cap"
        />
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <Panel>
          <PanelHeader
            title="Shift roster board"
            subtitle="Staffing per shift block against the manning plan"
            icon={CalendarClock}
            accent="#60a5fa"
          />
          <div className="grid gap-3.5 lg:grid-cols-3">
            {state.shifts.map((s) => {
              const assigned = state.operators.filter((o) => o.shift === s.name)
              return (
                <div
                  key={s.id}
                  className={cn(
                    'rounded-xl border p-3.5',
                    s.active ? 'border-cyan-400/30 bg-cyan-500/6' : 'border-white/8 bg-void-950/40',
                  )}
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-[13px] font-semibold text-haze-100">{s.name}</p>
                      <p className="mono text-[10.5px] text-haze-500">{s.window}</p>
                    </div>
                    {s.active && <Chip tone="cyan" dot>live</Chip>}
                  </div>
                  <div className="mt-2.5 flex items-center justify-between text-[10.5px]">
                    <span className="text-haze-500">Manning plan</span>
                    <span className="mono text-haze-200">
                      {assigned.length || Math.round(s.headcount / 6)}/{Math.round(s.headcount / 6)}
                    </span>
                  </div>
                  <div className="mt-1.5">
                    <Meter value={s.headcount / 1.2} tone={s.active ? 'cyan' : 'blue'} height={5} />
                  </div>
                  <div className="mt-3 space-y-1.5">
                    {state.operators
                      .filter((o) => o.shift === s.name)
                      .slice(0, 4)
                      .map((o) => (
                        <div key={o.id} className="flex items-center gap-2">
                          <span className="grid size-6 shrink-0 place-items-center rounded-full bg-gradient-to-br from-cyan-400/25 to-violet-500/25 text-[9px] font-semibold text-haze-100">
                            {o.name.split(' ').map((n) => n[0]).join('')}
                          </span>
                          <span className="min-w-0 flex-1 truncate text-[11px] text-haze-300">{o.name}</span>
                          <span className="mono text-[10px] text-haze-500">{o.efficiency.toFixed(0)}%</span>
                        </div>
                      ))}
                    {assigned.length === 0 && (
                      <p className="text-[10.5px] text-haze-500">Roster synced from the HR system</p>
                    )}
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2 border-t border-white/8 pt-2.5 text-[10px]">
                    <span className="text-haze-500">
                      Headcount <span className="mono text-haze-200">{s.headcount}</span>
                    </span>
                    <span className="text-haze-500">
                      Supervisor <span className="text-haze-200">{s.supervisor.split(' ').slice(-1)[0]}</span>
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        </Panel>

        <div className="space-y-5">
          <Panel>
            <PanelHeader title="Shift productivity" subtitle="OEE achieved per shift block" icon={Layers} accent="#22d3ee" />
            <HBars items={shiftPerformance} unit="%" />
            <div className="mt-3.5 flex items-center justify-between border-t border-white/8 pt-3">
              <div>
                <span className="label-cap text-haze-500">Top performer</span>
                <p className="mt-1 text-[12px] text-haze-100">{kpis.topPerformer?.name}</p>
                <p className="mono text-[10px] text-haze-500">{kpis.topPerformer?.role}</p>
              </div>
              <div className="text-right">
                <span className="label-cap text-haze-500">Efficiency</span>
                <p className="mono mt-1 text-[18px] font-semibold text-emerald-300">
                  {kpis.topPerformer?.efficiency.toFixed(1)}%
                </p>
              </div>
            </div>
          </Panel>

          <Panel>
            <PanelHeader title="Labour productivity" subtitle="Output attainment vs staffing level" icon={Star} accent="#a855f7" />
            <AreaLineChart
              series={[{ key: 'labour', label: 'Output attainment', color: '#a855f7', values: outputTrend }]}
              labels={state.outputHistory.map((p) => p.label)}
              height={186}
              target={95}
              unit="%"
            />
          </Panel>
        </div>
      </div>

      <Panel>
        <PanelHeader
          title="Skill coverage matrix"
          subtitle="Certification strength per operator across critical processes"
          icon={IdCard}
          accent="#fbbf24"
          actions={<Chip tone="amber">gap: Robot cell</Chip>}
        />
        <Heatmap
          rows={state.operators.slice(0, 10).map((o) => o.name.split(' ')[1]?.slice(0, 6) ?? o.name.slice(0, 6))}
          cols={SKILLS}
          values={skillMatrix}
          unitLabel="% skill"
          scale={['#7f1d1d', '#fbbf24', '#34d399']}
        />
        <div className="mt-4 grid gap-3 border-t border-white/8 pt-3 sm:grid-cols-3">
          <div className="flex items-center gap-2.5">
            <Award size={15} className="text-amber-300" />
            <div>
              <p className="text-[11.5px] text-haze-200">Multi-skilled operators</p>
              <p className="mono text-[10.5px] text-haze-500">
                {state.operators.filter((o) => o.certifications >= 5).length} of {state.operators.length} hold 5+ tickets
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2.5">
            <ShieldCheck size={15} className="text-emerald-300" />
            <div>
              <p className="text-[11.5px] text-haze-200">Safety observations</p>
              <p className="mono text-[10.5px] text-haze-500">418 days without a lost-time incident</p>
            </div>
          </div>
          <div className="flex items-center gap-2.5">
            <Users size={15} className="text-cyan-300" />
            <div>
              <p className="text-[11.5px] text-haze-200">Roster flexibility</p>
              <p className="mono text-[10.5px] text-haze-500">Can cover 2 additional lines at short notice</p>
            </div>
          </div>
        </div>
      </Panel>

      <Panel>
        <PanelHeader
          title="Operator performance register"
          subtitle="Efficiency, attendance and skill depth per individual"
          icon={Users}
          accent="#22d3ee"
          actions={<Chip tone="haze">{operators.length} records</Chip>}
        />
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>Operator</th>
                <th>Role</th>
                <th>Line</th>
                <th>Shift</th>
                <th>Efficiency</th>
                <th>Attendance</th>
                <th>Certifications</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {operators.map((o) => (
                <tr key={o.id}>
                  <td>
                    <div className="flex items-center gap-2">
                      <span className="grid size-6 shrink-0 place-items-center rounded-full bg-gradient-to-br from-cyan-400/25 to-violet-500/25 text-[9px] font-semibold text-haze-100">
                        {o.name.split(' ').map((n) => n[0]).join('')}
                      </span>
                      <span className="text-haze-100">{o.name}</span>
                    </div>
                  </td>
                  <td className="text-[11px] text-haze-300">{o.role}</td>
                  <td className="mono text-[11px] text-cyan-300">
                    {state.lines.find((l) => l.id === o.lineId)?.code}
                  </td>
                  <td className="text-[11px] text-haze-300">{o.shift}</td>
                  <td>
                    <div className="flex items-center gap-2">
                      <span className="mono text-[11px] text-haze-200">{o.efficiency.toFixed(1)}%</span>
                      <div className="w-16">
                        <Meter value={o.efficiency} tone={o.efficiency > 92 ? 'emerald' : o.efficiency > 85 ? 'cyan' : 'amber'} height={4} />
                      </div>
                    </div>
                  </td>
                  <td className="mono text-[11px] text-haze-300">{o.attendance.toFixed(1)}%</td>
                  <td>
                    <div className="flex items-center gap-1">
                      {Array.from({ length: Math.min(7, o.certifications) }).map((_, i) => (
                        <span key={i} className="size-1.5 rounded-full bg-cyan-400/80" style={{ boxShadow: '0 0 6px #22d3ee88' }} />
                      ))}
                      <span className="mono ml-1 text-[10px] text-haze-500">{o.certifications}</span>
                    </div>
                  </td>
                  <td>
                    <Chip tone={o.attendance > 97 ? 'emerald' : 'amber'} dot>
                      {o.attendance > 97 ? 'on duty' : 'monitor'}
                    </Chip>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  )
}
