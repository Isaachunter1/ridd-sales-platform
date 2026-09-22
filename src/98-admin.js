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
  const setPerm = (role, permId, val) => {
    state._compExtras = state._compExtras || {};
    const perms = state._compExtras.perms = state._compExtras.perms || {};
    const r = perms[role] = perms[role] || {};
    const def = !!(PERM_DEFAULTS[role] || {})[permId];
    if (!!val === def) delete r[permId];   // matches the default — store nothing
    else r[permId] = val ? 1 : 0;
    if (!Object.keys(r).length) delete perms[role];
    saveIndicatorState();
    logActivity('config_change', { detail: 'Permissions: ' + (ROLE_LABEL[role] || role) + ' \u00b7 ' + permId + ' \u2192 ' + (val ? 'visible' : 'hidden') });
    mountApp();
  };
  const resetRole = (role) => {
    if (!overrides[role]) return;
    delete state._compExtras.perms[role];
    saveIndicatorState();
    logActivity('config_change', { detail: 'Permissions: ' + (ROLE_LABEL[role] || role) + ' reset to defaults' });
    mountApp();
  };
  // One user type at a time, picked from a dropdown (per Isaac) — fits a
  // phone and keeps growing as permissions are added. Rows: label left,
  // switch / reach dropdown right. Same storage as before.
  const role = PERM_ROLES.includes(state._permRole) ? state._permRole : PERM_ROLES[0];
  const eff = effOf(role);
  const scopeOverrides = (state._compExtras && state._compExtras.permScopes) || {};
  const changed = !!overrides[role] || !!scopeOverrides[role];
  const sw = (on, onToggle, overridden) => el('button', { class: 'shrink-0', title: overridden ? 'Changed from default' : '', style: { width: '36px', height: '20px', borderRadius: '10px', background: on ? 'var(--accent)' : 'var(--border-2)', position: 'relative', border: 'none', cursor: 'pointer', boxShadow: overridden ? '0 0 0 2px rgba(223,100,58,.25)' : 'none' }, onclick: onToggle },
    el('div', { style: { position: 'absolute', top: '2px', left: on ? '18px' : '2px', width: '16px', height: '16px', borderRadius: '50%', background: '#fff', boxShadow: '0 1px 2px rgba(0,0,0,.3)', transition: 'left .12s' } }));
  const row = (label, control) => el('div', { class: 'flex items-center justify-between gap-3 py-1.5 border-t', style: { borderColor: 'var(--border)' } },
    el('div', { class: 'text-sm font-semibold' }, label), control);
  const groupHead = (t) => el('div', { class: 'pt-3 pb-1 text-[10px] uppercase tracking-widest font-semibold', style: { color: 'var(--text-subtle)' } }, t);
  const groups = [...new Set(PERM_DEFS.map(d => d.group))];
  const picker = el('select', {
    class: 'rounded-lg border px-2.5 py-1.5 text-sm font-semibold cursor-pointer',
    style: { borderColor: 'var(--border-2)', background: 'var(--card)', color: 'var(--text)' },
    onchange: (e) => { state._permRole = e.target.value; mountApp(); },
  }, ...PERM_ROLES.map(r => el('option', { value: r, selected: r === role }, ROLE_LABEL[r] || r)));
  return el('div', { class: 'flex flex-col gap-4' },
    el('div', { class: 'card p-4' },
      el('div', { class: 'flex items-center justify-between gap-3 flex-wrap' },
        el('div', { class: 'flex items-center gap-3 flex-wrap' },
          el('h2', { class: 'text-lg font-bold' }, 'Permissions'), picker),
        changed ? el('button', { class: 'text-[11px] font-semibold', style: { color: 'var(--accent)' }, onclick: () => {
          if (overrides[role]) resetRole(role);
          if (scopeOverrides[role]) { delete state._compExtras.permScopes[role]; saveIndicatorState(); mountApp(); }
        } }, 'Reset to defaults') : el('span', { class: 'text-[11px] text-muted-' }, 'defaults')),
      el('div', { class: 'mt-2' },
        ...groups.flatMap(g => [
          groupHead(g),
          ...PERM_DEFS.filter(d => d.group === g).map(d => {
            const on = !!eff[d.id];
            const overridden = overrides[role] && overrides[role][d.id] !== undefined;
            // Sensitive permissions (per Isaac, Sep 22): switching one ON asks
            // "are you sure" and says what it exposes. Switching off never asks.
            const toggle = () => {
              if (!on && d.sensitive) {
                const who = ROLE_LABEL[role] || role;
                if (!confirm('Give every ' + who + ' access to ' + d.sensitive + '?\n\nThis is sensitive information. Are you sure?')) return;
              }
              setPerm(role, d.id, !on);
            };
            const label = d.sensitive
              ? el('span', { class: 'inline-flex items-center gap-1.5' }, d.label, el('span', { class: 'text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded', style: { background: 'rgba(220,38,38,.10)', color: '#B91C1C' }, title: 'Sensitive \u2014 ' + d.sensitive }, 'sensitive'))
              : d.label;
            return row(label, sw(on, toggle, overridden));
          }),
        ]),
        groupHead('Reach'),
        ...PERM_SCOPE_DEFS.map(d => {
          const def = (PERM_SCOPE_DEFAULTS[role] || {})[d.id] || 'self';
          const cur = (scopeOverrides[role] && scopeOverrides[role][d.id]) || def;
          const overridden = cur !== def;
          return row(d.label, el('select', {
            class: 'rounded-lg border px-2 py-1 text-[11px] font-semibold cursor-pointer',
            style: { borderColor: overridden ? 'var(--accent)' : 'var(--border-2)', background: 'var(--card)', color: 'var(--text)' },
            title: (d.help || '') + (overridden ? ' · changed from default (' + PERM_SCOPE_LABELS[def] + ')' : ''),
            onchange: (e) => {
              const v = e.target.value;
              state._compExtras = state._compExtras || {};
              const ps = state._compExtras.permScopes = state._compExtras.permScopes || {};
              const r = ps[role] = ps[role] || {};
              if (v === def) delete r[d.id]; else r[d.id] = v;
              if (!Object.keys(r).length) delete ps[role];
              saveIndicatorState();
              logActivity('config_change', { detail: 'Permissions reach: ' + (ROLE_LABEL[role] || role) + ' · ' + d.id + ' → ' + v });
              mountApp();
            },
          }, ...PERM_SCOPES.map(sv => el('option', { value: sv, selected: sv === cur }, PERM_SCOPE_LABELS[sv]))));
        }))));
}

