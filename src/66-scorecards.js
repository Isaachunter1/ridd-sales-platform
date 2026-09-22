// ┌─ src/66-scorecards.js ─────────────────────────────────────────────────────
// │ Scorecards and the 1:1 meeting log.
// │ Part of the app.js bundle (tools/bundle.js concatenates src/*.js in name order).
// └────────────────────────────────────────────────────────────────────────
function viewScorecards() {
  const isAdmin = isAdminRole(state.profile?.role);
  const isLead = typeof isOfficeLeadRole === 'function' && isOfficeLeadRole(state.profile?.role);
  const canScoreRoster = isAdmin || isLead;
  // Department scope (per Isaac): everyone DEFAULTS to their own
  // department; admins switch with the dropdown, leads + reps are pinned.
  const myDept = scorecardDeptOf(state.profile);
  // Admins default to ALL departments, segmented (per Isaac); leads and
  // reps are pinned to their own.
  if (isAdmin && !state._scorecardDept) state._scorecardDept = 'all';
  const dept = isAdmin ? (state._scorecardDept || 'all') : myDept;
  const isAllDepts = dept === 'all';
  const deptLabel = isAllDepts ? 'All departments' : ((SCORECARD_DEPTS.find(d => d.id === dept) || {}).label || dept);
  // Template: the selected department's; in All view each card uses ITS
  // department's template (tplFor below) and the header shows none.
  const tpl = getScorecardTemplate(isAllDepts ? myDept : dept);
  const tplFor = (p) => getScorecardTemplate(scorecardDeptOf(p));
  if (!state._scorecardData) state._scorecardData = {};
  if (!state._scorecardPeriod) {
    const opts = scorecardPeriodOptions();
    state._scorecardPeriod = opts[0]?.key || new Date().toISOString().slice(0, 7);
  }
  const period = state._scorecardPeriod;
  loadScorecardCloud(period);   // hydrate cards + call audits from Supabase (no-op in demo)
  loadScorecardMeetingsCloud();  // 1:1 meeting log (all agents, once per session)
  const periodOpts = scorecardPeriodOptions();
  if (period && !periodOpts.some(o => o.key === period)) periodOpts.push({ key: period, label: period });
  // Storage key uses the profile.id (stable across renames / email
  // changes) rather than a display name from the CSV, so a rep editing
  // their name in the user editor doesn't orphan their scorecard
  // history.
  const cardKey = (profileId) => profileId + '|' + period;
  const getCard = (profileId) => state._scorecardData[cardKey(profileId)] || null;
  const upsertCard = (profileId, patch) => {
    const k = cardKey(profileId);
    const cur = state._scorecardData[k] || { metrics: {}, attendance: {}, notes: '' };
    state._scorecardData[k] = {
      metrics:    { ...(cur.metrics || {}),    ...(patch.metrics || {}) },
      attendance: { ...(cur.attendance || {}), ...(patch.attendance || {}) },
      notes:      patch.notes != null ? patch.notes : (cur.notes || ''),
      // Stamps (per Isaac): finalized = locked; reviewed = the 1:1
      // actually happened. `undefined` leaves a stamp alone, `null` clears.
      finalized:  patch.finalized !== undefined ? patch.finalized : (cur.finalized || null),
      reviewed:   patch.reviewed  !== undefined ? patch.reviewed  : (cur.reviewed  || null),
    };
    saveDemoData();
    const _p = (state.allProfiles || []).find(x => x.id === profileId);
    const _d = _p ? scorecardDeptOf(_p) : (isAllDepts ? myDept : dept);
    saveScorecardCardCloud(profileId, period, _d, getScorecardTemplate(_d));
  };

  // Roster — every active app user (profile). Scorecards are
  // intentionally NOT keyed off CSV rep names: only people who actually
  // sign into the app get scored, since the scorecard is a manager's
  // monthly review of THIS user. Anyone you don't want to see should be
  // flipped to inactive in the user editor.
  //
  // Reps only see their OWN card — same data, same modal, just scoped
  // to one row. They can read scores their manager has set and the
  // coaching notes, but the template editor is admin-only (gated below).
  // Office team leads run their department's monthly reviews (per
  // Isaac): full dept roster, score entry + notes. Template editor stays
  // admin-only, and a lead's OWN card is admin-scored.
  const allProfiles = (state.allProfiles || []).filter(p => p && p.is_active !== false);
  const roster = canScoreRoster
    ? allProfiles.filter(p => !isAdminRole(p.role) && !isAuditorRole(p.role)
        && typeof isOfficeStaffProfile === 'function' && isOfficeStaffProfile(p)
        && (isAllDepts || scorecardDeptOf(p) === dept))
        .sort((a, b) => (a.full_name || '').localeCompare(b.full_name || ''))
    : allProfiles.filter(p => p.id === state.profile?.id);

  // ── Header strip ──────────────────────────────────────────────────
  const container = el('div', { class: 'flex flex-col gap-4' });

  const header = el('div', { class: 'card p-5 flex items-start justify-between gap-4 flex-wrap' },
    el('div', {}, el('h2', { class: 'text-xl font-bold' }, 'Scorecards')),
    el('div', { class: 'flex items-center gap-2 flex-wrap' },
      // Department scope — admins switch between departments; leads and
      // reps see a pinned pill for their own.
      isAdmin ? el('select', {
        class: 'rounded-lg border px-2.5 py-1 text-[11px] cursor-pointer',
        style: { borderColor: 'var(--border-2)' },
        title: 'Which department\u2019s scorecards (and template) to show',
        onchange: (e) => { state._scorecardDept = e.target.value; mountApp(); },
      }, el('option', { value: 'all', selected: isAllDepts }, 'All departments'), ...SCORECARD_DEPTS.map(d => el('option', { value: d.id, selected: d.id === dept }, d.label)))
      : el('span', {
          class: 'rounded-full border px-2.5 py-1 text-[11px] font-semibold',
          style: { borderColor: 'var(--border-2)', color: 'var(--text-muted)' },
        }, deptLabel),
      el('label', { class: 'text-[10px] uppercase tracking-widest text-muted- font-semibold' }, 'Period'),
      el('select', {
        class: 'rounded-lg border px-2.5 py-1 text-[11px] cursor-pointer',
        style: { borderColor: 'var(--border-2)' },
        onchange: (e) => { state._scorecardPeriod = e.target.value; mountApp(); },
      },
        ...periodOpts.map(p => el('option', { value: p.key, selected: p.key === period }, p.label)),
      ),
      // Template editor — admin-only. The template defines the
      // metrics + weights + attendance penalties every scorecard uses,
      // so reps shouldn't be able to retune the formula their own
      // manager scores them on.
      canScoreRoster && !isAllDepts && el('button', {
        class: 'rounded-lg px-2.5 py-1 text-[11px] font-bold border transition hover:brightness-95',
        style: { borderColor: 'var(--border-2)', color: 'var(--text)' },
        title: 'Edit template metrics, weights, and attendance penalties',
        onclick: () => openScorecardTemplateModal(dept),
      }, '⚙ Template'),
    ),
  );
  container.append(header);

  if (roster.length === 0) {
    container.append(
      el('div', { class: 'card p-8 text-center' },
        el('div', { class: 'text-3xl mb-3' }, '📋'),
        el('h3', { class: 'text-base font-bold mb-1' }, 'No app users yet'),
        el('p', { class: 'text-xs text-muted- max-w-md mx-auto' },
          'Scorecards cover the people who sign into the app — not CSV-only rep names. ' +
          'Invite team members through Settings → Users, then come back here to start scoring.'),
      ),
    );
    return container;
  }

  // Roster-level rollups for the summary strip up top.
  const scores = roster.map(profile => {
    // A rep with graded calls but no saved card still scores (per Isaac —
    // Pere logged audits and saw nothing): score an empty shell so the
    // automatic audit / accuracy rollup counts.
    const hasAudits = typeof callAuditRollup === 'function' && callAuditRollup(profile.id, period).n > 0;
    const card = getCard(profile.id) || (hasAudits ? { metrics: {}, attendance: {}, notes: '' } : null);
    const score = card ? computeScorecardScore(card, tplFor(profile), period, profile.id) : null;
    return { profile, card, score };
  });
  const scored = scores.filter(s => s.score && s.score.coverage > 0);
  const avgComposite = scored.length > 0
    ? scored.reduce((a, s) => a + s.score.final, 0) / scored.length
    : null;
  const strongCount    = scored.filter(s => s.score.final >= 90).length;
  const watchCount     = scored.filter(s => s.score.final >= 75 && s.score.final < 90).length;
  const interveneCount = scored.filter(s => s.score.final < 75).length;

  const summaryStrip = el('div', { class: 'grid grid-cols-2 sm:grid-cols-4 gap-3' },
    scorecardSummaryCard('Roster', roster.length + ' agent' + (roster.length === 1 ? '' : 's'), scored.length + ' scored this period'),
    scorecardSummaryCard('Avg Composite',
      avgComposite != null ? fmtScore(avgComposite, 1) : '—',
      avgComposite != null ? scorecardBand(avgComposite).label : 'no scores yet',
      avgComposite != null ? scorecardBand(avgComposite).color : null),
    scorecardSummaryCard('Strong (≥90)',     strongCount.toString(),    'on or above target', '#DF643A'),
    scorecardSummaryCard('Needs Coaching',   (interveneCount + watchCount).toString(),
      interveneCount + ' intervene · ' + watchCount + ' watch',
      interveneCount > 0 ? '#B91C1C' : (watchCount > 0 ? '#A9441F' : null)),
  );
  // (1:1 Cadence summary card retired per Isaac, Sep 2026 — four cards only.)
  container.append(summaryStrip);

  // ── Agent grid ──────────────────────────────────────────────────
  // Sort: scored agents first (highest composite up top), then unscored.
  scores.sort((a, b) => {
    const aS = a.score && a.score.coverage > 0 ? a.score.final : -1;
    const bS = b.score && b.score.coverage > 0 ? b.score.final : -1;
    if (aS !== bS) return bS - aS;
    return (a.profile.full_name || '').localeCompare(b.profile.full_name || '');
  });

  // Trend series (per Isaac): composite over the last 6 periods,
  // oldest \u2192 newest, null where a month was never scored.
  const _trendKeys = periodOpts.slice(0, 6).map(o => o.key).reverse();
  const cardFor = ({ profile, card, score }) => {
    const t = tplFor(profile), d = scorecardDeptOf(profile);
    return scorecardAgentCard({
      profile, card, score, tpl: t,
      trend: _trendKeys.map(k => {
        const c = state._scorecardData[profile.id + '|' + k];
        const s = c ? computeScorecardScore(c, t, k, p.id) : null;
        return (s && s.coverage > 0) ? { key: k, val: s.final } : { key: k, val: null };
      }),
      // Admins and team leads have the SAME scorecard permissions (per
      // Isaac): score any card in the department, log / edit 1:1s.
      onOpen: () => openScorecardDetailModal(profile, period, t, upsertCard, canScoreRoster),
      onMeetings: () => openMeetingLogModal(profile, d, t, canScoreRoster),
    });
  };
  if (isAllDepts) {
    // Segmented by department (per Isaac): one section per dept, each with
    // its own header + grid, in SCORECARD_DEPTS order.
    for (const d of SCORECARD_DEPTS) {
      const rows = scores.filter(x => scorecardDeptOf(x.profile) === d.id);
      if (!rows.length) continue;
      const dScored = rows.filter(x => x.score && x.score.coverage > 0);
      const dAvg = dScored.length ? dScored.reduce((a, x) => a + x.score.final, 0) / dScored.length : null;
      container.append(el('div', { class: 'flex items-center gap-3 mt-2' },
        el('h3', { class: 'text-base font-bold' }, d.label),
        el('span', { class: 'text-[11px] text-muted-' }, rows.length + ' agent' + (rows.length === 1 ? '' : 's') + (dAvg != null ? ' \u00b7 avg ' + fmtScore(dAvg, 1) : '')),
        canScoreRoster ? el('button', {
          class: 'ml-auto rounded-lg px-2.5 py-1 text-[11px] font-bold border transition hover:brightness-95',
          style: { borderColor: 'var(--border-2)', color: 'var(--text)' },
          onclick: () => openScorecardTemplateModal(d.id),
        }, '\u2699 ' + d.label + ' template') : null));
      container.append(el('div', { class: 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3' }, ...rows.map(cardFor)));
    }
  } else {
    container.append(el('div', { class: 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3' }, ...scores.map(cardFor)));
  }

  return container;
}

function scorecardSummaryCard(label, value, subtitle, color) {
  return el('div', { class: 'card p-4' },
    el('div', { class: 'text-[10px] uppercase tracking-widest text-muted- font-semibold' }, label),
    el('div', {
      class: 'text-xl font-black tabular-nums mt-1',
      style: color ? { color } : {},
    }, value),
    el('div', { class: 'text-xs text-muted- mt-1' }, subtitle),
  );
}

function scorecardAgentCard({ profile, card, score, tpl, trend, onOpen, onMeetings }) {
  const composite = score && score.coverage > 0 ? score.final : null;
  const band = scorecardBand(composite);
  const isEmpty = !card || score.coverage === 0;
  const officeName = (state.offices || []).find(o => o.id === profile.office_id)?.name || '';
  const subtitle = [officeName, roleLabel ? roleLabel(profile.role) : profile.role]
    .filter(Boolean).join(' · ') || '—';

  const head = el('div', { class: 'flex items-start justify-between gap-3 mb-3' },
    el('div', { class: 'flex items-center gap-3 min-w-0 flex-1' },
      (() => {
        const av = avatarNode(profile.avatar_url, profile.initials || (profile.full_name || '?').slice(0, 2), 'w-10 h-10 text-sm');
        av.style.flexShrink = '0';
        return av;
      })(),
      el('div', { class: 'min-w-0' },
        el('div', { class: 'font-bold text-sm truncate' }, profile.full_name || 'Unnamed'),
        el('div', { class: 'text-[10px] text-muted- mt-0.5 truncate' }, subtitle),
      ),
    ),
    el('div', {
      class: 'rounded-lg px-3 py-1.5 text-center shrink-0',
      style: { background: band.bg, minWidth: '70px' },
    },
      el('div', {
        class: 'text-xl font-black tabular-nums leading-none',
        style: { color: band.color },
      }, composite != null ? fmtScore(composite) : '—'),
      el('div', {
        class: 'text-[9px] uppercase tracking-widest font-bold mt-0.5',
        style: { color: band.color },
      }, band.label),
    ),
  );

  // Per-metric mini-bars so the user can scan strengths/weaknesses
  // without opening the detail modal. Each bar fills proportional to
  // the metric's score; gray when missing.
  const bars = el('div', { class: 'flex flex-col gap-1.5' },
    ...tpl.metrics.map(m => {
      const v = score && score.breakdown[m.id];
      const has = Number.isFinite(v);
      const b = scorecardBand(v);
      return el('div', {},
        // Sheet order (per Isaac): item · weight · score (out of 100).
        el('div', { class: 'flex items-center justify-between text-[10px] mb-0.5 gap-2' },
          el('span', { class: 'text-muted- truncate' }, m.label),
          el('span', { class: 'flex items-center gap-2 shrink-0' },
            el('span', { class: 'tabular-nums text-muted-', title: 'Weight — share of the final score' }, Math.round(m.weight * 100) + '%'),
            el('span', {
              class: 'tabular-nums font-semibold text-right',
              style: Object.assign({ minWidth: '34px' }, has ? { color: b.color } : { color: 'var(--text-muted)' }),
            }, has ? fmtScore(v) : '—')),
        ),
        el('div', { style: { height: '5px', borderRadius: '0', background: 'var(--card-2)', overflow: 'hidden' } },
          has && el('div', {
            style: {
              width: Math.min(100, Math.max(0, v)) + '%',
              height: '100%',
              background: b.color,
              transition: 'width .25s',
            },
          }),
        ),
      );
    }),
  );

  // \u2500 Trend sparkline (per Isaac): composite over the last 6 periods,
  // fixed 0\u2013100 scale so months are comparable card-to-card. Hidden
  // until an agent has 2+ scored months.
  const spark = (() => {
    if (!Array.isArray(trend)) return null;
    const pts = trend.map((t, i) => ({ i, key: t && t.key, val: t && Number.isFinite(t.val) ? t.val : null }));
    if (pts.filter(p => p.val != null).length < 2) return null;
    const W = 120, H = 30, PAD = 4;
    const x = (i) => PAD + i * ((W - PAD * 2) / Math.max(1, pts.length - 1));
    const y = (v) => H - PAD - (Math.min(100, Math.max(0, v)) / 100) * (H - PAD * 2);
    const latest = [...pts].reverse().find(p => p.val != null);
    const first  = pts.find(p => p.val != null);
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    svg.style.width = '100%'; svg.style.height = '30px'; svg.style.display = 'block';
    let d = '', started = false;
    for (const p of pts) {
      if (p.val == null) { started = false; continue; }
      d += (started ? ' L ' : ' M ') + x(p.i).toFixed(1) + ' ' + y(p.val).toFixed(1);
      started = true;
    }
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', d.trim());
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', scorecardBand(latest.val).color);
    path.setAttribute('stroke-width', '2');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    svg.append(path);
    for (const p of pts) {
      if (p.val == null) continue;
      const c = document.createElementNS(NS, 'circle');
      c.setAttribute('cx', x(p.i).toFixed(1)); c.setAttribute('cy', y(p.val).toFixed(1)); c.setAttribute('r', '2.4');
      c.setAttribute('fill', scorecardBand(p.val).color);
      const t = document.createElementNS(NS, 'title');
      t.textContent = p.key + ' \u00b7 ' + fmtScore(p.val, 1);
      c.append(t);
      svg.append(c);
    }
    const mo = (k) => { const m = String(k || '').split('-')[1]; return m ? new Date(2000, Number(m) - 1, 1).toLocaleDateString('en-US', { month: 'short' }) : ''; };
    return el('div', { class: 'mt-3' },
      el('div', { class: 'flex items-center justify-between text-[9px] text-muted- mb-0.5' },
        el('span', { class: 'uppercase tracking-widest font-semibold' }, 'Trend'),
        el('span', { class: 'tabular-nums' }, mo(first.key) + ' \u2013 ' + mo(latest.key))),
      svg);
  })();

  const stampChips = [];
  if (card && card.finalized) stampChips.push(el('span', {
    class: 'rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider',
    style: { background: 'rgba(223,100,58,.12)', color: '#DF643A' },
    title: 'Finalized & locked' + (card.finalized.by ? ' by ' + card.finalized.by : '') + (card.finalized.on ? ' \u00b7 ' + fmt.dateShort(card.finalized.on) : ''),
  }, '\ud83d\udd12 Final'));
  if (card && card.reviewed) stampChips.push(el('span', {
    class: 'rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider',
    style: { background: 'rgba(169,68,31,.12)', color: '#A9441F' },
    title: 'Reviewed with the agent' + (card.reviewed.by ? ' by ' + card.reviewed.by : ''),
  }, '\u2713 Reviewed' + (card.reviewed.on ? ' ' + fmt.dateShort(card.reviewed.on) : '')));

  // 1:1 cadence (per Isaac): last meeting + what's due, and a button into
  // the meeting log. Red = overdue (14+ days) or never met.
  const cad = (typeof meetingCadence === 'function') ? meetingCadence(profile.id) : null;
  const footer = el('div', { class: 'mt-3 flex items-center justify-between text-[10px] gap-2' },
    stampChips.length
      ? el('span', { class: 'flex items-center gap-1.5 flex-wrap' }, ...stampChips)
      : el('span', { class: 'text-muted-' },
          isEmpty ? 'No score this period' : (cad && cad.last ? cad.label : 'Scored')),
    // One button (per Isaac): + Log Meeting — red until this month's
    // coaching 1:1 is logged, green after. The performance review (with
    // the score) and the coaching session both live inside it.
    // The card itself is STATIC (per Isaac) — scoring, the full scorecard
    // (audits / notes) and the 1:1 log all live behind this one button.
    el('button', {
      class: 'rounded-lg px-2 py-1 text-[10px] font-bold border transition hover:brightness-95 whitespace-nowrap shrink-0',
      style: { borderColor: cad && cad.coachingThisMonth ? '#5F6C5B' : '#DC2626', color: cad && cad.coachingThisMonth ? '#5F6C5B' : '#DC2626' },
      title: (cad && cad.coachingThisMonth ? 'Coaching 1:1 logged this month' : 'No coaching 1:1 logged this month') + ' \u2014 log a performance review (score) or coaching session',
      onclick: (e) => { e.stopPropagation(); if (onMeetings) onMeetings(); else if (onOpen) onOpen(); },
    }, '+ Log Meeting'),
  );

  return el('div', {
    class: 'card p-4',
    style: composite != null ? { borderLeft: '4px solid ' + band.color } : {},
  }, head, bars, spark, footer);
}

function openScorecardDetailModal(profile, period, tpl, upsertCard, canEdit = true) {
  const overlay = el('div', { class: 'modal-overlay' });
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  const modal = el('div', {
    class: 'card w-full max-w-2xl p-6 my-8 overflow-y-auto',
    style: { maxHeight: 'calc(100vh - 64px)' },
  });
  overlay.append(modal);
  const close = () => { overlay.remove(); mountApp(); };

  const profileId = profile.id;
  const name = profile.full_name || 'Unnamed';
  const officeName = (state.offices || []).find(o => o.id === profile.office_id)?.name || '';
  // Local draft so the user can tweak inputs before saving. Loaded from
  // existing card or empty defaults. We save on each input change so
  // there's no "did I save?" anxiety — the modal Close button just
  // dismisses.
  const cardKey = profileId + '|' + period;
  const initial = state._scorecardData[cardKey] || { metrics: {}, attendance: {}, notes: '' };
  const draft = {
    metrics:    { ...initial.metrics },
    attendance: { ...initial.attendance },
    notes:      initial.notes || '',
    finalized:  initial.finalized || null,
    reviewed:   initial.reviewed  || null,
  };

  const periodLabel = (() => {
    const [y, m] = period.split('-');
    return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  })();

  const render = () => {
    modal.innerHTML = '';
    const score = computeScorecardScore(draft, tpl, period, profileId);
    const band  = scorecardBand(score.final);
    // Finalize & lock (per Isaac): a finalized card is read-only for
    // EVERYONE; only an admin can unlock it for edits.
    const _isAdminHere = isAdminRole(state.profile?.role);
    const locked = !!draft.finalized;
    const canEditNow = canEdit && !locked;

    // ── Header
    modal.append(
      el('div', { class: 'flex items-start justify-between gap-4 mb-4' },
        el('div', { class: 'flex items-center gap-3 min-w-0' },
          (() => {
            const av = avatarNode(profile.avatar_url, profile.initials || name.slice(0, 2), 'w-12 h-12 text-base');
            av.style.flexShrink = '0';
            return av;
          })(),
          el('div', { class: 'min-w-0' },
            el('h2', { class: 'text-xl font-bold truncate' }, name),
            el('div', { class: 'text-xs text-muted- mt-1 truncate' },
              tpl.name + ' Scorecard · ' + periodLabel
                + (officeName ? ' · ' + officeName : '')),
          ),
        ),
        el('button', { class: 'text-2xl leading-none text-muted-', 'aria-label': 'Close', title: 'Close', onclick: close }, '×'),
      ),
    );

    if (locked) modal.append(
      el('div', { class: 'rounded-lg border px-3 py-2 text-[11px] mb-4', style: { borderColor: '#DF643A', background: 'rgba(223,100,58,.08)', color: '#DF643A' } },
        '\ud83d\udd12 Finalized' + (draft.finalized.by ? ' by ' + draft.finalized.by : '') + (draft.finalized.on ? ' \u00b7 ' + fmt.dateShort(draft.finalized.on) : '') + (_isAdminHere ? ' \u2014 unlock below to edit.' : ' \u2014 this scorecard is locked.')));
    else if (!canEdit) modal.append(
      el('div', { class: 'rounded-lg border px-3 py-2 text-[11px] mb-4', style: { borderColor: 'var(--border-2)', background: 'var(--card-2)', color: 'var(--text-muted)' } },
        'Read-only \u2014 scores on this card are entered by your team lead or an admin.'));

    // ── Composite headline (big number + per-metric stacked bar)
    modal.append(
      el('div', {
        class: 'rounded-lg border p-4 mb-5',
        style: { borderColor: band.color, background: band.bg },
      },
        el('div', { class: 'flex items-baseline gap-3 flex-wrap' },
          el('div', { class: 'text-4xl font-black tabular-nums', style: { color: band.color, lineHeight: '1' } },
            score.coverage > 0 ? fmtScore(score.final) : '—'),
          el('div', { class: 'text-xs font-bold uppercase tracking-widest', style: { color: band.color } }, band.label),
          el('div', { class: 'text-[11px] text-muted- ml-auto' },
            score.coverage > 0
              ? Math.round(score.coverage * 100) + '% of template filled'
              : 'Fill in metrics below to compute a score'),
        ),
      ),
    );

    // ── Manual metric inputs
    const metricSection = el('div', { class: 'mb-5' },
      el('h3', { class: 'text-xs font-bold uppercase tracking-widest text-muted- mb-3' }, 'Performance Metrics'),
      ...tpl.metrics.filter(m => m.source === 'manual').map(m => {
        const manual = draft.metrics[m.id];
        const auto = (typeof scorecardAutoMetric === 'function') ? scorecardAutoMetric(profileId, m.id, period) : null;
        const v = Number.isFinite(manual) ? manual : (auto != null ? auto : NaN);
        const b = scorecardBand(v);
        const has = Number.isFinite(v);
        const isAuto = !Number.isFinite(manual) && auto != null;
        const contribution = has ? v * m.weight : 0;
        return el('div', { class: 'flex items-center gap-3 mb-2.5' },
          el('div', { class: 'flex-1 min-w-0' },
            el('div', { class: 'text-xs font-semibold' }, m.label),
            el('div', { class: 'text-[10px] text-muted-' },
              'Weight ' + Math.round(m.weight * 100) + '%'
                + (has ? ' · contributes ' + contribution.toFixed(1) + ' pts' : '')
                + (isAuto ? ' · from graded calls (type a value to override)' : '')),
          ),
          el('input', {
            type: 'number', min: '0', max: '100', step: '0.1',
            disabled: canEditNow ? null : true,
            placeholder: isAuto ? String(auto) : '0–100',
            value: Number.isFinite(manual) ? String(manual) : '',
            class: 'rounded-lg border px-2.5 py-1 text-[11px] tabular-nums text-right',
            style: { borderColor: 'var(--border-2)', width: '90px' },
            oninput: (e) => {
              const num = e.target.value === '' ? null : Number(e.target.value);
              if (num == null) delete draft.metrics[m.id];
              else draft.metrics[m.id] = num;
              upsertCard(profileId, { metrics: draft.metrics });
              render();
            },
          }),
          el('div', {
            class: 'text-[10px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded shrink-0',
            style: has
              ? { background: b.bg, color: b.color, minWidth: '70px', textAlign: 'center' }
              : { background: 'var(--card-2)', color: 'var(--text-muted)', minWidth: '70px', textAlign: 'center' },
          }, has ? b.label : '—'),
        );
      }),
    );
    modal.append(metricSection);

    // ── Attendance Calculator
    const attTpl = tpl.attendance;
    const attScore = computeAttendanceScore(draft.attendance, attTpl, period);
    const attBand  = scorecardBand(attScore);
    const attMetric = tpl.metrics.find(m => m.source === 'attendance');
    const attWeight = attMetric ? attMetric.weight : 0;
    const attContribution = attScore * attWeight;
    // Working days: explicit override > Mon–Sat count for the period >
    // template fallback. We surface BOTH numbers in the input row so
    // the user sees the auto-calculated value and can override it.
    const workingDays = resolveWorkingDays(draft.attendance, attTpl, period);
    const autoWorkingDays = workingDaysForPeriod(period);
    const usingOverride = draft.attendance.workingDays != null
      && draft.attendance.workingDays !== '' && draft.attendance.workingDays !== autoWorkingDays;
    // Show the live deduction breakdown so the manager can see exactly
    // where the score is coming from (e.g. "−4.5% tardy + −10% call out").
    const deductionParts = (attTpl.penalties || []).reduce((acc, p) => {
      const n = Number(draft.attendance[p.id] || 0);
      if (!n) return acc;
      const ded = p.unit === 'percent'
        ? n * Number(p.weight || 0)
        : (n * Number(p.weightDays || 0)) / workingDays * 100;
      if (ded > 0) acc.push({ label: p.label, ded });
      return acc;
    }, []);
    const totalDeduction = deductionParts.reduce((s, x) => s + x.ded, 0);
    const breakdownLabel = totalDeduction > 0
      ? '−' + totalDeduction.toFixed(1) + '% · ' + attContribution.toFixed(1) + ' pts'
      : attContribution.toFixed(1) + ' pts (no deductions)';

    const attSection = el('div', { class: 'mb-5 rounded-lg border p-4', style: { borderColor: 'var(--border)', background: 'var(--card-2)' } },
      el('div', { class: 'flex items-center justify-between mb-3' },
        el('div', {},
          el('h3', { class: 'text-xs font-bold uppercase tracking-widest text-muted-' }, 'Attendance Calculator'),
          el('div', { class: 'text-[10px] text-muted- mt-0.5' },
            attMetric ? attMetric.label + ' · Weight ' + Math.round(attWeight * 100) + '%' : 'Not in template'),
        ),
        el('div', { class: 'text-right' },
          el('div', { class: 'text-2xl font-black tabular-nums', style: { color: attBand.color, lineHeight: '1' } },
            fmtScore(attScore, 1)),
          el('div', { class: 'text-[10px] text-muted- mt-0.5 tabular-nums' }, breakdownLabel),
        ),
      ),
      el('div', { class: 'flex items-center gap-3 mb-2.5' },
        el('div', { class: 'flex-1' },
          el('label', { class: 'text-xs font-semibold' }, 'Working Days in Period'),
          el('div', { class: 'text-[10px] text-muted- mt-0.5' },
            usingOverride
              ? 'Override · ' + autoWorkingDays + ' auto-calculated (Mon–Sat in ' + periodLabel + ')'
              : 'Auto-calculated from ' + periodLabel + ' (Mon–Sat)'),
        ),
        el('input', {
          type: 'number', min: '1', step: '1',
          disabled: canEditNow ? null : true,
          value: String(workingDays),
          placeholder: String(autoWorkingDays || ''),
          class: 'rounded-lg border px-2.5 py-1 text-[11px] tabular-nums text-right',
          style: { borderColor: 'var(--border-2)', width: '90px' },
          oninput: (e) => {
            const raw = e.target.value;
            // Empty input → clear the override so we fall back to the
            // dynamic Mon–Sat count for this period.
            if (raw === '') {
              delete draft.attendance.workingDays;
            } else {
              const n = Number(raw) || 0;
              draft.attendance.workingDays = n;
            }
            upsertCard(profileId, { attendance: draft.attendance });
            render();
          },
        }),
      ),
      ...attTpl.penalties.map(p => {
        const n = Number(draft.attendance[p.id] || 0);
        // Build the "each" hint based on the penalty's unit. Days-unit
        // penalties express as "1 day each (~4.5% on 22 days)" so the
        // manager sees the real impact on this month's denominator;
        // percent-unit penalties stay flat.
        let hint, runningDeduction;
        if (p.unit === 'percent') {
          const w = Number(p.weight || 0);
          hint = '−' + w + '% each';
          runningDeduction = n * w;
        } else {
          const d = Number(p.weightDays || 0);
          const pctEach = workingDays > 0 ? (d / workingDays) * 100 : 0;
          hint = '−' + d + ' day' + (d === 1 ? '' : 's') + ' each (~' + pctEach.toFixed(1) + '% on ' + workingDays + ' working days)';
          runningDeduction = (n * d) / Math.max(1, workingDays) * 100;
        }
        return el('div', { class: 'flex items-center gap-3 mb-2' },
          el('div', { class: 'flex-1 min-w-0' },
            el('div', { class: 'text-xs font-semibold' }, '# ' + p.label),
            el('div', { class: 'text-[10px] text-muted-' },
              hint + (n > 0 ? ' · −' + runningDeduction.toFixed(1) + '%' : '')),
          ),
          el('input', {
            type: 'number', min: '0', step: '1',
            disabled: canEditNow ? null : true,
            value: String(n),
            class: 'rounded-lg border px-2.5 py-1 text-[11px] tabular-nums text-right',
            style: { borderColor: 'var(--border-2)', width: '90px' },
            oninput: (e) => {
              const v = Number(e.target.value) || 0;
              draft.attendance[p.id] = v;
              upsertCard(profileId, { attendance: draft.attendance });
              render();
            },
          }),
        );
      }),
    );
    modal.append(attSection);

    // ── Call Audits (per Isaac) — rubric-graded QA replaces the 0/1 sheet.
    (() => {
      const _dept = scorecardDeptOf(profile);
      const _ak = profileId + '|' + period;
      const _audits = (state._scorecardAudits || {})[_ak] || [];
      const _roll = callAuditRollup(profileId, period);
      const scoreBadge = (lab, v) => el('span', { class: 'text-[10px] font-bold tabular-nums px-1.5 py-0.5 rounded shrink-0', style: { background: 'var(--card-2)', color: Number.isFinite(Number(v)) ? 'var(--text)' : 'var(--text-muted)' } },
        lab + ' ' + (Number.isFinite(Number(v)) ? Math.round(Number(v)) + '%' : '—'));
      const auditRow = (a) => el('div', { class: 'border-t py-1.5', style: { borderColor: 'var(--border)' } },
        el('div', { class: 'flex items-center gap-2' },
          el('div', { class: 'text-[11px] tabular-nums text-muted- shrink-0' }, String(a.call_date || '').slice(5, 10) || '—'),
          el('div', { class: 'text-xs font-semibold truncate flex-1 min-w-0' }, (a.call_type || 'Call') + (a.outcome ? ' · ' + a.outcome : '')),
          a.flagged ? el('span', { class: 'text-[11px] font-bold shrink-0', style: { color: '#DC2626' }, title: 'Compliance flag' }, '⚑') : null,
          scoreBadge('Call', a.call_score), scoreBadge('Acc', a.accuracy_score),
          canEditNow ? el('button', { class: 'text-sm text-muted- shrink-0', title: 'Delete this audit', style: { background: 'transparent', border: 'none', cursor: 'pointer' }, onclick: () => { deleteCallAuditRow(a); render(); } }, '×') : null),
        a.notes ? el('div', { class: 'text-[10px] text-muted- mt-0.5', style: { paddingLeft: '40px' } }, a.notes) : null);
      modal.append(el('div', { class: 'mb-5' },
        el('div', { class: 'flex items-center justify-between mb-2' },
          el('h3', { class: 'text-xs font-bold uppercase tracking-widest text-muted-' }, 'Call Audits' + (_audits.length ? ' · ' + _audits.length : '')),
          canEditNow ? el('button', {
            class: 'rounded-lg px-2.5 py-1 text-[11px] font-bold',
            style: { background: 'var(--accent)', color: 'var(--accent-text)', border: 'none', cursor: 'pointer' },
            onclick: () => openCallAuditModal(profile, period, _dept, () => render()),
          }, '+ Audit a call') : null),
        _audits.length
          ? el('div', {}, ..._audits.map(auditRow))
          : el('div', { class: 'text-[11px] text-muted-' }, 'No calls audited for this month yet.' + (canEditNow ? ' Grade a few — they roll up into the Audit and Accuracy scores.' : '')),
        _roll.n ? el('div', { class: 'flex items-center justify-between gap-2 mt-2 rounded-lg border px-3 py-2', style: { borderColor: 'var(--border-2)', background: 'var(--card-2)' } },
          el('div', { class: 'text-[11px]' },
            el('span', { class: 'font-bold' }, 'Rollup from ' + _roll.n + ' call' + (_roll.n === 1 ? '' : 's') + ': '),
            'Audit ' + (_roll.call == null ? '—' : _roll.call.toFixed(1) + '%') + ' · Accuracy ' + (_roll.accuracy == null ? '—' : _roll.accuracy.toFixed(1) + '%')
            + (_roll.flags ? ' · ' : ''),
            _roll.flags ? el('span', { style: { color: '#DC2626', fontWeight: '700' } }, _roll.flags + ' flagged') : null),
          canEditNow ? el('button', {
            class: 'rounded-lg border px-2.5 py-1 text-[11px] font-bold shrink-0',
            style: { borderColor: 'var(--accent)', color: 'var(--accent)', background: 'transparent', cursor: 'pointer' },
            title: 'Write the call rollup into the Audit Score and Accuracy Score metrics above',
            onclick: () => {
              if (_roll.call != null) draft.metrics.audit = Number(_roll.call.toFixed(1));
              if (_roll.accuracy != null) draft.metrics.accuracy = Number(_roll.accuracy.toFixed(1));
              upsertCard(profileId, { metrics: draft.metrics });
              render();
            },
          }, 'Apply to metrics →') : null) : null));
    })();

    // ── Coaching notes
    modal.append(
      el('div', { class: 'mb-4' },
        el('h3', { class: 'text-xs font-bold uppercase tracking-widest text-muted- mb-2' }, 'Coaching Notes'),
        el('textarea', {
          rows: 4,
          readonly: canEditNow ? null : true,
          placeholder: 'What went well, where to focus, action items for next month…',
          class: 'w-full rounded-lg border px-3 py-2 text-sm',
          style: { borderColor: 'var(--border-2)', resize: 'vertical', fontFamily: 'inherit' },
          oninput: (e) => {
            draft.notes = e.target.value;
            upsertCard(profileId, { notes: draft.notes });
          },
        }, draft.notes || ''),
      ),
    );

    // ── Footer — stamps on the left, actions on the right.
    const _me = (state.profile && state.profile.full_name) || 'Admin';
    const _today = new Date().toISOString().slice(0, 10);
    modal.append(
      el('div', { class: 'flex items-center justify-between gap-2 flex-wrap' },
        el('div', { class: 'flex items-center gap-2 flex-wrap' },
          // Reviewed-with-agent stamp (per Isaac): proof the 1:1 happened.
          // Stampable even on a locked card (reviews often happen AFTER
          // finalizing); click again to clear a mis-stamp.
          canEdit ? el('button', {
            class: 'rounded-lg px-2.5 py-1 text-[11px] font-semibold border transition hover:brightness-95',
            style: draft.reviewed
              ? { borderColor: '#DF643A', color: '#DF643A', background: 'rgba(223,100,58,.08)' }
              : { borderColor: 'var(--border-2)', color: 'var(--text)' },
            title: draft.reviewed
              ? 'Reviewed with the agent on ' + fmt.dateShort(draft.reviewed.on) + (draft.reviewed.by ? ' by ' + draft.reviewed.by : '') + ' \u2014 click to clear'
              : 'Stamp that this scorecard was reviewed 1-on-1 with the agent',
            onclick: () => {
              draft.reviewed = draft.reviewed ? null : { on: _today, by: _me };
              upsertCard(profileId, { reviewed: draft.reviewed });
              render();
            },
          }, draft.reviewed ? '\u2713 Reviewed ' + fmt.dateShort(draft.reviewed.on) : '\u2713 Reviewed with agent')
          : (draft.reviewed ? el('span', { class: 'text-[11px] font-semibold', style: { color: '#DF643A' } },
              '\u2713 Reviewed ' + fmt.dateShort(draft.reviewed.on)) : null),
          canEdit && !locked ? el('button', {
            class: 'rounded-lg px-2.5 py-1 text-[11px] font-bold border transition hover:brightness-95',
            style: { borderColor: 'var(--accent)', color: 'var(--accent)' },
            title: 'Lock this scorecard \u2014 no more edits unless an admin unlocks it',
            onclick: () => {
              if (!confirm('Finalize ' + name + '\'s ' + periodLabel + ' scorecard? It locks for everyone (an admin can unlock).')) return;
              draft.finalized = { on: _today, by: _me };
              upsertCard(profileId, { finalized: draft.finalized });
              render();
            },
          }, '\ud83d\udd12 Finalize & Lock') : null,
          locked && _isAdminHere ? el('button', {
            class: 'rounded-lg px-2.5 py-1 text-[11px] font-semibold border transition hover:brightness-95',
            style: { borderColor: 'var(--border-2)', color: 'var(--text-muted)' },
            title: 'Admin only \u2014 reopen this scorecard for edits',
            onclick: () => {
              if (!confirm('Unlock ' + name + '\'s ' + periodLabel + ' scorecard for edits?')) return;
              draft.finalized = null;
              upsertCard(profileId, { finalized: null });
              render();
            },
          }, 'Unlock') : null,
        ),
        el('div', { class: 'flex gap-2' },
          canEditNow ? el('button', {
            class: 'rounded-lg px-2.5 py-1 text-[11px] font-semibold border',
            style: { borderColor: '#DC2626', color: '#DC2626' },
            title: 'Clear all entries for this agent + period',
            onclick: () => {
              if (!confirm('Clear ' + name + '\'s scorecard for ' + periodLabel + '?')) return;
              delete state._scorecardData[cardKey];
              saveDemoData();
              close();
            },
          }, 'Clear Scorecard') : null,
          el('button', {
            class: 'rounded-lg px-2.5 py-1 text-[11px] font-bold',
            style: { background: 'var(--accent)', color: 'var(--accent-text)' },
            onclick: close,
          }, 'Done'),
        ),
      ),
    );
  };

  render();
  document.body.append(overlay);
}

// Template editor — edit metric weights + attendance penalty weights.
// Phase-1 single-template editor; Phase-2 would extend to multi-template.
// ════════════════════════════════════════════════════════════════════════
// SCORECARDS — 1:1 MEETING LOG (per Isaac, Sep 2026)
// Team leads meet every agent twice a month: the first is the performance
// / metric review (start of month), the second is coaching — training and
// what to actively work on. Each meeting is logged against the agent, open
// action items carry forward into the next one, and the timeline reads as
// a story: what was asked, what changed, what the scorecard did next.
// Table: public.scorecard_meetings (scorecard_meetings.sql).
// ════════════════════════════════════════════════════════════════════════
const MEETING_KINDS = {
  review:   { label: 'Performance review', short: 'Review',   color: '#DF643A', desc: 'Start of month — scorecard + metric review' },
  coaching: { label: 'Coaching session',   short: 'Coaching', color: '#1F6F84', desc: 'Mid-month review — training + what to actively work on' },
};
const MEETING_CADENCE_DAYS = 14;
function _mtgAll() { return Array.isArray(state._scorecardMeetings) ? state._scorecardMeetings : (state._scorecardMeetings = []); }
function meetingsFor(profileId) {
  return _mtgAll().filter(m => m.profile_id === profileId)
    .sort((a, b) => String(b.meeting_date || '').localeCompare(String(a.meeting_date || '')) || String(b.created_at || '').localeCompare(String(a.created_at || '')));
}
async function loadScorecardMeetingsCloud(force) {
  if (typeof DEMO !== 'undefined' && DEMO) return;
  if (typeof supabase === 'undefined' || !supabase) return;
  if (state._scorecardMeetingsLoaded && !force) return;
  state._scorecardMeetingsLoaded = true;
  try {
    const { data, error } = await supabase.from('scorecard_meetings').select('*').order('meeting_date', { ascending: false });
    if (error) { if (/scorecard_meetings/i.test(error.message || '')) state._scorecardMeetingsMissing = true; else console.warn('meetings load', error); return; }
    state._scorecardMeetings = data || [];
    state._scorecardMeetingsMissing = false;
    if (state.view === 'scorecards') mountApp();
  } catch (e) { console.warn('meetings load failed', e); }
}
async function saveScorecardMeeting(m) {
  const all = _mtgAll();
  const local = (row) => { const i = all.findIndex(x => x.id === row.id); if (i >= 0) all[i] = row; else all.unshift(row); saveDemoData(); };
  if ((typeof DEMO !== 'undefined' && DEMO) || state._scorecardMeetingsMissing || typeof supabase === 'undefined' || !supabase) {
    local({ ...m, id: m.id || ('local-' + Date.now()), created_at: m.created_at || new Date().toISOString() });
    return true;
  }
  const payload = { ...m, updated_at: new Date().toISOString() };
  if (!payload.id) delete payload.id;
  const { data, error } = await supabase.from('scorecard_meetings').upsert(payload).select().single();
  if (error) { toast('Meeting save failed: ' + error.message, 'error'); return false; }
  local(data);
  return true;
}
async function deleteScorecardMeeting(id) {
  const all = _mtgAll();
  const i = all.findIndex(x => x.id === id); if (i >= 0) all.splice(i, 1);
  saveDemoData();
  if ((typeof DEMO !== 'undefined' && DEMO) || String(id).startsWith('local-') || typeof supabase === 'undefined' || !supabase) return;
  const { error } = await supabase.from('scorecard_meetings').delete().eq('id', id);
  if (error) toast('Delete failed: ' + error.message, 'error');
}
const _mtgIso = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const _mtgDays = (iso) => iso ? Math.floor((Date.now() - new Date(String(iso).slice(0, 10) + 'T12:00').getTime()) / 86400000) : null;
const _mtgFmt = (iso) => iso ? new Date(String(iso).slice(0, 10) + 'T12:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
// Cadence status for an agent: last meeting, days since, what's due.
function meetingCadence(profileId) {
  const ms = meetingsFor(profileId);
  const last = ms[0] || null;
  const days = last ? _mtgDays(last.meeting_date) : null;
  const ym = _mtgIso(new Date()).slice(0, 7);
  const reviewThisMonth = ms.some(m => m.kind === 'review' && String(m.period || m.meeting_date || '').slice(0, 7) === ym);
  const coachingThisMonth = ms.some(m => m.kind === 'coaching' && String(m.period || m.meeting_date || '').slice(0, 7) === ym);
  const dayOfMonth = new Date().getDate();
  let status, color, label;
  if (!last) { status = 'never'; color = '#DC2626'; label = 'No 1:1 logged'; }
  else if (days > MEETING_CADENCE_DAYS) { status = 'overdue'; color = '#DC2626'; label = days + 'd since last 1:1 — overdue'; }
  else if (!reviewThisMonth && dayOfMonth > 10) { status = 'review_due'; color = '#A9441F'; label = 'Monthly review not logged'; }
  else { status = 'ok'; color = '#5F6C5B'; label = 'Last 1:1 ' + days + 'd ago'; }
  const openItems = ms.length ? (ms[0].action_items || []).filter(a => a && !a.done).length : 0;
  return { last, days, status, color, label, reviewThisMonth, coachingThisMonth, openItems, count: ms.length, nextKind: reviewThisMonth ? 'coaching' : 'review' };
}
// Plain-English insights built from the meeting history + scorecards.
function meetingInsights(profile, tpl) {
  const ms = meetingsFor(profile.id).slice().reverse();   // oldest → newest
  const out = [];
  if (!ms.length) return ['No meetings logged yet — the story starts with the first one.'];
  const scoreFor = (period) => { const c = (state._scorecardData || {})[profile.id + '|' + period]; const s = c ? computeScorecardScore(c, tpl, period, profile.id) : null; return (s && s.coverage > 0) ? s.final : null; };
  const periods = [...new Set(ms.map(m => String(m.period || m.meeting_date || '').slice(0, 7)))].filter(Boolean).sort();
  const scored = periods.map(p => ({ p, s: scoreFor(p) })).filter(x => x.s != null);
  if (scored.length >= 2) {
    const a = scored[0].s, b = scored[scored.length - 1].s, d = b - a;
    out.push('Composite ' + (d >= 0 ? 'up' : 'down') + ' ' + Math.abs(d).toFixed(1) + ' pts across ' + scored.length + ' reviewed months (' + a.toFixed(0) + '% → ' + b.toFixed(0) + '%)' + (d >= 5 ? ' — the coaching is landing.' : d <= -5 ? ' — worth a harder look at what changed.' : '.'));
    let streak = 0; for (let i = scored.length - 1; i > 0 && scored[i].s >= scored[i - 1].s; i--) streak++;
    if (streak >= 2) out.push(streak + ' straight months of improvement.');
  }
  const gaps = []; for (let i = 1; i < ms.length; i++) { const g = (new Date(ms[i].meeting_date) - new Date(ms[i - 1].meeting_date)) / 86400000; if (g > 0) gaps.push(g); }
  if (gaps.length) { const avg = gaps.reduce((a, b) => a + b, 0) / gaps.length; out.push('Meeting every ' + Math.round(avg) + ' days on average' + (avg > MEETING_CADENCE_DAYS + 4 ? ' — behind the 2-week cadence.' : ' — on cadence.')); }
  let asked = 0, done = 0, carriedTwice = 0;
  ms.forEach(m => (m.action_items || []).forEach(a => { asked++; if (a.done) done++; if (a.carried_from && a.carried_count >= 2) carriedTwice++; }));
  if (asked) out.push(done + ' of ' + asked + ' action items closed (' + Math.round(done / asked * 100) + '%)' + (carriedTwice ? ' · ' + carriedTwice + ' item' + (carriedTwice === 1 ? '' : 's') + ' carried 2+ meetings — stuck.' : '.'));
  const fc = new Map(); ms.forEach(m => (m.focus || []).forEach(f => { const k = String(f).trim(); if (k) fc.set(k, (fc.get(k) || 0) + 1); }));
  const rec = [...fc.entries()].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).slice(0, 3);
  if (rec.length) out.push('Keeps coming up: ' + rec.map(([k, n]) => k + ' (' + n + '×)').join(', ') + '.');
  const lastM = ms[ms.length - 1];
  if (lastM && lastM.kind === 'coaching' && (lastM.focus || []).length) out.push('Currently working on: ' + lastM.focus.join(', ') + '.');
  return out;
}

function openMeetingLogModal(profile, dept, tpl, canEdit) {
  const overlay = el('div', { class: 'modal-overlay' });
  const _escClose = (e) => { if (e.key === 'Escape' || !overlay.isConnected) { overlay.remove(); document.removeEventListener('keydown', _escClose); } };
  document.addEventListener('keydown', _escClose);
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  const modal = el('div', { class: 'card w-full max-w-3xl p-6 my-8 overflow-y-auto', style: { maxHeight: 'calc(100vh - 64px)' } });
  overlay.append(modal);
  let editing = null;

  const scoreFor = (period) => { const c = (state._scorecardData || {})[profile.id + '|' + period]; const s = c ? computeScorecardScore(c, tpl, period, profile.id) : null; return (s && s.coverage > 0) ? s : null; };
  const chip = (kind) => { const k = MEETING_KINDS[kind] || MEETING_KINDS.coaching; return el('span', { class: 'rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider', style: { background: k.color + '22', color: k.color } }, k.short); };

  const startNew = (kind) => {
    const ms = meetingsFor(profile.id);
    const prev = ms[0];
    const carried = prev ? (prev.action_items || []).filter(a => a && !a.done).map(a => ({ text: a.text, done: false, carried_from: prev.meeting_date, carried_count: (a.carried_count || 0) + 1 })) : [];
    const today = _mtgIso(new Date());
    editing = { profile_id: profile.id, dept, period: today.slice(0, 7), kind, meeting_date: today,
      lead_id: state.profile?.id || null, lead_name: state.profile?.full_name || '', notes: '', wins: '', focus: [], action_items: carried };
    render();
  };

  const form = () => {
    const m = editing;
    const inp = (key, ph, rows) => el(rows ? 'textarea' : 'input', Object.assign({
      class: 'w-full rounded-lg border px-2.5 py-1.5 text-xs', style: { borderColor: 'var(--border-2)', background: 'var(--card)' },
      placeholder: ph, value: m[key] || '', oninput: (e) => { m[key] = e.target.value; },
    }, rows ? { rows } : { type: 'text' }));
    const focusSuggest = [...new Set([...(tpl.metrics || []).map(x => x.label), ...meetingsFor(profile.id).flatMap(x => x.focus || [])])];
    const focusBox = el('div', { class: 'flex flex-wrap gap-1.5 items-center' });
    const drawFocus = () => {
      focusBox.innerHTML = '';
      (m.focus || []).forEach((f, i) => focusBox.append(el('span', { class: 'rounded-full px-2 py-0.5 text-[10px] font-semibold flex items-center gap-1', style: { background: 'rgba(223,100,58,.12)', color: '#DF643A' } }, f,
        el('button', { class: 'text-[11px] leading-none', onclick: () => { m.focus.splice(i, 1); drawFocus(); } }, '×'))));
      focusSuggest.filter(s => !(m.focus || []).includes(s)).slice(0, 8).forEach(s => focusBox.append(el('button', {
        class: 'rounded-full px-2 py-0.5 text-[10px] border', style: { borderColor: 'var(--border-2)', color: 'var(--text-muted)' },
        onclick: () => { (m.focus = m.focus || []).push(s); drawFocus(); } }, '+ ' + s)));
      focusBox.append(el('input', { type: 'text', placeholder: 'Add focus…', class: 'rounded-full border px-2 py-0.5 text-[10px]', style: { borderColor: 'var(--border-2)', width: '110px' },
        onkeydown: (e) => { if (e.key === 'Enter' && e.target.value.trim()) { e.preventDefault(); (m.focus = m.focus || []).push(e.target.value.trim()); drawFocus(); } } }));
    };
    drawFocus();
    const itemsBox = el('div', { class: 'flex flex-col gap-1.5' });
    const drawItems = () => {
      itemsBox.innerHTML = '';
      (m.action_items || []).forEach((a, i) => itemsBox.append(el('div', { class: 'flex items-center gap-2' },
        el('input', { type: 'checkbox', checked: !!a.done, style: { accentColor: 'var(--accent)' }, onchange: (e) => { a.done = e.target.checked; } }),
        el('input', { type: 'text', value: a.text || '', class: 'flex-1 rounded-lg border px-2.5 py-1 text-xs', style: { borderColor: 'var(--border-2)' }, oninput: (e) => { a.text = e.target.value; } }),
        a.carried_from ? el('span', { class: 'text-[9px] uppercase tracking-wider font-bold whitespace-nowrap', style: { color: '#A9441F' }, title: 'Open item carried from the ' + _mtgFmt(a.carried_from) + ' meeting' }, 'carried' + (a.carried_count >= 2 ? ' ×' + a.carried_count : '')) : null,
        el('button', { class: 'text-xs text-muted-', onclick: () => { m.action_items.splice(i, 1); drawItems(); } }, '×'))));
      itemsBox.append(el('button', { class: 'self-start text-[11px] font-semibold', style: { color: 'var(--accent)' }, onclick: () => { (m.action_items = m.action_items || []).push({ text: '', done: false }); drawItems(); setTimeout(() => { const t = itemsBox.querySelectorAll('input[type=text]'); if (t.length) t[t.length - 1].focus(); }, 0); } }, '+ Action item'));
    };
    drawItems();
    // ── Performance review: the SCORE lives here (per Isaac). Period
    // defaults to the meeting's month; any prior / future month can be
    // picked. Inputs write straight to that month's scorecard.
    const reviewBlock = () => {
      if (m.kind !== 'review') return null;
      const now = new Date();
      const opts = [];
      for (let i = -12; i <= 2; i++) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        opts.push({ key: d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'), label: d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) });
      }
      if (!opts.some(o => o.key === m.period)) opts.push({ key: m.period, label: m.period });
      opts.sort((a, b) => b.key.localeCompare(a.key));
      const card = (state._scorecardData || {})[profile.id + '|' + m.period] || { metrics: {}, attendance: {} };
      const sc = computeScorecardScore(card, tpl, m.period, profile.id);
      const band = scorecardBand(sc && sc.coverage > 0 ? sc.final : null);
      const host = el('div', { class: 'rounded-lg border p-3 flex flex-col gap-2', style: { borderColor: 'var(--border)', background: 'var(--card)' } });
      const head = el('div', { class: 'flex items-center gap-2 flex-wrap' },
        el('span', { class: 'text-[10px] uppercase tracking-widest text-muted- font-semibold' }, 'Scorecard for'),
        el('select', { class: 'rounded-lg border px-2.5 py-1 text-[11px] cursor-pointer font-semibold', style: { borderColor: 'var(--border-2)' },
          onchange: (e) => { m.period = e.target.value; render(); } },
          ...opts.map(o => el('option', { value: o.key, selected: o.key === m.period }, o.label))),
        el('span', { class: 'ml-auto text-lg font-black tabular-nums', style: { color: band.color } }, sc && sc.coverage > 0 ? fmtScore(sc.final) : '—'),
        sc && sc.coverage > 0 && sc.coverage < 0.999 ? el('span', { class: 'text-[10px] text-muted-' }, Math.round(sc.coverage * 100) + '% filled') : null,
        el('span', { class: 'text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded', style: { background: band.bg, color: band.color } }, sc && sc.coverage > 0 ? band.label : 'not scored'));
      host.append(head);
      const rowsBox = el('div', { class: 'flex flex-col gap-1.5' });
      (tpl.metrics || []).filter(x => x.source === 'manual').forEach(x => {
        const v = card.metrics ? card.metrics[x.id] : undefined;
        rowsBox.append(el('div', { class: 'flex items-center gap-2' },
          el('span', { class: 'flex-1 text-xs font-semibold' }, x.label),
          el('span', { class: 'text-[11px] text-muted- tabular-nums', style: { width: '36px', textAlign: 'right' }, title: 'Weight' }, Math.round(x.weight * 100) + '%'),
          el('input', { type: 'number', min: '0', max: '100', step: '0.1', placeholder: '0–100', value: Number.isFinite(v) ? String(v) : '',
            class: 'rounded-lg border px-2.5 py-1 text-[11px] tabular-nums', style: { borderColor: 'var(--border-2)', width: '84px' },
            onchange: (e) => { const n = e.target.value === '' ? null : Number(e.target.value); const mm = { ...(card.metrics || {}) }; if (n == null) delete mm[x.id]; else mm[x.id] = n; scorecardUpsertCard(profile.id, m.period, { metrics: mm }); render(); } })));
      });
      const att = tpl.attendance || {};
      if ((att.penalties || []).length) {
        const attScore = computeAttendanceScore(card.attendance || {}, att, m.period);
        const attW = ((tpl.metrics || []).find(x => x.source === 'attendance') || {}).weight;
        rowsBox.append(el('div', { class: 'flex items-center gap-2 mt-1' },
          el('span', { class: 'flex-1 text-xs font-semibold' }, 'Attendance Score', el('span', { class: 'text-[10px] text-muted- font-normal ml-1' }, 'auto from the counts below')),
          attW != null ? el('span', { class: 'text-[11px] text-muted- tabular-nums', style: { width: '36px', textAlign: 'right' }, title: 'Weight' }, Math.round(attW * 100) + '%') : null,
          el('span', { class: 'text-[11px] font-bold tabular-nums text-right', style: { width: '84px', color: scorecardBand(attScore).color } }, fmtScore(attScore, 1))));
        (att.penalties || []).forEach(pn => {
          const v = card.attendance ? card.attendance[pn.id] : undefined;
          rowsBox.append(el('div', { class: 'flex items-center gap-2' },
            el('span', { class: 'flex-1 text-xs' }, pn.label),
            el('input', { type: 'number', min: '0', step: '1', placeholder: '0', value: Number.isFinite(Number(v)) && v !== '' && v != null ? String(v) : '',
              class: 'rounded-lg border px-2.5 py-1 text-[11px] tabular-nums', style: { borderColor: 'var(--border-2)', width: '84px' },
              onchange: (e) => { const a2 = { ...(card.attendance || {}) }; a2[pn.id] = e.target.value === '' ? 0 : Number(e.target.value); scorecardUpsertCard(profile.id, m.period, { attendance: a2 }); render(); } })));
        });
      }
      host.append(rowsBox);
      host.append(el('button', { class: 'self-start text-[11px] font-semibold', style: { color: 'var(--accent)' },
        onclick: () => openScorecardDetailModal(profile, m.period, tpl, (pid, patch) => scorecardUpsertCard(pid, m.period, patch), canEdit) }, 'Full scorecard (audits, notes) →'));
      return host;
    };
    const k = MEETING_KINDS[m.kind];
    return el('div', { class: 'card p-4 flex flex-col gap-3', style: { borderLeft: '4px solid ' + k.color, background: 'var(--card-2)' } },
      el('div', { class: 'flex items-center gap-2 flex-wrap' },
        el('div', { class: 'inline-flex rounded-lg border overflow-hidden', style: { borderColor: 'var(--border-2)' } },
          ...Object.entries(MEETING_KINDS).map(([kk, kv]) => el('button', { class: 'px-2.5 py-1 text-[11px] font-bold', style: m.kind === kk ? { background: kv.color, color: '#fff' } : { color: 'var(--text-muted)' }, onclick: () => { m.kind = kk; render(); } }, kv.short))),
        // Player card (per Isaac): the same Indicators card the dashboards
        // open — sales, records, calendar, trends — right from the 1:1.
        el('button', { class: 'rounded-lg border px-2.5 py-1 text-[11px] font-bold', style: { color: 'var(--text)', borderColor: 'var(--border-2)' },
          title: 'Open ' + (profile.full_name || 'this rep') + '\u2019s player card',
          onclick: () => openDashboardPlayerCard(profile.id) }, 'Player card'),
        el('input', { type: 'date', value: m.meeting_date, class: 'rounded-lg border px-2.5 py-1 text-[11px]', style: { borderColor: 'var(--border-2)' }, onchange: (e) => { m.meeting_date = e.target.value; m.period = String(e.target.value).slice(0, 7); } }),
        el('span', { class: 'text-[11px] text-muted-' }, k.desc)),
      reviewBlock(),
      el('div', {}, el('div', { class: 'text-[10px] uppercase tracking-widest text-muted- font-semibold mb-1' }, m.kind === 'review' ? 'Metric review — what the numbers said and why' : 'What we worked on'), inp('notes', m.kind === 'review' ? 'Where they landed vs the template, what drove it, what we agreed to change…' : 'Training covered, role-plays, calls reviewed, what to practise…', 4)),
      el('div', {}, el('div', { class: 'text-[10px] uppercase tracking-widest text-muted- font-semibold mb-1' }, 'Wins since last time'), inp('wins', 'What improved, what they nailed…', 2)),
      el('div', {}, el('div', { class: 'text-[10px] uppercase tracking-widest text-muted- font-semibold mb-1' }, 'Focus areas'), focusBox),
      el('div', {}, el('div', { class: 'text-[10px] uppercase tracking-widest text-muted- font-semibold mb-1' }, 'Action items — open ones carry into the next meeting'), itemsBox),
      el('div', { class: 'flex items-center gap-2 pt-1' },
        el('button', { class: 'rounded-lg px-2.5 py-1 text-[11px] font-bold', style: { background: 'var(--accent)', color: 'var(--accent-text)' },
          onclick: async () => {
            if (!m.meeting_date) { toast('Pick a date', 'warn'); return; }
            m.action_items = (m.action_items || []).filter(a => a && String(a.text || '').trim());
            const sc = scoreFor(m.period); m.score_snapshot = sc ? sc.final : null;
            if (await saveScorecardMeeting(m)) { editing = null; toast('Meeting logged', 'success'); render(); if (state.view === 'scorecards') mountApp(); }
          } }, m.id ? 'Save changes' : 'Log meeting'),
        el('button', { class: 'rounded-lg px-2.5 py-1 text-[11px] font-semibold border', style: { borderColor: 'var(--border-2)', color: 'var(--text-muted)' }, onclick: () => { editing = null; render(); } }, 'Cancel')));
  };

  const timeline = () => {
    const ms = meetingsFor(profile.id);
    if (!ms.length) return el('div', { class: 'card p-6 text-center text-sm text-muted-' }, 'No meetings logged yet.');
    return el('div', { class: 'flex flex-col gap-3' }, ...ms.map((m, i) => {
      const k = MEETING_KINDS[m.kind] || MEETING_KINDS.coaching;
      const sc = m.score_snapshot != null ? Number(m.score_snapshot) : (scoreFor(m.period)?.final ?? null);
      const prevReview = ms.slice(i + 1).find(x => x.kind === 'review');
      const prevScore = prevReview ? (prevReview.score_snapshot != null ? Number(prevReview.score_snapshot) : (scoreFor(prevReview.period)?.final ?? null)) : null;
      const delta = (m.kind === 'review' && sc != null && prevScore != null) ? sc - prevScore : null;
      const items = m.action_items || [];
      return el('div', { class: 'card p-4', style: { borderLeft: '4px solid ' + k.color } },
        el('div', { class: 'flex items-center gap-2 flex-wrap mb-2' },
          chip(m.kind),
          el('span', { class: 'text-sm font-bold' }, _mtgFmt(m.meeting_date)),
          el('span', { class: 'text-[11px] text-muted-' }, 'with ' + (m.lead_name || 'team lead')),
          sc != null ? el('span', { class: 'ml-auto text-[11px] font-bold tabular-nums', style: { color: scorecardBand(sc).color }, title: 'Scorecard composite for ' + m.period }, fmtScore(sc, 1) + (delta != null ? ' (' + (delta >= 0 ? '+' : '') + delta.toFixed(1) + ' vs last review)' : '')) : null,
          canEdit ? el('span', { class: 'flex items-center gap-2' + (sc == null ? ' ml-auto' : '') },
            el('button', { class: 'text-[11px] font-semibold', style: { color: 'var(--accent)' }, onclick: () => { editing = JSON.parse(JSON.stringify(m)); render(); } }, 'Edit'),
            el('button', { class: 'text-[11px] font-semibold', style: { color: '#DC2626' }, onclick: async () => { if (!confirm('Delete this meeting?')) return; await deleteScorecardMeeting(m.id); render(); if (state.view === 'scorecards') mountApp(); } }, 'Delete')) : null),
        m.notes ? el('div', { class: 'text-xs leading-relaxed whitespace-pre-wrap mb-2' }, m.notes) : null,
        m.wins ? el('div', { class: 'text-xs mb-2' }, el('span', { class: 'font-bold', style: { color: '#5F6C5B' } }, 'Wins: '), m.wins) : null,
        (m.focus || []).length ? el('div', { class: 'flex items-center gap-1.5 flex-wrap mb-2' }, el('span', { class: 'text-[10px] uppercase tracking-widest text-muted- font-semibold' }, 'Focus'), ...m.focus.map(f => el('span', { class: 'rounded-full px-2 py-0.5 text-[10px] font-semibold', style: { background: 'rgba(223,100,58,.12)', color: '#DF643A' } }, f))) : null,
        items.length ? el('div', { class: 'flex flex-col gap-1' }, el('span', { class: 'text-[10px] uppercase tracking-widest text-muted- font-semibold' }, 'Action items'),
          ...items.map(a => el('label', { class: 'flex items-center gap-2 text-xs' + (canEdit ? ' cursor-pointer' : '') },
            el('input', { type: 'checkbox', checked: !!a.done, disabled: !canEdit, style: { accentColor: 'var(--accent)' }, onchange: async (e) => { a.done = e.target.checked; await saveScorecardMeeting(m); render(); } }),
            el('span', { style: a.done ? { textDecoration: 'line-through', color: 'var(--text-muted)' } : {} }, a.text),
            a.carried_from ? el('span', { class: 'text-[9px] uppercase tracking-wider font-bold', style: { color: '#A9441F' } }, 'carried from ' + _mtgFmt(a.carried_from)) : null))) : null);
    }));
  };

  const render = () => {
    modal.innerHTML = '';
    const cad = meetingCadence(profile.id);
    // DOM append() stringifies null — filter skipped conditional blocks out.
    modal.append(...[
      el('div', { class: 'flex items-start justify-between gap-4 mb-4' },
        el('div', { class: 'flex items-center gap-3' },
          avatarNode(profile.avatar_url, profile.initials || (profile.full_name || '?').slice(0, 2), 'w-10 h-10 text-sm'),
          el('div', {}, el('h2', { class: 'text-xl font-bold' }, profile.full_name), el('div', { class: 'text-[11px] font-semibold', style: { color: cad.color } }, cad.label + ' · ' + cad.count + ' meeting' + (cad.count === 1 ? '' : 's') + (cad.openItems ? ' · ' + cad.openItems + ' open item' + (cad.openItems === 1 ? '' : 's') : '')))),
        el('button', { class: 'text-2xl leading-none text-muted-', 'aria-label': 'Close', title: 'Close', onclick: () => overlay.remove() }, '×')),
      state._scorecardMeetingsMissing ? el('div', { class: 'card p-3 text-xs mb-3', style: { background: 'rgba(220,38,38,.08)', color: '#B91C1C' } }, 'The scorecard_meetings table isn’t in Supabase yet — run scorecard_meetings.sql. Meetings logged now stay on this device only.') : null,
      canEdit && !editing ? el('div', { class: 'flex items-center gap-2 flex-wrap mb-4' },
        ...Object.entries(MEETING_KINDS).map(([kk, kv]) => el('button', {
          class: 'rounded-lg px-2.5 py-1 text-[11px] font-bold transition hover:brightness-95',
          style: cad.nextKind === kk ? { background: kv.color, color: '#fff' } : { border: '1px solid var(--border-2)', color: 'var(--text)' },
          title: kv.desc, onclick: () => startNew(kk) }, '+ ' + kv.label)),
        el('span', { class: 'text-[11px] text-muted-' }, cad.coachingThisMonth ? 'Coaching 1:1 done for this month.' : 'This month\u2019s coaching 1:1 hasn\u2019t been logged yet.')) : null,
      editing ? el('div', { class: 'mb-4' }, form()) : null,
      el('div', { class: 'card p-4 mb-4', style: { background: 'var(--card-2)' } },
        el('div', { class: 'text-[10px] uppercase tracking-widest font-semibold mb-1.5', style: { color: 'var(--text-subtle)' } }, 'The story so far'),
        ...meetingInsights(profile, tpl).map(t => el('div', { class: 'text-xs leading-relaxed' }, '• ' + t))),
      timeline()].filter(Boolean));
  };
  // Open straight into the form (per Isaac): review by default, coaching
  // once this month's review is already logged. The picker row still shows
  // after a save / cancel.
  if (canEdit) startNew(meetingCadence(profile.id).nextKind); else render();
  document.body.append(overlay);
}

function openScorecardTemplateModal(dept = 'inside_sales') {
  const overlay = el('div', { class: 'modal-overlay' });
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  const modal = el('div', {
    class: 'card w-full max-w-xl p-6 my-8 overflow-y-auto',
    style: { maxHeight: 'calc(100vh - 64px)' },
  });
  overlay.append(modal);
  const close = () => { overlay.remove(); mountApp(); };

  const tpl = JSON.parse(JSON.stringify(getScorecardTemplate(dept))); // deep-clone draft
  const deptLabel = (SCORECARD_DEPTS.find(d => d.id === dept) || {}).label || dept;

  const persist = () => {
    if (!state._scorecardTemplates || typeof state._scorecardTemplates !== 'object') state._scorecardTemplates = {};
    state._scorecardTemplates[dept] = tpl;
    if (dept === 'inside_sales') state._scorecardTemplate = tpl; // legacy key kept in sync
    saveDemoData();
  };

  const render = () => {
    modal.innerHTML = '';
    const totalWeight = tpl.metrics.reduce((a, m) => a + Number(m.weight || 0), 0);
    const weightWarn  = Math.abs(totalWeight - 1) > 0.001;

    modal.append(
      el('div', { class: 'flex items-start justify-between gap-4 mb-4' },
        el('div', {},
          el('h2', { class: 'text-xl font-bold' }, '⚙ Scorecard Template'),
          el('div', { class: 'text-xs text-muted- mt-1' },
            'Configure the metrics + weights every ' + deptLabel + ' scorecard uses.'),
        ),
        el('button', { class: 'text-2xl leading-none text-muted-', 'aria-label': 'Close', title: 'Close', onclick: close }, '×'),
      ),
      // Template name
      el('div', { class: 'mb-4' },
        el('label', { class: 'text-[10px] uppercase tracking-widest text-muted- font-semibold' }, 'Template Name'),
        el('input', {
          type: 'text', value: tpl.name,
          class: 'mt-1 w-full rounded-lg border px-2.5 py-1 text-[11px]',
          style: { borderColor: 'var(--border-2)' },
          oninput: (e) => { tpl.name = e.target.value; persist(); },
        }),
      ),
      // Metrics
      el('div', { class: 'mb-4' },
        el('div', { class: 'flex items-baseline gap-3 mb-2' },
          el('h3', { class: 'text-xs font-bold uppercase tracking-widest text-muted-' }, 'Metrics'),
          el('span', {
            class: 'text-[11px] tabular-nums font-semibold',
            style: { color: weightWarn ? '#DC2626' : '#DF643A' },
          }, 'Weights total ' + Math.round(totalWeight * 100) + '%' + (weightWarn ? ' (should equal 100%)' : ' ✓')),
        ),
        ...tpl.metrics.map(m => el('div', { class: 'flex items-center gap-2 mb-2' },
          el('input', {
            type: 'text', value: m.label,
            class: 'rounded-lg border px-2.5 py-1 text-[11px] flex-1',
            style: { borderColor: 'var(--border-2)' },
            oninput: (e) => { m.label = e.target.value; persist(); },
          }),
          el('input', {
            type: 'number', min: '0', max: '100', step: '1',
            value: String(Math.round(m.weight * 100)),
            class: 'rounded-lg border px-2.5 py-1 text-[11px] tabular-nums text-left',
            style: { borderColor: 'var(--border-2)', width: '80px' },
            title: 'Weight (percent)',
            oninput: (e) => { m.weight = (Number(e.target.value) || 0) / 100; persist(); render(); },
          }),
          el('span', { class: 'text-[10px] text-muted- w-12' }, m.source === 'attendance' ? 'auto' : 'manual'),
        )),
      ),
      // Attendance penalties
      el('div', { class: 'mb-4' },
        el('h3', { class: 'text-xs font-bold uppercase tracking-widest text-muted- mb-2' }, 'Attendance Penalties'),
        el('div', { class: 'text-[10px] text-muted- mb-2' },
          'How it works: every agent starts the month at 100%. Each occurrence below takes points off — a "days" penalty costs that many working days (1 day out of a 26-day month = 3.8%), a "%" penalty is a flat deduction (10% per same-day call out). Score = 100 − total deductions, floored at 0.'),
        el('div', { class: 'flex items-center gap-2 mb-2' },
          el('div', { class: 'flex-1' },
            el('label', { class: 'text-xs font-semibold' }, 'Default Working Days'),
            el('div', { class: 'text-[10px] text-muted- mt-0.5' }, (() => {
              const now = new Date();
              const key = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
              const n = workingDaysForPeriod(key);
              return 'Auto: ' + n + ' working days (Mon–Sat) in ' + now.toLocaleString('en-US', { month: 'long', year: 'numeric' }) + '. Each scorecard uses its own month; type a number only to override.';
            })()),
          ),
          el('input', {
            type: 'number', min: '0', step: '1',
            value: String(tpl.attendance.workingDays || ''),
            placeholder: 'auto · ' + workingDaysForPeriod(new Date().getFullYear() + '-' + String(new Date().getMonth() + 1).padStart(2, '0')),
            class: 'rounded-lg border px-2.5 py-1 text-[11px] tabular-nums text-left',
            style: { borderColor: 'var(--border-2)', width: '80px' },
            oninput: (e) => {
              const raw = e.target.value;
              tpl.attendance.workingDays = raw === '' ? null : (Number(raw) || null);
              persist();
            },
          }),
        ),
        ...tpl.attendance.penalties.map(p => {
          // Default the unit field so legacy templates (no `unit`) get
          // 'days' behavior, matching what computeAttendanceScore does.
          if (!p.unit) p.unit = 'days';
          const weightVal = p.unit === 'percent'
            ? Number(p.weight || 0)
            : Number(p.weightDays || 0);
          return el('div', { class: 'flex items-center gap-2 mb-2' },
            el('input', {
              type: 'text', value: p.label,
              class: 'rounded-lg border px-2.5 py-1 text-[11px] flex-1',
              style: { borderColor: 'var(--border-2)' },
              oninput: (e) => { p.label = e.target.value; persist(); },
            }),
            el('input', {
              type: 'number', min: '0', step: '0.5',
              value: String(weightVal),
              class: 'rounded-lg border px-2.5 py-1 text-[11px] tabular-nums text-left',
              style: { borderColor: 'var(--border-2)', width: '80px' },
              title: p.unit === 'percent'
                ? 'Flat % deduction per occurrence'
                : 'Working days lost per occurrence (scales with month length)',
              oninput: (e) => {
                const v = Number(e.target.value) || 0;
                if (p.unit === 'percent') p.weight = v;
                else                       p.weightDays = v;
                persist(); render();
              },
            }),
            el('select', {
              class: 'rounded-lg border px-2.5 py-1 text-[11px] cursor-pointer',
              style: { borderColor: 'var(--border-2)' },
              title: 'Unit — fixed % per occurrence, or working-days lost (scales with month)',
              onchange: (e) => {
                const u = e.target.value;
                // Carry the numeric value over when the unit flips so
                // toggling doesn't silently zero-out the field.
                const prev = p.unit === 'percent' ? Number(p.weight || 0) : Number(p.weightDays || 0);
                p.unit = u;
                if (u === 'percent') { p.weight = prev; delete p.weightDays; }
                else                  { p.weightDays = prev; delete p.weight; }
                persist(); render();
              },
            },
              el('option', { value: 'percent', selected: p.unit === 'percent' }, '%'),
              el('option', { value: 'days',    selected: p.unit === 'days'    }, 'days'),
            ),
          );
        }),
      ),
      el('div', { class: 'flex gap-2 mt-5' },
        el('button', {
          class: 'rounded-lg px-2.5 py-1 text-[11px] font-semibold border',
          style: { borderColor: 'var(--border-2)', color: 'var(--text-muted)' },
          title: 'Reset template to defaults (does not clear saved scorecards)',
          onclick: () => {
            if (!confirm('Reset the ' + deptLabel + ' template to defaults? Existing scorecards are kept.')) return;
            if (state._scorecardTemplates) delete state._scorecardTemplates[dept];
            if (dept === 'inside_sales') state._scorecardTemplate = null;
            saveDemoData();
            close();
          },
        }, 'Reset Template'),
        el('button', {
          class: 'rounded-lg px-2.5 py-1 text-[11px] font-bold',
          style: { background: 'var(--accent)', color: 'var(--accent-text)' },
          onclick: close,
        }, 'Done'),
      ),
    );
  };

  render();
  document.body.append(overlay);
}

// ──────────────────────────────────────────────────────────────────────────
// VIEW: REPORTING — company-wide metrics from CSV snapshot uploads
// ──────────────────────────────────────────────────────────────────────────
// Admin-only. Each CSV upload is an "all-time" snapshot — uploads are
// appended (not merged) so admins can compare metrics across snapshot
// dates. Service-type config (is_recurring, is_hidden, category) is
// global because the same service means the same thing across snapshots.
//
// Backed by three Supabase tables (see reporting_schema.sql):
//   reporting_uploads          — snapshot metadata
//   reporting_subscriptions    — subscription rows tied to a snapshot
//   reporting_service_config   — global per-service config

// Header-based CSV parser for the all-time subscription export. Tolerant
// of column reordering and minor header variations (it does case-insensitive
// exact match first, then substring match). Throws if Customer ID or
// Subscription is missing — without those a row can't be tied to a customer
// or grouped by service.
// State as filed in the CRM. Blank / "un" / "unknown" / "??" / "n/a" all
// mean "no state" and group under ?? on the Geographic tab (waiting on a
// sync, or missing in FieldRoutes). Anything else — even junk like "AA" /
// "AC" — is kept as typed so it shows up as something to fix in the CRM.
function _normStateCode(v) {
  const t = String(v == null ? '' : v).trim().toUpperCase();
  if (!t || t === '??' || t === 'UN' || t === 'UNK' || t === 'UNKNOWN' || t === 'N/A' || t === 'NA' || t === 'NONE' || t === '-' || t === '--') return null;
  return t;
}
function parseReportingCsv(text) {
  function parseLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') { inQuotes = !inQuotes; }
      else if (c === ',' && !inQuotes) { result.push(current.trim()); current = ''; }
      else { current += c; }
    }
    result.push(current.trim());
    return result;
  }
  const lines = text.replace(/^﻿/, '').replace(/\r\n/g, '\n').trim().split('\n').filter(l => l.trim());
  if (lines.length < 2) throw new Error('CSV has no data rows');

  const headers = parseLine(lines[0]).map(h => h.toLowerCase().trim());
  const find = (...names) => {
    for (const n of names) {
      const i = headers.findIndex(h => h === n.toLowerCase());
      if (i >= 0) return i;
    }
    for (const n of names) {
      const i = headers.findIndex(h => h.includes(n.toLowerCase()));
      if (i >= 0) return i;
    }
    return -1;
  };

  const cols = {
    customer_id:                      find('customer id', 'cust id', 'account id'),
    last_name:                        find('last name'),
    first_name:                       find('first name'),
    sold_date:                        find('sold date', 'date sold'),
    customer_auto_pay:                find('customer auto pay', 'auto pay', 'apay'),
    customer_flags:                   find('customer flags', 'flags'),
    annual_recurring_value:           find('annual recurring value', 'arr', 'annual recurring'),
    sold_by_id:                       find('sold by id'),
    sold_by:                          find('sold by'),
    sold_by_type:                     find('sold by type'),
    subscription_completed_services:  find('subscription completed services', 'completed services'),
    county:                           find('county'),
    subscription:                     find('subscription'),
    subscription_cancellation_reason: find('subscription cancellation reason', 'cancellation reason', 'cancel reason'),
    subscription_date_canceled:       find('subscription date canceled', 'date canceled', 'cancel date'),
    subscription_status:              find('subscription status', 'status'),
    initial_service:                  find('initial service'),
    subscription_source:              find('subscription source'),
    country:                          find('country'),
    state:                            find('state'),
    zip_code:                         find('zip code', 'zip'),
    days_past_due:                    find('days past due'),
    office_name:                      find('office name', 'office'),
    agreement_length:                 find('agreement length'),
    subscription_contract_value:      find('subscription contract value', 'contract value'),
    initial_price:                    find('initial price'),
    recurring_frequency:              find('recurring frequency', 'frequency'),
    phone:                            find('phone number', 'phone', 'cell', 'mobile'),
    email:                            find('email address', 'email', 'e-mail'),
    // Optional second source column = the lead's ORIGINAL marketing source
    // (GHL / Google / Meta), distinct from Subscription Source (the CRM tag).
    // When present, Lead Attribution compares the two straight from the snapshot.
    lead_source:                      find('lead source', 'original source', 'first source', 'attribution source', 'marketing source', 'utm source', 'ad source', 'campaign source', 'ghl source', 'gohighlevel source'),
  };
  if (cols.customer_id < 0) throw new Error('Missing required column: Customer ID');
  if (cols.subscription < 0) throw new Error('Missing required column: Subscription');

  // Accept MM/DD/YY, MM/DD/YYYY, YYYY-MM-DD. Returns ISO yyyy-mm-dd or null.
  // 2-digit years split at 1970: 70-99 → 19xx, 00-69 → 20xx.
  const parseDate = (s) => {
    const v = String(s || '').trim();
    if (!v) return null;
    let m = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) return m[1] + '-' + m[2].padStart(2, '0') + '-' + m[3].padStart(2, '0');
    m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
    if (m) {
      let y = m[3];
      if (y.length === 2) y = (Number(y) >= 70 ? '19' : '20') + y;
      return y + '-' + m[1].padStart(2, '0') + '-' + m[2].padStart(2, '0');
    }
    return null;
  };
  const parseNumOrNull = (s) => {
    const v = String(s == null ? '' : s).replace(/[$%]/g, '').replace(/,/g, '').trim();
    if (!v) return null;
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : null;
  };
  const parseIntOrNull = (s) => {
    const n = parseNumOrNull(s);
    return n == null ? null : Math.trunc(n);
  };
  const textOrNull = (s) => {
    const v = String(s == null ? '' : s).trim();
    return v ? v : null;
  };
  const pick = (row, idx) => (idx >= 0 ? row[idx] : '');

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const r = parseLine(lines[i]);
    if (r.every(c => !c)) continue;
    // Keep ALL subscription rows (don't drop not-yet-serviced ones) so the
    // headline metrics — Active Subscriptions, Recurring ARR, Active Customers
    // — count every active sub, matching FieldRoutes' own "Active" status.
    // (Serviced-specific views can still filter on completed services.)
    const initialService = parseDate(pick(r, cols.initial_service));
    rows.push({
      customer_id:                      textOrNull(pick(r, cols.customer_id)),
      last_name:                        textOrNull(pick(r, cols.last_name)),
      first_name:                       textOrNull(pick(r, cols.first_name)),
      sold_date:                        parseDate(pick(r, cols.sold_date)),
      customer_auto_pay:                textOrNull(pick(r, cols.customer_auto_pay)),
      customer_flags:                   textOrNull(pick(r, cols.customer_flags)),
      annual_recurring_value:           parseNumOrNull(pick(r, cols.annual_recurring_value)),
      sold_by_id:                       textOrNull(pick(r, cols.sold_by_id)),
      sold_by:                          textOrNull(pick(r, cols.sold_by)),
      sold_by_type:                     textOrNull(pick(r, cols.sold_by_type)),
      subscription_completed_services:  parseIntOrNull(pick(r, cols.subscription_completed_services)),
      county:                           textOrNull(pick(r, cols.county)),
      subscription:                     textOrNull(pick(r, cols.subscription)),
      subscription_cancellation_reason: textOrNull(pick(r, cols.subscription_cancellation_reason)),
      subscription_date_canceled:       parseDate(pick(r, cols.subscription_date_canceled)),
      subscription_status:              textOrNull(pick(r, cols.subscription_status)),
      initial_service:                  initialService,
      subscription_source:              textOrNull(pick(r, cols.subscription_source)),
      country:                          textOrNull(pick(r, cols.country)),
      state:                            _normStateCode(textOrNull(pick(r, cols.state))),
      zip_code:                         textOrNull(pick(r, cols.zip_code)),
      days_past_due:                    parseIntOrNull(pick(r, cols.days_past_due)),
      office_name:                      textOrNull(pick(r, cols.office_name)),
      agreement_length:                 parseIntOrNull(pick(r, cols.agreement_length)),
      subscription_contract_value:      parseNumOrNull(pick(r, cols.subscription_contract_value)),
      initial_price:                    parseNumOrNull(pick(r, cols.initial_price)),
      recurring_frequency:              textOrNull(pick(r, cols.recurring_frequency)),
      phone:                            textOrNull(pick(r, cols.phone)),
      email:                            textOrNull(pick(r, cols.email)),
      lead_source:                      textOrNull(pick(r, cols.lead_source)),
    });
  }
  return rows;
}

// Fixed progress bar shown during a reporting upload. Call with a percent
// (0–100) + label to show/update it, or null to remove it.
function reportingUploadProgress(pct, label) {
  if (state._reportingSilent) return;   // background prefetch — no toast
  let bar = document.getElementById('rptUploadProg');
  if (pct == null) { if (bar) bar.remove(); return; }
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'rptUploadProg';
    bar.className = 'card';
    bar.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:9999;width:min(440px,92vw);padding:12px 16px;box-shadow:var(--shadow-lg)';
    document.body.appendChild(bar);
  }
  bar.innerHTML =
    '<div style="font-size:12px;font-weight:600;color:var(--text);margin-bottom:8px;display:flex;justify-content:space-between;gap:10px">'
    + '<span>' + (label || 'Uploading…') + '</span><span style="font-variant-numeric:tabular-nums">' + pct + '%</span></div>'
    + '<div style="height:8px;border-radius:6px;background:var(--card-2);overflow:hidden">'
    + '<div style="height:100%;width:' + pct + '%;background:var(--accent);transition:width .2s"></div></div>';
}

// Upload a new snapshot. Creates a reporting_uploads row, batch-inserts
// the subscription rows tied to it, seeds any new service names into
// reporting_service_config (defaulting to non-recurring so the admin
// reviews them), then reloads metadata + sets the new upload as active.
async function uploadReportingCsv(file) {
  if (!file) return;
  if (!DEMO && !isAdminRole(state.profile?.role)) { toast('Admins only', 'error'); return; }

  let rows;
  try {
    const text = await new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = (e) => res(e.target.result);
      r.onerror = () => rej(new Error('File read failed'));
      r.readAsText(file);
    });
    rows = parseReportingCsv(text);
  } catch (err) {
    toast('CSV parse error: ' + err.message, 'error');
    return;
  }
  if (rows.length === 0) { toast('No rows found in CSV', 'warn'); return; }

  toast('Uploading ' + rows.length.toLocaleString() + ' rows…', 'info');

  // DEMO mode: state-only, no Supabase. Subscription rows live in
  // memory for the session — refresh wipes them. Metadata + config
  // persist via saveDemoData so the snapshot list survives reload
  // (you'll just need to re-upload to see the rows again).
  if (DEMO) {
    const uploadId = (crypto.randomUUID && crypto.randomUUID()) || ('demo-' + Date.now());
    const upload = {
      id: uploadId,
      uploaded_at: new Date().toISOString(),
      uploaded_by: state.profile?.id || null,
      filename: file.name || '',
      row_count: rows.length,
      notes: null,
    };
    state.reportingUploads = [upload, ...(state.reportingUploads || [])];
    state.reportingSubscriptions = rows;
    state.reportingActiveUploadId = uploadId;
    state.reportingSubscriptionsLoadedFor = uploadId;
    _refreshRepTypeMap();

    // Seed any new service names into the config table so they appear
    // in Service Types with default (non-recurring, non-hidden) flags.
    const knownNames = new Set((state.reportingServiceConfig || []).map(c => c.service_name));
    for (const r of rows) {
      if (r.subscription && !knownNames.has(r.subscription)) {
        state.reportingServiceConfig.push({
          service_name: r.subscription,
          category: null,
          is_recurring: false,
          is_hidden: false,
        });
        knownNames.add(r.subscription);
      }
    }
    saveDemoData();
    toast('Uploaded ' + rows.length.toLocaleString() + ' rows (demo mode — rows are session-only)', 'success');
    mountApp();
    return;
  }

  // 1. FAST PATH — gzip the parsed rows and store them as ONE object in
  //    Supabase Storage (single PUT, seconds) instead of ~78 row-inserts.
  //    Falls back to the legacy chunked inserts if the bucket / column
  //    isn't set up yet (run reporting_storage.sql).
  let storagePath = null;
  try {
    if (typeof CompressionStream !== 'undefined') {
      reportingUploadProgress(8, 'Compressing ' + rows.length.toLocaleString() + ' rows…');
      const gz = new CompressionStream('gzip');
      const blob = await new Response(new Blob([JSON.stringify(rows)]).stream().pipeThrough(gz)).blob();
      const path = 'snapshots/' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.json.gz';
      reportingUploadProgress(20, 'Uploading snapshot (' + (blob.size / 1048576).toFixed(1) + ' MB)…');
      const { error: stErr } = await supabase.storage.from('reporting').upload(path, blob, { contentType: 'application/gzip' });
      if (!stErr) storagePath = path;
      else console.warn('[ridd] storage upload unavailable — falling back to row inserts', stErr);
    }
  } catch (e) { console.warn('[ridd] storage fast path failed — falling back to row inserts', e); }

  // 2. Snapshot envelope (carries storage_path when the fast path worked).
  const envelope = {
    filename:    file.name || '',
    row_count:   rows.length,
    uploaded_by: state.profile?.id || null,
  };
  if (storagePath) envelope.storage_path = storagePath;
  let { data: upload, error: uploadErr } = await supabase
    .from('reporting_uploads').insert(envelope).select().single();
  if (uploadErr && storagePath) {
    // storage_path column may not exist yet — retry as a legacy upload.
    console.warn('[ridd] envelope insert with storage_path failed — retrying legacy', uploadErr);
    storagePath = null; delete envelope.storage_path;
    ({ data: upload, error: uploadErr } = await supabase
      .from('reporting_uploads').insert(envelope).select().single());
  }
  if (uploadErr) { reportingUploadProgress(null); toast('Upload failed: ' + uploadErr.message, 'error'); return; }
  if (storagePath) reportingUploadProgress(92, 'Finishing up…');
  if (!storagePath) {

  // 2. Chunked inserts, run in parallel with a capped concurrency + a live
  //    progress bar. Sequential single-file inserts were the slow part; firing
  //    several chunks at once cuts the wait to roughly (chunks / CONCURRENCY).
  //    If any chunk fails we delete the envelope so we don't leave a
  //    half-loaded snapshot behind.
  // Smaller batches (250) so each INSERT finishes well under Supabase's
  // per-statement timeout — 1000-row inserts against an indexed table were
  // tripping "canceling statement due to statement timeout".
  const CHUNK = 250, CONCURRENCY = 6;
  // Columns the DB may not have yet (added by inside_sales_schema.sql). If an
  // insert errors because they're missing, we strip them and keep going so the
  // upload NEVER hard-fails on a not-yet-run migration. Inside Sales sold-date
  // data just won't populate until that migration is run.
  const OPTIONAL_COLS = ['customer_auto_pay', 'sold_date', 'customer_flags'];
  const stripOptional = (r) => { const c = { ...r }; OPTIONAL_COLS.forEach(k => delete c[k]); return c; };
  let strip = false, strippedAny = false;
  const chunks = [];
  for (let i = 0; i < rows.length; i += CHUNK) {
    chunks.push(rows.slice(i, i + CHUNK).map(r => ({ ...r, upload_id: upload.id })));
  }
  const missingColErr = (e) => /could not find|schema cache|column .* does not exist/i.test(e?.message || '');
  const transientErr  = (e) => /timeout|timed out|temporarily|too many|503|fetch|network/i.test(e?.message || '');
  // Insert with backoff retry on transient errors (statement timeouts spike
  // under concurrent load — a short wait + retry clears them).
  const insertWithRetry = async (payload) => {
    let last = null;
    for (let t = 0; t < 4; t++) {
      const { error } = await supabase.from('reporting_subscriptions').insert(payload);
      if (!error) return null;
      last = error;
      if (!transientErr(error)) return error;
      await new Promise(r => setTimeout(r, 500 * (t + 1)));
    }
    return last;
  };
  let done = 0, failed = null, nextChunk = 0;
  reportingUploadProgress(0, 'Uploading ' + rows.length.toLocaleString() + ' rows…');

  // PROBE: insert the first chunk by itself to settle the strip decision
  // BEFORE parallelizing — otherwise parallel chunks can fail on the missing
  // column before the strip flag flips (that race was the recurring failure).
  {
    const c0 = chunks[0] || [];
    let error = await insertWithRetry(c0);
    if (error && missingColErr(error)) {
      strip = true; strippedAny = true;
      error = await insertWithRetry(c0.map(stripOptional));
    }
    if (error) {
      await supabase.from('reporting_uploads').delete().eq('id', upload.id);
      reportingUploadProgress(null);
      toast('Upload failed: ' + error.message, 'error');
      return;
    }
    done += c0.length; nextChunk = 1;
    reportingUploadProgress(Math.round(100 * done / rows.length),
      'Uploading ' + done.toLocaleString() + ' / ' + rows.length.toLocaleString() + ' rows…');
  }

  const insertWorker = async () => {
    for (;;) {
      const idx = nextChunk++;
      if (idx >= chunks.length || failed) return;
      const payload = strip ? chunks[idx].map(stripOptional) : chunks[idx];
      const error = await insertWithRetry(payload);
      if (error) { failed = error; return; }
      done += chunks[idx].length;
      reportingUploadProgress(Math.round(100 * done / rows.length),
        'Uploading ' + done.toLocaleString() + ' / ' + rows.length.toLocaleString() + ' rows…');
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, chunks.length) }, insertWorker));
  if (failed) {
    await supabase.from('reporting_uploads').delete().eq('id', upload.id);
    reportingUploadProgress(null);
    toast('Upload failed: ' + failed.message, 'error');
    return;
  }
  reportingUploadProgress(100, 'Finishing up…');
  logActivity('report_upload', { detail: (upload?.filename || 'Customer Report') + ' · ' + rows.length.toLocaleString() + ' rows' });
  if (strippedAny) {
    setTimeout(() => toast('Uploaded — but Sold Date / Auto Pay weren\'t stored (run inside_sales_schema.sql for the Inside Sales tab).', 'warn'), 800);
  }
  } // end legacy row-insert path

  // 3. Seed any new service names so the Service Type Configuration
  //    tab shows them with default flags. Existing rows are left alone
  //    (no upsert overwrite) so prior admin choices aren't reset.
  const knownNames = new Set((state.reportingServiceConfig || []).map(c => c.service_name));
  const newNames = new Set();
  for (const r of rows) {
    if (r.subscription && !knownNames.has(r.subscription)) newNames.add(r.subscription);
  }
  if (newNames.size > 0) {
    const seedRows = [...newNames].map(name => ({
      service_name: name, is_recurring: false, is_hidden: false,
      updated_by: state.profile?.id || null,
    }));
    const { error: seedErr } = await supabase
      .from('reporting_service_config')
      .insert(seedRows);
    if (seedErr) console.warn('[ridd] service config seed failed', seedErr);
  }

  // 4. Reload metadata and point at the new snapshot. We already hold every
  //    row in memory (we just parsed + inserted them), so hand them straight
  //    to the view instead of re-downloading the whole snapshot from Supabase
  //    — that round-trip was the long "Loading snapshot…" wait after upload.
  await loadReportingMetadata();
  state.reportingActiveUploadId = upload.id;
  state.reportingSubscriptions = rows;
  state.reportingSubscriptionsLoadedFor = upload.id;
  _refreshRepTypeMap();
  reportingIdbPut(upload.id, rows); // seed the local cache so refresh is instant
  reportingUploadProgress(null);
  toast('Uploaded ' + rows.length.toLocaleString() + ' rows', 'success');
  mountApp();
}

