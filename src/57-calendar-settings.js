// ┌─ src/57-calendar-settings.js ─────────────────────────────────────────────
// │ Calendar → ⚙ Settings (per Isaac, Oct 13): one place for leads and admins
// │ to run the schedule — who is on the calendar (and in which department),
// │ each agent's standing week and who is working which shift this week (shift
// │ templates + the swap rule live in Settings → Configurations). Everything saves to the
// │ shared calendar_store (state.calendarSettings) like the shifts do.
// └────────────────────────────────────────────────────────────────────────
function _calSetSave() { saveDemoData(); mountApp(); }
function _calSetWeekStart() {
  const t = new Date(); t.setHours(0, 0, 0, 0);
  const base = state._calSetWeek ? new Date(state._calSetWeek + 'T00:00') : startOfWeek(t);
  return startOfWeek(base);
}
function _calSetAgentShifts(rep, iso) {
  const dept = calendarAgentDept(rep);
  return (state.shifts || []).filter(s => s.rep_id === rep.id && s.date === iso && shiftDept(s) === dept && (!companyHolidayFor(iso) || s.holiday_ok));
}
// Remove = off the calendar completely (per Isaac, Oct 13): off the roster AND every shift from today forward deleted,
// with any open swap / pick-up request on those shifts. Past shifts stay as history.
function _calSetRemove(p) {
  const t0 = isoDate(new Date());
  const mine = (state.shifts || []).filter(s => s.rep_id === p.id && s.date >= t0);
  if (!confirm('Remove ' + (p.full_name || 'this agent') + ' from the calendar? ' + (mine.length ? 'Their ' + mine.length + ' upcoming shift' + (mine.length === 1 ? '' : 's') + ' will be deleted. ' : '') + 'Past shifts are kept as history.')) return;
  const ids = new Set(mine.map(s => s.id));
  state.shifts = (state.shifts || []).filter(s => !ids.has(s.id));
  state.shiftSwapRequests = (state.shiftSwapRequests || []).filter(r => !ids.has(r.shift_id) || !(r.status === 'pending' || r.status === 'awaiting_lead'));
  const cs = calendarSettings(); cs.roster[p.id] = Object.assign({}, cs.roster[p.id] || {}, { on: false });
  toast((p.full_name || 'Agent') + ' removed' + (ids.size ? ' · ' + ids.size + ' upcoming shift' + (ids.size === 1 ? '' : 's') + ' deleted' : ''), 'success');
  _calSetSave();
}
function viewCalendarSettings(opts) {
  opts = opts || {};
  const cs = calendarSettings();
  const all = (state.allProfiles || []).filter(p => p && p.is_active !== false);
  const onCal = calendarEligibleProfiles(state.profile);
  const onIds = new Set(onCal.map(p => p.id));
  const offCal = all.filter(p => !onIds.has(p.id) && calendarRosterOf(p).on === false);
  // On the calendar but not on the roster: people with shifts from today on who aren't (or are no longer) active office
  // staff — the calendar still draws their shifts, so they're listed here to keep or remove (per Isaac, Oct 13).
  const _t0iso = isoDate(new Date());
  const strayIds = [...new Set((state.shifts || []).filter(s => s.date >= _t0iso && !onIds.has(s.rep_id)).map(s => s.rep_id))];
  const strays = strayIds.map(id => (state.allProfiles || []).find(p => p.id === id) || { id, full_name: '(removed user)' });
  const addable = all.filter(p => !onIds.has(p.id) && calendarRosterOf(p).on !== false).sort((a, b) => String(a.full_name || '').localeCompare(String(b.full_name || '')));
  const deptName = (id) => (DEPARTMENTS.find(d => d.id === id) || {}).name || id;
  const sel = { borderColor: 'var(--border-2)', background: 'var(--card)', color: 'var(--text)' };
  const btn = (label, onclick, sty, title) => el('button', { class: 'rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition hover:brightness-95 whitespace-nowrap', title: title || '', style: Object.assign({ borderColor: 'var(--border-2)', color: 'var(--text)', background: 'var(--card)' }, sty || {}), onclick }, label);
  const section = (title, sub, ...kids) => el('div', { class: 'card overflow-hidden' },
    el('div', { class: 'px-4 py-3 border-b', style: { borderColor: 'var(--border)' } },
      el('h3', { class: 'text-sm font-bold' }, title),
      sub ? el('div', { class: 'text-[11px]', style: { color: 'var(--text-muted)' } }, sub) : null),
    el('div', { class: 'p-4 flex flex-col gap-3' }, ...kids));
  const setRoster = (p, patch) => { cs.roster[p.id] = Object.assign({}, cs.roster[p.id] || {}, patch); _calSetSave(); };
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const t0 = new Date(); t0.setHours(0, 0, 0, 0);
  // Standing week = what is on the books over the next 7 days.
  const standing = (p) => { const out = []; let hrs = 0;
    for (let i = 0; i < 7; i++) { const d = new Date(t0); d.setDate(t0.getDate() + i); const iso = isoDate(d);
      const sh = _calSetAgentShifts(p, iso); sh.forEach(s => { const { st, en } = calShiftTimes(s); hrs += Math.max(0, (_toMin(en) - _toMin(st)) / 60); });
      out[d.getDay()] = sh.length ? sh.map(s => { const { st, en } = calShiftTimes(s); return calShortTime(st) + '–' + calShortTime(en); }).join(', ') : ''; }
    return { days: out, hrs: Math.round(hrs * 10) / 10 }; };

  // ── 1+2. Team & schedule — one table (per Isaac, Oct 13): every agent on the calendar, their department, the week's
  // shifts (pick the week with the arrows; click a day to edit it), hours that week, Edit schedule and Remove. ──
  const ws = _calSetWeekStart();
  const days = [...Array(7)].map((_, i) => { const d = new Date(ws); d.setDate(ws.getDate() + i); return d; });
  const shiftTxt = (sh) => sh.map(s => { const { st, en } = calShiftTimes(s); return calShortTime(st) + '–' + calShortTime(en); }).join(', ');
  const nCols = 11;
  const teamRows = DEPARTMENTS.flatMap(d => {
    const list = onCal.filter(p => calendarAgentDept(p) === d.id).sort((a, b) => String(a.full_name || '').localeCompare(String(b.full_name || '')));
    const heads = days.map(() => 0);
    const rows = list.map(p => { let hrs = 0;
      const cells = days.map((dd, i) => { const iso = isoDate(dd); const sh = _calSetAgentShifts(p, iso);
        if (sh.length) { heads[i]++; sh.forEach(s => { const { st, en } = calShiftTimes(s); hrs += Math.max(0, (_toMin(en) - _toMin(st)) / 60); }); }
        return el('td', { class: 'py-1.5 px-1 text-center text-[10px] tabular-nums whitespace-nowrap cursor-pointer hover:brightness-95', title: 'Open ' + iso,
          style: sh.length ? { background: 'color-mix(in srgb, ' + calendarAgentColor(p.id) + ' 16%, var(--card))', color: 'var(--text)', borderRadius: '6px' } : { color: 'var(--text-subtle)' },
          onclick: () => { if (typeof openDaySheet === 'function') openDaySheet(iso); } }, sh.length ? shiftTxt(sh) : '—'); });
      hrs = Math.round(hrs * 10) / 10;
      return el('tr', { class: 'border-t', style: { borderColor: 'var(--border)' } },
        el('td', { class: 'py-1.5 pr-2' }, el('div', { class: 'flex items-center gap-2' },
          el('span', { class: 'inline-block rounded-full shrink-0', style: { width: '9px', height: '9px', background: calendarAgentColor(p.id) } }),
          el('span', { class: 'font-semibold whitespace-nowrap' }, p.full_name || p.email || 'Agent'))),
        el('td', { class: 'py-1.5 pr-2' }, el('select', { class: 'rounded-lg border px-1.5 py-0.5 text-[11px]', style: sel, title: 'Department this agent is scheduled under',
          onchange: (e) => setRoster(p, { dept: e.target.value }) }, ...DEPARTMENTS.map(x => el('option', { value: x.id, selected: calendarAgentDept(p) === x.id }, x.name)))),
        ...cells,
        el('td', { class: 'py-1.5 px-2 text-[11px] tabular-nums text-right font-bold' }, hrs ? hrs + 'h' : '—'),
        el('td', { class: 'py-1.5 pl-2 text-right whitespace-nowrap' },
          btn('Edit schedule', () => openAgentScheduleModal(p), null, 'Set ' + (p.full_name || 'this agent') + '’s repeating week'), ' ',
          btn('Remove', () => _calSetRemove(p), { color: '#DC2626', borderColor: 'rgba(220,38,38,.35)' })));
    });
    if (!list.length) return [];
    return [el('tr', {}, el('td', { colspan: nCols, class: 'pt-3 pb-1 text-[10px] uppercase tracking-widest font-bold', style: { color: 'var(--text-muted)' } }, d.name + ' · ' + list.length))]
      .concat(rows, [el('tr', { class: 'border-t', style: { borderColor: 'var(--border-2)' } },
        el('td', { colspan: 2, class: 'py-1 pr-2 text-[10px] uppercase tracking-wider font-bold', style: { color: 'var(--text-muted)' } }, 'On shift'),
        ...heads.map(n => el('td', { class: 'py-1 text-center font-black tabular-nums text-[11px]', style: { color: n ? 'var(--text)' : '#DC2626' } }, String(n))),
        el('td', { colspan: 2 }))]);
  });
  const addSel = el('select', { class: 'rounded-lg border px-2 py-1 text-[11px]', style: sel },
    el('option', { value: '' }, addable.length ? 'Add someone to the calendar…' : 'Everyone active is on the calendar'),
    ...addable.map(p => el('option', { value: p.id }, (p.full_name || p.email || p.id) + (p.role ? ' · ' + p.role : ''))));
  addSel.onchange = () => { const p = addable.find(x => x.id === addSel.value); if (p) setRoster(p, { on: true, dept: currentDepartment() }); };
  const team = section('Team & schedule', 'Everyone on the calendar and their shifts for the week. Active office staff are on by default — add anyone else who works shifts, move someone between departments, or remove them. Click a day to add, move or remove shifts.',
    el('div', { class: 'flex items-center gap-2 flex-wrap' },
      btn('‹', () => { const d = new Date(ws); d.setDate(d.getDate() - 7); state._calSetWeek = isoDate(d); mountApp(); }),
      btn('This week', () => { state._calSetWeek = null; mountApp(); }),
      btn('›', () => { const d = new Date(ws); d.setDate(d.getDate() + 7); state._calSetWeek = isoDate(d); mountApp(); }),
      el('span', { class: 'text-[12px] font-semibold ml-1' }, calendarWindowLabel(ws, 'week')),
      el('div', { class: 'flex-1' }), addSel),
    el('div', { class: 'scroll-x' }, el('table', { class: 'w-full text-[12px]' },
      el('thead', { class: 'text-[9px] uppercase tracking-wider', style: { color: 'var(--text-muted)' } }, el('tr', {},
        el('th', { class: 'text-left pr-2 font-semibold' }, 'Agent'), el('th', { class: 'text-left pr-2 font-semibold' }, 'Department'),
        ...days.map(d => { const hol = companyHolidayFor(isoDate(d)); return el('th', { class: 'px-1 font-semibold text-center whitespace-nowrap', title: hol || '' }, dayNames[d.getDay()] + ' ' + (d.getMonth() + 1) + '/' + d.getDate() + (hol ? ' 🎉' : '')); }),
        el('th', { class: 'px-2 font-semibold text-right' }, 'Hrs'), el('th', {}))),
      el('tbody', {}, ...teamRows))),
    strays.length ? el('div', { class: 'rounded-xl border p-3 flex flex-col gap-1.5', style: { borderColor: 'rgba(217,119,6,.45)', background: 'rgba(217,119,6,.06)' } },
      el('div', { class: 'text-[12px] font-bold' }, '⚠ On the calendar but not on this list'),
      el('div', { class: 'text-[11px]', style: { color: 'var(--text-muted)' } }, 'These people have upcoming shifts but aren’t active office staff (inactive, a different user type, or no longer in the app). Keep them on the calendar or remove them and their shifts.'),
      ...strays.map(p => { const n = (state.shifts || []).filter(s => s.rep_id === p.id && s.date >= _t0iso).length;
        return el('div', { class: 'flex items-center gap-2 flex-wrap text-[12px]' },
          el('span', { class: 'font-semibold' }, p.full_name || p.email || 'User'),
          el('span', { class: 'text-[11px]', style: { color: 'var(--text-muted)' } }, n + ' upcoming shift' + (n === 1 ? '' : 's') + (p.is_active === false ? ' · inactive user' : p.role ? ' · ' + p.role : '')),
          p.is_active === false || !p.role ? null : btn('Keep on calendar', () => setRoster(p, { on: true, dept: currentDepartment() })),
          btn('Remove', () => _calSetRemove(p), { color: '#DC2626', borderColor: 'rgba(220,38,38,.35)' })); })) : null,
    offCal.length ? el('div', { class: 'text-[11px] flex items-center gap-1.5 flex-wrap', style: { color: 'var(--text-muted)' } }, 'Off the calendar:',
      ...offCal.map(p => btn('↩ ' + (p.full_name || p.email), () => setRoster(p, { on: undefined }), null, 'Put back on the calendar'))) : null);

  // ── 3. Shift templates ──
  const tplRows = cs.templates.map((t, i) => el('div', { class: 'flex items-center gap-2 flex-wrap' },
    el('input', { class: 'rounded-lg border px-2 py-1 text-[12px]', style: Object.assign({ width: '180px' }, sel), placeholder: 'Name (e.g. Opener)', value: t.name || '', onchange: (e) => { t.name = e.target.value.trim(); _calSetSave(); } }),
    el('input', { type: 'time', class: 'rounded-lg border px-2 py-1 text-[12px]', style: sel, value: t.start || '', onchange: (e) => { t.start = e.target.value; _calSetSave(); } }),
    el('span', { class: 'text-[11px]', style: { color: 'var(--text-muted)' } }, '→'),
    el('input', { type: 'time', class: 'rounded-lg border px-2 py-1 text-[12px]', style: sel, value: t.end || '', onchange: (e) => { t.end = e.target.value; _calSetSave(); } }),
    el('span', { class: 'text-[11px] tabular-nums', style: { color: 'var(--text-muted)' } }, t.start && t.end && t.start < t.end ? ((_toMin(t.end) - _toMin(t.start)) / 60) + 'h' : ''),
    btn('Delete', () => { cs.templates.splice(i, 1); _calSetSave(); }, { color: '#DC2626', borderColor: 'rgba(220,38,38,.35)' })));
  const templates = section('Shift templates', 'Named shifts (Opener, Mid, Closer…). They show as one-click buttons in each agent’s Edit schedule.',
    ...(tplRows.length ? tplRows : [el('div', { class: 'text-[11px]', style: { color: 'var(--text-subtle)' } }, 'No templates yet.')]),
    el('div', {}, btn('+ Add template', () => { cs.templates.push({ id: 'tpl-' + Date.now(), name: '', start: '09:00', end: '17:00' }); _calSetSave(); }, { background: 'var(--accent)', color: 'var(--accent-text)', borderColor: 'var(--accent)' })));

  // ── 4. Rules ──
  const lead = el('input', { type: 'checkbox', style: { cursor: 'pointer' } }); lead.checked = cs.swapNeedsLead !== false;
  lead.onchange = () => { cs.swapNeedsLead = lead.checked; _calSetSave(); };
  const rules = section('Rules', null,
    el('label', { class: 'flex items-start gap-2 text-[12px] cursor-pointer' }, lead,
      el('span', {}, el('b', {}, 'Shift swaps need a team lead’s approval'), el('div', { class: 'text-[11px]', style: { color: 'var(--text-muted)' } }, 'On: after the other rep accepts, a lead or admin signs off before the shift moves. Off: the shift moves as soon as the other rep accepts.'))),
    el('div', { class: 'text-[11px]', style: { color: 'var(--text-muted)' } }, 'Company holidays (no one is scheduled unless you add them on the day): New Year’s Day, Memorial Day, Independence Day, Labor Day, Thanksgiving, Black Friday, Christmas Eve, Christmas Day.'));

  if (opts.rulesOnly) return el('div', { class: 'flex flex-col gap-4 w-full' }, templates, rules);
  return el('div', { class: 'flex flex-col gap-4 w-full' },
    // Inside Settings → Calendar (per Isaac, Oct 13) the page header is the section title; on the calendar it's a back link.
    opts.embedded ? el('div', {}, el('h2', { class: 'text-lg font-bold' }, 'Calendar'), el('div', { class: 'text-[11px]', style: { color: 'var(--text-muted)' } }, 'Who is on the calendar and when they work, shift templates and swap rules. Also on the Calendar tab under ⚙ Settings.'))
      : el('div', { class: 'flex items-center gap-2 flex-wrap' },
          btn('‹ Back to calendar', () => { state._calSettingsOpen = false; mountApp(); }),
          el('h2', { class: 'text-lg font-bold ml-1' }, '⚙ Calendar settings')),
    team);
}
// Shift templates + the swap rule moved out of Calendar settings into
// Settings → Configurations (per Isaac, Oct 16). Same controls, same store.
function calendarRulesPanel() {
  return viewCalendarSettings({ rulesOnly: true });
}
