// ── Settings → Competitions (per Isaac) ─────────────────────────────────
// The competition calendar: every comp with its start / end, how it
// recurs, and the weekday it kicks off on — plus a month grid so you can
// see when the next rounds land. Planning data only (the boards keep
// their own scoring windows); synced to every admin via _compExtras.
const COMP_RECUR = [['none', 'One-off'], ['weekly', 'Weekly'], ['biweekly', 'Every 2 weeks'], ['monthly', 'Monthly'], ['quarterly', 'Quarterly'], ['yearly', 'Yearly']];
const COMP_DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
// ★ Default competition (admin): one at a time, synced to everyone.
// Virtual comps (Mystery Boxes, KOTH, …) persist their star in the synced
// extras map; config-backed comps carry it on the comp object itself.
function setCompDefault(comps, sel, on) {
  const _cXtra = (state._compExtras && typeof state._compExtras === 'object') ? state._compExtras : (state._compExtras = {});
  comps.forEach(c => { delete c.favorite; });
  state._compFavoriteMystery = false;
  Object.keys(_cXtra).forEach(k => { if (_cXtra[k] && typeof _cXtra[k] === 'object') delete _cXtra[k].favorite; });
  if (on) {
    if (sel.id === 'mystery_box') state._compFavoriteMystery = true;
    else {
      sel.favorite = true;
      const _cfgBacked = (typeof getIndicatorCompetitions === 'function' ? getIndicatorCompetitions() : []).some(c => c.id === sel.id);
      if (!_cfgBacked) _cXtra[sel.id] = { ..._cXtra[sel.id], favorite: true };
    }
  }
  logActivity('comp_change', { detail: on ? sel.name + ' set as the DEFAULT competition' : sel.name + ' unset as default competition' });
  saveDemoData();
  if (typeof saveIndicatorState === 'function') saveIndicatorState();
  mountApp();
}
// Is this competition inside one of its scheduled windows (Settings →
// Competitions) right now? Used to auto-feature running comps.
function compRunningNow(compId, now = new Date()) {
  const cfg = compScheduleStore()[compId];
  if (!cfg || !cfg.start) return null;
  const t = new Date(now); t.setHours(12, 0, 0, 0);
  const occ = compOccurrences(cfg).find(o => { const a = new Date(o.start); a.setHours(0, 0, 0, 0); const b = new Date(o.end); b.setHours(23, 59, 59, 999); return a <= t && t <= b; });
  return occ || null;
}
function compScheduleStore() {
  state._compExtras = state._compExtras || {};
  const sc = state._compExtras.compSchedule;
  return (sc && typeof sc === 'object') ? sc : (state._compExtras.compSchedule = {});
}
function compScheduleSave() {
  saveDemoData();
  if (typeof saveIndicatorConfigToSupabase === 'function') saveIndicatorConfigToSupabase().catch(() => {});
}
// Every competition the landing page can show, with its group.
function compScheduleList() {
  const out = [];
  const seen = new Set();
  const push = (id, name, group) => { if (!seen.has(id)) { seen.add(id); out.push({ id, name, group }); } };
  try { (getIndicatorCompetitions() || []).forEach(c => push(c.id, c.name, 'Sales Reps')); } catch (e) { /* no config yet */ }
  push('kobe_week', 'Kobe Week', 'Sales Reps');
  (typeof COMP_2026_NEW !== 'undefined' ? COMP_2026_NEW : []).forEach(([id, name]) => push(id, name, 'Sales Reps'));
  push('koth', 'KOTH', 'Sales Reps'); push('mystery_box', 'Mystery Boxes', 'Sales Reps');
  push('isl', 'Inside Sales League', 'Office Staff');
  const sc = compScheduleStore();
  Object.keys(sc).forEach(id => { if (sc[id] && sc[id].custom) push(id, sc[id].name || 'Custom', sc[id].group || 'Sales Reps'); });
  return out;
}
const _csIso = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const _csDate = (iso) => { const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12) : null; };
// Occurrences of a scheduled comp from its start, out `horizonDays` — each
// { start, end } as Date. Weekday pin (dow) snaps monthly/quarterly/yearly
// repeats to the first matching weekday on/after the nominal date.
function compOccurrences(cfg, horizonDays = 548) {
  const s0 = _csDate(cfg.start); if (!s0) return [];
  const e0 = _csDate(cfg.end) || s0;
  const len = Math.max(0, Math.round((e0 - s0) / 86400000));
  const stop = new Date(); stop.setDate(stop.getDate() + horizonDays);
  const out = [];
  const dow = cfg.dow === '' || cfg.dow == null ? null : Number(cfg.dow);
  const snap = (d) => { if (dow == null) return d; const x = new Date(d); while (x.getDay() !== dow) x.setDate(x.getDate() + 1); return x; };
  let i = 0;
  while (out.length < 60) {
    let st;
    if (cfg.recur === 'weekly') { st = new Date(s0); st.setDate(s0.getDate() + 7 * i); }
    else if (cfg.recur === 'biweekly') { st = new Date(s0); st.setDate(s0.getDate() + 14 * i); }
    else if (cfg.recur === 'monthly') { st = new Date(s0); st.setMonth(s0.getMonth() + i); st = snap(st); }
    else if (cfg.recur === 'quarterly') { st = new Date(s0); st.setMonth(s0.getMonth() + 3 * i); st = snap(st); }
    else if (cfg.recur === 'yearly') { st = new Date(s0); st.setFullYear(s0.getFullYear() + i); st = snap(st); }
    else { if (i > 0) break; st = s0; }
    if (st > stop) break;
    const en = new Date(st); en.setDate(st.getDate() + len);
    out.push({ start: st, end: en });
    i++;
  }
  return out;
}
// The board window for a competition, from Settings → Competitions (per
// Isaac, Oct 13: every year he sets each comp's dates HERE, and the boards
// follow). The occurrence that started most recently (so last summer's comp
// stays on the board until this year's starts), else the next one coming.
// null when the comp has no dates set.
function compSettingsWindow(compId) {
  const cfg = compScheduleStore()[compId];
  if (!cfg || !cfg.start) return null;
  const occ = compOccurrences(cfg);
  if (!occ.length) return null;
  const t = new Date(); t.setHours(12, 0, 0, 0);
  const started = occ.filter(o => o.start <= t);
  const o = started.length ? started[started.length - 1] : occ[0];
  return { start: _csIso(o.start), end: _csIso(o.end) };
}
// "Set in Settings" pointer for the boards' read-only Comp Window bars.
function compSettingsLink(isAdmin) {
  return isAdmin ? el('button', { class: 'text-[11px] font-semibold', style: { color: 'var(--accent)' }, title: 'Competition dates are set once a year in Settings \u2192 Competitions',
    onclick: () => { state.view = 'admin'; state.adminSection = 'comps'; history.replaceState(null, '', (typeof VIEW_TO_HASH !== 'undefined' && VIEW_TO_HASH['admin']) || '#admin'); mountApp(); } }, 'Set dates in Settings \u2192') : null;
}
function adminCompetitionSchedule() {
  if (!isAdminRole(state.profile?.role)) return emptyCard('Admins only.');
  const sc = compScheduleStore();
  const comps = compScheduleList();
  const today = new Date(); today.setHours(12, 0, 0, 0);
  const COLORS = ['#DF643A', '#5F6C5B', '#323230', '#A78256', '#9C3F1E', '#8E9C8A', '#FFB899', '#C9B98A', '#3F4A3C', '#E8A06B', '#7C857A', '#6B2A12'];
  const colorOf = (i) => COLORS[i % COLORS.length];
  const fmtD = fmt.dateMed;
  const inp = (id, key, type, extra = {}) => el('input', Object.assign({
    type, value: (sc[id] && sc[id][key]) || '',
    class: 'rounded-lg border px-2.5 py-1 text-[11px]',
    style: { borderColor: 'var(--border-2)', background: 'var(--card)' },
    onchange: (e) => { sc[id] = sc[id] || {}; sc[id][key] = e.target.value; if (key === 'start' && (sc[id].dow == null || sc[id].dow === '')) { const d = _csDate(e.target.value); if (d) sc[id].dow = String(d.getDay()); } compScheduleSave(); mountApp(); },
  }, extra));
  const sel = (id, key, opts) => el('select', {
    class: 'rounded-lg border px-2.5 py-1 text-[11px] cursor-pointer',
    style: { borderColor: 'var(--border-2)', background: 'var(--card)' },
    onchange: (e) => { sc[id] = sc[id] || {}; sc[id][key] = e.target.value; compScheduleSave(); mountApp(); },
  }, ...opts.map(([v, l]) => el('option', { value: v, selected: String((sc[id] && sc[id][key]) ?? '') === String(v) }, l)));

  // ── Table ──
  const th = (t) => el('th', { class: 'text-left px-2 py-2 text-[9px] uppercase tracking-wider font-semibold text-muted- whitespace-nowrap' }, t);
  const rows = comps.map((c, i) => {
    const cfg = sc[c.id] || {};
    const occ = compOccurrences(cfg);
    const upcoming = occ.filter(o => o.end >= today).slice(0, 3);
    const live = occ.find(o => o.start <= today && o.end >= today);
    return el('tr', { class: 'border-t', style: { borderColor: 'var(--border)' } },
      el('td', { class: 'px-2 py-2 whitespace-nowrap' },
        el('span', { class: 'inline-block mr-2 align-middle', style: { width: '9px', height: '9px', background: colorOf(i) } }),
        cfg.custom
          ? el('input', { type: 'text', value: cfg.name || '', class: 'rounded-lg border px-2.5 py-1 text-[11px] font-semibold', style: { borderColor: 'var(--border-2)', width: '150px' }, onchange: (e) => { cfg.name = e.target.value; compScheduleSave(); mountApp(); } })
          : el('span', { class: 'font-semibold' }, c.name),
        live ? el('span', { class: 'ml-2 text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded', style: { background: 'rgba(61,122,102,.16)', color: '#5F6C5B' } }, 'Live') : null),
      el('td', { class: 'px-2 py-2' }, inp(c.id, 'start', 'date')),
      el('td', { class: 'px-2 py-2' }, inp(c.id, 'end', 'date')),
      el('td', { class: 'px-2 py-2' }, sel(c.id, 'recur', COMP_RECUR)),
      el('td', { class: 'px-2 py-2' }, sel(c.id, 'dow', [['', 'Any'], ...COMP_DOW.map((d, k) => [String(k), d])])),
      el('td', { class: 'px-2 py-2 text-[11px] text-muted- whitespace-nowrap' },
        upcoming.length ? upcoming.map(o => fmtD(o.start) + (o.end > o.start ? ' – ' + fmtD(o.end) : '')).join(' · ') : (cfg.start ? 'Ended' : '—')),
      el('td', { class: 'px-2 py-2 whitespace-nowrap' }, cfg.custom ? el('button', {
        class: 'text-[11px] font-semibold', style: { color: '#DC2626' },
        onclick: () => { if (!confirm('Remove ' + (cfg.name || 'this competition') + ' from the schedule?')) return; delete sc[c.id]; compScheduleSave(); mountApp(); },
      }, 'Remove') : (cfg.start ? el('button', {
        class: 'text-[11px] font-semibold text-muted-',
        onclick: () => { delete sc[c.id]; compScheduleSave(); mountApp(); },
      }, 'Clear') : null)));
  });
  // One card per group (per Isaac): Sales Reps · Office Staff · Technicians.
  const groupCard = (group) => {
    const idx = comps.map((c, i) => [c, i]).filter(([c]) => ((sc[c.id] && sc[c.id].group) || c.group) === group);
    return el('div', { class: 'card overflow-hidden' },
      el('div', { class: 'px-4 py-3 flex items-center gap-3 border-b flex-wrap', style: { borderColor: 'var(--border)' } },
        el('h3', { class: 'text-base font-bold' }, group),
        el('span', { class: 'text-[11px] text-muted-' }, idx.length + ' competition' + (idx.length === 1 ? '' : 's')),
        el('button', {
          class: 'ml-auto rounded-lg px-2.5 py-1 text-[11px] font-bold', style: { background: 'var(--accent)', color: 'var(--accent-text)' },
          onclick: () => { const id = 'custom_' + Date.now(); sc[id] = { custom: true, name: 'New competition', group, recur: 'none' }; compScheduleSave(); mountApp(); },
        }, '+ Competition')),
      idx.length
        ? el('div', { class: 'scroll-x' }, el('table', { class: 'w-full text-xs' },
            el('thead', {}, el('tr', {}, th('Competition'), th('Start'), th('End'), th('Repeats'), th('Starts on'), th('Next runs'), th(''))),
            el('tbody', {}, ...idx.map(([, i]) => rows[i]))))
        : el('div', { class: 'px-4 py-6 text-center text-xs text-muted- italic' }, 'No ' + group.toLowerCase() + ' competitions scheduled yet.'));
  };
  // Tabs per user type (per Isaac, Sep 2026): one group on screen at a time
  // instead of all three stacked; the calendar follows the selected tab.
  const GROUPS = ['Sales Reps', 'Office Staff', 'Technicians'];
  const groupTab = GROUPS.includes(state._compSchedGroup) ? state._compSchedGroup : 'Sales Reps';
  const groupOf = (c) => (sc[c.id] && sc[c.id].group) || c.group;
  const tabs = el('div', { class: 'flex items-center gap-1 border-b flex-wrap', style: { borderColor: 'var(--border)' } },
    ...GROUPS.map(g => {
      const on = g === groupTab, n = comps.filter(c => groupOf(c) === g).length;
      return el('button', {
        class: 'px-2.5 py-1.5 text-[11px] font-semibold transition whitespace-nowrap',
        style: on ? { color: 'var(--text)', boxShadow: 'inset 0 -2px 0 var(--accent)' } : { color: 'var(--text-muted)' },
        onclick: () => { state._compSchedGroup = g; mountApp(); },
      }, g, el('span', { class: 'ml-1 text-[10px] font-semibold', style: { color: 'var(--text-muted)' } }, String(n)));
    }));
  const table = el('div', { class: 'flex flex-col gap-4' },
    tabs,
    el('div', { class: 'text-[11px] text-muted-' }, 'Set each comp’s first run + how it repeats; "Starts on" pins the weekday for monthly / quarterly / yearly repeats.'),
    groupCard(groupTab));

  // ── Month calendar ──
  if (!state._compCalYm) state._compCalYm = _csIso(today).slice(0, 7);
  const [cy, cm] = state._compCalYm.split('-').map(Number);
  const first = new Date(cy, cm - 1, 1, 12), daysIn = new Date(cy, cm, 0).getDate();
  const shiftMonth = (n) => { const d = new Date(cy, cm - 1 + n, 1); state._compCalYm = _csIso(d).slice(0, 7); mountApp(); };
  const perDay = Array.from({ length: daysIn }, () => []);
  comps.forEach((c, i) => {
    const cfg = sc[c.id]; if (!cfg || !cfg.start) return;
    if (groupOf(c) !== groupTab) return;
    compOccurrences(cfg).forEach(o => {
      for (let d = 1; d <= daysIn; d++) {
        const day = new Date(cy, cm - 1, d, 12);
        if (day >= o.start && day <= o.end) perDay[d - 1].push({ name: cfg.name || c.name, color: colorOf(i), starts: _csIso(day) === _csIso(o.start) });
      }
    });
  });
  const cells = [];
  for (let k = 0; k < first.getDay(); k++) cells.push(el('div', { class: 'p-1', style: { minHeight: '64px', background: 'var(--card-2)', opacity: '.5' } }));
  for (let d = 1; d <= daysIn; d++) {
    const isToday = _csIso(new Date(cy, cm - 1, d, 12)) === _csIso(today);
    const items = perDay[d - 1];
    cells.push(el('div', { class: 'p-1 flex flex-col gap-0.5', style: { minHeight: '64px', borderTop: '1px solid var(--border)', background: isToday ? 'rgba(223,100,58,.08)' : 'var(--card)' } },
      el('div', { class: 'text-[10px] tabular-nums font-semibold', style: { color: isToday ? 'var(--accent)' : 'var(--text-muted)' } }, String(d)),
      ...items.slice(0, 3).map(it => el('div', { class: 'text-[9px] font-bold truncate px-1', style: { background: it.color, color: '#fff', opacity: it.starts ? '1' : '.75' }, title: it.name + (it.starts ? ' — starts' : '') }, (it.starts ? '▸ ' : '') + it.name)),
      items.length > 3 ? el('div', { class: 'text-[9px] text-muted-' }, '+' + (items.length - 3) + ' more') : null));
  }
  const calendar = el('div', { class: 'card overflow-hidden' },
    el('div', { class: 'px-4 py-3 flex items-center gap-2 border-b', style: { borderColor: 'var(--border)' } },
      el('h3', { class: 'text-base font-bold' }, 'Calendar', el('span', { class: 'ml-2 text-[11px] font-semibold', style: { color: 'var(--text-muted)' } }, groupTab)),
      el('div', { class: 'ml-auto flex items-center gap-1' },
        el('button', { class: 'px-2.5 py-1 text-[11px] rounded-lg border', style: { borderColor: 'var(--border-2)' }, onclick: () => shiftMonth(-1) }, '‹'),
        el('span', { class: 'text-[11px] font-semibold px-2 tabular-nums' }, first.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })),
        el('button', { class: 'px-2.5 py-1 text-[11px] rounded-lg border', style: { borderColor: 'var(--border-2)' }, onclick: () => shiftMonth(1) }, '›'),
        el('button', { class: 'px-2.5 py-1 text-[11px] rounded-lg border ml-1', style: { borderColor: 'var(--border-2)' }, onclick: () => { state._compCalYm = _csIso(today).slice(0, 7); mountApp(); } }, 'Today'))),
    el('div', { class: 'grid grid-cols-7' }, ...COMP_DOW.map(d => el('div', { class: 'px-1 py-1 text-[9px] uppercase tracking-wider font-semibold text-muted-', style: { background: 'var(--card-2)' } }, d))),
    el('div', { class: 'grid grid-cols-7' }, ...cells));

  return el('div', { class: 'flex flex-col gap-4' },
    el('h2', { class: 'text-lg font-bold' }, 'Competitions'),
    el('div', { class: 'text-[12px] -mt-2', style: { color: 'var(--text-muted)' } }, 'Set each competition\u2019s start and end here once a year \u2014 the boards (Kobe Week, NRLA, Top Gun and the other date-window comps) run on these dates. Spring Cleaning rounds and Last Man Standing comp days are still set on their own boards.'),
    table, calendar);
}

