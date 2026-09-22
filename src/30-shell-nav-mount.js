// ┌─ src/30-shell-nav-mount.js ─────────────────────────────────────────────────────
// │ App shell: Inside Sales / D2D / Technician tab groups, nav menu, mountApp() view dispatch, My Settings, telemetry.
// │ Part of the app.js bundle (tools/bundle.js concatenates src/*.js in name order).
// └────────────────────────────────────────────────────────────────────────
// RIDD spider mark — the brand guide's bug vector (same path as favicon.svg). Brand orange in both the header and the favicon — reads on light and dark tabs alike (per Isaac).
const RIDD_SPIDER_PATH = 'M87.36 117.39 L87.36 100.86 C87.35 100.74 87.34 100.59 87.34 100.44 L87.34 94.85 C87.34 94.5 87.08 94.21 86.73 94.17 L81.17 94.17 C80.79 94.2 80.51 94.51 80.51 94.91 L80.51 100.55 C80.51 104.86 77 108.36 72.68 108.36 L37.24 108.36 C32.93 108.36 29.42 104.86 29.42 100.55 L29.42 94.91 C29.42 94.51 29.13 94.2 28.74 94.17 L23.16 94.17 C22.84 94.21 22.59 94.51 22.59 94.85 L22.56 117.39 L0.78 117.39 L0.78 86.91 L4.29 86.81 L14.54 86.81 C14.92 86.81 15.22 86.51 15.22 86.13 L15.22 67.03 L0 67.03 L0 45.64 L28.77 45.64 C29.14 45.64 29.45 45.33 29.45 44.96 L29.45 37.81 L19.38 32.52 C16.97 31.25 15.47 28.77 15.47 26.05 L15.44 0 L37.23 0 L37.23 16.09 L46.07 20.86 C49.01 22.45 50.83 25.5 50.83 28.81 L50.83 45.25 C50.83 49.53 47.34 53.02 43.05 53.02 L37.49 53.02 C37.1 53.02 36.79 53.33 36.79 53.72 L36.78 86.07 C36.78 86.48 37.11 86.81 37.52 86.81 L72.41 86.81 C72.82 86.81 73.15 86.48 73.15 86.07 L73.15 60.41 C73.08 59.96 73.07 59.53 73.07 59.28 L73.07 53.7 C73.07 53.32 72.76 53.02 72.39 53.02 L66.8 53.02 C62.52 53.02 59.03 49.53 59.03 45.25 L59.03 28.81 C59.03 25.5 60.85 22.46 63.77 20.87 L73.01 15.88 L73.01 0 L94.8 0 L94.79 25.83 C94.79 28.56 93.29 31.04 90.88 32.31 L80.41 37.81 L80.41 44.96 C80.41 45.33 80.71 45.64 81.09 45.64 L109.16 45.64 L109.16 67.03 L94.7 67.03 L94.7 86.13 C94.7 86.51 95.01 86.81 95.38 86.81 L109.15 86.81 L109.15 117.39 L87.36 117.39 Z';
// RIDDMADE wordmark — the single-path SVG from Cam's design kit
// (marks/riddmade-wordmark.svg), fill = currentColor so it takes the ink of
// whatever it sits on. Never carries a period as part of the mark.
const RIDDMADE_WORDMARK_PATHS = ["M0,26.72V0h27.66c6.62,0,11.91,2.15,11.91,9.83,0,6.07-3.8,8.93-9.44,9.56l-.71.08,1.88.98,8.31,6.27h-13.21l-8.46-6.66h-7.37v6.66H0ZM10.58,12.23h15.91c1.49,0,2.12-.39,2.12-1.57,0-1.37-.63-1.65-2.12-1.65h-15.91v3.21Z", "M41.77,26.72V0h10.58v26.72h-10.58Z", "M55.48,26.72V0h27.82c8.35,0,15.05,2.82,15.05,13.32s-6.82,13.4-15.05,13.4h-27.82ZM66.06,17.71h16.18c3.49,0,5.13-.35,5.13-4.39s-1.65-4.31-5.13-4.31h-16.18v8.7Z", "M100.69,26.72V0h27.82c8.35,0,15.05,2.82,15.05,13.32s-6.82,13.4-15.05,13.4h-27.82ZM111.27,17.71h16.18c3.49,0,5.13-.35,5.13-4.39s-1.65-4.31-5.13-4.31h-16.18v8.7Z", "M145.91,26.72V0h12.85l13.79,18.06L186.35,0h12.62v26.72h-10.58v-14.15l-10.58,14.15h-10.74l-10.58-14.18v14.18h-10.58Z", "M231.33,22.3h-16.34l-2.55,4.43h-12.7L216.16,0h14.15l16.42,26.72h-12.85l-2.55-4.43ZM227.17,15.05l-4-6.94-4.04,6.94h8.03Z", "M247.5,26.72V0h27.82c8.35,0,15.05,2.82,15.05,13.32s-6.82,13.4-15.05,13.4h-27.82ZM258.08,17.71h16.18c3.49,0,5.13-.35,5.13-4.39s-1.65-4.31-5.13-4.31h-16.18v8.7Z", "M292.72,26.72V0h36.52v8.23h-25.94v1.76h25.2v6.66h-25.2v1.84h25.94v8.23h-36.52Z"];
// Brand (generalization, Sep 22 2026): a company can set RIDD_CONFIG.BRAND =
// { WORDMARK_TEXT, WORDMARK_SVG: { viewBox, paths:[…] }, MARK_SVG: { viewBox, paths:[…] }, EXTERNAL_LINK: { label, url } }.
// Nothing set = the RIDDMADE wordmark and spider mark below, exactly as before.
function _brand() { try { return (window.RIDD_CONFIG && window.RIDD_CONFIG.BRAND) || {}; } catch (e) { return {}; } }
function riddmadeWordmark(width, opts = {}) {
  const NS = 'http://www.w3.org/2000/svg';
  const B = _brand();
  if (B.WORDMARK_TEXT && !B.WORDMARK_SVG) { const d = document.createElement('div'); d.className = 'font-display'; d.style.fontSize = Math.round(width / 6) + 'px'; d.style.lineHeight = '1'; d.textContent = B.WORDMARK_TEXT; return d; }
  const s = document.createElementNS(NS, 'svg');
  if (B.WORDMARK_SVG && Array.isArray(B.WORDMARK_SVG.paths)) {
    const [, , vw, vh] = String(B.WORDMARK_SVG.viewBox || '0 0 329.24 26.72').split(/\s+/).map(Number);
    s.setAttribute('viewBox', B.WORDMARK_SVG.viewBox); s.setAttribute('width', width); s.setAttribute('height', Math.round(width * vh / vw));
    s.setAttribute('fill', 'currentColor'); s.setAttribute('role', 'img'); s.setAttribute('aria-label', opts.label || B.WORDMARK_TEXT || CFG.COMPANY_NAME);
    for (const d of B.WORDMARK_SVG.paths) { const p = document.createElementNS(NS, 'path'); p.setAttribute('d', d); s.append(p); }
    s.style.display = 'block'; return s;
  }
  s.setAttribute('viewBox', '0 0 329.24 26.72'); s.setAttribute('width', width); s.setAttribute('height', Math.round(width * 26.72 / 329.24));
  s.setAttribute('fill', 'currentColor'); s.setAttribute('role', 'img'); s.setAttribute('aria-label', opts.label || 'RIDDMADE');
  for (const d of RIDDMADE_WORDMARK_PATHS) { const p = document.createElementNS(NS, 'path'); p.setAttribute('d', d); s.append(p); }
  s.style.display = 'block';
  return s;
}
function riddSpiderMark(px) { const B = _brand(); if (B.MARK_SVG && Array.isArray(B.MARK_SVG.paths)) { const NS = 'http://www.w3.org/2000/svg'; const s = document.createElementNS(NS, 'svg'); s.setAttribute('viewBox', B.MARK_SVG.viewBox || '0 0 100 100'); s.setAttribute('width', px); s.setAttribute('height', px); s.setAttribute('aria-hidden', 'true'); s.setAttribute('fill', 'currentColor'); for (const d of B.MARK_SVG.paths) { const p = document.createElementNS(NS, 'path'); p.setAttribute('d', d); s.append(p); } return s; }
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', '0 0 109.2 117.4'); s.setAttribute('width', px); s.setAttribute('height', px); s.setAttribute('aria-hidden', 'true'); const p = document.createElementNS('http://www.w3.org/2000/svg', 'path'); p.setAttribute('d', RIDD_SPIDER_PATH); p.setAttribute('fill', '#DF643A'); s.append(p); s.style.display = 'block'; return s; }
// ── Inside Sales consolidated tab ─────────────────────────────────────────
// The seven rep-facing views live under ONE "Inside Sales" nav entry; the
// individual views render with a Reporting-style sub-tab bar above them.
// Views/hashes/permissions are untouched — this is purely a nav grouping.
const INSIDE_SALES_TABS = [
  ['dashboard',    'Dashboard'],
  ['sales',        'Sales'],
  ['pay',          'Pay'],
  ['scorecards',   'Scorecards'],
  ['calendar',     'Calendar'],
  // 'competitions' sub-tab hidden — comps live on the top-level Competitions
  // tab now. The VIEW stays reachable (deep links / legacy hash) via the key
  // set below, it just doesn't render a sub-tab button anymore.
  ['hall_of_fame', 'Hall of Fame'],
];
const INSIDE_SALES_TAB_KEYS = new Set([...INSIDE_SALES_TABS.map(([k]) => k), 'competitions']);
// ── D2D SALES GROUP (per Isaac) — the door-to-door mirror of the Inside
// Sales world: Dashboard (war room on CRM D2D rows) · Sales (accounts list)
// · Pay (the commission calculator / My Commission, now a sub-tab).
const D2D_SALES_TABS = [
  ['d2d_dashboard', 'Dashboard'],
  ['d2d_sales',     'Sales'],
  ['commission',    'Pay'],
];
const D2D_SALES_TAB_KEYS = new Set(D2D_SALES_TABS.map(([k]) => k));
// ── TECHNICIAN GROUP (per Isaac, Sep 2026) — same shape: Dashboard + the
// auto-logged Sales queue (Upfront / Pending Backend Lock / Archived / History).
const TECH_TABS = [
  ['techs',      'Dashboard'],
  ['tech_sales', 'Sales'],
  ['tech_pay',   'Pay'],
];
const TECH_TAB_KEYS = new Set(TECH_TABS.map(([k]) => k));
// Which Sales queue a view shows — rows carry queue_type from the sync
// ('office' | 'd2d' | 'tech'); legacy manual rows (null) are Inside Sales.
const SALES_QUEUE_OF_VIEW = { sales: 'office', d2d_sales: 'd2d', tech_sales: 'tech' };
// Sales access — who gets the full Inside Sales group. Sellers (rep /
// admin_rep, incl. loyalty reps via rep_type) and admins see everything;
// auditors only need the Sales tab so they can audit sales. Everything
// else (Dashboard/leaderboard, Pay, Scorecards, Calendar, Competitions,
// Hall of Fame) is hidden from them.
function insideSalesTabsFor(role) {
  let tabs = INSIDE_SALES_TABS.filter(([k]) => viewFeatureOn(k));   // feature switches (RIDD_CONFIG.FEATURES)
  // Settings → Permissions decides the sub-tabs per role (defaults = the old hardcoded lists).
  if (!isAdminRole(role)) tabs = tabs.filter(([k]) => !VIEW_TAB_PERM[k] || userCan(VIEW_TAB_PERM[k]));
  return tabs;
}
// Admin-only segmented toggle between the two halves of "Sales":
// Inside Sales (office) ⇄ D2D Sales (the commission calculator). Reps never
// see it — their rep type decides which half IS their Sales tab.
function salesModeToggle(mode) {
  if (!isAdminRole(state.profile?.role)) return null;
  const btn = (m, label) => el('button', {
    class: 'sales-mode-btn px-2.5 py-1 text-[11px] font-bold transition',
    style: mode === m ? { background: 'var(--accent)', color: 'var(--accent-text)' } : { color: 'var(--text-muted)' },
    onclick: () => {
      if (m === mode) return;
      const target = m === 'd2d'
        ? (D2D_SALES_TAB_KEYS.has(state._lastD2dTab) ? state._lastD2dTab : 'd2d_dashboard')
        : m === 'techs'
          ? 'techs'
          : (INSIDE_SALES_TAB_KEYS.has(state._lastIsTab) && state._lastIsTab !== 'competitions' ? state._lastIsTab : 'dashboard');
      state.view = target;
      history.replaceState(null, '', VIEW_TO_HASH[target] || '#' + target);
      mountApp();
    },
  }, label);
  return el('div', { class: 'sales-mode-toggle inline-flex rounded-lg border overflow-hidden mr-2 shrink-0', style: { borderColor: 'var(--border-2)' } },
    btn('inside', 'Office Staff'), btn('d2d', 'D2D Sales'), btn('techs', 'Technicians'));   // 'Office Staff' matches FieldRoutes (per Isaac)
}
function insideSalesSubTabs() {
  const tabs = insideSalesTabsFor(state.profile?.role);
  // A one-tab bar is just noise — auditors land straight on Sales.
  if (tabs.length < 2) return null;
  const go = (k) => { state.view = k; state._navChosen = true; history.replaceState(null, '', VIEW_TO_HASH[k] || '#' + k); mountApp(); };
  // Desktop: static tab bar. Mobile: the tabs wrapped onto two cramped rows
  // and fought the Inside/D2D toggle for space — consolidated into ONE
  // dropdown that shows the current tab and jumps on select.
  const tabBar = el('div', { class: 'hidden sm:flex items-center flex-wrap gap-x-1 gap-y-0' },
    ...tabs.map(([k, label]) => {
      const active = state.view === k;
      return el('button', {
        class: 'px-2.5 py-1 text-[11px] font-semibold transition whitespace-nowrap',
        style: {
          borderBottom: active ? '2px solid var(--accent)' : '2px solid transparent',
          color: active ? 'var(--text)' : 'var(--text-muted)',
          marginBottom: '-1px',
        },
        onclick: () => go(k),
      }, label);
    }));
  const tabSelect = el('div', { class: 'sales-tab-select sm:hidden flex-1 min-w-0 py-1.5' },
    el('select', {
      class: 'w-full rounded-lg border px-2.5 py-1 text-[11px] font-bold',
      style: { borderColor: 'var(--border-2)', background: 'var(--card)', color: 'var(--text)' },
      onchange: (e) => go(e.target.value),
    }, ...tabs.map(([k, label]) => el('option', { value: k, selected: state.view === k }, label))));
  return el('div', { class: 'sales-subtabs flex items-center flex-wrap gap-x-1 gap-y-0 border-b mb-4', style: { borderColor: 'var(--border)' } },
    salesModeToggle('inside'),
    tabBar,
    tabSelect);
}
// D2D counterpart — same bar, same mobile dropdown consolidation, with the
// admin Inside/D2D/Techs toggle riding in front.
function d2dSalesSubTabs(mode) {
  const tabs = (mode === 'techs' ? TECH_TABS : D2D_SALES_TABS).filter(([k]) => viewFeatureOn(k))
    .filter(([k]) => isAdminRole(state.profile?.role) || !VIEW_TAB_PERM[k] || userCan(VIEW_TAB_PERM[k]));   // Settings → Permissions
  const go = (k) => { state.view = k; state._navChosen = true; history.replaceState(null, '', VIEW_TO_HASH[k] || '#' + k); mountApp(); };
  const tabBar = el('div', { class: 'hidden sm:flex items-center flex-wrap gap-x-1 gap-y-0' },
    ...tabs.map(([k, label]) => {
      const active = state.view === k;
      return el('button', {
        class: 'px-2.5 py-1 text-[11px] font-semibold transition whitespace-nowrap',
        style: {
          borderBottom: active ? '2px solid var(--accent)' : '2px solid transparent',
          color: active ? 'var(--text)' : 'var(--text-muted)',
          marginBottom: '-1px',
        },
        onclick: () => go(k),
      }, label);
    }));
  const tabSelect = el('div', { class: 'sales-tab-select sm:hidden flex-1 min-w-0 py-1.5' },
    el('select', {
      class: 'w-full rounded-lg border px-2.5 py-1 text-[11px] font-bold',
      style: { borderColor: 'var(--border-2)', background: 'var(--card)', color: 'var(--text)' },
      onchange: (e) => go(e.target.value),
    }, ...tabs.map(([k, label]) => el('option', { value: k, selected: state.view === k }, label))));
  return el('div', { class: 'sales-subtabs flex items-center flex-wrap gap-x-1 gap-y-0 border-b mb-4', style: { borderColor: 'var(--border)' } },
    salesModeToggle(mode === 'techs' ? 'techs' : 'd2d'),
    tabBar,
    tabSelect);
}

// ── Independent section re-render ─────────────────────────────────────────
// Lets a chart/section repaint just itself instead of triggering a full
// mountApp(). A section is wrapped via indSection(id, build): the builder is
// remembered, and refreshIndSection(id) rebuilds only that section's host
// (destroying any Chart.js instances first so canvases don't leak). Inside a
// section's own builder we shadow `mountApp` with refreshIndSection so every
// local control (toggles, pickers, sorts) updates only that card.
const _indSectionBuilders = {};
function indSection(id, build) {
  _indSectionBuilders[id] = build;
  const host = el('div', { 'data-indsection': id });
  host.append(build());
  return host;
}
function refreshIndSection(id) {
  const build = _indSectionBuilders[id];
  const host = document.querySelector('[data-indsection="' + CSS.escape(id) + '"]');
  if (!build || !host) { mountApp(); return; }   // fallback if not mounted
  if (window.Chart && Chart.getChart) {
    host.querySelectorAll('canvas').forEach(c => { const ch = Chart.getChart(c); if (ch) ch.destroy(); });
  }
  host.innerHTML = '';
  host.append(build());
  if (typeof fitCardNumbers === 'function') requestAnimationFrame(fitCardNumbers);
}

// ── White-screen safety net ────────────────────────────────────────────────
// A crash anywhere inside a render used to leave the page blank with the only
// clue buried in the console. Wrap every mountApp call: log the crash and show
// the standard error screen (with its reload path) instead of a white page.
// (Function declarations hoist, so `mountApp` is already bound here; rebinding
// the name routes every later call site through the guard.)
{
  const _mountAppInner = () => mountApp; // capture lazily to dodge TDZ ordering
  let _wrapped = false;
  setTimeout(() => {
    if (_wrapped) return; _wrapped = true;
    const inner = _mountAppInner();
    mountApp = function () {
      try { return inner.apply(this, arguments); }
      catch (err) {
        console.error('[ridd] render crashed', err);
        try { mountError(err); }
        catch (e2) {
          document.body.innerHTML = '<div style="padding:32px;font-family:system-ui,sans-serif"><h2 style="margin:0 0 8px">Something broke while rendering</h2><pre style="white-space:pre-wrap;color:#b91c1c">' + String((err && err.message) || err).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])) + '</pre><button onclick="location.reload()" style="margin-top:12px;padding:8px 14px;cursor:pointer">Reload</button></div>';
        }
      }
    };
  }, 0);
}
// ── My Settings (non-admin gear) ──────────────────────────────────────────
// The gear sits in the SAME header spot for every role — admins land on the
// full Settings page, everyone else gets this focused sheet: personal goal
// (sellers only), change password, sign out.
// Fire-and-forget Slack DM to a user (their ⚙ My Settings opt-in decides
// whether it actually sends). Callers never await or block on this.
function notifySlack(userId, text) {
  try {
    if (DEMO || !userId || !text || !state.session) return;
    fetch('/api/slack-dm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (state.session.access_token || '') },
      body: JSON.stringify({ user_id: userId, text }),
    }).catch(() => { /* best-effort */ });
  } catch (e) { /* never block the caller */ }
}
function openMySettingsModal() {
  const p = state.profile || {};
  // Annual goal is set by admins in Edit User (per Isaac); Slack DMs are an
  // office-staff feature — sellers and partners don't see either section.
  const officeStaff = (typeof isOfficeStaffProfile === 'function') ? isOfficeStaffProfile(p) : (typeof isOfficeStaffRole === 'function' && isOfficeStaffRole(p.role));
  const overlay = el('div', { class: 'modal-overlay' });
  const close = () => { overlay.remove(); document.removeEventListener('keydown', key); };
  const key = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', key);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  const secLabel = (t) => el('div', { class: 'text-[10px] uppercase tracking-widest font-semibold', style: { color: 'var(--text-subtle)' } }, t);

  // ── Slack notifications (per Isaac) — every user can opt in. Member ID
  // comes from Slack: profile → ⋮ → Copy member ID. Writes own row only
  // via the set_my_slack RPC (slack_notify.sql). ──
  const slackId = el('input', {
    type: 'text', value: p.slack_member_id || '', placeholder: 'Slack Member ID, e.g. U0123ABCD',
    class: 'flex-1 rounded-lg border px-2.5 py-1 text-[11px]', style: { minWidth: '0' },
  });
  const slackOn = el('input', { type: 'checkbox', class: 'cursor-pointer' });
  slackOn.checked = !!p.slack_notify;
  const slackBtn = el('button', {
    class: 'rounded-lg px-2.5 py-1 text-[11px] font-bold transition hover:brightness-95 whitespace-nowrap',
    style: { background: 'var(--accent)', color: 'var(--accent-text)' },
    onclick: async () => {
      try {
        const { error } = await supabase.rpc('set_my_slack', { member_id: slackId.value.trim(), notify: !!slackOn.checked });
        if (error) throw error;
        state.profile.slack_member_id = slackId.value.trim() || null;
        state.profile.slack_notify = !!slackOn.checked;
        toast(slackOn.checked ? 'Slack notifications ON' : 'Slack notifications off', 'success');
        if (slackOn.checked && slackId.value.trim()) notifySlack(p.id, '\ud83d\udc4b You\u2019re wired up \u2014 RIDD app notifications will land here.');
      } catch (err) {
        toast(/set_my_slack/.test(String(err.message)) ? 'An admin needs to run slack_notify.sql in Supabase first' : (err.message || 'Save failed'), 'error');
      }
    },
  }, 'Save');
  const slackSection = el('div', { class: 'flex flex-col gap-2' },
    secLabel('Slack notifications'),
    el('label', { class: 'flex items-center gap-2 text-sm cursor-pointer' }, slackOn,
      el('span', {}, 'DM me app notifications (audit results and more)')),
    el('div', { class: 'flex items-center gap-2' }, slackId, slackBtn),
    el('div', { class: 'text-[10px]', style: { color: 'var(--text-subtle)' } },
      'Find your Member ID in Slack: your profile \u2192 \u22ee \u2192 Copy member ID. A test DM confirms the hookup.'));

  // ── Change password — same policy + live checklist as the reset screen. ──
  const pw1 = el('input', { type: 'password', placeholder: 'New password', autocomplete: 'new-password', class: 'w-full rounded-lg border px-2.5 py-1 text-[11px]' });
  const pw2 = el('input', { type: 'password', placeholder: 'Confirm new password', autocomplete: 'new-password', class: 'w-full rounded-lg border px-2.5 py-1 text-[11px]' });
  const policyList = el('div', { class: 'flex flex-col gap-1 text-[11px]' },
    ...PASSWORD_POLICY.map(r => el('div', { 'data-req': r.label, style: { color: 'var(--text-subtle)', transition: 'color .15s' } }, '○ ' + r.label)));
  pw1.addEventListener('input', () => {
    PASSWORD_POLICY.forEach(r => {
      const row = policyList.querySelector('[data-req="' + r.label + '"]');
      if (!row) return;
      const ok = r.test(pw1.value);
      row.textContent = (ok ? '✓ ' : '○ ') + r.label;
      row.style.color = ok ? '#DF643A' : 'var(--text-subtle)';
    });
  });
  const pwBtn = el('button', {
    class: 'rounded-lg px-2.5 py-1 text-[11px] font-bold border transition hover:brightness-95',
    style: { borderColor: 'var(--border-2)', color: 'var(--text)' },
    onclick: async (e) => {
      const btn = e.currentTarget;
      const missing = passwordPolicyErrors(pw1.value);
      if (missing.length) { toast('Password needs: ' + missing.join(' · ').toLowerCase(), 'error'); return; }
      if (pw1.value !== pw2.value) { toast('Passwords don\'t match', 'error'); return; }
      if (DEMO) { toast('Demo mode — password would be updated in production', 'info'); return; }
      btn.disabled = true; btn.textContent = 'Updating…';
      try {
        // Same guard as the reset screen: the SDK's cross-tab auth lock can
        // stall updateUser silently (app open in another tab) — surface a
        // clear retry message instead of an eternal "Updating…".
        const { error } = await Promise.race([
          supabase.auth.updateUser({ password: pw1.value }),
          new Promise((_, rej) => setTimeout(
            () => rej(new Error('Taking too long — close other tabs with the app open and try again.')), 12000)),
        ]);
        if (error) throw error;
        pw1.value = ''; pw2.value = '';
        pw1.dispatchEvent(new Event('input'));
        toast('Password updated', 'success');
      } catch (err) {
        toast(err.message || 'Password update failed', 'error');
      } finally { btn.disabled = false; btn.textContent = 'Update Password'; }
    },
  }, 'Update Password');

  const card = el('div', { class: 'card w-full max-w-sm overflow-hidden flex flex-col' },
    el('div', { class: 'flex items-center justify-between px-5 pt-5 pb-3' },
      el('div', {},
        el('h2', { class: 'text-lg font-bold' }, 'My Settings'),
        el('div', { class: 'text-[11px]', style: { color: 'var(--text-muted)' } },
          (p.full_name || '') + ' · ' + roleLabel(p.role))),
      el('button', { class: 'text-2xl leading-none text-muted-', 'aria-label': 'Close', title: 'Close', style: { color: 'var(--text-muted)' }, onclick: close }, '×')),
    el('div', { class: 'px-5 pb-5 flex flex-col gap-5' },
      el('div', { class: 'flex flex-col gap-2' },
        secLabel('Time Zone'),
        el('select', {
          class: 'w-full rounded-lg border px-2.5 py-1 text-[11px]',
          style: { borderColor: 'var(--border-2)', background: 'var(--card)', color: 'var(--text)' },
          onchange: (e) => { setUserTzPref(e.target.value); toast('Time zone updated', 'success'); scheduleBackgroundRemount(); },
        }, ...USER_TZ_CHOICES.map(([v, label]) => el('option', { value: v, selected: userTzPref() === v }, label))),
        el('div', { class: 'text-[10px]', style: { color: 'var(--text-subtle)' } },
          'Affects time displays like Today\u2019s Sales. Auto = Mountain (Utah) for office staff; D2D sale times always show in the selling office\u2019s local time.')),
      officeStaff ? slackSection : null,
      el('div', { class: 'flex flex-col gap-2' },
        secLabel('Change Password'),
        pw1, pw2, policyList, pwBtn),
      el('div', { class: 'flex flex-col gap-2' },
        secLabel('Get the App on Your Phone'),
        (() => {
          const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent || '');
          const standalone = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true;
          if (standalone) {
            return el('div', { class: 'text-xs', style: { color: 'var(--text-muted)' } }, '✓ Installed — you\'re running RIDD from your home screen.');
          }
          if (window._riddInstallEvt) {
            return el('button', {
              class: 'rounded-lg px-2.5 py-1 text-[11px] font-bold border transition hover:brightness-95 self-start',
              style: { borderColor: 'var(--accent)', color: 'var(--accent)' },
              onclick: async (e) => {
                const evt = window._riddInstallEvt;
                window._riddInstallEvt = null;
                e.currentTarget.disabled = true;
                try { evt.prompt(); } catch { /* user dismissed */ }
              },
            }, 'Install on Device');
          }
          return el('div', { class: 'text-xs', style: { color: 'var(--text-muted)', lineHeight: '1.5' } },
            isIOS
              ? 'On iPhone: open this page in Safari, tap the Share button, then "Add to Home Screen" — RIDD installs like a real app.'
              : 'Open this page in Chrome or Edge and use the browser\'s "Install app" option (⋮ menu) to put RIDD on your home screen.');
        })()),
      el('div', { class: 'pt-3 border-t flex' , style: { borderColor: 'var(--border)' } },
        el('button', {
          class: 'text-xs font-semibold transition hover:underline',
          style: { color: '#DC2626' },
          onclick: async () => { if (DEMO) { location.href = location.pathname; return; } await supabase.auth.signOut(); },
        }, 'Sign out'))));
  overlay.append(card);
  document.body.append(overlay);
}

