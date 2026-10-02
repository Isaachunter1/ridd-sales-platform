// ┌─ src/98-admin.js ─────────────────────────────────────────────────────
// │ Settings: Users, Permissions, Configurations, Teams, Admin uploads/activity/integrity.
// │ Part of the app.js bundle (tools/bundle.js concatenates src/*.js in name order).
// └────────────────────────────────────────────────────────────────────────
// ──────────────────────────────────────────────────────────────────────────
// VIEW: ADMIN — audit queue, competitions editor
// ── Settings → Permissions — role × capability checkbox matrix. ─────────
// Checked = that user type sees it. Changes save instantly, sync to every
// user/device through the config row, and log to Activity. Admins always
// see everything (no admin column on purpose).
function adminPermissions() {
  const overrides = (state._compExtras && state._compExtras.perms) || {};
  const effOf = (role) => ({ ...(PERM_DEFAULTS[role] || {}), ...(overrides[role] || {}) });
  // Per PERMISSION, pick which user types have it (per Isaac, Sep 30) —
  // one multi-select per row instead of flipping one user type at a time.
  // Same storage as before (perms / permScopes overrides per role).
  const scopeOverrides = (state._compExtras && state._compExtras.permScopes) || {};
  const anyChanged = Object.keys(overrides).length > 0 || Object.keys(scopeOverrides).length > 0;
  const rl = (r) => ROLE_LABEL[r] || r;
  // Families from the "Family - Role" labels: Sales Rep · Office Staff · Technician · Auditor.
  const famOf = (r) => rl(r).split(' - ')[0];
  const shortOf = (r) => { const p = rl(r).split(' - '); return p.length > 1 ? p.slice(1).join(' - ') : p[0]; };
  const fams = [...new Set(PERM_ROLES.map(famOf))].map(f => ({ f, roles: PERM_ROLES.filter(r => famOf(r) === f) }));
  // Batch write: every role in one save.
  const setPermMany = (roles, permId, val) => {
    state._compExtras = state._compExtras || {};
    const perms = state._compExtras.perms = state._compExtras.perms || {};
    for (const role of roles) {
      const r = perms[role] = perms[role] || {};
      const def = !!(PERM_DEFAULTS[role] || {})[permId];
      if (!!val === def) delete r[permId]; else r[permId] = val ? 1 : 0;
      if (!Object.keys(r).length) delete perms[role];
    }
    saveIndicatorState();
    logActivity('config_change', { detail: 'Permissions: ' + permId + ' → ' + (val ? 'on' : 'off') + ' for ' + roles.map(rl).join(', ') });
    mountApp();
  };
  const setScope = (role, id, v) => {
    const def = (PERM_SCOPE_DEFAULTS[role] || {})[id] || 'self';
    state._compExtras = state._compExtras || {};
    const ps = state._compExtras.permScopes = state._compExtras.permScopes || {};
    const r = ps[role] = ps[role] || {};
    if (v === def) delete r[id]; else r[id] = v;
    if (!Object.keys(r).length) delete ps[role];
    saveIndicatorState();
    logActivity('config_change', { detail: 'Permissions reach: ' + rl(role) + ' · ' + id + ' → ' + v });
    mountApp();
  };
  const scopeOf = (role, id) => ((scopeOverrides[role] && scopeOverrides[role][id]) || (PERM_SCOPE_DEFAULTS[role] || {})[id] || 'self');
  const scopeDef = (role, id) => (PERM_SCOPE_DEFAULTS[role] || {})[id] || 'self';

  // Dropdown shell: a button with a summary, a checklist panel under it.
  const dropdown = (key, summary, changed, buildBody) => {
    const open = state._permOpen === key;
    const wrap = el('div', { class: 'relative shrink-0', 'data-dd': key });
    const panel = el('div', { class: 'card absolute p-1.5', style: { top: 'calc(100% + 6px)', right: '0', width: '290px', maxWidth: 'calc(100vw - 32px)', maxHeight: '380px', overflowY: 'auto', zIndex: '40', boxShadow: 'var(--shadow-lg)', display: open ? 'block' : 'none' }, onclick: (e) => e.stopPropagation() }, open ? buildBody() : null);
    const btn = el('button', {
      class: 'rounded-lg border px-2.5 py-1 text-[11px] font-semibold cursor-pointer flex items-center justify-between gap-2',
      style: { borderColor: changed ? 'var(--accent)' : 'var(--border-2)', background: 'var(--card)', color: 'var(--text)', width: '240px', minWidth: '240px', maxWidth: '240px', justifyContent: 'space-between', textAlign: 'left' },
      title: summary + (changed ? ' · changed from the defaults' : ''),
      onclick: (e) => { e.stopPropagation(); state._permOpen = open ? null : key; mountApp(); },
    }, el('span', { class: 'truncate' }, summary), el('span', { style: { fontSize: '9px', opacity: .7 } }, '▾'));
    wrap.append(btn, panel);
    if (open) {
      try { clampDropdownPanel(panel); } catch (err) { /* optional helper */ }
      setTimeout(() => document.addEventListener('mousedown', function closer(ev) { if (!(ev.target.closest && ev.target.closest('[data-dd="' + key + '"]'))) { document.removeEventListener('mousedown', closer); if (state._permOpen === key) { state._permOpen = null; mountApp(); } } }), 0);
    }
    return wrap;
  };
  const summarize = (on) => {
    if (!on.length) return 'Nobody';
    if (on.length === PERM_ROLES.length) return 'All user types';
    const full = fams.filter(g => g.roles.every(r => on.includes(r)));
    const rest = on.filter(r => !full.some(g => g.roles.includes(r)));
    const plural = (f) => ({ 'Sales Rep': 'Sales Reps', 'Technician': 'Technicians' })[f] || f;
    const parts = [...full.map(g => g.roles.length > 1 ? 'All ' + plural(g.f) : g.f), ...rest.map(r => rl(r))];
    if (parts.length <= 2) return parts.join(' + ');
    const off = PERM_ROLES.filter(r => !on.includes(r));
    const offFull = fams.filter(g => g.roles.every(r => off.includes(r)));
    const offParts = [...offFull.map(g => g.roles.length > 1 ? plural(g.f) : g.f), ...off.filter(r => !offFull.some(g => g.roles.includes(r))).map(r => rl(r))];
    return offParts.length <= 2 ? 'All except ' + offParts.join(' + ') : on.length + ' of ' + PERM_ROLES.length + ' user types';
  };
  const cb = (checked, onChange) => { const c = el('input', { type: 'checkbox', style: { accentColor: 'var(--accent)' }, onchange: (e) => onChange(e.target.checked) }); c.checked = checked; return c; };
  const famHead = (label, control) => el('div', { class: 'flex items-center justify-between gap-2 px-2 pt-2 pb-1 text-[10px] uppercase tracking-widest font-semibold', style: { color: 'var(--text-subtle)' } }, label, control || null);

  const permRow = (d) => {
    const on = PERM_ROLES.filter(r => !!effOf(r)[d.id]);
    const changed = PERM_ROLES.some(r => overrides[r] && overrides[r][d.id] !== undefined);
    // Sensitive permissions (per Isaac, Sep 22): granting asks first.
    const grant = (roles, val) => {
      const adding = val ? roles.filter(r => !on.includes(r)) : [];
      if (adding.length && d.sensitive && !confirm('Give ' + adding.map(rl).join(', ') + ' access to ' + d.sensitive + '?\n\nThis is sensitive information. Are you sure?')) return;
      setPermMany(roles, d.id, val);
    };
    const body = () => el('div', {},
      el('div', { class: 'flex items-center gap-1 px-1.5 pb-1.5 mb-1', style: { borderBottom: '1px solid var(--border)' } },
        ...[['All', () => grant(PERM_ROLES, true)], ['None', () => grant(PERM_ROLES, false)]].map(([l, fn]) => el('button', { class: 'rounded-lg px-2 py-0.5 text-[10px] font-bold', style: { background: 'var(--card-2)', color: 'var(--text-muted)', border: '1px solid var(--border)' }, onclick: fn }, l)),
        changed ? el('button', { class: 'ml-auto text-[10px] font-semibold', style: { color: 'var(--accent)' }, onclick: () => { for (const r of PERM_ROLES) if (overrides[r]) delete overrides[r][d.id]; for (const r of Object.keys(overrides)) if (!Object.keys(overrides[r]).length) delete overrides[r]; saveIndicatorState(); mountApp(); } }, 'defaults') : null),
      ...fams.flatMap(g => {
        return [
          famHead(g.f),
          ...g.roles.map(r => el('label', { class: 'w-full flex items-center gap-2 px-2.5 py-1 rounded-lg text-[11px] font-semibold cursor-pointer', style: { background: on.includes(r) ? 'var(--card-2)' : 'transparent', color: 'var(--text)' } },
            cb(on.includes(r), (v) => grant([r], v)), el('span', { class: 'flex-1' }, g.roles.length > 1 ? shortOf(r) : rl(r)),
            overrides[r] && overrides[r][d.id] !== undefined ? el('span', { class: 'text-[9px]', style: { color: 'var(--accent)' }, title: 'Changed from default' }, '●') : null)),
        ];
      }));
    const label = d.sensitive
      ? el('span', { class: 'inline-flex items-center gap-1.5 flex-wrap' }, d.label, el('span', { class: 'text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded', style: { background: 'rgba(220,38,38,.10)', color: '#B91C1C' }, title: 'Sensitive — ' + d.sensitive }, 'sensitive'))
      : d.label;
    return row(label, dropdown('p:' + d.id, summarize(on), changed, body));
  };

  const reachRow = (d) => {
    const vals = PERM_ROLES.map(r => scopeOf(r, d.id));
    const changed = PERM_ROLES.some(r => scopeOf(r, d.id) !== scopeDef(r, d.id));
    const counts = {}; vals.forEach(v => { counts[v] = (counts[v] || 0) + 1; });
    const summary = Object.keys(counts).length === 1 ? PERM_SCOPE_LABELS[vals[0]] + ' · everyone' : Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([v, n]) => PERM_SCOPE_LABELS[v] + ' ' + n).join(' · ');
    const sel = (cur, onChange, hi) => el('select', { class: 'rounded-lg border px-1.5 py-0.5 text-[10px] font-semibold cursor-pointer', style: { borderColor: hi ? 'var(--accent)' : 'var(--border-2)', background: 'var(--card)', color: 'var(--text)' }, onchange: (e) => onChange(e.target.value) },
      ...(cur == null ? [el('option', { value: '', selected: true }, 'Mixed')] : []), ...PERM_SCOPES.map(sv => el('option', { value: sv, selected: sv === cur }, PERM_SCOPE_LABELS[sv])));
    const body = () => el('div', {},
      d.help ? el('div', { class: 'px-2 pb-1.5 mb-1 text-[10px]', style: { color: 'var(--text-muted)', borderBottom: '1px solid var(--border)' } }, d.help) : null,
      ...fams.flatMap(g => {
        return [
          famHead(g.f),
          ...g.roles.map(r => el('div', { class: 'flex items-center justify-between gap-2 px-2.5 py-1 text-[11px] font-semibold' },
            el('span', {}, g.roles.length > 1 ? shortOf(r) : rl(r)), sel(scopeOf(r, d.id), (v) => setScope(r, d.id, v), scopeOf(r, d.id) !== scopeDef(r, d.id)))),
        ];
      }));
    return row(el('span', { title: d.help || '' }, d.label), dropdown('s:' + d.id, summary, changed, body));
  };

  const row = (label, control) => el('div', { class: 'flex items-center justify-between gap-x-3 gap-y-1 py-1.5 border-t flex-wrap', style: { borderColor: 'var(--border)' } },
    el('div', { class: 'text-sm font-semibold min-w-0' }, label), control);
  const groupHead = (t) => el('div', { class: 'pt-3 pb-1 text-[10px] uppercase tracking-widest font-semibold', style: { color: 'var(--text-subtle)' } }, t);
  const groups = [...new Set(PERM_DEFS.map(d => d.group))];
  return el('div', { class: 'flex flex-col gap-4' },
    el('div', { class: 'card p-4' },
      el('div', { class: 'flex items-center justify-between gap-3 flex-wrap' },
        el('div', {},
          el('h2', { class: 'text-lg font-bold' }, 'Permissions'),
          el('div', { class: 'text-[11px] mt-0.5', style: { color: 'var(--text-muted)' } }, 'Pick which user types get each one. Outlined = changed from the defaults. Admins always have everything.')),
        anyChanged ? el('button', { class: 'text-[11px] font-semibold', style: { color: 'var(--accent)' }, onclick: () => {
          if (!confirm('Reset every permission for every user type to the defaults?')) return;
          state._compExtras.perms = {}; state._compExtras.permScopes = {};
          saveIndicatorState(); logActivity('config_change', { detail: 'Permissions: all reset to defaults' }); mountApp();
        } }, 'Reset all to defaults') : el('span', { class: 'text-[11px] text-muted-' }, 'defaults')),
      el('div', { class: 'mt-2' },
        ...groups.flatMap(g => [groupHead(g), ...PERM_DEFS.filter(d => d.group === g).map(permRow)]),
        groupHead('Reach'),
        ...PERM_SCOPE_DEFS.map(reachRow))));
}

// ──────────────────────────────────────────────────────────────────────────
function viewAdmin() {
  // Partners / team leads land on Goals (per Isaac, Sep 23) — it's the section they own.
  if (!state.adminSection) state.adminSection = (state.profile && !isAdminRole(state.profile.role) && isPartnerRole(state.profile.role)) ? 'goals' : 'users';

  // One flat list, alphabetical (per Isaac, Sep 2026). Sources now lives
  // inside Configurations; the old 'sources' section key still resolves.
  if (state.adminSection === 'sources') state.adminSection = 'config';
  if (state.adminSection === 'uploads') state.adminSection = 'data';   // Admin section retired (per Isaac, Sep 23) — Data integrity lives under Data sources
  // Non-admins reach this page only through Settings → Permissions, and see
  // only the sections they were granted (Permissions / Admin never).
  const _allowed = (k) => canOpenAdminSection(k);
  // Settings IA (settings audit, Sep 30): grouped by how an admin thinks
  // about the business, not by code module. Section keys are unchanged so
  // saved links / permissions keep working.
  const _groupsAll = [
    { label: 'People & access', items: [
      ['users',     'Users',                'Logins, roles, rep links'],
      ['teams',     'Teams',                'Rosters, tiers, colors'],
      ['perms',     'Permissions',          'What each role can see and do'],
    ] },
    { label: 'Pay & goals', items: [
      ['pricing',   'Commissions & payroll', 'Rates by rep type · when sales pay and lock'],
      ['goals',     'Goals',                'Company and rep targets'],
      ['comps',     'Competitions',         'Schedule and calendar'],
    ] },
    { label: 'Rules', items: [
      ['config',    'Reporting rules',      'Book, churn, services, cancel reasons, Indicators'],
      ['marketing', 'Marketing & lead sources', 'Sources, paid channels, ad accounts, GoHighLevel, targets'],
    ] },
    { label: 'System', items: [
      ['slack',     'Notifications',        'Slack channels and DMs'],
      ['data',      'Connections',          'FieldRoutes, data health, setup'],
      ['usage',     'Usage',                'Who uses the app'],
    ] },
  ];
  const groups = _groupsAll.map(g => ({ label: g.label, items: g.items.filter(([k]) => _allowed(k)) })).filter(g => g.items.length);
  if (!_allowed(state.adminSection)) { const first = groups[0] && groups[0].items[0]; state.adminSection = first ? first[0] : 'users'; }

  const navBtn = ([k, label, icon]) => el('button', {
    class: 'flex items-center gap-3 px-2.5 py-1.5 rounded-lg text-[12px] font-medium transition text-left w-full',
    style: state.adminSection === k
      ? { background: 'var(--bg-subtle)', color: 'var(--text)', fontWeight: '600' }
      : { color: 'var(--text-muted)' },
    onmouseenter: (e) => { if (state.adminSection !== k) e.currentTarget.style.background = 'var(--bg-subtle)'; },
    onmouseleave: (e) => { if (state.adminSection !== k) e.currentTarget.style.background = 'transparent'; },
    onclick: () => { state.adminSection = k; mountApp(); },
  }, el('span', { class: 'flex flex-col min-w-0' }, el('span', {}, label),
    icon ? el('span', { class: 'text-[10px] font-normal truncate', style: { color: 'var(--text-subtle)' } }, icon) : null));

  // Desktop keeps the 220px sidebar; phones swap it for a compact section
  // dropdown + Sign out row so the content gets the full width (the sidebar
  // was eating half the screen and truncating every panel).
  const sidebar = el('aside', { class: 'hidden sm:flex rounded-2xl p-2 flex-col gap-1 shrink-0', style: { background: 'var(--card)', border: '1px solid var(--border)', width: '220px' } },
    ...groups.flatMap((g, gi) => [
      el('div', { class: 'px-3 py-2 text-[10px] uppercase tracking-widest font-semibold' + (gi > 0 ? ' mt-2' : ''), style: { color: 'var(--text-subtle)' } }, g.label),
      ...g.items.map(navBtn),
    ]),
    // Sign out — moved from the nav menu; bottom of the Settings sidebar.
    el('div', { class: 'mt-2 pt-2 border-t', style: { borderColor: 'var(--border)' } },
      el('button', {
        class: 'flex items-center gap-3 px-2.5 py-1 rounded-lg text-[11px] font-medium transition text-left w-full',
        style: { color: '#DC2626' },
        onmouseenter: (e) => { e.currentTarget.style.background = 'var(--bg-subtle)'; },
        onmouseleave: (e) => { e.currentTarget.style.background = 'transparent'; },
        onclick: async () => {
          if (typeof DEMO !== 'undefined' && DEMO) { location.href = location.pathname; return; }
          await supabase.auth.signOut();
        },
      }, 'Sign out')),
  );

  const sectionRenderers = {
    goals:   adminGoals,
    users:   adminReps,
    teams:   adminTeams,
    config:  () => adminConfigurations('reporting'),
    marketing: () => adminConfigurations('marketing'),
    perms:   adminPermissions,
    slack:   adminSlack,
    comps:   adminCompetitionSchedule,
    usage:   adminUsage,
    data:    adminDataSources,
    pricing: () => el('div', { class: 'flex flex-col gap-4' }, adminCommissions(), adminConfigurations('autolog')),   // rates + pay automation in ONE place
  };
  const view = _allowed(state.adminSection) ? (sectionRenderers[state.adminSection] || adminReps) : (() => el('div', { class: 'card p-6 text-sm text-muted-' }, 'Nothing here for your role yet \u2014 ask an admin to grant a Settings page in Permissions.'));
  const body = el('div', { class: 'flex-1 min-w-0' }, view());

  const mobileNav = el('div', { class: 'sm:hidden flex items-center gap-2' },
    el('select', {
      class: 'flex-1 rounded-xl px-3 text-[13px] font-semibold cursor-pointer',
      style: { minHeight: '44px' },
      onchange: (e) => { state.adminSection = e.target.value; mountApp(); },
    },
      ...groups.map(g => el('optgroup', { label: g.label },
        ...g.items.map(([k, label]) => {
          const o = el('option', { value: k }, label);
          if (state.adminSection === k) o.selected = true;
          return o;
        }))),
    ),
    el('button', {
      class: 'rounded-xl px-3 text-[12px] font-semibold border shrink-0',
      style: { color: '#DC2626', borderColor: 'var(--border-2)', minHeight: '44px' },
      onclick: async () => {
        if (typeof DEMO !== 'undefined' && DEMO) { location.href = location.pathname; return; }
        await supabase.auth.signOut();
      },
    }, 'Sign out'),
  );

  return el('div', { class: 'flex flex-col sm:flex-row gap-4 w-full' }, mobileNav, sidebar, body);
}

