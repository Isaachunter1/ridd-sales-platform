// ┌─ src/54-competitions.js ─────────────────────────────────────────────────────
// │ Competitions view (rules engine, bingo/royalty comps).
// │ Part of the app.js bundle (tools/bundle.js concatenates src/*.js in name order).
// └────────────────────────────────────────────────────────────────────────
// ──────────────────────────────────────────────────────────────────────────
// VIEW: COMPETITIONS
// ──────────────────────────────────────────────────────────────────────────
function viewCompetitions() {
  const active = state.competitions.filter(c => c.is_active && isCompActive(c));
  const upcoming = state.competitions.filter(c => c.is_active && new Date(c.start_date) > new Date());
  const past = state.competitions.filter(c => !c.is_active || new Date(c.end_date) < new Date());

  const container = el('div', { class: 'flex flex-col gap-6 w-full' });

  container.append(
    el('div', {},
      el('h1', { class: 'text-3xl font-bold' }, 'Competitions'),
      el('p', { class: 'text-battle-2 text-sm mt-1' }, 'Live progress on your active competitions.'),
    ),
  );

  if (active.length === 0 && upcoming.length === 0) {
    container.append(el('div', { class: 'card p-10 text-center' },
      el('div', { class: 'text-battle-2 text-sm mb-2' }, 'No competitions yet.'),
      isAdminRole(state.profile?.role) && el('button', {
        class: 'mt-2 px-2.5 py-1 rounded-xl bg-lime text-eerie font-semibold text-[11px]',
        onclick: () => { state.view = 'admin'; history.replaceState(null, '', VIEW_TO_HASH['admin'] || '#admin'); mountApp(); },
      }, 'Create one \u2192'),
    ));
    return container;
  }

  active.forEach(c => container.append(competitionCard(c)));
  if (upcoming.length) {
    container.append(el('h2', { class: 'text-lg font-semibold mt-4' }, 'Upcoming'));
    upcoming.forEach(c => container.append(competitionCard(c, { compact: true })));
  }
  if (past.length) {
    container.append(el('h2', { class: 'text-lg font-semibold mt-4' }, 'Past'));
    past.slice(0, 5).forEach(c => container.append(competitionCard(c, { compact: true })));
  }
  return container;
}