// ═══ PER-USER PAGE LAYOUT — 🔧 edit mode (per Isaac) ═══════════════════
// EVERY user can reshape ANY tab into their own view: in edit mode each
// top-level section grows a handle (↑ move up · ↓ move down · ✕ hide, ＋
// bring back). Layouts persist per user + per tab on this device and apply
// on every render. Fixed bars (and their spacers) are locked in place.
function _userLayoutKey() {
  const uid = (state.profile && state.profile.id) || 'anon';
  return 'ridd_layout_v1::' + uid + '::' + state.view;
}
function _userLayoutPrefs() {
  try {
    const p = JSON.parse(localStorage.getItem(_userLayoutKey()) || 'null');
    if (p && typeof p === 'object') return { order: Array.isArray(p.order) ? p.order : [], hidden: Array.isArray(p.hidden) ? p.hidden : [] };
  } catch { /* fresh */ }
  return { order: [], hidden: [] };
}
function _saveUserLayoutPrefs(p) {
  try { localStorage.setItem(_userLayoutKey(), JSON.stringify(p)); } catch { /* private mode */ }
  if (typeof pushUserPrefsSoon === 'function') pushUserPrefsSoon();
}
function applyUserLayout(root) {
  const kids = [...root.children];
  if (!kids.length) return;
  // Stable-ish keys: explicit data-section / id wins, else the position.
  const keyOf = (n, i) => (n.dataset && n.dataset.section) ? 's:' + n.dataset.section : (n.id ? 'i:' + n.id : 'n:' + i);
  const isLocked = (n) => !!(n.querySelector && (n.querySelector('#indFixedBar') || n.querySelector('#indBarSpacer')));
  const entries = kids.map((n, i) => ({ n, key: keyOf(n, i), locked: isLocked(n) }));
  const editable = entries.filter(e => !e.locked);
  if (!editable.length) return;
  const prefs = _userLayoutPrefs();
  const byKey = new Map(editable.map(e => [e.key, e]));
  const orderedEditable = [
    ...prefs.order.map(k => byKey.get(k)).filter(Boolean),
    ...editable.filter(e => !prefs.order.includes(e.key)),
  ];
  // Locked nodes hold their slots; editable slots refill from the queue.
  let qi = 0;
  entries.map(e => e.locked ? e.n : orderedEditable[qi++].n).forEach(n => root.append(n));
  const finalKeys = orderedEditable.map(e => e.key);
  const hidden = new Set(prefs.hidden.filter(k => byKey.has(k)));
  const save = (order, hiddenArr) => { _saveUserLayoutPrefs({ order, hidden: hiddenArr }); mountApp(); };
  orderedEditable.forEach((e, idx) => {
    const isHid = hidden.has(e.key);
    if (!state._editMode) {
      if (isHid) e.n.style.display = 'none';
      return;
    }
    if (!e.n.style.position) e.n.style.position = 'relative';
    e.n.style.outline = '2px dashed ' + (isHid ? '#A9441F' : 'var(--accent)');
    e.n.style.outlineOffset = '2px';
    e.n.style.opacity = isHid ? '.35' : '';
    const mk = (glyph, title, onclick, disabled) => el('button', {
      class: 'cursor-pointer',
      style: { minWidth: '26px', height: '26px', borderRadius: '0', border: 'none', background: 'var(--text)', color: 'var(--bg)', fontSize: glyph.length > 1 ? '10px' : '12px', fontWeight: '900', opacity: disabled ? '.35' : '1', boxShadow: 'var(--shadow-lg)', display: 'grid', placeItems: 'center', padding: glyph.length > 1 ? '0 8px' : '0' },
      title, onclick: disabled ? undefined : (ev) => { ev.stopPropagation(); onclick(); },
    }, glyph);
    e.n.append(el('div', { style: { position: 'absolute', top: '6px', right: '6px', zIndex: 35, display: 'flex', gap: '4px' } },
      mk('\u2191', 'Move this section up', () => { const ks = [...finalKeys]; ks.splice(idx - 1, 0, ks.splice(idx, 1)[0]); save(ks, [...hidden]); }, idx === 0),
      mk('\u2193', 'Move this section down', () => { const ks = [...finalKeys]; ks.splice(idx + 1, 0, ks.splice(idx, 1)[0]); save(ks, [...hidden]); }, idx === orderedEditable.length - 1),
      mk(isHid ? 'Show' : 'Hide', isHid ? 'Show this section again' : 'Hide this section (your view only \u2014 nothing is deleted)', () => {
        const h = new Set(hidden);
        if (isHid) h.delete(e.key); else h.add(e.key);
        save(finalKeys, [...h]);
      })));
  });
}
// ── ADOPTION TELEMETRY (per Isaac) — tiny fire-and-forget pings: one
// 'login' per session, one 'view' per tab per 10 minutes. Silent until
// usage_telemetry.sql runs; can never break the app.
const _usagePinged = { login: false, views: {} };
function usagePing(event, detail) {
  try {
    if ((typeof DEMO !== 'undefined' && DEMO) || !state.profile || !state.session) return;
    const now = Date.now();
    if (event === 'login') {
      if (_usagePinged.login) return;
      _usagePinged.login = true;
    } else if (event === 'view') {
      const last = _usagePinged.views[detail] || 0;
      if (now - last < 10 * 60000) return;
      _usagePinged.views[detail] = now;
    }
    supabase.from('usage_events').insert({ profile_id: state.profile.id, event, detail: detail || null })
      .then(() => { /* ok */ }, () => { /* table not created yet — fine */ });
  } catch (e) { /* telemetry must never break the app */ }
}