// ──────────────────────────────────────────────────────────────────────────
function viewAdmin() {
  if (!state.adminSection) state.adminSection = 'users';

  // One flat list, alphabetical (per Isaac, Sep 2026). Sources now lives
  // inside Configurations; the old 'sources' section key still resolves.
  if (state.adminSection === 'sources') state.adminSection = 'config';
  // Non-admins reach this page only through Settings → Permissions, and see
  // only the sections they were granted (Permissions / Admin never).
  const _allowed = (k) => canOpenAdminSection(k);
  const _groupsAll = [
    { label: 'Settings', items: [
      ['uploads', 'Admin',          '🗂'],
      ['pricing', 'Commissions',    '💵'],
      ['comps',   'Competitions',   '🏆'],
      ['config',  'Configurations', '🧮'],
      ['goals',   'Goals',          '🎯'],
      ['perms',   'Permissions',    '🔐'],
      ['slack',   'Slack',          '💬'],
      ['teams',   'Teams',          '🤝'],
      ['users',   'Users',          '👥'],
      ['usage',   'Usage',          '📈'],
    ] },
  ];
  const groups = _groupsAll.map(g => ({ label: g.label, items: g.items.filter(([k]) => _allowed(k)) })).filter(g => g.items.length);
  if (!_allowed(state.adminSection)) { const first = groups[0] && groups[0].items[0]; state.adminSection = first ? first[0] : 'users'; }

  const navBtn = ([k, label, icon]) => el('button', {
    class: 'flex items-center gap-3 px-2.5 py-1 rounded-lg text-[11px] font-medium transition text-left w-full',
    style: state.adminSection === k
      ? { background: 'var(--bg-subtle)', color: 'var(--text)', fontWeight: '600' }
      : { color: 'var(--text-muted)' },
    onmouseenter: (e) => { if (state.adminSection !== k) e.currentTarget.style.background = 'var(--bg-subtle)'; },
    onmouseleave: (e) => { if (state.adminSection !== k) e.currentTarget.style.background = 'transparent'; },
    onclick: () => { state.adminSection = k; mountApp(); },
  }, el('span', {}, label));

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
    config:  adminConfigurations,
    perms:   adminPermissions,
    uploads: adminUploads,
    sources: adminSources,
    slack:   adminSlack,
    comps:   adminCompetitionSchedule,
    usage:   adminUsage,
    pricing: adminCommissions,   // "Commissions" — CRM commission rules by rep type
    backup:  adminBackup,
  };
  const view = _allowed(state.adminSection) ? (sectionRenderers[state.adminSection] || adminReps) : (() => el('div', { class: 'card p-6 text-sm text-muted-' }, 'Nothing here for your role yet \u2014 ask an admin to grant a Settings page in Permissions.'));
  const body = el('div', { class: 'flex-1 min-w-0' }, view());

  const mobileNav = el('div', { class: 'sm:hidden flex items-center gap-2' },
    el('select', {
      class: 'flex-1 rounded-xl px-2.5 py-1 text-[11px] font-semibold cursor-pointer',
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
      class: 'rounded-xl px-2.5 py-1 text-[11px] font-semibold border shrink-0',
      style: { color: '#DC2626', borderColor: 'var(--border-2)' },
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
function adminConfigurations() {
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
    defRow('Recurring basis', 'Data-driven: a sub is recurring if its annual recurring value > $0 (self-maintaining, recommended). Lifecycle: the manual Service Types list decides.'),
    defRow('Aging threshold', 'A sub counts as aging / at-risk when its days past due is greater than or equal to this number (default 7).'),
    defRow('Active includes one-time', 'Count one-time active subs in “Subscriptions Active”; off = recurring only.'),
    defRow('Deleted CRM accounts', 'Customer IDs deleted inside FieldRoutes. The warehouse keeps their rows, so they are excluded from every dataset — automatically when the sync flags them, plus any IDs you list.'),
    defRow('Auto-log from FieldRoutes', 'The hourly sync (and the 15-minute FieldRoutes live pull) creates one sale per CRM subscription sold by a linked rep (Inside Sales, D2D, Technicians) the moment it exists. Each row shows whether it is commission-eligible — initial appointment on the books, billing on file, signed agreement — and auto-approval waits for the required ones. It then moves Upfront → Pending Backend Lock → Archived / History from the account’s live state. Revenue is frozen at first sight; the Log Sale form is for upsells only. Payroll runs stay the admin’s click.'),
    defRow('Attrition steps', 'The saved population rules behind the Retention tab, in the same order as its Attrition Steps card. The tab’s own switches are session-only what-ifs; what you set here is the default every user sees. Attrition = counted cancels ÷ beginning-of-year book.'),
    defRow('Step 3 · 3-day RORs', 'Reason “3 Day ROR”, or (switch on) any door-to-door sub cancelled within 3 days of the sale regardless of reason.'),
    defRow('Steps 4–5', 'Combined Subscriptions and Renewal - … reasons: the old sub was folded into / replaced by another that carries on, so it leaves the book without counting as a loss.'),
    defRow('Step 7 exemptions', 'Service names containing these terms keep their one-visit subs (Sentricon is annual — one visit a year is the service).'),
    defRow('Step 9', 'Cancel reasons treated as retained — the company ended it, the customer did not leave. Edited in the Cancel reasons list below.'),
    defRow('Indicators · MY % exclusions', 'Service terms left out of the MY % (multi-year) calculation on Indicators.'),
    defRow('Marketing / IS', 'Counts Office-Staff-sold accounts only; Renewal sources are excluded from new-business pace.'),
  );

  // ── tiny controls ──
  const sw = (on, onToggle) => el('button', { class: 'shrink-0', style: { width: '36px', height: '20px', borderRadius: '10px', background: on ? 'var(--accent)' : 'var(--border-2)', position: 'relative', border: 'none', cursor: 'pointer' }, onclick: onToggle },
    el('div', { style: { position: 'absolute', top: '2px', left: on ? '18px' : '2px', width: '16px', height: '16px', borderRadius: '50%', background: '#fff', boxShadow: '0 1px 2px rgba(0,0,0,.3)', transition: 'left .12s' } }));
  const row = (label, control, o = {}) => el('div', { class: 'flex items-center justify-between gap-3 py-1.5 border-t', style: { borderColor: 'var(--border)', paddingLeft: o.indent ? '18px' : '0' }, title: o.tip || '' },
    el('div', { class: (o.small ? 'text-xs' : 'text-sm') + ' font-semibold' + (o.tip ? ' cursor-help' : ''), style: o.muted ? { color: 'var(--text-muted)' } : {} }, label),
    el('div', { class: 'flex items-center gap-2 shrink-0' }, ...[].concat(control).filter(Boolean)));
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
        el('button', { class: 'text-[11px] leading-none', style: { color: 'var(--text-muted)' }, onclick: () => onChange(terms.filter(x => x !== t)) }, '×'))),
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
  const crmDelN = (state._crmDeletedIds || []).length;
  const crmMeta = state._crmDeletedMeta;
  const reportingRules = card('Reporting rules', null,
    row('Recurring basis', sel(reportingRecurringMode(), [['arv', 'Data-driven (ARV > $0)'], ['lifecycle', 'Lifecycle config']], (v) => { setReportingRecurringMode(v); mountApp(); }), { tip: 'How the app decides which subscriptions are recurring. Data-driven: annual recurring value > $0 (self-maintaining, recommended). Lifecycle: the Service Types list decides.' }),
    row('Aging threshold', [el('span', { class: 'text-[11px] text-muted-' }, 'days past due ≥'), num(reportingAgingDays(), (v) => { setReportingAgingDays(v); mountApp(); })], { tip: 'A sub counts as aging / at-risk when its days past due is greater than or equal to this number.' }),
    row('Active includes one-time', sw(reportingActiveInclOneTime(), () => { setReportingActiveInclOneTime(!reportingActiveInclOneTime()); mountApp(); }), { tip: 'Count one-time active subs in “Subscriptions Active”. Off = recurring only.' }),
    row('Deleted CRM accounts · auto-exclude', [
      orphans.length ? el('button', { class: 'text-[11px] font-semibold', style: { color: 'var(--accent)' }, onclick: () => openReportingDrillModal({ chartTitle: 'Subscriptions with no FieldRoutes customer record', sliceLabel: n(orphans.length) + ' subscriptions · deleted in the CRM', rows: orphans, formatValue: fmt.usd0 }) }, n(orphanCust) + ' detected →') : pill('0 detected'),
      pill(n(crmDelN) + ' from nightly FieldRoutes check' + (crmMeta && crmMeta.scanned_at ? ' · ' + new Date(crmMeta.scanned_at).toLocaleDateString([], { month: 'short', day: 'numeric' }) : ' · not run yet')),
      sw(autoOrph, () => {
        setReportingAutoExcludeOrphans(!autoOrph);
        if (Array.isArray(state.reportingSubscriptions)) {
          const ids = new Set(state._orphanCustIds || []);
          state.reportingSubscriptions = !autoOrph
            ? state.reportingSubscriptions.filter(r => !ids.has(String(r.customer_id != null ? r.customer_id : '')))
            : state.reportingSubscriptions.concat(orphans.filter(r => !state.reportingSubscriptions.includes(r)));
        }
        mountApp();
      })]),
    row('Deleted CRM accounts · manual IDs', [pill(n(delIds.length) + ' excluded'), txt(delIds.join(', '), (v) => {
      const ids = [...new Set(String(v || '').split(/[\s,;]+/).map(x => x.trim()).filter(x => /^\d+$/.test(x)))];
      state.indicatorDeletedCustIds = ids;
      const del = deletedCustIdSet();
      if (del.size && Array.isArray(state.reportingSubscriptions)) state.reportingSubscriptions = state.reportingSubscriptions.filter(r => !del.has(String(r.customer_id != null ? r.customer_id : '')));
      saveIndicatorState(); toast(ids.length + ' deleted account' + (ids.length === 1 ? '' : 's') + ' excluded app-wide', 'success'); mountApp();
    }, { placeholder: 'customer IDs, comma-separated' })], { small: true, indent: true }),
  );

  // ── 2. Attrition steps (mirror of the Retention tab, saved defaults) ──
  const popList = (() => { const r = _adminRules(); return r && Array.isArray(r.retenPopExclReasons) ? r.retenPopExclReasons : RETEN_POP_EXCL_REASONS_DEFAULT; })();
  const popOf = (kind) => popList.filter(x => crmReasonIs(kind, x));   // 'combined' | 'renewal' (src/12-crm-vocab.js)
  const exclReasons = reportingExcludedCancelReasons();
  const stepNo = (i) => el('span', { class: 'inline-flex items-center justify-center text-[10px] font-black rounded-full mr-2', style: { width: '18px', height: '18px', background: 'var(--card-2)', color: 'var(--text-muted)' } }, String(i));
  const STEP_TIP = {
    1: 'One-time services are never part of a retention book. Which subs are one-time comes from the recurring basis above.',
    2: 'A sub that never received its initial service never started, so it can neither retain nor churn.',
    3: 'Buyer’s remorse, not attrition. Removed when the cancel reason is a 3-day ROR, or (switch on) when a door-to-door sub was cancelled within 3 days of the sale whatever the reason.',
    4: 'Cancel reason “Combined Subscriptions” — the sub was folded into another sub on the same account, which carries on.',
    5: 'Cancel reason Renewal - … — the old plan was replaced by a renewal sub that stays in the book and inherits the original start date.',
    6: '$0 annual recurring value — nothing recurring to retain.',
    7: 'Prior-year subs with a single completed visit never became a customer, so their cancel is not real attrition. Exempt services (Sentricon) keep their one-visit subs because one visit a year is the service.',
    8: 'Frozen after one visit, any year. No cancel date ever lands, so left in they would count as retained forever.',
    9: 'Cancels with these reasons count as RETAINED — the company ended the service, the customer did not leave. Edited in the Cancel reasons list below.',
  };
  const stepRow = (i, label, control, o) => row(el('span', { class: 'inline-flex items-center' }, stepNo(i), label), control, { ...(o || {}), tip: STEP_TIP[i] });
  const attrition = card('Attrition steps', pill('saved defaults · Retention tab switches are session-only'),
    stepRow(1, 'Remove one-time services', pill('from recurring basis')),
    stepRow(2, 'Remove subs that never received an initial service', pill('always')),
    stepRow(3, 'Remove 3-day RORs', [pill(popOf('ror').join(', ') || '— no reason set'), el('span', { class: 'text-[10px] text-muted-' }, '+ D2D cancelled ≤3 days'), sw(reportingExcludeRorChurn(), () => { setReportingExcludeRorChurn(!reportingExcludeRorChurn()); mountApp(); })]),
    stepRow(4, 'Remove combined subscriptions', pill(popOf('combined').join(', ') || '— no reason set')),
    stepRow(5, 'Remove renewals', pill(popOf('renewal').join(', ') || '— no reason set')),
    row('Reasons that remove a sub from the book (steps 3–5)', txt(popList.join(', '), (v) => { const l = splitList(v); setRetenPopExclReasons(l.length ? l : RETEN_POP_EXCL_REASONS_DEFAULT); toast('Retention book updated', 'success'); mountApp(); }, { width: '360px' }), { small: true, indent: true }),
    stepRow(6, 'Remove subs with no ARR', sw(retenExclZeroPay(), () => { setRetenExclZeroPay(!retenExclZeroPay()); mountApp(); })),
    stepRow(7, 'Remove subs that never received a 2nd treatment (prior years)', sw(retenExclOneSvc(), () => { setRetenExclOneSvc(!retenExclOneSvc()); mountApp(); })),
    row('Exempt services', svcPicker(retenOneSvcExemptTerms(), (l) => { setRetenOneSvcExemptTerms(l.length ? l : ['sentricon']); toast('Exempt services saved', 'success'); mountApp(); }), { small: true, indent: true }),
    stepRow(8, 'Remove frozen subs with ≤1 service (any year)', sw(retenExclFrozenOneSvc(), () => { setRetenExclFrozenOneSvc(!retenExclFrozenOneSvc()); mountApp(); })),
    stepRow(9, 'Remove cancels with these reasons (count as retained)', [pill(n(exclReasons.size) + ' reason' + (exclReasons.size === 1 ? '' : 's')), lbtn('Edit', () => { state._cfgOpen = 'cancel'; mountApp(); setTimeout(() => { const t = document.getElementById('cfg-list-cancel'); if (t) t.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 50); })]),
  );

  // ── Auto-log from FieldRoutes (app_settings.autolog) ──
  if (state._autolog === undefined) {
    state._autolog = null;
    supabase.from('app_settings').select('value').eq('key', 'autolog').maybeSingle().then(({ data }) => {
      state._autolog = Object.assign({ enabled: false, start: '2026-01-01', types: ['Office Staff', 'Sales Rep', 'Technician'], auto_approve: true, lock_days: 90, lock_min_services: 2 }, (data && data.value) || {});
      mountApp();
    });
  }
  const AL = state._autolog;
  const saveAL = async (patch) => {
    Object.assign(AL, patch);
    const { error } = await supabase.from('app_settings').upsert({ key: 'autolog', value: AL }, { onConflict: 'key' });
    if (error) toast('Could not save: ' + error.message, 'error'); else { logActivity('config_change', { detail: 'Auto-log: ' + JSON.stringify(patch) }); toast('Saved — applies on the next sync', 'success'); }
    mountApp();
  };
  const TYPE_LABELS = [['Office Staff', 'Inside Sales'], ['Sales Rep', 'D2D'], ['Technician', 'Technicians']];
  const autolog = card('Auto-log from FieldRoutes', AL ? pill(AL.enabled ? 'on · every sync' : 'off') : pill('loading…'),
    ...(!AL ? [] : [
      row('Create sales from CRM subscriptions', sw(!!AL.enabled, () => saveAL({ enabled: !AL.enabled })), { tip: 'Every sync creates one sale per FieldRoutes subscription sold by a linked rep, with the revenue frozen at first sight. Off = reps log by hand.' }),
      row('Rep types', el('div', { class: 'flex items-center gap-3' }, ...TYPE_LABELS.map(([k, l]) => {
        const on = (AL.types || []).includes(k);
        return el('label', { class: 'inline-flex items-center gap-1 text-[11px] font-semibold cursor-pointer' },
          el('input', { type: 'checkbox', checked: on, onchange: () => saveAL({ types: on ? (AL.types || []).filter(x => x !== k) : [...(AL.types || []), k] }) }), l);
      })), { indent: true, small: true }),
      row('Start date', el('input', { type: 'date', value: String(AL.start || '').slice(0, 10), class: 'rounded-lg border px-2 py-1 text-[11px]', style: { borderColor: 'var(--border-2)', background: 'var(--card)', color: 'var(--text)' }, onchange: (e) => { if (e.target.value) saveAL({ start: e.target.value }); } }), { indent: true, small: true, tip: 'Subscriptions sold on or after this date are logged. Earlier ones are ignored.' }),
      row('Approval requires an initial appointment on the books', sw(AL.require_appt !== false, () => saveAL({ require_appt: !(AL.require_appt !== false) })), { tip: 'Every subscription is logged; auto-approval (and a payout) waits until the initial appointment is scheduled or completed.' }),
      row('… and billing on file', sw(AL.require_billing !== false, () => saveAL({ require_billing: !(AL.require_billing !== false) })), { tip: 'Customer has autopay (card or ACH) on file in FieldRoutes.' }),
      row('… and a signed agreement', sw(AL.require_signed !== false, () => saveAL({ require_signed: !(AL.require_signed !== false) })), { tip: 'A completed e-sign agreement on the subscription or the customer. The row shows ✓/✗ chips for each requirement; auto-approve waits for all the required ones.' }),
      row('Charge-upfront tier counts accounts flagged', txt(AL.upfront_flag == null ? 'Passed Audit' : AL.upfront_flag, (v) => saveAL({ upfront_flag: String(v || '').trim() }), { placeholder: 'FieldRoutes customer flag', width: '180px' }), { tip: 'The FieldRoutes customer flag that marks an account as charged upfront / passed the office audit. Accounts carrying it count toward the Charge Upfront % on the Pay tab (70%+ pays 100% of upfront commission; 50–69.9% 95%; 35–49.9% 90%; under 35% 85%). Re-checked every sync, so a flag added later still counts.' }),
      row('Failed-audit flag holds auto-approval', txt(AL.audit_fail_flag == null ? 'Failed Audit' : AL.audit_fail_flag, (v) => saveAL({ audit_fail_flag: String(v || '').trim() }), { placeholder: 'FieldRoutes customer flag', width: '180px' }), { indent: true, small: true, tip: 'Accounts carrying this flag stay in Upfront Sales for manual review instead of auto-approving. Clear the flag (or re-flag Passed) in FieldRoutes and the next sync continues the automated upfront-pay flow. Blank = no hold.' }),
      row('Upsells', sel(AL.upsells || 'manual', [['manual', 'Manual — Log Sale form'], ['auto', 'Automatic — add-on tickets in FieldRoutes']], (v) => saveAL({ upsells: v })), { tip: 'Manual: reps log upsells with the Log Sale form (today). Automatic: once RIDD sells upsells as add-on ticket items in FieldRoutes (Invoices → Add Ticket Item), every matching item becomes an upsell sale for the rep it is assigned to (or the person who added it), and the Log Sale form goes away. Flip this the day the CRM switches — no deploy.' }),
      row('Add-on services', svcPicker(AL.upsell_services || [], (l) => saveAL({ upsell_services: l })), { indent: true, small: true, tip: 'Which service types count as add-ons. Empty = any service whose name contains “add-on” or “upsell”.' }),
      row('Auto-approve upfront audit', sw(!!AL.auto_approve, () => saveAL({ auto_approve: !AL.auto_approve })), { tip: 'Approved automatically once the CRM shows the initial service completed, a signed agreement (one-time services exempt) and nothing past due. Off = an auditor clicks Approve.' }),
      row('Backend lock', [el('span', { class: 'text-[11px] text-muted-' }, 'days after sale ≥'), num(AL.lock_days, (v) => saveAL({ lock_days: Math.max(0, parseInt(v, 10) || 0) })), el('span', { class: 'text-[11px] text-muted-' }, 'and services completed ≥'), num(AL.lock_min_services, (v) => saveAL({ lock_min_services: Math.max(0, parseInt(v, 10) || 0) }))], { tip: 'Locks when both are true and the subscription is still active. A cancelled subscription becomes a chargeback instead. Payroll runs stay manual.' }),
    ]));

  // ── 4. Indicators ──
  const indicators = card('Indicators', null,
    row('MY % exclusions', svcPicker(myExcludeTerms(), (l) => { state.indicatorMyExclServiceTerms = l.length ? l : null; saveIndicatorState(); toast(l.length ? l.length + ' service' + (l.length === 1 ? '' : 's') + ' excluded from MY %' : 'Reset to the default (sentricon)', 'success'); mountApp(); })),
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
  const cxlCount = n(exclReasons.size) + ' excluded';

  return el('div', { class: 'flex flex-col gap-4' },
    el('div', { class: 'flex items-center gap-2' },
      el('h2', { class: 'text-lg font-bold' }, 'Configurations'),
      configInfoBtn('How reporting works', howItWorks())),
    reportingRules,
    autolog,
    attrition,
    indicators,
    listCard('service', 'Service Types', svcCount, reportingServiceConfigPanel),
    listCard('source', 'Sources', '', reportingSourceConfigPanel),
    listCard('cancel', 'Cancel reasons', cxlCount, reportingCancelConfigPanel),
    // The FieldRoutes source mirror (formerly its own Settings tab, per Isaac).
    el('div', { class: 'card p-4' }, adminSources()),
  );
}

// Global Admin — toggles between two views:
//   • Upload History — the two CSVs that drive the dashboards (Reporting
//     snapshot + Indicators export), side by side. They're separate files and
//     should generally be uploaded together so every tab reflects the same
//     week. Reporting snapshots are switchable/deletable; indicators history
//     is read-only (kept for record-break comparisons).
//   • App Activity — the full activity log (every logged action).
function adminUploads() {
  if (!state._adminSubTab) state._adminSubTab = 'history';
  const tab = state._adminSubTab;

  const toggle = el('div', { class: 'flex items-center gap-1 p-1 rounded-lg', style: { background: 'var(--card-2)', width: 'fit-content' } },
    // Data Integrity + Data Hygiene merged into ONE tab (per Isaac) - both
    // were "what is the data doing wrong", split for no real reason.
    ...[['history', 'Upload History'], ['activity', 'App Activity'], ['archive', 'Monthly Archive'], ['integrity', 'Data Integrity']].map(([k, label]) => el('button', {
      class: 'px-2.5 py-1 rounded-md text-[11px] font-semibold transition',
      style: tab === k
        ? { background: 'var(--card)', color: 'var(--text)', boxShadow: 'var(--shadow-sm)' }
        : { background: 'transparent', color: 'var(--text-muted)' },
      onclick: () => { state._adminSubTab = k; mountApp(); },
    }, label)),
  );

  return el('div', { class: 'flex flex-col gap-4' },
    el('div', {},
      el('h2', { class: 'text-lg font-bold' }, 'Admin'),
      el('p', { class: 'text-xs text-muted- mt-0.5' },
        'Snapshot history (synced from RevHawk) plus the app activity log.'),
    ),
    // RevHawk live data is now one click — the ↻ sync icon in the top-bar
    // header refreshes both Reporting and Indicators. (Auto-syncs nightly too.)
    el('div', { class: 'card p-3' },
      el('div', { class: 'text-sm font-semibold mb-0.5' }, 'RevHawk live data'),
      el('div', { class: 'text-[11px] text-muted-' },
        'Syncs automatically every hour on the hour during the day (8am–11pm ET) and rebuilds Reporting + Indicators each run. Resync (in the ⚙ menu) kicks the same job by hand — use it sparingly, each run is a full BigQuery scan that costs real quota.')),
    toggle,
    tab === 'activity'
      ? adminBackup()
      : tab === 'archive'
        ? monthlyArchivePanel()
        // The old 'hygiene' key still lands here, so a stale _adminSubTab
        // does not silently fall through to Upload History.
        : (tab === 'integrity' || tab === 'hygiene')
          ? el('div', { class: 'flex flex-col gap-4' }, dataIntegrityPanel(), adminDataHygiene())
          : reportingUploadsPanel(),
  );
}

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
function monthlyArchivePanel() {
  const host = el('div', { class: 'flex flex-col gap-3' });
  host.append(el('div', { class: 'text-xs text-muted-' },
    'One snapshot per closed month, written automatically by the nightly sync. History here outlives the 3-year live dataset — use it for year-over-year lookbacks.'));
  const listWrap = el('div', { class: 'card p-3 text-xs text-muted-' }, 'Loading archive…');
  const detailWrap = el('div', {});
  host.append(listWrap, detailWrap);
  const money0 = (v) => '$' + Math.round(v || 0).toLocaleString();
  const showSnap = async (name) => {
    detailWrap.innerHTML = '';
    detailWrap.append(el('div', { class: 'card p-3 text-xs text-muted-' }, 'Loading ' + name + '…'));
    try {
      const { data: blob, error } = await supabase.storage.from('reporting').download('snapshots/' + name);
      if (error) throw new Error(error.message);
      const text = (typeof DecompressionStream !== 'undefined')
        ? await new Response(blob.stream().pipeThrough(new DecompressionStream('gzip'))).text()
        : await blob.text();
      const snap = JSON.parse(text);
      const th = (lab, left) => el('th', { class: (left ? 'text-left pl-3 pr-2' : 'text-right px-2') + ' py-1.5 text-[9px] uppercase tracking-wider font-semibold', style: { color: 'var(--text-muted)', background: 'var(--card-2)' } }, lab);
      const td = (v, left, bold) => el('td', { class: (left ? 'text-left pl-3 pr-2' : 'text-right px-2') + ' py-1.5 tabular-nums' + (bold ? ' font-bold' : '') }, v);
      const row = (name2, m, bold) => el('tr', { class: 'border-t', style: { borderColor: 'var(--border)' } },
        td(name2, true, bold), td(fmt.int(m.sales), false, bold), td(money0(m.revenue), false, bold),
        td('$' + (m.acv || 0).toLocaleString(), false), td('$' + (m.avgInitial || 0).toLocaleString(), false),
        td(((m.myPct || 0) * 100).toFixed(1) + '%', false), td(((m.autoPayPct || 0) * 100).toFixed(1) + '%', false),
        td(fmt.int(m.cancelsRaw || 0), false), td(fmt.int(m.reps || 0), false));
      const section = (title, entries) => [
        el('tr', {}, el('td', { colspan: 9, class: 'pl-3 py-1.5 text-[9px] uppercase tracking-widest font-bold', style: { color: 'var(--accent)', background: 'var(--card-2)' } }, title)),
        ...entries.sort((a, b) => (b[1].revenue || 0) - (a[1].revenue || 0)).map(([k, m]) => row(k, m)),
      ];
      detailWrap.innerHTML = '';
      detailWrap.append(el('div', { class: 'card overflow-hidden' },
        el('div', { class: 'px-4 py-2.5 flex items-center justify-between border-b flex-wrap gap-2', style: { borderColor: 'var(--border)' } },
          el('div', { class: 'text-sm font-bold' }, '📚 ' + snap.period),
          el('div', { class: 'flex items-center gap-2' },
            el('span', {
              class: 'text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded',
              style: { background: 'rgba(223,100,58,.14)', color: '#DF643A' },
              title: 'Written once, on the first nightly run after the month closed, and never rewritten. Later changes to these accounts do not move these numbers.',
            }, 'Locked'),
            el('span', { class: 'text-[10px] text-muted-' }, 'captured ' + new Date(snap.generatedAt).toLocaleDateString()),
            el('button', {
              class: 'rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition hover:brightness-95',
              style: { borderColor: 'var(--border-2)', color: 'var(--text)' },
              onclick: () => {
                const a = document.createElement('a');
                a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
                a.download = 'metrics-' + snap.period + '.json';
                a.click();
              },
            }, '⬇ JSON'))),
        el('div', { class: 'scroll-x', style: { maxHeight: '480px', overflowY: 'auto' } },
          el('table', { class: 'w-full text-[11px]' },
            el('thead', {}, el('tr', {}, th('Scope', true), th('Sales'), th('Revenue'), th('ACV'), th('Avg Init'), th('MY %'), th('APay'), th('Cancels*'), th('Reps'))),
            el('tbody', {},
              row('RIDD · Company', snap.company, true),
              ...section('By Office', Object.entries(snap.byOffice || {})),
              ...section('By Department', Object.entries(snap.byDept || {}))))),
        el('div', { class: 'px-4 py-2 text-[10px]', style: { color: 'var(--text-subtle)', borderTop: '1px solid var(--border)' } },
          '*Cancels = raw cancel dates as of capture time (attrition matures after month close). Per-rep totals are inside the JSON download.')));
    } catch (e) {
      detailWrap.innerHTML = '';
      detailWrap.append(el('div', { class: 'card p-3 text-xs', style: { color: '#DC2626' } }, 'Could not load ' + name + ' — ' + (e.message || e)));
    }
  };
  (async () => {
    try {
      const { data, error } = await supabase.storage.from('reporting').list('snapshots', { limit: 1000 });
      if (error) throw new Error(error.message);
      const files = (data || []).filter(f => /^metrics-\d{4}-\d{2}\.json\.gz$/.test(f.name)).sort((a, b) => b.name.localeCompare(a.name));
      listWrap.innerHTML = '';
      if (!files.length) {
        listWrap.append(el('span', {}, 'No snapshots yet — the next nightly sync backfills every closed month in the dataset automatically.'));
        return;
      }
      // One dropdown instead of a wall of chips - this list only grows.
      listWrap.className = 'card p-3 flex items-center gap-2 flex-wrap';
      const _perOf = (f) => f.name.replace('metrics-', '').replace('.json.gz', '');
      const _label = (per) => new Date(per + '-01T00:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
      listWrap.append(
        el('span', { class: 'text-[10px] uppercase tracking-widest text-muted- font-bold' }, 'Month'),
        el('select', {
          class: 'rounded-xl px-2.5 py-1 text-[11px] font-medium cursor-pointer',
          style: { borderColor: 'var(--border-2)', background: 'var(--card)', color: 'var(--text)' },
          onchange: (e) => showSnap(e.target.value),
        }, ...files.map((f, i) => el('option', { value: f.name, selected: i === 0 },
          _label(_perOf(f)) + (i === 0 ? '  (latest)' : '')))),
        el('span', { class: 'text-[11px] text-muted-' },
          files.length + ' month' + (files.length === 1 ? '' : 's') + ' archived, back to ' + _label(_perOf(files[files.length - 1]))));
      showSnap(files[0].name);   // newest closed month opens by default
    } catch (e) {
      listWrap.innerHTML = '';
      listWrap.append(el('span', { style: { color: '#DC2626' } }, 'Archive list failed — ' + (e.message || e)));
    }
  })();
  return host;
}

// Indicators upload history — each row is one Indicators CSV import. The most
// recent is the live data behind the Indicators tab; older entries are kept
// for "records broken since last upload" comparisons. Read-only (no per-row
// activate/delete — there's a single live indicators dataset, not switchable
// snapshots like the reporting side).
function indicatorsUploadsPanel() {
  const snaps = [...(state._indicatorSnapshots || [])].reverse(); // newest first
  const liveAt = state.indicatorsUploadedAt || null;
  return el('div', { class: 'card p-4' },
    el('h2', { class: 'text-lg font-bold mb-1' }, 'Indicators Uploads'),
    el('p', { class: 'text-xs text-muted- mb-4' },
      'Each row is an Indicators CSV import. The newest is the live data behind the Indicators tab; older imports are retained for record-break comparisons.'),
    snaps.length === 0
      ? el('div', { class: 'p-8 text-center text-sm text-muted-' },
          'No indicators uploads yet. Upload the Indicators CSV from the Indicators tab.')
      : el('div', { class: 'rounded-lg border', style: { borderColor: 'var(--border)', maxHeight: '440px', overflowY: 'auto' } },
          el('table', { class: 'w-full text-sm' },
            el('thead', { class: 'text-[10px] uppercase tracking-wider', style: { background: 'var(--card-2)', color: 'var(--text-muted)', position: 'sticky', top: '0', zIndex: '10' } },
              el('tr', {},
                el('th', { class: 'text-left pl-4 pr-2 py-2.5 font-semibold' }, 'Filename'),
                el('th', { class: 'text-left px-2 py-2.5 font-semibold' }, 'Uploaded'),
                el('th', { class: 'text-right pr-4 pl-2 py-2.5 font-semibold', style: { width: '90px' } }, ''),
              ),
            ),
            el('tbody', {},
              ...snaps.map((s, i) => {
                const isLive = i === 0 && (!liveAt || s.uploadedAt === liveAt);
                return el('tr', { class: 'border-t', style: { borderColor: 'var(--border)', background: isLive ? 'rgba(223,100,58,.08)' : 'transparent' } },
                  el('td', { class: 'pl-4 pr-2 py-2.5' },
                    el('div', { class: 'font-medium' }, s.fileName || '(no filename)'),
                    isLive && el('div', { class: 'text-[10px] uppercase tracking-wider font-semibold mt-0.5', style: { color: 'var(--accent)' } }, 'Active'),
                  ),
                  el('td', { class: 'px-2 py-2.5 text-xs text-muted-' },
                    s.uploadedAt ? new Date(s.uploadedAt).toLocaleString() : ''),
                  el('td', { class: 'pr-4 pl-2 py-2.5 text-right text-xs text-muted-' },
                    isLive ? 'current' : timeAgo(s.uploadedAt)),
                );
              }),
            ),
          ),
        ),
  );
}

// ── Placeholder settings sections (filled in later as needed) ──
function adminGoals() {
  // One set of goals per department (per Isaac, Sep 22): Office Staff is the
  // company goal everything already reads; Door to Door and Technicians are
  // their own objects (same cards, own storage) to be configured from here.
  const dept = GOAL_DEPTS.find(d => d.id === state._goalDept) || GOAL_DEPTS[0];
  const g = deptGoalObj(dept.id);
  g.amount         = g.amount         ?? 0;
  g.new_amount     = g.new_amount     ?? Math.round(g.amount * 0.75);
  g.renewal_amount = g.renewal_amount ?? Math.round(g.amount * 0.25);
  g.is_reps        = g.is_reps        ?? 5;   // Inside Sales reps (carry the NEW quota)
  g.loyalty_reps   = g.loyalty_reps   ?? 4;   // Loyalty reps (carry the RENEWAL quota)
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
        goalTargetCard(dept.lines.b, g.renewal_amount, ytd.renewal, (val) => reseed('renewal', val))),
      el('div', { class: 'grid grid-cols-2 gap-4 mt-4 max-w-md' },
        goalRepCountField(dept.reps.a, g.is_reps, (v) => { g.is_reps = Math.max(1, parseInt(v) || 1); persist(); mountApp(); }),
        goalRepCountField(dept.reps.b, g.loyalty_reps, (v) => { g.loyalty_reps = Math.max(1, parseInt(v) || 1); persist(); mountApp(); }))),

    // ── Monthly seasonal allocation (with per-rep) ──
    goalMonthlyCard(g, persist, dept),

    // ── Quarterly per-rep quotas ──
    goalQuarterlyCard(g, dept),
  );
}

