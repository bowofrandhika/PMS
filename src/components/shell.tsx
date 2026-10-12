import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  Bell,
  BellRing,
  Boxes,
  CheckCheck,
  ChevronLeft,
  Command,
  Cpu,
  Factory,
  Gauge,
  LayoutDashboard,
  Pause,
  Play,
  Search,
  ShieldCheck,
  Users,
  X,
  Zap,
  type LucideIcon,
} from 'lucide-react'
import { cn, clockTime, SEVERITY_META, STATUS_META, timeAgo } from '../lib/utils'
import type { Severity } from '../lib/types'
import { useKpis, usePlant } from '../store/plant'
import { Chip, StatusDot } from './ui'

export function useClock(step = 1000) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), step)
    return () => window.clearInterval(t)
  }, [step])
  return now
}

/* -------------------------------------------------------------- backdrop --- */
export function Backdrop() {
  return (
    <>
      <div className="aura-field">
        <span className="aura aura-a" />
        <span className="aura aura-b" />
        <span className="aura aura-c" />
        <span className="aura aura-d" />
      </div>
      <div className="grid-field" />
      <div className="noise-field" />
      <div className="scanlines" />
      <div className="vignette" />
    </>
  )
}

/* ------------------------------------------------------------------- nav --- */
export interface NavItem {
  id: string
  label: string
  hint: string
  icon: LucideIcon
  accent: string
}

export const NAV_ITEMS: NavItem[] = [
  { id: 'dashboard', label: 'Command Center', hint: 'Plant-wide KPIs', icon: LayoutDashboard, accent: '#22d3ee' },
  { id: 'lines', label: 'Production Lines', hint: '6 lines · 24 stations', icon: Factory, accent: '#34d399' },
  { id: 'orders', label: 'Work Orders', hint: 'Scheduling & routing', icon: Gauge, accent: '#60a5fa' },
  { id: 'analytics', label: 'OEE Analytics', hint: 'Loss trees & SPC', icon: Zap, accent: '#a855f7' },
  { id: 'quality', label: 'Quality Lab', hint: 'Defects & inspection', icon: ShieldCheck, accent: '#fbbf24' },
  { id: 'maintenance', label: 'Maintenance', hint: 'Predictive upkeep', icon: Cpu, accent: '#fb7185' },
  { id: 'inventory', label: 'Inventory', hint: 'Material coverage', icon: Boxes, accent: '#fb923c' },
  { id: 'workforce', label: 'Workforce', hint: 'Shift roster & skills', icon: Users, accent: '#818cf8' },
]

