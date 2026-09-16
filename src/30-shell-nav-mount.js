// ┌─ src/30-shell-nav-mount.js ─────────────────────────────────────────────────────
// │ App shell: Inside Sales / D2D / Technician tab groups, nav menu, mountApp() view dispatch, My Settings, telemetry.
// │ Part of the app.js bundle (tools/bundle.js concatenates src/*.js in name order).
// └────────────────────────────────────────────────────────────────────────
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
  return isAuditorRole(role) ? INSIDE_SALES_TABS.filter(([k]) => k === 'sales') : INSIDE_SALES_TABS;
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
    btn('inside', 'Inside Sales'), btn('d2d', 'D2D Sales'), btn('techs', 'Technicians'));
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
  const tabs = mode === 'techs' ? TECH_TABS : D2D_SALES_TABS;
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
  const seller = (typeof isSellerRole === 'function') ? isSellerRole(p.role) : true;
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

  // ── Annual goal — writes ONLY the caller's own goal via the set_my_goal
  // RPC (security definer, own row, one column — no open profile writes). ──
  const goalInput = el('input', {
    type: 'number', min: '0', step: '1000',
    value: p.annual_revenue_goal || '',
    placeholder: 'e.g. 500000',
    class: 'flex-1 rounded-lg border px-2.5 py-1 text-[11px]',
  });
  const goalBtn = el('button', {
    class: 'rounded-lg px-2.5 py-1 text-[11px] font-bold transition hover:brightness-95 whitespace-nowrap',
    style: { background: 'var(--accent)', color: 'var(--accent-text)' },
    onclick: async (e) => {
      const btn = e.currentTarget;
      const goal = Math.max(0, parseFloat(goalInput.value) || 0);
      btn.disabled = true; btn.textContent = 'Saving…';
      try {
        if (!DEMO) {
          const { error } = await supabase.rpc('set_my_goal', { goal });
          if (error) throw error;
        }
        p.annual_revenue_goal = goal;
        if (state._realProfile) state._realProfile.annual_revenue_goal = goal;
        const row = (state.allProfiles || []).find(x => x.id === p.id);
        if (row) row.annual_revenue_goal = goal;
        toast('Goal saved — $' + goal.toLocaleString() + ' for the year', 'success');
        scheduleBackgroundRemount();
      } catch (err) {
        toast(/function|schema|does not exist/i.test(err.message || '')
          ? 'Goal save failed — an admin needs to run rep_self_settings.sql in Supabase'
          : (err.message || 'Save failed'), 'error');
      } finally { btn.disabled = false; btn.textContent = 'Save Goal'; }
    },
  }, 'Save Goal');

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
      el('button', { class: 'text-2xl leading-none', style: { color: 'var(--text-muted)' }, onclick: close }, '×')),
    el('div', { class: 'px-5 pb-5 flex flex-col gap-5' },
      seller ? el('div', { class: 'flex flex-col gap-2' },
        secLabel('Annual Revenue Goal ($)'),
        el('div', { class: 'flex items-center gap-2' }, goalInput, goalBtn),
        el('div', { class: 'text-[10px]', style: { color: 'var(--text-subtle)' } }, 'Your personal target — drives your goal pacing anywhere it shows in the app.')) : null,
      el('div', { class: 'flex flex-col gap-2' },
        secLabel('Time Zone'),
        el('select', {
          class: 'w-full rounded-lg border px-2.5 py-1 text-[11px]',
          style: { borderColor: 'var(--border-2)', background: 'var(--card)', color: 'var(--text)' },
          onchange: (e) => { setUserTzPref(e.target.value); toast('Time zone updated', 'success'); scheduleBackgroundRemount(); },
        }, ...USER_TZ_CHOICES.map(([v, label]) => el('option', { value: v, selected: userTzPref() === v }, label))),
        el('div', { class: 'text-[10px]', style: { color: 'var(--text-subtle)' } },
          'Affects time displays like Today\u2019s Sales. Auto = Mountain (Utah) for office staff; D2D sale times always show in the selling office\u2019s local time.')),
      slackSection,
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
    e.n.style.outline = '2px dashed ' + (isHid ? '#D97706' : 'var(--accent)');
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

// 📣 Feedback — one tap from any page, lands in Slack + the usage trail.
function openFeedbackModal() {
  const overlay = el('div', { class: 'modal-overlay' });
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  const ta = el('textarea', {
    class: 'w-full rounded-lg border px-3 py-2 text-sm',
    style: { borderColor: 'var(--border-2)', background: 'var(--input-bg)', minHeight: '110px', resize: 'vertical' },
    placeholder: 'Bug, idea, confusing screen, wrong number \u2014 anything. Screenshots can go to your manager; this sends the words straight to the app team.',
  });
  const send = el('button', {
    class: 'rounded-xl px-2.5 py-1 text-[11px] font-bold cursor-pointer',
    style: { background: 'var(--accent)', color: 'var(--accent-text)' },
    onclick: async () => {
      const text = ta.value.trim();
      if (!text) { toast('Write something first', 'warn'); return; }
      send.disabled = true; send.textContent = 'Sending\u2026';
      try {
        const res = await fetch('/api/feedback', {
          method: 'POST',
          headers: await _apiAuthHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ text, view: state.view || '' }),
        });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        overlay.remove();
        toast('\ud83d\udce3 Sent \u2014 thank you!', 'success');
      } catch (err) {
        send.disabled = false; send.textContent = 'Send';
        toast('Could not send \u2014 try again in a moment', 'error');
      }
    },
  }, 'Send');
  overlay.append(el('div', { class: 'card w-full max-w-md p-5 flex flex-col gap-3' },
    el('div', { class: 'flex items-center justify-between' },
      el('h2', { class: 'text-lg font-bold' }, '\ud83d\udce3 Feedback'),
      el('button', { class: 'text-2xl leading-none', style: { color: 'var(--text-muted)' }, onclick: () => overlay.remove() }, '\u00d7')),
    ta,
    el('div', { class: 'flex justify-end' }, send)));
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
  if (!isAdmin && ADMIN_ONLY_VIEWS.has(state.view)) {
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
  const repCanSee = (v) => (v === 'nrla' && userCan('view_comps'))
    || (v === 'indicators' && userCan('view_indicators'))
    || (isTechType && TECH_TAB_KEYS.has(v))                // Technicians: Dashboard + Sales queue
    || (isSalesRepType && D2D_SALES_TAB_KEYS.has(v))       // Sales Reps: the D2D Sales group
    || (isOfficeStaff && INSIDE_SALES_TAB_KEYS.has(v));
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
    ...(userCan('view_comps') ? [['nrla', 'Competitions', iconTrophy()]] : []),
    ...(userCan('view_indicators') ? [['indicators', 'Indicators', iconChart()]] : []),
  ] : [
    // Auditors only have the Sales tab, so call the entry what it is.
    // ONE "Sales" entry for every role — admins toggle Inside Sales ⇄ D2D
    // Sales inside the view itself (salesModeToggle).
    ['inside_sales', 'Sales', iconSales()],
    // Competitions — every comp (NRLA, Spring Cleaning, Top Gun, …) on its
    // own tab, visible to EVERYONE. Read-only for non-admins.
    ...(isAuditor && !userCan('view_comps') ? [] : [['nrla', 'Competitions', iconTrophy()]]),
    ...(isAdmin || (isAuditor && userCan('view_indicators')) ? [['indicators', 'Indicators', iconChart()]] : []),
    ...(isAdmin ? [['reporting',     'Reporting',     iconPie()]]       : []),
  ];
  // Registered modules (riddmarket etc.) join the nav for whoever they allow.
  for (const m of _visibleModules()) navItems.push([m.id, m.label || m.id, typeof m.icon === 'function' ? m.icon() : (m.icon || el('span', {}, '▦'))]);
  // Why RIDD — external link (whyridd.com) in the app menu for everyone (per Isaac).
  navItems.push(['__whyridd', 'Why RIDD', svg('<circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>')]);

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
          if (k === '__whyridd') { window.open('https://whyridd.com', '_blank', 'noopener'); return; }
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

  const gridBtn = el('button', {
    class: 'icon-btn show',
    onclick: toggleNavMenu,
    title: 'Menu',
  }, iconGrid(18));

  // ── Page header bar ──
  // Position: fixed so it always pins to the top of the viewport regardless
  // of flex / overflow quirks in the parent shell that broke the previous
  // sticky implementation. Main gets a matching top-padding below so the
  // first view-content line starts under the header instead of being
  // hidden behind it.
  const pageHeader = el('header', {
    class: 'page-header px-4 sm:px-6 py-4',
    style: { position: 'fixed', top: '0', left: '0', right: '0', zIndex: 30 },
  },
   el('div', { class: 'flex items-center justify-between gap-3 w-full max-w-[1600px] mx-auto' },
    el('div', { class: 'flex items-center gap-3 relative min-w-0' },
      gridBtn,
      navMenu,
      el('h1', { class: 'hb-topbar-title font-bold tracking-wider' }, TAB_TITLES[state.view] || (() => { const m = (window.RIDD_MODULES || []).find(x => x.id === state.view); return m ? String(m.title || m.label || m.id).toUpperCase() : ''; })()),
      // Freshness stamp — lives up here with the title on every data tab.
      (() => {
        // 'dashboard' (Sales War Room) + 'sales' joined the list now that the
        // Inside Sales queue is CRM-fed — the stamp says how live it is.
        // Shown on EVERY tab (per Isaac) — the whole app rides the same
        // hourly sync, so freshness is always relevant.
        const txt = (typeof appSyncStampStr === 'function') ? appSyncStampStr() : '';
        // Device-unreachable beats server age: a rep whose downloads 403 or
        // time out must never read a green stamp over stale numbers.
        const pullErr = state._indPullError && (Date.now() - state._indPullError.at) < 3 * 3600000;
        const lvl = pullErr ? 'red' : (typeof indicatorsSyncStaleness === 'function') ? indicatorsSyncStaleness() : null;
        const c = lvl === 'red' ? '#DC2626' : lvl === 'amber' ? '#D97706' : null;
        return txt ? el('span', {
          class: 'block text-[11px] whitespace-nowrap cursor-pointer truncate min-w-0',
          onclick: pullErr ? (() => { try { refreshIndicatorsFromCloud(true); toast('Retrying\u2026', 'success'); } catch (e) { /* poll retries */ } }) : undefined,
          style: { color: c || 'var(--text-muted)', marginLeft: '10px', alignSelf: 'center', fontWeight: lvl === 'red' ? '700' : '' },
          title: pullErr ? 'THIS DEVICE can\u2019t reach the server (' + state._indPullError.msg + ') — showing older data. Tap to retry.'
            : lvl === 'red' ? 'Data is over 4 hours old during selling hours — multiple syncs have failed. Check /api/sync-status and Netlify logs.'
            : lvl === 'amber' ? 'Data is older than the hourly sync cadence — a run may have failed (check Netlify logs)'
            : 'Syncs land hourly on the hour, 8am–11pm ET',
        },
          'Last sync: ', el('span', { class: 'font-semibold', style: { color: c || 'var(--text)' } }, txt),
          pullErr ? ' · CAN\u2019T REACH SERVER' : lvl === 'red' ? ' · SYNC DOWN' : lvl === 'amber' ? ' · overdue' : '') : null;
      })(),
    ),
    state.view === 'sales' ? buildSearchBar() : el('div', { class: 'flex-1' }),
    el('div', { class: 'flex items-center gap-2' },
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
        const item = (icon, label, onclick) => el('button', {
          class: 'w-full text-left px-2.5 py-1 rounded-lg text-[11px] font-medium cursor-pointer transition flex items-center gap-2',
          style: { background: 'transparent', border: 'none', color: 'var(--text)' },
          onmouseenter: (e) => { e.currentTarget.style.background = 'var(--bg-subtle)'; },
          onmouseleave: (e) => { e.currentTarget.style.background = 'transparent'; },
          onclick: () => { dd.style.display = 'none'; onclick(); },
        }, el('span', {}, icon), el('span', {}, label));
        [
          item('\u2699\ufe0f', isAdmin ? 'Settings' : 'My Settings', () => {
            if (isAdmin) { state.view = 'admin'; history.replaceState(null, '', VIEW_TO_HASH['admin'] || '#admin'); mountApp(); }
            else openMySettingsModal();
          }),
          isAdmin
            ? item('\u21bb', state._revhawkSyncing ? 'Syncing\u2026' : 'Resync', () => {
                if (state._revhawkSyncing) return;
                syncFromRevHawk(gearBtn);
              })
            : item('\u21bb', 'Refresh data', () => {
                gearBtn.classList.add('icon-spin');
                toast('Refreshing your data\u2026', 'success');
                try { refreshIndicatorsFromCloud(true); } catch (err) { /* poll retries */ }
                try { if (typeof refreshSalesData === 'function') refreshSalesData(); } catch (err) { /* ignore */ }
                setTimeout(() => { try { gearBtn.classList.remove('icon-spin'); } catch (err) { /* gone */ } }, 4000);
              }),
          item(state.theme === 'light' ? '\ud83c\udf19' : '\u2600\ufe0f', state.theme === 'light' ? 'Dark mode' : 'Light mode', () => toggleTheme()),
          // (TV Display retired from the menu — per Isaac. openTVDashboard() stays.)
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
  const main = el('main', { class: 'flex-1 overflow-x-hidden pt-[76px]' });
  // Apple-feel: crossfade + rise ONLY when the view actually changes —
  // in-place re-renders (filters, toggles) stay instant and steady.
  const _viewChanged = state._lastAnimView !== state.view;
  state._lastAnimView = state.view;
  // Competitions always opens on its landing page (per Isaac).
  if (_viewChanged && state.view === 'nrla') state._compsLanding = true;
  // Pay always opens on the CURRENT pay period (per Isaac).
  if (_viewChanged && state.view === 'pay') { state.payYear = null; state.payPeriodId = null; }
  const contentWrap = el('div', { class: 'p-4 sm:p-6 w-full max-w-[1600px] mx-auto overflow-x-auto' + (_viewChanged ? ' view-enter' : '') });
  // (Mobile freshness line retired — the header stamp shows on phones now, per Isaac.)
  usagePing('view', state.view);
  main.append(pageHeader, contentWrap);

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
      el('span', { class: 'text-xs font-semibold' }, '\ud83d\udc41 Viewing as ' + ((typeof ROLE_LABEL !== 'undefined' && ROLE_LABEL[viewAsRole()]) || viewAsRole())),
      el('button', {
        class: 'rounded-lg px-2.5 py-1 text-[11px] font-bold transition hover:brightness-95',
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
               boxShadow: 'var(--shadow-lg)', border: '1px solid #F59E0B', background: 'rgba(245,158,11,.10)' },
    },
      el('span', { class: 'text-xs font-semibold' }, '\ud83e\uddea Sandbox \u2014 changes are NOT being saved'),
      el('button', {
        class: 'rounded-lg px-2.5 py-1 text-[11px] font-bold transition hover:brightness-95',
        style: { background: '#F59E0B', color: '#fff' },
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
    tech_pay:     () => el('div', { class: 'card p-12 text-center' },
      el('div', { class: 'text-sm font-bold' }, 'Technician Pay — under construction'),
      el('div', { class: 'text-xs text-muted- mt-1' }, 'Commission rules for Technicians are being configured. Sales are already being pulled in under the Sales tab.')),
    admin:        viewAdmin,
  }[state.view];
  // Registered module views render through their own render(ctx).
  const _mod = typeof view !== 'function' ? _visibleModules().find(m => m.id === state.view) : null;
  if (_mod) {
    const ctx = _moduleCtx();
    if (state._lastModuleView !== _mod.id && typeof _mod.onEnter === 'function') { try { _mod.onEnter(ctx); } catch (e) { console.warn('[ridd] module onEnter', e); } }
    state._lastModuleView = _mod.id;
    let node; try { node = _mod.render(ctx); } catch (e) { console.error('[ridd] module render failed', _mod.id, e); node = el('div', { class: 'card p-8 text-center text-sm text-muted-' }, (_mod.label || _mod.id) + ' failed to render — check the console.'); }
    if (!(node instanceof Node)) node = el('div', { class: 'card p-8 text-center text-sm text-muted-' }, 'Module returned nothing.');
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
  const node = view();
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