// Color palette for the Reporting tab's pies / doughnuts. Ordered so the
// first slice (which is usually the largest) lands on RIDD's brand lime.
// Cycled when there are more slices than colors.
const REPORTING_PALETTE = [
  '#DF643A', // RIDD lime
  '#1D4D4F', // dark teal
  '#A9441F', // gold
  '#5F6C5B', // blue
  '#DC2626', // red
  '#9C3F1E', // purple
  '#5F6C5B', // teal
  '#FFB899', // orange
  '#C9B98A', // green
  '#A78256', // pink
  '#06B6D4', // cyan
  '#7C857A', // gray
];

// SERVICE-LEVEL recurring resolver — the single source of truth for whether
// a subscription's SERVICE TYPE counts as recurring. Decision per service:
//   • config.recurring_override === true / false  → admin's explicit choice
//   • otherwise                                    → data guess: recurring if
//     ANY row of that service in the snapshot has Annual Recurring Value > 0
// Computed across the WHOLE snapshot (not the office-filtered scope) so the
// answer is stable no matter which office filter is applied. Returns a
// Map<serviceName, boolean>. The Configurations tab writes recurring_override.
// Per-service LIFECYCLE — the master classification that drives both the
// recurring math and the data-hygiene flags. One of:
//   'recurring' — ongoing service; being Active is expected.
//   'onetime'   — closes after it's serviced; Active + already-serviced is stale.
//   'retired'   — discontinued service; ANY Active sub is a flag.
// Resolution order per service:
//   1. config.lifecycle  ('recurring' | 'onetime' | 'retired')   — admin's choice
//   2. config.recurring_override (true → recurring, false → onetime) — legacy
//   3. default ('auto'): RECURRING for everything except services named
//      "One Time …", which default to one-time.
// Build + persist a small map of rep name-signature → "Sold By Type" from the
// Customer Report's rows. The full report doesn't survive a refresh (too big
// for localStorage), but this tiny map does, so Manage Teams can show each
// rep's type (Sales Rep / Office Staff / Technician) even when the rows aren't
// loaded. Called whenever reporting subscription rows become available.
function _refreshRepTypeMap() {
  const rows = state.reportingSubscriptions || [];
  if (!rows.length) return;
  const m = {};
  // Also accumulate the distinct cancel reasons + lead sources seen in the
  // reporting customer report. The report's rows don't persist (too big), but
  // these small lists do — so the Configurations panels can reference the
  // reporting CSV's reasons/sources even when no snapshot is loaded.
  const reasons = new Set(state._reportingCancelReasonsSeen || []);
  const sources = new Set(state._reportingSourcesSeen || []);
  for (const r of rows) {
    const t = (r.sold_by_type || '').trim();
    if (r.sold_by && t) {
      const k = _repTypeNameSig(typeof getCanonicalRepName === 'function' ? getCanonicalRepName(r.sold_by) : r.sold_by);
      if (k && !m[k]) m[k] = t;
    }
    const reason = (r.subscription_cancellation_reason || '').trim();
    if (reason) reasons.add(reason);
    const src = (r.subscription_source || '').trim();
    if (src) sources.add(src);
  }
  if (Object.keys(m).length) state._indicatorRepTypeBySig = m;
  state._reportingCancelReasonsSeen = [...reasons];
  state._reportingSourcesSeen = [...sources];
  if (typeof saveIndicatorState === 'function') saveIndicatorState();
}