function goalRepCountField(label, val, onCommit) {
  return el('label', { class: 'block' },
    el('span', { class: 'text-[10px] uppercase tracking-widest text-muted- font-semibold block mb-1' }, label),
    el('input', { type: 'number', min: '1', step: '1', value: val,
      class: 'w-full rounded-lg border px-2.5 py-1 text-[11px] font-bold text-left', style: { borderColor: 'var(--border-2)' },
      onchange: (e) => onCommit(e.target.value) }));
}

// Quarterly rollup with per-rep quota (quarterly amount ÷ rep count) — matches
// the Inside Sales / Loyalty quota blocks in the RIDD quota sheet.
function goalQuarterlyCard(g, dept) {
  dept = dept || GOAL_DEPTS[0];
  const usd = (n) => '$' + Math.round(n || 0).toLocaleString();
  const block = (title, qAmts, reps) => {
    const yr = qAmts.reduce((a, b) => a + (b || 0), 0);
    const td = (v, bold) => el('td', { class: 'px-3 py-1.5 text-left tabular-nums' + (bold ? ' font-bold' : '') }, v);
    return el('div', { class: 'mb-1' },
      el('div', { class: 'text-xs font-bold uppercase tracking-wider px-3 py-1.5', style: { background: 'var(--text)', color: 'var(--bg)' } }, title + ' · ' + reps + ' reps'),
      // Fixed column layout, identical in both blocks, so Q1–Total line up vertically across Inside Sales and Loyalty (per Isaac, Sep 22).
      el('table', { class: 'w-full text-xs', style: { tableLayout: 'fixed' } },
        el('colgroup', {}, el('col', { style: { width: '22%' } }), ...[1, 2, 3, 4, 5].map(() => el('col', { style: { width: '15.6%' } }))),
        el('thead', { class: 'text-[10px] uppercase tracking-wider text-left', style: { color: 'var(--text-muted)' } },
          el('tr', {}, el('th', { class: 'text-left px-3 py-2 font-semibold' }, ''), ...['Q1','Q2','Q3','Q4','Total'].map(q => el('th', { class: 'text-left px-3 py-2 font-semibold' }, q)))),
        el('tbody', {},
          el('tr', { class: 'border-t', style: { borderColor: 'var(--border)' } },
            el('td', { class: 'px-3 py-1.5 text-left font-semibold' }, 'Quarterly %'),
            ...qAmts.map(a => td(yr > 0 ? Math.round(a / yr * 100) + '%' : '0%')), td('100%')),
          el('tr', { class: 'border-t', style: { borderColor: 'var(--border)' } },
            el('td', { class: 'px-3 py-1.5 text-left font-semibold' }, 'Quarterly amount'),
            ...qAmts.map(a => td(usd(a))), td(usd(yr), true)),
          el('tr', { class: 'border-t', style: { borderColor: 'var(--border)', background: 'rgba(223,100,58,.06)' } },
            el('td', { class: 'px-3 py-1.5 text-left font-semibold' }, 'Per-rep quota'),
            ...qAmts.map(a => td(usd(reps > 0 ? a / reps : 0), true)), td(usd(reps > 0 ? yr / reps : 0), true)))));
  };
  return el('div', { class: 'card p-4' },
    el('h3', { class: 'text-sm font-bold mb-3' }, 'Quarterly quotas'),
    el('div', { class: 'rounded-lg border overflow-x-auto', style: { borderColor: 'var(--border)' } },
      block(dept.blocks.a, g.quarterly_new, g.is_reps),
      block(dept.blocks.b, g.quarterly_renewal, g.loyalty_reps)));
}