// ═══ Settings ▸ Data Hygiene — the anomaly hunts that used to live in
// one-off spreadsheets, permanent. Each check names the CRM fix; every
// list exports for whoever cleans it up. Runs on the live snapshot.
function adminDataHygiene() {
  if (!isAdminRole(state.profile?.role)) return emptyCard('Admins only.');
  // Lazy-load the snapshot rows (same pattern as Configurations).
  const activeId = state.reportingActiveUploadId;
  if (activeId && state.reportingSubscriptionsLoadedFor !== activeId
      && typeof loadReportingSubscriptions === 'function' && !state._hygRowsLoading) {
    state._hygRowsLoading = true;
    loadReportingSubscriptions(activeId).then(rows => {
      state._hygRowsLoading = false;
      if (state.reportingActiveUploadId !== activeId || rows == null) return;
      state.reportingSubscriptions = rows;
      state.reportingSubscriptionsLoadedFor = activeId;
      if (state.view === 'admin' && state.adminSection === 'hygiene') mountApp();
    }).catch(() => { state._hygRowsLoading = false; });
  }
  if (!(state.reportingSubscriptions || []).length) {
    return emptyCard(state._hygRowsLoading ? 'Loading the snapshot…' : 'No snapshot loaded yet.');
  }
  const { all, isRecurring, isActive } = reportingFilters();
  const _iso = (v) => String(v || '').slice(0, 10);
  const BASE_COLS = ['Customer ID', 'Customer', 'Phone', 'Office', 'Subscription', 'Status', 'Initial Service', 'Date Canceled', 'Cancel Reason', 'ARV', 'Agreement Length'];
  const baseRow = (r) => [r.customer_id, _custDisplayName(r), r.phone || '', r.office_name, r.subscription, r.subscription_status, _iso(r.initial_service), _iso(r.subscription_date_canceled), reportingCancelReasonOf(r), Math.round(Number(r.annual_recurring_value) || 0), r.agreement_length];

  const checks = [];
  // 1. Cancel dated BEFORE the initial service — impossible timeline.
  checks.push({
    id: 'timewarp', icon: '⏱', title: 'Cancelled before initial service',
    fix: 'Impossible dates — someone backdated a cancel or the initial-service date is wrong. Correct the dates in FieldRoutes.',
    rows: all.filter(r => r.subscription_date_canceled && r.initial_service && _iso(r.subscription_date_canceled) < _iso(r.initial_service)),
    sev: 'high',
  });
  // 2. Cancels with no usable reason.
  checks.push({
    id: 'noreason', icon: '❓', title: 'Cancels with blank / Unspecified reason',
    fix: 'Unexplainable churn — make the cancellation reason mandatory in FieldRoutes and backfill these.',
    rows: all.filter(r => r.subscription_date_canceled && /^(unspecified)?$/i.test(reportingCancelReasonOf(r).trim())),
    sev: 'med',
  });
  // 2b + 2c. Cancel Hygiene (moved from the Retention tab, per Isaac):
  // RORs hiding under other reason codes, and 3-day-ROR-coded cancels whose
  // dates say otherwise. Recode the reason (or fix the dates) in FieldRoutes.
  const _quickCxl = (r) => { if (!r.sold_date || !r.subscription_date_canceled) return false; const d = (new Date(r.subscription_date_canceled) - new Date(r.sold_date)) / 86400000; return d >= 0 && d <= crmRorWindowDays(); };
  const _rorReason = (r) => crmVocab().reasons.ror ? crmReasonIs('ror', reportingCancelReasonOf(r)) : /^3\s*day\s*ror$/i.test(reportingCancelReasonOf(r));
  const _salesRepSold = (r) => { const t = String(r.sold_by_type || '').trim(); return !t || crmSellerIs('sales_rep', t); };
  const _cxlOnly = (r) => r.subscription_date_canceled && !/active/i.test(String(r.subscription_status || ''));
  checks.push({
    id: 'miscodedror', icon: '\ud83d\udd01', title: 'ROR hiding under another reason',
    fix: 'Sales-rep sale cancelled within 3 days of sold but coded as something else \u2014 recode the reason to 3 Day ROR in FieldRoutes.',
    rows: all.filter(r => _cxlOnly(r) && String(r.subscription_cancellation_reason || '').trim() && _salesRepSold(r) && _quickCxl(r) && !_rorReason(r)),
    sev: 'med',
  });
  checks.push({
    id: 'rorlate', icon: '\ud83d\udcc5', title: 'Coded 3 Day ROR but cancelled late',
    fix: 'Reason says 3 Day ROR but the cancel is more than 3 days after the sale \u2014 either the reason or the dates are wrong in FieldRoutes.',
    rows: all.filter(r => _cxlOnly(r) && _rorReason(r) && !_quickCxl(r)),
    sev: 'med',
  });
  // 3. Active recurring subs carrying $0 ARV.
  checks.push({
    id: 'zeroarv', icon: '💤', title: 'Active recurring subs with $0 ARV',
    fix: 'A recurring service billing nothing — frozen billing, a bad price, or a sub that should be one-time / closed.',
    rows: all.filter(r => isActive(r) && isRecurring(r) && (Number(r.annual_recurring_value) || 0) <= 0),
    sev: 'med',
  });
  // 4. Nonstandard agreement lengths on recurring subs.
  checks.push({
    id: 'oddterm', icon: '📄', title: 'Nonstandard agreement length (not 12 / 18 / 24)',
    fix: 'Legacy or fat-fingered terms (0, 6, 13, 36…). They pollute term analytics — the products are 12/18/24.',
    rows: all.filter(r => { const m = Number(r.agreement_length) || 0; return isRecurring(r) && isActive(r) && ![12, 18, 24].includes(m); }),
    sev: 'low',
  });
  // 5. Duplicate ACTIVE subs — same customer, same service, twice.
  checks.push({
    id: 'dupes', icon: '👯', title: 'Duplicate active subscriptions',
    fix: 'Same customer, same service type, active twice — usually a re-sign that never closed the old sub. Merge/close in FieldRoutes.',
    rows: (() => {
      const seen = new Map(), dupes = [];
      all.forEach(r => {
        if (!isActive(r) || !r.customer_id) return;
        const k = r.customer_id + '|' + String(r.subscription || '').toLowerCase();
        if (seen.has(k)) { if (seen.get(k) !== 'flagged') { dupes.push(seen.get(k)); seen.set(k, 'flagged'); } dupes.push(r); }
        else seen.set(k, r);
      });
      return dupes;
    })(),
    sev: 'med',
  });
  // 6. Cancel-reason spelling variants (same reason, different strings).
  const variantRows = (() => {
    const byNorm = new Map();
    all.forEach(r => {
      if (!r.subscription_date_canceled) return;
      const raw = String(r.subscription_cancellation_reason || '').trim();
      if (!raw) return;
      const k = _normCancelReason(raw);
      let g = byNorm.get(k); if (!g) { g = new Map(); byNorm.set(k, g); }
      g.set(raw, (g.get(raw) || 0) + 1);
    });
    const out = [];
    byNorm.forEach((g, k) => { if (g.size > 1) out.push({ norm: k, variants: [...g.entries()] }); });
    return out;
  })();
  checks.push({
    id: 'variants', icon: '🔤', title: 'Cancel-reason spelling variants',
    fix: 'The same reason spelled multiple ways in the CRM pick-list (trailing spaces, punctuation). The app normalizes them, but cleaning the source list stops the drift.',
    rows: [], custom: variantRows,
    sev: 'low',
  });

  const SEV = { high: '#DC2626', med: '#A9441F', low: '#7C857A' };
  const total = checks.reduce((a, c) => a + (c.custom ? c.custom.length : c.rows.length), 0);
  return el('div', { class: 'flex flex-col gap-4' },
    el('div', { class: 'card p-4' },
      el('h2', { class: 'text-lg font-bold' }, '🧹 Data Hygiene'),
      el('p', { class: 'text-xs mt-0.5', style: { color: 'var(--text-muted)' } },
        'The anomaly hunts, made permanent — every check runs on the live snapshot each time you open this page. Each card names the fix in FieldRoutes; exports go to whoever cleans it up. Goal: every count reads 0.'),
      el('div', { class: 'text-sm font-black tabular-nums mt-1.5', style: { color: total > 0 ? '#A9441F' : '#DF643A' } },
        total > 0 ? total.toLocaleString() + ' rows need attention across ' + checks.filter(c => (c.custom ? c.custom.length : c.rows.length) > 0).length + ' checks' : '✓ All clean')),
    ...checks.map(c => {
      const n = c.custom ? c.custom.length : c.rows.length;
      const isOpen = state._hygOpen === c.id;
      return el('div', { class: 'card p-4' + (n > 0 && !c.custom ? ' cursor-pointer' : ''), onclick: (n > 0 && !c.custom) ? () => { state._hygOpen = isOpen ? null : c.id; mountApp(); } : undefined },
        el('div', { class: 'flex items-start justify-between gap-3 flex-wrap' },
          el('div', { class: 'min-w-0' },
            el('div', { class: 'flex items-center gap-2' },
              el('span', {}, c.icon),
              el('h3', { class: 'text-sm font-bold' }, c.title),
              el('span', { class: 'text-sm font-black tabular-nums px-2 py-0.5 rounded-full', style: { background: n > 0 ? SEV[c.sev] + '18' : 'rgba(223,100,58,.14)', color: n > 0 ? SEV[c.sev] : '#DF643A' } }, n.toLocaleString()),
              (n > 0 && !c.custom) ? el('span', { class: 'text-[10px]', style: { color: 'var(--text-subtle)' } }, isOpen ? '▴ close' : '▾ view rows') : null),
            el('p', { class: 'text-[11px] mt-1', style: { color: 'var(--text-muted)' } }, c.fix))),
        // Inline row table (per Isaac — no exports, just look through them).
        (isOpen && !c.custom && n > 0) ? el('div', { class: 'mt-3 overflow-x-auto', style: { maxHeight: '380px', overflowY: 'auto' }, onclick: (e) => e.stopPropagation() },
          el('table', { class: 'w-full text-[11px] tabular-nums' },
            el('thead', { class: 'text-[9px] uppercase tracking-wider sticky top-0', style: { background: 'var(--card-2)', color: 'var(--text-muted)' } },
              el('tr', {}, ...BASE_COLS.map(h => el('th', { class: 'text-left px-2 py-1.5 font-semibold whitespace-nowrap' }, h)))),
            el('tbody', {},
              ...c.rows.slice(0, 400).map(r => el('tr', { class: 'border-t', style: { borderColor: 'var(--border)' } },
                ...baseRow(r).map((v, i) => el('td', { class: 'px-2 py-1.5' + (i === 1 ? ' font-semibold' : '') + ' whitespace-nowrap' }, String(v ?? ''))))),
              c.rows.length > 400 ? el('tr', {}, el('td', { class: 'px-2 py-2 text-center italic', colspan: BASE_COLS.length, style: { color: 'var(--text-subtle)' } }, 'Showing 400 of ' + c.rows.length.toLocaleString())) : null))) : null,
        c.custom && c.custom.length > 0 ? el('div', { class: 'mt-2 flex flex-col gap-1' },
          ...c.custom.slice(0, 12).map(v => el('div', { class: 'text-[11px] tabular-nums', style: { color: 'var(--text-muted)' } },
            v.variants.map(([raw, cnt]) => '"' + raw + '" ×' + cnt).join('  ·  ')))) : null);
    }));
}

// Settings ▸ Teams — the Manage Teams roster (teams, branches, tier, active)
// embedded as a tab. Same UI as the modal launched from the Audit view; both
// share manageTeamsPanel(). Editing here writes through to the same per-year
// team map and tier map the Users tab reads.
function adminTeams() {
  if (!isAdminRole(state.profile?.role)) return emptyCard('Admins only.');
  return el('div', { class: 'flex flex-col gap-3' }, manageTeamsPanel({ embedded: true }));
}

