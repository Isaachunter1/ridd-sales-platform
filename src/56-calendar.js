// ┌─ src/56-calendar.js ─────────────────────────────────────────────────────
// │ Calendar view and slot booking.
// │ Part of the app.js bundle (tools/bundle.js concatenates src/*.js in name order).
// └────────────────────────────────────────────────────────────────────────
function viewCalendar() {
  const me = state.profile;
  const meId = me.id;
  const isAdmin = calendarCanManage(me.role);
  const reps = calendarEligibleProfiles(me);
  const repById = Object.fromEntries(reps.map(r => [r.id, r]));
  // Loyalty reps open on the Loyalty department once per session instead
  // of Inside Sales every time (the picker still switches freely).
  if (!state._calDeptInit) { state._calDeptInit = true; if (!isAdmin && !state.calendarDepartment && typeof calendarAgentDept === 'function') state.calendarDepartment = calendarAgentDept(me); }
  if (!(state._calAgentHidden instanceof Set)) state._calAgentHidden = new Set();
  if (state._calFocus === undefined) state._calFocus = null;

  const today = new Date(); today.setHours(0, 0, 0, 0);
  if (!state.calendarAnchor) state.calendarAnchor = isoDate(state.calendarView === 'week' ? startOfWeek(today) : startOfMonth(today));
  const anchor = new Date(state.calendarAnchor + 'T00:00');

  const deptShiftIds = new Set(deptShifts().map(s => s.id));
  const inDept = (r) => deptShiftIds.has(r.shift_id);
  const incoming = state.shiftSwapRequests.filter(r => r.to_rep_id === meId && r.status === 'pending' && inDept(r));
  // Open shifts anyone can grab — dropped by someone else, still unclaimed,
  // and not in the past.
  const todayIsoO = isoDate(new Date());
  const openShifts = state.shiftSwapRequests.filter(r => isOpenReq(r) && inDept(r) && r.from_rep_id !== meId
    && (() => { const sh = state.shifts.find(x => x.id === r.shift_id); return sh && sh.date >= todayIsoO; })());
  const outgoing = state.shiftSwapRequests.filter(r => r.from_rep_id === meId && swapOpen(r) && inDept(r));
  // Accepted by the other rep — now a team lead / admin signs off before
  // the shift actually moves.
  const approvals = isAdmin ? state.shiftSwapRequests.filter(r => r.status === 'awaiting_lead' && inDept(r)) : [];

  return el('div', { class: 'flex flex-col gap-5 w-full' },

    // ── Toolbar ──
    el('div', { class: 'flex items-center gap-2 flex-wrap' },
      // Department selector — scopes everything below it
      el('select', {
        class: 'rounded-xl border px-2.5 py-1 text-[11px] font-semibold cursor-pointer',
        style: { borderColor: 'var(--border-2)', background: 'var(--card-2)', color: 'var(--text)' },
        onchange: (e) => {
          state.calendarDepartment = e.target.value;
          saveDemoData();
          mountApp();
        },
      },
        ...DEPARTMENTS.map(d => el('option', { value: d.id, selected: currentDepartment() === d.id }, d.name)),
      ),
      el('div', { class: 'inline-flex rounded-xl border overflow-hidden', style: { borderColor: 'var(--border-2)' } },
        ...['week', 'month'].map(v => el('button', {
          class: 'px-2.5 py-1 text-[11px] font-medium transition',
          style: state.calendarView === v
            ? { background: 'var(--accent)', color: 'var(--accent-text)' }
            : { background: 'transparent', color: 'var(--text)' },
          onclick: () => {
            state.calendarView = v;
            const base = new Date(state.calendarAnchor + 'T00:00');
            state.calendarAnchor = v === 'week' ? isoDate(startOfWeek(base)) : isoDate(startOfMonth(base));
            mountApp();
          },
        }, v === 'week' ? 'Week' : 'Month')),
      ),
      el('div', { class: 'flex items-center gap-1' },
        el('button', {
          class: 'px-2.5 py-1 text-[11px] rounded-lg border hover:brightness-95 transition',
          style: { borderColor: 'var(--border-2)' },
          onclick: () => { state.calendarAnchor = isoDate(shiftAnchor(anchor, state.calendarView, -1)); mountApp(); },
        }, '‹'),
        el('button', {
          class: 'px-2.5 py-1 text-[11px] rounded-lg border font-medium hover:brightness-95 transition',
          style: { borderColor: 'var(--border-2)' },
          onclick: () => {
            state.calendarAnchor = state.calendarView === 'week' ? isoDate(startOfWeek(today)) : isoDate(startOfMonth(today));
            mountApp();
          },
        }, 'Today'),
        el('button', {
          class: 'px-2.5 py-1 text-[11px] rounded-lg border hover:brightness-95 transition',
          style: { borderColor: 'var(--border-2)' },
          onclick: () => { state.calendarAnchor = isoDate(shiftAnchor(anchor, state.calendarView, 1)); mountApp(); },
        }, '›'),
      ),
      el('div', { class: 'text-sm font-semibold ml-2', style: { color: 'var(--text)' } },
        calendarWindowLabel(anchor, state.calendarView)),
      el('div', { class: 'flex-1' }),
      isAdmin && el('label', { class: 'flex items-center gap-1.5 text-[11px] text-muted-', title: 'Coverage floor \u2014 a day with fewer reps than this on a shift shows red in the month view' },
        'Min / shift',
        el('input', {
          type: 'number', min: '0', step: '1', value: calendarMinReps() || '',
          class: 'rounded-lg border px-2 py-1 text-[11px] w-14 tabular-nums',
          style: { borderColor: 'var(--border-2)', background: 'var(--card)', color: 'var(--text)' },
          onchange: (e) => { if (!state.calendarMinReps) state.calendarMinReps = {}; state.calendarMinReps[currentDepartment()] = Math.max(0, parseInt(e.target.value) || 0); saveDemoData(); mountApp(); },
        })),
      isAdmin && el('button', {
        class: 'rounded-lg px-2.5 py-1 text-[11px] font-bold transition hover:brightness-95',
        style: { background: 'var(--accent)', color: 'var(--accent-text)' },
        onclick: () => openNewShiftModal(isoDate(today)),
      }, '+ New shift'),
      el('div', { class: 'cal-legend flex items-center gap-3 text-xs text-muted-' },
        legendDot('var(--accent)', 'Includes you'),
        legendDot('var(--card-2)', 'Others only'),
      ),
    ),

    // ── Incoming swaps ──
    approvals.length > 0 && el('div', { class: 'card p-4 border-l-4', style: { borderLeftColor: '#A9441F' } },
      el('h3', { class: 'text-sm font-bold mb-1' }, `Shift swaps awaiting your approval (${approvals.length})`),
      el('p', { class: 'text-xs text-muted- mb-3' }, 'Both reps agreed. Approve to move the shift, or reject to leave it where it is.'),
      el('div', { class: 'flex flex-col gap-2' },
        ...approvals.map(req => swapRequestCard(req, repById, 'approve')))),
    openShifts.length > 0 && el('div', { class: 'card p-4 border-l-4', style: { borderLeftColor: '#5F6C5B' } },
      el('h3', { class: 'text-sm font-bold mb-1' }, `Open shifts (${openShifts.length})`),
      el('p', { class: 'text-xs text-muted- mb-3' }, 'Someone can\u2019t make these. Pick one up and a team lead will confirm it.'),
      el('div', { class: 'flex flex-col gap-2' },
        ...openShifts.map(req => swapRequestCard(req, repById, 'open')))),
    incoming.length > 0 && el('div', { class: 'card p-4 border-l-4', style: { borderLeftColor: 'var(--accent)' } },
      el('h3', { class: 'text-sm font-bold mb-3' }, `Shift transfers waiting on you (${incoming.length})`),
      el('div', { class: 'flex flex-col gap-2' },
        ...incoming.map(req => swapRequestCard(req, repById, 'incoming')),
      ),
    ),
    outgoing.length > 0 && el('div', { class: 'card p-4' },
      el('h3', { class: 'text-sm font-bold mb-3' }, `Your pending transfer requests (${outgoing.length})`),
      el('div', { class: 'flex flex-col gap-2' },
        ...outgoing.map(req => swapRequestCard(req, repById, 'outgoing')),
      ),
    ),

    // ── Agent sidebar + grid — the Google-Calendar layout ──
    // (Mobile: cal-layout stacks — the agent list becomes a scrolling chip
    // strip above a full-width, compact month grid; see index.html.)
    el('div', { class: 'cal-layout flex gap-4 items-start' },
      calendarAgentSidebar(meId, isAdmin, anchor),
      el('div', { class: 'flex-1 min-w-0' },
        state.calendarView === 'week'
          ? renderWeekGrid(anchor, today, meId, repById)
          : renderMonthGrid(anchor, today, meId, repById))),
  );
}