// 📣 Feedback — from the gear menu on any page (per Isaac): a note plus
// screenshots / screen recordings. Files go to the private "feedback"
// bucket under the sender's folder, the note + attachment list hit
// /api/feedback (Slack + usage_events.meta), and admins see it all under
// Settings → Users → Adoption → Feedback.
function openFeedbackModal() {
  const overlay = el('div', { class: 'modal-overlay' });
  const _escClose = (e) => { if (e.key === 'Escape' || !overlay.isConnected) { overlay.remove(); document.removeEventListener('keydown', _escClose); } };
  document.addEventListener('keydown', _escClose);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  const MAX_FILES = 6, MAX_MB = 50;
  const files = [];   // File objects picked so far
  const ta = el('textarea', {
    class: 'w-full rounded-lg border px-3 py-2 text-sm',
    style: { borderColor: 'var(--border-2)', background: 'var(--input-bg)', minHeight: '110px', resize: 'vertical' },
    placeholder: 'Bug, idea, confusing screen, wrong number — anything. Add a screenshot or a screen recording below if it helps.',
  });
  const list = el('div', { class: 'flex flex-col gap-1.5' });
  const drawList = () => {
    list.replaceChildren(...files.map((f, i) => {
      const isImg = /^image\//.test(f.type);
      const thumb = isImg ? el('img', { src: URL.createObjectURL(f), style: { width: '36px', height: '36px', objectFit: 'cover', borderRadius: '6px', flexShrink: 0 } })
        : el('span', { class: 'inline-flex items-center justify-center', style: { fontSize: '14px', width: '36px', height: '36px', borderRadius: '6px', background: 'var(--card-2)', flexShrink: 0 } }, /^video\//.test(f.type) ? '🎥' : '📄');
      return el('div', { class: 'flex items-center gap-2 rounded-lg border px-2 py-1.5', style: { borderColor: 'var(--border)' } },
        thumb,
        el('div', { class: 'min-w-0 flex-1' },
          el('div', { class: 'text-[11px] font-semibold truncate' }, f.name),
          el('div', { class: 'text-[10px]', style: { color: 'var(--text-subtle)' } }, (f.size / 1048576).toFixed(1) + ' MB · ' + (f.type || 'file'))),
        el('button', { class: 'text-[11px] px-2 py-0.5 rounded-lg border', style: { borderColor: 'var(--border-2)', color: 'var(--text-muted)' }, onclick: () => { files.splice(i, 1); drawList(); } }, 'Remove'));
    }));
  };
  const addFiles = (fl) => {
    for (const f of Array.from(fl || [])) {
      if (files.length >= MAX_FILES) { toast('Up to ' + MAX_FILES + ' files per message', 'warn'); break; }
      if (f.size > MAX_MB * 1048576) { toast(f.name + ' is over ' + MAX_MB + ' MB — trim the recording or send a shorter clip', 'warn'); continue; }
      if (!/^(image|video)\//.test(f.type) && f.type !== 'text/plain') { toast(f.name + ': images, videos or .txt only', 'warn'); continue; }
      files.push(f);
    }
    drawList();
  };
  const picker = el('input', { type: 'file', multiple: true, accept: 'image/*,video/*,.txt', style: { display: 'none' }, onchange: (e) => { addFiles(e.target.files); e.target.value = ''; } });
  const drop = el('div', {
    class: 'rounded-lg border-dashed border text-center px-3 py-3 text-[11px] cursor-pointer transition',
    style: { borderColor: 'var(--border-2)', color: 'var(--text-muted)', borderWidth: '1.5px' },
    onclick: () => picker.click(),
    ondragover: (e) => { e.preventDefault(); drop.style.borderColor = 'var(--accent)'; },
    ondragleave: () => { drop.style.borderColor = 'var(--border-2)'; },
    ondrop: (e) => { e.preventDefault(); drop.style.borderColor = 'var(--border-2)'; addFiles(e.dataTransfer.files); },
  }, el('span', { class: 'font-semibold', style: { color: 'var(--text)' } }, '📎 Add screenshots or a screen recording'), el('br'), 'tap to pick · drag & drop · paste an image into the note · up to ' + MAX_FILES + ' files, ' + MAX_MB + ' MB each');
  // Paste a screenshot straight into the note box (Cmd/Ctrl+V).
  ta.addEventListener('paste', (e) => {
    const its = Array.from((e.clipboardData && e.clipboardData.items) || []).filter(it => it.kind === 'file');
    if (!its.length) return;
    addFiles(its.map(it => it.getAsFile()).filter(Boolean));
  });
  const send = el('button', {
    class: 'rounded-xl px-2.5 py-1 text-[11px] font-bold cursor-pointer',
    style: { background: 'var(--accent)', color: 'var(--accent-text)' },
    onclick: async () => {
      const text = ta.value.trim();
      if (!text && !files.length) { toast('Write a note or attach something first', 'warn'); return; }
      send.disabled = true;
      try {
        // 1. Upload attachments to the private bucket under <uid>/<stamp>-<n>-<name>.
        const uid = (state.profile && state.profile.id) || (state.session && state.session.user && state.session.user.id) || '';
        const attachments = [];
        for (let i = 0; i < files.length; i++) {
          const f = files[i];
          send.textContent = 'Uploading ' + (i + 1) + ' of ' + files.length + '…';
          const safe = String(f.name || 'file').replace(/[^\w.\-]+/g, '_').slice(-80);
          const path = uid + '/' + Date.now() + '-' + i + '-' + safe;
          const { error } = await supabase.storage.from('feedback').upload(path, f, { contentType: f.type || 'application/octet-stream', upsert: false });
          if (error) throw new Error(/bucket/i.test(error.message || '') ? 'Attachments aren’t set up yet (run migrations/20260917_feedback_attachments.sql)' : 'Upload failed: ' + error.message);
          attachments.push({ path, name: f.name, type: f.type, size: f.size });
        }
        // 2. Send the note + attachment list.
        send.textContent = 'Sending…';
        const res = await fetch('/api/feedback', {
          method: 'POST',
          headers: await _apiAuthHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ text, view: state.view || '', attachments }),
        });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        overlay.remove();
        toast('Sent — thank you', 'success');
        state._usageStats = null;   // Adoption card re-pulls next time it renders
      } catch (err) {
        send.disabled = false; send.textContent = 'Send';
        toast(err.message || 'Could not send — try again in a moment', 'error');
      }
    },
  }, 'Send');
  overlay.append(el('div', { class: 'card w-full max-w-md p-5 flex flex-col gap-3' },
    el('div', { class: 'flex items-center justify-between' },
      el('h2', { class: 'text-lg font-bold' }, '📣 Feedback'),
      el('button', { class: 'text-2xl leading-none text-muted-', 'aria-label': 'Close', title: 'Close', style: { color: 'var(--text-muted)' }, onclick: () => overlay.remove() }, '×')),
    ta, drop, picker, list,
    el('div', { class: 'flex items-center justify-between gap-2' },
      el('span', { class: 'text-[10px]', style: { color: 'var(--text-subtle)' } }, 'Goes to the app team (Slack) and the Adoption log.'),
      send)));
  document.body.append(overlay);
  setTimeout(() => ta.focus(), 50);
}