// Global Configurations — service lifecycle, lead sources, and cancel-reason
// rules. Moved here from the Reporting gear so it's one shared place; these
// rules now drive BOTH Reporting and the Indicators tab.
function adminConfigurations(part) {
  part = part || 'reporting';
  // The config panels show per-row counts (subs per service/source, cancels per
  // reason) sourced from state.reportingSubscriptions. Those rows are lazy-loaded
  // by the Reporting tab — but a user landing straight on Settings → Configurations
  // never trips that load, so every count comes back 0. Trigger the same load here
  // so the counts populate without having to visit Reporting first.
  const activeId = state.reportingActiveUploadId;
  if (activeId && state.reportingSubscriptionsLoadedFor !== activeId
      && typeof loadReportingSubscriptions === 'function') {
    loadReportingSubscriptions(activeId).then(rows => {
      if (state.reportingActiveUploadId !== activeId) return; // snapshot switched mid-flight
      if (rows == null) return;                               // aborted/superseded load
      state.reportingSubscriptions = rows;
      state.reportingSubscriptionsLoadedFor = activeId;
      _refreshRepTypeMap();
      mountApp();
    });
  }

  // ── Rebuilt (per Isaac, Sep 2026): labels + controls only, no prose on the
  // page. Every explanation lives behind the ⓘ. Five cards: Reporting rules,
  // Attrition steps (same 1–9 as the Retention tab), Branch ↔ QuickBooks,
  // Indicators, and the three lists (Service Types / Sources / Cancel
  // reasons) collapsed behind one-line headers.
  const defRow = (term, def) => el('div', { class: 'flex gap-3 text-xs' },
    el('div', { class: 'font-semibold shrink-0', style: { color: 'var(--text)', width: '180px' } }, term),
    el('div', { class: 'text-muted- leading-relaxed' }, def));
  const howItWorks = () => el('div', { class: 'flex flex-col gap-1.5' },
    defRow('Data source', 'A live mirror of FieldRoutes (RevHawk), re-synced hourly during the day — no manual uploads.'),
    defRow('Aging threshold', 'A sub counts as aging / at-risk when its days past due is greater than or equal to this number (default 7).'),
    defRow('Deleted CRM accounts', 'Customer IDs deleted inside FieldRoutes. The warehouse keeps their rows, so they are excluded from every dataset — automatically when the sync flags them.'),
    defRow('Commission Rules', 'The hourly sync (and the 15-minute FieldRoutes live pull) creates one sale per CRM subscription sold by a linked rep (Inside Sales, D2D, Technicians) the moment it exists. Each row shows whether it is commission-eligible — initial appointment on the books, billing on file, signed agreement — and auto-approval waits for the required ones. It then moves Upfront → Pending Backend Lock → Archived / History from the account’s live state. Revenue is frozen at first sight; the Log Sale form is for upsells only. Payroll runs stay the admin’s click.'),
    defRow('Indicators · MY % exclusions', 'Service terms left out of the MY % (multi-year) calculation on Indicators.'),
    defRow('Marketing / IS', 'Counts Office-Staff-sold accounts only; Renewal sources are excluded from new-business pace.'),
  );

  // ── tiny controls ──
  const sw = (on, onToggle) => el('button', { type: 'button', class: 'shrink-0', role: 'switch', 'aria-checked': String(!!on), style: { width: '44px', height: '32px', padding: '6px 4px', background: 'transparent', border: 'none', cursor: 'pointer' }, onclick: onToggle },
    el('span', { style: { display: 'block', position: 'relative', width: '36px', height: '20px', borderRadius: '10px', background: on ? 'var(--accent)' : 'var(--border-2)' } },
      el('span', { style: { position: 'absolute', top: '2px', left: on ? '18px' : '2px', width: '16px', height: '16px', borderRadius: '50%', background: '#fff', boxShadow: '0 1px 2px rgba(0,0,0,.3)', transition: 'left .12s' } })));
  const sub = (t) => el('div', { class: 'text-[10px] uppercase tracking-widest font-bold pt-3 pb-1', style: { color: 'var(--text-subtle)' } }, t);
  // Rows wrap on phones (controls drop under the label instead of pushing
  // off-screen); o.desc is a visible one-liner, o.tip stays a hover detail.
  const row = (label, control, o = {}) => el('div', { class: 'flex items-center justify-between gap-x-3 gap-y-1 py-1.5 border-t flex-wrap', style: { borderColor: 'var(--border)', paddingLeft: o.indent ? '18px' : '0' }, title: o.tip || '' },
    el('div', { class: 'min-w-0', style: { flex: o.stack ? '1 1 100%' : '1 1 200px' } },
      el('div', { class: (o.small ? 'text-xs' : 'text-sm') + ' font-semibold' + (o.tip ? ' cursor-help' : ''), style: o.muted ? { color: 'var(--text-muted)' } : {} }, label),
      o.desc ? el('div', { class: 'text-[11px]', style: { color: 'var(--text-subtle)', lineHeight: '1.35' } }, o.desc) : null),
    el('div', { class: 'flex items-center gap-2 flex-wrap justify-end', style: o.stack ? { flex: '1 1 100%', justifyContent: 'flex-start' } : {} }, ...[].concat(control).filter(Boolean)));
  const sel = (value, opts, onChange, w) => el('select', { class: 'rounded-lg border px-2 py-1 text-[11px] font-semibold cursor-pointer', style: { borderColor: 'var(--border-2)', background: 'var(--card)', color: 'var(--text)', minWidth: w || '0' }, onchange: (e) => onChange(e.target.value) },
    ...opts.map(([v, l]) => el('option', { value: v, selected: v === value }, l)));
  const txt = (value, onSave, o = {}) => el('input', { type: 'text', value, placeholder: o.placeholder || '', class: 'rounded-lg border px-2.5 py-1 text-[11px]', style: { borderColor: 'var(--border-2)', background: 'var(--card)', color: 'var(--text)', width: o.width || '260px' },
    onchange: (e) => onSave(e.target.value) });
  // Service picker: chips for the selected terms (× removes) + a dropdown of
  // every service in the Service Types list not yet covered. Terms match by
  // substring, so picking a service stores its full name.
  const svcNames = (() => { try { return [...reportingServiceRecurringMap().keys()].sort((a, b) => a.localeCompare(b)); } catch (e) { return []; } })();
  const svcPicker = (terms, onChange) => {
    const cur = terms.map(t => String(t).toLowerCase());
    const covered = (name) => cur.some(t => name.toLowerCase().includes(t));
    return el('div', { class: 'flex items-center gap-1.5 flex-wrap justify-end' },
      ...terms.map(t => el('span', { class: 'inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full', style: { background: 'rgba(223,100,58,.10)', color: 'var(--text)' } }, t,
        el('button', { class: 'text-[13px] leading-none', 'aria-label': 'Remove ' + t, style: { color: 'var(--text-muted)', minWidth: '28px', minHeight: '28px', margin: '-6px -8px -6px 0' }, onclick: () => onChange(terms.filter(x => x !== t)) }, '×'))),
      el('select', { class: 'rounded-lg border px-2 py-1 text-[11px] font-semibold cursor-pointer', style: { borderColor: 'var(--border-2)', background: 'var(--card)', color: 'var(--text)', maxWidth: '180px' },
        onchange: (e) => { const v = e.target.value; if (v) onChange([...terms, v.toLowerCase()]); } },
        el('option', { value: '' }, '+ add service'),
        ...svcNames.filter(nm => !covered(nm)).map(nm => el('option', { value: nm }, nm))));
  };
  const num = (value, onSave) => el('input', { type: 'number', min: '0', value: String(value), class: 'rounded-lg border px-2 py-1 text-[11px] tabular-nums', style: { borderColor: 'var(--border-2)', background: 'var(--card)', color: 'var(--text)', width: '64px', textAlign: 'right' }, onchange: (e) => onSave(e.target.value) });
  const pill = (t, color) => el('span', { class: 'text-[10px] font-semibold px-2 py-0.5 rounded-full', style: color ? { background: color + '18', color } : { background: 'var(--card-2)', color: 'var(--text-muted)' } }, t);
  const lbtn = (t, onclick, primary) => el('button', { class: 'rounded-lg px-2.5 py-1 text-[11px] font-bold transition hover:brightness-95', style: primary ? { background: 'var(--accent)', color: 'var(--accent-text)' } : { border: '1px solid var(--border-2)', color: 'var(--text)' }, onclick }, t);
  const card = (title, right, ...body) => el('div', { class: 'card p-4' },
    el('div', { class: 'flex items-center justify-between gap-3 mb-1' }, el('div', { class: 'text-sm font-bold' }, title), right || null),
    ...body);
  const splitList = (s) => [...new Set(String(s || '').split(/[,;\n]+/).map(x => x.trim()).filter(Boolean))];
  const n = (v) => Number(v || 0).toLocaleString();

  // ── 1. Reporting rules ──
  const orphans = orphanSubRows();
  const orphanCust = new Set(orphans.map(r => String(r.customer_id || ''))).size;
  const autoOrph = reportingAutoExcludeOrphans();
  const delIds = state.indicatorDeletedCustIds || [];
  const crmDelN = (state._crmDeletedIdsRaw || state._crmDeletedIds || []).length;
  const useScan = reportingUseCrmDeletedScan();
  const crmMeta = state._crmDeletedMeta;
  // Nested option under the row above (per Isaac): indented behind a guide
  // line with a ↳ marker, smaller + lighter than a top-level rule.
  const sub2 = (label, control, o = {}) => el('div', { class: 'flex items-center justify-between gap-x-3 gap-y-1 py-1.5 flex-wrap', style: { marginLeft: '10px', paddingLeft: '14px', borderLeft: '2px solid var(--border-2)' }, title: o.tip || '' },
    el('div', { class: 'text-[11px] font-semibold' + (o.tip ? ' cursor-help' : ''), style: { color: 'var(--text-muted)', flex: '1 1 140px' } }, '↳ ' + label),
    el('div', { class: 'flex items-center gap-2 flex-wrap justify-end' }, ...[].concat(control).filter(Boolean)));
  const reportingRules = card('Customer book & churn', null,
    row('Reinstatement grace', [el('span', { class: 'text-[11px] text-muted-' }, 'reactivated within'), num(reportingReinstateGraceDays(), (v) => { setReportingReinstateGraceDays(v); mountApp(); }), el('span', { class: 'text-[11px] text-muted-' }, 'days = never churned')], { desc: 'Cancelled then reactivated within this window = never churned.', tip: 'A cancelled account that is active again within this many days is treated as retained. Reactivated later than this, the cancel stands as churn (revenue was missed) and the reactivation counts as a win-back. Needs the reactivation date from the CRM feed; until it arrives, an active account with an old cancel date is treated as reinstated in time.' }),
    row('Aging threshold', [el('span', { class: 'text-[11px] text-muted-' }, 'days past due ≥'), num(reportingAgingDays(), (v) => { setReportingAgingDays(v); mountApp(); })], { desc: 'Days past due before an account counts as at-risk.', tip: 'A sub counts as aging / at-risk when its days past due is greater than or equal to this number.' }),
    row('Deleted CRM accounts', [
      orphans.length ? el('button', { class: 'text-[11px] font-semibold', style: { color: 'var(--accent)' }, onclick: () => openReportingDrillModal({ chartTitle: 'Subscriptions with no FieldRoutes customer record', sliceLabel: n(orphans.length) + ' subscriptions · deleted in the CRM', rows: orphans, formatValue: fmt.usd0 }) }, n(orphanCust) + ' detected →') : pill('0 detected'),
      pill(n(crmDelN) + ' from nightly FieldRoutes check' + (crmMeta && crmMeta.scanned_at ? ' · ' + new Date(crmMeta.scanned_at).toLocaleDateString([], { month: 'short', day: 'numeric' }) : ' · not run yet') + (crmMeta && !crmMeta.checked ? ' · last run checked 0' : '') + (useScan ? '' : ' · not applied')),
      sw(autoOrph, () => { setReportingAutoExcludeOrphans(!autoOrph); mountApp(); })]),
    sub2('Use nightly check', sw(useScan, () => { setReportingUseCrmDeletedScan(!useScan); mountApp(); }), { small: true, indent: true, tip: 'Off by default. When on, customers the nightly FieldRoutes check could not find are removed app-wide (leaderboard, reporting, retention). Turned off Sep 29 after the check flagged 2,355 live customers.' }),
    sub2('Stale pending', [pill(n((state._stalePendingCustIds || []).length) + ' customers'), el('span', { class: 'text-[11px] text-muted-' }, 'initial appt passed ≥'), num(reportingStalePendingDays(), (v) => { setReportingStalePendingDays(v); mountApp(); }), el('span', { class: 'text-[11px] text-muted-' }, 'days'), sw(reportingExclStalePending(), () => { setReportingExclStalePending(!reportingExclStalePending()); mountApp(); })], { small: true, indent: true, tip: 'Accounts deleted in FieldRoutes right after signup stay Active + Pending in the mirror forever. Customers whose every subscription is active, never serviced, and whose initial appointment passed this many days ago (or has no appointment and was sold 14+ days ago) are treated as deleted app-wide. On by default.' }),
  );

  // (Attrition steps card retired Sep 23 per Isaac — the Retention tab's own
  // switches are the place to reason about the retention book.)

  // ── Auto-log from FieldRoutes (app_settings.autolog) ──
  if (state._autolog === undefined) {
    state._autolog = null;
    supabase.from('app_settings').select('value, updated_at').eq('key', 'autolog').maybeSingle().then(({ data }) => {
      (state._settingsSeen = state._settingsSeen || {}).autolog = (data && data.updated_at) || null;
      state._autolog = Object.assign({ enabled: false, start: '2026-01-01', types: ['Office Staff', 'Sales Rep', 'Technician'], auto_approve: true, lock_days: 90, lock_min_services: 2 }, (data && data.value) || {});
      mountApp();
    });
  }
  const AL = state._autolog;
  const saveAL = async (patch) => {
    Object.assign(AL, patch);
    if ('audit_fail_flag' in patch && typeof _setAdminRule === 'function') _setAdminRule('auditFailFlag', patch.audit_fail_flag);   // Audit % / comps read the same flag
    // Compare-and-swap (per Sep 30 audit): if another admin saved Pay
    // automation since this page loaded, re-read theirs, re-apply ONLY this
    // edit on top, and save again — nobody's change is silently lost.
    let r = await saveAppSettingCas('autolog', AL);
    if (r.conflict) {
      const { data } = await supabase.from('app_settings').select('value, updated_at').eq('key', 'autolog').maybeSingle();
      state._autolog = Object.assign({}, (data && data.value) || {}, patch);
      (state._settingsSeen = state._settingsSeen || {}).autolog = (data && data.updated_at) || null;
      r = await saveAppSettingCas('autolog', state._autolog);
    }
    state._autologCache = state._autolog;
    if (!r.ok) toast('Could not save: ' + ((r.error && r.error.message) || 'another admin is editing — reload and retry'), 'error'); else { logActivity('config_change', { detail: 'Auto-log: ' + JSON.stringify(patch) }); toast('Saved — applies on the next sync', 'success'); }
    mountApp();
  };
  const TYPE_LABELS = [['Office Staff', 'Inside Sales'], ['Sales Rep', 'D2D'], ['Technician', 'Technicians']];
  const autolog = card('Pay automation · when a sale is created, approved and locked', AL ? pill(AL.enabled ? 'on · every sync' : 'off') : pill('loading…'),
    ...(!AL ? [] : [
      sub('What gets logged'),
      row('Create sales from CRM subscriptions', sw(!!AL.enabled, () => saveAL({ enabled: !AL.enabled })), { desc: 'Every sync turns new FieldRoutes subscriptions sold by linked reps into sales.', tip: 'Every sync creates one sale per FieldRoutes subscription — recurring plans AND one-time services — sold by a linked rep, with the revenue frozen at first sight. Off = reps log by hand.' }),
      row('Rep types', el('div', { class: 'flex items-center gap-3', title: 'Untick a type and the sync stops creating sales (and pay) for those reps from the next run on; sales already logged stay.' }, ...TYPE_LABELS.map(([k, l]) => {
        const on = (AL.types || []).includes(k);
        return el('label', { class: 'inline-flex items-center gap-1 text-[11px] font-semibold cursor-pointer' },
          el('input', { type: 'checkbox', checked: on, onchange: () => saveAL({ types: on ? (AL.types || []).filter(x => x !== k) : [...(AL.types || []), k] }) }), l);
      })), { indent: true, small: true }),
      row('Effective date', el('input', { type: 'date', value: String(AL.start || '').slice(0, 10), class: 'rounded-lg border px-2 py-1 text-[11px]', style: { borderColor: 'var(--border-2)', background: 'var(--card)', color: 'var(--text)' }, onchange: (e) => { if (e.target.value) saveAL({ start: e.target.value }); } }), { indent: true, small: true, tip: 'Subscriptions sold on or after this date are logged, ongoing, until the switch above is turned off. Earlier ones are never backfilled.' }),
      sub('Upfront Commission Approval'),
      // One row per rep type (per Isaac, Sep 23): each type has its own guard
      // rails before a sale auto-approves for upfront pay. Stored as
      // AL.approval[office|d2d|tech] = { appt, autopay, signed }; the old
      // company-wide require_* flags are the fallback for anything unset.
      (() => {
        const AP = AL.approval || {};
        const ruleOf = (k, f) => { const a = AP[k] || {}; if (a[f] != null) return !!a[f]; return f === 'appt' ? AL.require_appt !== false : f === 'autopay' ? AL.require_billing !== false : AL.require_signed !== false; };
        const setRule = (k, f, v) => saveAL({ approval: Object.assign({}, AP, { [k]: Object.assign({ appt: ruleOf(k, 'appt'), autopay: ruleOf(k, 'autopay'), signed: ruleOf(k, 'signed') }, AP[k] || {}, { [f]: v }) }) });
        const RULES = [
          ['appt',    'Initial appointment scheduled OR completed', 'The subscription\u2019s initial appointment is Pending or Completed in FieldRoutes.'],
          ['autopay', 'Autopay on file',                            'Customer has autopay (card or ACH) on file in FieldRoutes.'],
          ['signed',  'Signed agreement',                           'A completed e-sign agreement on the subscription or the customer (one-time services exempt).'],
        ];
        const TYPES = [['office', 'Inside Sales'], ['d2d', 'D2D'], ['tech', 'Technicians']];
        const th = (t, cls) => el('th', { class: (cls || 'text-left') + ' px-2 py-1.5 text-[10px] uppercase tracking-wider font-semibold', style: { color: 'var(--text-muted)' } }, t);
        return el('div', { class: 'rounded-lg border mb-2 overflow-x-auto', style: { borderColor: 'var(--border)' } },
          el('table', { class: 'text-xs', style: { width: '100%', borderCollapse: 'collapse' } },
            el('thead', {}, el('tr', { style: { background: 'var(--card-2)' } }, th('Auto-approval requires'), ...TYPES.map(([, l]) => th(l, 'text-center')))),
            el('tbody', {}, ...RULES.map(([f, label, tip]) => el('tr', { class: 'border-t', style: { borderColor: 'var(--border)' }, title: tip },
              el('td', { class: 'px-2 py-1.5 font-semibold' }, label),
              ...TYPES.map(([k]) => el('td', { class: 'px-2 py-1.5 text-center' }, sw(ruleOf(k, f), () => setRule(k, f, !ruleOf(k, f))))))))));
      })(),
      sub('FieldRoutes audit flags'),
      row('Passed Audit % tier counts accounts flagged', txt(AL.upfront_flag == null ? 'Passed Audit' : AL.upfront_flag, (v) => saveAL({ upfront_flag: String(v || '').trim() }), { placeholder: 'FieldRoutes customer flag', width: '180px' }), { tip: 'The FieldRoutes customer flag that marks an account as passed the office audit (signed agreement, autopay on file, charged upfront). Accounts carrying it count toward the Passed Audit % on the Pay tab (70%+ pays 100% of upfront commission; 50–69.9% 95%; 35–49.9% 90%; under 35% 85%). Re-checked every sync, so a flag added later still counts.' }),
      row('Failed-audit flag holds auto-approval', txt(AL.audit_fail_flag == null ? 'Failed Audit' : AL.audit_fail_flag, (v) => saveAL({ audit_fail_flag: String(v || '').trim() }), { placeholder: 'FieldRoutes customer flag', width: '180px' }), { indent: true, small: true, tip: 'Accounts carrying this flag stay in Upfront Sales for manual review instead of auto-approving. Clear the flag (or re-flag Passed) in FieldRoutes and the next sync continues the automated upfront-pay flow. Blank = no hold.' }),
      sub('Upsells'),
      row('Upsells', el('span', { class: 'text-[11px] font-semibold' }, 'Automatic \u2014 add-on ticket items in FieldRoutes'), { tip: 'Every add-on sold as a ticket item in FieldRoutes (Invoices \u2192 Add Ticket Item) becomes an upsell sale for the rep it is assigned to (or the person who added it). No manual logging (per Isaac).' }),
      addonItemsTable(AL, saveAL, sw, pill),
      sub('Backend lock'),
      row('Auto-approve upfront commission', sw(!!AL.auto_approve, () => saveAL({ auto_approve: !AL.auto_approve })), { desc: 'Approve upfront pay automatically once the rules below hold.', tip: 'Approved automatically once the Upfront Commission Approval guard rails for the rep type hold (and no Failed Audit flag). Off = an auditor clicks Approve.' }),
      // Backend lock guard rails per rep type (per Isaac, Sep 23): the account
      // stays pending until every indication holds. AL.backend[office|tech].
      (() => {
        const BK = AL.backend || {};
        // Sales Reps (D2D, per Isaac Sep 30): always wait for Jan 31 of the
        // following year, plus whatever indications are set here — defaults
        // off, so today's rule (Jan 31 only) holds until an admin adds one.
        const D2D_DEF = { min_days: 0, min_services: 0, max_dpd: 0, autopay: false, signed: false };
        const get = (k, f) => { const b = BK[k] || {}; if (b[f] != null) return b[f]; if (k === 'd2d') return D2D_DEF[f]; return f === 'min_days' ? (AL.lock_days ?? 90) : f === 'min_services' ? Math.max(0, (AL.lock_min_services ?? 2) - 1) : f === 'max_dpd' ? 7 : true; };
        const set = (k, f, v) => saveAL({ backend: Object.assign({}, BK, { [k]: Object.assign({}, BK[k] || {}, { [f]: v }) }) });
        const TYPES = [['office', 'Inside Sales'], ['tech', 'Technicians'], ['d2d', 'Sales Reps (D2D)']];
        const th = (t, cls) => el('th', { class: (cls || 'text-left') + ' px-2 py-1.5 text-[10px] uppercase tracking-wider font-semibold', style: { color: 'var(--text-muted)' } }, t);
        const ROWS = [
          ['_jan31',       'Not before Jan 31 of the following year',   'fixed',  'Sales Reps only (fixed rule): an account sold in a year never locks before Jan 31 of the next year. Cancelled before then = chargeback.'],
          ['min_days',     'Days since sale \u2265',                    'num',    'How old the sale must be before the backend can lock.'],
          ['min_services', 'Services completed after the initial \u2265', 'num',   'Regular appointments completed since the initial service (the initial itself does not count).'],
          ['max_dpd',      'No balance past due \u2265 (days)',           'num',    'A balance past due this many days or more holds the backend. 0 = ignore balances.'],
          ['autopay',      'Autopay still on file',                     'switch', 'Customer still has a card or ACH on file in FieldRoutes.'],
          ['signed',       'Signed agreement',                          'switch', 'A completed e-sign agreement (one-time services exempt).'],
        ];
        return el('div', { class: 'rounded-lg border mb-2 overflow-x-auto', style: { borderColor: 'var(--border)' } },
          el('table', { class: 'text-xs', style: { width: '100%', borderCollapse: 'collapse' } },
            el('thead', {}, el('tr', { style: { background: 'var(--card-2)' } }, th('Backend locks when'), ...TYPES.map(([, l]) => th(l, 'text-center')))),
            el('tbody', {}, ...ROWS.map(([f, label, kind, tip]) => el('tr', { class: 'border-t', style: { borderColor: 'var(--border)' }, title: tip },
              el('td', { class: 'px-2 py-1.5 font-semibold' }, label),
              ...TYPES.map(([k]) => el('td', { class: 'px-2 py-1.5 text-center' },
                kind === 'fixed' ? (k === 'd2d' ? pill('Always') : el('span', { class: 'text-[11px]', style: { color: 'var(--text-subtle)' } }, '—')) :
                kind === 'num' ? num(get(k, f), (v) => set(k, f, Math.max(0, parseInt(v, 10) || 0))) : sw(!!get(k, f), () => set(k, f, !get(k, f))))))))));
      })(),
    ]));

  // ── 4. Indicators ──
  // (Slack notifications per rep type moved to the Slack tab, per Isaac Sep 30 — slackTypesCard().)

  // Indicators exclusions (per Isaac, Sep 30): MY %, services left out
  // entirely, and whole teams left out of every Indicators metric.
  const _chipPicker = (vals, options, onChange, addLabel) => el('div', { class: 'flex items-center gap-1.5 flex-wrap justify-end' },
    ...vals.map(t => el('span', { class: 'inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full', style: { background: 'rgba(223,100,58,.10)', color: 'var(--text)' } }, t,
      el('button', { class: 'text-[13px] leading-none', 'aria-label': 'Remove ' + t, style: { color: 'var(--text-muted)', minWidth: '28px', minHeight: '28px', margin: '-6px -8px -6px 0' }, onclick: () => onChange(vals.filter(x => x !== t)) }, '×'))),
    el('select', { class: 'rounded-lg border px-2 py-1 text-[11px] font-semibold cursor-pointer', style: { borderColor: 'var(--border-2)', background: 'var(--card)', color: 'var(--text)', maxWidth: '180px' },
      onchange: (e) => { const v = e.target.value; if (v) onChange([...vals, v]); } },
      el('option', { value: '' }, addLabel), ...options.filter(o => !vals.includes(o)).map(o => el('option', { value: o }, o))));
  const _exSvc = Array.isArray(state.indicatorExclServices) ? state.indicatorExclServices : [..._IND_EXCLUDED_SERVICES];
  const _allTeams = (typeof distinctTeams === 'function' ? distinctTeams() : []).filter(t => t && t !== 'Excluded').sort();
  const _exTeams = Array.isArray(state.indicatorExclTeams) ? state.indicatorExclTeams : [];
  const indicators = card('Indicators', null,
    row('MY % exclusions', svcPicker(myExcludeTerms(), (l) => { state.indicatorMyExclServiceTerms = l.length ? l : null; saveIndicatorState(); toast(l.length ? l.length + ' service' + (l.length === 1 ? '' : 's') + ' excluded from MY %' : 'Reset to the default (sentricon)', 'success'); mountApp(); }), { desc: 'Left out of both sides of MY %.', stack: true, tip: 'Services dropped from both sides of the MY % (multi-year) ratio — they still count everywhere else.' }),
    row('Excluded services', svcPicker(_exSvc, (l) => { state.indicatorExclServices = l; saveIndicatorState(); toast(l.length + ' service' + (l.length === 1 ? '' : 's') + ' left out of Indicators', 'success'); mountApp(); }), { desc: 'Left out of every Indicators number.', stack: true, tip: 'Services left out of every Indicators metric (fees, chargebacks, follow-ups, inspections, removals — not real new production). Starts from the built-in list.' }),
    row('Excluded teams', _chipPicker(_exTeams, _allTeams, (l) => { state.indicatorExclTeams = l; saveIndicatorState(); toast(l.length ? l.length + ' team' + (l.length === 1 ? '' : 's') + ' left out of Indicators' : 'No teams excluded', 'success'); mountApp(); }, '+ exclude team'), { desc: 'Reps on these teams drop out of Indicators.', stack: true, tip: 'Every sale by a rep on these teams drops out of every Indicators metric (boards, totals, charts). Competitions keep their own team exclusions.' }),
    row('Last Resort · initial under', el('span', { class: 'inline-flex items-center gap-1 text-[11px]' }, '$', num(lastResortMin(), (v) => { const n = Number(v); _setAdminRule('lastResortMin', Number.isFinite(n) && n >= 0 && n !== LAST_RESORT_MIN_DEFAULT ? n : null); toast('Last Resort = initial under $' + lastResortMin(), 'success'); mountApp(); })),
      { desc: 'Last Resort % and every competition’s Failed bucket.', tip: 'Sales whose initial price is under this are “Last Resort”: shown in Last Resort %, and out of every competition (PRA, King of the Hill, Top Gun, raffles). Default $' + LAST_RESORT_MIN_DEFAULT + '. 0 turns it off.' }),
    row('Pest initial exclusions', svcPicker(pestInitialExclList(), (l) => { _setAdminRule('pestInitialExcl', l.length ? l : []); toast(l.length ? l.length + ' service' + (l.length === 1 ? '' : 's') + ' left out of Pest Init' : 'Nothing left out of Pest Init', 'success'); mountApp(); }),
      { desc: 'Left out of Avg Pest / Pest Init (boards, player cards, raffles, exports).', stack: true, tip: 'Services matched by name (partial, any case). Default Sentricon, German Roach, Interior Flea.' + (Array.isArray(_adminRules() && _adminRules().pestInitialExcl) ? '' : ' (default)') }),
    row('Failed-audit flag', el('span', { class: 'text-[11px] font-semibold' }, auditFailFlag() || '— none —'), { desc: 'Audit %, competitions’ Failed bucket and the pay hold all read this one flag. Edit it in Pay automation.' }),
    (typeof indicatorMetricRulesTable === 'function') ? indicatorMetricRulesTable() : null,
  );

  // ── 5. Lists — collapsed one-liners ──
  const listCard = (key, title, count, build) => {
    const open = state._cfgOpen === key;
    return el('div', { class: 'card', id: 'cfg-list-' + key },
      el('button', { class: 'w-full flex items-center justify-between gap-3 px-4 py-3 text-left', onclick: () => { state._cfgOpen = open ? null : key; mountApp(); } },
        el('span', { class: 'text-sm font-bold' }, title),
        el('span', { class: 'flex items-center gap-2' }, pill(count), el('span', { class: 'text-[11px] text-muted-' }, open ? '▲' : '▼'))),
      open ? el('div', { class: 'px-4 pb-4' }, build()) : null);
  };
  const svcCount = (() => { try { const m = reportingServiceRecurringMap(); return n(m.size) + ' services'; } catch (e) { return ''; } })();
  const cxlCount = (() => { try { return n(reportingExcludedCancelReasons().size) + ' excluded'; } catch (e) { return ''; } })();

  const head = (title, desc, extra) => el('div', {},
    el('div', { class: 'flex items-center gap-2' }, el('h2', { class: 'text-lg font-bold' }, title), extra || null),
    desc ? el('p', { class: 'text-xs text-muted- mt-0.5' }, desc) : null);
  const advanced = (...items) => el('div', { class: 'flex flex-col gap-3' },
    el('div', { class: 'text-[10px] uppercase tracking-widest font-bold pt-2', style: { color: 'var(--text-subtle)' } }, 'Advanced'), ...items.filter(Boolean));
  // Pay automation lives with Commissions (Settings → Commissions & payroll).
  if (part === 'autolog') return autolog;
  if (part === 'marketing') return el('div', { class: 'flex flex-col gap-4' },
    head('Marketing & lead sources', 'What each FieldRoutes lead source is (new / renewal / upsell, paid or not, which provider it rolls into), how ad accounts and GoHighLevel leads map in, and the marketing targets.'),
    listCard('source', 'Lead sources', '', reportingSourceConfigPanel),
    typeof reportingAdAccountsPanel === 'function' ? listCard('adacc', 'Ad accounts → branch', 'Facebook + Google', reportingAdAccountsPanel) : null,
    typeof reportingGhlSourcesPanel === 'function' ? listCard('ghl', 'GoHighLevel sources → provider', (state._ghl && state._ghl.rows && state._ghl.rows.length) ? n(state._ghl.rows.length) + ' contacts' : 'sync', reportingGhlSourcesPanel) : null,
    typeof reportingMarketingGoalsPanel === 'function' ? listCard('mgoals', 'Marketing goals & targets', 'CAC · ROAS · spend mix', reportingMarketingGoalsPanel) : null);
  return el('div', { class: 'flex flex-col gap-4' },
    head('Reporting rules', 'How the customer book, churn and the Indicators leaderboard are counted — every tab reads these.', configInfoBtn('How reporting works', howItWorks())),
    reportingRules,
    indicators,
    listCard('service', 'Service types', svcCount, reportingServiceConfigPanel),
    listCard('cancel', 'Cancel reasons', cxlCount, reportingCancelConfigPanel),
    advanced(
      typeof reportingCrmVocabPanel === 'function' ? listCard('vocab', 'CRM vocabulary', 'seller types · reasons · ROR window', reportingCrmVocabPanel) : null,
      typeof reportingOpsBaselinePanel === 'function' ? listCard('ops', 'Operations baseline', 'benchmarks', reportingOpsBaselinePanel) : null));
}

// Global Admin — toggles between two views:
//   • Upload History — the two CSVs that drive the dashboards (Reporting
//     snapshot + Indicators export), side by side. They're separate files and
//     should generally be uploaded together so every tab reflects the same
//     week. Reporting snapshots are switchable/deletable; indicators history
//     is read-only (kept for record-break comparisons).
//   • App Activity — the full activity log (every logged action).
// (adminUploads removed — unreferenced; settings audit, Sep 30)

