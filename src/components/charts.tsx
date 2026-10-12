import { useEffect, useMemo, useRef, useState } from 'react'
import { cn, smoothPath, toneColor } from '../lib/utils'

/* ------------------------------------------------------------ size hook ---- */
export function useSize<T extends HTMLElement>() {
  const ref = useRef<T | null>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const update = () => setSize({ w: el.clientWidth, h: el.clientHeight })
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, size] as const
}

/* -------------------------------------------------------------- sparkline -- */
export function Sparkline({
  data,
  tone = 'cyan',
  height = 32,
  fill = true,
  className,
}: {
  data: number[]
  tone?: string
  height?: number
  fill?: boolean
  className?: string
}) {
  const color = toneColor(tone)
  const w = 100
  const h = height
  if (!data.length) return <div style={{ height }} />
  const min = Math.min(...data)
  const max = Math.max(...data)
  const span = max - min || 1
  const pts: Array<[number, number]> = data.map((v, i) => [
    (i / Math.max(1, data.length - 1)) * w,
    h - 3 - ((v - min) / span) * (h - 8),
  ])
  const d = smoothPath(pts, 0.18)
  const gid = `sp-${tone}-${Math.round(min * 100)}-${data.length}`
  const last = pts[pts.length - 1]
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className={cn('h-full w-full', className)}>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.5" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {fill && <path d={`${d} L ${w} ${h} L 0 ${h} Z`} fill={`url(#${gid})`} />}
      <path d={d} fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      <circle cx={last[0]} cy={last[1]} r="2" fill={color} />
    </svg>
  )
}

/* ---------------------------------------------------------- area line chart -- */
export interface Series {
  key: string
  label: string
  color: string
  values: number[]
  dashed?: boolean
  area?: boolean
}