function adminSlack() {
  const s = state.appSettings || (state.appSettings = {});
  s.slack_bot_token = s.slack_bot_token || '';
  if (!s.slack_channels) s.slack_channels = [
    { id: 1, name: '#insidesales', webhook: '' },
  ];
  s.first_blood = s.first_blood || {
    enabled: true,
    message: '[Rep name] first blood today!',
    image_url: 'https://i.imgur.com/TjjGnM1.png',
  };
  s.daily_update = s.daily_update || {
    enabled: false,
    send_time: '17:00',
    include_week: true,
    include_month: true,
    include_year: true,
  };
  if (s.paystub_dm_enabled == null) s.paystub_dm_enabled = true;

  // Saves to the shared pay_settings row (it only saved locally before —
  // settings audit, Sep 30). Debounced so typing a webhook isn't a write per key.
  const persist = () => { saveDemoData(); clearTimeout(state._slackSaveT); state._slackSaveT = setTimeout(() => { if (typeof saveAppSettings === 'function') saveAppSettings(); }, 700); };

  const profiles = state.allProfiles.length ? state.allProfiles : [state.profile];
  const _slackAdmin = isAdminRole(state.profile?.role);   // admins see webhook URLs; View-as Developer shows the masked version

  // Status pills surface the wiring state of each card so the UI doesn't lie
  // about which feature actually fires. live = browser webhook;
  // server = bot-token DM, needs Netlify Function (demo stub fires today);
  // cron = needs an external scheduler (won't fire from the browser).
  const statusPill = (kind) => {
    const m = {
      live:   { label: 'Live · webhook',                                         bg: 'rgba(223,100,58,.18)', fg: '#DF643A' },
      server: { label: DEMO ? 'Demo stub · needs server' : 'Live · server',      bg: 'rgba(95,108,91,.14)', fg: '#5F6C5B' },
      cron:   { label: 'Needs cron host',                                        bg: 'rgba(223,100,58,.16)', fg: '#A9441F' },
    };
    const meta = m[kind] || m.live;
    return el('span', {
      class: 'text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded',
      style: { background: meta.bg, color: meta.fg, whiteSpace: 'nowrap' },
    }, meta.label);
  };

  // Subsection inside a consolidated card. The first subsection in a card
  // skips the top divider; we pass `first` to control that.
  const subsection = (opts, ...children) => el('div', {
    style: opts.first ? {} : { borderTop: '1px solid var(--border)', paddingTop: '20px', marginTop: '20px' },
  },
    el('div', { class: 'flex items-center gap-2 mb-1 flex-wrap' },
      opts.icon ? el('span', { class: 'text-base' }, opts.icon) : null,
      el('h4', { class: 'text-sm font-bold' }, opts.title),
      opts.statusKind ? statusPill(opts.statusKind) : null,
    ),
    opts.hint ? el('p', { class: 'text-xs text-muted- mb-3' }, opts.hint) : null,
    ...children,
  );

  // Generic "enable + channel picker" combo used by Sale Broadcast and
  // Competition Updates — both just route to a channel webhook.
  const channelToggleBlock = (key, defaultObj, label) => {
    if (!s[key]) s[key] = defaultObj;
    return el('div', { class: 'flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3' },
      el('label', { class: 'flex items-center gap-2 text-sm' },
        el('input', {
          type: 'checkbox', class: 'accent-lime w-4 h-4',
          checked: s[key].enabled || false,
          onchange: (e) => { s[key].enabled = e.target.checked; persist(); },
        }),
        label,
      ),
      el('select', {
        class: 'rounded-lg border px-2.5 py-1 text-[11px] flex-1',
        onchange: (e) => { s[key].channel = e.target.value; persist(); },
      },
        el('option', { value: '' }, 'Select channel…'),
        ...s.slack_channels.map(ch => el('option', { value: ch.name, selected: s[key].channel === ch.name }, ch.name)),
      ),
    );
  };

  return el('div', { class: 'flex flex-col gap-4' },
    el('div', { class: 'flex items-center justify-between mb-1' },
      el('h2', { class: 'text-xl font-bold' }, 'Notifications · Slack'),
    ),
    (typeof slackTypesCard === 'function') ? slackTypesCard() : null,

    // (Architecture banner removed — implementation detail; settings audit, Sep 30)
    // ── 2. Connection — Bot Token + Channels ──
    el('div', { class: 'card p-5' },
      el('h3', { class: 'text-base font-bold mb-3' }, 'Connection'),

/* (Bot Token removed — nothing read it; settings audit, Sep 30) */

      subsection({ title: 'Channels', statusKind: 'live',
        hint: 'Each row is a Slack channel + its incoming webhook URL. Test posts straight from your browser — no server needed.',
      },
        el('div', { class: 'flex flex-col gap-2' },
          ...s.slack_channels.map((ch, i) => el('div', { class: 'flex items-center gap-2 flex-wrap' },
            el('input', {
              class: 'rounded-lg border px-2.5 py-1 text-[11px]',
              style: { width: '160px' },
              value: ch.name,
              oninput: (e) => { ch.name = e.target.value; persist(); },
            }),
            // Webhook URLs are secrets — anyone holding one can post into the
            // channel. Non-admins (Developer) see a saved one masked and can't
            // edit or remove it (per Isaac, Oct 13); admins see and edit as before.
            (!_slackAdmin && ch.webhook)
              ? el('span', { class: 'flex-1 rounded-lg border px-2.5 py-1 text-[11px] font-mono', style: { minWidth: '240px', color: 'var(--text-muted)', borderColor: 'var(--border)' }, title: 'Webhook saved — only an admin can view or change it' }, '\u2022\u2022\u2022\u2022\u2022\u2022 webhook saved (admin only)')
              : el('input', {
                  class: 'flex-1 rounded-lg border px-2.5 py-1 text-[11px] font-mono',
                  style: { minWidth: '240px' },
                  placeholder: 'https://hooks.slack.com/services/...',
                  value: ch.webhook,
                  oninput: (e) => { ch.webhook = e.target.value; persist(); },
                }),
            el('button', {
              class: 'px-2.5 py-1 rounded-lg border text-[11px] font-semibold transition',
              style: { borderColor: 'var(--border-2)', color: 'var(--text)' },
              onclick: async (ev) => {
                if (!ch.webhook) { toast('Add a webhook URL first', 'warn'); return; }
                const btn = ev.currentTarget;
                const orig = btn.textContent;
                btn.textContent = '…'; btn.disabled = true;
                const res = await slack.postWebhook(ch.webhook, {
                  text: '✅ Test post from RIDD Sales App — webhook for ' + ch.name + ' is wired up.',
                });
                btn.textContent = orig; btn.disabled = false;
                toast(res.ok ? 'Posted to ' + ch.name : 'Failed: ' + res.error, res.ok ? 'success' : 'error');
              },
            }, 'Test'),
            (!_slackAdmin && ch.webhook) ? null : el('button', {
              class: 'text-xs text-muted- hover:text-red-500 transition px-2',
              onclick: () => { s.slack_channels.splice(i, 1); persist(); mountApp(); },
              title: 'Remove',
            }, '×'),
          )),
        ),
        el('button', {
          class: 'mt-3 px-2.5 py-1 rounded-lg border text-[11px] font-medium',
          style: { borderColor: 'var(--border-2)', color: 'var(--text)' },
          onclick: () => {
            const nextId = Math.max(0, ...s.slack_channels.map(c => c.id)) + 1;
            s.slack_channels.push({ id: nextId, name: '#new-channel', webhook: '' });
            persist();
            mountApp();
          },
        }, '+ Add Channel'),
      ),
    ),

    // ── 3. Channel Posts — Sale Broadcast / First Blood / Weekly Digest / Competition Updates ──
    el('div', { class: 'card p-5' },
      el('h3', { class: 'text-base font-bold mb-3' }, 'Channel Posts'),

      subsection({ first: true, icon: '📢', title: 'Sale Broadcast', statusKind: 'live',
        hint: 'Every sale logged auto-posts the rep, customer, service, and ACV to the chosen channel.',
      },
        channelToggleBlock('sale_broadcast', { enabled: false, channel: '' }, 'Enabled'),
      ),

      subsection({ icon: '🩸', title: 'First Blood', statusKind: 'live',
        hint: 'Fires automatically on the rep\'s first sale of the day. Posts to the Sale Broadcast channel.',
      },
        el('label', { class: 'flex items-center gap-2 mb-3 text-sm' },
          el('input', {
            type: 'checkbox', class: 'accent-lime w-4 h-4',
            checked: s.first_blood.enabled,
            onchange: (e) => { s.first_blood.enabled = e.target.checked; persist(); },
          }),
          'Enabled',
        ),
        el('div', { class: 'grid grid-cols-1 sm:grid-cols-[auto_1fr] gap-2 items-center mb-2' },
          el('span', { class: 'text-[10px] uppercase tracking-widest text-muted- font-semibold' }, 'Message'),
          el('div', { class: 'flex items-center gap-2' },
            el('span', { class: 'text-xs text-muted- font-mono shrink-0' }, '[Rep name]'),
            el('input', {
              class: 'flex-1 rounded-lg border px-2.5 py-1 text-[11px]',
              value: s.first_blood.message,
              oninput: (e) => { s.first_blood.message = e.target.value; persist(); },
            }),
          ),
        ),
        el('div', { class: 'grid grid-cols-1 sm:grid-cols-[auto_1fr] gap-2 items-center' },
          el('span', { class: 'text-[10px] uppercase tracking-widest text-muted- font-semibold' }, 'Image URL'),
          el('input', {
            class: 'rounded-lg border px-2.5 py-1 text-[11px]',
            placeholder: 'https://i.imgur.com/...',
            value: s.first_blood.image_url,
            oninput: (e) => { s.first_blood.image_url = e.target.value; persist(); },
          }),
        ),
      ),

/* (Weekly Digest removed — nothing read it; settings audit, Sep 30) */

/* (Competition Updates removed — nothing read it; settings audit, Sep 30) */
    ),

    // ── 4. Direct Messages — Pay Stub DMs + Daily Update ──
    el('div', { class: 'card p-5' },
      el('h3', { class: 'text-base font-bold mb-3' }, 'Direct Messages'),

      subsection({ first: true, icon: '💰', title: 'Pay Stub DMs', statusKind: 'server',
        hint: 'DM each rep their pay stub the moment payroll runs. Demo mode logs the intent to Admin → Activity Log.',
      },
        el('label', { class: 'flex items-center gap-2 mb-3 text-sm' },
          el('input', {
            type: 'checkbox', class: 'accent-lime w-4 h-4',
            checked: s.paystub_dm_enabled,
            onchange: (e) => { s.paystub_dm_enabled = e.target.checked; persist(); },
          }),
          'Auto-DM when payroll runs',
          el('span', { class: 'text-[10px] text-muted- italic' }, '(Upfront + Backend)'),
        ),
        el('div', { class: 'grid grid-cols-1 sm:grid-cols-[auto_1fr_auto] gap-2 items-center' },
          el('span', { class: 'text-[10px] uppercase tracking-widest text-muted- font-semibold' }, 'Manual send'),
          el('select', {
            id: 'paystub-rep-picker',
            class: 'rounded-lg border px-2.5 py-1 text-[11px]',
          },
            el('option', { value: '' }, 'Select a rep…'),
            el('option', { value: '__all__' }, '— All active reps —'),
            ...profiles.filter(p => p.is_active !== false).map(p => el('option', { value: p.id }, p.full_name)),
          ),
          el('button', {
            class: 'px-2.5 py-1 rounded-lg text-[11px] font-semibold',
            style: { background: 'var(--accent)', color: 'var(--accent-text)' },
            onclick: () => {
              const sel = document.getElementById('paystub-rep-picker');
              if (!sel.value) return toast('Pick a rep first', 'warn');
              const today = new Date();
              const periodId = currentPayPeriodId(today.getFullYear());
              const period = getPayPeriods(today.getFullYear()).find(p => p.id === periodId);
              if (!period) return toast('Could not resolve current pay period', 'warn');
              const repIds = sel.value === '__all__'
                ? profiles.filter(p => p.is_active !== false && p.role !== 'auditor').map(p => p.id)
                : [sel.value];
              const sales = (state.allSales || []).filter(x =>
                repIds.includes(x.rep_id) &&
                new Date(x.sold_date + 'T00:00') >= period.start &&
                new Date(x.sold_date + 'T00:00') <= period.end
              );
              if (!sales.length) return toast('No sales in the current period for that selection', 'warn');
              const prev = s.paystub_dm_enabled;
              s.paystub_dm_enabled = true;
              notifyPayrollRun(sales, period, 'upfront');
              s.paystub_dm_enabled = prev;
            },
          }, 'Send'),
        ),
      ),

/* (Daily Update removed — nothing read it; settings audit, Sep 30) */
    ),

    // ── 5. Rep Slack User IDs ──
    el('div', { class: 'card p-5' },
      el('h3', { class: 'text-base font-bold mb-1' }, 'Rep Slack User IDs'),
      el('p', { class: 'text-xs text-muted- mb-3' },
        'Find a rep\'s Slack User ID in their Slack profile → ⋮ → Copy member ID. Looks like ',
        el('code', { style: { color: 'var(--accent)' } }, 'U01AB2CD3EF'),
        '. Required for DMs. Office staff only — sales reps and technicians don\'t use Slack.',
      ),
      el('div', { class: 'flex flex-col gap-2' },
        // Office staff only (per Isaac, Sep 23): D2D reps and techs never get Slack DMs.
        ...profiles.filter(p => p.is_active !== false && (isAdminRole(p.role) || (typeof isOfficeStaffProfile === 'function' ? isOfficeStaffProfile(p) : isOfficeStaffRole(p.role)))).map(p => el('div', { class: 'flex items-center gap-3' },
          el('div', { class: 'flex items-center gap-2 w-44 shrink-0' },
            avatarNode(p.avatar_url, p.initials, 'w-6 h-6 text-[8px]'),
            el('span', { class: 'text-sm font-medium truncate' }, p.full_name),
          ),
          el('input', {
            class: 'flex-1 rounded-lg border px-2.5 py-1 text-[11px] font-mono',
            placeholder: 'U01AB2CD3EF',
            value: p.slack_user_id || '',
            oninput: (e) => { p.slack_user_id = e.target.value; persist(); },
          }),
          p.slack_user_id
            ? el('span', { class: 'text-[10px] font-bold shrink-0', style: { color: '#DF643A' } }, '✓')
            : el('span', { class: 'text-[10px] text-muted- italic shrink-0', style: { whiteSpace: 'nowrap' } }, 'no DM'),
        )),
      ),
    ),
  );
}