// ── 🧪 DATA INTEGRITY — every judgment call the app makes, quantified. ──
// Bridging a CRM means fallbacks and text-matching; this panel makes each
// one VISIBLE with a count and the actual rows behind it, so "why does this
// number look off" always has a checkable answer.
function dataIntegrityPanel() {
  const raw = state._indicatorRawSales || [];
  if (!raw.length) return emptyCard('No dataset loaded — hit ↻ sync first.');
  const _sig = (n) => String(n || '').toLowerCase().replace(/[.,]/g, ' ').split(/\s+/).filter(Boolean).sort().join(' ');
  const typeMap = state._indicatorRepTypeBySig || {};
  const rosterSigs = new Set();
  (state.frRoster || []).forEach(e => {
    [(typeof _frEmpName === 'function') ? _frEmpName(e) : '', (typeof _frRealName === 'function') ? _frRealName(e) : '']
      .forEach(nm => { const g = _sig(nm); if (g) rosterSigs.add(g); });
  });

  // ── compute all checks in one pass ──
  const typeCls = { crm: 0, map: 0, fallback: 0 };
  const fallbackRows = [];
  const sigInfo = new Map();          // sig → { names:Set, ids:Set, n }
  const blankRows = [];
  let blankRev = 0;
  const cancelCls = { explicitRor: 0, dateFallbackRor: 0, mistagSuspect: 0, unspecified: 0, total: 0 };
  const mistagRows = [], unspecRows = [];
  for (const x of raw) {
    if (!x) continue;
    if (!x.rep) { blankRows.push(x); blankRev += Number(x.contractValue) || 0; continue; }
    // type classification source
    if (String(x.repType || '').trim()) typeCls.crm++;
    else if (typeMap[_sig(getCanonicalRepName(x.rep))]) typeCls.map++;
    else { typeCls.fallback++; if (fallbackRows.length < 120) fallbackRows.push(x); }
    // name/id collisions
    const g = _sig(getCanonicalRepName(x.rep));
    const inf = sigInfo.get(g) || { names: new Set(), ids: new Set(), n: 0 };
    inf.names.add(getCanonicalRepName(x.rep)); if (String(x.repId || '').trim()) inf.ids.add(String(x.repId).trim());
    inf.n++; sigInfo.set(g, inf);
    // cancel classification
    if (x.cancelDate) {
      cancelCls.total++;
      const reason = (x.cancelReason || '').trim();
      const dateRor = (typeof _is3DayROR === 'function') && _is3DayROR({ ...x, cancelReason: '' });
      if (_rorReasonHit(reason)) cancelCls.explicitRor++;
      else if (!reason && dateRor) cancelCls.dateFallbackRor++;
      else if (reason && dateRor && !_snsReasonHit(reason)) { cancelCls.mistagSuspect++; if (mistagRows.length < 120) mistagRows.push(x); }
      if (!reason) { cancelCls.unspecified++; if (unspecRows.length < 120) unspecRows.push(x); }
    }
  }
  // unmatched rep names (no CRM type AND not in roster)
  const repTotals = new Map();
  raw.forEach(x => { if (!x.rep) return; const k = getCanonicalRepName(x.rep); const t = repTotals.get(k) || { n: 0, rev: 0, hasType: false }; t.n++; t.rev += Number(x.contractValue) || 0; if (String(x.repType || '').trim()) t.hasType = true; repTotals.set(k, t); });
  const unmatched = [...repTotals.entries()].filter(([name, t]) => !t.hasType && !typeMap[_sig(name)] && !rosterSigs.has(_sig(name)))
    .sort((a, b) => b[1].rev - a[1].rev);
  // same-sig, multiple CRM ids = two different people sharing a name
  const collisions = [...sigInfo.entries()].filter(([, v]) => v.ids.size > 1)
    .map(([g, v]) => ({ names: [...v.names].join(' / '), ids: [...v.ids].join(', '), n: v.n }));
  // multi-office reps
  const officeBySig = new Map();
  raw.forEach(x => { if (!x.rep || !x.office) return; const g = _sig(getCanonicalRepName(x.rep)); const st = officeBySig.get(g) || { name: getCanonicalRepName(x.rep), offices: new Map() }; st.offices.set(x.office, (st.offices.get(x.office) || 0) + 1); officeBySig.set(g, st); });
  const multiOffice = [...officeBySig.values()].filter(v => v.offices.size > 1)
    .map(v => ({ name: v.name, offices: [...v.offices.entries()].sort((a, b) => b[1] - a[1]).map(([o, n]) => o + ' (' + n + ')').join(' · '), n: [...v.offices.values()].reduce((a, b) => a + b, 0) }))
    .sort((a, b) => b.n - a.n);

  // ── render helpers ──
  if (!state._integrityOpen) state._integrityOpen = {};
  const money0 = (v) => '$' + Math.round(v || 0).toLocaleString();
  const listTable = (cols, rows) => el('div', { class: 'scroll-x rounded-lg border mt-2', style: { borderColor: 'var(--border)', maxHeight: '320px', overflowY: 'auto' } },
    el('table', { class: 'w-full text-[11px]' },
      el('thead', { style: { position: 'sticky', top: 0, background: 'var(--card-2)' } }, el('tr', {},
        ...cols.map((c, i) => el('th', { class: (i === 0 ? 'text-left pl-3 pr-2' : 'text-left px-2') + ' py-1.5 text-[9px] uppercase tracking-wider font-semibold', style: { color: 'var(--text-muted)' } }, c)))),
      el('tbody', {}, ...rows.map(r => el('tr', { class: 'border-t', style: { borderColor: 'var(--border)' } },
        ...r.map((v, i) => el('td', { class: (i === 0 ? 'pl-3 pr-2' : 'px-2') + ' py-1.5 whitespace-nowrap' }, v)))))));
  const saleRow = (x) => [getCanonicalRepName(x.rep || '—'), x.customerId || '—', x.customer || '—', x.office || '—', x.source || '—', money0(x.contractValue), x.dateSold || '—'];
  const SALE_COLS = ['Rep', 'Cust ID', 'Customer', 'Office', 'Source', 'Contract', 'Sold'];
  const check = (key, title, count, tone, note, detail) => {
    const open = !!state._integrityOpen[key];
    const color = tone === 'bad' ? '#DC2626' : tone === 'warn' ? '#A9441F' : '#DF643A';
    return el('div', { class: 'card p-4' },
      el('div', { class: 'flex items-center gap-2.5 flex-wrap' + (detail ? ' cursor-pointer' : ''),
        onclick: detail ? (() => { state._integrityOpen[key] = !open; mountApp(); }) : undefined },
        el('span', { class: 'inline-block w-2.5 h-2.5 rounded-full shrink-0', style: { background: color } }),
        el('span', { class: 'text-sm font-bold' }, title),
        el('span', { class: 'text-sm font-black tabular-nums', style: { color } }, typeof count === 'number' ? count.toLocaleString() : count),
        detail ? el('span', { class: 'text-[10px] ml-auto', style: { color: 'var(--text-muted)' } }, open ? '▴ hide rows' : '▾ see rows') : null),
      el('div', { class: 'text-[11px] mt-1', style: { color: 'var(--text-muted)' } }, note),
      open && detail ? detail() : null);
  };
  const pct = (n, d) => d > 0 ? ' (' + (n / d * 100).toFixed(1) + '% of dataset)' : '';

  return el('div', { class: 'flex flex-col gap-3' },
    el('div', { class: 'text-xs text-muted-' },
      'Every judgment call quantified against the current dataset (' + raw.length.toLocaleString() + ' rows). Green = clean, amber = worth a look, red = actively skewing numbers.'),
    check('fallback', 'Rep type guessed from lead source', typeCls.fallback,
      typeCls.fallback === 0 ? 'good' : (typeCls.fallback / raw.length > 0.02 ? 'bad' : 'warn'),
      'CRM per-sale type: ' + typeCls.crm.toLocaleString() + ' · name-map: ' + typeCls.map.toLocaleString() + ' · source-guess: ' + typeCls.fallback.toLocaleString() + pct(typeCls.fallback, raw.length) + '. Guessed rows are the crack technicians slipped through — fix by getting the name matched to the CRM.',
      typeCls.fallback ? (() => listTable(SALE_COLS, fallbackRows.map(saleRow))) : null),
    check('unmatched', 'Rep names with no CRM match', unmatched.length,
      unmatched.length === 0 ? 'good' : (unmatched.length > 50 ? 'bad' : 'warn'),
      'Names in the sales data that match nobody in the FieldRoutes roster — usually spelling differences or departed reps. Resolve in Manage Teams → Link Names to CRM.' + (!(state.frRoster || []).length ? ' (Roster not loaded this session — open Settings → Users once to load it, then revisit.)' : ''),
      unmatched.length ? (() => listTable(['Rep name', 'Sales', 'Revenue'], unmatched.slice(0, 120).map(([n, t]) => [n, String(t.n), money0(t.rev)]))) : null),
    check('collision', 'Same name, multiple CRM employee IDs', collisions.length,
      collisions.length === 0 ? 'good' : 'bad',
      'Two different people may be sharing one stat line — the name signature matches but the CRM employee IDs differ. Verify and split/alias these deliberately.',
      collisions.length ? (() => listTable(['Name variants', 'Employee IDs', 'Sales pooled'], collisions.map(c => [c.names, c.ids, String(c.n)]))) : null),
    check('mistag', 'Quick cancels with a non-ROR reason', cancelCls.mistagSuspect,
      cancelCls.mistagSuspect === 0 ? 'good' : 'warn',
      'Cancelled within 3 days of sale but the typed reason says something else. The app counts these as RORs (confirmed rule: quick cancel = ROR even when mistagged) — this is the list to clean up in FieldRoutes. Cancels overall: ' + cancelCls.total.toLocaleString() + ' · explicit ROR reason: ' + cancelCls.explicitRor.toLocaleString() + ' · date-inferred ROR: ' + cancelCls.dateFallbackRor.toLocaleString() + '.',
      cancelCls.mistagSuspect ? (() => listTable(SALE_COLS.concat('Reason'), mistagRows.map(x => saleRow(x).concat(x.cancelReason || '—')))) : null),
    check('unspec', 'Cancels with no reason at all', cancelCls.unspecified,
      cancelCls.unspecified === 0 ? 'good' : (cancelCls.unspecified / Math.max(1, cancelCls.total) > 0.1 ? 'bad' : 'warn'),
      'Blank cancel reasons land in "Unspecified" on Cancel Analysis and can\u2019t be classified as ROR/renewal/etc. beyond the 3-day date rule.',
      cancelCls.unspecified ? (() => listTable(SALE_COLS, unspecRows.map(saleRow))) : null),
    check('blank', 'Rows with a blank rep name', blankRows.length,
      blankRows.length === 0 ? 'good' : 'warn',
      'Never counted in any rep metric (' + money0(blankRev) + ' of contract value sits here). Branch totals still include them.',
      blankRows.length ? (() => listTable(SALE_COLS, blankRows.slice(0, 120).map(saleRow))) : null),
    check('multioffice', 'Reps selling across multiple offices', multiOffice.length,
      'good',
      'Not an error — but their "primary branch" label (leaderboard filters, Manage Teams) is a judgment call: sales count under the account\u2019s office, the rep label follows their biggest market.',
      multiOffice.length ? (() => listTable(['Rep', 'Offices (sales)', 'Total sales'], multiOffice.slice(0, 120).map(m => [m.name, m.offices, String(m.n)]))) : null),
  );
}

// ── 📚 Monthly Archive — the sync job writes one immutable rollup per
// closed month (snapshots/metrics-YYYY-MM.json.gz): company, per-office,
// per-department, and per-rep sales/revenue metrics. These files are never
// pruned, so history survives the app's 3-year data fence.
// (monthlyArchivePanel removed — unreferenced; settings audit, Sep 30)

// Indicators upload history — each row is one Indicators CSV import. The most
// recent is the live data behind the Indicators tab; older entries are kept
// for "records broken since last upload" comparisons. Read-only (no per-row
// activate/delete — there's a single live indicators dataset, not switchable
// snapshots like the reporting side).
// (indicatorsUploadsPanel removed — unreferenced; settings audit, Sep 30)

// ── Placeholder settings sections (filled in later as needed) ──
function adminGoals() {
  // One set of goals per department (per Isaac, Sep 22): Office Staff is the
  // company goal everything already reads; Door to Door and Technicians are
  // their own objects (same cards, own storage) to be configured from here.
  // Sep 23: Door to Door = per-rep goals set by partners (their own teams);
  // Technicians cleared — Isaac builds that out with the COO.
  const _partnerOnly = !isAdminRole(state.profile?.role) && isPartnerRole(state.profile?.role);
  if (_partnerOnly) state._goalDept = 'd2d';
  const dept = GOAL_DEPTS.find(d => d.id === state._goalDept) || GOAL_DEPTS[0];
  if (dept.id === 'd2d' || dept.id === 'tech') {
    const tabs = _partnerOnly ? null : el('div', { class: 'inline-flex rounded-lg border overflow-hidden', style: { borderColor: 'var(--border-2)' } },
      ...GOAL_DEPTS.map(d => el('button', { class: 'px-3 py-1.5 text-[11px] font-bold transition', style: d.id === dept.id ? { background: 'var(--accent)', color: 'var(--accent-text)' } : { color: 'var(--text-muted)' }, onclick: () => { state._goalDept = d.id; mountApp(); } }, d.label)));
    return el('div', { class: 'flex flex-col gap-5' },
      el('div', { class: 'flex items-center justify-between gap-3 flex-wrap' }, el('h2', { class: 'text-xl font-bold' }, 'Goals'), tabs),
      dept.id === 'tech'
        ? el('div', { class: 'card p-8 text-center text-sm text-muted-' }, 'Technician goals are being built out with the COO.')
        : d2dRepGoalsCard(_partnerOnly));
  }
  const g = deptGoalObj(dept.id);
  g.amount         = g.amount         ?? 0;
  g.new_amount     = g.new_amount     ?? Math.round(g.amount * 0.75);
  g.renewal_amount = g.renewal_amount ?? Math.round(g.amount * 0.25);
  g.is_reps        = g.is_reps        ?? 5;   // Inside Sales reps (carry the NEW quota)
  g.loyalty_reps   = g.loyalty_reps   ?? 4;   // Loyalty reps (carry the RENEWAL quota)
  // Per-quarter head counts (per Isaac, Sep 23): the /rep quota is the
  // quarter's revenue ÷ the reps on the floor THAT quarter. Seeded from the
  // old single number; edited inside the quota grid.
  if (!Array.isArray(g.is_reps_q)      || g.is_reps_q.length      !== 4) g.is_reps_q      = [0, 1, 2, 3].map(() => Math.max(1, g.is_reps || 1));
  if (!Array.isArray(g.loyalty_reps_q) || g.loyalty_reps_q.length !== 4) g.loyalty_reps_q = [0, 1, 2, 3].map(() => Math.max(1, g.loyalty_reps || 1));
  // Monthly allocation is the source of truth — seeded from the seasonal curve,
  // editable per month, and feeds the IS pacer, dashboard, and Marketing tab.
  if (!Array.isArray(g.monthly_new)     || g.monthly_new.length     !== 12) g.monthly_new     = IS_SEASONAL.map(s => Math.round(g.new_amount * s));
  if (!Array.isArray(g.monthly_renewal) || g.monthly_renewal.length !== 12) g.monthly_renewal = IS_RENEWAL_SEASONAL.map(s => Math.round(g.renewal_amount * s));
  // Keep annual + quarterly derived from the monthly grid so existing consumers
  // (dashboard war-room, per-rep math) stay correct.
  const syncDerived = () => {
    g.new_amount     = g.monthly_new.reduce((a, b) => a + (b || 0), 0);
    g.renewal_amount = g.monthly_renewal.reduce((a, b) => a + (b || 0), 0);
    g.amount = g.new_amount + g.renewal_amount;
    const qsum = (arr, q) => (arr[q*3]||0) + (arr[q*3+1]||0) + (arr[q*3+2]||0);
    g.quarterly_new     = [0,1,2,3].map(q => qsum(g.monthly_new, q));
    g.quarterly_renewal = [0,1,2,3].map(q => qsum(g.monthly_renewal, q));
    g.quarterly         = [0,1,2,3].map(q => g.quarterly_new[q] + g.quarterly_renewal[q]);
    const cq = Math.floor(new Date().getMonth() / 3);
    g.is_reps = Math.max(1, g.is_reps_q[cq] || 1); g.loyalty_reps = Math.max(1, g.loyalty_reps_q[cq] || 1);   // legacy single numbers = this quarter
  };
  syncDerived();
  const persist = () => { syncDerived(); saveDemoData(); saveDeptGoal(dept.id); };
  // Re-spread an annual total across the 12 months via the matching seasonal curve.
  const reseed = (which, annual) => {
    const curve = which === 'new' ? IS_SEASONAL : IS_RENEWAL_SEASONAL;
    const arr = curve.map(s => Math.round(annual * s));
    if (which === 'new') g.monthly_new = arr; else g.monthly_renewal = arr;
    persist(); mountApp();
  };
  // YTD actuals only exist for the office-staff goal today (the CRM pool the
  // dashboard reads); the other departments show targets without progress.
  const ytd = dept.id === 'office' ? goalYtdRevenue(true) : { total: 0, new: 0, renewal: 0 };
  const tabs = el('div', { class: 'inline-flex rounded-lg border overflow-hidden', style: { borderColor: 'var(--border-2)' } },
    ...GOAL_DEPTS.map(d => el('button', { class: 'px-3 py-1.5 text-[11px] font-bold transition', style: d.id === dept.id ? { background: 'var(--accent)', color: 'var(--accent-text)' } : { color: 'var(--text-muted)' }, onclick: () => { state._goalDept = d.id; mountApp(); } }, d.label)));

  return el('div', { class: 'flex flex-col gap-5' },
    el('div', { class: 'flex items-center justify-between gap-3 flex-wrap' }, el('h2', { class: 'text-xl font-bold' }, 'Goals'), tabs),

    // ── Annual targets + team size ──
    el('div', { class: 'card p-5' },
      el('h3', { class: 'text-sm font-bold mb-4' }, 'Annual targets & team'),
      el('div', { class: 'grid grid-cols-1 sm:grid-cols-3 gap-4' },
        goalTargetCard('Total Revenue', g.amount, ytd.total, null, true),
        goalTargetCard(dept.lines.a, g.new_amount, ytd.new, (val) => reseed('new', val)),
        goalTargetCard(dept.lines.b, g.renewal_amount, ytd.renewal, (val) => reseed('renewal', val)))),

    // ── Quota grid: monthly allocation + quarterly rollup in one table (per Isaac, Sep 23) ──
    goalMonthlyCard(g, persist, dept),
  );
}

// (goalRepCountField removed — unreferenced; settings audit, Sep 30)

// Quarterly rollup with per-rep quota (quarterly amount ÷ rep count) — matches
// the Inside Sales / Loyalty quota blocks in the RIDD quota sheet.
// (goalQuarterlyCard removed — unreferenced; settings audit, Sep 30)

