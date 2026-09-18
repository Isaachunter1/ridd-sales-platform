// ── 2026 competition season (per Isaac, from the whyridd.com schedule) ──
// Sanctioned comps in calendar order. Mystery Boxes and Avg Pest & Raffle
// are one-offs and live in their own dropdown on the landing page.
const COMP_2026_ORDER = ['genesis', 'greatest_day', 'top_gun', 'spring_cleaning', 'last_man_standing', 'pr_week', 'nrla', 'unknwn', 'team_week', 'kobe_week'];
// The Greatest Day in D2D = the Labor Day comp, every year (per Isaac); the
// 2026 schedule shows it May 25 (Memorial Day) — same idea, one big day.
const COMP_2026_NEW = [['genesis', 'Genesis'], ['greatest_day', 'The Greatest Day in D2D'], ['pr_week', 'PR Week'], ['unknwn', 'UNKNWN'], ['team_week', 'Team Week']];
const COMP_2026_WINDOWS = {
  genesis: ['2026-05-04', '2026-05-23'], greatest_day: ['2026-05-25', '2026-05-25'], top_gun: ['2026-05-25', '2026-06-06'],
  spring_cleaning: ['2026-06-08', '2026-06-20'], last_man_standing: ['2026-06-20', '2026-06-20'], pr_week: ['2026-06-22', '2026-06-27'],
  nrla: ['2026-07-06', '2026-07-18'], unknwn: ['2026-07-20', '2026-07-25'], team_week: ['2026-07-27', '2026-08-01'], kobe_week: ['2026-08-03', '2026-08-08'],
};
const COMP_ONE_OFFS = new Set(['mystery_box', 'avg_pest_initial', 'koth']);   // KOTH (biggest days of the summer) is a one-off too (per Isaac)

// Rules popup for NRLA (the header ⓘ).
function openNrlaHelpModal() {
  const NAVY = '#0E1C30', PINK = '#F2148C';
  const overlay = el('div', { class: 'modal-overlay' });
  const close = () => { overlay.remove(); document.removeEventListener('keydown', key); };
  const key = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', key);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  const block = (title, body) => el('div', { class: 'mb-3' },
    el('div', { class: 'text-[11px] uppercase tracking-widest font-bold mb-1', style: { color: PINK } }, title),
    el('div', { class: 'text-[13px] leading-relaxed', style: { color: 'var(--text-muted)' } }, body));
  const card = el('div', { class: 'card w-full max-w-lg my-8 overflow-hidden flex flex-col', style: { maxHeight: 'calc(100vh - 64px)' } },
    el('div', { class: 'flex items-start justify-between px-5 py-3', style: { background: NAVY } },
      el('div', {},
        el('div', { class: 'text-[10px] uppercase tracking-widest font-semibold', style: { color: '#fff', opacity: '0.8' } }, 'RIDDMADE ★ Branch vs Branch'),
        el('h2', { class: 'text-lg font-black mt-0.5', style: { color: '#fff', textTransform: 'uppercase' } }, 'NRLA — Rules'),
      ),
      el('button', { class: 'text-2xl leading-none', style: { color: '#fff' }, onclick: close }, '×'),
    ),
    el('div', { class: 'overflow-auto px-5 py-4' },
      block('Format', '4 seeding rounds, 1 playoff (semifinal) round, 1 championship round. Every round is a 2-day block, Sundays skipped. 2026 season: July 6 – July 18.'),
      block('The metric', 'Win rounds by having a higher Per Rep Average than the team you\'re competing against. PRA = the round\'s QUALIFYING revenue (Passed + Pending audit accounts, Contract Value) ÷ reps competing. Failed Audit and Last Resort (<$99) revenue never counts toward the comp.'),
      block('What counts', 'Pending/Serviced accounts only. An account sold but never serviced — no appointment scheduled, cancelled at the door, or the initial appointment cancelled — is excluded from every number. Pending-audit accounts count as passing until flagged. Note: a brand-new sale may not show until the sync delivers its appointment — the synced data is always the source of truth.'),
      block('Round lock', 'A round\'s result is provisional (AUDITING badge) until every account in it has been audited — then it locks and shows FINAL. Audits landing as Failed pull that revenue out, so a tight matchup can flip before the lock.'),
      block('Seeding', 'After the seeding rounds, teams are ranked #1 through #8 by: 1. overall record · 2. head-to-head result · 3. total cumulative PRA.'),
      block('Playoffs', 'Semifinals: #1 vs #4, #2 vs #3, #5 vs #8, #6 vs #7. Championship round: semifinal winners meet in the 1st (and 5th) place matches, losers in the 3rd (and 7th) — every team plays for its final placement.'),
      block('Prize pool', 'Per rep, by final placement: 1st ®400K + Team Trip · 2nd ®325K · 3rd ®250K · 4th ®175K · 5th ®125K · 6th ®100K · 7th ®75K · 8th ®50K.'),
      block('Who counts', 'Sales-Rep (D2D) production only. Rosters (📋) are authoritative: a rostered rep counts for THAT team wherever they knock, and a team with a roster counts only its rostered reps. Roster size is the PRA denominator. Teams without a roster count everyone on the branch (denominator = reps who sold this season).'),
      block('Revenue columns', 'Total Rev Sold = everything sold in the season windows. Passed = Passed Audit / No Audit · Pending = not audited yet · Failed = Failed Audit + Last Resort (<$99). Informational — rounds are won on PRA.'),
      block('Updates', 'Updates will be sent daily.'),
    ),
  );
  overlay.append(card);
  document.body.append(overlay);
}

// Rep → team transfer modal — NRLA flavor of the Spring Cleaning market
// modal, writing to the same comp.repBranchOverrides store.
function openNrlaRepMarketModal(sales) {
  const comp = (typeof getActiveComp === 'function') ? getActiveComp() : null;
  if (!comp) { toast('No active competition', 'error'); return; }
  if (!comp.repBranchOverrides || typeof comp.repBranchOverrides !== 'object') comp.repBranchOverrides = {};
  const NAVY = '#0B4F9E';
  const overlay = el('div', { class: 'modal-overlay' });
  const close = () => { overlay.remove(); mountApp(); };
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  const card = el('div', { class: 'card w-full max-w-xl my-8 overflow-hidden flex flex-col', style: { maxHeight: 'calc(100vh - 64px)' } });
  overlay.append(card);
  const d2d = (sales || []).filter(s => _indicatorDeptOf(s) === 'd2d' && s.rep);
  const byRep = new Map();
  for (const s of d2d) {
    const name = _cleanRepName(getCanonicalRepName(s.rep));
    let r = byRep.get(name);
    if (!r) { r = { counts: {}, n: 0 }; byRep.set(name, r); }
    const o = (s.office || 'UNKNOWN').toUpperCase();
    r.counts[o] = (r.counts[o] || 0) + 1;
    r.n++;
  }
  const homeOf = (r) => Object.entries(r.counts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'UNKNOWN';
  const branches = [...new Set([
    ...d2d.map(s => (s.office || '').toUpperCase()).filter(Boolean),
    ...Object.values(comp.repBranchOverrides).map(b => String(b).toUpperCase()),
  ])].sort();
  const render = () => {
    card.innerHTML = '';
    const q = (state._nrlaRepSearch || '').trim().toLowerCase();
    const names = [...byRep.keys()].sort((a, b) => a.localeCompare(b)).filter(n => !q || n.toLowerCase().includes(q));
    const movedCount = Object.keys(comp.repBranchOverrides).length;
    const searchInput = el('input', {
      type: 'text', value: state._nrlaRepSearch || '', placeholder: 'Search reps…',
      class: 'w-full rounded-lg border px-2.5 py-1 text-[11px]',
      style: { background: 'var(--card)', borderColor: 'var(--border)', color: 'var(--text)' },
    });
    searchInput.addEventListener('input', (e) => { state._nrlaRepSearch = e.target.value; render(); setTimeout(() => { const el2 = card.querySelector('input'); if (el2) { el2.focus(); el2.setSelectionRange(el2.value.length, el2.value.length); } }, 0); });
    card.append(
      el('div', { class: 'flex items-center justify-between px-5 py-4 border-b gap-3', style: { borderColor: 'var(--border)' } },
        el('div', {},
          el('h2', { class: 'text-base font-bold' }, '👥 NRLA Team Assignments'),
          el('div', { class: 'text-[11px] mt-0.5', style: { color: 'var(--text-muted)' } },
            byRep.size + ' D2D reps · ' + movedCount + ' transferred · comp purposes only')),
        el('div', { class: 'flex items-center gap-2' },
          movedCount > 0 && el('button', {
            class: 'rounded-lg border px-2.5 py-1 text-[11px] font-bold cursor-pointer transition hover:brightness-95',
            style: { borderColor: '#DC2626', color: '#DC2626' },
            title: 'Send every transferred rep back to their home team',
            onclick: () => {
              if (!confirm('Reset all ' + movedCount + ' transferred reps back to their home teams?')) return;
              comp.repBranchOverrides = {};
              logActivity('comp_change', { detail: 'NRLA: all rep team transfers reset' });
              saveDemoData();
              render();
            },
          }, '↺ Reset all'),
          el('button', { class: 'text-2xl leading-none', style: { color: 'var(--text-muted)' }, onclick: close }, '×'))),
      el('div', { class: 'px-5 py-3 border-b', style: { borderColor: 'var(--border)' } }, searchInput),
      el('div', { class: 'overflow-y-auto flex-1' },
        ...names.map(name => {
          const r = byRep.get(name);
          const home = homeOf(r);
          const ov = comp.repBranchOverrides[name] ? String(comp.repBranchOverrides[name]).toUpperCase() : '';
          const effective = ov || home;
          const sel = el('select', {
            class: 'rounded-lg px-2.5 py-1 text-[11px] font-semibold cursor-pointer',
            style: ov ? { border: '2px solid ' + NAVY, color: NAVY } : {},
            onchange: (e) => {
              const v = e.target.value;
              if (!v || v === home) delete comp.repBranchOverrides[name];
              else comp.repBranchOverrides[name] = v;
              logActivity('comp_change', { rep_name: name, detail: (!v || v === home) ? name + ' back to home team ' + home + ' (NRLA)' : name + ' transferred to ' + v + ' (NRLA)' });
              saveDemoData();
              render();
            },
          }, ...branches.map(b => { const o = el('option', { value: b }, b + (b === home ? ' (home)' : '')); if (b === effective) o.selected = true; return o; }));
          return el('div', { class: 'flex items-center justify-between gap-3 px-5 py-2 border-b', style: { borderColor: 'var(--border)' } },
            el('div', { class: 'min-w-0' },
              el('div', { class: 'text-sm font-semibold truncate' }, name,
                ov && el('span', { class: 'ml-2 text-[9px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded', style: { background: 'rgba(11,79,158,.12)', color: NAVY } }, 'transferred')),
              el('div', { class: 'text-[10px]', style: { color: 'var(--text-muted)' } },
                r.n + ' acct' + (r.n === 1 ? '' : 's') + ' · knocks ' + home)),
            sel);
        })),
      el('div', { class: 'px-5 py-3 text-[10px] border-t', style: { borderColor: 'var(--border)', color: 'var(--text-subtle)' } },
        'Transfers move ALL of a rep\'s production to the chosen team — baseline goal and every round. Pick the home team to undo. Synced to every admin.'));
  };
  render();
  document.body.append(overlay);
}

// Competing-reps roster editor — pick exactly who competes for each team.
// Saved on the comp (cfg.rosters, synced to every admin). A team with NO
// roster counts everyone knocking under its banner.
function openNrlaRosterModal(rawSales) {
  const comp = (typeof getActiveComp === 'function') ? getActiveComp() : null;
  if (!comp) { toast('No active competition', 'error'); return; }
  const cfg = nrlaConfig(comp);
  const PINK = '#F2148C';
  const overlay = el('div', { class: 'modal-overlay' });
  let _saveTimer = null;
  const close = () => { if (_saveTimer) clearInterval(_saveTimer); overlay.remove(); mountApp(); };
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  const card = el('div', { class: 'card w-full max-w-2xl my-8 overflow-hidden flex flex-col', style: { maxHeight: 'calc(100vh - 64px)' } });
  overlay.append(card);
  // Candidates: every D2D rep, shown under the team they currently count for.
  // Rosters are authoritative — a rostered rep sits under their ROSTER team,
  // wherever they actually knock; everyone else under home branch.
  const d2d = nrlaApplyOverrides((rawSales || []).filter(s => _indicatorDeptOf(s) === 'd2d' && s.rep), comp);
  // Home = where the rep is knocking NOW: majority office during the NRLA
  // season, then the office of their most recent sale, then the all-time
  // majority as the last resort. (All-time alone misled — a rep who moved
  // branches mid-year showed their OLD branch as home.)
  const _rmWindows = nrlaRoundWindows({ start: cfg.start, rounds: cfg.seedRounds + 2 });
  const _rmS = _rmWindows.length ? _rmWindows[0].d1 : null;
  const _rmE = _rmWindows.length ? _rmWindows[_rmWindows.length - 1].d2 : null;
  const repInfo = new Map();   // name → { n, counts, season, lastD, lastT }
  for (const s of d2d) {
    const t = String(s.office || 'UNKNOWN').toUpperCase();
    if (t === 'UNKNOWN') continue;
    const name = _cleanRepName(getCanonicalRepName(s.rep));
    let e = repInfo.get(name);
    if (!e) { e = { n: 0, counts: {}, season: {}, lastD: null, lastT: '' }; repInfo.set(name, e); }
    e.n++; e.counts[t] = (e.counts[t] || 0) + 1;
    const d = _parseIndicatorDay(s);
    if (d && _rmS && d >= _rmS && d <= _rmE) e.season[t] = (e.season[t] || 0) + 1;
    if (d && (!e.lastD || d > e.lastD)) { e.lastD = d; e.lastT = t; }
  }
  const homeOf = (e) => {
    if (!e) return 'UNKNOWN';
    const seasonTop = Object.entries(e.season || {}).sort((a, b) => b[1] - a[1])[0]?.[0];
    return seasonTop || e.lastT || Object.entries(e.counts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'UNKNOWN';
  };
  const rosterTeamOf = (name) => {
    for (const [t, list] of Object.entries(cfg.rosters || {})) {
      if (Array.isArray(list) && list.includes(name)) return String(t).toUpperCase();
    }
    return null;
  };
  const teamOf = (name) => rosterTeamOf(name) || homeOf(repInfo.get(name));
  const teams = [...new Set([
    ...[...repInfo.values()].map(homeOf).filter(t => t !== 'UNKNOWN'),
    ...Object.keys(cfg.rosters || {}).map(t => String(t).toUpperCase()),
  ])].sort();
  const persist = (detail) => { logActivity('comp_change', { detail: 'NRLA: ' + detail }); saveDemoData(); renderList(); };
  // A rep lives on at most ONE roster — adding them to a team strips them
  // from every other team's list first.
  const putOnRoster = (name, t, on) => {
    Object.keys(cfg.rosters).forEach(k => {
      if (Array.isArray(cfg.rosters[k])) cfg.rosters[k] = cfg.rosters[k].filter(x => x !== name);
    });
    if (on) cfg.rosters[t] = [...(cfg.rosters[t] || []), name].sort();
    persist(name + (on ? ' → ' + t + ' roster' : ' off the ' + t + ' roster'));
  };
  // Reassign a rep to the branch they're COMPETING for (the row dropdown).
  // If the target team has no roster yet, seed it with its current members
  // first — otherwise the newcomer would become a one-man roster and knock
  // everyone else on that team out of the comp.
  const assignTo = (name, t2) => {
    if (!t2 || t2 === teamOf(name)) return;
    if (!Array.isArray(cfg.rosters[t2])) {
      cfg.rosters[t2] = [...repInfo.keys()].filter(x => x !== name && teamOf(x) === t2).sort();
    }
    Object.keys(cfg.rosters).forEach(k => {
      if (Array.isArray(cfg.rosters[k])) cfg.rosters[k] = cfg.rosters[k].filter(x => x !== name);
    });
    cfg.rosters[t2] = [...(cfg.rosters[t2] || []), name].sort();
    persist(name + ' reassigned → competes for ' + t2);
  };
  // Every branch a rep could compete for — current teams plus the flyer
  // eight, so a brand-new branch (Joplin) is assignable before it has data.
  // Every branch that has EVER sold D2D — new branches (Little Rock, …)
  // appear here automatically the moment they land in the sync (per Isaac).
  const _allOfficesEver = [...new Set((state._indicatorRawSales || [])
    .filter(s => (typeof _indicatorDeptOf !== 'function' || _indicatorDeptOf(s) === 'd2d') && s.office)
    .map(s => String(s.office).toUpperCase()))];
  const allTeamChoices = [...new Set([...teams, ..._allOfficesEver, ...NRLA_2026_SCHEDULE.flat(2).filter(Boolean)])].sort();
  // Fold a duplicate spelling into the real rep — wraps the app-wide
  // mergeDuplicateRep (alias + per-rep settings), then fixes rosters and
  // rep IDs here so the two rows collapse into one everywhere.
  const doMerge = (bad, good) => {
    state._nrlaMergeSrc = null;
    if (!bad || !good || bad === good) { renderList(); return; }
    const badTeam = rosterTeamOf(bad), goodTeam = rosterTeamOf(good);
    Object.keys(cfg.rosters).forEach(k => {
      if (Array.isArray(cfg.rosters[k])) cfg.rosters[k] = cfg.rosters[k].filter(x => x !== bad);
    });
    if (badTeam && !goodTeam) cfg.rosters[badTeam] = [...new Set([...(cfg.rosters[badTeam] || []), good])].sort();
    if (cfg.repIds[bad]) { if (!cfg.repIds[good]) cfg.repIds[good] = cfg.repIds[bad]; delete cfg.repIds[bad]; }
    mergeDuplicateRep(bad, good);
    // fold the modal's cached counts so the list updates without reopening
    const eb = repInfo.get(bad), eg = repInfo.get(good);
    if (eb && eg) {
      eg.n += eb.n;
      Object.entries(eb.counts).forEach(([t2, n2]) => { eg.counts[t2] = (eg.counts[t2] || 0) + n2; });
      Object.entries(eb.season || {}).forEach(([t2, n2]) => { eg.season[t2] = (eg.season[t2] || 0) + n2; });
      if (eb.lastD && (!eg.lastD || eb.lastD > eg.lastD)) { eg.lastD = eb.lastD; eg.lastT = eb.lastT; }
    } else if (eb && !eg) { repInfo.set(good, eb); }
    repInfo.delete(bad);
    saveDemoData();
    toast('Merged “' + bad + '” into “' + good + '” — their sales now count as one rep everywhere', 'success');
    renderList();
  };

  // ── Static chrome — built ONCE so the search box never loses focus and
  // typing doesn't rebuild the whole modal. Only the list re-renders. ──
  const pickedNote = el('span', {}, '');
  // ── Live save indicator — shows exactly where your edits stand:
  //   Saving…  → sync to the server is in flight
  //   Save     → unsynced changes exist (click to push right now)
  //   ✓ Saved  → everything is on the server; every admin sees it
  const saveBtn = el('button', { class: 'rounded-lg px-2.5 py-1 text-[11px] font-bold cursor-pointer transition shrink-0' }, '…');
  const refreshSaveBtn = () => {
    const busy = typeof _indCfgUpsertBusy !== 'undefined' && _indCfgUpsertBusy;
    const dirty = typeof _indCfgDirty === 'function' && _indCfgDirty();
    if (busy) {
      saveBtn.textContent = 'Saving…';
      Object.assign(saveBtn.style, { background: '#A9441F', color: '#fff', border: 'none' });
      saveBtn.title = 'Syncing to the server…';
    } else if (dirty) {
      saveBtn.textContent = 'Save';
      Object.assign(saveBtn.style, { background: PINK, color: '#fff', border: 'none' });
      saveBtn.title = 'Unsynced changes — click to push them to the server now';
    } else {
      saveBtn.textContent = '✓ Saved';
      Object.assign(saveBtn.style, { background: 'transparent', color: '#DF643A', border: '1px solid #DF643A' });
      saveBtn.title = 'Everything is saved and synced — every admin sees this roster';
    }
  };
  saveBtn.addEventListener('click', () => {
    saveDemoData();               // writes localStorage + kicks the server sync
    refreshSaveBtn();
  });
  _saveTimer = setInterval(refreshSaveBtn, 500);
  refreshSaveBtn();
  const header = el('div', { class: 'flex items-center justify-between px-5 py-4 border-b gap-3', style: { borderColor: 'var(--border)' } },
    el('div', {},
      el('h2', { class: 'text-base font-bold' }, '📋 NRLA Rosters — reps competing'),
      el('div', { class: 'text-[11px] mt-0.5', style: { color: 'var(--text-muted)' } },
        'Only rostered reps count for a team · a team with no roster counts everyone · ', pickedNote)),
    el('div', { class: 'flex items-center gap-2 shrink-0' },
      el('button', {
        class: 'rounded-lg border px-2.5 py-1 text-[11px] font-bold cursor-pointer transition hover:brightness-95',
        style: { borderColor: 'var(--border-2)', color: 'var(--text-muted)' },
        title: 'Config history — every saved change (teams, rosters, comps), with one-click restore',
        onclick: () => openIndicatorConfigHistoryModal(),
      }, '🕘'),
      saveBtn,
      el('button', { class: 'text-2xl leading-none', style: { color: 'var(--text-muted)' }, onclick: close }, '×')));
  const searchInput = el('input', {
    type: 'text', value: state._nrlaRosterSearch || '', placeholder: 'Search reps…',
    class: 'w-full rounded-lg border px-2.5 py-1 text-[11px]',
    style: { background: 'var(--card)', borderColor: 'var(--border)', color: 'var(--text)' },
  });
  let searchTimer = null;
  searchInput.addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { state._nrlaRosterSearch = e.target.value; renderList(); }, 180);
  });
  const listWrap = el('div', { class: 'overflow-y-auto flex-1' });
  // ── Add-rep bar — always visible. For brand-new hires with no synced sales
  // yet: type the name exactly as FieldRoutes puts it on their sales
  // ("Last, First"), pick the team, Add. Their production links up by name
  // the moment their first sale syncs.
  const addName = el('input', {
    type: 'text', placeholder: 'New rep — type it like FieldRoutes shows it ("Brayden Austin" works too)…',
    class: 'flex-1 rounded-lg border px-2.5 py-1 text-[11px] min-w-0',
    style: { background: 'var(--card)', borderColor: 'var(--border)', color: 'var(--text)' },
  });
  const addId = el('input', {
    type: 'text', placeholder: 'Rep ID (optional)',
    class: 'rounded-lg border px-2.5 py-1 text-[11px]',
    style: { width: '110px', background: 'var(--card)', borderColor: 'var(--border)', color: 'var(--text)' },
    title: 'FieldRoutes sales-rep ID (e.g. 19515) — stored with the rep for reference and future ID-based matching',
  });
  const addTeam = el('select', {
    class: 'rounded-lg border px-2.5 py-1 text-[11px] font-semibold cursor-pointer',
    style: { background: 'var(--card)', borderColor: 'var(--border)', color: 'var(--text)' },
  }, ...allTeamChoices.map(b => el('option', { value: b }, b)));
  const doAdd = () => {
    const raw = (addName.value || '').trim();
    if (!raw) { addName.focus(); return; }
    // Sales rows write reps as "Last, First" — if the name came in FieldRoutes
    // profile style ("Brayden Austin"), flip it. And if the rep already exists
    // in the data under either spelling, reuse THAT exact spelling so we never
    // create a duplicate entry.
    const flip = (!raw.includes(',') && raw.split(/\s+/).length >= 2)
      ? raw.split(/\s+/).slice(-1)[0] + ', ' + raw.split(/\s+/).slice(0, -1).join(' ')
      : null;
    const lower = new Map([...repInfo.keys()].map(k => [k.toLowerCase(), k]));
    const typed = _cleanRepName(getCanonicalRepName(raw));
    const nm = lower.get(typed.toLowerCase())
      || (flip && lower.get(_cleanRepName(getCanonicalRepName(flip)).toLowerCase()))
      || _cleanRepName(getCanonicalRepName(flip || raw));
    const id = (addId.value || '').trim();
    if (id) { cfg.repIds[nm] = id; }
    putOnRoster(nm, addTeam.value, true);
    state._nrlaRosterOpen = state._nrlaRosterOpen || {}; state._nrlaRosterOpen[addTeam.value] = true;
    toast('Added as “' + nm + '”' + (id ? ' · ID ' + id : '') + ' → ' + addTeam.value, 'success');
    addName.value = ''; addId.value = '';
    renderList();
  };
  addName.addEventListener('keydown', (e) => { if (e.key === 'Enter') doAdd(); });
  addId.addEventListener('keydown', (e) => { if (e.key === 'Enter') doAdd(); });
  const addBar = el('div', { class: 'px-5 py-2 border-b flex items-center gap-2 flex-wrap', style: { borderColor: 'var(--border)', background: 'rgba(242,20,140,.04)' } },
    el('span', { class: 'text-[10px] uppercase tracking-widest font-bold shrink-0', style: { color: PINK } }, '＋ Add rep'),
    addName, addId, addTeam,
    el('button', { class: 'rounded-lg px-2.5 py-1 text-[11px] font-bold cursor-pointer shrink-0', style: { background: PINK, color: '#fff' }, onclick: doAdd }, 'Add'));
  const footer = el('div', { class: 'px-5 py-3 text-[10px] border-t', style: { borderColor: 'var(--border)', color: 'var(--text-subtle)' } },
    'Rosters are authoritative: they set who competes for each team and the PRA denominator. Use the team dropdown on a rep to move them to the branch they\'re competing for — their production follows them. New reps are matched to their sales by NAME once the sync catches up. Synced to every admin.');
  // ── Competing branches (moved here from the board, per Isaac) — every
  // branch that has EVER sold D2D shows automatically (new ones included);
  // click to sit a branch out / bring it back.
  const chipsWrap = el('div', { class: 'px-5 py-2 border-b flex items-center gap-1.5 flex-wrap', style: { borderColor: 'var(--border)' } });
  const renderChips = () => {
    chipsWrap.innerHTML = '';
    const ex = new Set((comp.excludedBranches || []).map(b => String(b).toUpperCase()));
    const allBranches = [...new Set([...allTeamChoices, ...ex])].sort();
    chipsWrap.append(
      el('span', { class: 'text-[10px] uppercase tracking-widest font-bold shrink-0', style: { color: 'var(--text-subtle)' } }, 'Competing'),
      ...allBranches.map(b => {
        const off = ex.has(b);
        return el('button', {
          class: 'rounded-full px-2.5 py-0.5 text-[11px] font-semibold cursor-pointer transition hover:brightness-95',
          style: off
            ? { background: 'transparent', color: 'var(--text-muted)', border: '1px dashed var(--border-2)', textDecoration: 'line-through' }
            : { background: '#0E1C30', color: '#fff', border: '1px solid #0E1C30' },
          title: off ? b + ' is sitting the league out — click to include' : 'Click to pull ' + b + ' out of the league',
          onclick: () => {
            comp.excludedBranches = off
              ? (comp.excludedBranches || []).filter(x => String(x).toUpperCase() !== b)
              : [...(comp.excludedBranches || []), b];
            persist(b + (off ? ' back in the league' : ' pulled from the league'));
            renderChips();
            renderList();
          },
        }, b);
      }));
  };
  renderChips();
  card.append(header,
    chipsWrap,
    el('div', { class: 'px-5 py-3 border-b', style: { borderColor: 'var(--border)' } }, searchInput),
    addBar,
    listWrap, footer);

  const renderList = () => {
    listWrap.innerHTML = '';
    const q = (state._nrlaRosterSearch || '').trim().toLowerCase();
    // Teams sitting the league out (comp.excludedBranches — same store the
    // main board's Competing chips use).
    const exNow = new Set((comp.excludedBranches || []).map(b => String(b).toUpperCase()));
    // Keep the Add-rep team picker in sync — no assigning reps to a benched team.
    const _keepSel = addTeam.value;
    addTeam.innerHTML = '';
    allTeamChoices.filter(b => !exNow.has(b)).forEach(b => addTeam.append(el('option', { value: b }, b)));
    if ([...addTeam.options].some(o => o.value === _keepSel)) addTeam.value = _keepSel;
    if (state._nrlaMergeSrc) listWrap.append(el('div', { class: 'px-5 py-2 flex items-center justify-between gap-2', style: { background: 'rgba(223,100,58,.10)', borderBottom: '1px solid var(--border)', position: 'sticky', top: '0', zIndex: '2' } },
      el('span', { class: 'text-xs font-bold' }, '⛓ Merging “' + state._nrlaMergeSrc + '” — click “Keep this” on the row that\'s the SAME person (that spelling wins)'),
      el('button', { class: 'text-[11px] font-bold rounded px-2.5 py-1 cursor-pointer border shrink-0', style: { color: 'var(--text-muted)', borderColor: 'var(--border-2)' }, onclick: () => { state._nrlaMergeSrc = null; renderList(); } }, 'Cancel')));
    const totalPicked = Object.values(cfg.rosters || {}).reduce((a, l) => a + (Array.isArray(l) ? l.length : 0), 0);
    pickedNote.textContent = totalPicked + ' reps picked';
    const sections = teams.map(t => {
      // A benched team renders as one slim struck-through row — no roster, no
      // reps, out of matchups and standings — with a click to bring it back.
      if (exNow.has(t)) {
        return el('div', { class: 'flex items-center justify-between px-5 py-2 border-b', style: { background: 'var(--card-2)', borderColor: 'var(--border)' } },
          el('div', { class: 'text-xs font-black uppercase tracking-widest', style: { color: 'var(--text-subtle)', textDecoration: 'line-through' } }, t),
          el('div', { class: 'flex items-center gap-2' },
            el('span', { class: 'text-[10px] font-bold', style: { color: 'var(--text-subtle)' } }, 'sitting the league out'),
            el('button', {
              class: 'text-[10px] font-bold rounded px-2 py-0.5 cursor-pointer border', style: { color: 'var(--text-muted)', borderColor: 'var(--border-2)' },
              title: 'Bring ' + t + ' back into the league',
              onclick: () => { comp.excludedBranches = (comp.excludedBranches || []).filter(x => String(x).toUpperCase() !== t); persist(t + ' back in the league'); },
            }, 'Include')));
      }
      // Every rep appears exactly ONCE — under the team they currently count
      // for. Moving them to another team is what the row's dropdown is for.
      // Union in rostered names with NO synced sales yet (new hires added via
      // "+ Add") so they don't vanish from the list.
      const own = [...new Set([
        ...[...repInfo.keys()].filter(name => teamOf(name) === t),
        ...(cfg.rosters[t] || []),
      ])];
      const picked = new Set((cfg.rosters[t] || []).map(String));
      // Rostered reps float to the top of the section, each block alphabetical.
      const rows = own.filter(n => !q || n.toLowerCase().includes(q))
        .sort((a, b) => (picked.has(b) ? 1 : 0) - (picked.has(a) ? 1 : 0) || a.localeCompare(b));
      if (!rows.length) return null;
      const hasRoster = Array.isArray(cfg.rosters[t]);   // [] counts — explicit roster in force
      // Collapsible — sections start closed so eight branches don't make one
      // endless list. Searching auto-expands whatever matches.
      const open = (q || state._nrlaMergeSrc) ? true : !!(state._nrlaRosterOpen || {})[t];
      const toggleOpen = () => { state._nrlaRosterOpen = state._nrlaRosterOpen || {}; state._nrlaRosterOpen[t] = !open; renderList(); };
      return el('div', {},
        el('div', { class: 'flex items-center justify-between px-5 py-2 cursor-pointer select-none', style: { background: PINK, position: 'sticky', top: '0', zIndex: '1' }, onclick: toggleOpen, title: open ? 'Collapse' : 'Expand' },
          el('div', { class: 'text-xs font-black uppercase tracking-widest flex items-center gap-2', style: { color: '#fff' } },
            el('span', { style: { fontSize: '10px' } }, open ? '▾' : '▸'), t,
            el('span', { class: 'text-[10px] font-bold normal-case tracking-normal', style: { color: 'rgba(255,255,255,.75)' } }, rows.length + ' reps')),
          el('div', { class: 'flex items-center gap-2' },
            el('span', { class: 'text-[10px] font-bold', style: { color: 'rgba(255,255,255,.9)' } }, hasRoster ? picked.size + ' competing' : 'everyone competes'),
            el('button', {
              class: 'text-[10px] font-bold rounded px-2 py-0.5 cursor-pointer', style: { background: 'rgba(255,255,255,.25)', color: '#fff' },
              title: t + ' isn\'t competing this season? Pull the whole team out of the league — no matchups, no standings, no roster',
              onclick: (e) => {
                e.stopPropagation();
                if (!confirm('Pull ' + t + ' out of the NRLA entirely? They\'ll disappear from matchups and standings (you can bring them back any time).')) return;
                comp.excludedBranches = [...new Set([...(comp.excludedBranches || []), t])];
                persist(t + ' pulled from the league — sitting out');
              },
            }, 'Sit out'),
            el('button', {
              class: 'text-[10px] font-bold rounded px-2 py-0.5 cursor-pointer', style: { background: 'rgba(255,255,255,.25)', color: '#fff' },
              title: 'Add a rep who isn\'t in the synced data yet (brand-new hire) — jumps to the Add-rep bar with this team preselected',
              onclick: (e) => {
                e.stopPropagation();
                addTeam.value = t;
                addName.focus();
              },
            }, '+ Add'),
            // OPT-IN mode (per Isaac): 'All ✓' = whole branch competes.
            // Unclick it → roster clears to NOBODY, then add reps one by
            // one with the checkboxes. Click again → whole branch back in.
            el('button', {
              class: 'text-[10px] font-bold rounded px-2 py-0.5 cursor-pointer',
              style: hasRoster ? { background: 'rgba(255,255,255,.25)', color: '#fff' } : { background: '#fff', color: PINK },
              title: hasRoster
                ? 'Explicit roster in force (' + picked.size + ' competing) — click to put the WHOLE branch back in'
                : 'Everyone on the branch is competing — click to CLEAR the roster and add reps back individually',
              onclick: (e) => {
                e.stopPropagation();
                if (hasRoster) { delete cfg.rosters[t]; persist(t + ' → everyone on the branch competes'); }
                else { cfg.rosters[t] = []; persist(t + ' roster CLEARED — add reps individually'); }
              },
            }, hasRoster ? 'All' : 'All ✓'))),
        ...(open ? rows : []).map((name) => {
          const on = hasRoster ? picked.has(name) : true;   // no roster = everyone IS competing
          const info = repInfo.get(name) || { n: 0, counts: {} };
          const home = homeOf(info);
          const cb = el('input', {
            type: 'checkbox', class: 'cursor-pointer',
            onchange: (e) => {
              if (!hasRoster && !e.target.checked) {
                // Everyone-mode: unchecking one rep flips the team to an
                // explicit roster of everyone EXCEPT them.
                cfg.rosters[t] = own.filter(x => x !== name).sort();
                persist(name + ' opted OUT — ' + t + ' roster now explicit (' + cfg.rosters[t].length + ' competing)');
              } else {
                putOnRoster(name, t, e.target.checked);
              }
            },
          });
          cb.checked = on;
          // Team dropdown — move this rep to the branch they're competing for.
          const sel = el('select', {
            class: 'rounded px-1.5 py-1 text-[11px] font-semibold cursor-pointer',
            style: teamOf(name) !== home
              ? { border: '2px solid ' + PINK, color: PINK, background: 'var(--card)' }
              : { border: '1px solid var(--border-2)', color: 'var(--text)', background: 'var(--card)' },
            title: 'Which branch ' + name + ' competes for (moves them onto that team\'s roster)',
            onchange: (e) => assignTo(name, e.target.value),
            onclick: (e) => e.stopPropagation(),
          }, ...allTeamChoices.filter(b => !exNow.has(b) || b === teamOf(name)).map(b => { const o = el('option', { value: b }, b + (b === home ? ' (home)' : '')); if (b === teamOf(name)) o.selected = true; return o; }));
          const mergeSrc = state._nrlaMergeSrc;
          const rightSide = mergeSrc
            ? (mergeSrc === name
                ? el('span', { class: 'text-[10px] font-black uppercase tracking-wider shrink-0', style: { color: PINK } }, 'merging…')
                : el('button', {
                    class: 'rounded-lg px-2.5 py-1 text-[11px] font-bold cursor-pointer shrink-0',
                    style: { background: '#DF643A', color: '#fff' },
                    title: 'Keep “' + name + '” — fold “' + mergeSrc + '” and all their sales into this rep',
                    onclick: (e) => { e.preventDefault(); e.stopPropagation(); doMerge(mergeSrc, name); },
                  }, 'Keep this'))
            : el('span', { class: 'flex items-center gap-1.5 shrink-0' },
                el('button', {
                  class: 'cursor-pointer text-[12px] px-1 rounded',
                  style: { opacity: '.5', background: 'transparent', border: 'none' },
                  title: 'Duplicate spelling of another rep? Merge the two — pick this one as the duplicate, then click "Keep this" on the real one',
                  onclick: (e) => { e.preventDefault(); e.stopPropagation(); state._nrlaMergeSrc = name; renderList(); },
                }, '⛓'),
                sel);
          return el('label', { class: 'flex items-center gap-3 px-5 py-1.5 border-b cursor-pointer', style: { borderColor: 'var(--border)' } },
            cb,
            el('span', { class: 'text-sm font-semibold flex-1 min-w-0' },
              el('span', { style: (hasRoster && !on) ? { color: 'var(--text-subtle)', textDecoration: 'line-through' } : {} }, name),
              (teamOf(name) !== home && home !== 'UNKNOWN') && el('span', { class: 'block text-[10px] font-normal', style: { color: 'var(--text-subtle)' } }, 'knocks ' + home),
              el('span', { class: 'ml-2 text-[10px] font-normal tabular-nums', style: { color: 'var(--text-subtle)' } }, info.n ? info.n + ' acct' + (info.n === 1 ? '' : 's') : 'no synced sales yet'),
              cfg.repIds[name] && el('span', { class: 'ml-2 text-[9px] font-bold tabular-nums px-1 py-0.5 rounded', style: { background: 'rgba(11,79,158,.10)', color: '#0B4F9E' }, title: 'FieldRoutes sales-rep ID' }, 'ID ' + cfg.repIds[name])),
            rightSide);
        }));
    }).filter(Boolean);
    if (sections.length) sections.forEach(sec => listWrap.append(sec));
    else listWrap.append(el('div', { class: 'p-8 text-center text-sm', style: { color: 'var(--text-muted)' } }, 'No D2D reps found' + (q ? ' matching “' + (state._nrlaRosterSearch || '').trim() + '”' : ' in the uploaded data yet') + '.'));
  };
  renderList();
  document.body.append(overlay);
}

// Per-rep contribution modal — click a team in the standings. Shows every rep
// counting for that team this season (rostered reps with no production yet
// included at $0), bucketed exactly like the team columns.
function openNrlaTeamRepsModal(team, R, nameOf) {
  const PINK = '#F2148C', BLUE = '#3E9BE9';
  const money = (n) => '$' + Math.round(Number(n) || 0).toLocaleString();
  const overlay = el('div', { class: 'modal-overlay' });
  const close = () => { overlay.remove(); document.removeEventListener('keydown', key); };
  const key = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', key);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  const th = (t2, right) => el('th', { class: 'px-3 py-2 text-[10px] uppercase tracking-wider font-bold ' + (right ? 'text-right' : 'text-left'), style: { background: '#0E1C30', color: '#fff', position: 'sticky', top: '0' } }, t2);
  const td = (v, right, style) => el('td', { class: 'px-3 py-1.5 text-xs tabular-nums whitespace-nowrap ' + (right ? 'text-right' : ''), style: style || {} }, v);
  const card = el('div', { class: 'card w-full max-w-2xl my-8 overflow-hidden flex flex-col', style: { maxHeight: 'calc(100vh - 64px)' } });
  // Season ⇄ per-round scope (per Isaac) — re-renders in place.
  let scope = 'season';
  const _roundLbl = (rd) => (rd.phase === 'seed' ? 'Round ' + rd.num : rd.phase === 'semi' ? 'Semifinals' : 'Championship');
  const _dspan2 = (d1, d2) => (d1.getMonth() + 1) + '/' + d1.getDate() + '–' + (d2.getMonth() + 1) + '/' + d2.getDate();
  const render = () => {
    const stats = scope === 'season'
      ? ((R.repStats || {})[team] || {})
      : (() => {   // round stats are keyed rep → { team, … } across ALL teams
          const src2 = (R.roundRepStats || [])[Number(scope)] || {};
          const out = {};
          Object.entries(src2).forEach(([n, st]) => { if (st.team === team) out[n] = st; });
          return out;
        })();
    const rosterSet = R.rosters && R.rosters[team] ? [...R.rosters[team]] : [];
    const rows = [...new Set([...Object.keys(stats), ...(scope === 'season' ? rosterSet : [])])]
      .map(n => ({ name: n, ...(stats[n] || { n: 0, total: 0, passed: 0, pending: 0, failed: 0 }) }))
      .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
    const teamTotal = rows.reduce((a, r) => a + r.total, 0);
    const scopeSel = el('select', {
      class: 'rounded px-2.5 py-1 text-[11px] font-black cursor-pointer',
      style: { border: 'none', background: 'rgba(255,255,255,.25)', color: '#fff' },
      title: 'Season, or a single round',
      onchange: (e) => { scope = e.target.value; render(); },
    },
      (() => { const o = el('option', { value: 'season', style: { color: '#000' } }, 'Season'); if (scope === 'season') o.selected = true; return o; })(),
      ...(R.rounds || []).map((rd, i) => {
        if (!rd.started) return null;
        const o = el('option', { value: String(i), style: { color: '#000' } }, _roundLbl(rd) + ' · ' + _dspan2(rd.d1, rd.d2));
        if (scope === String(i)) o.selected = true; return o;
      }).filter(Boolean));
    card.innerHTML = '';
    card.append(
      el('div', { class: 'flex items-start justify-between px-5 py-3', style: { background: PINK } },
        el('div', {},
          el('div', { class: 'text-[10px] uppercase tracking-widest font-semibold', style: { color: 'rgba(255,255,255,.8)' } }, 'NRLA · rep contributions'),
          el('h2', { class: 'text-lg font-black mt-0.5', style: { color: '#fff', textTransform: 'uppercase' } }, (nameOf ? nameOf(team) : team)),
          el('div', { class: 'text-[11px] font-bold', style: { color: 'rgba(255,255,255,.9)' } },
            rows.length + ' reps · ' + money(teamTotal) + (scope === 'season' ? ' season total' : ' in ' + _roundLbl(R.rounds[Number(scope)])) + ' · Pending/Serviced accounts only')),
        el('div', { class: 'flex items-center gap-2' },
          scopeSel,
          el('button', { class: 'text-2xl leading-none', style: { color: '#fff' }, onclick: close }, '×'))),
      el('div', { class: 'overflow-auto flex-1' },
        el('table', { class: 'w-full' },
          el('thead', {}, el('tr', {}, th('#'), th('Rep'), th('Accts', true), th('Total Rev Sold', true), th('Passed', true), th('Pending', true), th('Failed', true), th('% of Team', true))),
          el('tbody', {},
            rows.length === 0 ? el('tr', {}, el('td', { class: 'px-3 py-6 text-center text-xs italic', colspan: '8', style: { color: 'var(--text-subtle)' } }, 'No production from this team in this round.')) : '',
            ...rows.map((r, i) => el('tr', { class: 'border-t', style: { borderColor: 'var(--border)', background: i % 2 ? 'rgba(14,28,48,.04)' : 'transparent' } },
            td(String(i + 1)),
            el('td', { class: 'px-3 py-1.5 text-xs font-bold whitespace-nowrap' }, r.name,
              r.n === 0 ? el('span', { class: 'ml-2 text-[9px] uppercase', style: { color: 'var(--text-subtle)' } }, 'no production yet') : null),
            td(String(r.n), true),
            td(money(r.total), true, { fontWeight: '800' }),
            td(money(r.passed), true, { color: '#DF643A' }),
            td('(' + money(r.pending) + ')', true, { color: '#A9441F' }),
            td(money(r.failed), true, { color: '#E8271B' }),
            td(teamTotal > 0 ? ((r.total / teamTotal) * 100).toFixed(1) + '%' : '—', true, { color: BLUE, fontWeight: '700' }))))
        )),
      el('div', { class: 'px-5 py-2.5 text-[10px] border-t', style: { borderColor: 'var(--border)', color: 'var(--text-subtle)' } },
        'Sold-Not-Started accounts (never serviced and no pending appointment — cancelled at the door, no appt scheduled, or appt cancelled) are excluded from every number. Passed = Passed/No Audit · Pending = not audited yet · Failed = Failed Audit + Last Resort (<$99).'));
  };
  render();
  overlay.append(card);
  document.body.append(overlay);
}

// ── NRLA board — 2026 flyer vibe: night sky, big white letters, hot-pink and
// signal-green copy. Seeding standings + playoff bracket + prize pool.
// ── Admin drill-down: every account behind a revenue number ──────────────
// kind: 'total' | 'passed' | 'pending' | 'failed' · team: branch key or null
// (null = all teams) · scope: 'season' | round index. Accounts are collected
// by nrlaCompute in the same pass that builds the season stats, so this list
// always reconciles to the dollar with the cell that was clicked.
function openNrlaAccountsModal(R, nameOf, opts) {
  const NAVY = '#0E1C30', PINK = '#F2148C';
  const kind  = (opts && opts.kind) || 'total';
  const team  = (opts && opts.team) || null;
  const scope = (opts && opts.scope) == null ? 'season' : String(opts.scope);
  const KIND_LABEL = { total: 'Total Rev Sold', passed: 'Passed Rev', pending: 'Pending Rev', failed: 'Failed Rev' };
  const scopeLabel = scope === 'season'
    ? 'Season'
    : (R.rounds[Number(scope)]
        ? (R.rounds[Number(scope)].phase === 'seed' ? 'Round ' + R.rounds[Number(scope)].num
           : R.rounds[Number(scope)].phase === 'semi' ? 'Semifinals' : 'Championship')
        : 'Season');
  const all = (R.accounts || []).filter(a =>
    (team ? a.team === team : true)
    && (scope === 'season' ? true : a.roundIdx === Number(scope))
    && (kind === 'total' ? true : a.bucket === kind))
    .sort((a, b) => b.revenue - a.revenue);

  const money2 = (v) => '$' + Math.round(v || 0).toLocaleString();
  const BUCKET_CHIP = {
    passed:  { t: 'Passed',  bg: 'rgba(223,100,58,.12)', c: '#DF643A' },
    pending: { t: 'Pending', bg: 'rgba(169,68,31,.12)', c: '#A9441F' },
    failed:  { t: 'Failed',  bg: 'rgba(220,38,38,.10)', c: '#DC2626' },
  };
  const overlay = el('div', { class: 'modal-overlay' });
  const close = () => { overlay.remove(); document.removeEventListener('keydown', key); };
  const key = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', key);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  const tbody = el('tbody', {});
  const countEl = el('span', { class: 'text-[11px] font-bold', style: { color: 'rgba(255,255,255,.9)' } });
  const renderRows = (q) => {
    const needle = (q || '').trim().toLowerCase();
    const rows = needle
      ? all.filter(a => (a.customer + ' ' + a.customerId + ' ' + a.rep + ' ' + a.team).toLowerCase().includes(needle))
      : all;
    countEl.textContent = rows.length.toLocaleString() + ' account' + (rows.length === 1 ? '' : 's') + ' · ' + money2(rows.reduce((s, a) => s + a.revenue, 0));
    tbody.innerHTML = '';
    if (!rows.length) {
      tbody.append(el('tr', {}, el('td', { class: 'px-3 py-6 text-center text-xs italic', colspan: '6', style: { color: 'var(--text-subtle)' } }, 'No accounts in this slice.')));
      return;
    }
    rows.slice(0, 400).forEach((a, i) => {
      const chip = BUCKET_CHIP[a.bucket] || BUCKET_CHIP.pending;
      tbody.append(el('tr', { class: 'border-t', style: { borderColor: 'var(--border)', background: i % 2 ? 'rgba(14,28,48,.04)' : 'transparent' } },
        el('td', { class: 'px-3 py-2 tabular-nums', style: { color: 'var(--text-muted)' } }, a.customerId || '—'),
        el('td', { class: 'px-2 py-2 font-semibold whitespace-nowrap' }, a.customer || '—'),
        el('td', { class: 'px-2 py-2 whitespace-nowrap' }, a.rep),
        el('td', { class: 'px-2 py-2 whitespace-nowrap', style: { color: 'var(--text-muted)' } }, nameOf(a.team)),
        el('td', { class: 'px-2 py-2 tabular-nums whitespace-nowrap' }, a.dateSold || (a.date ? a.date.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' }) : '—')),
        el('td', { class: 'px-2 py-2 tabular-nums whitespace-nowrap text-right font-black' },
          el('span', { class: 'text-[9px] font-bold uppercase px-1.5 py-0.5 rounded mr-2 align-middle', style: { background: chip.bg, color: chip.c } }, chip.t),
          money2(a.revenue)),
      ));
    });
    if (rows.length > 400) tbody.append(el('tr', {}, el('td', { class: 'px-3 py-3 text-center text-[11px] italic', colspan: '6', style: { color: 'var(--text-subtle)' } }, 'Showing top 400 by value — search to narrow, or export the CSV for everything.')));
  };
  const search = el('input', {
    class: 'rounded px-2.5 py-1 text-[11px]', placeholder: 'Search customer / rep / ID…',
    style: { border: 'none', background: 'rgba(255,255,255,.25)', color: '#fff', minWidth: '180px' },
    oninput: (e) => renderRows(e.target.value),
  });
  const csvBtn = el('button', {
    class: 'rounded px-2.5 py-1 text-[11px] font-black cursor-pointer',
    style: { background: 'rgba(255,255,255,.25)', color: '#fff' },
    title: 'Download this list as a CSV',
    onclick: () => {
      const esc = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
      const csv = ['Customer ID,Customer,Rep,Team,Date Sold,Status,Contract Value']
        .concat(all.map(a => [a.customerId, a.customer, a.rep, nameOf(a.team), a.dateSold, a.bucket, a.revenue].map(esc).join(',')))
        .join('\n');
      const aEl = document.createElement('a');
      aEl.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
      aEl.download = ('NRLA ' + (team ? nameOf(team) + ' ' : '') + KIND_LABEL[kind] + ' ' + scopeLabel + '.csv').replace(/\s+/g, '_');
      aEl.click();
      URL.revokeObjectURL(aEl.href);
    },
  }, '⬇ CSV');

  const card = el('div', { class: 'card w-full max-w-3xl overflow-hidden flex flex-col', style: { maxHeight: '84vh' } },
    el('div', { class: 'flex items-center justify-between gap-2 flex-wrap px-4 py-2.5', style: { background: NAVY } },
      el('div', {},
        el('div', { style: { fontFamily: 'var(--font-display)', fontSize: '.95rem', letterSpacing: '.14em', color: '#fff', textTransform: 'uppercase' } },
          (team ? nameOf(team) : 'All Teams') + ' · ' + KIND_LABEL[kind]),
        el('div', { class: 'text-[10px] font-bold', style: { color: PINK } }, scopeLabel + ' · ', countEl)),
      el('div', { class: 'flex items-center gap-2' }, search, csvBtn,
        el('button', { class: 'text-xl leading-none', style: { color: '#fff' }, onclick: close }, '×'))),
    el('div', { class: 'overflow-y-auto' },
      el('table', { class: 'w-full text-xs' },
        el('thead', { class: 'text-[10px] uppercase tracking-wider sticky top-0', style: { background: '#0E1C30', color: '#fff' } },
          el('tr', {},
            el('th', { class: 'text-left px-3 py-2 font-bold' }, 'Cust ID'),
            el('th', { class: 'text-left px-2 py-2 font-bold' }, 'Customer'),
            el('th', { class: 'text-left px-2 py-2 font-bold' }, 'Rep'),
            el('th', { class: 'text-left px-2 py-2 font-bold' }, 'Team'),
            el('th', { class: 'text-left px-2 py-2 font-bold' }, 'Sold'),
            el('th', { class: 'text-right px-2 py-2 font-bold' }, 'Contract Value'))),
        tbody)),
    el('div', { class: 'px-4 py-2 text-[10px] border-t', style: { borderColor: 'var(--border)', color: 'var(--text-subtle)' } },
      'Pending/Serviced accounts only — the CRM rule (initial appointment Pending or Completed); everything else is out of the comp entirely. Failed = Failed Audit or Last Resort (<$99 initial); failed revenue never counts toward PRA.'));
  renderRows('');
  overlay.append(card);
  document.body.append(overlay);
}

function nrlaBoard(rawSales, opts) {
  const RO = !!(opts && opts.readOnly);            // rep-facing: look, don't touch
  // 🗄 Past-season archives (per Isaac) — pulled once per session from
  // app_settings; the Comp Window bar grows a season dropdown when any exist.
  if (!state._nrlaArchivesLoaded && !(typeof DEMO !== 'undefined' && DEMO) && typeof supabase !== 'undefined' && supabase) {
    state._nrlaArchivesLoaded = true;
    Promise.resolve(supabase.from('app_settings').select('key,value').like('key', 'nrla_archive_%'))
      .then(({ data }) => {
        state._nrlaArchives = (data || []).sort((x, y) => String(x.key).localeCompare(String(y.key)));
        if (state._nrlaArchives.length && state.view === 'nrla') mountApp();
      })
      .catch(() => { state._nrlaArchivesLoaded = false; });
  }
  const R = nrlaCompute(rawSales, opts && opts.comp);
  const { cfg } = R;
  const PINK = '#F2148C', GREEN = '#2FD62F', REDD = '#E8271B', BLUE = '#3E9BE9';
  const DISP = "var(--font-display, 'Anton', system-ui, sans-serif)";
  const money = (n) => '$' + Math.round(Number(n) || 0).toLocaleString();
  const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const dspan = (d1, d2) => MON[d1.getMonth()] + ' ' + d1.getDate() + '–' + (d1.getMonth() === d2.getMonth() ? '' : MON[d2.getMonth()] + ' ') + d2.getDate();
  const rerender = () => { const sx = window.scrollX, sy = window.scrollY; setTimeout(() => { mountApp(); requestAnimationFrame(() => window.scrollTo(sx, sy)); }, 0); };
  const save = (detail) => { logActivity('comp_change', { detail: 'NRLA: ' + detail }); saveDemoData(); rerender(); };
  const nameOf = (t) => (cfg.teamNames && cfg.teamNames[t]) || t;
  const renameTeam = (t) => {
    const v = prompt('Display name for ' + t + ' (blank = branch name):', (cfg.teamNames && cfg.teamNames[t]) || '');
    if (v === null) return;
    if (!cfg.teamNames || typeof cfg.teamNames !== 'object') cfg.teamNames = {};
    const nm = v.trim();
    if (nm) cfg.teamNames[t] = nm; else delete cfg.teamNames[t];
    save('team name ' + t + ' → ' + (nm || t));
  };

  // ── Hero — night sky: near-black navy, faint cloud glow, power-line vibe ──
  const heroBg =
    'radial-gradient(ellipse 55% 42% at 68% 60%, rgba(255,255,255,.075), rgba(255,255,255,0) 70%),' +
    'radial-gradient(ellipse 65% 50% at 25% 95%, rgba(255,255,255,.05), rgba(255,255,255,0) 70%),' +
    'linear-gradient(180deg, #03070D 0%, #081221 55%, #0E1C30 100%)';
  const chip = (bg, fg, txt, extra) => el('span', { style: Object.assign({ display: 'inline-block', padding: '3px 10px', borderRadius: '0', background: bg, color: fg, fontWeight: '900', fontSize: '11px', letterSpacing: '.03em' }, extra || {}) }, txt);
  // When the comp data was last synced/derived — shown BIG on the banner.
  // Pinned to Eastern time (most reps viewing the board are ET).
  const syncStr = (() => {
    const t = state.indicatorsUploadedAt ? new Date(state.indicatorsUploadedAt) : null;
    if (!t || isNaN(t)) return '—';
    try {
      return t.toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).replace(',', ' ·');
    } catch (e) {
      return t.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' · ' + t.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    }
  })();
  const hero = el('div', { id: 'nrlaHero', style: { background: heroBg, padding: '22px 22px 18px', position: 'relative', overflow: 'hidden' } },
    el('div', { class: 'flex items-start justify-between gap-3 flex-wrap', style: { position: 'relative', zIndex: '1' } },
      el('div', {},
        // Title line: NRLA + the pulsing LIVE chip right beside it. The old
        // chip row (dates / Branch vs Branch / RIDDMADE) is retired — dates
        // live in the admin strip below, the rest was decoration.
        el('div', { class: 'flex items-end gap-3 flex-wrap' },
          el('div', { style: { fontFamily: DISP, fontSize: 'clamp(3rem,9vw,6rem)', lineHeight: '.8', color: '#fff', textTransform: 'uppercase', letterSpacing: '.1em', textShadow: '0 2px 30px rgba(0,0,0,.6)' } }, 'NRLA'),
          (() => {
            const lr = R.rounds.find(r => r.live);
            if (!lr) return null;
            const t = lr.phase === 'seed' ? 'Round ' + lr.num : lr.phase === 'semi' ? 'Semifinals' : 'Championship';
            return el('span', { style: { display: 'inline-flex', alignItems: 'center', gap: '5px', padding: '4px 12px', borderRadius: '0', background: GREEN, color: '#04310A', fontWeight: '900', fontSize: '12px', letterSpacing: '.03em', marginBottom: '6px' } },
              el('span', { style: { animation: 'nrlaPulse 1.2s ease-in-out infinite' } }, '●'), 'LIVE · ' + t);
          })(),
        ),
        el('div', { style: { fontFamily: DISP, fontSize: 'clamp(.85rem,1.8vw,1.15rem)', letterSpacing: '.06em', color: PINK, textTransform: 'none', marginTop: '7px' } }, 'National Riddmen League Association'),
        // Local time in every competing market — shared builder, dark variant.
        nrlaBranchClocks(R.teams, cfg, { RO, save, dark: true, style: { marginTop: '11px' } }),
      ),
      el('div', { class: 'nrla-hero-side flex flex-col items-end shrink-0' },
        // (📋 · 🏁 · ⬇ · ⓘ moved to the Comp Window bar — per Isaac)
        // BIG last-sync timestamp — the freshness of every number on the board.
        el('div', { style: { textAlign: 'right', marginTop: '14px' } },
          el('div', { style: { fontFamily: DISP, fontSize: '.62rem', letterSpacing: '.24em', color: PINK, textTransform: 'uppercase' } }, 'Last Sync'),
          el('div', { style: { fontFamily: DISP, fontSize: 'clamp(1.3rem,2.8vw,2rem)', color: '#fff', lineHeight: '1', marginTop: '2px' } }, syncStr)),
      ),
    ),
  );

  // (Frozen banner retired — it overlapped the fixed page header, and the
  // header's own Last-upload stamp now covers scrolled-away freshness.)
  if (window._nrlaStickyScroll) {
    document.removeEventListener('scroll', window._nrlaStickyScroll, true);
    window.removeEventListener('resize', window._nrlaStickyScroll);
    window._nrlaStickyScroll = null;
  }

  // ── Daily report CSV — a FLAT customer list by round (per Isaac): one
  // header row + one row per counted account, built for XLOOKUP fact-checks
  // against the CRM. No section headers, no rollups — those live on the
  // board itself.
  const dailyReportCsv = () => {
    const esc = (v) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const row = (...cells) => cells.map(esc).join(',');
    const roundLabel = (i) => {
      if (i < 0 || !R.rounds[i]) return 'Off-round';
      const rd = R.rounds[i];
      return rd.phase === 'seed' ? 'Round ' + (rd.num || (i + 1)) : rd.phase === 'semi' ? 'Semifinals' : 'Championship';
    };
    const dIso = (d) => d instanceof Date && !isNaN(d) ? d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') : '';
    const wSpan = (i) => (i >= 0 && R.rounds[i]) ? dIso(R.rounds[i].d1) + ' to ' + dIso(R.rounds[i].d2) : '';
    const L = [row('Round', 'Round Window', 'Team', 'Rep', 'Customer ID', 'Customer', 'Date Sold', 'Audit Status', 'Contract Value')];
    (R.accounts || []).slice()
      .sort((a, b) => (a.roundIdx - b.roundIdx) || String(a.team).localeCompare(String(b.team)) || String(a.dateSold).localeCompare(String(b.dateSold)))
      .forEach(a => L.push(row(
        roundLabel(a.roundIdx), wSpan(a.roundIdx), nameOf(a.team), a.rep,
        a.customerId, a.customer, a.dateSold,
        a.bucket === 'failed' ? 'Failed / Last Resort' : a.bucket === 'passed' ? 'Passed' : 'Pending',
        Math.round(Number(a.revenue) || 0))));
    return L.join('\n');
  };

  // ── Comp Window bar (standardized across comps, per Isaac): the season
  // dates AND the board controls (📋 rosters · 🏁 archive · ⬇ export · ⓘ)
  // all live here now — the hero and old config strip are clean.
  // Season archive object + writer — shared by the 🏁 button and the
  // AUTO-archive below (per Isaac: archiving isn't a manual job anymore).
  const _buildSeasonArchive = () => {
    const passedCount2 = {};
    (R.accounts || []).forEach(a => { if (a.bucket === 'passed' && a.rep && a.rep !== '\u2014') passedCount2[a.rep] = (passedCount2[a.rep] || 0) + 1; });
    return {
      archived_at: new Date().toISOString(),
      season_year: new Date().getFullYear(),
      standings: R.standings.map((s, i) => ({ seed: i + 1, team: nameOf(s.team), w: s.w, l: s.l, t: s.t || 0, stats: R.seasonStats[s.team] ? { total: Math.round(R.seasonStats[s.team].total), passed: Math.round(R.seasonStats[s.team].passed), pending: Math.round(R.seasonStats[s.team].pending), failed: Math.round(R.seasonStats[s.team].failed), accts: R.seasonStats[s.team].n } : null })),
      placements: (R.placements || []).map(p => ({ place: p.place, team: nameOf(p.team), prize: p.prize })),
      rep_stats: Object.fromEntries(Object.entries(R.repStats || {}).map(([t, reps]) => [nameOf(t), Object.fromEntries(Object.entries(reps).map(([n2, st]) => [n2, { accts: st.n, total: Math.round(st.total), passed: Math.round(st.passed), pending: Math.round(st.pending), failed: Math.round(st.failed), passed_accts: passedCount2[n2] || 0, payout_qualified: (passedCount2[n2] || 0) >= 4 }]))])),
    };
  };
  const _upsertSeasonArchive = async (archive) => {
    try {
      if (!(typeof DEMO !== 'undefined' && DEMO) && supabase) {
        await supabase.from('app_settings').upsert({ key: 'nrla_archive_' + archive.season_year, value: archive }, { onConflict: 'key' });
      }
    } catch (e) { console.warn('[nrla] archive upsert failed', e); }
  };
  // 🏁 AUTO-ARCHIVE (per Isaac): the moment the season has ENDED and every
  // counted account's audit has settled (zero pending), the record freezes
  // itself into app_settings — no manual click. Synced flag = runs once.
  if (!RO && cfg.start && cfg.end && Date.now() > new Date(cfg.end + 'T23:59:59').getTime()
      && (R.accounts || []).length
      && !(R.accounts || []).some(a => a.bucket === 'pending')
      && cfg.archivedSeason !== new Date(cfg.end + 'T00:00').getFullYear()) {
    const _auto = _buildSeasonArchive();
    _auto.season_year = new Date(cfg.end + 'T00:00').getFullYear();
    cfg.archivedSeason = _auto.season_year;
    _upsertSeasonArchive(_auto);
    save('Season ' + _auto.season_year + ' AUTO-archived \u2014 season over, all audits settled');
  }
  const lbl = (t) => el('span', { class: 'text-[10px] uppercase tracking-widest font-bold', style: { color: 'var(--text-subtle)' } }, t);
  const cfgBar = null;   // retired — dates moved to the Comp Window bar below
  const compWinBar = el('div', { class: 'card p-2.5 flex items-center gap-2 flex-wrap', style: { borderLeft: '3px solid var(--text)' } },
    lbl('Comp Window'),
    RO
      ? el('span', { class: 'text-[11px] font-bold tabular-nums' }, (cfg.start || '—') + ' → ' + (cfg.end || '—'))
      : el('span', { class: 'inline-flex items-center gap-1.5 whitespace-nowrap' },
          el('input', {
            type: 'date', value: cfg.start || '',
            class: 'rounded border px-1.5 py-1 text-xs',
            style: { borderColor: 'var(--border-2)', background: 'var(--card)', color: 'var(--text)', minWidth: '0' },
            title: 'First day of Seeding Round 1 (rounds are 2-day blocks, Sundays skipped)',
            onchange: (e) => { cfg.start = e.target.value; save('start date → ' + (e.target.value || 'unset')); },
          }),
          el('span', { class: 'text-muted-' }, '→'),
          el('input', {
            type: 'date', value: cfg.end || '',
            class: 'rounded border px-1.5 py-1 text-xs',
            style: { borderColor: 'var(--border-2)', background: 'var(--card)', color: 'var(--text)', minWidth: '0' },
            title: 'Last day of the Championship round — rounds auto-fill the window, last two become semifinal + championship. Update the two dates each year and the season lays itself out.',
            onchange: (e) => { cfg.end = e.target.value; save('end date → ' + (e.target.value || 'unset')); },
          })),
    el('div', { class: 'ml-auto' },
      el('div', { class: 'flex items-center gap-2' },
          RO ? null : el('button', {
            class: 'cursor-pointer transition hover:brightness-95',
            style: { width: '26px', height: '26px', borderRadius: '50%', background: '#fff', border: '1px solid rgba(255,255,255,.5)', display: 'grid', placeItems: 'center', fontSize: '13px', lineHeight: '1', padding: '0' },
            title: 'Rosters — pick who competes for each team and which branch each rep competes for (sets the PRA denominator)',
            onclick: () => openNrlaRosterModal(rawSales),
          }, '📋'),
          RO ? null : el('button', {
            class: 'cursor-pointer transition hover:brightness-95',
            style: { width: '26px', height: '26px', borderRadius: '50%', background: '#fff', border: '1px solid rgba(255,255,255,.5)', display: 'grid', placeItems: 'center', fontSize: '13px', lineHeight: '1', padding: '0' },
            title: 'Archive the season — freezes final standings, placements, per-rep stats and the payout math into a permanent record (Supabase + a JSON download), then optionally clears rosters & matchup overrides for a fresh season.',
            onclick: async () => {
              if (!confirm('Archive the season as it stands right now? Standings, placements, rep stats, and payout math get frozen into a permanent record. (This normally happens AUTOMATICALLY once the season ends and audits settle \u2014 the button is the manual override.)')) return;
              const archive = _buildSeasonArchive();
              await _upsertSeasonArchive(archive);
              // (JSON download retired — per Isaac: archives live IN the app,
              // stored permanently in Supabase app_settings.)
              toast('Season archived (' + archive.standings.length + ' teams, ' + Object.keys(archive.rep_stats).length + ' rosters)', 'success');
              // Optional fresh-season reset — archive is safely saved first.
              if (confirm('Season archived. ALSO clear the matchup overrides and rosters so next season starts clean? (Team assignments and the archive itself are untouched.)')) {
                if (cfg.matchups) cfg.matchups = {};
                if (cfg.rosters) cfg.rosters = {};
                save('Season archived — matchups & rosters cleared for the new season');
              }
            },
          }, '🏁'),
          RO ? null : el('button', {
            class: 'cursor-pointer transition hover:brightness-95',
            style: { width: '26px', height: '26px', borderRadius: '50%', background: '#fff', border: '1px solid rgba(255,255,255,.5)', display: 'grid', placeItems: 'center', fontSize: '13px', lineHeight: '1', padding: '0' },
            title: 'Export — CSV: one row per counted account with its round, team, rep, customer ID, audit status, and contract value. Built for XLOOKUP fact-checks against the CRM.',
            onclick: () => {
              try {
                const csv = dailyReportCsv();
                const a = document.createElement('a');
                a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' }));
                a.download = 'nrla-daily-' + new Date().toISOString().slice(0, 10) + '.csv';
                a.click();
                setTimeout(() => URL.revokeObjectURL(a.href), 5000);
              } catch (e) { toast('Report failed: ' + (e && e.message || e), 'error'); }
            },
          }, '⬇'),
          RO ? null : el('button', {
            class: 'text-[10px] font-black uppercase px-2.5 py-1 rounded-lg border cursor-pointer transition hover:brightness-95',
            style: { borderColor: '#B91C1C', color: '#B91C1C', background: 'transparent', whiteSpace: 'nowrap' },
            title: 'Reset the season window — both dates clear and the board goes blank until you set new ones (which then stick until the next reset). Rosters, matchups, and archives are untouched.',
            onclick: () => {
              if (!confirm('Reset the NRLA season window? Both dates clear and the board goes blank until you set new ones. Rosters, matchups, and archives are untouched.')) return;
              cfg.start = '';
              cfg.end = '';
              save('NRLA: season window RESET (dates cleared)');
            },
          }, '\u21ba Reset'),
          el('button', {
            class: 'inline-flex items-center justify-center rounded-full text-xs font-bold cursor-pointer',
            style: { width: '22px', height: '22px', background: PINK, color: '#fff' },
            title: 'How the league works',
            onclick: () => openNrlaHelpModal(),
          }, 'ⓘ'))),
  );
  // Season dropdown — Live + every archived season.
  if ((state._nrlaArchives || []).length) {
    compWinBar.append(el('select', {
      class: 'rounded-lg border px-2.5 py-1 text-[11px] font-bold cursor-pointer',
      style: { borderColor: 'var(--border-2)', background: 'var(--card)', color: 'var(--text)' },
      title: 'View a past season\u2019s archived final standings',
      onchange: (e) => { state._nrlaArchiveSel = e.target.value; mountApp(); },
    },
      el('option', { value: '', selected: !state._nrlaArchiveSel }, 'Live season'),
      ...(state._nrlaArchives || []).map(x => el('option', { value: x.key, selected: state._nrlaArchiveSel === x.key },
        'Season ' + ((x.value && x.value.season_year) || String(x.key).replace('nrla_archive_', '')) + ' \u00b7 archived'))));
  }
  const _nrlaWrap = (board) => el('div', { class: 'flex flex-col gap-4' }, compWinBar, board);
  // ── 🗄 Archived-season view — renders the frozen record verbatim ──
  if (state._nrlaArchiveSel) {
    const _arch = (state._nrlaArchives || []).find(x => x.key === state._nrlaArchiveSel);
    const A = _arch && _arch.value;
    if (A) {
      const _th = (t, right) => el('th', { class: 'px-3 py-2 text-[10px] uppercase tracking-widest text-muted- font-semibold' + (right ? ' text-right' : ' text-left') }, t);
      const _td = (t, right, bold) => el('td', { class: 'px-3 py-2 tabular-nums whitespace-nowrap' + (right ? ' text-right' : '') + (bold ? ' font-bold' : '') }, t);
      const placeStrip = (A.placements || []).length ? el('div', { class: 'px-4 py-3 flex items-center gap-2 flex-wrap border-b', style: { borderColor: 'var(--border)' } },
        ...(A.placements || []).map(p2 => el('span', { class: 'rounded-full px-3 py-1 text-[11px] font-black', style: { background: p2.place === 1 ? '#A9441F' : 'var(--card-2)', color: p2.place === 1 ? '#323230' : 'var(--text)' } },
          '#' + p2.place + ' ' + p2.team + (p2.prize ? ' \u00b7 ' + p2.prize : '')))) : null;
      const standingsTbl = el('div', { class: 'overflow-x-auto' }, el('table', { class: 'w-full text-sm' },
        el('thead', {}, el('tr', {}, _th('Seed'), _th('Team'), _th('W', true), _th('L', true), _th('T', true), _th('Passed $', true), _th('Pending $', true), _th('Failed $', true), _th('Accts', true))),
        el('tbody', {}, ...(A.standings || []).map(s2 => el('tr', { class: 'border-t', style: { borderColor: 'var(--border)' } },
          _td('#' + s2.seed), _td(s2.team, false, true), _td(String(s2.w), true), _td(String(s2.l), true), _td(String(s2.t || 0), true),
          _td(s2.stats ? money(s2.stats.passed) : '\u2014', true, true),
          _td(s2.stats ? money(s2.stats.pending) : '\u2014', true),
          _td(s2.stats ? money(s2.stats.failed) : '\u2014', true),
          _td(s2.stats ? String(s2.stats.accts) : '\u2014', true))))));
      const repRows = [];
      Object.entries(A.rep_stats || {}).forEach(([team, reps]) => {
        Object.entries(reps || {}).forEach(([nm, st]) => repRows.push({ team, nm, ...st }));
      });
      repRows.sort((x, y) => x.team.localeCompare(y.team) || (y.passed || 0) - (x.passed || 0));
      const repsTbl = repRows.length ? el('div', { class: 'overflow-x-auto border-t', style: { borderColor: 'var(--border)' } }, el('table', { class: 'w-full text-sm' },
        el('thead', {}, el('tr', {}, _th('Team'), _th('Rep'), _th('Accts', true), _th('Passed $', true), _th('Passed accts', true), _th('Payout \u2713', true))),
        el('tbody', {}, ...repRows.map(r2 => el('tr', { class: 'border-t', style: { borderColor: 'var(--border)' } },
          _td(r2.team), _td(r2.nm, false, true), _td(String(r2.accts || 0), true),
          _td(money(r2.passed), true, true), _td(String(r2.passed_accts || 0), true),
          _td(r2.payout_qualified ? '\u2705' : '\u2014', true)))))) : null;
      return _nrlaWrap(el('div', { class: 'card overflow-hidden' },
        el('div', { class: 'px-5 py-4 flex items-center justify-between gap-3 flex-wrap', style: { background: '#03070D', color: '#fff' } },
          el('div', {},
            el('div', { style: { fontFamily: DISP, fontSize: '28px', lineHeight: '1', textTransform: 'uppercase', letterSpacing: '.08em' } }, 'NRLA \u00b7 Season ' + (A.season_year || '')),
            el('div', { class: 'text-[11px] font-bold mt-1', style: { color: PINK } },
              '\ud83d\udd12 ARCHIVED RECORD' + (A.archived_at ? ' \u00b7 frozen ' + new Date(A.archived_at).toLocaleDateString() : ''))),
          el('div', { style: { fontSize: '30px' } }, '\ud83c\udfc6')),
        placeStrip, standingsTbl, repsTbl));
    }
  }

  // ── Competing-team chips ──
  const comp = R.comp;
  // eslint-disable-next-line no-unused-vars — chips live in the 📋 modal now
  const chipBar = (() => {
    return null;
    const allBranches = [...new Set([...R.teams, ...(comp.excludedBranches || []).map(b => String(b).toUpperCase())])].sort();
    if (!allBranches.length) return null;
    const ex = new Set((comp.excludedBranches || []).map(b => String(b).toUpperCase()));
    return el('div', { class: 'px-3 py-2 flex items-center gap-1.5 flex-wrap border-b', style: { borderColor: 'var(--border)' } },
      lbl('Competing'),
      ...allBranches.map(b => {
        const off = ex.has(b);
        return el('button', {
          class: 'rounded-full px-2.5 py-0.5 text-[11px] font-semibold cursor-pointer transition hover:brightness-95',
          style: off
            ? { background: 'transparent', color: 'var(--text-muted)', border: '1px dashed var(--border-2)', textDecoration: 'line-through' }
            : { background: '#0E1C30', color: '#fff', border: '1px solid #0E1C30' },
          title: off ? b + ' is sitting the league out — click to include' : 'Click to pull ' + b + ' out of the league',
          onclick: () => {
            comp.excludedBranches = off
              ? comp.excludedBranches.filter(x => String(x).toUpperCase() !== b)
              : [...(comp.excludedBranches || []), b];
            save(b + (off ? ' back in the league' : ' pulled from the league'));
          },
        }, b);
      }));
  })();

  // ── Empty states ──
  if (!cfg.start) {
    return _nrlaWrap(el('div', { class: 'card overflow-hidden' }, hero,
      el('div', { class: 'p-8 text-center text-sm', style: { color: 'var(--text-muted)' } },
        'Set a season start date in the Comp Window bar to build the schedule.')));
  }
  if (R.teams.length < 2) {
    return _nrlaWrap(el('div', { class: 'card overflow-hidden' }, hero,
      el('div', { class: 'p-8 text-center text-sm', style: { color: 'var(--text-muted)' } },
        'Fewer than two teams have data (or rosters) in the season window — nothing to schedule yet.')));
  }

  // ── Seeding standings — revenue columns scoped to the SEASON or any single
  // round via the picker (same as the rep leaderboard). Seeds / W / L always
  // reflect the full seeding race; the money columns re-scope. ──
  const resDot = (r, i) => el('span', {
    style: { display: 'inline-grid', placeItems: 'center', width: '16px', height: '16px', borderRadius: '0', fontSize: '9px', fontWeight: '900', marginRight: '2px',
      background: r === 'W' ? GREEN : r === 'L' ? REDD : '#9e9e9e', color: '#fff' },
    title: 'Seeding round ' + (i + 1) + ': ' + (r === 'W' ? 'Win' : r === 'L' ? 'Loss' : 'Tie'),
  }, r);
  const playedAny = R.standings.some(s => s.results.length);
  // Drill-downs are ADMIN-ONLY: reps get the board + their own local scope
  // pickers, but team/rep/account breakdowns stay behind the admin view.
  const teamCell = (s) => el('td', { class: 'px-2 py-2 font-bold whitespace-nowrap' },
    RO
      ? el('span', {}, nameOf(s.team))
      : el('span', {
          class: 'cursor-pointer hover:underline',
          title: 'See the individual reps contributing to ' + nameOf(s.team),
          onclick: () => openNrlaTeamRepsModal(s.team, R, nameOf),
        }, nameOf(s.team)),
    cfg.teamNames[s.team] && el('span', { class: 'ml-1 text-[9px] uppercase', style: { color: 'var(--text-subtle)' } }, s.team));
  const _roundLabelShort = (rd) => rd.phase === 'seed' ? 'Round ' + rd.num : rd.phase === 'semi' ? 'Semifinals' : 'Championship';
  const standingsCard = (() => {
    // Default to the LIVE round while one is running (the fight happening
    // right now) — Season only when nothing is live or the user picked it.
    const _liveIdxStand = (R.rounds || []).findIndex(rd => rd && rd.live);
    let scope = state._nrlaStandScope == null
      ? (_liveIdxStand >= 0 ? String(_liveIdxStand) : 'season')
      : String(state._nrlaStandScope);
    if (scope !== 'season' && !R.rounds[Number(scope)]) scope = 'season';
    // A round's team stats = that round's per-rep stats rolled up.
    const roundTeamStats = {};
    if (scope !== 'season') {
      Object.values((R.roundRepStats || [])[Number(scope)] || {}).forEach(st => {
        const o = roundTeamStats[st.team] || (roundTeamStats[st.team] = { total: 0, passed: 0, pending: 0, failed: 0, n: 0 });
        o.total += st.total; o.passed += st.passed; o.pending += st.pending; o.failed += st.failed; o.n += st.n;
      });
    }
    const statsFor = (team) => scope === 'season'
      ? (R.seasonStats[team] || { total: 0, passed: 0, pending: 0, failed: 0, n: 0 })
      : (roundTeamStats[team] || { total: 0, passed: 0, pending: 0, failed: 0, n: 0 });
    // Admin-only click-to-drill money cell → the accounts behind the number,
    // in the same scope the picker is set to. Reps get the plain number.
    const _drillTd = (team, kind, val, extra, color) => el('td', {
      class: 'px-2 py-2 tabular-nums whitespace-nowrap ' + (extra || '') + (RO ? '' : ' cursor-pointer hover:underline'),
      style: color ? { color } : {},
      title: RO ? undefined : 'See the accounts behind this number',
      onclick: RO ? undefined : () => openNrlaAccountsModal(R, nameOf, { team, scope, kind }),
    }, val);
    // Standings ⇄ By Round toggle (per Isaac): By Round turns the columns
    // into one revenue column per played round — how each round ended, at
    // a full glance.
    const view = state._nrlaStandView === 'rounds' ? 'rounds' : 'stand';
    const viewToggle = el('div', { class: 'inline-flex rounded overflow-hidden', style: { background: 'rgba(255,255,255,.25)' } },
      ...[['stand', 'Standings'], ['rounds', 'By Round']].map(([v, l]) => el('button', {
        class: 'px-2 py-1 text-[10px] font-black cursor-pointer',
        style: view === v ? { background: '#fff', color: PINK } : { color: '#fff', background: 'transparent' },
        onclick: () => { state._nrlaStandView = v; rerender(); },
      }, l)));
    const scopeSel = el('select', {
      class: 'rounded px-2.5 py-1 text-[11px] font-black cursor-pointer',
      style: { border: 'none', background: 'rgba(255,255,255,.25)', color: '#fff' },
      title: 'Scope the revenue columns to the whole season or a single round (seeds and W-L always show the full race)',
      onchange: (e) => { state._nrlaStandScope = e.target.value; rerender(); },
    },
      (() => { const o = el('option', { value: 'season', style: { color: '#000' } }, 'Season'); if (scope === 'season') o.selected = true; return o; })(),
      ...R.rounds.map((rd, i) => { const o = el('option', { value: String(i), style: { color: '#000' } }, _roundLabelShort(rd) + ' · ' + dspan(rd.d1, rd.d2)); if (scope === String(i)) o.selected = true; return o; }));
    // ── BY-ROUND VIEW — one revenue column per played round ──
    if (view === 'rounds') {
      const started = R.rounds.map((rd, i) => ({ rd, i })).filter(x => x.rd.started);
      const revByRound = started.map(({ i }) => {
        const m = {};
        Object.values((R.roundRepStats || [])[i] || {}).forEach(st => {
          const o = m[st.team] || (m[st.team] = { total: 0, passed: 0, pending: 0, failed: 0, n: 0 });
          o.total += st.total; o.passed += st.passed; o.pending += st.pending; o.failed += st.failed; o.n += st.n;
        });
        return m;
      });
      const resultOf = (rd, team) => {
        for (const m of rd.matchups) {
          const side = [m.a, m.b].find(x => x && x.team === team);
          if (!side) continue;
          const other = m.a && m.a.team === team ? m.b : m.a;
          const opp = other ? other.team : null;   // null = bye
          if (!m.winner) return { res: (rd.live || m._muPending) ? '·' : 'T', opp };
          return { res: m.winner === team ? 'W' : 'L', opp };
        }
        return null;   // not in this round
      };
      const shortLbl = (rd) => rd.phase === 'seed' ? 'R' + rd.num : rd.phase === 'semi' ? 'SF' : 'FINAL';
      return el('div', { class: 'nrla-standings' },
        el('div', { class: 'flex items-center justify-between gap-2 flex-wrap px-3 py-1.5', style: { background: PINK } },
          el('span', { style: { fontFamily: DISP, fontSize: '.82rem', letterSpacing: '.16em', color: '#fff', textTransform: 'uppercase' } },
            'Standings · By Round'),
          viewToggle),
        el('div', { class: 'overflow-x-auto' },
          el('table', { class: 'w-full text-xs' },
            el('thead', { class: 'text-[10px] uppercase tracking-wider', style: { background: '#0E1C30', color: '#fff' } },
              el('tr', {},
                el('th', { class: 'text-left px-3 py-2.5 font-bold' }, 'Seed'),
                el('th', { class: 'text-left px-2 py-2.5 font-bold' }, 'Team'),
                el('th', { class: 'text-left px-2 py-2.5 font-bold' }, 'W'),
                el('th', { class: 'text-left px-2 py-2.5 font-bold' }, 'L'),
                ...started.map(({ rd }) => el('th', {
                  class: 'text-right px-2 py-2.5 font-bold whitespace-nowrap',
                  title: _roundLabelShort(rd) + ' · ' + dspan(rd.d1, rd.d2) + (rd.live ? ' · LIVE' : '') + ' — Total Rev Sold that round; green = won, red = lost',
                }, shortLbl(rd) + (rd.live ? ' ●' : ''))),
                el('th', { class: 'text-right px-2 py-2.5 font-bold', title: 'Total Rev Sold across the whole season' }, 'Season'))),
            el('tbody', {},
              ...R.standings.map((s, i) => el('tr', {
                class: 'border-t', style: { borderColor: 'var(--border)', background: i === 0 && playedAny ? 'rgba(242,20,140,.07)' : (i % 2 ? 'rgba(14,28,48,.05)' : 'transparent') },
              },
                el('td', { class: 'px-3 py-2 font-black tabular-nums whitespace-nowrap' }, (i === 0 ? '🏆 ' : i === 1 ? '🥈 ' : i === 2 ? '🥉 ' : '') + '#' + (i + 1)),
                teamCell(s),
                el('td', { class: 'px-2 py-2 tabular-nums font-black whitespace-nowrap', style: { color: GREEN } }, s.w),
                el('td', { class: 'px-2 py-2 tabular-nums font-black whitespace-nowrap', style: { color: REDD } }, s.l + (s.t ? ' · ' + s.t + 'T' : '')),
                ...started.map(({ rd, i: ri }, idx) => {
                  const st = revByRound[idx][s.team];
                  const r0 = resultOf(rd, s.team);
                  const res = r0 && r0.res;
                  const oppName = r0 ? (r0.opp ? nameOf(r0.opp) : 'BYE') : null;
                  const col = res === 'W' ? '#DF643A' : res === 'L' ? REDD : null;
                  return el('td', {
                    class: 'px-2 py-2 text-right tabular-nums whitespace-nowrap font-bold' + (RO || !st ? '' : ' cursor-pointer hover:underline'),
                    style: col ? { color: col } : {},
                    title: _roundLabelShort(rd) + (oppName ? ' vs ' + oppName : '') + ': ' + (res === 'W' ? 'Won' : res === 'L' ? 'Lost' : res === 'T' ? 'Tied' : res === '·' ? 'In progress' : 'Bye')
                      + (st ? ' · ' + money(st.total) + ' total · ' + money(st.passed + st.pending) + ' qualifying · ' + st.n + ' accts' : ' · no production')
                      + (RO || !st ? '' : ' — click for the accounts'),
                    onclick: (RO || !st) ? undefined : () => openNrlaAccountsModal(R, nameOf, { team: s.team, scope: String(ri), kind: 'total' }),
                  },
                    el('div', {},
                      st ? money(st.total) : '—',
                      res && res !== '·' ? el('span', { class: 'ml-1 text-[9px] font-black', style: { opacity: '.8' } }, res) : null),
                    r0 ? el('div', { class: 'text-[8px] font-bold uppercase tracking-wide', style: { opacity: '.6' } }, 'vs ' + oppName) : null);
                }),
                el('td', { class: 'px-2 py-2 text-right tabular-nums font-black whitespace-nowrap' }, money((R.seasonStats[s.team] || {}).total || 0)))),
              (() => {
                const cells = started.map((_x, idx) => {
                  const tot = Object.values(revByRound[idx]).reduce((a, o) => a + o.total, 0);
                  return el('td', { class: 'px-2 py-2 text-right tabular-nums font-black whitespace-nowrap' }, money(tot));
                });
                const seasonTot = R.standings.reduce((a, s) => a + ((R.seasonStats[s.team] || {}).total || 0), 0);
                return el('tr', { class: 'border-t-2', style: { borderColor: '#0E1C30', background: 'rgba(14,28,48,.08)' } },
                  el('td', { class: 'px-3 py-2' }, ''),
                  el('td', { class: 'px-2 py-2 font-black whitespace-nowrap', style: { letterSpacing: '.06em' } }, 'RIDD'),
                  el('td', {}, ''), el('td', {}, ''),
                  ...cells,
                  el('td', { class: 'px-2 py-2 text-right tabular-nums font-black whitespace-nowrap' }, money(seasonTot)));
              })()))));
    }
    return el('div', { class: 'nrla-standings' },
      el('div', { class: 'flex items-center justify-between gap-2 flex-wrap px-3 py-1.5', style: { background: PINK } },
        el('span', { style: { fontFamily: DISP, fontSize: '.82rem', letterSpacing: '.16em', color: '#fff', textTransform: 'uppercase' } },
          'Standings' + (R.seedingDone ? ' · Final Seeds' : '') + (scope === 'season' ? '' : ' · ' + _roundLabelShort(R.rounds[Number(scope)]))),
        el('div', { class: 'flex items-center gap-2' },
          viewToggle, scopeSel)),
      el('div', { class: 'overflow-x-auto' },
        el('table', { class: 'w-full text-xs' },
          el('thead', { class: 'text-[10px] uppercase tracking-wider', style: { background: '#0E1C30', color: '#fff' } },
            el('tr', {},
              el('th', { class: 'text-left px-3 py-2.5 font-bold', title: 'Seed after the seeding rounds' }, 'Seed'),
              el('th', { class: 'text-left px-2 py-2.5 font-bold' }, 'Team'),
              el('th', { class: 'text-left px-2 py-2.5 font-bold' }, 'W'),
              el('th', { class: 'text-left px-2 py-2.5 font-bold' }, 'L'),
              el('th', { class: 'text-left px-2 py-2.5 font-bold', title: 'Reps competing — the roster (📋) when one is set, otherwise every rep who sold this season. The PRA denominator.' }, 'Reps'),
              el('th', { class: 'text-left px-2 py-2.5 font-bold', title: 'Per-Rep Average on QUALIFYING revenue: (Passed + Pending) ÷ reps competing. Failed Rev never counts toward the comp.' }, 'PRA'),
              el('th', { class: 'text-left px-2 py-2.5 font-bold' + (RO ? '' : ' cursor-pointer hover:underline'), title: 'Everything sold in this scope (Contract Value, all audit statuses) — Pending/Serviced accounts only; Sold-Not-Started is excluded.' + (RO ? '' : ' Click for every contributing account (all teams); click a cell for one team.'),
                onclick: RO ? undefined : () => openNrlaAccountsModal(R, nameOf, { team: null, scope, kind: 'total' }) }, 'Total Rev Sold'),
              el('th', { class: 'text-left px-2 py-2.5 font-bold' + (RO ? '' : ' cursor-pointer hover:underline'), title: 'Passed Audit or No Audit' + (RO ? '' : ' — click for the accounts (all teams)'),
                onclick: RO ? undefined : () => openNrlaAccountsModal(R, nameOf, { team: null, scope, kind: 'passed' }) }, 'Passed Rev'),
              el('th', { class: 'text-left px-2 py-2.5 font-bold', title: 'Passed Rev ÷ Total Rev Sold — how much of the production has cleared audit' }, '% Passed'),
              el('th', { class: 'text-left px-2 py-2.5 font-bold' + (RO ? '' : ' cursor-pointer hover:underline'), title: 'No audit flag yet — clears into Passed or Failed as audits land' + (RO ? '' : ' — click for the accounts (all teams)'),
                onclick: RO ? undefined : () => openNrlaAccountsModal(R, nameOf, { team: null, scope, kind: 'pending' }) }, 'Pending Rev'),
              el('th', { class: 'text-left px-2 py-2.5 font-bold' + (RO ? '' : ' cursor-pointer hover:underline'), title: 'Failed Audit + Last Resort (<$99 initial)' + (RO ? '' : ' — click for the accounts (all teams)'),
                onclick: RO ? undefined : () => openNrlaAccountsModal(R, nameOf, { team: null, scope, kind: 'failed' }) }, 'Failed Rev'),
              el('th', { class: 'text-left px-2 py-2.5 font-bold', title: 'Average Contract Value: Total Rev Sold ÷ accounts sold' }, 'ACV'),
              el('th', { class: 'text-left px-2 py-2.5 font-bold', title: 'Accounts sold in this scope (Pending/Serviced only)' }, 'Accts'),
            )),
          el('tbody', {},
            ...R.standings.map((s, i) => {
              const st = statsFor(s.team);
              const reps = R.repsCompeting[s.team] || 0;
              return el('tr', {
                class: 'border-t', style: { borderColor: 'var(--border)', background: i === 0 && playedAny ? 'rgba(242,20,140,.07)' : (i % 2 ? 'rgba(14,28,48,.05)' : 'transparent') },
              },
                el('td', { class: 'px-3 py-2 font-black tabular-nums whitespace-nowrap' }, (i === 0 ? '🏆 ' : i === 1 ? '🥈 ' : i === 2 ? '🥉 ' : '') + '#' + (i + 1)),
                teamCell(s),
                el('td', { class: 'px-2 py-2 tabular-nums font-black whitespace-nowrap', style: { color: GREEN } }, s.w),
                el('td', { class: 'px-2 py-2 tabular-nums font-black whitespace-nowrap', style: { color: REDD } }, s.l + (s.t ? ' · ' + s.t + 'T' : '')),
                el('td', { class: 'px-2 py-2 tabular-nums font-bold' }, reps),
                el('td', { class: 'px-2 py-2 tabular-nums whitespace-nowrap font-black', style: { color: BLUE } }, reps > 0 ? money((st.passed + st.pending) / reps) : '—'),
                _drillTd(s.team, 'total',  money(st.total), 'font-black', null),
                _drillTd(s.team, 'passed',  money(st.passed), 'font-bold', '#DF643A'),
                el('td', { class: 'px-2 py-2 tabular-nums whitespace-nowrap font-bold', style: { color: '#DF643A' } },
                  st.total > 0 ? (st.passed / st.total * 100).toFixed(0) + '%' : '—'),
                _drillTd(s.team, 'pending', '(' + money(st.pending) + ')', '', '#A9441F'),
                _drillTd(s.team, 'failed',  money(st.failed), 'font-bold', REDD),
                el('td', { class: 'px-2 py-2 tabular-nums whitespace-nowrap font-bold' }, st.n > 0 ? money(st.total / st.n) : '—'),
                el('td', { class: 'px-2 py-2 tabular-nums' }, st.n),
              );
            }),
            // ── RIDD totals row — everything across all teams. The money
            // cells drill into the all-teams account lists (⬇ CSV inside),
            // so "all branches pending rev" is one click + one download. ──
            (() => {
              const tot = { total: 0, passed: 0, pending: 0, failed: 0, n: 0 };
              let repsTot = 0;
              R.standings.forEach(s => {
                const st = statsFor(s.team);
                tot.total += st.total; tot.passed += st.passed; tot.pending += st.pending;
                tot.failed += st.failed; tot.n += st.n;
                repsTot += R.repsCompeting[s.team] || 0;
              });
              return el('tr', { class: 'border-t-2', style: { borderColor: '#0E1C30', background: 'rgba(14,28,48,.08)' } },
                el('td', { class: 'px-3 py-2' }, ''),
                el('td', { class: 'px-2 py-2 font-black whitespace-nowrap', style: { letterSpacing: '.06em' } }, 'RIDD'),
                el('td', {}, ''), el('td', {}, ''),
                el('td', { class: 'px-2 py-2 tabular-nums font-black' }, repsTot),
                el('td', { class: 'px-2 py-2 tabular-nums whitespace-nowrap font-black', style: { color: BLUE } }, repsTot > 0 ? money((tot.passed + tot.pending) / repsTot) : '—'),
                _drillTd(null, 'total',  money(tot.total), 'font-black', null),
                _drillTd(null, 'passed',  money(tot.passed), 'font-black', '#DF643A'),
                el('td', { class: 'px-2 py-2 tabular-nums whitespace-nowrap font-black', style: { color: '#DF643A' } },
                  tot.total > 0 ? (tot.passed / tot.total * 100).toFixed(0) + '%' : '—'),
                _drillTd(null, 'pending', '(' + money(tot.pending) + ')', 'font-black', '#A9441F'),
                _drillTd(null, 'failed',  money(tot.failed), 'font-black', REDD),
                el('td', { class: 'px-2 py-2 tabular-nums whitespace-nowrap font-black' }, tot.n > 0 ? money(tot.total / tot.n) : '—'),
                el('td', { class: 'px-2 py-2 tabular-nums font-black' }, tot.n),
              );
            })()))));
  })();

  // ── Rep leaderboard — top 10 individuals, scoped to the SEASON or any
  // single round via the picker (top producers by round). Ranked on
  // qualifying revenue (Passed + Pending) — failed never counts. ──
  const repBoard = (() => {
    const roundLabel = (rd) => (rd.phase === 'seed' ? 'Round ' + rd.num : rd.phase === 'semi' ? 'Semifinals' : 'Championship') + ' · ' + dspan(rd.d1, rd.d2);
    // Same live-round default as the standings above.
    const _liveIdxRep = (R.rounds || []).findIndex(rd => rd && rd.live);
    let scope = state._nrlaRepBoardScope == null
      ? (_liveIdxRep >= 0 ? String(_liveIdxRep) : 'season')
      : String(state._nrlaRepBoardScope);
    if (scope !== 'season' && !R.rounds[Number(scope)]) scope = 'season';
    const flat = [];
    if (scope === 'season') {
      Object.entries(R.repStats || {}).forEach(([t, reps]) =>
        Object.entries(reps).forEach(([name, st]) => flat.push({ name, team: t, ...st })));
    } else {
      Object.entries((R.roundRepStats || [])[Number(scope)] || {}).forEach(([name, st]) => flat.push({ name, ...st }));
    }
    const qual = (r) => (r.passed || 0) + (r.pending || 0);
    flat.sort((a, b) => qual(b) - qual(a) || a.name.localeCompare(b.name));
    // Team filter (per Isaac): All teams = the Top 10 race; one team = EVERY
    // rep on that team + a totals row, so team revenue reconciles against
    // the standings table row-by-row.
    const teamFilter = state._nrlaRepBoardTeam && R.teams.includes(state._nrlaRepBoardTeam) ? state._nrlaRepBoardTeam : 'all';
    const filtered = teamFilter === 'all' ? flat : flat.filter(r => r.team === teamFilter);
    const top = teamFilter === 'all' ? filtered.slice(0, 10) : filtered;
    const medal = (i) => i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '#' + (i + 1);
    // Season PRA = qualifying ÷ rounds played; a single round IS one window.
    const roundsStarted = scope === 'season' ? Math.max(1, R.rounds.filter(r => r.started).length) : 1;
    const scopeSel = el('select', {
      class: 'rounded px-2.5 py-1 text-[11px] font-black cursor-pointer',
      style: { border: 'none', background: 'rgba(255,255,255,.25)', color: '#fff' },
      title: 'Scope the leaderboard to the whole season or a single round',
      onchange: (e) => { state._nrlaRepBoardScope = e.target.value; rerender(); },
    },
      (() => { const o = el('option', { value: 'season', style: { color: '#000' } }, 'Season'); if (scope === 'season') o.selected = true; return o; })(),
      ...R.rounds.map((rd, i) => { const o = el('option', { value: String(i), style: { color: '#000' } }, roundLabel(rd)); if (scope === String(i)) o.selected = true; return o; }));
    const teamSel = el('select', {
      class: 'rounded px-2.5 py-1 text-[11px] font-black cursor-pointer',
      style: { border: 'none', background: 'rgba(255,255,255,.25)', color: '#fff' },
      title: 'All teams = Top 10 race · pick a team to see EVERY rep on it with team totals (data check)',
      onchange: (e) => { state._nrlaRepBoardTeam = e.target.value; rerender(); },
    },
      (() => { const o = el('option', { value: 'all', style: { color: '#000' } }, 'All teams · Top 10'); if (teamFilter === 'all') o.selected = true; return o; })(),
      ...R.teams.slice().sort((a, b) => nameOf(a).localeCompare(nameOf(b))).map(t => {
        const o = el('option', { value: t, style: { color: '#000' } }, nameOf(t));
        if (teamFilter === t) o.selected = true; return o;
      }));
    return el('div', { class: 'nrla-standings' },   // same mobile sticky #/Rep columns as the standings table
      el('div', { class: 'flex items-center justify-between gap-2 flex-wrap px-3 py-1.5', style: { background: PINK } },
        el('span', { style: { fontFamily: DISP, fontSize: '.82rem', letterSpacing: '.16em', color: '#fff', textTransform: 'uppercase' } },
          (teamFilter === 'all' ? 'Rep Leaderboard · Top 10' : 'Rep Leaderboard · ' + nameOf(teamFilter) + ' · all ' + top.length + ' reps')
          + (scope === 'season' ? '' : ' · ' + roundLabel(R.rounds[Number(scope)]).split(' · ')[0])),
        el('div', { class: 'flex items-center gap-2' },
          el('span', { class: 'text-[10px] font-bold', style: { color: 'rgba(255,255,255,.9)' } }, 'qualifying rev · Pending/Serviced only'),
          teamSel,
          scopeSel)),
      el('div', { class: 'overflow-x-auto' },
        el('table', { class: 'w-full text-xs' },
          el('thead', { class: 'text-[10px] uppercase tracking-wider', style: { background: '#0E1C30', color: '#fff' } },
            el('tr', {},
              el('th', { class: 'text-left px-3 py-2.5 font-bold' }, '#'),
              el('th', { class: 'text-left px-2 py-2.5 font-bold' }, 'Rep'),
              el('th', { class: 'text-left px-2 py-2.5 font-bold' }, 'Team'),
              el('th', { class: 'text-left px-2 py-2.5 font-bold', title: 'Qualifying revenue (Passed + Pending — failed never counts)' + (scope === 'season' ? ' averaged per round played' : ' for this round') }, 'PRA'),
              el('th', { class: 'text-left px-2 py-2.5 font-bold', title: 'The rep\'s own sold revenue in this scope' }, 'Total Rev Sold'),
              el('th', { class: 'text-left px-2 py-2.5 font-bold' }, 'Passed Rev'),
              el('th', { class: 'text-left px-2 py-2.5 font-bold' }, 'Pending Rev'),
              el('th', { class: 'text-left px-2 py-2.5 font-bold' }, 'Failed Rev'),
              el('th', { class: 'text-left px-2 py-2.5 font-bold', title: 'Average Contract Value: total ÷ accounts sold' }, 'ACV'),
              el('th', { class: 'text-left px-2 py-2.5 font-bold' }, 'Accts'),
            )),
          el('tbody', {},
            top.length ? '' : el('tr', {}, el('td', { class: 'px-3 py-4 text-center text-[11px]', colspan: '10', style: { color: 'var(--text-subtle)' } }, 'No qualifying production in this round yet.')),
            ...top.map((r, i) => el('tr', {
              class: 'border-t transition' + (RO ? '' : ' cursor-pointer hover:brightness-95'),
              style: { borderColor: 'var(--border)', background: i === 0 ? 'rgba(255,107,61,.07)' : (i % 2 ? 'rgba(14,28,48,.04)' : 'transparent') },
              title: RO ? undefined : 'See all of ' + nameOf(r.team) + '\'s reps',
              onclick: RO ? undefined : () => openNrlaTeamRepsModal(r.team, R, nameOf),
            },
              el('td', { class: 'px-3 py-2 font-black tabular-nums whitespace-nowrap' }, medal(i)),
              el('td', { class: 'px-2 py-2 font-bold whitespace-nowrap' }, r.name),
              el('td', { class: 'px-2 py-2 whitespace-nowrap', style: { color: 'var(--text-muted)' } }, nameOf(r.team)),
              el('td', { class: 'px-2 py-2 tabular-nums whitespace-nowrap font-black', style: { color: BLUE } }, money(qual(r) / roundsStarted)),
              el('td', { class: 'px-2 py-2 tabular-nums whitespace-nowrap font-black' }, money(r.total)),
              el('td', { class: 'px-2 py-2 tabular-nums whitespace-nowrap font-bold', style: { color: '#DF643A' } }, money(r.passed)),
              el('td', { class: 'px-2 py-2 tabular-nums whitespace-nowrap', style: { color: '#A9441F' } }, '(' + money(r.pending) + ')'),
              el('td', { class: 'px-2 py-2 tabular-nums whitespace-nowrap font-bold', style: { color: REDD } }, money(r.failed)),
              el('td', { class: 'px-2 py-2 tabular-nums whitespace-nowrap font-bold' }, r.n > 0 ? money(r.total / r.n) : '—'),
              el('td', { class: 'px-2 py-2 tabular-nums' }, r.n),
            )),
            // Team totals row (team filter only) — must reconcile with the
            // standings table's row for this team in the same scope.
            (teamFilter !== 'all' && top.length) ? (() => {
              const t = top.reduce((a, r) => ({ total: a.total + (r.total || 0), passed: a.passed + (r.passed || 0), pending: a.pending + (r.pending || 0), failed: a.failed + (r.failed || 0), n: a.n + (r.n || 0), q: a.q + qual(r) }), { total: 0, passed: 0, pending: 0, failed: 0, n: 0, q: 0 });
              return el('tr', { class: 'border-t-2', style: { borderColor: '#0E1C30', background: 'rgba(14,28,48,.08)' } },
                el('td', { class: 'px-3 py-2' }, ''),
                el('td', { class: 'px-2 py-2 font-black whitespace-nowrap', style: { letterSpacing: '.06em' } }, 'TEAM TOTAL'),
                el('td', {}, ''),
                el('td', { class: 'px-2 py-2 tabular-nums whitespace-nowrap font-black', style: { color: BLUE } }, money(t.q / roundsStarted)),
                el('td', { class: 'px-2 py-2 tabular-nums whitespace-nowrap font-black' }, money(t.total)),
                el('td', { class: 'px-2 py-2 tabular-nums whitespace-nowrap font-black', style: { color: '#DF643A' } }, money(t.passed)),
                el('td', { class: 'px-2 py-2 tabular-nums whitespace-nowrap font-black', style: { color: '#A9441F' } }, '(' + money(t.pending) + ')'),
                el('td', { class: 'px-2 py-2 tabular-nums whitespace-nowrap font-black', style: { color: REDD } }, money(t.failed)),
                el('td', { class: 'px-2 py-2 tabular-nums whitespace-nowrap font-black' }, t.n > 0 ? money(t.total / t.n) : '—'),
                el('td', { class: 'px-2 py-2 tabular-nums font-black' }, t.n));
            })() : null))));
  })();

  // Leaderboard-only mode — the Office Staff comps tab embeds JUST the Rep
  // Leaderboard card (they follow the rep comp without the full D2D board).
  if (opts && opts.leaderboardOnly) {
    return el('div', { class: 'card overflow-hidden' }, repBoard);
  }

  // ── Prize pool legend — always visible under the standings (the full
  // breakdown also lives in the ⓘ rules and the Final Standings card). ──
  const prizeStrip = el('div', { class: 'px-3 py-2 flex items-center gap-x-3 gap-y-1.5 flex-wrap border-t', style: { borderColor: 'var(--border)' } },
    el('span', { class: 'text-[10px] uppercase tracking-widest font-bold', style: { color: BLUE } }, '💰 Prize pool · per rep'),
    ...NRLA_PRIZE_POOL.map((p, i) => el('span', { class: 'inline-flex items-center gap-1 text-[11px] font-bold whitespace-nowrap' },
      el('span', { style: { color: 'var(--text-subtle)' } }, nrlaOrdinal(i + 1)),
      el('span', { style: { color: BLUE } }, p))));

  // ── Final standings + prize pool (fills in as championship matches settle) ──
  const prizeCard = R.placements.length ? el('div', {},
    el('div', { class: 'flex items-center justify-between gap-2 px-3 py-1.5', style: { background: BLUE } },
      el('span', { style: { fontFamily: DISP, fontSize: '.82rem', letterSpacing: '.16em', color: '#fff', textTransform: 'uppercase' } }, 'Final Standings · Prize Pool'),
      el('div', { class: 'flex items-center gap-2' },
        el('span', { class: 'text-[10px] font-bold', style: { color: 'rgba(255,255,255,.9)' } }, 'per rep, by placement'),
        RO ? null : el('button', {
          class: 'rounded px-2.5 py-1 text-[11px] font-black cursor-pointer',
          style: { background: 'rgba(255,255,255,.25)', color: '#fff' },
          title: 'Payout sheet — every rostered rep listed; 4+ PASSED-audit accounts on the season qualifies for the prize (per Isaac)',
          onclick: () => {
            const esc = (v) => { const t = v == null ? '' : String(v); return /[",\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
            // Qualification: 4+ passed-audit accounts across the season.
            // Everyone still appears on the sheet — unqualified rows carry
            // their count and $0 so payroll sees WHY, not just who.
            const MIN_PASSED = 4;
            const passedCount = {};
            (R.accounts || []).forEach(a => { if (a.bucket === 'passed' && a.rep && a.rep !== '—') passedCount[a.rep] = (passedCount[a.rep] || 0) + 1; });
            const L = ['Placement,Team,Rep,Passed Audit Accts,Qualified (4+ passed),Prize Per Rep'];
            R.placements.forEach(pl => {
              const roster = R.rosters[pl.team] ? [...R.rosters[pl.team]] : Object.keys((R.repStats || {})[pl.team] || {});
              if (!roster.length) L.push([nrlaOrdinal(pl.place), nameOf(pl.team), '(no roster set)', '', '', pl.prize].map(esc).join(','));
              roster.sort().forEach(rn => {
                const pc = passedCount[rn] || 0;
                const q = pc >= MIN_PASSED;
                L.push([nrlaOrdinal(pl.place), nameOf(pl.team), rn, pc, q ? 'YES' : 'no', q ? pl.prize : '$0'].map(esc).join(','));
              });
            });
            const a3 = document.createElement('a');
            a3.href = URL.createObjectURL(new Blob([L.join('\n')], { type: 'text/csv' }));
            a3.download = 'NRLA_Payout_Sheet_' + new Date().toISOString().slice(0, 10) + '.csv';
            a3.click();
            URL.revokeObjectURL(a3.href);
          },
        }, '⬇ Payout Sheet'))),
    el('div', { class: 'overflow-x-auto' },
      el('table', { class: 'w-full text-xs' },
        el('tbody', {},
          ...R.placements.map((p, i) => el('tr', { class: 'border-t', style: { borderColor: 'var(--border)', background: p.place === 1 ? 'rgba(62,155,233,.08)' : 'transparent' } },
            el('td', { class: 'px-3 py-2 font-black whitespace-nowrap', style: { width: '70px' } }, (p.place === 1 ? '🏆 ' : '') + nrlaOrdinal(p.place)),
            el('td', { class: 'px-2 py-2 font-bold whitespace-nowrap' }, nameOf(p.team)),
            el('td', { class: 'px-2 py-2 tabular-nums font-black whitespace-nowrap', style: { color: BLUE } }, p.prize + ' / rep'),
          )))))) : null;

  // ── Round cards: seeding → semifinals → championship ──
  // Seeding matchups are DRAG-AND-DROP editable: grab a team and drop it on
  // any other slot in the SAME round to swap the two. Saved per round on the
  // comp (cfg.matchups); ↺ on the round header restores the default.
  let _dragSrc = null;
  const _dropSwap = (ri, mi, sideKey) => {
    const src = _dragSrc; _dragSrc = null;
    if (!src || src.ri !== ri || (src.mi === mi && src.side === sideKey)) return;
    const rd = R.rounds[ri];
    if (rd.started && !confirm('This round has already started — rearranging rewrites its matchups (and results). Move anyway?')) return;
    const pairs = rd.matchups.map(m => [m.a ? m.a.team : null, m.b ? m.b.team : null]);
    const get = (p) => pairs[p.mi][p.side === 'a' ? 0 : 1];
    const put = (p, v) => { pairs[p.mi][p.side === 'a' ? 0 : 1] = v; };
    const tmp = get(src);
    put(src, get({ mi, side: sideKey }));
    put({ mi, side: sideKey }, tmp);
    cfg.matchups[rd.num] = pairs;
    save('Round ' + rd.num + ' matchups rearranged');
  };
  const _dndProps = (dnd, hasTeam) => dnd ? Object.assign({
    ondragover: (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; },
    ondrop: (e) => { e.preventDefault(); _dropSwap(dnd.ri, dnd.mi, dnd.side); },
  }, hasTeam ? {
    draggable: 'true',
    ondragstart: (e) => { _dragSrc = { ri: dnd.ri, mi: dnd.mi, side: dnd.side }; e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', 'x'); } catch (_) {} },
  } : {}) : {};
  const sideRow = (side, m, label, dnd, live) => {
    if (!side) return el('div', Object.assign({ class: 'flex items-center justify-between px-3 py-2' }, _dndProps(dnd, false)),
      el('span', { class: 'text-xs font-bold', style: { color: 'var(--text)', letterSpacing: '.05em' } }, label || 'BYE'),
      el('span', { class: 'text-[10px] font-bold', style: { color: 'var(--text)' } }, label ? 'TBD' : 'auto win'));
    const won = m.winner === side.team;
    // Live rounds: the CURRENT leader glows green (nothing's final yet).
    // Finished rounds: the winner keeps the pink stamp.
    const hi = live ? 'rgba(255,107,61,.10)' : 'rgba(242,20,140,.07)';
    const hiText = live ? GREEN : PINK;
    return el('div', Object.assign({
      class: 'flex items-center justify-between gap-2 px-3 py-2',
      style: Object.assign(won ? { background: hi } : {}, dnd ? { cursor: 'grab' } : {}),
      title: dnd ? 'Drag onto another team in this round to swap matchups' : '',
    }, _dndProps(dnd, true)),
      el('div', { class: 'min-w-0' },
        el('div', { class: 'text-xs font-black whitespace-nowrap', style: { color: 'var(--text)' } }, (dnd ? '⠿ ' : '') + (won ? (live ? '▲ ' : '✓ ') : '') + nameOf(side.team)),
        el('div', {
          class: 'text-[10px] tabular-nums font-semibold',
          style: { color: 'var(--text)' },
          title: 'Total revenue sold in this round (all audit buckets) · reps competing',
        }, money(side.totalRev != null ? side.totalRev : side.rev) + ' total · ' + side.reps + ' reps'),
        // Audit-bucket split — Passed / Pending / Failed contract $ for the
        // round. Passed + Pending = the qualifying revenue PRA runs on.
        side.buckets ? el('div', {
          class: 'text-[9px] tabular-nums font-bold whitespace-nowrap',
          style: { color: 'var(--text)', opacity: '.8' },
          title: 'Passed ' + money(side.buckets.passed) + ' · Pending ' + money(side.buckets.pending) + ' · Failed ' + money(side.buckets.failed) + ' — Passed + Pending = qualifying revenue (' + money(side.rev) + ')',
        },
          el('span', { style: { color: GREEN } }, '✓' + money(side.buckets.passed)),
          ' · ',
          el('span', {}, '⏳' + money(side.buckets.pending)),
          ' · ',
          el('span', { style: { color: '#FF5A5A' } }, '✗' + money(side.buckets.failed))) : null,
        // Day-by-day PRA split — how each of the round's two days contributed.
        (side.praD1 || side.praD2) ? el('div', { class: 'text-[9px] tabular-nums font-bold whitespace-nowrap', style: { color: 'var(--text)', opacity: '.75' } },
          'D1 ' + money(side.praD1) + ' · D2 ' + money(side.praD2) + ' PRA') : null),
      el('div', { class: 'text-right shrink-0' },
        el('div', { class: 'text-sm font-black tabular-nums', style: { color: 'var(--text)' } }, money(side.pra)),
        el('div', { class: 'text-[9px] font-black uppercase tracking-wider', style: { color: won ? hiText : 'var(--text)' } }, live && won ? 'LEADS' : 'PRA')));
  };
  const roundCard = (rd, ri) => {
    const title = rd.phase === 'seed' ? 'Round ' + rd.num : rd.phase === 'semi' ? 'Semifinals' : 'Championship';
    // Current round = GREEN, everything else = pink.
    const headBg = rd.live ? GREEN : PINK;
    const headFg = rd.live ? '#04310A' : '#fff';
    const _today = new Date(); _today.setHours(0, 0, 0, 0);
    const dayLabel = rd.live ? (_today.getTime() <= rd.d1.getTime() ? 'Day 1 of 2' : 'Final day') : null;
    const editable = rd.phase === 'seed' && !RO;
    // Each matchup renders as its OWN boxed pairing with a centered VS badge,
    // so who's playing who reads at a glance.
    const kids = [];
    rd.matchups.forEach((m, i) => {
      kids.push(el('div', { class: 'rounded-lg overflow-hidden', style: { border: '1.5px solid var(--text)', margin: '8px' } },
        m.tag ? el('div', { class: 'px-3 py-0.5 text-[9px] font-black uppercase tracking-widest', style: { color: PINK, background: 'rgba(242,20,140,.06)', borderBottom: '1px solid var(--text)' } }, m.tag) : null,
        sideRow(m.a, m, m.aLabel, editable ? { ri, mi: i, side: 'a' } : null, rd.live),
        el('div', { style: { position: 'relative', borderTop: '1px dashed var(--text)' } },
          el('span', { style: { position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%,-50%)', fontSize: '8px', fontWeight: '900', letterSpacing: '.12em', background: 'var(--card)', color: 'var(--text)', padding: '1px 7px', borderRadius: '0', border: '1px solid var(--text)', lineHeight: '1.2' } }, 'VS')),
        sideRow(m.b, m, m.bLabel, editable ? { ri, mi: i, side: 'b' } : null, rd.live)));
    });
    if (!rd.matchups.length) kids.push(el('div', { class: 'px-3 py-3 text-[11px] text-center', style: { color: 'var(--text-subtle)' } }, 'Matchups set after seeding.'));
    // Playoff cards (Semifinals + Championship) span TWO grid columns — together
    // they fill the row under the seeding rounds — and lay their matchups out
    // two-across to use the width.
    const playoff = rd.phase !== 'seed';
    const body = playoff && rd.matchups.length
      ? [el('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' } }, ...kids)]
      : kids;
    return el('div', { class: 'rounded-lg overflow-hidden' + (playoff ? ' nrla-playoff' : ''), style: { border: '1.5px solid ' + (rd.live ? GREEN : 'var(--text)'), boxShadow: rd.live ? '0 0 0 1px ' + GREEN + ', 0 8px 24px -16px rgba(255,107,61,.5)' : 'none' } },
      el('div', { class: 'flex items-center justify-between px-3 py-1.5', style: { background: headBg } },
        el('span', { class: 'text-[11px] font-black uppercase tracking-wider', style: { color: headFg } }, title + ' · ' + dspan(rd.d1, rd.d2) + (dayLabel ? ' · ' + dayLabel : '')),
        el('div', { class: 'flex items-center gap-1.5' },
          (editable && cfg.matchups[rd.num]) ? el('button', {
            class: 'text-[9px] font-black px-1.5 py-0.5 rounded cursor-pointer',
            style: { background: rd.live ? 'rgba(4,49,10,.18)' : 'rgba(255,255,255,.18)', color: headFg },
            title: 'Reset this round to the default schedule',
            onclick: () => { if (confirm('Reset Round ' + rd.num + ' to the default matchups?')) { delete cfg.matchups[rd.num]; save('Round ' + rd.num + ' matchups reset'); } },
          }, '↺') : null,
          el('span', {
            class: 'text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded inline-flex items-center gap-1',
            style: rd.live ? { background: '#04310A', color: GREEN }
              : (rd.done && !rd.locked) ? { background: '#A9441F', color: '#fff' }
              : { background: 'rgba(255,255,255,.18)', color: '#fff' },
            title: (rd.done && !rd.locked) ? rd.pendingAudits + ' account' + (rd.pendingAudits === 1 ? '' : 's') + ' still pending audit — pending counts as passing, so this result can move until every account is audited and the round locks' : '',
          },
            rd.live ? el('span', { style: { animation: 'nrlaPulse 1.2s ease-in-out infinite' } }, '●') : null,
            rd.live ? 'LIVE' : rd.done ? (rd.locked ? 'FINAL' : 'AUDITING · ' + rd.pendingAudits) : 'UPCOMING'))),
      ...body);
  };
  // ── ONE round card + picker (was a grid of every round) — defaults to
  // the LIVE round; ended comps default to the most recent decided round. ──
  const _roundTitle = (rd) => rd.phase === 'seed' ? 'Round ' + rd.num : rd.phase === 'semi' ? 'Semifinals' : 'Championship';
  let _selIdx = state._nrlaRoundSel;
  if (_selIdx == null || _selIdx < 0 || _selIdx >= R.rounds.length) {
    const _li = R.rounds.findIndex(rd => rd.live);
    let _lastDone = -1; R.rounds.forEach((rd, i) => { if (rd.done) _lastDone = i; });
    _selIdx = _li >= 0 ? _li : (_lastDone >= 0 ? _lastDone : 0);
  }
  const _keepScroll = (fn) => { const sx = window.scrollX, sy = window.scrollY; fn(); setTimeout(() => { mountApp(); requestAnimationFrame(() => window.scrollTo(sx, sy)); }, 0); };
  const roundPicker = el('div', { class: 'px-3 pt-3 flex items-center gap-2 flex-wrap' },
    el('select', {
      class: 'rounded-xl px-2.5 py-1 text-[11px] font-black uppercase tracking-wider cursor-pointer',
      style: { border: '1.5px solid ' + (R.rounds[_selIdx] && R.rounds[_selIdx].live ? GREEN : 'var(--border-2)'), background: 'var(--card)', color: 'var(--text)' },
      onchange: (e) => { const i = Number(e.target.value); _keepScroll(() => { state._nrlaRoundSel = i; }); },
    },
      ...R.rounds.map((rd, i) => {
        const o = el('option', { value: String(i) }, _roundTitle(rd) + (rd.live ? ' · LIVE' : rd.done ? (rd.locked ? ' · Final' : ' · Auditing') : ''));
        if (i === _selIdx) o.selected = true;
        return o;
      })));
  // ── Accounts drill — every D2D account sold on the round's two days:
  // time · customer · ID · contract value · rep, grouped by day. Admin-only
  // (customer-level data stays off rep screens, same as the player cards).
  // ── "Accounts Sold" POPUP — every D2D account on a round's days (rep ·
  // cust id · customer · contract · time · audit chip), with round + team
  // toggles INSIDE the modal. Local state + local re-render (no mountApp),
  // so switching rounds/teams is instant. Admin-only — customer-level data
  // stays off rep screens, same rule as the player cards.
  const openNrlaAccountsModal = (startIdx) => {
    let mIdx = startIdx, mTeam = '';
    let mSort = { key: 'time', asc: true };   // default: chronological
    const overlay = el('div', { class: 'modal-overlay' });
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    const card = el('div', { class: 'card w-full max-w-3xl my-8 flex flex-col overflow-hidden', style: { maxHeight: 'calc(100vh - 64px)' } });
    overlay.append(card); document.body.append(overlay);
    // NRLA is branch-vs-branch — the filter (and the tag next to each rep)
    // runs on the account's OFFICE, not Manage Teams teams.
    const _tcOff = (o) => String(o || '').split(' ').map(w => (w[0] || '').toUpperCase() + w.slice(1).toLowerCase()).join(' ');
    const _officeOf = (x) => _tcOff(x.office || 'Unknown');
    const _isRoundDay = (x, day) => { if (!day || isNaN(day)) return false; const d = _parseIndicatorDay(x); return d && d.getTime() === day.getTime(); };
    const _timeMin = (x) => { const t = _parseIndicatorTime(x); return t ? t.hour * 60 + t.minute : 24 * 60; };
    const _timeStr = (x) => { const t = _parseIndicatorTime(x); return t ? (((t.hour % 12) || 12) + ':' + String(t.minute).padStart(2, '0') + (t.hour >= 12 ? 'p' : 'a')) : '—'; };
    const render = () => {
      card.innerHTML = '';
      const rd = R.rounds[mIdx];
      const _roundD2d = (rawSales || []).filter(x =>
        (typeof _indicatorDeptOf !== 'function' || _indicatorDeptOf(x) === 'd2d')
        && (_isRoundDay(x, rd.d1) || _isRoundDay(x, rd.d2))
        // EXACT same population gate as the comp itself (frPendingServiced):
        // Sold-Not-Started reasons, cancelled/no-showed initial appointments,
        // frozen-no-service — all outside the comp, so none of them belong on
        // the audit list either. This is what makes the round card's pending
        // count and this list's Pending chips reconcile 1:1. 3-day RORs pass
        // the gate and stay — those DO count.
        && (typeof frPendingServiced !== 'function' || frPendingServiced(x)));
      const _teams = [...new Set(_roundD2d.map(_officeOf))].sort();
      if (mTeam && !_teams.includes(mTeam)) mTeam = '';
      const dayBlock = (day, label) => {
        if (!day || isNaN(day)) return null;
        const _sortVal = (x) => {
          switch (mSort.key) {
            case 'rep':      return getCanonicalRepName(x.rep || '').toLowerCase();
            case 'custid':   return Number(x.customerId) || 0;
            case 'customer': return String(x.customer || '').toLowerCase();
            case 'contract': return Number(x.contractValue) || 0;
            case 'audit':    return (typeof _auditStatusOf === 'function') ? _auditStatusOf(x.customerFlags) : '';
            default:         return _timeMin(x);
          }
        };
        const rows = _roundD2d.filter(x => _isRoundDay(x, day) && (!mTeam || _officeOf(x) === mTeam))
          .sort((a, b) => {
            const va = _sortVal(a), vb = _sortVal(b);
            const c = (typeof va === 'string') ? va.localeCompare(vb) : (va - vb);
            return mSort.asc ? c : -c;
          });
        const rev = rows.reduce((a, x) => a + (Number(x.contractValue) || 0), 0);
        return el('div', { class: 'mb-3' },
          el('div', { class: 'px-3 py-1.5 text-[10px] font-black uppercase tracking-widest flex items-center justify-between', style: { background: 'var(--card-2)', borderRadius: '0', border: '1px solid var(--border)', borderBottom: 'none' } },
            el('span', {}, label + ' · ' + day.toLocaleDateString('en-US', { weekday: 'short', month: 'numeric', day: 'numeric' })),
            el('span', { class: 'tabular-nums' }, rows.length + ' accts · ' + money(rev))),
          el('div', { class: 'scroll-x', style: { border: '1px solid var(--border)', borderRadius: '0' } },
            rows.length === 0
              ? el('div', { class: 'p-4 text-center text-xs italic', style: { color: 'var(--text-muted)' } }, 'No qualifying D2D accounts this day.')
              : el('table', { class: 'w-full text-[11px]' },
                  el('thead', { class: 'text-[9px] uppercase tracking-wider', style: { background: 'var(--card-2)', color: 'var(--text-muted)' } },
                    el('tr', {},
                      ...[['rep', 'Rep', 'text-left pl-3 pr-2'], ['custid', 'Cust ID', 'text-left px-2'], ['customer', 'Customer', 'text-left px-2'], ['contract', 'Contract', 'text-right px-2'], ['time', 'Time', 'text-left px-2'], ['audit', 'Audit', 'text-left pl-2 pr-3']].map(([k, lab, cls]) => el('th', {
                        class: cls + ' py-1.5 cursor-pointer select-none',
                        style: mSort.key === k ? { color: 'var(--accent)', fontWeight: '800' } : {},
                        title: 'Sort by ' + lab.toLowerCase(),
                        onclick: () => { mSort = mSort.key === k ? { key: k, asc: !mSort.asc } : { key: k, asc: true }; render(); },
                      }, lab)))),
                  el('tbody', {},
                    ...rows.map(x => {
                      // Chip mirrors the COMP's audit semantics (same rules as
                      // the round card's pending count): under-$99 = Last
                      // Resort, out of the comp with no audit needed — it
                      // must NOT read "Pending" here while the card has
                      // already written it off (card said 5, chips said 30).
                      let _st = (typeof _auditStatusOf === 'function') ? _auditStatusOf(x.customerFlags) : 'pending';
                      if (_st === 'pending' && (Number(x.initialPrice) || 0) < 99) _st = 'lastresort';
                      const _stMeta = _st === 'passed' ? ['Passed', '#DF643A', 'rgba(223,100,58,.14)']
                        : _st === 'failed' ? ['Failed', '#B91C1C', 'rgba(220,38,38,.10)']
                        : _st === 'noaudit' ? ['No Audit', 'var(--text-muted)', 'var(--card-2)']
                        : _st === 'lastresort' ? ['Last Resort', 'var(--text-muted)', 'var(--card-2)']
                        : ['Pending', '#A9441F', 'rgba(156,63,30,.10)'];
                      return el('tr', { class: 'border-t', style: { borderColor: 'var(--border)' } },
                        el('td', { class: 'pl-3 pr-2 py-1.5 whitespace-nowrap' }, getCanonicalRepName(x.rep || '—'),
                          el('span', { class: 'ml-1 text-[9px]', style: { color: 'var(--text-subtle)' } }, _officeOf(x))),
                        el('td', { class: 'px-2 py-1.5 tabular-nums', style: { color: 'var(--text-muted)' } }, x.customerId || '—'),
                        el('td', { class: 'px-2 py-1.5 whitespace-nowrap' }, x.customer || '—'),
                        el('td', { class: 'px-2 py-1.5 text-right tabular-nums font-semibold' }, money(Number(x.contractValue) || 0)),
                        el('td', { class: 'px-2 py-1.5 tabular-nums whitespace-nowrap' }, _timeStr(x)),
                        el('td', { class: 'pl-2 pr-3 py-1.5' },
                          el('span', { class: 'text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded whitespace-nowrap', style: { color: _stMeta[1], background: _stMeta[2] } }, _stMeta[0])));
                    })))));
      };
      const _mSel = (val, opts, onpick, activeBorder) => el('select', {
        class: 'rounded-lg border px-2.5 py-1 text-[11px] font-semibold cursor-pointer',
        style: { borderColor: activeBorder ? 'var(--accent)' : 'var(--border-2)', background: 'var(--card)', color: 'var(--text)' },
        onchange: (e) => onpick(e.target.value),
      }, ...opts.map(([v, lab]) => { const o = el('option', { value: v }, lab); if (String(v) === String(val)) o.selected = true; return o; }));
      const sameDay = rd.d1 && rd.d2 && rd.d1.getTime() === rd.d2.getTime();
      card.append(
        el('div', { class: 'px-5 py-3 flex items-center justify-between gap-3 flex-wrap border-b', style: { borderColor: 'var(--border)' } },
          el('div', { class: 'flex items-center gap-2 flex-wrap' },
            el('h2', { class: 'text-lg font-bold' }, 'Accounts Sold'),
            _mSel(mIdx, R.rounds.map((r2, i2) => [i2, _roundTitle(r2) + (r2.live ? ' · LIVE' : '')]), (v) => { mIdx = Number(v); render(); }),
            _mSel(mTeam, [['', 'All offices'], ..._teams.map(t => [t, t])], (v) => { mTeam = v; render(); }, !!mTeam)),
          el('button', { class: 'text-xl leading-none text-muted-', style: { lineHeight: '1' }, onclick: () => overlay.remove() }, '×')),
        el('div', { class: 'p-4 overflow-auto' },
          dayBlock(rd.d1, 'Day 1'),
          sameDay ? null : dayBlock(rd.d2, 'Day 2')));
    };
    render();
  };
  const roundDrillBtn = (RO || !R.rounds.length) ? null : el('button', {
    class: 'rounded-xl px-3 py-2 text-[10px] font-black uppercase tracking-widest cursor-pointer transition border hover:brightness-95 whitespace-nowrap',
    style: { borderColor: 'var(--border-2)', color: 'var(--text)' },
    onclick: () => openNrlaAccountsModal(_selIdx),
  }, '📋 Accounts sold');
  roundPicker.append(
    roundDrillBtn || el('span', {}),
    el('div', { class: 'flex-1' }),
    nrlaBranchClocks(R.teams, cfg, { RO, save, small: true }) || el('span', {}),
    el('span', { class: 'text-[10px] font-bold uppercase tracking-wider whitespace-nowrap', style: { color: 'var(--text-subtle)' }, title: 'When the board\'s data was last synced from FieldRoutes' },
      'Synced ' + syncStr),
  );
  const roundsGrid = R.rounds.length
    ? el('div', { style: { borderTop: '1px solid var(--border)' } },
        roundPicker,
        el('div', { class: 'p-3' },
          roundCard(R.rounds[_selIdx], _selIdx)))
    : el('div', { class: 'p-4 text-center text-[11px] font-bold uppercase tracking-widest', style: { color: 'var(--text-subtle)', borderTop: '1px solid var(--border)' } },
        'No rounds scheduled yet.');
  const footer = el('div', { class: 'px-3 py-2 text-center text-[10px] font-bold uppercase tracking-widest', style: { color: 'var(--text-subtle)', borderTop: '1px solid var(--border)' } },
    'Updates will be sent daily · RIDDMADE');

  // (competing-branch chips moved into the 📋 roster modal — per Isaac)
  return _nrlaWrap(el('div', { class: 'card overflow-hidden' }, hero,
    standingsCard, repBoard, prizeStrip, prizeCard, roundsGrid, footer));
}

// ── COMPETITIONS tab — every comp under one roof ────────────────────────────
// The old workflow (Indicators → Comps toggle) now lives on its own tab,
// visible to everyone: pick a competition, see its board. Admins get their
// full management controls; reps get a read-only view. Data comes from the
// shared cloud dataset + shared config (see nrla_rep_access.sql).
// ── 🎁 MYSTERY BOX — spin-to-reveal comp prize (per Isaac). The reveal is
// PRESET by an admin (reps don't know that): the animation cycles decoy
// prizes and "lands" on the configured one. Boxes live in app_settings
// 'mystery_boxes'; prize text is base64'd so a curious rep poking network
// responses doesn't casually read their prize early. Opened state is
// per-device (localStorage) — delivery tracking is the admin's Delivered
// checkbox, so no rep-side writes are needed.
// Prize rarity tiers (per Isaac) — the color of the light IS the drama.
const MB_RARITIES = {
  bronze:   { label: 'Bronze',   color: '#CD8A4B', text: '#E2A868', rays: false },
  silver:   { label: 'Silver',   color: '#C7D4E2', text: '#E4EDF6', rays: false },
  gold:     { label: 'Gold',     color: '#FFD86B', text: '#FFE59A', rays: true },
  platinum: { label: 'Platinum', color: '#9FDCFF', text: '#E3F5FF', rays: true },
};
function _mbRarityOf(prize) { return MB_RARITIES[(state._mbRarity || {})[prize]] || MB_RARITIES.bronze; }
const MB_DEFAULT_DECOYS = ['$500 cash', '$100 cash', 'AirPods Pro', 'YETI cooler', '$50 gift card', 'Dinner for two', 'Massage gun', 'Day off', 'Team lunch', '$250 cash'];
const _mbEnc = (s) => { try { return btoa(unescape(encodeURIComponent(String(s)))); } catch (e) { return ''; } };
const _mbDec = (s) => { try { return decodeURIComponent(escape(atob(String(s)))); } catch (e) { return '?'; } };
// Opened state is CROSS-DEVICE (rep-UX audit #11): localStorage stays the
// fast cache, the mb_opened table (mb_opened.sql) is the shared record —
// open a box on your phone and the desktop knows.
function _mbOpenedMap() {
  let m = {};
  try { m = JSON.parse(localStorage.getItem('ridd_mb_opened_v1') || '{}') || {}; } catch (e) { m = {}; }
  return Object.assign({}, state._mbOpenedSrv || {}, m);
}
function _mbMarkOpened(id) {
  try { const m = JSON.parse(localStorage.getItem('ridd_mb_opened_v1') || '{}') || {}; m[id] = new Date().toISOString(); localStorage.setItem('ridd_mb_opened_v1', JSON.stringify(m)); } catch (e) { /* private mode */ }
  state._mbOpenedSrv = Object.assign({}, state._mbOpenedSrv || {}, { [id]: new Date().toISOString() });
  try {
    if (!DEMO && supabase && state.profile) {
      Promise.resolve(supabase.from('mb_opened').upsert({ profile_id: state.profile.id, box_id: String(id) }, { onConflict: 'profile_id,box_id' }))
        .catch(() => { /* table not created yet — localStorage still covers this device */ });
    }
  } catch (e) { /* non-fatal */ }
}
async function loadMysteryBoxes() {
  if (state._mbLoaded || DEMO || !supabase) return;
  state._mbLoaded = true;
  try {
    const { data } = await supabase.from('app_settings').select('value').eq('key', 'mystery_boxes').maybeSingle();
    const v = (data && data.value) || {};
    state._mysteryBoxes = Array.isArray(v.boxes) ? v.boxes : [];
    state._mbGoals = (v.goals && typeof v.goals === 'object') ? v.goals : { rookie: 1500, vet: 2000 };
    state._mbPool = Array.isArray(v.pool) ? v.pool : [];
    state._mbOdds = (v.odds && typeof v.odds === 'object') ? v.odds : {};
    state._mbRarity = (v.rarity && typeof v.rarity === 'object') ? v.rarity : {};
    // Cross-device opened state (mb_opened.sql) — own rows only.
    try {
      if (state.profile) {
        const { data: op } = await supabase.from('mb_opened').select('box_id, opened_at').eq('profile_id', state.profile.id);
        if (Array.isArray(op)) state._mbOpenedSrv = Object.fromEntries(op.map(r => [r.box_id, r.opened_at]));
      }
    } catch (e2) { /* table not created yet — localStorage covers this device */ }
  } catch (e) { state._mysteryBoxes = []; state._mbGoals = { rookie: 1500, vet: 2000 }; state._mbPool = []; state._mbOdds = {}; state._mbRarity = {}; }
  if (state.view === 'nrla') mountApp();
}
async function _mbSaveCfg(patch) {
  if (patch.boxes) state._mysteryBoxes = patch.boxes;
  if (patch.goals) state._mbGoals = patch.goals;
  if (patch.pool) state._mbPool = patch.pool;
  if (patch.odds) state._mbOdds = patch.odds;
  if (patch.rarity) state._mbRarity = patch.rarity;
  if (DEMO || !supabase || !isAdminRole(state.profile?.role)) return;
  const value = { boxes: state._mysteryBoxes || [], goals: state._mbGoals || { rookie: 1500, vet: 2000 }, pool: state._mbPool || [], odds: state._mbOdds || {}, rarity: state._mbRarity || {} };
  try {
    const { error } = await supabase.from('app_settings').upsert({ key: 'mystery_boxes', value }, { onConflict: 'key' });
    if (error) toast('Mystery Box save failed: ' + error.message, 'error');
  } catch (e) { toast('Mystery Box save failed: ' + ((e && e.message) || e), 'error'); }
}
const saveMysteryBoxes = (boxes) => _mbSaveCfg({ boxes });
// Per-day qualification board — revenue sold THAT day, same audit gate as
// Spring Cleaning / LMS (passed + no-audit + pending-assumed-passing count;
// failed audit and Last Resort are out), D2D dept, tier from Manage Teams
// Rookie/Vet tags (untagged reps face the Veteran goal).
function mysteryBoxDayStats(day) {
  const raw = state._indicatorRawSales || [];
  const byRep = new Map();
  for (const s of raw) {
    if (typeof _indicatorDeptOf === 'function' && _indicatorDeptOf(s) !== 'd2d') continue;
    const _iso = (typeof dateSoldToIso === 'function' ? dateSoldToIso(s.dateSold) : '');
    if (!_iso || _iso < day.from || _iso > day.to) continue;
    const nm = getCanonicalRepName(s.rep);
    if (!nm) continue;
    const cv = Number(s.contractValue) || 0;
    // TOTAL = Pending/Serviced revenue (the FieldRoutes gate) — sold-not-
    // started rows don't exist anywhere on this board (per Isaac). The
    // three buckets below decompose Total exactly:
    //   PASSED  = (passed audit OR no audit) AND initial ≥ $99 — scores
    //   PENDING = not Last Resort, no audit flag yet — waiting
    //   FAILED  = Last Resort (<$99) OR failed audit
    if (typeof frPendingServiced === 'function' && !frPendingServiced(s)) continue;
    const o = byRep.get(nm) || { name: nm, rev: 0, n: 0, total: 0, totalN: 0, failed: 0, pending: 0, offRev: {} };
    o.total += cv; o.totalN++;
    if (s.office) o.offRev[s.office] = (o.offRev[s.office] || 0) + cv;
    const isLR = (Number(s.initialPrice) || 0) < 99;
    const isFailAudit = (typeof SC_FAIL_RE !== 'undefined') && SC_FAIL_RE.test(s.customerFlags || '');
    if (isLR || isFailAudit) o.failed += cv;
    else if (typeof scAuditPassed === 'function' && scAuditPassed(s.customerFlags)) { o.rev += cv; o.n++; }
    else o.pending += cv;
    byRep.set(nm, o);
  }
  return [...byRep.values()].map(o => {
    const tier = getRepTier(o.name);
    const goal = tier === 'rookie' ? (Number(day.rookie) || 0) : (Number(day.vet) || 0);
    // Office = where they sold the most (by revenue) inside the window.
    const office = (Object.entries(o.offRev || {}).sort((x, y) => y[1] - x[1])[0] || [''])[0];
    return { ...o, tier, goal, office, qualified: goal > 0 && o.rev >= goal };
  }).sort((a, b) => (b.qualified - a.qualified) || (b.rev - a.rev));
}
// Rep drill-down for the Mystery Box tier tables (admin verify tool):
// every account in the comp window with its bucket + the evidence (flags,
// initial, status), so Pending accounts can be chased and audit flags
// added in the CRM. Same gates + bucket rules as mysteryBoxDayStats —
// keep the two in lockstep.
function openMbRepModal(rep, day) {
  const raw = state._indicatorRawSales || [];
  const rows = [];
  for (const s of raw) {
    if (typeof _indicatorDeptOf === 'function' && _indicatorDeptOf(s) !== 'd2d') continue;
    const _iso = (typeof dateSoldToIso === 'function' ? dateSoldToIso(s.dateSold) : '');
    if (!_iso || _iso < day.from || _iso > day.to) continue;
    if (getCanonicalRepName(s.rep) !== rep.name) continue;
    if (typeof frPendingServiced === 'function' && !frPendingServiced(s)) continue;
    const cv = Number(s.contractValue) || 0;
    const init = Number(s.initialPrice) || 0;
    const isLR = init < 99;
    const isFailAudit = (typeof SC_FAIL_RE !== 'undefined') && SC_FAIL_RE.test(s.customerFlags || '');
    let bucket, why;
    if (isLR || isFailAudit) { bucket = 'failed'; why = isFailAudit ? 'Failed audit' : 'Last Resort (<$99 initial)'; }
    else if (typeof scAuditPassed === 'function' && scAuditPassed(s.customerFlags)) { bucket = 'passed'; why = /passed/i.test(s.customerFlags || '') ? 'Passed audit' : 'No audit'; }
    else { bucket = 'pending'; why = 'Awaiting audit flag'; }
    rows.push({ s, cv, init, bucket, why });
  }
  const ord = { pending: 0, failed: 1, passed: 2 };
  rows.sort((x, y) => (ord[x.bucket] - ord[y.bucket]) || (y.cv - x.cv));
  const sum = (b) => rows.filter(r => r.bucket === b).reduce((a2, r) => a2 + r.cv, 0);
  const B = { passed: { c: '#DF643A', bg: 'rgba(223,100,58,.14)', lab: 'Passed' },
              pending: { c: '#A9441F', bg: 'rgba(240,172,30,.16)', lab: 'Pending' },
              failed: { c: '#B91C1C', bg: 'rgba(220,38,38,.10)', lab: 'Failed' } };
  const overlay = el('div', { class: 'fixed inset-0 bg-black/70 z-40 flex items-start justify-center p-4 overflow-y-auto' });
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  const statChip = (lab, v, color) => el('div', { class: 'text-center' },
    el('div', { class: 'text-[9px] font-black uppercase tracking-widest', style: { color: 'var(--text-muted)' } }, lab),
    el('div', { class: 'text-sm font-black tabular-nums', style: color ? { color } : {} }, v));
  overlay.append(el('div', { class: 'card p-5 w-full', style: { maxWidth: '760px' } },
    el('div', { class: 'flex items-center justify-between gap-3 mb-1' },
      el('div', {},
        el('h3', { class: 'text-base font-bold' }, rep.name),
        el('div', { class: 'text-xs text-muted-' },
          (rep.tier === 'rookie' ? 'Rookie' : 'Veteran') + ' · goal ' + fmt.usd0(rep.goal || 0) + ' · ' + day.from + (day.to !== day.from ? ' → ' + day.to : ''))),
      el('button', { class: 'text-xl leading-none cursor-pointer px-2', onclick: () => overlay.remove() }, '×')),
    el('div', { class: 'flex items-center justify-between gap-2 py-2 px-3 rounded-lg mb-3 flex-wrap', style: { background: 'var(--card-2)' } },
      statChip('Accounts', String(rows.length)),
      statChip('Total', fmt.usd0(rows.reduce((a2, r) => a2 + r.cv, 0))),
      statChip('Passed', fmt.usd0(sum('passed')), B.passed.c),
      statChip('Pending', fmt.usd0(sum('pending')), B.pending.c),
      statChip('Failed', fmt.usd0(sum('failed')), B.failed.c)),
    rows.length === 0
      ? el('div', { class: 'p-4 text-center text-xs text-muted-' }, 'No counting accounts in this window.')
      : el('div', { style: { maxHeight: '62vh', overflowY: 'auto' } },
          el('table', { class: 'w-full text-xs' },
            el('thead', {}, el('tr', { class: 'text-left text-[9px] uppercase tracking-widest text-muted-' },
              el('th', { class: 'py-1.5 pr-2' }, 'Customer'),
              el('th', { class: 'py-1.5 pr-2 hidden sm:table-cell' }, 'Subscription'),
              el('th', { class: 'py-1.5 pr-2 hidden sm:table-cell' }, 'Sold'),
              el('th', { class: 'py-1.5 pr-2 text-right' }, 'Initial'),
              el('th', { class: 'py-1.5 pr-2 text-right' }, 'Value'),
              el('th', { class: 'py-1.5 text-right' }, 'Status'))),
            el('tbody', {}, ...rows.map(({ s, cv, init, bucket, why }) => el('tr', { class: 'border-t border-', style: bucket === 'pending' ? { background: B.pending.bg } : {} },
              el('td', { class: 'py-1.5 pr-2' },
                el('div', { class: 'font-semibold' }, s.customer || '—'),
                el('div', { class: 'text-[10px] text-muted- tabular-nums' }, (s.customerId ? '#' + s.customerId : '') + (s.customerFlags ? ' · ' + s.customerFlags : ''))),
              el('td', { class: 'py-1.5 pr-2 hidden sm:table-cell' }, s.subscription || '—'),
              el('td', { class: 'py-1.5 pr-2 whitespace-nowrap text-muted- hidden sm:table-cell' }, s.dateSold || '—'),
              el('td', { class: 'py-1.5 pr-2 text-right tabular-nums', style: init < 99 ? { color: B.failed.c, fontWeight: '700' } : {} }, fmt.usd0(init)),
              el('td', { class: 'py-1.5 pr-2 text-right tabular-nums font-bold' }, fmt.usd0(cv)),
              el('td', { class: 'py-1.5 text-right whitespace-nowrap' },
                el('span', { class: 'text-[10px] font-black px-1.5 py-0.5 rounded', style: { color: B[bucket].c, background: B[bucket].bg }, title: why }, B[bucket].lab)))))))));
  document.body.append(overlay);
}

// 🪙 Pay Mystery Box winners in RIDDCOIN — one click, one ledger row per
// winner with the comp window in the reason. Reps are matched to app
// accounts by name signature (token-sorted, punctuation-blind), so
// "Beaird, Ethan" finds profile "Ethan Beaird". Unmatched names are
// reported, never silently skipped.
async function _mbPayWinners(qualifiedList, day) {
  const amtStr = prompt('RIDDCOIN per box earned? Each of the ' + qualifiedList.length + ' qualified rep(s) receives this amount.', '500');
  if (amtStr == null) return;
  const amt = Math.abs(Math.round(Number(amtStr) || 0));
  if (!amt) { toast('Enter a whole number of RIDDCOIN', 'warn'); return; }
  const { data: profs, error } = await supabase.from('profiles').select('id, full_name');
  if (error) { toast('Could not load profiles: ' + error.message, 'error'); return; }
  const sig = (n) => String(n || '').toLowerCase().replace(/[^a-z]+/g, ' ').split(/\s+/).filter(Boolean).sort().join(' ');
  const bySig = new Map();
  (profs || []).forEach(pf => bySig.set(sig(pf.full_name), pf));
  const reason = 'Mystery Box ' + day.from + (day.to !== day.from ? ' \u2192 ' + day.to : '');
  let paid = 0;
  const missed = [];
  for (const r of qualifiedList) {
    const pf = bySig.get(sig(r.name));
    if (!pf) { missed.push(r.name); continue; }
    const { error: gErr } = await supabase.rpc('riddcoin_grant', { p_user: pf.id, p_amount: amt, p_reason: reason });
    if (gErr) { missed.push(r.name + ' (' + gErr.message + ')'); continue; }
    paid++;
  }
  state._rcLoadedAt = 0; // marketplace refreshes on next open
  toast('\ud83e\ude99 Paid ' + paid + ' winner' + (paid === 1 ? '' : 's') + ' ' + amt + ' RIDDCOIN each'
    + (missed.length ? ' \u00b7 NO app account (grant manually): ' + missed.join(', ') : ''), missed.length ? 'warn' : 'success');
}

function _mbEnsureStyles() {
  if (document.getElementById('mbStyles')) return;
  const st = document.createElement('style');
  st.id = 'mbStyles';
  st.textContent = `
@keyframes mbShake { 0%,100%{transform:rotate(0)} 20%{transform:rotate(-10deg)} 40%{transform:rotate(9deg)} 60%{transform:rotate(-7deg)} 80%{transform:rotate(5deg)}}
@keyframes mbPop { 0%{transform:scale(.2);opacity:0} 60%{transform:scale(1.15)} 100%{transform:scale(1);opacity:1}}
@keyframes mbBurst { 0%{transform:translate(0,0) scale(1);opacity:1} 100%{transform:translate(var(--bx),var(--by)) scale(.4);opacity:0}}
.mb-shake{animation:mbShake .5s ease-in-out infinite}
.mb-pop{animation:mbPop .45s cubic-bezier(.2,1.4,.4,1) forwards}
.mb-burst{position:absolute;left:50%;top:42%;font-size:22px;animation:mbBurst 1.1s ease-out forwards;pointer-events:none}
.mb-strip{overflow-x:auto;scrollbar-width:none;-ms-overflow-style:none;cursor:grab}
.mb-strip::-webkit-scrollbar{display:none}
.mb-strip.dragging{cursor:grabbing;scroll-snap-type:none !important}
@keyframes mbLidUp { 0%{transform:scaleY(0)} 62%{transform:scaleY(1.07)} 100%{transform:scaleY(1)} }
@keyframes mbFlash { 0%{opacity:0} 35%{opacity:.85} 100%{opacity:0} }
@keyframes mbRise { 0%{transform:translateX(-50%) translateY(46px) scale(.5);opacity:0} 65%{opacity:1} 82%{transform:translateX(-50%) translateY(-146px) scale(1.03)} 100%{transform:translateX(-50%) translateY(-135px) scale(1);opacity:1} }
@keyframes mbFloat { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-12px)} }
@keyframes mbGlowPulse { 0%,100%{opacity:.5;transform:translate(-50%,-50%) scale(1)} 50%{opacity:.85;transform:translate(-50%,-50%) scale(1.12)} }
@keyframes mbSceneIn { 0%{opacity:0;transform:scale(.92)} 100%{opacity:1;transform:scale(1)} }
@keyframes mbIdle { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-7px)} }
@keyframes mbGlint { 0%{opacity:0;transform:scale(.4)} 25%{opacity:.95;transform:scale(1)} 100%{opacity:0;transform:scale(1.6)} }
@keyframes mbLeak { 0%{opacity:0} 25%{opacity:.45} 40%{opacity:.2} 60%{opacity:.8} 75%{opacity:.55} 100%{opacity:1} }
@keyframes mbFlashFull { 0%{opacity:0} 18%{opacity:1} 100%{opacity:0} }
@keyframes mbRays { 0%{transform:translate(-50%,-50%) rotate(0)} 100%{transform:translate(-50%,-50%) rotate(360deg)} }
@keyframes mbDrift { 0%,100%{transform:translate(-50%,-50%) translateX(-26px)} 50%{transform:translate(-50%,-50%) translateX(26px)} }
@keyframes mbStamp { 0%{opacity:0;transform:translateX(-50%) scale(1.8)} 55%{opacity:1;transform:translateX(-50%) scale(.96)} 100%{opacity:1;transform:translateX(-50%) scale(1)} }
@keyframes mbFadeUp { 0%{opacity:0;transform:translateX(-50%) translateY(14px)} 100%{opacity:1;transform:translateX(-50%) translateY(0)} }
@keyframes mbOrb { 0%,100%{opacity:.75;transform:translateX(-50%) scale(1)} 50%{opacity:1;transform:translateX(-50%) scale(1.18)} }
@keyframes mbOrbIn { 0%{opacity:0;transform:translateX(-50%) translateY(46px) scale(.35)} 100%{opacity:1;transform:translateX(-50%) translateY(0) scale(1)} }`;
  document.head.append(st);
}
// A professional CSS gift box (no emoji): beveled charcoal base, velvet
// slot, brand plate — the same box at ring size and hero size.
// ── THE BOX — drawn to match the IcyBox reference: a chamfered suede
// jewelry box seen slightly from above. Front face + thin visible lid-top,
// octagonal silhouette, matte suede shading with a cool ambient edge, small
// gold keyhole riding the seam. Closed (carousel) and open (hero) variants
// share the same body so the reveal reads as the SAME box.
function _mbBoxArt(w, opts) {
  const o = opts || {};
  const t = Math.round(w * 0.075);         // visible lid-top sliver
  const L = Math.round(w * 0.21);          // lid band height
  const B = Math.round(w * 0.46);          // base height
  const H = t + L + B;
  const grain = 'radial-gradient(rgba(255,255,255,.045) 1px, transparent 1.3px)';
  const suedeFront = grain + ', linear-gradient(168deg, #5c4c40 0%, #4a3b31 40%, #382c25 75%, #2b211b 100%)';
  const suedeLid = grain + ', linear-gradient(180deg, #6b594b 0%, #55443a 70%, #46372e 100%)';
  const root = el('div', { style: { position: 'relative', width: w + 'px', height: Math.round(H * 1.12) + 'px', pointerEvents: 'none' } });
  // Ground shadow
  root.append(el('div', { style: { position: 'absolute', left: '50%', bottom: '-3%', transform: 'translateX(-50%)', width: '92%', height: '12%', borderRadius: '50%', background: 'radial-gradient(ellipse, rgba(0,0,10,.6) 0%, transparent 70%)', filter: 'blur(4px)' } }));
  const bodyTop = Math.round(H * 0.12) / 2;   // breathing room
  const box = el('div', { style: { position: 'absolute', left: '0', bottom: '0', width: w + 'px', height: H + 'px', filter: 'drop-shadow(0 10px 14px rgba(0,0,10,.5))' } });
  if (!o.open) {
    // Lid TOP sliver — flattened octagon, lit; narrower at the back edge.
    box.append(el('div', { style: { position: 'absolute', left: '0', top: '0', width: '100%', height: t + 'px', clipPath: 'polygon(13% 0, 87% 0, 96% 100%, 4% 100%)', background: grain + ', linear-gradient(180deg, #83705f 0%, #6b594b 100%)', backgroundSize: '4px 4px, 100% 100%' } }));
    // Lid band — chamfered corners, slight overhang.
    box.append(el('div', { style: { position: 'absolute', left: '0', top: t + 'px', width: '100%', height: L + 'px', clipPath: 'polygon(0 34%, 3.5% 0, 96.5% 0, 100% 34%, 100% 100%, 0 100%)', background: suedeLid, backgroundSize: '4px 4px, 100% 100%', boxShadow: 'inset 0 1px 0 rgba(255,255,255,.12)' } },
      el('div', { style: { position: 'absolute', left: '50%', top: '38%', transform: 'translateX(-50%)', fontSize: Math.max(7, Math.round(w * .078)) + 'px', fontWeight: '900', letterSpacing: '.24em', fontStyle: 'italic', color: 'rgba(232,198,106,.75)', textShadow: '0 -1px 0 rgba(0,0,0,.7), 0 1px 0 rgba(255,235,180,.18)' } }, 'RIDD')));
  } else {
    // OPEN: dark velvet mouth where the lid was, with a lit front lip.
    box.append(el('div', { style: { position: 'absolute', left: '2%', top: (t + Math.round(L * 0.45)) + 'px', width: '96%', height: Math.round(L * 0.62) + 'px', clipPath: 'polygon(1% 100%, 4% 0, 96% 0, 99% 100%)', background: 'linear-gradient(180deg, #061710 0%, #0d3a24 55%, #0a2718 100%)', boxShadow: 'inset 0 4px 10px rgba(0,0,0,.85)' } }));
    box.append(el('div', { style: { position: 'absolute', left: '0', top: (t + L - 3) + 'px', width: '100%', height: '4px', background: 'linear-gradient(90deg, rgba(255,255,255,.06), rgba(255,255,255,.16) 50%, rgba(255,255,255,.06))' } }));
  }
  // Base — full-width front, chamfered bottom corners, suede falloff.
  const baseTop = o.open ? (t + L) : (t + L);
  box.append(el('div', { style: { position: 'absolute', left: Math.round(w * 0.015) + 'px', top: baseTop + 'px', width: Math.round(w * 0.97) + 'px', height: B + 'px', clipPath: 'polygon(0 0, 100% 0, 100% 80%, 96.5% 100%, 3.5% 100%, 0 80%)', background: suedeFront, backgroundSize: '4px 4px, 100% 100%', boxShadow: 'inset 0 2px 4px rgba(0,0,0,.35), inset 3px 0 8px rgba(20,30,80,.12), inset -3px 0 8px rgba(0,0,0,.3)' } }));
  // Seam shadow between lid and base.
  box.append(el('div', { style: { position: 'absolute', left: '2%', top: (t + L - 1) + 'px', width: '96%', height: '2px', background: 'linear-gradient(90deg, rgba(0,0,0,.65), rgba(0,0,0,.4) 50%, rgba(0,0,0,.65))' } }));
  // Gold keyhole escutcheon riding the seam (small, like the reference).
  const kw = Math.max(7, Math.round(w * 0.085));
  box.append(el('div', { style: { position: 'absolute', left: '50%', top: (t + L + Math.round(B * 0.30)) + 'px', transform: 'translateX(-50%)', width: kw + 'px', height: Math.round(kw * 1.5) + 'px', borderRadius: '46% 46% 40% 40%', background: 'linear-gradient(165deg, #e9c76c 0%, #b8892f 55%, #8a6420 100%)', boxShadow: '0 1px 3px rgba(0,0,0,.75), inset 0 1px 1px rgba(255,255,255,.45)', zIndex: 3 } },
    el('div', { style: { position: 'absolute', left: '50%', top: '22%', transform: 'translateX(-50%)', width: '32%', height: '26%', borderRadius: '50%', background: '#160f0a' } }),
    el('div', { style: { position: 'absolute', left: '50%', top: '42%', transform: 'translateX(-50%)', width: '0', height: '0', borderLeft: Math.round(kw * .12) + 'px solid transparent', borderRight: Math.round(kw * .12) + 'px solid transparent', borderBottom: Math.round(kw * .42) + 'px solid #160f0a' } })));
  // OPEN: the lifted lid stands behind the box, leaning back — velvet inner
  // face toward camera inside a suede rim, gold frame line.
  let lidEl = null;
  if (o.open) {
    lidEl = el('div', { style: { position: 'absolute', left: '3%', bottom: (B + Math.round(L * 0.72)) + 'px', width: '94%', height: Math.round(L * 2.5) + 'px', transformOrigin: '50% 100%', zIndex: 0 } },
      el('div', { style: { position: 'absolute', inset: '0', clipPath: 'polygon(7% 0, 93% 0, 100% 100%, 0 100%)', background: suedeLid, backgroundSize: '4px 4px, 100% 100%' } }),
      el('div', { style: { position: 'absolute', inset: '7% 10% 6% 10%', clipPath: 'polygon(3% 0, 97% 0, 100% 100%, 0 100%)', background: 'linear-gradient(180deg, #0d3a24 0%, #124528 55%, #0a2718 100%)', boxShadow: 'inset 0 0 18px rgba(0,0,0,.7)' } },
        el('div', { style: { position: 'absolute', inset: '9%', border: '1px solid rgba(232,198,106,.35)', borderRadius: '0' } })));
    box.style.zIndex = '2';
  }
  root.append(box);
  return { root, lidEl };
}
function _mbGiftEl(w) { return _mbBoxArt(w).root; }
// ── The Icybox-style picker: a carousel of identical gift boxes. Spin it
// left/right by dragging (or trackpad/touch swipe), then TAP a box — that
// box opens. Every box holds the same preset prize; the choosing is the
// show (perfect for a screen recording).
function openMysteryBoxOverlay(box) {
  _mbEnsureStyles();
  const prize = _mbDec(box.prize);
  const overlay = el('div', { class: 'modal-overlay', style: { background: 'radial-gradient(circle at 50% 55%, #1b2545 0%, #10152b 48%, #070a14 88%)', zIndex: '10000', display: 'flex', alignItems: 'center', justifyContent: 'center' } });
  const title = el('div', { class: 'font-display text-2xl', style: { color: '#fff', textAlign: 'center' } }, 'Pick your box');
  const hint = el('div', { class: 'text-xs mt-1', style: { color: 'rgba(255,255,255,.55)', textAlign: 'center' } }, 'Spin left or right \u00b7 tap the one that feels lucky');
  // Odds legend — the pool with its percentages, icybox-style. Pure show:
  // the outcome is already locked, but the odds ARE the real arming odds.
  const _poolL = state._mbPool || [];
  const legend = _poolL.length ? el('div', { class: 'flex items-center justify-center gap-2 mt-3', style: { maxWidth: '96vw', margin: '12px auto 0', flexWrap: 'nowrap', overflowX: 'auto' } },
    ..._poolL.map(p => { const rm = _mbRarityOf(p); return el('span', { class: 'text-[11px] font-bold px-2.5 py-1 rounded-full', style: { background: rm.color + '1f', color: rm.text, border: '1px solid ' + rm.color + '44' } }, p); })) : null;
  // ── IcyBox-style 3D CAROUSEL: the boxes stand on a floor and orbit in
  // depth — front box big and lit, the rest receding smaller and dimmer
  // behind it. Drag left/right to spin the carousel (momentum on release),
  // tap any box to crack it.
  const N = 8;
  const stageW = Math.min(window.innerWidth * 0.96, 1020);
  const stageH = Math.min(window.innerHeight * 0.62, 540);
  const RX = stageW * 0.40;          // horizontal orbit radius
  const RY = stageH * 0.17;          // depth-to-vertical parallax
  const ring = el('div', { style: { position: 'relative', width: stageW + 'px', height: stageH + 'px', margin: '4px auto', touchAction: 'none', cursor: 'grab', userSelect: 'none', flexShrink: '0', overflow: 'visible' } });
  // Deep floor glow — drifts slowly so the stage feels lit, not printed.
  ring.append(el('div', { style: { position: 'absolute', left: '50%', top: '68%', transform: 'translate(-50%,-50%)', width: '115%', height: '70%', borderRadius: '50%', background: 'radial-gradient(ellipse, rgba(28,40,130,.55) 0%, rgba(18,24,80,.3) 45%, transparent 72%)', pointerEvents: 'none', animation: 'mbDrift 9s ease-in-out infinite' } }));
  let done = false, _dragged = false;
  const boxEls = [];
  // ── HERO REVEAL — spotlight scene, lid swings open, prize rises out. ──
  function _mbHeroReveal() {
    const R2 = _mbRarityOf(prize);
    const scene = el('div', { style: { position: 'relative', width: '100vw', height: '82vh', perspective: '1100px', animation: 'mbSceneIn .5s ease-out forwards' } });

    // Tier line under the box — "from $500 GOLD BOX" energy.
    scene.append(el('div', { style: { position: 'absolute', left: '50%', bottom: '4%', textAlign: 'center', zIndex: 7, opacity: '0', animation: 'mbFadeUp .6s ease-out 1.8s forwards' } },
      el('div', { style: { fontSize: '13px', letterSpacing: '.3em', fontWeight: '900', textTransform: 'uppercase', color: R2.color, textShadow: '0 0 14px ' + R2.color + '66' } }, R2.label + ' box'),
      el('div', { style: { fontSize: '10px', letterSpacing: '.25em', color: 'rgba(255,255,255,.4)', marginTop: '4px', textTransform: 'uppercase' } }, 'RIDDMADE\u00ae Mystery Box')));
    scene.append(el('div', { style: { position: 'absolute', left: '50%', top: '58%', transform: 'translate(-50%,-50%)', width: '640px', height: '640px', maxWidth: '95vw', borderRadius: '50%', background: 'radial-gradient(circle, ' + R2.color + '30 0%, ' + R2.color + '10 38%, transparent 68%)', animation: 'mbGlowPulse 3.2s ease-in-out infinite', pointerEvents: 'none' } }));
    // Gold/Platinum: rotating light rays behind the prize.
    let _raysEl = null;
    if (R2.rays) { _raysEl = el('div', { style: { position: 'absolute', left: '50%', top: '55%', width: '560px', height: '560px', maxWidth: '92vw', borderRadius: '50%', background: 'repeating-conic-gradient(' + R2.color + '30 0deg 9deg, transparent 9deg 24deg)', WebkitMaskImage: 'radial-gradient(circle, black 0%, transparent 68%)', maskImage: 'radial-gradient(circle, black 0%, transparent 68%)', animation: 'mbRays 11s linear infinite', opacity: '0', transition: 'opacity 1.2s', pointerEvents: 'none' } }); scene.append(_raysEl); }
    scene.append(
      el('div', { style: { position: 'absolute', left: '7%', bottom: '30%', opacity: '.18', filter: 'blur(1.5px)', transform: 'scale(.8) rotate(-6deg)' } }, _mbGiftEl(96)),
      el('div', { style: { position: 'absolute', right: '7%', bottom: '32%', opacity: '.18', filter: 'blur(1.5px)', transform: 'scale(.75) rotate(5deg)' } }, _mbGiftEl(96)));
    const hero = el('div', { style: { position: 'absolute', left: '50%', bottom: '10%', transform: 'translateX(-50%)', width: '320px', height: '420px', perspective: '1000px' } });
    // Light flash from the mouth as the lid clears it.
    hero.append(el('div', { style: { position: 'absolute', left: '50%', bottom: '150px', transform: 'translateX(-50%)', width: '250px', height: '60px', borderRadius: '50%', background: 'radial-gradient(ellipse, ' + R2.color + 'e6 0%, ' + R2.color + '66 45%, transparent 75%)', opacity: '0', animation: 'mbFlash .7s ease-out .8s forwards', filter: 'blur(6px)', zIndex: 5, pointerEvents: 'none' } }));
    // THE BOX — the same drawn box as the carousel, hero-sized, in its OPEN
    // state: velvet mouth on top, lifted lid standing behind. The lid grows
    // up from behind the rim on cue (scaleY from the hinge) so the open
    // reads as one motion.
    const B3 = _mbBoxArt(300, { open: true });
    B3.root.style.position = 'absolute';
    B3.root.style.left = '50%';
    B3.root.style.bottom = '0';
    B3.root.style.transform = 'translateX(-50%)';
    if (B3.lidEl) {
      B3.lidEl.style.transform = 'scaleY(0)';
      B3.lidEl.style.animation = 'mbLidUp .95s cubic-bezier(.5,.05,.3,1.05) .25s forwards';
    }
    hero.append(B3.root);
    // Glowing orb of rarity light hovering out of the velvet, prize name
    // stamped IN FRONT of it — the light is the backdrop, the words are
    // the product.
    hero.append(el('div', { style: { position: 'absolute', left: '50%', bottom: '185px', transform: 'translateX(-50%)', width: '175px', height: '175px', borderRadius: '50%', background: 'radial-gradient(circle, #ffffffd9 0%, ' + R2.color + 'cc 30%, ' + R2.color + '44 60%, transparent 78%)', filter: 'blur(2px)', opacity: '0', animation: 'mbOrbIn .9s cubic-bezier(.3,.8,.3,1) 1.05s forwards, mbOrb 2.6s ease-in-out 2.05s infinite', zIndex: 6, pointerEvents: 'none' } }));
    hero.append(el('div', { style: { position: 'absolute', left: '50%', bottom: '225px', width: 'max-content', maxWidth: '88vw', textAlign: 'center', zIndex: 8, opacity: '0', animation: 'mbStamp .55s cubic-bezier(.2,.9,.3,1.1) 1.4s forwards', pointerEvents: 'none' } },
      el('div', { style: { fontSize: '11px', letterSpacing: '.4em', fontWeight: '700', color: 'rgba(255,255,255,.7)', textTransform: 'uppercase', marginBottom: '8px' } }, 'Just Pulled'),
      el('div', { class: 'font-display', style: { fontSize: 'clamp(28px, 5vw, 46px)', lineHeight: '1.05', textTransform: 'uppercase', color: '#F5F7FA', textShadow: '0 0 26px ' + R2.color + '88, 0 2px 6px rgba(0,0,0,.85)' } }, prize)));
    scene.append(hero);
    // Rays ease in with the rise.
    if (_raysEl) setTimeout(() => { _raysEl.style.opacity = '1'; }, 1200);
    setTimeout(() => {
      for (let k = 0; k < (R2.rays ? 16 : 8); k++) {
        const s = el('span', { class: 'mb-burst', style: { top: '38%', fontSize: '15px' } }, '\u2728');
        s.style.setProperty('--bx', (Math.random() * 300 - 150).toFixed(0) + 'px');
        s.style.setProperty('--by', (Math.random() * 200 - 160).toFixed(0) + 'px');
        scene.append(s);
      }
    }, 1300);
    wrap.append(scene);
    _mbMarkOpened(box.id);
  }
  const reveal = (boxEl) => {
    if (done) return; done = true;
    ring.style.pointerEvents = 'none';
    clearInterval(_glintTimer);
    const R2 = _mbRarityOf(prize);
    _mbThud();
    // ACT 1 — the pick: everything else dies, the camera pushes in, the
    // chosen box glides to center-front.
    boxEls.forEach(c => { if (c !== boxEl) { c.style.transition = 'opacity .8s'; c.style.opacity = '.04'; } });
    title.style.transition = 'opacity .6s'; hint.style.transition = 'opacity .6s';
    title.style.opacity = '.25'; hint.style.opacity = '0';
    if (legend) { legend.style.transition = 'opacity .6s'; legend.style.opacity = '0'; }
    ring.style.transition = 'transform 1.1s cubic-bezier(.3,.7,.2,1)';
    ring.style.transform = 'scale(1.18)';
    boxEl.style.transition = 'transform .95s cubic-bezier(.3,.7,.25,1), filter .95s, opacity .3s';
    boxEl.style.zIndex = '400';
    boxEl.style.transform = 'translate(-50%,-50%) translate(0px,' + (RY * 0.9).toFixed(0) + 'px) scale(2.0)';
    boxEl.style.filter = 'brightness(1.05)';
    // ACT 2 — the tease: the riser swells (the visual seam-leak line was
    // cut per Isaac — the audio carries the suspense).
    setTimeout(() => { _mbRiserSnd(); }, 950);
    // ACT 3 — the burst: full-screen flash in the rarity color, hero scene.
    setTimeout(() => {
      const flash = el('div', { style: { position: 'fixed', inset: '0', background: 'radial-gradient(circle at 50% 60%, ' + R2.color + 'e6 0%, ' + R2.color + '55 35%, transparent 75%)', animation: 'mbFlashFull .55s ease-out forwards', zIndex: '10002', pointerEvents: 'none' } });
      overlay.append(flash);
      setTimeout(() => flash.remove(), 600);
      _mbChime(R2.rays);
      setTimeout(() => {
        ring.style.display = 'none';
        title.style.display = 'none'; hint.style.display = 'none';
        if (legend) legend.style.display = 'none';
        _mbHeroReveal();
      }, 180);
    }, 2150);
  };
  for (let i = 0; i < N; i++) {
    // Inner idle wrapper — the bob animation lives here so it never fights
    // the carousel's transform on the outer element.
    const b = el('div', {
      style: { position: 'absolute', left: '50%', top: '50%', cursor: 'pointer', transition: 'opacity .3s', willChange: 'transform, filter' },
    }, el('div', { style: { animation: 'mbIdle ' + (3.1 + (i % 4) * 0.45).toFixed(2) + 's ease-in-out ' + (i * 0.37).toFixed(2) + 's infinite' } }, _mbGiftEl(175)));
    boxEls.push(b);
    ring.append(b);
  }
  // Keyhole glints — every few seconds a random box's keyhole catches the
  // light. Cleared on reveal/close.
  const _glintTimer = setInterval(() => {
    if (done) return;
    const b2 = boxEls[Math.floor(Math.random() * boxEls.length)];
    const gift = b2 && b2.firstChild && b2.firstChild.firstChild;
    if (!gift) return;
    const g = el('div', { style: { position: 'absolute', left: '46%', top: '58%', width: '26px', height: '26px', borderRadius: '50%', background: 'radial-gradient(circle, rgba(255,240,190,.95) 0%, rgba(255,216,107,.4) 45%, transparent 70%)', animation: 'mbGlint .85s ease-out forwards', pointerEvents: 'none', zIndex: 5 } });
    gift.append(g);
    setTimeout(() => g.remove(), 900);
  }, 2600);
  // Carousel projection: x from sin, depth from cos → scale, height,
  // brightness and stacking all follow the depth, like their stage.
  let angle = 0;
  const layout = () => {
    for (let i = 0; i < N; i++) {
      const rad = (angle + i * (360 / N)) * Math.PI / 180;
      const x = Math.sin(rad) * RX;
      const z = Math.cos(rad);                   // +1 = front, −1 = back
      const y = z * RY;                          // front boxes sit lower
      const s = 0.42 + ((z + 1) / 2) * 0.95;     // back .42 → front 1.37
      const lum = 0.38 + ((z + 1) / 2) * 0.72;   // back dim → front lit
      boxEls[i].style.transform = 'translate(-50%,-50%) translate(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px) scale(' + s.toFixed(3) + ')';
      boxEls[i].style.filter = 'brightness(' + lum.toFixed(2) + ')';
      boxEls[i].style.zIndex = String(100 + Math.round(z * 50));
    }
  };
  // Horizontal drag spins the carousel; release glides with momentum.
  let _down = null, _vel = 0, _momRaf = null;
  ring.addEventListener('pointerdown', (e) => {
    if (done) return;
    // Remember which box the press landed on — pointer capture redirects
    // the eventual click to the ring, so tap detection happens on release.
    const hit = boxEls.find(bx => bx === e.target || bx.contains(e.target)) || null;
    _down = { x: e.clientX, base: angle, hit }; _dragged = false; _vel = 0;
    if (_momRaf) cancelAnimationFrame(_momRaf);
    ring.style.cursor = 'grabbing';
    try { ring.setPointerCapture(e.pointerId); } catch (err) { /* fine */ }
  });
  let _tickAcc = 0;
  const _tickOn = (d) => { _tickAcc += Math.abs(d); const step = 360 / N / 3; if (_tickAcc >= step) { _tickAcc = 0; _mbTick(); } };
  ring.addEventListener('pointermove', (e) => {
    if (!_down) return;
    const next = _down.base + (e.clientX - _down.x) * 0.38;
    if (Math.abs(next - _down.base) > 2) _dragged = true;
    _vel = next - angle;
    angle = next;
    _tickOn(_vel);
    layout();
  });
  const _release = () => {
    if (!_down) return;
    const _hit = _down.hit;
    _down = null;
    ring.style.cursor = 'grab';
    if (!_dragged && _hit) { reveal(_hit); return; }   // a clean tap = crack it
    let v = _vel;
    const glide = () => {
      if (Math.abs(v) < .06 || done) return;
      angle += v; v *= .96;
      _tickOn(v);
      layout();
      _momRaf = requestAnimationFrame(glide);
    };
    glide();
    setTimeout(() => { _dragged = false; }, 60);
  };
  ring.addEventListener('pointerup', _release);
  ring.addEventListener('pointercancel', _release);
  const wrap = el('div', { class: 'flex flex-col items-center', style: { width: '100vw', maxHeight: '100vh', overflow: 'hidden' } }, title, hint, ring, legend);
  overlay.append(el('button', {
    style: { position: 'fixed', top: '18px', left: '18px', fontSize: '26px', lineHeight: '1', color: 'rgba(255,255,255,.6)', background: 'none', border: 'none', cursor: 'pointer', zIndex: '10001' },
    title: 'Close',
    onclick: () => { clearInterval(_glintTimer); overlay.remove(); mountApp(); },
  }, '\u00d7'));
  overlay.append(wrap);
  document.body.append(overlay);
  layout();
}
// ── Sound design — tiny Web Audio engine, zero assets. Gentle volumes;
// every call is try/catch'd so audio can never break the spin.
let _mbAC = null;
function _mbCtx() {
  try {
    if (!_mbAC) _mbAC = new (window.AudioContext || window.webkitAudioContext)();
    if (_mbAC.state === 'suspended') _mbAC.resume();
    return _mbAC;
  } catch (e) { return null; }
}
function _mbTone(freq, dur, type, vol, sweepTo) {
  try {
    const ctx = _mbCtx(); if (!ctx) return;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, ctx.currentTime);
    if (sweepTo) o.frequency.exponentialRampToValueAtTime(sweepTo, ctx.currentTime + dur);
    g.gain.setValueAtTime(vol || 0.08, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
    o.connect(g); g.connect(ctx.destination);
    o.start(); o.stop(ctx.currentTime + dur + 0.02);
  } catch (e) { /* silent */ }
}
const _mbTick = () => _mbTone(1250, 0.025, 'square', 0.03);
const _mbThud = () => { _mbTone(88, 0.28, 'sine', 0.35); _mbTone(54, 0.34, 'sine', 0.22); };
const _mbRiserSnd = () => _mbTone(150, 1.25, 'sawtooth', 0.06, 620);
const _mbChime = (big) => {
  _mbTone(659, 0.5, 'triangle', 0.16);
  setTimeout(() => _mbTone(988, 0.65, 'triangle', 0.14), 140);
  setTimeout(() => _mbTone(1319, 0.9, 'sine', 0.12), 300);
  if (big) setTimeout(() => { _mbTone(1568, 1.2, 'sine', 0.1); _mbTone(784, 1.2, 'triangle', 0.08); }, 480);
};
// Weighted roll over the incentive pool — entries with a % weight roll by
// it; unweighted pools roll uniform. One helper so the Spin button and the
// Arm chooser can never disagree.
function _mbRollPrize() {
  const pool = state._mbPool || [];
  if (!pool.length) return null;
  const odds = state._mbOdds || {};
  const weights = pool.map(p => Number(odds[p]) || 0);
  const tw = weights.reduce((a, b) => a + b, 0);
  let roll = Math.random() * (tw > 0 ? tw : pool.length);
  for (let i = 0; i < pool.length; i++) {
    roll -= tw > 0 ? weights[i] : 1;
    if (roll <= 0) return pool[i];
  }
  return pool[pool.length - 1];
}
// Prize picker — dropdown of the saved pool plus "add new", so prizes
// accumulate on this tab as they're used (per Isaac; no more free-typing).
function _mbArmWithPrizeChooser(repName, profileId) {
  const overlay = el('div', { class: 'modal-overlay' });
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  const pool = state._mbPool || [];
  const odds = state._mbOdds || {};
  const sel = el('select', { class: 'w-full rounded-lg border px-2.5 py-1 text-[11px]', style: { borderColor: 'var(--border-2)', background: 'var(--card)', color: 'var(--text)' } },
    pool.length ? el('option', { value: '__roll__' }, '\ud83c\udfb2 Roll by the odds') : null,
    ...pool.map(p => el('option', { value: p }, p + (Number(odds[p]) ? ' \u00b7 ' + odds[p] + '%' : ''))),
    el('option', { value: '__new__' }, '＋ Add a new prize…'));
  sel.addEventListener('change', () => {
    if (sel.value !== '__new__') return;
    const np = prompt('New prize (gets saved to the pool):');
    if (np && np.trim()) {
      const pool2 = [...(state._mbPool || []), np.trim()];
      _mbSaveCfg({ pool: pool2 });
      sel.insertBefore(el('option', { value: np.trim(), selected: true }, np.trim()), sel.lastChild);
    } else sel.selectedIndex = 0;
  });
  overlay.append(el('div', { class: 'card w-full max-w-sm p-5' },
    el('div', { class: 'font-display text-xl mb-1' }, '🎁 Arm a box'),
    el('div', { class: 'text-xs text-muted- mb-3' }, repName + ' — pick what the box reveals. The spin cycles the rest of the pool as decoys.'),
    sel,
    el('div', { class: 'flex justify-end gap-2 mt-4' },
      el('button', { class: 'rounded-lg px-2.5 py-1 text-[11px]', style: { color: 'var(--text-muted)' }, onclick: () => overlay.remove() }, 'Cancel'),
      el('button', {
        class: 'rounded-lg px-2.5 py-1 text-[11px] font-bold', style: { background: 'var(--accent)', color: 'var(--accent-text)' },
        onclick: () => {
          let prize = sel.value === '__new__' ? '' : sel.value;
          if (prize === '__roll__') {
            // Rolled at ARM time — the outcome is locked before the rep spins.
            prize = _mbRollPrize() || '';
            if (prize) toast('\ud83c\udfb2 Rolled: ' + prize, 'info');
          }
          if (!prize) { toast('Pick a prize', 'warn'); return; }
          saveMysteryBoxes([...(state._mysteryBoxes || []), {
            id: 'mb_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
            profile_id: profileId, rep_label: repName, prize: _mbEnc(prize),
            decoys: (state._mbPool || []).filter(p => p !== prize),
            created_at: new Date().toISOString(), delivered: false,
          }]);
          overlay.remove();
          toast('Box armed for ' + repName, 'success');
          mountApp();
        },
      }, 'Arm box'))));
  document.body.append(overlay);
}
// ── \ud83d\udc51 KING OF THE HILL ─────────────────────────────────────────
// The rep with the single BIGGEST revenue day of the season, per class
// (Veterans / Rookies). Counting rules (per Isaac + the poster):
//   · Pending/Serviced base (frPendingServiced — the canonical gate)
//   · PASSED audit or NO AUDIT flag only — pending-audit accounts wait
//   · Failed audit and Last Resort (<$99 initial) never count
//   · Season locks August 22 — later days don\u2019t compete
// Theme: the red KOTH poster (condensed white type on red).
// Season window: a season closes on the week-ending Saturday of the week
// containing August 20 — i.e. the first Saturday on or after the 20th (per
// Isaac). 2026 → 2026-08-22, which is exactly the lock this used to hardcode.
function kothLockIso(year) {
  const d = new Date(Date.UTC(year, 7, 20));
  d.setUTCDate(d.getUTCDate() + ((6 - d.getUTCDay() + 7) % 7));
  return d.toISOString().slice(0, 10);
}
const KOTH_SEASON_YEAR = new Date().getFullYear();
const KOTH_LOCK_ISO = kothLockIso(KOTH_SEASON_YEAR);
const KOTH_PRIZE_LABEL = '2,000,000 RIDDCOIN';
// 📄 Kobe Week — Best Weeks PDF (per Isaac): one table of every active
// rep's best Sun–Sat week (the number they have to beat), biggest first.
async function downloadKobeBestWeeksPdf(reps, from, to) {
  try { await loadPdfLibsOnce(); } catch { toast('Could not load PDF libraries — check your connection', 'error'); return; }
  const wkLbl = (wk) => {
    const d = new Date(wk + 'T00:00');
    if (isNaN(d)) return wk || '—';
    const e = new Date(d); e.setDate(e.getDate() + 6);
    const f = (x) => (x.getMonth() + 1) + '/' + x.getDate();
    return f(d) + '–' + f(e) + '/' + String(e.getFullYear()).slice(-2);
  };
  if (!reps.length) { toast('No reps with a baseline week yet', 'warn'); return; }
  // Grouped by TEAM (per Isaac): sections ordered by the team's combined
  // best-week total, reps biggest-first inside each.
  const byTeam = new Map();
  reps.forEach(r => {
    const t = (typeof getRepTeam === 'function' && getRepTeam(r.name)) || 'Unassigned';
    if (!byTeam.has(t)) byTeam.set(t, []);
    byTeam.get(t).push(r);
  });
  const teams = [...byTeam.entries()]
    .map(([t, list]) => ({ t, list: list.slice().sort((a, b) => b.bestRev - a.bestRev), total: list.reduce((a, r) => a + r.bestRev, 0) }))
    .sort((a, b) => b.total - a.total);
  // (one team per column — two teams per page max, per Isaac)
  // Poster vibe (per Isaac): black page, white type, red + orange accents.
  const th = (t, right) => el('th', { style: { fontSize: '8px', fontWeight: '800', letterSpacing: '.06em', textTransform: 'uppercase', color: '#8a8a8a', padding: '4px 6px', textAlign: right ? 'right' : 'left', borderBottom: '1px solid #3a3a3a', whiteSpace: 'nowrap' } }, t);
  const td = (t, right, opts = {}) => el('td', { style: { padding: '3px 6px', fontSize: '9.5px', textAlign: right ? 'right' : 'left', borderBottom: '1px solid #232323', whiteSpace: 'nowrap', fontWeight: opts.bold ? '800' : '400', color: opts.color || '#f2f2f2', fontVariantNumeric: 'tabular-nums' } }, t);
  const mkTeam = (tm) => {
    // Band wears the team's own color (Manage Teams), text auto-contrasts.
    const bg = (typeof getTeamColor === 'function' && getTeamColor(tm.t)) || '#323230';
    const fg = (typeof groupHeaderTextColor === 'function') ? groupHeaderTextColor(bg) : '#fff';
    return el('div', {},
    el('div', { style: { padding: '6px 8px', fontSize: '10px', fontWeight: '900', textTransform: 'uppercase', letterSpacing: '.06em', background: bg, color: fg, whiteSpace: 'nowrap', borderRadius: '0' } },
      tm.t + ' \u00b7 ' + tm.list.length + ' rep' + (tm.list.length === 1 ? '' : 's')),
    el('table', { style: { width: '100%', borderCollapse: 'collapse', border: '1px solid #333', background: 'rgba(10,10,10,.72)' } },
      el('thead', { style: { background: '#161616' } }, el('tr', {},
        th('#'), th('Rep'), th('Best Week'), th('Best $', true), th('This Wk $', true), th('\u2713'))),
      el('tbody', {}, ...tm.list.map((r, i) => el('tr', {},
        td('#' + (i + 1), false, { color: '#999' }),
        td(r.name, false, { bold: true }),
        td('wk of ' + wkLbl(r.bestWk)),
        td(fmt.usd0(r.bestRev), true, { bold: true, color: '#A9441F' }),
        td(r.cur > 0 ? fmt.usd0(r.cur) : '\u2014', true),
        td(r.earned ? '\ud83d\udc0d' : '', false))))));
  };
  const pages = [];
  for (let i = 0; i < teams.length; i += 2) {
    const pair = teams.slice(i, i + 2);
    pages.push(el('div', { style: { width: '816px', minHeight: '1056px', padding: '24px 28px', background: '#0A0A0A', color: '#fff', fontFamily: '-apple-system, "Helvetica Neue", Arial, sans-serif', boxSizing: 'border-box', position: 'relative', overflow: 'hidden' } },
      // 🐍 the poster's snake artwork, extracted (kobe-snake.png) — rides
      // the right side of every page behind the tables.
      el('img', { src: 'kobe-snake.png', alt: '', style: { position: 'absolute', right: '-80px', top: '-10px', width: '600px', opacity: '.45', zIndex: '0', pointerEvents: 'none' } }),
      el('div', { style: { position: 'relative', zIndex: '1' } },
      el('div', { style: { borderBottom: '4px solid #E0402A', paddingBottom: '8px', marginBottom: '14px', display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' } },
        el('div', {},
          el('div', { style: { fontSize: '34px', fontWeight: '900', letterSpacing: '-0.02em', lineHeight: '.95', textTransform: 'uppercase', color: '#fff' } }, 'KOBE WEEK'),
          el('div', { style: { fontSize: '11px', fontWeight: '800', letterSpacing: '.18em', textTransform: 'uppercase', color: '#A9441F', marginTop: '4px' } }, 'BEST WEEKS \u00b7 ' + from.slice(5).replace('-', '/') + ' \u2013 ' + to.slice(5).replace('-', '/'))),
        el('div', { style: { textAlign: 'right' } },
          el('div', { style: { fontSize: '20px' } }, '\ud83d\udc0d'),
          el('div', { style: { fontSize: '8.5px', color: '#8a8a8a', fontWeight: '700', marginTop: '2px' } },
            new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) + (pages.length ? ' \u00b7 p.' + (pages.length + 1) : ' \u00b7 RIDDMADE')))),
      i === 0 ? el('div', { style: { border: '2px solid #E0402A', borderRadius: '0', padding: '9px 14px', margin: '0 0 14px', background: 'rgba(10,10,10,.85)' } },
        el('div', { style: { fontSize: '10px', fontWeight: '900', color: '#A9441F', textTransform: 'uppercase', letterSpacing: '.03em' } },
          'Target = your best Sun\u2013Sat week of the season \u00b7 MINIMUM: Rookies $7,000 \u00b7 Vets $10,000 \u00b7 Pending/Serviced only \u00b7 failed audits + last resorts don\u2019t count')) : null,
      el('div', { style: { display: 'flex', gap: '22px', alignItems: 'flex-start' } },
        el('div', { style: { flex: '1', minWidth: '0' } }, mkTeam(pair[0])),
        pair[1] ? el('div', { style: { flex: '1', minWidth: '0' } }, mkTeam(pair[1])) : el('div', { style: { flex: '1' } })))));
  }
  const reportEl = el('div', {}, ...pages);
  reportEl.style.position = 'fixed'; reportEl.style.left = '-99999px'; reportEl.style.top = '0'; reportEl.style.zIndex = '-1';
  document.body.append(reportEl);
  await new Promise(r => requestAnimationFrame(() => r()));
  try {
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ unit: 'pt', format: 'letter', orientation: 'portrait' });
    const pageW = pdf.internal.pageSize.getWidth(), pageH = pdf.internal.pageSize.getHeight();
    const sheets = [...reportEl.children];
    for (let pi = 0; pi < sheets.length; pi++) {
      const canvas = await html2canvas(sheets[pi], { scale: 2, backgroundColor: '#0A0A0A', logging: false, useCORS: true });
      const imgData = canvas.toDataURL('image/png');
      if (pi > 0) pdf.addPage();
      // ENTIRE page black first (per Isaac) — no white margins anywhere,
      // and every page reads the same size regardless of content height.
      pdf.setFillColor(10, 10, 10);
      pdf.rect(0, 0, pageW, pageH, 'F');
      const imgH = (canvas.height * pageW) / canvas.width;
      if (imgH <= pageH) pdf.addImage(imgData, 'PNG', 0, 0, pageW, imgH);
      else { const sW = (pageW * pageH) / imgH; pdf.addImage(imgData, 'PNG', (pageW - sW) / 2, 0, sW, pageH); }
    }
    pdf.save('RIDD-KobeWeek-BestWeeks-' + new Date().toISOString().slice(0, 10) + '.pdf');
    toast('Downloaded best weeks for ' + reps.length + ' reps across ' + teams.length + ' teams', 'success');
  } catch (err) {
    console.error('[ridd] Kobe best-weeks PDF failed', err);
    toast('Failed to generate PDF: ' + (err.message || 'unknown'), 'error');
  } finally { reportEl.remove(); }
}
function kobeWeekSection(raw, KOBE_FROM, KOBE_TO, FINAL_REPS) {
  const reps = Array.isArray(FINAL_REPS) ? FINAL_REPS : kobeWeekCompute(raw, KOBE_FROM, KOBE_TO);
  const BLACK = '#111111', MAMBA = '#E0402A';
  const todayIso = new Date().toISOString().slice(0, 10);
  const daysLeft = (() => {
    if (todayIso > KOBE_TO) return 0;
    const start = todayIso > KOBE_FROM ? todayIso : KOBE_FROM;
    return Math.max(1, Math.round((Date.parse(KOBE_TO) - Date.parse(start)) / 86400000) + 1);
  })();
  const live = todayIso >= KOBE_FROM && todayIso <= KOBE_TO;
  const over = todayIso > KOBE_TO;
  const wkLbl = (wk) => { const d = new Date(wk + 'T00:00'); return isNaN(d) ? wk : 'wk of ' + (d.getMonth() + 1) + '/' + d.getDate(); };
  const _sigK = (n) => String(n || '').toLowerCase().replace(/[.,]/g, ' ').split(/\s+/).filter(Boolean).sort().join(' ');
  const meSig = _sigK(state.profile && state.profile.full_name);
  const mine = reps.find(r => isMyRepName(r.name)) || reps.find(r => _sigK(r.name) === meSig) || null;
  // Board shows ACTIVE FieldRoutes reps only (Manage-Teams active flag,
  // synced from the CRM), alphabetical — per Isaac.
  const board = reps.filter(r => (typeof isRepActive !== 'function') || isRepActive(r.name));
  const sorted = board.slice().sort((a, b) => a.name.localeCompare(b.name));
  const earnedN = board.filter(r => r.earned).length;
  const nodes = [];
  // ── Poster masthead ──
  nodes.push(el('div', { class: 'card overflow-hidden' },
    el('div', { class: 'px-5 py-6', style: { background: BLACK, color: '#fff' } },
      el('div', { class: 'flex items-start justify-between gap-4 flex-wrap' },
        el('div', {},
          el('div', { class: 'font-display leading-none', style: { fontSize: '40px', letterSpacing: '.01em' } }, 'KOBE WEEK'),
          el('div', { class: 'text-xs font-bold mt-1', style: { color: MAMBA, letterSpacing: '.14em' } }, 'AUGUST 3\u20138'),
          el('div', { style: { width: '64px', height: '3px', background: MAMBA, marginTop: '6px' } })),
        el('div', { class: 'text-right' },
          el('div', { class: 'font-display text-2xl leading-none', style: { color: MAMBA } }, earnedN || '0'),
          el('div', { class: 'text-[9px] font-black uppercase', style: { letterSpacing: '.18em', opacity: '.7' } }, 'earned kobe week'))),
      el('div', { class: 'text-[11px] font-bold mt-3', style: { opacity: '.85' } },
        'Beat your best week of the summer \u00b7 Minimum target: Rookies $7K / Vets $10K \u00b7 Reward: a custom framed \u201c24\u201d jersey with your name, signed live at the gala'))));
  // ── Personal pacer hero (signed-in rep) ──
  if (mine) {
    const _tgt = mine.target || mine.bestRev;
    const remaining = Math.max(0, _tgt - mine.cur);
    const perDay = (remaining > 0 && daysLeft > 0) ? remaining / daysLeft : 0;
    const pct = _tgt > 0 ? Math.min(100, mine.cur / _tgt * 100) : 0;
    nodes.push(el('div', { class: 'card p-5', style: { borderLeft: '3px solid ' + MAMBA } },
      el('div', { class: 'flex items-center justify-between gap-3 flex-wrap' },
        el('div', {},
          el('div', { class: 'text-[9px] font-black uppercase', style: { letterSpacing: '.18em', color: 'var(--text-muted)' } }, 'Your Kobe Week'),
          el('div', { class: 'font-display text-2xl leading-none mt-1' },
            mine.earned ? 'YOU DID SOMETHING MEMORABLE.' : over ? 'The week is done.' : live ? 'BEAT ' + fmt.usd0(_tgt) : 'Your target: ' + fmt.usd0(_tgt)),
          el('div', { class: 'text-xs text-muted- mt-1' },
            'Best week of your summer: ' + fmt.usd0(mine.bestRev) + ' (' + wkLbl(mine.bestWk) + ')' + (_tgt > mine.bestRev ? ' \u00b7 minimum target ' + fmt.usd0(_tgt) : '') + ' \u00b7 this week so far: ' + fmt.usd0(mine.cur))),
        el('div', { class: 'text-right' },
          mine.earned
            ? el('div', { class: 'text-sm font-black px-3 py-1.5 rounded-lg', style: { background: MAMBA, color: '#fff' } }, '\ud83d\udc0d KOBE WEEK EARNED')
            : (live && perDay > 0)
              ? el('div', {},
                  el('div', { class: 'font-display text-3xl leading-none tabular-nums', style: { color: MAMBA } }, fmt.usd0(perDay) + '/day'),
                  el('div', { class: 'text-[10px] font-bold uppercase mt-0.5', style: { letterSpacing: '.12em', color: 'var(--text-muted)' } },
                    'for the next ' + daysLeft + ' day' + (daysLeft === 1 ? '' : 's') + ' \u00b7 ' + fmt.usd0(remaining) + ' to go'))
              : el('div', { class: 'text-xs text-muted- font-bold' }, live ? '' : 'Starts ' + new Date(KOBE_FROM + 'T00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric' })))),
      el('div', { class: 'mt-3', style: { height: '7px', borderRadius: '0', background: 'var(--card-2)', overflow: 'hidden' } },
        el('div', { style: { width: pct.toFixed(0) + '%', height: '100%', borderRadius: '0', background: mine.earned ? '#DF643A' : MAMBA } }))));
  }
  // ── Everyone: chase board ── Company view by default; the dropdown
  // scopes to a single team, and every row carries the rep's team (per Isaac).
  const _kTeamOf = (r) => (typeof getRepTeam === 'function' && getRepTeam(r.name)) || 'Unassigned';
  const _kTeams = [...new Set(sorted.map(_kTeamOf))].sort();
  const _kScope = (state._kobeTeamSel && _kTeams.includes(state._kobeTeamSel)) ? state._kobeTeamSel : '';
  const viewRows = _kScope ? sorted.filter(r => _kTeamOf(r) === _kScope) : sorted;
  nodes.push(el('div', { class: 'card overflow-hidden' },
    el('div', { class: 'px-4 py-2.5 flex items-center justify-between gap-2 flex-wrap', style: { background: BLACK, color: '#fff' } },
      el('div', { class: 'font-black uppercase tracking-widest text-sm' }, 'The Chase'),
      el('div', { class: 'flex items-center gap-2' },
        el('select', {
          class: 'rounded-lg px-2.5 py-1 text-[11px] font-bold cursor-pointer',
          style: { background: 'rgba(255,255,255,.12)', color: '#fff', border: '1px solid rgba(255,255,255,.25)' },
          title: 'Scope the chase \u2014 whole company or a single team',
          onchange: (e) => { state._kobeTeamSel = e.target.value; mountApp(); },
        },
          el('option', { value: '', selected: !_kScope }, 'Company'),
          ..._kTeams.map(t => el('option', { value: t, selected: _kScope === t }, t))),
        // In-place filter (show/hide rows) so typing never rebuilds the page.
        el('input', {
          type: 'text', placeholder: 'Search rep\u2026', value: state._kobeSearch || '',
          class: 'rounded-lg px-2.5 py-1 text-[11px] font-semibold',
          style: { background: 'rgba(255,255,255,.12)', color: '#fff', border: '1px solid rgba(255,255,255,.25)', width: '160px' },
          oninput: (e) => {
            state._kobeSearch = e.target.value;
            const q = e.target.value.trim().toLowerCase();
            document.querySelectorAll('[data-kobe]').forEach(row => {
              row.style.display = (!q || (row.getAttribute('data-kobe') || '').includes(q)) ? '' : 'none';
            });
          },
        }),
        el('div', { class: 'text-[10px] font-bold tabular-nums whitespace-nowrap', style: { opacity: '.6' } },
          over ? 'Final' : live ? daysLeft + ' day' + (daysLeft === 1 ? '' : 's') + ' left' : ''))),
    el('div', { class: 'overflow-x-auto' }, el('table', { class: 'w-full text-sm' },
      // Sortable headers (per Isaac): click toggles asc/desc; active column
      // highlighted with an arrow. Default = Rep A→Z.
      el('thead', {}, el('tr', { class: 'text-left text-[10px] uppercase tracking-widest text-muted-' },
        ...(() => {
          const _kSort = state._kobeSort || { key: 'name', dir: 'asc' };
          const _kTh = (key, label, extra, tip) => {
            const on = _kSort.key === key;
            return el('th', {
              class: 'px-3 py-2 cursor-pointer select-none' + (extra || ''),
              style: on ? { color: 'var(--accent)' } : {},
              title: (tip ? tip + ' \u00b7 ' : '') + 'Click to sort',
              onclick: () => {
                state._kobeSort = { key, dir: on ? (_kSort.dir === 'desc' ? 'asc' : 'desc') : ((key === 'name' || key === 'team') ? 'asc' : 'desc') };
                mountApp();
              },
            }, label + (on ? (_kSort.dir === 'desc' ? ' \u2193' : ' \u2191') : ''));
          };
          return [
            _kTh('name', 'Rep', ''),
            _kTh('team', 'Team', ''),
            _kTh('best', 'Best Week', ' text-right'),
            _kTh('cur', 'This Week', ' text-right'),
            _kTh('tobeat', 'To Beat', ' text-right hidden sm:table-cell'),
            _kTh('pace', 'Pace/Day', ' text-right hidden sm:table-cell', 'What\u2019s left \u00f7 remaining comp days'),
            _kTh('pct', 'Progress', '', null),
          ];
        })())),
      el('tbody', {}, ...(() => {
        const _kSort = state._kobeSort || { key: 'name', dir: 'asc' };
        const _kValOf = (r) => {
          const tgt = r.target || r.bestRev || 0;
          switch (_kSort.key) {
            case 'team':   return _kTeamOf(r);
            case 'best':   return r.bestRev || 0;
            case 'cur':    return r.cur || 0;
            case 'tobeat': return Math.max(0, tgt - (r.cur || 0));
            case 'pace':   return Math.max(0, tgt - (r.cur || 0));
            case 'pct':    return tgt > 0 ? (r.cur || 0) / tgt : 0;
            default:       return r.name;
          }
        };
        return viewRows.slice().sort((x, y) => {
          const vx = _kValOf(x), vy = _kValOf(y);
          const c = (typeof vx === 'string') ? vx.localeCompare(vy) : vx - vy;
          return _kSort.dir === 'desc' ? -c : c;
        });
      })().map(r => {
        const _rTgt = r.target || r.bestRev;
        const remaining = Math.max(0, _rTgt - r.cur);
        const perDay = (remaining > 0 && daysLeft > 0) ? remaining / daysLeft : 0;
        const pct = Math.min(100, r.cur / _rTgt * 100);
        const _q = String(state._kobeSearch || '').trim().toLowerCase();
        return el('tr', {
          class: 'border-t', 'data-kobe': r.name.toLowerCase(),
          style: { borderColor: 'var(--border)', background: r.earned ? 'rgba(224,64,42,.07)' : '',
            ...((_q && !r.name.toLowerCase().includes(_q)) ? { display: 'none' } : {}) },
        },
          el('td', { class: 'px-3 py-2 font-semibold whitespace-nowrap' }, r.name,
            r.earned ? el('span', { class: 'text-[10px] font-black px-1.5 py-0.5 rounded ml-2', style: { background: MAMBA, color: '#fff' } }, '\ud83d\udc0d EARNED') : null),
          el('td', { class: 'px-3 py-2 whitespace-nowrap text-muted-' }, _kTeamOf(r)),
          el('td', { class: 'px-3 py-2 text-right tabular-nums' }, fmt.usd0(r.bestRev),
            el('div', { class: 'text-[10px] font-semibold whitespace-nowrap', style: { color: 'var(--text-subtle)' } }, wkLbl(r.bestWk))),
          el('td', { class: 'px-3 py-2 text-right tabular-nums font-bold' }, fmt.usd0(r.cur)),
          el('td', { class: 'px-3 py-2 text-right tabular-nums hidden sm:table-cell', style: remaining ? {} : { color: '#DF643A', fontWeight: '700' } }, remaining ? fmt.usd0(remaining) : '\u2713'),
          el('td', { class: 'px-3 py-2 text-right tabular-nums hidden sm:table-cell', style: { color: perDay ? MAMBA : 'var(--text-subtle)', fontWeight: perDay ? '700' : '400' } }, perDay ? fmt.usd0(perDay) : '\u2014'),
          el('td', { class: 'px-3 py-2' },
            el('div', { class: 'flex items-center gap-1.5' },
              el('div', { style: { flex: '1', minWidth: '34px', height: '5px', borderRadius: '0', background: 'var(--card-2)', overflow: 'hidden' } },
                el('div', { style: { width: pct.toFixed(0) + '%', height: '100%', borderRadius: '0', background: r.earned ? '#DF643A' : MAMBA } })),
              el('span', { class: 'text-[11px] tabular-nums font-bold whitespace-nowrap', style: { color: r.earned ? '#DF643A' : 'var(--text-muted)' } }, pct.toFixed(0) + '%'))));
      }))))));
  return el('div', { class: 'flex flex-col gap-4' }, ...nodes);
}

// Class AS OF THAT SEASON. getRepTier answers "today", so a 2025 rookie reads
// as a vet now and would vanish off the 2025 rookie board. The live season
// still defers to getRepTier (manual tags win); past seasons reconstruct from
// the recorded tier year, falling back to the rep's first selling year.
function kothTierForYear(name, year) {
  if (year >= KOTH_SEASON_YEAR) return getRepTier(name) === 'rookie' ? 'rookie' : 'vet';
  const ty = Number(_repKeyedLookup(state._indicatorRepTierYear || {}, name)) || 0;
  if (ty) return ty === year ? 'rookie' : 'vet';
  const yrs = _repSaleYears(name);
  return (yrs && yrs.min === year) ? 'rookie' : 'vet';
}
// Every season present in the dataset, newest first (current season always
// offered, even before its first sale lands).
function kothYears(raw) {
  const set = new Set([KOTH_SEASON_YEAR]);
  for (const s of (raw || [])) {
    if (typeof _indicatorDeptOf === 'function' && _indicatorDeptOf(s) !== 'd2d') continue;
    const iso = (typeof dateSoldToIso === 'function') ? dateSoldToIso(s.dateSold) : '';
    const y = Number(String(iso).slice(0, 4));
    if (y && y <= KOTH_SEASON_YEAR) set.add(y);
  }
  return [...set].sort((a, b) => b - a);
}
// Bucketing follows the LMS scorecard convention (passed / failed / pending)
// so KOTH and the scorecards tell a rep the same story about the same
// account. passed = counts toward the crown; failed = Last Resort (<$99) or
// a failed audit; pending = audit still open, which may yet clear.
function kothBucket(s) {
  if ((Number(s.initialPrice) || 0) < 99) return 'failed';                                   // Last Resort
  if (typeof SC_FAIL_RE !== 'undefined' && SC_FAIL_RE.test(s.customerFlags || '')) return 'failed';
  if (typeof scAuditPassed === 'function' && scAuditPassed(s.customerFlags)) return 'passed';
  return 'pending';
}
function kothDays(raw, year) {
  const y = Number(year) || KOTH_SEASON_YEAR;
  const seasonFrom = y + '-01-01', seasonTo = kothLockIso(y);
  const byKey = new Map();
  for (const s of (raw || [])) {
    if (typeof _indicatorDeptOf === 'function' && _indicatorDeptOf(s) !== 'd2d') continue;
    const iso = (typeof dateSoldToIso === 'function') ? dateSoldToIso(s.dateSold) : '';
    // Season FLOOR as well as the lock. Without the floor every prior year's
    // big days competed for this year's crown.
    if (!iso || iso < seasonFrom || iso > seasonTo) continue;
    if (typeof frPendingServiced === 'function' && !frPendingServiced(s)) continue;
    const nm = getCanonicalRepName(s.rep);
    if (!nm) continue;
    const k = nm + '|' + iso;
    const o = byKey.get(k) || { name: nm, day: iso, rev: 0, n: 0, total: 0, totalN: 0, failed: 0, failedN: 0, pending: 0, pendingN: 0 };
    const cv = Number(s.contractValue) || 0;
    const b = kothBucket(s);
    // `total` is the Pending/Serviced base — what they SOLD that day. `rev`
    // stays passed-audit only, so the crown never moves on unaudited money.
    o.total += cv; o.totalN++;
    if (b === 'passed') { o.rev += cv; o.n++; }
    else if (b === 'failed') { o.failed += cv; o.failedN++; }
    else { o.pending += cv; o.pendingN++; }
    byKey.set(k, o);
  }
  // A day of purely pending/failed accounts has no claim on the crown.
  const days = [...byKey.values()].filter(d => d.n > 0);
  days.forEach(d => { d.tier = kothTierForYear(d.name, y); });
  return days;
}
// Account-level detail for one rep-day — the drill-down that shows a rep
// exactly which accounts made the board and which did not, and why.
function kothDayRows(raw, name, day) {
  const out = [];
  for (const s of (raw || [])) {
    if (typeof _indicatorDeptOf === 'function' && _indicatorDeptOf(s) !== 'd2d') continue;
    const iso = (typeof dateSoldToIso === 'function') ? dateSoldToIso(s.dateSold) : '';
    if (iso !== day) continue;
    if (getCanonicalRepName(s.rep) !== name) continue;
    const served = (typeof frPendingServiced !== 'function') || frPendingServiced(s);
    const b = served ? kothBucket(s) : 'excluded';
    let why = 'Counts toward the crown';
    if (b === 'excluded') why = 'No appointment, no-show or canceled initial. Never serviced.';
    else if ((Number(s.initialPrice) || 0) < 99) why = 'Last Resort, initial under $99';
    else if (b === 'failed') why = 'Failed audit';
    else if (b === 'pending') why = 'Audit still open, waiting';
    out.push({
      customer: s.customer || '(no name)',
      subscription: s.subscription || '-',
      months: Number(s.contract) || 0,
      initial: Number(s.initialPrice) || 0,
      cv: Number(s.contractValue) || 0,
      bucket: b,
      why: why,
    });
  }
  return out.sort((a, b2) => b2.cv - a.cv);
}
function kothCanDrill(name) {
  const team = (typeof getRepTeam === 'function') ? (getRepTeam(name) || '') : '';
  return (typeof canViewRepDetails !== 'function') || canViewRepDetails(name, team);
}
function openKothDayModal(name, day, raw) {
  if (!kothCanDrill(name)) return;
  const rows = kothDayRows(raw, name, day);
  if (!rows.length) { if (typeof toast === 'function') toast('No account detail for that day in this snapshot', 'warn'); return; }
  const overlay = el('div', { class: 'modal-overlay' });
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  const modal = el('div', { class: 'card w-full max-w-3xl p-6 my-8 overflow-y-auto', style: { maxHeight: 'calc(100vh - 64px)' } });
  overlay.append(modal);
  const sumOf = (b) => rows.filter(r => r.bucket === b).reduce((a, r) => a + r.cv, 0);
  const passedV = sumOf('passed'), pendingV = sumOf('pending'), failedV = sumOf('failed'), exclV = sumOf('excluded');
  // Two DIFFERENT reasons an account misses the crown, and they must not
  // share a chip: a failed audit is real revenue that lost credit (it stays
  // inside Total Sold), while a non-Pending/Serviced account was never
  // revenue at all (it sits outside Total Sold). One shared "NOT COUNTED"
  // label made four rows look like the one the tile was counting.
  const CHIP = {
    passed:   ['#DF643A', 'COUNTS'],
    pending:  ['#A9441F', 'PENDING'],
    failed:   ['#DC2626', 'DOES NOT COUNT'],
    excluded: ['#7C857A', 'NOT REVENUE'],
  };
  const fmtFull = (iso) => { const d = new Date(iso + 'T00:00'); return isNaN(d) ? iso : d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }); };
  const stat = (label, v, color) => el('div', { class: 'card p-3 min-w-0' },
    el('div', { class: 'text-[9px] uppercase tracking-widest text-muted- font-semibold' }, label),
    el('div', { class: 'font-display text-xl tabular-nums mt-1', style: color ? { color: color } : {} }, fmt.usd0(v)));
  // Accounts that ARE the revenue base, and the ones that never were.
  const inBase = rows.filter(r => r.bucket !== 'excluded');
  const outRows = rows.filter(r => r.bucket === 'excluded');
  const tableOf = (list, dim) => el('div', { class: 'overflow-x-auto mt-3', style: dim ? { opacity: '.6' } : {} }, el('table', { class: 'w-full text-sm' },
    el('thead', {}, el('tr', { class: 'text-left text-[10px] uppercase tracking-widest text-muted-' },
      el('th', { class: 'px-3 py-2' }, 'Customer'),
      el('th', { class: 'px-3 py-2' }, 'Service'),
      el('th', { class: 'px-3 py-2 text-right' }, 'Mo'),
      el('th', { class: 'px-3 py-2 text-right' }, 'Initial'),
      el('th', { class: 'px-3 py-2 text-right' }, 'Value'),
      el('th', { class: 'px-3 py-2' }, 'Status'))),
    el('tbody', {}, ...list.map(r => el('tr', { class: 'border-t', style: { borderColor: 'var(--border)' } },
      el('td', { class: 'px-3 py-2 font-semibold whitespace-nowrap' }, r.customer),
      el('td', { class: 'px-3 py-2 whitespace-nowrap text-muted-' }, r.subscription),
      el('td', { class: 'px-3 py-2 text-right tabular-nums' }, r.months ? String(r.months) : '-'),
      el('td', { class: 'px-3 py-2 text-right tabular-nums' }, fmt.usd0(r.initial)),
      el('td', { class: 'px-3 py-2 text-right tabular-nums font-bold' }, fmt.usd0(r.cv)),
      el('td', { class: 'px-3 py-2 whitespace-nowrap' },
        el('div', { class: 'text-[10px] font-black', style: { color: CHIP[r.bucket][0] } }, CHIP[r.bucket][1]),
        el('div', { class: 'text-[10px] text-muted-' }, r.why))))))); 
  modal.append(
    el('div', { class: 'flex items-start justify-between gap-3 flex-wrap' },
      el('div', { class: 'min-w-0' },
        el('div', { class: 'font-display text-2xl leading-none' }, name),
        el('div', { class: 'text-xs text-muted- mt-1' }, fmtFull(day))),
      el('button', {
        class: 'px-2.5 py-1 text-[11px] font-bold rounded-full',
        style: { background: 'var(--card-2)', color: 'var(--text-muted)' },
        onclick: () => overlay.remove(),
      }, 'Close')),
    el('div', { class: 'grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4' },
      stat('Total Sold', passedV + pendingV + failedV),
      stat('Counts', passedV, '#DF643A'),
      stat('Pending Audit', pendingV, '#A9441F'),
      stat('Does Not Count', failedV, '#DC2626')),
    tableOf(inBase),
    el('div', { class: 'text-[11px] text-muted- mt-3' },
      'The ' + inBase.length + ' account' + (inBase.length === 1 ? '' : 's') + ' above are Total Sold. King of the Hill counts the PASSED-AUDIT ones only; pending accounts join this day automatically once their audit clears.'),
    outRows.length ? el('div', { class: 'mt-6' },
      el('div', { class: 'text-[10px] uppercase tracking-widest font-black', style: { color: '#7C857A' } }, 'Not revenue - not in any total above'),
      el('div', { class: 'text-[11px] text-muted- mt-1' },
        outRows.length + ' account' + (outRows.length === 1 ? '' : 's') + ' worth ' + fmt.usd0(exclV)
        + ' never made it past a customer card and a subscription - no initial appointment was ever completed. The CRM drops these from Pending/Serviced, so they are not revenue anywhere in the app.'),
      tableOf(outRows, true)) : null);
  document.body.append(overlay);
}
function kothSection(raw, cfg, isAdmin) {
  cfg = (cfg && typeof cfg === 'object') ? cfg : {};
  // Per-year freeze store. The legacy single `cfg.final` was always the
  // CURRENT season's board — migrate it under that year so old freezes live on.
  if (!cfg.finalByYear || typeof cfg.finalByYear !== 'object') cfg.finalByYear = {};
  if (cfg.final && Array.isArray(cfg.final.days) && cfg.final.days.length && !cfg.finalByYear[KOTH_SEASON_YEAR]) {
    cfg.finalByYear[KOTH_SEASON_YEAR] = cfg.final;
  }
  const years = kothYears(raw);
  if (!state._kothYear || years.indexOf(state._kothYear) < 0) state._kothYear = years[0] || KOTH_SEASON_YEAR;
  const year = state._kothYear;
  const lockIso = kothLockIso(year);
  const isLive = year >= KOTH_SEASON_YEAR;
  const frozen = cfg.finalByYear[year];
  // AUTO-FREEZE (per Isaac): once past the lock date with ZERO unaudited
  // qualifying accounts, the final boards freeze into the synced config —
  // rendered from the snapshot forever after. Only ever the LIVE season, so
  // opening an old year can never write over this season's crown.
  let days;
  if (frozen && Array.isArray(frozen.days) && frozen.days.length) {
    days = frozen.days;
  } else {
    days = kothDays(raw, year);
    if (isAdmin && isLive && new Date().toISOString().slice(0, 10) > lockIso && days.length) {
      const _pendingN = (raw || []).filter(s => {
        if (typeof _indicatorDeptOf === 'function' && _indicatorDeptOf(s) !== 'd2d') return false;
        const iso = (typeof dateSoldToIso === 'function') ? dateSoldToIso(s.dateSold) : '';
        if (!iso || iso < year + '-01-01' || iso > lockIso) return false;
        if (typeof frPendingServiced === 'function' && !frPendingServiced(s)) return false;
        if ((Number(s.initialPrice) || 0) < 99) return false;
        const fl = s.customerFlags || '';
        if (typeof SC_FAIL_RE !== 'undefined' && SC_FAIL_RE.test(fl)) return false;
        return typeof scAuditPassed === 'function' && !scAuditPassed(fl);   // audit still open
      }).length;
      if (_pendingN === 0) {
        try {
          cfg.finalByYear[year] = { at: new Date().toISOString(), days: JSON.parse(JSON.stringify(days)) };
          cfg.final = cfg.finalByYear[year];   // legacy key kept in sync
          logActivity('comp_change', { detail: 'KOTH ' + year + ': final boards AUTO-frozen (lock passed, audits settled)' });
          saveDemoData();
          if (typeof saveIndicatorState === 'function') saveIndicatorState();
        } catch (e) { /* freeze next render */ }
      }
    }
  }
  const fmtDay = (iso) => { const d = new Date(iso + 'T00:00'); return isNaN(d) ? iso : d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }); };
  const fmtLock = (iso) => { const d = new Date(iso + 'T00:00'); return isNaN(d) ? iso : d.toLocaleDateString('en-US', { month: 'long', day: 'numeric' }); };
  const RED1 = '#D3524F', RED2 = '#B03432';
  const classCard = (tk) => {
    const list = days.filter(d => d.tier === tk).sort((a, b) => b.rev - a.rev);
    const king = list[0] || null;
    const rest = list.slice(1, 11);   // top 10 next-closest days — same rep can hold several
    return el('div', { class: 'card overflow-hidden' },
      el('div', { class: 'px-5 py-6 text-center', style: { background: 'linear-gradient(165deg,' + RED1 + ' 0%,' + RED2 + ' 100%)', color: '#fff' } },
        el('div', { class: 'text-[9px] font-black', style: { letterSpacing: '.3em', opacity: '.85' } }, 'RIDDMADE\u00ae \u00b7 ' + (tk === 'rookie' ? 'ROOKIES' : 'VETERANS')),
        el('div', { class: 'font-display leading-none mt-1', style: { fontSize: '34px', letterSpacing: '.02em' } }, 'KING OF THE HILL'),
        el('div', { class: 'text-[10px] font-bold uppercase mt-1.5', style: { letterSpacing: '.12em', opacity: '.9' } },
          'The ' + (tk === 'rookie' ? 'rookie' : 'vet') + ' with the biggest day ' + (isLive ? 'this summer' : 'of ' + year)),
        king
          ? el('div', { class: 'mt-4' },
              el('div', { class: 'font-display text-3xl leading-none mt-1' }, king.name),
              el('div', { class: 'font-black tabular-nums text-2xl mt-1' }, fmt.usd0(king.rev)),
              el('div', { class: 'text-[11px] font-bold uppercase tracking-wide mt-0.5', style: { opacity: '.85' } },
                fmtDay(king.day) + ' \u00b7 ' + king.n + ' account' + (king.n === 1 ? '' : 's')),
              king.total != null && king.total > king.rev
                ? el('div', { class: 'text-[10px] mt-1', style: { opacity: '.75', textTransform: 'none' } },
                    'Sold ' + fmt.usd0(king.total) + ' that day. ' + fmt.usd0(king.total - king.rev) + ' did not count.')
                : null,
              kothCanDrill(king.name)
                ? el('button', {
                    class: 'text-[10px] font-black uppercase mt-3 px-4 py-1.5 rounded-full',
                    style: { background: 'rgba(255,255,255,.2)', color: '#fff', letterSpacing: '.12em' },
                    onclick: () => openKothDayModal(king.name, king.day, raw),
                  }, 'See the accounts')
                : null)
          : el('div', { class: 'mt-4 text-sm font-bold', style: { opacity: '.85' } }, 'The hill is empty \u2014 no qualifying days yet.'),
        el('div', { class: 'text-[9px] font-bold uppercase mt-4', style: { letterSpacing: '.14em', opacity: '.75' } },
          'Lock date: ' + fmtLock(lockIso) + ' \u00b7 Passed audit accounts only \u00b7 Last Resort (<$99) never counts \u00b7 Prize: ' + KOTH_PRIZE_LABEL),
        // Spelled out because it surprises people: a rep's best day on the
        // leaderboard / player card can be HIGHER than their KOTH day, since
        // those count every account and this counts only passed audits.
        el('div', { class: 'text-[10px] mt-2 max-w-md mx-auto', style: { opacity: '.72', textTransform: 'none', letterSpacing: '.01em', lineHeight: '1.5' } },
          'Only PASSED-AUDIT accounts count toward King of the Hill. Some reps will show a higher best day on other boards, where every account counts. Here, a day is only worth what its passed-audit accounts are worth.')),
      rest.length ? el('div', { class: 'overflow-x-auto' }, el('table', { class: 'w-full text-sm' },
        el('thead', {}, el('tr', { class: 'text-left text-[10px] uppercase tracking-widest text-muted-' },
          el('th', { class: 'px-4 py-2' }, '#'),
          el('th', { class: 'px-4 py-2' }, 'Rep'),
          el('th', { class: 'px-4 py-2' }, 'Day'),
          el('th', { class: 'px-4 py-2 text-right', title: 'Passed / total accounts sold that day' }, 'Accts'),
          el('th', { class: 'px-4 py-2 text-right', title: 'Everything sold that day on the Pending/Serviced base' }, 'Total Rev'),
          el('th', { class: 'px-4 py-2 text-right', title: 'Passed-audit revenue only, which is what the crown is scored on' }, 'Passed Rev'),
          el('th', { class: 'px-4 py-2 text-right', title: 'How far this day is from the crown' }, 'To The Crown'))),
        el('tbody', {}, ...rest.map((d, i) => el('tr', {
          class: 'border-t' + (kothCanDrill(d.name) ? ' cursor-pointer' : ''),
          style: { borderColor: 'var(--border)' },
          title: kothCanDrill(d.name) ? 'See the accounts behind this day' : '',
          onclick: kothCanDrill(d.name) ? () => openKothDayModal(d.name, d.day, raw) : undefined,
        },
          el('td', { class: 'px-4 py-2 tabular-nums text-muted-' }, '#' + (i + 2)),
          el('td', { class: 'px-4 py-2 font-semibold whitespace-nowrap' }, d.name),
          el('td', { class: 'px-4 py-2 whitespace-nowrap text-muted- tabular-nums' }, d.day),
          el('td', { class: 'px-4 py-2 text-right tabular-nums' }, d.totalN != null ? (d.n + ' / ' + d.totalN) : String(d.n)),
          el('td', { class: 'px-4 py-2 text-right tabular-nums text-muted-' }, fmt.usd0(d.total != null ? d.total : d.rev)),
          el('td', { class: 'px-4 py-2 text-right tabular-nums font-bold' }, fmt.usd0(d.rev)),
          el('td', { class: 'px-4 py-2 text-right tabular-nums', style: { color: RED2, fontWeight: '700' } }, king ? fmt.usd0(Math.max(0, king.rev - d.rev)) : '\u2014'))))))
        : el('div', { class: 'p-6 text-center text-xs text-muted-' }, 'No chasers on this hill yet.'));
  };
  const yearSel = el('select', {
    class: 'rounded-xl px-2.5 py-1 text-[11px] font-medium cursor-pointer',
    onchange: (e) => { state._kothYear = Number(e.target.value); mountApp(); },
  }, ...years.map(y => el('option', { value: String(y), selected: y === year }, y === KOTH_SEASON_YEAR ? y + ' season' : String(y))));
  return el('div', { class: 'flex flex-col gap-4' },
    el('div', { class: 'flex items-center justify-end gap-2 flex-wrap' },
      frozen ? el('span', { class: 'text-[10px] uppercase tracking-widest text-muted- font-semibold' }, 'FINAL / FROZEN') : null,
      yearSel),
    el('div', { class: 'grid grid-cols-1 lg:grid-cols-2 gap-4 items-start' }, classCard('vet'), classCard('rookie')));
}

function mysteryBoxSection(isAdmin) {
  loadMysteryBoxes();
  const boxes = state._mysteryBoxes || [];
  const opened = _mbOpenedMap();
  const mine = state.profile ? boxes.filter(b => b.profile_id === state.profile.id) : [];
  const nodes = [];
  mine.forEach(b => {
    const isOpened = !!opened[b.id];
    nodes.push(el('div', { class: 'card p-4 flex items-center justify-between gap-3 flex-wrap', style: { borderLeft: '3px solid #DF643A' } },
      el('div', { class: 'flex items-center gap-3 min-w-0' },
        el('div', { style: { fontSize: '34px' } }, isOpened ? '🎉' : '🎁'),
        el('div', { class: 'min-w-0' },
          el('div', { class: 'font-display text-lg' }, isOpened ? 'You won: ' + _mbDec(b.prize) : 'You have a Mystery Box!'),
          el('div', { class: 'text-xs text-muted-' }, isOpened ? 'Opened ' + new Date(opened[b.id]).toLocaleDateString() + ' — see your admin to claim.' : 'Tap to open it. No takebacks.'))),
      !isOpened ? el('button', {
        class: 'rounded-xl px-2.5 py-1 text-[11px] font-bold transition hover:brightness-95',
        style: { background: '#DF643A', color: '#323230' },
        onclick: () => openMysteryBoxOverlay(b),
      }, 'Open the box') : null));
  });
  // ── Date bar + qualification table (per Isaac: one date, one table,
  // rookies vs vets distinguished; goals are the revenue metric). ──
  const goals = state._mbGoals || { rookie: 1500, vet: 2000 };
  const todayIso = (typeof bizTodayIso === 'function') ? bizTodayIso() : new Date().toISOString().slice(0, 10);
  // Date RANGE — defaults to a one-day window (today), but multi-day box
  // comps are a thing, so both ends are pickable.
  let mbFrom = state._mbDateFrom || todayIso;
  let mbTo = state._mbDateTo || mbFrom;
  if (mbTo < mbFrom) mbTo = mbFrom;
  const dayStats = mysteryBoxDayStats({ from: mbFrom, to: mbTo, rookie: goals.rookie, vet: goals.vet });
  const qualified = dayStats.filter(r => r.qualified);
  const belowN = dayStats.length - qualified.length;
  const _dayName = (iso, opts) => new Date(iso + 'T12:00:00').toLocaleDateString('en-US', opts || { weekday: 'long', month: 'long', day: 'numeric' });
  const dLbl = mbFrom === mbTo ? _dayName(mbFrom)
    : _dayName(mbFrom, { month: 'short', day: 'numeric' }) + ' \u2013 ' + _dayName(mbTo, { month: 'short', day: 'numeric' });
  const _mbSyncStr = appSyncStampStr() || null;
  const goalIn = (key, val) => el('input', {
    type: 'number', value: String(val),
    class: 'rounded px-1.5 py-0.5 text-xs tabular-nums font-bold',
    style: { width: '64px', background: 'rgba(255,255,255,.12)', color: 'var(--bg)', border: '1px solid rgba(255,255,255,.25)' },
    onchange: (e) => { const g = { ...goals, [key]: Number(e.target.value) || 0 }; _mbSaveCfg({ goals: g }); mountApp(); },
  });
  // ── ONE top bar: brand · boxes earned · tier split · Spin · 𝕽 (the
  // hidden prize-list toggle). Condensed from the old masthead + winners
  // cards (per Isaac). ──
  let _mbHdr = null;
  {
    const qR = qualified.filter(r => r.tier === 'rookie'), qV = qualified.filter(r => r.tier !== 'rookie');
    const prizeEditor = (isAdmin && state._mbPrizeOpen) ? (() => {
      const pin = el('input', {
        type: 'text', placeholder: 'New incentive\u2026',
        class: 'rounded-lg border px-2.5 py-1 text-[11px] flex-1 min-w-0',
        style: { borderColor: 'var(--border-2)', background: 'var(--card)', color: 'var(--text)' },
        onkeydown: (e) => { if (e.key === 'Enter') e.target.nextSibling.click(); },
      });
      const poolNow = state._mbPool || [];
      return el('div', { class: 'mt-3 pt-3', style: { borderTop: '1px solid var(--border)' } },
        poolNow.length ? (() => {
          const odds = state._mbOdds || {};
          const total = poolNow.reduce((a2, p) => a2 + (Number(odds[p]) || 0), 0);
          return el('div', { class: 'flex flex-col mb-2' },
            ...poolNow.map((p, i) => el('div', { class: 'flex items-center justify-between gap-2 py-1.5 text-sm', style: { borderBottom: '1px solid var(--border)' } },
              el('span', { class: 'font-semibold min-w-0 truncate' }, p),
              el('div', { class: 'flex items-center gap-2 shrink-0' },
                (() => {
                  const cur = (state._mbRarity || {})[p] || 'bronze';
                  return el('select', {
                    class: 'rounded border px-1.5 py-1 text-xs font-bold',
                    style: { borderColor: 'var(--border-2)', background: 'var(--card)', color: MB_RARITIES[cur].color },
                    title: 'Rarity — sets the reveal treatment',
                    onchange: (e) => { const rr = { ...(state._mbRarity || {}) }; rr[p] = e.target.value; _mbSaveCfg({ rarity: rr }); mountApp(); },
                  }, ...Object.entries(MB_RARITIES).map(([k, m]) => el('option', { value: k, selected: cur === k }, m.label)));
                })(),
                el('div', { class: 'flex items-center gap-1' },
                  el('input', {
                    type: 'number', min: '0', max: '100', step: '1', value: odds[p] != null ? String(odds[p]) : '',
                    placeholder: '\u2014',
                    class: 'rounded border px-2.5 py-1 text-[11px] text-right tabular-nums',
                    style: { width: '58px', borderColor: 'var(--border-2)', background: 'var(--card)', color: 'var(--text)' },
                    onchange: (e) => {
                      const o = { ...(state._mbOdds || {}) };
                      const v2 = e.target.value === '' ? null : Math.max(0, Math.min(100, Number(e.target.value) || 0));
                      if (v2 == null) delete o[p]; else o[p] = v2;
                      _mbSaveCfg({ odds: o }); mountApp();
                    },
                  }),
                  el('span', { class: 'text-xs text-muted-' }, '%')),
                el('button', {
                  class: 'text-xs', style: { color: '#DC2626' }, title: 'Remove this incentive',
                  onclick: () => { const o = { ...(state._mbOdds || {}) }; delete o[p]; _mbSaveCfg({ pool: poolNow.filter((_, j) => j !== i), odds: o }); mountApp(); },
                }, '\u2715')))),
            el('div', { class: 'flex items-center justify-end gap-1 pt-1.5 text-[11px] tabular-nums font-bold', style: { color: total === 100 ? '#DF643A' : '#A9441F' } },
              'Total ' + total + '%' + (total === 100 ? ' \u2713' : ' \u2014 should sum to 100')));
        })() : el('div', { class: 'text-xs text-muted- mb-2' }, 'No incentives yet \u2014 add the ones boxes can reveal.'),
        el('div', { class: 'flex items-center gap-2' },
          pin,
          el('button', {
            class: 'rounded-lg px-2.5 py-1 text-[11px] font-bold shrink-0', style: { background: 'var(--accent)', color: 'var(--accent-text)' },
            onclick: () => {
              const p = pin.value.trim();
              if (!p) return;
              _mbSaveCfg({ pool: [...(state._mbPool || []), p] });
              pin.value = '';
              mountApp();
            },
          }, '+ Add')));
    })() : null;
    // WHITE masthead retired (per Isaac, Jul 2026) — everything lives in
    // the black bar now. Stash the pieces the bar needs.
    _mbHdr = { qR, qV, prizeEditor };
  }
  // Standardized Comp Window bar (per Isaac): the window dates live up top
  // like every other comp, with the \ud835\udd7d on the far right and \u25b6 Spin next to it.
  nodes.push((() => {
    const dIn = (val, onCommit) => el('input', {
      type: 'date', value: val,
      class: 'rounded border px-1.5 py-1 text-xs',
      style: { borderColor: 'var(--border-2)', background: 'var(--card)', color: 'var(--text)' },
      onchange: (e) => { if (e.target.value) { onCommit(e.target.value); mountApp(); } },
    });
    return el('div', { class: 'card p-2.5 flex items-center gap-2 flex-wrap', style: { borderLeft: '3px solid var(--text)' } },
      el('span', { class: 'text-[10px] uppercase tracking-widest font-bold', style: { color: 'var(--text-subtle)' } }, 'Comp Window'),
      dIn(mbFrom, (v) => { state._mbDateFrom = v; if (!state._mbDateTo || state._mbDateTo < v) state._mbDateTo = v; }),
      el('span', { class: 'text-muted-' }, '\u2192'),
      dIn(mbTo, (v) => { state._mbDateTo = v; if (state._mbDateFrom && state._mbDateFrom > v) state._mbDateFrom = v; }),
      el('div', { class: 'ml-auto flex items-center gap-2.5' },
        isAdmin ? el('button', {
          class: 'text-[11px] font-bold px-2.5 py-1 rounded-lg border cursor-pointer transition hover:brightness-95',
          style: { borderColor: 'var(--border-2)', color: 'var(--text)' },
          title: 'Run a spin \u2014 rolls a prize from the incentive list by its percentages',
          onclick: () => {
            const rolled = _mbRollPrize();
            if (!rolled) { toast('Add incentives first \u2014 click the \ud835\udd7d', 'warn'); return; }
            openMysteryBoxOverlay({ id: '__spin__', prize: _mbEnc(rolled) });
          },
        }, '\u25b6 Spin') : null,
        el('div', {
          style: { fontSize: '26px', lineHeight: '1', fontFamily: "'Old English Text MT',serif", cursor: isAdmin ? 'pointer' : 'default', userSelect: 'none', color: 'var(--text)' },
          title: isAdmin ? 'Incentive list' : '',
          onclick: isAdmin ? (() => { state._mbPrizeOpen = !state._mbPrizeOpen; mountApp(); }) : undefined,
        }, '\ud835\udd7d')));
  })());
  nodes.push(el('div', { class: 'card overflow-hidden' },
    // Black requirement bar — the poster look, with the date picker in it.
    el('div', { class: 'px-4 py-2.5', style: { background: 'var(--text)', color: 'var(--bg)' } },
      // Compact single-block layout (per Isaac, Jul 2026): brand + window
      // stacked on the left, boxes/date/split/Spin dead-center, last sync +
      // requirements (with the \ud835\udd7d at their right) stacked on the right.
      // ONE band \u2014 no second row, no dead space.
      el('div', { class: 'flex items-stretch gap-3 flex-wrap' },
        el('div', { class: 'flex-1 min-w-0 order-1 flex flex-col justify-between gap-2' },
          el('div', {},
            el('div', { class: 'text-[9px] font-black', style: { letterSpacing: '.25em', opacity: '.85' } }, 'RIDDMADE\u00ae'),
            el('div', { class: 'font-display text-3xl leading-none' }, 'MYSTERY BOX'),
            _mbSyncStr ? el('div', { class: 'text-[10px] font-bold tabular-nums mt-1', style: { opacity: '.55' } }, 'Last sync ' + _mbSyncStr) : null),
          // (window dates moved to the Comp Window bar above \u2014 per Isaac)
          null),
        el('div', { class: 'text-center w-full sm:w-auto order-3 sm:order-2 flex flex-col items-center justify-center py-0.5' },
          el('div', { class: 'font-display text-2xl leading-none' }, qualified.length + ' BOX' + (qualified.length === 1 ? '' : 'ES') + ' EARNED'),
          el('div', { class: 'text-[11px] font-bold uppercase tracking-wide mt-0.5', style: { opacity: '.7' } }, dLbl),
          _mbHdr ? el('div', { class: 'text-xs font-bold mt-0.5' },
            el('span', { style: { color: '#60A5FA' } }, _mbHdr.qV.length + ' veteran' + (_mbHdr.qV.length === 1 ? '' : 's')),
            el('span', { style: { opacity: '.5' } }, ' \u00b7 '),
            el('span', { style: { color: '#F87171' } }, _mbHdr.qR.length + ' rookie' + (_mbHdr.qR.length === 1 ? '' : 's')),
            qualified.length ? el('span', { class: 'tabular-nums', style: { opacity: '.6' } }, ' \u00b7 ' + fmt.usd0(qualified.reduce((a2, r) => a2 + r.rev, 0)) + ' sold') : null) : null,
          (isAdmin && qualified.length) ? el('button', {
            class: 'text-[11px] font-bold px-2.5 py-1 rounded-lg border mt-1.5',
            style: { borderColor: 'rgba(223,100,58,.5)', color: '#DF643A', background: 'rgba(223,100,58,.08)' },
            title: 'Grant every qualified rep RIDDCOIN for this window \u2014 one ledger row each, reason auto-filled',
            onclick: () => _mbPayWinners(qualified, { from: mbFrom, to: mbTo }),
          }, '\ud83e\ude99 Pay winners') : null),
        el('div', { class: 'flex-1 min-w-0 order-2 sm:order-3 flex flex-col items-end justify-end gap-1.5' },
          // (Last sync moved under the MYSTERY BOX title — per Isaac)
          el('div', { class: 'flex items-center justify-end gap-2.5' },
            el('div', { class: 'text-right' },
              el('div', { class: 'text-xs font-bold flex items-center gap-1.5 justify-end' }, 'Rookie: ', isAdmin ? goalIn('rookie', goals.rookie) : fmt.usd0(goals.rookie)),
              el('div', { class: 'text-xs font-bold flex items-center gap-1.5 justify-end mt-1' }, 'Veteran: ', isAdmin ? goalIn('vet', goals.vet) : fmt.usd0(goals.vet))))))),
    // Incentive editor (admin, toggled by the \ud835\udd7d) \u2014 sits under the
    // black bar inside the same card now that the white masthead is gone.
    (_mbHdr && _mbHdr.prizeEditor) ? el('div', { class: 'px-4 pb-4' }, _mbHdr.prizeEditor) : null,
    // (bar card ends here \u2014 the tier tables live in their own cards below)
    ));
  // ── TWO ADJACENT TABLES (per Isaac): Veterans left, Rookies right. Each
  // shows its qualified reps on top (green rows — earned is implied), then
  // a CHASING section with progress-to-goal. Sortable headers per table. ──
  const tierCard = (tk) => {
    const isRk = tk === 'rookie';
    const goal = isRk ? (Number(goals.rookie) || 0) : (Number(goals.vet) || 0);
    const inTier = (r) => (isRk ? r.tier === 'rookie' : r.tier !== 'rookie');
    let qual2 = qualified.filter(inTier);
    let chase = dayStats.filter(r => !r.qualified && inTier(r)).sort((a2, b2) => (b2.goal ? b2.rev / b2.goal : 0) - (a2.goal ? a2.rev / a2.goal : 0));
    const _srt2 = state._mbSort || null;
    if (_srt2) {
      const valOf = (r) => (_srt2.key === 'name' || _srt2.key === 'office') ? String(r[_srt2.key] || '')
        : _srt2.key === 'progress' ? (r.goal ? r.rev / r.goal : 0)
        : Number(r[_srt2.key]) || 0;
      const srt = (arr) => arr.slice().sort((x, y) => {
        const a2 = valOf(x), b2 = valOf(y);
        const c2 = typeof a2 === 'string' ? a2.localeCompare(b2) : a2 - b2;
        return _srt2.dir === 'desc' ? -c2 : c2;
      });
      qual2 = srt(qual2); chase = srt(chase);
    }
    const row = (r) => {
      const isQ = r.qualified;
      const pctTo = r.goal > 0 ? Math.min(100, r.rev / r.goal * 100) : 0;
      return el('tr', {
        class: 'border-t cursor-pointer hover:brightness-95 transition',
        style: { borderColor: 'var(--border)', background: isQ ? 'rgba(223,100,58,.06)' : '' },
        title: 'Click for ' + r.name + '\u2019s accounts \u2014 verify revenue and chase pending audits',
        onclick: () => openMbRepModal(r, { from: mbFrom, to: mbTo }),
      },
        el('td', { class: 'px-3 py-2 font-semibold whitespace-nowrap' }, r.name),
        // (Office column dropped so the To Go pacer fits — per Isaac; the
        // office still shows in the rep drill-down modal.)
        el('td', { class: 'px-3 py-2 tabular-nums hidden sm:table-cell' }, String(r.n)),
        el('td', { class: 'px-3 py-2 tabular-nums text-muted- hidden sm:table-cell' }, fmt.usd0(r.total)),
        el('td', { class: 'px-3 py-2 tabular-nums font-bold' }, fmt.usd0(r.rev)),
        el('td', { class: 'px-3 py-2 tabular-nums hidden sm:table-cell', style: { color: r.pending ? '#A9441F' : 'var(--text-subtle)' } }, r.pending ? fmt.usd0(r.pending) : '\u2014'),
        el('td', { class: 'px-3 py-2 tabular-nums hidden sm:table-cell', style: { color: r.failed ? '#DC2626' : 'var(--text-subtle)' } }, r.failed ? fmt.usd0(r.failed) : '\u2014'),
        isQ
          ? el('td', { class: 'px-3 py-2' })
          : el('td', { class: 'px-3 py-2 whitespace-nowrap', style: { minWidth: '160px' } },
              el('div', { class: 'flex items-center gap-1.5' },
                el('div', { style: { flex: '1', minWidth: '34px', height: '5px', borderRadius: '0', background: 'var(--card-2)', overflow: 'hidden' } },
                  el('div', { style: { width: pctTo.toFixed(0) + '%', height: '100%', borderRadius: '0', background: pctTo >= 75 ? '#DF643A' : pctTo >= 40 ? '#A9441F' : 'var(--border-2)' } })),
                el('span', { class: 'text-[11px] tabular-nums font-bold whitespace-nowrap', style: { color: pctTo >= 75 ? '#DF643A' : 'var(--text-muted)' } },
                  fmt.usd0(Math.max(0, r.goal - r.rev)) + ' to go'))));
    };
    return el('div', { class: 'card overflow-hidden' },
      el('div', { class: 'px-4 py-2.5 flex items-center justify-between', style: { background: 'var(--text)', color: 'var(--bg)' } },
        el('div', { class: 'font-black uppercase tracking-widest text-sm' }, (isRk ? 'Rookies' : 'Veterans') + ' \u00b7 ' + fmt.usd0(goal)),
        el('div', { class: 'text-xs font-bold tabular-nums px-2 py-0.5 rounded', style: { background: qual2.length ? '#DF643A' : 'rgba(255,255,255,.15)', color: qual2.length ? '#323230' : 'var(--bg)' } }, qual2.length + ' earned')),
      (qual2.length || chase.length) ? el('div', { class: 'overflow-x-auto' }, el('table', { class: 'w-full text-sm' },
        el('thead', {}, el('tr', { class: 'text-left text-[10px] uppercase tracking-widest text-muted-' },
          ...[['name', 'Rep'], ['n', 'Passed Accts', 'Accounts counting toward the box (passed audit / no audit)'], ['total', 'Total', 'Pending/Serviced revenue (the FieldRoutes gate) \u2014 Passed + Pending + Failed'], ['rev', 'Passed', 'Passed audit or no audit, $99+ initial \u2014 the only revenue that counts toward the box'], ['pending', 'Pending', 'No audit flag yet (not Last Resort) \u2014 moves to Passed or Failed as audits land'], ['failed', 'Failed', 'Failed audit + Last Resort (<$99) \u2014 does not count'], ['progress', 'To Go', 'Sort by % of goal']].map(([k, h, tip]) => {
            const _mobileHide = (k === 'office' || k === 'n' || k === 'total' || k === 'pending' || k === 'failed') ? ' hidden sm:table-cell' : '';
            const _srt = state._mbSort || null;
            const active = _srt && _srt.key === k;
            return el('th', {
              class: 'px-3 py-2 whitespace-nowrap cursor-pointer select-none' + _mobileHide,
              style: active ? { color: 'var(--accent)' } : {},
              title: (tip ? tip + ' \u00b7 ' : '') + 'Click to sort',
              onclick: () => {
                const cur = state._mbSort || {};
                state._mbSort = { key: k, dir: cur.key === k ? (cur.dir === 'desc' ? 'asc' : 'desc') : (k === 'name' ? 'asc' : 'desc') };
                mountApp();
              },
            }, h + (active ? (_srt.dir === 'desc' ? ' \u2193' : ' \u2191') : ''));
          }))),
        el('tbody', {},
          ...qual2.map(row),
          chase.length ? el('tr', {}, el('td', {
            colspan: '8',
            class: 'px-3 py-1.5 text-[10px] font-black uppercase tracking-widest',
            style: { background: 'var(--card-2)', color: 'var(--text-muted)' },
          }, 'Chasing the box')) : null,
          ...chase.map(row))))
        : el('div', { class: 'p-6 text-center text-xs text-muted-' }, 'No sales in this window.'));
  };
  nodes.push(el('div', { class: 'grid grid-cols-1 lg:grid-cols-2 gap-4 items-start' }, tierCard('vet'), tierCard('rookie')));
  return nodes.length ? el('div', { class: 'flex flex-col gap-4' }, ...nodes) : null;
}

// ═══ 🏆 RIDD INSIDE SALES LEAGUE (Office Staff) — per Isaac ═════════════
// Soccer-style promotion/relegation league in SEMI-MONTHLY rounds (always
// the 1st–15th, then the 16th–month-end), ranked on revenue. Straight off the FieldRoutes sync (Office Staff rows).
// COUNTING RULES (same P/S basis as the sales-rep comps):
//   · Pending/Serviced gate (frPendingServiced) — pre-service cancels are out
//   · AutoPay must be ON
//   · An agreement must be on file (12/18/24-Mo contract length). The CRM
//     mirror does NOT carry e-signature status; if a contractSigned field
//     ever lands in the sync, it takes over automatically.
//   · Failed-audit revenue is broken out and DEDUCTED (Passed Revenue =
//     FR Revenue + Upsells − Failed)
// Divisions of 3 (PREMIER LEAGUE, then PRIORITY 1, 2, …). Each rotation:
// bottom of a division relegates ▼, top of the division below promotes ▲.
function islQualifies(s) {
  if (typeof _indicatorDeptOf === 'function' && _indicatorDeptOf(s) !== 'office') return false;
  if (typeof frPendingServiced === 'function' && !frPendingServiced(s)) return false;
  if (!(s.autoPay && s.autoPay !== 'No')) return false;                     // AutoPay required
  if (s.contractSigned !== undefined) return !!s.contractSigned;            // future-proof: real signed flag wins
  return Number(s.contract) > 1;                                            // agreement on file (not One-Time)
}
function openIslHelpModal() {
  const overlay = el('div', { class: 'modal-overlay' });
  const close = () => overlay.remove();
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  const block = (t, b) => el('div', { class: 'mb-4' },
    el('div', { class: 'text-[11px] uppercase tracking-widest font-bold mb-1', style: { color: '#323230' } }, t),
    el('div', { class: 'text-[13px] leading-relaxed', style: { color: 'var(--text-muted)' } }, b));
  overlay.append(el('div', { class: 'card w-full max-w-lg my-8 overflow-hidden flex flex-col', style: { maxHeight: 'calc(100vh - 64px)' } },
    el('div', { class: 'flex items-start justify-between px-5 py-3', style: { background: '#1F3B8B' } },
      el('div', {},
        el('div', { class: 'text-[10px] uppercase tracking-widest font-black', style: { color: '#F6C915', letterSpacing: '.35em' } }, 'BELIEVE'),
        el('h2', { class: 'text-lg font-black mt-0.5', style: { color: '#fff', textTransform: 'uppercase' } }, 'RIDD Inside Sales League')),
      el('button', { class: 'text-2xl leading-none cursor-pointer', style: { color: '#fff' }, onclick: close }, '\u00d7')),
    el('div', { class: 'overflow-auto px-5 py-4' },
      block('\u26bd The format', 'Football is life \u2014 and so is inside sales. Divisions of 3: Premier League on top, then Priority 1, Priority 2, \u2026 competing in semi-monthly rounds \u2014 always the 1st\u201315th, then the 16th through month-end \u2014 ranked by Passed Revenue.'),
      block('\ud83d\udd03 Promotion & relegation', 'When a round ends (midnight after the 15th / month-end), its tables FREEZE automatically as the permanent record, the BOTTOM rep of each division drops a division (\u25bc), and the TOP rep of the division below moves up (\u25b2). Ties break to the higher MY %.'),
      block('\ud83d\udcde The stakes', 'Premier League takes MORE inbound calls. Get relegated to a Priority and you take fewer \u2014 climb back up to earn the call volume back.'),
      block('\ud83d\udcb0 What counts', 'Pending/Serviced accounts only (the same gate every sales-rep comp uses \u2014 pre-service cancels never count), sold by Office Staff, with AutoPay ON and an agreement on file (12/18/24-month contract; one-time jobs are out).'),
      block('\ud83e\uddfe The columns', 'Pending/Serviced Rev = CRM-synced subscription revenue passing the P/S gate. Upsells = upsell-source revenue. Failed = failed-audit revenue, which is DEDUCTED. Passed Revenue = Pending/Serviced + Upsells \u2212 Failed \u2014 that\u2019s the ranking number.'))));
  document.body.append(overlay);
}
// 👥 League roster — who's actually competing. Reps can sell revenue
// without being in the league (per Isaac); toggling here builds an explicit
// roster (default = everyone with season production).
function openIslRosterModal(cfg, repRows, onSave) {
  const overlay = el('div', { class: 'modal-overlay' });
  const close = () => { overlay.remove(); mountApp(); };
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  const card = el('div', { class: 'card w-full max-w-md my-8 overflow-hidden flex flex-col', style: { maxHeight: 'calc(100vh - 64px)' } });
  overlay.append(card);
  const render = () => {
    card.innerHTML = '';
    const isIn = (n) => (!Array.isArray(cfg.roster) || !cfg.roster.length) ? true : cfg.roster.includes(n);
    const toggle = (n) => {
      let r = (Array.isArray(cfg.roster) && cfg.roster.length) ? cfg.roster.slice() : repRows.map(x => x.name);
      if (r.includes(n)) r = r.filter(x => x !== n); else r.push(n);
      cfg.roster = r;
      onSave('roster \u2192 ' + r.length + ' competing');
      render();
    };
    card.append(
      el('div', { class: 'flex items-center justify-between px-5 py-3', style: { background: '#1F3B8B' } },
        el('div', {},
          el('h2', { class: 'text-base font-bold', style: { color: '#fff' } }, 'League roster'),
          el('div', { class: 'text-[11px]', style: { color: '#F6C915' } }, 'Toggle who\u2019s competing \u2014 revenue from non-roster reps never enters the divisions')),
        el('button', { class: 'text-2xl leading-none cursor-pointer', style: { color: '#fff' }, onclick: close }, '\u00d7')),
      el('div', { class: 'overflow-auto p-2' },
        ...repRows.map(r => el('button', {
          class: 'w-full flex items-center gap-2 px-2.5 py-1 rounded-lg text-[11px] cursor-pointer text-left transition hover:brightness-95',
          style: { background: isIn(r.name) ? 'var(--card-2)' : 'transparent', opacity: isIn(r.name) ? '1' : '.55' },
          onclick: () => toggle(r.name),
        },
          el('span', { style: { fontSize: '14px' } }, isIn(r.name) ? '\u2611' : '\u2610'),
          el('span', { class: 'font-semibold flex-1 min-w-0 truncate', style: isIn(r.name) ? {} : { textDecoration: 'line-through' } }, r.name),
          el('span', { class: 'text-xs tabular-nums', style: { color: 'var(--text-muted)' } }, fmt.usd0(r.rev) + ' season')))));
  };
  render();
  document.body.append(overlay);
}
// Rep drill-down (per Isaac): every account behind a league line — what
// counted, what failed audit (deducted), and what was excluded and WHY.
function openIslRepModal(nm, recs, roundLabel) {
  const overlay = el('div', { class: 'modal-overlay' });
  const close = () => overlay.remove();
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  const counted = recs.filter(r => !r.reason && !r.failed);
  const failed = recs.filter(r => !r.reason && r.failed);
  const excl = recs.filter(r => r.reason);
  const sum = (arr) => arr.reduce((a, r) => a + r.cv, 0);
  const secHead = (label, color, amt) => el('div', { class: 'px-4 py-1.5 text-[10px] font-black uppercase tracking-widest flex items-center justify-between', style: { background: 'var(--card-2)', color } },
    el('span', {}, label), el('span', { class: 'tabular-nums' }, fmt.usd0(amt)));
  const row = (r, dim) => el('div', { class: 'px-4 py-2 flex items-center gap-3 border-t text-sm', style: { borderColor: 'var(--border)', opacity: dim ? '.6' : '1' } },
    el('div', { class: 'flex-1 min-w-0' },
      el('div', { class: 'font-semibold truncate' }, '#' + (r.s.customerId || '\u2014') + ' \u00b7 ' + (r.s.customer || 'Customer')),
      el('div', { class: 'text-[11px]', style: { color: 'var(--text-muted)' } },
        (r.s.subscription || '') + ' \u00b7 sold ' + (r.s.dateSold || '') + (r.isUp ? ' \u00b7 UPSELL' : '') + (r.reason ? ' \u00b7 ' + r.reason : ''))),
    el('div', { class: 'tabular-nums font-bold whitespace-nowrap' }, fmt.usd0(r.cv)));
  overlay.append(el('div', { class: 'card w-full max-w-lg my-8 overflow-hidden flex flex-col', style: { maxHeight: 'calc(100vh - 64px)' } },
    el('div', { class: 'flex items-center justify-between px-5 py-3', style: { background: '#1F3B8B' } },
      el('div', {},
        el('h2', { class: 'text-base font-bold', style: { color: '#fff' } }, nm),
        el('div', { class: 'text-[11px]', style: { color: '#F6C915' } }, roundLabel + ' \u00b7 Passed Revenue ' + fmt.usd0(sum(counted)))),
      el('button', { class: 'text-2xl leading-none cursor-pointer', style: { color: '#fff' }, onclick: close }, '\u00d7')),
    el('div', { class: 'overflow-auto' },
      counted.length ? secHead('\u2705 Counted \u00b7 ' + counted.length, '#DF643A', sum(counted)) : null,
      ...counted.map(r => row(r, false)),
      failed.length ? secHead('\u26d4 Failed audit \u00b7 deducted \u00b7 ' + failed.length, '#DC2626', sum(failed)) : null,
      ...failed.map(r => row(r, false)),
      excl.length ? secHead('\u2014 Not counted \u00b7 ' + excl.length, 'var(--text-muted)', sum(excl)) : null,
      ...excl.map(r => row(r, true)),
      !recs.length ? el('div', { class: 'p-6 text-center text-xs', style: { color: 'var(--text-muted)' } }, 'No accounts in this round.') : null)));
  document.body.append(overlay);
}
function islSection(raw, cfg, isAdmin) {
  const wrap = el('div', { class: 'flex flex-col gap-4' });
  const save = (detail) => {
    logActivity('comp_change', { detail: 'Inside Sales League: ' + detail });
    saveDemoData();
    if (typeof saveIndicatorState === 'function') saveIndicatorState();
    mountApp();
  };
  const DIV_SIZE = 3;
  // ── Comp Window bar ──
  // The round selector IS the comp window (per Isaac) — no separate date
  // box. The season-start input only shows while no season is set (and
  // again after a ↺ Reset).
  const bar = el('div', { class: 'card p-2.5 flex items-center gap-2 flex-wrap', style: { borderLeft: '3px solid var(--text)' } },
    el('span', { class: 'text-[10px] uppercase tracking-widest font-bold', style: { color: 'var(--text-subtle)' } }, 'Comp Window'));
  wrap.append(bar);
  if (!cfg.start) {
    bar.append(
      isAdmin ? el('input', {
        type: 'date', value: '',
        class: 'rounded border px-1.5 py-1 text-xs',
        style: { borderColor: 'var(--border-2)', background: 'var(--card)', color: 'var(--text)' },
        title: 'Season start — rounds run the 1st–15th and the 16th–month-end, rolling from this date',
        onchange: (e) => { cfg.start = e.target.value; state._islRoundSel = null; save('season start \u2192 ' + (e.target.value || 'unset')); },
      }) : null,
      el('span', { class: 'text-[11px] ml-1', style: { color: 'var(--text-muted)' } }, '\u00b7 set the season start \u2014 rounds run the 1st\u201315th, then the 16th\u2013month-end'),
      el('div', { class: 'ml-auto' }));
    wrap.append(el('div', { class: 'card p-8 text-center text-sm', style: { color: 'var(--text-muted)' } },
      isAdmin ? 'Set the season start date in the Comp Window bar to open the league.' : 'The league opens once an admin sets the season start date.'));
    return wrap;
  }
  // SEMI-MONTHLY rounds (per Isaac): always the 1st–15th, then the 16th
  // through the end of the month. Round 1 = whichever half the season
  // start lands in.
  const dayMs = 86400000;
  const _startD = new Date(cfg.start + 'T00:00');
  const _halfIdxOf = (d) => (d.getFullYear() * 12 + d.getMonth()) * 2 + (d.getDate() > 15 ? 1 : 0);
  const _startHalf = _halfIdxOf(_startD);
  const curIdx = Math.max(0, _halfIdxOf(new Date()) - _startHalf);
  const selIdx = (state._islRoundSel == null || state._islRoundSel < 0) ? curIdx : Math.min(state._islRoundSel, curIdx);
  const _roundBounds = (idx) => {
    const h = _startHalf + idx;
    const hy = Math.floor(h / 24), hrem = h % 24, hm = Math.floor(hrem / 2), hh = hrem % 2;
    return { rS: new Date(hy, hm, hh === 0 ? 1 : 16), rE: hh === 0 ? new Date(hy, hm, 15) : new Date(hy, hm + 1, 0) };
  };
  const { rS, rE } = _roundBounds(selIdx);
  const iso = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const mmdd = (d) => (d.getMonth() + 1) + '/' + d.getDate();
  const roundOver = Date.now() > rE.getTime() + dayMs;
  // Qualifying tallies for ANY round — used by the selected-round board and
  // by the auto-freeze below.
  const _computeRoundTally = (idx) => {
    const b = _roundBounds(idx);
    const bS = b.rS.getFullYear() + '-' + String(b.rS.getMonth() + 1).padStart(2, '0') + '-' + String(b.rS.getDate()).padStart(2, '0');
    const bE = b.rE.getFullYear() + '-' + String(b.rE.getMonth() + 1).padStart(2, '0') + '-' + String(b.rE.getDate()).padStart(2, '0');
    const t0 = new Map();
    for (const s of (raw || [])) {
      if (typeof _indicatorDeptOf === 'function' && _indicatorDeptOf(s) !== 'office') continue;
      const dIso = (typeof dateSoldToIso === 'function') ? dateSoldToIso(s.dateSold) : '';
      if (!dIso || dIso < bS || dIso > bE) continue;
      const nm = getCanonicalRepName(s.rep);
      if (!nm) continue;
      const cv = Number(s.contractValue) || 0;
      const t = t0.get(nm) || { fr: 0, up: 0, fail: 0, n: 0, multi: 0, twelve: 0, apN: 0, apOn: 0 };
      t.apN++;
      if (s.autoPay && s.autoPay !== 'No') t.apOn++;
      t0.set(nm, t);
      if (!islQualifies(s)) continue;
      if ((typeof reportingSourceClass === 'function') && reportingSourceClass(s.source) === 'upsell') t.up += cv; else t.fr += cv;
      if (typeof SC_FAIL_RE !== 'undefined' && SC_FAIL_RE.test(s.customerFlags || '')) t.fail += cv;
      t.n++;
      const _myb2 = myBucketOf(s);
      if (_myb2 === 'multi') t.multi++; else if (_myb2 === 'twelve') t.twelve++;
      t0.set(nm, t);
    }
    return t0;
  };
  // ── AUTO-FREEZE (per Isaac): no manual rotation button. The first admin
  // load after a round closes (midnight after the 15th / month-end) locks
  // that round's final tables as the permanent record and rolls promotion/
  // relegation forward — because CRM upsells keep moving live numbers, the
  // snapshot is the truth for finished rounds.
  cfg.history = (cfg.history && typeof cfg.history === 'object') ? cfg.history : {};
  if (isAdmin) {
    let _froze = 0;
    for (let ri = 0; ri < curIdx; ri++) {
      if (cfg.history[ri]) continue;
      const rt = _computeRoundTally(ri);
      const _p = (nm) => { const t = rt.get(nm) || { fr: 0, up: 0, fail: 0 }; return t.fr + t.up - t.fail; };
      const _m = (nm) => { const t = rt.get(nm); if (!t) return 0; const d = t.multi + t.twelve; return d > 0 ? t.multi / d : 0; };
      const _cmp = (a, b) => _p(b) - _p(a) || _m(b) - _m(a);
      const _statR = (nm) => { const t = rt.get(nm) || { fr: 0, up: 0, fail: 0, n: 0, apN: 0, apOn: 0 }; return { name: nm, fr: t.fr, fail: t.fail, up: t.up, passed: _p(nm), my: _m(nm), acv: t.n > 0 ? (t.fr + t.up) / t.n : 0, ap: t.apN > 0 ? t.apOn / t.apN : null }; };
      const rosterR = (Array.isArray(cfg.roster) && cfg.roster.length) ? cfg.roster.slice() : [...rt.keys()];
      let dd = Array.isArray(cfg.divs) && cfg.divs.length ? cfg.divs.map(d => d.slice()) : null;
      if (dd) dd = dd.map(d => d.filter(n => rosterR.includes(n))).filter(d => d.length);
      if (!dd || !dd.length) {
        const ranked = rosterR.slice().sort(_cmp);
        dd = [];
        for (let i = 0; i < ranked.length; i += 3) dd.push(ranked.slice(i, i + 3));
      } else {
        const placed = new Set(dd.flat());
        rosterR.filter(n => !placed.has(n)).forEach(n => { const last = dd[dd.length - 1]; if (last.length < 3) last.push(n); else dd.push([n]); });
      }
      if (!dd.length) continue;   // nothing to freeze yet
      const sorted = dd.map(d => d.slice().sort(_cmp));
      cfg.history[ri] = { at: new Date().toISOString(), divs: sorted.map(d => d.map(_statR)) };
      for (let i = 0; i < sorted.length - 1; i++) {
        const down = sorted[i].pop();
        const up2 = sorted[i + 1].shift();
        if (up2 !== undefined) sorted[i].push(up2);
        if (down !== undefined) sorted[i + 1].unshift(down);
      }
      cfg.divs = sorted.map(d => d.slice()).filter(d => d.length);
      _froze++;
    }
    if (_froze) {
      logActivity('comp_change', { detail: 'Inside Sales League: auto-froze ' + _froze + ' round(s) + applied rotation' });
      saveDemoData();
      if (typeof saveIndicatorState === 'function') saveIndicatorState();
    }
  }
  // ── Per-rep tallies for the selected round ──
  const tally = new Map();
  const seasonNames = new Set();
  const _seasonRev = new Map();
  const _repRecs = new Map();   // rep → every round account, for the drill-down
  for (const s of (raw || [])) {
    if (typeof _indicatorDeptOf === 'function' && _indicatorDeptOf(s) !== 'office') continue;
    const dIso = (typeof dateSoldToIso === 'function') ? dateSoldToIso(s.dateSold) : '';
    if (!dIso || dIso < cfg.start) continue;
    const nm = getCanonicalRepName(s.rep);
    if (!nm) continue;
    if (typeof frPendingServiced === 'function' && frPendingServiced(s)) {
      seasonNames.add(nm);
      _seasonRev.set(nm, (_seasonRev.get(nm) || 0) + (Number(s.contractValue) || 0));
    }
    if (dIso < iso(rS) || dIso > iso(rE)) continue;
    // Classify EVERY round account (for the rep drill-down), then tally
    // only the qualifying ones.
    const cv = Number(s.contractValue) || 0;
    const _ps = (typeof frPendingServiced !== 'function') || frPendingServiced(s);
    const rec = {
      s, cv,
      isUp: (typeof reportingSourceClass === 'function') && reportingSourceClass(s.source) === 'upsell',
      failed: typeof SC_FAIL_RE !== 'undefined' && SC_FAIL_RE.test(s.customerFlags || ''),
      reason: !_ps ? 'Not Pending/Serviced (pre-service cancel / no scheduled initial)'
        : !(s.autoPay && s.autoPay !== 'No') ? 'No AutoPay'
        : (s.contractSigned !== undefined ? !s.contractSigned : !(Number(s.contract) > 1)) ? 'No agreement on file (one-time)'
        : null,
    };
    if (!_repRecs.has(nm)) _repRecs.set(nm, []);
    _repRecs.get(nm).push(rec);
    const t = tally.get(nm) || { fr: 0, up: 0, fail: 0, n: 0, multi: 0, twelve: 0, pend: 0, apN: 0, apOn: 0 };
    t.apN++;
    if (s.autoPay && s.autoPay !== 'No') t.apOn++;
    tally.set(nm, t);
    if (rec.reason) continue;
    if (rec.isUp) t.up += cv; else t.fr += cv;
    if (rec.failed) t.fail += cv;
    t.n++;
    const _myb = myBucketOf(s);
    if (_myb === 'multi') t.multi++; else if (_myb === 'twelve') t.twelve++;
    if (!rec.failed && typeof scAuditPassed === 'function' && !scAuditPassed(s.customerFlags || '')) t.pend++;
    tally.set(nm, t);
  }
  const passedOf = (nm) => { const t = tally.get(nm) || { fr: 0, up: 0, fail: 0 }; return t.fr + t.up - t.fail; };
  const myOf = (nm) => { const t = tally.get(nm); if (!t) return 0; const d = t.multi + t.twelve; return d > 0 ? t.multi / d : 0; };
  const acvOf = (nm) => { const t = tally.get(nm); return (t && t.n > 0) ? (t.fr + t.up) / t.n : 0; };
  const apOf = (nm) => { const t = tally.get(nm); return (t && t.apN > 0) ? t.apOn / t.apN : null; };
  const statOf = (nm) => ({ name: nm, fr: (tally.get(nm) || {}).fr || 0, fail: (tally.get(nm) || {}).fail || 0, up: (tally.get(nm) || {}).up || 0, passed: passedOf(nm), my: myOf(nm), acv: acvOf(nm), ap: apOf(nm) });
  // Ranking: Passed Revenue, ties broken by the HIGHER MY % (per Isaac).
  const cmpReps = (a, b) => passedOf(b) - passedOf(a) || myOf(b) - myOf(a);
  // ── Division membership: stored (rotations applied) or seeded from the
  //    season's sellers ranked by this round's Passed Revenue. New sellers
  //    join the bottom division automatically. ──
  let divs = Array.isArray(cfg.divs) && cfg.divs.length ? cfg.divs.map(d => d.slice()) : null;
  // 👥 Roster: explicit competing list when set (per Isaac — producers who
  // aren't in the league stay off the tables); otherwise every season seller.
  const _hasRoster = Array.isArray(cfg.roster) && cfg.roster.length > 0;
  const roster = _hasRoster ? cfg.roster.slice() : [...seasonNames];
  if (_hasRoster && divs) divs = divs.map(d => d.filter(n => roster.includes(n))).filter(d => d.length);
  if (!divs) {
    const ranked = roster.slice().sort(cmpReps);
    divs = [];
    for (let i = 0; i < ranked.length; i += DIV_SIZE) divs.push(ranked.slice(i, i + DIV_SIZE));
  } else {
    const placed = new Set(divs.flat());
    const newcomers = roster.filter(n => !placed.has(n));
    if (newcomers.length) {
      const last = divs[divs.length - 1];
      newcomers.forEach(n => { if (last.length < DIV_SIZE) last.push(n); else divs.push([n]); });
    }
  }
  // ── Bar controls: round picker + rotation + reset + \u24d8 ──
  const ctl = el('div', { class: 'ml-auto flex items-center gap-2' });
  // Round DROPDOWN (per Isaac) — pick any round; finished ones show 🔒
  // (their frozen snapshot renders, immune to later CRM movement).
  bar.append(el('select', {
    class: 'rounded-lg border px-2.5 py-1 text-[11px] font-bold cursor-pointer',
    style: { borderColor: 'var(--border-2)', background: 'var(--card)', color: 'var(--text)' },
    onchange: (e) => { state._islRoundSel = Number(e.target.value); mountApp(); },
  }, ...Array.from({ length: curIdx + 1 }, (_, i) => {
    const b = _roundBounds(i);
    return el('option', { value: String(i), selected: i === selIdx },
      'Round ' + (i + 1) + ' \u00b7 ' + mmdd(b.rS) + '\u2013' + mmdd(b.rE) +
      (cfg.history[i] ? ' \ud83d\udd12' : (i === curIdx && !roundOver) ? ' \u00b7 live' : ''));
  })));
  ctl.append(
    isAdmin ? el('button', {
      class: 'cursor-pointer transition hover:brightness-95 border rounded-full',
      style: { width: '26px', height: '26px', borderColor: 'var(--border-2)', background: 'var(--card)', display: 'grid', placeItems: 'center', fontSize: '13px', lineHeight: '1', padding: '0' },
      title: 'League roster \u2014 toggle who\u2019s competing (producers off the roster never enter the divisions)',
      onclick: () => {
        const rows = [...new Set([...seasonNames, ...(Array.isArray(cfg.roster) ? cfg.roster : [])])]
          .map(n => ({ name: n, rev: _seasonRev.get(n) || 0 }))
          .sort((a, b) => b.rev - a.rev);
        openIslRosterModal(cfg, rows, (detail) => {
          logActivity('comp_change', { detail: 'Inside Sales League: ' + detail });
          saveDemoData();
          if (typeof saveIndicatorState === 'function') saveIndicatorState();
        });
      },
    }, '\ud83d\udc65') : null,
    // (↺ Reset dropped — per Isaac: the league is a rolling leaderboard of
    // the semi-monthly rounds, nothing to reset.)
    el('button', {
      class: 'rounded-full flex items-center justify-center font-black cursor-pointer transition hover:brightness-95 border',
      style: { width: '26px', height: '26px', borderColor: 'var(--border-2)', color: 'var(--text)', fontSize: '13px', flexShrink: '0' },
      title: 'League rules',
      onclick: () => openIslHelpModal(),
    }, '\u24d8'));
  bar.append(ctl);
  // ── Masthead ──
  // Ted Lasso theme (per Isaac): the masthead IS the BELIEVE sign — bright
  // yellow card, royal-blue letters — with AFC-Richmond navy & gold on the
  // division tables below.
  wrap.append(el('div', { class: 'card overflow-hidden' },
    el('div', { class: 'px-5 py-5 flex items-center justify-between gap-3 flex-wrap', style: { background: '#F6C915', color: '#1F3B8B' } },
      el('div', {},
        el('div', { style: { display: 'inline-block', background: '#fff', border: '3px solid #1F3B8B', borderRadius: '0', padding: '4px 14px', fontWeight: '900', fontSize: '22px', letterSpacing: '.35em', color: '#1F3B8B', boxShadow: '0 2px 6px rgba(0,0,0,.18)' } }, 'BELIEVE'),
        el('div', { class: 'font-display text-3xl leading-none mt-2', style: { color: '#1F3B8B' } }, 'RIDD INSIDE SALES LEAGUE'),
        el('div', { class: 'text-[11px] font-bold uppercase tracking-wide mt-1', style: { color: '#1F3B8B', opacity: '.8' } },
          'Round ' + (selIdx + 1) + ' \u00b7 ' + mmdd(rS) + '/' + rS.getFullYear() + ' \u2013 ' + mmdd(rE) + '/' + rE.getFullYear() + ' \u00b7 Pending/Serviced \u00b7 AutoPay + agreement required')),
      el('div', { class: 'text-right' },
        el('div', { style: { fontSize: '40px' } }, '\ud83c\udfc6'),
        el('div', { class: 'text-[10px] font-bold italic mt-1', style: { color: '#1F3B8B', opacity: '.75' } }, '\u201cBe a goldfish.\u201d')))));
  // ── Division tables ──
  if (!divs.length) {
    wrap.append(el('div', { class: 'card p-8 text-center text-sm', style: { color: 'var(--text-muted)' } },
      'No qualifying Office Staff production yet this season \u2014 the divisions seed from the first accounts that land.'));
    return wrap;
  }
  const _benched = _hasRoster ? [...seasonNames].filter(n => !roster.includes(n)) : [];
  const divName = (i) => i === 0 ? 'PREMIER LEAGUE' : 'PRIORITY ' + i;
  // Frozen round? Render the snapshot verbatim (structure AND numbers) —
  // the live recompute is only for rounds that haven't been locked.
  const _snap = (cfg.history && cfg.history[selIdx]) || null;
  const _renderDivs = _snap ? _snap.divs.map(d => d.map(r => r.name)) : divs;
  const _snapStat = _snap ? new Map(_snap.divs.flat().map(r => [r.name, r])) : null;
  const statFor = (nm) => (_snapStat && _snapStat.get(nm)) || statOf(nm);
  // (benched-producers explainer removed — per Isaac; the 👥 roster modal
  // is the single place to see who's in and out)
  _renderDivs.forEach((names, di) => {
    const rows = _snap ? names.slice() : names.slice().sort(cmpReps);
    // ± slots (per Isaac): grow a division by pulling the top rep up from
    // the division below, or shrink it by dropping its bottom rep down —
    // so Premier can run 4 while a Priority runs 2, etc. Sizes persist
    // through rotations (they always swap 1-for-1).
    const _persistDivs = (detail) => {
      cfg.divs = divs.map(d => d.slice()).filter(d => d.length);
      save(detail);
    };
    const _grow = () => {
      if (di >= divs.length - 1) return;
      const below = divs[di + 1].slice().sort(cmpReps);
      const top = below[0];
      divs[di + 1] = divs[di + 1].filter(n => n !== top);
      divs[di] = [...divs[di], top];
      _persistDivs(divName(di) + ' grew to ' + divs[di].length + ' (pulled ' + top + ' up)');
    };
    const _shrink = () => {
      if (!divs[di].length) return;
      const sortedD = divs[di].slice().sort(cmpReps);
      const bottom = sortedD[sortedD.length - 1];
      divs[di] = divs[di].filter(n => n !== bottom);
      if (di === divs.length - 1) divs.push([bottom]); else divs[di + 1] = [bottom, ...divs[di + 1]];
      _persistDivs(divName(di) + ' shrank (moved ' + bottom + ' down)');
    };
    const _szBtn = (glyph, title, onclick, disabled) => el('button', {
      class: 'cursor-pointer font-black',
      style: { width: '20px', height: '20px', borderRadius: '0', border: '1px solid rgba(255,255,255,.4)', background: 'rgba(255,255,255,.12)', color: 'inherit', fontSize: '13px', lineHeight: '1', padding: '0', opacity: disabled ? '.35' : '1' },
      title, onclick: disabled ? undefined : onclick,
    }, glyph);
    wrap.append(el('div', { class: 'card overflow-hidden' },
      el('div', { class: 'px-4 py-2.5 flex items-center justify-between', style: { background: di === 0 ? '#1F3B8B' : '#2b3a5e', color: di === 0 ? '#F6C915' : '#fff' } },
        el('div', { class: 'font-black uppercase tracking-widest text-sm' }, (di === 0 ? '\ud83c\udfc6 ' : '') + divName(di)),
        el('div', { class: 'flex items-center gap-2' },
          _snap ? el('span', { class: 'text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded', style: { background: 'rgba(255,255,255,.18)' } }, '\ud83d\udd12 FINAL') : null,
          el('span', { class: 'text-[10px] font-bold uppercase tracking-widest', style: { opacity: '.75' } }, names.length + ' rep' + (names.length === 1 ? '' : 's')),
          (isAdmin && !_snap && divs[di]) ? _szBtn('\u2212', 'Take a rank away \u2014 this division\u2019s bottom rep drops to the division below', _shrink, !divs[di].length || (di === divs.length - 1 && divs[di].length <= 1)) : null,
          (isAdmin && !_snap && divs[di]) ? _szBtn('+', 'Add a rank \u2014 pulls the top rep up from the division below', _grow, di >= divs.length - 1) : null)),
      // table-layout FIXED + identical column widths so every division
      // table's columns line up down the page (per Isaac).
      el('div', { class: 'overflow-x-auto' }, el('table', { class: 'w-full text-sm', style: { tableLayout: 'fixed', minWidth: '1000px' } },
        el('thead', {}, el('tr', { class: 'text-left text-[10px] uppercase tracking-widest text-muted-' },
          el('th', { class: 'px-3 py-2', style: { width: '44px' } }, 'Pos'),
          el('th', { class: 'px-3 py-2' }, 'Sales Rep'),
          el('th', { class: 'px-3 py-2 text-right whitespace-nowrap', style: { width: '185px' }, title: 'CRM-synced revenue passing the Pending/Serviced gate (AutoPay + agreement required)' }, 'Pending/Serviced Rev'),
          el('th', { class: 'px-3 py-2 text-right whitespace-nowrap', style: { width: '80px' } }, 'Failed'),
          el('th', { class: 'px-3 py-2 text-right whitespace-nowrap', style: { width: '90px' } }, 'Upsells'),
          el('th', { class: 'px-3 py-2 text-right whitespace-nowrap', style: { width: '70px' }, title: 'Multi-year share of contract sales \u2014 the TIEBREAKER (higher wins)' }, 'MY %'),
          el('th', { class: 'px-3 py-2 text-right whitespace-nowrap', style: { width: '90px' } }, 'ACV'),
          el('th', { class: 'px-3 py-2 text-right whitespace-nowrap', style: { width: '84px' }, title: 'AutoPay share of ALL the rep\u2019s round accounts \u2014 the league only counts AutoPay-ON accounts, so this shows how much of the book qualifies' }, 'APay %'),
          el('th', { class: 'px-3 py-2 text-right whitespace-nowrap', style: { width: '145px' } }, 'Passed Revenue'),
          el('th', { class: 'px-3 py-2 text-center whitespace-nowrap', style: { width: '64px' } }, 'Result'))),
        el('tbody', {}, ...rows.map((nm, i) => {
          const st = statFor(nm);
          const up = i === 0 && di > 0;                      // promotes \u25b2
          const down = i === rows.length - 1 && di < _renderDivs.length - 1;   // relegates \u25bc
          return el('tr', {
            class: 'border-t cursor-pointer hover:brightness-95 transition',
            style: { borderColor: 'var(--border)', background: up ? 'rgba(223,100,58,.07)' : down ? 'rgba(220,38,38,.06)' : '' },
            title: 'Click for ' + nm + '\u2019s accounts \u2014 counted, failed, and excluded',
            onclick: () => openIslRepModal(nm, _repRecs.get(nm) || [], 'Round ' + (selIdx + 1) + ' \u00b7 ' + mmdd(rS) + ' \u2013 ' + mmdd(rE)),
          },
            el('td', { class: 'px-3 py-2 font-black tabular-nums', style: { color: i === 0 ? (di === 0 ? '#DF643A' : 'var(--text)') : 'var(--text-muted)' } }, String(i + 1)),
            el('td', { class: 'px-3 py-2 font-semibold whitespace-nowrap' }, nm),
            el('td', { class: 'px-3 py-2 text-right tabular-nums' }, fmt.usd0(st.fr)),
            el('td', { class: 'px-3 py-2 text-right tabular-nums', style: { color: st.fail ? '#DC2626' : 'var(--text-subtle)' } }, st.fail ? '\u2212' + fmt.usd0(st.fail) : '\u2014'),
            el('td', { class: 'px-3 py-2 text-right tabular-nums' }, st.up ? fmt.usd0(st.up) : '\u2014'),
            el('td', { class: 'px-3 py-2 text-right tabular-nums' }, (st.my > 0 || st.passed > 0) ? (st.my * 100).toFixed(0) + '%' : '\u2014'),
            el('td', { class: 'px-3 py-2 text-right tabular-nums' }, st.acv > 0 ? fmt.usd0(st.acv) : '\u2014'),
            el('td', { class: 'px-3 py-2 text-right tabular-nums' }, st.ap != null ? (st.ap * 100).toFixed(0) + '%' : '\u2014'),
            el('td', { class: 'px-3 py-2 text-right tabular-nums font-black' }, fmt.usd0(st.passed)),
            el('td', { class: 'px-3 py-2 text-center font-black' }, up ? el('span', { style: { color: '#DF643A' }, title: 'Promotes at rotation' }, '\u25b2') : down ? el('span', { style: { color: '#DC2626' }, title: 'Relegates at rotation' }, '\u25bc') : ''));
        }))))));
  });
  return wrap;
}

function viewNrlaPublic() {
  const wrap = el('div', { class: 'flex flex-col gap-5 w-full' });
  const isAdmin = isAdminRole(state.profile?.role);
  let comps = (typeof getIndicatorCompetitions === 'function') ? getIndicatorCompetitions() : [];
  // Avg Pest & Raffle is ADMIN-ONLY — reps never see its pill or board.
  if (!isAdmin) comps = comps.filter(c => (c.scoring || c.id) !== 'avg_pest_initial' && c.id !== 'avg_pest_initial');
  // Mystery Boxes rides the pill bar as its own competition tab (per Isaac).
  // Virtual — no scoring config behind it, so it never becomes the active
  // scoring comp.
  {
    const _mbFav = !!state._compFavoriteMystery;
    if (_mbFav) comps = comps.map(c => { const c2 = c; delete c2.favorite; return c2; });
    comps = [...comps, { id: 'mystery_box', name: 'Mystery Boxes', favorite: _mbFav }];
  }
  // Virtual pills have no config row — their persisted bits (★ default,
  // comp windows, …) live in the synced _compExtras map, so ANY virtual
  // comp added here (now or in the future) gets them for free.
  const _cXtra = (state._compExtras && typeof state._compExtras === 'object') ? state._compExtras : (state._compExtras = {});
  const _hydrateVirtual = (c) => Object.assign(c, _cXtra[c.id] || {});
  // \ud83d\udc51 King of the Hill — whoever holds the biggest days of the
  // summer. Not on the sanctioned schedule; lives in the one-offs dropdown.
  comps = [...comps, _hydrateVirtual({ id: 'koth', name: 'KOTH' })];
  // \ud83d\udc0d Kobe Week — beat-your-best-week personal record comp.
  comps = [...comps, _hydrateVirtual({ id: 'kobe_week', name: 'Kobe Week' })];
  // New 2026 competitions (per Isaac) — no scoring engine yet: each renders
  // its window + a plain revenue board for that window until rules land.
  for (const [id, name] of COMP_2026_NEW) comps = [...comps, _hydrateVirtual({ id, name })];
  // 2026 SCHEDULE ORDER (per Isaac) — the sanctioned season, in calendar
  // order. Anything not on the schedule (one-offs) sinks after it.
  {
    const _ord = COMP_2026_ORDER;
    comps = comps.slice().sort((a, b) => {
      const ia = _ord.indexOf(a.id), ib = _ord.indexOf(b.id);
      return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
    });
  }
  // Seed the 2026 windows into the comp schedule the first time (admin
  // only — it lands in shared config). Existing entries are never touched.
  if (isAdmin && typeof compScheduleStore === 'function') {
    const sc = compScheduleStore(); let seeded = 0;
    for (const [id, win] of Object.entries(COMP_2026_WINDOWS)) { if (!sc[id] || !sc[id].start) { sc[id] = Object.assign({}, sc[id] || {}, { start: win[0], end: win[1], repeat: 'none' }); seeded++; } }
    if (seeded && typeof compScheduleSave === 'function') compScheduleSave();
  }
  const raw = state._indicatorRawSales || [];
  // Self-heal a stale dataset: if what we're holding is >3h old, force one
  // cloud check on open (the regular 10-min poll takes it from there).
  if (state.indicatorsUploadedAt && !state._nrlaStaleRepull
      && Date.now() - new Date(state.indicatorsUploadedAt).getTime() > 3 * 3600 * 1000
      && typeof refreshIndicatorsFromCloud === 'function') {
    state._nrlaStaleRepull = true;
    refreshIndicatorsFromCloud(true).catch(() => {});
  }
  if (!raw.length || !comps.length) {
    // Pull the shared dataset once; the refresh mounts the app when it lands.
    if (!state._nrlaPublicPulled && typeof refreshIndicatorsFromCloud === 'function') {
      state._nrlaPublicPulled = true;
      refreshIndicatorsFromCloud(true).catch(e => console.warn('[ridd] competitions data pull failed', e));
    }
    wrap.append(el('div', { class: 'card p-10 text-center' },
      el('div', { class: 'text-2xl mb-2' }, '🏆'),
      el('div', { class: 'text-sm font-bold' }, 'Loading the competitions…'),
      el('div', { class: 'text-xs mt-1', style: { color: 'var(--text-muted)' } },
        'Pulling the latest shared data — this page refreshes itself. If it never loads, an admin needs to run nrla_rep_access.sql in Supabase.')));
    return wrap;
  }
  // ── Rep-type tabs — comps are organized by WHO competes. Everything built
  // so far is a Sales-Rep (D2D) competition; Office Staff comps get their own
  // home here when they're built. Viewers land on their own type's tab.
  const COMP_REPTYPE_TABS = ['Sales Reps', 'Office Staff', 'Technicians'];
  // ★ The admin-starred default comp applies across ALL user types (per
  // Isaac): everyone LANDS on the starred comp's tab, whatever their role.
  // The tab switcher is open to every account — other types' boards are
  // read-only displays anyway — so office staff can flip back to their own
  // comps after seeing the featured one.
  if (!state._compsRepTypeTab) {
    const _hasFav = comps.some(c => c.favorite) || !!state._compFavoriteMystery;
    state._compsRepTypeTab = _hasFav ? 'Sales Reps'
      : (isOfficeStaffRole(state.profile?.role) ? 'Office Staff' : 'Sales Reps');
  }
  const repTypeTab = COMP_REPTYPE_TABS.includes(state._compsRepTypeTab) ? state._compsRepTypeTab : 'Sales Reps';
  {
    wrap.append(el('div', { class: 'flex items-center gap-1 border-b flex-wrap', style: { borderColor: 'var(--border)' } },
      ...COMP_REPTYPE_TABS.map(t => {
        const on = repTypeTab === t;
        return el('button', {
          class: 'px-2.5 py-1 text-[11px] font-semibold transition whitespace-nowrap',
          style: on ? { color: 'var(--text)', boxShadow: 'inset 0 -2px 0 var(--accent)' } : { color: 'var(--text-muted)' },
          onclick: () => { state._compsRepTypeTab = t; state._compsLanding = true; mountApp(); },
        }, t);
      })));
  }
  // ── Landing page (per Isaac) — poster-style front door: eyebrow, big
  // headline, one button per competition for the selected rep type. Picking
  // a competition opens its page; "← Competitions" comes back here.
  if (state._compsLanding !== false || repTypeTab === 'Technicians') {
    const landingAll = repTypeTab === 'Sales Reps' ? comps
      : repTypeTab === 'Office Staff' ? [{ id: 'isl', name: 'Inside Sales League' }]
      : [];
    const landingComps = landingAll.filter(c => !COMP_ONE_OFFS.has(c.id));
    const oneOffs = landingAll.filter(c => COMP_ONE_OFFS.has(c.id));
    const open = (id) => {
      state._compsLanding = false;
      if (repTypeTab === 'Sales Reps') state._compsTabSel = id;
      mountApp();
    };
    const mono = { fontFamily: "'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, monospace" };
    const ink = '#111';
    const eyebrow = (t) => el('div', { class: 'text-[11px] tracking-[.22em] uppercase', style: { ...mono, color: 'rgba(0,0,0,.65)' } }, t);
    const compBtn = (c) => el('button', {
      class: 'px-5 py-3 text-left transition hover:brightness-110',
      style: { background: ink, color: 'var(--accent)', border: '2px solid ' + ink, fontFamily: 'var(--font-display)', fontSize: '22px', letterSpacing: '.03em', textTransform: 'uppercase', lineHeight: '1' },
      title: 'Open ' + c.name,
      onclick: () => open(c.id),
    }, (c.favorite ? '\u2605 ' : '') + c.name);
    // Poster fills the screen below the top bar + rep-type tabs (per Isaac):
    // the headline block grows, the competition buttons sit at the bottom.
    // Orange keeps going past the poster (per Isaac): the page background
    // itself goes accent while the landing is up, so scrolling / iOS
    // overscroll never shows the off-white behind it.
    try { document.body.classList.add('comp-landing'); } catch (e) { /* noop */ }
    // The competition pickers sit under the copy in the right column (per
    // Isaac, Sep 2026) — no rule, no bottom band.
    const pickers = (() => {
          if (!landingComps.length) return el('div', {},
            eyebrow('02 / No competitions yet'),
            el('div', { class: 'mt-4 comp-landing-copy', style: { ...mono, color: 'rgba(0,0,0,.7)' } }, 'Nothing is running for ' + repTypeTab.toLowerCase() + ' right now \u2014 check back when the next season opens.'));
          const isFav = (c) => !!(c.favorite || (c.id === 'mystery_box' && state._compFavoriteMystery) || (_cXtra[c.id] && _cXtra[c.id].favorite));
          const running = landingComps.filter(c => compRunningNow(c.id));
          const preselect = (running[0] || landingComps.find(isFav) || landingComps[0]).id;
          if (!landingComps.some(c => c.id === state._compsLandingPick)) state._compsLandingPick = preselect;
          const pickId = state._compsLandingPick;
          const picked = landingComps.find(c => c.id === pickId) || landingComps[0];
          const fmtD = (d) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
          const box = el('div', {});
          if (running.length) {
            box.append(eyebrow('02 / Running now' + (running.length > 1 ? ' \u00b7 ' + running.length + ' competitions' : '')),
              el('div', { class: 'flex flex-wrap gap-3 mt-4' }, ...running.map(c => {
                const occ = compRunningNow(c.id);
                const b = compBtn(c);
                b.append(el('div', { class: 'text-[10px] tracking-[.18em] mt-1', style: { ...mono, fontFamily: undefined, textTransform: 'none', letterSpacing: '.12em', opacity: .8 } }, fmtD(occ.start) + ' \u2013 ' + fmtD(occ.end)));
                return b;
              })));
          }
          box.append(eyebrow((running.length ? '03 / ' : '02 / ') + 'All competitions'), el('div', { class: 'flex flex-wrap items-stretch gap-2 mt-4' },
            el('select', {
              class: 'px-4 text-[13px] font-bold cursor-pointer',
              style: { ...mono, borderRadius: '0', background: '#111', color: 'var(--accent)', border: '2px solid #111', minWidth: '240px', height: '46px' },
              onchange: (e) => { state._compsLandingPick = e.target.value; mountApp(); },
            }, ...landingComps.map(c => el('option', { value: c.id, selected: c.id === pickId }, (isFav(c) ? '\u2605 ' : '') + c.name + (compRunningNow(c.id) ? ' \u00b7 live' : '')))),
            el('button', {
              class: 'px-5 text-[13px] font-bold transition hover:brightness-110',
              style: { ...mono, background: 'var(--accent)', color: '#111', border: '2px solid #111', height: '46px', textTransform: 'uppercase', letterSpacing: '.08em' },
              onclick: () => open(picked.id),
            }, 'Open \u2192'),
            isAdmin && repTypeTab === 'Sales Reps' ? el('button', {
              class: 'px-3 transition hover:brightness-110',
              style: { fontSize: '18px', background: 'transparent', color: '#111', border: '2px dashed rgba(0,0,0,.45)', height: '46px' },
              title: isFav(picked) ? '\u201c' + picked.name + '\u201d is the default everyone lands on. Click to unset.' : 'Make \u201c' + picked.name + '\u201d the default competition everyone lands on (a running comp still takes priority)',
              onclick: () => setCompDefault(comps, picked, !isFav(picked)),
            }, isFav(picked) ? '\u2605' : '\u2606') : null,
          ));
          // One-offs (per Isaac): Mystery Boxes / Avg Pest & Raffle aren't
          // sanctioned season comps — their own dropdown, off to the side.
          // Admin competitions (per Isaac): the unsanctioned one-offs are an
          // admin-only dropdown now — reps never see them.
          if (oneOffs.length && isAdmin) {
            const sel1 = el('select', {
              class: 'px-4 text-[13px] font-bold cursor-pointer',
              style: { ...mono, borderRadius: '0', background: '#111', color: 'var(--accent)', border: '2px solid #111', minWidth: '240px', height: '46px' },
            }, ...oneOffs.map(c => el('option', { value: c.id }, c.name)));
            box.append(el('div', { class: 'mt-6' }, eyebrow((running.length ? '04 / ' : '03 / ') + 'Admin competitions')), el('div', { class: 'flex flex-wrap items-stretch gap-2 mt-4' },
              sel1,
              el('button', { class: 'px-5 text-[13px] font-bold transition hover:brightness-110', style: { ...mono, background: 'var(--accent)', color: '#111', border: '2px solid #111', height: '46px', textTransform: 'uppercase', letterSpacing: '.08em' }, onclick: () => open(sel1.value) }, 'Open \u2192')));
          }
          return box;
        })();
    wrap.append(el('div', { class: 'card overflow-hidden comp-landing-poster', style: { background: 'var(--accent)', color: ink, border: 'none' } },
      el('div', { class: 'comp-landing-pad comp-landing-top', style: { paddingBottom: '24px' } },
        eyebrow('01 / Competitions \u00b7 ' + repTypeTab),
        el('div', { class: 'grid grid-cols-1 sm:grid-cols-2 gap-6 mt-3 items-start' },
          el('div', { style: { fontFamily: 'var(--font-display)', fontSize: 'clamp(56px, 9vw, 128px)', lineHeight: '.9', letterSpacing: '.01em', textTransform: 'uppercase', color: ink } },
            'Built to', el('br'), 'break', el('br'), 'records.'),
          el('div', {},
            el('div', { class: 'leading-relaxed comp-landing-copy', style: { ...mono, color: 'rgba(0,0,0,.85)', maxWidth: '520px' } },
              el('p', { class: 'mb-4' }, 'Every board on these pages is pulled live from the company database. If a number changes in FieldRoutes, it changes here.'),
              el('p', {}, 'Published rules, published standings. Nobody\u2019s scoring is a secret and nobody\u2019s is special.')),
            el('div', { style: { marginTop: '32px' } }, pickers))))));
    // Size the poster to the viewport EXACTLY (per Isaac: no scrolling on the
    // landing). Measured live after mount — header, tabs and gutters all
    // vary — and re-measured on resize. The negative bottom margin already
    // eats the content wrapper's bottom padding, so top-of-poster → viewport
    // bottom is the whole height.
    const _fitPoster = () => {
      const p = wrap.querySelector('.comp-landing-poster'); if (!p || !p.isConnected) return false;
      const top = p.getBoundingClientRect().top + (window.scrollY || 0);
      p.style.minHeight = Math.max(420, window.innerHeight - top) + 'px';
      return true;
    };
    requestAnimationFrame(() => { _fitPoster(); setTimeout(_fitPoster, 250); });
    if (!window._compPosterFitBound) { window._compPosterFitBound = true; window.addEventListener('resize', () => { try { _fitPoster(); } catch (e) { /* gone */ } }); }
    return wrap;
  }
  const backBtn = el('button', {
    class: 'rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition hover:brightness-95 self-start',
    style: { borderColor: 'var(--border-2)', color: 'var(--text)' },
    onclick: () => { state._compsLanding = true; mountApp(); },
  }, '\u2190 Competitions');
  wrap.append(backBtn);
  // PLAIN MODE (per Isaac, Sep 2026): competition LOOKS are moving to Cam's
  // app — this tab is now a data-verification surface. The .comp-plain
  // rules in index.html strip posters, colours, display type and artwork
  // so every board reads as a basic table; the numbers and controls stay.
  wrap.classList.add('comp-plain');
  if (repTypeTab === 'Office Staff') {
    // 🏆 RIDD Inside Sales League — the first Office Staff competition
    // (per Isaac). Config rides the synced _compExtras map under 'isl'.
    wrap.append(el('div', { class: 'card p-3 flex items-center gap-2 flex-wrap', style: { borderLeft: '3px solid var(--text)' } },
      el('span', { class: 'text-[11px] uppercase tracking-widest font-bold', style: { color: 'var(--text-subtle)' } }, 'Competition'),
      el('button', {
        class: 'text-[11px] font-bold rounded-full px-2.5 py-1 border transition cursor-pointer whitespace-nowrap',
        style: { background: 'var(--text)', color: 'var(--bg)', borderColor: 'var(--text)' },
      }, 'Inside Sales League')));
    const _islCfg = (_cXtra.isl && typeof _cXtra.isl === 'object') ? _cXtra.isl : (_cXtra.isl = { start: '2026-07-01' });
    wrap.append(islSection(raw, _islCfg, isAdmin));
    return wrap;
  }
  // Selection order: this session's pick → the ★ DEFAULT comp (admin-set,
  // synced to everyone — "the ongoing comp loads first") → NRLA → first.
  // The active-comp pointer follows the selection so every board computes
  // against the right comp's config (reps never push config, so this stays
  // local for them).
  let selId = state._compsTabSel
    || (comps.find(c => c.favorite) || comps.find(c => isNrlaComp(c)) || comps[0]).id;
  if (!comps.some(c => c.id === selId)) selId = comps[0].id;
  const sel = comps.find(c => c.id === selId);
  if (sel.id !== 'mystery_box' && getActiveCompId() !== sel.id) state._indicatorActiveCompId = sel.id;
  // (Comp switcher pill bar retired — per Isaac; the landing page's
  // dropdown is the one place to pick a competition. Admins star the
  // default there too.)
  // ── Mystery Boxes: its own tab — rep boxes + admin arming panel ──
  if (sel.id === 'mystery_box') {
    const _mb = mysteryBoxSection(isAdmin);
    if (_mb) wrap.append(_mb);
    else wrap.append(el('div', { class: 'card p-10 text-center' },
      el('div', { class: 'text-3xl mb-2' }, '🎁'),
      el('div', { class: 'text-sm font-bold' }, 'No Mystery Box for you… yet.'),
      el('div', { class: 'text-xs mt-1', style: { color: 'var(--text-muted)' } }, 'Keep selling — boxes get armed for big performances, and when one\u2019s yours it shows up right here.')));
    return wrap;
  }
  // ── New 2026 comps (Genesis / PR Week / UNKNWN / Team Week): rules and
  // scoring aren't built yet — show the window and a plain revenue board
  // for it so the data is verifiable (per Isaac; looks live in Cam's app).
  if (COMP_2026_NEW.some(([id]) => id === sel.id)) {
    const win = (typeof compScheduleStore === 'function' ? compScheduleStore()[sel.id] : null) || {};
    const from = win.start || (COMP_2026_WINDOWS[sel.id] || [])[0] || '', to = win.end || (COMP_2026_WINDOWS[sel.id] || [])[1] || '';
    const inWin = (raw || []).filter(s => { const iso = (typeof dateSoldToIso === 'function') ? dateSoldToIso(s.dateSold) : ''; return iso && iso >= from && iso <= to && frPendingServiced(s) && _indicatorDeptOf(s) === 'd2d'; });
    const byRep = new Map();
    for (const s of inWin) { const n = getCanonicalRepName(s.rep); const r = byRep.get(n) || { name: n, office: s.office || '', n: 0, rev: 0 }; r.n++; r.rev += Number(s.contractValue) || 0; byRep.set(n, r); }
    const rows = [...byRep.values()].sort((a, b) => b.rev - a.rev);
    wrap.append(el('div', { class: 'card p-3 flex items-center gap-3 flex-wrap' },
      el('span', { class: 'text-[10px] uppercase tracking-widest font-bold', style: { color: 'var(--text-subtle)' } }, 'Comp Window'),
      el('span', { class: 'text-[11px] font-bold tabular-nums' }, (from || '\u2014') + ' \u2192 ' + (to || '\u2014')),
      el('span', { class: 'text-[11px] ml-auto', style: { color: 'var(--text-muted)' } }, 'Rules + scoring for ' + sel.name + ' aren\u2019t built yet \u2014 this is the raw Pending/Serviced revenue board for the window.' + (isAdmin ? ' Edit the window in Settings \u2192 Competitions.' : ''))));
    wrap.append(el('div', { class: 'card overflow-hidden' }, el('table', { class: 'w-full text-sm' },
      el('thead', {}, el('tr', {}, el('th', { class: 'px-3 py-2 text-left' }, '#'), el('th', { class: 'px-3 py-2 text-left' }, 'Rep'), el('th', { class: 'px-3 py-2 text-left' }, 'Office'), el('th', { class: 'px-3 py-2 text-right' }, 'Accounts'), el('th', { class: 'px-3 py-2 text-right' }, 'Revenue'))),
      el('tbody', {}, ...(rows.length ? rows.map((r, i) => el('tr', {}, el('td', { class: 'px-3 py-2' }, String(i + 1)), el('td', { class: 'px-3 py-2 font-semibold' }, r.name), el('td', { class: 'px-3 py-2' }, r.office), el('td', { class: 'px-3 py-2 text-right tabular-nums' }, String(r.n)), el('td', { class: 'px-3 py-2 text-right tabular-nums font-bold' }, fmt.usd0(r.rev))))
        : [el('tr', {}, el('td', { colspan: '5', class: 'px-3 py-6 text-center', style: { color: 'var(--text-muted)' } }, 'No sales in this window yet.'))])))));
    return wrap;
  }
  // ── \ud83d\udc51 King of the Hill: biggest single day of the season ──
  if (sel.id === 'koth') {
    const _kothCfg = (_cXtra.koth && typeof _cXtra.koth === 'object') ? _cXtra.koth : (_cXtra.koth = {});
    wrap.append(kothSection(raw, _kothCfg, isAdmin));
    return wrap;
  }
  // ── \ud83d\udc0d Kobe Week: beat your own best week ──
  if (sel.id === 'kobe_week') {
    // Comp window is year-to-year configurable (per Isaac) — stored on the
    // comp config; defaults to the 2026 flyer window (Aug 3–8).
    if (typeof sel.kobeFrom !== 'string') sel.kobeFrom = KOBE_FROM;
    if (typeof sel.kobeTo !== 'string') sel.kobeTo = KOBE_TO;
    const saveKobe = (detail) => {
      // sel is a virtual pill rebuilt every render — persist the window in
      // the synced _compExtras map so it survives.
      _cXtra[sel.id] = { ..._cXtra[sel.id], kobeFrom: sel.kobeFrom, kobeTo: sel.kobeTo };
      logActivity('comp_change', { detail: 'Kobe Week: ' + detail });
      saveDemoData();
      if (typeof saveIndicatorState === 'function') saveIndicatorState();
      mountApp();
    };
    const kIn = (key, what) => el('input', {
      type: 'date', value: sel[key] || '',
      class: 'rounded border px-1.5 py-1 text-xs',
      style: { borderColor: 'var(--border-2)', background: 'var(--card)', color: 'var(--text)' },
      onchange: (e) => { sel[key] = e.target.value; saveKobe(what + ' → ' + (e.target.value || 'unset')); },
    });
    // 🗓 Year lookback (per Isaac, just for fun): pick a year to see every
    // rep's best week of that year instead of the live comp board.
    const _kYears = [...new Set((raw || []).map(s => ((typeof dateSoldToIso === 'function' ? dateSoldToIso(s.dateSold) : '') || '').slice(0, 4)).filter(y => /^\d{4}$/.test(y)))].sort().reverse();
    const _kSelYr = state._kobeYear || '';
    wrap.append(el('div', { class: 'card p-2.5 flex items-center gap-2 flex-wrap', style: { borderLeft: '3px solid var(--text)' } },
      el('span', { class: 'text-[10px] uppercase tracking-widest font-bold', style: { color: 'var(--text-subtle)' } }, 'Comp Window'),
      ...(isAdmin
        ? [kIn('kobeFrom', 'start'), el('span', { class: 'text-muted-' }, '→'), kIn('kobeTo', 'end')]
        : [el('span', { class: 'text-[11px] font-bold tabular-nums' }, (sel.kobeFrom || '—') + ' → ' + (sel.kobeTo || '—'))]),
      el('select', {
        class: 'rounded-lg border px-2.5 py-1 text-[11px] font-bold cursor-pointer',
        style: { borderColor: 'var(--border-2)', background: 'var(--card)', color: 'var(--text)' },
        title: 'Look back at every rep\u2019s best week of a given year',
        onchange: (e) => { state._kobeYear = e.target.value; mountApp(); },
      },
        // Plain YEARS only (per Isaac): the comp year is the live board,
        // any other year is the lookback.
        el('option', { value: '', selected: !_kSelYr }, (sel.kobeFrom || KOBE_FROM).slice(0, 4)),
        ..._kYears.filter(y => y !== (sel.kobeFrom || KOBE_FROM).slice(0, 4)).map(y => el('option', { value: y, selected: _kSelYr === y }, y))),
      isAdmin ? el('button', {
        class: 'rounded-lg px-2.5 py-1 text-[11px] font-bold cursor-pointer transition hover:brightness-95 border ml-auto',
        style: { borderColor: 'var(--border-2)', color: 'var(--text)' },
        title: 'PDF: every active rep\u2019s best Sun\u2013Sat week of the season (the number they have to beat), biggest first',
        onclick: () => {
          const _reps = kobeWeekCompute(raw, sel.kobeFrom || KOBE_FROM, sel.kobeTo || KOBE_TO)
            .filter(r => (typeof isRepActive !== 'function') || isRepActive(r.name));
          downloadKobeBestWeeksPdf(_reps, sel.kobeFrom || KOBE_FROM, sel.kobeTo || KOBE_TO);
        },
      }, '\u2b07 Best Weeks') : null,
      isAdmin ? el('button', {
        class: 'text-[10px] font-black uppercase px-2.5 py-1 rounded-lg border cursor-pointer transition hover:brightness-95',
        style: { borderColor: '#B91C1C', color: '#B91C1C', background: 'transparent', whiteSpace: 'nowrap' },
        title: 'Reset the comp window — dates clear until you set new ones, which then stick until the next reset',
        onclick: () => {
          if (!confirm('Reset the Kobe Week comp window? Dates clear until you set new ones.')) return;
          sel.kobeFrom = '';
          sel.kobeTo = '';
          delete sel.final;   // new season = new snapshot
          if (_cXtra[sel.id]) delete _cXtra[sel.id].final;
          saveKobe('comp window RESET (dates cleared)');
        },
      }, '\u21ba Reset') : null));
    if (_kSelYr) {
      const yReps = kobeWeekCompute(raw, (Number(_kSelYr) + 1) + '-01-01', (Number(_kSelYr) + 1) + '-01-02', _kSelYr)
        .sort((a, b) => b.bestRev - a.bestRev);
      wrap.append(el('div', { class: 'card overflow-hidden' },
        el('div', { class: 'px-4 py-2.5 flex items-center justify-between', style: { background: '#111', color: '#fff' } },
          el('div', { class: 'font-black uppercase tracking-widest text-sm' }, '\ud83d\udc0d Best Weeks \u00b7 ' + _kSelYr),
          el('div', { class: 'text-[10px] font-bold uppercase tracking-widest', style: { opacity: '.6' } }, yReps.length + ' reps')),
        yReps.length ? el('div', { class: 'overflow-x-auto' }, el('table', { class: 'w-full text-sm' },
          el('thead', {}, el('tr', { class: 'text-left text-[10px] uppercase tracking-widest text-muted-' },
            el('th', { class: 'px-3 py-2 w-10' }, '#'),
            el('th', { class: 'px-3 py-2' }, 'Rep'),
            el('th', { class: 'px-3 py-2' }, 'Best Week'),
            el('th', { class: 'px-3 py-2 text-right' }, 'Revenue'))),
          el('tbody', {}, ...yReps.map((r, i) => {
            const d = new Date(r.bestWk + 'T00:00');
            const lbl = isNaN(d) ? (r.bestWk || '\u2014') : 'wk of ' + (d.getMonth() + 1) + '/' + d.getDate() + '/' + String(d.getFullYear()).slice(-2);
            return el('tr', { class: 'border-t', style: { borderColor: 'var(--border)' } },
              el('td', { class: 'px-3 py-2 font-black tabular-nums', style: { color: i < 3 ? '#E0402A' : 'var(--text-muted)' } }, String(i + 1)),
              el('td', { class: 'px-3 py-2 font-semibold whitespace-nowrap' }, r.name),
              el('td', { class: 'px-3 py-2 whitespace-nowrap text-muted-' }, lbl),
              el('td', { class: 'px-3 py-2 text-right tabular-nums font-bold' }, fmt.usd0(r.bestRev)));
          }))))
        : el('div', { class: 'p-8 text-center text-sm', style: { color: 'var(--text-muted)' } }, 'No qualifying weeks in ' + _kSelYr + '.')));
      return wrap;
    }
    if (sel.kobeFrom && sel.kobeTo) {
      // AUTO-FREEZE (per Isaac): once the window closes and every counted
      // account's audit has settled, the final board snapshots into the
      // synced extras and renders from there.
      let _kFinal = (sel.final && Array.isArray(sel.final.reps) && sel.final.reps.length) ? sel.final.reps : null;   // an EMPTY frozen board is a bad freeze — ignore it and compute live
      if (!_kFinal && isAdmin && new Date().toISOString().slice(0, 10) > sel.kobeTo) {
        const _pendK = (raw || []).filter(s => {
          if (typeof _indicatorDeptOf === 'function' && _indicatorDeptOf(s) !== 'd2d') return false;
          if (typeof frPendingServiced === 'function' && !frPendingServiced(s)) return false;
          if ((Number(s.initialPrice) || 0) < 99) return false;
          const fl = s.customerFlags || '';
          if (typeof SC_FAIL_RE !== 'undefined' && SC_FAIL_RE.test(fl)) return false;
          const iso = (typeof dateSoldToIso === 'function') ? dateSoldToIso(s.dateSold) : '';
          return iso && iso >= sel.kobeFrom && iso <= sel.kobeTo && typeof scAuditPassed === 'function' && !scAuditPassed(fl);
        }).length;
        if (_pendK === 0) {
          try {
            const _repsK = kobeWeekCompute(raw, sel.kobeFrom, sel.kobeTo);
            if (!_repsK.length) throw new Error('empty board — nothing to freeze');
            sel.final = { at: new Date().toISOString(), reps: JSON.parse(JSON.stringify(_repsK)) };
            _cXtra[sel.id] = { ..._cXtra[sel.id], final: sel.final };
            logActivity('comp_change', { detail: 'Kobe Week: final board AUTO-frozen (window over, audits settled)' });
            saveDemoData();
            if (typeof saveIndicatorState === 'function') saveIndicatorState();
            _kFinal = sel.final.reps;
          } catch (e) { /* freeze next render */ }
        }
      }
      wrap.append(kobeWeekSection(raw, sel.kobeFrom, sel.kobeTo, _kFinal));
    }
    else wrap.append(el('div', { class: 'card p-8 text-center text-sm', style: { color: 'var(--text-muted)' } },
      'Set the comp window dates above to run Kobe Week.'));
    return wrap;
  }
  // ── NRLA gets its own board (runs on its own schedule — no window bar) ──
  if (isNrlaComp(sel)) {
    wrap.append(nrlaBoard(raw, { readOnly: !isAdmin, comp: sel }));
    return wrap;
  }
  // ── Last Man Standing runs on SCHEDULED DAYS — no user-adjustable window.
  // Reps see the schedule read-only; admins can add/remove days (synced to
  // everyone via the shared comp config, same as ★ default). ──
  if (isLastManStandingComp(sel)) {
    // ── SEASON AUTO-RESET (per Isaac): once a champion is crowned AND the
    // final comp day has passed, the season archives itself (champion,
    // days, rounds, field size) and the board resets for EVERYONE — no
    // stale test dates lingering. First admin load after season end does
    // the write, same pattern as the ISL auto-freeze.
    if (isAdmin && Array.isArray(sel.compDays) && sel.compDays.length) {
      const _daysAll = [...sel.compDays].sort();
      const _todayIso0 = new Date().toISOString().slice(0, 10);
      if (_daysAll.every(d => d < _todayIso0)) {
        const _pre = lastManStandingCompute(raw, sel);
        if (_pre.champion) {
          sel.lmsPastSeasons = [...(Array.isArray(sel.lmsPastSeasons) ? sel.lmsPastSeasons : []), {
            champion: _pre.champion,
            days: _daysAll,
            rounds: (_pre.rounds || []).length,
            started: _pre.rosterSize,
            endedAt: new Date().toISOString(),
          }];
          sel.compDays = [];
          logActivity('comp_change', { detail: 'Last Man Standing: season COMPLETE \u2014 ' + _pre.champion + ' crowned \u00b7 board auto-reset (season archived)' });
          saveDemoData();
          if (typeof saveIndicatorState === 'function') saveIndicatorState();
        }
      }
    }
    const lmsR = lastManStandingCompute(raw, sel);
    const custom = Array.isArray(sel.compDays) ? [...sel.compDays].sort() : null;   // [] = cleared season (zero days)
    const effectiveDays = custom || lmsR.saturdays;
    const fmtDay = (iso) => new Date(iso + 'T12:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    const saveDays = (days) => {
      if (days) sel.compDays = [...new Set(days)].sort(); else delete sel.compDays;
      logActivity('comp_change', { detail: 'Last Man Standing comp days ' + (days ? (sel.compDays.length ? 'set to ' + sel.compDays.join(', ') : 'CLEARED (zero days)') : 'reset to auto (Saturdays)') });
      saveDemoData();   // syncs to every user
      mountApp();
    };
    // ── Admin controls: + Add day · Generate Season… · Clear all ──
    // Generate Season builds the whole Saturday list from a start date + a
    // round count (sized to how many reps are competing — halving each week,
    // ⌈log₂(reps)⌉ + 1 rounds cuts the field to one winner). Add/remove
    // individual days for holiday swaps; Clear all resets for a new year.
    // Season building, simplified (per Isaac): "+ Add days" on an empty
    // season seeds the next 5 Saturdays; "+" appends one more Saturday
    // after the last scheduled day. Chips stay click-to-move / ×-to-drop
    // for holiday swaps. (The old Generate Season prompt flow is retired.)
    const nextSaturday = (afterIso) => {
      const d = afterIso ? new Date(afterIso + 'T12:00') : new Date();
      d.setDate(d.getDate() + (((6 - d.getDay()) + 7) % 7 || 7));
      return d.toISOString().slice(0, 10);
    };
    // "+ Add days" (per Isaac): pick the FIRST comp day yourself, then the
    // next 4 recurring Saturdays fill in automatically — 5 rounds total.
    const addInput = (isAdmin && effectiveDays.length === 0) ? (() => {
      const seedInp = el('input', {
        type: 'date',
        style: { width: '0', height: '0', opacity: '0', position: 'absolute', pointerEvents: 'none' },
        onchange: (e) => {
          const first = e.target.value;
          if (!first) return;
          const days = [first];
          let iso = first;
          for (let i = 0; i < 4; i++) { iso = nextSaturday(iso); days.push(iso); }
          saveDays(days);
        },
      });
      return el('span', { style: { position: 'relative' } }, el('button', {
        class: 'text-[11px] font-bold px-2.5 py-1 rounded-lg border cursor-pointer transition hover:brightness-95',
        style: { borderColor: 'var(--accent)', color: 'var(--accent)' },
        title: 'Start the season — pick the first comp day, and the next 4 recurring Saturdays are added automatically. Click any chip to move its date; use + for more.',
        onclick: () => { try { seedInp.showPicker ? seedInp.showPicker() : seedInp.click(); } catch { seedInp.click(); } },
      }, '+ Add days'), seedInp);
    })() : null;
    const genBtn = (isAdmin && effectiveDays.length > 0) ? el('button', {
      class: 'text-[11px] font-black px-2.5 py-1 rounded-lg border cursor-pointer transition hover:brightness-95',
      style: { borderColor: 'var(--accent)', color: 'var(--accent)' },
      title: 'Add the next Saturday after ' + fmtDay(effectiveDays[effectiveDays.length - 1]),
      onclick: () => saveDays([...effectiveDays, nextSaturday(effectiveDays[effectiveDays.length - 1])]),
    }, '+') : null;
    // ↺ Reset — same treatment as Spring Cleaning (per Isaac): clears the
    // ENTIRE season; new days entered afterward stick until the next reset.
    const clearBtn = isAdmin ? el('button', {
      class: 'text-[10px] font-black uppercase px-2.5 py-1 rounded-lg border cursor-pointer transition hover:brightness-95 ml-auto',
      style: { borderColor: '#B91C1C', color: '#B91C1C', background: 'transparent', whiteSpace: 'nowrap' },
      title: 'Reset the competition — ALL comp days clear and the board goes empty until you add days or generate a season',
      onclick: () => { if (confirm('Reset Last Man Standing? All comp days clear and the board goes empty until you add days or generate a season.')) saveDays([]); },
    }, '\u21ba Reset') : null;
    // ⏳/📸 board controls land in this span (filled by lastManStandingBoard).
    const _lmsBarCtl = el('span', { class: 'inline-flex items-center gap-2' });
    wrap.append(el('div', { class: 'card p-2.5 flex items-center gap-2 flex-wrap', style: { borderLeft: '3px solid var(--text)' } },
      el('span', { class: 'text-[10px] uppercase tracking-widest font-bold', style: { color: 'var(--text-subtle)' } }, 'Comp Window'),
      // Every chip is EDITABLE (admin): click it to move that round to a
      // different date — e.g. swap the July 4 Saturday to Friday July 3.
      // × removes the day entirely. Works in auto mode too (first edit
      // converts the schedule to an explicit list).
      ...effectiveDays.map(iso => {
        const dateInp = isAdmin ? el('input', {
          type: 'date', value: iso,
          style: { width: '0', height: '0', opacity: '0', position: 'absolute', pointerEvents: 'none' },
          onchange: (e) => {
            const v = e.target.value;
            if (!v || v === iso) return;
            saveDays(effectiveDays.map(d => (d === iso ? v : d)));
          },
        }) : null;
        return el('span', {
          class: 'text-[11px] font-bold rounded-full px-2.5 py-1 border inline-flex items-center gap-1.5 whitespace-nowrap' + (isAdmin ? ' cursor-pointer transition hover:brightness-95' : ''),
          style: { borderColor: 'var(--border-2)', color: 'var(--text)', position: 'relative' },
          title: isAdmin ? 'Click to move this comp day to a different date' : undefined,
          onclick: isAdmin ? () => { try { dateInp.showPicker ? dateInp.showPicker() : dateInp.click(); } catch { dateInp.click(); } } : undefined,
        }, fmtDay(iso), dateInp,
          isAdmin ? el('button', {
            class: 'leading-none cursor-pointer', style: { color: 'var(--text-subtle)' },
            title: 'Remove this comp day',
            onclick: (e) => { e.stopPropagation(); saveDays(effectiveDays.filter(d => d !== iso)); },
          }, '×') : null);
      }),
      // 🏆 After an auto-reset, the previous champion stays celebrated here
      // until the next season starts.
      (!effectiveDays.length && Array.isArray(sel.lmsPastSeasons) && sel.lmsPastSeasons.length) ? (() => {
        const _last = sel.lmsPastSeasons[sel.lmsPastSeasons.length - 1];
        const _dRange = (Array.isArray(_last.days) && _last.days.length)
          ? ' \u00b7 ' + _last.days[0] + ' \u2192 ' + _last.days[_last.days.length - 1] : '';
        return el('button', {
          class: 'text-[11px] font-bold whitespace-nowrap' + (isAdmin ? ' cursor-pointer' : ''),
          style: { background: 'transparent', border: 'none', color: 'var(--text)', padding: '0' },
          title: 'Archived automatically when the season ended' + _dRange
            + (isAdmin ? ' \u2014 wrong result (test dates)? Click to DELETE this archived season' : ''),
          onclick: isAdmin ? () => {
            if (!confirm('Delete this archived season (' + String(_last.champion || '') + _dRange + ')? Do this when a TEST season archived the wrong champion \u2014 the real season re-archives itself once its dates are in and finished.')) return;
            sel.lmsPastSeasons = sel.lmsPastSeasons.slice(0, -1);
            logActivity('comp_change', { detail: 'Last Man Standing: archived season DELETED (' + String(_last.champion || '') + _dRange + ')' });
            saveDemoData();
            mountApp();
          } : undefined,
        }, '\ud83c\udfc6 Last champion: ' + String(_last.champion || '') + _dRange);
      })() : null,
      addInput, genBtn, clearBtn,
      _lmsBarCtl,
      el('button', {
        class: 'rounded-full flex items-center justify-center font-black cursor-pointer transition hover:brightness-95 border',
        style: { width: '26px', height: '26px', borderColor: 'var(--border-2)', color: 'var(--text)', fontSize: '13px', flexShrink: '0' },
        title: 'Last Man Standing rules',
        onclick: () => openLastManStandingHelpModal('scheduled comp days'),
      }, 'ⓘ')));
    wrap.append(lastManStandingBoard(raw, 'scheduled comp days', sel, _lmsBarCtl));
    return wrap;
  }
  // ── Other comps use the session Comp Window date range, same as before ──
  const cf = state._indicatorCompFilter || (state._indicatorCompFilter = { start: '', end: '' });
  const applyWin = () => { const sx = window.scrollX, sy = window.scrollY; setTimeout(() => { mountApp(); requestAnimationFrame(() => window.scrollTo(sx, sy)); }, 0); };
  const dateInput = (key) => el('input', {
    type: 'date', value: cf[key] || '',
    class: 'rounded border px-2.5 py-1 text-[11px]',
    style: { borderColor: 'var(--border-2)', background: 'var(--card)', color: 'var(--text)' },
    onchange: (e) => { cf[key] = e.target.value; applyWin(); },
  });
  // Spring Cleaning: separate comp-window dates were redundant with the
  // round dates (per Isaac) — the bar hosts the R1–R4 pickers instead, and
  // the effective window derives first-set → last-set date.
  const _scSel = isSpringCleaningComp(sel) ? sel : null;
  if (_scSel && (!Array.isArray(_scSel.rounds) || _scSel.rounds.length === 0)) {
    _scSel.rounds = SPRING_DEFAULT_ROUNDS.map(r => ({ ...r }));
  }
  // Reps see the round dates read-only (rep-UX audit #3) — their edits only
  // ever landed in their own localStorage and silently re-scoped their board.
  const _scRoundInput = (r, key, i) => isAdmin ? el('input', {
    type: 'date', value: r[key] || '',
    class: 'rounded border',
    style: { borderColor: 'var(--border-2)', background: 'var(--card)', color: 'var(--text)', fontSize: '10px', padding: '1px 2px', width: '106px' },
    onchange: (e) => { r[key] = e.target.value; logActivity('comp_change', { detail: 'Spring round ' + (i + 1) + ' ' + key + ' → ' + r[key] }); saveDemoData(); applyWin(); },
  }) : el('span', { class: 'text-[11px] font-bold tabular-nums' }, r[key] || '\u2014');
  const _scAllDates = _scSel ? _scSel.rounds.flatMap(r => [r.start, r.end]).filter(Boolean).sort() : [];
  const compWinBar = el('div', { class: 'card p-2.5 flex items-center gap-2 flex-wrap', style: { borderLeft: '3px solid var(--text)' } },
    el('span', { class: 'text-[10px] uppercase tracking-widest font-bold', style: { color: 'var(--text-subtle)' } }, 'Comp Window'),
    ...(_scSel
      ? [
          ..._scSel.rounds.map((r, i) => el('span', { class: 'flex items-center gap-1' },
            el('span', { class: 'text-[10px] font-black', style: { color: 'var(--text-subtle)' } }, 'R' + (i + 1)),
            _scRoundInput(r, 'start', i), el('span', { class: 'text-muted-' }, '–'), _scRoundInput(r, 'end', i))),
        ]
      : [dateInput('start'), el('span', { class: 'text-muted-' }, '→'), dateInput('end'),
          el('span', { class: 'text-[11px] ml-1', style: { color: 'var(--text-muted)' } }, '· date range for this competition')]));
  wrap.append(compWinBar);
  const bounds = _scSel
    ? (_scAllDates.length ? { s: new Date(_scAllDates[0] + 'T00:00'), e: new Date(_scAllDates[_scAllDates.length - 1] + 'T23:59') } : null)
    : ((cf.start && cf.end) ? { s: new Date(cf.start + 'T00:00'), e: new Date(cf.end + 'T23:59') } : null);
  const windowed = bounds
    ? raw.filter(s => { const d = _parseIndicatorDay(s); return d && d >= bounds.s && d <= bounds.e; })
    : raw;
  const winLabel = _scSel
    ? (_scAllDates.length ? _scAllDates[0] + ' → ' + _scAllDates[_scAllDates.length - 1] : 'all dates')
    : ((cf.start && cf.end) ? cf.start + ' → ' + cf.end : 'all dates');
  if (isSpringCleaningComp(sel)) {
    const offices = [...new Set(windowed.filter(s => _indicatorDeptOf(s) === 'd2d').map(s => s.office).filter(Boolean))];
    // Spring Cleaning controls ride the Comp Window bar (per Isaac):
    // Standings PDF · Reps export · 👥 rep markets · rules ⓘ.
    compWinBar.append(el('div', { class: 'ml-auto flex items-center gap-2' },
      // ⬇ standings PDF — icon only (per Isaac). ↓ Reps export retired; the
      // 🏢 competing-offices toggles moved INTO the 👥 modal.
      el('button', {
        class: 'cursor-pointer transition hover:brightness-95 rounded-full',
        style: { width: '26px', height: '26px', background: '#9C3F1E', color: '#fff', display: 'grid', placeItems: 'center', fontSize: '13px', lineHeight: '1', padding: '0', border: 'none' },
        title: 'Download the standings poster as a PDF',
        onclick: () => {
          const node = document.getElementById('spring-standings-poster');
          if (node) exportSpringStandingsPdf(node);
          else toast('Standings section not found', 'error');
        },
      }, '\u2b07'),
      isAdmin ? el('button', {
        class: 'cursor-pointer transition hover:brightness-95 border rounded-full',
        style: { width: '26px', height: '26px', borderColor: 'var(--border-2)', background: 'var(--card)', display: 'grid', placeItems: 'center', fontSize: '13px', lineHeight: '1', padding: '0' },
        title: 'Reps & offices — who competes, which market each rep counts toward, and which offices are in the comp',
        onclick: () => openSpringRepMarketModal(windowed, offices),
      }, '👥') : null,
      isAdmin ? el('button', {
        class: 'text-[10px] font-black uppercase px-2.5 py-1 rounded-lg border cursor-pointer transition hover:brightness-95',
        style: { borderColor: '#B91C1C', color: '#B91C1C', background: 'transparent', whiteSpace: 'nowrap' },
        title: 'Reset the ENTIRE competition — every round\u2019s dates clear and the board goes blank until new dates are entered',
        onclick: () => {
          if (!confirm('Reset Spring Cleaning? ALL round dates clear and the board goes blank. New dates you enter afterward stick until the next reset.')) return;
          sel.rounds = SPRING_DEFAULT_ROUNDS.map(() => ({ start: '', end: '' }));
          sel.scHistory = {};   // a reset starts a NEW season — old freezes go with it
          logActivity('comp_change', { detail: 'Spring Cleaning: competition RESET — all round dates cleared' });
          saveDemoData();
          mountApp();
        },
      }, '\u21ba Reset') : null,
      el('button', {
        class: 'rounded-full flex items-center justify-center font-black cursor-pointer transition hover:brightness-95 border',
        style: { width: '26px', height: '26px', borderColor: 'var(--border-2)', color: 'var(--text)', fontSize: '13px' },
        title: 'How each metric is tracked',
        onclick: () => openSpringCleaningHelpModal(),
      }, 'ⓘ')));
    wrap.append(indicatorSpringCleaningBoard(windowed, offices, winLabel));
    if (typeof springStandingsCard === 'function') wrap.append(el('div', { class: 'overflow-x-auto' }, springStandingsCard()));
  } else if ((sel.scoring || '') === 'top_gun') {
    const allD2d = raw.filter(s => _indicatorDeptOf(s) === 'd2d');
    const yr = new Date().getFullYear();
    const yearD2d = allD2d.filter(s => { const d = _parseIndicatorDay(s); return d && d.getFullYear() === yr; });
    const proSet = topGunProSet(yearD2d);
    const windowedD2d = bounds
      ? allD2d.filter(s => { const d = _parseIndicatorDay(s); return d && d >= bounds.s && d <= bounds.e; })
      : allD2d;
    // Top Gun controls ride the Comp Window bar (per Isaac): Export ·
    // Reset, with the rules ⓘ to the right of both.
    compWinBar.append(el('div', { class: 'ml-auto flex items-center gap-2' },
      el('button', {
        class: 'rounded-lg px-2.5 py-1 text-[11px] font-bold cursor-pointer transition hover:brightness-95 border',
        style: { borderColor: 'var(--border-2)', color: 'var(--text)' },
        title: 'Export Top Gun (Standings + all accounts by class)',
        onclick: () => exportTopGunXlsx(windowedD2d, proSet),
      }, '↓ Export'),
      isAdmin ? el('button', {
        class: 'text-[10px] font-black uppercase px-2.5 py-1 rounded-lg border cursor-pointer transition hover:brightness-95',
        style: { borderColor: '#B91C1C', color: '#B91C1C', whiteSpace: 'nowrap' },
        title: 'Reset the competition window — dates clear (All dates) until you set new ones, which then stick until the next reset',
        onclick: () => {
          if (!confirm('Reset the Top Gun comp window? Dates clear to All dates until you set new ones.')) return;
          state._indicatorCompFilter = { start: '', end: '' };
          logActivity('comp_change', { detail: 'Top Gun: comp window RESET (all dates)' });
          saveDemoData();
          mountApp();
        },
      }, '\u21ba Reset') : null,
      el('button', {
        class: 'rounded-full flex items-center justify-center font-black cursor-pointer transition hover:brightness-95 border',
        style: { width: '26px', height: '26px', borderColor: 'var(--border-2)', color: 'var(--text)', fontSize: '13px' },
        title: 'Top Gun rules',
        onclick: () => openTopGunHelpModal(),
      }, 'ⓘ')));
    wrap.append(indicatorTopGunBoard(windowedD2d, proSet));
  } else if ((sel.scoring || '') === 'avg_pest_initial' || sel.id === 'avg_pest_initial') {
    // Avg Pest & Raffle — the SAME card Indicators renders, right here.
    // Base data mirrors the indicators pipeline: FR Pending/Serviced gate,
    // D2D rows only. The card manages its own comp window via `cf`.
    const _apAll = raw.filter(s => frPendingServiced(s) && _indicatorDeptOf(s) === 'd2d');
    const _apWin = bounds
      ? _apAll.filter(s => { const d = _parseIndicatorDay(s); return d && d >= bounds.s && d <= bounds.e; })
      : _apAll;
    // Rules ⓘ rides the Comp Window bar (per Isaac) — moved off the
    // green banner.
    compWinBar.append(el('button', {
      class: 'ml-auto rounded-full flex items-center justify-center font-black cursor-pointer transition hover:brightness-95 border',
      style: { width: '26px', height: '26px', borderColor: 'var(--border-2)', color: 'var(--text)', fontSize: '13px', flexShrink: '0' },
      title: 'Competition rules',
      onclick: () => openAvgPestRaffleHelpModal(),
    }, 'ⓘ'));
    wrap.append(buildAvgPestCompCard({
      cf, allRawSales: _apAll, rawSales: _apWin, windowLabel: winLabel,
      applyExclusion: false, rerender: () => mountApp(),
    }));
  } else {
    wrap.append(el('div', { class: 'card p-8 text-center text-sm', style: { color: 'var(--text-muted)' } },
      '“' + sel.name + '” doesn\'t have a board built yet.'));
  }
  return wrap;
}




function springCleaningReason(s) {
  if ((Number(s.initialPrice) || 0) < 99) return 'Last Resort (<$99 initial)';
  if (!frPendingServiced(s)) return 'Not Pending/Serviced in the CRM (no appointment, no-show, canceled initial, or globally excluded service)';
  if (springServicedStatus(s) === 'late') return 'Not serviced by deadline';
  if (SC_FAIL_RE.test(s.customerFlags || '')) return 'Failed audit';
  if (!scAuditPassed(s.customerFlags)) return 'Awaiting audit';
  return '';
}
function springCleaningCounts(s) {
  return springCleaningStatus(s) === 'counting';
}

// Spring Cleaning scoreboard card — golf-scored branch standings for the
// currently date-filtered window, plus an excluded-revenue summary.
// Spring Cleaning competition export — 5 sheets (Standings / Passed Audit /
// Pending Audit / Failed Audit / Last Resort). Self-contained so the board's
// own export button can call it with the same windowed sales it displays.
async function exportSpringCleaningXlsx(sales, branchList, winLabel) {
  try { await loadXlsxLibOnce(); } catch { toast('Could not load Excel library — check your connection', 'error'); return; }
  const XLSX = window.XLSX;
  if (!XLSX) { toast('Excel library missing after load', 'error'); return; }
  const numOrBlank0 = (v) => { const n = Number(v); return Number.isFinite(n) ? n : ''; };
  const sc = springCleaningCompute(sales, branchList);

  const st = [];
  st.push(['Spring Cleaning — Standings']);
  st.push(['Scope', (winLabel || 'current window') + ' · Door-to-Door only']);
  st.push(['Note', 'Standings include passed-audit + pending (assumed passing). Excluded = Failed Audit + Last Resort (<$99).']);
  st.push(['Pulled', new Date().toLocaleString()]);
  st.push([]);
  st.push(['Branch', 'Reps', 'Accounts', 'Revenue', 'Avg Pest Init', 'PRA', 'ACV', '24+ Mo %', 'Autopay %', 'Audit %', 'Total Pts', 'Place', 'Bugs']);
  sc.ranked.forEach(m => st.push([
    m.office, m.reps, m.n, Math.round(m.revenue), +m.avgPestInitial.toFixed(2), Math.round(m.pra),
    +m.acv.toFixed(2), +(m.pct24 * 100).toFixed(1), +(m.autopayPct * 100).toFixed(1), +(m.auditPct * 100).toFixed(1), m.totalPoints, m.place, m.bugs,
  ]));
  st.push([]);
  st.push(['EXCLUDED (not counting)']);
  st.push(['Accounts excluded', sc.excludedSummary.count]);
  st.push(['Revenue excluded', Math.round(sc.excludedSummary.revenue)]);
  st.push(['— Last Resort (<$99)', sc.excludedSummary.lastResort]);
  st.push(['— Failed audit', sc.excludedSummary.failedAudit]);
  st.push([]);
  st.push(['PENDING (awaiting audit — still out there)']);
  st.push(['Accounts pending', sc.pendingSummary.count]);
  st.push(['Revenue pending', Math.round(sc.pendingSummary.revenue)]);

  const acctHeader = ['Rep', 'Office', 'Customer', 'Customer ID', 'Date Sold', 'Subscription', 'Source',
    'Initial Price', 'Contract Value', 'Contract Months', 'Auto Pay', 'Customer Flags'];
  const acctRow = (s) => [
    s.rep || '', s.office || '', s.customer || '', s.customerId || '', s.dateSold || '',
    s.subscription || '', s.source || '', numOrBlank0(s.initialPrice), numOrBlank0(s.contractValue),
    numOrBlank0(s.contract), s.autoPay || '', s.customerFlags || '',
  ];
  const counting = [acctHeader, ...sc.counting.map(acctRow)];
  const pending  = [acctHeader, ...sc.pending.map(acctRow)];
  const lastResortRows  = sc.excluded.filter(s => (Number(s.initialPrice) || 0) < 99);
  const failedAuditRows = sc.excluded.filter(s => (Number(s.initialPrice) || 0) >= 99);
  const failedAudit = [acctHeader, ...failedAuditRows.map(acctRow)];
  const lastResort  = [acctHeader, ...lastResortRows.map(acctRow)];

  const wbS = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wbS, XLSX.utils.aoa_to_sheet(st), 'Standings');
  XLSX.utils.book_append_sheet(wbS, XLSX.utils.aoa_to_sheet(counting), 'Passed Audit');
  XLSX.utils.book_append_sheet(wbS, XLSX.utils.aoa_to_sheet(pending), 'Pending Audit');
  XLSX.utils.book_append_sheet(wbS, XLSX.utils.aoa_to_sheet(failedAudit), 'Failed Audit');
  XLSX.utils.book_append_sheet(wbS, XLSX.utils.aoa_to_sheet(lastResort), 'Last Resort');
  XLSX.writeFile(wbS, 'RIDD-Spring-Cleaning-' + new Date().toISOString().slice(0, 10) + '.xlsx');
  toast('Exported Spring Cleaning — ' + sc.counting.length.toLocaleString() + ' counting, '
    + sc.pending.length.toLocaleString() + ' pending, ' + failedAuditRows.length.toLocaleString() + ' failed audit, '
    + lastResortRows.length.toLocaleString() + ' last resort', 'success');
}

// Rep payout list — for each ROUND, the reps who sold a qualifying (counting +
// pending) account, grouped BY BRANCH, with their account count + passed
// revenue. This is what the admin uses to split each round's winnings among the
// reps who actually produced for the branch.
async function exportSpringRepsXlsx() {
  try { await loadXlsxLibOnce(); } catch { toast('Could not load Excel library — check your connection', 'error'); return; }
  const XLSX = window.XLSX;
  if (!XLSX) { toast('Excel library missing after load', 'error'); return; }
  const comp = (typeof getActiveComp === 'function') ? getActiveComp() : null;
  const rounds = (comp && Array.isArray(comp.rounds) && comp.rounds.length) ? comp.rounds : SPRING_DEFAULT_ROUNDS;
  const d2dAll = (typeof indicatorSales === 'function' ? indicatorSales() : []).filter(s => _indicatorDeptOf(s) === 'd2d');
  const branchList = [...new Set(d2dAll.map(s => s.office).filter(Boolean))];

  // ONE cumulative sheet across all 4 rounds — one row per rep/branch, totals
  // summed over the whole competition. Only reps who sold a QUALIFIED (counting
  // /pending) account at least once during the comp are listed (a rep whose
  // every account failed audit or never serviced is left off — there's nothing
  // to pay out). Columns split their footprint so you can see context:
  //   • Qualifying Accts = all real-production sales (≥$99, not Sold-Not-Started),
  //     including failed-audit / not-serviced-by-deadline accounts.
  //   • Counting Accts   = the subset that actually scored (counting + pending).
  //   • Passed Rev       = revenue from those counting/pending accounts.
  const byKey = new Map();
  const ensure = (b, rep) => {
    const key = b + '||' + rep;
    if (!byKey.has(key)) byKey.set(key, { branch: b, rep, total: 0, qual: 0, counting: 0, rev: 0 });
    return byKey.get(key);
  };
  rounds.forEach((r) => {
    const roundSales = d2dAll.filter(s => {
      const d = _parseIndicatorDay(s); if (!d || isNaN(d)) return false;
      const iso = d.toISOString().slice(0, 10);
      return iso >= r.start && iso <= r.end;
    });
    const sc = springCleaningCompute(roundSales, branchList);     // applies branch exclusions + rep market overrides
    // Total = every pending/serviced account (real production, NOT Sold-Not-
    // Started), regardless of audit flag or Last Resort — i.e. counting + pending
    // + excluded (SNS is already dropped upstream, so it never lands here).
    for (const s of [...sc.counting, ...sc.pending, ...sc.excluded]) ensure(s.office || 'UNKNOWN', s.rep || 'Unknown').total += 1;
    // Qualifying = real production (≥$99, not SNS): counting/pending PLUS failed-
    // audit / not-serviced-by-deadline. Counting = the scored subset.
    for (const s of [...sc.counting, ...sc.pending]) { const e = ensure(s.office || 'UNKNOWN', s.rep || 'Unknown'); e.qual += 1; e.counting += 1; e.rev += Number(s.contractValue) || 0; }
    for (const s of sc.excluded) { if ((Number(s.initialPrice) || 0) >= 99) ensure(s.office || 'UNKNOWN', s.rep || 'Unknown').qual += 1; }
  });

  const rows = [['Branch', 'Rep', 'Total Accts', 'Qualifying Accts', 'Counting Accts', 'Passed Rev']];
  const entries = [...byKey.values()]
    .filter(e => e.total > 0)   // any rep who sold a D2D account during the comp — surfaces zero-qualifying reps
    .sort((a, b) => a.branch.localeCompare(b.branch) || b.rev - a.rev || b.total - a.total || a.rep.localeCompare(b.rep));
  entries.forEach(e => rows.push([e.branch, e.rep, e.total, e.qual, e.counting, Math.round(e.rev)]));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Reps');
  XLSX.writeFile(wb, 'RIDD-Spring-Cleaning-Reps-' + new Date().toISOString().slice(0, 10) + '.xlsx');
  toast('Exported ' + entries.length + ' reps (cumulative, 4 rounds)', 'success');
}

// Breakdown popup explaining how each Spring Cleaning metric + rule works.
// 🪳 STANDINGS POSTER — live replica of the printed Spring Cleaning
// standings sheet. Round date boxes sit beside the header title; Export
// PDF + Reset-dates at the top. Rounds AUTO-LOCK: a round is final when
// its date range is over AND no pending-audit accounts remain in the
// window — at that point nothing can move the numbers, so its bugs turn
// green (official). Bugs from rounds still in play (in progress, or
// finished with audits outstanding) are red; unearned slots stay black.
const SPRING_DEFAULT_ROUNDS = [
  { start: '2026-06-08', end: '2026-06-10' },
  { start: '2026-06-11', end: '2026-06-13' },
  { start: '2026-06-15', end: '2026-06-17' },
  { start: '2026-06-18', end: '2026-06-20' },
];
function springStandingsCard() {
  // Inline section — sits on the Spring Cleaning tab directly under the
  // live board. Export happens from the board's "↓ Standings" button.
  const comp = (typeof getActiveComp === 'function') ? getActiveComp() : null;
  if (!comp) return null;
  if (!Array.isArray(comp.rounds) || comp.rounds.length === 0) {
    comp.rounds = SPRING_DEFAULT_ROUNDS.map(r => ({ ...r }));
  }
  const card = el('div', { id: 'spring-standings-poster', class: 'rounded-2xl overflow-hidden', style: { background: '#dddcd4', color: '#323230' } });

  const ABBREV = { CHARLESTON: 'CHS', DETROIT: 'DET', RALEIGH: 'RAL', DESTIN: 'DES', ATLANTA: 'ATL' };
  const abbrev = (b) => {
    const u = String(b).toUpperCase();
    if (ABBREV[u]) return ABBREV[u];
    const words = u.split(/\s+/);
    return words.length > 1 ? words.map(w => w[0]).join('') : u.slice(0, 3);
  };
  const tc = (s) => (s || '').split(' ').map(w => w[0] + w.slice(1).toLowerCase()).join(' ');
  const ordinal = (n) => n + (n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th');

  const render = () => {
    card.innerHTML = '';
    const todayIso = new Date().toISOString().slice(0, 10);
    const allSales = (typeof indicatorSales === 'function' ? indicatorSales() : []);
    const d2dAll = allSales.filter(s => _indicatorDeptOf(s) === 'd2d');
    const masterBranches = [...new Set(d2dAll.map(s => s.office).filter(Boolean))];

    // Per-round results. AUTO-LOCK: final = window over + zero pending
    // audits left in the window (nothing can move the standings anymore).
    // FROZEN ROUNDS (per Isaac): the moment a round turns OFFICIAL (window
    // over + zero pending audits) its full standings freeze into the comp
    // config automatically — later CRM mutations (upsells changing contract
    // values) can't rewrite history. Frozen rounds render from the snapshot.
    comp.scHistory = (comp.scHistory && typeof comp.scHistory === 'object') ? comp.scHistory : {};
    const rounds = comp.rounds.map((r, _ri) => {
      const snap = comp.scHistory[_ri];
      if (snap && snap.sc) {
        return { ...r, sc: snap.sc, ranked: snap.sc.ranked || [], hasData: true, finished: true, pendingN: 0, official: true, frozen: true };
      }
      const roundSales = d2dAll.filter(s => {
        const d = _parseIndicatorDay(s);
        if (!d) return false;
        const iso = d.toISOString().slice(0, 10);
        return iso >= r.start && iso <= r.end;
      });
      const sc = roundSales.length > 0 ? springCleaningCompute(roundSales, masterBranches) : null;
      const finished = !!r.end && r.end < todayIso;
      const pendingN = sc ? sc.pending.length : 0;
      return {
        ...r, sc,
        ranked: sc ? sc.ranked : [],
        hasData: roundSales.length > 0,
        finished,
        pendingN,
        official: finished && roundSales.length > 0 && pendingN === 0,
      };
    });
    // First admin render after a round goes official does the freeze.
    if (typeof isAdminRole === 'function' && isAdminRole(state.profile && state.profile?.role)) {
      let _froze = 0;
      rounds.forEach((r, i) => {
        if (r.official && !r.frozen && r.sc && !comp.scHistory[i]) {
          try {
            comp.scHistory[i] = { at: new Date().toISOString(), sc: JSON.parse(JSON.stringify(r.sc)) };
            _froze++;
          } catch (e) { /* non-serializable — keep computing live */ }
        }
      });
      if (_froze) {
        logActivity('comp_change', { detail: 'Spring Cleaning: ' + _froze + ' official round(s) AUTO-frozen (window over, audits settled)' });
        saveDemoData();
      }
    }

    // Branch order + bug tallies: green = official rounds, red = rounds
    // still in play (live, or finished with audits pending).
    const branchSet = new Set();
    rounds.forEach(r => r.ranked.forEach(m => branchSet.add(m.office)));
    const exB = (comp.excludedBranches || []).map(x => String(x).toUpperCase());
    masterBranches.forEach(b => { if (!exB.includes(String(b).toUpperCase())) branchSet.add(b); });
    // dead = bugs from FINISHED rounds (red, flipped — exterminated) ·
    // live = bugs from the round still in progress (black, red outline).
    const deadBugs = {}, liveBugs = {};
    [...branchSet].forEach(b => { deadBugs[b] = 0; liveBugs[b] = 0; });
    rounds.forEach(r => {
      if (!r.hasData) return;
      r.ranked.forEach(m => {
        if (r.finished) deadBugs[m.office] = (deadBugs[m.office] || 0) + (m.bugs || 0);
        else liveBugs[m.office] = (liveBugs[m.office] || 0) + (m.bugs || 0);
      });
    });
    const cum = (b) => (deadBugs[b] || 0) + (liveBugs[b] || 0);
    const branches = [...branchSet].sort((a, b) => cum(b) - cum(a) || a.localeCompare(b));

    // (Round date pickers moved to the shared Comp Window bar — per Isaac,
    // the separate comp-window dates were redundant with the round dates.)

    // ── Header — title left, round boxes to its right. Sized for the
    //    full-width inline card (the poster used to live in an 880px
    //    modal; at page width the old sizes looked tiny). ──
    const header = el('div', { style: { padding: '30px 36px 18px', minHeight: '120px', display: 'flex', alignItems: 'center', gap: '18px', flexWrap: 'nowrap' } },
      el('img', { src: 'sweeper.png', alt: '', style: { height: '84px', filter: 'grayscale(1)', flex: 'none' } }),
      el('div', { style: { flex: 'none', minWidth: '0' } },
        el('div', { style: { fontWeight: '900', fontSize: '52px', letterSpacing: '-0.03em', lineHeight: '0.95', textTransform: 'uppercase', whiteSpace: 'nowrap' } }, 'Spring Cleaning'),
        el('div', { style: { fontWeight: '800', fontSize: '13px', letterSpacing: '0.05em', textTransform: 'uppercase', marginTop: '6px', whiteSpace: 'nowrap' } }, 'Team Quality Based Competition by RIDDMADE™')));

    // (↺ Reset dates moved to the shared Comp Window bar — per Isaac.)

    // ── Info boxes ──
    const CATS_LIST = ['Revenue', 'Average Pest Initial', 'Per Rep Average', 'Average Contract Value', '24 Month Agreement %', 'Autopay %', 'Passed Audit %'];
    const PAYOUT = [['1st Place', 6], ['2nd Place', 5], ['3rd Place', 4], ['4th Place', 3], ['5th Place', 2], ['6th Place', 1], ['7th Place', 0]];
    const TIERS = [[24, '®300k', '#9C3F1E'], [20, '®200k', '#DF643A'], [16, '®100k', '#FF8A5C'], [12, '®50k', '#FFB899']];
    // Compact info row (per Isaac): categories + per-round payout share ONE
    // box (orange | red halves), tiers slim on the right — shorter banners
    // pull the bug tracker and round tables up the page.
    const infoRow = el('div', { style: { display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: '8px', padding: '2px 30px 8px' } },
      el('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', overflow: 'hidden' } },
        el('div', { style: { background: '#F7941D', color: '#323230', padding: '8px 12px' } },
          el('div', { style: { fontSize: '10px', fontWeight: '900', textTransform: 'uppercase', letterSpacing: '.06em', borderBottom: '2px solid rgba(20,20,20,.35)', paddingBottom: '2px', marginBottom: '3px' } }, '7 Categories'),
          ...CATS_LIST.map((c, i) => el('div', { style: { fontSize: '9.5px', fontWeight: '800', lineHeight: '1.5', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, (i + 1) + '. ' + c))),
        el('div', { style: { background: '#ED1C24', color: '#fff', padding: '8px 12px' } },
          el('div', { style: { fontSize: '10px', fontWeight: '900', textTransform: 'uppercase', letterSpacing: '.06em', borderBottom: '2px solid rgba(255,255,255,.5)', paddingBottom: '2px', marginBottom: '3px' } }, 'Per Round'),
          ...PAYOUT.map(([p, n]) => el('div', { style: { fontSize: '9.5px', fontWeight: '800', lineHeight: '1.5', whiteSpace: 'nowrap' } }, p + '\u2026 ' + n + ' Bug' + (n === 1 ? '' : 's'))))),
      el('div', { style: { display: 'flex', flexDirection: 'column', gap: '3px' } },
        ...TIERS.map(([n, coin, color]) => el('div', { style: { background: color, color: n >= 20 ? '#fff' : '#323230', fontSize: '9.5px', fontWeight: '900', padding: '4px 10px', whiteSpace: 'nowrap', flex: '1', display: 'flex', alignItems: 'center' } },
          n + ' Bugs Exterminated = ' + coin + ' per rep'))));

    // ── BUG COUNT tracker — every slot has a spider ──
    const MILESTONES = { 12: ['12', '@50K', '#FFB899', '#323230'], 16: ['16', '@100K', '#FF8A5C', '#323230'], 20: ['20', '@200K', '#DF643A', '#fff'], 24: ['24', '@300K', '#9C3F1E', '#fff'] };
    const SLOTS = 24;
    // SVG spiders (not emoji) — emoji rasterize as broken glyphs in the
    // PDF export; SVG paints identically on screen and in html2canvas.
    // Poster-style: small head + 8 legs (4 per side). Three states:
    //   dead — red + flipped (round finished, exterminated)
    //   live — black with a red outline (current round, still moving)
    //   black — not earned yet
    // Artwork is vertically centered in the viewBox so flipped and
    // upright spiders sit on the SAME baseline.
    const SPIDER_LEGS = 'M10 11 C7 9 5 6.8 4.2 4.2 M11 10.4 C9.4 8 8.6 6 8.2 3.8 M13 10.4 C14.6 8 15.4 6 15.8 3.8 M14 11 C17 9 19 6.8 19.8 4.2 M9.5 12.6 C6.4 12 3.8 11.8 1.9 12.4 M14.5 12.6 C17.6 12 20.2 11.8 22.1 12.4 M9.9 14.6 C7 15.8 5 17.2 3.7 19.5 M14.1 14.6 C17 15.8 19 17.2 20.3 19.5';
    const bugCell = (kind, slot) => {
      const ms = MILESTONES[slot];
      const dead = kind === 'dead';
      const fill = dead ? '#ED1C24' : '#323230';
      const legC = dead ? '#ED1C24' : '#323230';
      const outline = kind === 'live' ? ' stroke="#ED1C24" stroke-width="1.4"' : '';
      const cell = el('div', { style: {
        width: '100%', aspectRatio: '1', display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: ms ? ms[2] : 'transparent',
      } });
      cell.innerHTML = '<svg viewBox="0 0 24 24" style="width:86%;height:86%;display:block'
        + (dead ? ';transform:rotate(180deg)' : '') + '">'
        + '<path d="' + SPIDER_LEGS + '" stroke="' + legC + '" stroke-width="1.6" fill="none" stroke-linecap="round"/>'
        + '<ellipse cx="12" cy="13.4" rx="3.4" ry="4.3" fill="' + fill + '"' + outline + '/>'
        + '<circle cx="12" cy="7.6" r="2.1" fill="' + fill + '"' + outline + '/>'
        + '</svg>';
      return cell;
    };
    const tracker = el('div', { style: { margin: '6px 30px 14px', background: '#9d9d97', padding: '14px 16px 16px' } },
      el('div', { style: { display: 'grid', gridTemplateColumns: '120px repeat(' + SLOTS + ', 1fr)', gap: '2px', alignItems: 'center' } },
        el('div', { style: { fontSize: '18px', fontWeight: '900', textTransform: 'uppercase', color: '#323230' } }, 'Bug Count'),
        ...Array.from({ length: SLOTS }, (_, i) => {
          const ms = MILESTONES[i + 1];
          return el('div', { style: { textAlign: 'center', fontSize: '8px', fontWeight: '900', color: ms ? ms[3] : 'transparent', background: ms ? ms[2] : 'transparent', padding: '2px 0' } },
            ms ? el('div', {}, el('div', { style: { fontSize: '11px' } }, ms[0]), el('div', {}, ms[1])) : '·');
        }),
        ...branches.flatMap(b => {
          const d = Math.min(deadBugs[b] || 0, SLOTS);
          const l = Math.min(liveBugs[b] || 0, SLOTS - d);
          return [
            el('div', { style: { fontSize: '11px', fontWeight: '800', textTransform: 'uppercase', color: '#323230', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', paddingRight: '4px' } }, b),
            ...Array.from({ length: SLOTS }, (_, i) =>
              bugCell(i < d ? 'dead' : i < d + l ? 'live' : 'black', i + 1)),
          ];
        })),
      el('div', { style: { display: 'flex', gap: '14px', marginTop: '8px', fontSize: '9px', fontWeight: '800', color: '#323230' } },
        el('span', { style: { color: '#ED1C24' } }, '● flipped red — past rounds (exterminated)'),
        el('span', { style: { color: '#323230' } }, '◉ black + red outline — live round'),
        el('span', { style: { color: '#323230' } }, '● black — not earned yet')));

    // ── Round tables ──
    const CAT_COLS = [['avgPestInitial', 'Avg Pest Init'], ['pra', 'PRA'], ['acv', 'ACV'], ['pct24', '24M %'], ['autopayPct', 'Apay %'], ['auditPct', 'Audit %'], ['revenue', 'Passed Rev']];
    // Formatters for the actual metric values (shown alongside each rank).
    const _usd  = (v) => '$' + Math.round(Number(v) || 0).toLocaleString();
    const _usd2 = (v) => '$' + (Number(v) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const _pct  = (v) => ((Number(v) || 0) * 100).toFixed(1) + '%';
    const CAT_FMT = { revenue: _usd, avgPestInitial: _usd2, pra: _usd, acv: _usd, pct24: _pct, autopayPct: _pct, auditPct: _pct };
    const dayOrd = (iso) => { const d = new Date(iso + 'T00:00'); return d.toLocaleDateString('en-US', { month: 'long' }) + ' ' + ordinal(d.getDate()); };
    const roundLabel = (r) => {
      const a = new Date(r.start + 'T00:00'), b = new Date(r.end + 'T00:00');
      return a.getMonth() === b.getMonth() ? dayOrd(r.start) + ' - ' + ordinal(b.getDate()) : dayOrd(r.start) + ' - ' + dayOrd(r.end);
    };
    const roundBlock = (r, idx) => {
      const byOffice = {};
      r.ranked.forEach(m => byOffice[m.office] = m);
      // Rows ordered by THIS round's finishing place (1st on top); branches
      // with no data in the round sink to the bottom alphabetically.
      const order = [...branches].sort((a, b) => {
        const pa = byOffice[a]?.place ?? 999, pb = byOffice[b]?.place ?? 999;
        return pa - pb || a.localeCompare(b);
      });
      const rowFor = (b) => {
        const m = byOffice[b];
        return el('tr', {},
          el('td', { style: { padding: '3px 8px 3px 0', fontSize: '11.5px', fontWeight: '600', whiteSpace: 'nowrap', position: 'sticky', left: '0', zIndex: 1, background: '#dddcd4' } }, tc(b)),
          el('td', { style: { padding: '3px 10px 3px 6px', fontSize: '11.5px', textAlign: 'left', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', fontWeight: '700' } }, m ? m.reps : '—'),
          ...CAT_COLS.map(([k]) => el('td', { style: { padding: '3px 10px 3px 6px', fontSize: '11.5px', textAlign: 'left', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' } },
            m ? el('span', {},
                  el('span', { style: { fontWeight: '700' } }, CAT_FMT[k](m[k])),
                  el('span', { style: { color: '#777', marginLeft: '5px', fontSize: '10px', fontWeight: '800' } }, '(' + (m.places[k] || 0) + ')'))
              : '—')),
          el('td', { style: { padding: '3px 10px 3px 6px', fontSize: '11.5px', textAlign: 'left', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', color: '#666' } }, m ? _usd(m.totalRevenue) : '—'),
          el('td', { style: { padding: '3px 10px 3px 6px', fontSize: '11.5px', textAlign: 'left', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', fontWeight: '700', color: '#b03030' } }, m ? _usd(m.failedRevenue) : '—'),
          el('td', { style: { padding: '3px 10px 3px 6px', fontSize: '11.5px', textAlign: 'left', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', fontWeight: '700', color: '#9a7d0a' } }, m ? _usd(m.pendingRevenue) : '—'));
      };
      const rankRow = (b) => {
        const m = byOffice[b];
        // Fixed grid columns so the points stack in one clean vertical
        // line regardless of how wide the branch abbreviation is.
        return el('div', { style: { display: 'grid', gridTemplateColumns: '36px 1fr 30px', gap: '8px', fontSize: '11px', lineHeight: '1.7', alignItems: 'baseline' } },
          el('span', { style: { fontWeight: '900', color: '#fff' } }, abbrev(b)),
          el('span', { style: { fontWeight: '800', color: '#fff', fontVariantNumeric: 'tabular-nums', textAlign: 'right' } }, m ? m.totalPoints : 0),
          el('span', { style: { fontWeight: '900', color: m && m.place === 1 ? '#FFB899' : '#e8e8e2', textAlign: 'right' } }, m ? ordinal(m.place) : ''));
      };
      const bugRow = (b) => {
        const m = byOffice[b];
        return el('div', { style: { fontSize: '11px', fontWeight: '800', lineHeight: '1.7', whiteSpace: 'nowrap' } }, (m ? m.bugs : 0) + ' Bugs');
      };
      const status = r.official
        ? el('span', { style: { fontSize: '9px', fontWeight: '900', color: '#fff', background: '#DF643A', padding: '2px 8px', borderRadius: '0', textTransform: 'uppercase' } }, '🔒 Official — audits settled')
        : r.hasData && r.finished
          ? el('span', { style: { fontSize: '9px', fontWeight: '900', color: '#fff', background: '#ED1C24', padding: '2px 8px', borderRadius: '0', textTransform: 'uppercase', cursor: r.pendingN ? 'pointer' : 'default' },
              title: r.pendingN ? 'Click to see the pending accounts' : '',
              onclick: r.pendingN ? () => openSpringPendingModal(idx + 1, roundLabel(r), r.sc ? r.sc.pending : []) : null },
              r.pendingN + ' audit' + (r.pendingN === 1 ? '' : 's') + ' pending')
          : r.hasData
            ? el('span', { style: { fontSize: '9px', fontWeight: '900', color: '#323230', background: '#FFB899', padding: '2px 8px', borderRadius: '0', textTransform: 'uppercase' } }, 'Live')
            : null;
      return el('div', { style: { padding: '6px 30px 14px' } },
        el('div', { style: { display: 'flex', alignItems: 'center', gap: '12px' } },
          el('div', {},
            el('div', { style: { fontSize: '17px', fontWeight: '900', textTransform: 'uppercase' } }, 'Round ' + (idx + 1)),
            el('div', { style: { fontSize: '10px', fontWeight: '700', color: '#555' } }, roundLabel(r))),
          status),
        el('div', { style: { display: 'flex', gap: '14px', alignItems: 'flex-start', marginTop: '4px' } },
          el('table', { style: { borderCollapse: 'collapse', flex: '1' } },
            el('thead', {}, el('tr', {},
              el('th', { style: { width: '120px', minWidth: '120px', maxWidth: '120px', boxSizing: 'border-box', position: 'sticky', left: '0', zIndex: 2, background: '#dddcd4' } }, ''),
              el('th', { style: { padding: '3px 10px 3px 6px', fontSize: '10.5px', fontWeight: '800', textAlign: 'left', whiteSpace: 'nowrap', borderBottom: '2px solid #323230' } }, 'Reps'),
              ...CAT_COLS.map(([, lab]) => el('th', { style: { padding: '3px 10px 3px 6px', fontSize: '10.5px', fontWeight: '800', textAlign: 'left', whiteSpace: 'nowrap', borderBottom: '2px solid #323230' } }, lab)),
              el('th', { style: { padding: '3px 10px 3px 6px', fontSize: '10.5px', fontWeight: '800', textAlign: 'left', whiteSpace: 'nowrap', borderBottom: '2px solid #323230', color: '#666' } }, 'Total Rev'),
              el('th', { style: { padding: '3px 10px 3px 6px', fontSize: '10.5px', fontWeight: '800', textAlign: 'left', whiteSpace: 'nowrap', borderBottom: '2px solid #323230', color: '#b03030' } }, 'Failed Rev'),
              el('th', { style: { padding: '3px 10px 3px 6px', fontSize: '10.5px', fontWeight: '800', textAlign: 'left', whiteSpace: 'nowrap', borderBottom: '2px solid #323230', color: '#9a7d0a' } }, 'Pending Rev'))),
            el('tbody', {}, ...order.map(rowFor))),
          el('div', { style: { background: '#9d9d97', padding: '8px 12px', minWidth: '150px', marginTop: '21px' } },
            el('div', { style: { fontSize: '10.5px', fontWeight: '900', color: '#323230', marginBottom: '4px', whiteSpace: 'nowrap' } }, 'Rd ' + (idx + 1) + ' Power Rank'),
            ...order.map(rankRow)),
          el('div', { style: { background: '#b9b9b3', padding: '8px 12px', minWidth: '86px', marginTop: '21px' } },
            el('div', { style: { fontSize: '10.5px', fontWeight: '900', color: '#323230', marginBottom: '4px', whiteSpace: 'nowrap' } }, 'Bug Count'),
            ...order.map(bugRow))));
    };

    // ── Round picker (per Isaac): ONE round at a time, NRLA-style —
    // pills select the round, defaulting to the latest round with data.
    if (state._scRoundSel == null || state._scRoundSel >= rounds.length) {
      let _d = 0;
      rounds.forEach((r, i) => { if (r.hasData) _d = i; });
      state._scRoundSel = _d;
    }
    const roundPicker = el('div', { class: 'sc-noprint', style: { display: 'flex', gap: '6px', alignItems: 'center', padding: '2px 30px 8px', flexWrap: 'wrap' } },
      ...rounds.map((r, i) => el('button', {
        class: 'cursor-pointer transition hover:brightness-95',
        style: {
          fontSize: '10px', fontWeight: '900', textTransform: 'uppercase', padding: '4px 12px', borderRadius: '0',
          background: i === state._scRoundSel ? '#323230' : 'transparent',
          color: i === state._scRoundSel ? '#fff' : '#323230',
          border: '1px solid #323230', whiteSpace: 'nowrap',
        },
        title: (r.start && r.end) ? roundLabel(r) : 'No dates set yet',
        onclick: () => { state._scRoundSel = i; render(); },
      }, 'Round ' + (i + 1) + (r.official ? ' \ud83d\udd12' : (r.hasData && !r.finished) ? ' \u00b7 live' : ''))));
    card.append(header, infoRow, tracker, roundPicker, roundBlock(rounds[state._scRoundSel], state._scRoundSel),
      el('div', { style: { padding: '10px 30px 22px', display: 'flex', alignItems: 'center', gap: '8px' } },
        el('img', { src: 'sweeper.png', alt: '', style: { height: '26px', filter: 'grayscale(1)' } }),
        el('div', {},
          el('div', { style: { fontSize: '10px', fontWeight: '900', textTransform: 'uppercase' } }, 'Spring Cleaning'),
          el('div', { style: { fontSize: '8px', color: '#777' } }, 'RIDDMADE · RIDD PEST'))));
  };
  render();
  return card;
}

// Export the standings poster as a single-page PDF sized to the poster
// itself. Control buttons (date editors, export) are excluded.
async function exportSpringStandingsPdf(card) {
  try { await loadPdfLibsOnce(); } catch { toast('Could not load PDF libraries — check your connection', 'error'); return; }
  const prevMax = card.style.maxHeight, prevOv = card.style.overflowY;
  card.style.maxHeight = 'none'; card.style.overflowY = 'visible';
  try {
    await new Promise(r => requestAnimationFrame(() => r()));
    const canvas = await html2canvas(card, {
      scale: 2, backgroundColor: '#dddcd4', logging: false, useCORS: true,
      ignoreElements: (n) => n.classList && n.classList.contains('sc-noprint'),
    });
    const { jsPDF } = window.jspdf;
    const w = canvas.width / 2, h = canvas.height / 2;
    const pdf = new jsPDF({ unit: 'pt', format: [w * 0.75, h * 0.75], orientation: w > h ? 'l' : 'p' });
    pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, w * 0.75, h * 0.75);
    pdf.save('Spring-Cleaning-Standings-' + new Date().toISOString().slice(0, 10) + '.pdf');
    toast('Standings PDF downloaded', 'success');
  } catch (e) {
    console.warn('[ridd] standings pdf failed', e);
    toast('PDF export failed — try again', 'error');
  } finally {
    card.style.maxHeight = prevMax; card.style.overflowY = prevOv;
  }
}

// 👥 Reps modal — every D2D rep in the current window with the market
// they're counting toward. Pick a different branch to reassign a rep for
// COMP PURPOSES ONLY (stored on the competition as repBranchOverrides;
// nothing changes about their real sales data).
function openSpringRepMarketModal(sales, officeList) {
  const comp = (typeof getActiveComp === 'function') ? getActiveComp() : null;
  if (!comp) { toast('No active competition', 'error'); return; }
  if (!comp.repBranchOverrides || typeof comp.repBranchOverrides !== 'object') comp.repBranchOverrides = {};
  const overlay = el('div', { class: 'modal-overlay' });
  const close = () => { overlay.remove(); mountApp(); };
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  const card = el('div', { class: 'card w-full max-w-xl my-8 overflow-hidden flex flex-col', style: { maxHeight: 'calc(100vh - 64px)' } });
  overlay.append(card);

  // D2D reps in the window + their HOME market (where most of their sales
  // actually landed — that's where they'd count without an override).
  const d2d = (sales || []).filter(s => _indicatorDeptOf(s) === 'd2d' && s.rep);
  const byRep = new Map();
  for (const s of d2d) {
    const name = _cleanRepName(getCanonicalRepName(s.rep));
    let r = byRep.get(name);
    if (!r) { r = { counts: {}, n: 0 }; byRep.set(name, r); }
    const o = (s.office || 'UNKNOWN').toUpperCase();
    r.counts[o] = (r.counts[o] || 0) + 1;
    r.n++;
  }
  const homeOf = (r) => Object.entries(r.counts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'UNKNOWN';
  const branches = [...new Set([
    ...d2d.map(s => (s.office || '').toUpperCase()).filter(Boolean),
    ...Object.values(comp.repBranchOverrides).map(b => String(b).toUpperCase()),
  ])].sort();

  const render = () => {
    card.innerHTML = '';
    const q = (state._scRepSearch || '').trim().toLowerCase();
    const names = [...byRep.keys()].sort((a, b) => a.localeCompare(b)).filter(n => !q || n.toLowerCase().includes(q));
    const movedCount = Object.keys(comp.repBranchOverrides).length;
    const searchInput = el('input', {
      type: 'text', value: state._scRepSearch || '', placeholder: 'Search reps…',
      class: 'w-full rounded-lg border px-2.5 py-1 text-[11px]',
      style: { background: 'var(--card)', borderColor: 'var(--border)', color: 'var(--text)' },
    });
    searchInput.addEventListener('input', (e) => { state._scRepSearch = e.target.value; render(); setTimeout(() => { const el2 = card.querySelector('input'); if (el2) { el2.focus(); el2.setSelectionRange(el2.value.length, el2.value.length); } }, 0); });
    card.append(
      el('div', { class: 'flex items-center justify-between px-5 py-4 border-b gap-3', style: { borderColor: 'var(--border)' } },
        el('div', {},
          el('h2', { class: 'text-base font-bold' }, '👥 Comp Market Assignments'),
          el('div', { class: 'text-[11px] mt-0.5', style: { color: 'var(--text-muted)' } },
            byRep.size + ' D2D reps in window · ' + movedCount + ' reassigned · comp purposes only')),
        el('div', { class: 'flex items-center gap-2' },
          movedCount > 0 && el('button', {
            class: 'rounded-lg border px-2.5 py-1 text-[11px] font-bold cursor-pointer transition hover:brightness-95',
            style: { borderColor: '#DC2626', color: '#DC2626' },
            title: 'Send every reassigned rep back to their home market',
            onclick: () => {
              if (!confirm('Reset all ' + movedCount + ' reassigned reps back to their home markets?')) return;
              comp.repBranchOverrides = {};
              logActivity('comp_change', { detail: 'Spring Cleaning: all rep market reassignments reset' });
              saveDemoData();
              render();
            },
          }, '↺ Reset all'),
          el('button', { class: 'text-2xl leading-none', style: { color: 'var(--text-muted)' }, onclick: close }, '×'))),
      // 🏢 competing offices (merged in from the old separate modal — per
      // Isaac): green = in the comp, struck = sitting out. Synced.
      (() => {
        if (!Array.isArray(comp.excludedBranches)) comp.excludedBranches = ['SALT LAKE'];
        const _all = [...new Set([...(officeList || []).map(b => String(b).toUpperCase()), ...branches, ...comp.excludedBranches.map(b => String(b).toUpperCase())])].sort();
        const exSet = new Set(comp.excludedBranches.map(b => String(b).toUpperCase()));
        return el('div', { class: 'px-5 py-2 border-b flex items-center gap-1.5 flex-wrap', style: { borderColor: 'var(--border)' } },
          el('span', { class: 'text-[10px] uppercase tracking-widest font-bold shrink-0', style: { color: 'var(--text-subtle)' } }, 'Offices competing'),
          ..._all.map(b => {
            const off = exSet.has(b);
            return el('button', {
              class: 'rounded-full px-2.5 py-0.5 text-[11px] font-semibold cursor-pointer transition hover:brightness-95',
              style: off
                ? { background: 'transparent', color: 'var(--text-muted)', border: '1px dashed var(--border-2)', textDecoration: 'line-through' }
                : { background: '#9C3F1E', color: '#fff', border: '1px solid #9C3F1E' },
              title: off ? b + ' is sitting this comp out — click to include' : 'Click to pull ' + b + ' out of the comp',
              onclick: () => {
                comp.excludedBranches = off
                  ? comp.excludedBranches.filter(x => String(x).toUpperCase() !== b)
                  : [...comp.excludedBranches, b];
                logActivity('comp_change', { detail: 'Spring Cleaning: ' + b + (off ? ' back in the comp' : ' pulled from the comp') });
                saveDemoData();
                render();
              },
            }, b);
          }));
      })(),
      el('div', { class: 'px-5 py-3 border-b', style: { borderColor: 'var(--border)' } }, searchInput),
      el('div', { class: 'overflow-y-auto flex-1' },
        ...names.map(name => {
          const r = byRep.get(name);
          const home = homeOf(r);
          const ov = comp.repBranchOverrides[name] ? String(comp.repBranchOverrides[name]).toUpperCase() : '';
          const effective = ov || home;
          const sel = el('select', {
            class: 'rounded-lg px-2.5 py-1 text-[11px] font-semibold cursor-pointer',
            style: ov ? { border: '2px solid #9C3F1E', color: '#9C3F1E' } : {},
            onchange: (e) => {
              const v = e.target.value;
              if (!v || v === home) delete comp.repBranchOverrides[name];
              else comp.repBranchOverrides[name] = v;
              logActivity('comp_change', { rep_name: name, detail: (!v || v === home) ? name + ' back to home market ' + home : name + ' reassigned to ' + v + ' (comp)' });
              saveDemoData();
              render();
            },
          }, ...branches.map(b => { const o = el('option', { value: b }, b + (b === home ? ' (home)' : '')); if (b === effective) o.selected = true; return o; }));
          return el('div', { class: 'flex items-center justify-between gap-3 px-5 py-2 border-b', style: { borderColor: 'var(--border)' } },
            el('div', { class: 'min-w-0' },
              el('div', { class: 'text-sm font-semibold truncate' }, name,
                ov && el('span', { class: 'ml-2 text-[9px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded', style: { background: 'rgba(156,63,30,.12)', color: '#9C3F1E' } }, 'moved')),
              el('div', { class: 'text-[10px]', style: { color: 'var(--text-muted)' } },
                r.n + ' acct' + (r.n === 1 ? '' : 's') + ' · knocks ' + home)),
            sel);
        })),
      el('div', { class: 'px-5 py-3 text-[10px] border-t', style: { borderColor: 'var(--border)', color: 'var(--text-subtle)' } },
        'Reassignments move ALL of a rep\'s accounts (revenue, PRA, Audit %, every category) to the chosen branch on the Spring Cleaning board and its export. Pick the home market to undo. Synced to every admin.'));
  };
  render();
  document.body.append(overlay);
}

// Click-through from a round's red "N audits pending" pill — lists the exact
// accounts with no audit flag yet, so the admin can go flag them in FieldRoutes
// and settle the round. Replaces the old leaderboard export for that workflow.
function openSpringPendingModal(roundNum, roundLabelStr, pending) {
  const tc = (s) => String(s || '').split(' ').map(w => w ? w[0] + w.slice(1).toLowerCase() : w).join(' ');
  const list = (pending || []).slice().sort((a, b) =>
    String(a.office || '').localeCompare(String(b.office || '')) || String(a.rep || '').localeCompare(String(b.rep || '')));
  const overlay = el('div', { class: 'modal-overlay' });
  const close = () => { overlay.remove(); document.removeEventListener('keydown', key); };
  const key = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', key);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  const money = (n) => '$' + Math.round(Number(n) || 0).toLocaleString();
  const th = (t, right) => el('th', { class: 'text-[10px] uppercase tracking-wider font-semibold px-3 py-2 ' + (right ? 'text-right' : 'text-left'), style: { borderBottom: '1px solid var(--border)', color: 'var(--text-muted)', position: 'sticky', top: '0', background: 'var(--card)' } }, t);
  const td = (t, right) => el('td', { class: 'px-3 py-1.5 text-xs ' + (right ? 'text-right tabular-nums' : ''), style: { borderBottom: '1px solid var(--border)' } }, t);
  const card = el('div', { class: 'card w-full max-w-3xl my-8 overflow-hidden flex flex-col', style: { maxHeight: 'calc(100vh - 64px)' } },
    el('div', { class: 'flex items-start justify-between p-5 pb-3' },
      el('div', {},
        el('div', { class: 'text-[10px] uppercase tracking-widest font-semibold', style: { color: 'var(--text-subtle)' } }, 'Spring Cleaning · Round ' + roundNum + ' · ' + roundLabelStr),
        el('h2', { class: 'text-xl font-bold mt-0.5' }, list.length + ' pending audit' + (list.length === 1 ? '' : 's')),
        el('p', { class: 'text-xs text-muted- mt-1' }, 'Door-to-Door, ≥$99, no Passed / No Audit / Failed flag yet (counted as assumed-passing). Flag these in FieldRoutes to settle the round.')),
      el('button', { class: 'text-2xl leading-none px-2', style: { color: 'var(--text-muted)' }, onclick: close }, '×')),
    el('div', { class: 'overflow-auto px-5 pb-5', style: { borderTop: '1px solid var(--border)' } },
      list.length === 0
        ? el('div', { class: 'p-8 text-center text-sm text-muted-' }, 'No pending audits — this round is settled.')
        : el('table', { class: 'w-full' },
            el('thead', {}, el('tr', {}, th('Customer'), th('Cust #'), th('Rep'), th('Office'), th('Service'), th('Initial', true), th('Contract', true), th('Sold'))),
            el('tbody', {}, ...list.map(s => el('tr', {},
              td(s.customer || '—'),
              td(s.customerId || '—'),
              td(s.rep || '—'),
              td(tc(s.office)),
              td(s.subscription || '—'),
              td(money(s.initialPrice), true),
              td(money(s.contractValue), true),
              td(s.dateSold || '')))))));
  overlay.append(card);
  document.body.append(overlay);
}

function openSpringCleaningHelpModal() {
  const overlay = el('div', { class: 'modal-overlay' });
  const close = () => { overlay.remove(); document.removeEventListener('keydown', key); };
  const key = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', key);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  const section = (title, ...body) => el('div', { class: 'mb-3' },
    el('div', { class: 'text-[11px] uppercase tracking-widest font-bold mb-1', style: { color: 'var(--accent)' } }, title),
    el('div', { class: 'text-[13px] leading-relaxed', style: { color: 'var(--text-muted)' } }, ...body));
  const metric = (name, desc) => el('div', { class: 'mb-1.5' },
    el('span', { class: 'font-bold', style: { color: 'var(--text)' } }, name + ' — '),
    el('span', { style: { color: 'var(--text-muted)' } }, desc));

  const card = el('div', { class: 'card w-full max-w-2xl my-8 overflow-hidden flex flex-col', style: { maxHeight: 'calc(100vh - 64px)' } },
    el('div', { class: 'flex items-start justify-between p-5 pb-3' },
      el('div', {},
        el('div', { class: 'text-[10px] uppercase tracking-widest font-semibold', style: { color: 'var(--text-subtle)' } }, 'Spring Cleaning'),
        el('h2', { class: 'text-xl font-bold mt-0.5' }, 'Full competition rules'),
      ),
      el('button', { class: 'text-2xl leading-none', style: { color: 'var(--text-muted)' }, onclick: close }, '×'),
    ),
    el('div', { class: 'overflow-auto px-5 pb-5', style: { borderTop: '1px solid var(--border)' } },
      el('div', { class: 'pt-4' },
        section('Who competes',
          el('div', {}, 'The Sales Rep rep type only — Office Staff and Technicians are out entirely. Rep type comes from the Customer Report (Source is only a fallback for reps with no type on file). Branches can be sat out for the year via the "Competing" chips on the board.'),
          el('div', { class: 'mt-1' }, 'Set the round with the date filter at the top.')),
        section('Does an account count? (in order)',
          metric('1 · Initial ≥ $99', 'Under $99 = "Last Resort" — out of every category (but still shows in Audit %).'),
          metric('2 · Not a pre-service cancel', 'If the account cancelled before its initial service ever ran (any cancel reason), it\'s excluded from EVERY metric — revenue, PRA, Audit %, all of it. A pre-service cancel never needed an audit, so it isn\'t counted anywhere.'),
          metric('3 · Serviced by the deadline', 'Sold in a round, it must be serviced (initial service completed) by the end of the FOLLOWING week. Weeks run Sun–Sat — e.g. sold the week of Jun 8 → serviced by Sat Jun 20. Past the deadline unserviced, or serviced late → out. Before the deadline, an unserviced account is still in play.'),
          metric('4 · Audit flag', 'Passed Audit or No Audit → counts. Failed Audit → out. No flag yet = pending, counted as assumed-passing until it\'s flagged.')),
        section('The seven categories (per branch)',
          metric('Passed Rev', 'The SCORED revenue — counting revenue toward the comp (passed audit + no audit + pending). A separate "Total Rev" column shows everything sold except Sold-Not-Started (incl. Last Resort + Failed) so it reconciles to FieldRoutes, but Total isn\'t scored.'),
          metric('Avg Pest Init', 'Average initial price, excluding Sentricon / German Roach / Interior Flea services.'),
          metric('PRA', 'Per Rep Average = Revenue ÷ number of reps who sold that round. Last Resort sales leave no footprint here — they add no revenue and don\'t count a rep into the denominator.'),
          metric('ACV', 'Average Contract Value per account.'),
          metric('24+ Mo %', 'Share of accounts on a 24-month-or-longer agreement. One-time services are excluded from the denominator; everything else counts.'),
          metric('Autopay %', 'Share of accounts with a payment method on file.'),
          metric('Audit %', 'Passed + No Audit + pending ÷ ALL accounts (incl. failed audit & Last Resort). Scored like every other category — and it doubles as the points tiebreaker.')),
        section('Scoring',
          el('div', {}, 'In each category the branches are ranked; your place = your points (1st = 1pt … 7th = 7pts — golf, low is good).'),
          el('div', { class: 'mt-1' }, 'Your seven category points add up to a Total. Lowest total wins the round.'),
          el('div', { class: 'mt-1' }, 'Tiebreakers: a dead tie WITHIN a category means both teams take the same points and the next place is skipped (two teams at 100% AutoPay both score 1, the next team scores 3). A tie in TOTAL points goes to the higher Passed Audit %; if that\'s somehow tied too, higher Avg Pest Initial decides it.'),
          el('div', { class: 'mt-1' }, 'Place → Bugs: 1st = 6, 2nd = 5, 3rd = 4, 4th = 3, 5th = 2, 6th = 1, 7th = 0.')),
        section('Excluded entirely',
          el('div', {}, 'Four ways an account drops out of every category: Last Resort (initial < $99), pre-service cancel (cancelled before any service), not serviced by the deadline, and Failed Audit.'),
          el('div', { class: 'mt-1' }, 'The one exception is Audit %, where Last Resort and Failed Audit accounts still count by their actual flag. Click a round\'s red "audits pending" pill to see exactly which accounts still need a flag.')),
        section('Pending',
          el('div', {}, 'An account is "pending" when it clears every gate above but has no audit flag yet. Pending revenue counts toward standings (assumed-passing) until the flag lands — so the standings can still move as audits come in. A round locks as "Official" once its window is over and zero accounts are pending.')),
      ),
    ),
  );
  overlay.append(card);
  document.body.append(overlay);
}

// Rules popup for the Avg Pest Initial + Raffle competitions (both explanations
// consolidated into the ⓘ on the green banner).
function openAvgPestRaffleHelpModal() {
  const overlay = el('div', { class: 'modal-overlay' });
  const close = () => { overlay.remove(); document.removeEventListener('keydown', key); };
  const key = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', key);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  const block = (title, body) => el('div', { class: 'mb-4' },
    el('div', { class: 'text-[11px] uppercase tracking-widest font-bold mb-1', style: { color: '#A9441F' } }, title),
    el('div', { class: 'text-[13px] leading-relaxed', style: { color: 'var(--text-muted)' } }, body));

  const card = el('div', { class: 'card w-full max-w-lg my-8 overflow-hidden flex flex-col', style: { maxHeight: 'calc(100vh - 64px)' } },
    el('div', { class: 'flex items-start justify-between px-5 py-3', style: { background: '#DF643A' } },
      el('div', {},
        el('div', { class: 'text-[10px] uppercase tracking-widest font-semibold', style: { color: '#323230', opacity: '0.8' } }, 'By RIDDMADE™'),
        el('h2', { class: 'text-lg font-black mt-0.5', style: { color: '#323230', textTransform: 'uppercase' } }, 'Avg Pest Initial Competitions'),
      ),
      el('button', { class: 'text-2xl leading-none', style: { color: '#323230' }, onclick: close }, '×'),
    ),
    el('div', { class: 'overflow-auto px-5 py-4' },
      block('🏆 Avg Pest Initial', 'Every rep with 6+ qualifying accounts, ranked by Avg Initial. Sentricon / German Roach / Interior Flea services don\'t count toward the average. Post-service cancels still count once the initial ran.'),
      block('⏳ Serviced-by-Friday Rule', 'From the selected date range, an account only qualifies if it\'s been serviced by the FOLLOWING Friday after the range ends. Pending accounts that haven\'t been serviced yet don\'t count — so judge the comp (and export winners) after that Friday, on a fresh CSV upload.'),
      block('🎟️ Raffle Tickets', '$149–199 initial = 1 ticket · $200–249 = 2 tickets · $250+ = 3 tickets. Active accounts only. Sentricon / German Roach / Interior Flea are excluded. Spin the wheel to draw a winner, weighted by each rep\'s ticket count.'),
    ),
  );
  overlay.append(card);
  document.body.append(overlay);
}

// Last Man Standing rules popup — opened from the ⓘ on the poster header.
function openLastManStandingHelpModal(winLabel) {
  const RED = '#FF1F0E';
  const overlay = el('div', { class: 'modal-overlay' });
  const close = () => { overlay.remove(); document.removeEventListener('keydown', key); };
  const key = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', key);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  const section = (title, ...body) => el('div', { class: 'mb-3' },
    el('div', { class: 'text-[11px] uppercase tracking-widest font-bold mb-1', style: { color: RED } }, title),
    el('div', { class: 'text-[13px] leading-relaxed', style: { color: 'var(--text-muted)' } }, ...body));

  const card = el('div', { class: 'card w-full max-w-lg my-8 overflow-hidden flex flex-col', style: { maxHeight: 'calc(100vh - 64px)' } },
    el('div', { class: 'flex items-start justify-between px-5 py-3', style: { background: '#000' } },
      el('div', {},
        el('div', { class: 'text-[10px] uppercase tracking-widest font-semibold', style: { color: RED } }, 'RIDDMADE Competition Series'),
        el('h2', { class: 'text-lg font-black mt-0.5', style: { color: '#fff', textTransform: 'uppercase' } }, 'The Arena'),
      ),
      el('button', { class: 'text-2xl leading-none', style: { color: '#fff' }, onclick: close }, '×'),
    ),
    el('div', { class: 'overflow-auto px-5 py-4', style: { borderTop: '1px solid var(--border)' } },
      section('Who competes',
        el('div', {}, 'Door-to-Door reps only. Sales count only if made on a Saturday and the account qualifies: ≥$99 initial and not a Failed Audit. Passed, No-Audit, and still-pending accounts all count — pending is assumed passing so the bracket can run before audits land.')),
      section('Round 1 — the qualifier',
        el('div', {}, 'The first Saturday is a pure qualifier: every rep who lands a qualifying sale advances, no matter how small. Anyone with no qualifying sale that Saturday is out. Nobody is cut for being low in Round 1.')),
      section('Round 2 onward — the weekly cut',
        el('div', {}, 'Each following Saturday the survivors are ranked by that day\'s qualifying revenue and the top half advance (rounded up — odd fields round in the survivors\' favor). The bottom half is eliminated. Ties break on cumulative revenue across the competition. Once the field is down to THREE or fewer, that round is the FINAL: winner-take-all — the top qualifying revenue that day is the champion.')),
      section('Serviced by Friday',
        el('div', {}, 'For revenue to count toward a round, the account must be serviced by the Friday after it was sold — sell Saturday, service by the next Friday. That Friday is the cutoff, so when the new round opens that Saturday we can confirm exactly who advances. Accounts still unserviced, or serviced after that Friday, don\'t count — nobody can sandbag a future service date to pad a round.')),
      section('Winning',
        el('div', {}, 'The cut repeats every Saturday until one rep is left standing — the champion.')),
      section('Checking the receipts',
        el('div', {}, 'Click any rep — survivor card or eliminated chip — for their week-by-week production: qualified, total, pending, and failed revenue per round, plus a jump to their full player card.')),
      section('Window',
        el('div', {}, 'Competition dates: ' + (winLabel || 'all dates') + '. Adjust with the date filter at the top.')),
    ),
  );
  overlay.append(card);
  document.body.append(overlay);
}

// "Last sync: <time>" from the most recent Indicators sync — shown on
// each competition header. ("Last sync" verbiage everywhere, per Isaac.)
function indicatorLastUpdatedStr() {
  if (!state.indicatorsUploadedAt) return null;
  return 'Last sync: ' + new Date(state.indicatorsUploadedAt).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}
// Selected Comp Window as a readable date range, for display on every
// competition header (so it's captured in screenshots). Returns 'All dates'
// when no range is set.
function indicatorCompWindowStr() {
  const cf = state._indicatorCompFilter || {};
  const fmt = (iso) => new Date(iso + 'T00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  if (cf.start && cf.end) return fmt(cf.start) + ' – ' + fmt(cf.end);
  if (cf.start) return 'From ' + fmt(cf.start);
  if (cf.end) return 'Through ' + fmt(cf.end);
  return 'All dates';
}

// 🏢 Competing offices — the branch in/out toggles, moved off the board
// face into a modal opened from the Comp Window bar (per Isaac). Same
// persistence: comp.excludedBranches on the competition itself, synced.
function openSpringCompetingModal(branchList) {
  const comp = (typeof getActiveComp === 'function') ? getActiveComp() : null;
  if (!comp) { toast('No active Spring Cleaning config found', 'warn'); return; }
  if (!Array.isArray(comp.excludedBranches)) comp.excludedBranches = ['SALT LAKE'];
  const overlay = el('div', { class: 'fixed inset-0 bg-black/70 z-40 flex items-start justify-center p-4 overflow-y-auto' });
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  const body = el('div', { class: 'flex items-center gap-1.5 flex-wrap' });
  const render = () => {
    body.innerHTML = '';
    const allBranches = [...new Set([...(branchList || []), ...comp.excludedBranches.map(b => String(b).toUpperCase())])].sort();
    const ex = new Set(comp.excludedBranches.map(b => String(b).toUpperCase()));
    allBranches.forEach(b => {
      const off = ex.has(String(b).toUpperCase());
      body.append(el('button', {
        class: 'rounded-full px-2.5 py-1 text-[11px] font-semibold cursor-pointer transition hover:brightness-95',
        style: off
          ? { background: 'transparent', color: 'var(--text-muted)', border: '1px dashed var(--border-2)', textDecoration: 'line-through' }
          : { background: '#9C3F1E', color: '#fff', border: '1px solid #9C3F1E' },
        title: off ? b + ' is sitting this comp out — click to include' : 'Click to pull ' + b + ' out of the comp',
        onclick: () => {
          const u = String(b).toUpperCase();
          const wasOff = off;
          comp.excludedBranches = wasOff
            ? comp.excludedBranches.filter(x => String(x).toUpperCase() !== u)
            : [...comp.excludedBranches, u];
          logActivity('comp_change', { detail: 'Spring Cleaning: ' + b + (wasOff ? ' back in the comp' : ' pulled from the comp') });
          saveDemoData();
          render();
          const sx = window.scrollX, sy = window.scrollY;
          setTimeout(() => { mountApp(); requestAnimationFrame(() => window.scrollTo(sx, sy)); }, 0);
        },
      }, b));
    });
  };
  render();
  overlay.append(el('div', { class: 'card p-5 w-full', style: { maxWidth: '520px' } },
    el('div', { class: 'flex items-center justify-between mb-1' },
      el('h3', { class: 'text-base font-bold' }, '🏢 Offices competing'),
      el('button', { class: 'text-xl leading-none cursor-pointer px-2', onclick: () => overlay.remove() }, '×')),
    el('p', { class: 'text-xs text-muted- mb-3' },
      'Green = in the comp. Struck through = sitting this one out — excluded branches drop from every category, the points race, and Audit %. Synced to every admin.'),
    body));
  document.body.append(overlay);
}

function indicatorSpringCleaningBoard(sales, branchList, winLabel) {
  const { ranked, excludedSummary, pendingSummary } = springCleaningCompute(sales, branchList);
  const usd = (v) => '$' + Math.round(v).toLocaleString();
  const usd2 = (v) => '$' + (Number(v) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const pct = (v) => (v * 100).toFixed(1) + '%';
  const catDefs = [
    { key: 'avgPestInitial', label: 'Avg Pest Init', fmt: usd2 },
    { key: 'pra',            label: 'PRA',           fmt: usd },
    { key: 'acv',            label: 'ACV',           fmt: usd },
    { key: 'pct24',          label: '24+ Mo %',      fmt: pct },
    { key: 'autopayPct',     label: 'Autopay %',     fmt: pct },
    { key: 'auditPct',       label: 'Audit %',       fmt: pct },
  ];
  // Passed Rev is still a SCORED category (keeps its place badge) but renders to
  // the right with the other revenue columns: … Audit % | Passed Rev | Total Rev | Failed Rev | Failed %
  const passedRevDef = { key: 'revenue', label: 'Passed Rev', fmt: usd };
  const placeBadge = (p) => el('span', { class: 'ml-1 text-[10px]', style: { color: 'var(--text-subtle)' } }, '(' + p + ')');
  const catCell = (m, def) => el('td', { class: 'px-2 py-2 text-left tabular-nums whitespace-nowrap' },
    def.fmt(m[def.key]), placeBadge(m.places[def.key]));

  // Green gradient for the bug count (0 → 6), echoing the Spring Cleaning poster.
  const BUG_COLORS = ['#b8bdc2', '#FFB899', '#FF8A5C', '#FF6B3D', '#DF643A', '#C8552E', '#9C3F1E'];
  const bugBadge = (bugs) => el('span', {
    style: { display: 'inline-block', minWidth: '30px', textAlign: 'center', padding: '2px 9px', borderRadius: '0',
      background: BUG_COLORS[Math.max(0, Math.min(6, bugs))], color: '#fff', fontWeight: '900', fontSize: '12px' },
  }, String(bugs));
  // 4-round cumulative RIDDCOIN reward tiers (matches the poster's bug-count bars).
  const COIN_TIERS = [
    { bugs: 12, coin: '®50K',  color: '#FFB899' },
    { bugs: 16, coin: '®100K', color: '#FF8A5C' },
    { bugs: 20, coin: '®200K', color: '#DF643A' },
    { bugs: 24, coin: '®300K', color: '#9C3F1E' },
  ];

  return el('div', { class: 'card overflow-hidden' },
    // ── Poster-style banner header ──
    el('div', { style: { background: '#E7E7DF', padding: '14px 16px', borderBottom: '3px solid #9C3F1E' } },
      el('div', { class: 'flex items-center justify-between gap-3' },
        el('div', { class: 'shrink-0' },
          el('div', { style: { fontWeight: '900', fontSize: '30px', letterSpacing: '-0.02em', color: '#323230', lineHeight: '0.95', textTransform: 'uppercase' } }, 'Spring Cleaning'),
          el('div', { style: { fontWeight: '800', fontSize: '10.5px', letterSpacing: '0.06em', color: '#323230', marginTop: '3px', textTransform: 'uppercase' } },
            'Team Quality Based Competition by RIDDMADE™'),
          indicatorCompWindowStr() !== 'All dates' && el('div', { style: { display: 'inline-block', marginTop: '6px', padding: '3px 10px', borderRadius: '0', background: '#9C3F1E', color: '#fff', fontWeight: '900', fontSize: '11px', letterSpacing: '0.03em' } }, indicatorCompWindowStr()),
          indicatorLastUpdatedStr() && el('div', { style: { fontSize: '10px', color: '#A9441F', marginTop: '4px', fontWeight: '700' } }, indicatorLastUpdatedStr()),
        ),
        el('div', { class: 'sc-sweep-track', title: 'Sweepin\' up' },
          el('div', { class: 'sc-walker' },
            el('img', { src: 'sweeper.png', class: 'sc-sweeper', alt: 'sweeping mascot', draggable: 'false' }),
            el('div', { class: 'sc-dust' }, el('span', {}), el('span', {}), el('span', {})),
          ),
        ),
        // Standings · Reps · 👥 · ⓘ moved to the Comp Window bar (per Isaac).
      ),
    ),
    // (Competing-branches toggles live in the 🏢 modal on the Comp Window
    // bar now — per Isaac.)
    // ── MOBILE (per Isaac): the 13-column table is unusable on a phone —    // ── MOBILE (per Isaac): the 13-column table is unusable on a phone —
    // each branch becomes a stacked card: rank + bugs + points up top, the
    // six scored categories in a two-column grid, revenue strip below. ──
    el('div', { class: 'sm:hidden' },
      ...ranked.map((m, i) => el('div', { class: 'px-3 py-3', style: { borderTop: i ? '1px solid var(--border)' : 'none', background: i % 2 ? 'rgba(156,63,30,0.04)' : 'transparent' } },
        el('div', { class: 'flex items-center justify-between gap-2 mb-2' },
          el('div', { class: 'flex items-center gap-2 min-w-0' },
            el('span', { class: 'font-black tabular-nums', style: { color: i < 3 ? '#9C3F1E' : 'var(--text-muted)' } }, '#' + m.place),
            el('span', { class: 'font-bold truncate' }, m.office),
            el('span', { class: 'text-[10px] text-muted- whitespace-nowrap' }, m.reps + ' reps')),
          el('div', { class: 'flex items-center gap-2 shrink-0' },
            el('span', { class: 'text-[10px] font-black tabular-nums', style: { color: 'var(--text-muted)' } }, m.totalPoints + ' pts'),
            bugBadge(m.bugs))),
        el('div', { class: 'grid grid-cols-3 gap-x-2 gap-y-1.5 mb-2' },
          ...catDefs.map(d => el('div', { class: 'min-w-0' },
            el('div', { class: 'text-[9px] uppercase tracking-wider font-bold', style: { color: 'var(--text-subtle)' } }, d.label),
            el('div', { class: 'text-xs tabular-nums font-semibold whitespace-nowrap' }, d.fmt(m[d.key]), placeBadge(m.places[d.key]))))),
        el('div', { class: 'flex items-center gap-x-3 gap-y-1 flex-wrap text-[11px] tabular-nums' },
          el('span', { class: 'font-bold' }, 'Passed ' + usd(m.revenue), placeBadge(m.places.revenue)),
          el('span', { style: { color: 'var(--text-muted)' } }, 'Total ' + usd(m.totalRevenue)),
          el('span', { style: { color: '#c0392b' } }, 'Failed ' + usd(m.failedRevenue)),
          el('span', { style: { color: '#b8860b' } }, 'Pending ' + usd(m.pendingRevenue)))))),
    el('div', { class: 'overflow-x-auto hidden sm:block' },
      el('table', { class: 'w-full text-xs' },
        el('thead', { class: 'text-[10px] uppercase tracking-wider', style: { background: '#9C3F1E', color: '#fff' } },
          el('tr', {},
            // Branch column frozen — sticky through horizontal scroll (the
            // green header bg carries over so rows never show through).
            el('th', { class: 'text-left px-3 py-2.5 font-bold', style: { position: 'sticky', left: '0', zIndex: '3', background: '#9C3F1E' } }, 'Branch'),
            el('th', { class: 'text-left px-2 py-2.5 font-bold', title: 'Reps with a qualifying sale this round' }, 'Reps'),
            ...catDefs.map(d => el('th', {
              class: 'text-left px-2 py-2.5 font-bold',
              title: d.key === 'auditPct' ? 'Passed Audit %: passed + no-audit + pending ÷ all accounts (incl. failed audit & last resort) — now a scored category AND the points tiebreaker' : '',
            }, d.label)),
            el('th', { class: 'text-left px-2 py-2.5 font-bold', title: 'Passed/counting revenue (passed + no-audit + pending) — this is the scored revenue.' }, 'Passed Rev'),
            el('th', { class: 'text-left px-2 py-2.5 font-bold', style: { opacity: '0.85' }, title: 'Total revenue sold (matches the CRM Pending/Serviced view). Not scored.' }, 'Total Rev'),
            el('th', { class: 'text-left px-2 py-2.5 font-bold', title: 'Revenue NOT counting: failed audit + Last Resort (<$99) + not serviced by deadline' }, 'Failed Rev'),
            el('th', { class: 'text-left px-2 py-2.5 font-bold', title: 'Pending-audit revenue (the un-flagged subset of Passed) — watch it clear as audits land' }, 'Pending Rev'),
            el('th', { class: 'text-left px-2 py-2.5 font-bold' }, 'Total'),
            el('th', { class: 'text-left px-2 py-2.5 font-bold' }, 'Place'),
            el('th', { class: 'text-left px-3 py-2.5 font-bold' }, 'Bugs'),
          ),
        ),
        el('tbody', {},
          ...ranked.map((m, i) => el('tr', {
            class: 'border-t',
            style: { borderColor: 'var(--border)', background: i % 2 ? 'rgba(156,63,30,0.04)' : 'transparent' },
          },
            // (accounts count dropped — the row is about the standings, and
            // sticky cells need an OPAQUE bg; the zebra tint is baked in so
            // scrolled columns never bleed through the frozen name.)
            el('td', {
              class: 'px-3 py-2 font-bold whitespace-nowrap',
              style: { position: 'sticky', left: '0', zIndex: '1', backgroundColor: 'var(--card)',
                       backgroundImage: i % 2 ? 'linear-gradient(rgba(156,63,30,0.04), rgba(156,63,30,0.04))' : 'none' },
            },
              el('span', { style: { color: 'var(--text)' } }, m.office)),
            el('td', { class: 'px-2 py-2 text-left tabular-nums whitespace-nowrap font-bold' }, m.reps),
            ...catDefs.map(d => catCell(m, d)),
            catCell(m, passedRevDef),
            el('td', { class: 'px-2 py-2 text-left tabular-nums whitespace-nowrap', style: { color: 'var(--text-muted)' } }, usd(m.totalRevenue)),
            el('td', { class: 'px-2 py-2 text-left tabular-nums whitespace-nowrap', style: { color: '#c0392b' } }, usd(m.failedRevenue)),
            el('td', { class: 'px-2 py-2 text-left tabular-nums whitespace-nowrap', style: { color: '#b8860b' } }, usd(m.pendingRevenue)),
            el('td', { class: 'px-2 py-2 text-left tabular-nums font-black' }, m.totalPoints),
            el('td', { class: 'px-2 py-2 text-left tabular-nums font-bold' }, m.place),
            el('td', { class: 'px-3 py-2 text-left' }, bugBadge(m.bugs)),
          )),
        ),
      ),
    ),
    // RIDDCOIN reward legend (left) + live exclusion / pending callouts (right).
    el('div', { class: 'px-3 py-2.5 flex items-center justify-between gap-x-4 gap-y-1.5 flex-wrap text-[11px]', style: { borderTop: '1px solid var(--border)' } },
      el('div', { class: 'flex items-center gap-x-3 gap-y-1.5 flex-wrap' },
        el('span', { class: 'text-[10px] uppercase tracking-widest font-bold', style: { color: 'var(--text-subtle)' } }, '🐛 4-round reward'),
        ...COIN_TIERS.map(t => el('span', { class: 'inline-flex items-center gap-1.5' },
          el('span', { style: { display: 'inline-block', width: '26px', textAlign: 'center', padding: '1px 0', borderRadius: '0', background: t.color, color: '#fff', fontWeight: '900', fontSize: '10px' } }, String(t.bugs)),
          el('span', { style: { color: 'var(--text-muted)', fontWeight: '700' } }, '= ' + t.coin + '/rep'),
        )),
      ),
      el('div', { class: 'text-[11px] text-right flex flex-col gap-0.5' },
        el('div', { style: { color: '#DC2626' } },
          '⚠ ' + excludedSummary.count.toLocaleString() + ' not counting · ' + usd(excludedSummary.revenue) + ' excluded'),
        el('div', { style: { color: '#A9441F' } },
          '⏳ ' + pendingSummary.count.toLocaleString() + ' pending audit · ' + usd(pendingSummary.revenue) + ' included (assumed passing)'),
      ),
    ),
  );
}

// ── Top Gun ─────────────────────────────────────────────────────────────────
// Per-rep production competition with three classes. Each class pays its top 3
// producers ®1,000,000 / ®500,000 / ®300,000. Production = revenue (Contract
// Value); only audit-passed (or No Audit) accounts count.
//   • PROS     = the top 7 revenue reps company-wide (auto, regardless of tier)
//   • VETERANS = remaining reps tagged "Vet" in Manage Teams
//   • ROOKIES  = remaining reps tagged "Rookie" in Manage Teams
const TOP_GUN_PRO_COUNT = 7;
// PROS = the top 7 VET-tier reps by revenue on the YEAR (a standing elite tier,
// determined from full-year data — not the comp window). Pass the resulting
// rep set into topGunCompute so the comp-window table values stay separate.
function topGunProSet(yearSales) {
  const rev = new Map();
  for (const s of (yearSales || [])) {
    if (getRepTier(s.rep) !== 'vet') continue;
    rev.set(s.rep, (rev.get(s.rep) || 0) + (Number(s.contractValue) || 0));
  }
  return new Set([...rev.entries()].sort((a, b) => b[1] - a[1]).slice(0, TOP_GUN_PRO_COUNT).map(([rep]) => rep));
}

// Rules popup for Top Gun (the header ⓘ next to Export).
function openTopGunHelpModal() {
  const BLUE = '#2b3a6b', CREAM = '#f4eede';
  const overlay = el('div', { class: 'modal-overlay' });
  const close = () => { overlay.remove(); document.removeEventListener('keydown', key); };
  const key = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', key);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  const block = (title, body) => el('div', { class: 'mb-3' },
    el('div', { class: 'text-[11px] uppercase tracking-widest font-bold mb-1', style: { color: BLUE } }, title),
    el('div', { class: 'text-[13px] leading-relaxed', style: { color: 'var(--text-muted)' } }, body));

  const card = el('div', { class: 'card w-full max-w-lg my-8 overflow-hidden flex flex-col', style: { maxHeight: 'calc(100vh - 64px)' } },
    el('div', { class: 'flex items-start justify-between px-5 py-3', style: { background: BLUE } },
      el('div', {},
        el('div', { class: 'text-[10px] uppercase tracking-widest font-semibold', style: { color: CREAM, opacity: '0.8' } }, 'RIDDMADE ★ ★ ★'),
        el('h2', { class: 'text-lg font-black mt-0.5', style: { color: CREAM, textTransform: 'uppercase', fontFamily: 'Georgia, serif' } }, 'Top Gun — Rules'),
      ),
      el('button', { class: 'text-2xl leading-none', style: { color: CREAM }, onclick: close }, '×'),
    ),
    el('div', { class: 'overflow-auto px-5 py-4' },
      block('Payouts', 'Each class pays its top 3 producers (®1,000,000 / ®500,000 / ®300,000).'),
      block('Ranking', 'Reps are ranked on Passed Rev (audit-passed production · Contract Value).'),
      block('Total Revenue', 'Total Rev = the sum of everything (Passed + Pending + Failed).'),
      block('Pros', 'PROS = the top 7 Vet reps by revenue on the year.'),
      block('Veterans & Rookies', 'The rest of the reps, split by their Rookie/Vet tier in Manage Teams.'),
      block('Eligibility', 'Only audit-passed accounts count toward the competition.'),
    ),
  );
  overlay.append(card);
  document.body.append(overlay);
}

function indicatorTopGunBoard(sales, proSet) {
  const RED = '#be3a2b', BLUE = '#2b3a6b', CREAM = '#f4eede';
  const classes = topGunCompute(sales, proSet);
  const PRIZES = ['®1,000,000', '®500,000', '®300,000'];
  const usd = (v) => '$' + Math.round(v).toLocaleString();
  const CLASS_DEFS = [
    { key: 'rookie', name: 'ROOKIES',  badge: 'R', color: RED },
    { key: 'vet',    name: 'VETERANS', badge: 'V', color: BLUE },
    { key: 'pro',    name: 'PROS',     badge: 'P', color: RED },
  ];

  const classCard = (def) => {
    const reps = classes[def.key] || [];
    return el('div', { style: { borderRadius: '0', overflow: 'hidden', border: '3px solid ' + def.color, background: def.color } },
      el('div', { class: 'flex items-stretch' },
        el('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'center', minWidth: '96px', padding: '12px', borderRight: '2px solid ' + CREAM } },
          el('div', { style: { width: '54px', height: '54px', borderRadius: '50%', border: '3px solid ' + CREAM, display: 'flex', alignItems: 'center', justifyContent: 'center', color: CREAM, fontWeight: '900', fontSize: '26px', fontFamily: 'Georgia, serif' } }, def.badge),
        ),
        el('div', { style: { flex: '1', padding: '12px 16px', color: CREAM } },
          el('div', { style: { fontWeight: '900', fontSize: '20px', letterSpacing: '0.02em', fontStyle: 'italic' } }, '"' + def.name + '"'),
          ...PRIZES.map((p, i) => el('div', { class: 'flex items-center justify-between gap-3', style: { fontSize: '11px', fontWeight: '700', marginTop: '3px', maxWidth: '340px', textTransform: 'uppercase' } },
            el('span', {}, (i === 0 ? 'Top producing rep' : ('#' + (i + 1) + ' rep in this class')) + ' receives'),
            el('span', { style: { fontWeight: '900' } }, p))),
        ),
      ),
      reps.length === 0
        ? el('div', { style: { padding: '10px 16px', color: CREAM, fontSize: '11px', fontStyle: 'italic', opacity: '0.85' } },
            def.key === 'pro' ? 'No audit-passed production in this window yet.'
              : 'No reps tagged "' + (def.key === 'rookie' ? 'Rookie' : 'Vet') + '" in Manage Teams yet.')
        : el('div', { style: { background: CREAM, margin: '0 8px 8px', borderRadius: '0', overflow: 'hidden' } },
            // ~10 rows tall, then scroll through the rest of the class.
            el('div', { style: { maxHeight: '300px', overflowY: 'auto' } },
              el('table', { class: 'w-full', style: { fontSize: '11px' } },
                el('thead', { style: { position: 'sticky', top: '0', background: CREAM, zIndex: 1 } },
                  (() => {
                    const th = (label, title) => el('th', { title: title || '', style: { padding: '6px 8px', textAlign: 'left', fontSize: '9px', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.03em', color: '#555', borderBottom: '2px solid rgba(0,0,0,0.15)', whiteSpace: 'nowrap' } }, label);
                    return el('tr', {},
                      (() => { const t = th('#'); Object.assign(t.style, { position: 'sticky', left: '0', zIndex: 2, background: CREAM, width: '30px', minWidth: '30px', maxWidth: '30px', boxSizing: 'border-box' }); return t; })(),
                      (() => { const t = th('Rep'); Object.assign(t.style, { position: 'sticky', left: '30px', zIndex: 2, background: CREAM }); return t; })(),
                      th('Subs', 'All subscriptions sold (every account, all audit statuses)'),
                      th('ACV', 'Avg contract value across all accounts'),
                      th('Total Rev', 'Passed + Pending + Failed (all revenue)'),
                      th('Failed', 'Failed Audit + Last Resort'),
                      th('Pending', 'Awaiting audit'),
                      th('Passed Rev', 'Passed Audit + No Audit revenue — reps are ranked on this'),
                      th('Audit %', 'Passed + No-Audit + Pending ÷ all accounts (incl. failed audit & last resort)'),
                      th('RIDDCOIN'),
                    );
                  })(),
                ),
                el('tbody', {},
                  ...reps.map((r, i) => el('tr', { style: { borderTop: i ? '1px solid rgba(0,0,0,0.08)' : 'none', background: i < 3 ? 'rgba(190,58,43,0.06)' : 'transparent' } },
                    // Rank + Rep frozen — opaque bg (cream base, podium tint
                    // layered) so scrolled columns never bleed through.
                    el('td', { style: { padding: '5px 8px', fontWeight: '900', width: '30px', minWidth: '30px', maxWidth: '30px', boxSizing: 'border-box', color: def.color, position: 'sticky', left: '0', zIndex: 1, backgroundColor: CREAM, backgroundImage: i < 3 ? 'linear-gradient(rgba(190,58,43,0.06),rgba(190,58,43,0.06))' : 'none' } }, i + 1),
                    el('td', { style: { padding: '5px 8px', fontWeight: '700', color: '#222', whiteSpace: 'nowrap', position: 'sticky', left: '30px', zIndex: 1, backgroundColor: CREAM, backgroundImage: i < 3 ? 'linear-gradient(rgba(190,58,43,0.06),rgba(190,58,43,0.06))' : 'none' } }, r.rep),
                    el('td', { style: { padding: '5px 8px', textAlign: 'left', fontVariantNumeric: 'tabular-nums', color: '#222' } }, r.subs.toLocaleString()),
                    el('td', { style: { padding: '5px 8px', textAlign: 'left', fontVariantNumeric: 'tabular-nums', color: '#222' } }, usd(r.acv)),
                    el('td', { style: { padding: '5px 8px', textAlign: 'left', fontVariantNumeric: 'tabular-nums', color: '#111', fontWeight: '900' } }, usd(r.total)),
                    el('td', { style: { padding: '5px 8px', textAlign: 'left', fontVariantNumeric: 'tabular-nums', color: RED, fontWeight: '700' } }, r.failedRev ? usd(r.failedRev) : '—'),
                    el('td', { style: { padding: '5px 8px', textAlign: 'left', fontVariantNumeric: 'tabular-nums', color: '#a67c00' } }, r.pendingRev ? usd(r.pendingRev) : '—'),
                    el('td', { style: { padding: '5px 8px', textAlign: 'left', fontVariantNumeric: 'tabular-nums', color: '#222', fontWeight: '900' } }, usd(r.passedRev)),
                    el('td', { style: { padding: '5px 8px', textAlign: 'left', fontVariantNumeric: 'tabular-nums', color: '#222', fontWeight: '700' } }, (r.auditPct * 100).toFixed(1) + '%'),
                    el('td', { style: { padding: '5px 8px', textAlign: 'left', fontWeight: '900', color: BLUE, width: '96px', whiteSpace: 'nowrap' } }, i < 3 ? PRIZES[i] : '—'),
                  )),
                ),
              ),
            ),
          ),
      el('div', { style: { padding: '8px 16px', color: CREAM, fontWeight: '800', fontSize: '11px', textAlign: 'center', letterSpacing: '0.02em', textTransform: 'uppercase' } }, 'Only accounts that pass audit count for competition'),
    );
  };

  const unclassified = classes.none || [];

  return el('div', { class: 'card overflow-hidden', style: { background: CREAM } },
    el('div', { style: { background: BLUE, padding: '16px 18px' } },
      el('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '14px', flexWrap: 'wrap' } },
        el('div', { style: { display: 'flex', flexDirection: 'column', gap: '4px' } },
          el('div', { style: { fontWeight: '900', fontSize: '40px', lineHeight: '0.9', color: CREAM, letterSpacing: '0.04em', fontFamily: 'Georgia, serif' } }, 'TOP GUN'),
          el('div', {},
            el('div', { style: { fontWeight: '800', fontSize: '11px', color: CREAM, letterSpacing: '0.14em', whiteSpace: 'nowrap' } }, 'RIDDMADE   ★ ★ ★'),
            indicatorLastUpdatedStr() && el('div', { style: { fontSize: '9.5px', color: CREAM, opacity: '0.7', whiteSpace: 'nowrap', marginTop: '2px', letterSpacing: '0.02em' } }, indicatorLastUpdatedStr()),
          ),
        ),
        el('div', { class: 'tg-fly-track', title: 'On patrol' },
          el('div', { class: 'tg-flyer' },
            el('img', { src: 'plane.svg', class: 'tg-plane', alt: 'stealth bomber', draggable: 'false' }),
          ),
        ),
        el('div', { class: 'shrink-0', style: { display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '6px' } },
          // Export · Reset · ⓘ moved to the Comp Window bar (per Isaac) —
          // only the active-window pill stays on the poster header.
          // (date pill removed — per Isaac; the Comp Window bar above already
          // shows the active range)
        ),
      ),
    ),
    el('div', { style: { padding: '14px', display: 'flex', flexDirection: 'column', gap: '14px' } },
      ...CLASS_DEFS.map(classCard),
      unclassified.length ? el('div', { style: { fontSize: '11px', color: '#a33', padding: '4px' } },
        '⚠ ' + unclassified.length + ' rep' + (unclassified.length === 1 ? '' : 's') + ' with no Rookie/Vet tier (and not a Pro): '
          + unclassified.slice(0, 20).map(r => r.rep).join(', ') + (unclassified.length > 20 ? '…' : '')
          + ' — tag them in Manage Teams to include them.') : null,
    ),
  );
}

// Top Gun export — a Standings sheet (every rep's metrics per class) plus one
// sheet per class (Pros / Veterans / Rookies) with all of that class's accounts.
async function exportTopGunXlsx(sales, proSet) {
  try { await loadXlsxLibOnce(); } catch { toast('Could not load Excel library — check your connection', 'error'); return; }
  const XLSX = window.XLSX;
  if (!XLSX) { toast('Excel library missing after load', 'error'); return; }
  const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : ''; };
  const classes = topGunCompute(sales, proSet);
  const PRIZES = ['1,000,000', '500,000', '300,000'];
  const CLASS_DEFS = [
    { key: 'pro', name: 'Pros' },
    { key: 'vet', name: 'Veterans' },
    { key: 'rookie', name: 'Rookies' },
  ];
  const repClass = new Map();
  CLASS_DEFS.forEach(d => (classes[d.key] || []).forEach(r => repClass.set(r.rep, d.name)));

  // Standings sheet — each class, every rep ranked.
  const st = [];
  st.push(['Top Gun — Standings']);
  st.push(['Pulled', new Date().toLocaleString()]);
  st.push(['Note', 'Reps are ranked on Passed Rev (audit-passed production). Total Rev = Passed + Pending + Failed (all revenue). Pros = top 7 Vet reps by year revenue.']);
  CLASS_DEFS.forEach(d => {
    const reps = classes[d.key] || [];
    st.push([]);
    st.push([d.name.toUpperCase()]);
    st.push(['#', 'Rep', 'Subs', 'ACV', 'Total Rev', 'Failed Rev', 'Pending Rev', 'Passed Rev', 'RIDDCOIN']);
    reps.forEach((r, i) => st.push([i + 1, r.rep, r.subs, Math.round(r.acv), Math.round(r.total), Math.round(r.failedRev), Math.round(r.pendingRev), Math.round(r.passedRev), i < 3 ? PRIZES[i] : '']));
  });

  const acctHeader = ['Rep', 'Class', 'Audit Bucket', 'Office', 'Customer', 'Customer ID', 'Date Sold',
    'Subscription', 'Source', 'Initial Price', 'Contract Value', 'Contract Months', 'Auto Pay', 'Customer Flags'];
  const acctRow = (s) => [
    s.rep || '', repClass.get(s.rep) || 'Unclassified', topGunBucket(s), s.office || '', s.customer || '', s.customerId || '',
    s.dateSold || '', s.subscription || '', s.source || '', num(s.initialPrice), num(s.contractValue), num(s.contract), s.autoPay || '', s.customerFlags || '',
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(st), 'Standings');
  CLASS_DEFS.forEach(d => {
    const repNames = new Set((classes[d.key] || []).map(r => r.rep));
    const rows = (sales || []).filter(s => repNames.has(s.rep));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([acctHeader, ...rows.map(acctRow)]), d.name);
  });
  XLSX.writeFile(wb, 'RIDD-Top-Gun-' + new Date().toISOString().slice(0, 10) + '.xlsx');
  toast('Exported Top Gun — Standings + accounts by class', 'success');
}

// ── Power-Ranking exclusions ─────────────────────────────────────────────
// Offices (branch view) or teams (team view) the user has deselected from the
// Power Ranking. Unlike team exclusions, these stay fully ON THE BOARD (values
// table + RIDD totals) — they just don't earn ranking points and don't shift
// anyone else's ranks. Stored per group type so branches and teams are kept
// separate. Shared across admins via the same cloud sync as team settings.
function _rankExcludeMode() {
  return state.indicatorsGroupBy === 'teams' ? 'teams' : 'branch';
}
function rankExcludedSet() {
  const store = state._indicatorRankExclude || {};
  // Phantom CRM offices (negative IDs → "OFFICE -1" / "OFFICE -7") can linger in
  // a persisted exclusion list from before they were filtered out of the data.
  // They're no longer real branches, so never count them toward the Power
  // Ranking exclusions or the trophy badge.
  const raw = (store[_rankExcludeMode()] || []).filter(n => !/^office\s*-\s*\d/i.test(String(n || '').trim()));
  return new Set(raw);
}
function isRankExcluded(name) {
  return !!name && rankExcludedSet().has(name);
}
function toggleRankExcluded(name) {
  if (!name) return;
  if (!state._indicatorRankExclude || typeof state._indicatorRankExclude !== 'object') state._indicatorRankExclude = {};
  const mode = _rankExcludeMode();
  const cur = new Set(state._indicatorRankExclude[mode] || []);
  if (cur.has(name)) cur.delete(name); else cur.add(name);
  state._indicatorRankExclude[mode] = [...cur];
  logActivity('config_change', { detail: 'Power Ranking ' + (cur.has(name) ? 'excluded' : 'included') + ' ' + mode + ': ' + name });
  // Shared config: exclusions ride in the competitions jsonb so every
  // admin device agrees (was per-browser — desktop and phone disagreed).
  saveDemoData();
  if (typeof saveIndicatorConfigToSupabase === 'function') saveIndicatorConfigToSupabase().catch(() => {});
}

// Excluded-team helpers now operate on the ACTIVE competition's list, so all
// existing call sites become competition-aware through this single chokepoint.
function getExcludedTeams() {
  return getActiveComp().excludedTeams;
}
function isTeamExcluded(teamName) {
  if (!teamName) return false;
  return getExcludedTeams().includes(teamName);
}
function setTeamExcluded(teamName, excluded) {
  if (!teamName) return;
  const list = getExcludedTeams();
  const idx = list.indexOf(teamName);
  if (excluded && idx === -1) list.push(teamName);
  else if (!excluded && idx !== -1) list.splice(idx, 1);
  logActivity('comp_change', { detail: 'Team ' + teamName + (excluded ? ' excluded from comp' : ' included in comp') });
  saveDemoData();
}
function isRepExcluded(repName) {
  return isTeamExcluded(getRepTeam(repName));
}

// Independent of team: each rep can be tagged 'rookie' | 'vet' (or unset).
const REP_TIERS = [
  { id: 'rookie', label: 'Rookie', color: '#5F6C5B' },
  { id: 'vet',    label: 'Vet',    color: '#DF643A' },
];
function setRepTier(repName, tier) {
  if (!state._indicatorRepTier) state._indicatorRepTier = {};
  if (!state._indicatorRepTierYear) state._indicatorRepTierYear = {};
  if (!tier) { delete state._indicatorRepTier[repName]; delete state._indicatorRepTierYear[repName]; }
  else       { state._indicatorRepTier[repName] = tier; state._indicatorRepTierYear[repName] = new Date().getFullYear(); }
  _invalidateRepSigIndex(state._indicatorRepTier);
  _invalidateRepSigIndex(state._indicatorRepTierYear);
  logActivity('team_change', { rep_name: repName, detail: repName + (tier ? ' tagged ' + tier : ' tier cleared') });
  saveDemoData();
}
function repTierMeta(tierId) { return REP_TIERS.find(t => t.id === tierId); }

// Active/inactive flag — defaults to active. Reserved for competitions/PRA
// gating later; today it's purely informational and shown in Manage Teams.
function isRepActive(repName) {
  if (!repName) return true;
  const map = state._indicatorRepActive || {};
  // Explicit pins first (exact → cleaned → name-signature): an admin's
  // manual Active/Inactive toggle beats the auto rule in BOTH directions.
  let explicit = map[repName];
  if (explicit === undefined) explicit = map[_cleanRepName(repName)];
  if (explicit === undefined) explicit = _repSigIndex(map)[_repNameSig(repName)];
  if (explicit === false) return false;
  if (explicit === true) return true;
  // AUTO-INACTIVE — no sale within 75 days of the DATASET'S latest sale
  // flips a rep Inactive automatically (roster self-cleans as reps churn;
  // selling again self-reactivates on the next sync). Anchored to the data,
  // not the clock, so a stale upload can't flip the whole roster.
  const rec = _repSaleYears(repName);
  const anchor = _tierYearsCache.latestMs || 0;
  if (!rec || !rec.lastMs || !anchor) return false;   // never sold → inactive
  return (anchor - rec.lastMs) <= 75 * 86400000;
}
function setRepActive(repName, active) {
  if (!state._indicatorRepActive) state._indicatorRepActive = {};
  // Tri-state now that auto-inactive exists: explicit true AND false are
  // both stored, so a manual toggle pins the rep against the 75-day rule.
  state._indicatorRepActive[repName] = !!active;
  _invalidateRepSigIndex(state._indicatorRepActive);
  logActivity('team_change', { rep_name: repName, detail: repName + ' pinned ' + (active ? 'Active' : 'Inactive') });
  saveDemoData();
}
// Auto-reactivation: any rep currently marked Inactive who has sold within the
// coaching "silence" window (the same 30-day threshold that flags them inactive)
// is flipped back to Active. This lets an admin safely mass-mark quiet reps
// Inactive — the moment one sells again on a sync, they return to the
// leaderboards + PDF. Runs after every sync/upload. Matched by name-signature so
// the Inactive flag (Manage Teams spelling) lines up with the sales-data
// spelling ("Last, First" vs "First Last").
function reactivateRecentSellers() {
  const map = state._indicatorRepActive;
  if (!map || typeof map !== 'object') return;
  const inactive = Object.keys(map).filter(k => map[k] === false);
  if (!inactive.length) return;
  const sales = state._indicatorRawSales || [];
  if (!sales.length) return;
  const NO_SALE_DAYS_INACTIVE = 30; // mirrors the coach's inactive-candidate rule
  // Anchor on the dataset's most recent sale (same as the coach), and find each
  // rep's latest sale by signature in one pass.
  let latest = 0;
  const lastBySig = new Map();
  for (const s of sales) {
    if (!s.rep) continue;
    const d = _parseIndicatorDay(s);
    if (!d) continue;
    const t = d.getTime();
    if (t > latest) latest = t;
    const sig = _repNameSig(s.rep);
    if (t > (lastBySig.get(sig) || 0)) lastBySig.set(sig, t);
  }
  if (!latest) return;
  const cutoff = latest - NO_SALE_DAYS_INACTIVE * 86400000;
  const revived = [];
  for (const name of inactive) {
    const last = lastBySig.get(_repNameSig(name));
    if (last && last >= cutoff) { delete map[name]; revived.push(name); }
  }
  if (revived.length) {
    _invalidateRepSigIndex(map);
    revived.forEach(n => logActivity('team_change', { rep_name: n, detail: n + ' auto-reactivated — sold again within ' + NO_SALE_DAYS_INACTIVE + ' days' }));
    if (typeof saveIndicatorState === 'function') saveIndicatorState();
  }
}

// Manual office mapping for reps who don't have any sales rows yet (new
// hires, quiet reps). Read in this order:
//   getRepOffice(name)  → manual map (sourced from the original team CSV's
//                         Market column, bulk-uploaded via SQL)
//   primaryOffice(name) → most-frequent office across this rep's sales
// In Manage Teams we union them so every rep shows an office, even ones
// who haven't sold anything yet.
function getRepOffice(repName) {
  if (!repName) return '';
  return _repKeyedLookup(state._indicatorRepOffice || {}, repName);
}
function setRepOffice(repName, office) {
  if (!state._indicatorRepOffice) state._indicatorRepOffice = {};
  if (!office) delete state._indicatorRepOffice[repName];
  else         state._indicatorRepOffice[repName] = office;
  _invalidateRepSigIndex(state._indicatorRepOffice);
  saveDemoData();
}

// ── Duplicate rep detection ──────────────────────────────────────────────
// Same rep shows up under two spellings when the team-CSV upload uses a
// full name (Joshua Sturgeon) but the indicator CSV uses a nickname
// (Josh Sturgeon). This list catches the common non-prefix nicknames;
// prefix nicknames (Josh→Joshua, Joe→Joseph) are detected by the prefix
// rule in findDuplicateRepCandidates() and don't need to be listed.
const NICKNAME_PAIRS = [
  ['Mike',  'Michael'], ['Bob',   'Robert'],  ['Bobby', 'Robert'],
  ['Bill',  'William'], ['Billy', 'William'], ['Jim',   'James'],
  ['Jimmy', 'James'],   ['Jamie', 'James'],   ['Rick',  'Richard'],
  ['Dick',  'Richard'], ['Hank',  'Henry'],   ['Jack',  'John'],
  ['Johnny','John'],    ['Tony',  'Anthony'], ['Chuck', 'Charles'],
  ['Frank', 'Francis'], ['Ed',    'Edward'],  ['Eddie', 'Edward'],
  ['Ned',   'Edward'],  ['Ron',   'Ronald'],  ['Don',   'Donald'],
  ['Ken',   'Kenneth'], ['Greg',  'Gregory'], ['Larry', 'Lawrence'],
  ['Drew',  'Andrew'],  ['Andy',  'Andrew'],  ['Tom',   'Thomas'],
];

// Returns an array of { bad, good, reason } pairs where `bad` is the
// spelling NOT in the CSV (gets removed on merge) and `good` is the
// spelling IN the CSV (stays). Pairs the user has dismissed (via
// state._indicatorDismissedDupes) are filtered out.
function findDuplicateRepCandidates() {
  const allNames = new Set([
    ...((state._indicatorRawSales || []).map(s => s.rep).filter(Boolean)),
    ...Object.keys(state._indicatorRepTeam   || {}),
    ...Object.keys(state._indicatorRepTier   || {}),
    ...Object.keys(state._indicatorRepOffice || {}),
  ]);
  const namesInCsv = new Set((state._indicatorRawSales || []).map(s => s.rep).filter(Boolean));
  // ALSO scan the FieldRoutes roster (active Sales Reps only, so techs and
  // office staff don't flood the list). A duplicate employee record that has
  // never sold is invisible to a sales-data-only scan - which is exactly how
  // "Colton Rutherford" (0 sales) sat alongside "Colton Rutherfurd" (222)
  // unnoticed. Surfacing it BEFORE the empty twin earns anything is the
  // whole point: once it does, the rep's history silently splits in two.
  (state.frRoster || []).forEach(e => {
    if (!e || e.type_label !== 'Sales Rep') return;
    if (e.active === 0 || e.active === false || e.active === '0') return;
    const ln = String(e.lname || '').trim(), fn = String(e.fname || '').trim();
    if (ln && fn) allNames.add(ln + ', ' + fn);          // sales-data shape is "Last, First"
  });
  const rosterNames = new Set();
  (state.frRoster || []).forEach(e => {
    const ln = String(e && e.lname || '').trim(), fn = String(e && e.fname || '').trim();
    if (ln && fn) rosterNames.add(ln + ', ' + fn);
  });
  const dismissed = new Set(state._indicatorDismissedDupes || []);
  // Names already merged into something else — skip them so the
  // scanner doesn't re-suggest the same pair after a merge.
  const aliased = new Set(Object.keys(state._indicatorRepAlias || {}));

  const nickMap = new Map();
  NICKNAME_PAIRS.forEach(([a, b]) => {
    nickMap.set(a.toLowerCase(), b.toLowerCase());
    nickMap.set(b.toLowerCase(), a.toLowerCase());
  });

  const names = [...allNames].sort();
  const pairs = [];
  const seen = new Set();

  // Precomputed ONCE per name rather than twice per pair. This loop is
  // O(n^2) and the roster names push n up, so the squash/token keys are
  // built here instead of inside the comparison.
  const _squashOf = (x) => x.toLowerCase().replace(/[^a-z]/g, '').split('').sort().join('');
  const _tokensOf = (x) => x.toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(Boolean).sort();
  const meta = names.map(n => ({ squash: _squashOf(n), tokens: _tokensOf(n), parts: n.toLowerCase().split(/\s+/) }));

  // True when two strings are exactly one insert/delete/substitute apart.
  const _oneEditApart = (x, y) => {
    if (Math.abs(x.length - y.length) > 1) return false;
    if (x === y) return false;
    let i = 0, j = 0, edits = 0;
    while (i < x.length && j < y.length) {
      if (x[i] === y[j]) { i++; j++; continue; }
      if (++edits > 1) return false;
      if (x.length > y.length) i++;
      else if (y.length > x.length) j++;
      else { i++; j++; }
    }
    if (i < x.length || j < y.length) edits++;
    return edits === 1;
  };
  // Rule 3: every token matches except ONE, and that odd pair is a single
  // typo apart - Rutherford/Rutherfurd, Dalley/Daley. Rules 1 and 2 both
  // demand an EXACT last-name match and Rule 0 demands identical letters,
  // so a misspelled surname slips past all three. Token-set based, so it
  // works whether the name is stored "Last, First" or "First Last".
  const _isTypoDupe = (ma, mb) => {
    const ax = ma.tokens, bx = mb.tokens;
    if (ax.length !== bx.length || ax.length < 2) return false;
    let diff = null;
    for (let k = 0; k < ax.length; k++) {
      if (ax[k] === bx[k]) continue;
      if (diff) return false;                      // more than one token differs
      diff = [ax[k], bx[k]];
    }
    // >=4 chars keeps short tokens (initials, Jo/Bo) out of it.
    return !!diff && diff[0].length >= 4 && diff[1].length >= 4 && _oneEditApart(diff[0], diff[1]);
  };

  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      const a = names[i], b = names[j];
      // If either side has already been merged into something else,
      // skip — the merge state is the source of truth, not the spelling.
      if (aliased.has(a) || aliased.has(b)) continue;
      const ma = meta[i], mb = meta[j];
      // Rule 0 (per Isaac, "Pere LeSueur" vs "Pere Le Sueur"): the SAME
      // letters once spacing/punctuation/word order are stripped = the same
      // human split by a spelling difference. These pairs are flagged even
      // when BOTH spellings carry revenue - that's exactly the bug.
      const isSquashDupe = ma.squash === mb.squash;
      const isTypoDupe = !isSquashDupe && _isTypoDupe(ma, mb);
      let isPrefix = false, isNickname = false;
      if (!isSquashDupe && !isTypoDupe) {
      const aParts = ma.parts;
      const bParts = mb.parts;
      if (aParts.length < 2 || bParts.length < 2) continue;

      // Last names must match (case-insensitive). The last whitespace
      // token wins, which gracefully handles middle names + initials.
      const aLast = aParts[aParts.length - 1];
      const bLast = bParts[bParts.length - 1];
      if (aLast !== bLast) continue;

      const aFirst = aParts[0];
      const bFirst = bParts[0];
      if (aFirst === bFirst) continue;

      // Rule 1: one first name is a prefix of the other (≥3 chars).
      // Catches Josh/Joshua, Joe/Joseph, Tom/Thomas, Sam/Samuel, etc.
      isPrefix =
        (aFirst.length >= 3 && bFirst.startsWith(aFirst)) ||
        (bFirst.length >= 3 && aFirst.startsWith(bFirst));
      // Rule 2: known nickname pair (Bob/Robert, Bill/William, etc.).
      isNickname = nickMap.get(aFirst) === bFirst;
      if (!isPrefix && !isNickname) continue;
      }

      const aInCsv = namesInCsv.has(a);
      const bInCsv = namesInCsv.has(b);
      // Decide which is canonical. If only one is in the CSV, that's
      // the keeper. If both or neither, skip — too ambiguous to auto-
      // pick a winner; the user should fix it manually instead.
      let bad, good;
      if (aInCsv && !bInCsv)      { good = a; bad = b; }
      else if (bInCsv && !aInCsv) { good = b; bad = a; }
      else if (isSquashDupe) {
        // Same-letters pairs surface even when BOTH spellings have sales
        // (revenue is being split!). Keeper = the spelling with more rows
        // in the dataset; the other one merges into it.
        const _rowsOf = (n) => (state._indicatorRawSales || []).reduce((acc, s) => acc + (s.rep === n ? 1 : 0), 0);
        if (_rowsOf(a) >= _rowsOf(b)) { good = a; bad = b; } else { good = b; bad = a; }
      }
      // Typo pairs where BOTH spellings have sales (Coates/Coats, per Isaac)
      // are still surfaced — but never auto-merged: they land in the review
      // list for a human to confirm, keeper = the spelling the FieldRoutes
      // roster uses (if exactly one side is on it), else the one with more
      // rows. One letter apart CAN be two real people (Anderson/Andersen).
      else if (isTypoDupe) {
        const _onRoster = (n) => rosterNames.has(n);
        const _rowsOf = (n) => (state._indicatorRawSales || []).reduce((acc, s) => acc + (s.rep === n ? 1 : 0), 0);
        if (_onRoster(a) !== _onRoster(b)) { if (_onRoster(a)) { good = a; bad = b; } else { good = b; bad = a; } }
        else if (_rowsOf(a) >= _rowsOf(b)) { good = a; bad = b; } else { good = b; bad = a; }
      }
      else continue;

      const key = bad + '||' + good;
      if (dismissed.has(key) || seen.has(key)) continue;
      seen.add(key);
      pairs.push({ bad, good, reason: isSquashDupe ? 'spelling' : isTypoDupe ? 'typo' : isPrefix ? 'prefix' : 'nickname' });
    }
  }
  return pairs;
}

// Resolve a rep name to its canonical form. If `name` has been merged
// into another rep (via mergeDuplicateRep), this returns the canonical
// name; otherwise returns `name` unchanged. Used at every per-rep
// aggregation point so a rep that appears in the CSV under two
// spellings still counts as ONE rep for revenue, sales, ranking, etc.
// Where a rep SOLD — per-office counts, revenue, and date spans, plus their
// most recent accounts. Answers "which offices did this rep sell in, how
// much, and when" from Manage Teams (click the rep's name).
function openRepWhereSoldModal(repName) {
  const canonical = getCanonicalRepName(repName);
  const sig = (n) => String(n || '').toLowerCase().replace(/[.,]/g, ' ').split(/\s+/).filter(Boolean).sort().join(' ');
  const mySig = sig(canonical);
  const rows = (state._indicatorRawSales || []).filter(s => s.rep && sig(getCanonicalRepName(s.rep)) === mySig
    && (typeof frPendingServiced !== 'function' || frPendingServiced(s)));
  const iso = (s) => (typeof dateSoldToIso === 'function' && dateSoldToIso(s.dateSold)) || '';
  const byOffice = new Map();
  rows.forEach(s => {
    const o = String(s.office || 'UNKNOWN').split(',')[0].trim().toUpperCase();
    let g = byOffice.get(o); if (!g) { g = { n: 0, rev: 0, first: '9999', last: '' }; byOffice.set(o, g); }
    g.n++; g.rev += Number(s.contractValue) || 0;
    const d = iso(s);
    if (d) { if (d < g.first) g.first = d; if (d > g.last) g.last = d; }
  });
  const offices2 = [...byOffice.entries()].map(([o, g]) => ({ o, ...g })).sort((a, b) => b.rev - a.rev);
  const fmtD = (d) => d && d !== '9999' ? new Date(d + 'T00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' }) : '—';
  const recent = rows.slice().sort((a, b) => iso(b).localeCompare(iso(a))).slice(0, 15);
  const titleCase2 = (t) => String(t).split(' ').map(w => w ? w[0] + w.slice(1).toLowerCase() : w).join(' ');
  const overlay = el('div', { class: 'modal-overlay' });
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  const card = el('div', { class: 'card w-full max-w-lg my-8 overflow-hidden flex flex-col', style: { maxHeight: 'calc(100vh - 64px)' } },
    el('div', { class: 'flex items-start justify-between gap-3 p-4 pb-2' },
      el('div', {},
        el('h2', { class: 'text-base font-bold' }, canonical + ' — where they sold'),
        el('div', { class: 'text-[11px] mt-0.5', style: { color: 'var(--text-muted)' } },
          fmt.int(rows.length) + ' pending/serviced accounts · ' + fmt.usd0(rows.reduce((a, s) => a + (Number(s.contractValue) || 0), 0)) + ' total')),
      el('button', { class: 'text-2xl leading-none', style: { color: 'var(--text-muted)' }, onclick: () => overlay.remove() }, '×')),
    el('div', { class: 'px-4 pb-4 overflow-y-auto' },
      offices2.length === 0
        ? el('div', { class: 'p-6 text-center text-sm', style: { color: 'var(--text-muted)' } }, 'No pending/serviced accounts in the loaded dataset.')
        : el('table', { class: 'w-full text-xs tabular-nums mb-3' },
            el('thead', { class: 'text-[10px] uppercase tracking-wider text-muted-' },
              el('tr', {},
                el('th', { class: 'text-left py-1.5 pr-2' }, 'Office'),
                el('th', { class: 'text-right px-2 py-1.5' }, 'Accounts'),
                el('th', { class: 'text-right px-2 py-1.5' }, 'Revenue'),
                el('th', { class: 'text-right pl-2 py-1.5' }, 'First → Last'))),
            el('tbody', {},
              ...offices2.map(g => el('tr', { class: 'border-t border-' },
                el('td', { class: 'py-1.5 pr-2 font-semibold' }, titleCase2(g.o)),
                el('td', { class: 'px-2 py-1.5 text-right' }, fmt.int(g.n)),
                el('td', { class: 'px-2 py-1.5 text-right font-semibold' }, fmt.usd0(g.rev)),
                el('td', { class: 'pl-2 py-1.5 text-right whitespace-nowrap', style: { color: 'var(--text-muted)' } }, fmtD(g.first) + ' → ' + fmtD(g.last)))))),
      recent.length > 0 && el('div', {},
        el('div', { class: 'text-[10px] uppercase tracking-widest font-bold mb-1', style: { color: 'var(--text-subtle)' } }, 'Most recent accounts'),
        el('table', { class: 'w-full text-[11px] tabular-nums' },
          el('tbody', {},
            ...recent.map(s => el('tr', { class: 'border-t border-' },
              el('td', { class: 'py-1 pr-2 whitespace-nowrap', style: { color: 'var(--text-muted)' } }, fmtD(iso(s))),
              el('td', { class: 'px-2 py-1 font-semibold' }, titleCase2(String(s.office || '—').split(',')[0])),
              el('td', { class: 'px-2 py-1 truncate', style: { maxWidth: '160px', color: 'var(--text-muted)' } }, s.customer || s.subscription || '—'),
              el('td', { class: 'pl-2 py-1 text-right font-semibold' }, fmt.usd0(Number(s.contractValue) || 0)))))))));
  overlay.append(card);
  document.body.append(overlay);
}
// If a name is an alias (has been merged into something else), return
// the canonical target. Returns null when the name is itself canonical.
// Useful for badging "merged into X" in the UI without scanning the
// whole alias map every time.
function getRepAliasTarget(name) {
  if (!name) return null;
  const t = (state._indicatorRepAlias || {})[name];
  return (t && t !== name) ? t : null;
}

// Roll a duplicate rep into the canonical name and drop the duplicate.
// Returns true if anything actually changed. BAD's values overwrite
// GOOD's where present, since BAD typically holds the more deliberate
// assignment (team-upload SQL) while GOOD's values may have been auto-
// populated by a CSV ingest or the bulk untagged→rookie script.
// Records the bad→good mapping in `_indicatorRepAlias` so per-rep
// aggregations (sales, revenue, rankings) treat BAD's sales as GOOD's
// — no double counting even when the CSV still contains BAD's rows.
function mergeDuplicateRep(bad, good) {
  if (!bad || !good || bad === good) return false;
  // Set the alias first. If BAD was itself the target of an existing
  // alias chain (rare but possible), we'd skip — that means BAD is
  // already canonical, and we should be merging away from it.
  if (!state._indicatorRepAlias) state._indicatorRepAlias = {};
  state._indicatorRepAlias[bad] = good;
  logActivity('team_change', { detail: 'Merged rep "' + bad + '" into "' + good + '"' });
  // Collapse chains: any alias that previously pointed to BAD now
  // points directly at GOOD, so canonical resolution stays one-hop.
  Object.keys(state._indicatorRepAlias).forEach(k => {
    if (state._indicatorRepAlias[k] === bad) state._indicatorRepAlias[k] = good;
  });

  const mapKeys = ['_indicatorRepTier', '_indicatorRepOffice', '_indicatorRepActive'];
  let changed = true;  // setting the alias always counts as a change
  mapKeys.forEach(key => {
    const m = state[key] = state[key] || {};
    if (m[bad] !== undefined) {
      m[good] = m[bad];
      delete m[bad];
    }
    _invalidateRepSigIndex(m);
  });
  // Team assignments are per-year — merge BAD→GOOD in every year's map.
  _allTeamYearMaps().forEach(m => {
    if (m[bad] !== undefined) { m[good] = m[bad]; delete m[bad]; }
    _invalidateRepSigIndex(m);
  });
  saveDemoData();
  if (typeof saveIndicatorConfigToSupabase === 'function') saveIndicatorConfigToSupabase().catch(() => {});
  return changed;
}

// Mark a (bad, good) pair as dismissed so it stops surfacing in the
// duplicate scanner. Persisted to localStorage via saveIndicatorState
// so the dismissal sticks across reloads.
function dismissDuplicateRepPair(bad, good) {
  if (!state._indicatorDismissedDupes) state._indicatorDismissedDupes = [];
  const key = bad + '||' + good;
  if (!state._indicatorDismissedDupes.includes(key)) {
    state._indicatorDismissedDupes.push(key);
    saveDemoData();
    if (typeof saveIndicatorConfigToSupabase === 'function') saveIndicatorConfigToSupabase().catch(() => {});
  }
}

// Build indicator-shaped rows aggregated by an arbitrary key (branch, team, …).
//   - applyExclusion: drop reps on excluded teams. Team view → true, branch view → false.
//   - pestExcludeRegex: strip subscription types from the avg_initial calc.
//     Team view passes the strict regex (Sentricon + German Roach + Interior
//     Flea); branch view passes null so the column is a true "Avg Initial"
//     across every account type with no carve-outs.
function aggregateRawSalesByGroup(rawSales, getGroupKey, indicatorRowsForDates, applyExclusion = false, pestExcludeRegex = null) {
  const weekMeta = {};
  (indicatorRowsForDates || []).forEach(r => {
    if (weekMeta[r.week]) return;
    weekMeta[r.week] = { date: r.date, iso_start: r.iso_start };
  });

  const groups = {}; // key = groupKey + '|' + week
  (rawSales || []).forEach(s => {
    if (!s.rep) return;
    if (applyExclusion && isRepExcluded(s.rep)) return; // team view only
    const groupKey = getGroupKey(s);
    if (!groupKey) return;
    const key = groupKey + '|' + s.week;
    if (!groups[key]) groups[key] = { groupKey, week: s.week, sales: [] };
    groups[key].sales.push(s);
  });

  return Object.values(groups).map(g => {
    const ss = g.sales;
    const count = ss.length;
    const revenue = ss.reduce((a, s) => a + (Number(s.contractValue) || 0), 0);
    const pest = pestExcludeRegex ? ss.filter(s => !pestExcludeRegex.test(s.subscription || '')) : ss;
    const avgInit = pest.length > 0 ? pest.reduce((a, s) => a + (Number(s.initialPrice) || 0), 0) / pest.length : 0;
    const multiYears = ss.filter(s => myBucketOf(s) === 'multi').length;
    const twelveMonth = ss.filter(s => myBucketOf(s) === 'twelve').length;
    const autoPayCount = ss.filter(s => s.autoPay && s.autoPay !== 'No').length;
    const auditFail = ss.filter(s => /failed\s*audit/i.test(s.customerFlags || '')).length;
    const lastResort = ss.filter(s => (Number(s.initialPrice) || 0) < 99).length;
    const uniqueReps = new Set(ss.map(s => s.rep).filter(Boolean)).size;
    const meta = weekMeta[g.week] || {};
    return {
      week: g.week,
      date: meta.date || '',
      iso_start: meta.iso_start || null,
      branch: g.groupKey, // reuse 'branch' field — the rest of the page reads it generically
      sold_accounts: count,
      revenue,
      avg_initial: avgInit,
      avg_initial_count: pest.length,
      auto_pay_pct: count > 0 ? autoPayCount / count : 0,
      audit_fail: auditFail, // accounts flagged Failed Audit (for Audit % rollups)
      last_resort: lastResort, // accounts with initial < $99 (for Last Resort % rollups)
      multi_years: multiYears,
      twelve_month: twelveMonth,
      reps: uniqueReps,
    };
  });
}
// Bucket-axis variant of aggregateRawSalesByGroup — same output row shape,
// but rows are keyed by BUCKET ordinal (day / month buckets from
// getChartBuckets) instead of the CSV week number, so the trend charts can
// render daily granularity on short ranges and monthly on long ones.
function aggregateRawSalesByBucket(rawSales, getGroupKey, buckets, applyExclusion = false, pestExcludeRegex = null) {
  const groups = {};
  (rawSales || []).forEach(s => {
    if (!s.rep) return;
    if (applyExclusion && isRepExcluded(s.rep)) return;
    const groupKey = getGroupKey(s);
    if (!groupKey) return;
    for (let i = 0; i < buckets.length; i++) {
      if (!buckets[i].match(s)) continue;
      const key = groupKey + '|' + i;
      if (!groups[key]) groups[key] = { groupKey, week: i, sales: [] };
      groups[key].sales.push(s);
      break;
    }
  });
  return Object.values(groups).map(g => {
    const ss = g.sales;
    const count = ss.length;
    const revenue = ss.reduce((a, s) => a + (Number(s.contractValue) || 0), 0);
    const pest = pestExcludeRegex ? ss.filter(s => !pestExcludeRegex.test(s.subscription || '')) : ss;
    const avgInit = pest.length > 0 ? pest.reduce((a, s) => a + (Number(s.initialPrice) || 0), 0) / pest.length : 0;
    const multiYears = ss.filter(s => myBucketOf(s) === 'multi').length;
    const twelveMonth = ss.filter(s => myBucketOf(s) === 'twelve').length;
    const autoPayCount = ss.filter(s => s.autoPay && s.autoPay !== 'No').length;
    const auditFail = ss.filter(s => /failed\s*audit/i.test(s.customerFlags || '')).length;
    const lastResort = ss.filter(s => (Number(s.initialPrice) || 0) < 99).length;
    const uniqueReps = new Set(ss.map(s => s.rep).filter(Boolean)).size;
    return {
      week: g.week,
      date: buckets[g.week]?.label || '',
      iso_start: null,
      branch: g.groupKey,
      sold_accounts: count,
      revenue,
      avg_initial: avgInit,
      avg_initial_count: pest.length,
      auto_pay_pct: count > 0 ? autoPayCount / count : 0,
      audit_fail: auditFail, // accounts flagged Failed Audit (for Audit % rollups)
      last_resort: lastResort, // accounts with initial < $99 (for Last Resort % rollups)
      multi_years: multiYears,
      twelve_month: twelveMonth,
      reps: uniqueReps,
    };
  });
}

// Subscription exclusions used at the team-aggregation level — the same
// strict list rep-level analytics use, kept here so team rollups treat
// non-pest accounts the same way.
const TEAM_PEST_EXCLUDE = /sentricon|german\s*roach|interior\s*flea/i;

// Memoized per sales-array identity — indicatorSales() returns stable cached
// arrays per dept, so flipping the dept toggle reuses prior aggregations
// instead of re-rolling 100k+ rows every click.
const _aggBranchCache = new WeakMap();
function aggregateByBranch(rawSales, indicatorRowsForDates) {
  // Avg Initial: Sales Rep dept strips Sentricon/Roach/Flea (Avg Pest Initial);
  // Office Staff, Technician, and All average every account type. indicatorSales()
  // returns a distinct cached array per dept, so the WeakMap stays dept-correct.
  const pestRe = state.indicatorDept === 'd2d' ? TEAM_PEST_EXCLUDE : null;
  if (rawSales && typeof rawSales === 'object') {
    const hit = _aggBranchCache.get(rawSales);
    if (hit && hit.rows === indicatorRowsForDates) return hit.out;
    const out = aggregateRawSalesByGroup(rawSales, s => s.office || 'Unknown', indicatorRowsForDates, false, pestRe);
    _aggBranchCache.set(rawSales, { rows: indicatorRowsForDates, out });
    return out;
  }
  return aggregateRawSalesByGroup(rawSales, s => s.office || 'Unknown', indicatorRowsForDates, false, pestRe);
}
// Company view (admin-only): RPS / RPC columns; the RIDD column IS the sum.
function aggregateByCompany(rawSales, indicatorRowsForDates) {
  const pestRe = state.indicatorDept === 'd2d' ? TEAM_PEST_EXCLUDE : null;
  return aggregateRawSalesByGroup(rawSales, s => companyGroupOf(s.office), indicatorRowsForDates, false, pestRe);
}
function aggregateByTeam(rawSales, indicatorRowsForDates) {
  // Team view honors both team exclusions and the strict pest-subscription regex.
  // SALES REPS ONLY — teams are a D2D construct; office staff and technicians
  // don't get team assignments, so including their sales just piled a huge
  // fake "Unassigned" column into the view.
  const d2d = (rawSales || []).filter(s => (typeof _indicatorDeptOf !== 'function') || _indicatorDeptOf(s) === 'd2d');
  return aggregateRawSalesByGroup(d2d, s => getRepTeam(s.rep) || 'Unassigned', indicatorRowsForDates, true, TEAM_PEST_EXCLUDE);
}
// Department view — the three legs of the company as columns (Sales Rep /
// Office Staff / Technician), classified per sale by _indicatorDeptOf.
// No exclusions, plain Avg Initial (mixed service types across legs).
const DEPT_GROUP_LABELS = { d2d: 'SALES REP', office: 'OFFICE STAFF', techs: 'TECHNICIAN' };
function aggregateByDept(rawSales, indicatorRowsForDates) {
  return aggregateRawSalesByGroup(rawSales, s => DEPT_GROUP_LABELS[_indicatorDeptOf(s)] || 'OFFICE STAFF', indicatorRowsForDates, false, null);
}

// Dynamic label for the avg_initial column. "Avg Pest Initial" (strips
// Sentricon/Roach/Flea from the average) is used for the Sales Rep dept and in
// Team view; Office Staff, Technician, and All show the plain "Avg Initial".
function indicatorAvgInitialIsPest() {
  return state.indicatorsGroupBy === 'teams' || state.indicatorDept === 'd2d';
}
function indicatorMetricLabel(metric) {
  if (metric && metric.key === 'avg_initial') {
    return indicatorAvgInitialIsPest() ? 'Avg Pest Initial' : 'Avg Initial';
  }
  return metric ? metric.label : '';
}
// Teams now have an explicit registry (state._indicatorTeams) so they survive
// when no rep is assigned. distinctTeams() unions the registry + any teams
// referenced by current assignments, so legacy assignments still work even if
// they pre-date the registry.
function distinctTeams() {
  const registry = state._indicatorTeams || [];
  // Surface every currently-excluded team so users can manage them. On fresh
  // state, getExcludedTeams() seeds itself with ['Excluded']; once the user
  // removes a team it stays gone (no hardcoded re-seed here).
  const set = new Set(getExcludedTeams());
  registry.forEach(t => { if (t) set.add(t); });
  // Team NAMES are global across years, so surface any team referenced by an
  // assignment in ANY year (not just the active one).
  _allTeamYearMaps().forEach(map => Object.values(map).forEach(t => { if (t) set.add(t); }));
  return [...set].sort((a, b) => {
    const ax = isTeamExcluded(a), bx = isTeamExcluded(b);
    if (ax !== bx) return ax ? 1 : -1; // excluded teams sort last
    return a.localeCompare(b);
  });
}
// Year-scoped variant for Manage Teams. Shows the registry (so freshly-created /
// empty teams stay assignable), excluded teams (so they can still be managed),
// and ONLY the selected year's assignments — teams that exist solely in OTHER
// years' rosters drop out, so each year shows just its own teams.
function distinctTeamsForYear(year) {
  const set = new Set(getExcludedTeams());
  (state._indicatorTeams || []).forEach(t => { if (t) set.add(t); });
  const map = (state._indicatorRepTeamByYear || {})[String(year)] || {};
  Object.values(map).forEach(t => { if (t) set.add(t); });
  return [...set].sort((a, b) => {
    const ax = isTeamExcluded(a), bx = isTeamExcluded(b);
    if (ax !== bx) return ax ? 1 : -1;
    return a.localeCompare(b);
  });
}
function addTeam(name) {
  const clean = (name || '').trim();
  if (!clean) return false;
  if (!state._indicatorTeams) state._indicatorTeams = [];
  if (state._indicatorTeams.some(t => t.toLowerCase() === clean.toLowerCase())) return false;
  state._indicatorTeams.push(clean);
  logActivity('team_change', { detail: 'Team created: ' + clean });
  saveDemoData();
  return true;
}
// Team list manager (per Isaac): every team for the year with headcount,
// remove with an are-you-sure that states how many reps become untagged.
function openTeamsListModal(teamYear, onChange) {
  const overlay = el('div', { class: 'modal-overlay' });
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  const card = el('div', { class: 'card w-full max-w-md my-8 overflow-hidden flex flex-col', style: { maxHeight: 'calc(100vh - 64px)' } });
  overlay.append(card);
  const yearMap = (state._indicatorRepTeamByYear || {})[String(teamYear)] || {};
  const countIn = (t) => Object.values(yearMap).filter(v => v === t).length;
  const countAll = (t) => _allTeamYearMaps().reduce((n, m) => n + Object.values(m).filter(v => v === t).length, 0);
  const askRemove = (t) => {
    const here = countIn(t), everywhere = countAll(t);
    const ov = el('div', { class: 'modal-overlay', style: { zIndex: '2100' } });
    ov.append(el('div', { class: 'card w-full max-w-sm p-5 flex flex-col gap-3' },
      el('h3', { class: 'text-base font-bold' }, 'Remove “' + t + '”?'),
      el('p', { class: 'text-sm' }, here
        ? here + ' rep' + (here === 1 ? '' : 's') + ' in ' + teamYear + ' will move to untagged.'
        : 'No reps are on this team in ' + teamYear + ' — nobody moves to untagged.'),
      everywhere > here ? el('p', { class: 'text-[11px] text-muted-' }, (everywhere - here) + ' assignment' + (everywhere - here === 1 ? '' : 's') + ' in other years will be cleared too.') : null,
      el('div', { class: 'flex justify-end gap-2 mt-1' },
        el('button', { class: 'rounded-lg border px-2.5 py-1 text-[11px] font-semibold', style: { borderColor: 'var(--border-2)' }, onclick: () => ov.remove() }, 'Cancel'),
        el('button', { class: 'rounded-lg px-2.5 py-1 text-[11px] font-bold', style: { background: '#DC2626', color: '#fff' },
          onclick: () => { removeTeam(t); ov.remove(); if (state._indicatorManageTeamFilter === t) state._indicatorManageTeamFilter = ''; draw(); if (typeof onChange === 'function') onChange(); toast('Team removed: ' + t, 'success'); } }, 'Yes, remove'))));
    document.body.append(ov);
  };
  const draw = () => {
    card.innerHTML = '';
    const teams = distinctTeamsForYear(teamYear).filter(t => t !== '(unassigned)');
    card.append(
      el('div', { class: 'flex items-center justify-between px-5 py-4 border-b', style: { borderColor: 'var(--border)' } },
        el('div', {}, el('h2', { class: 'text-base font-bold' }, 'Teams · ' + teamYear), el('div', { class: 'text-[11px] text-muted-' }, teams.length + ' team' + (teams.length === 1 ? '' : 's'))),
        el('button', { class: 'rounded-lg border px-2.5 py-1 text-[11px]', style: { borderColor: 'var(--border-2)' }, onclick: () => overlay.remove() }, 'Done')),
      (() => {
        const inp = el('input', { type: 'text', placeholder: 'New team name', class: 'flex-1 rounded-lg border px-2.5 py-1 text-[11px]', style: { borderColor: 'var(--border-2)', background: 'var(--card)', color: 'var(--text)' },
          onkeydown: (e) => { if (e.key === 'Enter') add(); } });
        const add = () => {
          const name = inp.value.trim(); if (!name) return;
          if (!addTeam(name)) { toast('Team already exists', 'warn'); return; }
          inp.value = ''; draw(); if (typeof onChange === 'function') onChange(); toast('Team added: ' + name, 'success');
          setTimeout(() => { const i = card.querySelector('input[placeholder="New team name"]'); if (i) i.focus(); }, 0);
        };
        return el('div', { class: 'flex items-center gap-2 px-5 py-3 border-b', style: { borderColor: 'var(--border)', background: 'var(--card-2)' } }, inp,
          el('button', { class: 'rounded-lg px-2.5 py-1 text-[11px] font-bold', style: { background: 'var(--accent)', color: 'var(--accent-text)' }, onclick: add }, '+ Add'));
      })(),
      el('div', { class: 'overflow-y-auto flex-1' },
        ...teams.map(t => {
          const n = countIn(t);
          return el('div', { class: 'flex items-center gap-3 px-5 py-2.5 border-b', style: { borderColor: 'var(--border)' } },
            el('div', { class: 'flex-1 min-w-0' },
              el('div', { class: 'text-sm font-semibold truncate' }, t, isTeamExcluded(t) ? el('span', { class: 'ml-2 text-[9px] uppercase tracking-wider font-bold', style: { color: '#DC2626' } }, 'excluded') : null),
              el('div', { class: 'text-[11px] text-muted-' }, n ? n + ' rep' + (n === 1 ? '' : 's') : 'empty')),
            el('button', { class: 'rounded-lg px-2.5 py-1 text-[11px] font-semibold border', style: { color: '#DC2626', borderColor: 'rgba(220,38,38,.35)' }, onclick: () => askRemove(t) }, 'Remove'));
        })));
  };
  draw();
  document.body.append(overlay);
}
function removeTeam(name) {
  if (!name) return;
  if (state._indicatorTeams) {
    state._indicatorTeams = state._indicatorTeams.filter(t => t !== name);
  }
  // Unassign any rep currently on that team — across every year.
  _allTeamYearMaps().forEach(map => { Object.keys(map).forEach(r => { if (map[r] === name) delete map[r]; }); _invalidateRepSigIndex(map); });
  // Drop from the excluded list too — no orphaned exclusion entries.
  if (Array.isArray(state._indicatorExcludedTeams)) {
    state._indicatorExcludedTeams = state._indicatorExcludedTeams.filter(t => t !== name);
  }
  // And from every competition's exclusion list.
  getIndicatorCompetitions().forEach(c => { c.excludedTeams = c.excludedTeams.filter(t => t !== name); });
  logActivity('team_change', { detail: 'Team deleted: ' + name });
  saveDemoData();
}
function renameTeam(oldName, newNameRaw) {
  const newName = (newNameRaw || '').trim();
  if (!oldName) return { ok: false, error: 'Missing team name' };
  if (!newName) return { ok: false, error: 'Name required' };
  if (newName === oldName) return { ok: true, noop: true };
  // Case-insensitive duplicate check (allow case-only changes of the same team)
  const others = (state._indicatorTeams || []).filter(t => t !== oldName);
  if (others.some(t => t.toLowerCase() === newName.toLowerCase())) return { ok: false, error: 'Another team with that name already exists' };
  // Rename in the registry, preserving order
  if (!state._indicatorTeams) state._indicatorTeams = [];
  state._indicatorTeams = state._indicatorTeams.map(t => t === oldName ? newName : t);
  logActivity('team_change', { detail: 'Team renamed: ' + oldName + ' → ' + newName });
  // Rename in every rep assignment, across every year.
  _allTeamYearMaps().forEach(map => { Object.keys(map).forEach(r => { if (map[r] === oldName) map[r] = newName; }); _invalidateRepSigIndex(map); });
  // Carry the rename into the modal's active filter so the filter doesn't break
  if (state._indicatorManageTeamFilter === oldName) state._indicatorManageTeamFilter = newName;
  if (state._indicatorRepTeamFilter === oldName)   state._indicatorRepTeamFilter   = newName;
  // Carry the rename into the excluded-teams list so the exclusion follows.
  if (Array.isArray(state._indicatorExcludedTeams)) {
    state._indicatorExcludedTeams = state._indicatorExcludedTeams.map(t => t === oldName ? newName : t);
  }
  // And into every competition's exclusion list.
  getIndicatorCompetitions().forEach(c => { c.excludedTeams = c.excludedTeams.map(t => t === oldName ? newName : t); });
  saveDemoData();
  return { ok: true };
}

function openManageTeamsModal() { return manageTeamsPanel({ embedded: false }); }

// 🏆 Power Ranking scoring picker — a dropdown listing every office (Branch
// mode) or team (Teams mode) with a checkbox: unchecked = still on the board,
// but earns no ranking points. Follows the Indicators page's current
// grouping; a Branch/Teams toggle inside lets an admin edit either list.
function powerRankPickerBtn() {
  const wrap = el('div', { style: { position: 'relative' } });
  let mode = _rankExcludeMode();
  const panel = el('div', {
    class: 'card',
    style: { position: 'absolute', right: '0', top: 'calc(100% + 6px)', zIndex: '70', minWidth: '270px', maxHeight: '340px', overflowY: 'auto', padding: '6px', boxShadow: 'var(--shadow-lg)', display: 'none' },
  });
  const titleCase = (x) => String(x || '').split(' ').map(w => w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w).join(' ');
  const optionsFor = (m) => {
    if (m === 'teams') {
      const map = (typeof _activeTeamMap === 'function') ? _activeTeamMap() : (state._indicatorRepTeam || {});
      return [...new Set(Object.values(map).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    }
    return [...new Set((state._indicatorRawSales || []).map(r => r.office).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  };
  const paint = () => {
    const store = state._indicatorRankExclude || {};
    const excluded = new Set((store[mode] || []).filter(n => !/^office\s*-\s*\d/i.test(String(n || '').trim())));
    const opts = optionsFor(mode);
    panel.innerHTML = '';
    panel.append(
      el('div', { class: 'flex items-center justify-between gap-2 px-2 py-1.5' },
        el('span', { class: 'text-[10px] uppercase tracking-widest font-semibold whitespace-nowrap', style: { color: 'var(--text-subtle)' } }, 'Power Ranking'),
        el('div', { class: 'inline-flex rounded-lg border overflow-hidden shrink-0', style: { borderColor: 'var(--border-2)' } },
          ...[['branch', 'Offices'], ['teams', 'Teams']].map(([v, l]) => el('button', {
            class: 'px-2.5 py-1 text-[10px] font-semibold transition',
            style: mode === v ? { background: 'var(--accent)', color: 'var(--accent-text)' } : { color: 'var(--text-muted)' },
            onclick: (e) => { e.stopPropagation(); mode = v; paint(); },
          }, l)))),
      el('button', {
        class: 'text-[10px] font-semibold px-2 py-1', style: { color: 'var(--accent)', cursor: 'pointer' },
        onclick: (e) => {
          e.stopPropagation();
          if (!state._indicatorRankExclude) state._indicatorRankExclude = {};
          state._indicatorRankExclude[mode] = [];
          saveDemoData();
          if (typeof saveIndicatorConfigToSupabase === 'function') saveIndicatorConfigToSupabase().catch(() => {});
          paint();
        },
      }, 'Include all'),
      ...opts.map(b => {
        const out = excluded.has(b);
        return el('label', {
          class: 'flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer text-xs',
          style: { color: 'var(--text)' },
          title: out ? 'Excluded from the Power Ranking' : '',
        },
          (() => { const cb = el('input', { type: 'checkbox', onchange: (e) => {
            e.stopPropagation();
            if (!state._indicatorRankExclude) state._indicatorRankExclude = {};
            const cur = new Set(state._indicatorRankExclude[mode] || []);
            if (cur.has(b)) cur.delete(b); else cur.add(b);
            state._indicatorRankExclude[mode] = [...cur];
            logActivity('config_change', { detail: 'Power Ranking ' + (cur.has(b) ? 'excluded' : 'included') + ' ' + mode + ': ' + b });
            saveDemoData();
            if (typeof saveIndicatorConfigToSupabase === 'function') saveIndicatorConfigToSupabase().catch(() => {});
            paint();
          } }); cb.checked = !out; return cb; })(),
          el('span', { class: 'truncate', style: out ? { opacity: '.45', textDecoration: 'line-through' } : {} }, titleCase(b)));
      }),
      opts.length ? null : el('div', { class: 'px-2 py-2 text-[11px] italic', style: { color: 'var(--text-muted)' } }, 'Nothing to list yet.'));
  };
  const btn = el('button', {
    class: 'rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition hover:brightness-95',
    style: { borderColor: 'var(--border-2)', color: 'var(--text)' },
    title: 'Power Ranking — choose which offices / teams are scored',
    onclick: (e) => {
      e.stopPropagation();
      const open = panel.style.display === 'block';
      if (open) { panel.style.display = 'none'; return; }
      paint();
      panel.style.display = 'block';
      if (typeof clampDropdownPanel === 'function') clampDropdownPanel(panel);
      const closer = (ev) => { if (!panel.contains(ev.target) && !btn.contains(ev.target)) { panel.style.display = 'none'; document.removeEventListener('mousedown', closer); } };
      setTimeout(() => document.addEventListener('mousedown', closer), 0);
    },
  }, '\ud83c\udfc6');   // icon only (per Isaac) — the title carries the label
  wrap.append(btn, panel);
  return wrap;
}
