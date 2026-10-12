'use strict';

const crypto = require('node:crypto');
const express = require('express');
const { nowIso, hashPassword, verifyPassword } = require('../db');
const { PERMISSIONS } = require('../rbac');
const {
  HttpError, badRequest, notFound, conflict, audit, setting, settingNumber,
  requireString, requireNumber, requireEnum, loadUserContext, optionalTime, sessionCookie, SESSION_COOKIE,
} = require('../http');

// Definisi resource master generik. Tidak ada endpoint DELETE: data master dinonaktifkan (active=0),
// sesuai aturan "No hard delete" (bagian 1.2 dan 9.3).
const MASTER = {
  equipment: {
    table: 'equipment',
    listOrder: 'code',
    create: (b) => ({
      code: requireString(b, 'code', { max: 40 }),
      name: requireString(b, 'name', { max: 120 }),
      type: requireEnum(b, 'type', ['DRYER', 'PRESS', 'PRESS_CHAMBER', 'MD', 'SCALE', 'SHREDDER', 'VORTEX_PUMP', 'FORKLIFT', 'FLOW_METER', 'THERMOMETER', 'FURNACE']),
      parent_code: b.parent_code || null,
      location: b.location || null,
      compartments: b.compartments == null || b.compartments === '' ? null : requireNumber(b, 'compartments', { min: 1, max: 200, integer: true }),
      notes: b.notes || null,
    }),
    update: ['name', 'location', 'active', 'notes', 'parent_code'],
  },
  batches: {
    table: 'batches',
    listOrder: 'code',
    create: (b) => ({
      code: requireString(b, 'code', { max: 40 }),
      work_order: b.work_order || null,
      product: b.product || null,
      grade: b.grade || null,
      material_source: b.material_source || null,
      status: b.status || 'ACTIVE',
      effective_date: b.effective_date || null,
    }),
    update: ['work_order', 'product', 'grade', 'material_source', 'status', 'effective_date'],
  },
  'reason-codes': {
    table: 'reason_codes',
    listOrder: 'category, code',
    create: (b) => ({
      category: requireEnum(b, 'category', ['DOWNTIME', 'ABNORMALITY', 'CORRECTION', 'HOLD_REJECT', 'MOVEMENT']),
      code: requireString(b, 'code', { max: 40 }),
      description: requireString(b, 'description', { max: 200 }),
      approval_required: b.approval_required ? 1 : 0,
    }),
    update: ['description', 'active', 'approval_required'],
  },
  'validated-settings': {
    table: 'validated_settings',
    listOrder: 'product, dryer_code, id DESC',
    create: (b) => ({
      product: requireString(b, 'product', { max: 120 }),
      dryer_code: requireEnum(b, 'dryer_code', ['DRY-A', 'DRY-B']),
      b1_temp: requireNumber(b, 'b1_temp', { min: 0, max: 400 }),
      b2_temp: requireNumber(b, 'b2_temp', { min: 0, max: 400 }),
      timer_min: requireNumber(b, 'timer_min', { min: 1, max: 100000 }),
      run_type: requireEnum(b, 'run_type', ['STARTUP_EMPTY', 'STEADY_WIP']),
      effective_date: requireString(b, 'effective_date', { max: 20 }),
      approved_by: requireString(b, 'approved_by', { max: 120 }),
    }),
    // Validated setting tidak di-overwrite: perubahan = revisi baru (versi lama tetap ada).
    update: ['active'],
  },
  trolleys: {
    table: 'trolleys',
    listOrder: 'code',
    create: (b) => ({
      code: requireString(b, 'code', { max: 40 }),
      status: 'AVAILABLE',
      location: b.location || 'Area Filling',
      condition: b.condition || null,
    }),
    update: ['location', 'active', 'condition'],
  },
};

const SETTING_KEYS = ['session_timeout_min', 'lockout_threshold', 'lockout_minutes', 'bale_per_pallet_max', 'chamber_repeat_alert', 'dryer_compartments'];