export function Sidebar({
  active,
  onNavigate,
  collapsed,
  onToggle,
  mobileOpen,
  onCloseMobile,
}: {
  active: string
  onNavigate: (id: string) => void
  collapsed: boolean
  onToggle: () => void
  mobileOpen: boolean
  onCloseMobile: () => void
}) {
  const { state } = usePlant()
  const kpis = useKpis()

  const plantHealth = useMemo(() => {
    const statuses = state.lines.map((l) => l.status)
    if (statuses.includes('critical')) return { label: 'Critical', tone: '#fb7185' }
    if (statuses.includes('attention')) return { label: 'Attention', tone: '#fbbf24' }
    return { label: 'Nominal', tone: '#34d399' }
  }, [state.lines])

  return (
    <>
      {mobileOpen && (
        <button
          type="button"
          aria-label="Close navigation"
          onClick={onCloseMobile}
          className="fixed inset-0 z-40 bg-void-950/70 backdrop-blur-sm lg:hidden"
        />
      )}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex flex-col border-r border-white/8 bg-void-900/85 backdrop-blur-2xl transition-[width,transform] duration-400 ease-out',
          collapsed ? 'w-[76px]' : 'w-[254px]',
          mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0',
        )}
      >
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-40 opacity-60"
          style={{ background: 'radial-gradient(60% 100% at 50% 0%, rgba(34,211,238,0.16), transparent 70%)' }}
        />

        {/* brand */}
        <div className="relative flex items-center gap-3 px-4 py-5">
          <div className="relative grid size-10 shrink-0 place-items-center rounded-xl border border-cyan-400/25 bg-gradient-to-br from-cyan-500/20 to-violet-500/10">
            <span className="absolute inset-0 rounded-xl ring-1 ring-inset ring-white/10" />
            <svg width="20" height="20" viewBox="0 0 32 32" className="relative">
              <defs>
                <linearGradient id="brand-g" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stopColor="#22d3ee" />
                  <stop offset="100%" stopColor="#a855f7" />
                </linearGradient>
              </defs>
              <path
                d="M8 23V9l8 9 8-9v14"
                fill="none"
                stroke="url(#brand-g)"
                strokeWidth="2.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <span className="absolute -inset-1 rounded-2xl border border-cyan-400/10 spin-slower" />
          </div>
          {!collapsed && (
            <div className="min-w-0">
              <p className="text-[14px] font-semibold leading-none tracking-tight text-haze-100">
                NEXUS<span className="text-cyan-300">·</span>PMS
              </p>
              <p className="label-cap mt-1.5 text-haze-500">Smart Factory Suite</p>
            </div>
          )}
        </div>

        {/* nav */}
        <nav className="relative flex-1 space-y-1 overflow-y-auto px-2.5 pb-4">
          {!collapsed && <p className="label-cap px-2.5 pb-2 pt-3 text-haze-500">Operations</p>}
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon
            const isActive = active === item.id
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  onNavigate(item.id)
                  onCloseMobile()
                }}
                title={collapsed ? item.label : undefined}
                data-active={isActive}
                className={cn('nav-item w-full', collapsed && 'justify-center !px-0')}
              >
                <span className="relative grid size-8 shrink-0 place-items-center">
                  <Icon size={16.5} strokeWidth={1.85} style={{ color: isActive ? item.accent : undefined }} />
                  {isActive && (
                    <span
                      className="absolute inset-0 rounded-lg opacity-70"
                      style={{ background: `radial-gradient(circle, ${item.accent}33, transparent 70%)` }}
                    />
                  )}
                </span>
                {!collapsed && (
                  <span className="min-w-0 flex-1 text-left">
                    <span className="block truncate text-[12.5px] font-medium leading-tight">{item.label}</span>
                    <span className="mt-0.5 block truncate text-[10px] text-haze-500">{item.hint}</span>
                  </span>
                )}
                {!collapsed && item.id === 'dashboard' && kpis.criticalAlerts > 0 && (
                  <span className="mono rounded-full border border-rose-400/30 bg-rose-500/15 px-1.5 py-0.5 text-[10px] text-rose-300">
                    {kpis.criticalAlerts}
                  </span>
                )}
              </button>
            )
          })}

          {!collapsed && (
            <div className="mt-4 rounded-xl border border-white/8 bg-white/3 p-3">
              <div className="flex items-center justify-between">
                <span className="label-cap text-haze-500">Plant Health</span>
                <StatusDot color={plantHealth.tone} />
              </div>
              <p className="mono mt-1.5 text-[15px] font-semibold" style={{ color: plantHealth.tone }}>
                {plantHealth.label}
              </p>
              <div className="mt-2.5 grid grid-cols-2 gap-2 text-[10.5px]">
                <div>
                  <p className="text-haze-500">Running</p>
                  <p className="mono text-haze-200">
                    {kpis.machinesRunning}/{kpis.machinesTotal}
                  </p>
                </div>
                <div>
                  <p className="text-haze-500">Down</p>
                  <p className="mono text-rose-300">{kpis.machinesDown}</p>
                </div>
              </div>
              <div className="track mt-2.5">
                <span
                  style={{
                    width: `${kpis.machinesTotal ? (kpis.machinesRunning / kpis.machinesTotal) * 100 : 0}%`,
                    background: 'linear-gradient(90deg,#22d3ee,#34d399)',
                    boxShadow: '0 0 12px #22d3ee88',
                  }}
                />
              </div>
            </div>
          )}
        </nav>

        {/* footer */}
        <div className="relative border-t border-white/8 p-3">
          {!collapsed ? (
            <div className="rounded-xl border border-white/8 bg-gradient-to-br from-white/5 to-transparent p-3">
              <div className="flex items-center gap-2.5">
                <span className="grid size-8 place-items-center rounded-full bg-gradient-to-br from-cyan-400/30 to-violet-500/30 text-[11px] font-semibold text-haze-100">
                  RH
                </span>
                <div className="min-w-0">
                  <p className="truncate text-[12px] font-medium text-haze-100">Rangga Hartono</p>
                  <p className="truncate text-[10px] text-haze-500">Plant Manager · NEX-1</p>
                </div>
              </div>
            </div>
          ) : (
            <div className="grid place-items-center">
              <span className="grid size-8 place-items-center rounded-full bg-gradient-to-br from-cyan-400/30 to-violet-500/30 text-[11px] font-semibold text-haze-100">
                RH
              </span>
            </div>
          )}
          <button
            type="button"
            onClick={onToggle}
            className="mt-3 hidden w-full items-center justify-center gap-2 rounded-lg border border-white/8 py-1.5 text-[11px] text-haze-400 transition hover:border-cyan-400/30 hover:text-haze-100 lg:flex"
          >
            <ChevronLeft size={13} className={cn('transition-transform duration-300', collapsed && 'rotate-180')} />
            {!collapsed && 'Collapse'}
          </button>
        </div>
      </aside>
    </>
  )
}