function reportingServiceLifecycleMap() {
  const cfg = state.reportingServiceConfig || [];
  const byName = new Map(cfg.map(c => [c.service_name, c]));
  const arvAny = new Map(); // service → does any row have ARV > 0?
  for (const r of (state.reportingSubscriptions || [])) {
    const n = r.subscription; if (!n) continue;
    if (!arvAny.has(n)) arvAny.set(n, false);
    if ((Number(r.annual_recurring_value) || 0) > 0) arvAny.set(n, true);
  }
  const names = new Set([...byName.keys(), ...arvAny.keys()]);
  const map = new Map();
  const VALID = new Set(['recurring', 'onetime', 'retired']);
  for (const n of names) {
    const c = byName.get(n) || {};
    let lc;
    if (VALID.has(c.lifecycle)) lc = c.lifecycle;
    else if (c.recurring_override === true)  lc = 'recurring';
    else if (c.recurring_override === false) lc = 'onetime';
    // Default: everything is recurring EXCEPT services named "One Time …",
    // which default to one-time. (Explicit pins above still win.)
    else lc = _ONETIME_SUB_RE.test(n) ? 'onetime' : 'recurring';
    map.set(n, lc);
  }
  return map;
}

// Recurring view of the lifecycle map (recurring iff lifecycle === 'recurring').
function reportingServiceRecurringMap() {
  const lc = reportingServiceLifecycleMap();
  const map = new Map();
  for (const [n, v] of lc) map.set(n, v === 'recurring');
  return map;
}