function publicUser(db, id) {
  const u = db.prepare('SELECT id, username, full_name, active, failed_attempts, locked_until, created_at FROM users WHERE id = ?').get(id);
  if (!u) return null;
  const roles = db.prepare('SELECT role_code FROM user_roles WHERE user_id = ? ORDER BY role_code').all(id).map((r) => r.role_code);
  return { ...u, active: !!u.active, roles };
}

function buildRouter(db, { requireAuth, requirePerm }) {
  const r = express.Router();

  // ---------- Auth ----------
  r.post('/auth/login', (req, res) => {
    const username = requireString(req.body || {}, 'username', { max: 60 }).trim();
    const password = requireString(req.body || {}, 'password', { max: 200 });
    // Username tidak peka huruf besar/kecil (Admin = admin).
    const user = db.prepare('SELECT * FROM users WHERE lower(username) = lower(?)').get(username);
    const genericError = new HttpError(401, 'Username atau password salah');
    if (!user) throw genericError;
    if (!user.active) throw new HttpError(403, 'Akun dinonaktifkan. Hubungi Admin Sistem.');
    if (user.locked_until && new Date(user.locked_until) > new Date()) {
      throw new HttpError(423, `Akun terkunci sampai ${user.locked_until}. Hubungi Admin atau tunggu.`);
    }
    if (!verifyPassword(password, user.password_hash)) {
      const threshold = settingNumber(db, 'lockout_threshold') || 5;
      const attempts = user.failed_attempts + 1;
      let lockedUntil = null;
      if (attempts >= threshold) {
        lockedUntil = new Date(Date.now() + (settingNumber(db, 'lockout_minutes') || 15) * 60000).toISOString();
      }
      db.prepare('UPDATE users SET failed_attempts = ?, locked_until = ? WHERE id = ?').run(attempts, lockedUntil, user.id);
      audit(db, { id: user.id, username, roles: [] }, { action: 'LOGIN_FAILED', entity: 'users', recordId: user.id });
      throw genericError;
    }
    db.prepare('UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = ?').run(user.id);
    const token = crypto.randomBytes(32).toString('hex');
    db.prepare('INSERT INTO sessions (token, user_id, created_at, last_seen) VALUES (?, ?, ?, ?)').run(token, user.id, nowIso(), nowIso());
    const ctx = loadUserContext(db, user.id);
    audit(db, ctx, { action: 'LOGIN', entity: 'users', recordId: user.id });
    res.setHeader('Set-Cookie', sessionCookie(token, 8 * 60 * 60));
    res.json({ token, user: ctx });
  });

  r.post('/auth/logout', requireAuth, (req, res) => {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(req.token);
    audit(db, req.user, { action: 'LOGOUT', entity: 'users', recordId: req.user.id });
    res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
    res.json({ ok: true });
  });

  r.get('/me', requireAuth, (req, res) => {
    res.json({ user: req.user, permissions: PERMISSIONS });
  });

  // ---------- Master data ----------
  for (const [slug, def] of Object.entries(MASTER)) {
    r.get(`/master/${slug}`, requireAuth, (req, res) => {
      const rows = db.prepare(`SELECT * FROM ${def.table} ORDER BY ${def.listOrder}`).all();
      res.json({ items: rows });
    });

    r.post(`/master/${slug}`, requireAuth, requirePerm('master.write'), (req, res) => {
      const values = def.create(req.body || {});
      const cols = Object.keys(values);
      const info = db.prepare(`INSERT INTO ${def.table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
        .run(...cols.map((c) => values[c]));
      const created = db.prepare(`SELECT * FROM ${def.table} WHERE id = ?`).get(Number(info.lastInsertRowid));
      audit(db, req.user, { action: 'CREATE', entity: def.table, recordId: created.id, newValue: created });
      res.status(201).json({ item: created });
    });

    r.patch(`/master/${slug}/:id`, requireAuth, requirePerm('master.write'), (req, res) => {
      const before = db.prepare(`SELECT * FROM ${def.table} WHERE id = ?`).get(Number(req.params.id));
      if (!before) throw notFound('Data master');
      const sets = [];
      const vals = [];
      const changed = {};
      for (const f of def.update) {
        if (req.body && Object.prototype.hasOwnProperty.call(req.body, f)) {
          const v = f === 'active' || f === 'approval_required' ? (req.body[f] ? 1 : 0) : req.body[f];
          sets.push(`${f} = ?`);
          vals.push(v);
          changed[f] = { from: before[f], to: v };
        }
      }
      if (!sets.length) throw badRequest('Tidak ada field yang diubah');
      db.prepare(`UPDATE ${def.table} SET ${sets.join(', ')} WHERE id = ?`).run(...vals, before.id);
      const after = db.prepare(`SELECT * FROM ${def.table} WHERE id = ?`).get(before.id);
      audit(db, req.user, { action: 'UPDATE', entity: def.table, recordId: before.id, oldValue: before, newValue: after, reason: req.body.reason || null });
      res.json({ item: after });
    });
  }

  // ---------- Users & RBAC (Admin) ----------
  r.get('/admin/users', requireAuth, requirePerm('user.manage'), (req, res) => {
    const ids = db.prepare('SELECT id FROM users ORDER BY username').all();
    res.json({ items: ids.map((x) => publicUser(db, x.id)) });
  });

  r.post('/admin/users', requireAuth, requirePerm('user.manage'), (req, res) => {
    const b = req.body || {};
    const username = requireString(b, 'username', { max: 60 });
    const fullName = requireString(b, 'full_name', { max: 120 });
    const password = requireString(b, 'password', { max: 200 });
    if (password.length < 8) throw badRequest('Password minimal 8 karakter');
    const roles = Array.isArray(b.roles) ? b.roles : [];
    if (!roles.length) throw badRequest('User wajib memiliki minimal satu role');
    const knownRoles = db.prepare('SELECT code FROM roles').all().map((x) => x.code);
    for (const role of roles) if (!knownRoles.includes(role)) throw badRequest(`Role tidak dikenal: ${role}`);
    if (db.prepare('SELECT id FROM users WHERE username = ?').get(username)) throw conflict('Username sudah digunakan');
    const info = db.prepare('INSERT INTO users (username, full_name, password_hash, created_at) VALUES (?, ?, ?, ?)')
      .run(username, fullName, hashPassword(password), nowIso());
    const id = Number(info.lastInsertRowid);
    for (const role of roles) db.prepare('INSERT INTO user_roles (user_id, role_code) VALUES (?, ?)').run(id, role);
    const item = publicUser(db, id);
    audit(db, req.user, { action: 'CREATE', entity: 'users', recordId: id, newValue: { username, roles } });
    res.status(201).json({ item });
  });

  r.patch('/admin/users/:id', requireAuth, requirePerm('user.manage'), (req, res) => {
    const id = Number(req.params.id);
    const before = publicUser(db, id);
    if (!before) throw notFound('User');
    const b = req.body || {};
    const changes = {};
    if (b.full_name !== undefined) {
      changes.full_name = requireString(b, 'full_name', { max: 120 });
      db.prepare('UPDATE users SET full_name = ? WHERE id = ?').run(changes.full_name, id);
    }
    if (b.active !== undefined) {
      if (id === req.user.id && !b.active) throw badRequest('Tidak dapat menonaktifkan akun sendiri');
      changes.active = !!b.active;
      db.prepare('UPDATE users SET active = ? WHERE id = ?').run(b.active ? 1 : 0, id);
      if (!b.active) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
    }
    if (b.unlock) {
      db.prepare('UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = ?').run(id);
      changes.unlocked = true;
    }
    if (b.password) {
      const pw = requireString(b, 'password', { max: 200 });
      if (pw.length < 8) throw badRequest('Password minimal 8 karakter');
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(pw), id);
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
      changes.password = 'RESET';
    }
    if (Array.isArray(b.roles)) {
      if (!b.roles.length) throw badRequest('User wajib memiliki minimal satu role');
      const knownRoles = db.prepare('SELECT code FROM roles').all().map((x) => x.code);
      for (const role of b.roles) if (!knownRoles.includes(role)) throw badRequest(`Role tidak dikenal: ${role}`);
      db.prepare('DELETE FROM user_roles WHERE user_id = ?').run(id);
      for (const role of b.roles) db.prepare('INSERT INTO user_roles (user_id, role_code) VALUES (?, ?)').run(id, role);
      changes.roles = b.roles;
    }
    const after = publicUser(db, id);
    audit(db, req.user, { action: 'UPDATE', entity: 'users', recordId: id, oldValue: before, newValue: after, reason: b.reason || null });
    res.json({ item: after, changes });
  });

  r.get('/admin/roles', requireAuth, requirePerm('user.manage'), (req, res) => {
    const roles = db.prepare('SELECT * FROM roles ORDER BY code').all().map((role) => ({
      ...role,
      permissions: db.prepare('SELECT permission FROM role_permissions WHERE role_code = ? ORDER BY permission').all(role.code).map((p) => p.permission),
    }));
    res.json({ roles, permissions: PERMISSIONS });
  });

  r.put('/admin/roles/:code/permissions', requireAuth, requirePerm('rbac.manage'), (req, res) => {
    const code = req.params.code;
    const role = db.prepare('SELECT * FROM roles WHERE code = ?').get(code);
    if (!role) throw notFound('Role');
    const perms = Array.isArray(req.body && req.body.permissions) ? req.body.permissions : null;
    if (!perms) throw badRequest('Field "permissions" harus berupa array');
    for (const p of perms) if (!PERMISSIONS[p]) throw badRequest(`Permission tidak dikenal: ${p}`);
    // Pengaman: Admin tetap memiliki rbac.manage agar tidak terkunci dari sistem.
    if (code === 'ADMIN' && !perms.includes('rbac.manage')) throw badRequest('Role ADMIN harus tetap memiliki rbac.manage');
    const before = db.prepare('SELECT permission FROM role_permissions WHERE role_code = ? ORDER BY permission').all(code).map((p) => p.permission);
    db.prepare('DELETE FROM role_permissions WHERE role_code = ?').run(code);
    for (const p of perms) db.prepare('INSERT INTO role_permissions (role_code, permission) VALUES (?, ?)').run(code, p);
    audit(db, req.user, { action: 'UPDATE', entity: 'role_permissions', recordId: code, oldValue: before, newValue: perms, reason: req.body.reason || null });
    res.json({ role: code, permissions: perms });
  });

  // ---------- Settings ----------
  r.get('/settings', requireAuth, (req, res) => {
    const rows = db.prepare('SELECT key, value FROM settings ORDER BY key').all();
    res.json({ items: rows });
  });

  r.put('/settings/:key', requireAuth, requirePerm('rbac.manage'), (req, res) => {
    const key = req.params.key;
    if (!SETTING_KEYS.includes(key)) throw badRequest('Setting tidak dapat diubah dari UI');
    const value = requireString(req.body || {}, 'value', { max: 50 });
    if (!Number.isFinite(Number(value)) || Number(value) <= 0) throw badRequest('Nilai setting harus angka positif');
    const old = setting(db, key);
    db.prepare('UPDATE settings SET value = ? WHERE key = ?').run(value, key);
    audit(db, req.user, { action: 'UPDATE', entity: 'settings', recordId: key, oldValue: old, newValue: value, reason: req.body.reason || null });
    res.json({ key, value });
  });

  // ---------- Audit trail ----------
  r.get('/audit', requireAuth, requirePerm('audit.view'), (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 200, 1000);
    const where = [];
    const vals = [];
    if (req.query.entity) { where.push('entity = ?'); vals.push(String(req.query.entity)); }
    if (req.query.action) { where.push('action = ?'); vals.push(String(req.query.action)); }
    if (req.query.username) { where.push('username = ?'); vals.push(String(req.query.username)); }
    const sql = `SELECT * FROM audit_logs ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC LIMIT ?`;
    res.json({ items: db.prepare(sql).all(...vals, limit) });
  });

  return r;
}

module.exports = { buildRouter, MASTER, optionalTime };
