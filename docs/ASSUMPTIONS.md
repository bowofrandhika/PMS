# Asumsi, Open Items, dan Gap — PMS Produksi Kering

Sumber: "Kebutuhan Developer Aplikasi Produksi Kering" (Versi 1, Draft untuk requirement confirmation, 12 Oktober 2026; revisi 2.0). Dokumen ini mencatat setiap keputusan yang diambil **sebelum** requirement lock ditandatangani Process Owner. Setiap asumsi harus dikonfirmasi; open item tidak boleh menjadi asumsi permanen, sehingga dibuat *configurable* atau *inactive*.

## 1. Status requirement

| Item | Status |
|---|---|
| Tahap 0 Requirement Lock (sign-off Process Owner) | **Belum** — build MVP dikerjakan atas dasar asumsi di dokumen ini |
| Tahap 1 Foundation (Auth/RBAC, master, Plan/revisi, audit) | Dibangun |
| Tahap 2 Core Operation (Mandor, trolley, Dryer, sampling, Cake weight, MD, cutoff, pallet, handover) | Dibangun |
| Tahap 3 Loss & KPI (downtime, consumable, report, OEE Dryer) | Dibangun (OEE pilot, lihat gap) |
| Tahap 4 Future (QC/Lab detail, treatment Hold, integrasi, Furnace, Wet Production) | Tidak dibangun (di luar MVP) |

## 2. Scope MVP

Mengikuti bagian 2.1. Hal di bagian 2.2 **tidak** dibuat sebagai form rutin:
- Input Shredder/Filling oleh operator: tidak ada. Input Filling/Shredder dilakukan Mandor (`/shifts/:id/events`).
- Press Charge, berat Cake per Press, cycle Press, record per Bale: tidak ada.
- Input rutin Bale Inspection, Wrapping, Palletizing, Forklift: tidak ada. Movement pallet dicatat Mandor/MD secara terbatas.
- Treatment Hold, integrasi alat otomatis, Wet Production, Press OEE: tidak ada.

## 3. Asumsi teknologi dan arsitektur

- Node.js 22 + Express 4 + `node:sqlite` (DatabaseSync, WAL). Tanpa build step; frontend SPA vanilla di `public/`.
- Sesi bearer token, timeout 30 menit tidak aktif (`session_timeout_min`).
- Password di-hash scrypt; lockout 5 kali gagal, 15 menit (`lockout_threshold`, `lockout_minutes`).
- Timestamp server disimpan ISO-8601 UTC; tampilan dan tanggal operasional mengikuti zona `Asia/Jakarta`.
- Akun demo (password `Password123!`, dapat diubah dengan env `PMS_DEMO_PASSWORD` sebelum seed pertama): admin, spv, spv2, mandor, opdryer, opmd, qc, manager, auditor.
- Tidak ada hard delete. Kolom dan endpoint koreksi menyimpan nilai lama, nilai baru, alasan, pemohon, dan approver.

## 4. Keputusan dari dokumen yang diterapkan

| Topik | Implementasi |
|---|---|
| Plan lifecycle | DRAFT → APPROVED → ACTIVE → CLOSED; revisi menjadi versi baru; versi induk SUPERSEDED saat versi baru diaktifkan. Approver ≠ pembuat (maker-checker). |
| PLAN-001 | Approval/aktivasi ditolak bila field wajib kosong (Dryer/Press aktif, sampling rule, urutan Batch, interval Cake 30/60, validated setting Dryer). |
| NOT PLANNED | Equipment yang tidak dipilih plan ditampilkan `NOT PLANNED` (`/equipment/status`), tidak dihitung downtime dan tidak masuk denominator Availability. |
| REDUCED CAPACITY | Satu chamber rusak = `REDUCED CAPACITY` pada status equipment. |
| Dryer Board | 23 kompartemen per Dryer (DRY-A, DRY-B). Trolley IN/OUT mengubah status trolley secara konsisten. Timer ON dihitung dari interval RUNNING. |
| DRY-001 | Dryer yang tidak dipilih plan tidak dapat dibuka runnya. |
| Stop/resume Dryer | SPV dan Operator Dryer (`dryer.stop`). |
| Run close | Ditolak selama masih ada trolley di board (gunakan OUT atau carry-over). |
| Sampling Cake | Rule per plan: TIME_INTERVAL, TROLLEY_INTERVAL, SPECIFIC_TROLLEY, RANDOM. Sampling tambahan = AD HOC dengan alasan wajib. Bukan 30 menit yang dibakukan. |
| Berat rata-rata Cake | Interval 30/60 menit per plan. Bukan sampling P0/MV/PRI dan bukan Press Charge. |
| Process Adjustment | REQUESTED → APPROVED (SPV) → EXECUTED (Operator Dryer). Approver ≠ pemohon. |
| MD challenge | Fe/Non-Fe/SS 2.5 wajib PASS sebelum start dan setelah restart (`/md/start` menolak jika belum). |
| Count Bale OK | Tanpa detail chamber (MD-002). Batch aktif otomatis; pergantian Batch hanya lewat Batch Cutoff. |
| Maksimal pallet | 36 Bale (Pallet Unit = alas + 1 Forming Box). Bale ke-37 diblokir sebelum pallet ditutup (PAL-001). |
| Pemisahan pallet | Mixed status dilarang (PAL-004). Hold/Reject dipisah ke pallet kategori sendiri. Pallet OK dan Hold tidak dicampur. |
| Reject | Masuk gross dan reject count, **tidak** mengisi slot pallet OK, tidak ada recheck (MD-006). |
| Hold | Mengisi slot pallet (PAL-005) dan belum Good sampai QC Release. |
| Exception | Wajib chamber A1, A2, B1, B2, C1, C2 (MD-004). Reject metal wajib jenis Fe/Non-Fe/SS. |
| Pola chamber | Reject/Hold berurutan dari chamber sama memunculkan *indikasi* untuk diverifikasi (BR-011), bukan kesimpulan. Threshold = setting `chamber_repeat_alert` (default 3). |
| Partial pallet | Dilanjutkan antarshift tanpa reset (PAL-006). |
| Batch Cutoff | Batch di luar plan memerlukan approval SPV sebelum verifikasi Mandor. Verifikasi final tidak dapat diedit (CUT-005). |
| QC Release | Hanya peran QC (`quality.release`). Keputusan final satu kali. |
| Consumable | Expected per driver: pallet 1 per Pallet Unit, plastik SIR 1 per Bale OK, interlayer 1,5 per Pallet Unit, minyak makan 1 liter per hari produksi, solar per Dryer Run (provisional). |
| Harga | Manual dengan effective date. Harga lama ditutup, bukan ditimpa. Belum ada harga = `PRICE NOT SET`, cost KPI tidak dihitung. |
| Energi | Solar dan cangkang ditampilkan terpisah. Nilai kalor provisional: diesel 35,9 MJ/liter, cangkang 17 MJ/kg. |
| Moisture cangkang | PASS ≤15%, Monitoring >15–18%, Hold/Review >18% (`/consumables/moisture-rule`). |
| Koreksi | Field yang boleh dikoreksi di-whitelist; approval SPV; approver ≠ pemohon. |
| Laporan | Filter tanggal, plan, dan lainnya. Laporan per-Bale normal tidak disediakan (RPT-004). Dashboard tetap menampilkan INCOMPLETE dan pending approval (RPT-003). |
| Role | Permission matrix di `server/rbac.js`, disimpan di database dan dapat diubah Admin (`PUT /admin/roles/:code/permissions`). |