// Delete a sale entirely. Admin-only — wired up from the × button on each
// row of the Sales tab after a confirm dialog. Removes from both collections
// in demo mode; deletes the row from Supabase in production.
async function deleteSale(saleId) {
  const sale = state.allSales.find(s => s.id === saleId) || state.mySales.find(s => s.id === saleId);
  const customerName = sale?.customer_name || 'sale';
  if (DEMO) {
    state.mySales  = state.mySales.filter(s => s.id !== saleId);
    state.allSales = state.allSales.filter(s => s.id !== saleId);
    logActivity('audit', { sale_id: saleId, customer_name: customerName, old_status: sale?.audit_status, new_status: 'deleted' });
    toast('Deleted "' + customerName + '"', 'success');
    saveDemoData();
    mountApp();
    return;
  }
  try {
    const { error } = await supabase.from('sales').delete().eq('id', saleId);
    if (error) throw error;
    toast('Deleted "' + customerName + '"', 'success');
    await refreshSalesData();
    await recomputeAllProgress();
    mountApp();
  } catch (err) {
    toast(err.message || 'Failed to delete', 'error');
  }
}

// Restore a cancelled sale back to Pending so it can be re-audited. Only
// applies to cancelled sales (other terminal statuses need a chargeback flow,
// not a simple revert). Clears the audit stamps and un-stages from payroll.
async function reinstateSale(saleId) {
  if (DEMO) {
    for (const list of [state.mySales, state.allSales]) {
      const sale = list.find(s => s.id === saleId);
      if (sale) {
        sale.audit_status = 'pending';
        sale.audited_by = null;
        sale.audited_at = null;
        sale.staged_for_payroll = false;
        sale.staged_at = null;
      }
    }
    const sale = state.allSales.find(s => s.id === saleId);
    logActivity('audit', { sale_id: saleId, customer_name: sale?.customer_name, old_status: 'cancelled', new_status: 'pending' });
    toast('Sale reinstated', 'success');
    saveDemoData();
    mountApp();
    return;
  }
  try {
    const { error } = await supabase.from('sales').update({
      audit_status: 'pending',
      audited_by: null,
      audited_at: null,
      staged_for_payroll: false,
      staged_at: null,
    }).eq('id', saleId);
    if (error) throw error;
    toast('Sale reinstated', 'success');
    await refreshSalesData();
    await recomputeAllProgress();
    mountApp();
  } catch (err) {
    toast(err.message || 'Failed', 'error');
  }
}

// Status (audit_status) and Auditor (audited_by) are independent decisions.
// A sale only stages for payroll when BOTH conditions are met:
//   1. Status is payroll-eligible (serviced or below_minimums), AND
//   2. An auditor has been assigned (audited_by != null)
// Either change re-evaluates staging — set them in any order, change the
// status back to Pending and it un-stages, etc.
function _evalStaging(sale) {
  const isPayrollStatus = sale.audit_status === 'serviced' || sale.audit_status === 'below_minimums';
  const hasAuditor = !!sale.audited_by;
  if (isPayrollStatus && hasAuditor) {
    if (!sale.staged_for_payroll) sale.staged_at = new Date().toISOString();
    sale.staged_for_payroll = true;
  } else {
    sale.staged_for_payroll = false;
    sale.staged_at = null;
  }
}

async function auditSale(saleId, status) {
  if (typeof trackAction === 'function') trackAction('sale_audit', status);
  if (DEMO) {
    for (const list of [state.mySales, state.allSales]) {
      const sale = list.find(s => s.id === saleId);
      if (sale) {
        sale.audit_status = status;
        // Note: we do NOT touch audited_by here — that's set independently
        // via the Audit dropdown so admins can credit the right auditor
        // (which may not be the person clicking Status).
        _evalStaging(sale);
      }
    }
    const sale = state.allSales.find(s => s.id === saleId);
    logActivity('audit', { sale_id: saleId, customer_name: sale?.customer_name, old_status: sale?.audit_status, new_status: status });
    /* no status toast — the row's colour says it (per Isaac, Oct 15) */
    saveDemoData();
    mountApp();
    return;
  }
  try {
    // Re-derive staging on the server side too — find the sale, compute
    // staged_for_payroll based on the new status + existing audited_by.
    const sale = state.allSales.find(s => s.id === saleId) || state.mySales.find(s => s.id === saleId);
    const isPayrollStatus = status === 'serviced' || status === 'below_minimums';
    const hasAuditor = !!sale?.audited_by;
    const willStage = isPayrollStatus && hasAuditor;
    const { error } = await supabase.from('sales').update({
      audit_status: status,
      staged_for_payroll: willStage,
      staged_at: willStage ? new Date().toISOString() : null,
    }).eq('id', saleId);
    if (error) throw error;
    /* no status toast — the row's colour says it (per Isaac, Oct 15) */
    // Slack DM to the sale's rep (their ⚙ My Settings opt-in decides
    // whether it sends) — first event wired to per-user notifications.
    try {
      if (sale && sale.profile_id && sale.profile_id !== state.profile?.id) {
        const _lbl = { pending: 'Pending', serviced: 'Commissionable \u2705', below_minimums: 'Below Minimums', cancelled: 'Cancelled', nsf: 'NSF', not_payable: 'Not Payable', reschedule: 'Reschedule', re_audit: 'Re-Audit' }[status] || status;
        notifySlack(sale.profile_id, '\ud83d\udd0e Audit update \u2014 your sale for ' + (sale.customer_name || 'a customer') + ' was marked *' + _lbl + '*.');
      }
    } catch (e2) { /* best-effort */ }
    await refreshSalesData();
    await recomputeAllProgress();
    mountApp();
  } catch (err) {
    toast(err.message || 'Failed', 'error');
  }
}

// (adminCompetitions removed — unreferenced; settings audit, Sep 30)

// (openCompEditor removed — unreferenced; settings audit, Sep 30)

// ── FieldRoutes roster (mirrored by the sync into fieldroutes_employees) ──
// Loaded lazily for admins. Powers the "in CRM, not in the app yet" list and
// the email auto-link review on the Users screen.
async function loadFieldRoutesRoster(force) {
  if (typeof DEMO !== 'undefined' && DEMO) { if (!state.frRoster) state.frRoster = []; return state.frRoster; }
  if (state._frRosterLoading) return state.frRoster;
  if (state.frRoster && !force) return state.frRoster;
  state._frRosterLoading = true;
  try {
    const { data, error } = await supabase.from('fieldroutes_employees').select('*');
    state.frRoster = error ? [] : (data || []);
    state._frRosterError = error ? error.message : null;
    if (error) console.warn('[fr roster] load failed:', error.message);
  } catch (e) { state.frRoster = []; state._frRosterError = String((e && e.message) || e); console.warn('[fr roster]', e); }
  finally { state._frRosterLoading = false; }
  // Roster in hand → re-run the auto-alias pass so CRM-LINKED multi-branch
  // accounts merge even when the roster loads after the sales data did.
  try { if ((state.frRoster || []).length && (state._indicatorRawSales || []).length) _autoAliasByRepId(state._indicatorRawSales); } catch { /* non-fatal */ }
  return state.frRoster;
}
const _frEmpName  = (e) => ([(e.nickname || e.fname), e.lname].filter(Boolean).join(' ')).trim() || (e.email || ('Employee ' + e.employee_id));
const _frNormEmail = (s) => String(s || '').trim().toLowerCase();
// Normalized full name for fallback matching when an app login email differs
// from the CRM email (e.g. cameron@riddpest.com vs crprymak@gmail.com).
const _frNormName  = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
// First+last from a FieldRoutes record (ignores nickname so it matches the app
// profile's real name, e.g. "Cameron Prymak").
const _frRealName  = (e) => _frNormName([e.fname, e.lname].filter(Boolean).join(' '));
// Write a FieldRoutes link onto an existing profile (admin RLS allows it).
async function applyFieldRoutesLink(profileId, empId) {
  if (typeof DEMO !== 'undefined' && DEMO) {
    const p = (state.allProfiles || []).find(x => x.id === profileId);
    if (p) p.fieldroutes_employee_id = empId;
    saveDemoData(); toast('Linked', 'success'); mountApp(); return;
  }
  const { error } = await supabase.from('profiles').update({ fieldroutes_employee_id: empId }).eq('id', profileId);
  if (error) { toast('Link failed: ' + error.message, 'error'); return; }
  const p = (state.allProfiles || []).find(x => x.id === profileId);
  if (p) p.fieldroutes_employee_id = empId;
  toast('Linked to FieldRoutes', 'success'); mountApp();
}
// Flip an app user's active state (Users screen inline toggle). Guards against
// an admin locking themselves out.
// One-press password-reset email — used by the user editor's Send Reset
// Link button and the activate flow below. (The row-level 🔑 was retired;
// resets live inside Edit User now.)
async function sendPasswordResetLink(email) {
  if (!email) { toast('No email on file for this user.', 'error'); return false; }
  if (typeof DEMO !== 'undefined' && DEMO) { toast('Demo mode — would email a password reset link to ' + email, 'info'); return true; }
  try {
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: authEmailRedirectUrl() });
    if (error) throw error;
    toast('Reset link sent to ' + email, 'success');
    return true;
  } catch (err) {
    toast(err.message || 'Could not send reset link', 'error');
    return false;
  }
}
async function setProfileActive(p, active) {
  if (p.id === state.profile?.id && !active) { toast('You can’t deactivate your own account.', 'error'); return; }
  if (typeof DEMO !== 'undefined' && DEMO) { p.is_active = active; saveDemoData(); toast(active ? 'Activated' : 'Deactivated', 'success'); mountApp(); return; }
  const { error } = await supabase.from('profiles').update({ is_active: active }).eq('id', p.id);
  if (error) { toast('Update failed: ' + error.message, 'error'); return; }
  p.is_active = active; toast(active ? 'Activated' : 'Deactivated', 'success'); mountApp();
  // Just ACTIVATED → offer the reset-link email right here, one press.
  if (active && p.email && confirm('Also email ' + p.email + ' a password-reset link so they can set their password?')) {
    await sendPasswordResetLink(p.email);
  }
}
// Which rep-type tab a person belongs to. App users inherit their linked (or
// email-matched) FieldRoutes type; otherwise infer from role.
const REP_TYPE_TABS = ['All', 'Office Staff', 'Technician', 'Sales Rep'];
const REP_TYPE_TAB_LABEL = { 'All': 'All', 'Office Staff': 'Office Staff', 'Technician': 'Technicians', 'Sales Rep': 'Sales Reps' };

