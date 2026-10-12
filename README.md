# NEXUS · PMS — Production Management System

Aplikasi web **Production Management System (PMS)** bergaya *mission control* futuristik: dark UI,
panel kaca, aksen neon cyan–violet, animasi halus, dan telemetri lantai produksi yang bergerak
secara *real-time*. Dibangun dengan **React + TypeScript + Vite + Tailwind CSS v4**, tanpa backend —
semua data disimulasikan secara deterministik sehingga UI bisa langsung dijalankan dan seluruh
perilaku produk (OEE, work order, alert, downtime) bisa dinilai end-to-end.

> Semua angka, mesin, dan SKU adalah data simulasi pabrik (plant) contoh: 6 lini produksi,
> 24 stasiun mesin, 3 shift, 22 work order, 14 material, dan 14 work order pemeliharaan.

---

## ✨ Fitur

| Modul | Isi |
| --- | --- |
| **Command Center** | OEE gauge, dekomposisi A×P×Q, output vs plan, fleet status donut, alert stream, downtime Pareto, kartu per lini, papan skor shift |
| **Production Lines** | Peta lantai (digital twin) dengan konveyor beranimasi, telemetri per stasiun (suhu, getaran, RPM), dossier mesin + kontrol override status (HMI) |
| **Work Orders** | Register order + filter/search, progress eksekusi, release order baru, mini-Gantt 14 hari, beban kapasitas per lini |
| **OEE Analytics** | Tren dekomposisi OEE, six big losses, output vs target per jam, radar multi-axis, control chart SPC (Cpk), heatmap utilisasi |
| **Quality Lab** | Pareto defect, mix kategori donut, tren FPY vs defect rate, radar kapabilitas proses, register inspeksi AQL, papan CAPA, chart kontrol |
| **Maintenance** | MTBF/MTTR/PM compliance, ranking risiko aset + estimasi RUL, kalender pemeliharaan 14 hari, forecast failure mode, register work order |
| **Inventory** | Register stok dengan ambang min/max, coverage days, reorder intelligence + aksi *raise PO*, klasifikasi ABC, denyut rantai pasok |
| **Workforce** | Papan roster per shift, produktivitas shift, skill coverage matrix (heatmap), register performa operator |

### Elemen UX yang membuatnya "hidup"

- **Live simulation loop** — setiap tick (~1×/detik, bisa 2×/4×) status mesin, telemetri, output,
  alert, sampai work order diperbarui oleh simulator di dalam store.
- **Command palette** (`⌘/Ctrl + K`) untuk lompat antar modul, mencari stasiun, atau men-toggle feed.
- **Pause live feed** (`P` atau tombol di top bar) untuk membekukan grafik saat presentasi/demo.
- **Alert stream** dengan acknowledge per-item maupun *ack all*, plus **toaster** notifikasi aksi.
- **Ticker lantai** di bawah top bar: OEE, output, dan status semua lini berjalan sebagai marquee.
- **Responsif penuh** — sidebar collapse di desktop, drawer di mobile, tabel dengan scroll horizontal.

---

## 🎨 Bahasa desain

- **Palet void/haze + neon**: latar `#04060e` berlapis aura bergerak, grid halus, noise, scanline,
  dan vignette untuk kedalaman.
- **Glassmorphism**: `.glass`, `.glass-solid`, hairline highlight, backdrop blur 18–22 px.
- **Efek sinematik**: border conic *beam* berputar, sweep scan-line, shimmer toast, pulse dot,
  ring-ping, gradient glow pada angka kunci, animasi *draw* pada grafik garis.
- **Tipografi**: *Space Grotesk Variable* (display) + *JetBrains Mono Variable* (angka/tabular),
  di-self-host lewat `@fontsource-variable/*` sehingga tidak bergantung pada CDN eksternal.
- **Kontrol**: tombol, segmen, chip status, field, tabel, dan gauge semuanya punya state hover/focus
  yang konsisten; seluruh animasi otomatis redup saat `prefers-reduced-motion`.

Grafik dibuat dari nol dengan SVG (tanpa library chart): `AreaLineChart` (crosshair + tooltip),
`BarChart`, `Sparkline`, `Donut`, `HBars`, `Meter`, `Gauge`, `Radar`, `Heatmap`, dan `SpcChart`.

---

## 🚀 Menjalankan

```bash
npm install
npm run dev        # http://localhost:5173  (Vite dev server, host 0.0.0.0)
npm run build      # type-check (tsc --noEmit) + build produksi ke dist/
npm run preview    # pratinjau hasil build
npm run typecheck  # hanya type-check
```

Build produksi saat ini ≈ **121 kB gzip JS** + **15 kB gzip CSS** (font woff2 terpisah).

---

## 🗂 Struktur proyek

```
src/
├─ App.tsx                 # shell: routing modul, shortcut keyboard, footer status
├─ main.tsx                # entry React
├─ index.css               # design token Tailwind v4 (@theme) + seluruh efek visual
├─ lib/
│  ├─ types.ts             # domain model (Machine, Line, WorkOrder, Alert, …)
│  ├─ data.ts              # generator data plant awal (deterministik, seed tetap)
│  └─ utils.ts             # format angka/waktu, palet status, path smoothing, tema
├─ store/plant.tsx         # reducer + simulator + selectors (usePlant, useKpis)
├─ components/
│  ├─ shell.tsx            # backdrop, sidebar, top bar, toaster, command palette
│  ├─ ui.tsx               # Panel, Stat, Gauge, Chip, Modal, Meter, Seg, …
│  └─ charts.tsx           # semua komponen grafik SVG
└─ pages/                  # 8 modul: Dashboard, Lines, Orders, Analytics,
                           #            Quality, Maintenance, Inventory, Workforce
```

---

## 🔌 Menghubungkan ke backend / MES nyata

Aplikasi ini sengaja memisahkan *sumber data* dari *tampilan*:

1. `src/lib/data.ts` → ganti dengan hasil `fetch` REST/GraphQL (plant, mesin, order, dll).
2. `src/store/plant.tsx` → ganti fungsi `simulate()` dengan WebSocket/MQTT/OPC-UA subscription;
   dispatch aksi yang sudah ada (`SET_MACHINE_STATUS`, `CREATE_ORDER`, `ADVANCE_ORDER`,
   `ACK_ALERT`, …) dari pesan masuk, atau tambahkan aksi baru untuk event server.
3. `useKpis()` dan seluruh halaman tidak perlu diubah — semuanya membaca dari store yang sama.

---

## ⌨️ Shortcut

| Tombol | Aksi |
| --- | --- |
| `⌘/Ctrl + K` | Buka/tutup command palette |
| `P` | Pause / resume live telemetry |
| `Esc` | Tutup palette, modal, atau drawer mobile |
| Klik baris tabel | Buka detail (stasiun, work order pemeliharaan, dll.) |

---

## 🧱 Tech stack

- [React 19](https://react.dev) + TypeScript (strict, `noUnusedLocals`/`noUnusedParameters`)
- [Vite 8](https://vite.dev) — dev server & bundler
- [Tailwind CSS v4](https://tailwindcss.com) — token tema via `@theme`, tanpa file config tambahan
- [lucide-react](https://lucide.dev) — ikon
- Grafik SVG buatan sendiri (tanpa dependency chart eksternal)

## 📁 Lisensi

MIT — silakan pakai, modifikasi, dan kembangkan.