function _ensureEditBanner() {
  document.getElementById('editModeBanner')?.remove();
  if (!state._editMode) return;
  document.body.append(el('div', {
    id: 'editModeBanner',
    style: { position: 'fixed', bottom: '18px', left: '50%', transform: 'translateX(-50%)', zIndex: 80, display: 'flex', alignItems: 'center', gap: '10px', background: 'var(--text)', color: 'var(--bg)', borderRadius: '0', padding: '8px 14px', boxShadow: 'var(--shadow-lg)', fontSize: '12px', fontWeight: '700', whiteSpace: 'nowrap', maxWidth: 'calc(100vw - 24px)' } },
    '\u270f\ufe0f Edit mode \u2014 \u2191\u2193 move \u00b7 Hide/Show \u00b7 your view only',
    el('button', {
      class: 'cursor-pointer rounded-full px-2.5 py-1 text-[11px] font-black',
      style: { background: 'rgba(255,255,255,.18)', color: 'var(--bg)', border: 'none' },
      title: 'Reset THIS tab back to the default layout',
      onclick: () => { try { localStorage.removeItem(_userLayoutKey()); } catch { /* private */ } mountApp(); },
    }, 'Reset page'),
    el('button', {
      class: 'cursor-pointer rounded-full px-2.5 py-1 text-[11px] font-black',
      style: { background: 'var(--accent)', color: 'var(--accent-text)', border: 'none' },
      onclick: () => { state._editMode = false; mountApp(); },
    }, 'Done')));
}