// How "recurring" is decided across all reporting:
//   'lifecycle' — the admin's per-service Lifecycle config (manual, can drift).
//   'arv'       — data-driven: a sub is recurring iff it carries an annual
//                 recurring value > $0 (self-maintaining, matches FieldRoutes).
// Persisted locally so it survives reloads without a Supabase column.
// ── ADMIN RULES that change COMPANY NUMBERS (attrition, retention, branch
// scoping) ride the synced config row — competitions.extras.adminRules —
// so every admin device and every rep computes the SAME totals. localStorage
// remains a per-device fallback for pre-migration devices only.
function _adminRules() { return (state._compExtras && state._compExtras.adminRules) || null; }
function _setAdminRule(key, val) {
  state._compExtras = state._compExtras || {};
  const r = state._compExtras.adminRules = state._compExtras.adminRules || {};
  r[key] = val;
  try { saveIndicatorState(); } catch (e) { /* localStorage fallback below still applies */ }
}

function reportingRecurringMode() {
  const r = _adminRules();
  if (r && (r.recurringMode === 'arv' || r.recurringMode === 'lifecycle')) return r.recurringMode;
  try { return localStorage.getItem('ridd_reporting_recurring_mode') === 'arv' ? 'arv' : 'lifecycle'; } catch { return 'lifecycle'; }
}
function setReportingRecurringMode(m) {
  _setAdminRule('recurringMode', m === 'arv' ? 'arv' : 'lifecycle');
  try { localStorage.setItem('ridd_reporting_recurring_mode', m === 'arv' ? 'arv' : 'lifecycle'); } catch {}
}