function renderSlotBar(iso, slot, meId, repById, opts = {}) {
  const allAssigns = assignmentsForSlot(iso, slot.slot_id);
  // Sidebar visibility filters the BAR only - the slot modal it opens still
  // shows everyone, so an admin can always reach a hidden agent's shift.
  const assigns = allAssigns.filter(calendarAssignVisible);
  const hiddenN = allAssigns.length - assigns.length;
  if (allAssigns.length > 0 && assigns.length === 0 && !opts.compactLabel) {
    // Every assignee is filtered out: a slim ghost, so the slot stays
    // clickable without shouting.
    return el('button', {
      'data-slot-bar': 'true',
      class: 'cal-slot-bar w-full text-left rounded-lg border transition hover:brightness-95 p-2',
      style: { borderColor: 'var(--border)', background: 'transparent', color: 'var(--text-subtle)', borderStyle: 'dashed', opacity: '.6' },
      onclick: (e) => { e.stopPropagation(); openSlotModal(iso, slot.slot_id); },
    }, el('span', { class: 'text-[10px] italic' }, hiddenN + ' filtered'));
  }
  const includesMe = assigns.some(a => a.rep_id === meId);
  return el('button', {
    'data-slot-bar': 'true',
    class: 'cal-slot-bar w-full text-left rounded-lg border transition hover:brightness-95 p-2 flex flex-col gap-1',
    style: includesMe
      ? { borderColor: 'var(--accent)', background: 'rgba(223,100,58,0.10)', color: 'var(--text)' }
      : { borderColor: 'var(--border)', background: 'var(--card-2)', color: 'var(--text)' },
    onclick: (e) => { e.stopPropagation(); openSlotModal(iso, slot.slot_id); },
  },
    el('div', { class: 'flex items-center justify-between gap-2' },
      el('span', { class: 'text-[10px] font-bold uppercase tracking-wider', style: { color: 'var(--text-muted)' } },
        opts.compactLabel ? `${fmtTime(slot.slot_start)}–${fmtTime(slot.slot_end)}` : slot.label),
      assigns.length > 0 && el('span', { class: 'text-[10px] font-bold', style: { color: 'var(--text-muted)' } }, `${assigns.length}`),
    ),
    assigns.length === 0
      ? el('div', { class: 'text-[11px] italic', style: { color: 'var(--text-subtle)' } }, 'No reps · click to add')
      : el('div', { class: 'cal-rep-chips flex flex-wrap gap-1' },
          ...assigns.map(a => {
            const isPartial = a.start !== slot.slot_start || a.end !== slot.slot_end;
            const isMine = a.rep_id === meId;
            const firstName = calendarRepShort(a.rep_id, repById);
            // Google-Calendar coloring: every agent keeps their own color,
            // "me" keeps the accent so your own shifts still pop first.
            const ac = calendarAgentColor(a.rep_id);
            return el('span', {
              class: 'text-[11px] font-semibold rounded-full px-2 py-0.5 whitespace-nowrap',
              style: isMine
                ? { background: 'var(--accent)', color: 'var(--accent-text)' }
                : { background: ac + '1c', color: ac, border: '1px solid ' + ac + '55' },
            }, firstName + (isPartial ? ` · ${fmtTime(a.start)}–${fmtTime(a.end)}` : ''));
          }),
        ),
  );
}

// ── Week view: Google Calendar–style time grid ────────────────────────────
const WEEK_START_HOUR  = 6;   // 6 AM
const WEEK_END_HOUR    = 19;  // 7 PM (exclusive)
const WEEK_HOUR_HEIGHT = 56;  // px per hour
function _toMin(hhmm) { const [h,m] = String(hhmm || '').split(':').map(Number); return h*60 + (m || 0); }
function _timeToPx(hhmm) {
  return ((_toMin(hhmm) - WEEK_START_HOUR * 60) / 60) * WEEK_HOUR_HEIGHT;
}
// Group overlapping slots so they render side-by-side within a day column.
function layoutSlots(slots) {
  const items = slots.map(s => ({ ...s, _a: _toMin(s.slot_start), _b: _toMin(s.slot_end) }))
                     .sort((a,b) => a._a - b._a);
  const clusters = [];
  items.forEach(it => {
    const cluster = clusters.find(c => c.some(ci => ci._b > it._a && ci._a < it._b));
    if (cluster) cluster.push(it); else clusters.push([it]);
  });
  const laid = [];
  clusters.forEach(c => c.forEach((it, idx) => laid.push({ slot: it, colIdx: idx, cols: c.length })));
  return laid;
}

function renderWeekGrid(anchor, today, meId, repById) {
  const isAdmin = calendarCanManage(state.profile?.role);
  const dayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const days = Array.from({ length: 7 }, (_, i) => { const d = new Date(anchor); d.setDate(anchor.getDate() + i); return d; });
  const todayIso = isoDate(today);
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const nowPx = ((nowMin - WEEK_START_HOUR * 60) / 60) * WEEK_HOUR_HEIGHT;
  const showNow = nowMin >= WEEK_START_HOUR * 60 && nowMin <= WEEK_END_HOUR * 60;
  const gridHeight = (WEEK_END_HOUR - WEEK_START_HOUR) * WEEK_HOUR_HEIGHT;

  // ── Header row: empty gutter cell + 7 day cells ──
  const header = el('div', {
    class: 'border-b text-xs font-semibold uppercase tracking-wider flex',
    style: { borderColor: 'var(--border)' },
  },
    el('div', { class: 'flex-shrink-0', style: { width: '56px' } }),
    ...days.map(d => {
      const iso = isoDate(d);
      return el('div', {
        class: 'flex-1 p-3 text-center cursor-pointer hover:brightness-95',
        title: 'Open the full day',
        onclick: () => openDaySheet(iso),
        style: { background: iso === todayIso ? 'rgba(223,100,58,0.16)' : 'transparent',
                 boxShadow: iso === todayIso ? 'inset 0 0 0 2px var(--accent)' : 'none',
                 color: iso === todayIso ? 'var(--accent)' : 'var(--text-muted)' },
      },
        el('div', {}, dayNames[d.getDay()]),
        el('div', {
          class: iso === todayIso
            ? 'inline-flex items-center justify-center rounded-full text-base font-bold mt-0.5'
            : 'text-base font-bold mt-0.5',
          style: iso === todayIso
            ? { width: '28px', height: '28px', background: 'var(--accent)', color: 'var(--accent-text)' }
            : { color: 'var(--text)' },
        }, String(d.getDate())),
      );
    }),
  );

  // ── Time gutter (hour labels) ──
  const gutter = el('div', {
    class: 'flex-shrink-0 relative',
    style: { width: '56px', height: gridHeight + 'px' },
  });
  for (let h = WEEK_START_HOUR; h < WEEK_END_HOUR; h += 1) {
    const isNoon = h === 12;
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12  = ((h + 11) % 12) + 1;
    gutter.append(el('div', {
      class: 'absolute pr-2 text-right text-[10px] font-semibold',
      style: {
        top: ((h - WEEK_START_HOUR) * WEEK_HOUR_HEIGHT - 6) + 'px',
        right: '0', width: '56px',
        color: 'var(--text-muted)',
      },
    }, h === WEEK_START_HOUR ? '' : (isNoon ? 'Noon' : `${h12} ${ampm}`)));
  }

  // ── Day columns ──
  const dayColumns = days.map((d, dayIdx) => {
    const iso = isoDate(d);
    const slots = shiftSlotsForDate(iso);
    const laid = layoutSlots(slots);
    const col = el('div', {
      class: 'flex-1 relative' + (isAdmin ? ' cursor-pointer' : ''),
      style: {
        height: gridHeight + 'px',
        borderLeft: '1px solid var(--border)',
        background: iso === todayIso ? 'rgba(223,100,58,0.12)' : 'transparent',
      },
      onclick: isAdmin ? (e) => {
        // Ignore clicks on existing shift blocks — those handle their own click
        if (e.target.closest('button')) return;
        // Derive a sensible default start time from click Y position (nearest hour)
        const rect = e.currentTarget.getBoundingClientRect();
        const y = e.clientY - rect.top;
        const hour = Math.max(WEEK_START_HOUR, Math.min(WEEK_END_HOUR - 1,
          Math.round(WEEK_START_HOUR + y / WEEK_HOUR_HEIGHT)));
        const defaultStart = String(hour).padStart(2, '0') + ':00';
        const defaultEnd   = String(Math.min(WEEK_END_HOUR, hour + 8)).padStart(2, '0') + ':00';
        openNewShiftModal(iso, { start: defaultStart, end: defaultEnd });
      } : null,
    });
    // Horizontal hour lines
    for (let h = WEEK_START_HOUR; h <= WEEK_END_HOUR; h += 1) {
      col.append(el('div', {
        class: 'absolute left-0 right-0',
        style: {
          top: ((h - WEEK_START_HOUR) * WEEK_HOUR_HEIGHT) + 'px',
          height: '1px', background: 'var(--border)', opacity: '0.5',
          pointerEvents: 'none',
        },
      }));
    }
    // Admin-only hint for empty day columns
    if (isAdmin && laid.length === 0) {
      col.append(el('div', {
        class: 'absolute inset-0 flex items-center justify-center text-center text-[11px] italic pointer-events-none',
        style: { color: 'var(--text-subtle)', padding: '12px' },
      }, 'Click anywhere to add a shift'));
    }
    // Slot blocks
    laid.forEach(({ slot, colIdx, cols }) => {
      const top = _timeToPx(slot.slot_start);
      const bot = _timeToPx(slot.slot_end);
      const leftPct  = (colIdx / cols) * 100;
      const widthPct = (1 / cols) * 100;
      const assigns = assignmentsForSlot(iso, slot.slot_id);
      const includesMe = assigns.some(a => a.rep_id === meId);
      const block = el('button', {
        class: 'absolute rounded-lg border text-left transition hover:brightness-95 overflow-hidden flex flex-col gap-1',
        style: {
          top: (top + 2) + 'px',
          height: (bot - top - 4) + 'px',
          left: `calc(${leftPct}% + 2px)`,
          width: `calc(${widthPct}% - 4px)`,
          padding: '6px 8px',
          borderColor: includesMe ? 'var(--accent)' : 'var(--border-2)',
          background: includesMe ? 'rgba(223,100,58,0.14)' : 'var(--card-2)',
          color: 'var(--text)',
        },
        onclick: () => openSlotModal(iso, slot.slot_id),
      },
        el('div', { class: 'text-[10px] font-bold uppercase tracking-wider whitespace-nowrap', style: { color: 'var(--text-muted)' } },
          `${fmtTime(slot.slot_start)}–${fmtTime(slot.slot_end)}`),
        el('div', { class: 'text-[11px] font-semibold leading-tight' },
          assigns.length === 0
            ? el('span', { class: 'italic', style: { color: 'var(--text-subtle)' } }, 'No reps')
            : el('span', {}, assigns.slice(0, 6).map(a => {
                const rep = repById[a.rep_id];
                const isPartial = a.start !== slot.slot_start || a.end !== slot.slot_end;
                const firstName = rep?.full_name?.split(' ')[0] || 'Rep';
                return firstName + (isPartial ? '*' : '');
              }).join(', ') + (assigns.length > 6 ? ` +${assigns.length - 6}` : '')),
        ),
        assigns.length > 0 && el('div', { class: 'text-[10px] mt-auto', style: { color: 'var(--text-muted)' } },
          `${assigns.length} rep${assigns.length === 1 ? '' : 's'}`),
      );
      col.append(block);
    });
    // Current-time indicator for today
    if (iso === todayIso && showNow) {
      col.append(el('div', {
        class: 'absolute left-0 right-0',
        style: { top: (nowPx - 1) + 'px', height: '2px', background: '#EF4444', pointerEvents: 'none', zIndex: '5' },
      }));
      col.append(el('div', {
        class: 'absolute rounded-full',
        style: { top: (nowPx - 5) + 'px', left: '-5px', width: '10px', height: '10px', background: '#EF4444', pointerEvents: 'none', zIndex: '5' },
      }));
    }
    return col;
  });

  return el('div', { class: 'card overflow-hidden' },
    header,
    el('div', {
      class: 'relative',
      style: { maxHeight: '70vh', overflowY: 'auto' },
    },
      el('div', { class: 'flex', style: { minHeight: gridHeight + 'px' } },
        gutter,
        ...dayColumns,
      ),
    ),
    // Footer legend for partials
    el('div', { class: 'px-4 py-2 text-[10px] border-t', style: { borderColor: 'var(--border)', color: 'var(--text-muted)' } },
      'Click a block to manage reps. Names marked with * are covering only part of the shift.'),
  );
}