// ── Adoption drill-down (per Isaac): the numbers on the Adoption cards,
// opened up — per-user activity, per-tab views, and the raw feedback. All
// from usage_events already in memory (state._usageStats); no extra query.
function openAdoptionDrill(kind, allRows, o = {}) {
  const rows = (allRows || []).filter(r => new Date(r.at).getTime() >= (o.since || 0));
  const profOf = (id) => (state.allProfiles || []).find(p => p.id === id) || null;
  const nameOf = (id) => (profOf(id) || {}).full_name || 'Unknown (' + String(id || '').slice(0, 8) + ')';
  const roleOf = (id) => { const p = profOf(id); return p ? ((typeof ROLE_LABEL !== 'undefined' && ROLE_LABEL[p.role]) || p.role || '') : ''; };
  const tabName = (d) => usageScreenName(d);
  const overlay = el('div', { class: 'modal-overlay' });
  const _escClose = (e) => { if (e.key === 'Escape' || !overlay.isConnected) { overlay.remove(); document.removeEventListener('keydown', _escClose); } };
  document.addEventListener('keydown', _escClose);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  const modal = el('div', { class: 'card w-full max-w-4xl p-5 my-8 overflow-y-auto', style: { maxHeight: 'calc(100vh - 64px)' } });
  overlay.append(modal);
  const th = (t, right) => el('th', { class: 'px-2 py-1.5 text-[9px] uppercase tracking-widest font-semibold whitespace-nowrap ' + (right ? 'text-right' : 'text-left'), style: { color: 'var(--text-muted)' } }, t);
  const td = (t, right, cls = '') => el('td', { class: 'px-2 py-1.5 text-xs ' + (right ? 'text-right tabular-nums ' : '') + cls }, t);
  const table = (heads, body) => el('div', { class: 'overflow-x-auto mt-3' }, el('table', { class: 'w-full' }, el('thead', { style: { background: 'var(--card-2)' } }, el('tr', {}, ...heads)), el('tbody', {}, ...body)));
  const head = (title, sub, extra) => el('div', { class: 'flex items-start justify-between gap-3' },
    el('div', {}, el('h3', { class: 'text-base font-bold' }, title), el('div', { class: 'text-[11px]', style: { color: 'var(--text-muted)' } }, sub)),
    el('div', { class: 'flex items-center gap-2' }, extra || null, el('button', { class: 'rounded-lg border px-2.5 py-1 text-[11px] font-semibold', style: { borderColor: 'var(--border-2)' }, onclick: () => overlay.remove() }, 'Close')));
  const dayKey = (iso) => String(iso || '').slice(0, 10);
  const perUser = () => {
    const m = new Map();
    for (const r of rows) {
      const u = m.get(r.profile_id) || (m.set(r.profile_id, { id: r.profile_id, events: 0, views: 0, days: new Set(), tabs: {}, last: 0, first: Infinity, feedback: 0 }), m.get(r.profile_id));
      const t = new Date(r.at).getTime();
      u.events++; if (r.event === 'view') { u.views++; if (r.detail) u.tabs[r.detail] = (u.tabs[r.detail] || 0) + 1; }
      if (r.event === 'feedback') u.feedback++;
      u.days.add(dayKey(r.at)); if (t > u.last) u.last = t; if (t < u.first) u.first = t;
    }
    return [...m.values()].sort((a, b) => b.last - a.last);
  };
  if (kind === 'users') {
    const users = perUser();
    let q = '';
    const body = el('tbody');
    const draw = () => {
      body.replaceChildren(...users.filter(u => !q || nameOf(u.id).toLowerCase().includes(q) || roleOf(u.id).toLowerCase().includes(q)).map(u => {
        const top = Object.entries(u.tabs).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, n]) => tabName(k) + ' \u00d7' + n).join(' \u00b7 ');
        return el('tr', { class: 'border-t transition', style: { borderColor: 'var(--border)', cursor: 'pointer' }, title: 'Click to see exactly what ' + nameOf(u.id) + ' looked at',
          onmouseenter: (e) => { e.currentTarget.style.background = 'var(--bg-subtle)'; }, onmouseleave: (e) => { e.currentTarget.style.background = 'transparent'; },
          onclick: () => openUsageUserDrill(u.id, { since: o.since || 0, back: () => { modal.replaceChildren(...saved); } , modal }) },
          td(el('span', { class: 'font-semibold' }, nameOf(u.id))),
          td(el('span', { style: { color: 'var(--text-muted)' } }, roleOf(u.id))),
          td(String(u.days.size), true), td(String(u.views), true), td(String(u.events), true),
          td(el('span', { title: new Date(u.last).toLocaleString() }, timeAgo(new Date(u.last).toISOString())), false, 'whitespace-nowrap'),
          td(el('span', { class: 'text-[11px]', style: { color: 'var(--text-muted)' } }, top || '\u2014')),
          td(el('span', { class: 'text-[10px] font-semibold', style: { color: 'var(--accent)' } }, 'what they saw \u2192'), true));
      }));
      if (!body.children.length) body.append(el('tr', {}, el('td', { class: 'px-2 py-4 text-center text-[11px]', colspan: '7', style: { color: 'var(--text-muted)' } }, 'No activity in this window.')));
    };
    draw();
    let saved = [];
    const search = el('input', { type: 'text', placeholder: 'Search name or role\u2026', class: 'rounded-lg border px-2.5 py-1 text-[11px]', style: { borderColor: 'var(--border-2)', background: 'var(--card)', color: 'var(--text)', width: '180px' }, oninput: (e) => { q = e.target.value.trim().toLowerCase(); draw(); } });
    modal.append(head(o.title + ' \u00b7 ' + users.length + (users.length === 1 ? ' user' : ' users'), o.sub, search),
      el('div', { class: 'overflow-x-auto mt-3' }, el('table', { class: 'w-full' },
        el('thead', { style: { background: 'var(--card-2)' } }, el('tr', {}, th('User'), th('Access profile'), th('Days active', true), th('Tab views', true), th('Events', true), th('Last active'), th('Top tabs'), th(''))),
        body)));
    saved = [...modal.childNodes];
  } else if (kind === 'tabs') {
    const views = rows.filter(r => r.event === 'view' && r.detail);
    const byTab = new Map();
    for (const r of views) { const t = byTab.get(r.detail) || (byTab.set(r.detail, { key: r.detail, n: 0, users: new Map() }), byTab.get(r.detail)); t.n++; t.users.set(r.profile_id, (t.users.get(r.profile_id) || 0) + 1); }
    const tabs = [...byTab.values()].sort((a, b) => b.n - a.n);
    const detail = el('div', { class: 'mt-3' });
    const showTab = (t) => {
      detail.replaceChildren(el('div', { class: 'rounded-lg border p-3', style: { borderColor: 'var(--border)' } },
        el('div', { class: 'text-[11px] font-bold mb-1' }, tabName(t.key) + ' \u00b7 who opened it'),
        el('div', { class: 'flex flex-wrap gap-1.5' }, ...[...t.users.entries()].sort((a, b) => b[1] - a[1]).map(([id, n]) => el('span', { class: 'rounded-full px-2 py-0.5 text-[10px] border', style: { borderColor: 'var(--border-2)' } }, nameOf(id) + ' \u00d7' + n)))));
    };
    modal.append(head(o.title + ' \u00b7 ' + views.length + ' views', o.sub),
      table([th('Tab'), th('Views', true), th('Unique users', true), th('Views / user', true), th('')],
        tabs.map(t => el('tr', { class: 'border-t', style: { borderColor: 'var(--border)' } },
          td(el('span', { class: 'font-semibold' }, tabName(t.key))), td(String(t.n), true), td(String(t.users.size), true), td((t.n / Math.max(1, t.users.size)).toFixed(1), true),
          td(el('button', { class: 'rounded-lg border px-2 py-0.5 text-[10px] font-semibold', style: { borderColor: 'var(--border-2)' }, onclick: () => showTab(t) }, 'who \u2192'), true)))),
      detail);
  } else {
    const fb = rows.filter(r => r.event === 'feedback');
    // Attachments live in the private "feedback" bucket — admins get short
    // signed URLs; images inline as thumbnails, videos play in place.
    const attachBox = (r) => {
      const atts = (r.meta && Array.isArray(r.meta.attachments)) ? r.meta.attachments : [];
      if (!atts.length) return null;
      const box = el('div', { class: 'flex flex-wrap gap-2 mt-2' });
      atts.forEach(async (a) => {
        const slot = el('div', { class: 'rounded-lg border overflow-hidden', style: { borderColor: 'var(--border)', maxWidth: '260px' } },
          el('div', { class: 'text-[10px] px-2 py-1 truncate', style: { color: 'var(--text-muted)' } }, a.name || a.path));
        box.append(slot);
        try {
          const { data, error } = await supabase.storage.from('feedback').createSignedUrl(a.path, 3600);
          if (error || !data || !data.signedUrl) { slot.append(el('div', { class: 'text-[10px] px-2 pb-1', style: { color: '#B91C1C' } }, 'file unavailable')); return; }
          const url = data.signedUrl;
          if (/^image\//.test(a.type || '')) slot.prepend(el('a', { href: url, target: '_blank', rel: 'noopener' }, el('img', { src: url, style: { display: 'block', maxWidth: '260px', maxHeight: '180px', objectFit: 'cover' } })));
          else if (/^video\//.test(a.type || '')) slot.prepend(el('video', { src: url, controls: true, preload: 'metadata', style: { display: 'block', maxWidth: '260px', maxHeight: '180px', background: '#000' } }));
          else slot.append(el('a', { href: url, target: '_blank', rel: 'noopener', class: 'text-[11px] font-semibold px-2 pb-1 block', style: { color: 'var(--accent)' } }, 'Open \u2192'));
        } catch (e) { slot.append(el('div', { class: 'text-[10px] px-2 pb-1', style: { color: '#B91C1C' } }, 'file unavailable')); }
      });
      return box;
    };
    modal.append(head(o.title + ' \u00b7 ' + fb.length, o.sub),
      fb.length ? el('div', { class: 'flex flex-col gap-2 mt-3' }, ...fb.map(r => el('div', { class: 'rounded-lg border px-3 py-2', style: { borderColor: 'var(--border)' } },
        el('div', { class: 'flex items-center justify-between gap-2 text-[10px]', style: { color: 'var(--text-muted)' } }, el('span', { class: 'font-bold', style: { color: 'var(--text)' } }, nameOf(r.profile_id) + ' \u00b7 ' + roleOf(r.profile_id)), el('span', { title: new Date(r.at).toLocaleString() }, timeAgo(r.at))),
        el('div', { class: 'text-xs mt-1 whitespace-pre-wrap' }, r.detail || ''),
        attachBox(r))))
      : el('div', { class: 'mt-3 text-[11px] text-center py-6', style: { color: 'var(--text-muted)' } }, 'No feedback in the last 30 days.'));
  }
  document.body.append(overlay);
}

// Human names for what the telemetry records: a view key plus the sub-tab /
// queue / settings section that was open. Distinct per screen (the old
// TAB_TITLES lookup called every Sales-group view "SALES").
const USAGE_SCREEN_NAMES = {
  dashboard: 'Inside Sales · Dashboard', sales: 'Inside Sales · Sales', pay: 'Inside Sales · Pay', scorecards: 'Scorecards', calendar: 'Calendar',
  hall_of_fame: 'Hall of Fame', competitions: 'Competitions', nrla: 'Competitions', queues: 'Queues',
  d2d_dashboard: 'D2D · Dashboard', d2d_sales: 'D2D · Sales', commission: 'D2D · Pay',
  all_dashboard: 'All user types · Dashboard',
  d2d_hof: 'D2D · Hall of Fame', tech_hof: 'Technicians · Hall of Fame',
  techs: 'Technicians · Dashboard', tech_sales: 'Technicians · Sales', tech_pay: 'Technicians · Pay',
  indicators: 'Indicators', reporting: 'Reporting', marketing: 'Marketing', admin: 'Settings', auditing: 'Auditing', pricing: 'Pricing',
};
const USAGE_SUB_NAMES = {
  upfront: 'Upfront Sales', backend: 'Pending Backend Lock', cancels: 'Archived', history: 'History',
  overview: 'Overview', geographic: 'Geographic', waterfall: 'Retention', auditing: 'Auditing', marketing: 'Marketing', putis: 'P&L', ops: 'Operations', definitions: 'Definitions',
  uploads: 'Admin', pricing: 'Commissions', comps: 'Competitions', calendar: 'Calendar', config: 'Configurations', goals: 'Goals', perms: 'Permissions', slack: 'Slack', teams: 'Teams', users: 'Users', usage: 'Usage', sources: 'Sources',
};
function usageScreenName(view, sub) {
  const base = USAGE_SCREEN_NAMES[view] || (view ? String(view).replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase()) : '\u2014');
  if (!sub) return base;
  return base + ' \u203a ' + (USAGE_SUB_NAMES[sub] || String(sub).replace(/_/g, ' '));
}
function usageFmtDur(ms) {
  const s = Math.round((ms || 0) / 1000);
  if (s < 60) return s + 's';
  const m = Math.floor(s / 60); if (m < 60) return m + 'm ' + String(s % 60).padStart(2, '0') + 's';
  const h = Math.floor(m / 60); return h + 'h ' + String(m % 60).padStart(2, '0') + 'm';
}