function mountApp() {
  // Competitions landing paints the whole page orange (set again below
  // by the landing renderer when it's the view being drawn).
  try { document.body.classList.remove('comp-landing'); } catch (e) { /* pre-DOM */ }
  const _mountKeepX = window.scrollX || 0, _mountKeepY = window.scrollY || 0;
  // ── Shared-dataset freshness watch — EVERY view, not just Indicators. ──
  // PWAs essentially never reboot, so before this a device that sat on the
  // War Room (or anywhere else) NEVER re-checked the cloud: the Last-upload
  // stamp — and every CRM-backed number — froze at whatever it pulled last.
  // The refresh itself is cheap (throttled to one conditional request per
  // 2 minutes; 304 when nothing new landed) and re-renders only on new data.
  if (state.profile && !DEMO && !state._indCloudWatch) {
    state._indCloudWatch = true;
    // APP-TABLE refresher rides the same clock: the Sales/Pay/audit views
    // read the app database (logged sales, audit statuses, auto-added rows),
    // which only updated on explicit actions — the CRM dataset auto-synced
    // but the sales table sat stale. Throttled to one pull per 2 minutes,
    // hidden tabs skip, and it only re-renders when the data actually
    // changed (fingerprint) so it can never eat what you're typing.
    let _appDataAt = 0, _appDataBusy = false;
    const _appDataFp = () => {
      const rows = state.allSales || [];
      let latest = '';
      const byStatus = {};
      for (const s of rows) {
        const k = (s.updated_at || s.created_at || '');
        if (k > latest) latest = k;
        byStatus[s.audit_status] = (byStatus[s.audit_status] || 0) + 1;   // catches an OLD row's audit flip too
      }
      return rows.length + '|' + latest + '|' + Object.entries(byStatus).sort().map(([k, v]) => k + v).join(',');
    };
    const _refreshAppData = async () => {
      if (_appDataBusy || document.hidden) return;
      if (Date.now() - _appDataAt < 120000) return;
      _appDataAt = Date.now(); _appDataBusy = true;
      try {
        const before = _appDataFp();
        await refreshSalesData();
        if (_appDataFp() !== before) {
          // Data moved — repaint unless the user is mid-modal or typing;
          // the scheduler also waits out active scrolling (render stability).
          const typing = document.activeElement && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
          const modalOpen = !!document.querySelector('.modal-overlay');
          if (!typing && !modalOpen) scheduleBackgroundRemount();
        }
      } catch (e) { /* next tick retries */ }
      finally { _appDataBusy = false; }
    };
    const _freshKick = () => {
      try { refreshIndicatorsFromCloud(); } catch { /* next tick retries */ }
      try { _refreshAppData(); } catch { /* next tick retries */ }
    };
    window.addEventListener('focus', _freshKick);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) _freshKick(); });
    setInterval(_freshKick, 180000);
  }
  // Access revoked (CRM marked the rep inactive → sync set role='disabled'):
  // full-stop screen, nothing else renders. Admins restore access from
  // Settings → Users by assigning a role again.
  if (state.profile && state.profile?.role === 'disabled') {
    mount(el('div', { class: 'min-h-screen flex items-center justify-center p-6' },
      el('div', { class: 'card p-8 max-w-sm w-full text-center flex flex-col items-center gap-3' },
        el('div', { class: 'text-4xl' }, '🔒'),
        el('div', { class: 'text-lg font-bold' }, 'Access deactivated'),
        el('div', { class: 'text-sm text-muted-' }, 'This account is no longer active. If that\u2019s a mistake, reach out to your admin.'),
        el('button', {
          class: 'mt-2 rounded-lg px-2.5 py-1 text-[11px] font-semibold border transition hover:brightness-95',
          style: { borderColor: 'var(--border-2)', color: 'var(--text)' },
          onclick: async () => { if (typeof DEMO !== 'undefined' && DEMO) { location.href = location.pathname; return; } await supabase.auth.signOut(); },
        }, 'Sign out'))));
    return;
  }
  try { _saveResume(); } catch { /* never block a render */ }
  const isAdmin = isAdminRole(state.profile?.role);
  const isAuditor = isAuditorRole(state.profile?.role);

  // Route guard — auditors only get the Sales tab of the Inside Sales
  // group (they audit sales, they don't sell). Any other Inside Sales
  // view (deep-link hash, stale _lastIsTab, default 'dashboard' on boot)
  // is coerced to Sales before render.
  if (isAuditor && ((INSIDE_SALES_TAB_KEYS.has(state.view) && state.view !== 'sales') || state.view === 'queues' || D2D_SALES_TAB_KEYS.has(state.view))) {
    state.view = 'sales';
    history.replaceState(null, '', VIEW_TO_HASH.sales || '#sales');
  }
  // ── ONE SALES WORLD PER REP TYPE (per Isaac): office staff live in the
  // Inside Sales group only, technicians in Technicians only, D2D reps in
  // D2D Sales only. Switching between them stays an admin function (the
  // toggle already renders admin-only); this guard enforces it on deep
  // links and stale resumes too. Competitions stays open to everyone.
  if (!isAdmin && !isAuditor && state.profile) {
    const _grp = repTypeGroup(state.profile);
    const _isTabNotComp = INSIDE_SALES_TAB_KEYS.has(state.view) && state.view !== 'competitions';
    const _isD2dTab = D2D_SALES_TAB_KEYS.has(state.view);
    const _d2dHome = D2D_SALES_TAB_KEYS.has(state._lastD2dTab) ? state._lastD2dTab : 'd2d_dashboard';
    let _redir = null;
    if (_grp === 'office' && (TECH_TAB_KEYS.has(state.view) || _isD2dTab)) _redir = 'dashboard';
    else if (_grp === 'tech' && (_isTabNotComp || _isD2dTab)) _redir = 'techs';
    else if (_grp === 'd2d' && (_isTabNotComp || TECH_TAB_KEYS.has(state.view))) _redir = _d2dHome;
    // Work Queues is an OFFICE STAFF tool (call lists carry customer identity).
    if (state.view === 'queues' && _grp !== 'office') _redir = _grp === 'tech' ? 'techs' : _d2dHome;
    if (_redir) {
      state.view = _redir;
      history.replaceState(null, '', VIEW_TO_HASH[_redir] || '#' + _redir);
    }
  }
  // Route guard — admin-only tabs. These were only ever hidden from the nav
  // MENU; a deep-link hash could still render them. Any non-admin landing
  // on an admin view is coerced to Indicators — the same home a rep gets on
  // a fresh login (this also fixes admin "View as Rep" from an admin page
  // dumping the preview onto the NRLA board instead of the rep landing).
  // Queues tab RETIRED (Jul 2026, per Isaac — may return redesigned).
  // Bookmarks / saved sessions pointing at it heal to Indicators; the
  // role guards below re-route reps and auditors to their own homes.
  if (state.view === 'queues') {
    state.view = 'indicators';
    history.replaceState(null, '', VIEW_TO_HASH.indicators || '#indicators');
  }
  const ADMIN_ONLY_VIEWS = new Set(['reporting', 'marketing', 'admin']);
  // Permissions can open Reporting / Settings to a non-admin (per Isaac, Sep 22).
  const _grantedView = (v) => (v === 'reporting' && userCan('view_reporting')) || (v === 'admin' && canOpenSettings());
  if (!isAdmin && ADMIN_ONLY_VIEWS.has(state.view) && !_grantedView(state.view)) {
    state.view = 'indicators';
    history.replaceState(null, '', VIEW_TO_HASH.indicators || '#indicators');
  }
  // Route guard — rep accounts, shaped by their CRM rep TYPE:
  //   · Sales Rep (or unknown type) → Competitions + Indicators (rep-lite:
  //                                   power-ranking metrics + Rep Leaderboard)
  //   · Office Staff               → Competitions + the Inside Sales group
  // Auditors keep their Sales tab; admins keep everything.
  const isRepOnly = !isAdmin && !isAuditor;
  // One resolver for office staff (rep-UX audit): the profile-based check
  // (role → CRM roster → rep-type map) — the role-only check bounced legacy
  // 'rep' office staff into the D2D world every render.
  const _repGrp = isRepOnly ? repTypeGroup(state.profile) : null;
  const isOfficeStaff = isRepOnly && _repGrp === 'office';
  const isTechType = isRepOnly && _repGrp === 'tech';
  const isSalesRepType = isRepOnly && !isOfficeStaff && !isTechType;
  // Tab visibility now reads the Settings → Permissions matrix (userCan);
  // defaults match the old hardcoded list exactly.
  const _tabOk = (v) => !VIEW_TAB_PERM[v] || userCan(VIEW_TAB_PERM[v]);
  const repCanSee = (v) => (v === 'nrla' && userCan('view_comps'))
    || (v === 'indicators' && userCan('view_indicators'))
    || (v === 'reporting' && userCan('view_reporting'))
    || (v === 'admin' && canOpenSettings())
    || _visibleModules().some(m => m.id === v)             // registered modules (Pricing, riddmarket…) the module itself allows
    || (isTechType && TECH_TAB_KEYS.has(v) && _tabOk(v))                // Technicians: Dashboard + Sales queue
    || (isSalesRepType && D2D_SALES_TAB_KEYS.has(v) && _tabOk(v))       // Sales Reps: the D2D Sales group
    || (isOfficeStaff && INSIDE_SALES_TAB_KEYS.has(v) && _tabOk(v));
  if (isRepOnly && !repCanSee(state.view)) {
    // Home per rep type (per Isaac): Sales Reps land in their D2D Sales
    // group; office staff on their Sales world; others keep Indicators.
    const _home = isTechType ? 'techs'
      : isSalesRepType
      ? (D2D_SALES_TAB_KEYS.has(state._lastD2dTab) ? state._lastD2dTab : 'd2d_dashboard')
      : isOfficeStaff ? 'sales' : 'indicators';
    state.view = _home;
    history.replaceState(null, '', VIEW_TO_HASH[_home] || '#' + _home);
  }
  // Auditor tab access reads the Permissions matrix (all off by default —
  // grant Indicators/Competitions/etc. from Settings → Permissions).
  if (isAuditor) {
    const _audBlocked = (state.view === 'indicators' && !userCan('view_indicators'))
      || (state.view === 'nrla' && !userCan('view_comps'));
    if (_audBlocked) {
      state.view = 'sales';
      history.replaceState(null, '', VIEW_TO_HASH.sales || '#sales');
    }
  }

  // ── Single-column layout. The grid icon in the header is the nav menu. ──
  const shell = el('div', { class: 'min-h-screen flex flex-col' });

  // Nav items (admin reaches Settings via the gear icon, not the nav menu).
  // 'inside_sales' is a virtual entry — clicking it lands on the last-used
  // Inside Sales sub-tab (default Dashboard).
  const navItems = (!isAdmin && !isAuditor) ? [
    // Rep accounts: everyone gets Competitions + rep-lite Indicators.
    // Office Staff get the Inside Sales group; Sales Reps get "Sales" —
    // their commission home, the D2D counterpart to Inside Sales.
    ...(isOfficeStaff ? [['inside_sales', 'Sales', iconSales()]]
      : isTechType ? [['techs', 'Sales', iconSales()]]
      : [['d2d_group', 'Sales', iconDollar()]]),
    ...(userCan('view_comps') && featureOn('competitions') ? [['nrla', 'Competitions', iconTrophy()]] : []),
    ...(userCan('view_indicators') ? [['indicators', 'Indicators', iconChart()]] : []),
    ...(userCan('view_reporting') ? [['reporting', 'Reporting', iconPie()]] : []),   // granted in Settings → Permissions
  ] : [
    // Auditors only have the Sales tab, so call the entry what it is.
    // ONE "Sales" entry for every role — admins toggle Inside Sales ⇄ D2D
    // Sales inside the view itself (salesModeToggle).
    ['inside_sales', 'Sales', iconSales()],
    // Competitions — every comp (NRLA, Spring Cleaning, Top Gun, …) on its
    // own tab, visible to EVERYONE. Read-only for non-admins.
    ...((isAuditor && !userCan('view_comps')) || !featureOn('competitions') ? [] : [['nrla', 'Competitions', iconTrophy()]]),
    ...(isAdmin || (isAuditor && userCan('view_indicators')) ? [['indicators', 'Indicators', iconChart()]] : []),
    ...(isAdmin || userCan('view_reporting') ? [['reporting',     'Reporting',     iconPie()]]       : []),
  ];
  // Registered modules (riddmarket etc.) join the nav for whoever they allow.
  for (const m of _visibleModules()) navItems.push([m.id, m.label || m.id, typeof m.icon === 'function' ? m.icon() : (m.icon || el('span', {}, '▦'))]);
  // External brand link in the app menu for everyone (per Isaac): RIDDMADE → whyridd.com,
  // or whatever RIDD_CONFIG.BRAND.EXTERNAL_LINK names; none set on a brand = no entry.
  const _extLink = _brand().EXTERNAL_LINK !== undefined ? _brand().EXTERNAL_LINK : { label: 'RIDDMADE', url: 'https://whyridd.com' };
  if (_extLink && _extLink.url) navItems.push(['__whyridd', _extLink.label || _extLink.url, svg('<circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>')]);

  // ── Nav dropdown menu (anchored to the grid icon) ──
  const navMenu = el('div', {
    class: 'nav-menu card',
    style: {
      position: 'absolute',
      top: 'calc(100% + 8px)',
      left: '0',
      minWidth: '240px',
      padding: '8px',
      display: 'none',
      zIndex: '40',
      boxShadow: 'var(--shadow-lg)',
    },
  },
    // Brand block at the top
    el('div', {
      class: 'px-3 py-2.5 mb-1 border-b flex items-baseline gap-2',
      style: { borderColor: 'var(--border)' },
    },
      el('div', { class: 'text-xl font-display leading-none', style: { color: 'var(--accent)', letterSpacing: '.02em' } }, CFG.COMPANY_NAME),
      // Tagline beside the wordmark, not under it (per Isaac).
      el('div', { class: 'text-[9px] tracking-[.22em] whitespace-nowrap', style: { color: 'var(--text-subtle)' } }, CFG.COMPANY_TAGLINE),
    ),
    // Nav items
    ...navItems.map(([k, label, icon]) => {
      const active = k === 'inside_sales' ? INSIDE_SALES_TAB_KEYS.has(state.view)
        : k === 'd2d_group' ? D2D_SALES_TAB_KEYS.has(state.view)
        : state.view === k;
      return el('button', {
        class: 'w-full flex items-center gap-3 px-2.5 py-1 rounded-lg text-[11px] font-medium transition',
        style: active
          ? { background: 'var(--accent)', color: 'var(--accent-text)' }
          : { color: 'var(--text)' },
        onmouseenter: (e) => { if (!active) e.currentTarget.style.background = 'var(--card-2)'; },
        onmouseleave: (e) => { if (!active) e.currentTarget.style.background = 'transparent'; },
        onclick: () => {
          if (k === '__whyridd') { window.open(_extLink.url, '_blank', 'noopener'); return; }
          const target = k === 'inside_sales'
            ? (isAuditor ? 'sales' : (INSIDE_SALES_TAB_KEYS.has(state._lastIsTab) ? state._lastIsTab : 'dashboard'))
            : k === 'd2d_group'
              ? (D2D_SALES_TAB_KEYS.has(state._lastD2dTab) ? state._lastD2dTab : 'd2d_dashboard')
              : k;
          state.view = target;
          history.replaceState(null, '', VIEW_TO_HASH[target] || '#' + target);
          mountApp();
        },
      }, icon, el('span', {}, label));
    }),
    // Footer: current user + sign out
    el('div', {
      class: 'px-3 pt-2 mt-1 border-t',
      style: { borderColor: 'var(--border)' },
    },
      el('div', { class: 'text-[11px] font-medium', style: { color: 'var(--text-muted)' } }, state.profile.full_name),
      el('div', { class: 'text-[10px]', style: { color: 'var(--text-subtle)' } },
        roleLabel(state.profile?.role) + (isAdmin ? '' : ' · ' + (state.offices.find(o => o.id === state.profile.office_id)?.name || 'no office'))),
      // Sign out lives under the ⚙ gear: non-admins → My Settings sheet,
      // admins → bottom of the Settings sidebar. The nav menu stays purely
      // navigation (demo keeps its exit button here).
      DEMO ? el('button', {
        class: 'mt-2 mb-1 text-xs transition hover:underline',
        style: { color: 'var(--text-muted)' },
        onclick: () => { location.href = location.pathname; },
      }, 'Exit demo') : null,
    ),
  );

  function toggleNavMenu() {
    const isOpen = navMenu.style.display === 'block';
    navMenu.style.display = isOpen ? 'none' : 'block';
    if (!isOpen) {
      // Close on outside click
      const closer = (e) => {
        if (!navMenu.contains(e.target) && !gridBtn.contains(e.target)) {
          navMenu.style.display = 'none';
          document.removeEventListener('mousedown', closer);
        }
      };
      setTimeout(() => document.addEventListener('mousedown', closer), 0);
    }
  }

  // Brand mark (per Isaac): the RIDD spider from the brand guide is the
  // menu button, replacing the generic ⊞ grid icon.
  const gridBtn = el('button', {
    class: 'icon-btn show',
    onclick: toggleNavMenu,
    title: 'Menu',
  }, riddSpiderMark(20));

  // ── Page header bar ──
  // Position: fixed so it always pins to the top of the viewport regardless
  // of flex / overflow quirks in the parent shell that broke the previous
  // sticky implementation. Main gets a matching top-padding below so the
  // first view-content line starts under the header instead of being
  // hidden behind it.
  // Freshness stamp — sits on the RIGHT beside the gear (per Isaac).
  const syncStamp = (() => {
        // 'dashboard' (Sales War Room) + 'sales' joined the list now that the
        // Inside Sales queue is CRM-fed — the stamp says how live it is.
        // Shown on EVERY tab (per Isaac) — the whole app rides the same
        // hourly sync, so freshness is always relevant.
        const _phone = (() => { try { return window.matchMedia('(max-width: 640px)').matches; } catch { return false; } })();
        // Phone (per Isaac): the title is wide, so the stamp is just the
        // time ("12:31 PM") — full date + zone stays in the tooltip.
        const txtFull = (typeof appSyncStampStr === 'function') ? appSyncStampStr() : '';
        const txt = (_phone && txtFull) ? (txtFull.match(/\d{1,2}:\d{2}\s*[AP]M/i) || [txtFull])[0] : txtFull;
        // Device-unreachable beats server age: a rep whose downloads 403 or
        // time out must never read a green stamp over stale numbers.
        const pullErr = state._indPullError && (Date.now() - state._indPullError.at) < 3 * 3600000;
        // Any OTHER source in error (QuickBooks, pay settings, calendar save…)
        // turns the pill amber and lists itself in the tooltip (P1-7).
        const _bad = (typeof healthWorst === 'function') ? healthWorst().filter(b => b.source !== 'indicators') : [];
        const lvl0 = pullErr ? 'red' : (typeof indicatorsSyncStaleness === 'function') ? indicatorsSyncStaleness() : null;
        const lvl = lvl0 || (_bad.length ? 'amber' : null);
        const c = lvl === 'red' ? '#DC2626' : lvl === 'amber' ? '#A9441F' : null;
        return txt ? el('span', {
          class: 'block text-[11px] whitespace-nowrap cursor-pointer truncate min-w-0',
          onclick: () => { if (typeof openHealthSheet === 'function') openHealthSheet(); else if (pullErr) { try { refreshIndicatorsFromCloud(true); toast('Retrying\u2026', 'success'); } catch (e) { /* poll retries */ } } },
          style: { color: c || 'var(--text-muted)', marginRight: '6px', alignSelf: 'center', textAlign: 'right', fontWeight: lvl === 'red' ? '700' : '' },
          title: pullErr ? 'THIS DEVICE can\u2019t reach the server (' + state._indPullError.msg + ') — showing older data. Tap to retry.'
            : lvl === 'red' ? 'Data is over 4 hours old during selling hours — multiple syncs have failed. Check /api/sync-status and Netlify logs.'
            : lvl === 'amber' && !lvl0 ? 'Problem with: ' + _bad.map(b => b.label).join(', ') + ' — tap for details'
            : lvl === 'amber' ? 'Data is older than the hourly sync cadence — a run may have failed (check Netlify logs)'
            : 'Syncs land hourly on the hour, 8am–11pm ET — tap for every data source',
        },
          _phone ? 'Last sync ' : 'Last sync: ', el('span', { class: 'font-semibold', style: { color: c || 'var(--text)' } }, txt),
          pullErr ? (_phone ? ' \u00b7 OFFLINE' : ' \u00b7 CAN\u2019T REACH SERVER') : lvl === 'red' ? ' \u00b7 SYNC DOWN' : (lvl === 'amber' && !lvl0) ? ' \u00b7 ' + _bad.length + ' issue' + (_bad.length === 1 ? '' : 's') : lvl === 'amber' ? ' \u00b7 overdue' : '') : null;
      })();
  const pageHeader = el('header', {
    class: 'page-header px-4 sm:px-6 py-4',
    style: { position: 'fixed', top: '0', left: '0', right: '0', zIndex: 30 },
  },
   el('div', { class: 'flex items-center justify-between gap-3 w-full max-w-[1600px] mx-auto' },
    el('div', { class: 'flex items-center gap-3 relative min-w-0' },
      gridBtn,
      navMenu,
      el('h1', { class: 'hb-topbar-title font-bold tracking-wider' }, TAB_TITLES[state.view] || (() => { const m = (window.RIDD_MODULES || []).find(x => x.id === state.view); return m ? String(m.title || m.label || m.id).toUpperCase() : ''; })()),
    ),
    // (Top-bar customer search retired — the Sales tab has its own search row, per Isaac.)
    el('div', { class: 'flex-1' }),
    el('div', { class: 'flex items-center gap-2' },
      syncStamp,
      // (📣 Feedback · ✏️ Edit layout · 📺 TV · theme now live under the
      // ⚙ gear menu — the icon row was getting messy, per Isaac.)
      // Coach Mode icon — REMOVED from the top bar for now (per Isaac, Jul
      // 2026). The feature itself (computeCoachFlags / openCoachModeModal)
      // is intact — restore by re-adding the icon button here.
      // ⚙ ONE menu for the meta actions (per Isaac — the icon row got
      // messy): Notifications, Sync, Settings/My Settings, Edit layout,
      // Feedback, Theme and TV Display ALL live here now - the icon row is
      // a single gear. The unread badge rides the gear itself.
      (() => {
        const wrap = el('div', { class: 'relative' });
        const gearBtn = el('button', {
          class: 'icon-btn show',
          style: state._editMode ? { background: 'var(--accent)', color: 'var(--accent-text)' } : {},
          title: 'Settings & tools',
        }, iconGear(18));
        // The bell moved in here, so its unread badge rides the gear -
        // otherwise folding notifications into a menu would hide the only
        // signal that there ARE any.
        // (Notifications, Edit layout and Feedback retired from this menu — per Isaac.)
        const dd = el('div', {
          class: 'card',
          style: { position: 'absolute', top: 'calc(100% + 8px)', right: '0', minWidth: '210px', padding: '6px', display: 'none', zIndex: 60, boxShadow: 'var(--shadow-lg)' },
        });
        // One icon set, one size (16px SVG in an 18px slot) so the rows line up.
        const ICO = {
          resync:   '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>',
          moon:     '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>',
          sun:      '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>',
          settings: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
          power:    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18.36 6.64a9 9 0 1 1-12.73 0"/><line x1="12" y1="2" x2="12" y2="12"/></svg>',
          feedback: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
          tv:       '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="14" rx="1"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="18" x2="12" y2="21"/></svg>',
        };
        const item = (icon, label, onclick) => {
          const ic = el('span', { class: 'inline-flex items-center justify-center shrink-0', style: { width: '18px', height: '18px', color: 'var(--text-muted)' } });
          ic.innerHTML = ICO[icon] || '';
          return el('button', {
            class: 'w-full text-left px-2.5 py-1.5 rounded-lg text-[11px] font-medium cursor-pointer transition flex items-center gap-2',
            style: { background: 'transparent', border: 'none', color: 'var(--text)' },
            onmouseenter: (e) => { e.currentTarget.style.background = 'var(--bg-subtle)'; },
            onmouseleave: (e) => { e.currentTarget.style.background = 'transparent'; },
            onclick: () => { dd.style.display = 'none'; onclick(); },
          }, ic, el('span', {}, label));
        };
        // Order (per Isaac): Resync · Dark mode · Settings · Sign out.
        [
          isAdmin
            ? item('resync', state._revhawkSyncing ? 'Syncing…' : 'Resync', () => {
                if (state._revhawkSyncing) return;
                if (typeof trackAction === 'function') trackAction('resync', 'manual');
                syncFromRevHawk(gearBtn);
              })
            : item('resync', 'Refresh data', () => {
                gearBtn.classList.add('icon-spin');
                toast('Refreshing your data…', 'success');
                try { refreshIndicatorsFromCloud(true); } catch (err) { /* poll retries */ }
                try { if (typeof refreshSalesData === 'function') refreshSalesData(); } catch (err) { /* ignore */ }
                setTimeout(() => { try { gearBtn.classList.remove('icon-spin'); } catch (err) { /* gone */ } }, 4000);
              }),
          item(state.theme === 'light' ? 'moon' : 'sun', state.theme === 'light' ? 'Dark mode' : 'Light mode', () => toggleTheme()),
          item('settings', (isAdmin || canOpenSettings()) ? 'Settings' : 'My Settings', () => {
            if (isAdmin || canOpenSettings()) { state.view = 'admin'; history.replaceState(null, '', VIEW_TO_HASH['admin'] || '#admin'); mountApp(); }
            else openMySettingsModal();
          }),
          item('feedback', 'Feedback', () => openFeedbackModal()),
          // TV Display (per Isaac, Sep 2026): the inside-sales floor board.
          // Admins + office-staff reps only (per Isaac) — it is the inside-sales floor board.
          // Desktop only (per Isaac) — a wall board has no business on a phone.
          (typeof openTvBoard === 'function' && !(() => { try { return window.matchMedia('(max-width: 900px)').matches; } catch (e) { return false; } })() && (isAdmin || userCan('view_tv'))) ? item('tv', 'TV Display', () => openTvBoard()) : null,   // Settings → Permissions (default: office staff)
          el('div', { style: { borderTop: '1px solid var(--border)', margin: '4px 2px' } }),
          item('power', 'Sign out', async () => {
            if (typeof DEMO !== 'undefined' && DEMO) { location.href = location.pathname; return; }
            try { localStorage.removeItem('ridd_last_auth_v1'); } catch { /* private mode */ }
            // signOut with a cap — the SDK's cross-tab lock can stall it; the
            // reload lands on the sign-in screen either way once storage is clear.
            try { await Promise.race([supabase.auth.signOut(), new Promise(r => setTimeout(r, 3000))]); } catch { /* best effort */ }
            try { const k = typeof authStorageKey === 'function' && authStorageKey(); if (k) localStorage.removeItem(k); } catch { /* ignore */ }
            history.replaceState(null, '', location.pathname);
            location.reload();
          }),
        ].forEach(n => { if (n) dd.append(n); });
        gearBtn.onclick = () => {
          const willOpen = dd.style.display !== 'block';
          dd.style.display = willOpen ? 'block' : 'none';
          if (willOpen) setTimeout(() => document.addEventListener('mousedown', function closer(e) {
            if (!dd.contains(e.target) && !gearBtn.contains(e.target)) { dd.style.display = 'none'; document.removeEventListener('mousedown', closer); }
          }), 0);
        };
        wrap.append(gearBtn, dd);
        return wrap;
      })(),
    ),
  ));

  // ── Main content area ──
  // pt-[60px] reserves space at the top of main equal to the fixed page
  // header's height (~60px = py-3 padding + 36px icon-btn). The page header
  // floats over this padding via position:fixed; main's in-flow children
  // (contentWrap) start below it cleanly.
  // main clips horizontal overflow so the document never grows wider than the
  // window — that keeps the fixed header/indicator bars aligned to the viewport
  // (a wider document would shove their right-aligned content off-screen). Wide
  // content (tables, toolbars) instead scrolls inside contentWrap, so nothing
  // is hidden.
  // Side gutter lives on <main> (not the content wrapper) so it matches the
  // header exactly: both are gutter → max-w-[1600px] centred box (per Isaac —
  // the spider and gear sat 24px outside the content edge on wide screens).
  // overflow-x: CLIP, not hidden — hidden turns <main> into a scroll
  // container, which silently breaks every position: sticky inside it
  // (the Pricing quote stuck to <main>'s top instead of the viewport).
  const main = el('main', { class: 'flex-1 overflow-x-clip- pt-[76px] px-4 sm:px-6' });
  // Apple-feel: crossfade + rise ONLY when the view actually changes —
  // in-place re-renders (filters, toggles) stay instant and steady.
  const _viewChanged = state._lastAnimView !== state.view;
  state._lastAnimView = state.view;
  // Competitions always opens on its landing page (per Isaac).
  if (_viewChanged && state.view === 'nrla') state._compsLanding = true;
  // Pay always opens on the CURRENT pay period (per Isaac).
  if (_viewChanged && state.view === 'pay') { state.payYear = null; state.payPeriodId = null; }
  // Pricing pins its quote with position: sticky. `overflow-x: auto` here
  // would make THIS wrapper the sticky's scroll container (a 60px+ blank
  // band above the quote, and the quote painting over the first program on
  // phones) — so that view clips instead of scrolls.
  const contentWrap = el('div', { class: 'py-4 sm:py-6 w-full max-w-[1600px] mx-auto ' + (state.view === 'pricing' ? 'overflow-x-clip-' : 'overflow-x-auto') + (_viewChanged ? ' view-enter' : '') });
  // (Mobile freshness line retired — the header stamp shows on phones now, per Isaac.)
  usagePing('view', state.view);
  main.append(pageHeader, contentWrap);
  // Live header height for anything that pins under it (Pricing quote):
  // measured, so the phone safe-area and the update banner are included.
  try { requestAnimationFrame(() => { const h = pageHeader.getBoundingClientRect().bottom; if (h > 0) document.documentElement.style.setProperty('--hdr-h', Math.round(h) + 'px'); }); } catch (e) { /* noop */ }
  _profMark('dom-attach');

  shell.append(main);
  // Mobile bottom tab bar RETIRED — the ⊞ nav menu top-left is navigation
  // on every screen size (per Isaac: duplicate nav looked cluttered).
  mount(shell);

  // Shared-calendar sync — every shift/swap mutation ends in a mountApp(),
  // so this one hook catches them all (fingerprint no-ops when unchanged).
  try { _calendarCloudAutoSync(); } catch { /* best-effort */ }

  // View-as pill — while previewing another role the admin tabs are hidden,
  // so this floating pill is the way back. Lives on <body>, above everything.
  const _oldViewAsPill = document.getElementById('viewAsPill');
  if (_oldViewAsPill) _oldViewAsPill.remove();
  if (viewAsRole() && state._realProfile && isAdminRole(state._realProfile.role)) {
    document.body.append(el('div', {
      id: 'viewAsPill',
      class: 'card',
      style: { position: 'fixed', bottom: '18px', left: '50%', transform: 'translateX(-50%)', zIndex: '9998',
               padding: '8px 14px', display: 'flex', alignItems: 'center', gap: '10px',
               boxShadow: 'var(--shadow-lg)', border: '1px solid var(--accent)' },
    },
      el('span', { class: 'text-xs font-semibold', title: 'Every screen, tab, button and data pull runs exactly as this user type — the only thing not mimicked is the database\u2019s row-level security, since your login is still an admin.' }, '\ud83d\udc41 Viewing as ' + (state.profile && state.profile._viewAs ? (state.profile.full_name + ' \u00b7 ') : '') + ((typeof ROLE_LABEL !== 'undefined' && ROLE_LABEL[viewAsRole()]) || viewAsRole())),
      el('button', {
        class: 'rounded-lg px-2.5 py-1 text-[11px] font-bold transition hover:brightness-95 whitespace-nowrap shrink-0',
        style: { background: 'var(--accent)', color: 'var(--accent-text)' },
        onclick: () => setViewAsRole(''),
      }, 'Back to Admin'),
    ));
  }
  // Sandbox pill — always visible while sandboxed so there's never a doubt
  // about whether a change was real. Stacks above the view-as pill when
  // both are active (sandbox + previewing a role is a supported combo).
  const _oldSandboxPill = document.getElementById('sandboxPill');
  if (_oldSandboxPill) _oldSandboxPill.remove();
  if (typeof sandboxOn === 'function' && sandboxOn()) {
    const _stacked = !!document.getElementById('viewAsPill');
    document.body.append(el('div', {
      id: 'sandboxPill',
      class: 'card',
      style: { position: 'fixed', bottom: _stacked ? '64px' : '18px', left: '50%', transform: 'translateX(-50%)', zIndex: '9998',
               padding: '8px 14px', display: 'flex', alignItems: 'center', gap: '10px',
               boxShadow: 'var(--shadow-lg)', border: '1px solid #DF643A', background: 'rgba(223,100,58,.10)' },
    },
      el('span', { class: 'text-xs font-semibold' }, '\ud83e\uddea Sandbox \u2014 changes are NOT being saved'),
      el('button', {
        class: 'rounded-lg px-2.5 py-1 text-[11px] font-bold transition hover:brightness-95',
        style: { background: '#DF643A', color: '#fff' },
        onclick: () => sandboxExit(),
      }, 'Exit & discard'),
    ));
  }

  // Data Assistant 💬 — admin-only, created once (never re-rendered by
  // mountApp, so a mid-question re-render can't eat what you're typing).
  try { _ensureAskWidget(); } catch (e) { /* never block a render */ }

  // Render the view's body
  const view = {
    dashboard:    viewDashboard,
    sales:        viewSales,
    pay:          viewPay,
    calendar:     viewCalendar,
    competitions: viewCompetitions,
    hall_of_fame: viewHallOfFame,
    queues: viewQueues,
    indicators:   viewIndicators,
    nrla:         viewNrlaPublic,
    scorecards:   viewScorecards,
    reporting:    viewReporting,
    marketing:    viewMarketing,
    commission:   viewCommission,
    d2d_dashboard: viewD2dDashboard,
    d2d_sales:    viewSales,
    techs:        viewTechs,
    tech_sales:   viewSales,
    tech_pay:     viewTechPay,
    admin:        viewAdmin,
  }[state.view];
  // Registered module views render through their own render(ctx).
  const _mod = typeof view !== 'function' ? _visibleModules().find(m => m.id === state.view) : null;
  if (_mod) {
    const ctx = _moduleCtx();
    if (state._lastModuleView !== _mod.id && typeof _mod.onEnter === 'function') { try { _mod.onEnter(ctx); } catch (e) { console.warn('[ridd] module onEnter', e); } }
    state._lastModuleView = _mod.id;
    let node; try { node = _mod.render(ctx); } catch (e) { console.error('[ridd] module render failed', _mod.id, e); node = emptyCard((_mod.label || _mod.id) + ' failed to render — check the console.'); }
    if (!(node instanceof Node)) node = emptyCard('Module returned nothing.');
    node.classList.add('fade-in');
    contentWrap.append(node);
    return;
  }
  // Retired tabs (Training, Marketplace) — a stale saved view or old
  // bookmark lands on Sales instead of crashing the render.
  if (typeof view !== 'function') {
    state.view = 'sales';
    try { history.replaceState(null, '', VIEW_TO_HASH.sales || '#sales'); } catch (e) {}
    return mountApp();
  }
  if (INSIDE_SALES_TAB_KEYS.has(state.view)) state._lastIsTab = state.view;
  if (D2D_SALES_TAB_KEYS.has(state.view)) state._lastD2dTab = state.view;
  _profStart(state.view);
  const _t0 = performance.now();
  const node = view();
  _profMark('view()');
  try {
    const _sub = state.view === 'reporting' ? (state.reportingSubTab || 'overview') : /^(sales|d2d_sales|tech_sales)$/.test(state.view) ? (state._salesQueueFilter || 'upfront') : state.view === 'admin' ? (state.adminSection || null) : null;
    _trkView(state.view, _sub, Math.round(performance.now() - _t0));
  } catch (e) { /* noop */ }
  node.classList.add('fade-in');
  // Per-user layout (🔧): reorder / hide sections on every tab.
  try { applyUserLayout(node); } catch (e) { console.warn('[ridd] user layout skipped', e); }
  try { _ensureEditBanner(); } catch (e) { /* never block a render */ }
  // Inside Sales views get the consolidated sub-tab bar above the content
  // (auditors get no bar — their only tab is Sales).
  if (INSIDE_SALES_TAB_KEYS.has(state.view)) {
    const subTabBar = insideSalesSubTabs();
    if (subTabBar) contentWrap.append(subTabBar);
  } else if (D2D_SALES_TAB_KEYS.has(state.view)) {
    // D2D Sales group — its own sub-tab bar (admin toggle rides in front).
    const subTabBar = d2dSalesSubTabs();
    if (subTabBar) contentWrap.append(subTabBar);
  } else if (TECH_TAB_KEYS.has(state.view)) {
    const subTabBar = d2dSalesSubTabs('techs');
    if (subTabBar) contentWrap.append(subTabBar);
  }
  contentWrap.append(node);

  // Floating action button — hidden on admin/settings, indicators, and calendar
  // (those tabs aren't sales-input contexts)
  const FAB_HIDDEN_VIEWS = new Set(['admin', 'indicators', 'nrla', 'calendar', 'scorecards', 'reporting', 'marketing', 'commission', 'd2d_dashboard', 'd2d_sales', 'techs', 'tech_sales', 'tech_pay', 'auditing']);
  document.querySelector('.fab')?.remove();
  // + FAB is OFFICE STAFF only (per Isaac) — admins don't log sales from a
  // floating button, and the retired AI speed-dial no longer replaces it.
  const _showFab = state.profile && !isAdminRole(state.profile?.role) && (typeof isOfficeStaffProfile === 'function' && isOfficeStaffProfile(state.profile));
  if (!FAB_HIDDEN_VIEWS.has(state.view) && _showFab && manualUpsellsOn()) {
    // Icon-only FAB — a lone + reads instantly and stops covering table
    // rows / the pinned leaderboard footer on phones.
    const fab = el('button', {
      class: 'fab',
      title: 'New Sale',
      style: { width: '56px', height: '56px', borderRadius: '0', padding: '0', justifyContent: 'center' },
      onclick: () => openNewSaleModal(),
    },
      el('span', { class: 'text-3xl leading-none', style: { marginTop: '-2px' } }, '+'),
    );
    document.body.append(fab);
  }

  // Big-number overflow guard — synchronous, so oversized figures never
  // paint full-size for a frame before shrinking.
  try { fitCardNumbers(); } catch (e) { /* never block a render */ }
  // RENDER STABILITY (per Isaac): background remounts used to yank the page
  // back to the top. Same view → restore the exact scroll spot; a real
  // navigation still starts at the top like it should.
  if (_lastMountedView === state.view && (_mountKeepX || _mountKeepY)) {
    const kx = _mountKeepX, ky = _mountKeepY;
    requestAnimationFrame(() => window.scrollTo(kx, ky));
  }
  _lastMountedView = state.view;
  _profEnd();
}