// ── Reporting rules (locally-persisted settings; defaults preserve behavior) ──
function reportingAgingDays() {
  const r = _adminRules();
  if (r && Number.isFinite(r.agingDays) && r.agingDays >= 0) return r.agingDays;
  try { const v = parseInt(localStorage.getItem('ridd_rpt_aging_days') || '7', 10); return Number.isFinite(v) && v >= 0 ? v : 7; } catch { return 7; } }
function setReportingAgingDays(n) {
  const v = Math.max(0, parseInt(n, 10) || 0);
  _setAdminRule('agingDays', v);
  try { localStorage.setItem('ridd_rpt_aging_days', String(v)); } catch {} }
function reportingExcludeRorChurn() {
  if (state._retenWhatIf && typeof state._retenWhatIf.ror === 'boolean' && state.reportingSubTab === 'waterfall') return state._retenWhatIf.ror;
  const r = _adminRules();
  if (r && typeof r.exclRorChurn === 'boolean') return r.exclRorChurn;
  try { return localStorage.getItem('ridd_rpt_excl_ror') === '1'; } catch { return false; } }
function setReportingExcludeRorChurn(b) {
  _setAdminRule('exclRorChurn', !!b);
  try { localStorage.setItem('ridd_rpt_excl_ror', b ? '1' : '0'); } catch {} }
