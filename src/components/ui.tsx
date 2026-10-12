import type { ReactNode } from 'react'
import { cn, toneColor } from '../lib/utils'
import {
  ArrowDownRight,
  ArrowUpRight,
  Minus,
  type LucideIcon,
} from 'lucide-react'

/* ------------------------------------------------------------------ panel -- */
export function Panel({
  children,
  className,
  glow = false,
  beam = false,
  bare = false,
}: {
  children: ReactNode
  className?: string
  glow?: boolean
  beam?: boolean
  bare?: boolean
}) {
  return (
    <section
      className={cn(
        'glass relative overflow-hidden rounded-2xl',
        !bare && 'p-4',
        beam && 'beam',
        glow && 'shadow-[0_0_60px_-30px_rgba(34,211,238,0.8)]',
        className,
      )}
    >
      {children}
    </section>
  )
}

export function PanelHeader({
  title,
  subtitle,
  icon: Icon,
  actions,
  accent = '#22d3ee',
  className,
}: {
  title: string
  subtitle?: string
  icon?: LucideIcon
  actions?: ReactNode
  accent?: string
  className?: string
}) {
  return (
    <header className={cn('mb-3.5 flex items-start justify-between gap-3', className)}>
      <div className="flex min-w-0 items-start gap-2.5">
        {Icon && (
          <span
            className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-xl border border-white/10"
            style={{
              background: `linear-gradient(140deg, ${accent}2e, transparent 70%)`,
              boxShadow: `inset 0 0 18px ${accent}22`,
              color: accent,
            }}
          >
            <Icon size={15} strokeWidth={1.9} />
          </span>
        )}
        <div className="min-w-0">
          <h3 className="truncate text-[13.5px] font-semibold tracking-tight text-haze-100">{title}</h3>
          {subtitle && <p className="mt-0.5 truncate text-[11px] text-haze-500">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex shrink-0 items-center gap-1.5">{actions}</div>}
    </header>
  )
}

/* ------------------------------------------------------------------ chips -- */
export function Chip({
  children,
  tone = 'haze',
  className,
  icon: Icon,
  dot = false,
}: {
  children: ReactNode
  tone?: 'haze' | 'cyan' | 'violet' | 'emerald' | 'amber' | 'rose' | 'blue' | 'orange'
  className?: string
  icon?: LucideIcon
  dot?: boolean
}) {
  const map: Record<string, string> = {
    haze: 'border-white/12 bg-white/6 text-haze-300',
    cyan: 'border-cyan-400/30 bg-cyan-500/12 text-cyan-300',
    violet: 'border-violet-400/30 bg-violet-500/12 text-violet-300',
    emerald: 'border-emerald-400/30 bg-emerald-500/12 text-emerald-300',
    amber: 'border-amber-400/30 bg-amber-500/12 text-amber-300',
    rose: 'border-rose-400/30 bg-rose-500/12 text-rose-300',
    blue: 'border-blue-400/30 bg-blue-500/12 text-blue-300',
    orange: 'border-orange-400/30 bg-orange-500/12 text-orange-300',
  }
  return (
    <span className={cn('chip', map[tone], className)}>
      {dot && <span className="size-1.5 rounded-full bg-current" />}
      {Icon && <Icon size={11.5} strokeWidth={2.1} />}
      {children}
    </span>
  )
}

export function StatusDot({ color, pulse = true, className }: { color: string; pulse?: boolean; className?: string }) {
  return (
    <span
      className={cn('relative inline-flex size-2 rounded-full', pulse && 'pulse-dot', className)}
      style={{ background: color, color, boxShadow: `0 0 10px ${color}` }}
    />
  )
}

/* ------------------------------------------------------------------- stat -- */
export function Stat({
  label,
  value,
  unit,
  delta,
  deltaSuffix = '%',
  icon: Icon,
  tone = 'cyan',
  hint,
  spark,
  progress,
  className,
  invertDelta = false,
}: {
  label: string
  value: string | number
  unit?: string
  delta?: number
  deltaSuffix?: string
  icon?: LucideIcon
  tone?: string
  hint?: string
  spark?: ReactNode
  progress?: number
  className?: string
  invertDelta?: boolean
}) {
  const color = toneColor(tone)
  const good = delta === undefined ? null : invertDelta ? delta <= 0 : delta >= 0
  const DeltaIcon = delta === undefined || Math.abs(delta) < 0.05 ? Minus : delta > 0 ? ArrowUpRight : ArrowDownRight
  return (
    <Panel className={cn('lift group', className)} bare>
      <div
        className="pointer-events-none absolute -right-10 -top-12 size-32 rounded-full opacity-40 blur-2xl transition-opacity duration-500 group-hover:opacity-70"
        style={{ background: `radial-gradient(circle, ${color}55, transparent 70%)` }}
      />
      <div className="relative p-3.5">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            {Icon && (
              <span
                className="grid size-7 place-items-center rounded-lg border border-white/10"
                style={{ background: `linear-gradient(140deg,${color}2e,transparent)`, color }}
              >
                <Icon size={13.5} strokeWidth={1.9} />
              </span>
            )}
            <span className="label-cap text-haze-500">{label}</span>
          </div>
          {delta !== undefined && (
            <span
              className={cn(
                'mono inline-flex items-center gap-0.5 rounded-md border px-1.5 py-0.5 text-[10.5px]',
                good ? 'border-emerald-400/25 bg-emerald-500/10 text-emerald-300' : 'border-rose-400/25 bg-rose-500/10 text-rose-300',
              )}
            >
              <DeltaIcon size={11} strokeWidth={2.4} />
              {Math.abs(delta).toFixed(1)}
              {deltaSuffix}
            </span>
          )}
        </div>

        <div className="mt-3 flex items-end justify-between gap-3">
          <div className="flex items-baseline gap-1">
            <span className="mono text-[26px] font-semibold leading-none tracking-tight text-haze-100">{value}</span>
            {unit && <span className="mono text-[11px] text-haze-500">{unit}</span>}
          </div>
          {spark && <div className="h-8 w-20 shrink-0 opacity-90">{spark}</div>}
        </div>

        {progress !== undefined && (
          <div className="track mt-3">
            <span
              style={{
                width: `${Math.max(2, Math.min(100, progress))}%`,
                background: `linear-gradient(90deg, ${color}bb, ${color})`,
                boxShadow: `0 0 12px ${color}99`,
              }}
            />
          </div>
        )}
        {hint && <p className="mt-2 text-[10.5px] leading-tight text-haze-500">{hint}</p>}
      </div>
    </Panel>
  )
}

/* ------------------------------------------------------------------ gauge -- */
export function Gauge({
  value,
  max = 100,
  size = 132,
  tone = 'cyan',
  label,
  sublabel,
  thickness = 9,
  children,
}: {
  value: number
  max?: number
  size?: number
  tone?: string
  label?: string
  sublabel?: string
  thickness?: number
  children?: ReactNode
}) {
  const color = toneColor(tone)
  const r = (size - thickness * 2) / 2
  const c = 2 * Math.PI * r
  const ratio = Math.max(0, Math.min(1, value / max))
  const id = `g-${tone}-${size}`

  return (
    <div className="relative grid place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.55" />
            <stop offset="100%" stopColor={color} />
          </linearGradient>
          <filter id={`${id}-glow`}>
            <feGaussianBlur stdDeviation="4.2" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="rgba(255,255,255,0.07)"
          strokeWidth={thickness}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={`url(#${id})`}
          strokeWidth={thickness}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - ratio)}
          filter={`url(#${id}-glow)`}
          style={{ transition: 'stroke-dashoffset 0.9s cubic-bezier(0.22,1,0.36,1)' }}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r - thickness * 1.6}
          fill="none"
          stroke="rgba(255,255,255,0.05)"
          strokeWidth={1}
          strokeDasharray="2 5"
        />
      </svg>
      <div className="absolute grid place-items-center text-center">
        {children ?? (
          <>
            <span className="mono text-[25px] font-semibold leading-none" style={{ color }}>
              {value.toFixed(1)}
              <span className="text-[12px] text-haze-500">%</span>
            </span>
            {label && <span className="label-cap mt-1.5 text-haze-500">{label}</span>}
            {sublabel && <span className="mono mt-1 text-[10px] text-haze-400">{sublabel}</span>}
          </>
        )}
      </div>
    </div>
  )
}