function renderMonthGrid(anchor, today, meId, repById) {
  const isAdmin = calendarCanManage(state.profile?.role);
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const lastDay = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0).getDate();
  const startPad = first.getDay();
  const cells = [];
  for (let i = 0; i < startPad; i += 1) cells.push(null);
  for (let dd = 1; dd <= lastDay; dd += 1) cells.push(new Date(anchor.getFullYear(), anchor.getMonth(), dd));
  while (cells.length % 7 !== 0) cells.push(null);
  const todayIso = isoDate(today);
  const dayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  return el('div', { class: 'card overflow-hidden' },
    el('div', { class: 'grid grid-cols-7 border-b text-[11px] font-semibold uppercase tracking-wider text-muted-', style: { borderColor: 'var(--border)' } },
      ...dayNames.map(n => el('div', { class: 'p-2.5 text-center' }, n)),
    ),
    el('div', { class: 'grid grid-cols-7' },
      ...cells.map((d, idx) => {
        if (!d) {
          return el('div', { class: 'cal-month-cell border-r border-b', style: {
            borderColor: 'var(--border)',
            borderRightWidth: (idx + 1) % 7 === 0 ? '0' : '1px',
            minHeight: '120px',
            opacity: '0.35',
          } });
        }
        const iso = isoDate(d);
        const isToday = iso === todayIso;
        const holiday = companyHolidayFor(iso);
        const cell = el('div', {
          class: 'cal-month-cell p-1.5 border-r border-b flex flex-col gap-1 relative' + (isAdmin ? ' cursor-pointer' : ''),
          style: {
            borderColor: 'var(--border)',
            borderRightWidth: (idx + 1) % 7 === 0 ? '0' : '1px',
            minHeight: '120px',
            background: holiday ? 'rgba(242,20,140,0.05)' : isToday ? 'rgba(223,100,58,0.14)' : 'transparent',
            boxShadow: isToday ? 'inset 0 0 0 2px var(--accent)' : 'none',
          },
          // Tap the day → full-day sheet (per Isaac: month cells are too small
          // to hit one shift). The + badge still opens New shift for admins.
          onclick: () => openDaySheet(iso),
        },
          holiday && el('div', {
            class: 'text-[9px] font-black uppercase tracking-widest rounded-md px-1.5 py-1 pointer-events-none',
            style: { background: 'rgba(242,20,140,.12)', color: '#C2185B' },
            title: 'Company holiday — nobody is scheduled by default. Click the day to add reps manually if you need coverage.',
          }, '🎉 ' + holiday),
          el('div', { class: 'flex items-center justify-between mb-0.5 pointer-events-none' },
            el('div', { class: 'text-xs font-bold', style: { color: isToday ? 'var(--accent)' : 'var(--text)' } }, String(d.getDate())),
            isAdmin && el('span', {
              class: 'cal-add-badge inline-flex items-center justify-center rounded-full text-[12px] font-bold leading-none cursor-pointer',
              style: {
                width: '18px', height: '18px',
                background: 'var(--accent)', color: 'var(--accent-text)',
                flexShrink: '0', pointerEvents: 'auto',
              },
              title: 'Add shift',
              onclick: (e) => { e.stopPropagation(); openNewShiftModal(iso); },
            }, '+'),
          ),
          // One line per AGENT with their REAL window (per Isaac: slot
          // grouping hid odd schedules - an agent whose times were adjusted
          // still displayed under the slot's generic label). Sorted by
          // start, colored per agent, click opens the same slot modal.
          ...(() => {
            const vis = _shiftVisibleOn(iso);
            const rows = deptShifts()
              .filter(sh => sh.date === iso && vis(sh) && calendarAssignVisible(sh))
              .sort((a, b) => String(a.start || a.slot_start || '').localeCompare(String(b.start || b.slot_start || ''))
                || calendarRepShort(a.rep_id, repById).localeCompare(calendarRepShort(b.rep_id, repById)));
            const CAP = 7;
            // Coverage: reps per slot vs the department floor.
            const minReps = calendarMinReps();
            const perSlot = {}; rows.forEach(a => { const k = calShiftTimes(a).slotId; perSlot[k] = (perSlot[k] || 0) + 1; });
            const short = minReps > 0 && Object.keys(perSlot).length > 0 && Object.values(perSlot).some(n => n < minReps);
            const out = [];
            if (rows.length) out.push(el('div', { class: 'text-[9px] font-bold tabular-nums pointer-events-none',
              style: { color: short ? '#DC2626' : 'var(--text-subtle)', position: 'absolute', top: '6px', right: isAdmin ? '28px' : '6px' }, title: short ? 'Below the ' + minReps + '-rep floor on a shift' : rows.length + ' on' }, (short ? '\u26a0 ' : '') + rows.length));
            out.push(...rows.slice(0, CAP).map(a => {
              const c = calendarAgentColor(a.rep_id);
              const mine = a.rep_id === meId;
              const openReq = openShiftReqFor(a.id);
              return el('button', {
                'data-slot-bar': 'true',
                class: 'cal-chip w-full text-left rounded-md px-1.5 py-1 text-[10px] font-semibold flex items-center gap-1 transition hover:brightness-95 overflow-hidden',
                style: openReq
                  ? { background: 'transparent', color: '#A9441F', border: '1.5px dashed #DF643A' }
                  : mine
                  ? { background: 'var(--accent)', color: 'var(--accent-text)' }
                  : { background: c + '14', color: 'var(--text)', borderLeft: '3px solid ' + c },
                title: calendarRepShort(a.rep_id, repById) + ' \u00b7 ' + calShortTime(calShiftTimes(a).st) + ' \u2013 ' + calShortTime(calShiftTimes(a).en),
                onclick: (e) => { e.stopPropagation(); if (_calPhone()) openDaySheet(iso); else openSlotModal(iso, calShiftTimes(a).slotId); },
              },
                el('span', { class: 'cal-chip-name truncate' }, (openReq ? 'OPEN \u00b7 ' : '') + calendarRepShort(a.rep_id, repById)),
                el('span', { class: 'cal-chip-time ml-auto tabular-nums shrink-0', style: { color: mine && !openReq ? 'var(--accent-text)' : 'var(--text-muted)', fontWeight: '600' } },
                  calShortTime(calShiftTimes(a).st) + '\u2013' + calShortTime(calShiftTimes(a).en)));
            }));
            if (rows.length > CAP) out.push(el('div', { class: 'text-[9px] text-muted- px-1 pointer-events-none' }, '+' + (rows.length - CAP) + ' more'));
            return out;
          })(),
        );
        return cell;
      }),
    ),
  );
}

// ── Swap request card (top-of-page Inbox / Outgoing lists) ────────────────
// ── Open shifts (per Isaac, Sep 2026): a rep DROPS a shift they can't make
// (a transfer request with no target rep), it shows as OPEN on the calendar,
// any eligible rep PICKS IT UP, and a lead / admin approves — the same
// approval path a rep-to-rep transfer already takes.
function isOpenReq(r) { return !!r && r.status === 'pending' && !r.to_rep_id; }
function openShiftReqFor(shiftId) { return state.shiftSwapRequests.find(r => r.shift_id === shiftId && isOpenReq(r)); }
function dropShiftOpen(assignment, note, redraw) {
  const meId = state.profile.id;
  state.shiftSwapRequests.push({
    id: 'swap-' + Date.now(),
    shift_id: assignment.id,
    from_rep_id: meId, to_rep_id: null,
    status: 'pending', note: (note || '').trim(),
    created_at: new Date().toISOString(), resolved_at: null,
  });
  saveDemoData();
  toast('Shift is open — anyone on the team can pick it up', 'success');
  if (redraw) redraw();
}
function pickUpOpenShift(req, redraw) {
  const me = state.profile || {};
  if (!isOpenReq(req)) { toast('That shift was already taken', 'warn'); return; }
  req.to_rep_id = me.id;
  req.picked_at = new Date().toISOString();
  // Picking up IS accepting — leads approve; a lead picking up self-approves.
  resolveSwap(req.id, 'accepted');
  if (redraw) redraw();
}
// Department-level coverage floor (admin sets it once in the toolbar): a
// day whose slot has fewer reps than this reads red in the month grid.
function calendarMinReps() {
  const m = state.calendarMinReps || {};
  const v = Number(m[currentDepartment()]);
  return Number.isFinite(v) && v > 0 ? v : 0;
}