// ── Retention population rules — the app-side build of the workbook's manual
// Steps 4–6 (default ON so the Retention tab matches the hand report):
//   · renewal-source subs are continuations of an existing customer, not new
//     book entries — counting them double-counts the relationship AND flatters
//     retention (they're recent + overwhelmingly active)
//   · $0-paying subs aren't real book
//   · Frozen with ≤1 completed service = a quiet death: no cancel date ever
//     lands, so left in they'd count as "retained" forever
function retenExclRenewalSubs()   {
  const r = _adminRules(); if (r && typeof r.retenExclRenewals === 'boolean') return r.retenExclRenewals;
  return false; }   // default OFF since Sep 2026: the renewal IS the live book; the old sub closed "Renewal - …" is what leaves (retenPopExclReasons)
function setRetenExclRenewalSubs(b)   { _setAdminRule('retenExclRenewals', !!b); try { localStorage.setItem('ridd_reten_excl_renewals', b ? '1' : '0'); } catch {} }
function retenExclZeroPay()       {
  if (state._retenWhatIf && typeof state._retenWhatIf.zero === 'boolean' && state.reportingSubTab === 'waterfall') return state._retenWhatIf.zero;
  const r = _adminRules(); if (r && typeof r.retenExclZeroPay === 'boolean') return r.retenExclZeroPay;
  try { return localStorage.getItem('ridd_reten_excl_zeropay') !== '0'; } catch { return true; } }