export function AreaLineChart({
  series,
  labels,
  height = 240,
  target,
  targetLabel = 'Target',
  unit = '',
  yTicks = 4,
  digits = 1,
  showLegend = true,
  className,
}: {
  series: Series[]
  labels: string[]
  height?: number
  target?: number
  targetLabel?: string
  unit?: string
  yTicks?: number
  digits?: number
  showLegend?: boolean
  className?: string
}) {
  const [ref, { w }] = useSize<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)

  const padL = 40
  const padR = 12
  const padT = 12
  const padB = 24
  const innerW = Math.max(10, w - padL - padR)
  const innerH = height - padT - padB

  const all = useMemo(
    () => series.flatMap((s) => s.values).concat(target !== undefined ? [target] : []),
    [series, target],
  )
  const rawMin = Math.min(...all)
  const rawMax = Math.max(...all)
  const pad = (rawMax - rawMin) * 0.14 || 2
  const min = Math.max(0, rawMin - pad)
  const max = rawMax + pad
  const span = max - min || 1

  const x = (i: number) => padL + (i / Math.max(1, labels.length - 1)) * innerW
  const y = (v: number) => padT + innerH - ((v - min) / span) * innerH

  const ticks = Array.from({ length: yTicks + 1 }, (_, i) => min + (span * i) / yTicks)

  return (
    <div className={cn('relative', className)} ref={ref} style={{ height }}>
      {w > 0 && (
        <svg
          width={w}
          height={height}
          onMouseLeave={() => setHover(null)}
          onMouseMove={(e) => {
            const rect = e.currentTarget.getBoundingClientRect()
            const rel = e.clientX - rect.left - padL
            const idx = Math.round((rel / innerW) * (labels.length - 1))
            setHover(Math.max(0, Math.min(labels.length - 1, idx)))
          }}
        >
          <defs>
            {series.map((s) => (
              <linearGradient key={s.key} id={`area-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={s.color} stopOpacity="0.42" />
                <stop offset="78%" stopColor={s.color} stopOpacity="0.02" />
              </linearGradient>
            ))}
          </defs>

          {/* horizontal grid + y labels */}
          {ticks.map((t, i) => (
            <g key={i}>
              <line
                x1={padL}
                x2={w - padR}
                y1={y(t)}
                y2={y(t)}
                stroke="rgba(255,255,255,0.06)"
                strokeDasharray={i === 0 ? undefined : '3 6'}
              />
              <text x={padL - 8} y={y(t) + 3.5} textAnchor="end" className="mono" fontSize="9" fill="#626f94">
                {t.toFixed(digits)}
              </text>
            </g>
          ))}

          {/* target line */}
          {target !== undefined && (
            <g>
              <line
                x1={padL}
                x2={w - padR}
                y1={y(target)}
                y2={y(target)}
                stroke="#a3e635"
                strokeWidth="1.1"
                strokeDasharray="5 5"
                opacity="0.65"
              />
              <text x={w - padR - 4} y={y(target) - 5} textAnchor="end" fontSize="9" fill="#a3e635" className="mono">
                {targetLabel} {target}
                {unit}
              </text>
            </g>
          )}

          {/* x labels */}
          {labels.map((l, i) =>
            labels.length > 14 && i % 2 !== 0 ? null : (
              <text key={l + i} x={x(i)} y={height - 6} textAnchor="middle" fontSize="9" fill="#626f94" className="mono">
                {l}
              </text>
            ),
          )}

          {/* series */}
          {series.map((s, si) => {
            const pts: Array<[number, number]> = s.values.map((v, i) => [x(i), y(v)])
            const d = smoothPath(pts, 0.2)
            return (
              <g key={s.key}>
                {s.area !== false && (
                  <path d={`${d} L ${x(s.values.length - 1)} ${padT + innerH} L ${padL} ${padT + innerH} Z`} fill={`url(#area-${s.key})`} />
                )}
                <path
                  d={d}
                  fill="none"
                  stroke={s.color}
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeDasharray={s.dashed ? '4 4' : undefined}
                  className={si === 0 ? 'draw-line' : undefined}
                  style={{ ['--len' as string]: '1600', filter: `drop-shadow(0 0 6px ${s.color}66)` }}
                />
              </g>
            )
          })}

          {/* hover crosshair */}
          {hover !== null && (
            <g>
              <line x1={x(hover)} x2={x(hover)} y1={padT} y2={padT + innerH} stroke="rgba(255,255,255,0.28)" strokeDasharray="3 3" />
              {series.map((s) => (
                <circle
                  key={s.key}
                  cx={x(hover)}
                  cy={y(s.values[hover] ?? 0)}
                  r="3.4"
                  fill="#04060e"
                  stroke={s.color}
                  strokeWidth="2"
                />
              ))}
            </g>
          )}
        </svg>
      )}

      {hover !== null && w > 0 && (
        <div
          className="glass-solid pointer-events-none absolute z-10 min-w-[132px] rounded-xl px-2.5 py-2 text-[11px]"
          style={{
            left: Math.min(Math.max(x(hover) + 12, 8), Math.max(8, w - 148)),
            top: 6,
          }}
        >
          <p className="label-cap mb-1.5 text-haze-500">{labels[hover]}</p>
          {series.map((s) => (
            <div key={s.key} className="flex items-center justify-between gap-3 py-0.5">
              <span className="flex items-center gap-1.5 text-haze-400">
                <span className="size-1.5 rounded-full" style={{ background: s.color, boxShadow: `0 0 8px ${s.color}` }} />
                {s.label}
              </span>
              <span className="mono text-haze-100">
                {(s.values[hover] ?? 0).toFixed(digits)}
                {unit}
              </span>
            </div>
          ))}
        </div>
      )}

      {showLegend && (
        <div className="mt-1 flex flex-wrap items-center gap-3 px-1">
          {series.map((s) => (
            <span key={s.key} className="flex items-center gap-1.5 text-[10.5px] text-haze-400">
              <span className="h-0.5 w-4 rounded-full" style={{ background: s.color, boxShadow: `0 0 8px ${s.color}` }} />
              {s.label}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------- bars -- */
export function BarChart({
  labels,
  series,
  height = 200,
  unit = '',
  target,
  className,
}: {
  labels: string[]
  series: Array<{ key: string; label: string; color: string; values: number[] }>
  height?: number
  unit?: string
  target?: number
  className?: string
}) {
  const [ref, { w }] = useSize<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)
  const padL = 38
  const padR = 10
  const padT = 10
  const padB = 22
  const innerW = Math.max(10, w - padL - padR)
  const innerH = height - padT - padB

  const max = Math.max(...series.flatMap((s) => s.values), target ?? 0) * 1.12 || 1
  const group = innerW / Math.max(1, labels.length)
  const barW = Math.max(3, (group * 0.62) / series.length)

  return (
    <div className={cn('relative', className)} ref={ref} style={{ height }}>
      {w > 0 && (
        <svg width={w} height={height} onMouseLeave={() => setHover(null)}>
          <defs>
            {series.map((s) => (
              <linearGradient key={s.key} id={`bar-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={s.color} stopOpacity="1" />
                <stop offset="100%" stopColor={s.color} stopOpacity="0.28" />
              </linearGradient>
            ))}
          </defs>
          {[0, 0.25, 0.5, 0.75, 1].map((t) => (
            <g key={t}>
              <line
                x1={padL}
                x2={w - padR}
                y1={padT + innerH * t}
                y2={padT + innerH * t}
                stroke="rgba(255,255,255,0.055)"
                strokeDasharray={t === 1 ? undefined : '3 6'}
              />
              <text x={padL - 7} y={padT + innerH * t + 3.5} textAnchor="end" fontSize="9" fill="#626f94" className="mono">
                {Math.round(max * (1 - t))}
              </text>
            </g>
          ))}
          {target !== undefined && (
            <line
              x1={padL}
              x2={w - padR}
              y1={padT + innerH - (target / max) * innerH}
              y2={padT + innerH - (target / max) * innerH}
              stroke="#a3e635"
              strokeDasharray="5 5"
              opacity="0.6"
            />
          )}
          {labels.map((l, i) => {
            const gx = padL + group * i
            return (
              <g key={l + i} onMouseEnter={() => setHover(i)}>
                <rect x={gx} y={padT} width={group} height={innerH} fill="transparent" />
                {series.map((s, si) => {
                  const v = s.values[i] ?? 0
                  const bh = Math.max(1, (v / max) * innerH)
                  const bx = gx + group / 2 - (barW * series.length) / 2 + si * barW
                  return (
                    <g key={s.key}>
                      <rect
                        x={bx + 1}
                        y={padT + innerH - bh}
                        width={barW - 2}
                        height={bh}
                        rx={Math.min(4, barW / 2)}
                        fill={`url(#bar-${s.key})`}
                        className="bar-grow"
                        style={{ animationDelay: `${i * 45}ms`, opacity: hover === null || hover === i ? 1 : 0.42 }}
                      />
                    </g>
                  )
                })}
                <text x={gx + group / 2} y={height - 6} textAnchor="middle" fontSize="9" fill="#626f94" className="mono">
                  {l}
                </text>
              </g>
            )
          })}
        </svg>
      )}
      {hover !== null && w > 0 && (
        <div className="glass-solid pointer-events-none absolute right-2 top-1 z-10 rounded-xl px-2.5 py-2 text-[11px]">
          <p className="label-cap mb-1 text-haze-500">{labels[hover]}</p>
          {series.map((s) => (
            <div key={s.key} className="flex items-center justify-between gap-3 py-0.5">
              <span className="flex items-center gap-1.5 text-haze-400">
                <span className="size-1.5 rounded-full" style={{ background: s.color }} />
                {s.label}
              </span>
              <span className="mono text-haze-100">
                {(s.values[hover] ?? 0).toLocaleString()}
                {unit}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------- horizontal -- */
export function HBars({
  items,
  max,
  unit = '',
  className,
}: {
  items: Array<{ label: string; value: number; tone?: string; hint?: string }>
  max?: number
  unit?: string
  className?: string
}) {
  const peak = max ?? Math.max(...items.map((i) => i.value), 1)
  return (
    <div className={cn('space-y-2.5', className)}>
      {items.map((item, idx) => {
        const color = toneColor(item.tone ?? 'cyan')
        return (
          <div key={item.label} className="rise" style={{ animationDelay: `${idx * 55}ms` }}>
            <div className="mb-1 flex items-center justify-between gap-3 text-[11.5px]">
              <span className="truncate text-haze-300">{item.label}</span>
              <span className="mono shrink-0 text-haze-200">
                {item.value.toLocaleString()}
                {unit}
                {item.hint && <span className="ml-1.5 text-[10px] text-haze-500">{item.hint}</span>}
              </span>
            </div>
            <div className="track" style={{ height: 7 }}>
              <span
                style={{
                  width: `${Math.max(2, (item.value / peak) * 100)}%`,
                  background: `linear-gradient(90deg, ${color}88, ${color})`,
                  boxShadow: `0 0 14px ${color}99`,
                }}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}

/* ------------------------------------------------------------------ donut -- */
export function Donut({
  segments,
  size = 168,
  thickness = 16,
  centerLabel,
  centerValue,
  className,
}: {
  segments: Array<{ label: string; value: number; color: string }>
  size?: number
  thickness?: number
  centerLabel?: string
  centerValue?: string
  className?: string
}) {
  const total = segments.reduce((s, x) => s + x.value, 0) || 1
  const r = (size - thickness) / 2
  const c = 2 * Math.PI * r
  let offset = 0
  return (
    <div className={cn('relative grid place-items-center', className)} style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={thickness} />
        {segments.map((s) => {
          const len = (s.value / total) * c
          const el = (
            <circle
              key={s.label}
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              stroke={s.color}
              strokeWidth={thickness}
              strokeLinecap="round"
              strokeDasharray={`${Math.max(0, len - 3)} ${c - len + 3}`}
              strokeDashoffset={-offset}
              style={{ filter: `drop-shadow(0 0 7px ${s.color}88)`, transition: 'stroke-dasharray 0.8s ease' }}
            />
          )
          offset += len
          return el
        })}
      </svg>
      <div className="absolute grid place-items-center text-center">
        {centerValue && <span className="mono text-[22px] font-semibold text-haze-100">{centerValue}</span>}
        {centerLabel && <span className="label-cap mt-1 text-haze-500">{centerLabel}</span>}
      </div>
    </div>
  )
}

/* -------------------------------------------------------------- spc chart -- */
export function SpcChart({ samples, height = 180 }: { samples: Array<{ index: number; value: number; mean: number; ucl: number; lcl: number }>; height?: number }) {
  const [ref, { w }] = useSize<HTMLDivElement>()
  const padL = 34
  const padR = 10
  const padT = 10
  const padB = 18
  const innerW = Math.max(10, w - padL - padR)
  const innerH = height - padT - padB
  const min = Math.min(...samples.map((s) => s.lcl)) - 0.6
  const max = Math.max(...samples.map((s) => s.ucl)) + 0.6
  const x = (i: number) => padL + (i / Math.max(1, samples.length - 1)) * innerW
  const y = (v: number) => padT + innerH - ((v - min) / (max - min)) * innerH
  const pts: Array<[number, number]> = samples.map((s, i) => [x(i), y(s.value)])
  const d = smoothPath(pts, 0.16)
  const mean = samples[0]?.mean ?? 0
  const ucl = samples[0]?.ucl ?? 0
  const lcl = samples[0]?.lcl ?? 0

  return (
    <div className={cn('relative')} ref={ref} style={{ height }}>
      {w > 0 && (
        <svg width={w} height={height}>
          <defs>
            <linearGradient id="spc-area" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#22d3ee" stopOpacity="0.3" />
              <stop offset="100%" stopColor="#22d3ee" stopOpacity="0" />
            </linearGradient>
          </defs>
          <rect x={padL} y={y(ucl)} width={innerW} height={y(lcl) - y(ucl)} fill="rgba(52,211,153,0.06)" />
          {[ucl, mean, lcl].map((v, i) => (
            <g key={i}>
              <line
                x1={padL}
                x2={w - padR}
                y1={y(v)}
                y2={y(v)}
                stroke={i === 1 ? 'rgba(255,255,255,0.32)' : '#34d399'}
                strokeWidth={i === 1 ? 1 : 1.1}
                strokeDasharray={i === 1 ? '6 4' : '4 4'}
                opacity={i === 1 ? 0.7 : 0.75}
              />
              <text x={padL - 6} y={y(v) + 3.5} textAnchor="end" fontSize="8.5" fill={i === 1 ? '#8592b6' : '#34d399'} className="mono">
                {i === 1 ? 'x̄' : v.toFixed(1)}
              </text>
            </g>
          ))}
          <path d={`${d} L ${x(samples.length - 1)} ${padT + innerH} L ${padL} ${padT + innerH} Z`} fill="url(#spc-area)" />
          <path d={d} fill="none" stroke="#22d3ee" strokeWidth="1.8" style={{ filter: 'drop-shadow(0 0 6px #22d3ee77)' }} />
          {samples.map((s, i) =>
            s.value > ucl || s.value < lcl ? (
              <g key={s.index}>
                <circle cx={x(i)} cy={y(s.value)} r="5" fill="none" stroke="#fb7185" strokeWidth="1.3" />
                <circle cx={x(i)} cy={y(s.value)} r="3" fill="#fb7185" />
              </g>
            ) : (
              <circle key={s.index} cx={x(i)} cy={y(s.value)} r="1.9" fill="#67e8f9" />
            ),
          )}
          <text x={padL} y={height - 4} fontSize="9" fill="#626f94" className="mono">
            sample #{samples[0]?.index ?? 0}
          </text>
          <text x={w - padR} y={height - 4} textAnchor="end" fontSize="9" fill="#626f94" className="mono">
            #{samples[samples.length - 1]?.index ?? 0}
          </text>
        </svg>
      )}
    </div>
  )
}

/* ----------------------------------------------------------------- radar -- */
export function Radar({
  axes,
  series,
  size = 240,
  className,
}: {
  axes: string[]
  series: Array<{ label: string; color: string; values: number[] }>
  size?: number
  className?: string
}) {
  const c = size / 2
  const r = c - 34
  const n = axes.length
  const angle = (i: number) => (Math.PI * 2 * i) / n - Math.PI / 2
  const point = (i: number, v: number) => [c + Math.cos(angle(i)) * r * (v / 100), c + Math.sin(angle(i)) * r * (v / 100)]

  return (
    <svg width={size} height={size} className={className}>
      <defs>
        {series.map((s, i) => (
          <radialGradient key={s.label} id={`radar-${i}`}>
            <stop offset="0%" stopColor={s.color} stopOpacity="0.5" />
            <stop offset="100%" stopColor={s.color} stopOpacity="0.08" />
          </radialGradient>
        ))}
      </defs>
      {[0.25, 0.5, 0.75, 1].map((t) => (
        <polygon
          key={t}
          points={axes.map((_, i) => point(i, t * 100).join(',')).join(' ')}
          fill="none"
          stroke="rgba(255,255,255,0.08)"
          strokeDasharray="3 5"
        />
      ))}
      {axes.map((a, i) => {
        const p = point(i, 100)
        const lp = point(i, 120)
        return (
          <g key={a}>
            <line x1={c} y1={c} x2={p[0]} y2={p[1]} stroke="rgba(255,255,255,0.07)" />
            <text
              x={lp[0]}
              y={lp[1] + 3}
              textAnchor={lp[0] > c + 4 ? 'start' : lp[0] < c - 4 ? 'end' : 'middle'}
              fontSize="9"
              fill="#8592b6"
              className="mono"
            >
              {a}
            </text>
          </g>
        )
      })}
      {series.map((s, si) => (
        <g key={s.label}>
          <polygon
            points={s.values.map((v, i) => point(i, v).join(',')).join(' ')}
            fill={`url(#radar-${si})`}
            stroke={s.color}
            strokeWidth="1.6"
            style={{ filter: `drop-shadow(0 0 8px ${s.color}77)` }}
          />
          {s.values.map((v, i) => {
            const p = point(i, v)
            return <circle key={i} cx={p[0]} cy={p[1]} r="2.4" fill={s.color} />
          })}
        </g>
      ))}
    </svg>
  )
}

/* --------------------------------------------------------------- heatmap -- */
export function Heatmap({
  rows,
  cols,
  values,
  scale = ['#0e7490', '#22d3ee', '#a3e635'],
  unitLabel = '',
}: {
  rows: string[]
  cols: string[]
  values: number[][]
  scale?: string[]
  unitLabel?: string
}) {
  const [hover, setHover] = useState<{ r: number; c: number } | null>(null)
  const color = (v: number) => {
    const t = Math.max(0, Math.min(1, v / 100))
    if (t < 0.5) return mix(scale[0], scale[1], t / 0.5)
    return mix(scale[1], scale[2], (t - 0.5) / 0.5)
  }
  return (
    <div className="relative">
      <div className="flex gap-2">
        <div className="flex flex-col justify-around pt-4">
          {rows.map((r) => (
            <span key={r} className="mono text-[9.5px] leading-none text-haze-500">
              {r}
            </span>
          ))}
        </div>
        <div className="flex-1 overflow-x-auto">
          <div
            className="grid gap-[3px]"
            style={{ gridTemplateColumns: `repeat(${cols.length}, minmax(0,1fr))` }}
          >
            {cols.map((c) => (
              <span key={c} className="mono pb-1 text-center text-[9px] text-haze-500">
                {c}
              </span>
            ))}
            {rows.map((_, ri) =>
              cols.map((_, ci) => (
                <div
                  key={`${ri}-${ci}`}
                  onMouseEnter={() => setHover({ r: ri, c: ci })}
                  onMouseLeave={() => setHover(null)}
                  className="h-5 rounded-[4px] transition-transform duration-200 hover:scale-110"
                  style={{
                    background: color(values[ri][ci]),
                    boxShadow: `0 0 10px ${color(values[ri][ci])}55`,
                    outline: hover && hover.r === ri && hover.c === ci ? '1px solid rgba(255,255,255,0.5)' : undefined,
                  }}
                />
              )),
            )}
          </div>
        </div>
      </div>
      {hover && (
        <div className="glass-solid absolute -top-1 right-0 rounded-lg px-2 py-1 text-[10.5px]">
          <span className="mono text-haze-200">
            {rows[hover.r]} · {cols[hover.c]} → {values[hover.r][hover.c].toFixed(1)}
            {unitLabel}
          </span>
        </div>
      )}
    </div>
  )
}

function mix(a: string, b: string, t: number) {
  const pa = hex(a)
  const pb = hex(b)
  const out = pa.map((v, i) => Math.round(v + (pb[i] - v) * t))
  return `rgb(${out[0]},${out[1]},${out[2]})`
}
function hex(h: string): number[] {
  const s = h.replace('#', '')
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)]
}