/* --------------------------------------------------------------- segmented -- */
export function Seg<T extends string>({
  options,
  value,
  onChange,
  className,
}: {
  options: Array<{ value: T; label: string }>
  value: T
  onChange: (v: T) => void
  className?: string
}) {
  return (
    <div className={cn('seg', className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className="seg-item"
          data-active={o.value === value}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/* ------------------------------------------------------------------ modal -- */
export function Modal({
  open,
  onClose,
  title,
  subtitle,
  icon: Icon,
  children,
  footer,
  width = 'max-w-2xl',
}: {
  open: boolean
  onClose: () => void
  title: string
  subtitle?: string
  icon?: LucideIcon
  children: ReactNode
  footer?: ReactNode
  width?: string
}) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-void-950/80 backdrop-blur-md"
      />
      <div className={cn('glass-solid fade-scale beam relative z-10 w-full overflow-hidden rounded-2xl', width)}>
        <div className="flex items-start justify-between gap-4 border-b border-white/8 px-5 py-4">
          <div className="flex items-start gap-3">
            {Icon && (
              <span className="grid size-9 place-items-center rounded-xl border border-cyan-400/25 bg-cyan-500/10 text-cyan-300">
                <Icon size={16} strokeWidth={1.9} />
              </span>
            )}
            <div>
              <h2 className="text-[15px] font-semibold tracking-tight text-haze-100">{title}</h2>
              {subtitle && <p className="mt-0.5 text-[11.5px] text-haze-500">{subtitle}</p>}
            </div>
          </div>
          <button type="button" onClick={onClose} className="btn btn-ghost !px-2 !py-1 text-[11px]">
            ESC
          </button>
        </div>
        <div className="max-h-[64vh] overflow-y-auto px-5 py-4">{children}</div>
        {footer && (
          <div className="flex items-center justify-end gap-2 border-t border-white/8 bg-white/2 px-5 py-3.5">{footer}</div>
        )}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ misc --- */
export function InfoRow({ label, value, tone }: { label: string; value: ReactNode; tone?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-white/5 py-2 last:border-0">
      <span className="label-cap text-haze-500">{label}</span>
      <span className={cn('mono text-[12px]', tone ?? 'text-haze-200')}>{value}</span>
    </div>
  )
}

export function Meter({
  value,
  tone = 'cyan',
  height = 6,
  showGlow = true,
}: {
  value: number
  tone?: string
  height?: number
  showGlow?: boolean
}) {
  const color = toneColor(tone)
  return (
    <div className="track" style={{ height }}>
      <span
        style={{
          width: `${Math.max(1.5, Math.min(100, value))}%`,
          background: `linear-gradient(90deg, ${color}99, ${color})`,
          boxShadow: showGlow ? `0 0 12px ${color}aa` : undefined,
        }}
      />
    </div>
  )
}

export function SectionTitle({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow: string
  title: string
  description?: string
  actions?: ReactNode
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
      <div className="rise">
        <div className="mb-2 flex items-center gap-2">
          <span className="h-px w-6 bg-gradient-to-r from-cyan-400 to-transparent" />
          <span className="label-cap text-cyan-300/80">{eyebrow}</span>
        </div>
        <h1 className="text-[22px] font-semibold leading-tight tracking-tight text-haze-100 sm:text-[26px]">{title}</h1>
        {description && <p className="mt-1.5 max-w-2xl text-[12.5px] leading-relaxed text-haze-500">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

export function Empty({ label, hint }: { label: string; hint?: string }) {
  return (
    <div className="grid place-items-center gap-1 rounded-xl border border-dashed border-white/10 py-10 text-center">
      <p className="text-[12.5px] text-haze-400">{label}</p>
      {hint && <p className="text-[11px] text-haze-500">{hint}</p>}
    </div>
  )
}