function swapRequestCard(req, repById, direction) {
  const shift = state.shifts.find(s => s.id === req.shift_id);
  const from  = repById[req.from_rep_id];
  const to    = repById[req.to_rep_id];
  if (!shift) return null;
  const dateLabel = new Date(shift.date + 'T00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  return el('div', { class: 'flex items-center justify-between gap-3 rounded-lg px-3 py-2.5 border', style: { borderColor: 'var(--border)', background: 'var(--card-2)' } },
    el('div', { class: 'flex-1 min-w-0' },
      el('div', { class: 'text-sm font-semibold' },
        direction === 'open' ? `${from?.full_name || 'A rep'} dropped this shift`
          : direction === 'incoming' ? `${from?.full_name || 'A rep'} → you`
          : direction === 'approve' ? `${from?.full_name || 'A rep'} → ${to?.full_name || 'rep'}`
          : `You → ${to?.full_name || 'anyone (open)'}`),
      el('div', { class: 'text-xs text-muted- mt-0.5' },
        `${dateLabel} · ${fmtTime(shift.start)}–${fmtTime(shift.end)}`),
      req.note && el('div', { class: 'text-xs mt-1 italic', style: { color: 'var(--text-muted)' } }, '"' + req.note + '"'),
    ),
    direction === 'open' && el('button', {
      class: 'rounded-lg px-2.5 py-1 text-[11px] font-bold',
      style: { background: 'var(--accent)', color: 'var(--accent-text)' },
      onclick: () => { pickUpOpenShift(req); mountApp(); },
    }, 'Pick up'),
    direction === 'incoming' && el('div', { class: 'flex gap-1.5' },
      el('button', {
        class: 'rounded-lg px-2.5 py-1 text-[11px] font-bold',
        style: { background: 'var(--accent)', color: 'var(--accent-text)' },
        onclick: () => resolveSwap(req.id, 'accepted'),
      }, 'Accept'),
      el('button', {
        class: 'rounded-lg px-2.5 py-1 text-[11px] font-semibold border',
        style: { borderColor: 'var(--border-2)', color: 'var(--text)' },
        onclick: () => resolveSwap(req.id, 'declined'),
      }, 'Decline'),
    ),
    direction === 'approve' && el('div', { class: 'flex gap-1.5' },
      el('button', {
        class: 'rounded-lg px-2.5 py-1 text-[11px] font-bold',
        style: { background: 'var(--accent)', color: 'var(--accent-text)' },
        onclick: () => resolveSwap(req.id, 'approved'),
      }, 'Approve'),
      el('button', {
        class: 'rounded-lg px-2.5 py-1 text-[11px] font-semibold border',
        style: { borderColor: 'var(--border-2)', color: 'var(--text)' },
        onclick: () => resolveSwap(req.id, 'rejected'),
      }, 'Reject'),
    ),
    direction === 'outgoing' && el('div', { class: 'flex gap-1.5' },
      el('span', { class: 'text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded whitespace-nowrap',
        style: { background: req.status === 'awaiting_lead' ? 'rgba(223,100,58, 0.15)' : 'var(--card)', color: req.status === 'awaiting_lead' ? '#A9441F' : 'var(--text-muted)' } },
        req.status === 'awaiting_lead' ? 'Lead approval' : 'Pending'),
      el('button', {
        class: 'rounded-lg px-2.5 py-1 text-[11px] font-semibold border',
        style: { borderColor: 'var(--border-2)', color: 'var(--text)' },
        onclick: () => resolveSwap(req.id, 'cancelled'),
      }, 'Cancel'),
    ),
  );
}

function resolveSwap(requestId, decision) {
  const req = state.shiftSwapRequests.find(r => r.id === requestId);
  if (!req) return;
  const me = state.profile || {};
  const apply = () => {
    const shift = state.shifts.find(s => s.id === req.shift_id);
    if (shift) shift.rep_id = req.to_rep_id;
    req.status = 'approved';
    req.approved_by = me.id;
    req.resolved_at = new Date().toISOString();
  };
  let msg = 'Request updated', kind = 'info';
  if (decision === 'accepted') {
    // The other rep said yes. A team lead / admin accepting IS the
    // approval; anyone else parks it for a lead to sign off.
    if (calendarCanManage(me.role)) { apply(); msg = 'Shift transferred'; kind = 'success'; }
    else { req.status = 'awaiting_lead'; req.accepted_at = new Date().toISOString(); msg = 'Accepted — waiting on team lead approval'; kind = 'success'; }
  } else if (decision === 'approved') {
    if (!calendarCanManage(me.role)) { toast('Only a team lead or admin can approve swaps', 'warn'); return; }
    apply(); msg = 'Swap approved — shift transferred'; kind = 'success';
  } else if (decision === 'rejected') {
    if (!calendarCanManage(me.role)) { toast('Only a team lead or admin can reject swaps', 'warn'); return; }
    req.status = 'rejected'; req.approved_by = me.id; req.resolved_at = new Date().toISOString(); msg = 'Swap rejected';
  } else if (decision === 'declined') {
    req.status = 'declined'; req.resolved_at = new Date().toISOString(); msg = 'Request declined';
  } else if (decision === 'cancelled') {
    req.status = 'cancelled'; req.resolved_at = new Date().toISOString(); msg = 'Request cancelled';
  }
  saveDemoData();
  toast(msg, kind);
  mountApp();
}

