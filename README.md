# Production Management System — PT Potensi Bumi Sakti (Produksi Kering)

Aplikasi web untuk proses utama produksi kering: **Production Plan → Shift Mandor → Dryer Board (23 kompartemen) → Metal Detector → Pallet → Handover**, dengan audit trail, RBAC, laporan, dan KPI pilot.

Sumber requirement: "Kebutuhan Developer Aplikasi Produksi Kering" (Rev 2.0). **Status: MVP untuk requirement confirmation.** Asumsi dan open items ada di [docs/ASSUMPTIONS.md](docs/ASSUMPTIONS.md).

## Menjalankan

Syarat: Node.js ≥ 22.5 (menggunakan `node:sqlite`).

```bash
npm install
npm start            # http://0.0.0.0:3000 (ubah dengan PORT=… )
npm test             # test integrasi (18 skenario)
npm run backup       # salinan konsisten database ke data/backups/
```

Database berada di `data/pms.db` (dibuat otomatis, tidak masuk Git). Lokasi lain dapat diatur dengan `PMS_DB=/path/file.db`.

## Akun demo

Password awal: `Password123!` (atau nilai `PMS_DEMO_PASSWORD` saat seed pertama dijalankan).

| Username | Peran |
|---|---|
| admin | Admin Sistem (master, user, RBAC, audit) |
| spv | SPV Produksi (plan, adjustment, approval) |
| spv2 | SPV Produksi, approver kedua (maker-checker) |
| mandor | Mandor (shift, trolley, WIP, handover, verifikasi) |
| opdryer | Operator Dryer (Dryer Run, trolley, sampling) |
| opmd | Operator Metal Detector (challenge, Bale, exception, pallet) |
| qc | QC (QC Release Hold/Reject) |
| manager | Manager (dashboard, laporan, harga) |
| auditor | Auditor / Document Control (audit trail, laporan) |

Akun individual wajib dibuat untuk pengguna sebenarnya (menu Admin).

## Alur singkat (demo)

1. `spv` membuat Production Plan (DRAFT), `spv2` menyetujui, lalu mengaktifkan.
2. `mandor` membuka shift, mencatat Harvest/Filling, dan menutup shift setelah handover.
3. `opdryer` membuka Dryer Run, trolley IN/OUT, pembacaan suhu, sampling Cake, lalu menutup run.
4. `opmd` mencatat challenge Fe/Non-Fe/SS 2.5 PASS, menjalankan MD, mencatat count Bale, exception Reject/Hold dengan chamber, dan pallet.
5. `qc` memutuskan Hold/Reject. `manager` dan `auditor` melihat laporan dan audit.

## Struktur

```
server/
  index.js            entry point (0.0.0.0, PORT)
  app.js              perakitan router, penanganan error
  db.js               skema SQLite, seed (RBAC, settings, master, user demo)
  http.js             auth (sesi, RBAC), audit, validator, HttpError
  rbac.js             daftar permission dan role default
  domain.js           aturan domain (status trolley, plan, equipment status)
  routes/
    core.js           login, master data, admin user/role, settings, audit
    production.js     plan, shift Mandor, trolley, downtime, handover
    dryer.js          Dryer Run, board, sampling, adjustment
    md.js             challenge MD, bale, exception, pallet, cutoff, QC
    reports.js        dashboard, OEE, konsumsi/energi, koreksi, laporan
public/
  index.html, app.js, styles.css   SPA vanilla
  logo.svg                         logo resmi PBS (LOGO_-_PBS.svg, metadata C2PA dibuang)
test/api.test.js      test integrasi (node:test)
scripts/backup.js     backup database
docs/ASSUMPTIONS.md   asumsi, open items, gap
```

## Mengganti logo

Logo resmi PBS dipakai sebagai `public/logo.svg` (sumber: `LOGO_-_PBS.svg` dari folder PMS di Drive). Untuk mengganti, timpa `public/logo.svg` dengan SVG baru (atau ubah `src` di `public/index.html`, `public/app.js`, dan `server/routes/reports.js` bila memakai nama/format lain).

## Catatan keamanan

- Sesi bearer token, timeout 30 menit tidak aktif, lockout setelah 5 kali gagal.
- Hanya permission yang tercantum yang dapat mengakses endpoint; cek di `server/rbac.js`.
- Ubah password demo sebelum dipakai di lingkungan nyata.
- Tidak ada hard delete. Koreksi memerlukan approval SPV.