function setRetenExclZeroPay(b)       { _setAdminRule('retenExclZeroPay', !!b); try { localStorage.setItem('ridd_reten_excl_zeropay', b ? '1' : '0'); } catch {} }
// Step 6 of the workbook, in full (per Isaac): "take out all subscriptions
// that have only received 1 service" - a one-visit account is not yet a
// legitimate customer, so its cancel is not legitimate attrition. Broader
// than the frozen-only rule below (which stays for when this is OFF).
// Default ON, matching the hand report like the other Steps toggles.
function retenExclOneSvc()  {
  if (state._retenWhatIf && typeof state._retenWhatIf.oneSvc === 'boolean' && state.reportingSubTab === 'waterfall') return state._retenWhatIf.oneSvc;
  const r = _adminRules(); if (r && typeof r.retenExclOneSvc === 'boolean') return r.retenExclOneSvc;
  try { return localStorage.getItem('ridd_reten_excl_onesvc') !== '0'; } catch { return true; } }
function setRetenExclOneSvc(b)  { _setAdminRule('retenExclOneSvc', !!b); try { localStorage.setItem('ridd_reten_excl_onesvc', b ? '1' : '0'); } catch {} }
function retenExclFrozenOneSvc()  {
  if (state._retenWhatIf && typeof state._retenWhatIf.frozenOneSvc === 'boolean' && state.reportingSubTab === 'waterfall') return state._retenWhatIf.frozenOneSvc;
  const r = _adminRules(); if (r && typeof r.retenExclFrozenOneSvc === 'boolean') return r.retenExclFrozenOneSvc;
  try { return localStorage.getItem('ridd_reten_excl_frozen1') !== '0'; } catch { return true; } }
function setRetenExclFrozenOneSvc(b)  { _setAdminRule('retenExclFrozenOneSvc', !!b); try { localStorage.setItem('ridd_reten_excl_frozen1', b ? '1' : '0'); } catch {} }
// Step 1 (per Isaac, Sep 2026): subs CLOSED with one of these cancellation
// reasons leave the retention book entirely - they are not customers lost
// (3-day ROR = never really a customer; Combined = folded into another
// sub; Renewal-* = the old sub was replaced by the renewal, which stays).
// "ROR" as a WORD (3 Day ROR, ROR, right of rescission) — a bare /ror/
// also matched "Subscription ERROR" and pulled real cancels into the ROR step.
function _isRorReason(x) { return crmReasonIs('ror', x); }   // → src/12-crm-vocab.js (RIDD default: “3 Day ROR” / rescission)
const RETEN_POP_EXCL_REASONS_DEFAULT = ['3 Day ROR', 'Combined Subscriptions', 'Renewal - Outbound', 'Renewal - Loyalty', 'Renewal - Service Pro Upsell', 'Renewal - Inbound'];
// These three getters are called PER ROW inside 77k-row filters, so they
// memoize on (admin rules, cancel config, what-if, tab) — rebuilding a Set
// per row was the reason Attrition Steps took seconds to open.
const _retenMemo = { key: null, pop: null, terms: null, excl: null };
function _retenMemoKey() { return JSON.stringify([_adminRules() || null, state._retenWhatIf || null, state.reportingSubTab, (state.reportingCancelConfig || []).length, state._reportingCancelConfigStamp || 0]); }
function _retenMemoGet(slot, build) {
  const k = _retenMemoKey();
  if (_retenMemo.key !== k) { _retenMemo.key = k; _retenMemo.pop = _retenMemo.terms = _retenMemo.excl = null; }
  if (_retenMemo[slot] == null) _retenMemo[slot] = build();
  return _retenMemo[slot];
}
function retenPopExclReasons() { return _retenMemoGet('pop', _retenPopExclReasonsBuild); }
function _retenPopExclReasonsBuild() {
  const r = _adminRules(); const v = r && Array.isArray(r.retenPopExclReasons) ? r.retenPopExclReasons : RETEN_POP_EXCL_REASONS_DEFAULT;
  let list = v.map(_normCancelReason);
  // What-if switches on the Retention tab: the 3-day ROR reason and the
  // combined / renewal reasons can be turned off separately.
  if (!_retenWhatIf('popRor', true)) list = list.filter(x => !_isRorReason(x));
  if (!_retenWhatIf('popCombined', true)) list = list.filter(x => !crmReasonIs('combined', x));
  if (!_retenWhatIf('popRenew', true)) list = list.filter(x => _isRorReason(x) || crmReasonIs('combined', x));
  return new Set(list);
}
function setRetenPopExclReasons(arr) { _setAdminRule('retenPopExclReasons', arr); }
// Step 3 exemption: one-service subs whose service name contains one of
// these terms stay in the book (Sentricon is annual - one visit a year IS
// the service).
function retenOneSvcExemptTerms() { return _retenMemoGet('terms', () => {
  const r = _adminRules(); const v = r && Array.isArray(r.retenOneSvcExempt) ? r.retenOneSvcExempt : ['sentricon'];
  return v.map(x => String(x).toLowerCase()).filter(Boolean);
}); }
function setRetenOneSvcExemptTerms(arr) { _setAdminRule('retenOneSvcExempt', arr); }
function _retenOneSvcExempt(r) {
  // The Sentricon exemption is its own toggle on the Retention tab; the
  // current-year exemption below is the sheet's Step 6 and always applies.
  const name = String(r.subscription || '').toLowerCase();
  if (_retenWhatIf('oneSvcExempt', true) && retenOneSvcExemptTerms().some(t => name.includes(t))) return true;
  // Step 4: current-year accounts are exempt - they are just young, not dead.
  const _sd = r.sold_date ? new Date(r.sold_date) : (r.initial_service ? new Date(r.initial_service) : null);
  const _yr = _sd && !isNaN(_sd) ? _sd.getFullYear() : null;
  return _yr != null && _yr >= new Date().getFullYear();
}
// One test, shared by the Retention tab prep + its population export.
// Order = Isaac's hand method: (1) drop subs closed by ROR / combine /
// renewal, (2) drop $0 ARR, (3) drop one-service subs unless Sentricon or
// (4) current-year.
function retenIsRorSub(r) {
  // 3-day ROR at the SUBSCRIPTION level (per Isaac): the reason says so, OR
  // the door-to-door sub was cancelled within 3 days of the sale whatever
  // reason got typed.
  if (!r.subscription_date_canceled) return false;
  // Timing-based catch (cancelled within 3 days, reason miscoded) is a
  // separate toggle on the Retention tab — the hand sheet only uses the reason.
  return _isRorReason(_normCancelReason(reportingCancelReasonOf(r))) || (_retenWhatIf('popRorTiming', true) && _reporting3dayRor(r));
}
function retenPopulationExcluded(r) {
  const popSet = retenPopExclReasons();
  if ([...popSet].some(_isRorReason) && retenIsRorSub(r)) return 'closed by 3 Day ROR';
  if (r.subscription_date_canceled && popSet.has(_normCancelReason(reportingCancelReasonOf(r)))) return 'closed by ' + String(reportingCancelReasonOf(r) || '').trim();
  if (retenExclRenewalSubs() && reportingSourceClass(r.subscription_source) === 'renewal') return 'renewal sub';
  if (retenExclZeroPay() && (Number(r.annual_recurring_value) || 0) <= 0) return '$0 paying';
  const svc = Number(r.subscription_completed_services) || 0;
  if (retenExclOneSvc() && svc <= 1 && !_retenOneSvcExempt(r)) return 'under 2 services';
  // Frozen after a single visit is a dead-on-arrival account in ANY year
  // (per Isaac's hand method, Sep 2026): the current-year exemption above
  // only protects accounts that are still alive and just young. Sentricon
  // (annual) stays exempt.
  if (retenExclFrozenOneSvc() && /frozen/i.test(String(r.subscription_status || '')) && svc <= 1 && !retenOneSvcExemptTerms().some(t => String(r.subscription || '').toLowerCase().includes(t))) return 'frozen, 1 service';
  return null;
}
function reportingActiveInclOneTime() {
  const r = _adminRules(); if (r && typeof r.activeInclOneTime === 'boolean') return r.activeInclOneTime;
  try { return localStorage.getItem('ridd_rpt_active_onetime') === '1'; } catch { return false; } }
function setReportingActiveInclOneTime(b) { _setAdminRule('activeInclOneTime', !!b); try { localStorage.setItem('ridd_rpt_active_onetime', b ? '1' : '0'); } catch {} }
function reportingExcludedBranches() {
  const r = _adminRules(); if (r && Array.isArray(r.excludedBranches)) return new Set(r.excludedBranches);
  try { return new Set(JSON.parse(localStorage.getItem('ridd_rpt_excl_branches') || '[]')); } catch { return new Set(); } }
function setReportingExcludedBranches(arr) { _setAdminRule('excludedBranches', [...arr]); try { localStorage.setItem('ridd_rpt_excl_branches', JSON.stringify([...arr])); } catch {} }
function reportingBranchRenames() {
  const r = _adminRules(); if (r && r.branchRenames && typeof r.branchRenames === 'object') return r.branchRenames;
  try { return JSON.parse(localStorage.getItem('ridd_rpt_branch_renames') || '{}') || {}; } catch { return {}; } }
function setReportingBranchRename(from, to) { try { const m = { ...reportingBranchRenames() }; if (to && to !== from) m[from] = to; else delete m[from]; _setAdminRule('branchRenames', m); localStorage.setItem('ridd_rpt_branch_renames', JSON.stringify(m)); } catch {} }
function reportingAllBranches() { const s = new Set(); for (const r of (state.reportingSubscriptions || [])) { const o = (r.office_name || '').trim(); if (o) s.add(o); } return [...s].sort(); }
function _reporting3dayRor(r) {
  if (!_reporting3dayRorByDates(r)) return false;
  // A sub with MORE THAN ONE completed appointment was really serviced (per
  // Isaac, Sep 21): whatever the CRM dates say, nobody rescinded it. Those
  // stay in the book — and if the cancel reason is a renewal, the renewals
  // step later treats them as retained. A step on Retention (default ON)
  // shows them and can switch the exemption off to see them as RORs.
  const keepServiced = (typeof _retenWhatIf === 'function') ? _retenWhatIf('popRorServiced', true) : true;
  if (keepServiced && (Number(r.subscription_completed_services) || 0) > 1) return false;
  return true;
}
// The pure dates test: door-to-door, cancelled within 3 days of the sale.
function _reporting3dayRorByDates(r) {
  if (!r.subscription_date_canceled || !r.sold_date) return false;
  // 3-day ROR is a DOOR-TO-DOOR contract right (per Isaac) - office staff
  // and technician sales don't get one, so a quick cancel there is a real
  // cancel (or a miscoded reason to fix), never an ROR exclusion. Blank
  // sold-by types keep the old behavior (legacy rows, benefit of the doubt).
  const _t = String(r.sold_by_type || '').trim();
  if (_t && !crmSellerIs('sales_rep', _t)) return false;   // seller-type vocabulary (src/12-crm-vocab.js)
  const d = (new Date(r.subscription_date_canceled) - new Date(r.sold_date)) / 86400000;
  return d >= 0 && d <= crmRorWindowDays();   // rescission window is state law — configurable, RIDD = 3
}
// Apply branch exclusions + renames to a row set (used by every reporting scope).
function reportingApplyBranchRules(rows) {
  const excl = reportingExcludedBranches();
  const ren = reportingBranchRenames();
  const hasRen = Object.keys(ren).length > 0;
  if (!excl.size && !hasRen) return rows;
  const out = [];
  for (const r of rows) {
    const o = (r.office_name || '').trim();
    if (excl.has(o)) continue;
    out.push(hasRen && ren[o] ? { ...r, office_name: ren[o] } : r);
  }
  return out;
}

// Turn the synced reporting snapshot into the exact Sales-Report CSV shape the
// Indicators parser expects — so Indicators can run off the same RevHawk data
// (with the sale TIME, from sold_at, preserved for the time-of-day charts).
// Header names are chosen to match parseIndicatorsCsv's column detection.
function reportingSnapshotToIndicatorsCsv(rows) {
  const fmtDate = (r) => {
    const raw = r.sold_at || r.sold_date || '';
    const m = String(raw).match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}:\d{2}(?::\d{2})?))?/);
    if (!m) return '';
    const date = m[2] + '/' + m[3] + '/' + m[1];     // MM/DD/YYYY (parser wants slashes)
    return m[4] ? (date + ' ' + m[4]) : date;         // append 24h time when present
  };
  const esc = (v) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const headers = ['Office', 'Date Sold', 'Customer Id', 'Customer Name', 'Subscription', 'Active', 'Cancellation Reason', 'Cancellation Date', 'Age', 'Source', 'Contract', 'Contract Value', 'Initial Price', 'Annual Recurring Value', 'Completed Services', 'Status', 'Auto Pay', 'Sales Rep', 'Sales Rep Id', 'Sales Rep Type', 'Customer Flags', 'Serviced Date', 'Initial Status'];
  const lines = [headers.join(',')];
  for (const r of (rows || [])) {
    lines.push([
      r.office_name || '', fmtDate(r), r.customer_id || '', [r.last_name, r.first_name].filter(Boolean).join(', '),
      r.subscription || '', r.subscription_status || '', r.subscription_cancellation_reason || '', r.subscription_date_canceled || '',
      r.days_past_due || 0, r.subscription_source || '', r.agreement_length || 0, r.subscription_contract_value || 0, r.initial_price || 0,
      r.annual_recurring_value || 0, r.subscription_completed_services || 0, r.subscription_status || '', r.customer_auto_pay || '',
      r.sold_by || '', r.sold_by_id || '', r.sold_by_type || '', r.customer_flags || '', r.initial_serviced_date || '', r.initial_status || '',
    ].map(esc).join(','));
  }
  return lines.join('\n');
}

// HANDS-OFF nightly Indicators: when a fresher Reporting snapshot exists than
// the current Indicators dataset, rebuild Indicators from it automatically (and
// push to the shared cloud copy). Runs on boot for admins, so the morning after
// the nightly sync the first admin to open the app makes Indicators current for
// everyone — no clicks. Idempotent + guarded so it does the heavy work at most
// once per new snapshot per browser, and prefers a cloud copy another admin
// already derived.
async function autoDeriveIndicatorsFromSnapshot() {
  // RETIRED — the sync job derives the shared dataset server-side on every
  // run, so no browser rebuilds or uploads it anymore. One writer (the
  // server), many readers (every device pulls the same blob). This client
  // fallback predates the server derive and could race it: an admin's
  // browser doing a heavy local rebuild + push while the server had already
  // published a fresher copy — subtle inconsistency between users.
  return;
  /* eslint-disable no-unreachable */
  if ((typeof DEMO !== 'undefined' && DEMO) || !state.profile || !isAdminRole(state.profile?.role)) return;
  const up = (state.reportingUploads || [])[0];                  // newest snapshot
  if (!up || !up.uploaded_at) return;
  const snapAt = new Date(up.uploaded_at).getTime();
  const indAt  = state.indicatorsUploadedAt ? new Date(state.indicatorsUploadedAt).getTime() : 0;
  if (indAt >= snapAt) return;                                   // Indicators already ≥ snapshot
  if (state._indicatorsBuiltFromUploadId === up.id) return;      // already built from this one here
  state._indicatorsBuiltFromUploadId = up.id;                    // claim it (prevents re-entry)
  try {
    // Prefer a copy another admin already derived + shared.
    if (typeof refreshIndicatorsFromCloud === 'function') await refreshIndicatorsFromCloud(true);
    const indAt2 = state.indicatorsUploadedAt ? new Date(state.indicatorsUploadedAt).getTime() : 0;
    if (indAt2 >= snapAt) return;                                // cloud copy was fresh enough
    // Otherwise build locally from the snapshot rows.
    let rows = state.reportingSubscriptions;
    if ((!rows || !rows.length || state.reportingSubscriptionsLoadedFor !== up.id) && typeof loadReportingSubscriptions === 'function') {
      rows = await loadReportingSubscriptions(up.id);
      if (rows) { state.reportingSubscriptions = rows; state.reportingSubscriptionsLoadedFor = up.id; }
    }
    if (!rows || !rows.length) return;
    state.indicatorsData = parseIndicatorsCsv(reportingSnapshotToIndicatorsCsv(rows)); // also sets _indicatorRawSales
    state.indicatorsWeek = -1;
    state.indicatorsUploadedAt = up.uploaded_at;                 // tie freshness to the snapshot
    state.indicatorsFileName = 'RevHawk sync — ' + new Date(up.uploaded_at).toLocaleDateString();
    if (typeof captureIndicatorSnapshot === 'function') captureIndicatorSnapshot();
    saveDemoData();
    if (typeof syncIndicatorsToCloud === 'function') await syncIndicatorsToCloud();
    if (state.view === 'indicators') mountApp();
  } catch (e) { console.warn('[ridd] auto-derive indicators failed', e); state._indicatorsBuiltFromUploadId = null; }
}

