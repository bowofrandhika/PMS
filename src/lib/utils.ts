import type { MachineStatus, Priority, OrderStatus, Severity, LineStatus } from './types'

export const clamp = (v: number, min = 0, max = 100) => Math.min(max, Math.max(min, v))
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t

/** Deterministic PRNG so the demo plant looks identical on every reload. */
export function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const num = (v: number, digits = 0) =>
  v.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })

export const pct = (v: number, digits = 1) => `${v.toFixed(digits)}%`

export function compact(v: number) {
  if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`
  if (Math.abs(v) >= 1_000) return `${(v / 1_000).toFixed(1)}k`
  return num(v)
}

export function clockTime(d: Date) {
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

export function dateTime(d: Date) {
  return d.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function timeAgo(ts: number, now = Date.now()) {
  const s = Math.max(0, Math.round((now - ts) / 1000))
  if (s < 60) return `${s}s ago`
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.round(h / 24)}d ago`
}

export function duration(min: number) {
  if (min < 60) return `${Math.round(min)}m`
  const h = Math.floor(min / 60)
  const m = Math.round(min % 60)
  return m ? `${h}h ${m}m` : `${h}h`
}

export function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ')
}

/** Catmull-Rom → cubic bezier smoothing for the SVG line charts. */
export function smoothPath(points: Array<[number, number]>, tension = 0.22) {
  if (points.length < 2) return ''
  let d = `M ${points[0][0]} ${points[0][1]}`
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i]
    const p1 = points[i]
    const p2 = points[i + 1]
    const p3 = points[i + 2] ?? p2
    const c1x = p1[0] + (p2[0] - p0[0]) * tension
    const c1y = p1[1] + (p2[1] - p0[1]) * tension
    const c2x = p2[0] - (p3[0] - p1[0]) * tension
    const c2y = p2[1] - (p3[1] - p1[1]) * tension
    d += ` C ${c1x.toFixed(2)} ${c1y.toFixed(2)}, ${c2x.toFixed(2)} ${c2y.toFixed(2)}, ${p2[0].toFixed(2)} ${p2[1].toFixed(2)}`
  }
  return d
}

/* ---------------------------------------------------------------- palettes */
export const STATUS_META: Record<
  MachineStatus,
  { label: string; color: string; text: string; bg: string; ring: string; dot: string }
> = {
  running: {
    label: 'Running',
    color: '#34d399',
    text: 'text-emerald-300',
    bg: 'bg-emerald-500/12',
    ring: 'border-emerald-400/35',
    dot: 'bg-emerald-400',
  },
  idle: {
    label: 'Idle',
    color: '#fbbf24',
    text: 'text-amber-300',
    bg: 'bg-amber-500/12',
    ring: 'border-amber-400/35',
    dot: 'bg-amber-400',
  },
  setup: {
    label: 'Setup / Changeover',
    color: '#60a5fa',
    text: 'text-blue-300',
    bg: 'bg-blue-500/12',
    ring: 'border-blue-400/35',
    dot: 'bg-blue-400',
  },
  maintenance: {
    label: 'Maintenance',
    color: '#c084fc',
    text: 'text-purple-300',
    bg: 'bg-purple-500/12',
    ring: 'border-purple-400/35',
    dot: 'bg-purple-400',
  },
  down: {
    label: 'Down',
    color: '#fb7185',
    text: 'text-rose-300',
    bg: 'bg-rose-500/12',
    ring: 'border-rose-400/35',
    dot: 'bg-rose-400',
  },
}

export const LINE_META: Record<LineStatus, { label: string; color: string; text: string; bg: string; ring: string }> = {
  optimal: { label: 'Optimal', color: '#34d399', text: 'text-emerald-300', bg: 'bg-emerald-500/12', ring: 'border-emerald-400/35' },
  nominal: { label: 'Nominal', color: '#22d3ee', text: 'text-cyan-300', bg: 'bg-cyan-500/12', ring: 'border-cyan-400/35' },
  attention: { label: 'Attention', color: '#fbbf24', text: 'text-amber-300', bg: 'bg-amber-500/12', ring: 'border-amber-400/35' },
  critical: { label: 'Critical', color: '#fb7185', text: 'text-rose-300', bg: 'bg-rose-500/12', ring: 'border-rose-400/35' },
  offline: { label: 'Offline', color: '#8592b6', text: 'text-haze-400', bg: 'bg-white/5', ring: 'border-white/12' },
}

