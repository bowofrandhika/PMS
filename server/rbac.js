'use strict';

// Matriks RBAC sesuai bagian 4 (User, Role, dan Pemilik Input) dan bagian 7 dokumen Rev.02.
// Hak akses disimpan di database (tabel role_permissions) sehingga bisa dikonfigurasi
// Admin tanpa mengubah source code (AUTH-004). Nilai di sini hanya merupakan default awal.

const PERMISSIONS = {
  'dashboard.view': 'Melihat dashboard',
  'plan.view': 'Melihat Production Plan',
  'plan.write': 'Membuat dan merevisi Production Plan (DRAFT)',
  'plan.approve': 'Approve, aktivasi, dan close Production Plan',
  'shift.write': 'Membuka shift, mencatat aktual Mandor, dan menutup shift',
  'trolley.write': 'Mengubah status trolley dan assign Batch',
  'cake.write': 'Mencatat monitoring berat rata-rata Cake',
  'movement.write': 'Mencatat movement material/pallet',
  'downtime.write': 'Mencatat downtime non-Dryer / Press',
  'downtime.verify': 'Verifikasi downtime (berbeda dengan pencatat)',
  'handover.write': 'Mencatat handover shift',
  'dryer.write': 'Membuka dan mengelola Dryer Run',
 'dryer.stop': 'Stop / resume Dryer (SPV, Operator Dryer)',
  'dryer.view': 'Melihat Dryer Board',
  'sampling.write': 'Mencatat actual sampling Cake',
  'adjustment.request': 'Membuat Process Adjustment instruction',
  'adjustment.approve': 'Menyetujui Process Adjustment',
  'adjustment.execute': 'Melaksanakan Process Adjustment',
  'md.challenge': 'Mencatat challenge Metal Detector',
  'md.run': 'Start/stop Metal Detector',
  'bale.write': 'Mencatat count Bale normal',
  'exception.write': 'Mencatat exception Reject/Hold Bale',
  'exception.approve': 'Menyetujui exception',
  'pallet.write': 'Membuat, menutup, dan mengelola Pallet',
  'cutoff.request': 'Membuat Request Batch Cutoff',
  'cutoff.verify': 'Verifikasi Batch Cutoff',
  'cutoff.approve': 'Approval SPV untuk Batch di luar plan',
  'quality.release': 'QC Release / disposition Hold',
  'consumable.write': 'Mencatat transaksi consumable & energy',
  'consumable.price': 'Mengelola harga consumable (effective date)',
  'master.write': 'Mengelola master data',
  'correction.request': 'Mengajukan koreksi transaksi (wajib alasan)',
  'correction.approve': 'Menyetujui koreksi transaksi',
  'report.view': 'Melihat laporan',
  'report.export': 'Export laporan',
  'audit.view': 'Melihat audit trail',
  'user.manage': 'Mengelola user',
  'rbac.manage': 'Mengelola role dan hak akses',
};

const ROLES = {
  SPV: { name: 'SPV Produksi', perms: ['dashboard.view', 'plan.view', 'plan.write', 'plan.approve', 'dryer.view', 'dryer.stop', 'adjustment.request', 'adjustment.approve', 'exception.approve', 'cutoff.approve', 'correction.request', 'correction.approve', 'report.view', 'report.export'] },
  MANDOR: { name: 'Mandor', perms: ['dashboard.view', 'plan.view', 'dryer.view', 'shift.write', 'trolley.write', 'cake.write', 'movement.write', 'downtime.write', 'downtime.verify', 'handover.write', 'cutoff.verify', 'consumable.write', 'correction.request', 'report.view'] },
  OP_DRYER: { name: 'Operator Dryer', perms: ['plan.view', 'dryer.view', 'dryer.write', 'dryer.stop', 'sampling.write', 'adjustment.request', 'adjustment.execute'] },
  OP_MD: { name: 'Operator Metal Detector', perms: ['plan.view', 'md.challenge', 'md.run', 'bale.write', 'exception.write', 'pallet.write', 'cutoff.request', 'consumable.write', 'correction.request'] },
  QC: { name: 'QC', perms: ['dashboard.view', 'plan.view', 'quality.release', 'report.view', 'report.export'] },
  MANAGER: { name: 'Manager', perms: ['dashboard.view', 'plan.view', 'consumable.price', 'report.view', 'report.export', 'audit.view'] },
  ADMIN: { name: 'Admin Sistem', perms: ['master.write', 'user.manage', 'rbac.manage', 'audit.view', 'plan.view', 'dashboard.view'] },
  AUDITOR: { name: 'Document Control / Auditor', perms: ['dashboard.view', 'plan.view', 'report.view', 'report.export', 'audit.view'] },
};

module.exports = { PERMISSIONS, ROLES };