// Monthly allocation grid — New + Renewal editable per month, Total computed.
// This is what the IS pacer / dashboard / Marketing read for projections.
function goalMonthlyCard(g, persist, dept) {
  dept = dept || GOAL_DEPTS[0];
  const lineA = dept.blocks.a, lineB = dept.blocks.b;
  const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const usd = (n) => '$' + Math.round(n || 0).toLocaleString();
  const curM = new Date().getMonth();
  const cell = (arr, m) => el('input', {
    type: 'text', inputmode: 'numeric', value: Math.round(arr[m] || 0).toLocaleString(),
    class: 'w-24 text-left text-[11px] rounded border px-2.5 py-1 tabular-nums', style: { borderColor: 'var(--border-2)' },
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
      type: 'text', inputmode: 'decimal', value: pct.toFixed(1),
      class: 'w-16 text-left text-[11px] rounded border px-2.5 py-1 tabular-nums', style: { borderColor: 'var(--border-2)' },
      onchange: (e) => { reshapeCurve(arr, m, (parseFloat(e.target.value.replace(/[^0-9.]/g, '')) || 0) / 100); persist(); mountApp(); },
    });
  };
  const totNew = g.monthly_new.reduce((a, b) => a + (b || 0), 0);
  const totRen = g.monthly_renewal.reduce((a, b) => a + (b || 0), 0);
  const isReps = Math.max(1, g.is_reps || 1), loyReps = Math.max(1, g.loyalty_reps || 1);
  return el('div', { class: 'card p-4' },
    el('div', { class: 'flex items-center justify-between flex-wrap gap-2 mb-3' },
      el('h3', { class: 'text-sm font-bold' }, 'Monthly allocation'),
      el('button', { class: 'text-[11px] rounded px-2.5 py-1 border', style: { borderColor: 'var(--border-2)', color: 'var(--text-muted)' },
        onclick: () => { g.monthly_new = IS_SEASONAL.map(s => Math.round(g.new_amount * s)); g.monthly_renewal = IS_RENEWAL_SEASONAL.map(s => Math.round(g.renewal_amount * s)); persist(); mountApp(); } },
        '↻ Reset to default curve')),
    // Transposed (per Isaac, Sep 22): months across the top, one row per line
    // — the curve reads left-to-right as a curve. Inputs stay editable in place.
    el('div', { class: 'rounded-lg border overflow-x-auto', style: { borderColor: 'var(--border)' } },
      el('table', { class: 'text-xs', style: { minWidth: '100%', borderCollapse: 'collapse' } },
        el('thead', { class: 'text-[10px] uppercase tracking-wider text-left', style: { background: 'var(--card-2)', color: 'var(--text-muted)' } },
          el('tr', {}, el('th', { class: 'text-left px-3 py-2 font-semibold whitespace-nowrap', style: { position: 'sticky', left: 0, background: 'var(--card-2)', zIndex: 1 } }, ''),
            ...M.map((lbl, m) => el('th', { class: 'text-left px-3 py-2 font-semibold whitespace-nowrap', style: m === curM ? { color: 'var(--accent)' } : {} }, lbl + (m === curM ? ' ·' : ''))),
            el('th', { class: 'text-left px-3 py-2 font-semibold whitespace-nowrap', style: { borderLeft: '2px solid var(--border)' } }, 'Year'))),
        el('tbody', {},
          ...[
            [lineA + ' curve %', (m) => curveCell(g.monthly_new, m),                        '100%',                 false],
            [lineA,           (m) => cell(g.monthly_new, m),                             usd(totNew),            true],
            [lineA + ' /rep', (m) => usd((g.monthly_new[m] || 0) / isReps),               usd(totNew / isReps),   false],
            [lineB + ' curve %', (m) => curveCell(g.monthly_renewal, m),                  '100%',                 false],
            [lineB,           (m) => cell(g.monthly_renewal, m),                         usd(totRen),            true],
            [lineB + ' /rep', (m) => usd((g.monthly_renewal[m] || 0) / loyReps),         usd(totRen / loyReps),  false],
            ['Total',         (m) => usd((g.monthly_new[m] || 0) + (g.monthly_renewal[m] || 0)), usd(totNew + totRen), true],
          ].map(([label, cellOf, yearVal, bold], ri) => el('tr', { class: 'border-t', style: { borderColor: 'var(--border)', background: label === 'Total' ? 'var(--card-2)' : 'transparent', borderTop: label === 'Total' ? '2px solid var(--border)' : undefined } },
            el('td', { class: 'px-3 py-1.5 text-left font-semibold whitespace-nowrap', style: { position: 'sticky', left: 0, background: label === 'Total' ? 'var(--card-2)' : 'var(--card)', zIndex: 1 } }, label),
            ...M.map((lbl, m) => el('td', { class: 'px-3 py-1.5 text-left tabular-nums whitespace-nowrap' + (bold && typeof cellOf(m) === 'string' ? ' font-semibold' : ''), style: m === curM ? { background: 'rgba(223,100,58,.06)' } : {} }, cellOf(m))),
            el('td', { class: 'px-3 py-1.5 text-left tabular-nums font-bold whitespace-nowrap', style: { borderLeft: '2px solid var(--border)' } }, yearVal)))))));
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