// ── Per-user drilldown (per Isaac): exactly what one person looked at —
// every screen with opens and time on it, what they did there (drills,
// searches, audits, exports…), and a recent timeline. Reads app_events
// (the richer feed: sub-tabs, time on page, actions) for that user; falls
// back to the legacy usage_events pings when app_events isn't there yet.
async function openUsageUserDrill(userId, o = {}) {
  const prof = (state.allProfiles || []).find(p => p.id === userId) || {};
  const name = prof.full_name || 'Unknown';
  const role = (typeof ROLE_LABEL !== 'undefined' && ROLE_LABEL[prof.role]) || prof.role || '';
  const since = new Date(o.since || (Date.now() - 30 * 86400000)).toISOString();
  const modal = o.modal;
  const th = (t, right) => el('th', { class: 'px-2 py-1.5 text-[9px] uppercase tracking-widest font-semibold whitespace-nowrap ' + (right ? 'text-right' : 'text-left'), style: { color: 'var(--text-muted)' } }, t);
  const td = (t, right, cls = '') => el('td', { class: 'px-2 py-1.5 text-xs ' + (right ? 'text-right tabular-nums ' : '') + cls }, t);
  const table = (heads, body, empty) => el('div', { class: 'overflow-x-auto mt-2' }, el('table', { class: 'w-full' }, el('thead', { style: { background: 'var(--card-2)' } }, el('tr', {}, ...heads)),
    el('tbody', {}, ...(body.length ? body : [el('tr', {}, el('td', { class: 'px-2 py-3 text-center text-[11px]', colspan: String(heads.length), style: { color: 'var(--text-muted)' } }, empty || 'Nothing yet.'))]))));
  const section = (title, sub) => el('div', { class: 'mt-4' }, el('div', { class: 'text-[11px] font-bold' }, title), sub ? el('div', { class: 'text-[10px]', style: { color: 'var(--text-muted)' } }, sub) : null);
  const head = el('div', { class: 'flex items-start justify-between gap-3' },
    el('div', {}, el('h3', { class: 'text-base font-bold' }, name), el('div', { class: 'text-[11px]', style: { color: 'var(--text-muted)' } }, role + ' \u00b7 what they looked at since ' + new Date(since).toLocaleDateString())),
    el('div', { class: 'flex items-center gap-2' },
      el('button', { class: 'rounded-lg border px-2.5 py-1 text-[11px] font-semibold', style: { borderColor: 'var(--border-2)' }, onclick: () => o.back && o.back() }, '\u2190 Back'),
      el('button', { class: 'rounded-lg border px-2.5 py-1 text-[11px] font-semibold', style: { borderColor: 'var(--border-2)' }, onclick: () => { const ov = modal.closest('.modal-overlay'); if (ov) ov.remove(); } }, 'Close')));
  modal.replaceChildren(head, el('div', { class: 'mt-4 text-[11px]', style: { color: 'var(--text-muted)' } }, 'Loading\u2026'));

  let rows = null, err = null;
  try {
    const r = await supabase.from('app_events').select('event, name, sub, dur_ms, props, device, session_id, at').eq('user_id', userId).gte('at', since).order('at', { ascending: false }).limit(4000);
    if (r.error) err = r.error.message || 'failed'; else rows = r.data || [];
  } catch (e) { err = String(e && e.message || e); }
  if (!modal.isConnected) return;

  if (!rows) {
    // Fallback: the legacy 10-minute view pings.
    const legacy = ((state._usageStats && state._usageStats.rows) || []).filter(r => r.profile_id === userId && new Date(r.at).getTime() >= new Date(since).getTime());
    const counts = {};
    legacy.forEach(r => { if (r.event === 'view' && r.detail) counts[r.detail] = (counts[r.detail] || 0) + 1; });
    modal.replaceChildren(head,
      el('div', { class: 'mt-3 text-[11px] rounded-lg border px-3 py-2', style: { borderColor: 'var(--border)', color: 'var(--text-muted)' } },
        /app_events|relation|schema cache/i.test(err || '') ? 'Detailed usage needs migrations/20260921_app_events.sql in Supabase — showing the basic tab pings until then.' : 'Detailed usage unavailable (' + err + ') — showing the basic tab pings.'),
      section('Tabs opened', 'one ping per tab per 10 minutes'),
      table([th('Screen'), th('Opens', true)], Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([k, n]) => el('tr', { class: 'border-t', style: { borderColor: 'var(--border)' } }, td(usageScreenName(k)), td(String(n), true)))));
    return;
  }

  // ── Screens: opens + time on page (closed view rows carry dur_ms) ──
  const screens = new Map();
  const views = rows.filter(r => r.event === 'view');
  for (const r of views) {
    const k = (r.name || '') + '|' + (r.sub || '');
    const sc = screens.get(k) || (screens.set(k, { view: r.name, sub: r.sub, opens: 0, ms: 0, last: 0 }), screens.get(k));
    const opened = r.props && r.props.opened, closed = r.props && r.props.closed;
    if (opened || (!opened && !closed)) sc.opens++;
    if (closed && r.dur_ms > 0 && r.dur_ms < 4 * 3600000) sc.ms += r.dur_ms;
    const t = new Date(r.at).getTime(); if (t > sc.last) sc.last = t;
  }
  const scList = [...screens.values()].sort((a, b) => b.ms - a.ms || b.opens - a.opens);
  const totalMs = scList.reduce((a, b) => a + b.ms, 0);
  const sessions = new Set(rows.map(r => r.session_id).filter(Boolean)).size;
  const days = new Set(rows.map(r => String(r.at).slice(0, 10))).size;
  const devices = rows.reduce((m, r) => { m[r.device || 'desktop'] = (m[r.device || 'desktop'] || 0) + 1; return m; }, {});
  const devTxt = Object.entries(devices).sort((a, b) => b[1] - a[1]).map(([d, n]) => d + ' ' + Math.round(100 * n / rows.length) + '%').join(' \u00b7 ');
  const stat = (label, val) => el('div', { class: 'rounded-lg border px-3 py-2', style: { borderColor: 'var(--border)', background: 'var(--card-2)' } },
    el('div', { class: 'text-[9px] uppercase tracking-widest font-semibold', style: { color: 'var(--text-subtle)' } }, label),
    el('div', { class: 'text-sm font-bold tabular-nums' }, val));
  const bar = (pct) => el('div', { class: 'rounded-full overflow-hidden', style: { height: '6px', background: 'var(--card-2)', width: '90px', display: 'inline-block', verticalAlign: 'middle', marginRight: '6px' } },
    el('div', { style: { height: '100%', width: Math.max(2, pct) + '%', background: 'var(--accent)' } }));

  // ── Actions: drills / searches / audits / exports … ──
  const actions = new Map();
  const ACTION_LABEL = { drill: 'Opened a chart drilldown', 'search:sales_queue': 'Searched the Sales queue', 'search:leaderboard': 'Searched the leaderboard', 'search:customer_health': 'Searched customer health',
    sale_audit: 'Audited a sale', pay_stage: 'Staged pay', payroll_run: 'Ran payroll', export: 'Exported', filters_apply: 'Applied filters', resync: 'Resynced', player_card: 'Opened a player card',
    health_sheet: 'Opened the sync health sheet', setting_save: 'Saved a setting', call_audit: 'Saved a call audit', shift: 'Calendar shift' };
  for (const r of rows.filter(r => r.event === 'action')) {
    const label = ACTION_LABEL[r.name] || String(r.name || '').replace(/_/g, ' ');
    const detail = r.name === 'drill' ? (r.sub || '') : r.name === 'export' ? (r.sub || '') : r.name === 'sale_audit' ? ('\u2192 ' + (r.sub || '')) : r.name === 'filters_apply' ? (r.sub || '') : (r.props && r.props.view ? 'on ' + usageScreenName(r.props.view) : (r.sub || ''));
    const k = label + '|' + detail;
    const a = actions.get(k) || (actions.set(k, { label, detail, n: 0, last: 0 }), actions.get(k));
    a.n++; const t = new Date(r.at).getTime(); if (t > a.last) a.last = t;
  }
  const acts = [...actions.values()].sort((a, b) => b.n - a.n);
  const modals = new Map();
  for (const r of rows.filter(r => r.event === 'modal')) {
    const m = modals.get(r.name) || (modals.set(r.name, { name: r.name, open: 0, done: 0 }), modals.get(r.name));
    if (r.sub === 'open') m.open++; if (r.sub === 'done') m.done++;
  }
  const errs = rows.filter(r => r.event === 'error');

  // ── Timeline: most recent 60 opens / actions in order ──
  const timeline = rows.filter(r => (r.event === 'view' && r.props && r.props.opened) || r.event === 'action' || r.event === 'error').slice(0, 60);
  const tlRow = (r) => {
    const t = new Date(r.at);
    const what = r.event === 'view' ? usageScreenName(r.name, r.sub)
      : r.event === 'error' ? '\u26a0 ' + (r.name || 'error')
      : ((ACTION_LABEL[r.name] || String(r.name || '').replace(/_/g, ' ')) + (r.sub ? ' \u00b7 ' + r.sub : ''));
    return el('tr', { class: 'border-t', style: { borderColor: 'var(--border)' } },
      td(el('span', { class: 'whitespace-nowrap', style: { color: 'var(--text-muted)' }, title: t.toLocaleString() }, t.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' ' + t.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }))),
      td(el('span', { class: r.event === 'view' ? 'font-semibold' : '', style: r.event === 'error' ? { color: '#B91C1C' } : r.event === 'action' ? { color: 'var(--text-muted)' } : {} }, what)),
      td(el('span', { class: 'text-[10px]', style: { color: 'var(--text-subtle)' } }, r.device || ''), false, 'whitespace-nowrap'));
  };

  modal.replaceChildren(head,
    el('div', { class: 'grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3' },
      stat('Days active', String(days)), stat('Sessions', String(sessions)), stat('Time in app', usageFmtDur(totalMs)), stat('Device', devTxt || '\u2014')),
    section('Screens', 'every screen they opened, ranked by time spent (sub-tab / queue included)'),
    table([th('Screen'), th('Share of time'), th('Time', true), th('Opens', true), th('Last opened')],
      scList.map(sc => el('tr', { class: 'border-t', style: { borderColor: 'var(--border)' } },
        td(el('span', { class: 'font-semibold' }, usageScreenName(sc.view, sc.sub))),
        td(el('span', { class: 'whitespace-nowrap tabular-nums text-[11px]' }, bar(totalMs ? 100 * sc.ms / totalMs : 0), (totalMs ? Math.round(100 * sc.ms / totalMs) : 0) + '%')),
        td(usageFmtDur(sc.ms), true), td(String(sc.opens), true),
        td(el('span', { title: new Date(sc.last).toLocaleString() }, timeAgo(new Date(sc.last).toISOString())), false, 'whitespace-nowrap'))), 'No screens recorded in this window.'),
    section('What they did', 'drilldowns opened, searches, audits, exports, filters'),
    table([th('Action'), th('Detail'), th('Times', true), th('Last')],
      acts.map(a => el('tr', { class: 'border-t', style: { borderColor: 'var(--border)' } },
        td(el('span', { class: 'font-semibold' }, a.label)), td(el('span', { style: { color: 'var(--text-muted)' } }, a.detail || '\u2014')), td(String(a.n), true),
        td(el('span', { title: new Date(a.last).toLocaleString() }, timeAgo(new Date(a.last).toISOString())), false, 'whitespace-nowrap'))), 'No actions recorded — just browsing.'),
    (modals.size || errs.length) ? el('div', { class: 'mt-3 text-[11px]', style: { color: 'var(--text-muted)' } },
      [...modals.values()].map(m => m.name + ': opened ' + m.open + (m.done ? ', completed ' + m.done : '')).concat(errs.length ? ['\u26a0 ' + errs.length + ' error' + (errs.length === 1 ? '' : 's') + ' hit'] : []).join(' \u00b7 ')) : null,
    section('Recent activity', 'newest first, last ' + timeline.length + ' screen opens and actions'),
    table([th('When'), th('What'), th('')], timeline.map(tlRow), 'No activity yet.'));
}