// ── Overflow guard for display numbers ─────────────────────────────────────
// On squeezed desktop widths (and small phones) a long figure like
// "$34,928,722" in a stat card can bleed past the card edge — the display
// font doesn't wrap (no spaces) and the tiles are width-constrained. Rather
// than hand-tuning every card, this pass measures every display-font number
// inside a card after each render and shrinks just the overflowing ones
// until they fit (floor 11px). Reset-first so growing the window restores
// full size. Wired to mountApp + debounced window resize.
function fitCardNumbers() {
  try {
    const els = document.querySelectorAll('.card .font-display, .stat-tile .font-display');
    // Pass 1: undo anything a previous pass shrank (so resizes can re-grow).
    els.forEach(n => {
      if (n.dataset.fitPrev != null) { n.style.fontSize = n.dataset.fitPrev; delete n.dataset.fitPrev; }
    });
    // Pass 2: shrink whatever overflows now.
    els.forEach(n => {
      if (!n.clientWidth) return;                       // hidden / display:none
      if (n.scrollWidth <= n.clientWidth + 1) return;   // fits fine
      const prev = n.style.fontSize || '';
      let size = parseFloat(getComputedStyle(n).fontSize) || 16;
      let guard = 0;
      while (n.scrollWidth > n.clientWidth + 1 && size > 11 && guard++ < 14) {
        size *= 0.93;
        n.style.fontSize = size.toFixed(1) + 'px';
      }
      n.dataset.fitPrev = prev;
    });
  } catch (e) { /* a measurement hiccup must never break a render */ }
}
if (!window._riddFitWired) {
  window._riddFitWired = true;
  let _fitT;
  window.addEventListener('resize', () => { clearTimeout(_fitT); _fitT = setTimeout(fitCardNumbers, 150); });
}

// ──────────────────────────────────────────────────────────────────────────
// VIEW: DASHBOARD — "SALES WAR ROOM" (matches mockup)
// ──────────────────────────────────────────────────────────────────────────
// ──────────────────────────────────────────────────────────────────────────
// WAR ROOM DATA BRIDGE — the Inside Sales dashboard runs on CRM data.
// ──────────────────────────────────────────────────────────────────────────
// Source of truth: the FieldRoutes shared dataset (hourly server sync),
// filtered to the OFFICE department, mapped into app-sale shape. On top of
// that ride app-logged UPSELLS — the one revenue stream the CRM can't
// express (they deduct from existing contracts). Regular app-logged rows
// are intentionally IGNORED here: office staff historically double-logged
// them in the CRM, and the auto-add sync now inserts the rest, so counting
// both sides would double revenue. Upsells count as NEW revenue.
// CRM sales by office staff without an app account carry rep_id=null and
// rank on the leaderboard under their CRM name (synthetic rows).
let _wrBridgeCache = { src: null, roster: null, profiles: null, out: null };
