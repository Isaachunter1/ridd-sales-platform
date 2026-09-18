// ┌─ src/62-manage-teams.js ─────────────────────────────────────────────────────
// │ Manage Teams roster (teams per year, tiers, active flags, logos, exclusions).
// │ Part of the app.js bundle (tools/bundle.js concatenates src/*.js in name order).
// └────────────────────────────────────────────────────────────────────────
// Core builder for the Manage Teams UI.
//   embedded:false → floating modal (launched from the Audit view).
//   embedded:true  → returns a plain in-page card for the Settings ▸ Teams tab
//                    (no overlay, no "Done" button).
function manageTeamsPanel(opts) {
  const embedded = !!(opts && opts.embedded);
  const overlay = embedded ? null : el('div', { class: 'modal-overlay' });
  // Closing the modal also re-renders the app shell so any color / team
  // assignment / tier change the admin made in here is reflected in the
  // tables and charts behind it. Without this the modal-local render()
  // updates the modal preview only. (Embedded mode has no close button —
  // the local render() rebuilds the panel in place.)
  const close = embedded ? null : () => { overlay.remove(); mountApp(); };
  if (overlay) overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  const card = embedded
    ? el('div', { class: 'card overflow-hidden flex flex-col', style: { maxHeight: 'calc(100vh - 220px)' } })
    : el('div', { class: 'card w-full max-w-2xl my-8 overflow-hidden flex flex-col', style: { maxHeight: 'calc(100vh - 64px)' } });

  const render = () => {
    const rawSales = indicatorSales();
    // Teams are now YEAR-SCOPED. Point the legacy team map at the selected
    // year and build the roster for THAT year only: (1) every rep with a
    // D2D sale in the selected year, plus (2) anyone already assigned a team
    // in that year (so deliberate assignments stay visible before a sale
    // lands). This makes the "(unassigned)" chip read as "sold this year but
    // not on a team yet" — i.e. exactly who still needs a team for the year.
    _activeTeamMap();
    const teamYear = Number(_teamYearKey());
    const d2dRepsThisYear = rawSales.filter(s => {
      if (_indicatorDeptOf(s) !== 'd2d' || !s.rep) return false;
      const d = _parseIndicatorDay(s);
      return d && d.getFullYear() === teamYear;
    }).map(s => s.rep).filter(Boolean);
    // Also pull D2D sellers for this year straight from the CRM sync
    // (FieldRoutes), mapped to their CRM employee name. The uploaded indicator
    // CSV can be a partial window, so this fills in everyone who actually sold
    // that year per the live data. Matched by name signature so we only ADD
    // reps the CSV/assignments don't already cover (no duplicates, and existing
    // team/tier assignments under their current name are preserved).
    const _rosterSig = (n) => String(n || '').toLowerCase().replace(/[.,]/g, ' ').split(/\s+/).filter(Boolean).sort().join(' ');
    const _empByIdRoster = new Map((state.frRoster || []).map(e => [String(e.employee_id), e]));
    const baseReps = [...d2dRepsThisYear, ...Object.keys(state._indicatorRepTeam || {})];
    const haveSig = new Set(baseReps.map(_rosterSig));
    const crmExtra = [];
    (state.reportingSubscriptions || []).forEach(r => {
      const sd = Date.parse(r.sold_date || String(r.sold_at || '').slice(0, 10));
      if (isNaN(sd) || new Date(sd).getFullYear() !== teamYear) return;
      const src = (typeof reportingSourceOf === 'function') ? reportingSourceOf(r) : (r.source || '');
      if (!/door/i.test(String(src))) return;  // D2D sellers only
      const e = _empByIdRoster.get(String(r.sold_by_id || '').trim());
      const nm = e ? _frEmpName(e) : '';
      if (!nm) return;
      const s = _rosterSig(nm);
      if (haveSig.has(s)) return;
      haveSig.add(s); crmExtra.push(nm);
    });
    const reps = [...new Set([...baseReps, ...crmExtra])].sort();
    const teams = distinctTeamsForYear(teamYear);

    // Rep TYPE — cross-referenced from the Customer Report uploaded on the
    // Reporting tab (its "Sold By Type" column: Sales Rep / Office Staff /
    // Technician). Matched to each Manage-Teams rep by a format-agnostic name
    // signature so "Last, First" and "First Last" line up.
    const _nameSig = (n) => String(n || '').toLowerCase().replace(/[.,]/g, ' ').split(/\s+/).filter(Boolean).sort().join(' ');
    let _typeBySig = {};
    if ((state.reportingSubscriptions || []).length) {
      for (const r of state.reportingSubscriptions) {
        const t = (r.sold_by_type || '').trim();
        if (!r.sold_by || !t) continue;
        const k = _nameSig(getCanonicalRepName(r.sold_by));
        if (k && !_typeBySig[k]) _typeBySig[k] = t;
      }
      state._indicatorRepTypeBySig = _typeBySig; // keep the persisted copy fresh
    } else {
      // Report rows aren't in memory (they don't survive a refresh) — fall back
      // to the small persisted map built when the report was last loaded.
      _typeBySig = state._indicatorRepTypeBySig || {};
    }
    const hasTypeData = Object.keys(_typeBySig).length > 0;
    const repTypeOf = (rep) => _typeBySig[_nameSig(rep)] || 'Unknown';
    const repTypesPresent = (() => {
      const s = new Set(reps.map(repTypeOf));
      return ['Sales Rep', 'Office Staff', 'Technician'].filter(t => s.has(t)).concat(s.has('Unknown') ? ['Unknown'] : []);
    })();
    // Years available in the Team-Year selector: every year present in the
    // uploaded sales + every year that already has assignments + the current
    // year, newest first.
    const teamYearOptions = (() => {
      const ys = new Set([new Date().getFullYear()]);
      for (const s of rawSales) { const d = _parseIndicatorDay(s); if (d) ys.add(d.getFullYear()); }
      Object.keys(state._indicatorRepTeamByYear || {}).forEach(y => { if (/^\d{4}$/.test(y)) ys.add(Number(y)); });
      return [...ys].sort((a, b) => b - a);
    })();

    const search = state._indicatorTeamSearch || '';
    const teamSelect = state._indicatorManageTeamFilter || ''; // '' = all, '(unassigned)' = no team
    // Tier filter is independent of the team filter — admin can cross them
    // (e.g. "show me Avanti's rookies") or use them separately. '' = all,
    // 'untagged' = reps with no tier set.
    const tierSelect = state._indicatorManageTierFilter || '';
    // Active/Inactive filter — '' = all, 'active' = only Active reps,
    // 'inactive' = only reps the admin flipped Inactive in this modal.
    const activeSelect = state._indicatorManageActiveFilter || '';
    // Rep-type filter — '' = all, else a "Sold By Type" value from the
    // Customer Report (Sales Rep / Office Staff / Technician / Unknown).
    const typeSelect = state._indicatorManageTypeFilter || '';
    // Branch filter — '' = all, else a primary-office name. Lets the admin
    // view the roster one branch at a time.
    const branchSelect = state._indicatorManageBranchFilter || '';

    // Counts per team for the summary chips. Aliased (merged-into-
    // another-rep) reps are excluded so the chip counts reflect unique
    // reps only — otherwise a merged rep would inflate both its old
    // team's count AND its canonical name's count.
    const isAlias = (name) => !!getRepAliasTarget(name);
    const counts = {};
    reps.forEach(r => {
      if (isAlias(r)) return;
      const t = getRepTeam(r) || '(unassigned)';
      counts[t] = (counts[t] || 0) + 1;
    });
    // Counts per tier for the second filter row — same exclusion.
    const tierCounts = { rookie: 0, vet: 0, untagged: 0 };
    reps.forEach(r => {
      if (isAlias(r)) return;
      const t = getRepTier(r);
      if (t === 'rookie') tierCounts.rookie++;
      else if (t === 'vet') tierCounts.vet++;
      else tierCounts.untagged++;
    });
    // Last active (per Isaac): each rep's most recent sold date in the
    // shared dataset — shown under the Active/Inactive badge.
    const _lastSale = new Map();
    try {
      for (const sale of (state._indicatorRawSales || [])) {
        const d = _parseIndicatorDay(sale); if (!d) continue;
        const nm = getCanonicalRepName(sale.rep);
        const prev = _lastSale.get(nm);
        if (!prev || d > prev) _lastSale.set(nm, d);
      }
    } catch (e) { /* dataset not loaded yet */ }
    const _lastSaleOf = (name) => _lastSale.get(name) || _lastSale.get(getCanonicalRepName(name)) || null;
    const _fmtLast = (d) => { if (!d) return 'no sales'; const days = Math.round((Date.now() - d.getTime()) / 86400000); return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) + (days <= 0 ? ' · today' : days === 1 ? ' · yesterday' : days < 60 ? ' · ' + days + 'd ago' : ''); };
    // Active vs Inactive counts for the status filter chips below.
    const activeCounts = { active: 0, inactive: 0 };
    reps.forEach(r => {
      if (isAlias(r)) return;
      if (isRepActive(r)) activeCounts.active++;
      else                activeCounts.inactive++;
    });
    // Counts per rep-type (from the Customer Report) for the Rep Type chips.
    const typeCounts = {};
    reps.forEach(r => { if (isAlias(r)) return; const t = repTypeOf(r); typeCounts[t] = (typeCounts[t] || 0) + 1; });

    // For each rep, figure out their primary office (most-frequent office across
    // their sales). Read-only — purely informational so admins can sanity-check
    // the assignment before tagging a tier or team.
    const repToOffice = {};
    rawSales.forEach(s => {
      if (!s.rep || !s.office) return;
      if (!repToOffice[s.rep]) repToOffice[s.rep] = {};
      repToOffice[s.rep][s.office] = (repToOffice[s.rep][s.office] || 0) + 1;
    });
    // Branch comes from the FieldRoutes employee record — where the rep's
    // account is housed — matched by name signature. Authoritative most of the
    // time (a rep who switches markets keeps their original housing office, but
    // that's the right read the large majority of the time). Built from the CRM
    // roster, which loads in the background below if it isn't in memory yet.
    // office_name can be a comma-joined list when a rep is tied to several
    // offices (regional managers, roaming reps). Take just the FIRST = their
    // main/home branch, so the table shows a single branch per rep.
    const _mainBranch = (off) => String(off || '').split(',')[0].trim();
    const _officeBySig = {};
    (state.frRoster || []).forEach(e => {
      const off = _mainBranch(e && e.office_name); if (!off) return;
      [(typeof _frEmpName === 'function') ? _frEmpName(e) : '', (typeof _frRealName === 'function') ? _frRealName(e) : '']
        .forEach(nm => { const s = _nameSig(nm); if (s && !_officeBySig[s]) _officeBySig[s] = off; });
    });
    const primaryOffice = (rep) => {
      // 1) FieldRoutes employee office (where the account lives) — authoritative.
      const frOff = _officeBySig[_nameSig(rep)];
      if (frOff) return frOff;
      // 2) Fall back to the office derived from the rep's actual sales.
      const entries = Object.entries(repToOffice[rep] || {});
      if (entries.length) return entries.sort((a, b) => b[1] - a[1])[0][0];
      // 3) Last resort: the manual map (team-upload Market column).
      return getRepOffice(rep) || '';
    };
    const titleCase = (s) => (s || '').split(' ').map(w => w[0]?.toUpperCase() + w.slice(1).toLowerCase()).join(' ');

    // Per-branch counts for the Branch filter chips (alias rows excluded,
    // matching the other chip rows). Branch = the rep's primary office,
    // NORMALIZED to one canonical key — the three office sources disagree on
    // format (CRM roster "Atlanta" / multi-office "Atlanta, Detroit" vs
    // sales-data "ATLANTA"), which was rendering duplicate dropdown entries
    // like "Atlanta · 2" AND "Atlanta · 283". Multi-office people count
    // under their FIRST listed office.
    const _normBranch = (b) => String(b || '').split(',')[0].trim().toUpperCase();
    const branchCounts = {};
    reps.forEach(r => { if (isAlias(r)) return; const b = _normBranch(primaryOffice(r)) || '(no branch)'; branchCounts[b] = (branchCounts[b] || 0) + 1; });
    const branchesPresent = Object.keys(branchCounts).sort();

    let filteredReps = reps;
    // (Team filter retired — the list is grouped by team instead.)
    if (tierSelect) {
      filteredReps = filteredReps.filter(r => {
        const t = getRepTier(r);
        if (tierSelect === 'untagged') return !t;
        return t === tierSelect;
      });
    }
    if (activeSelect === 'active') {
      filteredReps = filteredReps.filter(r => isRepActive(r));
    } else if (activeSelect === 'inactive') {
      filteredReps = filteredReps.filter(r => !isRepActive(r));
    }
    if (typeSelect) {
      filteredReps = filteredReps.filter(r => repTypeOf(r) === typeSelect);
    } else {
      // DEFAULT: teams are a Sales-Rep construct — known Office Staff and
      // Technicians stay out of the roster (accounts mis-sourced as Door to
      // Door were sneaking techs in here). 'Unknown' types stay visible so
      // unmatched sales reps can still be assigned. Pick the Office Staff /
      // Technician chip to see those groups explicitly.
      filteredReps = filteredReps.filter(r => { const t = repTypeOf(r); return t !== 'Office Staff' && t !== 'Technician'; });
    }
    if (branchSelect) {
      filteredReps = filteredReps.filter(r => (_normBranch(primaryOffice(r)) || '(no branch)') === branchSelect);
    }
    // ── Sort (Name / Tier / Team) — click a column header to group. In
    // ascending order the blanks float to the top (Untagged tier, Unassigned
    // team) so the unassigned are easy to find.
    const _mtSortCol = state._manageTeamsSort || 'name';
    const _mtSortDir = state._manageTeamsSortDir || 'asc';
    const _tierRank = (r) => { const t = getRepTier(r); return t === 'vet' ? 2 : t === 'rookie' ? 1 : 0; };
    const _mtCmp = {
      name: (a, b) => a.localeCompare(b),
      tier: (a, b) => (_tierRank(a) - _tierRank(b)) || a.localeCompare(b),
      team: (a, b) => String(getRepTeam(a) || '').localeCompare(String(getRepTeam(b) || '')) || a.localeCompare(b),
    }[_mtSortCol] || ((a, b) => a.localeCompare(b));
    filteredReps = filteredReps.slice().sort(_mtCmp);
    if (_mtSortDir === 'desc') filteredReps.reverse();
    // Untagged reps FIRST (per Isaac) — anyone with no team or no tier floats
    // to the top of the list, whatever the sort, so they're the first thing
    // fixed. Within each group the chosen sort still applies.
    {
      const _needs = (n) => !getRepTeam(n) || !getRepTier(n);
      const top = filteredReps.filter(_needs), rest = filteredReps.filter(n => !_needs(n));
      filteredReps = [...top, ...rest];
      state._mtUntaggedFirstCount = top.length;
    }
    // NOTE: the search box is applied client-side (show/hide rows) so typing
    // never triggers a full re-render — see applyRepSearch() below.

    // Header = three tidy rows (per Isaac): title + Year / tools / Done on
    // top, the filter pills on one row beneath, and the rep search spanning
    // the full width under that.
    const headerFilterSlot = el('div', { class: 'w-full flex flex-wrap items-center gap-x-2.5 gap-y-2' });
    const headerSearchSlot = el('div', { class: 'w-full' });
    const header = el('div', { class: 'flex flex-col px-5 py-3 border-b gap-2.5', style: { borderColor: 'var(--border)' } },
      el('div', { class: 'flex items-center gap-3 w-full' },
      el('h2', {
        class: 'text-base font-bold whitespace-nowrap',
        title: 'Teams are tracked per year — the roster reflects the selected Year. Tiers auto-set from sales history (first season = Rookie, returning = Vet); tagging overrides — Vet is permanent, Rookie applies to the year tagged and auto-promotes when they return. Click a team to rename it, pick a color, or toggle Exclude from metrics.',
      }, 'Manage Teams'),
      el('div', { class: 'flex items-center gap-2 shrink-0 ml-auto' },
        // Team Year — assignments are stored per calendar year, so this picks
        // which year's teams you're viewing and editing. Defaults to the
        // current year; switching it changes the roster + (unassigned) chip.
        el('div', { class: 'flex items-center gap-1.5 mr-1' },
          el('span', { class: 'text-[10px] uppercase tracking-widest font-semibold whitespace-nowrap', style: { color: 'var(--text-muted)' } }, 'Year'),
          el('select', {
            class: 'rounded-lg border px-2.5 py-1 text-[11px] font-semibold cursor-pointer',
            style: { borderColor: 'var(--border-2)', color: 'var(--text)', background: 'var(--card)' },
            title: 'Team assignments are tracked per year — pick which year to view/edit',
            onchange: (e) => { state._teamYear = e.target.value; _activeTeamMap(); saveDemoData(); render(); },
          }, ...teamYearOptions.map(y => el('option', { value: String(y), selected: String(y) === _teamYearKey() }, String(y)))),
        ),
        // (Roster .xlsx export lives inside Reports now — per Isaac.)
        // (🏷 Tiers export retired — per Isaac.)
        // Moved here from the Indicators top bar (per Isaac). Uses the
        // grouping + timeframe of the Indicators render that stashed the
        // context, so it reports on exactly what that page is showing.
        (typeof state._indTeamReportCtx === 'function') && el('button', {
          class: 'rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition hover:brightness-95',
          style: { borderColor: 'var(--border-2)', color: 'var(--text)' },
          onclick: () => {
            const ctx = state._indTeamReportCtx && state._indTeamReportCtx();
            if (!ctx) { toast('Open the Indicators tab first so the report has a timeframe', 'warn'); return; }
            openTeamReportsModal(ctx);
          },
          title: 'Reports — download PDF reports per team, per office, or per rep (pick the grouping inside), for the timeframe currently set on Indicators',
        }, '📄'),
        // 🏆 Power Ranking scoring picker — icon only, to the right of Reports (per Isaac).
        powerRankPickerBtn(),
        embedded ? null : el('button', {
          class: 'rounded-lg border px-2.5 py-1 text-[11px]',
          style: { borderColor: 'var(--border-2)' },
          onclick: close,
        }, 'Done'),
      )),
      headerFilterSlot,
      headerSearchSlot,
    );

    // ── Add team bar ──
    const newTeamInput = el('input', {
      type: 'text', placeholder: 'Add new team',
      class: 'flex-1 rounded-lg border px-2.5 py-1 text-[11px]',
      style: { borderColor: 'var(--border-2)' },
      onkeydown: (e) => { if (e.key === 'Enter') { commitNewTeam(); } },
    });
    const commitNewTeam = () => {
      const name = newTeamInput.value;
      if (!name.trim()) return;
      const ok = addTeam(name);
      if (!ok) { toast('Team already exists', 'warn'); return; }
      newTeamInput.value = '';
      render();
    };
    const addBar = el('div', { class: 'px-5 py-3 border-b flex items-center gap-2', style: { borderColor: 'var(--border)' } },
      newTeamInput,
      el('button', {
        class: 'rounded-lg px-2.5 py-1 text-[11px] font-bold',
        style: { background: 'var(--accent)', color: 'var(--accent-text)' },
        onclick: commitNewTeam,
      }, '+ Add'),
    );

    // ── Combined team chips ──
    // One row of chips serves as BOTH the rep-list filter and the entry into
    // a team's settings. Picking a real team activates the filter + opens an
    // inline detail panel below; picking "All" or "(unassigned)" only filters.
    const teamRepCount = (t) => reps.filter(r => getRepTeam(r) === t).length;
    const chipForTeam = (team, n) => {
      const isActive = teamSelect === team;
      const isReal = team !== '(unassigned)';
      // Excluded teams keep the red tint regardless of picked color so the
      // exclusion signal stays loud. Real teams use their team color so the
      // chip in the modal matches what shows up in the Indicators teams view.
      const baseStyle = isTeamExcluded(team)
        ? { background: 'rgba(220, 38, 38, .12)', color: '#DC2626', border: '1px solid transparent' }
        : team === '(unassigned)'
          ? { background: 'var(--card-2)', color: 'var(--text-muted)', border: '1px solid var(--border)' }
          : { background: getTeamColor(team), color: '#fff', border: '1px solid transparent' };
      const activeStyle = isActive ? { boxShadow: '0 0 0 2px var(--accent)', filter: 'brightness(1.05)' } : {};
      const logo = isReal ? getTeamLogo(team) : '';
      return el('button', {
        class: 'rounded-full text-[11px] font-semibold cursor-pointer transition hover:brightness-95 inline-flex items-center gap-1.5',
        // Tighter left padding when a logo is present so the chip stays compact.
        style: { ...baseStyle, ...activeStyle, padding: logo ? '2px 10px 2px 3px' : '2px 10px' },
        onclick: () => {
          state._indicatorManageTeamFilter = isActive ? '' : team;
          render();
        },
      },
        logo && el('img', {
          src: logo, alt: '',
          style: { width: '16px', height: '16px', borderRadius: '50%', objectFit: 'cover', background: '#fff', flexShrink: '0' },
        }),
        el('span', {}, team + ' · ' + n),
      );
    };
    const allActive = !teamSelect;
    // Build the chip list by union of (a) every team in distinctTeams so we
    // surface even teams with zero assigned reps, plus (b) the synthetic
    // "(unassigned)" pseudo-team if any rep lacks a team. counts already
    // covers (b); we merge teams from distinctTeams that are missing from it.
    const chipEntries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    const chipNames = new Set(chipEntries.map(([t]) => t));
    teams.forEach(t => { if (!chipNames.has(t)) chipEntries.push([t, 0]); });
    const teamChips = el('div', { class: 'px-5 py-3 border-b flex flex-wrap gap-1.5 items-center', style: { borderColor: 'var(--border)' } },
      el('button', {
        class: 'rounded-full px-2.5 py-0.5 text-[11px] font-semibold cursor-pointer transition hover:brightness-95',
        style: allActive
          ? { background: 'var(--text)', color: 'var(--card)', boxShadow: '0 0 0 2px var(--accent)' }
          : { background: 'var(--card-2)', color: 'var(--text)', border: '1px solid var(--border-2)' },
        onclick: () => { state._indicatorManageTeamFilter = ''; render(); },
      }, 'All · ' + reps.length),
      ...chipEntries.map(([team, n]) => chipForTeam(team, n)),
      (teamSelect || tierSelect) && el('span', { class: 'text-[10px] text-muted- ml-1 italic' },
        'Showing ' + filteredReps.length + ' of ' + reps.length),
    );

    // ── Tier filter chips ──
    // Lets admin slice the rep list by Rookie / Vet / Untagged independently
    // of the team filter above. Used to quickly answer "who still hasn't
    // been tagged?" without scrolling — the Untagged chip surfaces the gap
    // and its count, so it doubles as a progress signal.
    const tierChip = (id, label, color, n) => {
      const isActive = tierSelect === id;
      return el('button', {
        class: 'rounded-full text-[11px] font-semibold cursor-pointer transition hover:brightness-95 inline-flex items-center gap-1.5 px-2.5 py-0.5',
        style: isActive
          ? { background: color, color: '#fff', boxShadow: '0 0 0 2px var(--accent)' }
          : { background: 'transparent', color: color, border: '1px solid ' + color },
        onclick: () => {
          state._indicatorManageTierFilter = isActive ? '' : id;
          render();
        },
      }, label + ' · ' + n);
    };
    const allTiersActive = !tierSelect;
    const tierChips = el('div', { class: 'px-5 py-2 border-b flex flex-wrap gap-1.5 items-center', style: { borderColor: 'var(--border)' } },
      el('span', { class: 'text-[10px] uppercase tracking-widest font-semibold mr-1', style: { color: 'var(--text-muted)' } }, 'Tier'),
      el('button', {
        class: 'rounded-full px-2.5 py-0.5 text-[11px] font-semibold cursor-pointer transition hover:brightness-95',
        style: allTiersActive
          ? { background: 'var(--text)', color: 'var(--card)', boxShadow: '0 0 0 2px var(--accent)' }
          : { background: 'var(--card-2)', color: 'var(--text)', border: '1px solid var(--border-2)' },
        onclick: () => { state._indicatorManageTierFilter = ''; render(); },
      }, 'All · ' + reps.length),
      tierChip('rookie',   'Rookie',   '#5F6C5B', tierCounts.rookie),
      tierChip('vet',      'Vet',      '#DF643A', tierCounts.vet),
      tierChip('untagged', 'Untagged', '#9B6B2C', tierCounts.untagged),
    );

    // ── Active / Inactive status chips ──
    // Lets the admin see at a glance which reps they've flipped to
    // Inactive (commonly from Coach Mode's bulk action). Same pill
    // pattern as Tier, default "All" so the modal opens unfiltered.
    const activeChip = (id, label, color, n) => {
      const isOn = activeSelect === id;
      return el('button', {
        class: 'rounded-full text-[11px] font-semibold cursor-pointer transition hover:brightness-95 inline-flex items-center gap-1.5 px-2.5 py-0.5',
        style: isOn
          ? { background: color, color: '#fff', boxShadow: '0 0 0 2px var(--accent)' }
          : { background: 'transparent', color: color, border: '1px solid ' + color },
        onclick: () => {
          state._indicatorManageActiveFilter = isOn ? '' : id;
          render();
        },
      }, label + ' · ' + n);
    };
    const allActiveStates = !activeSelect;
    const activeChips = el('div', { class: 'px-5 py-2 border-b flex flex-wrap gap-1.5 items-center', style: { borderColor: 'var(--border)' } },
      el('span', { class: 'text-[10px] uppercase tracking-widest font-semibold mr-1', style: { color: 'var(--text-muted)' } }, 'Status'),
      el('button', {
        class: 'rounded-full px-2.5 py-0.5 text-[11px] font-semibold cursor-pointer transition hover:brightness-95',
        style: allActiveStates
          ? { background: 'var(--text)', color: 'var(--card)', boxShadow: '0 0 0 2px var(--accent)' }
          : { background: 'var(--card-2)', color: 'var(--text)', border: '1px solid var(--border-2)' },
        onclick: () => { state._indicatorManageActiveFilter = ''; render(); },
      }, 'All · ' + reps.length),
      activeChip('active',   'Active',   '#DF643A', activeCounts.active),
      activeChip('inactive', 'Inactive', '#DC2626', activeCounts.inactive),
    );

    // ── Rep Type chips — cross-referenced from the Customer Report ──
    // "Sold By Type" (Sales Rep / Office Staff / Technician) matched to each
    // rep by name. "Unknown" = no match in the uploaded report.
    const TYPE_COLOR = { 'Sales Rep': '#5F6C5B', 'Office Staff': '#9C3F1E', 'Technician': '#A9441F', 'Unknown': '#7C857A' };
    const typeChip = (id) => {
      const isOn = typeSelect === id;
      const color = TYPE_COLOR[id] || '#7C857A';
      return el('button', {
        class: 'rounded-full text-[11px] font-semibold cursor-pointer transition hover:brightness-95 inline-flex items-center gap-1.5 px-2.5 py-0.5',
        style: isOn
          ? { background: color, color: '#fff', boxShadow: '0 0 0 2px var(--accent)' }
          : { background: 'transparent', color: color, border: '1px solid ' + color },
        onclick: () => { state._indicatorManageTypeFilter = isOn ? '' : id; render(); },
      }, id + ' · ' + (typeCounts[id] || 0));
    };
    const typeChips = el('div', { class: 'px-5 py-2 border-b flex flex-wrap gap-1.5 items-center', style: { borderColor: 'var(--border)' } },
      el('span', { class: 'text-[10px] uppercase tracking-widest font-semibold mr-1', style: { color: 'var(--text-muted)' } }, 'Rep Type'),
      el('button', {
        class: 'rounded-full px-2.5 py-0.5 text-[11px] font-semibold cursor-pointer transition hover:brightness-95',
        style: !typeSelect
          ? { background: 'var(--text)', color: 'var(--card)', boxShadow: '0 0 0 2px var(--accent)' }
          : { background: 'var(--card-2)', color: 'var(--text)', border: '1px solid var(--border-2)' },
        onclick: () => { state._indicatorManageTypeFilter = ''; render(); },
      }, 'All · ' + reps.length),
      ...repTypesPresent.map(typeChip),
      !hasTypeData
        ? el('span', { class: 'text-[10px] text-muted- italic ml-1' }, 'Open the Reporting tab (or upload a Customer Report) to populate rep types')
        : null,
    );

    // ── Branch chips — filter the roster by the rep's primary office ──
    const branchChip = (b) => {
      const isOn = branchSelect === b;
      const color = BRANCH_COLORS[String(b).toUpperCase()] || '#7C857A';
      return el('button', {
        class: 'rounded-full text-[11px] font-semibold cursor-pointer transition hover:brightness-95 inline-flex items-center gap-1.5 px-2.5 py-0.5',
        style: isOn
          ? { background: color, color: '#fff', boxShadow: '0 0 0 2px var(--accent)' }
          : { background: 'transparent', color: color, border: '1px solid ' + color },
        onclick: () => { state._indicatorManageBranchFilter = isOn ? '' : b; render(); },
      }, titleCase(b) + ' · ' + (branchCounts[b] || 0));
    };
    const branchChips = el('div', { class: 'px-5 py-2 border-b flex flex-wrap gap-1.5 items-center', style: { borderColor: 'var(--border)' } },
      el('span', { class: 'text-[10px] uppercase tracking-widest font-semibold mr-1', style: { color: 'var(--text-muted)' } }, 'Branch'),
      el('button', {
        class: 'rounded-full px-2.5 py-0.5 text-[11px] font-semibold cursor-pointer transition hover:brightness-95',
        style: !branchSelect
          ? { background: 'var(--text)', color: 'var(--card)', boxShadow: '0 0 0 2px var(--accent)' }
          : { background: 'var(--card-2)', color: 'var(--text)', border: '1px solid var(--border-2)' },
        onclick: () => { state._indicatorManageBranchFilter = ''; render(); },
      }, 'All · ' + reps.length),
      ...branchesPresent.map(branchChip),
    );

    // ── Possible duplicates ──
    // Scans every rep name we know about for likely duplicates (prefix
    // nicknames like Josh↔Joshua, plus a small dictionary of common
    // non-prefix nicknames). Each pair gets a one-click Merge and a
    // Dismiss link (which is remembered across reloads). Hidden when
    // there's nothing to flag so the panel doesn't crowd Manage Teams.
    // Order-flips ("Aaron Morse" vs "Morse, Aaron") are the SAME name parts in
    // a different order — one human, certainly. They used to fill this list
    // 600+ deep; now they're merged silently (keeper = the "Last, First"
    // spelling the sales data uses) so only real nickname/spelling pairs
    // remain for a human to judge (per Isaac).
    let dupePairs = findDuplicateRepCandidates();
    {
      const _sig = (n) => String(n || '').toLowerCase().replace(/[.,]/g, ' ').split(/\s+/).filter(Boolean).sort().join(' ');
      const flips = dupePairs.filter(pr => _sig(pr.bad) === _sig(pr.good));
      let n = 0;
      flips.forEach(pr => {
        const goodHasComma = pr.good.includes(','), badHasComma = pr.bad.includes(',');
        const keep = (badHasComma && !goodHasComma) ? pr.bad : pr.good;
        const drop = (keep === pr.bad) ? pr.good : pr.bad;
        if (keep !== drop && mergeDuplicateRep(drop, keep)) n++;
      });
      if (n) { saveIndicatorState(); toast('Merged ' + n + ' order-flipped name' + (n === 1 ? '' : 's') + ' automatically', 'success'); dupePairs = findDuplicateRepCandidates(); }
      // ONE name shape everywhere (per Isaac): the roster shows "Last, First"
      // like FieldRoutes. Names still stored "First Last" (old team-map keys
      // with no second spelling to merge into) get renamed to that shape —
      // via the roster's lname/fname when the person is on it, else by
      // flipping a plain two-word name. Longer names not on the roster are
      // left alone (can't tell which words are the surname).
      let flipped = 0;
      const _rosterByFL = new Map();
      (state.frRoster || []).forEach(e => {
        const ln = String(e && e.lname || '').trim(), fn = String(e && (e.nickname || e.fname) || '').trim();
        if (ln && fn) _rosterByFL.set((fn + ' ' + ln).toLowerCase().replace(/[^a-z\s]/g, ''), ln + ', ' + fn);
      });
      const _allRepNames = new Set([
        ...(state._indicatorRawSales || []).map(x => x.rep).filter(Boolean),
        ...Object.keys(state._indicatorRepTier || {}), ...Object.keys(state._indicatorRepOffice || {}),
      ]);
      _allTeamYearMaps().forEach(m => Object.keys(m).forEach(k => _allRepNames.add(k)));
      _allRepNames.forEach(nm => {
        if (!nm || nm.includes(',') || getRepAliasTarget(nm)) return;
        const key = nm.toLowerCase().replace(/[^a-z\s]/g, '').replace(/\s+/g, ' ').trim();
        let tgt = _rosterByFL.get(key) || null;
        if (!tgt) {
          const parts = nm.trim().split(/\s+/);
          if (parts.length === 2) tgt = parts[1] + ', ' + parts[0];
        }
        if (tgt && tgt !== nm && mergeDuplicateRep(nm, tgt)) flipped++;
      });
      if (flipped) { saveIndicatorState(); toast('Renamed ' + flipped + ' rep' + (flipped === 1 ? '' : 's') + ' to Last, First', 'success'); dupePairs = findDuplicateRepCandidates(); }
    }
    const _dupesOpen = !!state._indicatorDupesOpen;
    const renderDupeLine = (name, includeTeam = true) => {
      const team = getRepTeam(name);
      const tier = getRepTier(name);
      const office = getRepOffice(name) || '';
      const bits = [];
      if (includeTeam && team) bits.push(team);
      if (tier) bits.push(tier === 'rookie' ? 'Rookie' : tier === 'vet' ? 'Vet' : tier);
      if (office) bits.push(office);
      return el('div', { class: 'flex flex-col min-w-0' },
        el('span', { class: 'text-sm font-semibold truncate' }, name),
        bits.length > 0 && el('span', { class: 'text-[10px] text-muted- truncate' }, bits.join(' · ')),
      );
    };
    const dupesPanel = dupePairs.length === 0 ? null : el('div', {
      class: 'border-b',
      style: { borderColor: 'var(--border)', background: _dupesOpen ? 'rgba(255, 193, 7, .06)' : 'transparent' },
    },
      // Collapsed by default — the roster below is the point of this panel.
      el('button', { class: 'w-full flex items-center justify-between gap-2 px-2.5 py-1 cursor-pointer text-[11px]', style: { background: 'transparent' },
        onclick: () => { state._indicatorDupesOpen = !_dupesOpen; render(); } },
        el('span', { class: 'text-xs font-bold uppercase tracking-widest', style: { color: '#A9441F' } },
          '⚠️ ' + dupePairs.length + ' possible duplicate' + (dupePairs.length === 1 ? '' : 's')),
        el('span', { class: 'text-[11px] text-muted-' }, _dupesOpen ? 'Hide' : 'Show')),
      !_dupesOpen ? null : el('div', { class: 'px-5 pb-3' },
      el('div', { class: 'flex items-center justify-between mb-2' },
        el('div', { class: 'flex items-center gap-2' },
          el('span', { class: 'text-[10px] text-muted- italic' },
            'Auto-detected — nickname/prefix pairs, plus same-letters spellings (\u201cLeSueur\u201d vs \u201cLe Sueur\u201d) that are SPLITTING one rep\u2019s revenue. Merge folds the left name into the right.'),
        ),
        // Order-flips ("Aaron Morse" vs "Morse, Aaron") are the SAME tokens in
        // a different order - one human, certainly, and historically the bulk
        // of this list. Clear them in one action instead of N clicks; keeper is
        // the "Last, First" form the sales data uses.
        (() => {
          const _sig = (n) => String(n || '').toLowerCase().replace(/[.,]/g, ' ').split(/\s+/).filter(Boolean).sort().join(' ');
          const flips = dupePairs.filter(pr => _sig(pr.bad) === _sig(pr.good));
          if (flips.length < 2) return null;
          return el('button', {
            class: 'rounded-lg px-2.5 py-1 text-[11px] font-bold shrink-0 transition hover:brightness-95',
            style: { background: '#A9441F', color: '#fff' },
            title: 'Same name, different word order. Keeps the "Last, First" spelling the sales data uses.',
            onclick: () => {
              if (!confirm('Merge ' + flips.length + ' name pairs that differ only in word order?\n\nExample: ' + flips[0].bad + '  ->  ' + flips[0].good + '\n\nReversible per rep from the alias list.')) return;
              let n = 0;
              flips.forEach(pr => {
                // Prefer the sales-data shape as the survivor.
                const goodHasComma = pr.good.includes(','), badHasComma = pr.bad.includes(',');
                const keep = (badHasComma && !goodHasComma) ? pr.bad : pr.good;
                const drop = (keep === pr.bad) ? pr.good : pr.bad;
                if (keep !== drop && mergeDuplicateRep(drop, keep)) n++;
              });
              saveIndicatorState();
              toast('Merged ' + n + ' order-flipped name' + (n === 1 ? '' : 's'), 'success');
              render();
            },
          }, 'Merge all ' + flips.length + ' order-flips');
        })(),
      ),
      el('div', { class: 'flex flex-col gap-1.5 overflow-y-auto', style: { maxHeight: '300px' } },
        ...dupePairs.map(({ bad, good }) => el('div', {
          class: 'flex items-center gap-2 px-2 py-2 rounded-lg',
          style: { background: 'var(--card-2)', border: '1px solid var(--border)' },
        },
          // Left side: BAD name + its assignments
          el('div', { class: 'flex-1 min-w-0' }, renderDupeLine(bad)),
          // Arrow
          el('span', { class: 'text-muted- shrink-0', style: { fontSize: '14px' } }, '→'),
          // Right side: GOOD name + its assignments
          el('div', { class: 'flex-1 min-w-0' }, renderDupeLine(good)),
          // Actions
          el('div', { class: 'flex items-center gap-1.5 shrink-0' },
            el('button', {
              class: 'rounded-lg px-2.5 py-1 text-[11px] font-bold cursor-pointer transition hover:brightness-95',
              style: { background: 'var(--accent)', color: 'var(--accent-text)' },
              title: 'Merge ' + bad + ' into ' + good + ' and remove the duplicate',
              onclick: () => {
                const ok = mergeDuplicateRep(bad, good);
                if (ok) toast('Merged ' + bad + ' → ' + good, 'success');
                else    toast('Nothing to merge for that pair', 'warn');
                render();
              },
            }, 'Merge'),
            el('button', {
              class: 'text-[10px] underline cursor-pointer',
              style: { color: 'var(--text-muted)' },
              title: 'Mark these two as NOT duplicates — stops them surfacing here',
              onclick: () => {
                dismissDuplicateRepPair(bad, good);
                toast('Dismissed ' + bad + ' / ' + good, 'info');
                render();
              },
            }, 'Not a dupe'),
          ),
        )),
      ),
      ),   // close collapsible body
    );

    // ── Inline detail panel ──
    // Shown only when a real team is selected (not "All" or "(unassigned)").
    // Combines rename + exclude toggle + remove in one place.
    let detailPanel = null;
    if (teamSelect && teamSelect !== '(unassigned)') {
      const t = teamSelect;
      const excluded = isTeamExcluded(t);
      const repCount = teamRepCount(t);

      const renameInput = el('input', {
        type: 'text', value: t,
        class: 'flex-1 rounded-lg border px-2.5 py-1 text-[11px] font-semibold',
        style: { borderColor: 'var(--border-2)' },
        onkeydown: (e) => { if (e.key === 'Enter') commitRename(); },
      });
      const commitRename = () => {
        const next = renameInput.value;
        if (next == null) return;
        const result = renameTeam(t, next);
        if (!result.ok) { toast(result.error || 'Rename failed', 'warn'); return; }
        if (!result.noop) toast('Renamed to "' + next.trim() + '"', 'success');
        state._indicatorManageTeamFilter = next.trim();
        render();
      };

      const teamColor = getTeamColor(t);
      const hasCustomColor = !!(state._indicatorTeamColors && state._indicatorTeamColors[t]);
      const teamLogo = getTeamLogo(t);

      // Hex-code input: accepts #RRGGBB (or RRGGBB). Applies on blur/Enter.
      // Lets the admin paste a brand-exact color when the palette swatches +
      // native picker aren't precise enough.
      const hexInput = el('input', {
        type: 'text', value: teamColor, maxlength: 7,
        placeholder: '#RRGGBB',
        class: 'rounded-lg border px-2.5 py-1 text-[11px] tabular-nums w-[88px]',
        style: { borderColor: 'var(--border-2)' },
      });
      const applyHex = () => {
        let v = (hexInput.value || '').trim();
        if (v && !v.startsWith('#')) v = '#' + v;
        // #RGB or #RRGGBB only
        if (!/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(v)) {
          toast('Invalid hex code — use #RRGGBB', 'warn');
          hexInput.value = teamColor;
          return;
        }
        setTeamColor(t, v);
        render();
      };
      hexInput.addEventListener('blur', applyHex);
      hexInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); applyHex(); } });

      // Hidden file input wired to a visible "Upload logo" button. The
      // uploaded image is center-cropped to a square and shrunk to 128×128
      // JPEG so the data URL stays under ~12KB per team — well within the
      // Supabase jsonb column and localStorage cache.
      const hiddenLogoFile = el('input', {
        type: 'file',
        accept: 'image/jpeg,image/png,image/gif,image/webp,image/svg+xml',
        style: { display: 'none' },
        onchange: (e) => {
          const file = e.target.files[0];
          // Always reset so re-picking the same file still fires onchange.
          e.target.value = '';
          if (!file) return;
          openLogoCropper(file, t, () => render());
        },
      });

      detailPanel = el('div', { class: 'px-5 py-3 border-b flex flex-col gap-3', style: { borderColor: 'var(--border)', background: 'var(--card-2)' } },
        // Rename row
        el('div', { class: 'flex flex-col gap-1' },
          el('div', { class: 'text-[10px] uppercase tracking-widest font-semibold text-muted-' }, 'Team name'),
          el('div', { class: 'flex items-center gap-2' },
            renameInput,
            el('button', {
              class: 'rounded-lg px-2.5 py-1 text-[11px] font-bold',
              style: { background: 'var(--accent)', color: 'var(--accent-text)' },
              onclick: commitRename,
            }, 'Save'),
          ),
        ),
        // Color picker row
        el('div', { class: 'flex flex-col gap-1' },
          el('div', { class: 'text-[10px] uppercase tracking-widest font-semibold text-muted-' }, 'Color'),
          el('div', { class: 'flex items-center gap-2 flex-wrap' },
            // Current-color swatch
            el('span', {
              class: 'inline-block rounded-full shrink-0',
              style: { width: '22px', height: '22px', background: teamColor, border: '1px solid var(--border-2)' },
              title: 'Current color: ' + teamColor + (hasCustomColor ? '' : ' (default)'),
            }),
            // Native color picker
            el('input', {
              type: 'color', value: teamColor,
              class: 'rounded-lg border cursor-pointer',
              style: { borderColor: 'var(--border-2)', width: '52px', height: '32px', padding: '2px' },
              oninput: (e) => { setTeamColor(t, e.target.value); render(); },
            }),
            // Hex-code text input
            hexInput,
            // Quick-pick swatches from the default palette
            el('div', { class: 'flex flex-wrap gap-1' },
              ...TEAM_COLOR_PALETTE.map(hex => el('button', {
                class: 'rounded-full cursor-pointer hover:brightness-110 transition shrink-0',
                style: {
                  width: '18px', height: '18px', background: hex,
                  border: hex.toLowerCase() === teamColor.toLowerCase() ? '2px solid var(--text)' : '1px solid var(--border-2)',
                },
                title: hex,
                onclick: () => { setTeamColor(t, hex); render(); },
              })),
            ),
            hasCustomColor && el('button', {
              class: 'text-[10px] underline text-muted- cursor-pointer ml-auto',
              title: 'Reset to the auto-assigned default color',
              onclick: () => { setTeamColor(t, ''); render(); },
            }, 'Reset'),
          ),
        ),
        // Logo upload row
        el('div', { class: 'flex flex-col gap-1' },
          el('div', { class: 'text-[10px] uppercase tracking-widest font-semibold text-muted-' }, 'Logo'),
          el('div', { class: 'flex items-center gap-3 flex-wrap' },
            // Logo preview (large square — falls back to color dot if no logo)
            teamLogo
              ? el('img', {
                  src: teamLogo, alt: t + ' logo',
                  style: {
                    width: '44px', height: '44px', borderRadius: '0',
                    objectFit: 'cover', background: '#fff',
                    border: '1px solid var(--border-2)',
                  },
                })
              : el('div', {
                  style: {
                    width: '44px', height: '44px', borderRadius: '0',
                    background: teamColor, color: '#fff',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontWeight: '700', fontSize: '14px',
                    border: '1px solid var(--border-2)',
                  },
                  title: 'No logo yet — falls back to the team color',
                }, (t || '?').slice(0, 1).toUpperCase()),
            hiddenLogoFile,
            el('button', {
              class: 'rounded-lg border px-2.5 py-1 text-[11px] font-semibold',
              style: { borderColor: 'var(--border-2)' },
              onclick: () => hiddenLogoFile.click(),
            }, teamLogo ? 'Replace logo' : 'Upload logo'),
            teamLogo && el('button', {
              class: 'text-[10px] underline text-muted- cursor-pointer',
              onclick: () => { setTeamLogo(t, ''); render(); },
            }, 'Remove'),
            el('div', { class: 'text-[10px] text-muted-' },
              'PNG / JPG / SVG · square cropped, ~128px stored'),
          ),
        ),
        // Exclude toggle row
        el('div', { class: 'flex items-center justify-between rounded-lg p-2.5',
          style: {
            background: excluded ? 'rgba(220, 38, 38, .08)' : 'var(--card)',
            border: '1px solid ' + (excluded ? 'rgba(220, 38, 38, .35)' : 'var(--border-2)'),
          },
        },
          el('div', { class: 'flex flex-col' },
            el('div', { class: 'text-xs font-bold' }, 'Exclude from team views'),
            el('div', { class: 'text-[10px] text-muted-' },
              excluded
                ? 'On — hidden when Indicators is grouped by Teams. Still counts by Office and company-wide.'
                : 'Off — counts everywhere.'),
          ),
          el('button', {
            class: 'rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-widest cursor-pointer transition',
            style: excluded
              ? { background: '#DC2626', color: '#fff' }
              : { background: 'var(--card)', color: 'var(--text-muted)', border: '1px solid var(--border-2)' },
            onclick: () => { setTeamExcluded(t, !excluded); render(); },
          }, excluded ? '● On' : '○ Off'),
        ),
        // Remove team row
        el('div', { class: 'flex justify-end' },
          el('button', {
            class: 'rounded-lg px-2.5 py-1 text-[11px] font-semibold cursor-pointer',
            style: { color: '#DC2626', border: '1px solid rgba(220, 38, 38, .35)', background: 'transparent' },
            onclick: () => {
              const msg = repCount > 0
                ? 'Remove team "' + t + '"? ' + repCount + ' rep' + (repCount === 1 ? '' : 's') + ' on it will be unassigned.'
                : 'Remove team "' + t + '"?';
              if (confirm(msg)) {
                removeTeam(t);
                state._indicatorManageTeamFilter = '';
                render();
              }
            },
          }, 'Remove team'),
        ),
      );
    }

    // Search box (id is stable across re-renders so we can refocus after a change)
    const searchInput = el('div', { class: 'flex w-full' },
      el('input', {
        id: 'manage-reps-search',
        type: 'text', placeholder: 'Search rep…', value: search,
        class: 'rounded-lg border px-2.5 py-1 text-[11px] w-full',
        style: { borderColor: 'var(--border-2)' },
        oninput: (e) => {
          // Filter the list IN PLACE — show/hide existing rows — instead of
          // re-rendering the whole modal. No rebuild means the input keeps
          // focus and there's no flicker on every keystroke.
          state._indicatorTeamSearch = e.target.value;
          applyRepSearch();
        },
      }),
    );

    // Rep list (id is stable so we can preserve scroll position across re-renders)
    const repList = el('div', { id: 'manage-reps-list', class: 'flex-1 overflow-y-auto', style: { overflowX: 'hidden' } },
      ...(() => { const buildRow = (repName) => { const _ri = -1;
        // Divider between the untagged block on top and everyone else.
        const _divider = (_ri === state._mtUntaggedFirstCount && _ri > 0)
          ? el('div', { class: 'px-5 py-1 text-[10px] uppercase tracking-widest font-bold border-t border-b', style: { color: 'var(--text-subtle)', borderColor: 'var(--border)', background: 'var(--card-2)' } }, 'Everyone else')
          : null;
        const _untaggedHead = (_ri === 0 && state._mtUntaggedFirstCount > 0)
          ? el('div', { class: 'px-5 py-1 text-[10px] uppercase tracking-widest font-bold border-b', style: { color: '#A9441F', borderColor: 'var(--border)', background: 'rgba(255,193,7,.06)' } }, state._mtUntaggedFirstCount + ' need a team or tier')
          : null;
        const _row = (() => {
        const currentTeam = getRepTeam(repName);
        const currentTier = getRepTier(repName);
        const teamExcluded = isTeamExcluded(currentTeam);
        const teamSel = el('select', {
          class: 'rounded-lg border px-2.5 py-1 text-[11px] cursor-pointer',
          style: {
            borderColor: 'var(--border-2)',
            background: teamExcluded ? 'rgba(220, 38, 38, .08)' : 'var(--card-2)',
            color: teamExcluded ? '#DC2626' : 'var(--text)',
          },
          onchange: (e) => {
            const v = e.target.value;
            if (v === '__new__') {
              const name = prompt('New team name:');
              if (name && name.trim()) {
                const clean = name.trim();
                addTeam(clean); // register so it persists even if no rep is on it
                setRepTeam(repName, clean);
              } else {
                setRepTeam(repName, currentTeam); // revert
              }
            } else {
              setRepTeam(repName, v);
            }
            render();
          },
        },
          el('option', { value: '', selected: !currentTeam }, '— Team —'),
          ...teams.map(t => el('option', { value: t, selected: currentTeam === t }, t)),
          el('option', { value: '__new__' }, '+ New team…'),
        );

        const tierMeta = repTierMeta(currentTier);
        const tierSel = el('select', {
          class: 'rounded-lg border px-2.5 py-1 text-[11px] cursor-pointer',
          style: {
            borderColor: 'var(--border-2)',
            background: tierMeta ? 'rgba(223,100,58,.08)' : 'var(--card-2)',
            color: tierMeta ? tierMeta.color : 'var(--text)',
            fontWeight: tierMeta ? '700' : '400',
          },
          onchange: (e) => { setRepTier(repName, e.target.value); render(); },
        },
          el('option', { value: '', selected: !currentTier }, '— Tier —'),
          ...REP_TIERS.map(t => el('option', { value: t.id, selected: currentTier === t.id }, t.label)),
        );

        const office = primaryOffice(repName);
        const active = isRepActive(repName);
        // Alias check — if this rep has been merged into another rep,
        // we render the row as a "merged" stub: name strikethrough,
        // badge pointing at the canonical, no editable controls. This
        // makes the duplicate visible (so the manager can see we
        // recognize it) but prevents accidental tier/team edits that
        // would diverge from the canonical's settings.
        const aliasTarget = getRepAliasTarget(repName);
        const isAlias = !!aliasTarget;
        const activeToggle = el('button', {
          class: 'rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest transition cursor-pointer',
          style: active
            ? { background: 'rgba(223,100,58,.18)', color: '#DF643A' }
            : { background: 'var(--card-2)', color: 'var(--text-muted)', border: '1px dashed var(--border-2)' },
          title: active ? 'Click to mark Inactive' : 'Click to mark Active',
          onclick: () => { setRepActive(repName, !active); render(); },
        }, active ? '● Active' : '○ Inactive');

        // Unmerge button — only visible on aliased rows. Clears the
        // alias entry so the rep separates back out (keeps any tier /
        // team / office assignments that happened post-merge, since
        // those moved to the canonical; the dupe goes back to blank).
        const unmergeBtn = isAlias ? el('button', {
          class: 'rounded-md border px-2 py-0.5 text-[10px] font-bold cursor-pointer',
          style: { borderColor: 'var(--border-2)', color: 'var(--text-muted)' },
          title: 'Reverse the merge — this rep will appear separately again',
          onclick: () => {
            delete state._indicatorRepAlias[repName];
            saveDemoData();
            toast('Unmerged ' + repName, 'info');
            render();
          },
        }, 'Unmerge') : null;

        const repType = repTypeOf(repName);
        return el('div', {
          'data-rep': repName.toLowerCase(),
          class: 'mt-rep-row flex items-center justify-between gap-3 px-5 py-2 border-b text-sm',
          style: {
            borderColor: 'var(--border)',
            opacity: isAlias ? '0.55' : (active ? '1' : '0.6'),
            background: isAlias ? 'rgba(255,193,7,.04)' : 'transparent',
          },
        },
          el('div', { class: 'flex items-center gap-2 min-w-0 flex-1' },
            el('span', {
              class: 'font-medium truncate' + (isAlias ? '' : ' cursor-pointer hover:underline'),
              style: isAlias ? { textDecoration: 'line-through', color: 'var(--text-muted)' } : {},
              title: isAlias ? undefined : 'Where did ' + repName + ' sell? Offices, amounts, and dates',
              onclick: isAlias ? undefined : () => openRepWhereSoldModal(repName),
            }, repName),
            // Merged-into badge — clear visual signal that this row is
            // a dupe rolled into the canonical, not a real second rep.
            isAlias && el('span', {
              class: 'text-[10px] font-bold uppercase tracking-widest shrink-0 px-2 py-0.5 rounded-full',
              style: { background: 'rgba(255,193,7,.15)', color: '#A9441F', border: '1px solid rgba(194,138,31,.35)' },
              title: 'This rep is merged into ' + aliasTarget + ' — sales count under that name.',
            }, '→ ' + aliasTarget),
            office && !isAlias && el('span', {
              class: 'text-[10px] font-semibold rounded-full px-2 py-0.5 shrink-0',
              style: {
                background: 'var(--card)',
                color: BRANCH_COLORS[office.toUpperCase?.()] || 'var(--text-muted)',
                border: '1px solid var(--border)',
              },
              title: 'Primary office (read-only)',
            }, titleCase(office)),
            // Sales Rep is the expected default for this roster, so only badge
            // the exceptions (Office Staff / Technician) — those are the rows
            // worth a second look. Unknown stays unbadged too.
            !isAlias && repType && repType !== 'Unknown' && repType !== 'Sales Rep' && el('span', {
              class: 'text-[10px] font-semibold rounded-full px-2 py-0.5 shrink-0',
              style: { background: 'var(--card)', color: TYPE_COLOR[repType] || 'var(--text-muted)', border: '1px solid var(--border)' },
              title: 'Rep type from the Customer Report (read-only)',
            }, repType),
            teamExcluded && !isAlias && el('span', { class: 'text-[10px] font-bold uppercase tracking-widest shrink-0', style: { color: '#DC2626' } }, '· hidden'),
          ),
          // Aliased rows hide the editable controls — edits should
          // happen on the canonical rep instead.
          el('div', { class: 'mt-rep-controls flex items-center gap-2 shrink-0' },
            ...(isAlias
              ? [unmergeBtn]
              : [el('span', { class: 'text-[9px] whitespace-nowrap', style: { color: 'var(--text-subtle)' }, title: 'Last active — most recent sale in the dataset' }, 'Last active · ' + _fmtLast(_lastSaleOf(repName))),
                 activeToggle, tierSel, teamSel]),
          ),
        );
        })();
        return _row;
      };
      // ── Grouped list (per Isaac): reps that still need a team or tier
      // first, then one collapsible section per team. Click a team to open
      // its reps; the team's settings (rename / color / logo / exclude) live
      // inside the open section. Search expands every section.
      const _needsN = state._mtUntaggedFirstCount || 0;
      const needs = filteredReps.slice(0, _needsN), rest = filteredReps.slice(_needsN);
      const byTeam = new Map();
      rest.forEach(r => { const t = getRepTeam(r) || '(unassigned)'; if (!byTeam.has(t)) byTeam.set(t, []); byTeam.get(t).push(r); });
      const teamOrder = [...byTeam.keys()].sort((a, b) => byTeam.get(b).length - byTeam.get(a).length || a.localeCompare(b));
      const openSet = state._mtOpenTeams instanceof Set ? state._mtOpenTeams : (state._mtOpenTeams = new Set());
      const out = [];
      if (needs.length) {
        out.push(el('div', { class: 'px-5 py-1.5 text-[10px] uppercase tracking-widest font-bold border-b', style: { color: '#A9441F', borderColor: 'var(--border)', background: 'rgba(255,193,7,.06)' } }, needs.length + ' need a team or tier'));
        needs.forEach(r => out.push(buildRow(r)));
      }
      teamOrder.forEach(t => {
        const rows = byTeam.get(t); const open = openSet.has(t); const real = t !== '(unassigned)';
        const logo = real ? getTeamLogo(t) : '';
        const color = real ? getTeamColor(t) : 'var(--border-2)';
        out.push(el('div', { class: 'flex items-center gap-2.5 px-5 py-2 border-b border-t cursor-pointer hover:brightness-95', 'data-team-head': t,
          style: { borderColor: 'var(--border)', background: open ? 'rgba(223,100,58,.06)' : 'var(--card-2)' },
          onclick: () => { if (open) openSet.delete(t); else openSet.add(t); render(); } },
          logo ? el('img', { src: logo, alt: '', style: { width: '18px', height: '18px', borderRadius: '50%', objectFit: 'cover', background: '#fff' } })
               : el('span', { style: { width: '10px', height: '10px', borderRadius: '50%', background: color, display: 'inline-block', flex: 'none' } }),
          el('span', { class: 'text-sm font-bold flex-1 min-w-0 truncate' }, t, isTeamExcluded(t) ? el('span', { class: 'ml-2 text-[9px] uppercase tracking-wider font-bold', style: { color: '#DC2626' } }, 'excluded') : null),
          el('span', { class: 'text-[11px] tabular-nums text-muted-' }, rows.length + ' rep' + (rows.length === 1 ? '' : 's')),
          real ? el('button', { class: 'text-[11px] font-semibold px-2 py-0.5 rounded-md border', style: { borderColor: 'var(--border-2)', color: teamSelect === t ? 'var(--accent)' : 'var(--text-muted)' }, title: 'Rename, color, logo, exclude',
            onclick: (e) => { e.stopPropagation(); state._indicatorManageTeamFilter = teamSelect === t ? '' : t; openSet.add(t); render(); } }, teamSelect === t ? 'Close settings' : 'Settings') : null,
          el('span', { class: 'text-[11px] text-muted-' }, open ? '▲' : '▼')));
        if (open) {
          if (teamSelect === t && detailPanel) out.push(detailPanel);
          rows.forEach(r => out.push(buildRow(r)));
        }
      });
      return out;
      })(),
      filteredReps.length === 0 && el('div', { class: 'px-5 py-6 text-center text-sm text-muted- italic' },
        reps.length === 0 ? 'No reps found — upload a raw-sales CSV first.' : 'No reps match the current filters.'),
    );

    // Show/hide rep rows by the search box without re-rendering the modal.
    const applyRepSearch = () => {
      const q = (state._indicatorTeamSearch || '').trim().toLowerCase();
      if (q && state._mtOpenTeams instanceof Set) {
        // Searching: open every section so the matches are reachable.
        const heads = repList.querySelectorAll('[data-team-head]');
        let need = false; heads.forEach(h => { if (!state._mtOpenTeams.has(h.getAttribute('data-team-head'))) need = true; });
        if (need) { heads.forEach(h => state._mtOpenTeams.add(h.getAttribute('data-team-head'))); render(); return; }
      }
      for (const row of repList.querySelectorAll('[data-rep]')) {
        const name = row.getAttribute('data-rep');
        row.style.display = (!q || name.includes(q)) ? '' : 'none';
      }
    };
    applyRepSearch();

    // Capture focus + scroll BEFORE we tear down the DOM so the user doesn't
    // lose their place every time they pick a tier/team or type in search.
    const prevList = document.getElementById('manage-reps-list');
    const prevScroll = prevList ? prevList.scrollTop : 0;
    const prevSearch = document.getElementById('manage-reps-search');
    const searchHadFocus = prevSearch && document.activeElement === prevSearch;
    const searchSelStart = searchHadFocus ? prevSearch.selectionStart : null;
    const searchSelEnd   = searchHadFocus ? prevSearch.selectionEnd   : null;

    // ── Compact filter toolbar ──────────────────────────────────────────
    // Tier / Status / Rep Type / Branch collapsed from four stacked chip rows
    // into one row of dropdowns. Every count is scoped to the roster for the
    // selected Team Year (the Year dropdown above), so switching years
    // re-scopes the whole panel. Team stays as chips since clicking a team
    // also opens its detail/edit panel.
    // Each filter stretches so the pills share the row edge-to-edge (per Isaac).
    const mkFilter = (label, value, opts, onChange) => el('label', { class: 'inline-flex items-center gap-1.5 flex-1', style: { minWidth: '150px' } },
      el('span', { class: 'text-[10px] uppercase tracking-widest font-semibold', style: { color: 'var(--text-muted)' } }, label),
      el('select', {
        class: 'rounded-lg border px-2.5 py-1 text-[11px] cursor-pointer w-full',
        style: { borderColor: 'var(--border-2)', background: 'var(--card-2)', color: 'var(--text)', minWidth: '0' },
        onchange: (e) => onChange(e.target.value),
      }, ...opts.map(o => el('option', { value: o.value, selected: value === o.value }, o.label))));
    const filterBar = el('div', { style: { display: 'contents' } },
      // ⚙ Teams — every team with its headcount and a Remove button; the
      // confirm names how many reps go untagged (per Isaac).
      el('button', {
        class: 'rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition hover:brightness-95',
        style: { borderColor: 'var(--border-2)', color: 'var(--text)' },
        title: 'All teams — add or remove teams',
        onclick: () => openTeamsListModal(teamYear, render),
      }, 'Teams'),
      mkFilter('Tier', tierSelect, [
        { value: '', label: 'All · ' + (tierCounts.rookie + tierCounts.vet + tierCounts.untagged) },
        { value: 'rookie', label: 'Rookie · ' + tierCounts.rookie },
        { value: 'vet', label: 'Vet · ' + tierCounts.vet },
        { value: 'untagged', label: 'Untagged · ' + tierCounts.untagged },
      ], (v) => { state._indicatorManageTierFilter = v; render(); }),
      mkFilter('Status', activeSelect, [
        { value: '', label: 'All' },
        { value: 'active', label: 'Active · ' + activeCounts.active },
        { value: 'inactive', label: 'Inactive · ' + activeCounts.inactive },
      ], (v) => { state._indicatorManageActiveFilter = v; render(); }),
      // Type defaults to Sales Reps (+ unmatched names) — teams are a
      // Sales-Rep construct. Pick a specific type to inspect the others.
      mkFilter('Type', typeSelect, [
        { value: '', label: 'Sales Reps' },
        ...repTypesPresent.filter(t => t !== 'Sales Rep').map(t => ({ value: t, label: t + ' only' })),
        ...(repTypesPresent.includes('Sales Rep') ? [{ value: 'Sales Rep', label: 'Sales Rep (CRM-matched)' }] : []),
      ], (v) => { state._indicatorManageTypeFilter = v; render(); }),
      mkFilter('Branch', branchSelect, [
        { value: '', label: 'All' },
        ...branchesPresent.map(b => ({ value: b, label: titleCase(b) + ' · ' + branchCounts[b] })),
      ], (v) => { state._indicatorManageBranchFilter = v; render(); }),
      (teamSelect || tierSelect || activeSelect || branchSelect)
        ? el('span', { class: 'text-[10px] text-muted- italic' }, 'Showing ' + filteredReps.length + ' of ' + reps.length)
        : null,
    );
    headerFilterSlot.append(...Array.from(filterBar.childNodes));
    headerSearchSlot.append(searchInput);

    // ── Link names to FieldRoutes (CRM) ──────────────────────────────────
    // Some reps are spelled differently in the sales data than in the CRM, so
    // they don't auto-match (no branch, "Unknown" type). This finds those and
    // lets the admin link each to the right CRM employee; linking renames the
    // rep to the CRM spelling (via the existing alias/merge), so sales, team,
    // tier, and branch all consolidate under the CRM name.
    let crmLinkPanel = null;
    if (Array.isArray(state.frRoster) && state.frRoster.length) {
      const _toks = (n) => String(n || '').toLowerCase().replace(/[.,]/g, ' ').split(/\s+/).filter(Boolean);
      const crmSigSet = new Set();
      const crmByToken = new Map();
      state.frRoster.forEach(e => {
        const names = [(typeof _frEmpName === 'function') ? _frEmpName(e) : '', (typeof _frRealName === 'function') ? _frRealName(e) : ''];
        names.forEach(nm => { const s = _nameSig(nm); if (s) crmSigSet.add(s); });
        new Set(names.flatMap(_toks)).forEach(t => { if (!crmByToken.has(t)) crmByToken.set(t, []); crmByToken.get(t).push(e); });
      });
      const appNames = new Set([
        ...(state._indicatorRawSales || []).map(s => s.rep).filter(Boolean),
        ...Object.keys(state._indicatorRepTier || {}),
        ...Object.keys(state._indicatorRepOffice || {}),
      ]);
      _allTeamYearMaps().forEach(m => Object.keys(m).forEach(k => appNames.add(k)));
      const candidatesFor = (rep) => {
        const score = new Map();
        _toks(rep).forEach(t => (crmByToken.get(t) || []).forEach(e => score.set(e, (score.get(e) || 0) + 1)));
        // At least TWO name parts must match. Scoring on ONE shared token made
        // every "Alex ..." a candidate for Alex Wilson - and the top candidate
        // is pre-selected next to a Link button that folds the rep's sales into
        // whoever is chosen. A shared surname is not evidence of the same human,
        // and a wrong Link is far more expensive than an unmatched name.
        return [...score.entries()].filter(([, hits]) => hits >= 2)
          .sort((a, b) => b[1] - a[1]).map(([e]) => e).slice(0, 8);
      };
      let unmatched = [...appNames].filter(n => n && !getRepAliasTarget(n) && !crmSigSet.has(_nameSig(n))).sort((a, b) => a.localeCompare(b));
      // AUTO-LINK the unambiguous ones (per Isaac): when a sales-data name and
      // exactly one CRM employee carry the same name parts — same first + last
      // once punctuation, order, case, middle initials and nicknames are
      // ignored — link them without asking. Anything with a competing
      // candidate, or where the parts don't fully match, stays in the review
      // list below. Runs once per Manage Teams open.
      const _core = (n) => _toks(n).filter(t => t.length > 1);   // drop middle initials
      const _sameParts = (a, b) => { const A = new Set(_core(a)), B = new Set(_core(b)); return A.size >= 2 && A.size === B.size && [...A].every(t => B.has(t)); };
      {
        let autoLinked = 0;
        unmatched.forEach(rep => {
          const cands = candidatesFor(rep);
          const exact = cands.filter(e => _sameParts(rep, _frEmpName(e)) || _sameParts(rep, (typeof _frRealName === 'function' ? _frRealName(e) : '')));
          if (exact.length !== 1) return;
          const ln = String(exact[0].lname || '').trim(), fn = String((exact[0].nickname || exact[0].fname) || '').trim();
          const tgt = (ln && fn) ? (ln + ', ' + fn) : _frEmpName(exact[0]);
          if (!tgt || tgt === rep) return;
          if (mergeDuplicateRep(rep, tgt)) autoLinked++;
        });
        if (autoLinked) {
          toast('Auto-linked ' + autoLinked + ' rep name' + (autoLinked === 1 ? '' : 's') + ' to the CRM spelling', 'success');
          unmatched = unmatched.filter(n => !getRepAliasTarget(n));
        }
      }
      const withCand = [], noCand = [];
      unmatched.forEach(n => { (candidatesFor(n).length ? withCand : noCand).push(n); });
      const open = !!state._indicatorCrmLinkOpen;
      const empById = new Map(state.frRoster.map(e => [String(e.employee_id), e]));
      // Link used to rename the rep to _frEmpName(), which is "First Last".
      // The sales data is "Last, First", so every link created a second
      // spelling of the same human that then showed up in the duplicates
      // list - the Link feature was manufacturing its own backlog. Write
      // back in the sales-data shape instead.
      const _frEmpNameLF = (e) => {
        const ln = String(e.lname || '').trim();
        const fn = String((e.nickname || e.fname) || '').trim();
        return (ln && fn) ? (ln + ', ' + fn) : ((typeof _frEmpName === 'function') ? _frEmpName(e) : '');
      };
      const rowFor = (rep) => {
        const cands = candidatesFor(rep);
        const sel = el('select', { class: 'rounded-lg border px-2.5 py-1 text-[11px] cursor-pointer', style: { borderColor: 'var(--border-2)', background: 'var(--card-2)', color: 'var(--text)', maxWidth: '260px' } },
          ...cands.map((e, i) => el('option', { value: String(e.employee_id), selected: i === 0 }, _frEmpName(e) + (e.office_name ? ' · ' + e.office_name : ''))));
        return el('div', { class: 'flex items-center justify-between gap-3 px-5 py-2 border-b text-sm', style: { borderColor: 'var(--border)' } },
          el('span', { class: 'font-medium truncate flex-1 min-w-0' }, rep),
          el('div', { class: 'flex items-center gap-2 shrink-0' },
            el('span', { class: 'text-[10px] text-muted-' }, '→'), sel,
            el('button', { class: 'rounded-md px-2.5 py-1 text-[11px] font-bold cursor-pointer', style: { background: 'var(--accent)', color: 'var(--accent-text)' },
              onclick: () => { const e = empById.get(sel.value); if (e) { const _tgt = _frEmpNameLF(e); mergeDuplicateRep(rep, _tgt); toast('Linked to ' + _tgt, 'success'); render(); } } }, 'Link')));
      };
      state._mtCrmNeedLook = withCand.length;
      crmLinkPanel = el('div', { class: 'border-b', style: { borderColor: 'var(--border)', background: open ? 'rgba(13,148,136,.05)' : 'transparent' } },
        el('button', { class: 'w-full flex items-center justify-between gap-2 px-2.5 py-1 cursor-pointer text-[11px]', style: { background: 'transparent' },
          onclick: () => { state._indicatorCrmLinkOpen = !open; render(); } },
          el('span', { class: 'text-xs font-bold uppercase tracking-widest', style: { color: '#5F6C5B' } },
            '🔗 Link names to CRM · ' + withCand.length + ' need a look' + (noCand.length ? ' · ' + noCand.length + ' no match' : '')),
          el('span', { class: 'text-[11px] text-muted-' }, open ? 'Hide ▲' : 'Show ▼')),
        open ? el('div', { class: 'flex flex-col' },
          el('div', { class: 'px-5 py-2 text-[11px] text-muted- italic' }, 'Exact first+last matches are linked automatically. These share only part of a name with a CRM employee — pick the right one and Link, or leave them.'),
          el('div', { class: 'flex flex-col overflow-y-auto', style: { maxHeight: '340px' } },
            ...withCand.slice(0, 150).map(rowFor),
            withCand.length > 150 ? el('div', { class: 'px-5 py-2 text-[11px] text-muted-' }, 'Showing first 150 of ' + withCand.length + ' — link some and the rest will surface.') : null,
            noCand.length ? el('div', { class: 'px-5 py-2 text-[11px] text-muted-' }, noCand.length + ' had no close CRM name (likely not in the CRM / terminated): ' + noCand.slice(0, 30).join(', ') + (noCand.length > 30 ? '…' : '')) : null,
          ),
        ) : null,
      );
    }

    // ── Sortable column header — click Rep / Tier / Team to sort the list.
    const _mtSortBtn = (col, label) => el('button', {
      class: 'text-[10px] uppercase tracking-widest font-bold cursor-pointer',
      style: { color: _mtSortCol === col ? 'var(--accent)' : 'var(--text-muted)', background: 'transparent', border: 'none', padding: '0' },
      style: _mtSortCol === col ? { color: 'var(--accent)', fontWeight: '800' } : {},
      title: 'Sort by ' + label,
      onclick: () => {
        if (state._manageTeamsSort === col) state._manageTeamsSortDir = (_mtSortDir === 'asc' ? 'desc' : 'asc');
        else { state._manageTeamsSort = col; state._manageTeamsSortDir = 'asc'; }
        render();
      },
    }, label);   // active column highlighted, no arrows
    const sortHeader = el('div', { class: 'flex items-center justify-between gap-3 px-5 py-1.5 border-b', style: { borderColor: 'var(--border)', background: 'var(--card-2)' } },
      el('div', { class: 'flex-1' }, _mtSortBtn('name', 'Rep')),
      el('div', { class: 'flex items-center gap-4 shrink-0' },
        _mtSortBtn('tier', 'Tier'),
        _mtSortBtn('team', 'Team')));

    // ── Stale teams (per Isaac: "gtilbert" kept showing in team pickers).
    // A team name lives on in the global lists as long as ANY year's
    // roster references it — even if nobody in the selected year is on it.
    // Surface those here with a remove-everywhere button.
    const _thisYear = new Set(distinctTeamsForYear(teamYear));
    const _stale = distinctTeams().filter(t => !_thisYear.has(t));
    const stalePanel = _stale.length ? el('div', { class: 'px-5 py-3 border-b flex flex-col gap-2', style: { borderColor: 'var(--border)', background: 'rgba(223,100,58, 0.06)' } },
      el('div', { class: 'text-[10px] uppercase tracking-widest font-bold', style: { color: '#A9441F' } }, 'Teams only referenced in other years'),
      el('div', { class: 'text-[11px] text-muted-' }, 'Nobody in ' + teamYear + ' is on these, but they still show in team dropdowns because an older roster references them. Remove to clear them everywhere.'),
      el('div', { class: 'flex flex-wrap gap-1.5' }, ..._stale.map(t => {
        const yrs = Object.keys(state._indicatorRepTeamByYear || {}).filter(y => Object.values(state._indicatorRepTeamByYear[y] || {}).includes(t));
        return el('span', { class: 'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px]', style: { borderColor: 'var(--border-2)', background: 'var(--card)' } },
          el('span', { class: 'font-semibold' }, t),
          el('span', { class: 'text-muted-' }, yrs.length ? yrs.join(', ') : 'registry only'),
          el('button', { class: 'font-bold', style: { color: '#DC2626' }, title: 'Remove "' + t + '" from every year and every list',
            onclick: () => { if (confirm('Remove team "' + t + '" everywhere (' + (yrs.join(', ') || 'registry') + ')?')) { removeTeam(t); render(); } } }, '×'));
      }))) : null;
    // Data-hygiene tools (CRM name links, possible duplicates) tucked into
    // ONE muted line, collapsed by default (per Isaac) — the roster is the
    // point of this panel. Only shown when there is something to do.
    const _hyOpen = !!state._mtHygieneOpen;
    const _hyBits = [];
    if (crmLinkPanel) _hyBits.push((state._mtCrmNeedLook || 0) + ' CRM name' + ((state._mtCrmNeedLook || 0) === 1 ? '' : 's') + ' to review');
    if (dupesPanel) _hyBits.push(dupePairs.length + ' possible duplicate' + (dupePairs.length === 1 ? '' : 's'));
    const hygienePanel = (crmLinkPanel || dupesPanel) ? el('div', { class: 'border-b', style: { borderColor: 'var(--border)' } },
      el('button', { class: 'w-full flex items-center justify-between gap-2 px-5 py-1 text-[10px] uppercase tracking-widest', style: { background: 'transparent', color: 'var(--text-subtle)' },
        onclick: () => { state._mtHygieneOpen = !_hyOpen; render(); } },
        el('span', {}, 'Data hygiene · ' + _hyBits.join(' · ')),
        el('span', {}, _hyOpen ? 'Hide ▲' : 'Show ▼')),
      _hyOpen ? el('div', {}, ...[crmLinkPanel, dupesPanel].filter(Boolean)) : null) : null;
    card.innerHTML = '';
    card.append(
      header,
      ...(stalePanel ? [stalePanel] : []),
      sortHeader, repList,
      ...(hygienePanel ? [hygienePanel] : []),
    );
    if (overlay) { overlay.innerHTML = ''; overlay.append(card); }

    // Restore scroll + search focus on the freshly-rendered DOM
    requestAnimationFrame(() => {
      const newList = document.getElementById('manage-reps-list');
      if (newList) newList.scrollTop = prevScroll;
      if (searchHadFocus) {
        const newSearch = document.getElementById('manage-reps-search');
        if (newSearch) {
          newSearch.focus();
          if (searchSelStart != null) {
            try { newSearch.setSelectionRange(searchSelStart, searchSelEnd); } catch (_) {}
          }
        }
      }
    });
  };

  render();
  // Branch is sourced from the FieldRoutes employee office — pull the CRM
  // roster in the background if it isn't loaded yet, then re-render so offices
  // fill in.
  if (state.frRoster == null && typeof loadFieldRoutesRoster === 'function' && !state._frRosterLoading) {
    loadFieldRoutesRoster().then(() => { if ((overlay && overlay.isConnected) || card.isConnected) render(); }).catch(() => {});
  }
  // If the Customer Report rows aren't in memory (they don't survive a
  // refresh), pull them in the background so the Rep Type column can populate
  // without the user having to visit the Reporting tab first.
  if (!(state.reportingSubscriptions || []).length && state.reportingActiveUploadId
      && typeof loadReportingSubscriptions === 'function') {
    loadReportingSubscriptions(state.reportingActiveUploadId).then(rows => {
      if (!rows || !rows.length || (overlay && !overlay.isConnected) || !card.isConnected) return;
      state.reportingSubscriptions = rows;
      state.reportingSubscriptionsLoadedFor = state.reportingActiveUploadId;
      _refreshRepTypeMap();
      render();
    }).catch(() => {});
  }
  if (embedded) return card;
  document.body.append(overlay);
}