// Adoption card — lives on Settings → Usage (per Isaac, Sep 23; was on Users).
function adoptionCard(host) {
  // ── 📊 Adoption — who's actually using the app (usage_events). Card
  // renders only once the telemetry table exists and has rows; silent
  // otherwise. Cached 5 minutes so opening Users doesn't hammer the DB. ──
  if (!(typeof DEMO !== 'undefined' && DEMO)) {
    const _stale = !state._usageStats || (Date.now() - state._usageStats.at) > 5 * 60000;
    if (_stale && !state._usageStatsLoading) {
      state._usageStatsLoading = true;
      (async () => {
        try {
          const since = new Date(Date.now() - 30 * 86400000).toISOString();
          let { data, error } = await supabase.from('usage_events')
            .select('profile_id, event, detail, at, meta').gte('at', since)
            .order('at', { ascending: false }).limit(5000);
          if (error && /meta/i.test(error.message || '')) ({ data, error } = await supabase.from('usage_events')   // migration not run yet
            .select('profile_id, event, detail, at').gte('at', since).order('at', { ascending: false }).limit(5000));
          state._usageStats = { at: Date.now(), rows: error ? null : (data || []) };
        } catch (e) { state._usageStats = { at: Date.now(), rows: null }; }
        state._usageStatsLoading = false;
        if (state.view === 'admin' && state.adminSection === 'usage') mountApp();
      })();
    }
    const us = state._usageStats;
    if (us && us.rows && us.rows.length) {
      const wk = Date.now() - 7 * 86400000, day = Date.now() - 86400000;
      const nameOf = (id) => ((state.allProfiles || []).find(p => p.id === id) || {}).full_name || 'Unknown';
      const rows7 = us.rows.filter(r => new Date(r.at).getTime() >= wk);
      const active1 = new Set(us.rows.filter(r => new Date(r.at).getTime() >= day).map(r => r.profile_id));
      const active7 = new Set(rows7.map(r => r.profile_id));
      const tabCounts = {};
      rows7.forEach(r => { if (r.event === 'view' && r.detail) tabCounts[r.detail] = (tabCounts[r.detail] || 0) + 1; });
      const topTabs = Object.entries(tabCounts).sort((a, b) => b[1] - a[1]).slice(0, 5);
      const fb = us.rows.filter(r => r.event === 'feedback').slice(0, 3);
      // Every card drills down (per Isaac): who exactly, how often, which tabs.
      const stat = (label, val, drill) => el('button', { class: 'rounded-lg border px-3 py-2 text-center transition hover:brightness-95 w-full', style: { borderColor: 'var(--border)', background: 'var(--card-2)', cursor: 'pointer' }, title: 'Click for the breakdown', onclick: drill },
        el('div', { class: 'text-[9px] uppercase tracking-widest font-semibold', style: { color: 'var(--text-subtle)' } }, label),
        el('div', { class: 'text-lg font-bold tabular-nums' }, val),
        el('div', { class: 'text-[9px]', style: { color: 'var(--text-subtle)' } }, 'details \u2192'));
      host.append(el('div', { class: 'card p-4' },
        el('div', { class: 'flex items-center justify-between flex-wrap gap-2' },
          el('h3', { class: 'text-base font-bold' }, '\ud83d\udcca Adoption'),
          el('div', { class: 'text-[10px]', style: { color: 'var(--text-subtle)' } }, 'last 30 days')),
        el('div', { class: 'grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3' },
          stat('Active today', String(active1.size), () => openAdoptionDrill('users', us.rows, { since: day, title: 'Active today', sub: 'everyone with any activity in the last 24 hours' })),
          stat('Active \u00b7 7d', String(active7.size), () => openAdoptionDrill('users', us.rows, { since: wk, title: 'Active \u00b7 last 7 days', sub: 'everyone with any activity in the last 7 days' })),
          stat('Tab views \u00b7 7d', String(rows7.filter(r => r.event === 'view').length), () => openAdoptionDrill('tabs', us.rows, { since: wk, title: 'Tab views \u00b7 last 7 days', sub: 'which screens are getting opened, and by whom' })),
          stat('Feedback \u00b7 30d', String(us.rows.filter(r => r.event === 'feedback').length), () => openAdoptionDrill('feedback', us.rows, { since: 0, title: 'Feedback \u00b7 last 30 days', sub: 'everything sent through the feedback button' }))),
        ...fb.map(r => el('div', { class: 'mt-2 text-[11px] rounded-lg border px-3 py-2', style: { borderColor: 'var(--border)' } },
          el('span', { class: 'font-bold' }, '\ud83d\udce3 ' + nameOf(r.profile_id) + ': '), r.detail || '',
          (r.meta && Array.isArray(r.meta.attachments) && r.meta.attachments.length) ? el('span', { class: 'ml-2 text-[10px]', style: { color: 'var(--text-subtle)' } }, '\ud83d\udcce ' + r.meta.attachments.length) : null))));
    }
  }
}