/* ---------------------------------------------------------------- top bar -- */
export function TopBar({
  title,
  section,
  onOpenPalette,
  onOpenMobile,
}: {
  title: string
  section: string
  onOpenPalette: () => void
  onOpenMobile: () => void
}) {
  const { state, dispatch } = usePlant()
  const kpis = useKpis()
  const now = useClock()
  const [bellOpen, setBellOpen] = useState(false)
  const bellRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (bellRef.current && !bellRef.current.contains(e.target as Node)) setBellOpen(false)
    }
    window.addEventListener('mousedown', onClick)
    return () => window.removeEventListener('mousedown', onClick)
  }, [])

  const unacked = state.alerts.filter((a) => !a.acknowledged)

  return (
    <header className="sticky top-0 z-30 border-b border-white/8 bg-void-900/72 backdrop-blur-2xl">
      <div className="flex items-center gap-3 px-4 py-3 sm:px-6">
        <button
          type="button"
          onClick={onOpenMobile}
          className="btn btn-ghost !px-2 lg:hidden"
          aria-label="Open navigation"
        >
          <span className="flex flex-col gap-[3px]">
            <span className="block h-[1.5px] w-4 bg-current" />
            <span className="block h-[1.5px] w-4 bg-current" />
            <span className="block h-[1.5px] w-2.5 bg-current" />
          </span>
        </button>

        <div className="hidden min-w-0 flex-col sm:flex">
          <span className="label-cap text-cyan-300/70">{section}</span>
          <h2 className="truncate text-[14.5px] font-semibold tracking-tight text-haze-100">{title}</h2>
        </div>

        <div className="flex flex-1 items-center justify-end gap-2">
          <button
            type="button"
            onClick={onOpenPalette}
            className="group hidden items-center gap-2 rounded-xl border border-white/10 bg-white/4 px-3 py-1.5 text-[11.5px] text-haze-500 transition hover:border-cyan-400/35 hover:text-haze-200 md:flex"
          >
            <Search size={13} />
            <span className="w-28 text-left">Search assets…</span>
            <span className="kbd flex items-center gap-0.5">
              <Command size={9} />K
            </span>
          </button>

          <div className="mono hidden items-center gap-2 rounded-xl border border-white/10 bg-white/4 px-2.5 py-1.5 text-[11.5px] text-haze-300 xl:flex">
            <span className="text-cyan-300">{clockTime(now)}</span>
            <span className="text-haze-500">·</span>
            <span>{now.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}</span>
          </div>

          <Chip tone={state.running ? 'emerald' : 'amber'} dot className="!py-1">
            <span className="hidden sm:inline">{state.running ? 'LIVE' : 'PAUSED'}</span>
          </Chip>

          <div className="hidden items-center gap-1 rounded-xl border border-white/8 bg-void-950/50 p-1 sm:flex">
            <button
              type="button"
              onClick={() => dispatch({ type: 'SET_RUNNING', running: !state.running })}
              className="grid size-6.5 place-items-center rounded-lg text-haze-300 transition hover:bg-white/8 hover:text-haze-100"
              title={state.running ? 'Pause live feed (P)' : 'Resume live feed (P)'}
            >
              {state.running ? <Pause size={13} /> : <Play size={13} />}
            </button>
            {[1, 2, 4].map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => dispatch({ type: 'SET_SPEED', speed: s })}
                className={cn(
                  'mono rounded-lg px-1.5 py-0.5 text-[10.5px] transition',
                  state.speed === s ? 'bg-cyan-400/20 text-cyan-200' : 'text-haze-500 hover:text-haze-200',
                )}
              >
                {s}×
              </button>
            ))}
          </div>

          <div className="relative" ref={bellRef}>
            <button
              type="button"
              onClick={() => setBellOpen((v) => !v)}
              className={cn(
                'relative grid size-9 place-items-center rounded-xl border transition',
                unacked.length
                  ? 'border-rose-400/30 bg-rose-500/10 text-rose-300'
                  : 'border-white/10 bg-white/4 text-haze-400 hover:text-haze-100',
              )}
            >
              {unacked.length ? <BellRing size={15} /> : <Bell size={15} />}
              {unacked.length > 0 && (
                <span className="mono absolute -right-1 -top-1 grid min-w-4 place-items-center rounded-full bg-rose-500 px-1 text-[9.5px] font-semibold text-void-950">
                  {unacked.length}
                </span>
              )}
            </button>

            {bellOpen && (
              <div className="glass-solid fade-scale absolute right-0 top-11 z-40 w-[330px] overflow-hidden rounded-2xl">
                <div className="flex items-center justify-between border-b border-white/8 px-3.5 py-2.5">
                  <div>
                    <p className="text-[12.5px] font-semibold text-haze-100">Alert stream</p>
                    <p className="text-[10.5px] text-haze-500">{unacked.length} unacknowledged</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => dispatch({ type: 'ACK_ALL' })}
                    className="btn btn-ghost !px-2 !py-1 text-[10.5px]"
                  >
                    <CheckCheck size={12} /> Ack all
                  </button>
                </div>
                <div className="max-h-[340px] overflow-y-auto">
                  {state.alerts.slice(0, 12).map((a) => {
                    const meta = SEVERITY_META[a.severity]
                    return (
                      <button
                        key={a.id}
                        type="button"
                        onClick={() => dispatch({ type: 'ACK_ALERT', id: a.id })}
                        className={cn(
                          'flex w-full gap-2.5 border-b border-white/5 px-3.5 py-2.5 text-left transition hover:bg-white/5',
                          a.acknowledged && 'opacity-55',
                        )}
                      >
                        <span
                          className="mt-1 size-2 shrink-0 rounded-full"
                          style={{ background: meta.color, boxShadow: `0 0 9px ${meta.color}` }}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center justify-between gap-2">
                            <span className="truncate text-[12px] font-medium text-haze-100">{a.title}</span>
                            <span className="mono shrink-0 text-[9.5px] text-haze-500">{timeAgo(a.timestamp)}</span>
                          </span>
                          <span className="mt-0.5 block truncate text-[10.5px] text-haze-500">{a.detail}</span>
                          <span className="mono mt-1 block text-[9.5px] text-cyan-300/70">{a.source}</span>
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ticker */}
      <div className="relative overflow-hidden border-t border-white/6 bg-void-950/60 py-1.5">
        <div className="marquee-track">
          {[0, 1].map((dup) => (
            <span key={dup} className="flex items-center">
              {state.lines.map((l) => {
                const meta = STATUS_META[l.status === 'optimal' ? 'running' : l.status === 'nominal' ? 'setup' : l.status === 'attention' ? 'idle' : l.status === 'critical' ? 'down' : 'setup']
                return (
                  <span key={`${dup}-${l.id}`} className="mono flex items-center gap-2 px-4 text-[10.5px] text-haze-400">
                    <span className="size-1.5 rounded-full" style={{ background: meta.color, boxShadow: `0 0 8px ${meta.color}` }} />
                    <span className="text-haze-300">{l.code}</span>
                    <span className="text-haze-500">{l.product}</span>
                    <span className="text-haze-200">OEE {l.oee.toFixed(1)}%</span>
                    <span className="text-haze-500">·</span>
                    <span className="text-haze-200">
                      {l.output.toLocaleString()}/{l.target.toLocaleString()}
                    </span>
                    <span className="text-cyan-300/60">|</span>
                  </span>
                )
              })}
              <span className="mono px-4 text-[10.5px] text-haze-500">
                CYCLE {kpis.throughput.toLocaleString()} u/h · ALERTS {kpis.openAlerts} · UPTIME{' '}
                {(state.uptimeSeconds / 3600).toFixed(0)}h
                <span className="px-2 text-cyan-300/60">|</span>
              </span>
            </span>
          ))}
        </div>
      </div>
    </header>
  )
}

/* -------------------------------------------------------------- toaster ---- */
export function Toaster() {
  const { state, dispatch } = usePlant()
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[318px] flex-col gap-2.5">
      {state.toasts.map((t) => {
        const meta = SEVERITY_META[t.tone as Severity]
        return (
          <div
            key={t.id}
            className="glass-solid slide-in-right pointer-events-auto relative overflow-hidden rounded-xl p-3 pl-3.5"
            style={{ borderColor: `${meta.color}44` }}
          >
            <span className="absolute inset-y-0 left-0 w-[3px]" style={{ background: meta.color, boxShadow: `0 0 12px ${meta.color}` }} />
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className={cn('text-[12.5px] font-medium', meta.text)}>{t.title}</p>
                <p className="mt-0.5 text-[11px] leading-snug text-haze-500">{t.detail}</p>
              </div>
              <button
                type="button"
                onClick={() => dispatch({ type: 'DISMISS_TOAST', id: t.id })}
                className="text-haze-500 transition hover:text-haze-100"
              >
                <X size={13} />
              </button>
            </div>
            <span
              className="toast-life absolute bottom-0 left-0 h-[2px] w-full"
              style={{ background: meta.color, boxShadow: `0 0 10px ${meta.color}` }}
            />
          </div>
        )
      })}
    </div>
  )
}

/* -------------------------------------------------------- command palette -- */
export function CommandPalette({
  open,
  onClose,
  onNavigate,
  extra,
}: {
  open: boolean
  onClose: () => void
  onNavigate: (id: string) => void
  extra?: ReactNode
}) {
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement | null>(null)
  const { state, dispatch } = usePlant()

  useEffect(() => {
    if (open) {
      setQuery('')
      window.setTimeout(() => inputRef.current?.focus(), 30)
    }
  }, [open])

  if (!open) return null

  const results = NAV_ITEMS.filter(
    (i) =>
      i.label.toLowerCase().includes(query.toLowerCase()) ||
      i.hint.toLowerCase().includes(query.toLowerCase()),
  )

  const machines = state.machines.filter(
    (m) =>
      query.length > 0 &&
      (m.name.toLowerCase().includes(query.toLowerCase()) || m.code.toLowerCase().includes(query.toLowerCase())),
  )

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center p-4 pt-[12vh]">
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 cursor-default bg-void-950/80 backdrop-blur-md" />
      <div className="glass-solid fade-scale beam relative w-full max-w-xl overflow-hidden rounded-2xl">
        <div className="flex items-center gap-2.5 border-b border-white/8 px-4 py-3">
          <Search size={16} className="text-cyan-300" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Jump to a module or search a station…"
            className="flex-1 bg-transparent text-[13px] outline-none placeholder:text-haze-500"
          />
          <span className="kbd">ESC</span>
        </div>
        <div className="max-h-[50vh] overflow-y-auto p-2">
          <p className="label-cap px-2 py-1.5 text-haze-500">Modules</p>
          {results.map((r) => {
            const Icon = r.icon
            return (
              <button
                key={r.id}
                type="button"
                onClick={() => {
                  onNavigate(r.id)
                  onClose()
                }}
                className="flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition hover:bg-white/6"
              >
                <span className="grid size-7 place-items-center rounded-lg border border-white/10" style={{ color: r.accent }}>
                  <Icon size={14} />
                </span>
                <span className="flex-1">
                  <span className="block text-[12.5px] text-haze-100">{r.label}</span>
                  <span className="block text-[10.5px] text-haze-500">{r.hint}</span>
                </span>
              </button>
            )
          })}
          {machines.length > 0 && (
            <>
              <p className="label-cap px-2 pb-1.5 pt-3 text-haze-500">Stations</p>
              {machines.slice(0, 6).map((m) => {
                const meta = STATUS_META[m.status]
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => {
                      onNavigate('lines')
                      onClose()
                    }}
                    className="flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition hover:bg-white/6"
                  >
                    <span className="grid size-7 place-items-center rounded-lg border border-white/10 text-haze-300">
                      <Cpu size={13} />
                    </span>
                    <span className="flex-1">
                      <span className="block text-[12.5px] text-haze-100">
                        {m.code} · {m.name}
                      </span>
                      <span className="mono block text-[10.5px]" style={{ color: meta.color }}>
                        {meta.label} · health {m.health.toFixed(0)}%
                      </span>
                    </span>
                  </button>
                )
              })}
            </>
          )}
          <p className="label-cap px-2 pb-1.5 pt-3 text-haze-500">Quick actions</p>
          <button
            type="button"
            onClick={() => dispatch({ type: 'SET_RUNNING', running: !state.running })}
            className="flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition hover:bg-white/6"
          >
            <span className="grid size-7 place-items-center rounded-lg border border-white/10 text-emerald-300">
              {state.running ? <Pause size={13} /> : <Play size={13} />}
            </span>
            <span className="text-[12.5px] text-haze-100">{state.running ? 'Pause live telemetry' : 'Resume live telemetry'}</span>
          </button>
          <button
            type="button"
            onClick={() => dispatch({ type: 'ACK_ALL' })}
            className="flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition hover:bg-white/6"
          >
            <span className="grid size-7 place-items-center rounded-lg border border-white/10 text-cyan-300">
              <CheckCheck size={13} />
            </span>
            <span className="text-[12.5px] text-haze-100">Acknowledge every open alert</span>
          </button>
          {extra}
        </div>
      </div>
    </div>
  )
}