// Monthly allocation grid — New + Renewal editable per month, Total computed.
// This is what the IS pacer / dashboard / Marketing read for projections.
function goalMonthlyCard(g, persist, dept) {
  dept = dept || GOAL_DEPTS[0];
  const lineA = dept.blocks.a, lineB = dept.blocks.b;
  const N = dept.names || {};   // explicit row labels (Office Staff); other depts fall back to the block names
  const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const usd = (n) => '$' + Math.round(n || 0).toLocaleString();
  const curM = new Date().getMonth();
  // Phone (per Isaac, Sep 23): one month at a time behind a dropdown, defaulting
  // to the current month; the quarterly band shows that month's quarter.
  // Desktop: all 12 months fit the card width — no horizontal scrolling.
  const phone = window.matchMedia('(max-width: 767px)').matches;
  if (state._goalMonth == null) state._goalMonth = curM;
  const months = phone ? [state._goalMonth] : M.map((_, i) => i);
  const quarters = phone ? [Math.floor(state._goalMonth / 3)] : [0, 1, 2, 3];
  if (!window.__goalGridResize) { window.__goalGridResize = true; let _t; window.addEventListener('resize', () => { clearTimeout(_t); _t = setTimeout(() => { if (state.view === 'admin') mountApp(); }, 200); }); }
  const cell = (arr, m) => el('input', {
    type: 'text', inputmode: 'numeric', value: Math.round(arr[m] || 0).toLocaleString(),
    class: 'text-left text-[11px] rounded border px-1.5 py-1 tabular-nums', style: { borderColor: 'var(--border-2)', width: '100%', minWidth: '0' },
    onchange: (e) => { arr[m] = parseFloat(e.target.value.replace(/[^0-9.]/g, '')) || 0; persist(); mountApp(); },
  });
  // Editable seasonal curve %: each month's share of its line's annual total.
  // Editing reshapes the curve while HOLDING that line's annual total fixed —
  // the edited month takes the new %, the other months rescale proportionally.
  const reshapeCurve = (arr, m, frac) => {
    frac = Math.max(0, Math.min(1, frac || 0));
    const annual = arr.reduce((a, b) => a + (b || 0), 0);
    if (annual <= 0) return;
    const otherSum = annual - (arr[m] || 0);
    arr[m] = annual * frac;
    const remain = annual * (1 - frac);
    if (otherSum > 0) { const f = remain / otherSum; for (let i = 0; i < arr.length; i++) if (i !== m) arr[i] = (arr[i] || 0) * f; }
    else { const each = remain / (arr.length - 1); for (let i = 0; i < arr.length; i++) if (i !== m) arr[i] = each; }
  };
  const curveCell = (arr, m) => {
    const tot = arr.reduce((a, b) => a + (b || 0), 0);
    const pct = tot > 0 ? (arr[m] || 0) / tot * 100 : 0;
    return el('input', {
      type: 'text', inputmode: 'decimal', value: pct.toFixed(1) + '%',
      class: 'text-left text-[11px] rounded border px-1.5 py-1 tabular-nums', style: { borderColor: 'var(--border-2)', width: '100%', minWidth: '0' },
      onchange: (e) => { reshapeCurve(arr, m, (parseFloat(e.target.value.replace(/[^0-9.]/g, '')) || 0) / 100); persist(); mountApp(); },
    });
  };
  const totNew = g.monthly_new.reduce((a, b) => a + (b || 0), 0);
  const totRen = g.monthly_renewal.reduce((a, b) => a + (b || 0), 0);
  const repsA = (q) => Math.max(1, Number(g.is_reps_q[q]) || 1), repsB = (q) => Math.max(1, Number(g.loyalty_reps_q[q]) || 1);
  const qOf = (m) => Math.floor(m / 3);
  const yrA = [0, 1, 2, 3].reduce((a, q) => a + repsA(q), 0) / 4, yrB = [0, 1, 2, 3].reduce((a, q) => a + repsB(q), 0) / 4;   // year /rep = avg head count
  const repCell = (arr, q) => el('input', {
    type: 'number', min: '1', step: '1', value: Math.max(1, Number(arr[q]) || 1), title: 'Reps on the floor this quarter',
    class: 'text-left text-[11px] rounded border px-1.5 py-0.5 tabular-nums', style: { borderColor: 'var(--border-2)', width: '56px' },
    onchange: (e) => { arr[q] = Math.max(1, parseInt(e.target.value, 10) || 1); persist(); mountApp(); },
  });
  return el('div', { class: 'card p-4' },
    el('div', { class: 'flex items-center justify-between flex-wrap gap-2 mb-3' },
      el('h3', { class: 'text-sm font-bold' }, dept.label + ' Quota'),
      phone ? el('select', { class: 'rounded-lg border px-2 py-1 text-[11px] font-semibold', style: { borderColor: 'var(--border-2)', background: 'var(--card)', color: 'var(--text)' },
        onchange: (e) => { state._goalMonth = Number(e.target.value); mountApp(); } },
        ...M.map((lbl, m) => el('option', { value: m, selected: m === state._goalMonth }, lbl + (m === curM ? ' (current)' : '')))) : null,
      el('button', { class: 'text-[11px] rounded px-2.5 py-1 border', style: { borderColor: 'var(--border-2)', color: 'var(--text-muted)' },
        onclick: () => { g.monthly_new = IS_SEASONAL.map(s => Math.round(g.new_amount * s)); g.monthly_renewal = IS_RENEWAL_SEASONAL.map(s => Math.round(g.renewal_amount * s)); persist(); mountApp(); } },
        '↻ Reset to default curve')),
    // Transposed (per Isaac, Sep 22): months across the top, one row per line
    // — the curve reads left-to-right as a curve. Inputs stay editable in place.
    el('div', { class: 'rounded-lg border', style: { borderColor: 'var(--border)', overflow: 'hidden' } },
      el('table', { class: 'text-xs', style: { width: '100%', tableLayout: 'fixed', borderCollapse: 'collapse' } },
        el('colgroup', {}, el('col', { style: { width: phone ? '44%' : '15.5%' } }), ...months.map(() => el('col', {})), el('col', { style: { width: phone ? '28%' : '8%' } })),
        el('thead', { class: 'text-[10px] uppercase tracking-wider text-left', style: { background: 'var(--card-2)', color: 'var(--text-muted)' } },
          el('tr', {}, el('th', { class: 'text-left px-2 py-2 font-semibold whitespace-nowrap' }, ''),
            ...months.map((m) => el('th', { class: 'text-left px-1.5 py-2 font-semibold whitespace-nowrap', style: m === curM ? { color: 'var(--accent)' } : {} }, M[m] + (m === curM ? ' ·' : ''))),
            el('th', { class: 'text-left px-2 py-2 font-semibold whitespace-nowrap', style: { borderLeft: '2px solid var(--border)' } }, 'Year'))),
        el('tbody', {},
          ...[
            [N.curveA || (lineA + ' curve %'), (m) => curveCell(g.monthly_new, m),                        '100%',                 false],
            [N.revA || lineA, (m) => cell(g.monthly_new, m),                             usd(totNew),            true],
            [N.perA || (lineA + ' /rep'), (m) => usd((g.monthly_new[m] || 0) / repsA(qOf(m))),         usd(totNew / yrA),      false],
            [N.curveB || (lineB + ' curve %'), (m) => curveCell(g.monthly_renewal, m),                  '100%',                 false],
            [N.revB || lineB, (m) => cell(g.monthly_renewal, m),                         usd(totRen),            true],
            [N.perB || (lineB + ' /rep'), (m) => usd((g.monthly_renewal[m] || 0) / repsB(qOf(m))),     usd(totRen / yrB),      false],
            [N.total || 'Total', (m) => usd((g.monthly_new[m] || 0) + (g.monthly_renewal[m] || 0)), usd(totNew + totRen), true],
          ].map(([label, cellOf, yearVal, bold], ri) => el('tr', { class: 'border-t', style: { borderColor: 'var(--border)', background: label === 'Total' ? 'var(--card-2)' : 'transparent', borderTop: label === 'Total' ? '2px solid var(--border)' : undefined } },
            el('td', { class: 'px-2 py-1.5 text-left font-semibold', style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, label),
            ...months.map((m) => el('td', { class: 'px-1.5 py-1.5 text-left tabular-nums whitespace-nowrap' + (bold && typeof cellOf(m) === 'string' ? ' font-semibold' : ''), style: Object.assign({ overflow: 'hidden' }, m === curM ? { background: 'rgba(223,100,58,.06)' } : {}) }, cellOf(m))),
            el('td', { class: 'px-2 py-1.5 text-left tabular-nums font-bold whitespace-nowrap', style: { borderLeft: '2px solid var(--border)', overflow: 'hidden' } }, yearVal))),
          // ── Quarterly rollup — each quarter cell spans its three months (3× box) ──
          el('tr', { style: { background: 'var(--card-2)', borderTop: '2px solid var(--border)' } },
            el('th', { class: 'text-left px-2 py-2 text-[10px] uppercase tracking-wider font-semibold whitespace-nowrap', style: { color: 'var(--text-muted)' } }, 'Quarterly'),
            ...quarters.map(q => el('th', { colspan: phone ? '1' : '3', class: 'text-left px-1.5 py-2 text-[10px] uppercase tracking-wider font-semibold', style: Object.assign({ color: 'var(--text-muted)' }, Math.floor(curM / 3) === q ? { color: 'var(--accent)' } : {}) }, 'Q' + (q + 1) + (Math.floor(curM / 3) === q ? ' ·' : ''))),
            el('th', { class: 'text-left px-2 py-2 text-[10px] uppercase tracking-wider font-semibold whitespace-nowrap', style: { borderLeft: '2px solid var(--border)', color: 'var(--text-muted)' } }, 'Year')),
          ...(() => {
            const qsum = (arr, q) => (arr[q * 3] || 0) + (arr[q * 3 + 1] || 0) + (arr[q * 3 + 2] || 0);
            const qn = [0, 1, 2, 3].map(q => qsum(g.monthly_new, q)), qr = [0, 1, 2, 3].map(q => qsum(g.monthly_renewal, q));
            const pctOf = (a, t) => (t > 0 ? (a / t * 100).toFixed(1) : '0.0') + '%';   // = the three months' curve % added up
            const rows = [
              [N.qPctA || (lineA + ' quarterly %'), q => pctOf(qn[q], totNew), '100%', false],
              [N.qA || (lineA + ' quarterly'), q => usd(qn[q]), usd(totNew), true],
              [N.repsA || dept.reps.a, q => repCell(g.is_reps_q, q), (Math.round(yrA * 10) / 10) + ' avg', false],
              [N.quotaA || (lineA + ' /rep quota'), q => usd(qn[q] / repsA(q)), usd(totNew / yrA), true],
              [N.qPctB || (lineB + ' quarterly %'), q => pctOf(qr[q], totRen), '100%', false],
              [N.qB || (lineB + ' quarterly'), q => usd(qr[q]), usd(totRen), true],
              [N.repsB || dept.reps.b, q => repCell(g.loyalty_reps_q, q), (Math.round(yrB * 10) / 10) + ' avg', false],
              [N.quotaB || (lineB + ' /rep quota'), q => usd(qr[q] / repsB(q)), usd(totRen / yrB), true],
              [N.qTotal || 'Total quarterly', q => usd(qn[q] + qr[q]), usd(totNew + totRen), true],
            ];
            return rows.map(([label, cellOf, yearVal, bold]) => el('tr', { class: 'border-t', style: { borderColor: 'var(--border)', background: label === 'Total quarterly' ? 'var(--card-2)' : (/\/rep/.test(label) ? 'rgba(223,100,58,.06)' : 'transparent'), borderTop: label === 'Total quarterly' ? '2px solid var(--border)' : undefined } },
              el('td', { class: 'px-2 py-1.5 text-left font-semibold', style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, label),
              ...quarters.map(q => el('td', { colspan: phone ? '1' : '3', class: 'px-1.5 py-1.5 text-left tabular-nums whitespace-nowrap' + (bold ? ' font-semibold' : ''), style: Math.floor(curM / 3) === q ? { background: 'rgba(223,100,58,.06)' } : {} }, cellOf(q))),
              el('td', { class: 'px-2 py-1.5 text-left tabular-nums font-bold whitespace-nowrap', style: { borderLeft: '2px solid var(--border)' } }, yearVal)));
          })()))));
}

// Helper card for the Goals section — shows target, YTD actual, and a mini progress bar
function goalTargetCard(label, target, actual, onInput, readOnly = false) {
  const pct = target > 0 ? Math.min(1, actual / target) : 0;
  return el('div', { class: 'card-2 rounded-xl border border- p-4' },
    el('div', { class: 'text-[10px] uppercase tracking-widest text-muted- font-semibold mb-2' }, label),
    readOnly
      ? el('div', { class: 'text-2xl font-black tabular-nums mb-1' }, fmt.usd0(target))
      : el('div', { class: 'relative mb-1' },
          el('span', { class: 'absolute left-3 top-1/2 -translate-y-1/2 text-muted- text-sm' }, '$'),
          el('input', {
            type: 'text',
            inputmode: 'numeric',
            class: 'w-full rounded-lg border pl-7 pr-3 py-2 text-sm font-bold text-left',
            value: target,
            onchange: (e) => onInput(parseFloat(e.target.value.replace(/[^0-9.]/g, '')) || 0),
          }),
        ),
    el('div', { class: 'goal-track mb-1', style: { height: '6px' } },
      el('div', { class: 'goal-fill', style: { width: (pct * 100).toFixed(1) + '%' } }),
    ),
    el('div', { class: 'flex items-center gap-2 text-[10px]' },
      el('span', { class: 'text-muted-' }, fmt.usd0(actual) + ' YTD'),
      el('span', { class: 'font-semibold', style: { color: 'var(--accent)' } }, fmt.pct(pct)),
    ),
  );
}

// (quarterlyMilestonesCard removed — unreferenced; settings audit, Sep 30)

// Sources admin — add a new lead/renewal source, hide one without losing
// the history it produced. Hidden sources drop out of the Sales Log
// dropdown but still resolve on existing sales (so old rows keep showing
// their source name). No delete on purpose — hide is the safe equivalent.
// (adminSources removed — unreferenced; settings audit, Sep 30)

// ── Sales Rep payscales (per Isaac, Sep 2026) ────────────────────────────
// Four ladders — Rookie / Veteran / Elite / Pro — each a list of tiers
// (rate % · retained revenue threshold · what it unlocks). Defaults below
// mirror the whyridd.com payscale pages; admins edit them in place and the
// result syncs through commission_config.d2dPayscales. A rep is put on a
// ladder (or given their own tiers) via profiles.pay_overrides.d2d.
const D2D_PAYSCALE_DEFAULTS = {
  deadline: 'Jan. 31, 2028',
  order: ['rookie', 'veteran', 'elite', 'pro'],
  scales: {
    rookie:  { label: 'Rookie',  requirement: 'Year 1',   tiers: [[22, 30000, ''], [24, 50000, ''], [26, 75000, ''], [28, 110000, 'Half company trip'], [30, 130000, 'Rent covered (single housing) · Company trip'], [32, 150000, 'LDRSHP Retreat'], [34, 200000, 'Ridd Raider Club'], [38, 260000, 'Rent covered (married housing)'], [40, 350000, ''], [45, 450000, ''], [50, 650000, '']] },
    veteran: { label: 'Veteran', requirement: 'Year 2',   tiers: [[30, 50000, ''], [32, 75000, ''], [34, 110000, 'Half company trip'], [36, 130000, 'Rent covered (single housing) · Company trip'], [38, 200000, 'LDRSHP Retreat'], [40, 260000, 'Rent covered (married housing)'], [42, 300000, ''], [46, 350000, 'Ridd Raider Club'], [50, 400000, ''], [55, 500000, ''], [60, 650000, '']] },
    elite:   { label: 'Elite',   requirement: '$150,000', tiers: [[40, 50000, ''], [42, 110000, 'Half company trip'], [44, 130000, 'Rent covered (single housing) · Company trip'], [46, 200000, 'LDRSHP Retreat'], [48, 260000, 'Rent covered (married housing)'], [50, 300000, ''], [54, 400000, 'Ridd Raider Club'], [58, 500000, ''], [60, 650000, ''], [62, 800000, ''], [65, 1000000, '']] },
    pro:     { label: 'Pro',     requirement: '$300,000', tiers: [[45, 50000, ''], [47, 110000, 'Half company trip'], [49, 130000, 'Rent covered (single housing) · Company trip'], [51, 200000, 'LDRSHP Retreat'], [53, 260000, 'Rent covered (married housing)'], [55, 300000, ''], [57, 400000, 'Ridd Raider Club'], [59, 500000, ''], [62, 650000, ''], [64, 800000, ''], [68, 1000000, '']] },
  },
};
function d2dPayscales() {
  const c = commissionConfig();
  if (c.d2dPayscales && c.d2dPayscales.scales) return c.d2dPayscales;
  return JSON.parse(JSON.stringify(D2D_PAYSCALE_DEFAULTS));
}
function saveD2dPayscales(ps) { const c = commissionConfig(); c.d2dPayscales = ps; saveCommissionConfig(c); }
// The ladder a rep is actually on: their own tiers if they have them, else
// the scale they're assigned to, else nothing (admin hasn't placed them).
function d2dLadderFor(profile) {
  const ps = d2dPayscales();
  const o = (profile && profile.pay_overrides && profile.pay_overrides.d2d) || null;
  const scaleId = (o && o.scale) || null;
  const base = scaleId && ps.scales[scaleId] ? ps.scales[scaleId] : null;
  if (!base) return null;
  return { scale: scaleId, label: base.label, requirement: base.requirement, custom: !!(o && Array.isArray(o.tiers) && o.tiers.length), tiers: (o && Array.isArray(o.tiers) && o.tiers.length) ? o.tiers : base.tiers };
}
function adminD2dPayscales() {
  const ps = d2dPayscales();
  const money = (n) => '$' + Math.round(Number(n) || 0).toLocaleString();
  const num = (v) => { const n = parseFloat(String(v).replace(/[^0-9.\-]/g, '')); return Number.isFinite(n) ? n : 0; };
  const reps = (state.allProfiles || []).filter(p => p && p.is_active !== false && ['rep_sales', 'rep_partner', 'rep_team_lead'].includes(String(p.role || '')))
    .sort((a, b) => String(a.full_name || '').localeCompare(String(b.full_name || '')));
  const repId = state._d2dPayRep || '';
  const rep = repId ? (state.allProfiles || []).find(p => p.id === repId) : null;
  const placed = (state.allProfiles || []).filter(p => p && p.pay_overrides && p.pay_overrides.d2d && p.pay_overrides.d2d.scale);
  if (!ps.order.includes(state._d2dScaleTab)) state._d2dScaleTab = ps.order[0];
  const saveRep = async (d2d) => {
    if (!rep) return;
    const po = Object.assign({}, rep.pay_overrides || {});
    if (d2d && (d2d.scale || (d2d.tiers && d2d.tiers.length))) po.d2d = d2d; else delete po.d2d;
    rep.pay_overrides = Object.keys(po).length ? po : null;
    if (typeof DEMO !== 'undefined' && DEMO) { saveDemoData(); return; }
    const { error } = await supabase.from('profiles').update({ pay_overrides: rep.pay_overrides }).eq('id', rep.id);
    if (error) toast(/pay_overrides/i.test(error.message || '') ? 'Run migrations/20260917_pay_overrides.sql first' : 'Could not save: ' + error.message, 'error');
    else { try { logActivity('pay_override', { detail: rep.full_name + ' payscale: ' + JSON.stringify(d2d || null) }); } catch (e) { /* optional */ } }
  };
  // ── ladder table (shared by the defaults view and the rep view) ──
  const cell = (val, onCommit, o = {}) => el('input', { type: 'text', inputmode: o.text ? 'text' : 'decimal', value: val == null ? '' : String(val), placeholder: o.placeholder || '',
    class: 'rounded-lg border px-2 py-1 text-xs w-full ' + (o.text ? '' : 'text-left tabular-nums font-semibold'),
    style: { borderColor: 'transparent', background: 'transparent', color: o.muted ? 'var(--text-muted)' : 'var(--text)' },
    onfocus: (e) => { e.target.style.borderColor = 'var(--accent)'; e.target.style.background = 'var(--card)'; },
    onblur: (e) => { e.target.style.borderColor = 'transparent'; e.target.style.background = 'transparent'; onCommit(e.target.value); },
    onkeydown: (e) => { if (e.key === 'Enter') e.target.blur(); } });
  const ladderTable = (tiers, onChange, opts = {}) => {
    const body = el('tbody');
    const draw = () => body.replaceChildren(...tiers.map((t, i) => el('tr', { class: 'border-t', style: { borderColor: 'var(--border)' } },
      el('td', { class: 'px-3 py-1', style: { width: '90px' } }, cell((Number(t[0]) || 0) + '%', (v) => { t[0] = num(v); onChange(); draw(); })),
      el('td', { class: 'px-3 py-1', style: { width: '150px' } }, cell(money(t[1]), (v) => { t[1] = num(v); onChange(); draw(); })),
      el('td', { class: 'px-3 py-1' }, cell(t[2] || '', (v) => { t[2] = v.trim(); onChange(); }, { text: true, placeholder: '—', muted: true })),
      el('td', { class: 'px-3 py-1 text-left tabular-nums font-bold text-[13px]', style: { width: '140px' } }, money(t[0] / 100 * t[1])),
      el('td', { class: 'px-1 py-1 text-right', style: { width: '32px' } }, opts.readonly ? null : el('button', { class: 'text-xs px-1.5', style: { color: 'var(--text-subtle)' }, title: 'Remove tier', onclick: () => { tiers.splice(i, 1); onChange(); draw(); } }, '×')))));
    draw();
    return el('div', { class: 'card overflow-hidden' },
      el('table', { class: 'w-full' },
        el('thead', {}, el('tr', { class: 'text-[10px] uppercase tracking-widest font-semibold', style: { color: 'var(--text-subtle)', background: 'var(--card-2)' } },
          el('th', { class: 'px-3 py-2 text-left' }, 'Rate %'), el('th', { class: 'px-3 py-2 text-left' }, 'Retained revenue'), el('th', { class: 'px-3 py-2 text-left' }, 'Unlocks'), el('th', { class: 'px-3 py-2 text-left' }, 'Est. earnings'), el('th', {}))),
        body),
      opts.readonly ? null : el('div', { class: 'px-3 py-2 border-t flex items-center gap-2', style: { borderColor: 'var(--border)' } },
        el('button', { class: 'rounded-lg border px-2.5 py-1 text-[11px] font-semibold', style: { borderColor: 'var(--border-2)' }, onclick: () => { const last = tiers[tiers.length - 1] || [20, 25000, '']; tiers.push([last[0] + 2, Math.round(last[1] * 1.25 / 1000) * 1000, '']); onChange(); draw(); } }, '+ Add tier'),
        el('span', { class: 'text-[10px]', style: { color: 'var(--text-subtle)' } }, 'Rate applies to retained revenue at or above the threshold. Est. earnings = rate × threshold.')));
  };
  // ── rep picker ──
  const picker = el('div', { class: 'card p-3 flex items-center gap-3 flex-wrap' },
    el('span', { class: 'text-[10px] uppercase tracking-widest font-semibold', style: { color: 'var(--text-subtle)' } }, 'Individual reps'),
    el('select', { class: 'rounded-lg border px-2.5 py-1 text-[11px] font-semibold cursor-pointer', style: { borderColor: 'var(--border-2)', background: 'var(--card)', color: 'var(--text)', minWidth: '240px' },
      onchange: (e) => { state._d2dPayRep = e.target.value; mountApp(); } },
      el('option', { value: '', selected: !repId }, 'Default ladders — pick a rep to place them…'),
      ...reps.map(p => { const L = d2dLadderFor(p); return el('option', { value: p.id, selected: p.id === repId }, p.full_name + (L ? ' · ' + L.label + (L.custom ? ' (custom)' : '') : ' · not placed')); })),
    el('span', { class: 'text-[10px] ml-auto', style: { color: 'var(--text-subtle)' } }, placed.length + ' of ' + reps.length + ' sales reps placed on a ladder'));
  if (rep) {
    const L = d2dLadderFor(rep);
    const o = Object.assign({}, (rep.pay_overrides && rep.pay_overrides.d2d) || {});
    const scaleSel = el('select', { class: 'rounded-lg border px-2.5 py-1 text-[11px] font-semibold cursor-pointer', style: { borderColor: 'var(--border-2)', background: 'var(--card)', color: 'var(--text)' },
      onchange: (e) => { const v = e.target.value; saveRep(v ? { scale: v } : null).then(mountApp); } },
      el('option', { value: '', selected: !L }, '— not placed —'),
      ...ps.order.map(id => el('option', { value: id, selected: L && L.scale === id }, ps.scales[id].label)));
    const head = el('div', { class: 'card p-3 flex items-center gap-3 flex-wrap' },
      el('div', {}, el('div', { class: 'text-sm font-bold' }, rep.full_name), el('div', { class: 'text-[10px]', style: { color: 'var(--text-subtle)' } }, (typeof ROLE_LABEL !== 'undefined' && ROLE_LABEL[rep.role]) || rep.role)),
      el('label', { class: 'flex items-center gap-2 text-[11px] font-semibold' }, 'Payscale', scaleSel),
      L && L.custom ? el('span', { class: 'rounded-full px-2 py-0.5 text-[10px] font-bold', style: { background: 'rgba(223,100,58,.12)', color: 'var(--accent)' } }, 'custom ladder') : null,
      L && L.custom ? el('button', { class: 'rounded-lg border px-2.5 py-1 text-[11px] font-semibold', style: { borderColor: 'var(--border-2)' }, onclick: () => { if (confirm('Drop ' + rep.full_name + '’s custom tiers and put them back on the standard ' + L.label + ' ladder?')) saveRep({ scale: L.scale }).then(mountApp); } }, 'Reset to ' + L.label) : null,
      L && !L.custom ? el('span', { class: 'text-[10px] ml-auto', style: { color: 'var(--text-subtle)' } }, 'On the standard ' + L.label + ' ladder — edit any cell below to give them their own.') : null);
    if (!L) return el('div', { class: 'flex flex-col gap-3' }, picker, head, el('div', { class: 'card p-6 text-center text-xs', style: { color: 'var(--text-muted)' } }, 'Pick a payscale above to place ' + rep.full_name + '.'));
    // Editing a cell forks the standard ladder into the rep's own tiers.
    const mine = L.custom ? o.tiers : JSON.parse(JSON.stringify(L.tiers));
    const table = ladderTable(mine, () => { saveRep({ scale: L.scale, tiers: mine }); });
    return el('div', { class: 'flex flex-col gap-3' }, picker, head, table);
  }
  // ── defaults: one tab per scale ──
  const cur = ps.scales[state._d2dScaleTab];
  const tabs = el('div', { class: 'flex items-center gap-1 flex-wrap' },
    ...ps.order.map(id => el('button', { class: 'rounded-full px-3 py-1 text-[11px] font-bold border transition', style: id === state._d2dScaleTab ? { background: 'var(--accent)', color: 'var(--accent-text)', borderColor: 'var(--accent)' } : { borderColor: 'var(--border-2)', color: 'var(--text-muted)' }, onclick: () => { state._d2dScaleTab = id; mountApp(); } }, ps.scales[id].label)));
  const meta = el('div', { class: 'card p-3 flex items-center gap-4 flex-wrap' },
    tabs,
    el('span', { class: 'text-[10px] ml-auto', style: { color: 'var(--text-subtle)' } }, placed.filter(p => p.pay_overrides.d2d.scale === state._d2dScaleTab).length + ' reps on ' + cur.label));
  const table = ladderTable(cur.tiers, () => saveD2dPayscales(ps));
  return el('div', { class: 'flex flex-col gap-3 max-w-4xl w-full' }, picker, meta, table);
}

// Admin → Commissions: the rule set behind the Commission Calculator, set per
// REP TYPE (Office Staff / Sales Reps / Technicians). A specific rep's rates can
// still be overridden on the calculator; this is the default for everyone of a
// type. The service→category map is global (one taxonomy for all).
function adminCommissions() {
  if (!isAdminRole(state.profile?.role)) return emptyCard('Admins only.');
  const pct = (n) => (Math.round((n || 0) * 100) / 100).toFixed(2) + '%';
  const money = (n) => '$' + Math.round(n || 0).toLocaleString();
  if (!COMMISSION_REP_TYPES.includes(state._commRulesTab)) state._commRulesTab = 'Sales Rep';
  const type = state._commRulesTab;
  const cfg = commissionConfig();
  const rules = commissionRulesForType(type);

  const saveTypeRule = (patch) => { const c = commissionConfig(); c.typeRules = Object.assign({}, c.typeRules); c.typeRules[type] = Object.assign({}, c.typeRules[type], patch); saveCommissionConfig(c); mountApp(); };
  const saveTypeMY = (patch) => { const c = commissionConfig(); c.typeRules = Object.assign({}, c.typeRules); const cur = Object.assign({}, c.typeRules[type]); cur.multiYear = Object.assign({}, COMMISSION_MY_DEFAULT, c.multiYear, cur.multiYear, patch); c.typeRules[type] = cur; saveCommissionConfig(c); mountApp(); };
  const saveCat = (svc, val) => { const c = commissionConfig(); c.serviceCategories = Object.assign({}, c.serviceCategories); c.serviceCategories[svc] = val; saveCommissionConfig(c); mountApp(); };

  const lbl = (t) => el('span', { class: 'text-[10px] uppercase tracking-widest text-muted- font-semibold block mb-1' }, t);
  const numField = (label, val, onCommit, opts = {}) => el('label', { class: 'block' }, lbl(label),
    el('input', { type: 'number', step: opts.step || '0.01', value: (val == null ? '' : val),
      class: 'w-full rounded-lg border px-2.5 py-1 text-[11px] text-left tabular-nums', style: { borderColor: 'var(--border-2)' },
      onchange: (e) => onCommit(e.target.value) }));

  const tabs = el('div', { class: 'flex items-center gap-1 border-b flex-wrap', style: { borderColor: 'var(--border)' } },
    ...COMMISSION_REP_TYPES.map(t => {
      const on = type === t;
      return el('button', { class: 'px-2.5 py-1 text-[11px] font-semibold transition whitespace-nowrap',
        style: { borderBottom: on ? '2px solid var(--accent)' : '2px solid transparent', color: on ? 'var(--text)' : 'var(--text-muted)', marginBottom: '-1px', minHeight: '40px' },
        onclick: () => { state._commRulesTab = t; mountApp(); } }, t === 'Sales Rep' ? 'Sales Reps' : t === 'Technician' ? 'Technicians' : t);
    }));

  const ratesPanel = el('div', { class: 'card p-4' },
    el('div', { class: 'text-sm font-bold mb-1' }, 'Commission rates · ' + type),
    el('div', { class: 'text-[11px] text-muted- mb-3' }, 'Default for every ' + type + '. Pest % is the base; Ancillary and Bundle are multiples of it. Company default: 20% · 0.5× · 0.8×.'),
    el('div', { class: 'grid grid-cols-3 gap-3' },
      numField('Pest Commission %', rules.pest * 100, v => saveTypeRule({ pest: (parseFloat(v) || 0) / 100 }), { step: '0.5' }),
      numField('Ancillary Multiplier', rules.ancMult, v => saveTypeRule({ ancMult: parseFloat(v) || 0 }), { step: '0.1' }),
      numField('Bundle Multiplier', rules.bundleMult, v => saveTypeRule({ bundleMult: parseFloat(v) || 0 }), { step: '0.1' })),
    el('div', { class: 'text-[11px] text-muted- mt-2' }, '→ Ancillary ' + pct(rules.pest * rules.ancMult * 100) + ' · Bundle ' + pct(rules.pest * rules.bundleMult * 100)));

  const my = rules.multiYear;
  const myPanel = el('div', { class: 'card p-4' },
    el('div', { class: 'text-sm font-bold mb-1' }, 'Multi-year bonus · ' + type),
    el('div', { class: 'text-[11px] text-muted- mb-3' }, 'Above the high threshold: +18mo% on 18-month revenue and +24mo% on 24-month. Below the low threshold: a penalty on all revenue.'),
    el('div', { class: 'grid grid-cols-2 sm:grid-cols-5 gap-3' },
      numField('High % >', my.hiPct, v => saveTypeMY({ hiPct: parseFloat(v) || 0 }), { step: '1' }),
      numField('Low % ≥', my.loPct, v => saveTypeMY({ loPct: parseFloat(v) || 0 }), { step: '1' }),
      numField('18mo +%', my.rate18, v => saveTypeMY({ rate18: parseFloat(v) || 0 }), { step: '0.5' }),
      numField('24mo +%', my.rate24, v => saveTypeMY({ rate24: parseFloat(v) || 0 }), { step: '0.5' }),
      numField('Penalty %', my.penalty, v => saveTypeMY({ penalty: parseFloat(v) || 0 }), { step: '0.5' })));

  // Global service → category map (one taxonomy for everyone).
  const svcAgg = new Map();
  for (const r of (state.reportingSubscriptions || [])) { const s = r.subscription || '(blank)'; svcAgg.set(s, (svcAgg.get(s) || 0) + (Number(r.subscription_contract_value) || 0)); }
  const svcList = [...svcAgg.entries()].sort((a, b) => (cfg.serviceCategories[a[0]] ? 1 : 0) - (cfg.serviceCategories[b[0]] ? 1 : 0) || b[1] - a[1]);
  const catSelect = (svc) => { const cur = cfg.serviceCategories[svc] || ''; return el('select', { class: 'rounded-lg border px-2.5 py-1 text-[11px]', style: { borderColor: 'var(--border-2)' }, onchange: (e) => saveCat(svc, e.target.value) },
    ...[['', 'Unclassified'], ['pest', 'Pest'], ['bundle', 'Bundle'], ['ancillary', 'Ancillary'], ['exclude', 'Exclude']].map(([v, t]) => el('option', { value: v, selected: cur === v }, t))); };
  const svcPanel = el('div', { class: 'card p-4' },
    el('div', { class: 'text-sm font-bold mb-1' }, 'Service → category map (global)'),
    el('div', { class: 'text-[11px] text-muted- mb-3' }, 'Tag each service so its revenue lands in Pest, Bundle, or Ancillary. Applies to every rep type.'),
    svcList.length === 0
      ? el('div', { class: 'rounded-lg border border-dashed p-6 text-center text-xs text-muted-', style: { borderColor: 'var(--border-2)' } }, 'No services loaded yet — open the Reporting tab once so the snapshot loads, then come back.')
      : el('div', { class: 'flex flex-col divide-y', style: { borderColor: 'var(--border)' } },
          ...svcList.slice(0, 80).map(([svc, rev]) => el('div', { class: 'flex items-center gap-4 gap-3 py-2' },
            el('div', { class: 'min-w-0' }, el('div', { class: 'text-sm font-medium truncate' }, svc), el('div', { class: 'text-[11px] text-muted-' }, money(rev))),
            catSelect(svc)))));

  // Office Staff = Inside Sales reps, who log accounts in-app and are paid on
  // the Inside Sales Pay-Tab model (upfront % by contract type, below-min,
  // PIF/commercial overrides, flat renewal $, quarter-end backend + close-rate
  // bonus). That's a different animal from the CRM pest/bundle model the D2D
  // Sales Reps and Technicians use, so this tab renders the pay-settings editor.
  const isOfficeStaff = (type === 'Office Staff');
  const isTechnician  = (type === 'Technician');
  const body = isOfficeStaff
    ? adminPricingSimple()
    : isTechnician
      ? el('div', { class: 'card p-10 text-center' },
          el('div', { class: 'text-sm font-semibold mb-1' }, 'No Technician commission rules yet'),
          el('div', { class: 'text-xs text-muted-' }, 'Rules for Technicians haven’t been set up. They’ll be added here later.'))
      : el('div', { class: 'flex flex-col gap-4' }, adminD2dPayscales(), (() => {
          // Backend pay-stub rules (settings audit, Sep 30): the D2D Pay tab's
          // stub reads these (rates, multi-year, attrition, service categories)
          // but their editors were never shown — values were frozen.
          const open = !!state._commAdvOpen;
          const attr = el('div', { class: 'card p-4' },
            el('div', { class: 'text-sm font-bold mb-1' }, 'Estimated attrition'),
            el('div', { class: 'text-[11px] text-muted- mb-3' }, 'Held back from Total Commission on the D2D pay stub until the Jan 31 lock; after it, the actual canceled accounts replace the estimate. A rep can be set differently on their stub.'),
            el('div', { class: 'grid grid-cols-2 sm:grid-cols-4 gap-3' }, numField('Attrition %', cfg.attritionPct, v => { const c = commissionConfig(); c.attritionPct = Math.max(0, parseFloat(v) || 0); saveCommissionConfig(c); mountApp(); }, { step: '0.5' })));
          return el('div', { class: 'flex flex-col gap-3' },
            el('button', { class: 'text-left text-[11px] font-bold uppercase tracking-widest', style: { color: 'var(--text-subtle)', minHeight: '40px' }, onclick: () => { state._commAdvOpen = !open; mountApp(); } }, (open ? '▾ ' : '▸ ') + 'Advanced · backend pay stub (rates, multi-year, attrition, service categories)'),
            ...(open ? [ratesPanel, myPanel, attr, svcPanel] : []));
        })());   // Sales Reps: the four payscale ladders + per-rep assignment (per Isaac)

  return el('div', { class: 'flex flex-col gap-4' },
    el('div', {},
      el('h2', { class: 'text-lg font-bold' }, 'Commissions & payroll'),
      el('p', { class: 'text-xs text-muted-' }, isOfficeStaff
        ? 'Inside Sales pay rules for Office Staff — these drive the Pay tab. Pay automation (when sales are created, approved and locked) is below.'
        : type === 'Sales Rep'
          ? 'Sales Rep payscales \u2014 the Rookie / Veteran / Elite / Pro ladders (rate by retained revenue). Pick a rep to put them on a ladder or give them their own. Backend pay-stub rules are under Advanced.'
          : 'Commission rules by rep type. The Commission Calculator uses these; a specific rep can still be overridden there.')),
    tabs,
    body);
}

// ── Office Staff commissions — ONE plain metrics table (per Isaac): every
// rule the pay engine reads, as a label + value, edited in place. Modifiers
// are shown RELATIVE to the base Upfront % (commercial −3.5, OTS −2, upsell
// +3) exactly like the comp sheet, and written back to the absolute rates
// the engine stores. The old sectioned editor (adminPricing) is kept for
// reference but no longer rendered.
function adminPricingSimple() {
  const s = ensurePaySettings();
  const validCtIds = new Set(state.contractTypes.map(ct => ct.id));
  if (!s.contract_commissions) s.contract_commissions = state.contractTypes.map(ct => ({ contract_type_id: ct.id, name: ct.name, rate: 7.0 }));
  else s.contract_commissions = s.contract_commissions.filter(cc => validCtIds.has(cc.contract_type_id));
  s.below_min_multiplier = s.below_min_multiplier ?? 50;
  s.commercial_multiplier = s.commercial_multiplier ?? 50;
  if (!Array.isArray(s.close_rate_tiers) || !s.close_rate_tiers.length) s.close_rate_tiers = [{ min_close_rate: 60, rate: 3.0 }, { min_close_rate: 50, rate: 2.0 }];
  if (s.close_rate_tiers.length < 2) s.close_rate_tiers.push({ min_close_rate: 50, rate: 2.0 });
  const persist = () => { saveDemoData(); saveAppSettings(); };
  const isStd = (cc) => /month/i.test(cc.name) && !/upsell|one\s*time/i.test(cc.name);
  const num = (v) => { const n = parseFloat(String(v).replace(/[^0-9.\-]/g, '')); return Number.isFinite(n) ? n : 0; };
  const r2 = (n) => Math.round(n * 100) / 100;

  // ── Per-rep overrides (per Isaac): pick a rep, edit THEIR column; blank
  // = inherits the default live. Stored on profiles.pay_overrides, read by
  // effectivePaySettings() everywhere pay is computed.
  const reps = (state.allProfiles || []).filter(p => p && p.is_active !== false && (typeof isOfficeStaffProfile === 'function' ? isOfficeStaffProfile(p) : /office|loyalty/.test(String(p.role || ''))))
    .sort((a, b) => String(a.full_name || '').localeCompare(String(b.full_name || '')));
  const withOverrides = (state.allProfiles || []).filter(p => p && p.pay_overrides && typeof p.pay_overrides === 'object' && Object.keys(p.pay_overrides).length);
  const repId = state._payOverrideRep || '';
  const rep = repId ? (state.allProfiles || []).find(p => p.id === repId) : null;
  const ov = rep ? ((rep.pay_overrides && typeof rep.pay_overrides === 'object') ? rep.pay_overrides : {}) : null;
  const saveOverrides = async (next) => {
    if (!rep) return;
    const clean = {};
    for (const [k, v] of Object.entries(next || {})) { if (v == null) continue; if (typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length) continue; clean[k] = v; }
    rep.pay_overrides = Object.keys(clean).length ? clean : null;
    // Upfront % override also lands on the legacy per-profile rate so the
    // commercial path (half of the rep's OWN upfront) follows it.
    if (clean.upfront_pct != null) rep.upfront_commission_rate = Number(clean.upfront_pct) / 100;
    if (typeof DEMO !== 'undefined' && DEMO) { saveDemoData(); return; }
    const patch = { pay_overrides: rep.pay_overrides };
    if (clean.upfront_pct != null) patch.upfront_commission_rate = rep.upfront_commission_rate;
    const { error } = await supabase.from('profiles').update(patch).eq('id', rep.id);
    if (error) toast(/pay_overrides/i.test(error.message || '') ? 'Run migrations/20260917_pay_overrides.sql first' : 'Could not save: ' + error.message, 'error');
    else { try { logActivity('pay_override', { detail: rep.full_name + ': ' + JSON.stringify(clean) }); } catch (e) { /* optional */ } }
  };
  // Effective (default + rep) view, so the rep column shows what they actually get.
  const eff = () => (rep && typeof effectivePaySettings === 'function') ? effectivePaySettings(rep.id) : s;
  const stdOf = (S) => { const c = (S.contract_commissions || []).find(isStd); return c ? Number(c.rate) : 7; };
  const ccOf = (S, re) => { const c = (S.contract_commissions || []).find(cc => re.test(cc.name)); return c ? Number(c.rate) : null; };

  // Row spec: label · unit · hint · default get/set (writes appSettings) ·
  // override key + get/set on the override object (relative values are
  // converted to the absolute rate the engine stores).
  const rows = [
    ['section', 'Metrics'],
    { label: 'Upfront %', unit: '%', hint: 'Base upfront commission on 12 / 18 / 24-month contracts.',
      get: () => stdOf(s), set: (v) => { for (const cc of s.contract_commissions) if (isStd(cc)) cc.rate = v; },
      oget: () => ov.upfront_pct, oset: (v) => { ov.upfront_pct = v; }, oeff: () => stdOf(eff()) },
    { label: 'Close Rate %', unit: '%', hint: 'Close rate needed for the full close-rate bonus.',
      get: () => s.close_rate_tiers[0].min_close_rate, set: (v) => { s.close_rate_tiers[0].min_close_rate = v; },
      oget: () => ov.close_min, oset: (v) => { ov.close_min = v; }, oeff: () => eff().close_rate_tiers[0].min_close_rate },
    { label: 'Passed Audit Pay %', unit: '%', hint: 'Share of the upfront commission paid at the top Passed Audit % tier.',
      get: () => (s.upfront_tiers[0] || {}).pay, set: (v) => { if (s.upfront_tiers[0]) s.upfront_tiers[0].pay = v; },
      oget: () => (ov.upfront_tiers || [])[0] && ov.upfront_tiers[0].pay, oset: (v) => { ov.upfront_tiers = (ov.upfront_tiers || s.upfront_tiers.map(t => ({ ...t }))); ov.upfront_tiers[0].pay = v; }, oeff: () => (eff().upfront_tiers[0] || {}).pay },
    { label: 'Passed Audit Tier', unit: '%+', hint: '% of commissionable accounts flagged Passed Audit to reach the top tier.',
      get: () => (s.upfront_tiers[0] || {}).min, set: (v) => { if (s.upfront_tiers[0]) s.upfront_tiers[0].min = v; },
      oget: () => (ov.upfront_tiers || [])[0] && ov.upfront_tiers[0].min, oset: (v) => { ov.upfront_tiers = (ov.upfront_tiers || s.upfront_tiers.map(t => ({ ...t }))); ov.upfront_tiers[0].min = v; }, oeff: () => (eff().upfront_tiers[0] || {}).min },
    ...((s.upfront_tiers || []).slice(1).map((t, i) => ({ label: 'Passed Audit Tier ' + (i + 2) + ' (≥ ' + t.min + '%)', unit: '%', hint: 'Pays this % of the upfront commission at ≥ ' + t.min + '% passed audit.',
      get: () => t.pay, set: (v) => { t.pay = v; },
      oget: () => (ov.upfront_tiers || [])[i + 1] && ov.upfront_tiers[i + 1].pay, oset: (v) => { ov.upfront_tiers = (ov.upfront_tiers || s.upfront_tiers.map(x => ({ ...x }))); if (ov.upfront_tiers[i + 1]) ov.upfront_tiers[i + 1].pay = v; }, oeff: () => ((eff().upfront_tiers || [])[i + 1] || {}).pay }))),
    ['section', 'Modifiers'],
    { label: 'PIF Modifier', unit: 'pts', hint: 'Added to the base rate when the customer pays in full (7 + 5 = 12%).',
      get: () => s.pif_modifier ?? 5, set: (v) => { s.pif_modifier = v; }, oget: () => ov.pif_modifier, oset: (v) => { ov.pif_modifier = v; }, oeff: () => eff().pif_modifier ?? 5 },
    { label: 'Commercial Modifier', unit: 'pts', hint: 'Relative to Upfront %. −3.5 means commercial pays 3.5% on a 7% base (half).',
      get: () => r2(stdOf(s) * ((s.commercial_multiplier ?? 50) / 100) - stdOf(s)), set: (v) => { const b = stdOf(s) || 7; s.commercial_multiplier = r2(((b + v) / b) * 100); },
      oget: () => ov.commercial_multiplier == null ? undefined : r2(stdOf(eff()) * (ov.commercial_multiplier / 100) - stdOf(eff())), oset: (v) => { const b = stdOf(eff()) || 7; ov.commercial_multiplier = r2(((b + v) / b) * 100); }, oeff: () => r2(stdOf(eff()) * ((eff().commercial_multiplier ?? 50) / 100) - stdOf(eff())) },
    { label: 'OTS Modifier', unit: 'pts', hint: 'Relative to Upfront %. One-time services: −2 = 5%.',
      get: () => r2((ccOf(s, /one\s*time/i) ?? 5) - stdOf(s)), set: (v) => { for (const cc of s.contract_commissions) if (/one\s*time/i.test(cc.name)) cc.rate = r2(stdOf(s) + v); },
      oget: () => ov.ots_rate == null ? undefined : r2(ov.ots_rate - stdOf(eff())), oset: (v) => { ov.ots_rate = r2(stdOf(eff()) + v); }, oeff: () => r2((ccOf(eff(), /one\s*time/i) ?? 5) - stdOf(eff())) },
    { label: 'Upsell Modifier', unit: 'pts', hint: 'Relative to Upfront %. Upsells: +3 = 10%.',
      get: () => r2((ccOf(s, /upsell/i) ?? 10) - stdOf(s)), set: (v) => { for (const cc of s.contract_commissions) if (/upsell/i.test(cc.name)) cc.rate = r2(stdOf(s) + v); },
      oget: () => ov.upsell_rate == null ? undefined : r2(ov.upsell_rate - stdOf(eff())), oset: (v) => { ov.upsell_rate = r2(stdOf(eff()) + v); }, oeff: () => r2((ccOf(eff(), /upsell/i) ?? 10) - stdOf(eff())) },
    { label: 'Below Min Pay Modifier', unit: '%', hint: 'Below-minimum accounts pay this % of the normal commission.',
      get: () => s.below_min_multiplier, set: (v) => { s.below_min_multiplier = v; }, oget: () => ov.below_min_multiplier, oset: (v) => { ov.below_min_multiplier = v; }, oeff: () => eff().below_min_multiplier },
    { label: 'Close Rate Bonus %', unit: '%', hint: 'Bonus on subscription revenue at the full close rate.',
      get: () => s.close_rate_tiers[0].rate, set: (v) => { s.close_rate_tiers[0].rate = v; }, oget: () => ov.close_rate, oset: (v) => { ov.close_rate = v; }, oeff: () => eff().close_rate_tiers[0].rate },
    { label: 'Close Rate Tier 2 (≥ ' + s.close_rate_tiers[1].min_close_rate + '%)', unit: '%', hint: 'Bonus at the second close-rate tier.',
      get: () => s.close_rate_tiers[1].rate, set: (v) => { s.close_rate_tiers[1].rate = v; }, oget: () => ov.close2_rate, oset: (v) => { ov.close2_rate = v; }, oeff: () => (eff().close_rate_tiers[1] || {}).rate },
    { label: '18 Mo Backend Bonus %', unit: '%', hint: 'Quarter-end backend on 18-month revenue.',
      get: () => s.multi_year_rate_18, set: (v) => { s.multi_year_rate_18 = v; }, oget: () => ov.multi_year_rate_18, oset: (v) => { ov.multi_year_rate_18 = v; }, oeff: () => eff().multi_year_rate_18 },
    { label: '24 Mo Backend Bonus %', unit: '%', hint: 'Quarter-end backend on 24-month revenue.',
      get: () => s.multi_year_rate_24, set: (v) => { s.multi_year_rate_24 = v; }, oget: () => ov.multi_year_rate_24, oset: (v) => { ov.multi_year_rate_24 = v; }, oeff: () => eff().multi_year_rate_24 },
    { label: 'Renewal Backend Bonus', unit: '%', hint: 'Quarter-end backend on renewal revenue.',
      get: () => s.renewal_backend_rate, set: (v) => { s.renewal_backend_rate = v; }, oget: () => ov.renewal_backend_rate, oset: (v) => { ov.renewal_backend_rate = v; }, oeff: () => eff().renewal_backend_rate },
    ...([['m12', 'Upfront 12-Mo Pay', '12-month'], ['m18', 'Upfront 18-Mo Pay', '18-month'], ['m24', 'Upfront 24-Mo Pay', '24-month'], ['pif', 'Upfront PIF Pay', 'paid in full']].map(([k, label, what]) => ({ label, unit: '$', hint: 'Flat pay per serviced renewal-source account, ' + what + '.',
      get: () => s.renewal_flat[k], set: (v) => { s.renewal_flat[k] = v; },
      oget: () => (ov.renewal_flat || {})[k], oset: (v) => { ov.renewal_flat = ov.renewal_flat || {}; ov.renewal_flat[k] = v; }, oeff: () => (eff().renewal_flat || {})[k] }))),
  ];
  const fmt = (v, unit) => v == null || v === '' ? '' : unit === '$' ? '$' + Number(v).toFixed(2) : (unit === 'pts' ? (v > 0 ? '+' : '') + Number(v).toFixed(2) + '%' : Number(v).toFixed(2) + (unit === '%+' ? '% +' : '%'));
  const cellInput = (get, set, unit, hint, placeholder) => el('input', { type: 'text', inputmode: 'decimal', value: fmt(get(), unit), placeholder: placeholder || '', title: hint,
    class: 'text-right tabular-nums font-semibold rounded-lg border px-2 py-1 text-xs w-full',
    style: { borderColor: 'transparent', background: 'transparent', color: 'var(--text)', maxWidth: '120px' },
    onfocus: (e) => { e.target.style.borderColor = 'var(--accent)'; e.target.style.background = 'var(--card)'; const v = get(); e.target.value = v == null ? '' : String(v); e.target.select(); },
    onblur: (e) => { set(e.target.value.trim() === '' ? null : num(e.target.value)); e.target.style.borderColor = 'transparent'; e.target.style.background = 'transparent'; },
    onkeydown: (e) => { if (e.key === 'Enter') e.target.blur(); if (e.key === 'Escape') { e.target.value = fmt(get(), unit); e.target.blur(); } },
  });
  const body = el('tbody');
  const draw = () => {
    body.replaceChildren(...rows.map(r => {
      if (Array.isArray(r)) return el('tr', {}, el('td', { colspan: rep ? '3' : '2', class: 'px-3 py-1.5 text-[10px] uppercase tracking-widest font-bold', style: { background: 'var(--card-2)', color: 'var(--text-muted)', borderTop: '1px solid var(--border)' } }, r[1]));
      const defIn = cellInput(r.get, (v) => { if (v != null) { r.set(v); persist(); } draw(); }, r.unit, r.hint);
      const cells = [
        el('td', { class: 'px-3 py-1.5 text-xs font-semibold uppercase whitespace-nowrap', title: r.hint }, r.label),
        el('td', { class: 'px-3 py-1 text-right', style: { width: '140px' } }, defIn),
      ];
      if (rep) {
        const has = r.oget() != null;
        const ovIn = cellInput(r.oget, (v) => {
          if (v == null) { r.oset(undefined); for (const k of Object.keys(ov)) if (ov[k] === undefined) delete ov[k]; }
          else r.oset(v);
          saveOverrides(ov).then(draw);
        }, r.unit, r.hint, fmt(r.oeff(), r.unit));
        if (has) { ovIn.style.color = 'var(--accent)'; ovIn.style.background = 'rgba(223,100,58,.08)'; }
        cells.push(el('td', { class: 'px-3 py-1 text-right', style: { width: '150px' } },
          el('div', { class: 'flex items-center justify-end gap-1' },
            ovIn,
            has ? el('button', { class: 'text-[10px] px-1.5 rounded', style: { color: 'var(--text-muted)' }, title: 'Back to default', onclick: () => { r.oset(undefined); for (const k of Object.keys(ov)) if (ov[k] === undefined) delete ov[k]; if (ov.renewal_flat && !Object.keys(ov.renewal_flat).length) delete ov.renewal_flat; saveOverrides(ov).then(draw); } }, '×') : null)));
      }
      return el('tr', { class: 'border-t', style: { borderColor: 'var(--border)' } }, ...cells);
    }));
  };
  draw();
  // ── Per-rep pay-stub amounts (moved here from Edit User, per Isaac):
  // fixed additives stored straight on the profile, no company default.
  const stubFields = [
    ['other_pay_amount',       'Other Pay',       'Fixed extra pay added to Total Upfront Pay each period.'],
    ['loyalty_pay_amount',     'Loyalty Pay',     'Fixed loyalty pay added each period.'],
    ['golden_phone_amount',    'Golden Phone',    'Office-staff Golden Phone royalty (sales-rep typed users only).'],
    ['loyalty_royalty_amount', 'Loyalty Royalty', 'Loyalty Royalty (loyalty-rep typed users only).'],
  ];
  const stubTable = rep ? (() => {
    const saveField = async (k, v) => {
      rep[k] = v == null ? 0 : v;
      if (typeof DEMO !== 'undefined' && DEMO) { saveDemoData(); return; }
      const { error } = await supabase.from('profiles').update({ [k]: rep[k] }).eq('id', rep.id);
      if (error) toast('Could not save: ' + error.message, 'error');
      else { try { logActivity('pay_override', { detail: rep.full_name + ': ' + k + ' = ' + rep[k] }); } catch (e) { /* optional */ } }
    };
    const closeIn = cellInput(
      () => rep.close_rate_target == null ? null : Math.round(Number(rep.close_rate_target) * 1000) / 10,
      (v) => { if (v != null) saveField('close_rate_target', Math.max(0, Math.min(100, v)) / 100); },
      '%', 'This rep\u2019s actual close rate (hand-maintained each quarter; also editable on the Pay tab).');
    return el('div', { class: 'card overflow-hidden' }, el('table', { class: 'w-full' },
      el('thead', {}, el('tr', { class: 'text-[10px] uppercase tracking-widest font-semibold', style: { color: 'var(--text-subtle)' } },
        el('th', { class: 'px-3 py-2 text-left' }, 'Pay stub \u00b7 ' + rep.full_name),
        el('th', { class: 'px-3 py-2 text-right' }, 'Amount'))),
      el('tbody', {},
        el('tr', { class: 'border-t', style: { borderColor: 'var(--border)' } },
          el('td', { class: 'px-3 py-1.5 text-xs font-semibold uppercase whitespace-nowrap' }, 'Close Rate'),
          el('td', { class: 'px-3 py-1 text-right', style: { width: '150px' } }, closeIn)),
        ...stubFields.map(([k, label, hint]) => el('tr', { class: 'border-t', style: { borderColor: 'var(--border)' } },
          el('td', { class: 'px-3 py-1.5 text-xs font-semibold uppercase whitespace-nowrap', title: hint }, label),
          el('td', { class: 'px-3 py-1 text-right', style: { width: '150px' } },
            cellInput(() => (Number(rep[k]) || 0) === 0 ? null : Number(rep[k]), (v) => saveField(k, v), '$', hint, '$0.00')))))));
  })() : null;
  const head = el('thead', {}, el('tr', { class: 'text-[10px] uppercase tracking-widest font-semibold', style: { color: 'var(--text-subtle)' } },
    el('th', { class: 'px-3 py-2 text-left' }, 'Metric'),
    el('th', { class: 'px-3 py-2 text-right' }, 'Default'),
    rep ? el('th', { class: 'px-3 py-2 text-right', style: { color: 'var(--accent)' } }, rep.full_name) : null));
  const picker = el('div', { class: 'card p-3 flex items-center gap-3 flex-wrap' },
    el('span', { class: 'text-[10px] uppercase tracking-widest font-semibold', style: { color: 'var(--text-subtle)' } }, 'Individual overrides'),
    el('select', {
      class: 'rounded-lg border px-2.5 py-1 text-[11px] font-semibold cursor-pointer',
      style: { borderColor: 'var(--border-2)', background: 'var(--card)', color: 'var(--text)', minWidth: '220px' },
      onchange: (e) => { state._payOverrideRep = e.target.value; mountApp(); },
    },
      el('option', { value: '', selected: !repId }, 'Defaults only — pick a rep to customize…'),
      ...reps.map(p => el('option', { value: p.id, selected: p.id === repId }, p.full_name + (p.pay_overrides && Object.keys(p.pay_overrides || {}).length ? ' · custom' : '')))),
    withOverrides.length ? el('div', { class: 'flex items-center gap-1.5 flex-wrap ml-auto' },
      el('span', { class: 'text-[10px]', style: { color: 'var(--text-subtle)' } }, withOverrides.length + ' with custom pay:'),
      ...withOverrides.map(p => el('button', { class: 'rounded-full px-2 py-0.5 text-[10px] font-semibold border', style: { borderColor: p.id === repId ? 'var(--accent)' : 'var(--border-2)', color: p.id === repId ? 'var(--accent)' : 'var(--text)' }, onclick: () => { state._payOverrideRep = p.id; mountApp(); } }, p.full_name)))
      : el('span', { class: 'text-[10px] ml-auto', style: { color: 'var(--text-subtle)' } }, 'No rep has custom pay — everyone is on the defaults.'));
  return el('div', { class: 'flex flex-col gap-3 max-w-3xl w-full commission-config' },
    picker,
    el('div', { class: 'card overflow-hidden' }, el('table', { class: 'w-full' }, head, body)),
    stubTable,
    el('div', { class: 'text-[11px]', style: { color: 'var(--text-subtle)' } },
      rep ? 'Type in ' + rep.full_name + '’s column to override a metric (orange = custom). Clear it or hit × to fall back to the default. Blank cells show the default they inherit.'
          : 'Click a default to edit; saves when you tab or click away. Modifiers are points relative to Upfront %. Pick a rep above to give them different numbers.'));
}

// (adminPricing removed — unreferenced; settings audit, Sep 30)



// ── Usage (Sep 2026): how people actually use the app ─────────────────────
// Reads usage_summary() (migrations/20260921_app_events.sql). Page usage,
// time on page, render speed, actions, feature adoption, errors, abandoned
// modals, searches, time-to-complete — so the next improvements come from
// behaviour, not intuition.
function adminUsage() {
  if (!isAdminRole(state.profile?.role)) return emptyCard('Admins only.');
  const days = [7, 30, 90].includes(Number(state._usageDays)) ? Number(state._usageDays) : 30;
  const key = 'd' + days;
  state._usage = state._usage || {};
  const cached = state._usage[key];
  if (!cached && !state._usageLoading && typeof supabase !== 'undefined' && supabase) {
    state._usageLoading = true;
    supabase.rpc('usage_summary', { days }).then(({ data, error }) => {
      state._usageLoading = false;
      state._usage[key] = error ? { error: error.message } : (data || {});
      if (state.view === 'admin' && state.adminSection === 'usage') mountApp();
    });
  }
  const wrap = el('div', { class: 'flex flex-col gap-4' });
  wrap.append(el('div', { class: 'flex items-center justify-between gap-3 flex-wrap' },
    el('div', {}, el('h2', { class: 'text-lg font-bold' }, 'Usage'), el('div', { class: 'text-[11px] text-muted-' }, 'Page views, time on page, actions, adoption, errors and abandoned flows — recorded by the app itself. Rows older than 90 days are pruned.')),
    el('div', { class: 'inline-flex rounded-lg border overflow-hidden', style: { borderColor: 'var(--border-2)' } },
      ...[7, 30, 90].map(d => el('button', { class: 'px-2.5 py-1 text-[11px] font-bold transition', style: d === days ? { background: 'var(--accent)', color: 'var(--accent-text)' } : { color: 'var(--text-muted)' }, onclick: () => { state._usageDays = d; mountApp(); } }, 'Last ' + d + ' days')))));
  // Adoption (who's actually using the app) moved here from Users (per Isaac, Sep 23).
  try { if (typeof adoptionCard === 'function') adoptionCard(wrap); } catch (e) { /* card is best-effort */ }
  if (!cached) { wrap.append(emptyCard('Loading usage…')); return wrap; }
  if (cached.error) {
    wrap.append(el('div', { class: 'card p-6 text-sm' }, el('div', { class: 'font-bold mb-1' }, 'Usage data is not available yet'),
      el('div', { class: 'text-[11px] text-muted-' }, /usage_summary|app_events/.test(cached.error) ? 'Run migrations/20260921_app_events.sql in Supabase — the app starts recording the moment the table exists.' : cached.error)));
    return wrap;
  }
  const u = cached;
  const tile = (label, v, sub) => el('div', { class: 'card p-4' }, el('div', { class: 'text-[10px] uppercase tracking-widest font-semibold text-muted-' }, label), el('div', { class: 'font-display text-2xl sm:text-4xl mt-1 tabular-nums' }, v), sub ? el('div', { class: 'text-[11px] text-muted- mt-0.5' }, sub) : null);
  const totalViews = (u.views || []).reduce((a, v) => a + (Number(v.n) || 0), 0);
  const totalErrors = (u.errors || []).reduce((a, v) => a + (Number(v.n) || 0), 0);
  wrap.append(el('div', { class: 'grid gap-3 grid-cols-2 sm:grid-cols-4' },
    tile('Active users', fmt.int(u.active_users || 0), fmt.int(u.active_users_7d || 0) + ' in the last 7 days'),
    tile('Sessions', fmt.int(u.sessions || 0), 'sign-ins / app opens'),
    tile('Page views', fmt.int(totalViews), 'across ' + (u.views || []).length + ' pages'),
    tile('Errors', fmt.int(totalErrors), (u.errors || []).length + ' distinct')));
  const th = (t, right) => el('th', { class: 'px-2 py-1.5 text-[9px] uppercase tracking-wider font-semibold whitespace-nowrap ' + (right ? 'text-right' : 'text-left'), style: { color: 'var(--text-muted)', background: 'var(--card-2)' } }, t);
  const td = (t, right) => el('td', { class: 'px-2 py-1.5 tabular-nums ' + (right ? 'text-right whitespace-nowrap' : 'text-left'), style: right ? {} : { overflowWrap: 'anywhere' } }, t);
  const table = (title, sub, heads, rows, empty) => el('div', { class: 'card overflow-hidden' },
    el('div', { class: 'px-4 py-3 border-b', style: { borderColor: 'var(--border)' } }, el('h3', { class: 'text-sm font-bold' }, title), sub ? el('div', { class: 'text-[11px] text-muted-' }, sub) : null),
    rows.length ? el('div', { class: 'scroll-x' }, el('table', { class: 'w-full text-xs frozen-table', style: { borderCollapse: 'collapse' } },
      el('thead', {}, el('tr', {}, ...heads.map(([h, r]) => th(h, r)))),
      el('tbody', {}, ...rows.map(r => el('tr', { class: 'border-t', style: { borderColor: 'var(--border)' } }, ...r.map(([v, right]) => td(v, right)))))))
      : el('div', { class: 'px-4 py-6 text-center text-xs text-muted- italic' }, empty || 'Nothing recorded yet.'));
  const pageName = (v) => (v.name || '?') + (v.sub ? ' · ' + v.sub : '');
  const secs = (n) => { n = Number(n) || 0; return n >= 60 ? Math.round(n / 60) + ' min' : n + ' s'; };
  wrap.append(el('div', { class: 'grid gap-4', style: { gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))' } },
    table('Pages', 'Views, distinct users, average time on page and median render time.', [['Page'], ['Views', 1], ['Users', 1], ['Avg time', 1], ['Render', 1]],
      (u.views || []).slice(0, 40).map(v => [[pageName(v)], [fmt.int(v.n), 1], [fmt.int(v.users), 1], [secs(v.sec), 1], [(Number(v.render_ms) || 0) + ' ms', 1]])),
    table('By role', 'Who is using the app.', [['Role'], ['Users', 1], ['Views', 1]],
      (u.by_role || []).map(r => [[(typeof ROLE_LABEL !== 'undefined' && ROLE_LABEL[r.role]) || r.role], [fmt.int(r.users), 1], [fmt.int(r.views), 1]])),
    table('Actions', 'Workflow completions: audits, staging, payroll runs, save attempts, exports, drills, filters.', [['Action'], ['Times', 1], ['Users', 1]],
      (u.actions || []).slice(0, 40).map(a => [[(a.name || '?') + (a.sub ? ' · ' + a.sub : '')], [fmt.int(a.n), 1], [fmt.int(a.users), 1]])),
    table('Feature adoption', 'Share of active users who used each feature at least once.', [['Feature'], ['Users', 1], ['Adoption', 1]],
      (u.adoption || []).map(a => [[a.name], [fmt.int(a.users), 1], [(Number(a.pct) || 0) + '%', 1]])),
    table('Time to complete', 'Median seconds from opening the page to completing the action on it.', [['Action'], ['Median', 1], ['Samples', 1]],
      (u.time_to || []).map(a => [[a.name], [secs(a.median_sec), 1], [fmt.int(a.n), 1]])),
    table('Modals', 'Opened vs completed — the gap is abandonment.', [['Modal'], ['Opened', 1], ['Completed', 1], ['Abandoned', 1], ['Avg open', 1]],
      (u.modals || []).map(m => [[m.name], [fmt.int(m.opened), 1], [fmt.int(m.completed), 1], [fmt.int(Math.max(0, (m.opened || 0) - (m.completed || 0))), 1], [secs(m.sec), 1]])),
    table('Searches', 'Where people type to find things.', [['Search box'], ['Searches', 1], ['Users', 1]],
      (u.searches || []).map(a => [[String(a.name || '').replace(/^search:/, '')], [fmt.int(a.n), 1], [fmt.int(a.users), 1]])),
    table('Errors', 'Uncaught errors and failed renders, most frequent first.', [['Error'], ['Times', 1], ['Users', 1], ['Last', 1]],
      (u.errors || []).map(e => [[e.name], [fmt.int(e.n), 1], [fmt.int(e.users), 1], [e.last ? new Date(e.last).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—', 1]]), 'No errors recorded.')));
  if ((u.daily || []).length) {
    const mx = Math.max(1, ...u.daily.map(d => Number(d.users) || 0));
    wrap.append(el('div', { class: 'card p-4' }, el('div', { class: 'text-[10px] uppercase tracking-widest font-semibold text-muted- mb-2' }, 'Active users by day'),
      el('div', { class: 'flex items-end gap-1', style: { height: '80px' } }, ...u.daily.map(d => el('div', { class: 'flex-1', title: d.d + ' · ' + d.users + ' users · ' + d.views + ' views', style: { height: Math.max(2, Math.round((Number(d.users) || 0) / mx * 76)) + 'px', background: 'var(--accent)', minWidth: '3px' } })))));
  }
  return wrap;
}


// ── Door to Door goals (per Isaac, Sep 23): a table of every sales rep on the
// viewer's teams — partners / team leads see the teams they lead (Settings →
// Users → Teams led + their own Manage Teams team), admins see everyone
// grouped by team. Revenue goal feeds the Individual pacer
// (profiles.annual_revenue_goal); the other goals live in profiles.year_goals
// {accounts, acv, retained_pct, other}. Saved through the set_rep_goals RPC so
// a partner can write their reps' rows without profile-wide update rights.
function d2dRepGoalsCard(partnerOnly) {
  const year = new Date().getFullYear();
  // Goals sit behind the profiles self-read policy, so a partner's roster
  // rows don't carry them — pull them once through rep_goals_all() and merge.
  if (state._repGoalsLoaded === undefined && !DEMO && supabase) {
    state._repGoalsLoaded = false;
    supabase.rpc('rep_goals_all').then(({ data }) => {
      state._repGoalsLoaded = true;
      if (!data) return;
      const by = new Map(data.map(r => [r.id, r]));
      (state.allProfiles || []).forEach(p => { const r = by.get(p.id); if (r) { p.annual_revenue_goal = r.annual_revenue_goal; p.year_goals = r.year_goals || {}; } });
      mountApp();
    }).catch(() => { state._repGoalsLoaded = true; });
  }
  // Goals for roster reps WITHOUT an app account (rep_name_goals, by name).
  if (state._repNameGoalsYear !== year && !DEMO && supabase) {
    state._repNameGoalsYear = year; state._repNameGoals = state._repNameGoals || {};
    supabase.from('rep_name_goals').select('name,revenue,goals').eq('year', year).then(({ data }) => {
      state._repNameGoals = {}; (data || []).forEach(r => { state._repNameGoals[r.name] = { annual_revenue_goal: r.revenue, year_goals: r.goals || {} }; });
      mountApp();
    }).catch(() => {});
  }
  const reach = partnerOnly ? myReachTeams() : null;
  const _sig = (n) => String(n || '').toLowerCase().replace(/[.,]/g, ' ').split(/\s+/).filter(Boolean).sort().join(' ');
  const _teamOf = (n) => (typeof getRepTeam === 'function' && (getRepTeam(n) || (typeof getCanonicalRepName === 'function' ? getRepTeam(getCanonicalRepName(n)) : ''))) || '';
  // Active in the app AND active in Manage Teams (per Isaac, Sep 23).
  const _mtActive = (n) => { if (typeof isRepActive !== 'function') return true; const c = (typeof getCanonicalRepName === 'function') ? getCanonicalRepName(n) : n; return isRepActive(n) || (c !== n && isRepActive(c)); };
  const profBySig = new Map();
  (state.allProfiles || []).forEach(p => { if (p.full_name) profBySig.set(_sig(p.full_name), p); });
  // Every rep Manage Teams assigns to a team (per Isaac, Sep 24 — Grayson
  // sees ALL of the Dawgs, not just the ones with an app login) + any app
  // D2D profile. A profile row carries its goals on the profile; a
  // roster-only row keeps them in rep_name_goals under the CRM name.
  const seen = new Set(), reps = [];
  const push = (name, p) => {
    const key = _sig(name); if (!key || seen.has(key)) return; seen.add(key);
    const team = _teamOf(name) || (p ? _teamOf(p.full_name) : '');
    if (reach && !(team && reach.has(team))) return;
    const disp = p ? p.full_name : (typeof flipLastFirst === 'function' ? flipLastFirst(name) : name);
    const g = p ? p : ((state._repNameGoals || {})[name] || { annual_revenue_goal: 0, year_goals: {} });
    reps.push({ p, name, disp, team, g });
  };
  Object.keys(state._indicatorRepTeam || {}).forEach(n => { if (_mtActive(n)) push(n, profBySig.get(_sig(n)) || null); });
  (state.allProfiles || []).filter(p => p.is_active !== false && slackTypeOfProfile(p) === 'd2d' && _mtActive(p.full_name)).forEach(p => push(p.full_name, p));
  reps.sort((a, b) => (a.team || 'zzz').localeCompare(b.team || 'zzz') || a.disp.localeCompare(b.disp));
  const usd = (n) => '$' + Math.round(n || 0).toLocaleString();
  const save = async (r, patch) => {
    const g = r.g;
    const yg = Object.assign({}, g.year_goals || {}, patch.year_goals || {});
    const rev = patch.annual_revenue_goal != null ? patch.annual_revenue_goal : (Number(g.annual_revenue_goal) || 0);
    if (DEMO || !supabase) { g.annual_revenue_goal = rev; g.year_goals = yg; saveDemoData(); return; }
    const { error } = r.p
      ? await supabase.rpc('set_rep_goals', { target: r.p.id, revenue: rev, goals: yg })
      : await supabase.rpc('set_rep_name_goals', { yr: year, nm: r.name, revenue: rev, goals: yg });
    if (error) { toast(/set_rep_goals|set_rep_name_goals|rep_name_goals/.test(String(error.message)) ? 'Run migrations/20260924_rep_name_goals.sql in Supabase first' : ('Could not save: ' + error.message), 'error'); return; }
    g.annual_revenue_goal = rev; g.year_goals = yg;
    if (!r.p) (state._repNameGoals = state._repNameGoals || {})[r.name] = g;
    logActivity('config_change', { detail: 'Rep goals · ' + r.disp + ' · ' + JSON.stringify(patch) });
    toast('Saved', 'success');
  };
  const inp = (val, onSave, o = {}) => el('input', Object.assign({
    type: 'text', inputmode: o.text ? 'text' : 'decimal', value: val == null || val === '' ? '' : String(val), placeholder: o.placeholder || '',
    class: 'text-left text-[11px] rounded border px-1.5 py-1 tabular-nums', style: { borderColor: 'var(--border-2)', background: 'var(--card)', color: 'var(--text)', width: '100%', minWidth: '0' },
    onchange: (e) => onSave(o.text ? e.target.value.trim() : (parseFloat(e.target.value.replace(/[^0-9.]/g, '')) || 0)),
  }));
  const th = (t) => el('th', { class: 'text-left px-2 py-2 text-[10px] uppercase tracking-wider font-semibold', style: { color: 'var(--text-muted)' } }, t);
  const COLS = [['Revenue goal', 'annual_revenue_goal'], ['Accounts', 'accounts'], ['Avg contract $', 'acv'], ['Retained %', 'retained_pct'], ['Other goal', 'other']];
  const repRow = (r) => {
    const g = r.g, yg = g.year_goals || {};
    return el('tr', { class: 'border-t', style: { borderColor: 'var(--border)' } },
      el('td', { class: 'px-2 py-1.5 font-semibold whitespace-nowrap' }, r.disp, r.p ? null : el('span', { class: 'ml-1.5 text-[9px] font-normal', style: { color: 'var(--text-subtle)' }, title: 'No app login yet — goals are kept under the CRM name and carry over when they sign up' }, 'no login')),
      el('td', { class: 'px-2 py-1' }, inp(Number(g.annual_revenue_goal) ? Math.round(Number(g.annual_revenue_goal)).toLocaleString() : '', (v) => save(r, { annual_revenue_goal: v }), { placeholder: '$' })),
      el('td', { class: 'px-2 py-1' }, inp(yg.accounts, (v) => save(r, { year_goals: { accounts: v } }), { placeholder: '#' })),
      el('td', { class: 'px-2 py-1' }, inp(yg.acv, (v) => save(r, { year_goals: { acv: v } }), { placeholder: '$' })),
      el('td', { class: 'px-2 py-1' }, inp(yg.retained_pct, (v) => save(r, { year_goals: { retained_pct: v } }), { placeholder: '%' })),
      el('td', { class: 'px-2 py-1' }, inp(yg.other, (v) => save(r, { year_goals: { other: v } }), { text: true, placeholder: 'e.g. 40 Sentricon' })));
  };
  // Broken out by team like Manage Teams (per Isaac, Sep 23): one accordion
  // section per team — logo / colour dot, name, rep count, goals total —
  // toggled in the DOM. Partners' own teams start open; admins start closed.
  const byTeam = new Map();
  for (const r of reps) { const k = r.team || '(unassigned)'; if (!byTeam.has(k)) byTeam.set(k, []); byTeam.get(k).push(r); }
  if (!(state._goalTeamsOpen instanceof Set)) state._goalTeamsOpen = new Set(partnerOnly ? [...byTeam.keys()] : []);
  const openSet = state._goalTeamsOpen;
  const colgroup = () => el('colgroup', {}, el('col', { style: { width: '22%' } }), el('col', { style: { width: '16%' } }), el('col', { style: { width: '12%' } }), el('col', { style: { width: '14%' } }), el('col', { style: { width: '12%' } }), el('col', {}));
  const sections = [...byTeam.entries()].map(([t, ps]) => {
    const real = t !== '(unassigned)';
    const logo = real && typeof getTeamLogo === 'function' ? getTeamLogo(t) : '';
    const color = real && typeof getTeamColor === 'function' ? getTeamColor(t) : 'var(--border-2)';
    const tTotal = ps.reduce((a, r) => a + (Number(r.g.annual_revenue_goal) || 0), 0);
    const open = openSet.has(t);
    const body = el('div', { style: { display: open ? '' : 'none' } },
      el('table', { class: 'text-xs', style: { width: '100%', tableLayout: 'fixed', borderCollapse: 'collapse' } },
        colgroup(),
        el('thead', {}, el('tr', { style: { background: 'var(--card)' } }, th('Rep'), ...COLS.map(([l]) => th(l)))),
        el('tbody', {}, ...ps.map(repRow))));
    const head = el('div', { class: 'flex items-center gap-2.5 px-3 py-2 border-t cursor-pointer hover:brightness-95 select-none',
      style: { borderColor: 'var(--border)', background: open ? 'rgba(223,100,58,.06)' : 'var(--card-2)' },
      onclick: () => { const on = !openSet.has(t); if (on) openSet.add(t); else openSet.delete(t); body.style.display = on ? '' : 'none'; head.style.background = on ? 'rgba(223,100,58,.06)' : 'var(--card-2)'; head.lastElementChild.textContent = on ? '\u25b2' : '\u25bc'; } },
      logo ? el('img', { src: logo, alt: '', style: { width: '18px', height: '18px', borderRadius: '50%', objectFit: 'cover', background: '#fff' } })
           : el('span', { style: { width: '10px', height: '10px', borderRadius: '50%', background: color, display: 'inline-block', flex: 'none' } }),
      el('span', { class: 'text-sm font-bold flex-1 min-w-0 truncate' }, real ? t : 'Unassigned'),
      el('span', { class: 'text-[11px] tabular-nums text-muted-' }, ps.length + ' rep' + (ps.length === 1 ? '' : 's') + ' · ' + usd(tTotal)),
      el('span', { class: 'text-[11px] text-muted-' }, open ? '\u25b2' : '\u25bc'));
    return [head, body];
  }).flat();
  const total = reps.reduce((a, x) => a + (Number(x.g.annual_revenue_goal) || 0), 0);
  return el('div', { class: 'card p-4' },
    el('div', { class: 'flex items-center justify-between flex-wrap gap-2 mb-3' },
      el('h3', { class: 'text-sm font-bold' }, (partnerOnly ? 'My team' : 'Door to Door') + ' · ' + year + ' rep goals'),
      el('span', { class: 'text-[11px] text-muted-' }, reps.length + ' rep' + (reps.length === 1 ? '' : 's') + ' · revenue goals total ' + usd(total))),
    reps.length
      ? el('div', { class: 'rounded-lg border', style: { borderColor: 'var(--border)', overflow: 'hidden' } }, ...sections)
      : el('div', { class: 'p-6 text-center text-sm text-muted-' }, partnerOnly ? 'No reps are assigned to your team yet — assignments come from Manage Teams.' : 'No active sales reps yet.'),
    el('div', { class: 'text-[10px] mt-2', style: { color: 'var(--text-subtle)' } }, 'Revenue goal drives each rep’s Individual pacer on the Dashboard. Other goals are yours to define per rep for the year.'));
}


// ── Settings → Data sources (per Isaac, Sep 23) ──────────────────────────
// The product is being built to be sold: every external system it reads is
// connected from here, per company, with a test button and live health —
// no Netlify env vars needed for a new customer. Secrets are write-only from
// the browser (saved through /api/integrations-admin; the masked view
// integrations_public only says whether each one is set).
function adminDataSources() {
  if (!isAdminRole(state.profile?.role)) return el('div', { class: 'card p-6 text-sm text-muted-' }, 'Admins only.');
  if (state._integrations === undefined) {
    state._integrations = null;
    Promise.all([
      supabase.from('integrations_public').select('*'),
      fetch('/api/sync-status').then(r => r.json()).catch(() => null),
    ]).then(([q, st]) => {
      state._integrations = {}; (q.data || []).forEach(r => { state._integrations[r.id] = r; });
      state._integrationsErr = q.error ? q.error.message : null;
      state._syncStatus = st; mountApp();
    });
  }
  const I = state._integrations || {}, fr = I.fieldroutes || { config: {}, status: {}, secrets_set: {} }, st = state._syncStatus || {};
  const cfg = fr.config || {}, fst = fr.status || {}, set = fr.secrets_set || {};
  const when = (iso) => iso ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—';
  const ago = (iso) => { if (!iso) return 'never'; const m = Math.round((Date.now() - Date.parse(iso)) / 60000); return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : m < 1440 ? Math.round(m / 60) + ' h ago' : Math.round(m / 1440) + ' d ago'; };
  const pill = (ok, txt) => el('span', { class: 'text-[10px] font-bold px-2 py-0.5 rounded-full', style: ok === true ? { background: 'rgba(95,108,91,.16)', color: '#5F6C5B' } : ok === false ? { background: 'rgba(220,38,38,.12)', color: '#B91C1C' } : { background: 'var(--card-2)', color: 'var(--text-muted)' } }, txt);
  const field = (label, node, hint) => el('label', { class: 'block' },
    el('span', { class: 'text-[10px] uppercase tracking-widest font-semibold block mb-1', style: { color: 'var(--text-subtle)' } }, label), node,
    hint ? el('span', { class: 'text-[10px] block mt-0.5', style: { color: 'var(--text-subtle)' } }, hint) : null);
  const inp = (attrs) => el('input', Object.assign({ class: 'w-full rounded-lg border px-2.5 py-1.5 text-[12px]', style: { borderColor: 'var(--border-2)', background: 'var(--card)', color: 'var(--text)' } }, attrs));
  const subIn = inp({ type: 'text', value: cfg.subdomain || '', placeholder: 'riddpest', autocomplete: 'off' });
  const domSel = el('select', { class: 'w-full rounded-lg border px-2.5 py-1.5 text-[12px]', style: { borderColor: 'var(--border-2)', background: 'var(--card)', color: 'var(--text)' } },
    ...['pestroutes.com', 'fieldroutes.com'].map(d => el('option', { value: d, selected: (cfg.domain || 'pestroutes.com') === d }, d)));
  const keyIn = inp({ type: 'password', placeholder: set.auth_key ? '•••••••• (saved — leave blank to keep)' : 'Authentication Key', autocomplete: 'new-password' });
  const tokIn = inp({ type: 'password', placeholder: set.auth_token ? '•••••••• (saved — leave blank to keep)' : 'Authentication Token', autocomplete: 'new-password' });
  const call = async (action) => {
    const { data } = await supabase.auth.getSession();
    const body = { id: 'fieldroutes', action, config: { subdomain: subIn.value.trim(), domain: domSel.value, enabled: true }, secrets: { auth_key: keyIn.value, auth_token: tokIn.value } };
    const r = await fetch('/api/integrations-admin', { method: 'POST', headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + (data.session && data.session.access_token || '') }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { toast(j.error || ('HTTP ' + r.status), 'error'); return; }
    if (j.test) toast(j.test.ok ? '✓ ' + j.test.message : '✗ ' + j.test.message, j.test.ok ? 'success' : 'error');
    else toast('Saved', 'success');
    logActivity('config_change', { detail: 'Data sources · FieldRoutes · ' + action });
    state._integrations = undefined; mountApp();
  };
  const btn = (label, fn, primary) => el('button', { class: 'rounded-lg px-3 py-1.5 text-[11px] font-bold transition hover:brightness-95', style: primary ? { background: 'var(--accent)', color: 'var(--accent-text)' } : { border: '1px solid var(--border-2)', color: 'var(--text)' }, onclick: fn }, label);
  const row = (k, v) => el('div', { class: 'flex items-center justify-between gap-3 py-1 border-t text-[11px]', style: { borderColor: 'var(--border)' } }, el('span', { style: { color: 'var(--text-muted)' } }, k), el('span', { class: 'tabular-nums text-right' }, v));
  const connected = fst.last_test_ok === true && set.auth_key && set.auth_token;
  const frCard = el('div', { class: 'card p-5' },
    el('div', { class: 'flex items-start justify-between gap-3 flex-wrap mb-3' },
      el('div', {}, el('h3', { class: 'text-sm font-bold' }, 'FieldRoutes (CRM)'), el('div', { class: 'text-[11px] mt-0.5', style: { color: 'var(--text-muted)' } }, 'New subscriptions land in the Sales queues within 5 minutes; add-on tickets and the deleted-account scan use the same key.')),
      pill(connected ? true : (fst.last_test_ok === false ? false : null), connected ? 'Connected' : fst.last_test_ok === false ? 'Not connected' : (set.auth_key ? 'Saved · untested' : 'Not set up'))),
    el('div', { class: 'grid gap-3', style: { gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' } },
      field('Subdomain', subIn, 'The first part of the address you sign in at — riddpest for riddpest.pestroutes.com.'),
      field('Domain', domSel),
      field('Authentication key', keyIn, 'FieldRoutes → Settings → API. Use a global key (all offices) with read access to subscriptions, customers, contracts and offices.'),
      field('Authentication token', tokIn)),
    el('div', { class: 'flex items-center gap-2 mt-3 flex-wrap' }, btn('Save & test', () => call('save'), true), btn('Test connection', () => call('test')),
      el('span', { class: 'text-[10px]', style: { color: 'var(--text-subtle)' } }, 'Saved here overrides the Netlify environment variables; leave a secret blank to keep the saved one.')),
    el('div', { class: 'mt-4' },
      row('Last test', fst.last_test_at ? (fst.last_test_ok ? '✓ ' : '✗ ') + (fst.last_test_message || '') + ' · ' + ago(fst.last_test_at) : '—'),
      row('Last live pull', fst.last_run_at ? (fst.last_run_ok ? '✓ ' : '✗ ') + ago(fst.last_run_at) + ' · ' + (fst.last_run_message || '') : 'not yet — runs every 5 min, 7am–11pm ET, once connected'),
      fst.rate_limited ? row('Rate-limited retries (last run)', String(fst.rate_limited)) : null));
  const rvOk = !!(st && st.lastRun && st.lastRun.ok);
  const rvCard = el('div', { class: 'card p-5' },
    el('div', { class: 'flex items-start justify-between gap-3 flex-wrap mb-3' },
      el('div', {}, el('h3', { class: 'text-sm font-bold' }, 'RevHawk (data warehouse)'), el('div', { class: 'text-[11px] mt-0.5', style: { color: 'var(--text-muted)' } }, 'Full-book snapshot every 30 minutes — Reporting, Retention, Indicators and the TV board read this. Service account lives in the Netlify environment (GCP_SA_EMAIL / GCP_SA_PRIVATE_KEY).')),
      pill(st && st.lastRun ? rvOk : null, st && st.lastRun ? (rvOk ? 'Healthy' : 'Last run failed') : 'checking…')),
    row('Last snapshot', st && st.recentSnapshots && st.recentSnapshots[0] ? ago(st.recentSnapshots[0].uploaded_at) + ' · ' + Number(st.recentSnapshots[0].rows || 0).toLocaleString() + ' rows' : '—'),
    row('Last run', st && st.lastRun ? (st.lastRun.stage || '') + (st.lastRun.ms ? ' · ' + Math.round(st.lastRun.ms / 1000) + 's' : '') : '—'),
    row('Derive worker', st && st.lastDerive ? (st.lastDerive.ok ? '✓ ' : '') + (st.lastDerive.stage || '') + ' · ' + ago(st.lastDerive.at) : '—'),
    el('div', { class: 'text-[10px] mt-3', style: { color: 'var(--text-subtle)' } }, 'Roadmap: a FieldRoutes-native mirror (nightly full pull + 5-minute changes into our own tables) makes this source optional for new customers.'));
  const sbCard = el('div', { class: 'card p-5' },
    el('h3', { class: 'text-sm font-bold mb-2' }, 'Setup checklist'),
    ...[
      ['FieldRoutes connected', !!connected],
      ['Commission Rules · Create sales from CRM subscriptions switched on (Configurations)', !!(state._autolog && state._autolog.enabled)],
      ['RevHawk snapshot healthy', rvOk],
      ['Reps linked to their FieldRoutes employee (Users)', (state.allProfiles || []).some(p => p.fieldroutes_employee_id)],
      ['Slack notifications configured', !!(state.appSettings && state.appSettings.slack_channels && state.appSettings.slack_channels.length)],
    ].map(([l, ok]) => el('div', { class: 'flex items-center gap-2 py-1 text-[12px]' }, el('span', { style: { color: ok ? '#5F6C5B' : 'var(--text-subtle)' } }, ok ? '✓' : '○'), el('span', { style: ok ? {} : { color: 'var(--text-muted)' } }, l))));
  // Data integrity (per Isaac, Sep 23): moved here from the retired Admin
  // section — collapsed, since it is a diagnostic, not a setting.
  const diOpen = state._dsIntegrityOpen === true;
  const diCard = el('div', { class: 'card overflow-hidden' },
    el('button', { class: 'w-full flex items-center justify-between gap-3 px-5 py-3 text-left', onclick: () => { state._dsIntegrityOpen = !diOpen; mountApp(); } },
      el('div', {}, el('div', { class: 'text-sm font-bold' }, 'Data integrity'), el('div', { class: 'text-[11px]', style: { color: 'var(--text-muted)' } }, 'Every judgment call the bridge makes — fallbacks, name matching, cancel tagging — with the rows behind each count.')),
      el('span', { class: 'text-[11px] text-muted-' }, diOpen ? '▲' : '▼')),
    diOpen ? el('div', { class: 'px-5 pb-5 flex flex-col gap-4' }, dataIntegrityPanel(), adminDataHygiene()) : null);
  // Brand assets (per Isaac, Oct 2): the RIDD wordmark as a hosted PNG —
  // charcoal on transparent — for outside flows that need an image URL
  // (the Gmail API signature flow). Collapsed; tucked at the bottom.
  const baOpen = state._dsBrandOpen === true;
  const logoUrl = location.origin + '/ridd-logo.png';
  const baCard = el('div', { class: 'card overflow-hidden' },
    el('button', { class: 'w-full flex items-center justify-between gap-3 px-5 py-3 text-left', onclick: () => { state._dsBrandOpen = !baOpen; mountApp(); } },
      el('div', {}, el('div', { class: 'text-sm font-bold' }, 'Brand assets'), el('div', { class: 'text-[11px]', style: { color: 'var(--text-muted)' } }, 'The RIDD logo as a hosted PNG, for email signatures and API flows.')),
      el('span', { class: 'text-[11px] text-muted-' }, baOpen ? '▲' : '▼')),
    baOpen ? el('div', { class: 'px-5 pb-5 flex items-center gap-4 flex-wrap' },
      el('div', { class: 'rounded-lg border p-3', style: { borderColor: 'var(--border)', background: '#FDF1D3' } },
        el('img', { src: '/ridd-logo.png', alt: 'RIDD logo', style: { height: '44px', display: 'block' } })),
      el('div', { class: 'flex flex-col gap-2 min-w-0' },
        el('div', { class: 'text-[11px]', style: { color: 'var(--text-muted)' } }, 'PNG · charcoal on a transparent background · 888 × 252'),
        el('code', { class: 'text-[11px]', style: { wordBreak: 'break-all' } }, logoUrl),
        el('div', { class: 'flex items-center gap-2 flex-wrap' },
          el('button', { class: 'rounded-lg border px-2.5 py-1 text-[11px] font-semibold', style: { borderColor: 'var(--border-2)' }, onclick: () => { try { navigator.clipboard.writeText(logoUrl); toast('Logo URL copied', 'success'); } catch (e) { toast('Copy failed — select the URL above', 'warn'); } } }, 'Copy URL'),
          el('a', { class: 'rounded-lg border px-2.5 py-1 text-[11px] font-semibold', style: { borderColor: 'var(--border-2)', color: 'var(--text)' }, href: '/ridd-logo.png', download: 'ridd-logo.png' }, 'Download PNG')))) : null);
  return el('div', { class: 'flex flex-col gap-4' },
    el('div', { class: 'flex items-center gap-2' }, el('h2', { class: 'text-lg font-bold' }, 'Connections'), state._integrationsErr ? pill(false, 'run migrations/20260923_integrations.sql') : null),
    frCard, rvCard, sbCard, diCard, baCard);
}

// ── Upsells → ticket items (per Isaac, Sep 30) ───────────────────────────
// Every ticket item FieldRoutes has on a recurring ticket (catalogued by the
// add-ons sync), each with a Commissionable switch. Commissionable items are
// "Eligible Revenue": their value (per-service charge × 12) is added to — or,
// for a negative line like a discount, subtracted from — the account's
// commissionable ARV; everything else (service fees, tax) is left out.
// Stored as autolog.addon_items { [name lower-case]: true|false }.
const ADDON_NOT_DEFAULT = /^(service fee|tax|nsf fee|late fee|finance charge|credit card fee)\b|discount/i;
function _addonAutoRule(AL, name) {
  const n = String(name || '').trim().toLowerCase();
  const terms = (AL.upsell_services || []).map(x => String(x).toLowerCase()).filter(Boolean);
  return terms.length ? terms.some(t => n.includes(t)) : !ADDON_NOT_DEFAULT.test(n);
}
function _loadAddonCatalog() {
  if (state._addonCatalog !== undefined) return;
  state._addonCatalog = null;
  supabase.from('app_settings').select('value').eq('key', 'addon_item_catalog').maybeSingle().then(async ({ data }) => {
    let items = (data && data.value && data.value.items) || {};
    let at = data && data.value && data.value.at;
    // Before the first catalogue run: names from the revenue split lines.
    if (!Object.keys(items).length) {
      try {
        // Supabase caps a read at 1,000 rows — page through every account.
        const rv = [];
        for (let off = 0; off < 60000; off += 1000) {
          const { data: pg } = await supabase.from('subscription_revenue').select('lines').eq('active', true).range(off, off + 999);
          if (pg) rv.push(...pg);
          if (!pg || pg.length < 1000) break;
        }
        for (const r of rv) for (const l of (r.lines || [])) {
          if (!l || l.kind === 'base' || !l.name || l.name === 'Initial extras') continue;
          const x = items[l.name] || (items[l.name] = { n: 0, avg: 0, _t: 0 }); x.n++; x._t += Number(l.per_service) || 0; x.avg = Math.round(x._t / x.n * 100) / 100;
        }
        at = null;
      } catch (e) { /* table may not exist yet */ }
    }
    state._addonCatalog = { items, at };
    mountApp();
  });
}
function addonItemsTable(AL, saveAL, sw, pill) {
  _loadAddonCatalog();
  const C = state._addonCatalog;
  const map = AL.addon_items || {};
  const muted = { color: 'var(--text-muted)' };
  const th = (t, cls) => el('th', { class: (cls || 'text-left') + ' px-2 py-1.5 text-[10px] uppercase tracking-wider font-semibold', style: muted }, t);
  if (!C) return el('div', { class: 'text-[11px] py-2', style: muted }, 'Loading ticket items…');
  const names = Object.keys(C.items).sort((a, b) => (C.items[b].n || 0) - (C.items[a].n || 0) || a.localeCompare(b));
  const list = names;
  const setItem = (nm, v) => { const m = Object.assign({}, map); const k = nm.trim().toLowerCase(); if (v == null) delete m[k]; else m[k] = v; saveAL({ addon_items: m }); };
  const eligibleN = names.filter(nm => { const v = map[nm.trim().toLowerCase()]; return typeof v === 'boolean' ? v : _addonAutoRule(AL, nm); }).length;
  const open = state._addonItemsOpen !== false;
  return el('div', { class: 'rounded-lg border mb-2', style: { borderColor: 'var(--border)' } },
    el('div', { class: 'flex items-center gap-2 flex-wrap px-2 py-2', style: { background: 'var(--card-2)' } },
      el('button', { class: 'text-[11px] font-bold', onclick: () => { state._addonItemsOpen = !open; mountApp(); } }, (open ? '▾ ' : '▸ ') + 'Ticket items · Eligible Revenue'),
      pill(eligibleN + ' of ' + names.length + ' commissionable'),
      el('span', { class: 'text-[10px] flex-1', style: { color: 'var(--text-subtle)' } }, 'Commissionable items are Eligible Revenue: per-service charge × 12 added to the account’s commissionable ARV (a negative line such as a discount subtracts). Off = left out, like service fees. Items nobody is credited with ride the base seller.' + (C.at ? ' · catalog ' + new Date(C.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ' · full list fills in after tonight’s 2am sweep')),
),
    !open ? null : !names.length ? el('div', { class: 'px-3 py-4 text-[11px]', style: muted }, 'No ticket items yet — the add-ons sync lists them after its next run.') :
      el('div', { style: { maxHeight: '360px', overflowY: 'auto' } }, el('table', { class: 'text-xs', style: { width: '100%', borderCollapse: 'collapse' } },
        el('thead', { style: { position: 'sticky', top: 0, background: 'var(--card)', zIndex: 1 } }, el('tr', {}, th('Ticket item'), th('On recurring tickets', 'text-right'), th('Commissionable', 'text-center'), th(''))),
        el('tbody', {}, ...list.map(nm => {
          const x = C.items[nm] || {}; const k = nm.trim().toLowerCase(); const set = typeof map[k] === 'boolean'; const on = set ? map[k] : _addonAutoRule(AL, nm);
          return el('tr', { class: 'border-t', style: { borderColor: 'var(--border)' } },
            el('td', { class: 'px-2 py-1.5 font-semibold' }, nm),
            el('td', { class: 'px-2 py-1.5 text-right tabular-nums' }, Number(x.n || 0).toLocaleString()),
            el('td', { class: 'px-2 py-1.5 text-center' }, sw(on, () => setItem(nm, !on))),
            el('td', { class: 'px-2 py-1.5 text-[10px]', style: { color: 'var(--text-subtle)' } }, set ? el('button', { class: 'underline', onclick: () => setItem(nm, null) }, 'reset to auto') : 'auto'));
        })))));
}

// Slack notifications per rep type (pay_settings.slack_types) — lives on
// Settings → Slack (moved from Configurations, per Isaac Sep 30).
function slackTypesCard() {
  const SL = Object.assign({}, SLACK_TYPE_DEFAULTS, (state.appSettings && state.appSettings.slack_types) || {});
  const saveSL = (k, v) => { state.appSettings.slack_types = Object.assign({}, SL, { [k]: v }); saveAppSettings(); logActivity('config_change', { detail: 'Slack ' + k + ': ' + (v ? 'on' : 'off') }); toast('Saved', 'success'); mountApp(); };
  const sw = (on, onToggle) => el('button', { type: 'button', class: 'shrink-0', role: 'switch', 'aria-checked': String(!!on), style: { width: '44px', height: '32px', padding: '6px 4px', background: 'transparent', border: 'none', cursor: 'pointer' }, onclick: onToggle },
    el('span', { style: { display: 'block', position: 'relative', width: '36px', height: '20px', borderRadius: '10px', background: on ? 'var(--accent)' : 'var(--border-2)' } },
      el('span', { style: { position: 'absolute', top: '2px', left: on ? '18px' : '2px', width: '16px', height: '16px', borderRadius: '50%', background: '#fff', boxShadow: '0 1px 2px rgba(0,0,0,.3)', transition: 'left .12s' } })));
  const row = (label, control, tip) => el('div', { class: 'flex items-center justify-between gap-3 py-1.5 border-t', style: { borderColor: 'var(--border)' }, title: tip || '' },
    el('div', { class: 'text-sm font-semibold' + (tip ? ' cursor-help' : '') }, label), control);
  const on = [['office', 'Inside Sales'], ['d2d', 'D2D'], ['tech', 'Technicians']].filter(([k]) => SL[k] !== false && !(k !== 'office' && SL[k] !== true)).map(([, l]) => l).join(' · ') || 'off';
  return el('div', { class: 'card p-4' },
    el('div', { class: 'flex items-center justify-between gap-3 mb-1' }, el('div', { class: 'text-sm font-bold' }, 'Slack notifications by rep type'),
      el('span', { class: 'text-[10px] font-semibold px-2 py-0.5 rounded-full', style: { background: 'var(--card-2)', color: 'var(--text-muted)' } }, on)),
    row('Inside Sales', sw(SL.office !== false, () => saveSL('office', !(SL.office !== false))), 'Office staff and loyalty reps can wire a Slack Member ID in ⚙ My Settings and get DMs (audit results, pay stubs and more). Default on.'),
    row('D2D sales reps', sw(SL.d2d === true, () => saveSL('d2d', !(SL.d2d === true))), 'Sales reps, partners and team leads. Off hides the Slack section from their settings and mutes DMs to them. Default off.'),
    row('Technicians', sw(SL.tech === true, () => saveSL('tech', !(SL.tech === true))), 'All technician roles. Default off.'));
}