// ── Indicators saved-filter presets (per Isaac) — a FieldRoutes-style
// ribbon. "+ Save current" snapshots the page's filter state under a name;
// clicking a chip restores it EXACTLY. Synced through the shared indicator
// settings, so every admin sees the same ribbon.
const IND_PRESET_KEYS = [
  'indicatorAcctStatus',         // Metric: Pending/Serviced vs Total Revenue
  'indicatorDept',               // Type: All / Sales Rep / Office Staff / Technician
  'indicatorsRangePreset', 'indicatorsCustomStart', 'indicatorsCustomEnd',
  'indicatorsGroupBy',
  'indicatorsComps',
  '_indicatorRepTierFilter', '_indicatorRepTeamFilter', '_indicatorRepOfficeFilter', '_indicatorRepSort',
  '_indicatorMixGroup', '_indicatorSubMixOffice',
  '_indicatorYoYMetric', '_indicatorTrendScope',
  '_indCtxCollapsed',
  '_indRepRevMode',
  '_indHiddenMetrics',
  '_indHiddenLbCols',
  '_indicatorRepPick',           // a partner's hand-picked downline (null = everyone)
];
// Presets are PER USER (per Isaac): stored on this device under the
// signed-in account, so everyone builds their own set.
function _indPresetsKey() { return 'ridd_ind_presets_v1::' + ((state.profile && state.profile.id) || 'anon'); }
function _indPresetsLoad() {
  try {
    const p = JSON.parse(localStorage.getItem(_indPresetsKey()) || 'null');
    if (Array.isArray(p)) return p;
  } catch { /* fresh */ }
  // One-time migration: seed from the old SHARED presets if they exist.
  const legacy = Array.isArray(state._indicatorFilterPresets) ? state._indicatorFilterPresets : [];
  if (legacy.length) { _indPresetsSave(legacy); return legacy.slice(); }
  return [];
}
function _indPresetsSave(list) {
  try { localStorage.setItem(_indPresetsKey(), JSON.stringify(list)); } catch { /* private mode */ }
  if (typeof pushUserPrefsSoon === 'function') pushUserPrefsSoon();
}
function indPresetRibbon() {
  const presets = _indPresetsLoad();
  const _snapNow = () => {
    const s = {};
    IND_PRESET_KEYS.forEach(k => {
      const v = state[k];
      s[k] = (v && typeof v === 'object') ? JSON.parse(JSON.stringify(v)) : (v == null ? '' : v);
    });
    return s;
  };
  const _matches = (p) => { try { return JSON.stringify(p.snap) === JSON.stringify(_snapNow()); } catch { return false; } };
  const open = !!state._indPresetsOpen;
  // FieldRoutes-style ribbon (per Isaac): a slim VERTICAL handle pinned to
  // the page's left edge, titled "Presets"; clicking it expands the saved-
  // preset drawer beside it.
  // Now a regular toolbar button, left-justified on the Filters row (per
  // Isaac) — the vertical left-edge handle is retired. The drawer drops
  // down from the button.
  const tab = el('button', {
    class: 'rounded-xl px-2.5 py-1 text-[11px] font-semibold border cursor-pointer transition hover:brightness-95 flex items-center gap-1.5 shrink-0',
    style: open
      ? { background: 'var(--accent)', color: 'var(--accent-text)', borderColor: 'var(--accent)' }
      : { borderColor: 'var(--border-2)', color: 'var(--text)' },
    title: 'Saved presets \u2014 save the whole page setup and jump between views in one click',
    // Toggle IN PLACE (per Isaac) — no full re-render just to show/hide the drawer.
    onclick: (e) => {
      e.stopPropagation();
      const nowOpen = panel.style.display !== 'block';
      state._indPresetsOpen = nowOpen;
      panel.style.display = nowOpen ? 'block' : 'none';
      Object.assign(tab.style, nowOpen
        ? { background: 'var(--accent)', color: 'var(--accent-text)', borderColor: 'var(--accent)' }
        : { background: '', color: 'var(--text)', borderColor: 'var(--border-2)' });
      if (nowOpen) setTimeout(() => document.addEventListener('mousedown', function closer(ev) {
        if (panel.contains(ev.target) || tab.contains(ev.target)) return;
        panel.style.display = 'none'; state._indPresetsOpen = false;
        Object.assign(tab.style, { background: '', color: 'var(--text)', borderColor: 'var(--border-2)' });
        document.removeEventListener('mousedown', closer);
      }), 0);
    },
  }, 'Presets');
  const caret = el('span');   // (caret retired — per Isaac, no ▾ on dropdown buttons)
  const panel = el('div', {
    class: 'card',
    style: { position: 'absolute', left: '0', top: 'calc(100% + 6px)', zIndex: 39, width: 'min(300px, calc(100vw - 32px))', maxHeight: '62vh', overflowY: 'auto', boxShadow: 'var(--shadow-lg)', padding: '10px', display: open ? 'block' : 'none' },
  },
    // When the preset you applied has been CHANGED on the page, a Save
    // button pops in to overwrite it in place (per Isaac) — Save as New
    // below still forks a fresh one.
    (() => {
      const lastP = presets.find(x => x.id === state._indPresetLastApplied);
      if (!lastP || _matches(lastP)) return null;
      return el('div', { class: 'flex items-center gap-2 mb-2 rounded-lg border px-2.5 py-2', style: { borderColor: 'var(--accent)', background: 'var(--card-2)' } },
        el('div', { class: 'flex-1 min-w-0 text-[11px] font-semibold truncate' },
          'Filters changed from \u201c' + lastP.name + '\u201d'),
        el('button', {
          class: 'rounded-lg px-2.5 py-1 text-[11px] font-bold cursor-pointer shrink-0',
          style: { background: 'var(--accent)', color: 'var(--accent-text)' },
          title: 'Overwrite \u201c' + lastP.name + '\u201d with the page\u2019s current setup',
          onclick: () => {
            lastP.snap = _snapNow();
            lastP.at = new Date().toISOString();
            lastP.by = (state.profile && state.profile.full_name) || lastP.by || '';
            _indPresetsSave(presets);
            mountApp();
            toast('Updated \u201c' + lastP.name + '\u201d', 'success');
          },
        }, 'Save'));
    })(),
    (() => {
      const nameIn = el('input', {
        type: 'text', placeholder: 'Name this preset\u2026',
        class: 'flex-1 min-w-0 rounded-lg border px-2.5 py-1 text-[11px]',
        style: { borderColor: 'var(--border-2)', background: 'var(--card-2)', color: 'var(--text)' },
      });
      return el('div', { class: 'flex items-center gap-2 mb-2' },
        nameIn,
        el('button', {
          class: 'rounded-lg px-2.5 py-1 text-[11px] font-bold cursor-pointer shrink-0',
          style: { background: 'var(--accent)', color: 'var(--accent-text)' },
          title: 'Snapshot the page exactly as it\u2019s set up right now \u2014 metric, type, date range, grouping, leaderboard filters, mix grouping, trend metric',
          onclick: () => {
            const name = (nameIn.value || '').trim();
            if (!name) { toast('Give the preset a name first', 'warn'); return; }
            const list = presets.filter(x => (x.name || '').toLowerCase() !== name.toLowerCase());
            list.push({ id: 'p' + Date.now(), name, at: new Date().toISOString(), by: (state.profile && state.profile.full_name) || '', snap: _snapNow() });
            _indPresetsSave(list);
            mountApp();
            toast('Saved \u201c' + name + '\u201d \u2014 click it any time to restore these exact settings', 'success');
          },
        }, 'Save as New'));
    })(),
    presets.length === 0 ? el('div', { class: 'text-xs italic px-1 py-2', style: { color: 'var(--text-muted)' } },
      'No presets yet \u2014 set the page up how you like it, name it above, and save.') : null,
    ...presets.map(p => {
      const on = _matches(p);
      return el('div', {
        class: 'flex items-center gap-2 rounded-lg px-2.5 py-2 cursor-pointer transition hover:brightness-95 border mb-1',
        style: { borderColor: on ? 'var(--accent)' : 'var(--border)', background: on ? 'var(--card-2)' : 'transparent' },
        title: 'Apply \u201c' + p.name + '\u201d \u2014 restores the exact page setup saved under it',
        onclick: () => {
          Object.entries(p.snap || {}).forEach(([k, v]) => {
            state[k] = (v && typeof v === 'object') ? JSON.parse(JSON.stringify(v)) : v;
          });
          state._indPresetLastApplied = p.id;   // enables the overwrite Save when filters drift
          mountApp();
        },
      },
        el('div', { class: 'flex-1 min-w-0' },
          el('div', { class: 'text-xs font-bold truncate', style: on ? { color: 'var(--accent)' } : {} }, p.name + (on ? ' \u2713' : '')),
          el('div', { class: 'text-[10px] italic', style: { color: 'var(--text-muted)' } },
            (p.by || '') + (p.at ? ' \u00b7 ' + new Date(p.at).toLocaleString('en-US', { month: '2-digit', day: '2-digit', year: '2-digit', hour: 'numeric', minute: '2-digit' }) : ''))),
        el('button', {
          class: 'cursor-pointer shrink-0', style: { color: 'var(--text-subtle)', fontSize: '14px' },
          title: 'Delete this preset',
          onclick: (e) => {
            e.stopPropagation();
            if (!confirm('Delete the \u201c' + p.name + '\u201d preset?')) return;
            _indPresetsSave(presets.filter(x => x.id !== p.id));
            mountApp();
          },
        }, '\ud83d\uddd1'));
    }));
  return el('div', { style: { position: 'relative' } }, tab, panel);
}