export const PRIORITY_META: Record<Priority, { label: string; text: string; bg: string; ring: string; color: string }> = {
  critical: { label: 'Critical', text: 'text-rose-300', bg: 'bg-rose-500/12', ring: 'border-rose-400/35', color: '#fb7185' },
  high: { label: 'High', text: 'text-orange-300', bg: 'bg-orange-500/12', ring: 'border-orange-400/35', color: '#fb923c' },
  medium: { label: 'Medium', text: 'text-cyan-300', bg: 'bg-cyan-500/12', ring: 'border-cyan-400/35', color: '#22d3ee' },
  low: { label: 'Low', text: 'text-haze-300', bg: 'bg-white/6', ring: 'border-white/12', color: '#a9b4d0' },
}

export const ORDER_META: Record<OrderStatus, { label: string; text: string; bg: string; ring: string; color: string }> = {
  queued: { label: 'Queued', text: 'text-haze-300', bg: 'bg-white/6', ring: 'border-white/12', color: '#a9b4d0' },
  running: { label: 'In Progress', text: 'text-cyan-300', bg: 'bg-cyan-500/12', ring: 'border-cyan-400/35', color: '#22d3ee' },
  blocked: { label: 'Blocked', text: 'text-rose-300', bg: 'bg-rose-500/12', ring: 'border-rose-400/35', color: '#fb7185' },
  quality: { label: 'Quality Hold', text: 'text-amber-300', bg: 'bg-amber-500/12', ring: 'border-amber-400/35', color: '#fbbf24' },
  done: { label: 'Complete', text: 'text-emerald-300', bg: 'bg-emerald-500/12', ring: 'border-emerald-400/35', color: '#34d399' },
}

export const SEVERITY_META: Record<Severity, { text: string; bg: string; ring: string; color: string; icon: string }> = {
  critical: { text: 'text-rose-300', bg: 'bg-rose-500/12', ring: 'border-rose-400/35', color: '#fb7185', icon: 'alert' },
  warning: { text: 'text-amber-300', bg: 'bg-amber-500/12', ring: 'border-amber-400/35', color: '#fbbf24', icon: 'warn' },
  info: { text: 'text-cyan-300', bg: 'bg-cyan-500/12', ring: 'border-cyan-400/35', color: '#22d3ee', icon: 'info' },
  success: { text: 'text-emerald-300', bg: 'bg-emerald-500/12', ring: 'border-emerald-400/35', color: '#34d399', icon: 'ok' },
}

export const TONE_GRADIENT: Record<string, string> = {
  cyan: 'linear-gradient(120deg,#22d3ee,#60a5fa)',
  violet: 'linear-gradient(120deg,#a855f7,#6366f1)',
  emerald: 'linear-gradient(120deg,#34d399,#22d3ee)',
  amber: 'linear-gradient(120deg,#fbbf24,#fb923c)',
  rose: 'linear-gradient(120deg,#fb7185,#a855f7)',
  blue: 'linear-gradient(120deg,#60a5fa,#a855f7)',
}

export const TONE_STROKE: Record<string, string> = {
  cyan: '#22d3ee',
  violet: '#a855f7',
  emerald: '#34d399',
  amber: '#fbbf24',
  rose: '#fb7185',
  blue: '#60a5fa',
  teal: '#2dd4bf',
  lime: '#a3e635',
  indigo: '#818cf8',
  pink: '#f472b6',
  orange: '#fb923c',
}

export function toneColor(tone: string) {
  return TONE_STROKE[tone] ?? TONE_STROKE.cyan
}

export function healthTone(v: number) {
  if (v >= 88) return 'emerald'
  if (v >= 75) return 'cyan'
  if (v >= 62) return 'amber'
  return 'rose'
}

export function oeeTone(v: number) {
  if (v >= 85) return 'emerald'
  if (v >= 75) return 'cyan'
  if (v >= 65) return 'amber'
  return 'rose'
}