function quarterlyMilestonesCard(title, goalObj, key, annualTarget, persist, readOnly = false) {
  const qLabels = ['Q1', 'Q2', 'Q3', 'Q4'];
  const arr = goalObj[key];

  // If read-only, recompute from new + renewal each quarter
  if (readOnly && goalObj.quarterly_new && goalObj.quarterly_renewal) {
    for (let i = 0; i < 4; i++) {
      arr[i] = (goalObj.quarterly_new[i] || 0) + (goalObj.quarterly_renewal[i] || 0);
    }
  }

  const sum = arr.reduce((a, b) => a + b, 0);
  const match = Math.round(sum) === Math.round(annualTarget);

  return el('div', { class: 'card p-5' },
    el('div', { class: 'flex items-center gap-3 mb-3 flex-wrap' },
      el('h3', { class: 'text-sm font-bold' }, title),
      el('div', { class: 'text-xs' },
        el('span', { class: 'text-muted-' }, 'Sum: '),
        el('strong', {}, fmt.usd0(sum)),
        match
          ? el('span', { class: 'ml-1.5', style: { color: 'var(--accent)' } }, '✓')
          : el('span', { class: 'text-amber-500 ml-1.5' }, '≠ ' + fmt.usd0(annualTarget)),
      ),
    ),
    el('div', { class: 'grid grid-cols-2 sm:grid-cols-4 gap-3' },
      ...qLabels.map((label, i) => el('label', { class: 'block' },
        el('span', { class: 'text-[10px] uppercase tracking-widest text-muted- block mb-1 font-semibold' }, label),
        readOnly
          ? el('div', { class: 'rounded-lg border px-3 py-2 text-sm text-left font-semibold tabular-nums', style: { background: 'var(--bg-subtle)', color: 'var(--text-muted)' } },
              '$' + Math.round(arr[i]).toLocaleString(),
            )
          : el('div', { class: 'relative' },
              el('span', { class: 'absolute left-3 top-1/2 -translate-y-1/2 text-muted- text-sm' }, '$'),
              el('input', {
                type: 'text',
                inputmode: 'numeric',
                class: 'w-full rounded-lg border pl-7 pr-3 py-2 text-sm text-left',
                value: Math.round(arr[i]),
                onchange: (e) => {
                  arr[i] = parseFloat(e.target.value.replace(/[^0-9.]/g, '')) || 0;
                  // Recompute total quarterly from new + renewal
                  if (goalObj.quarterly_new && goalObj.quarterly_renewal) {
                    for (let j = 0; j < 4; j++) {
                      goalObj.quarterly[j] = (goalObj.quarterly_new[j] || 0) + (goalObj.quarterly_renewal[j] || 0);
                    }
                    goalObj.amount = goalObj.quarterly.reduce((a, b) => a + b, 0);
                  }
                  persist(); mountApp();
                },
              }),
            ),
      )),
    ),
  );
}