## 5. Open items (18.1) — penanganan di MVP

| ID | Topik | Penanganan MVP |
|---|---|---|
| OI-01 | User pendukung dan permission QC, Lab, Workshop, Manager, Admin, Document Control | Role QC, Manager, Admin Sistem, Auditor dibuat dengan permission **awal** yang dapat diubah. Role Lab dan Workshop belum dibuat. |
| OI-02 | Treatment Hold | Inactive. Hold hanya dicatat dan menunggu QC Release. |
| OI-03 | Mapping Fe/Non-Fe/SS ke MP/MS | Inactive. Jenis metal disimpan apa adanya (FE, NONFE, SS). |
| OI-04 | Threshold alert Reject/Hold berurutan | Configurable via setting `chamber_repeat_alert` (default 3). Bersifat indikasi. |
| OI-05 | Rule WS-2 > 10 Bale | Inactive. Tidak ada rule yang di-hardcode. |
| OI-06 | Equipment ID, serial/model, kalibrasi, 40 trolley | Master data editable. Trolley 40 bersifat provisional (`trolley_count_provisional`). Serial/kalibrasi belum ada field. |
| OI-07 | Interface scale/MD/PLC/flow meter | Inactive. Semua input manual. |
| OI-08 | Harga aktual, lead time, minimum stock, authorized cost role | Harga manual dengan effective date. Lead time dan authorized cost role belum dibuat. Minimum stock ada sebagai kolom tanpa alert. |
| OI-09 | Furnace dan cangkang | Cangkang ada sebagai consumable kategori ENERGY dengan status "future". Furnace tidak dimodelkan. |
| OI-10 | Metode agregat OEE jika Dryer A dan B aktif bersamaan | Belum ditetapkan. OEE dihitung **per Dryer**, tidak diagregasi. |

## 6. Gap yang diketahui (belum selesai)

1. **Export PDF sungguhan belum ada.** Yang tersedia: CSV kompatibel Excel (UTF-8 dengan BOM, dipisah koma) dan halaman print A4 (`format=print`) yang dapat disimpan sebagai PDF lewat dialog cetak browser.
2. **Planned Timer ON belum tersimpan di plan.** OEE A diisi lewat parameter `planned_min` pada `/api/kpi/oee`. Tanpa itu status INCOMPLETE.
3. **Q OEE berbasis count Bale**, bukan kg (berat per Bale belum ada sumber). Q juga INCOMPLETE sampai ada keputusan QC.
4. **Press OEE** tidak dihitung (sesuai 11.1).
5. **Aturan QC untuk Bale OK** (Good hanya setelah QC Release) belum dimodelkan penuh. Saat ini OK dihitung Good dan Hold/Reject hanya Good setelah QC Release.
6. **Lab/QC detail, treatment Hold, integrasi alat, Furnace, Wet Production** tidak dibangun (Tahap 4).
7. **Backup/restore** tersedia sebagai skrip (`npm run backup`), tetapi belum ada prosedur restore otomatis. Restore dilakukan manual dengan server dihentikan.
8. **Logo**: `public/logo.svg` adalah **logo pengganti buatan**. Logo asli "LOGO - PBS.png" tidak bisa dipindahkan ke sandbox. Ganti file `public/logo.svg` dengan logo resmi (SVG, atau ubah referensi ke PNG).
9. **Pengujian UI**: frontend diperiksa sintaksnya dan endpoint-nya diuji lewat test integrasi, tetapi belum diuji di browser sungguhan. UAT (28 skenario) belum dijalankan.
10. **Tidak ada edit PATCH untuk plan DRAFT** di UI (endpoint `PATCH /plans/:id` tersedia).