// ── Home-screen install (#8) ──────────────────────────────────────────────
// Chrome/Edge/Android fire beforeinstallprompt when the app is installable;
// we stash it so ⚙ My Settings can offer a real Install button. iOS never
// fires it — the settings sheet shows Add-to-Home-Screen instructions there.
window._riddInstallEvt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  window._riddInstallEvt = e;
});

// ── Hover tooltips ────────────────────────────────────────────────────────
// One styled bubble for the whole app. Anything carrying a title (every
// icon-only button already does) gets a proper popup on hover instead of the
// browser's plain delayed tooltip. The title is moved to data-tip on first
// hover so the native bubble never doubles up; code that re-sets .title later
// (spinners, toggles) keeps working — the next hover re-converts it.
(() => {
  let tipEl = null, showT = null, cur = null;
  const hide = () => { clearTimeout(showT); showT = null; cur = null; if (tipEl) tipEl.style.opacity = '0'; };
  const ensure = () => {
    if (!tipEl) { tipEl = document.createElement('div'); tipEl.className = 'app-tip'; document.body.appendChild(tipEl); }
    return tipEl;
  };
  document.addEventListener('pointerover', (e) => {
    const t = e.target && e.target.closest && e.target.closest('[title], [data-tip]');
    if (!t || t === cur) return;
    cur = t;
    if (t.hasAttribute('title')) { t.dataset.tip = t.getAttribute('title'); t.removeAttribute('title'); }
    const text = t.dataset.tip;
    if (!text) { cur = null; return; }
    clearTimeout(showT);
    showT = setTimeout(() => {
      if (cur !== t) return;
      const tip = ensure();
      tip.textContent = t.dataset.tip;   // re-read — may have been updated
      tip.style.display = 'block';
      const r = t.getBoundingClientRect();
      const tw = tip.offsetWidth, th = tip.offsetHeight;
      let x = r.left + r.width / 2 - tw / 2;
      x = Math.max(8, Math.min(x, window.innerWidth - tw - 8));
      let y = r.top - th - 8;
      if (y < 8) y = r.bottom + 8;
      tip.style.left = x + 'px'; tip.style.top = y + 'px';
      tip.style.opacity = '1';
    }, 250);
  }, true);
  document.addEventListener('pointerout', (e) => {
    if (!cur) return;
    const to = e.relatedTarget;
    if (to && cur.contains(to)) return;
    if (e.target === cur || cur.contains(e.target)) hide();
  }, true);
  document.addEventListener('pointerdown', (e) => {
    // Touch: the tap that opens a tip also fires pointerdown — keep the tip
    // when the press is on the tipped element itself; any other tap hides.
    if (cur && e.target && (e.target === cur || cur.contains(e.target))) return;
    hide();
  }, true);
  window.addEventListener('scroll', hide, true);
})();

// ── Live scoreboard freshness ───────────────────────────────────────────
// The RevHawk cron lands a fresh snapshot every 30 minutes; an OPEN app also
// checks every 10 minutes (visible tabs only) so a wallboard stays current
// without a reload. Both are cheap no-ops when nothing new has landed —
// autoDeriveIndicatorsFromSnapshot bails unless a newer snapshot exists, and
// non-admin tabs just pull the cloud copy another admin already derived.
setInterval(() => {
  try {
    if (document.hidden || (typeof DEMO !== 'undefined' && DEMO) || !state.profile) return;
    if (isAdminRole(state.profile?.role)) {
      Promise.resolve(typeof loadReportingMetadata === 'function' ? loadReportingMetadata() : null)
        .then(() => autoDeriveIndicatorsFromSnapshot())
        .catch(e => console.warn('[ridd] live refresh failed', e));
    } else if (typeof refreshIndicatorsFromCloud === 'function') {
      refreshIndicatorsFromCloud().catch(() => {});
    }
  } catch (e) { console.warn('[ridd] live refresh tick failed', e); }
}, 10 * 60 * 1000);

// PHONES: background tabs get their timers throttled or suspended, and the
// tick above deliberately skips hidden tabs — so a phone reopening the app
// could sit on numbers up to 10 minutes old. Waking the app = check NOW.
// (refreshIndicatorsFromCloud's internal 2-min throttle keeps rapid app
// switching free; a phone that was pocketed for an hour gets an instant
// refresh.) This is what makes mobile sync behave exactly like a desktop
// tab that never sleeps.
document.addEventListener('visibilitychange', () => {
  try {
    if (document.hidden || (typeof DEMO !== 'undefined' && DEMO) || !state.profile) return;
    if (typeof refreshIndicatorsFromCloud === 'function') refreshIndicatorsFromCloud().catch(() => {});
    if (isAdminRole(state.profile?.role)) {
      Promise.resolve(typeof loadReportingMetadata === 'function' ? loadReportingMetadata() : null)
        .then(() => autoDeriveIndicatorsFromSnapshot())
        .catch(() => {});
    }
  } catch (e) { /* never break the app on wake */ }
});

// ── Pull-to-refresh (installed app) ─────────────────────────────────────
// Standalone/home-screen mode has no browser chrome, so there's no native
// swipe-down refresh. This recreates it: pull down from the very top of a
// page ≥70px and release → a quick conditional sync (ETag'd — the server
// answers "unchanged" in ~100ms, or ships fresh data when there is some).
// Touch-only, standalone-only (regular Safari keeps its own native PTR),
// and inert while a modal sheet is open.
(() => {
  const isStandalone = () =>
    (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true;
  let startY = 0, pulling = false, armed = false, busy = false;
  const THRESH = 70;
  let bubble = null;
  const ensureBubble = () => {
    if (bubble) return bubble;
    bubble = el('div', {
      id: 'ptr-bubble',
      style: {
        position: 'fixed', left: '50%', top: 'calc(env(safe-area-inset-top, 0px) + 64px)',
        transform: 'translateX(-50%) scale(.6)', zIndex: 4000,
        width: '38px', height: '38px', borderRadius: '0',
        background: 'var(--card)', border: '1px solid var(--border-2)',
        boxShadow: 'var(--shadow-lg)', display: 'flex', alignItems: 'center',
        justifyContent: 'center', fontSize: '18px', opacity: '0',
        transition: 'opacity .12s ease, transform .12s ease', pointerEvents: 'none',
      },
    }, el('span', { id: 'ptr-glyph', style: { display: 'inline-block' } }, '↓'));
    document.body.append(bubble);
    return bubble;
  };
  const glyph = () => (ensureBubble(), document.getElementById('ptr-glyph'));
  const setBubble = (dy) => {
    const b = ensureBubble();
    const p = Math.min(dy / THRESH, 1);
    b.style.opacity = String(Math.min(p * 1.2, 1));
    b.style.transform = 'translateX(-50%) scale(' + (0.6 + p * 0.4) + ')';
    const g = glyph(); if (g) { g.textContent = '↓'; g.style.animation = ''; g.style.transform = 'rotate(' + (p * 180) + 'deg)'; }
  };
  const hideBubble = () => { if (bubble) { bubble.style.opacity = '0'; bubble.style.transform = 'translateX(-50%) scale(.6)'; } };
  const spinBubble = () => {
    const b = ensureBubble();
    b.style.opacity = '1';
    b.style.transform = 'translateX(-50%) scale(1)';
    const g = glyph(); if (g) { g.textContent = '↻'; g.style.transform = ''; g.style.animation = 'spin 0.8s linear infinite'; }
  };
  const stopSpin = () => { const g = document.getElementById('ptr-glyph'); if (g) g.style.animation = ''; hideBubble(); };

  document.addEventListener('touchstart', (e) => {
    if (!isStandalone() || busy) return;
    if (window.scrollY > 0) return;                                   // only from the very top
    if (document.querySelector('.modal-overlay')) return;             // sheets scroll themselves
    startY = e.touches[0].clientY;
    pulling = true; armed = false;
  }, { passive: true });

  document.addEventListener('touchmove', (e) => {
    if (!pulling) return;
    const dy = e.touches[0].clientY - startY;
    if (window.scrollY > 0 || dy < 10) { hideBubble(); armed = false; return; }
    setBubble(dy);
    armed = dy >= THRESH;
  }, { passive: true });

  document.addEventListener('touchend', async () => {
    if (!pulling) return;
    pulling = false;
    if (!armed || busy) { hideBubble(); return; }
    armed = false; busy = true;
    const began = Date.now();
    spinBubble();
    try {
      _indCloudCheckedAt = 0;                                         // bypass the 2-min throttle — this is an explicit gesture
      await Promise.allSettled([
        (typeof refreshIndicatorsFromCloud === 'function') ? refreshIndicatorsFromCloud(true) : null,
        (typeof refreshSalesData === 'function' && state.profile && !isAdminRole(state.profile?.role)) ? refreshSalesData() : null,
      ]);
      if (typeof mountApp === 'function') mountApp();
    } catch (e) { console.warn('[ridd] pull-to-refresh failed', e); }
    finally {
      // keep the spinner visible ≥400ms so a 304 doesn't feel like a misfire
      setTimeout(() => { stopSpin(); busy = false; }, Math.max(0, 400 - (Date.now() - began)));
    }
  }, { passive: true });
})();

// One-click RevHawk refresh behind the header sync icon. Fires the admin-gated
// background sync, waits for the FRESH snapshot to land in Supabase, then loads
// it into Reporting AND rebuilds Indicators from it (sale times preserved). The
// passed button gets a spinner + disabled state for the whole round-trip.
async function syncFromRevHawk(btn) {
  if (state._revhawkSyncing) return;
  if (state._revhawkLandWatch) { toast('A sync is already running — it pulls in on its own when it lands', 'info'); return; }
  if (typeof DEMO !== 'undefined' && DEMO) { toast('Live sync isn’t available in demo mode', 'info'); return; }
  // FIRE-AND-FORGET: kick the server job and give the button back right
  // away. The job runs 1–2+ min in the background (BigQuery scan → snapshot
  // → derive → roster/auto-add/verify blocks) — the old blocking poll kept
  // the button spinning that whole time. A temporary watcher below pulls the
  // fresh dataset in the moment it lands; the global freshness watch is the
  // backstop after that.
  state._revhawkSyncing = true;
  if (btn) { btn.classList.add('icon-spin'); btn.disabled = true; btn.title = 'Starting sync…'; }
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const token = session && session.access_token;
    if (!token) { toast('Sign in required', 'error'); return; }

    // Remember the newest snapshot so the watcher can spot the new one.
    const beforeTop = (state.reportingUploads || [])[0] || null;
    const beforeId = beforeTop && beforeTop.id;
    const beforeAt = beforeTop && beforeTop.uploaded_at;

    const r = await fetch('/api/revhawk-sync-now', { method: 'POST', headers: { Authorization: 'Bearer ' + token } });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok) { toast('Sync failed: ' + (j.error || ('HTTP ' + r.status)), 'error'); return; }
    toast('Sync started — fresh numbers land in a minute or two and pull in automatically', 'info');

    // While the CRM job cooks in the background, re-pull everything ELSE
    // the app reads — cheap direct reads, all best-effort: logged sales +
    // audit statuses, shared config (teams/tiers/comps), and the roster
    // mirror. The shared dataset check rides along (usually 304 until the
    // job lands; the watcher below catches the real thing).
    try {
      await Promise.all([
        (typeof refreshSalesData === 'function') ? refreshSalesData().catch(() => {}) : null,
        (typeof loadIndicatorConfigFromSupabase === 'function') ? loadIndicatorConfigFromSupabase().catch(() => {}) : null,
        (typeof loadFieldRoutesRoster === 'function') ? loadFieldRoutesRoster(true).catch(() => {}) : null,
        (typeof refreshIndicatorsFromCloud === 'function') ? refreshIndicatorsFromCloud(true).catch(() => {}) : null,
      ]);
      mountApp();
    } catch (e) { console.warn('inline refresh during sync failed', e); }

    // QuickBooks marketing spend is served live (not a stored snapshot) —
    // refresh it inline; it’s quick and independent. Best-effort.
    state._mkBust = Date.now();
    state._mkSpend = state._mkLeads = state._mkQbo = null;
    try {
      const qr = await fetch('/api/qbo-spend?_=' + state._mkBust, { headers: await _apiAuthHeaders() });
      const qj = qr.ok ? await qr.json() : null;
      if (qj && qj.bySourceMonth && Object.keys(qj.bySourceMonth).length) {
        state.reportingIsSpend = qj.bySourceMonth;
        state._isSpendSource = 'QuickBooks';
        state._isSpendPulledAt = qj.pulledAt;
        state._isSpendLoading = false;
      }
    } catch (e) { console.warn('QBO refresh during sync failed', e); }

    // Landing watch — every 20s for up to 15 min, NON-blocking (the button
    // is already released). Applies the new snapshot to Reporting and pulls
    // the server-derived indicators blob the moment they exist.
    if (state._revhawkLandWatch) clearInterval(state._revhawkLandWatch);
    let tries = 0;
    state._revhawkLandWatch = setInterval(async () => {
      tries++;
      try {
        if (typeof loadReportingMetadata === 'function') await loadReportingMetadata();
        const top = (state.reportingUploads || [])[0];
        const isNew = top && top.id !== beforeId && (!beforeAt || (top.uploaded_at && top.uploaded_at > beforeAt));
        if (isNew) {
          clearInterval(state._revhawkLandWatch); state._revhawkLandWatch = null;
          state.reportingActiveUploadId = top.id;
          let rows = null;
          if (typeof loadReportingSubscriptions === 'function') {
            rows = await loadReportingSubscriptions(top.id);
            if (rows) { state.reportingSubscriptions = rows; state.reportingSubscriptionsLoadedFor = top.id; }
          }
          // Server-derived blob is the source of truth (single writer);
          // local rebuild only fires when the server’s derive is missing.
          try { if (typeof refreshIndicatorsFromCloud === 'function') await refreshIndicatorsFromCloud(true); } catch { /* fallback below */ }
          const snapAt = Date.parse(top.uploaded_at || '') || 0;
          const indAt = state.indicatorsUploadedAt ? Date.parse(state.indicatorsUploadedAt) : 0;
          if (rows && rows.length && !(snapAt && indAt >= snapAt)) {
            try {
              console.warn('[ridd] server-derived indicators blob not available — rebuilding locally (fallback)');
              state.indicatorsData = parseIndicatorsCsv(reportingSnapshotToIndicatorsCsv(rows));
              state.indicatorsWeek = -1;
              state.indicatorsUploadedAt = top.uploaded_at || new Date().toISOString();
              state.indicatorsFileName = 'RevHawk sync — ' + new Date().toLocaleDateString();
              if (typeof captureIndicatorSnapshot === 'function') captureIndicatorSnapshot();
              // NO cloud push — the server is the only writer of the shared
              // blob. This rebuild is device-local scaffolding until the
              // server's derive lands (found a client overwrite at 7:48pm
              // on 7/11 via /api/sync-status — that class of race ends here).
            } catch (e) { console.warn('Indicators rebuild after sync failed', e); }
          }
          if (typeof saveDemoData === 'function') saveDemoData();
          toast('Fresh CRM data just landed' + (rows ? ' — ' + rows.length.toLocaleString() + ' subscriptions' : ''), 'success');
          mountApp();
        } else if (tries >= 45) {
          clearInterval(state._revhawkLandWatch); state._revhawkLandWatch = null;
          toast('Sync is taking longer than usual — if the stamp doesn’t move, check the Netlify function logs', 'info');
        }
      } catch (e) {
        if (tries >= 45) { clearInterval(state._revhawkLandWatch); state._revhawkLandWatch = null; }
      }
    }, 20000);
  } catch (err) {
    toast('Sync failed: ' + (err && err.message || err), 'error');
  } finally {
    state._revhawkSyncing = false;
    if (btn) { btn.classList.remove('icon-spin'); btn.disabled = false; btn.title = 'Manual sync — refreshes everything: kicks a fresh CRM pull (lands in ~1–2 min) and re-pulls app sales, config, roster, QuickBooks + marketing feeds right away. Costs a full BigQuery scan; the hourly schedule is the normal path.'; }
  }
}

