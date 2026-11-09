// ┌─ src/admin/scorecard-board.js ─────────────────────────────────────────
// │ The 1:1 accountability board (per Isaac, Nov 9): "an accountability
// │ place for TLs to make sure they are actually doing the recurring
// │ meetings they are supposed to do with their reps — simple, easy to use,
// │ moves the needle forward." Meetings are the headline; the scorecard is
// │ what gets reviewed inside the Review meeting.
// │   Each month, every Inside Sales / Loyalty rep owes two 1:1s with their
// │   TL: a Performance review (due by the 10th) and a Coaching session (due
// │   by the 25th). A chip per meeting: logged ✓, past due (red), coming up.
// │   Blocks are by department (a TL's reps = their department's reps),
// │   with the month's completion % and a six-month streak strip per block.
// │ Admins see every department, a TL theirs, a rep their own row plus the
// │ action items they own. Reads scorecard_meetings (openMeetingLogModal
// │ writes it); nothing new is stored.
// │ Part of the app.js bundle (app/src/bundle.order.js).
// └────────────────────────────────────────────────────────────────────────
const MEETING_DUE_DAY = { review: 10, coaching: 25 };
const _scbYm = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
const _scbShift = (ym, n) => _scbYm(new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1 + n, 1));
const _scbLbl = (ym) => new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1, 1).toLocaleDateString('en-US', { month: 'short' });
// One rep, one month: what was logged, what's late, what's still coming.
function meetingMonthStatus(profileId, ym) {
  const ms = meetingsFor(profileId);
  const today = new Date(), curYm = _scbYm(today), dom = today.getDate();
  const inMonth = (m) => String(m.period || m.meeting_date || '').slice(0, 7) === ym;
  const out = {};
  for (const kind of ['review', 'coaching']) {
    const hit = ms.filter(m => m.kind === kind && inMonth(m)).sort((a, b) => String(a.meeting_date).localeCompare(String(b.meeting_date)))[0] || null;
    const due = MEETING_DUE_DAY[kind];
    let st;
    if (hit) st = 'done';
    else if (ym < curYm) st = 'missed';
    else if (ym > curYm) st = 'upcoming';
    else st = dom > due ? 'late' : 'due';
    out[kind] = { st, m: hit, due, daysLate: st === 'late' ? dom - due : 0 };
  }
  const last = ms[0] || null;
  out.last = last; out.daysSince = last ? _mtgDays(last.meeting_date) : null;
  out.openItems = last ? (last.action_items || []).filter(a => a && !a.done) : [];
  out.doneN = (out.review.st === 'done' ? 1 : 0) + (out.coaching.st === 'done' ? 1 : 0);
  return out;
}
// Completion for a set of reps in a month: logged ÷ owed (two per rep).
function meetingCompletion(profileIds, ym) {
  let done = 0, owed = profileIds.length * 2, late = 0;
  for (const id of profileIds) { const s = meetingMonthStatus(id, ym); done += s.doneN; if (s.review.st === 'late' || s.review.st === 'missed') late++; if (s.coaching.st === 'late' || s.coaching.st === 'missed') late++; }
  return { done, owed, late, pct: owed ? done / owed : null };
}