// ── Create-shift modal: pick days, times, reps, then fan out assignments ──
function openNewShiftModal(defaultIso, opts = {}) {
  if (!calendarCanManage(state.profile?.role)) return;
  // Agents of the CURRENT department view only - and each shift files under
  // the AGENT's own department (from their user type), not the dropdown.
  const reps = calendarDeptAgents();
  const overlay = el('div', { class: 'modal-overlay' });
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

  // ── Form state ──
  const RECURRENCE_WEEKS = 52; // 1-year horizon; effectively "forever" — admin adjusts individual days as needed
  const formState = {
    mode:       'single',                                                                  // 'single' | 'range'
    start_date: defaultIso || isoDate(new Date()),
    start:      opts.start || '09:00',
    end:        opts.end   || '17:00',
    rep_ids:    new Set(),
    // For Date-range mode: which weekdays repeat. Pre-seeded from the clicked day.
    days:       new Set([new Date((defaultIso || isoDate(new Date())) + 'T00:00').getDay()]),
  };

  const card = el('div', { class: 'card w-full max-w-lg my-8 overflow-hidden flex flex-col', style: { maxHeight: 'calc(100vh - 64px)' } });

  const header = el('div', { class: 'flex items-center justify-between px-5 py-4 border-b', style: { borderColor: 'var(--border)' } },
    el('div', {},
      el('h2', { class: 'text-base font-bold' }, 'New shift'),
      el('div', { class: 'text-xs text-muted- mt-0.5' }, 'Adjust individual days directly from the calendar.'),
    ),
    el('button', {
      class: 'rounded-lg border px-2.5 py-1 text-[11px] text-muted-',
      style: { borderColor: 'var(--border-2)' },
      onclick: () => overlay.remove(),
    }, 'Cancel'),
  );

  const body = el('div', { class: 'flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-5' });

  // ── Mode toggle: Single Shift | Date Range ──
  const dayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const modeToggle = el('div', {
    class: 'inline-flex rounded-xl border overflow-hidden self-start',
    style: { borderColor: 'var(--border-2)' },
  });
  const dateLabel = el('span', { class: 'text-xs font-bold uppercase tracking-wider text-muted-' }, 'Date');
  const dayRow = el('div', { class: 'flex flex-wrap gap-1.5' });
  const daysSection = el('div', { class: 'flex flex-col gap-1.5', style: { display: 'none' } });
  function renderDayChips() {
    dayRow.innerHTML = '';
    dayNames.forEach((n, i) => {
      const on = formState.days.has(i);
      dayRow.append(el('button', {
        type: 'button',
        class: 'rounded-full px-2.5 py-1 text-[11px] font-semibold border transition',
        style: on
          ? { background: 'var(--accent)', color: 'var(--accent-text)', borderColor: 'var(--accent)' }
          : { background: 'transparent', color: 'var(--text)', borderColor: 'var(--border-2)' },
        onclick: () => {
          if (formState.days.has(i)) formState.days.delete(i);
          else formState.days.add(i);
          renderDayChips();
        },
      }, n));
    });
  }
  renderDayChips();
  daysSection.append(
    el('span', { class: 'text-xs font-bold uppercase tracking-wider text-muted-' }, 'Days of week'),
    dayRow,
    el('div', { class: 'text-[10px] text-muted-' },
      'Repeats on these days going forward. If a shift needs to change later, just edit that day.'),
  );
  function renderModeToggle() {
    modeToggle.innerHTML = '';
    ['single', 'range'].forEach(m => {
      modeToggle.append(el('button', {
        type: 'button',
        class: 'px-2.5 py-1 text-[11px] font-semibold transition',
        style: formState.mode === m
          ? { background: 'var(--accent)', color: 'var(--accent-text)' }
          : { background: 'transparent', color: 'var(--text)' },
        onclick: () => {
          formState.mode = m;
          dateLabel.textContent = m === 'range' ? 'Starting' : 'Date';
          daysSection.style.display = m === 'range' ? 'flex' : 'none';
          renderModeToggle();
        },
      }, m === 'single' ? 'Single shift' : 'Date range'));
    });
  }
  renderModeToggle();
  body.append(el('div', { class: 'flex flex-col gap-1.5' },
    el('span', { class: 'text-xs font-bold uppercase tracking-wider text-muted-' }, 'Mode'),
    modeToggle,
    el('div', { class: 'text-[10px] text-muted-' },
      'Single shift adds just that one day. Date range repeats on the weekdays you pick.'),
  ));

  // ── Date (Single or "Starting" in Range mode) ──
  const startDateInput = el('input', {
    type: 'date', class: 'rounded-lg border px-2.5 py-1 text-[11px]',
    value: formState.start_date, style: { borderColor: 'var(--border-2)' },
    onchange: (e) => {
      formState.start_date = e.target.value;
      // Move the auto-selected weekday chip to the new date if only one was selected
      if (formState.days.size === 1) {
        formState.days.clear();
        formState.days.add(new Date(e.target.value + 'T00:00').getDay());
        renderDayChips();
      }
    },
  });
  body.append(el('label', { class: 'flex flex-col gap-1.5' },
    dateLabel,
    startDateInput,
  ));

  // ── Days of week (only shown in Range mode) ──
  body.append(daysSection);

  // ── Times ──
  const startInput = el('input', { type: 'time', class: 'w-full rounded-lg border px-3 py-2 text-sm', value: formState.start, style: { borderColor: 'var(--border-2)' }, onchange: e => formState.start = e.target.value });
  const endInput   = el('input', { type: 'time', class: 'w-full rounded-lg border px-3 py-2 text-sm', value: formState.end,   style: { borderColor: 'var(--border-2)' }, onchange: e => formState.end = e.target.value });
  body.append(el('div', { class: 'flex flex-col gap-1.5' },
    el('span', { class: 'text-xs font-bold uppercase tracking-wider text-muted-' }, 'Shift time'),
    el('div', { class: 'flex items-center gap-2' },
      el('label', { class: 'text-[10px] font-semibold flex-1 text-muted-' }, 'Start', startInput),
      el('label', { class: 'text-[10px] font-semibold flex-1 text-muted-' }, 'End',   endInput),
    ),
  ));

  // ── Reps (multi-select, clickable rows) ──
  const repRow = el('div', { class: 'flex flex-col gap-1 max-h-48 overflow-y-auto rounded-lg border p-1.5', style: { borderColor: 'var(--border-2)' } });
  const repCountLabel = el('span', { class: 'text-xs font-bold uppercase tracking-wider text-muted-' }, 'Reps working this shift');
  const refreshCountLabel = () => {
    repCountLabel.textContent = formState.rep_ids.size
      ? `Reps working this shift (${formState.rep_ids.size} selected)`
      : 'Reps working this shift';
  };
  reps.forEach(r => {
    const applyStyles = (selected) => {
      row.style.background    = selected ? 'var(--accent)' : 'transparent';
      row.style.color         = selected ? 'var(--accent-text)' : 'var(--text)';
      row.style.fontWeight    = selected ? '700' : '500';
      check.style.visibility  = selected ? 'visible' : 'hidden';
    };
    const check = el('span', {
      class: 'mr-2 text-sm font-bold flex-shrink-0',
      style: { visibility: 'hidden' },
    }, '✓');
    const row = el('button', {
      type: 'button',
      class: 'w-full flex items-center text-left text-[11px] py-1 px-2.5 rounded-md transition hover:brightness-95',
      onclick: () => {
        const next = !formState.rep_ids.has(r.id);
        if (next) formState.rep_ids.add(r.id);
        else      formState.rep_ids.delete(r.id);
        applyStyles(next);
        refreshCountLabel();
      },
    }, check, r.full_name);
    applyStyles(false);
    repRow.append(row);
  });
  body.append(el('div', { class: 'flex flex-col gap-1.5' },
    repCountLabel,
    repRow,
    el('div', { class: 'text-[10px] text-muted-' }, 'Tap a name to toggle. You can add more reps or narrow times per-rep later by clicking the shift block.'),
  ));

  // ── Footer: Create ──
  const footer = el('div', { class: 'px-5 py-4 border-t flex items-center justify-end gap-2', style: { borderColor: 'var(--border)' } },
    el('button', {
      class: 'rounded-lg px-2.5 py-1 text-[11px] font-bold transition hover:brightness-95',
      style: { background: 'var(--accent)', color: 'var(--accent-text)' },
      onclick: () => {
        if (formState.start >= formState.end) { toast('End time must be after start time', 'warn'); return; }
        if (formState.rep_ids.size === 0)     { toast('Pick at least one rep', 'warn'); return; }

        if (formState.mode === 'range' && formState.days.size === 0) {
          toast('Pick at least one day of the week', 'warn'); return;
        }
        const slotId = slotIdFor(formState.start, formState.end);
        const picks = Array.from(formState.rep_ids);
        // Build the list of dates to apply this shift to
        const dates = [];
        if (formState.mode === 'single') {
          dates.push(formState.start_date);
        } else {
          // Repeat indefinitely (1-year horizon) on the selected weekdays
          const start = new Date(formState.start_date + 'T00:00');
          const until = new Date(start); until.setDate(start.getDate() + 7 * RECURRENCE_WEEKS);
          for (let d = new Date(start); d <= until; d.setDate(d.getDate() + 1)) {
            if (!formState.days.has(d.getDay())) continue;
            if (companyHolidayFor(isoDate(d))) continue;   // company holiday — day off
            dates.push(isoDate(d));
          }
        }
        const _deptOf = (repId) => { const r = reps.find(x => x.id === repId); return r ? calendarAgentDept(r) : currentDepartment(); };
        let added = 0;
        dates.forEach(dIso => {
          picks.forEach(repId => {
            const dept = _deptOf(repId);
            // Dedupe per-department: a rep can be on the same slot+date in both
            // departments (e.g. cross-trained), just not twice in the same one.
            if (state.shifts.some(s => s.date === dIso && s.slot_id === slotId && s.rep_id === repId && shiftDept(s) === dept)) return;
            state.shifts.push({
              id: `shift-${dIso}-${slotId}-${repId}-${Date.now()}-${added}`,
              date: dIso,
              slot_id: slotId,
              slot_start: formState.start,
              slot_end:   formState.end,
              rep_id: repId,
              start: formState.start,
              end:   formState.end,
              note: '',
              recurring: formState.mode === 'range',
              holiday_ok: !!companyHolidayFor(dIso),   // explicitly added ON a holiday
              department: dept,
            });
            added += 1;
          });
        });
        saveDemoData();
        overlay.remove();
        toast(
          formState.mode === 'single'
            ? `Created ${added} shift${added === 1 ? '' : 's'}`
            : `Created ${added} shift${added === 1 ? '' : 's'} across ${formState.days.size} weekday${formState.days.size === 1 ? '' : 's'}`,
          'success');
        mountApp();
      },
    }, 'Create shift'),
  );

  card.append(header, body, footer);
  overlay.append(card);
  document.body.append(overlay);
}

// ── Recurrence helpers ────────────────────────────────────────────────────
// An assignment is "recurring" when `recurring !== false`. The series is
// grouped by (rep_id, slot_id, day-of-week). "All upcoming" operations match
// the current shift + every future recurring sibling on the same weekday.
function weekdayName(iso) {
  return new Date(iso + 'T00:00').toLocaleDateString('en-US', { weekday: 'long' });
}
function isRecurring(a) { return a && a.recurring !== false; }
function findRecurringSiblings(assignment, scope) {
  if (scope === 'this') {
    const hit = state.shifts.find(s => s.id === assignment.id);
    return hit ? [hit] : [];
  }
  const dow = new Date(assignment.date + 'T00:00').getDay();
  const dept = shiftDept(assignment);
  // Pattern-based series membership — the recurring flag lied on shifts the
  // New Shift modal fanned out, so we match the schedule itself: same rep,
  // same slot, same department, same weekday, this date forward.
  return state.shifts.filter(s =>
    shiftDept(s) === dept
    && s.slot_id === assignment.slot_id
    && s.rep_id === assignment.rep_id
    && s.date    >= assignment.date
    && new Date(s.date + 'T00:00').getDay() === dow
  );
}

