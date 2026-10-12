import { useMemo, useState } from 'react'
import {
  AlertTriangle,
  Boxes,
  CalendarClock,
  DollarSign,
  Gauge as GaugeIcon,
  Landmark,
  PackageCheck,
  PackageX,
  Search,
  ShieldAlert,
  ShoppingCart,
  Truck,
  Warehouse,
} from 'lucide-react'
import { Donut, HBars } from '../components/charts'
import { Chip, Meter, Panel, PanelHeader, SectionTitle, Stat } from '../components/ui'
import { useKpis, usePlant } from '../store/plant'
import { cn, num } from '../lib/utils'

const STATUS_META_ITEM = {
  ok: { label: 'In range', tone: 'emerald', color: '#34d399' },
  low: { label: 'Low', tone: 'amber', color: '#fbbf24' },
  critical: { label: 'Critical', tone: 'rose', color: '#fb7185' },
  excess: { label: 'Excess', tone: 'violet', color: '#a855f7' },
} as const

export default function Inventory() {
  const { state, dispatch } = usePlant()
  const kpis = useKpis()
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('all')

  const categories = useMemo(() => ['all', ...new Set(state.inventory.map((i) => i.category))], [state.inventory])

  const items = useMemo(
    () =>
      state.inventory
        .filter((i) => (category === 'all' ? true : i.category === category))
        .filter((i) => (query ? `${i.sku} ${i.name} ${i.supplier}`.toLowerCase().includes(query.toLowerCase()) : true)),
    [state.inventory, category, query],
  )

  const inventoryKpis = useMemo(() => {
    const inv = state.inventory
    return {
      skus: inv.length,
      critical: inv.filter((i) => i.status === 'critical').length,
      low: inv.filter((i) => i.status === 'low').length,
      excess: inv.filter((i) => i.status === 'excess').length,
      coverage: inv.reduce((s, i) => s + (i.stock / Math.max(1, i.consumedToday)) * 24, 0) / inv.length,
      value: Math.round(inv.reduce((s, i) => s + i.stock * (i.category === 'Component' ? 3.4 : 0.42), 0) / 1000),
      onTime: 94.6,
    }
  }, [state.inventory])

  const abc = useMemo(() => {
    const sorted = [...state.inventory].sort((a, b) => b.consumedToday - a.consumedToday)
    const third = Math.ceil(sorted.length / 3)
    return [
      { label: 'Class A · high movement', value: sorted.slice(0, third).length, color: '#22d3ee' },
      { label: 'Class B · medium', value: sorted.slice(third, third * 2).length, color: '#a855f7' },
      { label: 'Class C · slow', value: sorted.slice(third * 2).length, color: '#818cf8' },
    ]
  }, [state.inventory])

  const consumption = useMemo(
    () =>
      state.inventory
        .slice()
        .sort((a, b) => b.consumedToday - a.consumedToday)
        .slice(0, 6)
        .map((i) => ({ label: i.name, value: i.consumedToday, tone: i.status === 'critical' ? 'rose' : 'cyan', hint: i.unit })),
    [state.inventory],
  )

  const reorder = state.inventory.filter((i) => i.status === 'critical' || i.status === 'low')

  return (
    <div className="space-y-5">
      <SectionTitle
        eyebrow="Material Flow"
        title="Inventory & Supply Control"
        description="Live stock position for every raw material, component and packaging item — with consumption rates, coverage days and reorder intelligence."
        actions={
          <>
            <Chip tone={inventoryKpis.critical ? 'rose' : 'emerald'} icon={ShieldAlert}>
              {reorder.length} items need attention
            </Chip>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() =>
                dispatch({
                  type: 'PUSH_TOAST',
                  toast: {
                    id: `t-${Date.now()}`,
                    title: 'Purchase requisitions drafted',
                    detail: `${reorder.length} reorder proposals sent to procurement for approval.`,
                    tone: 'success',
                  },
                })
              }
            >
              <ShoppingCart size={13} /> Auto-reorder
            </button>
          </>
        }
      />

      <div className="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="Active SKUs"
          value={inventoryKpis.skus}
          unit="items"
          icon={Boxes}
          tone="cyan"
          progress={100}
          hint={`${categories.length - 1} material categories`}
        />
        <Stat
          label="Below Reorder Point"
          value={reorder.length}
          unit="items"
          delta={1}
          invertDelta
          icon={AlertTriangle}
          tone={reorder.length > 3 ? 'rose' : 'amber'}
          progress={(reorder.length / state.inventory.length) * 100}
          hint={`${inventoryKpis.critical} critical · ${inventoryKpis.low} low`}
        />
        <Stat
          label="Avg Coverage"
          value={inventoryKpis.coverage.toFixed(1)}
          unit="days"
          icon={CalendarClock}
          tone="blue"
          progress={Math.min(100, inventoryKpis.coverage * 3)}
          hint="Weighted by daily consumption"
        />
        <Stat
          label="Supplier OTD"
          value={inventoryKpis.onTime}
          unit="%"
          delta={1.2}
          icon={Truck}
          tone="emerald"
          progress={inventoryKpis.onTime}
          hint={`Stock value index ≈ ${inventoryKpis.value}k`}
        />
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Panel>
          <PanelHeader
            title="Stock register"
            subtitle="Position against minimum and maximum thresholds"
            icon={Warehouse}
            actions={<Chip tone="haze">{items.length} items</Chip>}
          />
          <div className="mb-3.5 flex flex-wrap items-center gap-2">
            <div className="relative min-w-[200px] flex-1">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-haze-500" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search SKU, material or supplier…"
                className="field !pl-8"
              />
            </div>
            <div className="seg flex-wrap">
              {categories.slice(0, 5).map((c) => (
                <button key={c} type="button" className="seg-item" data-active={category === c} onClick={() => setCategory(c)}>
                  {c === 'all' ? 'All' : c}
                </button>
              ))}
            </div>
          </div>

          <div className="max-h-[520px] overflow-auto rounded-xl border border-white/6">
            <table className="data-table">
              <thead>
                <tr>
                  <th>SKU</th>
                  <th>Material</th>
                  <th>Location</th>
                  <th>Stock position</th>
                  <th>Coverage</th>
                  <th>Status</th>
                  <th>Supplier</th>
                  <th>Lead</th>
                </tr>
              </thead>
              <tbody>
                {items.map((i) => {
                  const meta = STATUS_META_ITEM[i.status]
                  const fill = (i.stock / Math.max(i.max, 1)) * 100
                  const coverageDays = i.stock / Math.max(1, i.consumedToday)
                  return (
                    <tr key={i.sku}>
                      <td className="mono text-cyan-300">{i.sku}</td>
                      <td>
                        <div className="flex flex-col">
                          <span className="text-haze-100">{i.name}</span>
                          <span className="text-[10px] text-haze-500">{i.category}</span>
                        </div>
                      </td>
                      <td className="mono text-[10.5px] text-haze-400">{i.location}</td>
                      <td>
                        <div className="w-[130px]">
                          <div className="mb-1 flex items-center justify-between text-[10px]">
                            <span className="mono text-haze-200">{num(i.stock)}</span>
                            <span className="mono text-haze-500">min {num(i.min)}</span>
                          </div>
                          <div className="relative">
                            <Meter value={fill} tone={meta.tone === 'violet' ? 'violet' : meta.tone === 'rose' ? 'rose' : meta.tone === 'amber' ? 'amber' : 'emerald'} height={4} />
                            <span
                              className="absolute -top-[2px] h-2 w-[1.5px] bg-white/50"
                              style={{ left: `${(i.min / Math.max(i.max, 1)) * 100}%` }}
                            />
                          </div>
                        </div>
                      </td>
                      <td>
                        <span className={cn('mono text-[11px]', coverageDays < 2 ? 'text-rose-300' : coverageDays < 5 ? 'text-amber-300' : 'text-haze-200')}>
                          {coverageDays.toFixed(1)}d
                        </span>
                      </td>
                      <td>
                        <span className="chip" style={{ background: `${meta.color}1f`, color: meta.color, borderColor: `${meta.color}44` }}>
                          <span className="size-1.5 rounded-full bg-current" />
                          {meta.label}
                        </span>
                      </td>
                      <td className="text-[11px] text-haze-300">{i.supplier}</td>
                      <td className="mono text-[11px] text-haze-400">{i.leadTimeDays}d</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Panel>

        <div className="space-y-5">
          <Panel>
            <PanelHeader
              title="Reorder intelligence"
              subtitle="Items at or below the reorder point"
              icon={PackageX}
              accent="#fb7185"
            />
            {reorder.length === 0 ? (
              <div className="grid place-items-center gap-1.5 rounded-xl border border-dashed border-emerald-400/25 bg-emerald-500/5 py-8">
                <PackageCheck size={22} className="text-emerald-400" />
                <p className="text-[12px] text-emerald-300">Every material is above its reorder point</p>
              </div>
            ) : (
              <div className="space-y-2.5">
                {reorder.map((i) => {
                  const meta = STATUS_META_ITEM[i.status]
                  return (
                    <div key={i.sku} className="rounded-xl border border-white/7 bg-void-950/40 p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-[12px] text-haze-100">{i.name}</p>
                          <p className="mono text-[10px] text-haze-500">
                            {i.sku} · {i.location}
                          </p>
                        </div>
                        <span className="mono shrink-0 text-[10.5px]" style={{ color: meta.color }}>
                          {num(i.stock)} / {num(i.min)}
                        </span>
                      </div>
                      <div className="mt-2 flex items-center justify-between text-[10.5px]">
                        <span className="text-haze-500">
                          Lead time <span className="mono text-haze-300">{i.leadTimeDays}d</span> · {i.supplier}
                        </span>
                        <button
                          type="button"
                          className="text-cyan-300 transition hover:text-cyan-200"
                          onClick={() =>
                            dispatch({
                              type: 'PUSH_TOAST',
                              toast: {
                                id: `t-${Date.now()}`,
                                title: `PO raised for ${i.sku}`,
                                detail: `${num(Math.round(i.max * 0.6))} ${i.unit} ordered from ${i.supplier}.`,
                                tone: 'info',
                              },
                            })
                          }
                        >
                          raise PO →
                        </button>
                      </div>
                      <div className="mt-2">
                        <Meter value={(i.stock / Math.max(1, i.max)) * 100} tone={i.status === 'critical' ? 'rose' : 'amber'} height={4} />
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </Panel>

          <Panel>
            <PanelHeader title="Movement classification" subtitle="ABC analysis by consumption velocity" icon={GaugeIcon} accent="#a855f7" />
            <div className="flex items-center gap-4">
              <Donut segments={abc} size={132} thickness={13} centerValue={`${state.inventory.length}`} centerLabel="SKUs" />
              <div className="flex-1 space-y-2">
                {abc.map((a) => (
                  <div key={a.label} className="flex items-center gap-2 text-[11px]">
                    <span className="size-2 rounded-full" style={{ background: a.color, boxShadow: `0 0 9px ${a.color}` }} />
                    <span className="truncate text-haze-300">{a.label}</span>
                    <span className="mono ml-auto text-haze-500">{a.value}</span>
                  </div>
                ))}
              </div>
            </div>
          </Panel>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel>
          <PanelHeader title="Top consumption today" subtitle="Highest-burn materials feeding the lines" icon={Landmark} accent="#22d3ee" />
          <HBars items={consumption} />
        </Panel>

        <Panel>
          <PanelHeader title="Supply chain pulse" subtitle="Inbound, in-transit and expedited shipments" icon={DollarSign} accent="#fb923c" />
          <div className="grid gap-3 sm:grid-cols-2">
            {[
              { label: 'Inbound today', value: '14 loads', tone: 'cyan' },
              { label: 'In transit', value: '6 shipments', tone: 'violet' },
              { label: 'Expedited', value: '2 air freight', tone: 'rose' },
              { label: 'Quarantine', value: '1 lot hold', tone: 'amber' },
            ].map((r) => (
              <div key={r.label} className="rounded-xl border border-white/8 bg-void-950/40 p-3">
                <span className="label-cap text-haze-500">{r.label}</span>
                <p className={cn('mono mt-1.5 text-[16px] font-semibold', r.tone === 'rose' ? 'text-rose-300' : r.tone === 'amber' ? 'text-amber-300' : r.tone === 'violet' ? 'text-violet-300' : 'text-cyan-300')}>
                  {r.value}
                </p>
              </div>
            ))}
          </div>
          <div className="mt-3.5 space-y-2.5 border-t border-white/8 pt-3">
            {state.inventory.slice(0, 4).map((i) => (
              <div key={i.sku} className="flex items-center gap-3 text-[11px]">
                <span className="mono w-16 shrink-0 text-haze-400">{i.sku}</span>
                <span className="flex-1 truncate text-haze-300">{i.name}</span>
                <span className="mono text-haze-200">{num(i.consumedToday)}/day</span>
              </div>
            ))}
          </div>
          <p className="mt-3 flex items-center gap-1.5 text-[10.5px] text-haze-500">
            <Truck size={12} /> Plant currently consuming {num(kpis.throughput * 2)} material units per hour.
          </p>
        </Panel>
      </div>
    </div>
  )
}
