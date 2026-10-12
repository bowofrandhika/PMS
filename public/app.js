/* Production Management System – SPA ringan (vanilla JS). Semua data diambil dari /api. */
(function () {
  'use strict';

  // Penyimpanan token aman: browser dapat memblokir localStorage di dalam iframe/preview.
  const store = {
    get() { try { return window.localStorage.getItem('pms_token'); } catch (e) { return null; } },
    set(v) { try { window.localStorage.setItem('pms_token', v); } catch (e) { /* abaikan */ } },
    del() { try { window.localStorage.removeItem('pms_token'); } catch (e) { /* abaikan */ } },
  };
  const S = {
    token: store.get() || null,
    me: null,
    tab: 'dash',
    planId: null,
    plans: [],
    runId: null,
    shiftId: null,
    palletId: null,
    flash: null,
    cache: {},
  };
  const app = document.getElementById('app');

  // ---------- util ----------
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const has = (p) => !!S.me && S.me.permissions.includes(p);
  const hasAny = (ps) => ps.some(has);
  const GRADES = ['SIR20', 'SIR10'];
  const BATCH_CODES = ['B-0001', 'B-0002', 'B-0003'];
  const BALE_KG = 35;
  const fmt = (n) => (n === null || n === undefined ? '—' : typeof n === 'number' ? n.toLocaleString('id-ID') : esc(n));
  const badge = (text, cls = '') => `<span class="badge ${cls}">${esc(text)}</span>`;
  const PLAN_STATUS = { DRAFT: 'BELUM MULAI', ACTIVE: 'BERJALAN', CLOSED: 'SELESAI', SUPERSEDED: 'RIWAYAT' };
  const statusCls = (s) => (/CLOSED|OK|PASS|VERIFIED|APPROVED|ACTIVE|RELEASED|EXECUTED/.test(s) ? 'ok' : /HOLD|REJECT|FAIL|OVERDUE|INCOMPLETE|PENDING|REQUESTED|STOPPED/.test(s) ? 'warn' : '');

  function flash(kind, text) { S.flash = { kind, text }; }

  async function api(method, url, body) {
    const headers = {};
    if (S.token) { headers.Authorization = 'Bearer ' + S.token; headers['X-PMS-Token'] = S.token; }
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetch('/api' + url, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
    const ct = res.headers.get('content-type') || '';
    const data = ct.includes('application/json') ? await res.json() : null;
    if (res.status === 401 && S.token && !url.startsWith('/auth/login')) {
      // Token tidak valid (sesi berakhir/diganti). Kembali ke login; pesan hanya jika sebelumnya sudah login.
      const wasLoggedIn = !!S.me;
      S.token = null; S.me = null; S.plans = []; store.del();
      const reason = data && data.error ? ` (${data.error})` : '';
      if (wasLoggedIn) S.flash = { kind: 'err', text: 'Sesi berakhir. Silakan login ulang.' + reason };
      const e = new Error('Sesi tidak valid' + reason);
      e.status = 401;
      throw e;
    }
    if (!res.ok) {
      const detail = data && data.details ? ' – ' + JSON.stringify(data.details) : '';
      const e = new Error(((data && data.error) || `Permintaan gagal (${res.status})`) + detail);
      e.status = res.status;
      throw e;
    }
    return data;
  }

  // Ambil nilai form: data-type="num|bool|json|multi|list" menentukan konversi.
  function readForm(form) {
    const out = {};
    for (const el of form.querySelectorAll('[name]')) {
      const t = el.dataset.type;
      const name = el.name;
      if (el.type === 'checkbox' && t === 'multi') {
        if (!out[name]) out[name] = [];
        if (el.checked) out[name].push(el.value);
        continue;
      }
      if (el.type === 'checkbox') { out[name] = el.checked; continue; }
      const raw = el.value;
      if (raw === '' || raw === null) { if (t !== 'json') continue; }
      if (t === 'num') out[name] = raw === '' ? undefined : Number(raw);
      else if (t === 'json') out[name] = raw.trim() ? JSON.parse(raw) : undefined;
      else if (t === 'list') out[name] = raw.split(',').map((s) => s.trim()).filter(Boolean);
      else out[name] = raw;
    }
    for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
    return out;
  }

  // ---------- layout ----------
  const TABS = [
    { id: 'dash', label: 'Dashboard', ok: () => has('dashboard.view'), view: viewDash },
    { id: 'plan', label: 'Nomor Produksi', ok: () => has('plan.view'), view: viewPlan },
    { id: 'wo', label: 'Work Order', ok: () => has('plan.view'), view: viewWO },
    { id: 'shift', label: 'Shift Mandor', ok: () => has('plan.view'), view: viewShift },
    { id: 'dryer', label: 'Dryer Board', ok: () => has('dryer.view'), view: viewDryer },
    { id: 'md', label: 'MD & Pallet', ok: () => has('plan.view'), view: viewMD },
    { id: 'kpi', label: 'OEE & Konsumsi', ok: () => has('dashboard.view'), view: viewKpi },
    { id: 'rep', label: 'Laporan', ok: () => has('report.view'), view: viewReports },
    { id: 'corr', label: 'Koreksi', ok: () => has('dashboard.view'), view: viewCorr },
    { id: 'riwayat', label: 'Riwayat', ok: () => has('deleted.view'), view: viewRiwayat },
    { id: 'admin', label: 'Admin', ok: () => hasAny(['user.manage', 'rbac.manage', 'master.write', 'audit.view']), view: viewAdmin },
  ];

  function shell(content) {
    const visible = TABS.filter((t) => t.ok());
    if (!visible.find((t) => t.id === S.tab)) S.tab = visible[0] ? visible[0].id : 'dash';
    const planOpts = S.plans.map((p) => `<option value="${p.id}" ${Number(S.planId) === p.id ? 'selected' : ''}>#${p.id} ${esc(p.plan_no)} v${p.version} · ${esc(PLAN_STATUS[p.status] || p.status)}</option>`).join('');
    const flashHtml = S.flash ? `<div class="msg ${S.flash.kind === 'err' ? 'err' : S.flash.kind === 'info' ? 'info' : 'ok'}">${esc(S.flash.text)}</div>` : '';
    return `
      <header class="top">
        <img class="logo" src="/logo.svg?v=5" alt="PT Potensi Bumi Sakti">
        <div>
          <div class="brand-title">Production Management System</div>
          <div class="brand-sub">PT Potensi Bumi Sakti · Produksi Kering</div>
        </div>
        <div class="grow"></div>
        <label>Production Plan aktif
          <select data-act="setPlan">${S.plans.length ? planOpts : '<option value="">(belum ada plan)</option>'}</select>
        </label>
        <div class="who"><b>${esc(S.me.fullName)}</b><br>${esc(S.me.roles.join(', '))}</div>
        <button class="btn sec" data-act="logout">Keluar</button>
      </header>
      <nav class="tabs">${visible.map((t) => `<button data-act="tab" data-id="${t.id}" class="${t.id === S.tab ? 'active' : ''}">${esc(t.label)}</button>`).join('')}</nav>
      <main>${flashHtml}${content}</main>`;
  }

  function loginView() {
    return `<div class="login-wrap"><div class="login">
      <img src="/logo.svg?v=5" alt="PT Potensi Bumi Sakti">
      <div class="login-title">Production Management System</div>
      <div class="login-sub">PT Potensi Bumi Sakti · Produksi Kering</div>
      <form data-form="login">
        <label>Username<input name="username" autocomplete="username" required></label>
        <label>Password<input name="password" type="password" autocomplete="current-password" required></label>
        <button class="btn" type="submit">Masuk</button>
      </form>
      ${S.flash ? `<div class="msg err">${esc(S.flash.text)}</div>` : ''}
      <p class="muted" style="font-size:12px;margin:18px 0 0">Akun individual · Zona waktu Asia/Jakarta</p>
    </div></div>`;
  }

  async function render() {
    try {
      if (!S.token) { app.innerHTML = loginView(); return; }
      if (!S.me) {
        try { S.me = (await api('GET', '/me')).user; } catch (e) { S.token = null; store.del(); app.innerHTML = loginView(); return; }
      }
      if (!S.me) { app.innerHTML = loginView(); return; }
      try { S.plans = (await api('GET', '/plans')).items; } catch (e) { S.plans = []; }
      if (!S.planId || !S.plans.some((p) => p.id === S.planId)) {
        const active = S.plans.find((p) => p.status === 'ACTIVE') || S.plans[0];
        S.planId = active ? active.id : null;
        S.runId = null; S.shiftId = null; S.palletId = null;
      }
      const tab = TABS.find((t) => t.id === S.tab && t.ok()) || TABS.find((t) => t.ok());
      S.tab = tab ? tab.id : 'dash';
      const body = tab ? await tab.view() : '<p class="muted">Tidak ada menu untuk role Anda.</p>';
      app.innerHTML = shell(body);
      S.flash = null;
    } catch (e) {
      if (e.status === 401 || !S.token) { app.innerHTML = loginView(); return; }
      app.innerHTML = shell(`<div class="msg err">${esc(e.message)}</div>`);
    }
  }

  function errMsg(e) { flash('err', e.message); return render(); }

  // ---------- actions (delegasi event) ----------
  const ACT = {
    async logout() {
      try { await api('POST', '/auth/logout'); } catch (e) { /* abaikan */ }
      S.token = null; S.me = null; S.plans = []; store.del(); render();
    },
    tab(el) { S.tab = el.dataset.id; render(); },
    editPlan(el) { S.editPlanId = Number(el.dataset.id); render(); },
    editWo(el) { S.editWoId = Number(el.dataset.id); render(); },
    cancelEdit() { S.editPlanId = null; S.editWoId = null; render(); },
    openHist(el) { S.histEntity = el.dataset.entity; S.histId = Number(el.dataset.id); S.histLabel = el.dataset.label || ''; S.histPage = 1; S.tab = 'riwayat'; render(); },
    clearHist() { S.histEntity = null; S.histId = null; S.histLabel = ''; render(); },
    histPage(el) { S.histPage = Math.max(1, Number(el.dataset.page) || 1); render(); },
    exportPeriod(el) {
      return ACT.run(el, async () => {
        const res = await fetch('/api/periods/current/export', { headers: { Authorization: 'Bearer ' + S.token, 'X-PMS-Token': S.token } });
        if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.error || 'Export gagal'); }
        const blob = await res.blob();
        const cd = res.headers.get('content-disposition') || '';
        const name = (cd.match(/filename="([^"]+)"/) || [])[1] || 'export.json';
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob); a.download = name;
        document.body.appendChild(a); a.click(); a.remove();
        return 'Export dibuat dan diunduh. Tutup buku bisa dilakukan setelah data dicek.';
      });
    },
    setPlan(el) { S.planId = el.value ? Number(el.value) : null; S.runId = null; S.shiftId = null; S.palletId = null; render(); },
    select(el) {
      const k = el.dataset.key;
      if (k === 'run') S.runId = Number(el.dataset.id);
      if (k === 'shift') S.shiftId = Number(el.dataset.id);
      if (k === 'pallet') S.palletId = Number(el.dataset.id);
      render();
    },
    async run(el, fn) {
      // Jalankan aksi API; tampilkan hasil atau error.
      try {
        const msg = await fn();
        flash('ok', msg || 'Berhasil disimpan.');
        if (el && el.dataset.reload === 'plans') S.plans = [];
      } catch (e) { flash('err', e.message); }
      render();
    },
  };

  // Aksi yang memerlukan API sederhana (dipanggil dari tombol data-api="METHOD|/path|jsonBody")
  async function onClick(e) {
    const el = e.target.closest('[data-act],[data-api]');
    if (!el || el.disabled || el.tagName === 'SELECT' || el.tagName === 'INPUT') return;
    if (el.dataset.confirm && !window.confirm(el.dataset.confirm)) return;
    if (el.dataset.act && ACT[el.dataset.act]) {
      if (el.tagName === 'BUTTON' && el.dataset.act !== 'tab' && el.dataset.act !== 'select') e.preventDefault();
      return ACT[el.dataset.act](el);
    }
    if (el.dataset.api) {
      e.preventDefault();
      const [method, path] = el.dataset.api.split('|');
      let body;
      if (el.dataset.prompt) {
        const v = window.prompt(el.dataset.prompt, el.dataset.default || '');
        if (v === null) return;
        body = el.dataset.field ? { [el.dataset.field]: v } : JSON.parse(v);
      } else if (el.dataset.body) {
        body = JSON.parse(el.dataset.body);
      }
      const url = path.replace(':id', el.dataset.id || '');
      return ACT.run(el, async () => {
        const res = await api(method, url, body);
        if (method === 'GET') { S.cache.lastResult = { url, res }; return el.dataset.ok || 'Data dimuat.'; }
        return el.dataset.ok || (res && res.note) || 'Berhasil.';
      });
    }
  }

  async function onSubmit(e) {
    const form = e.target;
    if (!form.dataset.form) return;
    e.preventDefault();
    const name = form.dataset.form;
    const btn = form.querySelector('button[type=submit]');
    if (btn) btn.disabled = true;
    try {
      const body = readForm(form);
      if (name === 'login') {
        S.flash = null;
        const res = await api('POST', '/auth/login', body);
        S.token = res.token; store.set(res.token);
        S.me = null; S.plans = []; S.planId = null;
        flash('ok', 'Login berhasil.');
        return render();
      }
      const spec = FORMS[name];
      const result = await spec.submit(body, form);
      flash('ok', (result && result.msg) || 'Berhasil disimpan.');
      if (spec.reloadPlans) S.plans = [];
      if (spec.afterSubmit) spec.afterSubmit(result, form);
      form.reset();
      render();
    } catch (err) {
      flash('err', err.message);
      render();
    }
  }

  // Sampling rule dari form biasa (bukan JSON), sama seperti kolom lain pada Nomor Produksi.
  function buildSampling(b) {
    const rules = [];
    if (b.sr_time) rules.push({ type: 'TIME_INTERVAL', interval_min: Number(b.sr_time) });
    if (b.sr_trolley) rules.push({ type: 'TROLLEY_INTERVAL', n: Number(b.sr_trolley) });
    const list = String(b.sr_specific || '').split(',').map((x) => x.trim()).filter(Boolean);
    if (list.length) rules.push({ type: 'SPECIFIC_TROLLEY', trolleys: list });
    if (b.sr_random) rules.push({ type: 'RANDOM', target: Number(b.sr_random) });
    return rules;
  }

  // Badan request Nomor Produksi dari form (create & edit).
  function buildPlanBody(b) {
    const body = { ...b };
    if (!body.plan_no) delete body.plan_no;
    const codes = String(body.batch_codes || '').split(',').map((c) => c.trim().toUpperCase()).filter(Boolean);
    if (new Set(codes).size !== codes.length) throw new Error('Kode batch tidak boleh duplikat.');
    body.batch_sequence = codes.map((code, i) => ({ batch_code: code, seq: i + 1 }));
    body.sampling_rules = buildSampling(body);
    for (const k of Object.keys(body)) if (/^batch_codes$|^sr_/.test(k)) delete body[k];
    // 1 Bale = 35 kg. Pakai nilai yang diisi duluan (kolom lainnya sudah terkunci otomatis).
    if (body.target_bale !== undefined && body.target_bale !== '') {
      body.target_bale = Math.round(Number(body.target_bale));
      body.target_kg = body.target_bale * BALE_KG;
    } else if (body.target_kg !== undefined && body.target_kg !== '') {
      body.target_bale = Math.round(Number(body.target_kg) / BALE_KG);
      body.target_kg = body.target_bale * BALE_KG;
    } else {
      delete body.target_bale; delete body.target_kg;
    }
    return body;
  }

  // ---------- form handlers ----------
  const FORMS = {
    planCreate: {
      reloadPlans: true,
      submit: (b) => api('POST', '/plans', buildPlanBody(b)).then((r) => ({ msg: `Nomor Produksi ${r.item.plan_no} dibuat (DRAFT).` })),
    },
    planEdit: {
      reloadPlans: true,
      submit: (b) => api('PATCH', `/plans/${S.editPlanId}`, buildPlanBody(b)).then((r) => ({ msg: `Nomor Produksi ${r.item.plan_no} diperbarui.` })),
      afterSubmit: () => { S.editPlanId = null; },
    },
    histSearch: {
      submit: (b) => { S.histQ = String(b.q || '').trim(); S.histPage = 1; return { msg: 'Pencarian diperbarui.' }; },
    },
    woEdit: {
      submit: (b) => api('PATCH', `/work-orders/${S.editWoId}`, { buyer: b.buyer, target_ton: b.target_ton, notes: b.notes || null }).then((r) => ({ msg: `WO ${r.item.wo_no} diperbarui.` })),
      afterSubmit: () => { S.editWoId = null; },
    },
    masterEdit: {
      submit: (b, form) => {
        let patch;
        try { patch = JSON.parse(b.body); } catch (e) { throw new Error('Isi perubahan harus JSON valid'); }
        return api('PATCH', `/master/${form.dataset.slug}/${Number(b.id)}`, patch).then(() => ({ msg: 'Data master diperbarui.' }));
      },
    },
    woCreate: {
      submit: (b) => api('POST', '/work-orders', b).then((r) => ({ msg: `WO ${r.item.wo_no} disimpan.` })),
    },
    shiftOpen: {
      submit: (b) => api('POST', '/shifts', { ...b, plan_id: S.planId }).then((r) => { S.shiftId = r.item.id; return { msg: 'Shift dibuka.' }; }),
    },
    mandorEvent: { submit: (b) => api('POST', `/shifts/${S.shiftId}/events`, b).then(() => ({ msg: 'Event Mandor tercatat.' })) },
    cakeWeight: { submit: (b) => api('POST', `/shifts/${S.shiftId}/cake-weights`, b).then(() => ({ msg: 'Berat rata-rata Cake tercatat.' })) },
    downtimeNew: { submit: (b) => api('POST', `/shifts/${S.shiftId}/downtime`, b).then(() => ({ msg: 'Downtime dicatat (OPEN).' })) },
    handover: { submit: (b) => api('POST', `/shifts/${S.shiftId}/handover`, b).then(() => ({ msg: 'Handover tercatat.' })) },
    trolleyStatus: { submit: (b) => api('POST', `/trolleys/${encodeURIComponent(b.code)}/status`, { status: b.status, batch_code: b.batch_code, remark: b.remark }).then(() => ({ msg: `Status trolley ${b.code} diubah.` })) },
    runNew: { submit: (b) => api('POST', '/dryer/runs', { ...b, plan_id: S.planId }).then((r) => { S.runId = r.item.id; return { msg: `Dryer Run #${r.item.id} dibuka.` }; }) },
    trolleyIn: { submit: (b) => api('POST', `/dryer/runs/${S.runId}/trolley-in`, { ...b, compartment: Number(b.compartment) }).then(() => ({ msg: 'Trolley masuk Dryer.' })) },
    reading: { submit: (b) => api('POST', `/dryer/runs/${S.runId}/readings`, b).then(() => ({ msg: 'Pembacaan tercatat.' })) },
    sample: { submit: (b) => api('POST', `/dryer/runs/${S.runId}/samples`, { ...b, ad_hoc: !!b.ad_hoc }).then(() => ({ msg: 'Sampling Cake tercatat.' })) },
    carryOver: { submit: (b) => api('POST', `/dryer/runs/${S.runId}/carry-over`, b).then(() => ({ msg: 'Carry-over dicatat.' })) },
    carryIn: { submit: (b) => api('POST', `/dryer/runs/${S.runId}/carry-in`, { ...b, compartment: Number(b.compartment) }).then(() => ({ msg: 'Carry-over masuk ke papan.' })) },
    adjRequest: { submit: (b) => api('POST', `/plans/${S.planId}/adjustments`, { ...b, run_id: S.runId || undefined }).then(() => ({ msg: 'Instruksi Process Adjustment dibuat (REQUESTED).' })) },
    challenge: { submit: (b) => api('POST', '/md/challenges', { ...b, plan_id: S.planId }).then(() => ({ msg: 'Challenge tercatat.' })) },
    bale: { submit: (b) => api('POST', '/md/bales', { ...b, plan_id: S.planId, pallet_id: S.palletId || undefined }).then((r) => ({ msg: `Count Bale OK +${r.qty} (Pallet #${r.pallet.id}: ${r.pallet.slot_count}/${r.pallet.max_bale}).` })) },
    exception: { submit: (b) => api('POST', '/md/exceptions', { ...b, plan_id: S.planId, pallet_id: S.palletId || undefined }).then(() => ({ msg: 'Exception Reject/Hold tercatat.' })) },
    palletNew: { submit: (b) => api('POST', '/md/pallets', { ...b, plan_id: S.planId }).then((r) => { S.palletId = r.item.id; return { msg: `Pallet #${r.item.id} dibuat.` }; }) },
    cutoffNew: { submit: (b) => api('POST', '/md/cutoffs', { ...b, plan_id: S.planId }).then((r) => ({ msg: r.note || 'Request Batch Cutoff dibuat.' })) },
    qcRelease: { submit: (b, form) => api('POST', `/quality/exceptions/${form.dataset.id}/release`, b).then(() => ({ msg: 'QC decision tersimpan.' })) },
    consumableTx: { submit: (b) => api('POST', '/consumables/transactions', { ...b, plan_id: S.planId }).then(() => ({ msg: 'Transaksi consumable tercatat.' })) },
    consumablePrice: { submit: (b, form) => api('POST', `/consumables/${form.dataset.id}/prices`, b).then(() => ({ msg: 'Harga disimpan (effective date).' })) },
    correctionNew: { submit: (b) => api('POST', '/corrections', b).then(() => ({ msg: 'Koreksi diajukan (PENDING approval SPV).' })) },
    userNew: { submit: (b) => api('POST', '/admin/users', b).then(() => ({ msg: 'User dibuat.' })) },
    masterNew: { submit: (b, form) => api('POST', `/master/${form.dataset.slug}`, b.body).then(() => ({ msg: 'Master data ditambahkan.' })) },
    settingSet: { submit: (b, form) => api('PUT', `/settings/${form.dataset.key}`, { value: b.value }).then(() => ({ msg: 'Setting diperbarui.' })) },
    report: { submit: () => Promise.resolve({ msg: '' }) },
  };

  // ---------- helper tampilan ----------
  function field(name, label, opts = {}) {
    const attrs = `name="${name}" ${opts.type ? `data-type="${opts.type}"` : ''} ${opts.required ? 'required' : ''} ${opts.value !== undefined ? `value="${esc(opts.value)}"` : ''} ${opts.placeholder ? `placeholder="${esc(opts.placeholder)}"` : ''}`;
    let input;
    if (opts.select) input = `<select ${attrs}>${opts.select.map((o) => { const v = typeof o === 'object' ? o.value : o; const l = typeof o === 'object' ? o.label : o; return `<option value="${esc(v)}" ${opts.value === v ? 'selected' : ''}>${esc(l)}</option>`; }).join('')}</select>`;
    else if (opts.textarea) input = `<textarea ${attrs.replace(/value="[^"]*"/, '')}>${esc(opts.value ?? '')}</textarea>`;
    else input = `<input ${attrs.replace(/value="[^"]*"/, '')} ${opts.value !== undefined ? `value="${esc(opts.value)}"` : ''} ${opts.type === 'num' ? 'type="number" step="any"' : ''}>`;
    return `<label>${esc(label)}${input}</label>`;
  }
  const checks = (name, items, checked = []) => `<div style="display:flex;gap:8px;flex-wrap:wrap">${items.map((i) => `<label style="flex-direction:row;align-items:center;color:var(--ink-2);text-transform:none;letter-spacing:0;font-size:13px;font-weight:500"><input type="checkbox" name="${name}" data-type="multi" value="${esc(i)}" ${checked.includes(i) ? 'checked' : ''} style="min-width:0">${esc(i)}</label>`).join('')}</div>`;
  const table = (cols, rows) => `<div class="scroll"><table><thead><tr>${cols.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${rows.length ? rows.join('') : `<tr><td colspan="${cols.length}" class="muted">Belum ada data.</td></tr>`}</tbody></table></div>`;
  const tr = (cells) => `<tr>${cells.map((c) => `<td>${c}</td>`).join('')}</tr>`;
  const needPlan = () => (S.planId ? '' : '<div class="msg info">Pilih atau buat Production Plan terlebih dahulu.</div>');
  const json = (v) => `<pre class="json">${esc(JSON.stringify(v, null, 2))}</pre>`;

  // ---------- VIEW: Dashboard ----------
  async function viewDash() {
    const d = await api('GET', `/dashboard${S.planId ? `?plan_id=${S.planId}` : ''}`);
    const bales = d.bales || [];
    const byCat = (c) => bales.find((b) => b.category === c) || { n: 0, gross: 0 };
    const ok = byCat('OK').n;
    const holdN = bales.filter((b) => b.category.startsWith('HOLD')).reduce((s, b) => s + b.n, 0);
    const rejN = bales.filter((b) => b.category.startsWith('REJECT')).reduce((s, b) => s + b.n, 0);
    const gross = bales.reduce((s, b) => s + (b.gross || 0), 0);
    const pend = d.pending;
    return `
      <h1>Dashboard ${d.plan ? `· ${esc(d.plan.plan_no)} v${d.plan.version} (${esc(d.plan.status)})` : ''}</h1>
      ${!d.plan ? '<div class="msg info">Belum ada plan ACTIVE. Buat dan aktifkan Production Plan.</div>' : ''}
      <div class="grid">
        <div class="kpi"><div class="v">${fmt(gross)}</div><div class="l">Gross Bale (count)</div></div>
        <div class="kpi"><div class="v">${fmt(ok)}</div><div class="l">Bale OK</div></div>
        <div class="kpi"><div class="v">${fmt(rejN)}</div><div class="l">Reject</div></div>
        <div class="kpi"><div class="v">${fmt(holdN)}</div><div class="l">Hold (belum Good sampai QC Release)</div></div>
        <div class="kpi"><div class="v">${d.md_running ? 'RUNNING' : 'STOP'}</div><div class="l">Metal Detector</div></div>
        <div class="kpi"><div class="v">${fmt((d.pallets || []).reduce((s, p) => s + p.n, 0))}</div><div class="l">Pallet (total)</div></div>
      </div>
      <h2>Menunggu tindakan / approval</h2>
      <div class="grid">
        <div class="kpi"><div class="v">${pend.plans_not_started}</div><div class="l">Plan belum dimulai</div></div>
        <div class="kpi"><div class="v">${pend.cutoffs_awaiting_action}</div><div class="l">Batch Cutoff belum final</div></div>
        <div class="kpi"><div class="v">${pend.adjustments_awaiting_approval}</div><div class="l">Process Adjustment REQUESTED</div></div>
        <div class="kpi"><div class="v">${pend.corrections_awaiting_approval}</div><div class="l">Koreksi PENDING</div></div>
        <div class="kpi"><div class="v">${pend.qc_exceptions_pending}</div><div class="l">Hold/Reject menunggu QC</div></div>
      </div>
      <h2>Status OEE Dryer</h2>
      ${d.oee_status ? table(['Dryer', 'Status'], Object.entries(d.oee_status).map(([k, v]) => tr([esc(k), `<span class="incomplete">${esc(v)}</span>`]))) : '<p class="muted">—</p>'}
      <h2>Status trolley</h2>
      ${table(['Status', 'Jumlah'], (d.trolley_status || []).map((t) => tr([esc(t.status), fmt(t.n)])))}
      <p class="muted" style="font-size:12px">${esc(d.note)}</p>`;
  }

  // Form Nomor Produksi. p = null untuk buat baru, atau plan DRAFT untuk diubah (nilai terisi).
  function planFormHtml(p, wos) {
    const v = p || {};
    const batchCodes = (v.batch_sequence || []).map((b) => b.batch_code).join(', ');
    const sr = (v.sampling_rules || []);
    const srOf = (t) => sr.find((r) => r.type === t) || {};
    const isEdit = !!p;
    return `
      ${wos.length ? '' : '<div class="msg info">Belum ada Work Order aktif. Tambahkan di menu Work Order.</div>'}
      <form class="inline" data-form="${isEdit ? 'planEdit' : 'planCreate'}">
        ${isEdit ? field('plan_no', 'Nomor Produksi (ubah jika salah input)', { required: true, value: v.plan_no }) : ''}
        ${isEdit ? '<p class="muted" style="font-size:12px;flex-basis:100%">Mengubah tanggal atau shift akan memindahkan semua shift milik Nomor Produksi ini. Waktu kejadian aktual (trolley, bale, Dryer) tidak diubah.</p>' : ''}
        ${field('plan_date', 'Tanggal produksi', { required: true, type: 'date', value: v.plan_date || new Date().toISOString().slice(0, 10) })}
        ${field('shift_code', 'Shift', { required: true, select: ['1', '2', '3'], value: v.shift_code || '1' })}
        ${field('work_order', 'Work Order (WO)', { required: true, value: v.work_order || '', select: wos.map((w) => ({ value: w.wo_no, label: `${w.wo_no} · ${w.buyer} · ${w.target_ton} ton` })) })}
        ${field('product', 'Grade', { required: true, select: GRADES, value: v.product || 'SIR20' })}
        <label>Target Bale<input type="number" name="target_bale" min="0" step="1" data-sync="bale" value="${v.target_bale ?? ''}"></label>
        <label>Target kg<input type="number" name="target_kg" min="0" step="35" data-sync="kg" value="${v.target_kg ?? ''}"></label>
        <p class="muted" style="font-size:12px;flex-basis:100%">1 Bale = 35 kg. Isi salah satu; yang lain terisi otomatis (yang diisi duluan yang dipakai).</p>
        ${field('cake_interval_min', 'Interval berat Cake (menit)', { select: [30, 60], value: v.cake_interval_min || 60, type: 'num' })}
        <div><div class="muted" style="font-size:12px">Dryer aktif</div>${checks('dryers', ['DRY-A', 'DRY-B'], v.dryers || ['DRY-A'])}</div>
        <div><div class="muted" style="font-size:12px">Press aktif</div>${checks('presses', ['PRS-A', 'PRS-B', 'PRS-C'], v.presses || ['PRS-A'])}</div>
        ${field('batch_codes', 'Kode batch produksi (pisahkan koma)', { required: true, placeholder: 'B-0023, B-0024', value: batchCodes })}
        <div style="flex-basis:100%"><div class="muted" style="font-size:12px">Sampling (kosongkan yang tidak dipakai)</div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            ${field('sr_time', 'Interval waktu (menit)', { type: 'num', value: srOf('TIME_INTERVAL').interval_min ?? (isEdit ? '' : 30) })}
            ${field('sr_trolley', 'Setiap N trolley', { type: 'num', value: srOf('TROLLEY_INTERVAL').n ?? '' })}
            ${field('sr_specific', 'Trolley khusus (pisahkan koma)', { placeholder: 'TRL-01, TRL-05', value: (srOf('SPECIFIC_TROLLEY').trolleys || []).join(', ') })}
            ${field('sr_random', 'Target sampel random', { type: 'num', value: srOf('RANDOM').target ?? '' })}
          </div></div>
        <button class="btn" type="submit">${isEdit ? 'Simpan perubahan' : 'Simpan DRAFT'}</button>
      </form>`;
  }

  // ---------- VIEW: Production Plan ----------
  async function viewPlan() {
    const plans = (await api('GET', '/plans')).items;
    S.plans = plans;
    const canWrite = has('plan.write');
    const wos = canWrite ? (await api('GET', '/work-orders')).items.filter((w) => w.status === 'ACTIVE') : [];
    const editing = S.editPlanId ? plans.find((p) => p.id === S.editPlanId) : null;
    if (S.editPlanId && !editing) S.editPlanId = null;
    const rows = plans.map((p) => {
      const acts = [];
      if (has('data.edit')) acts.push(`<button class="btn sec" data-act="editPlan" data-id="${p.id}">Ubah</button>`);
      if (has('data.edit')) acts.push(`<button class="btn sec" data-api="POST|/plans/:id/sync-shifts" data-id="${p.id}" data-ok="Shift disinkronkan dengan Nomor Produksi." title="Samakan tanggal dan shift semua shift dengan Nomor Produksi ini">Sinkron shift</button>`);
      if (has('deleted.view')) acts.push(`<button class="btn sec" data-act="openHist" data-entity="production_plans" data-id="${p.id}" data-label="${esc(p.plan_no)}">Riwayat</button>`);
      if (has('hard.delete')) acts.push(`<button class="btn bad" data-api="DELETE|/plans/:id" data-id="${p.id}" data-field="reason" data-prompt="Alasan hapus permanen (tercatat di riwayat):" data-confirm="Hapus permanen Nomor Produksi DRAFT ini?" data-ok="Nomor Produksi dihapus permanen (tersimpan di riwayat).">Hapus</button>`);
      if (canWrite && p.status === 'DRAFT') acts.push(`<button class="btn" data-api="POST|/plans/:id/start" data-id="${p.id}" data-confirm="Mulai produksi plan ini? Statusnya menjadi BERJALAN." data-ok="Produksi dimulai.">Mulai produksi</button>`);
      if (canWrite && p.status === 'ACTIVE') acts.push(`<button class="btn warn" data-api="POST|/plans/:id/close" data-id="${p.id}" data-confirm="Selesaikan plan ini? Setelah selesai tidak bisa berjalan lagi." data-ok="Plan diselesaikan.">Selesai</button>`);
      return tr([`<button class="link" data-act="select" data-key="plan" data-id="${p.id}">#${p.id}</button>`, esc(p.plan_no), fmt(p.version), `<span class="badge ${statusCls(p.status)}">${esc(PLAN_STATUS[p.status] || p.status)}</span>`, esc(p.plan_date), esc(p.shift_code), esc(p.work_order || '—'), esc(p.product), fmt(p.target_bale), esc(p.dryers.join(', ')), esc(p.presses.join(', ')), acts.join(' ')]);
    });
    let equip = '';
    if (S.planId) {
      const rd = await api('GET', `/equipment/readiness?plan_id=${S.planId}`);
      equip = `<p class="muted" style="font-size:12px"><b>SIAP</b> = boleh dijalankan sekarang. <b>TIDAK SIAP</b> = ada alasan di kolom sebelahnya yang harus diselesaikan dulu. Hanya dibaca; status berubah otomatis dari plan, run Dryer, MD, dan downtime.</p>`
        + table(['Kode', 'Nama', 'Tipe', 'Status sekarang', 'Kesiapan', 'Alasan'], rd.items.map((x) => tr([
          esc(x.code), esc(x.name), esc(x.type),
          `<span class="badge ${statusCls(x.status)}">${esc(x.status)}</span>`,
          `<span class="badge ${x.ready ? 'ok' : 'warn'}">${esc(x.label)}</span>`,
          x.reasons.length ? esc(x.reasons.join('; ')) : '<span class="muted">—</span>',
        ])))
        + `<p class="muted" style="font-size:12px"><b>Cara cek:</b> Dryer siap bila dipilih di plan, tidak ada downtime terbuka, ada setting tervalidasi (B1/B2/Timer) untuk grade plan, dan belum berjalan. Press siap bila dipilih dan masih ada chamber yang berfungsi. MD siap bila challenge Fe, Non-Fe, dan SS 2.5 sudah PASS sejak STOP terakhir.</p>`;
    }
    return `
      <h1>Nomor Produksi</h1>
      ${table(['ID', 'Nomor Produksi', 'Versi', 'Status', 'Tanggal', 'Shift', 'Work Order', 'Grade', 'Target Bale', 'Dryer', 'Press', 'Aksi'], rows)}
      <p class="muted" style="font-size:12px">Alur: BELUM MULAI → Mulai produksi → BERJALAN → Selesai → SELESAI. Nomor Produksi boleh diubah kapan saja, termasuk setelah SELESAI (nomor, tanggal, shift). Perubahan tanggal atau shift ikut memindahkan shift terkait. Setiap perubahan tercatat di Riwayat. Hapus hanya jika belum ada data produksi.</p>
      ${canWrite && !editing ? `<h2>Buat Nomor Produksi baru</h2>${planFormHtml(null, wos)}` : ''}
      ${canWrite && editing ? `<h2>Ubah Nomor Produksi ${esc(editing.plan_no)}</h2>${planFormHtml(editing, wos)}<button class="btn sec" data-act="cancelEdit" type="button">Batal ubah</button>` : ''}
      <h2>Kesiapan alat (Nomor Produksi terpilih)</h2>
      ${equip || '<p class="muted">Pilih plan.</p>'}`;
  }

  // ---------- VIEW: Work Order ----------
  async function viewWO() {
    const items = (await api('GET', '/work-orders')).items;
    const canWrite = has('wo.write');
    const canDelete = has('hard.delete');
    const editingWo = S.editWoId ? items.find((w) => w.id === S.editWoId) : null;
    if (S.editWoId && !editingWo) S.editWoId = null;
    const ton = (kg) => (Math.round((kg / 1000) * 1000) / 1000).toLocaleString('id-ID');
    const rows = items.map((w) => tr([
      esc(w.wo_no), esc(w.buyer), fmt(w.target_ton), `${ton(w.produced_kg)}`,
      w.progress_pct === null ? '—' : `<b>${fmt(w.progress_pct)}%</b>`,
      `${ton(Math.max(0, w.target_kg - w.produced_kg))}`,
      fmt(w.plans.length),
      `<span class="badge ${statusCls(w.status)}">${esc(w.status)}</span>`,
      canWrite ? `<button class="btn sec" data-act="editWo" data-id="${w.id}">Ubah</button> <button class="btn ${w.status === 'ACTIVE' ? 'warn' : ''}" data-api="POST|/work-orders/:id/toggle" data-id="${w.id}" data-ok="Status WO diubah.">${w.status === 'ACTIVE' ? 'Nonaktifkan' : 'Aktifkan'}</button>` : '',
      has('deleted.view') ? `<button class="btn sec" data-act="openHist" data-entity="work_orders" data-id="${w.id}" data-label="${esc(w.wo_no)}">Riwayat</button>` : '',
      canDelete && !w.plans.length ? ` <button class="btn bad" data-api="DELETE|/work-orders/:id" data-id="${w.id}" data-field="reason" data-prompt="Alasan hapus permanen WO (tercatat di riwayat):" data-confirm="Hapus permanen WO ${esc(w.wo_no)}?" data-ok="WO dihapus permanen (tersimpan di riwayat).">Hapus</button>` : '',
    ]));
    const planRows = items.flatMap((w) => w.plans.map((p) => tr([esc(w.wo_no), esc(p.plan_no), esc(p.plan_date), esc(p.shift_code), `<span class="badge ${statusCls(p.status)}">${esc(PLAN_STATUS[p.status] || p.status)}</span>`, fmt(p.bale), fmt(p.kg)])));
    return `
      <h1>Work Order (WO)</h1>
      <p class="muted" style="font-size:12px">Produksi WO dihitung otomatis dari semua Bale output (OK + Hold + Reject) pada Nomor Produksi yang memakai WO tersebut. 1 Bale = 35 kg. Satu WO bisa terdiri dari beberapa hari produksi.</p>
      ${table(['Nomor WO', 'Buyer', 'Target (ton)', 'Terproduksi (ton)', 'Progres', 'Sisa (ton)', 'Jml Nomor Produksi', 'Status', 'Aksi'], rows)}
      <h2>Rincian Nomor Produksi per WO</h2>
      ${table(['WO', 'Nomor Produksi', 'Tanggal', 'Shift', 'Status', 'Bale', 'kg'], planRows)}
      ${canWrite && editingWo ? `<h2>Ubah WO ${esc(editingWo.wo_no)}</h2>
      <form class="inline" data-form="woEdit">
        ${field('buyer', 'Buyer', { required: true, value: editingWo.buyer })}
        ${field('target_ton', 'Target (ton)', { required: true, type: 'num', value: editingWo.target_ton })}
        ${field('notes', 'Catatan', { value: editingWo.notes || '' })}
        <button class="btn" type="submit">Simpan perubahan</button>
      </form>
      <button class="btn sec" data-act="cancelEdit" type="button">Batal ubah</button>` : ''}
      ${canWrite && !editingWo ? `<h2>Tambah WO</h2>
      <form class="inline" data-form="woCreate">
        ${field('wo_no', 'Nomor WO', { required: true, placeholder: 'WO-BELL-002' })}
        ${field('buyer', 'Buyer', { required: true, placeholder: 'Bellshina' })}
        ${field('target_ton', 'Target (ton)', { required: true, type: 'num' })}
        ${field('notes', 'Catatan')}
        <button class="btn" type="submit">Simpan WO</button>
      </form>` : ''}`;
  }

  // ---------- VIEW: Shift Mandor ----------
  async function viewShift() {
    if (!S.planId) return needPlan();
    const shifts = (await api('GET', `/shifts?plan_id=${S.planId}`)).items;
    const rows = shifts.map((s) => tr([`<button class="link" data-act="select" data-key="shift" data-id="${s.id}">#${s.id}</button>`, esc(s.shift_date), esc(s.shift_code), `<span class="badge ${statusCls(s.status)}">${esc(s.status)}</span>`, esc(s.opened_by)]));
    let detail = '';
    if (S.shiftId) {
      const d = await api('GET', `/shifts/${S.shiftId}`);
      const open = d.item.status === 'OPEN';
      const trolleys = (await api('GET', '/trolleys')).items;
      detail = `
        <h2>Shift #${d.item.id} · ${esc(d.item.shift_date)} ${esc(d.item.shift_code)} <span class="badge ${statusCls(d.item.status)}">${esc(d.item.status)}</span></h2>
        ${open && has('shift.write') ? `
        <div class="card"><b>Event Mandor</b>
          <form class="inline" data-form="mandorEvent">
            ${field('kind', 'Jenis', { select: ['HARVEST', 'TRANSFER_BLANKET', 'SHREDDER_START', 'SHREDDER_STOP', 'FILLING', 'MOVEMENT'] })}
            ${field('batch_code', 'Batch', { value: 'B-0001' })}
            ${field('trolley_code', 'Trolley', { value: 'TRL-01' })}
            ${field('qty_kg', 'Qty kg', { type: 'num' })}
            ${field('from_loc', 'Dari')}${field('to_loc', 'Ke')}${field('forklift_code', 'Forklift')}
            ${field('remark', 'Catatan')}
            <button class="btn" type="submit">Catat</button>
          </form></div>
        <div class="card"><b>Status trolley</b>
          <form class="inline" data-form="trolleyStatus">
            ${field('code', 'Trolley', { select: trolleys.map((t) => t.code) })}
            ${field('status', 'Status baru', { select: ['AVAILABLE/EMPTY', 'FILLING', 'FILLED/READY', 'HOLD', 'CLEANING', 'REPAIR'] })}
            ${field('batch_code', 'Batch (opsional)')}
            ${field('remark', 'Catatan')}
            <button class="btn" type="submit">Ubah status</button>
          </form></div>
        <div class="card"><b>Berat rata-rata Cake (interval plan)</b>
          <form class="inline" data-form="cakeWeight">
            ${field('avg_kg', 'Rata-rata kg', { type: 'num', required: true })}
            ${field('dryer_code', 'Dryer', { select: ['DRY-A', 'DRY-B'] })}
            ${field('trolley_code', 'Trolley')}
            ${field('remark', 'Catatan')}
            <button class="btn" type="submit">Catat</button>
          </form></div>
        <div class="card"><b>Downtime non-Dryer / Press</b>
          <form class="inline" data-form="downtimeNew">
            ${field('equipment_code', 'Equipment', { value: 'SHRED-01' })}
            ${field('reason_code_id', 'Reason ID (DOWNTIME)', { type: 'num', value: 1 })}
            ${field('line_impact', 'Dampak line')}
            ${field('action', 'Tindakan')}
            <button class="btn" type="submit">Catat downtime</button>
          </form>
          <p class="muted" style="font-size:12px">Reason ID: lihat Master → reason_codes (kategori DOWNTIME).</p></div>
        <div class="card"><b>Handover</b>
          <form class="inline" data-form="handover">
            ${field('wip_summary', 'Ringkasan WIP')}${field('partial_pallets', 'Partial pallet')}
            ${field('open_issues', 'Isu terbuka')}${field('carry_over', 'Carry-over')}
            ${field('next_action', 'Tindak lanjut', { required: true })}${field('incoming_user', 'Shift masuk (user)')}
            <button class="btn" type="submit">Simpan handover</button>
          </form></div>
        <button class="btn warn" data-api="POST|/shifts/:id/close" data-id="${d.item.id}" data-confirm="Tutup shift ini?" data-ok="Shift ditutup.">Tutup shift</button>` : ''}
        <h2>Event</h2>
        ${table(['Waktu', 'Jenis', 'Batch', 'Trolley', 'Kg', 'Dari→Ke', 'Oleh'], d.events.map((e) => tr([esc(e.at), esc(e.kind), esc(e.batch_id ?? ''), esc(e.trolley_code ?? ''), fmt(e.qty_kg), esc(`${e.from_loc ?? ''} → ${e.to_loc ?? ''}`), esc(e.by)])))}
        <h2>Downtime</h2>
        ${table(['ID', 'Equipment', 'Mulai', 'Selesai', 'Status', 'Aksi'], d.downtime.map((x) => tr([fmt(x.id), esc(x.equipment_code), esc(x.start_at), esc(x.end_at ?? '—'), `<span class="badge ${statusCls(x.status)}">${esc(x.status)}</span>`,
          (x.status === 'OPEN' ? `<button class="btn sec" data-api="POST|/downtime/:id/end" data-id="${x.id}" data-ok="Downtime diakhiri.">Akhiri</button>` : '') + (x.status === 'ENDED' && has('downtime.verify') ? ` <button class="btn" data-api="POST|/downtime/:id/verify" data-id="${x.id}" data-ok="Downtime diverifikasi.">Verifikasi</button>` : '')])))}
        <h2>Berat Cake</h2>
        ${table(['Waktu', 'Dryer', 'Trolley', 'Rata-rata kg'], d.cake_weights.map((c) => tr([esc(c.monitored_at), esc(c.dryer_code ?? ''), esc(c.trolley_code ?? ''), fmt(c.avg_kg)])))}
        ${d.handover ? `<h2>Handover terakhir</h2>${json(d.handover)}` : ''}`;
    }
    return `
      <h1>Shift Mandor</h1>
      ${has('shift.write') ? `<form class="inline card" data-form="shiftOpen">
        <p class="muted" style="font-size:12px;flex-basis:100%">Tanggal shift mengikuti tanggal Nomor Produksi aktif. Untuk mengubah tanggal, edit Nomor Produksi.</p>
        ${field('shift_code', 'Kode shift', { required: true, value: '1' })}
        <button class="btn" type="submit">Buka shift</button></form>` : ''}
      ${table(['ID', 'Tanggal', 'Shift', 'Status', 'Dibuka oleh'], rows)}
      ${detail}`;
  }

  // ---------- VIEW: Dryer Board ----------
  async function viewDryer() {
    if (!S.planId) return needPlan();
    const runs = (await api('GET', `/dryer/runs?plan_id=${S.planId}`)).items;
    const rows = runs.map((r) => tr([`<button class="link" data-act="select" data-key="run" data-id="${r.id}">#${r.id}</button>`, esc(r.dryer_code), esc(r.run_type), `<span class="badge ${statusCls(r.status)}">${esc(r.status)}</span>`, esc(r.started_at), fmt(r.timer_on_min)]));
    let detail = '';
    if (S.runId) {
      const d = await api('GET', `/dryer/runs/${S.runId}`);
      const run = d.item;
      const closed = run.status === 'CLOSED';
      const adjs = d.adjustments;
      const trolleys = has('dryer.write') ? (await api('GET', '/trolleys?status=FILLED/READY')).items : [];
      const board = d.compartments.map((c) => `<div class="comp ${c.trolley_code ? 'busy' : ''}"><b>K${c.compartment}</b>${c.trolley_code ? `${esc(c.trolley_code)}<br><span class="muted">${esc(c.since ?? '')}</span>${!closed && has('dryer.write') ? `<br><button class="btn sec" style="padding:2px 6px;margin-top:4px" data-api="POST|/dryer/runs/:id/trolley-out" data-id="${run.id}" data-body='${JSON.stringify({ compartment: c.compartment })}' data-ok="Trolley keluar.">OUT</button>` : ''}` : '<span class="muted">kosong</span>'}</div>`).join('');
      const empty = d.compartments.filter((c) => !c.trolley_code).map((c) => c.compartment);
      detail = `
        <h2>Dryer Run #${run.id} · ${esc(run.dryer_code)} · <span class="badge ${statusCls(run.status)}">${esc(run.status)}</span> · Timer ON ${fmt(run.timer_on_min)} min</h2>
        <p class="muted" style="font-size:12px">Plan #${d.plan.id} v${d.plan.version} (${esc(d.plan.status)}). Papan 23 kompartemen (Burner 1 belakang, Burner 2 depan).</p>
        <div class="board">${board}</div>
        ${!closed && has('dryer.write') && empty.length ? `<div class="card"><b>Trolley masuk</b>
          <form class="inline" data-form="trolleyIn">
            ${field('compartment', 'Kompartemen kosong', { select: empty, type: 'num' })}
            ${field('trolley_code', 'Trolley (FILLED/READY)', { select: trolleys.map((t) => t.code) })}
            <button class="btn" type="submit">Trolley IN</button></form></div>` : ''}
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin:8px 0">
          ${has('dryer.stop') && run.status === 'RUNNING' ? `<button class="btn warn" data-api="POST|/dryer/runs/:id/stop" data-id="${run.id}" data-prompt="Alasan stop (opsional):" data-field="remark" data-default="" data-ok="Dryer STOPPED.">Stop</button>` : ''}
          ${has('dryer.stop') && run.status === 'STOPPED' ? `<button class="btn" data-api="POST|/dryer/runs/:id/restart" data-id="${run.id}" data-ok="Dryer RUNNING kembali.">Resume</button>` : ''}
          ${has('dryer.write') && !closed ? `<button class="btn bad" data-api="POST|/dryer/runs/:id/close" data-id="${run.id}" data-confirm="Tutup Dryer Run? Pastikan board kosong." data-ok="Dryer Run ditutup.">Close run</button>` : ''}
          <button class="btn sec" data-api="GET|/dryer/runs/:id/sampling-compliance" data-id="${run.id}" data-ok="Compliance dimuat (lihat di bawah).">Cek compliance sampling</button>
        </div>
        ${!closed && has('dryer.write') ? `<div class="card"><b>Pembacaan suhu / Timer</b>
          <form class="inline" data-form="reading">
            ${field('b1_temp', 'B1 (°C)', { type: 'num' })}${field('b2_temp', 'B2 (°C)', { type: 'num' })}${field('ref_temp', 'Reference (°C)', { type: 'num' })}${field('timer_min', 'Timer (menit)', { type: 'num' })}
            <button class="btn" type="submit">Catat</button></form></div>
        <div class="card"><b>Sampling Cake</b>
          <form class="inline" data-form="sample">
            ${field('trolley_code', 'Trolley', { required: true })}${field('p0', 'P0', { type: 'num' })}${field('mv', 'MV', { type: 'num' })}${field('pri', 'PRI', { type: 'num' })}
            <label style="flex-direction:row;align-items:center;color:var(--ink-2);text-transform:none;letter-spacing:0;font-size:13px;font-weight:500"><input type="checkbox" name="ad_hoc" data-type="bool" style="min-width:0"> AD HOC</label>
            ${field('reason', 'Alasan (wajib jika AD HOC)')}
            <button class="btn" type="submit">Catat sampel</button></form></div>` : ''}
        ${S.cache.lastResult && S.cache.lastResult.url.includes('sampling-compliance') && S.cache.lastResult.url.includes(`/runs/${run.id}/`) ? `<h2>Compliance sampling</h2>${json(S.cache.lastResult.res)}` : ''}
        ${!closed && has('dryer.write') ? `<div class="card"><b>Carry-over keluar</b> <span class="muted">(trolley WIP dilepas dari papan run ini, tetap IN DRYER)</span>
          <form class="inline" data-form="carryOver">${field('trolley_code', 'Trolley', { required: true })}${field('remark', 'Catatan')}<button class="btn" type="submit">Catat carry-over</button></form></div>
        <div class="card"><b>Carry-over masuk</b> <span class="muted">(trolley WIP dari run sebelumnya ditempatkan di kompartemen)</span>
          <form class="inline" data-form="carryIn">${field('compartment', 'Kompartemen', { type: 'num', required: true, value: 1 })}${field('trolley_code', 'Trolley', { required: true })}<button class="btn" type="submit">Masukkan ke papan</button></form></div>` : ''}
        <h2>Process Adjustment</h2>
        ${has('adjustment.request') && !closed ? `<div class="card"><form class="inline" data-form="adjRequest">
          ${field('instruction', 'Instruksi', { required: true })}${field('trigger_reason', 'Pemicu')}${field('before_setting', 'Sebelum')}${field('after_setting', 'Sesudah')}
          <button class="btn" type="submit">Buat instruksi</button></form></div>` : ''}
        ${table(['ID', 'Instruksi', 'Status', 'Diminta', 'Disetujui', 'Aksi'], adjs.map((a) => tr([fmt(a.id), esc(a.instruction), `<span class="badge ${statusCls(a.status)}">${esc(a.status)}</span>`, esc(a.requested_by), esc(a.approved_by ?? '—'),
          (a.status === 'REQUESTED' && has('adjustment.approve') ? `<button class="btn" data-api="POST|/adjustments/:id/approve" data-id="${a.id}" data-ok="Disetujui.">Setujui</button> <button class="btn bad" data-api="POST|/adjustments/:id/reject" data-id="${a.id}" data-prompt="Alasan penolakan:" data-field="reason" data-default="" data-ok="Ditolak.">Tolak</button>` : '') +
          (a.status === 'APPROVED' && has('adjustment.execute') ? ` <button class="btn sec" data-api="POST|/adjustments/:id/execute" data-id="${a.id}" data-prompt="Hasil pelaksanaan:" data-field="result" data-default="" data-ok="Dilaksanakan.">Laksanakan</button>` : '')]))) }
        <h2>Event Dryer Run</h2>
        ${table(['Waktu', 'Jenis', 'Kompartemen', 'Trolley', 'B1', 'B2', 'Ref', 'Timer', 'Catatan', 'Oleh'], d.events.map((e) => tr([esc(e.at), esc(e.kind), fmt(e.compartment), esc(e.trolley_code ?? ''), fmt(e.b1_temp), fmt(e.b2_temp), fmt(e.ref_temp), fmt(e.timer_min), esc(e.remark ?? ''), esc(e.by)])))}
        <h2>Sampel Cake</h2>
        ${table(['Trolley', 'Urutan', 'Aktual', 'AD HOC', 'Alasan', 'P0', 'MV', 'PRI', 'Oleh'], d.samples.map((s) => tr([esc(s.trolley_code), fmt(s.trolley_seq), esc(s.actual_at), s.ad_hoc ? badge('AD HOC', 'warn') : '', esc(s.reason ?? ''), fmt(s.p0), fmt(s.mv), fmt(s.pri), esc(s.by)])))}`;
    }
    return `
      <h1>Dryer Board</h1>
      ${has('dryer.write') ? `<form class="inline card" data-form="runNew">
        ${field('dryer_code', 'Dryer', { select: ['DRY-A', 'DRY-B'] })}
        ${field('run_type', 'Jenis run', { select: [{ value: 'STEADY_WIP', label: 'STEADY_WIP' }, { value: 'STARTUP_EMPTY', label: 'STARTUP_EMPTY' }] })}
        <button class="btn" type="submit">Buka Dryer Run</button></form>
        <p class="muted" style="font-size:12px">Dryer Run hanya dapat dibuka jika Dryer dipilih pada plan dan validated setting tersedia.</p>` : ''}
      ${table(['ID', 'Dryer', 'Jenis', 'Status', 'Mulai', 'Timer ON (menit)'], rows)}
      ${detail}`;
  }

  // ---------- VIEW: MD & Pallet ----------
  async function viewMD() {
    if (!S.planId) return needPlan();
    const st = await api('GET', `/md/status?plan_id=${S.planId}`);
    const pal = await api('GET', `/md/pallets?plan_id=${S.planId}`);
    const cut = await api('GET', `/md/cutoffs?plan_id=${S.planId}`);
    const qe = await api('GET', `/quality/exceptions?plan_id=${S.planId}`).catch(() => ({ items: [] }));
    const plan = S.plans.find((p) => p.id === S.planId);
    return `
      <h1>Metal Detector, Bale & Pallet</h1>
      <div class="grid">
        <div class="kpi"><div class="v">${st.running ? 'RUNNING' : 'STOP'}</div><div class="l">Status MD</div></div>
        <div class="kpi"><div class="v">${esc(st.active_batch ?? '—')}</div><div class="l">Batch aktif</div></div>
        <div class="kpi"><div class="v">${st.can_start ? 'SIAP' : 'BELUM'}</div><div class="l">Start (challenge PASS)</div></div>
      </div>
      <div class="card"><b>Challenge Fe / Non-Fe / SS 2.5</b>
        <table style="margin:6px 0"><tr>${st.challenges.map((c) => `<td>${esc(c.test_type)}: <span class="badge ${statusCls(c.result || '')}">${esc(c.result || 'belum')}</span></td>`).join('')}</tr></table>
        ${has('md.challenge') ? `<form class="inline" data-form="challenge">
          ${field('test_type', 'Uji', { select: ['FE_2_5', 'NONFE_2_5', 'SS_2_5'] })}
          ${field('result', 'Hasil', { select: ['PASS', 'FAIL'] })}
          <button class="btn" type="submit">Catat challenge</button></form>` : ''}
        <div style="margin-top:8px;display:flex;gap:8px">
          ${has('md.run') && !st.running ? `<button class="btn" data-api="POST|/md/start" data-body='${JSON.stringify({ plan_id: S.planId })}' data-ok="MD dimulai.">Start MD</button>` : ''}
          ${has('md.run') && st.running ? `<button class="btn warn" data-api="POST|/md/stop" data-body='${JSON.stringify({ plan_id: S.planId })}' data-ok="MD dihentikan. Restart memerlukan challenge PASS.">Stop MD</button>` : ''}
        </div></div>
      ${has('bale.write') && st.running ? `<div class="card"><b>Count Bale OK</b> <span class="muted">(tanpa detail chamber, MD-002)</span>
        <form class="inline" data-form="bale">${field('qty', 'Jumlah Bale', { type: 'num', value: 1 })}
        <span class="muted">Pallet: ${S.palletId ? `#${S.palletId}` : 'otomatis (pallet terbuka atau baru)'}</span>
        <button class="btn" type="submit">Catat count OK</button></form></div>` : ''}
      ${has('exception.write') && st.running ? `<div class="card"><b>Exception Reject / Hold</b> <span class="muted">(chamber wajib: MD-004)</span>
        <form class="inline" data-form="exception">
          ${field('category', 'Kategori', { select: ['REJECT_METAL', 'REJECT_OTHER', 'HOLD_CONTAMINATION', 'HOLD_WS', 'HOLD_OTHER'] })}
          ${field('chamber_code', 'Chamber', { select: ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'] })}
          ${field('metal_type', 'Jenis metal (Reject metal)', { select: ['', 'FE', 'NONFE', 'SS'] })}
          ${field('remark', 'Catatan')}
          <button class="btn bad" type="submit">Catat exception</button></form></div>` : ''}
      <h2>Pallet</h2>
      ${has('pallet.write') ? `<form class="inline card" data-form="palletNew">${field('manual_no', 'No. manual (opsional)')}${field('location', 'Lokasi', { value: 'Area Palletizing' })}<button class="btn" type="submit">Buat pallet baru</button></form>` : ''}
      ${table(['ID', 'Manual', 'Status', 'Kategori', 'Isi / Max', 'Lokasi', 'komposisi', 'Aksi'], pal.items.map((p) => tr([
        `<button class="link" data-act="select" data-key="pallet" data-id="${p.id}">#${p.id}</button>`, esc(p.manual_no ?? '—'), `<span class="badge ${statusCls(p.status)}">${esc(p.status)}</span>`, esc(p.status_category ?? '—'),
        `${fmt(p.slot_count)} / ${fmt(p.max_bale)}`, esc(p.location ?? ''), esc(p.compositions.map((c) => `${c.batch_code}/${c.status_category}: ${c.qty}`).join('; ')),
        [has('pallet.write') && ['OPEN', 'PARTIAL', 'FULL', 'HOLD/REJECT'].includes(p.status) ? `<button class="btn sec" data-api="POST|/md/pallets/:id/close" data-id="${p.id}" data-ok="Pallet ditutup.">Tutup</button>` : '',
         has('movement.write') && ['OPEN', 'PARTIAL', 'FULL'].includes(p.status) ? `<button class="btn" data-api="POST|/md/pallets/:id/move" data-id="${p.id}" data-prompt="Lokasi tujuan:" data-field="to_loc" data-default="Gudang FG" data-ok="Pallet dipindah.">Pindah</button>` : ''].join(' ')]))) }
      <p class="muted" style="font-size:12px">Maksimal ${pal.max_bale} Bale per pallet (Pallet Unit = alas + 1 Forming Box). Pallet PARTIAL dilanjutkan shift berikut.</p>
      <h2>Batch Cutoff</h2>
      ${has('cutoff.request') ? `<form class="inline card" data-form="cutoffNew">${field('new_batch_code', 'Batch baru', { required: true, value: 'B-2610-002' })}${field('boundary_count', 'Batas (jumlah Bale)', { type: 'num', required: true, value: 0 })}<button class="btn" type="submit">Request cutoff</button></form>` : ''}
      ${table(['ID', 'Dari → Ke', 'Batas', 'Di luar plan', 'Status', 'Aksi'], cut.items.map((c) => tr([fmt(c.id), esc(`${c.old_batch_code} → ${c.new_batch_code}`), fmt(c.boundary_count), c.off_plan ? badge('YA', 'warn') : 'Tidak', `<span class="badge ${statusCls(c.status)}">${esc(c.status)}</span>`,
        [c.status === 'REQUESTED' && c.off_plan && has('cutoff.approve') ? `<button class="btn sec" data-api="POST|/md/cutoffs/:id/approve" data-id="${c.id}" data-ok="Disetujui SPV.">Approve SPV</button>` : '',
         c.status !== 'VERIFIED' && has('cutoff.verify') ? `<button class="btn" data-api="POST|/md/cutoffs/:id/verify" data-id="${c.id}" data-ok="Cutoff diverifikasi. Batch aktif berubah.">Verifikasi</button>` : ''].join(' ')]))) }
      <h2>Quality – Hold / Reject</h2>
      ${table(['ID', 'Kategori', 'Batch', 'Chamber', 'Metal', 'Lokasi', 'QC', 'Aksi'], qe.items.map((q) => tr([fmt(q.id), esc(q.category), esc(q.batch_code), esc(q.chamber_code ?? ''), esc(q.metal_type ?? ''), esc(q.location ?? ''),
        q.qc_decision ? badge(q.qc_decision, 'ok') : '<span class="incomplete">PENDING</span>',
        has('quality.release') && !q.qc_decision ? `<form class="inline" data-form="qcRelease" data-id="${q.id}">
          <select name="decision"><option>RELEASE_GOOD</option><option>REJECT_FINAL</option><option>KEEP_HOLD</option></select>
          <input name="reason" placeholder="Alasan" required><button class="btn" type="submit">Putuskan</button></form>` : '']))) }
      <p class="muted" style="font-size:12px">Reject tidak diperiksa ulang (MD-006). Hold belum Good sampai QC Release. ${plan ? '' : ''}</p>`;
  }

  // ---------- VIEW: OEE & Konsumsi ----------
  async function viewKpi() {
    if (!S.planId) return needPlan();
    const oee = await api('GET', `/kpi/oee?plan_id=${S.planId}`);
    const cons = await api('GET', `/consumables/summary?plan_id=${S.planId}`);
    const list = await api('GET', '/consumables');
    return `
      <h1>OEE Dryer (pilot) & Konsumsi / Energi</h1>
      ${table(['Dryer', 'Status', 'A (%)', 'P (%)', 'Q (%)', 'OEE (%)', 'Timer aktual (min)', 'Timer planned (min)', 'Trolley OUT / Ideal', 'Bale gross/good', 'Belum lengkap'],
        oee.items.map((x) => tr([esc(x.dryer), `<span class="${x.status === 'OK' ? '' : 'incomplete'}">${esc(x.status)}</span>`, fmt(x.A), fmt(x.P), fmt(x.Q), fmt(x.OEE), fmt(x.actual_timer_on_min), fmt(x.planned_timer_on_min), `${fmt(x.trolley_out)} / ${fmt(x.ideal_trolley)}`, `${fmt(x.gross_bale)} / ${fmt(x.good_bale)}`, esc(x.missing.join('; ') || '—')])))}
      <div class="msg info" style="font-size:12px">Planned Timer ON belum tersimpan pada plan (OI-06/OI-10). Isi melalui parameter <code>planned_min</code> pada URL: <code>/api/kpi/oee?plan_id=…&amp;planned_min=…</code>. Press OEE tidak dihitung (MVP).</div>
      <h2>Konsumsi & energi (plan terpilih)</h2>
      ${table(['Consumable', 'Kategori', 'Driver', 'Jumlah driver', 'Expected', 'Aktual', 'Varian', 'Harga/satuan', 'Cost', 'Energi (MJ)'],
        cons.items.map((c) => tr([esc(`${c.name} (${c.uom})`), esc(c.category), esc(c.driver), fmt(c.driver_count), esc(c.expected), fmt(c.actual), fmt(c.variance), esc(c.unit_price ?? 'PRICE NOT SET'), esc(c.cost), c.energy ? `${fmt(c.energy.mj)} <span class="muted">${esc(c.energy.basis)}</span>` : '—'])))}
      <p class="muted" style="font-size:12px">${esc(cons.note)} Nilai kalor provisional (diesel 35,9 MJ/liter; cangkang 17 MJ/kg).</p>
      ${has('consumable.write') ? `<div class="card"><b>Catat transaksi consumable / energi</b>
        <form class="inline" data-form="consumableTx">
          ${field('consumable_id', 'Consumable', { select: list.items.map((c) => ({ value: c.id, label: c.name })), type: 'num' })}
          ${field('type', 'Tipe', { select: ['USE', 'ISSUE', 'RECEIPT', 'RETURN', 'WASTE', 'ADJUSTMENT'] })}
          ${field('qty', 'Qty', { type: 'num', required: true })}
          ${field('reason', 'Alasan / referensi')}
          <button class="btn" type="submit">Catat</button></form></div>` : ''}
      ${has('consumable.price') ? `<div class="card"><b>Harga (effective date)</b>
        <form class="inline" data-form="consumablePrice">
          ${field('consumable_id', 'Consumable (ID)', { type: 'num', required: true })}
          ${field('price', 'Harga (IDR)', { type: 'num', required: true })}
          ${field('effective_start', 'Mulai berlaku', { type: 'date', required: true })}
          ${field('effective_end', 'Sampai (opsional)', { type: 'date' })}
          ${field('source', 'Sumber')}
          <button class="btn" type="submit">Simpan harga</button></form>
        <p class="muted" style="font-size:12px">Harga lama ditutup, bukan ditimpa. Harga belum ada = PRICE NOT SET; cost KPI tidak dihitung.</p></div>` : ''}
      <div class="card"><b>Cek moisture cangkang</b>
        <label>Moisture (%)<input id="moist" type="number" step="0.1" style="min-width:90px"></label>
        <button class="btn sec" data-act="moist">Cek</button> <span id="moistOut" class="muted"></span></div>`;
  }

  // ---------- VIEW: Laporan ----------
  async function viewReports() {
    const reps = (await api('GET', '/reports')).items;
    const today = new Date().toISOString().slice(0, 10);
    return `
      <h1>Laporan & Export</h1>
      <div class="card"><form class="inline" data-form="report" id="repForm">
        <label>Laporan<select id="repType">${reps.map((r) => `<option value="${esc(r.key)}">${esc(r.title)}</option>`).join('')}</select></label>
        <label>Dari<input type="date" id="repFrom" value="${today.slice(0, 8)}01"></label>
        <label>Sampai<input type="date" id="repTo" value="${today}"></label>
        <label>Plan<select id="repPlan"><option value="">Semua</option>${S.plans.map((p) => `<option value="${p.id}" ${p.id === S.planId ? 'selected' : ''}>#${p.id} ${esc(p.plan_no)}</option>`).join('')}</select></label>
        <button class="btn sec" type="button" data-act="repPreview">Pratinjau</button>
        ${has('report.export') ? `<button class="btn" type="button" data-act="repCsv">Export CSV (Excel)</button>
        <button class="btn" type="button" data-act="repPrint">Halaman cetak A4 / PDF</button>` : ''}
      </form></div>
      <div id="repOut"><p class="muted">Pilih laporan lalu tekan Pratinjau. Laporan per-Bale normal tidak disediakan (RPT-004).</p></div>`;
  }

  function repParams() {
    const q = new URLSearchParams();
    q.set('from', document.getElementById('repFrom').value);
    q.set('to', document.getElementById('repTo').value);
    const p = document.getElementById('repPlan').value;
    if (p) q.set('plan_id', p);
    return { type: document.getElementById('repType').value, q };
  }

  async function rawFetch(url) {
    const res = await fetch('/api' + url, { headers: { Authorization: 'Bearer ' + S.token, 'X-PMS-Token': S.token } });
    if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.error || 'Gagal'); }
    return res;
  }

  // ---------- VIEW: Koreksi ----------
  async function viewCorr() {
    const items = (await api('GET', '/corrections')).items;
    return `
      <h1>Koreksi transaksi</h1>
      <p class="muted" style="font-size:12px">Tidak ada hard delete. Koreksi menyimpan nilai lama dan baru, alasan, pemohon, dan approval SPV (maker-checker).</p>
      ${has('correction.request') ? `<form class="inline card" data-form="correctionNew">
        ${field('entity', 'Entitas', { select: ['bale_events', 'dryer_events', 'cake_samples', 'mandor_events'] })}
        ${field('field', 'Field', { select: ['remark', 'chamber_code', 'p0', 'mv', 'pri'] })}
        ${field('record_id', 'ID record', { type: 'num', required: true })}
        ${field('new_value', 'Nilai baru', { required: true })}
        ${field('reason', 'Alasan', { required: true })}
        <button class="btn" type="submit">Ajukan koreksi</button></form>` : ''}
      ${table(['ID', 'Entitas', 'Record', 'Field', 'Lama', 'Baru', 'Alasan', 'Status', 'Pemohon', 'Aksi'], items.map((c) => tr([fmt(c.id), esc(c.entity), fmt(c.record_id), esc(c.field), esc(c.old_value ?? ''), esc(c.new_value ?? ''), esc(c.reason), `<span class="badge ${statusCls(c.status)}">${esc(c.status)}</span>`, esc(c.requested_by),
        c.status === 'PENDING' && has('correction.approve') ? `<button class="btn" data-api="POST|/corrections/:id/decide" data-id="${c.id}" data-body='{"decision":"APPROVED"}' data-ok="Koreksi disetujui & diterapkan.">Setujui</button> <button class="btn bad" data-api="POST|/corrections/:id/decide" data-id="${c.id}" data-body='{"decision":"REJECTED"}' data-ok="Koreksi ditolak.">Tolak</button>` : ''])))}`;
  }

  // ---------- VIEW: Admin ----------
  const jsonCell = (txt) => {
    if (!txt) return '';
    let pretty = String(txt);
    try { pretty = JSON.stringify(JSON.parse(txt), null, 2); } catch (e) { /* teks biasa */ }
    return `<details><summary>lihat</summary><pre class="json">${esc(pretty)}</pre></details>`;
  };

  async function viewRiwayat() {
    const page = S.histPage || 1;
    const q = S.histQ || '';
    const dr = await api('GET', `/deleted-records?page=${page}&limit=20&q=${encodeURIComponent(q)}`);
    const parts = [`<h1>Riwayat</h1>`,
      `<p class="muted" style="font-size:12px">Riwayat perubahan dan penghapusan permanen. Isi lengkapnya tetap tersimpan sampai reset/tutup buku tahunan.</p>`];

    if (S.histEntity) {
      const h = await api('GET', `/history?entity=${encodeURIComponent(S.histEntity)}&record_id=${S.histId}`);
      const rowsA = h.audit.map((x) => tr([esc(x.ts), esc(x.username || ''), esc(x.action), jsonCell(x.old_value), jsonCell(x.new_value), esc(x.reason || '')]));
      const rowsD = h.deleted.map((x) => tr([esc(x.deleted_at), esc(x.deleted_by || ''), '<b>HAPUS PERMANEN</b>', jsonCell(x.data), '', esc(x.reason || '')]));
      parts.push(`<div class="card"><h2>Riwayat data: ${esc(S.histLabel || '')}</h2>
        <button class="btn sec" data-act="clearHist" type="button">Tutup riwayat data</button>
        ${table(['Waktu', 'User', 'Aksi', 'Sebelum', 'Sesudah', 'Alasan'], [...rowsD, ...rowsA])}</div>`);
    }

    parts.push(`<h2>Riwayat hapus permanen</h2>
      <form class="inline" data-form="histSearch">${field('q', 'Cari (nomor, alasan, user, entitas)', { value: q })}<button class="btn sec" type="submit">Cari</button></form>`);
    parts.push(table(['Waktu', 'Data', 'Entitas', 'Alasan', 'Oleh', 'Isi sebelum dihapus'],
      dr.items.map((x) => tr([esc(x.deleted_at), esc(x.label || ''), esc(x.entity), esc(x.reason || ''), esc(x.deleted_by || ''), jsonCell(x.data)]))));
    parts.push(`<div style="display:flex;gap:8px;align-items:center;margin-top:8px;flex-wrap:wrap">
      <button class="btn sec" data-act="histPage" data-page="${dr.page - 1}" ${dr.page <= 1 ? 'disabled' : ''} type="button">‹ Sebelumnya</button>
      <span class="muted">Halaman ${dr.page} dari ${dr.pages} · ${dr.total} data</span>
      <button class="btn sec" data-act="histPage" data-page="${dr.page + 1}" ${dr.page >= dr.pages ? 'disabled' : ''} type="button">Berikutnya ›</button></div>`);
    return parts.join('');
  }

  async function viewAdmin() {
    const parts = [];
    if (has('user.manage')) {
      const users = (await api('GET', '/admin/users')).items;
      parts.push(`<h2>User</h2>${table(['ID', 'Username', 'Nama', 'Role', 'Aktif'], users.map((u) => tr([fmt(u.id), esc(u.username), esc(u.full_name ?? u.fullName ?? ''), esc((u.roles || []).join(', ')), u.active ? 'Ya' : 'Tidak'])))}
        <div class="card"><b>Tambah user</b> <form class="inline" data-form="userNew">
          ${field('username', 'Username', { required: true })}${field('full_name', 'Nama lengkap', { required: true })}${field('password', 'Password awal', { required: true, type: 'password' })}
          ${field('roles', 'Role (pisah koma)', { type: 'list', value: 'OP_DRYER' })}
          <button class="btn" type="submit">Simpan</button></form></div>`);
    }
    if (has('rbac.manage') || has('user.manage')) {
      const roles = (await api('GET', '/admin/roles')).roles;
      parts.push(`<h2>Role & hak akses (konfigurasi via API PUT /admin/roles/:code/permissions)</h2>${table(['Kode', 'Nama', 'Permission'], roles.map((r) => tr([esc(r.code), esc(r.name), `<span class="muted" style="font-size:12px">${esc((r.permissions || []).join(', '))}</span>`])))}`);
    }
    if (has('master.write') || has('dashboard.view')) {
      const slugs = ['equipment', 'batches', 'reason-codes', 'validated-settings', 'trolleys'];
      const sel = S.cache.masterSlug || 'equipment';
      const m = await api('GET', `/master/${sel}`);
      parts.push(`<h2>Master data</h2><label>Tabel <select id="mSlug" data-act="masterSlug">${slugs.map((s) => `<option ${s === sel ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
        ${json(m.items.slice(0, 60))}
        ${has('master.write') ? `<form class="inline card" data-form="masterNew" data-slug="${sel}"><label>Data baru (JSON)<textarea name="body" data-type="json" required>{}</textarea></label><button class="btn" type="submit">Tambah</button></form>` : ''}
        ${has('data.edit') ? `<form class="inline card" data-form="masterEdit" data-slug="${sel}"><b>Ubah data master</b> <span class="muted">(isi perubahan dalam JSON, contoh {\"name\":\"Nama baru\"})</span>${field('id', 'ID', { required: true, type: 'num' })}<label>Perubahan (JSON)<textarea name="body" data-type="str" required>{}</textarea></label><button class="btn" type="submit">Simpan perubahan</button></form>` : ''}
        ${has('hard.delete') ? `<form class="inline card" data-form="masterDelete" data-slug="${sel}"><b>Hapus permanen</b> <span class="muted">(isi tersimpan di riwayat penghapusan)</span>${field('id', 'ID', { required: true, type: 'num' })}${field('reason', 'Alasan', { required: true })}<button class="btn bad" type="submit">Hapus permanen</button></form>` : ''}`);
    }
    if (has('rbac.manage')) {
      const st = (await api('GET', '/settings')).items;
      parts.push(`<h2>Setting sistem</h2>${table(['Kunci', 'Nilai', 'Ubah'], st.map((s) => tr([esc(s.key), esc(s.value), `<form class="inline" data-form="settingSet" data-key="${esc(s.key)}"><input name="value" value="${esc(s.value)}" data-type="str" style="min-width:90px"><button class="btn sec" type="submit">Simpan</button></form>`])))}`);
    }
    if (has('report.export') || has('period.close')) {
      const periods = (await api('GET', '/periods')).items;
      const cur = periods.find((p) => p.status === 'OPEN');
      parts.push(`<h2>Periode & tutup buku</h2>
        <p class="muted" style="font-size:12px">Nomor Produksi berlanjut terus dalam satu periode (contoh DP1-121026-057). Urutan: (1) export data periode berjalan, (2) tutup buku. Syarat tutup buku: sudah ada export, tidak ada Nomor Produksi DRAFT/APPROVED/ACTIVE, dan tidak ada Dryer yang berjalan. Setelah ditutup, nomor baru mulai dari 001 pada periode baru. Periode lama tetap tersimpan dan hanya bisa dibaca.</p>
        ${table(['Periode', 'Mulai', 'Selesai', 'Status', 'Nomor terakhir', 'Jml Nomor Produksi', 'Jml export'], periods.map((p) => tr([esc(p.name), esc(p.start_date), esc(p.end_date || '—'), `<span class="badge ${statusCls(p.status)}">${esc(p.status)}</span>`, fmt(p.last_seq), fmt(p.plan_count), fmt(p.export_count)])))}
        <div class="card">
          ${has('report.export') ? '<button class="btn sec" data-act="exportPeriod">Export periode berjalan (JSON)</button> ' : ''}
          ${has('period.close') && cur ? `<button class="btn bad" data-api="POST|/periods/close" data-field="confirm" data-prompt="Ketik TUTUP BUKU untuk konfirmasi:" data-confirm="Tutup buku ${esc(cur.name)}? Nomor akan mulai dari 001 pada periode baru." data-ok="Tutup buku berhasil. Periode baru dimulai.">Tutup buku</button>` : ''}
        </div>`);
    }
    if (has('audit.view')) {
      const a = (await api('GET', '/audit?limit=100')).items;
      parts.push(`<h2>Audit trail (100 terbaru)</h2>${table(['Waktu', 'User', 'Role', 'Aksi', 'Entitas', 'ID', 'Lama', 'Baru', 'Alasan'], a.map((x) => tr([esc(x.ts), esc(x.username), esc(x.role ?? ''), esc(x.action), esc(x.entity), esc(x.record_id ?? ''), `<span class="muted" style="font-size:11px">${esc(x.old_value ?? '')}</span>`, `<span class="muted" style="font-size:11px">${esc(x.new_value ?? '')}</span>`, esc(x.reason ?? '')])))}`);
    }
    return `<h1>Admin Sistem & Audit</h1>${parts.join('') || '<p class="muted">Tidak ada menu admin.</p>'}`;
  }

  // ---------- event handler tambahan (laporan, moisture, master) ----------
  async function onExtra(e) {
    const act = e.target.closest && e.target.closest('[data-act]');
    if (!act) return;
    if (act.tagName === 'SELECT' && e.type === 'click') return;
    const a = act.dataset.act;
    try {
      if (a === 'repPreview') {
        const { type, q } = repParams();
        const r = await api('GET', `/reports/${type}?${q}`);
        document.getElementById('repOut').innerHTML = `<p class="muted">${esc(r.title)} · ${r.count} baris</p>` + (r.items.length
          ? table(Object.keys(r.items[0]), r.items.slice(0, 300).map((row) => tr(Object.values(row).map((v) => esc(v ?? '')))))
          : '<p class="muted">Tidak ada data pada periode ini.</p>');
      }
      if (a === 'repCsv' || a === 'repPrint') {
        const { type, q } = repParams();
        if (a === 'repCsv') {
          q.set('format', 'csv');
          const res = await rawFetch(`/reports/${type}?${q}`);
          const blob = await res.blob();
          const link = document.createElement('a');
          link.href = URL.createObjectURL(blob);
          link.download = `${type}.csv`;
          link.click();
        } else {
          q.set('format', 'print');
          const res = await rawFetch(`/reports/${type}?${q}`);
          const html = await res.text();
          const w = window.open('', '_blank');
          if (!w) throw new Error('Pop-up diblokir browser. Izinkan pop-up untuk mencetak.');
          w.document.open(); w.document.write(html); w.document.close();
        }
      }
      if (a === 'moist') {
        const pct = document.getElementById('moist').value;
        if (pct === '') return;
        const r = await api('GET', `/consumables/moisture-rule?pct=${encodeURIComponent(pct)}`);
        document.getElementById('moistOut').textContent = `Status: ${r.status} (PASS ≤15%, Monitoring >15–18%, Hold/Review >18%)`;
      }
      if (a === 'masterSlug') { S.cache.masterSlug = act.value; render(); }
    } catch (err) { flash('err', err.message); render(); }
  }

  // ---------- bootstrap ----------
  document.addEventListener('click', (e) => { onClick(e); onExtra(e); });
  document.addEventListener('submit', onSubmit);
  // Target Bale dan kg: kolom yang diisi duluan dipakai; kolom satunya terkunci dan terisi otomatis.
  document.addEventListener('input', (e) => {
    const el = e.target;
    if (!el.dataset || !el.dataset.sync || !el.form) return;
    const other = el.form.querySelector(el.dataset.sync === 'bale' ? '[data-sync="kg"]' : '[data-sync="bale"]');
    if (el.value === '') { other.readOnly = false; other.value = ''; return; }
    const v = Number(el.value);
    other.readOnly = true;
    other.value = el.dataset.sync === 'bale' ? v * BALE_KG : Math.round(v / BALE_KG);
  });
  document.addEventListener('reset', (e) => {
    if (e.target.querySelectorAll) e.target.querySelectorAll('[data-sync]').forEach((x) => { x.readOnly = false; });
  });
  document.addEventListener('change', (e) => {
    const el = e.target;
    if (el.dataset && (el.dataset.act === 'setPlan' || el.dataset.act === 'masterSlug')) {
      if (el.dataset.act === 'setPlan') ACT.setPlan(el); else onExtra({ target: el });
    }
  });
  render();
})();
