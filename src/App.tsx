import { useEffect, useState } from 'react'
import { Command, Cpu, Radio, Signal, Zap } from 'lucide-react'
import { Backdrop, CommandPalette, NAV_ITEMS, Sidebar, Toaster, TopBar, useClock } from './components/shell'
import { PlantProvider, useKpis, usePlant } from './store/plant'
import Dashboard from './pages/Dashboard'
import Lines from './pages/Lines'
import Orders from './pages/Orders'
import Analytics from './pages/Analytics'
import Quality from './pages/Quality'
import Maintenance from './pages/Maintenance'
import Inventory from './pages/Inventory'
import Workforce from './pages/Workforce'

function Shell() {
  const [page, setPage] = useState('dashboard')
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const { state, dispatch } = usePlant()
  const kpis = useKpis()
  const now = useClock(5000)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const typing =
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOpen((v) => !v)
        return
      }
      if (e.key === 'Escape') {
        setPaletteOpen(false)
        setMobileOpen(false)
        return
      }
      if (!typing && e.key.toLowerCase() === 'p') {
        dispatch({ type: 'SET_RUNNING', running: !state.running })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [dispatch, state.running])

  // Scroll to top on page change.
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [page])

  const nav = NAV_ITEMS.find((n) => n.id === page) ?? NAV_ITEMS[0]

  return (
    <div className="relative min-h-screen">
      <Backdrop />

      <Sidebar
        active={page}
        onNavigate={setPage}
        collapsed={collapsed}
        onToggle={() => setCollapsed((v) => !v)}
        mobileOpen={mobileOpen}
        onCloseMobile={() => setMobileOpen(false)}
      />

      <div className={collapsed ? 'relative z-10 lg:pl-[76px]' : 'relative z-10 lg:pl-[254px]'}>
        <TopBar
          title={nav.label}
          section={nav.hint}
          onOpenPalette={() => setPaletteOpen(true)}
          onOpenMobile={() => setMobileOpen(true)}
        />

        <main id="page-scroll" className="px-4 pb-10 pt-5 sm:px-6">
          <div key={page} className="rise mx-auto max-w-[1600px]">
            {page === 'dashboard' && <Dashboard onNavigate={setPage} />}
            {page === 'lines' && <Lines />}
            {page === 'orders' && <Orders />}
            {page === 'analytics' && <Analytics />}
            {page === 'quality' && <Quality />}
            {page === 'maintenance' && <Maintenance />}
            {page === 'inventory' && <Inventory />}
            {page === 'workforce' && <Workforce />}
          </div>

          <footer className="mx-auto mt-8 max-w-[1600px] border-t border-white/8 pt-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-4 text-[10.5px] text-haze-500">
                <span className="flex items-center gap-1.5">
                  <span className="relative flex size-1.5">
                    <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-70" />
                    <span className="relative inline-flex size-1.5 rounded-full bg-emerald-400" />
                  </span>
                  <span className="mono text-emerald-300">MES gateway linked</span>
                </span>
                <span className="mono flex items-center gap-1.5">
                  <Signal size={11} /> OPC-UA · MQTT · {12 + (state.tick % 7)} ms
                </span>
                <span className="mono flex items-center gap-1.5">
                  <Radio size={11} /> {state.machines.length} tags streaming
                </span>
                <span className="mono flex items-center gap-1.5">
                  <Zap size={11} /> tick #{state.tick.toLocaleString()} · {state.speed}×
                </span>
                <span className="mono hidden items-center gap-1.5 sm:flex">
                  <Cpu size={11} /> edge collector v4.2.1
                </span>
              </div>
              <div className="flex items-center gap-3 text-[10.5px] text-haze-500">
                <span className="mono">
                  {kpis.machinesRunning}/{kpis.machinesTotal} stations up · {kpis.openAlerts} alerts open
                </span>
                <span className="hidden items-center gap-1.5 sm:flex">
                  <Command size={11} className="kbd !p-0 border-0 bg-transparent" /> K for command palette · P to pause
                </span>
                <span className="mono text-haze-500">
                  {now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            </div>
          </footer>
        </main>
      </div>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} onNavigate={setPage} />
      <Toaster />
    </div>
  )
}

export default function App() {
  return (
    <PlantProvider>
      <Shell />
    </PlantProvider>
  )
}