// Sources admin — add a new lead/renewal source, hide one without losing
// the history it produced. Hidden sources drop out of the Sales Log
// dropdown but still resolve on existing sales (so old rows keep showing
// their source name). No delete on purpose — hide is the safe equivalent.
function adminSources() {
  // Always alphabetical regardless of visibility — hidden rows just dim
  // in place so an admin's eye doesn't have to track the row jumping
  // sections when they toggle.
  const sorted = [...state.sources].sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  // FieldRoutes mirror facts — the RevHawk sync stamps every CRM-linked row
  // each run, so the newest fr_synced_at is "when we last checked the CRM".
  const frLinked = state.sources.filter(s => s.fr_source_id);
  const frStampRaw = frLinked.reduce((m, s) => ((s.fr_synced_at || '') > m ? s.fr_synced_at : m), '');
  const frStamp = frStampRaw
    ? new Date(frStampRaw).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' ET'
    : null;
  const frChip = (s) => s.fr_source_id
    ? el('span', {
        class: 'text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ml-2 align-middle whitespace-nowrap',
        style: { background: 'rgba(95,108,91,.12)', color: '#5F6C5B', border: '1px solid rgba(95,108,91,.25)' },
        title: 'Mirrored from FieldRoutes (source ID ' + s.fr_source_id + '). Add or hide it in FieldRoutes and the change lands here within ~30 min.',
      }, 'FieldRoutes')
    : el('span', {
        class: 'text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ml-2 align-middle whitespace-nowrap',
        style: { background: 'rgba(220,38,38,.10)', color: '#DC2626', border: '1px solid rgba(220,38,38,.25)' },
        title: 'Not found in the FieldRoutes source list — hidden from the Sales Log automatically. Past sales that used it are unaffected.',
      }, 'Not in CRM');

  return el('div', { class: 'flex flex-col gap-5' },
    el('h2', { class: 'text-xl font-bold' }, 'Sources'),
    el('p', { class: 'text-xs text-muted-' },
      'Read-only mirror of the FieldRoutes source list, refreshed by the hourly sync — add or hide sources in FieldRoutes and verify here. ' +
      'Every CRM source is shown, visible and hidden alike; visible ones feed the Source dropdown on the Sales Log. ' +
      'Anything no longer in FieldRoutes is hidden automatically (past sales keep showing whatever they were logged with).'),

    // List
    el('div', { class: 'card overflow-hidden' },
      el('div', { class: 'flex items-center justify-between px-4 py-3 border-b border-' },
        el('h3', { class: 'text-sm font-bold' }, 'All Sources'),
        el('div', { class: 'text-[11px] text-muted- text-right' },
          state.sources.filter(s => s.is_active !== false).length + ' visible · ' +
          state.sources.filter(s => s.is_active === false).length + ' hidden · ' +
          frLinked.length + ' from FieldRoutes',
          frStamp
            ? el('div', { class: 'text-[10px]', style: { color: 'var(--text-subtle)' } }, 'Last CRM check ' + frStamp)
            : el('div', { class: 'text-[10px]', style: { color: 'var(--text-subtle)' } }, 'CRM sync pending — runs hourly'),
        ),
      ),
      el('table', { class: 'w-full text-sm' },
        el('thead', { class: 'text-[9px] uppercase tracking-wider text-muted-' },
          el('tr', { style: { background: 'var(--card-2)' } },
            el('th', { class: 'text-left pl-4 pr-2 py-2 font-semibold' }, 'Source'),
            el('th', { class: 'text-left px-2 py-2 font-semibold' }, 'Type'),
            el('th', { class: 'text-left px-2 py-2 font-semibold' }, 'Visibility'),
            el('th', { class: 'text-left pr-4 pl-2 py-2 font-semibold' }, 'Pay tab'),
          ),
        ),
        el('tbody', {},
          ...(sorted.length === 0
            ? [el('tr', {}, el('td', { class: 'px-4 py-6 text-center text-xs text-muted- italic', colspan: 4 }, 'No sources yet — the FieldRoutes sync fills this in automatically (runs every 30 min).'))]
            : sorted.map(s => {
                const isHidden = s.is_active === false;
                return el('tr', {
                  class: 'border-t border-',
                  style: isHidden ? { opacity: '0.55' } : {},
                },
                  el('td', { class: 'pl-4 pr-2 py-2.5 font-medium' }, s.name, frChip(s)),
                  el('td', { class: 'px-2 py-2.5' },
                    s.is_renewal
                      ? el('span', { class: 'text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded', style: { background: 'rgba(223,100,58,.16)', color: '#DF643A' } }, 'Renewal')
                      : el('span', { class: 'text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded', style: { background: 'var(--card-2)', color: 'var(--text-muted)', border: '1px solid var(--border)' } }, 'New'),
                  ),
                  el('td', { class: 'px-2 py-2.5 text-left' },
                    el('span', {
                      class: 'inline-block rounded-lg px-3 py-1.5 text-[11px] font-bold',
                      style: isHidden
                        ? { background: 'var(--card-2)', color: 'var(--text-muted)', border: '1px solid var(--border)' }
                        : { background: 'rgba(223,100,58,.16)', color: '#DF643A', border: '1px solid rgba(223,100,58,.3)' },
                      title: 'Managed in FieldRoutes — hide or show it there and it updates here within ~30 min.',
                    }, isHidden ? 'Hidden' : 'Visible'),
                  ),
                  el('td', { class: 'pr-4 pl-2 py-2.5 text-left' }, (() => {
                    const off = !!payHiddenSources()[s.id];
                    return el('button', {
                      class: 'inline-block rounded-lg px-3 py-1.5 text-[11px] font-bold transition hover:brightness-95',
                      style: off
                        ? { background: 'var(--card-2)', color: 'var(--text-muted)', border: '1px solid var(--border)' }
                        : { background: 'rgba(61,122,102,.16)', color: '#5F6C5B', border: '1px solid rgba(61,122,102,.3)' },
                      title: off ? 'Hidden from the Pay tab\u2019s By Source grid \u2014 sales on it still pay and show flagged. Click to show.' : 'Shown on the Pay tab\u2019s By Source grid. Click to hide.',
                      onclick: () => togglePayHiddenSource(s.id),
                    }, off ? 'Hidden on Pay' : 'On Pay');
                  })()),
                );
              })),
        ),
      ),
    ),
  );
}

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
    class: 'rounded-lg border px-2 py-1 text-xs w-full ' + (o.text ? '' : 'text-right tabular-nums font-semibold'),
    style: { borderColor: 'transparent', background: 'transparent', color: o.muted ? 'var(--text-muted)' : 'var(--text)' },
    onfocus: (e) => { e.target.style.borderColor = 'var(--accent)'; e.target.style.background = 'var(--card)'; },
    onblur: (e) => { e.target.style.borderColor = 'transparent'; e.target.style.background = 'transparent'; onCommit(e.target.value); },
    onkeydown: (e) => { if (e.key === 'Enter') e.target.blur(); } });
  const ladderTable = (tiers, onChange, opts = {}) => {
    const body = el('tbody');
    const draw = () => body.replaceChildren(...tiers.map((t, i) => el('tr', { class: 'border-t', style: { borderColor: 'var(--border)' } },
      el('td', { class: 'px-3 py-1', style: { width: '90px' } }, cell(t[0], (v) => { t[0] = num(v); onChange(); draw(); })),
      el('td', { class: 'px-3 py-1', style: { width: '150px' } }, cell(money(t[1]), (v) => { t[1] = num(v); onChange(); draw(); })),
      el('td', { class: 'px-3 py-1' }, cell(t[2] || '', (v) => { t[2] = v.trim(); onChange(); }, { text: true, placeholder: '—', muted: true })),
      el('td', { class: 'px-3 py-1 text-right tabular-nums font-bold text-[13px]', style: { width: '140px' } }, money(t[0] / 100 * t[1])),
      el('td', { class: 'px-1 py-1 text-right', style: { width: '32px' } }, opts.readonly ? null : el('button', { class: 'text-xs px-1.5', style: { color: 'var(--text-subtle)' }, title: 'Remove tier', onclick: () => { tiers.splice(i, 1); onChange(); draw(); } }, '×')))));
    draw();
    return el('div', { class: 'card overflow-hidden' },
      el('table', { class: 'w-full' },
        el('thead', {}, el('tr', { class: 'text-[10px] uppercase tracking-widest font-semibold', style: { color: 'var(--text-subtle)', background: 'var(--card-2)' } },
          el('th', { class: 'px-3 py-2 text-right' }, 'Rate %'), el('th', { class: 'px-3 py-2 text-right' }, 'Retained revenue'), el('th', { class: 'px-3 py-2 text-left' }, 'Unlocks'), el('th', { class: 'px-3 py-2 text-right' }, 'Est. earnings'), el('th', {}))),
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
      ...ps.order.map(id => el('option', { value: id, selected: L && L.scale === id }, ps.scales[id].label + ' · ' + ps.scales[id].requirement)));
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
    el('label', { class: 'flex items-center gap-2 text-[11px] font-semibold' }, 'Requirement', el('input', { type: 'text', value: cur.requirement, class: 'rounded-lg border px-2 py-1 text-[11px]', style: { borderColor: 'var(--border-2)', background: 'var(--card)', color: 'var(--text)', width: '110px' }, onchange: (e) => { cur.requirement = e.target.value.trim(); saveD2dPayscales(ps); } })),
    el('label', { class: 'flex items-center gap-2 text-[11px] font-semibold' }, 'Retained by', el('input', { type: 'text', value: ps.deadline, class: 'rounded-lg border px-2 py-1 text-[11px]', style: { borderColor: 'var(--border-2)', background: 'var(--card)', color: 'var(--text)', width: '120px' }, onchange: (e) => { ps.deadline = e.target.value.trim(); saveD2dPayscales(ps); } })),
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
        style: { borderBottom: on ? '2px solid var(--accent)' : '2px solid transparent', color: on ? 'var(--text)' : 'var(--text-muted)', marginBottom: '-1px' },
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
      : adminD2dPayscales();   // Sales Reps: the four payscale ladders + per-rep assignment (per Isaac)

  return el('div', { class: 'flex flex-col gap-4' },
    el('div', {},
      el('h2', { class: 'text-lg font-bold' }, 'Commissions'),
      el('p', { class: 'text-xs text-muted-' }, isOfficeStaff
        ? 'Inside Sales pay rules for Office Staff — these drive the Pay tab and the Commission Calculator. Sales Reps and Technicians use the CRM pest/bundle model on their tabs.'
        : type === 'Sales Rep'
          ? 'Sales Rep payscales \u2014 the Rookie / Veteran / Elite / Pro ladders (rate by retained revenue). Pick a rep to put them on a ladder or give them their own.'
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
    { label: 'Charge Upfront %', unit: '%', hint: 'Share of the upfront commission paid at the top charge-upfront tier.',
      get: () => (s.upfront_tiers[0] || {}).pay, set: (v) => { if (s.upfront_tiers[0]) s.upfront_tiers[0].pay = v; },
      oget: () => (ov.upfront_tiers || [])[0] && ov.upfront_tiers[0].pay, oset: (v) => { ov.upfront_tiers = (ov.upfront_tiers || s.upfront_tiers.map(t => ({ ...t }))); ov.upfront_tiers[0].pay = v; }, oeff: () => (eff().upfront_tiers[0] || {}).pay },
    { label: 'Upfront Tier', unit: '%+', hint: '% of commissionable accounts charged upfront to reach the top tier.',
      get: () => (s.upfront_tiers[0] || {}).min, set: (v) => { if (s.upfront_tiers[0]) s.upfront_tiers[0].min = v; },
      oget: () => (ov.upfront_tiers || [])[0] && ov.upfront_tiers[0].min, oset: (v) => { ov.upfront_tiers = (ov.upfront_tiers || s.upfront_tiers.map(t => ({ ...t }))); ov.upfront_tiers[0].min = v; }, oeff: () => (eff().upfront_tiers[0] || {}).min },
    ...((s.upfront_tiers || []).slice(1).map((t, i) => ({ label: 'Upfront Tier ' + (i + 2) + ' (≥ ' + t.min + '%)', unit: '%', hint: 'Pays this % of the upfront commission at ≥ ' + t.min + '% charged upfront.',
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

function adminPricing(opts = {}) {
  // Seeds sheet-aligned defaults (incl. renewal flat pay, backend rates,
  // close-rate tiers) and runs the one-time 7%→sheet-rates migration.
  // opts.embedded → omit the standalone "Pricing" heading so this can be
  // dropped inside the Office Staff tab of Settings → Commissions.
  const s = ensurePaySettings();

  // Commission rates per contract type (exclude Commercial + Paid in Full — those are separate overrides)
  const validCtIds = new Set(state.contractTypes.map(ct => ct.id));
  if (!s.contract_commissions) {
    s.contract_commissions = state.contractTypes.map(ct => ({ contract_type_id: ct.id, name: ct.name, rate: 7.0 }));
  } else {
    s.contract_commissions = s.contract_commissions.filter(cc => validCtIds.has(cc.contract_type_id));
  }

  // Below minimums multiplier (applied to the contract rate)
  s.below_min_multiplier = s.below_min_multiplier ?? 50; // 50% = half commission

  // Commercial + Paid in Full override rates (override the contract type base rate when checked)
  s.commercial_multiplier = s.commercial_multiplier ?? 50;   // % of the rep's own upfront rate
  s.paid_in_full_rate = s.paid_in_full_rate ?? 7.0;

  const persist = () => { saveDemoData(); saveAppSettings(); };

  return el('div', { class: 'flex flex-col gap-5 max-w-4xl w-full commission-config' },
    opts.embedded ? null : el('h2', { class: 'text-xl font-bold' }, 'Pricing'),

    // ── Status-based pay rules ──
    el('div', { class: 'card p-5' },
      el('h3', { class: 'text-sm font-bold mb-1' }, 'Pay by Status'),
      el('p', { class: 'text-xs text-muted- mb-3' }, 'How audit status affects commission payout.'),
      el('div', { class: 'flex flex-col gap-2' },
        el('div', { class: 'flex items-center gap-4 py-2 border-b', style: { borderColor: 'var(--border)' } },
          el('div', {},
            el('div', { class: 'text-sm font-semibold' }, 'Serviced'),
            el('div', { class: 'text-xs text-muted-' }, 'Full commission — account has been audited and serviced'),
          ),
          el('div', { class: 'text-sm font-bold', style: { color: 'var(--accent)' } }, '100%'),
        ),
        el('div', { class: 'flex items-center gap-4 py-2 border-b', style: { borderColor: 'var(--border)' } },
          el('div', {},
            el('div', { class: 'text-sm font-semibold' }, 'Below Minimums'),
            el('div', { class: 'text-xs text-muted-' }, 'Reduced commission — account audited but below service minimums'),
          ),
          el('div', { class: 'flex items-center gap-1' },
            el('input', {
              type: 'text',
              inputmode: 'numeric',
              class: 'rounded-lg border px-2.5 py-1 text-[11px] font-bold w-16 text-left',
              value: s.below_min_multiplier,
              onchange: e => { s.below_min_multiplier = parseFloat(e.target.value.replace(/[^0-9.]/g, '')) || 0; persist(); },
            }),
            el('span', { class: 'text-sm text-muted-' }, '%'),
          ),
        ),
        el('div', { class: 'flex items-center gap-4 py-2' },
          el('div', {},
            el('div', { class: 'text-sm font-semibold' }, 'NSF / Cancelled / Not Payable'),
            el('div', { class: 'text-xs text-muted-' }, 'No commission paid'),
          ),
          el('div', { class: 'text-sm font-bold text-muted-' }, '0%'),
        ),
      ),
    ),

    // ── Paid in Full (sheet O32: contract base + flat modifier) ──
    el('div', { class: 'card p-5' },
      el('div', { class: 'flex items-center gap-4' },
        el('div', {},
          el('h3', { class: 'text-sm font-bold' }, 'Paid in Full Modifier'),
          el('p', { class: 'text-xs text-muted- mt-0.5' },
            'Added on top of the contract-type base when Paid in Full is checked \u2014 base 7% + 5 = 12% on any term. PIF accounts still earn the multi-year + close-rate backend at quarter end.'),
        ),
        el('div', { class: 'flex items-center gap-1 shrink-0 ml-4' },
          el('span', { class: 'text-sm text-muted-' }, '+'),
          el('input', {
            type: 'text', inputmode: 'numeric',
            class: 'rounded-lg border px-2.5 py-1 text-[11px] font-bold w-16 text-left',
            value: s.pif_modifier ?? 5,
            onchange: e => { s.pif_modifier = parseFloat(e.target.value.replace(/[^0-9.]/g, '')) || 0; persist(); },
          }),
          el('span', { class: 'text-sm text-muted-' }, 'pts'),
        ),
      ),
    ),

    // ── Commercial override ──
    el('div', { class: 'card p-5' },
      el('div', { class: 'flex items-center gap-4' },
        el('div', {},
          el('h3', { class: 'text-sm font-bold' }, 'Commercial Override'),
          el('p', { class: 'text-xs text-muted- mt-0.5' }, 'When the "Commercial" box is checked on a sale, the rep earns this share of THEIR OWN upfront % (a 7% rep at 50% pays 3.5%; an 8% rep pays 4%). Typically for accounts with ACV > $2,000 on commercial properties.'),
        ),
        el('div', { class: 'flex items-center gap-1 shrink-0 ml-4' },
          el('input', {
            type: 'text', inputmode: 'numeric',
            class: 'rounded-lg border px-2.5 py-1 text-[11px] font-bold w-16 text-left',
            value: s.commercial_multiplier,
            onchange: e => { s.commercial_multiplier = parseFloat(e.target.value.replace(/[^0-9.]/g, '')) || 0; persist(); },
          }),
          el('span', { class: 'text-sm text-muted-' }, '% of rep upfront'),
        ),
      ),
    ),

    // ── Charge Upfront Tier (sheet O29-O31) ──
    el('div', { class: 'card p-5' },
      el('h3', { class: 'text-sm font-bold mb-1' }, 'Charge Upfront Tier'),
      el('p', { class: 'text-xs text-muted- mb-3' },
        'The share of a rep\u2019s commissionable accounts (serviced + below-min; renewals and upsells don\u2019t count) marked \u201cCharged Upfront\u201d sets what percent of their WHOLE upfront commission pays out.'),
      el('div', { class: 'flex flex-col' },
        ...(s.upfront_tiers || []).map((t, i) => el('div', { class: 'flex items-center gap-4 py-1.5 text-xs', style: { borderTop: i ? '1px solid var(--border)' : 'none' } },
          el('span', { class: 'flex items-center gap-1 text-muted-' },
            '\u2265',
            el('input', {
              type: 'text', inputmode: 'numeric',
              class: 'rounded-lg border px-2.5 py-1 text-[11px] font-bold w-14 text-left',
              value: t.min,
              onchange: e => { t.min = parseFloat(e.target.value.replace(/[^0-9.]/g, '')) || 0; persist(); },
            }),
            '% collected upfront'),
          el('span', { class: 'flex items-center gap-1' },
            'pays',
            el('input', {
              type: 'text', inputmode: 'numeric',
              class: 'rounded-lg border px-2.5 py-1 text-[11px] font-bold w-14 text-left',
              value: t.pay,
              onchange: e => { t.pay = parseFloat(e.target.value.replace(/[^0-9.]/g, '')) || 0; persist(); },
            }),
            el('b', {}, '%'), ' of upfront pay')))),
    ),

    // ── Commission by Contract Type ──
    el('div', { class: 'card p-5' },
      el('h3', { class: 'text-sm font-bold mb-1' }, 'Commission by Contract Type'),
      el('p', { class: 'text-xs text-muted- mb-3' },
        'Base upfront commission rate per contract type. The per-rep Commission Bump (in Users) is added on top.',
      ),
      el('div', { class: 'flex flex-col gap-2' },
        el('div', { class: 'grid grid-cols-[1.5fr_1fr] gap-2 text-[10px] uppercase tracking-widest text-muted- font-semibold px-1' },
          el('div', {}, 'Contract Type'),
          el('div', {}, 'Base Rate'),
        ),
        ...s.contract_commissions.map(cc => el('div', { class: 'grid grid-cols-[1.5fr_1fr] gap-2 items-center' },
          el('div', { class: 'text-sm py-2 px-1' }, cc.name),
          el('div', { class: 'relative' },
            el('input', {
              type: 'text',
              inputmode: 'numeric',
              class: 'w-full rounded-lg border pl-3 pr-7 py-2 text-sm',
              value: cc.rate,
              onchange: e => { cc.rate = parseFloat(e.target.value.replace(/[^0-9.]/g, '')) || 0; persist(); },
            }),
            el('span', { class: 'absolute right-3 top-1/2 -translate-y-1/2 text-muted- text-sm' }, '%'),
          ),
        )),
      ),
    ),

    // ── Renewal Pay (flat $/account by contract term) ──
    el('div', { class: 'card p-5' },
      el('h3', { class: 'text-sm font-bold mb-1' }, 'Renewal Pay'),
      el('p', { class: 'text-xs text-muted- mb-3' },
        'Sources tagged "Renewal" in Settings → Sources pay a flat amount per serviced account instead of a % of revenue. Below Minimums pays half. Any new source you add is standard (%) unless you tag it as a renewal.',
      ),
      el('div', { class: 'grid grid-cols-2 sm:grid-cols-4 gap-3' },
        ...[
          ['m12', '12 Months'], ['m18', '18 Months'], ['m24', '24 Months'], ['pif', 'Paid in Full'],
        ].map(([key, label]) => el('div', {},
          el('div', { class: 'text-[10px] uppercase tracking-widest text-muted- font-semibold mb-1' }, label),
          el('div', { class: 'relative' },
            el('span', { class: 'absolute left-3 top-1/2 -translate-y-1/2 text-muted- text-sm' }, '$'),
            el('input', {
              type: 'text', inputmode: 'numeric',
              class: 'w-full rounded-lg border pl-7 pr-3 py-2 text-sm text-left',
              value: s.renewal_flat[key],
              onchange: e => { s.renewal_flat[key] = parseFloat(e.target.value.replace(/[^0-9.]/g, '')) || 0; persist(); },
            }),
          ),
        )),
      ),
    ),

    // ── Backend Pay rates ──
    el('div', { class: 'card p-5' },
      el('h3', { class: 'text-sm font-bold mb-1' }, 'Backend Pay'),
      el('p', { class: 'text-xs text-muted- mb-3' },
        'Quarter-end backend rates. Multi-year applies to 18/24-month contracts from standard sources; renewal backend applies to serviced revenue from renewal sources. Paid-in-Full accounts earn no backend.',
      ),
      el('div', { class: 'grid grid-cols-1 sm:grid-cols-3 gap-3' },
        ...[
          ['multi_year_rate_18',   '18-Month Backend'],
          ['multi_year_rate_24',   '24-Month Backend'],
          ['renewal_backend_rate', 'Renewal Backend'],
        ].map(([key, label]) => el('div', {},
          el('div', { class: 'text-[10px] uppercase tracking-widest text-muted- font-semibold mb-1' }, label),
          el('div', { class: 'relative' },
            el('input', {
              type: 'text', inputmode: 'numeric',
              class: 'w-full rounded-lg border pl-3 pr-7 py-2 text-sm text-left',
              value: s[key],
              onchange: e => { s[key] = parseFloat(e.target.value.replace(/[^0-9.]/g, '')) || 0; persist(); },
            }),
            el('span', { class: 'absolute right-3 top-1/2 -translate-y-1/2 text-muted- text-sm' }, '%'),
          ),
        )),
      ),
    ),

    // ── Close Rate Bonus tiers ──
    el('div', { class: 'card p-5' },
      el('h3', { class: 'text-sm font-bold mb-1' }, 'Close Rate Bonus'),
      el('p', { class: 'text-xs text-muted- mb-3' },
        'Quarter-end bonus on subscription revenue (12/18/24/PIF from standard sources). The highest tier the rep’s close rate reaches wins; below every tier pays $0.',
      ),
      el('div', { class: 'flex flex-col gap-2' },
        el('div', { class: 'grid grid-cols-[1fr_1fr] gap-2 text-[10px] uppercase tracking-widest text-muted- font-semibold px-1' },
          el('div', {}, 'Close Rate ≥'),
          el('div', {}, 'Bonus Rate'),
        ),
        ...s.close_rate_tiers.map(t => el('div', { class: 'grid grid-cols-[1fr_1fr] gap-2 items-center' },
          el('div', { class: 'relative' },
            el('input', {
              type: 'text', inputmode: 'numeric',
              class: 'w-full rounded-lg border pl-3 pr-7 py-2 text-sm text-left',
              value: t.min_close_rate,
              onchange: e => { t.min_close_rate = parseFloat(e.target.value.replace(/[^0-9.]/g, '')) || 0; persist(); },
            }),
            el('span', { class: 'absolute right-3 top-1/2 -translate-y-1/2 text-muted- text-sm' }, '%'),
          ),
          el('div', { class: 'relative' },
            el('input', {
              type: 'text', inputmode: 'numeric',
              class: 'w-full rounded-lg border pl-3 pr-7 py-2 text-sm text-left',
              value: t.rate,
              onchange: e => { t.rate = parseFloat(e.target.value.replace(/[^0-9.]/g, '')) || 0; persist(); },
            }),
            el('span', { class: 'absolute right-3 top-1/2 -translate-y-1/2 text-muted- text-sm' }, '%'),
          ),
        )),
      ),
    ),

  );
}



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