function competitionCard(comp, { compact = false } = {}) {
  const rules = state.compRules.filter(r => r.competition_id === comp.id);
  const myProgress = state.compProgress.filter(p => p.competition_id === comp.id && p.rep_id === state.profile.id);
  const progressByRuleId = Object.fromEntries(myProgress.map(p => [p.rule_id, p]));

  // Bingo grid vs list
  const isBingo = comp.type === 'bingo';
  const gridRules = isBingo
    ? rules.filter(r => r.bingo_row != null && r.bingo_col != null).sort((a, b) => a.bingo_row - b.bingo_row || a.bingo_col - b.bingo_col)
    : rules;

  const cols = isBingo ? Math.max(...rules.map(r => r.bingo_col || 0), 0) + 1 : 0;

  const card = el('div', { class: 'card p-5 sm:p-6' },
    // Header
    el('div', { class: 'flex items-start justify-between gap-4 mb-4' },
      el('div', {},
        el('div', { class: 'text-[10px] uppercase tracking-widest text-battleship' },
          comp.category.replace('_', ' ') + ' · ' + comp.type + ' · ' + fmt.dateShort(comp.start_date) + ' → ' + fmt.dateShort(comp.end_date)),
        el('h2', { class: 'text-2xl font-bold mt-1' }, comp.name),
        comp.description && el('p', { class: 'text-sm text-battle-2 mt-1 max-w-2xl' }, comp.description),
      ),
      el('div', { class: 'text-right shrink-0' },
        el('div', { class: 'text-[10px] uppercase tracking-widest text-battleship' }, 'Prize'),
        el('div', { class: 'text-lg font-bold text-lime' }, comp.prize_text || '—'),
      ),
    ),

    compact ? null :
    // Bingo card grid
    isBingo && gridRules.length > 0
      ? el('div', {
          class: 'grid gap-2',
          style: { gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` },
        },
          gridRules.map(rule => {
            const p = progressByRuleId[rule.id];
            const met = p?.met || false;
            const cv = p ? Number(p.current_value) : 0;
            return el('div', {
              class: 'bingo-square',
              'data-met': met,
              title: `${rule.label} — current: ${cv}/${rule.threshold}`,
            },
              el('div', { class: 'font-semibold' }, rule.label),
              el('div', { class: 'text-[10px] text-battleship mt-1 tabular-nums' }, `${cv} / ${rule.threshold}`),
              el('div', { class: 'check mt-1' }, '✓'),
            );
          })
        )
      : !isBingo && rules.length > 0
        ? el('div', { class: 'flex flex-col gap-2' },
            rules.map(rule => {
              const p = progressByRuleId[rule.id];
              const met = p?.met || false;
              const cv = p ? Number(p.current_value) : 0;
              return el('div', {
                class: 'flex items-center justify-between p-3 rounded-lg border border-eerie3 bg-eerie',
                style: met ? { borderColor: '#DF643A', background: 'rgba(223,100,58,.08)' } : {},
              },
                el('div', {},
                  el('div', { class: 'text-sm font-medium' }, rule.label),
                  el('div', { class: 'text-xs text-battle-2' }, `${metricLabel(rule.metric)} · ${rule.window}`),
                ),
                el('div', { class: 'text-right' },
                  el('div', { class: 'text-sm font-semibold tabular-nums' + (met ? ' text-lime' : '') }, `${cv} / ${rule.threshold}`),
                  met ? el('div', { class: 'text-[10px] text-lime uppercase tracking-widest' }, 'Qualified') : null,
                ),
              );
            }))
        : el('div', { class: 'text-sm text-battle-2 italic' }, 'No rules defined for this competition yet.'),

    // Compact stats
    compact && el('div', { class: 'text-xs text-battle-2 mt-1' }, comp.prize_text || ''),
  );

  return card;
}

// ──────────────────────────────────────────────────────────────────────────
// VIEW: HISTORY
// ──────────────────────────────────────────────────────────────────────────
// ──────────────────────────────────────────────────────────────────────────
// VIEW: CALENDAR — one bar per slot (hours of operation), many reps per bar
// ──────────────────────────────────────────────────────────────────────────
// Slots are now derived from actual shifts — admins build the schedule. Every
// shift on a given day with the same (slot_start, slot_end) renders together
// as one block. `slot_id` is the canonical "HH:MM-HH:MM" string.
// Shifts are scoped per-department (inside_sales | loyalty) via state.calendarDepartment.
const DEPARTMENTS = [
  { id: 'inside_sales', name: 'Inside Sales' },
  { id: 'loyalty',      name: 'Loyalty' },
];
function currentDepartment() { return state.calendarDepartment || 'inside_sales'; }
function shiftDept(s) { return s.department || 'inside_sales'; }
function deptShifts() {
  const d = currentDepartment();
  return state.shifts.filter(s => shiftDept(s) === d);
}
function slotIdFor(slotStart, slotEnd) { return slotStart + '-' + slotEnd; }
// On a company holiday the default is NO reps working — pre-existing /
// recurring shifts are suppressed; only shifts explicitly created on the
// holiday itself (holiday_ok) show (per Isaac: "if I manually want to add
// them back, I will").
function _shiftVisibleOn(iso) {
  const hol = companyHolidayFor(iso);
  return (s) => !hol || !!s.holiday_ok;
}
function shiftSlotsForDate(iso) {
  const groups = {};
  const vis = _shiftVisibleOn(iso);
  deptShifts().filter(s => s.date === iso && vis(s)).forEach(s => {
    const key = slotIdFor(s.slot_start, s.slot_end);
    if (!groups[key]) {
      groups[key] = {
        slot_id: key,
        slot_start: s.slot_start,
        slot_end: s.slot_end,
        label: `${fmtTime(s.slot_start)} – ${fmtTime(s.slot_end)}`,
      };
    }
  });
  return Object.values(groups).sort((a, b) => a.slot_start.localeCompare(b.slot_start));
}
function slotTemplate(iso, slotId) {
  const existing = shiftSlotsForDate(iso).find(s => s.slot_id === slotId);
  if (existing) return existing;
  // Synthesize from the slotId (covers the case where the last rep was just removed)
  const [start, end] = (slotId || '').split('-');
  if (!start || !end) return null;
  return { slot_id: slotId, slot_start: start, slot_end: end, label: `${fmtTime(start)} – ${fmtTime(end)}` };
}
function assignmentsForSlot(iso, slotId) {
  const vis = _shiftVisibleOn(iso);
  return deptShifts()
    .filter(s => s.date === iso && s.slot_id === slotId && vis(s))
    .sort((a, b) => a.start.localeCompare(b.start));
}

// Date helpers
function isoDate(d) { return d.toISOString().slice(0, 10); }
function startOfWeek(d) { const x = new Date(d); x.setHours(0,0,0,0); x.setDate(x.getDate() - x.getDay()); return x; }
function startOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function shiftAnchor(anchor, view, dir) {
  const x = new Date(anchor);
  if (view === 'week') x.setDate(x.getDate() + 7 * dir);
  else x.setMonth(x.getMonth() + dir);
  return view === 'week' ? startOfWeek(x) : startOfMonth(x);
}
function calendarWindowLabel(anchor, view) {
  if (view === 'week') {
    const end = new Date(anchor); end.setDate(anchor.getDate() + 6);
    const fmtShort = (d) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    return `${fmtShort(anchor)} – ${fmtShort(end)}, ${end.getFullYear()}`;
  }
  return anchor.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}
function legendDot(color, label) {
  return el('div', { class: 'flex items-center gap-1.5' },
    el('span', { class: 'inline-block rounded-full', style: { width: '8px', height: '8px', background: color } }),
    el('span', {}, label),
  );
}
function fmtTime(hhmm) {
  if (!hhmm) return '';
  const [h, m] = hhmm.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = ((h + 11) % 12) + 1;
  return m ? `${h12}:${String(m).padStart(2,'0')} ${ampm}` : `${h12} ${ampm}`;
}
function repInitials(rep) {
  return (rep?.full_name || '').split(/\s+/).filter(Boolean).map(p => p[0]).join('').slice(0, 2).toUpperCase() || '?';
}

// ── COMPANY HOLIDAYS (per Isaac) — New Year's, Memorial Day, July 4th,
// Labor Day, Thanksgiving, Black Friday, Christmas Eve, Christmas. Weekend
// holidays observe on the nearest weekday (Sat → Friday before, Sun →
// Monday after). Calendar marks these as Holiday and skips them when
// fanning out recurring shifts.
const _holidayCache = {};
function _companyHolidays(year) {
  if (_holidayCache[year]) return _holidayCache[year];
  const iso = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const nthWeekday = (month, weekday, n) => {   // n-th <weekday> of month (0-based month)
    const d = new Date(year, month, 1);
    let count = 0;
    while (true) { if (d.getDay() === weekday) { count++; if (count === n) return d; } d.setDate(d.getDate() + 1); }
  };
  const lastWeekday = (month, weekday) => {
    const d = new Date(year, month + 1, 0);
    while (d.getDay() !== weekday) d.setDate(d.getDate() - 1);
    return d;
  };
  const observe = (d) => {   // Sat → Friday before · Sun → Monday after
    const o = new Date(d);
    if (o.getDay() === 6) o.setDate(o.getDate() - 1);
    else if (o.getDay() === 0) o.setDate(o.getDate() + 1);
    return o;
  };
  const thanksgiving = nthWeekday(10, 4, 4);   // 4th Thursday of November
  const blackFriday = new Date(thanksgiving); blackFriday.setDate(thanksgiving.getDate() + 1);
  const list = [
    ["New Year's Day", observe(new Date(year, 0, 1))],
    ['Memorial Day', lastWeekday(4, 1)],                    // last Monday of May
    ['Independence Day', observe(new Date(year, 6, 4))],
    ['Labor Day', nthWeekday(8, 1, 1)],                     // 1st Monday of September
    ['Thanksgiving', thanksgiving],
    ['Black Friday', blackFriday],
    ['Christmas Eve', observe(new Date(year, 11, 24))],
    ['Christmas Day', observe(new Date(year, 11, 25))],
  ];
  const map = {};
  // Christmas Eve/Day can observe onto the same weekday (e.g. 24th = Sat →
  // Fri 23rd while 25th = Sun → Mon 26th is fine; but 25th = Sat → Fri 24th
  // collides with Eve). Nudge a collision one weekday earlier.
  list.forEach(([name, d]) => {
    let k = iso(d);
    while (map[k]) { const nd = new Date(d); nd.setDate(nd.getDate() - (nd.getDay() === 1 ? 3 : 1)); d = nd; k = iso(d); }
    map[k] = name;
  });
  _holidayCache[year] = map;
  return map;
}
function companyHolidayFor(isoStr) {
  const y = Number(String(isoStr).slice(0, 4));
  if (!y) return null;
  // Jan 1 can observe into the prior year (Dec 31) — check neighbors too.
  return _companyHolidays(y)[isoStr] || _companyHolidays(y + 1)[isoStr] || null;
}

// The calendar is an Inside Sales scheduling tool — ACTIVE OFFICE STAFF
// only (per Isaac). D2D reps and technicians never appear on shifts.
// Who can build / edit the schedule and approve swaps: admins plus the
// office team leads (Inside Sales + Loyalty leads) — per Isaac, team
// leads get the calendar. Reps only request swaps on their own shifts.
function calendarCanManage(role) {
  return isAdminRole(role) || isOfficeLeadRole(role);
}
// A swap request that is still in flight: waiting on the other rep, or
// accepted by them and now waiting on a team lead / admin.
function swapOpen(r) { return r && (r.status === 'pending' || r.status === 'awaiting_lead'); }
function calendarEligibleProfiles(fallback) {
  const all = state.allProfiles.length ? state.allProfiles : [fallback].filter(Boolean);
  const staff = all.filter(p => p && p.is_active !== false && isSellerRole(p.role) && isOfficeStaffProfile(p));
  return staff.length ? staff : all.filter(p => p && p.is_active !== false);
}
// ── AGENT LAYER — the calendar is built around individual agents now ─────
// Department is derived from the PROFILE (per Isaac: "based on user type"),
// not chosen per shift: Loyalty-typed reps file under Loyalty, every other
// office-staff profile under Inside Sales. The dropdown up top is a view
// scope, not a filing decision.
function calendarAgentDept(p) {
  return (p && p.rep_type === 'loyalty_rep') ? 'loyalty' : 'inside_sales';
}
function calendarDeptAgents() {
  return calendarEligibleProfiles(state.profile)
    .filter(p => calendarAgentDept(p) === currentDepartment())
    .sort((a, b) => (a.full_name || '').localeCompare(b.full_name || ''));
}
// Stable per-agent color (Google-Calendar style). Hash on the profile id so
// an agent keeps their color across sessions and devices.
const CAL_AGENT_COLORS = ['#DF643A', '#5F6C5B', '#323230', '#A78256', '#9C3F1E', '#8E9C8A', '#FFB899', '#C9B98A', '#3F4A3C', '#E8A06B', '#7C857A', '#6B2A12'];
function calendarAgentColor(repId) {
  let h = 0; const s = String(repId || '');
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return CAL_AGENT_COLORS[Math.abs(h) % CAL_AGENT_COLORS.length];
}
// Visibility: a focused agent shows alone; otherwise everyone not unchecked
// in the sidebar. Session-only on purpose - a hidden agent who stays hidden
// is how a shift gets missed.
function calendarAssignVisible(a) {
  if (state._calFocus) return a.rep_id === state._calFocus;
  return !(state._calAgentHidden instanceof Set && state._calAgentHidden.has(a.rep_id));
}
// Name lookup that cannot come back as the bare "Rep" filler: repById only
// carries CALENDAR-ELIGIBLE profiles, so an agent whose role shifted (or an
// admin who grabbed a shift) fell out of it and rendered as "Rep" with no
// times. Fall back to the full profile list before giving up.
function calendarRepShort(repId, repById) {
  const p = (repById && repById[repId]) || (state.allProfiles || []).find(x => x.id === repId);
  return (p && p.full_name ? p.full_name.split(' ')[0] : '') || '(removed)';
}
// A legacy or hand-synced shift row can be missing start/end/slot_id - the
// demo data never is, but the shared calendar_store has months of rows.
// Normalize before display so one malformed row cannot take down the tab.
function calShiftTimes(a) {
  const st = a.start || a.slot_start || '00:00';
  const en = a.end || a.slot_end || st;
  return { st, en, slotId: a.slot_id || slotIdFor(st, en) };
}
// Compact time for narrow month cells: "7AM", "6:30AM", "12PM".
function calShortTime(hhmm) {
  const [h, m] = String(hhmm || '').split(':').map(Number);
  if (!Number.isFinite(h)) return String(hhmm || '');
  const ap = h < 12 ? 'AM' : 'PM';
  const hr = (h % 12) || 12;
  return hr + (m ? ':' + String(m).padStart(2, '0') : '') + ap;
}

// ── WEEKLY SCHEDULE BUILDER — one agent, one repeating week ──────────────
// Sets the agent's standing week (e.g. Mon-Fri 9-5) and materializes it as
// ordinary shift rows through the horizon - the SAME rows the grid, slot
// modal, swaps and holiday logic already speak, so nothing downstream
// changes. One-off edits stay exactly that: click a day on the grid.
function openAgentScheduleModal(rep) {
  if (!calendarCanManage(state.profile?.role) || !rep) return;
  const dept = calendarAgentDept(rep);
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  // Seed from the agent's shifts over the NEXT 7 days so editing an
  // existing schedule starts from what is already on the books.
  const _seed = {};
  {
    const t0 = new Date(); t0.setHours(0, 0, 0, 0);
    for (let i = 0; i < 7; i++) {
      const d = new Date(t0); d.setDate(t0.getDate() + i);
      const iso = isoDate(d);
      const row = (state.shifts || []).find(s => s.rep_id === rep.id && s.date === iso && shiftDept(s) === dept);
      if (row) { const { st, en } = calShiftTimes(row); _seed[d.getDay()] = { start: st, end: en }; }
    }
  }
  const days = dayNames.map((name, dow) => ({
    dow, name,
    on: !!_seed[dow],
    start: (_seed[dow] && _seed[dow].start) || '09:00',
    end: (_seed[dow] && _seed[dow].end) || '17:00',
  }));
  let horizonWeeks = 12;

  const overlay = el('div', { class: 'modal-overlay' });
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  const card = el('div', { class: 'card w-full max-w-md my-8 overflow-hidden flex flex-col', style: { maxHeight: 'calc(100vh - 64px)' } });
  overlay.append(card);

  const body = el('div', { class: 'flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-2' });
  // Live weekly-hours readout - recomputed on every checkbox/time change so
  // the admin sees the load they are building before they save it.
  const fmtHrs = (h) => (h % 1 ? h.toFixed(1) : String(h)) + 'h';
  const hoursEl = el('span', { class: 'font-display text-lg tabular-nums' });
  const updHours = () => {
    const total = days.reduce((t, d) => {
      if (!d.on || !d.start || !d.end || d.start >= d.end) return t;
      return t + (_toMin(d.end) - _toMin(d.start)) / 60;
    }, 0);
    hoursEl.textContent = fmtHrs(Math.round(total * 10) / 10);
    hoursEl.style.color = total > 0 ? 'var(--text)' : 'var(--text-subtle)';
  };
  const rowEls = days.map(d => {
    const cb = el('input', { type: 'checkbox', style: { cursor: 'pointer' } }); cb.checked = d.on;
    const st = el('input', { type: 'time', value: d.start, class: 'rounded-lg border px-2 py-1 text-xs', style: { borderColor: 'var(--border-2)' } });
    const en = el('input', { type: 'time', value: d.end, class: 'rounded-lg border px-2 py-1 text-xs', style: { borderColor: 'var(--border-2)' } });
    const sync = () => { d.on = cb.checked; d.start = st.value || d.start; d.end = en.value || d.end; st.disabled = en.disabled = !d.on; st.style.opacity = en.style.opacity = d.on ? '1' : '.4'; updHours(); };
    cb.onchange = sync; st.onchange = sync; en.onchange = sync;
    setTimeout(sync, 0);
    return el('div', { class: 'flex items-center gap-2' },
      el('label', { class: 'flex items-center gap-2 text-sm font-medium cursor-pointer', style: { width: '120px' } }, cb, d.name),
      st, el('span', { class: 'text-xs text-muted-' }, '→'), en);
  });
  body.append(...rowEls,
    el('div', { class: 'flex items-center justify-between gap-2 mt-2 px-1 py-2 rounded-lg', style: { background: 'var(--card-2)' } },
      el('span', { class: 'text-[10px] uppercase tracking-widest text-muted- font-bold', style: { paddingLeft: '4px' } }, 'Hours / week'),
      hoursEl),
    el('div', { class: 'flex items-center gap-2 mt-1' },
      el('span', { class: 'text-xs font-bold uppercase tracking-wider text-muted-' }, 'Build ahead'),
      el('select', {
        class: 'rounded-lg border px-2.5 py-1 text-[11px] cursor-pointer', style: { borderColor: 'var(--border-2)' },
        onchange: (e) => { horizonWeeks = Number(e.target.value) || 12; },
      }, ...[[4, '4 weeks'], [8, '8 weeks'], [12, '12 weeks'], [26, '26 weeks'], [52, '52 weeks']].map(([v, l]) => el('option', { value: String(v), selected: v === 12 }, l)))),
    el('div', { class: 'text-[11px] text-muted-' },
      'Saving writes these as normal shifts from today through the horizon (company holidays skipped, days already scheduled left alone). Adjust single days straight on the calendar afterward.'));

  const footer = el('div', { class: 'px-5 py-4 border-t flex items-center justify-between gap-2 flex-wrap', style: { borderColor: 'var(--border)' } },
    el('button', {
      class: 'rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition hover:brightness-95',
      style: { borderColor: '#DC2626', color: '#DC2626' },
      title: 'Delete every one of this agent’s shifts from today forward (past shifts are kept). One-offs included.',
      onclick: () => {
        const t0 = isoDate(new Date());
        const mine = (state.shifts || []).filter(s => s.rep_id === rep.id && shiftDept(s) === dept && s.date >= t0);
        if (!mine.length) { toast('No upcoming shifts to clear', 'info'); return; }
        if (!confirm('Delete all ' + mine.length + ' upcoming shift' + (mine.length === 1 ? '' : 's') + ' for ' + rep.full_name + '? Past shifts are kept.')) return;
        const ids = new Set(mine.map(s => s.id));
        state.shifts = state.shifts.filter(s => !ids.has(s.id));
        saveDemoData();
        toast('Cleared ' + ids.size + ' upcoming shift' + (ids.size === 1 ? '' : 's'), 'success');
        overlay.remove(); mountApp();
      },
    }, 'Clear upcoming'),
    el('div', { class: 'flex items-center gap-2' },
      el('button', { class: 'rounded-lg border px-2.5 py-1 text-[11px] font-semibold', style: { borderColor: 'var(--border-2)', color: 'var(--text)' }, onclick: () => overlay.remove() }, 'Cancel'),
      el('button', {
        class: 'rounded-lg px-2.5 py-1 text-[11px] font-bold transition hover:brightness-95',
        style: { background: 'var(--accent)', color: 'var(--accent-text)' },
        onclick: () => {
          const active = days.filter(d => d.on && d.start && d.end && d.start < d.end);
          if (!active.length) { toast('Turn on at least one day (with start before end)', 'warn'); return; }
          const byDow = Object.fromEntries(active.map(d => [d.dow, d]));
          const t0 = new Date(); t0.setHours(0, 0, 0, 0);
          let added = 0;
          for (let i = 0; i < horizonWeeks * 7; i++) {
            const d = new Date(t0); d.setDate(t0.getDate() + i);
            const tpl = byDow[d.getDay()];
            if (!tpl) continue;
            const iso = isoDate(d);
            if (companyHolidayFor(iso)) continue;                               // company holiday - day off
            const slotId = slotIdFor(tpl.start, tpl.end);
            // A day that already has ANY shift for this agent in this dept is
            // left alone - a one-off edit an admin made must survive a
            // template re-save.
            if (state.shifts.some(s => s.rep_id === rep.id && s.date === iso && shiftDept(s) === dept)) continue;
            state.shifts.push({
              id: 'shift-' + iso + '-' + slotId + '-' + rep.id + '-' + Date.now() + '-' + added,
              date: iso, slot_id: slotId, slot_start: tpl.start, slot_end: tpl.end,
              rep_id: rep.id, start: tpl.start, end: tpl.end,
              note: '', recurring: true, holiday_ok: false,
              department: dept,
            });
            added++;
          }
          saveDemoData();
          toast(added ? ('Scheduled ' + added + ' shift' + (added === 1 ? '' : 's') + ' for ' + (rep.full_name || 'agent')) : 'Nothing to add - those days are already scheduled', added ? 'success' : 'info');
          overlay.remove(); mountApp();
        },
      }, 'Save schedule')));

  card.append(
    el('div', { class: 'px-5 py-4 border-b flex items-center justify-between', style: { borderColor: 'var(--border)' } },
      el('div', { class: 'flex items-center gap-2' },
        el('span', { style: { width: '10px', height: '10px', borderRadius: '0', background: calendarAgentColor(rep.id), display: 'inline-block' } }),
        el('div', {},
          el('h2', { class: 'text-base font-bold leading-none' }, rep.full_name || 'Agent'),
          el('div', { class: 'text-[10px] text-muted- mt-1 uppercase tracking-wider font-semibold' }, (DEPARTMENTS.find(x => x.id === dept) || {}).name || dept))),
      el('button', { class: 'text-2xl text-muted-', onclick: () => overlay.remove() }, '×')),
    body, footer);
  document.body.append(overlay);
}

// ── AGENT SIDEBAR — the Google-Calendar "calendars" list ─────────────────
function calendarAgentSidebar(meId, isAdmin, anchor) {
  const agents = calendarDeptAgents();
  const focus = state._calFocus;
  // Hours each agent works in the VISIBLE window (the week or month on
  // screen), holiday-suppressed like the grid, so the number beside a name
  // always matches the blocks you can see.
  const view = state.calendarView === 'month' ? 'month' : 'week';
  const a0 = view === 'week' ? startOfWeek(anchor || new Date()) : startOfMonth(anchor || new Date());
  const a1 = new Date(a0);
  if (view === 'week') a1.setDate(a0.getDate() + 7); else a1.setMonth(a0.getMonth() + 1);
  const isoA = isoDate(a0), isoB = isoDate(a1);
  const dept = currentDepartment();
  const hoursFor = (repId) => (state.shifts || []).reduce((t, sh) => {
    if (!sh || sh.rep_id !== repId || shiftDept(sh) !== dept) return t;
    if (!sh.date || sh.date < isoA || sh.date >= isoB) return t;
    if (!_shiftVisibleOn(sh.date)(sh)) return t;
    const { st, en } = calShiftTimes(sh);
    const mins = _toMin(en) - _toMin(st);
    return t + (Number.isFinite(mins) ? Math.max(0, mins) / 60 : 0);
  }, 0);
  const fmtHrs = (h) => { const r = Math.round(h * 10) / 10; return (r % 1 ? r.toFixed(1) : String(r)) + 'h'; };
  return el('div', { class: 'cal-sidebar card p-3 flex flex-col gap-1 shrink-0', style: { width: '210px', maxHeight: '70vh', overflowY: 'auto' } },
    el('div', { class: 'cal-sidebar-head flex items-center justify-between px-1 pb-1' },
      el('span', { class: 'text-[10px] uppercase tracking-widest text-muted- font-bold' }, 'Agents'),
      focus ? el('button', {
        class: 'text-[10px] font-bold', style: { color: 'var(--accent)', background: 'transparent' },
        onclick: () => { state._calFocus = null; mountApp(); },
      }, 'Show all') : null),
    agents.length === 0
      ? el('div', { class: 'text-[11px] text-muted- px-1 py-2' }, 'No agents of this type yet - agents file here by their user type (Loyalty reps under Loyalty, other office staff under Inside Sales).')
      : el('div', { class: 'cal-agent-list flex flex-col' }, ...agents.map(p => {
          const c = calendarAgentColor(p.id);
          const hidden = state._calAgentHidden.has(p.id);
          const isFocus = focus === p.id;
          const cb = el('input', { type: 'checkbox', style: { cursor: 'pointer', accentColor: c, flexShrink: '0' } });
          cb.checked = !hidden;
          cb.onclick = (e) => { e.stopPropagation(); };
          cb.onchange = () => { if (cb.checked) state._calAgentHidden.delete(p.id); else state._calAgentHidden.add(p.id); mountApp(); };
          return el('div', {
            class: 'cal-agent-row flex items-center gap-2 px-1.5 py-1.5 rounded-lg cursor-pointer transition',
            style: isFocus ? { background: 'var(--card-2)', '--agent-color': c } : { '--agent-color': c },
            title: isFocus ? 'Showing only ' + (p.full_name || 'this agent') + ' - click to show everyone' : 'Click to view only ' + (p.full_name || 'this agent'),
            onclick: () => { state._calFocus = isFocus ? null : p.id; mountApp(); },
          },
            cb,
            el('span', { style: { width: '9px', height: '9px', borderRadius: '0', background: c, display: 'inline-block', flexShrink: '0' } }),
            el('span', { class: 'text-xs font-medium truncate flex-1 min-w-0' + (p.id === meId ? ' font-bold' : '') }, (p.full_name || '(no name)') + (p.id === meId ? ' · you' : '')),
            (() => {
              const h = hoursFor(p.id);
              return el('span', {
                class: 'cal-agent-hours text-[10px] tabular-nums shrink-0' + (h > 0 ? ' font-semibold' : ''),
                style: { color: h > 0 ? 'var(--text-muted)' : 'var(--text-subtle)' },
                title: (h > 0 ? fmtHrs(h) : 'No hours') + ' scheduled this ' + view,
              }, h > 0 ? fmtHrs(h) : '—');
            })(),
            isAdmin ? el('button', {
              class: 'cal-agent-edit text-[11px] shrink-0 rounded px-1 transition hover:brightness-95',
              style: { background: 'transparent', color: 'var(--text-muted)' },
              title: 'Build ' + (p.full_name || 'this agent') + '’s weekly schedule',
              onclick: (e) => { e.stopPropagation(); openAgentScheduleModal(p); },
            }, '✎') : null);
        })));
}