function scorecardBoard({ roster, isAdmin, canScoreRoster, isAllDepts, dept, period, tplFor, upsertCard, allProfiles }) {
  const ym = period, curYm = _scbYm(new Date());
  const muted = { color: 'var(--text-muted)' };
  const me = state.profile || {};
  const depts = isAllDepts ? SCORECARD_DEPTS : SCORECARD_DEPTS.filter(d => d.id === dept);
  const leadsOf = (d) => (allProfiles || []).filter(p => p.is_active !== false && typeof isOfficeLeadRole === 'function' && isOfficeLeadRole(p.role) && scorecardDeptOf(p) === d);
  const C = { done: '#3E5A3A', late: '#B91C1C', missed: '#B91C1C', due: '#B45309', upcoming: 'var(--text-muted)' };
  const chip = (kind, s, profile, d) => {
    const k = MEETING_KINDS[kind]; const x = s[kind];
    const txt = x.st === 'done' ? k.short + ' ✓ ' + new Date(String(x.m.meeting_date).slice(0, 10) + 'T12:00').toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' })
      : x.st === 'late' ? k.short + ' · ' + x.daysLate + 'd late' : x.st === 'missed' ? k.short + ' · missed' : x.st === 'due' ? k.short + ' · by the ' + x.due + (x.due === 25 ? 'th' : 'th') : k.short + ' · next month';
    const bg = x.st === 'done' ? 'rgba(62,90,58,.12)' : (x.st === 'late' || x.st === 'missed') ? 'rgba(185,28,28,.12)' : x.st === 'due' ? 'rgba(180,83,9,.12)' : 'var(--card-2)';
    const can = canScoreRoster && x.st !== 'upcoming';
    return el('button', { class: 'rounded-full px-2.5 py-1 text-[11px] font-bold whitespace-nowrap' + (can ? '' : ' cursor-default'), style: { background: bg, color: C[x.st], border: '1px solid transparent' },
      title: x.st === 'done' ? 'Logged · open to read or edit' : can ? 'Log the ' + k.label.toLowerCase() + ' now' : k.desc,
      onclick: can ? () => openMeetingLogModal(profile, d, tplFor(profile), canScoreRoster, x.st === 'done' ? { startKind: null } : { startKind: kind, period: ym }) : null }, txt);
  };
  const streak = (ids) => {
    // Six months ending at the selected one: full dot = every meeting logged, half = at least half, hollow = less.
    const months = []; for (let i = 5; i >= 0; i--) months.push(_scbShift(ym, -i));
    return el('div', { class: 'flex items-center gap-1', title: 'Last six months — filled = every 1:1 logged, half = at least half, empty = less than half' },
      ...months.map(m => { const c = meetingCompletion(ids, m); const future = m > curYm; const full = c.pct != null && c.pct >= 0.999, half = c.pct != null && c.pct >= 0.5;
        return el('span', { title: _scbLbl(m) + ': ' + c.done + ' of ' + c.owed, class: 'inline-flex flex-col items-center gap-0.5' },
          el('span', { class: 'inline-block rounded-full', style: { width: '10px', height: '10px', border: '2px solid ' + (future ? 'var(--border-2)' : full ? C.done : half ? C.due : C.late), background: future ? 'transparent' : full ? C.done : half ? 'linear-gradient(90deg, ' + C.due + ' 50%, transparent 50%)' : 'transparent' } }),
          el('span', { class: 'text-[8px] uppercase', style: muted }, _scbLbl(m))); }));
  };
  const scoreOf = (profile) => { const c = (state._scorecardData || {})[profile.id + '|' + ym]; const s = c ? computeScorecardScore(c, tplFor(profile), ym, profile.id) : null; return s && s.coverage > 0 ? s.final : null; };

  const row = (profile, d) => {
    const s = meetingMonthStatus(profile.id, ym);
    const sc = scoreOf(profile);
    const open = s.openItems.length;
    return el('div', { class: 'flex items-center gap-3 px-4 py-2.5 border-t flex-wrap', style: { borderColor: 'var(--border)' } },
      avatarNode(profile.avatar_url, profile.initials || (profile.full_name || '?').slice(0, 2), 'w-8 h-8 text-[11px]'),
      el('div', { class: 'min-w-0', style: { width: '180px' } },
        el('div', { class: 'text-sm font-bold truncate' }, profile.full_name || '—'),
        el('div', { class: 'text-[11px]', style: muted }, s.last ? 'Last 1:1 ' + s.daysSince + 'd ago' : 'No 1:1 ever logged')),
      chip('review', s, profile, d), chip('coaching', s, profile, d),
      el('button', { class: 'text-[11px] font-semibold whitespace-nowrap', style: { color: open ? '#B45309' : 'var(--text-muted)' }, title: open ? s.openItems.map(a => '• ' + a.text).join('\n') : 'No open action items',
        onclick: () => openMeetingLogModal(profile, d, tplFor(profile), canScoreRoster, { startKind: null }) }, open + ' open item' + (open === 1 ? '' : 's')),
      el('span', { class: 'ml-auto' }),
      sc != null ? el('span', { class: 'text-[11px] font-bold tabular-nums', style: { color: scorecardBand(sc).color }, title: 'Scorecard composite for ' + ym }, fmtScore(sc, 1)) : el('span', { class: 'text-[11px]', style: muted }, 'not scored'),
      el('button', { class: 'rounded-lg border px-2 py-0.5 text-[11px] font-semibold', style: { borderColor: 'var(--border-2)', color: 'var(--text)' }, onclick: () => openScorecardDetailModal(profile, ym, tplFor(profile), upsertCard, canScoreRoster) }, 'Scorecard'),
      el('button', { class: 'rounded-lg border px-2 py-0.5 text-[11px] font-semibold', style: { borderColor: 'var(--border-2)', color: 'var(--text-muted)' }, title: 'Every 1:1 logged with ' + (profile.full_name || 'this rep'), onclick: () => openMeetingLogModal(profile, d, tplFor(profile), canScoreRoster, { startKind: null }) }, 'History'));
  };

  const out = el('div', { class: 'flex flex-col gap-4' });
  // ── Summary strip for the month. ──
  const ids = roster.map(p => p.id);
  const tot = meetingCompletion(ids, ym);
  const reviews = ids.filter(id => meetingMonthStatus(id, ym).review.st === 'done').length, coachings = ids.filter(id => meetingMonthStatus(id, ym).coaching.st === 'done').length;
  const openAll = ids.reduce((a, id) => a + meetingMonthStatus(id, ym).openItems.length, 0);
  const monthLbl = new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  if (canScoreRoster) out.append(el('div', { class: 'grid grid-cols-2 sm:grid-cols-4 gap-3' },
    scorecardSummaryCard('1:1s logged · ' + monthLbl, tot.done + ' of ' + tot.owed, tot.pct != null ? Math.round(tot.pct * 100) + '% of the month’s meetings' : 'no reps', tot.pct == null ? null : tot.pct >= 0.999 ? C.done : tot.late ? C.late : C.due),
    scorecardSummaryCard('Performance reviews', reviews + ' of ' + ids.length, 'due by the 10th', reviews === ids.length ? C.done : null),
    scorecardSummaryCard('Coaching sessions', coachings + ' of ' + ids.length, 'due by the 25th', coachings === ids.length ? C.done : null),
    scorecardSummaryCard(ym === curYm ? 'Past due' : 'Missed', String(tot.late), tot.late ? 'meeting' + (tot.late === 1 ? '' : 's') + ' not logged in time · ' + openAll + ' open action item' + (openAll === 1 ? '' : 's') : openAll + ' open action item' + (openAll === 1 ? '' : 's'), tot.late ? C.late : C.done)));

  // ── Blocks by department (a TL's reps). ──
  const isLead = (p) => typeof isOfficeLeadRole === 'function' && isOfficeLeadRole(p.role);
  for (const d of depts) {
    const reps = roster.filter(p => scorecardDeptOf(p) === d.id && !isLead(p));   // a TL's own 1:1 is with an admin — their block below
    if (!reps.length) continue;
    const leads = leadsOf(d.id);
    const c = meetingCompletion(reps.map(p => p.id), ym);
    const order = (p) => { const s = meetingMonthStatus(p.id, ym); const w = (x) => x.st === 'late' || x.st === 'missed' ? 0 : x.st === 'due' ? 1 : x.st === 'done' ? 3 : 2; return Math.min(w(s.review), w(s.coaching)); };
    reps.sort((a, b) => order(a) - order(b) || String(a.full_name || '').localeCompare(String(b.full_name || '')));
    out.append(el('div', { class: 'card overflow-hidden' },
      el('div', { class: 'px-4 py-3 flex items-center gap-3 flex-wrap' },
        el('div', { class: 'min-w-0' },
          el('div', { class: 'text-base font-bold' }, d.label),
          el('div', { class: 'text-[11px]', style: muted }, (leads.length ? 'TL: ' + leads.map(l => l.full_name).join(', ') : 'No team lead assigned — give someone the TL role in Settings → Users') + ' · ' + reps.length + ' rep' + (reps.length === 1 ? '' : 's'))),
        el('div', { class: 'ml-auto flex items-center gap-4 flex-wrap' },
          el('div', { class: 'text-right' },
            el('div', { class: 'text-lg font-black tabular-nums', style: { color: c.pct == null ? 'var(--text)' : c.pct >= 0.999 ? C.done : c.late ? C.late : C.due } }, c.pct == null ? '—' : Math.round(c.pct * 100) + '%'),
            el('div', { class: 'text-[10px] uppercase tracking-widest', style: muted }, c.done + ' of ' + c.owed + ' logged')),
          streak(reps.map(p => p.id)),
          canScoreRoster && isAdmin ? el('button', { class: 'rounded-lg px-2 py-0.5 text-[11px] font-semibold border', style: { borderColor: 'var(--border-2)', color: 'var(--text)' }, title: 'Scorecard template for ' + d.label, onclick: () => openScorecardTemplateModal(d.id) }, '⚙ Template') : null)),
      ...reps.map(p => row(p, d.id))));
  }

  // ── Team leads: their own 1:1s are with an admin (admins only). ──
  const tls = isAdmin ? roster.filter(isLead) : [];
  if (tls.length) {
    const c = meetingCompletion(tls.map(p => p.id), ym);
    out.append(el('div', { class: 'card overflow-hidden' },
      el('div', { class: 'px-4 py-3 flex items-center gap-3 flex-wrap' },
        el('div', {}, el('div', { class: 'text-base font-bold' }, 'Team leads'), el('div', { class: 'text-[11px]', style: muted }, 'Their 1:1s are with you · ' + tls.length + ' TL' + (tls.length === 1 ? '' : 's'))),
        el('div', { class: 'ml-auto flex items-center gap-4 flex-wrap' },
          el('div', { class: 'text-right' },
            el('div', { class: 'text-lg font-black tabular-nums', style: { color: c.pct == null ? 'var(--text)' : c.pct >= 0.999 ? C.done : c.late ? C.late : C.due } }, c.pct == null ? '—' : Math.round(c.pct * 100) + '%'),
            el('div', { class: 'text-[10px] uppercase tracking-widest', style: muted }, c.done + ' of ' + c.owed + ' logged')),
          streak(tls.map(p => p.id)))),
      ...tls.map(p => row(p, scorecardDeptOf(p)))));
  }

  // ── A rep's own view: their row, plus the action items they own. ──
  if (!canScoreRoster && roster.length) {
    const p = roster[0]; const s = meetingMonthStatus(p.id, ym);
    if (s.openItems.length) out.append(el('div', { class: 'card p-4' },
      el('div', { class: 'text-[10px] uppercase tracking-widest font-semibold mb-2', style: muted }, 'Your open action items'),
      ...s.openItems.map(a => el('div', { class: 'text-xs py-1 border-t', style: { borderColor: 'var(--border)' } }, '• ' + a.text + (a.carried_from ? '  (since ' + _mtgFmt(a.carried_from) + ')' : '')))));
    if (s.last && (s.last.notes || s.last.wins)) out.append(el('div', { class: 'card p-4' },
      el('div', { class: 'text-[10px] uppercase tracking-widest font-semibold mb-2', style: muted }, 'From your last 1:1 · ' + _mtgFmt(s.last.meeting_date)),
      s.last.wins ? el('div', { class: 'text-xs mb-1' }, el('span', { class: 'font-bold', style: { color: C.done } }, 'Wins: '), s.last.wins) : null,
      s.last.notes ? el('div', { class: 'text-xs whitespace-pre-wrap' }, s.last.notes) : null));
  }
  return out;
}