// Show a "Only this shift / All upcoming <Weekday>s" prompt for recurring
// assignments. If not recurring, applies immediately.
function applyRecurringChange(assignment, label, applyFn, redraw) {
  const commit = (scope, toastMsg) => {
    applyFn(scope);
    saveDemoData();
    if (toastMsg) toast(toastMsg, 'success');
    redraw();
  };
  const series = findRecurringSiblings(assignment, 'all');
  if (series.length <= 1) {
    commit('this', `${label}d`);
    return;
  }
  const overlay = el('div', { class: 'modal-overlay' });
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  const dateLabel = new Date(assignment.date + 'T00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
  const weekday = weekdayName(assignment.date);
  const card = el('div', { class: 'card w-full max-w-sm my-8 overflow-hidden' },
    el('div', { class: 'flex items-center justify-between px-5 py-4 border-b', style: { borderColor: 'var(--border)' } },
      el('h2', { class: 'text-base font-bold' }, `${label} recurring shift?`),
      el('button', { class: 'rounded-lg border px-2.5 py-1 text-[11px]', style: { borderColor: 'var(--border-2)' }, onclick: () => overlay.remove() }, 'Cancel'),
    ),
    el('div', { class: 'px-5 py-4 flex flex-col gap-3' },
      el('p', { class: 'text-sm' },
        `This shift is scheduled on ${series.length} ${weekday}s (this one + ${series.length - 1} upcoming).`),
      el('div', { class: 'flex flex-col gap-2' },
        el('button', {
          class: 'rounded-lg px-2.5 py-1 text-[11px] font-bold text-left',
          style: { background: 'var(--accent)', color: 'var(--accent-text)' },
          onclick: () => { overlay.remove(); commit('this', `Only ${dateLabel} updated`); },
        }, `Only this day · ${dateLabel}`),
        el('button', {
          class: 'rounded-lg px-2.5 py-1 text-[11px] font-semibold border text-left',
          style: { borderColor: '#DC2626', color: '#DC2626' },
          onclick: () => { overlay.remove(); commit('all', `${series.length} ${weekday} shifts updated`); },
        }, `This + all ${series.length - 1} upcoming ${weekday}s`),
      ),
    ),
  );
  overlay.append(card);
  document.body.append(overlay);
}

// ── Slot modal: one slot/date. Add/remove reps, split, transfer ───────────
// ── Day sheet (per Isaac, Sep 2026): tap a day and see EVERYTHING on it —
// every shift, every rep, with the same actions the slot modal offers
// (reassign / edit time / split / remove for admins, request transfer +
// accept / decline for reps). Arrows step through days; admins add from here.
function _calPhone() { try { return window.matchMedia('(max-width: 640px)').matches; } catch { return false; } }
function openDaySheet(iso0) {
  let iso = iso0;
  const overlay = el('div', { class: 'modal-overlay' });
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  const render = () => {
    const allReps    = state.allProfiles.length ? state.allProfiles : [state.profile];
    const activeReps = calendarEligibleProfiles(state.profile);
    const meId = state.profile.id;
    const isAdmin = calendarCanManage(state.profile?.role);
    const repById = Object.fromEntries(allReps.map(r => [r.id, r]));
    const d = new Date(iso + 'T00:00');
    const dateLabel = d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
    const holiday = companyHolidayFor(iso);
    const vis = _shiftVisibleOn(iso);
    const rows = deptShifts()
      .filter(sh => sh.date === iso && vis(sh) && calendarAssignVisible(sh))
      .sort((a, b) => String(a.start || a.slot_start || '').localeCompare(String(b.start || b.slot_start || ''))
        || calendarRepShort(a.rep_id, repById).localeCompare(calendarRepShort(b.rep_id, repById)));
    // Group by slot (Morning / Afternoon / …) so the day reads like a roster.
    const bySlot = new Map();
    rows.forEach(a => { const t = calShiftTimes(a); const k = t.slotId; if (!bySlot.has(k)) bySlot.set(k, []); bySlot.get(k).push(a); });
    const mine = rows.filter(a => a.rep_id === meId);
    const step = (n) => { const x = new Date(iso + 'T00:00'); x.setDate(x.getDate() + n); iso = isoDate(x); render(); };
    const navBtn = (lab, n) => el('button', { class: 'rounded-lg border px-2.5 py-1 text-[11px] font-bold', style: { borderColor: 'var(--border-2)' }, onclick: () => step(n) }, lab);

    const card = el('div', { class: 'card w-full max-w-lg my-8 overflow-hidden flex flex-col', style: { maxHeight: 'calc(100vh - 64px)' } });
    const header = el('div', { class: 'flex items-center justify-between gap-2 px-5 py-4 border-b', style: { borderColor: 'var(--border)' } },
      el('div', { class: 'min-w-0' },
        el('h2', { class: 'text-base font-bold truncate' }, dateLabel),
        el('div', { class: 'text-xs text-muted- mt-0.5' },
          (holiday ? '🎉 ' + holiday + ' · ' : '')
          + rows.length + ' shift' + (rows.length === 1 ? '' : 's')
          + (mine.length ? ' · you’re on ' + mine.map(a => calShortTime(calShiftTimes(a).st) + '–' + calShortTime(calShiftTimes(a).en)).join(', ') : ''))),
      el('div', { class: 'flex items-center gap-1 shrink-0' },
        navBtn('‹', -1), navBtn('›', 1),
        el('button', { class: 'rounded-lg border px-2.5 py-1 text-[11px] text-muted-', style: { borderColor: 'var(--border-2)' }, onclick: () => overlay.remove() }, 'Close')));
    const body = el('div', { class: 'flex-1 overflow-y-auto' });
    if (!rows.length) {
      body.append(el('div', { class: 'px-5 py-8 text-sm text-muted- italic text-center' },
        holiday ? 'Company holiday — nobody is scheduled.' : 'Nobody is scheduled this day.'));
    }
    for (const [slotId, list] of bySlot) {
      const slot = slotTemplate(iso, slotId) || { label: 'Shift', slot_start: list[0].slot_start, slot_end: list[0].slot_end };
      body.append(el('div', { class: 'px-5 py-4 flex flex-col gap-2 border-b', style: { borderColor: 'var(--border)' } },
        el('div', { class: 'flex items-center justify-between gap-2' },
          el('div', { class: 'text-xs font-bold uppercase tracking-wider text-muted-' },
            slot.label + ' · ' + fmtTime(slot.slot_start) + '–' + fmtTime(slot.slot_end) + ' · ' + list.length),
          !_calPhone() ? el('button', { class: 'text-[11px] font-semibold', style: { color: 'var(--accent)' }, onclick: () => { overlay.remove(); openSlotModal(iso, slotId); } }, 'Open shift →') : null),
        ...list.map(a => assignmentRow(a, slot, activeReps, repById, meId, isAdmin, redraw))));
    }
    if (isAdmin) {
      body.append(el('div', { class: 'px-5 py-4 flex items-center gap-2' },
        el('button', {
          class: 'rounded-lg px-2.5 py-1 text-[11px] font-bold transition hover:brightness-95',
          style: { background: 'var(--accent)', color: 'var(--accent-text)' },
          onclick: () => { overlay.remove(); openNewShiftModal(iso); },
        }, '+ New shift'),
        ...(bySlot.size ? [el('span', { class: 'text-[11px] text-muted-' }, 'or add a rep to an existing shift above')] : [])));
    }
    card.append(header, body);
    overlay.replaceChildren(card);
  };
  const redraw = () => { render(); mountApp(); };
  render();
  document.body.append(overlay);
}

function openSlotModal(iso, slotId) {
  const overlay = el('div', { class: 'modal-overlay' });
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  const render = () => {
    const slot = slotTemplate(iso, slotId);
    if (!slot) { overlay.remove(); return; }
    // Full roster (used for looking up names on already-assigned reps, even if deactivated later).
    // Assignable roster = active OFFICE STAFF only (calendar is an Inside Sales tool).
    const allReps    = state.allProfiles.length ? state.allProfiles : [state.profile];
    const activeReps = calendarEligibleProfiles(state.profile);
    const meId = state.profile.id;
    const isAdmin = calendarCanManage(state.profile?.role);
    const repById = Object.fromEntries(allReps.map(r => [r.id, r]));
    const assigns = assignmentsForSlot(iso, slotId);
    const dateLabel = new Date(iso + 'T00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

    const card = el('div', { class: 'card w-full max-w-md my-8 overflow-hidden flex flex-col', style: { maxHeight: 'calc(100vh - 64px)' } });

    const header = el('div', { class: 'flex items-center justify-between px-5 py-4 border-b', style: { borderColor: 'var(--border)' } },
      el('div', {},
        el('h2', { class: 'text-base font-bold' }, slot.label),
        el('div', { class: 'text-xs text-muted- mt-0.5' },
          dateLabel + (isAdmin ? ' · Admin edit' : '')),
      ),
      el('button', {
        class: 'rounded-lg border px-2.5 py-1 text-[11px] text-muted-',
        style: { borderColor: 'var(--border-2)' },
        onclick: () => overlay.remove(),
      }, 'Close'),
    );

    const body = el('div', { class: 'flex-1 overflow-y-auto' });

    const assignedList = el('div', { class: 'px-5 py-4 flex flex-col gap-2 border-b', style: { borderColor: 'var(--border)' } },
      el('div', { class: 'text-xs font-bold uppercase tracking-wider text-muted-' }, `Reps working this shift (${assigns.length})`),
      ...(assigns.length === 0
        ? [el('div', { class: 'text-sm text-muted- italic py-2' },
            isAdmin ? 'Nobody assigned yet — add a rep below.' : 'Nobody assigned yet.')]
        : assigns.map(a => assignmentRow(a, slot, activeReps, repById, meId, isAdmin, redraw))
      ),
    );

    body.append(assignedList);

    // ── Admin-only: add a rep to this slot ──
    if (isAdmin) {
      const unassignedReps = activeReps.filter(r => !assigns.some(a => a.rep_id === r.id));
      const addSelect = el('select', {
        class: 'flex-1 rounded-lg border px-2.5 py-1 text-[11px]',
        style: { borderColor: 'var(--border-2)' },
      },
        el('option', { value: '' }, 'Choose rep…'),
        ...unassignedReps.map(r => el('option', { value: r.id }, r.full_name))
      );
      const addStart = el('input', { type: 'time', class: 'w-full rounded-lg border px-2 py-2 text-sm', value: slot.slot_start, style: { borderColor: 'var(--border-2)' } });
      const addEnd   = el('input', { type: 'time', class: 'w-full rounded-lg border px-2 py-2 text-sm', value: slot.slot_end,   style: { borderColor: 'var(--border-2)' } });
      const repeatChk = el('input', { type: 'checkbox', checked: true, class: 'mr-2' });
      const weekday = weekdayName(iso);
      const addRow = el('div', { class: 'px-5 py-4 flex flex-col gap-2' },
        el('div', { class: 'text-xs font-bold uppercase tracking-wider text-muted-' }, 'Add a rep'),
        addSelect,
        el('div', { class: 'flex items-center gap-2' },
          el('label', { class: 'text-[10px] font-semibold flex-1 text-muted-' }, 'Start', addStart),
          el('label', { class: 'text-[10px] font-semibold flex-1 text-muted-' }, 'End',   addEnd),
        ),
        el('label', { class: 'flex items-center text-xs' },
          repeatChk,
          el('span', {}, `Repeat every ${weekday} for the next 12 weeks`),
        ),
        el('div', { class: 'text-[10px] text-muted-' },
          `Leave times at ${fmtTime(slot.slot_start)}–${fmtTime(slot.slot_end)} for a full shift, or narrow them for partial coverage.`),
        el('button', {
          class: 'rounded-lg px-2.5 py-1 text-[11px] font-bold transition hover:brightness-95',
          style: { background: 'var(--accent)', color: 'var(--accent-text)' },
          onclick: () => {
            const repId = addSelect.value;
            if (!repId) { toast('Pick a rep', 'warn'); return; }
            const start = addStart.value || slot.slot_start;
            const end   = addEnd.value   || slot.slot_end;
            if (start >= end) { toast('End must be after start', 'warn'); return; }
            if (start < slot.slot_start || end > slot.slot_end) {
              toast(`Must stay within ${fmtTime(slot.slot_start)}–${fmtTime(slot.slot_end)}`, 'warn');
              return;
            }
            const isRecurring = repeatChk.checked;
            const baseDate = new Date(iso + 'T00:00');
            const baseDow  = baseDate.getDay();
            let added = 0;
            const pushOne = (targetIso) => {
              // Skip duplicates (same rep already on this slot on this date)
              if (state.shifts.some(s => s.date === targetIso && s.slot_id === slotId && s.rep_id === repId)) return;
              state.shifts.push({
                id: `shift-${targetIso}-${slotId}-${repId}-${Date.now()}-${added}`,
                date: targetIso, slot_id: slotId,
                slot_start: slot.slot_start, slot_end: slot.slot_end,
                rep_id: repId, start, end, note: '',
                recurring: isRecurring,
              });
              added += 1;
            };
            pushOne(iso);
            if (isRecurring) {
              const until = new Date(baseDate); until.setDate(baseDate.getDate() + 7 * 12);
              for (let d = new Date(baseDate); d <= until; d.setDate(d.getDate() + 1)) {
                if (d.getDay() !== baseDow) continue;
                const dIso = isoDate(d);
                if (dIso === iso) continue;
                // Only add if this date actually has this slot in its template
                if (!shiftSlotsForDate(dIso).some(s => s.slot_id === slotId)) continue;
                pushOne(dIso);
              }
            }
            saveDemoData();
            toast(isRecurring
              ? `Added recurring (${added} ${weekday}${added === 1 ? '' : 's'})`
              : 'Added to shift',
              'success');
            redraw();
          },
        }, '+ Add to shift'),
      );
      body.append(addRow);
    }

    card.append(header, body);
    overlay.innerHTML = '';
    overlay.append(card);
  };
  const redraw = () => { render(); mountApp(); };
  render();
  document.body.append(overlay);
}

function assignmentRow(a, slot, reps, repById, meId, isAdmin, redraw) {
  const rep = repById[a.rep_id];
  const isMine = a.rep_id === meId;
  const isPartial = a.start !== slot.slot_start || a.end !== slot.slot_end;
  const pendingReq = state.shiftSwapRequests.find(r => r.shift_id === a.id && swapOpen(r));
  const awaitingLead = !!(pendingReq && pendingReq.status === 'awaiting_lead');
  const wrap = el('div', { class: 'rounded-lg border p-2.5 flex flex-col gap-2', style: {
    borderColor: isMine ? 'var(--accent)' : 'var(--border)',
    background: isMine ? 'rgba(223,100,58,0.08)' : 'var(--card-2)',
  } });
  wrap.append(
    el('div', { class: 'flex items-center justify-between gap-2' },
      el('div', { class: 'flex-1 min-w-0 flex items-center gap-2' },
        el('span', {
          class: 'inline-flex items-center justify-center rounded-full text-[10px] font-bold flex-shrink-0',
          style: { width: '24px', height: '24px', background: isMine ? 'var(--accent)' : 'var(--card)', color: isMine ? 'var(--accent-text)' : 'var(--text)', border: '1px solid var(--border-2)' },
        }, repInitials(rep)),
        el('div', { class: 'flex-1 min-w-0' },
          el('div', { class: 'text-sm font-semibold truncate flex items-center gap-1.5' },
            rep?.full_name || 'Unknown',
            isRecurring(a) && el('span', {
              class: 'text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded',
              style: { background: 'var(--card)', color: 'var(--text-muted)', border: '1px solid var(--border)' },
              title: `Repeats every ${weekdayName(a.date)}`,
            }, '↻ Weekly'),
          ),
          el('div', { class: 'text-[11px] text-muted-' },
            isPartial ? `${fmtTime(a.start)}–${fmtTime(a.end)} · partial` : 'Full shift'),
        ),
      ),
      pendingReq && el('span', {
        class: 'text-[9px] font-bold uppercase tracking-wider px-2 py-1 rounded whitespace-nowrap',
        style: { background: 'rgba(223,100,58, 0.15)', color: '#A9441F' },
      }, awaitingLead ? 'Lead approval' : isOpenReq(pendingReq) ? 'Open' : pendingReq.from_rep_id === meId ? 'Waiting' : 'Incoming'),
    ),
  );

  const actions = el('div', { class: 'flex flex-wrap gap-1.5' });
  const btn = (label, onclick, variant) => el('button', {
    class: 'rounded-lg px-2.5 py-1 text-[11px] font-semibold' + (variant === 'primary' ? '' : ' border'),
    style: variant === 'primary'
      ? { background: 'var(--accent)', color: 'var(--accent-text)' }
      : variant === 'danger'
        ? { borderColor: 'var(--border-2)', color: 'var(--text-muted)' }
        : { borderColor: 'var(--border-2)', color: 'var(--text)' },
    onclick,
  }, label);

  if (isAdmin) {
    // ── Admin: full edit on every row, no transfer flow needed (reassign is direct) ──
    actions.append(
      btn('Reassign', () => openReassignSheet(a, reps, redraw)),
      btn('Edit time', () => openEditTimesSheet(a, slot, redraw)),
      btn('Split', () => openSplitSheet(a, slot, redraw)),
      btn('Remove', () => {
        applyRecurringChange(a, 'Remove', (scope) => {
          const victims = findRecurringSiblings(a, scope);
          const ids = new Set(victims.map(s => s.id));
          state.shifts = state.shifts.filter(s => !ids.has(s.id));
          state.shiftSwapRequests = state.shiftSwapRequests.filter(r => !ids.has(r.shift_id));
        }, redraw);
      }, 'danger'),
    );
    // Lead / admin signs off on swaps both reps already agreed to
    if (awaitingLead) {
      const toRep = repById[pendingReq.to_rep_id];
      actions.append(
        btn('Approve → ' + (toRep?.full_name?.split(' ')[0] || 'rep'), () => { resolveSwap(pendingReq.id, 'approved'); redraw(); }, 'primary'),
        btn('Reject', () => { resolveSwap(pendingReq.id, 'rejected'); redraw(); }),
      );
    }
    if (pendingReq && isOpenReq(pendingReq)) {
      actions.append(el('span', { class: 'text-xs flex-1', style: { color: '#A9441F' } }, 'Open \u2014 nobody has picked it up yet'));
      if (!isMine) actions.append(btn('Pick up', () => pickUpOpenShift(pendingReq, redraw), 'primary'));
      actions.append(btn('Cancel drop', () => { resolveSwap(pendingReq.id, 'cancelled'); redraw(); }));
    }
    // Admin can also accept/decline if they happen to be the target of a swap
    if (pendingReq && pendingReq.status === 'pending' && pendingReq.to_rep_id === meId) {
      actions.append(
        btn('Accept', () => { resolveSwap(pendingReq.id, 'accepted'); redraw(); }, 'primary'),
        btn('Decline', () => { resolveSwap(pendingReq.id, 'declined'); redraw(); }),
      );
    }
  } else {
    // ── Rep (non-admin): only request-transfer on your own row, and accept/decline on incoming ──
    if (isMine && !pendingReq) {
      actions.append(
        btn('Request transfer', () => openTransferSheet(a, reps, redraw), 'primary'),
        btn('Drop \u00b7 open to anyone', () => { if (window.confirm('Open this shift up for anyone on the team to pick up?')) dropShiftOpen(a, '', redraw); }));
    } else if (isMine && pendingReq && pendingReq.from_rep_id === meId) {
      const toRep = repById[pendingReq.to_rep_id];
      actions.append(
        el('span', { class: 'text-xs text-muted- flex-1' }, awaitingLead ? 'Waiting on team lead approval\u2026' : isOpenReq(pendingReq) ? 'Open \u2014 waiting for someone to pick it up\u2026' : 'Awaiting ' + (toRep?.full_name?.split(' ')[0] || 'rep') + '\u2026'),
        btn('Cancel', () => { resolveSwap(pendingReq.id, 'cancelled'); redraw(); }),
      );
    } else if (!isMine && pendingReq && isOpenReq(pendingReq)) {
      actions.append(btn('Pick up this shift', () => pickUpOpenShift(pendingReq, redraw), 'primary'));
    } else if (!isMine && pendingReq && pendingReq.status === 'pending' && pendingReq.to_rep_id === meId) {
      actions.append(
        btn('Accept', () => { resolveSwap(pendingReq.id, 'accepted'); redraw(); }, 'primary'),
        btn('Decline', () => { resolveSwap(pendingReq.id, 'declined'); redraw(); }),
      );
    }
  }

  if (actions.children.length > 0) wrap.append(actions);
  return wrap;
}

function openSplitSheet(assignment, slot, redraw) {
  const overlay = el('div', { class: 'modal-overlay' });
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  const toM = (hhmm) => { const [h,m] = hhmm.split(':').map(Number); return h*60+m; };
  const toS = (mins) => `${String(Math.floor(mins/60)).padStart(2,'0')}:${String(mins%60).padStart(2,'0')}`;
  const midMins = Math.round(((toM(assignment.start) + toM(assignment.end)) / 2) / 15) * 15;
  const splitAt = el('input', { type: 'time', class: 'w-full rounded-lg border px-2 py-2 text-sm', value: toS(midMins), style: { borderColor: 'var(--border-2)' } });
  const card = el('div', { class: 'card w-full max-w-sm my-8 overflow-hidden' },
    el('div', { class: 'flex items-center justify-between px-5 py-4 border-b', style: { borderColor: 'var(--border)' } },
      el('h2', { class: 'text-base font-bold' }, 'Split shift'),
      el('button', { class: 'rounded-lg border px-2.5 py-1 text-[11px]', style: { borderColor: 'var(--border-2)' }, onclick: () => overlay.remove() }, 'Cancel'),
    ),
    el('div', { class: 'px-5 py-4 flex flex-col gap-3' },
      el('p', { class: 'text-sm text-muted-' },
        `Your ${fmtTime(assignment.start)}–${fmtTime(assignment.end)} shift will be split in two. You keep both halves — then Transfer just the half you need covered.`),
      el('label', { class: 'block text-xs font-semibold' }, 'Split at', splitAt),
      el('button', {
        class: 'rounded-lg px-2.5 py-1 text-[11px] font-bold',
        style: { background: 'var(--accent)', color: 'var(--accent-text)' },
        onclick: () => {
          const t = splitAt.value;
          if (!t || t <= assignment.start || t >= assignment.end) {
            toast(`Pick a time between ${fmtTime(assignment.start)} and ${fmtTime(assignment.end)}`, 'warn');
            return;
          }
          const original = state.shifts.find(s => s.id === assignment.id);
          if (!original) return;
          const wasRecurring = isRecurring(original);
          // Split is always a one-off — unlink both halves from the recurring series
          original.recurring = false;
          const secondHalf = { ...original, id: original.id + '-b-' + Date.now(), start: t, end: original.end, recurring: false };
          original.end = t;
          state.shifts.push(secondHalf);
          saveDemoData();
          overlay.remove();
          toast(wasRecurring ? 'Shift split (this day only, series intact)' : 'Shift split', 'success');
          redraw();
        },
      }, 'Split'),
    ),
  );
  overlay.append(card);
  document.body.append(overlay);
}

function openTransferSheet(assignment, reps, redraw) {
  const overlay = el('div', { class: 'modal-overlay' });
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  const meId = state.profile.id;
  const others = reps.filter(r => r.id !== meId && r.is_active !== false);
  const target = el('select', { class: 'w-full rounded-lg border px-2.5 py-1 text-[11px]', style: { borderColor: 'var(--border-2)' } },
    el('option', { value: '' }, 'Choose rep…'),
    ...others.map(r => el('option', { value: r.id }, r.full_name))
  );
  const note = el('textarea', {
    class: 'w-full rounded-lg border px-3 py-2 text-sm', rows: 2,
    placeholder: 'Optional note…', style: { borderColor: 'var(--border-2)' },
  });
  const card = el('div', { class: 'card w-full max-w-sm my-8 overflow-hidden' },
    el('div', { class: 'flex items-center justify-between px-5 py-4 border-b', style: { borderColor: 'var(--border)' } },
      el('h2', { class: 'text-base font-bold' }, 'Request transfer'),
      el('button', { class: 'rounded-lg border px-2.5 py-1 text-[11px]', style: { borderColor: 'var(--border-2)' }, onclick: () => overlay.remove() }, 'Cancel'),
    ),
    el('div', { class: 'px-5 py-4 flex flex-col gap-3' },
      el('p', { class: 'text-sm text-muted-' }, `Transferring ${fmtTime(assignment.start)}–${fmtTime(assignment.end)}. The other rep has to accept, then a team lead approves before it moves.`),
      el('label', { class: 'block text-xs font-semibold' }, 'Transfer to', target),
      el('label', { class: 'block text-xs font-semibold' }, 'Note', note),
      el('button', {
        class: 'rounded-lg px-2.5 py-1 text-[11px] font-bold',
        style: { background: 'var(--accent)', color: 'var(--accent-text)' },
        onclick: () => {
          const toId = target.value;
          if (!toId) { toast('Pick a rep', 'warn'); return; }
          state.shiftSwapRequests.push({
            id: 'swap-' + Date.now(),
            shift_id: assignment.id,
            from_rep_id: meId, to_rep_id: toId,
            status: 'pending', note: note.value.trim(),
            created_at: new Date().toISOString(), resolved_at: null,
          });
          saveDemoData();
          overlay.remove();
          toast('Transfer requested', 'success');
          redraw();
        },
      }, 'Request transfer'),
    ),
  );
  overlay.append(card);
  document.body.append(overlay);
}

// ── Admin-only: directly reassign an assignment to a different rep ────────
function openReassignSheet(assignment, reps, redraw) {
  const overlay = el('div', { class: 'modal-overlay' });
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  const currentRep = reps.find(r => r.id === assignment.rep_id);
  const others = reps.filter(r => r.id !== assignment.rep_id && r.is_active !== false);
  const target = el('select', { class: 'w-full rounded-lg border px-2.5 py-1 text-[11px]', style: { borderColor: 'var(--border-2)' } },
    el('option', { value: '' }, 'Choose rep…'),
    ...others.map(r => el('option', { value: r.id }, r.full_name))
  );
  const card = el('div', { class: 'card w-full max-w-sm my-8 overflow-hidden' },
    el('div', { class: 'flex items-center justify-between px-5 py-4 border-b', style: { borderColor: 'var(--border)' } },
      el('h2', { class: 'text-base font-bold' }, 'Reassign shift'),
      el('button', { class: 'rounded-lg border px-2.5 py-1 text-[11px]', style: { borderColor: 'var(--border-2)' }, onclick: () => overlay.remove() }, 'Cancel'),
    ),
    el('div', { class: 'px-5 py-4 flex flex-col gap-3' },
      el('p', { class: 'text-sm text-muted-' },
        `Currently assigned to ${currentRep?.full_name || 'unknown'} (${fmtTime(assignment.start)}–${fmtTime(assignment.end)}). Admin reassignment is instant — no request/accept.`),
      el('label', { class: 'block text-xs font-semibold' }, 'Reassign to', target),
      el('button', {
        class: 'rounded-lg px-2.5 py-1 text-[11px] font-bold',
        style: { background: 'var(--accent)', color: 'var(--accent-text)' },
        onclick: () => {
          const toId = target.value;
          if (!toId) { toast('Pick a rep', 'warn'); return; }
          overlay.remove();
          applyRecurringChange(assignment, 'Reassign', (scope) => {
            const affected = findRecurringSiblings(assignment, scope);
            affected.forEach(s => { s.rep_id = toId; });
            if (scope === 'this') {
              const shift = state.shifts.find(s => s.id === assignment.id);
              if (shift) shift.recurring = false;
            }
            const ids = new Set(affected.map(s => s.id));
            state.shiftSwapRequests = state.shiftSwapRequests.filter(r => !ids.has(r.shift_id) || !swapOpen(r));
          }, redraw);
        },
      }, 'Reassign'),
    ),
  );
  overlay.append(card);
  document.body.append(overlay);
}

// ── Admin-only: edit an assignment's start/end times (within slot bounds) ─
function openEditTimesSheet(assignment, slot, redraw) {
  const overlay = el('div', { class: 'modal-overlay' });
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  const startInput = el('input', { type: 'time', class: 'w-full rounded-lg border px-2 py-2 text-sm', value: assignment.start, style: { borderColor: 'var(--border-2)' } });
  const endInput   = el('input', { type: 'time', class: 'w-full rounded-lg border px-2 py-2 text-sm', value: assignment.end,   style: { borderColor: 'var(--border-2)' } });
  const card = el('div', { class: 'card w-full max-w-sm my-8 overflow-hidden' },
    el('div', { class: 'flex items-center justify-between px-5 py-4 border-b', style: { borderColor: 'var(--border)' } },
      el('h2', { class: 'text-base font-bold' }, 'Edit shift time'),
      el('button', { class: 'rounded-lg border px-2.5 py-1 text-[11px]', style: { borderColor: 'var(--border-2)' }, onclick: () => overlay.remove() }, 'Cancel'),
    ),
    el('div', { class: 'px-5 py-4 flex flex-col gap-3' },
      el('p', { class: 'text-sm text-muted-' },
        `Slot runs ${fmtTime(slot.slot_start)}–${fmtTime(slot.slot_end)}. Narrower times = partial coverage.`),
      el('div', { class: 'flex items-center gap-2' },
        el('label', { class: 'text-[10px] font-semibold flex-1 text-muted-' }, 'Start', startInput),
        el('label', { class: 'text-[10px] font-semibold flex-1 text-muted-' }, 'End',   endInput),
      ),
      el('button', {
        class: 'rounded-lg px-2.5 py-1 text-[11px] font-bold',
        style: { background: 'var(--accent)', color: 'var(--accent-text)' },
        onclick: () => {
          const start = startInput.value;
          const end   = endInput.value;
          if (!start || !end || start >= end) { toast('End must be after start', 'warn'); return; }
          if (start < slot.slot_start || end > slot.slot_end) {
            toast(`Must stay within ${fmtTime(slot.slot_start)}–${fmtTime(slot.slot_end)}`, 'warn');
            return;
          }
          overlay.remove();
          applyRecurringChange(assignment, 'Update times on', (scope) => {
            const affected = findRecurringSiblings(assignment, scope);
            affected.forEach(s => { s.start = start; s.end = end; });
            if (scope === 'this') {
              const shift = state.shifts.find(s => s.id === assignment.id);
              if (shift) shift.recurring = false;
            }
          }, redraw);
        },
      }, 'Save'),
    ),
  );
  overlay.append(card);
  document.body.append(overlay);
}

// ──────────────────────────────────────────────────────────────────────────
// VIEW: HALL OF FAME — personal records per rep
// ──────────────────────────────────────────────────────────────────────────