function adminReps() {
  const host = el('div', { class: 'flex flex-col gap-4' });
  // Pull the CRM roster the first time an admin opens this screen.
  if (!(typeof DEMO !== 'undefined' && DEMO) && state.frRoster == null && !state._frRosterLoading) {
    loadFieldRoutesRoster().then(() => { if (state.view === 'admin') mountApp(); });
  }

  // Persisted UI state: which rep-type tab, active/inactive/all, search box.
  if (!REP_TYPE_TABS.includes(state._adminUserTypeTab)) state._adminUserTypeTab = 'All';
  if (state._adminUserActiveFilter == null) state._adminUserActiveFilter = 'active';
  if (state._adminUserSearch == null) state._adminUserSearch = '';
  const typeTab = state._adminUserTypeTab;
  const activeFilter = state._adminUserActiveFilter;
  const q = state._adminUserSearch.trim().toLowerCase();

  const allProfiles = state.allProfiles.length ? state.allProfiles : [state.profile];
  const roster = state.frRoster || [];
  const rosterById = new Map(roster.map(e => [e.employee_id, e]));

  // ── Merge app profiles + CRM roster into one "people" list ──
  // A person is either an app user (a real login) or a CRM-only employee
  // (display-only until provisioned). App users inherit their FieldRoutes type
  // (via link or email match); roster-only people use their CRM type.
  // The FieldRoutes employee behind an app user — linked first, then email
  // match, then full-name match (covers app logins whose email differs from
  // the CRM email, e.g. cameron@riddpest.com vs crprymak@gmail.com).
  const profFrEmp = (p) => {
    const linked = frRosterRowForProfile(p) || (p.fieldroutes_employee_id ? rosterById.get(p.fieldroutes_employee_id) : null);
    if (linked) return linked;
    const byEmail = roster.find(e => e.email && _frNormEmail(e.email) === _frNormEmail(p.email));
    if (byEmail) return byEmail;
    const pn = _frNormName(p.full_name);
    return (pn && roster.find(e => _frRealName(e) === pn || _frNormName(_frEmpName(e)) === pn)) || null;
  };
  const appByEmpId = new Map();
  const appEmails = new Set();
  allProfiles.forEach(p => { if (p.fieldroutes_employee_id) appByEmpId.set(p.fieldroutes_employee_id, p); if (p.email) appEmails.add(_frNormEmail(p.email)); });

  // Every CRM employee an app user resolves to — so they never also appear as a
  // separate "in CRM" row (which is what duplicated Cameron).
  const matchedEmpIds = new Set();
  const people = allProfiles.map(p => {
    const fr = profFrEmp(p);
    if (fr) matchedEmpIds.add(fr.employee_id);
    return {
      isApp: true, profile: p, frEmp: fr, name: p.full_name || '(no name)', email: p.email || '',
      // Rep type comes from FieldRoutes when we know it; role is only a fallback.
      type: (fr && fr.type_label) || (p.role === 'rep' ? 'Sales Rep' : 'Office Staff'),
      active: p.is_active !== false,
    };
  });
  roster.forEach(e => {
    if (appByEmpId.has(e.employee_id)) return;                       // already a linked app user
    if (matchedEmpIds.has(e.employee_id)) return;                    // matched to an app user (email or name)
    if (e.email && appEmails.has(_frNormEmail(e.email))) return;     // matches an app user's email
    if (!e.active) return;                                           // inactive in FieldRoutes — not someone to invite (roster carries them since Sep 22)
    people.push({ isApp: false, emp: e, name: _frEmpName(e), email: e.email || '', type: e.type_label || 'Office Staff', active: false });
  });

  const byName = (a, b) => a.name.localeCompare(b.name);
  const countByType = (t) => t === 'All' ? people.length : people.filter(x => x.type === t).length;

  // ── Header ──
  // Rep-type tabs sit right of the title (per Isaac — saves a row).
  // Phones (per Isaac): the four type tabs share ONE row — tighter padding
  // and the counts drop, so Sales Reps fits beside Technicians.
  const _phoneU = (() => { try { return window.matchMedia('(max-width: 640px)').matches; } catch (e) { return false; } })();
  const _typeTabs = el('div', { class: 'flex items-center gap-1' + (_phoneU ? '' : ' flex-wrap'), style: _phoneU ? { width: '100%' } : {} },
    ...REP_TYPE_TABS.map(t => {
      const on = typeTab === t;
      return el('button', {
        class: (_phoneU ? 'px-2 py-1 flex-1 justify-center' : 'px-2.5 py-1') + ' text-[11px] font-semibold transition whitespace-nowrap flex items-center gap-2 rounded-lg',
        style: { background: on ? 'rgba(223,100,58,.10)' : 'transparent', color: on ? 'var(--text)' : 'var(--text-muted)', boxShadow: on ? 'inset 0 -2px 0 var(--accent)' : 'none' },
        onclick: () => { state._adminUserTypeTab = t; mountApp(); },
      }, REP_TYPE_TAB_LABEL[t],
        _phoneU ? null : el('span', { class: 'text-[10px] tabular-nums px-1.5 py-0.5 rounded', style: { background: 'var(--card-2)', color: 'var(--text-muted)' } }, countByType(t).toLocaleString()));
    }));
  // The eye (view-as) + New user move down to the status row on phones so
  // everything sits on one line: [Active | Inactive | All] [+ New user] [Filters] [👁].
  const _actionsRow = el('div', { class: 'flex items-center gap-2' });
  host.append(el('div', { class: 'flex items-center justify-between flex-wrap gap-3' },
    el('div', { class: 'flex items-center gap-4 flex-wrap' + (_phoneU ? ' w-full' : '') },
      el('h3', { class: 'text-lg font-bold' }, 'Users'), _typeTabs),
    _actionsRow));
  _actionsRow.append(
      // 👁 View-as — icon only; the hover tip explains it, the click opens
      // a small role menu. Renders the app exactly as that role sees it (the
      // floating pill brings you back to admin).
      (() => {
        const wrap = el('div', { class: 'relative' });
        const menu = el('div', {
          class: 'card',
          style: { position: 'absolute', top: 'calc(100% + 6px)', right: '0', minWidth: '190px', padding: '6px', display: 'none', zIndex: '50', boxShadow: 'var(--shadow-lg)' },
        },
          el('div', { class: 'px-3 pt-1.5 pb-2 text-[10px] uppercase tracking-widest font-semibold', style: { color: 'var(--text-subtle)' } }, 'View the app as\u2026'),
          ...['rep_sales', 'rep_partner', 'rep_team_lead', 'rep_office', 'rep_office_lead', 'rep_loyalty', 'rep_loyalty_lead', 'office_staff', 'tech_regional', 'tech_branch', 'tech_senior_lead', 'tech_pro', 'auditor', 'developer'].map(v => [v, ROLE_LABEL[v]]).map(([v, label]) => el('button', {
            class: 'w-full text-left px-2.5 py-1 rounded-lg text-[11px] font-medium transition',
            style: { color: 'var(--text)' },
            onmouseenter: (e) => { e.currentTarget.style.background = 'var(--card-2)'; },
            onmouseleave: (e) => { e.currentTarget.style.background = 'transparent'; },
            onclick: () => setViewAsRole(v),
          }, label)),
          // ── View as a specific PERSON (per Isaac): their whole identity —
          // name, id, role, office, team reach — so the page is exactly what
          // they get (team card, drills, permissions), not just their role.
          el('div', { class: 'px-3 pt-2 pb-1 mt-1 border-t text-[10px] uppercase tracking-widest font-semibold', style: { borderColor: 'var(--border)', color: 'var(--text-subtle)' } }, 'View as a person\u2026'),
          (() => {
            const list = el('div', { class: 'flex flex-col', style: { maxHeight: '220px', overflowY: 'auto' } });
            const roleRank = (r) => (['rep_partner', 'rep_team_lead', 'rep_office_lead', 'rep_loyalty_lead', 'rep_office', 'rep_loyalty', 'office_staff', 'rep_sales', 'tech_regional', 'tech_branch', 'tech_senior_lead', 'tech_pro'].indexOf(r) + 1) || 99;
            const people = (state.allProfiles || []).filter(p => p && p.id && p.is_active !== false && !isAdminRole(p.role))
              .sort((a, b) => (roleRank(a.role) - roleRank(b.role)) || String(a.full_name || '').localeCompare(String(b.full_name || '')));
            const shortRole = (r) => (ROLE_LABEL[r] || r || '').replace(/^Rep - /, '');
            const draw = (q) => {
              list.replaceChildren();
              const needle = String(q || '').trim().toLowerCase();
              const hits = needle ? people.filter(p => (String(p.full_name || '') + ' ' + shortRole(p.role)).toLowerCase().includes(needle)) : people;
              if (!hits.length) { list.append(el('div', { class: 'px-2.5 py-1 text-[10px]', style: { color: 'var(--text-subtle)' } }, 'No match')); return; }
              let lastRole = null;
              hits.forEach(p => {
                if (!needle && p.role !== lastRole) {
                  lastRole = p.role;
                  list.append(el('div', { class: 'px-2.5 pt-1.5 pb-0.5 text-[9px] uppercase tracking-widest font-semibold', style: { color: 'var(--text-subtle)' } }, shortRole(p.role)));
                }
                list.append(el('button', {
                  class: 'w-full text-left px-2.5 py-1 rounded-lg text-[11px] font-medium transition flex items-center justify-between gap-2',
                  style: { color: 'var(--text)' },
                  onmouseenter: (e) => { e.currentTarget.style.background = 'var(--card-2)'; },
                  onmouseleave: (e) => { e.currentTarget.style.background = 'transparent'; },
                  onclick: () => setViewAsProfile(p),
                }, el('span', { class: 'truncate' }, p.full_name || p.email || p.id),
                  needle ? el('span', { class: 'text-[9px] uppercase tracking-wider shrink-0', style: { color: 'var(--text-subtle)' } }, shortRole(p.role)) : null));
              });
            };
            const inp = el('input', { type: 'text', placeholder: 'Search a name or role\u2026', class: 'rounded-lg border px-2.5 py-1 text-[11px] w-full mb-1', style: { borderColor: 'var(--border-2)', background: 'var(--card)', color: 'var(--text)' },
              oninput: (e) => draw(e.target.value), onclick: (e) => e.stopPropagation() });
            draw('');
            return el('div', { class: 'px-1.5 pb-1' }, inp, list);
          })());
        const btn = el('button', {
          class: 'icon-btn show',
          // A fixed 28px box (per Isaac, Oct 16): the bare emoji glyph spilled past the table's right edge.
          style: { width: '28px', height: '28px', minWidth: '28px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '15px', lineHeight: '1', padding: '0', overflow: 'hidden' },
          title: 'Change rep type view',
          onclick: () => {
            const open = menu.style.display === 'block';
            if (!open) {
              // Anchor to whichever side has room — right-anchored clipped
              // off-screen when the wrapped mobile header put the eye at
              // the LEFT edge.
              const r = wrap.getBoundingClientRect();
              if (r.left < 210) { menu.style.right = 'auto'; menu.style.left = '0'; }
              else { menu.style.left = 'auto'; menu.style.right = '0'; }
            }
            menu.style.display = open ? 'none' : 'block';
            if (!open) setTimeout(() => document.addEventListener('mousedown', function closer(ev) {
              if (!wrap.contains(ev.target)) { menu.style.display = 'none'; document.removeEventListener('mousedown', closer); }
            }), 0);
          },
        }, '\ud83d\udc41');
        wrap.append(btn, menu);
        return wrap;
      })(),
      el('button', {
        class: 'px-2.5 py-1 rounded-xl font-semibold text-[11px] transition hover:brightness-95',
        style: { background: 'var(--accent)', color: 'var(--accent-text)', height: '28px' },
        onclick: () => openUserEditor(),
      }, '+ User'));   // shorter label (per Isaac, Oct 9) so it fits beside the status toggle on phones
  // (the two action controls are re-homed into the status row below)
  const _eyeWrap = _actionsRow.children[0], _newUserBtn = _actionsRow.children[1];

  // ── Roster status banner — tells the admin exactly why the CRM roster is
  // empty (table missing → run the SQL; loaded 0 → run a sync; or an error). ──
  if (!(typeof DEMO !== 'undefined' && DEMO) && roster.length === 0) {
    const err = state._frRosterError || '';
    const missingTable = /relation .*does not exist|could not find the table|schema cache/i.test(err);
    host.append(el('div', { class: 'card p-4', style: { borderLeft: '3px solid var(--accent)' } },
      el('div', { class: 'text-sm font-bold mb-1' }, 'FieldRoutes roster not loaded yet'),
      el('div', { class: 'text-xs text-muted-' },
        missingTable
          ? 'The fieldroutes_employees table doesn’t exist yet — run fieldroutes_link.sql in Supabase; the next scheduled sync (hourly) fills it.'
          : err
            ? ('Couldn’t read the roster: ' + err)
            : 'The table is empty — the next scheduled sync (hourly during the day) pulls the FieldRoutes roster automatically.')));
  }

  // ── Active / Inactive / All + column filters + search — ONE row:
  // status toggle on the left; ⚲ filters sit just left of the search box. ──
  const inTab = typeTab === 'All' ? people : people.filter(x => x.type === typeTab);
  const aCount = inTab.filter(x => x.active).length;
  // Filters button retired (per Isaac, Oct 16 — search covers it); clear any pick left over so nothing filters silently.
  state._adminUserFilters = {}; state._adminUserFiltersOpen = false;
  const F = state._adminUserFilters;
  const _roleOpts = [...new Set(inTab.filter(x => x.isApp).map(x => String(x.profile.role || '')))].filter(Boolean).sort();
  const _officeOpts = [...new Set(inTab.flatMap(x => { const e = x.frEmp || x.emp; return String((e && e.office_name) || '').split(',').map(s => s.trim()).filter(Boolean); }))].sort();
  const _fActive = ['role', 'office', 'tier'].filter(k => F[k]).length;
  const _fSel = (key, label, opts) => el('select', {
    class: 'rounded-lg border px-2.5 py-1 text-[11px] cursor-pointer w-full',
    style: { borderColor: F[key] ? 'var(--accent)' : 'var(--border-2)', background: 'var(--card)', color: 'var(--text)', fontWeight: F[key] ? '700' : '400' },
    title: 'Filter the list by ' + label.toLowerCase(),
    onchange: (e) => { F[key] = e.target.value; mountApp(); },
  },
    el('option', { value: '', selected: !F[key] }, label + ' — all'),
    ...opts.map(o => el('option', { value: o.v, selected: F[key] === o.v }, o.t)));
  // ONE row: status toggle · Filters dropdown (Access Profile / Branch /
  // Tier + Clear live inside) · search stretching to fill what's left —
  // on phones the search wraps to its own full-width line.
  const _filtersWrap = (() => {
    const wrap = el('div', { class: 'relative' });
    const _fLabel = (t) => el('div', { class: 'text-[9px] uppercase tracking-widest font-semibold px-0.5 pb-1', style: { color: 'var(--text-subtle)' } }, t);
    const panel = el('div', {
      class: 'card absolute p-3 flex flex-col gap-2',
      style: { top: 'calc(100% + 6px)', left: '0', minWidth: '250px', zIndex: '40', boxShadow: 'var(--shadow-lg)', display: state._adminUserFiltersOpen ? 'flex' : 'none' },
    },
      el('div', {}, _fLabel('Access Profile'), _fSel('role', 'Access Profile', [..._roleOpts.map(r => ({ v: r, t: roleLabel(r) })), { v: '__crm', t: 'In CRM (not added)' }])),
      el('div', {}, _fLabel('Office'), _fSel('office', 'Office', _officeOpts.map(o => ({ v: o, t: o })))),
      el('div', {}, _fLabel('Tier'), _fSel('tier', 'Tier', (typeof REP_TIERS !== 'undefined' ? REP_TIERS : []).map(t => ({ v: t.id, t: t.label })))),
      _fActive ? el('button', {
        class: 'text-[11px] font-bold px-2.5 py-1 rounded-lg border transition hover:brightness-95',
        style: { borderColor: 'var(--accent)', color: 'var(--accent)' },
        onclick: () => { state._adminUserFilters = {}; mountApp(); },
      }, '× Clear (' + _fActive + ')') : null);
    const btn = el('button', {
      class: 'px-2.5 py-1 rounded-xl border text-[11px] font-semibold transition hover:brightness-95 flex items-center gap-1.5',
      style: _fActive
        ? { background: 'var(--accent)', color: 'var(--accent-text)', borderColor: 'var(--accent)' }
        : { borderColor: 'var(--border-2)', color: 'var(--text)' },
      onclick: (e) => {
        e.stopPropagation();
        const open = panel.style.display === 'flex';
        panel.style.display = open ? 'none' : 'flex';
        state._adminUserFiltersOpen = !open;
        if (!open) clampDropdownPanel(panel);
        if (!open) setTimeout(() => document.addEventListener('mousedown', function closer(ev) {
          if (wrap.contains(ev.target)) return;
          panel.style.display = 'none'; state._adminUserFiltersOpen = false;
          document.removeEventListener('mousedown', closer);
        }), 0);
      },
    }, 'Filters');   // orange when on, no count (per Isaac, Oct 15)
    if (state._adminUserFiltersOpen) setTimeout(() => document.addEventListener('mousedown', function closer(ev) {
      if (!wrap.isConnected) { document.removeEventListener('mousedown', closer); return; }
      if (wrap.contains(ev.target)) return;
      panel.style.display = 'none'; state._adminUserFiltersOpen = false;
      document.removeEventListener('mousedown', closer);
    }), 0);
    wrap.append(btn, panel);
    clampDropdownPanel(panel);
    return wrap;
  })();
  _actionsRow.remove();
  // Phones (per Isaac, Oct 9): row 1 = status toggle + "+ User"; row 2 = the search across the width, Filters and 👁 at its end.
  const _statusToggle = el('div', { class: 'inline-flex rounded-xl border overflow-hidden shrink-0', style: { borderColor: 'var(--border-2)', height: '28px' } },
      ...[
        { id: 'active', label: 'Active', count: aCount },
        { id: 'inactive', label: 'Inactive', count: inTab.length - aCount },
        { id: 'all', label: 'All', count: inTab.length },
      ].map(t => el('button', {
        class: 'px-2.5 py-1 text-[11px] font-semibold transition flex items-center gap-1.5',
        style: activeFilter === t.id ? { background: 'var(--accent)', color: 'var(--accent-text)' } : { background: 'transparent', color: 'var(--text)' },
        onclick: () => { state._adminUserActiveFilter = t.id; mountApp(); },
      }, el('span', {}, t.label),
        el('span', { class: 'text-[10px] tabular-nums px-1.5 py-0.5 rounded', style: activeFilter === t.id ? { background: 'rgba(0,0,0,.15)', color: 'var(--accent-text)' } : { background: 'var(--card-2)', color: 'var(--text-muted)' } }, t.count.toLocaleString()))));
  const _searchInp = el('input', {
      id: 'admin-user-search',
      class: 'rounded-xl border px-2.5 py-1 text-[11px] flex-1 min-w-0', style: { borderColor: 'var(--border-2)', minWidth: _phoneU ? '0' : '220px', height: '28px', marginRight: '6px' },   // takes the Filters button's room (per Isaac, Oct 16)
      placeholder: 'Search ' + REP_TYPE_TAB_LABEL[typeTab] + '…', value: state._adminUserSearch,
      // The debounced mountApp() rebuilds the whole page, which replaces
      // this input and dropped focus mid-word - typing felt like the page
      // refreshed on every character. The list is paginated with per-tab
      // counts, so rows can't just be hidden in place like the leaderboard
      // search; instead the remount re-focuses the rebuilt input with the
      // caret back where it was.
      oninput: (e) => {
        state._adminUserSearch = e.target.value;
        clearTimeout(state._adminUserSearchT);
        state._adminUserSearchT = setTimeout(() => {
          mountApp();
          const inp = document.getElementById('admin-user-search');
          if (inp) { inp.focus(); const n = inp.value.length; try { inp.setSelectionRange(n, n); } catch (err) { /* non-text input */ } }
        }, 200);
      },
    });
  if (_phoneU) host.append(el('div', { class: 'flex flex-col gap-2' },
    el('div', { class: 'flex items-center gap-2' }, _statusToggle, el('div', { class: 'ml-auto shrink-0' }, _newUserBtn)),
    el('div', { class: 'flex items-center gap-2 w-full' }, _searchInp, _eyeWrap)));
  else host.append(el('div', { class: 'flex items-center flex-wrap gap-2' }, _statusToggle, _searchInp,
    // Right-hand cluster (per Isaac): search sits left, actions pinned right.
    el('div', { class: 'flex items-center gap-2 shrink-0 ml-auto' }, _newUserBtn, _eyeWrap)));

  // ── Build the filtered, capped list for this tab ──
  let list = inTab;
  if (activeFilter === 'active') list = list.filter(x => x.active);
  else if (activeFilter === 'inactive') list = list.filter(x => !x.active);
  if (q) list = list.filter(x => (x.name + ' ' + x.email).toLowerCase().includes(q));
  if (F.role) list = list.filter(x => (x.isApp ? String(x.profile.role || '') : '__crm') === F.role);
  if (F.office) list = list.filter(x => { const e = x.frEmp || x.emp; return String((e && e.office_name) || '').split(',').map(s => s.trim()).includes(F.office); });
  // (Tier filter is applied a few lines down, once repKeyForPerson exists.)

  const statusChip = (active) => el('span', { class: 'chip', style: active
    ? { background: 'rgba(21,128,61,.10)', color: '#15803D', border: '1px solid rgba(21,128,61,.30)' }   // light green (per Isaac, Oct 16)
    : { background: 'rgba(220,38,38,.08)', color: '#B91C1C', border: '1px solid rgba(220,38,38,.25)' } }, active ? 'Active' : 'Inactive');

  // Readable last-login from the CRM string ("YYYY-MM-DD HH:MM:SS" or blank).
  const fmtLogin = (s) => {
    if (!s || /^0+[^0-9]/.test(String(s)) || /^0000/.test(String(s))) return 'Never';
    const d = new Date(String(s).replace(' ', 'T'));
    return isNaN(d) ? String(s) : d.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: '2-digit' });
  };
  const td  = (v, extra) => el('td', { class: 'px-2.5 py-2.5 ' + (extra || '') }, v == null || v === '' ? '—' : v);
  const tdM = (v) => td(v, 'text-muted-');

  // ── Team + Tier columns (read from the same maps Manage Teams writes) ──
  // Those maps are keyed by the canonical sales-data rep name ("Last, First"),
  // while a profile carries "First Last". Bridge them with a format-agnostic
  // name signature, the same trick Manage Teams uses. Team is per-Team-Year;
  // Tier is global.
  const _sig = (n) => String(n || '').toLowerCase().replace(/[.,]/g, ' ').split(/\s+/).filter(Boolean).sort().join(' ');
  const _repKeyBySig = {};
  const _seedKey = (name) => { if (!name) return; const s = _sig(name); if (s && !_repKeyBySig[s]) _repKeyBySig[s] = name; };
  Object.keys(_activeTeamMap() || {}).forEach(_seedKey);
  Object.keys(state._indicatorRepTier || {}).forEach(_seedKey);
  (state.reportingSubscriptions || []).forEach(r => { if (r.sold_by) _seedKey(getCanonicalRepName(r.sold_by)); });
  // The canonical rep name to read/write team & tier for this person.
  const repKeyForPerson = (x) => {
    const s = _sig(x.name);
    if (_repKeyBySig[s]) return _repKeyBySig[s];
    const frName = x.frEmp ? _frEmpName(x.frEmp) : (x.emp ? _frEmpName(x.emp) : '');
    if (frName) { const s2 = _sig(frName); if (_repKeyBySig[s2]) return _repKeyBySig[s2]; }
    return x.name; // no match yet — key under their own name
  };
  // Tier filter needs repKeyForPerson, so it lands here; then split the list.
  if (F.tier) list = list.filter(x => (getRepTier(repKeyForPerson(x)) || '') === F.tier);
  // ── Click-to-sort — any column header toggles asc/desc. App users and
  // CRM-only rows each sort within their own block (app users stay on top).
  if (!state._adminUserSort) state._adminUserSort = { key: 'name', asc: true };
  const _us = state._adminUserSort;
  const _sortVal = (x, key) => {
    const p = x.profile, e2 = x.frEmp || x.emp;
    switch (key) {
      case 'id':       return Number((e2 && e2.employee_id) || 0) || 0;
      case 'username': return String((e2 && e2.username) || '').toLowerCase();
      case 'role':     return x.isApp ? roleLabelOf(p).toLowerCase() : '~in crm';
      case 'reptype':  return (x.type || '').toLowerCase();
      case 'phone':    return String((p && p.phone) || (e2 && e2.phone) || '');
      case 'email':    return String((p && p.email) || (e2 && e2.email) || '').toLowerCase();
      case 'tier':     return getRepTier(repKeyForPerson(x)) || '~';
      case 'status':   return x.active ? 0 : 1;
      default:         return (x.name || '').toLowerCase();
    }
  };
  const bySort = (a, b) => {
    const va = _sortVal(a, _us.key), vb = _sortVal(b, _us.key);
    const cmp = (typeof va === 'number' && typeof vb === 'number') ? va - vb : String(va).localeCompare(String(vb));
    return (_us.asc ? cmp : -cmp) || byName(a, b);
  };
  const appPeople = list.filter(x => x.isApp).sort(bySort);
  const rosterPeople = list.filter(x => !x.isApp).sort(bySort);
  // CRM-only rows are PAGED — 25 per page with arrows under the table. The
  // page resets whenever the tab / search / filters change the list.
  const PAGE_SIZE = 25;
  const _pageSig = [typeTab, activeFilter, q, F.role || '', F.office || '', F.tier || ''].join('|');
  if (state._adminUserPageSig !== _pageSig) { state._adminUserPageSig = _pageSig; state._adminUserRosterPage = 0; }
  const pageCount = Math.max(1, Math.ceil(rosterPeople.length / PAGE_SIZE));
  const page = Math.min(state._adminUserRosterPage || 0, pageCount - 1);
  state._adminUserRosterPage = page;
  const rosterShown = rosterPeople.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  // Tier cell. Currently writes the manual Rookie/Vet tag (shared with Manage
  // Teams). TODO: once FieldRoutes carries a rookie/vet designation, source this
  // read-only from the roster instead of the manual tag.
  const tierCell = (x) => el('td', { class: 'px-3 py-3' }, repTierSelect(repKeyForPerson(x), mountApp));

  // Avatar that opens a photo picker on click (app users only) — saves straight
  // from the table without opening the editor. Hover shows an accent ring + 📷.
  const clickableAvatar = (p) => {
    const wrap = el('button', {
      class: 'relative shrink-0 cursor-pointer rounded-full',
      title: 'Click to change photo',
      style: { lineHeight: '0', borderRadius: '0', transition: 'box-shadow .12s' },
      onmouseenter: (e) => { e.currentTarget.style.boxShadow = '0 0 0 2px var(--accent)'; const b = e.currentTarget.querySelector('[data-cam]'); if (b) b.style.opacity = '1'; },
      onmouseleave: (e) => { e.currentTarget.style.boxShadow = 'none'; const b = e.currentTarget.querySelector('[data-cam]'); if (b) b.style.opacity = '0'; },
      onclick: (e) => { e.stopPropagation(); changeProfileAvatar(p); },
    },
      avatarNode(p.avatar_url, p.initials, 'w-9 h-9 text-[10px]'),
      el('div', { 'data-cam': '1', class: 'absolute rounded-full flex items-center justify-center',
        style: { bottom: '-2px', right: '-2px', width: '16px', height: '16px', background: '#323230', border: '2px solid var(--card)', opacity: '0', transition: 'opacity .12s' } },
        el('span', { style: { color: '#F3F3F3', fontSize: '8px' } }, '📷')));
    return wrap;
  };

  const appRow = (x) => {
    const p = x.profile, active = x.active, fr = x.frEmp;
    return el('tr', { class: 'border-t border-' + (!active ? ' opacity-60' : '') },
      tdM(fr ? fr.employee_id : null),                                    // ID (CRM)
      el('td', { class: 'px-4 py-3' }, el('div', { class: 'flex items-center gap-3' },
        clickableAvatar(p),
        el('div', {}, el('div', { class: 'font-semibold' }, p.full_name),
          fr && !p.fieldroutes_employee_id ? el('div', { class: 'text-[10px]', style: { color: 'var(--accent)' } }, '↔ match — confirm to link') : null))),
      tdM(fr ? fr.username : null),                                       // User ID (CRM username)
      td(roleLabelOf(p), p.is_owner ? 'font-bold' : ''),                 // Access Profile (app role)
      td(fr ? fr.type_label : null, fr ? '' : 'text-muted- italic'),      // Rep Type (CRM)
      tdM(p.phone || (fr ? fr.phone : null)),                             // Phone (profile wins, else CRM)
      // (Email column dropped from the list — per Isaac, Oct 16; it's in Edit User. Search still matches it.)
      // Last Login moved into Edit User — it was costing a whole column.
      tierCell(x),                                                       // Tier
      el('td', { class: 'px-3 py-3 text-center' },
        el('button', { title: active ? 'Click to deactivate' : 'Click to activate (offers a reset-link email)', onclick: () => setProfileActive(p, !active) }, statusChip(active))),
      el('td', { class: 'px-3 py-3 text-right whitespace-nowrap' },
        // Row-level password-reset button retired (per Isaac) - the reset
        // link lives in Edit User (sendPasswordResetLink via the editor's
        // Send Reset Link button), so the row stays one action wide.
        el('button', { class: 'text-[11px] px-2.5 py-1 rounded-lg border border- text-muted- hover:text-default transition', onclick: () => openUserEditor(p) }, 'Edit')));
  };
  const rosterRow = (x) => {
    const e = x.emp;
    return el('tr', { class: 'border-t border- opacity-80' },
      tdM(e.employee_id),                                                 // ID
      el('td', { class: 'px-4 py-3' }, el('div', { class: 'flex items-center gap-3' },
        avatarNode(null, (e.fname || '?')[0] + (e.lname || '')[0], 'w-9 h-9 text-[10px]'),
        // Branch list moved off the row (it made Name eat the table) — hover
        // the name to see which branches this person has access to.
        el('div', { class: 'font-semibold whitespace-nowrap', title: e.office_name ? 'Offices: ' + e.office_name : undefined }, x.name))),
      tdM(e.username),                                                    // User ID
      el('td', { class: 'px-3 py-3 text-muted- italic' }, 'In CRM'),      // Access Profile (none yet)
      td(e.type_label),                                                   // Rep Type
      tdM(e.phone),                                                       // Phone
      tierCell(x),                                                       // Tier
      el('td', { class: 'px-3 py-3 text-center' }, statusChip(false)),
      el('td', { class: 'px-3 py-3 text-right' },
        el('button', { class: 'text-[11px] px-2.5 py-1 rounded-lg font-bold transition hover:brightness-95 whitespace-nowrap', style: { background: 'var(--accent)', color: 'var(--accent-text)' },
          onclick: () => openUserEditor(null, {
            // REAL first+last (matches CRM sold_by), never the nickname —
            // a nickname profile can't match its own sales rows.
            full_name: _frRealName(e).replace(/\b\w/g, c => c.toUpperCase()) || x.name,
            email: e.email || '', phone: e.phone || '',
            role: crmSellerIs('office_staff', e.type_label || '') ? 'rep_office' : crmSellerIs('technician', e.type_label || '') ? 'tech_pro' : 'rep_sales',
            fieldroutes_employee_id: e.employee_id }) }, '+ Add to app')));
  };

  const th = (label, align, key) => key
    ? el('th', {
        class: (align || 'text-left') + ' px-3 py-3 cursor-pointer select-none transition hover:brightness-110 whitespace-nowrap',
        style: _us.key === key ? { color: 'var(--accent)', fontWeight: '800' } : {},
        title: 'Sort by ' + label + (_us.key === key ? (_us.asc ? ' — descending next' : ' — ascending next') : ''),
        onclick: () => { if (_us.key === key) { _us.asc = !_us.asc; } else { _us.key = key; _us.asc = true; } mountApp(); },
      }, label)
    : el('th', { class: (align || 'text-left') + ' px-3 py-3' }, label);
  host.append(el('div', { class: 'card overflow-hidden' }, el('div', { class: 'scroll-x' },
    // Fixed column widths (per Isaac, Oct 16): Active, Inactive and All line up the same whatever the names are.
    (() => { if (!document.getElementById('users-tbl-css')) { const st = document.createElement('style'); st.id = 'users-tbl-css';
      st.textContent = 'table.users-tbl td, table.users-tbl th { overflow: hidden; text-overflow: ellipsis; }'; document.head.appendChild(st); } return null; })(),
    el('table', { class: 'w-full text-sm whitespace-nowrap users-tbl', style: { tableLayout: 'fixed', minWidth: '960px' } },
      el('colgroup', {}, ...['6%', '17%', '13%', '18%', '9%', '10%', '10%', '9%', '8%'].map(w => el('col', { style: { width: w } }))),
      el('thead', { class: 'text-[10px] uppercase tracking-widest text-muted-' }, el('tr', {},
        th('ID', null, 'id'), th('Name', 'text-left', 'name'), th('User Name', null, 'username'), th('Access Profile', null, 'role'),
        th('Rep Type', null, 'reptype'), th('Phone', null, 'phone'),
        th('Tier', null, 'tier'), th('Status', 'text-center', 'status'), th('', 'text-right'))),
      el('tbody', {},
        (appPeople.length + rosterShown.length) === 0
          ? el('tr', {}, el('td', { class: 'px-4 py-8 text-center text-xs text-muted- italic', colspan: 9 },
              q ? 'No ' + REP_TYPE_TAB_LABEL[typeTab] + ' match “' + state._adminUserSearch + '”.' : 'No ' + REP_TYPE_TAB_LABEL[typeTab] + ' in this view.'))
          : null,
        ...appPeople.map(appRow),
        ...rosterShown.map(rosterRow))))));

  if (rosterPeople.length > PAGE_SIZE) {
    const _pFirst = page * PAGE_SIZE + 1;
    const _pLast = Math.min(rosterPeople.length, (page + 1) * PAGE_SIZE);
    const pagerBtn = (label, enabled, go) => el('button', {
      class: 'rounded-lg border px-2.5 py-1 text-[11px] font-bold transition' + (enabled ? ' hover:brightness-95 cursor-pointer' : ''),
      style: enabled
        ? { borderColor: 'var(--border-2)', color: 'var(--text)' }
        : { borderColor: 'var(--border)', color: 'var(--text-subtle)', cursor: 'default' },
      disabled: !enabled,
      title: label === '‹' ? 'Previous page' : 'Next page',
      onclick: enabled ? go : undefined,
    }, label);
    host.append(el('div', { class: 'flex items-center justify-between flex-wrap gap-2' },
      el('div', { class: 'text-[11px] text-muted-' },
        'Showing ' + _pFirst + '–' + _pLast + ' of ' + rosterPeople.length.toLocaleString() + ' CRM-only ' + REP_TYPE_TAB_LABEL[typeTab]),
      el('div', { class: 'flex items-center gap-1' },
        pagerBtn('‹', page > 0, () => { state._adminUserRosterPage = page - 1; mountApp(); }),
        el('span', { class: 'text-[11px] font-semibold px-2 tabular-nums' }, 'Page ' + (page + 1) + ' of ' + pageCount),
        pagerBtn('›', page < pageCount - 1, () => { state._adminUserRosterPage = page + 1; mountApp(); }))));
  }

  // ── Auto-link review (email matches) — kept as a banner above the list ──
  if (roster.length) {
    const linkedIds = new Set(allProfiles.map(p => p.fieldroutes_employee_id).filter(Boolean));
    const suggestions = [];
    for (const p of allProfiles) {
      if (p.fieldroutes_employee_id) continue;
      const hit = profFrEmp(p); // email or full-name match
      if (hit && !linkedIds.has(hit.employee_id)) suggestions.push({ p, e: hit });
    }
    if (suggestions.length) {
      host.append(el('div', { class: 'card p-4' },
        el('div', { class: 'flex items-center justify-between flex-wrap gap-2 mb-3' },
          el('div', {},
            el('h3', { class: 'text-base font-bold' }, '↔ FieldRoutes links to review'),
            el('p', { class: 'text-xs text-muted-' }, suggestions.length + ' app user' + (suggestions.length === 1 ? '' : 's') + ' matched a CRM employee by email. Confirm to link.')),
          el('button', { class: 'px-2.5 py-1 rounded-lg text-[11px] font-bold transition hover:brightness-95', style: { background: 'var(--accent)', color: 'var(--accent-text)' },
            onclick: async () => { for (const s of suggestions) { await applyFieldRoutesLink(s.p.id, s.e.employee_id); } } }, 'Link all ' + suggestions.length)),
        el('div', { class: 'flex flex-col divide-y', style: { borderColor: 'var(--border)' } },
          ...suggestions.slice(0, 30).map(({ p, e }) => el('div', { class: 'flex items-center justify-between gap-3 py-2 text-sm' },
            el('div', { class: 'min-w-0' },
              el('span', { class: 'font-semibold' }, p.full_name),
              el('span', { class: 'text-muted-' }, ' → ' + _frEmpName(e) + (e.office_name ? ' · ' + e.office_name : '') + (e.type_label ? ' · ' + e.type_label : '')),
              el('div', { class: 'text-[11px] text-muted-' }, p.email)),
            el('button', { class: 'text-[11px] px-2.5 py-1 rounded-lg border font-semibold transition hover:brightness-95', style: { borderColor: 'var(--border-2)' },
              onclick: () => applyFieldRoutesLink(p.id, e.employee_id) }, 'Link'))))));
    }
  }

  return host;
}

