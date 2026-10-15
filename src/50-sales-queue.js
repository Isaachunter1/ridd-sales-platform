// ┌─ src/50-sales-queue.js ─────────────────────────────────────────────────────
// │ The Sales queues (Upfront / Pending Backend Lock / Archived / History) shared by all rep types, audit controls, CSV export.
// │ Part of the app.js bundle (tools/bundle.js concatenates src/*.js in name order).
// └────────────────────────────────────────────────────────────────────────
// ──────────────────────────────────────────────────────────────────────────
// VIEW: SALES — pending queue (+ new sale opens modal via FAB)
// ──────────────────────────────────────────────────────────────────────────
// ──────────────────────────────────────────────────────────────────────────
// VIEW: SALES — spreadsheet-style table matching the RIDD SALES sheet
//   Rep:   sees only their own pending / below-min / nsf sales
//   Admin: sees every rep's pending sales + inline audit dropdown per row
// ──────────────────────────────────────────────────────────────────────────
// Placeholder for tabs being rebuilt (per Isaac, Oct 15): Sales Rep / Technician Sales + Pay.
// Non-commissionable sellers (per Isaac, Oct 15): house logins like "RIDD Account" never earn commission, so
// their sales stay off the Sales tab. Settings → Configurations → Commission Rules → Non-commissionable sellers
// (adminRules.nonCommSellers); names match in any order ("Account, RIDD" = "RIDD Account").
const NONCOMM_DEFAULT = ['RIDD Account'];
const _nameSig = (n) => String(n || '').toLowerCase().replace(/[.,]/g, ' ').split(/\s+/).filter(Boolean).sort().join(' ');
function nonCommSellers() { const r = (typeof _adminRules === 'function') ? _adminRules() : null; return (r && Array.isArray(r.nonCommSellers)) ? r.nonCommSellers : NONCOMM_DEFAULT; }
function setNonCommSellers(list) { if (typeof _setAdminRule === 'function') _setAdminRule('nonCommSellers', list); }
function isNonCommSale(s) {
  const sigs = new Set(nonCommSellers().map(_nameSig).filter(Boolean)); if (!sigs.size) return false;
  const p = s.rep_id ? (state.allProfiles || []).find(x => x.id === s.rep_id) : null;
  return sigs.has(_nameSig(p ? p.full_name : '')) || sigs.has(_nameSig(s.crm_seller_name));
}
function viewUnderConstruction(what) {
  return el('div', { class: 'card p-10 text-center flex flex-col items-center gap-2' },
    el('div', { style: { fontSize: '28px' } }, '\u{1F6A7}'),
    el('div', { class: 'text-base font-bold' }, 'Under construction'),
    el('div', { class: 'text-xs text-muted-' }, (what ? what.charAt(0).toUpperCase() + what.slice(1) : 'This tab') + ' is coming soon.'));
}
function viewSales() {
  const isAdmin = isAdminRole(state.profile?.role);
  // One renderer, three queues: Inside Sales ('sales'), D2D ('d2d_sales'),
  // Technicians ('tech_sales'). Rows carry queue_type from the sync.
  const _queue = SALES_QUEUE_OF_VIEW[state.view] || 'office';
  // Sales Rep + Technician Sales tabs (per Isaac, Oct 15): under construction while the Office Staff flow is
  // built out — they get it next, with their own commission rules.
  if (_queue === 'd2d' || _queue === 'tech') {
    return viewUnderConstruction((_queue === 'd2d' ? 'Sales Rep' : 'Technician') + ' sales');
  }
  // Reach (Settings → Permissions → Sales tab rows): 'self' = own sales (the
  // default); team / dept / everyone widen it to those reps' sales.
  const _salesScope = isAdmin ? 'all' : ((typeof userScope === 'function') ? userScope('sales_scope') : 'self');
  const _profName = new Map((state.allProfiles || []).map(p => [String(p.id), p.full_name || '']));
  const _mine = (s) => s.rep_id === state.profile.id || (_salesScope !== 'self' && _salesScope !== 'none' && repInReach(_salesScope, _profName.get(String(s.rep_id)) || ''));
  const _pool = _queue === 'office' ? (isAdmin ? state.allSales : (_salesScope === 'self' ? state.mySales : (state.allSales || []).filter(_mine)))
    : ((state.queueSales && state.queueSales[_queue]) || []).filter(s => isAdmin || _mine(s));
  const source  = (_pool || []).filter(s => !isNonCommSale(s));   // house / non-commissionable sellers stay off the Sales tab
  // The Sales tab is the active queue — anything that still needs admin/auditor
  // attention OR is in flight to payroll. A sale falls off only when payroll
  // is RUN (payroll_processed_at set) AND the backend lock is decided
  // (lock_status set to lock or chargeback). At that point it lives in History.
  // Cancelled / Reschedule / Not Payable are terminal — they go straight to
  // History too (Cancelled is reinstateable from there).
  const ACTIVE_QUEUE = new Set(['pending', 'serviced', 'below_minimums', 'nsf', 're_audit']);
  const lockOf = (s) => s.lock_status || 'pending';
  // Four queues, toggleable: upfront-payment audit (no first-pass audit yet)
  // vs backend-lock review (audited & paid out, awaiting Lock/Chargeback call)
  // vs cancels (audit_status set to cancelled — Reinstate by flipping Status
  // back to Pending) vs history (settled — locked / charged back / terminally
  // rejected). History was its own top-level tab; now it lives here so the
  // rep can see the whole pipeline in one place.
  if (!state._salesQueueFilter) state._salesQueueFilter = 'upfront';
  const queueFilter = state._salesQueueFilter;
  // The backend queue cross-references the active Reporting snapshot (by
  // customer #). Those rows lazy-load on the Reporting tab — pull them here too
  // so a reviewer landing straight on the backend queue still sees live status.
  if (queueFilter === 'backend' && state.reportingActiveUploadId
      && state.reportingSubscriptionsLoadedFor !== state.reportingActiveUploadId
      && typeof loadReportingSubscriptions === 'function') {
    loadReportingSubscriptions(state.reportingActiveUploadId).then(rows => {
      if (rows == null || state.reportingActiveUploadId == null) return;
      state.reportingSubscriptions = rows;
      state.reportingSubscriptionsLoadedFor = state.reportingActiveUploadId;
      mountApp();
    });
  }
  const HIST_TERMINAL = new Set(['not_payable', 'reschedule']);
  // Upfront = everything still on its way to the UPFRONT payroll run: waiting on audit, or approved
  // (Commissionable / Below Minimums / NSF) but not paid yet. It only moves to Pending Backend Lock once
  // the upfront payroll has actually run on it (per Isaac, Oct 15 — no payroll run yet, so nothing
  // should be waiting on a backend decision).
  // Upfront starts Oct 12 (per Isaac, Oct 15 — the 'before 10/12' table is cleared): the new flow begins there.
  const isUpfrontPending = (s) =>
    ACTIVE_QUEUE.has(s.audit_status) && lockOf(s) === 'pending' && !s.payroll_processed_at && saleHasInitialScheduled(s)
    && (_queue !== 'office' || String(s.sold_date || '') >= SALES_FEED_START);
  // Sold but no initial booked yet — kept off Upfront (per Isaac, Oct 15); listed on demand.
  const isAwaitingInitial = (s) =>
    ACTIVE_QUEUE.has(s.audit_status) && lockOf(s) === 'pending' && !s.payroll_processed_at && !saleHasInitialScheduled(s);
  // Pending Backend Lock includes:
  //   (a) audited sales still awaiting a Lock/Chargeback decision, AND
  //   (b) sales already marked Lock or Chargeback that haven't yet had
  //       backend payroll run on them. Marking Lock doesn't bounce the row
  //       off this tab — backend payroll does. The Lock dropdown stays
  //       interactive in case the reviewer needs to flip the decision.
  const isBackendPending = (s) =>
    ACTIVE_QUEUE.has(s.audit_status) &&
    s.audit_status !== 'pending' &&
    !!s.payroll_processed_at &&
    !s.backend_payroll_processed_at;
  // Archived (per Isaac) = cancelled sales PLUS the ones parked as Not
  // Payable / Reschedule — they're no longer in flight but aren't settled
  // pay history either. History is strictly the locked / charged-back set.
  const isCancelled = (s) => s.audit_status === 'cancelled' || HIST_TERMINAL.has(s.audit_status);
  // History = settled. A Lock/Chargeback sale only graduates here once the
  // RUN BACKEND payroll run has stamped backend_payroll_processed_at.
  const isHistory = (s) => {
    const lock = lockOf(s);
    return (lock === 'lock' || lock === 'chargeback') && !!s.backend_payroll_processed_at;
  };
  const queueCounts = {
    upfront: source.filter(isUpfrontPending).length,
    backend: source.filter(isBackendPending).length,
    cancels: source.filter(isCancelled).length,
    history: source.filter(isHistory).length,
  };
  const queuePredicate = queueFilter === 'backend' ? isBackendPending
    : queueFilter === 'cancels' ? isCancelled
    : queueFilter === 'history' ? isHistory
    : isUpfrontPending;
  const pending = source.filter(queuePredicate);
  // Sort: oldest first (audit FIFO)
  pending.sort((a, b) => {
    const ta = new Date(a.created_at || a.sold_date).getTime();
    const tb = new Date(b.created_at || b.sold_date).getTime();
    return ta - tb;
  });

  // Apply user filters on top
  const sf = state.salesFilters;
  let filtered = pending;
  if (sf.dateStart) filtered = filtered.filter(s => s.sold_date >= sf.dateStart);
  if (sf.dateEnd) filtered = filtered.filter(s => s.sold_date <= sf.dateEnd);
  if (sf.status) filtered = filtered.filter(s => s.audit_status === sf.status);
  if (sf.repId) filtered = filtered.filter(s => s.rep_id === sf.repId);
  if (sf.contractTypeId) filtered = filtered.filter(s => s.contract_type_id === Number(sf.contractTypeId));
  if (sf.sourceId) filtered = filtered.filter(s => s.source_id === Number(sf.sourceId));
  if (sf.q) { const q = sf.q.toLowerCase(); filtered = filtered.filter(s => ((s.customer_name || '') + ' ' + (s.customer_number || '') + ' ' + (s.notes || '')).toLowerCase().includes(q)); }

  // Sortable column headers — click toggles asc/desc, arrow indicator on
  // the active column. Default: newest first by created_at (FIFO inverted).
  // Default on every queue (per Isaac, Oct 6): Sold Date, newest first —
  // until the user clicks a column, which takes over as usual. (Was created-at,
  // oldest-first on the pending queue.)
  if (!state._salesSort || (!state._salesSortTouched && state._salesSort.key === 'created_at')) state._salesSort = { key: 'sold_date', dir: 'desc' };
  const sortKey = state._salesSort.key;
  const sortDir = state._salesSort.dir;
  const sortVal = (s, key) => {
    switch (key) {
      case 'customer_name':   return (s.customer_name || '').toLowerCase();
      case 'customer_number': return s.customer_number || '';
      case 'rep':             return (state.allProfiles.find(p => p.id === s.rep_id)?.full_name || '').toLowerCase();
      case 'office':          return (state.offices.find(o => o.id === s.office_id)?.name || '').toLowerCase();
      case 'service_type':    return nameFromId(state.serviceTypes, s.service_type_id).toLowerCase();
      case 'contract':        return contractTypeLabelForSale(s).toLowerCase();
      case 'source':          return nameFromId(state.sources, s.source_id).toLowerCase();
      case 'initial_amount':  return Number(s.initial_amount || 0);
      case 'monthly_amount':  return Number(s.monthly_amount || 0);
      case 'revenue_amount':  return Number(s.revenue_amount || 0);
      case 'sold_date':       return s.sold_date || '';
      case 'commission_date': return (commissionableDate(s) || {}).date || '';
      case 'service_date': return s.crm_serviced_at ? String(s.crm_serviced_at).slice(0, 10) : (s.crm_initial_appt_at ? String(s.crm_initial_appt_at).slice(0, 10) : '');
      case 'audit_status':    return s.audit_status || '';
      case 'audited_by':      return (state.allProfiles.find(p => p.id === s.audited_by)?.full_name || '').toLowerCase();
      case 'crm_audit':       return s.crm_audit === 'passed' ? 2 : s.crm_audit === 'failed' ? 1 : 0;
      case 'created_at':      return new Date(s.created_at || s.sold_date).getTime();
      default:                return '';
    }
  };
  filtered = filtered.slice().sort((a, b) => {
    // On Pending Backend Lock, always group pending-decision rows above
    // already-decided rows (Lock / Chargeback) regardless of the column the
    // user picked. The decided rows are just waiting on backend payroll —
    // there's nothing to act on, so they shouldn't crowd the top.
    if (queueFilter === 'backend') {
      const decidedA = lockOf(a) !== 'pending' ? 1 : 0;
      const decidedB = lockOf(b) !== 'pending' ? 1 : 0;
      if (decidedA !== decidedB) return decidedA - decidedB;
    }
    const va = sortVal(a, sortKey);
    const vb = sortVal(b, sortKey);
    if (va < vb) return sortDir === 'asc' ? -1 : 1;
    if (va > vb) return sortDir === 'asc' ? 1 : -1;
    // Same value (e.g. several sales on one sold date): most recently logged first.
    return (new Date(b.created_at || b.sold_date).getTime() || 0) - (new Date(a.created_at || a.sold_date).getTime() || 0);
  });

  // Queue toggle is always the first row, regardless of which queue is active.
  // Individual pills that WRAP rather than one segmented strip — the strip
  // overflowed into a horizontal scroll/slider on mobile. Wrapping keeps every
  // pill visible and static on any width.
  // One joined segmented strip that spans the row (per Isaac — same look
  // as the Inside / D2D / Technicians toggle), equal-width segments.
  const queueToggle = el('div', { class: 'queue-strip flex w-full rounded-lg border overflow-hidden', style: { borderColor: 'var(--border-2)' } },
    ...[
      { id: 'upfront', label: 'Upfront Sales',                short: 'Sales' },
      { id: 'backend', label: 'Pending Backend Lock', short: 'Backend' },
      { id: 'cancels', label: 'Archived',             short: 'Archived' },
      { id: 'history', label: 'History',              short: 'History' },
    ].map((t, i) => el('button', {
      class: 'px-2.5 py-1 text-[11px] font-bold transition flex items-center justify-center gap-2 whitespace-nowrap' + (i ? ' border-l' : ''),
      style: queueFilter === t.id
        ? { background: 'var(--accent)', color: 'var(--accent-text)', borderColor: 'var(--border-2)' }
        : { color: 'var(--text-muted)', borderColor: 'var(--border-2)' },
      onclick: () => { state._salesQueueFilter = t.id; mountApp(); },
    },
      // Phones get the short label (the four pills overlapped on 390px).
      el('span', { class: 'queue-strip-full' }, t.label),
      el('span', { class: 'queue-strip-short' }, t.short),
      el('span', {
        class: 'text-[10px] tabular-nums px-1.5 py-0.5 rounded',
        style: queueFilter === t.id
          ? { background: 'rgba(0,0,0,.18)', color: 'var(--accent-text)' }
          : { background: 'var(--card-2)', color: 'var(--text-muted)' },
      }, queueCounts[t.id]),
    )),
  );

  // Filter bar (per Isaac): the same search / status / source / Export CSV
  // strip History uses (minus Export CSV), on every active queue — plus a rep picker for admins.
  const filterControls = () => [
    el('input', {
      id: 'sales-queue-q',
      class: 'flex-1 min-w-[200px] rounded-lg border px-2.5 py-1 text-[11px]',
      placeholder: 'Search customer or notes…',
      value: sf.q || '',
      onchange: e => { if (e.target.value.trim() && typeof trackAction === 'function') trackAction('search:sales_queue', state._salesQueueFilter || 'upfront', { len: e.target.value.trim().length }); },
      oninput: e => {
        sf.q = e.target.value;
        clearTimeout(state._salesQTimer);
        state._salesQTimer = setTimeout(() => {
          mountApp();
          const inp = document.getElementById('sales-queue-q');
          if (inp) { inp.focus(); const n = inp.value.length; try { inp.setSelectionRange(n, n); } catch (_) {} }
        }, 250);
      },
    }),
    el('select', {
      class: 'rounded-xl px-2.5 py-1 text-[11px] font-medium cursor-pointer',
      style: { maxWidth: '140px' },
      onchange: e => { sf.status = e.target.value; mountApp(); },
    },
      el('option', { value: '', selected: !sf.status }, 'All statuses'),
      ...SALE_STATUS_OPTIONS.map(([s, lbl]) =>
        el('option', { value: s, selected: sf.status === s }, lbl)),
    ),
    isAdmin && el('select', {
      class: 'rounded-xl px-2.5 py-1 text-[11px] font-medium cursor-pointer',
      style: { maxWidth: '140px' },
      onchange: e => { sf.repId = e.target.value; mountApp(); },
    },
      el('option', { value: '', selected: !sf.repId }, 'All reps'),
      // Only this tab's rep type (per Isaac, Oct 15): Office Staff here; Sales Reps / Technicians on theirs.
      // (also anyone credited with a sale in this tab's queue, so a rep whose CRM type hasn't synced yet isn't lost).
      ...(() => { const sellers = new Set(source.filter(x => (x.queue_type || 'office') === _queue).map(x => String(x.rep_id))); return (state.allProfiles||[])
        .filter(p => String(p.role || '') !== 'disabled' && ((typeof repTypeGroup === 'function' && repTypeGroup(p) === _queue) || sellers.has(String(p.id)))); })()
        .sort((a, b) => String(a.full_name || '').localeCompare(String(b.full_name || '')))
        .map(p => el('option', { value: p.id, selected: sf.repId === p.id }, p.full_name)),
    ),
    el('select', {
      class: 'rounded-xl px-2.5 py-1 text-[11px] font-medium cursor-pointer',
      style: { maxWidth: '160px' },
      onchange: e => { sf.sourceId = e.target.value; mountApp(); },
    },
      el('option', { value: '', selected: !sf.sourceId }, 'All sources'),
      ...(state.sources||[]).map(src => el('option', { value: src.id, selected: String(sf.sourceId) === String(src.id) }, src.name)),
    ),
    // Run payroll (per Isaac, Oct 15): right of All sources — the pay stubs for every commissionable account.
    (isAdmin && _queue === 'office' && queueFilter === 'upfront') && el('button', {
      class: 'rounded-xl px-3 py-1 text-[11px] font-bold transition hover:brightness-95 whitespace-nowrap', style: { background: 'var(--accent)', color: 'var(--accent-text)' },
      title: 'Pay stubs for every commissionable account on Upfront Sales — review, then confirm',
      onclick: () => openPayrollRun(source.filter(isUpfrontPending)),
    }, 'Run payroll'),
    (sf.status || sf.repId || sf.sourceId || sf.q) && el('button', {
      class: 'text-[11px] font-semibold px-2.5 py-1', style: { color: 'var(--accent)' },
      onclick: () => { Object.assign(sf, { dateStart:'', dateEnd:'', status:'', repId:'', contractTypeId:'', sourceId:'', q:'' }); mountApp(); },
    }, 'Clear'),
  ];

  // Top row: queue toggle on the left, status/rep filters right-aligned on
  // every active queue (per Isaac). No + New Sale here — sales are logged
  // from the Dashboard so the metrics stay front and center.
  // Admin totals strip (per Isaac): cumulative count + revenue per queue and
  // for the year, so the tab reads as a P&L of the pipeline, not just a list.
  const _sumRev = (list) => list.reduce((a, s) => a + (Number(s.revenue_amount) || 0), 0);
  const _yr = String(new Date().getFullYear());
  const _ytd = source.filter(s => String(s.sold_date || '').slice(0, 4) === _yr);
  // Phones (per Isaac, Oct 6): all five on ONE short row — label over the
  // number, no count line (the queue pills right below carry the counts).
  const _phoneT = (() => { try { return window.matchMedia('(max-width: 640px)').matches; } catch { return false; } })();
  const _tile = (label, list, accent, short) => {
    const rev = _sumRev(list), cnt = list.length.toLocaleString() + ' sale' + (list.length === 1 ? '' : 's');
    if (_phoneT) return el('div', { class: 'min-w-0 text-center', title: cnt, style: { flex: '1 1 0', padding: '5px 2px', borderLeft: '1px solid var(--border)' } },
      el('div', { class: 'uppercase font-semibold truncate', style: { fontSize: '8px', letterSpacing: '.08em', color: 'var(--text-subtle)' } }, short || label),
      el('div', { class: 'font-black tabular-nums', style: Object.assign({ fontSize: '13px', lineHeight: '1.25' }, accent ? { color: 'var(--accent)' } : {}) }, (rev >= 100000 && fmt.usdShort) ? fmt.usdShort(rev) : fmt.usd0(rev)));
    return el('div', { class: 'flex-1 min-w-0 px-3 py-2 text-center', style: { borderLeft: '1px solid var(--border)' } },
      el('div', { class: 'text-[9px] uppercase tracking-widest font-semibold', style: { color: 'var(--text-subtle)' } }, label),
      el('div', { class: 'text-base font-black tabular-nums', style: accent ? { color: 'var(--accent)' } : {} }, fmt.usd0(rev)),
      el('div', { class: 'text-[10px] tabular-nums text-muted-' }, cnt));
  };
  const totalsStrip = isAdmin ? el('div', { class: _phoneT ? 'card flex items-stretch overflow-hidden' : 'card flex items-stretch overflow-x-auto sales-totals-strip' },
    _tile(_yr + ' sold', _ytd, true, "'" + _yr.slice(2) + ' Sold'),
    _tile('Upfront', source.filter(isUpfrontPending)),
    _tile('Backend lock', source.filter(isBackendPending), false, 'Backend'),
    _tile('Archived', source.filter(isCancelled)),
    _tile('History', source.filter(isHistory))) : null;
  if (totalsStrip && _phoneT && totalsStrip.firstChild) totalsStrip.firstChild.style.borderLeft = '0';
  const queueRow = el('div', { class: 'flex flex-col gap-3' }, totalsStrip, el('div', { class: 'flex items-center justify-between gap-3 flex-wrap' }, queueToggle));
  // Phones (per Isaac): dropdowns share the top row (reps / sources /
  // statuses fit three across), the search bar spans the row below.
  const _phoneQ = (() => { try { return window.matchMedia('(max-width: 640px)').matches; } catch { return false; } })();
  const filterBar = queueFilter !== 'history'
    ? (_phoneQ ? (() => {
        const ctl = filterControls().filter(Boolean);
        const search = ctl.find(n => n.id === 'sales-queue-q');
        const rest = ctl.filter(n => n !== search);
        rest.forEach(n => { if (n.tagName === 'SELECT') { n.style.maxWidth = ''; n.style.minWidth = '0'; n.classList.add('flex-1'); } });
        search.classList.remove('min-w-[200px]'); search.classList.add('w-full');
        return el('div', { class: 'flex flex-col gap-2' },
          el('div', { class: 'flex gap-2 items-center' }, ...rest),
          search);
      })() : el('div', { class: 'flex flex-wrap gap-2 items-center' }, ...filterControls()))
    : null;

  // History pill swaps in the (settled) history view inline — same toggle on
  // top, but the body comes from viewHistory rather than the active-queue
  // table. No "+ New Sale" button here; settled sales aren't created from
  // the History view.
  if (queueFilter === 'history') {
    return el('div', { class: 'flex flex-col gap-5 w-full' },
      queueRow,
      viewHistory({ embedded: true }),
    );
  }

  return el('div', { class: 'flex flex-col gap-5 w-full' },
    (typeof repTodayStrip === 'function') ? repTodayStrip() : null,
    queueRow,
    filterBar,


    // 👻 Unlogged sales (per Isaac) — CRM subscriptions in this rep's name
    // with a signed agreement that were never logged here. Ghosted rows the
    // rep can Claim (opens Log Sale pre-filled) or mark Not mine.
    queueFilter === 'upfront' ? unloggedSalesBlock(isAdmin) : null,

    // ── Table ──
    filtered.length === 0
      ? el('div', { class: 'card p-10 text-center text-muted- text-sm' },
          isAdmin
            ? (queueFilter === 'backend'
                ? 'No sales waiting on a backend-lock decision.'
                : queueFilter === 'cancels'
                  ? 'Nothing archived \u2014 no cancelled, not-payable or rescheduled sales.'
                  : 'All caught up \u2014 no sales waiting for upfront audit.')
            : 'Nothing pending — new sales arrive from FieldRoutes automatically.')
      : el('div', {},
          // Mobile: card list (hidden on sm+). Tapping a card opens the same
          // edit modal as clicking a desktop row, so the rep can fix details
          // or admins can audit on a phone without horizontal-scrolling a
          // 13-column table.
          salesCardsMobile(filtered, { isAdmin, queueFilter }),
          // Upfront queue (per Isaac, Oct 14): sales from Oct 12 on — when office add-ons started — read as the
          // TV's Latest-sales rows with their add-ons and initial date; anything older keeps the table below.
          // Pending Backend Lock (office) reads the same rows — with invoices paid + days aging to watch (per Isaac, Oct 15).
          ((queueFilter === 'upfront' || (queueFilter === 'backend' && _queue === 'office')) && filtered.some(s => String(s.sold_date || '') >= SALES_FEED_START))
            ? el('div', { class: 'hidden sm:block mb-5' }, salesFeed(filtered.filter(s => String(s.sold_date || '') >= SALES_FEED_START), { isAdmin, title: queueFilter === 'backend' ? 'Waiting on 4 paid invoices' : '' })) : null,
          ((queueFilter === 'upfront' || (queueFilter === 'backend' && _queue === 'office')) && !filtered.some(s => String(s.sold_date || '') < SALES_FEED_START)) ? null :
          el('div', { class: 'hidden sm:block' },
            queueFilter === 'upfront' && filtered.some(s => String(s.sold_date || '') >= SALES_FEED_START) ? el('div', { class: 'text-[10px] uppercase tracking-widest font-semibold text-muted- mb-2' }, 'Before ' + fmt.dateShortYear(SALES_FEED_START)) : null,
            salesTable(queueFilter === 'upfront' ? filtered.filter(s => String(s.sold_date || '') < SALES_FEED_START) : filtered, { isAdmin, sortKey, sortDir,
              // Pending Backend Lock surfaces the second-pass review controls
              // (Audit 2 + Lock dropdown) plus any enriched columns from an
              // uploaded backend report so admins can decide row-by-row.
              showBackend: queueFilter === 'backend',
              // Pending queue (admins): live CRM account columns — status,
              // current sub, balance, aging, services done — so the backend
              // picture is visible while the sale is still upfront-pending.
              // (Live CRM account columns retired from the Upfront queue — per
              // Isaac, the Archived layout is the model; the CRM ✓ chips already
              // carry billing / past-due / serviced.)
              showCrmAccount: false,
              showReportCols: queueFilter === 'backend' && filtered.some(s => s.backend_report_uploaded_at),
              // Tint already-decided rows so they recede behind the rows still
              // needing a decision. Only applies on Pending Backend Lock.
              rowStyle: queueFilter === 'backend'
                ? (s) => lockOf(s) !== 'pending' ? { opacity: '.55', background: 'var(--bg-subtle)' } : null
                : null,
              onSort: (key) => {
                state._salesSortTouched = true;   // user took over — stop the oldest-first default
                if (state._salesSort.key === key) {
                  state._salesSort.dir = state._salesSort.dir === 'asc' ? 'desc' : 'asc';
                } else {
                  // Numeric / date columns default to descending (largest/newest first);
                  // text columns default to ascending (A→Z).
                  const NUMERIC = new Set(['initial_amount', 'monthly_amount', 'revenue_amount', 'sold_date', 'commission_date', 'created_at']);
                  state._salesSort = { key, dir: NUMERIC.has(key) ? 'desc' : 'asc' };
                }
                mountApp();
              },
            }),
          ),
        ),
  );
}

// 👻 Unlogged ("ghost") sales strip — sits above the Pending Upfront table.
// Reps see their own open ghosts; admins see every rep's. Claim opens the
// normal Log Sale form pre-filled from the CRM row and, once the sale is
// inserted, marks the ghost claimed (linked to the new sale). Not mine
// dismisses it (admins can still see dismissed rows in the DB).
function unloggedSalesBlock(isAdmin) {
  // Per Isaac: with auto-log on, sales match by FieldRoutes rep id — nobody
  // claims anything. The strip only shows when auto-log is switched off.
  const _al = state._autolog || state._autologCache;
  if (!_al || _al.enabled) return null;   // unknown yet or ON → no strip
  const all = state.unloggedSales || [];
  const mine = all.filter(g => g.status === 'open' && (isAdmin || g.rep_id === state.profile?.id));
  if (!mine.length) return null;
  const repName = (id) => (state.allProfiles || []).find(p => p.id === id)?.full_name || '';
  const norm = (x) => String(x || '').trim().toLowerCase();
  const resolve = async (g, status, saleId) => {
    const upd = { status, resolved_at: new Date().toISOString(), resolved_by: state.profile?.id || null };
    if (saleId) upd.sale_id = saleId;
    if (DEMO) { Object.assign(g, upd); saveDemoData(); mountApp(); return; }
    const { error } = await supabase.from('unlogged_sales').update(upd).eq('id', g.id);
    if (error) { toast('Could not update: ' + error.message, 'error'); return; }
    Object.assign(g, upd);
    mountApp();
  };
  const claim = (g) => {
    // Map the CRM names onto the app's lookup ids; anything that doesn't
    // resolve is left blank for the rep to pick.
    const ctName = (Number(g.contract_months) || 12) + ' Months';
    const prefill = {
      rep_id: g.rep_id,
      customer_name: g.customer_name,
      customer_number: g.customer_number,
      office_id: (state.offices || []).find(o => norm(o.name) === norm(g.office_name))?.id ?? null,
      contract_type_id: (state.contractTypes || []).find(c => norm(c.name) === norm(ctName))?.id ?? null,
      service_type_id: (state.serviceTypes || []).find(t => norm(t.name) === norm(g.crm_subscription))?.id ?? null,
      source_id: (state.sources || []).find(o => norm(o.name) === norm(g.subscription_source))?.id ?? null,
      initial_amount: g.initial_amount,
      monthly_amount: g.monthly_amount,
      sold_date: g.sold_date,
      notes: 'Claimed from FieldRoutes (unlogged) · signed ' + (g.contract_signed_at || '—'),
    };
    openNewSaleModal(g.rep_id, null, { prefill, onLogged: (saleId) => resolve(g, 'claimed', saleId) });
  };
  // Same columns as the sales table below (per Isaac) so the eye doesn't
  // re-learn a layout: Customer Name · Customer # · Office Rep · Office ·
  // Service Type · Contract Type · Source · Initial · Monthly · Revenue ·
  // Sold Date · Signed · actions. Shown 25 at a time; a search box narrows.
  const st = (state._unlogged = state._unlogged || { limit: 25, q: '' });
  const q = norm(st.q);
  const shown = q ? mine.filter(g => norm(g.customer_name + ' ' + g.customer_number + ' ' + repName(g.rep_id) + ' ' + g.crm_subscription + ' ' + g.subscription_source + ' ' + g.office_name).includes(q)) : mine;
  const th = (t, right) => el('th', { class: (right ? 'text-right' : 'text-left') + ' px-2 py-2 font-semibold whitespace-nowrap' }, t);
  const td = (c, cls = '') => el('td', { class: 'px-2 py-2 ' + cls }, c);
  const row = (g) => el('tr', {
    class: 'border-t border- transition',
    style: { opacity: '.72' },
    title: 'In FieldRoutes this subscription is sold by ' + (repName(g.rep_id) || 'this rep') + ' with a signed agreement, but it was never logged here.',
  },
    el('td', { class: 'pl-4 pr-2 py-2 font-medium whitespace-nowrap max-w-[160px] truncate', title: g.customer_name }, g.customer_name || ('Customer ' + g.customer_number)),
    td(el('span', { class: 'text-muted- tabular-nums' }, g.customer_number || '—'), 'whitespace-nowrap'),
    td(el('span', { class: 'text-[11px] font-medium whitespace-nowrap' }, (repName(g.rep_id) || '—').split(' ')[0])),
    td(el('span', { class: 'text-muted- whitespace-nowrap' }, g.office_name || '—')),
    td(el('span', { class: 'text-muted- max-w-[140px] truncate inline-block align-bottom', title: g.crm_subscription }, g.crm_subscription || '—')),
    td(el('span', { class: 'text-muted- whitespace-nowrap' }, (Number(g.contract_months) || 12) + ' Mo')),
    td(el('span', { class: 'text-muted- whitespace-nowrap max-w-[110px] truncate inline-block align-bottom', title: g.subscription_source }, g.subscription_source || '—')),
    el('td', { class: 'px-2 py-2 text-right tabular-nums whitespace-nowrap' }, fmt.usd(g.initial_amount || 0)),
    el('td', { class: 'px-2 py-2 text-right tabular-nums whitespace-nowrap text-muted-' }, fmt.usd(g.monthly_amount || 0)),
    el('td', { class: 'px-2 py-2 text-right tabular-nums font-semibold whitespace-nowrap' }, fmt.usd(g.revenue_amount || 0)),
    td(el('span', { class: 'text-muted- tabular-nums whitespace-nowrap' }, fmt.dateShortYear(g.sold_date))),
    td(el('span', { class: 'text-muted- tabular-nums whitespace-nowrap' }, g.contract_signed_at ? fmt.dateShortYear(g.contract_signed_at) : '—')),
    el('td', { class: 'px-2 py-2 whitespace-nowrap' },
      el('div', { class: 'flex items-center gap-1.5 justify-end' },
        el('button', { class: 'rounded-lg px-2.5 py-1 text-[11px] font-bold transition hover:brightness-95', style: { background: 'var(--accent)', color: 'var(--accent-text)' }, onclick: () => claim(g) }, 'Claim'),
        el('button', { class: 'rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition hover:brightness-95', style: { borderColor: 'var(--border-2)', color: 'var(--text-muted)' },
          onclick: () => { if (confirm('Mark this subscription as not yours? It will leave your board.')) resolve(g, 'dismissed'); } }, 'Not mine'))),
  );
  const search = el('input', { type: 'search', placeholder: 'Search unlogged…', value: st.q, class: 'rounded-lg border px-2.5 py-1 text-[11px]', style: { borderColor: 'var(--border-2)', background: 'var(--card)', color: 'var(--text)', minWidth: '180px' },
    oninput: (e) => { st.q = e.target.value; st.limit = 25; clearTimeout(st._t); st._t = setTimeout(() => mountApp(), 250); } });
  return el('div', { class: 'card overflow-hidden mb-4' },
    el('div', { class: 'flex items-center justify-between gap-3 px-4 py-2.5 flex-wrap' },
      el('div', { class: 'flex items-center gap-2' },
        el('span', { class: 'font-bold text-sm' }, 'Unlogged sales'),
        el('span', { class: 'text-[11px] text-muted-' }, mine.length + ' in FieldRoutes under ' + (isAdmin ? 'reps’ names' : 'your name') + ', signed, not logged here')),
      el('div', { class: 'flex items-center gap-2 flex-wrap' },
        search,
        el('span', { class: 'text-[10px] text-muted-' }, 'Claim to log it and start the audit · Not mine to dismiss'))),
    el('div', { class: 'scroll-x' },
      el('table', { class: 'w-full text-xs' },
        el('thead', { class: 'text-[9px] uppercase tracking-wider text-muted- bg-card2-' },
          el('tr', {}, el('th', { class: 'text-left pl-4 pr-2 py-2 font-semibold whitespace-nowrap' }, 'Customer Name'), th('Customer #'), th('Office Rep'), th('Office'), th('Service Type'), th('Contract Type'), th('Source'), th('Initial', true), th('Monthly', true), th('Revenue', true), th('Sold Date'), th('Signed'), th(''))),
        el('tbody', {}, ...shown.slice(0, st.limit).map(row)))),
    shown.length > st.limit
      ? el('div', { class: 'px-4 py-2 border-t text-center', style: { borderColor: 'var(--border)' } },
          el('button', { class: 'text-[11px] font-semibold', style: { color: 'var(--accent)' }, onclick: () => { st.limit += 50; mountApp(); } }, 'Show more (' + (shown.length - st.limit) + ' left)'))
      : null);
}

// Mobile-only card list. Mirrors salesTable for phones: each sale is a tap-
// target that opens the same edit modal as a desktop row. Admins also get the
// status + auditor dropdowns inline so they can audit on a phone. We keep this
// deliberately spare — no sort headers, no filter chips, no horizontal scroll.
function salesCardsMobile(rows, { isAdmin = false, queueFilter = 'upfront' } = {}) {
  // Compact cards (per Isaac, Oct 6): two lines per sale — about half the old height.
  return el('div', { class: 'flex flex-col sm:hidden', style: { gap: '6px' } },
    ...rows.map(s => {
      const rep = s.rep_id ? (state.allProfiles.find(p => p.id === s.rep_id) || (state.profile && state.profile.id === s.rep_id ? state.profile : null)) : null;
      const repFirst = rep ? (rep.full_name || '').split(' ')[0] : (s.crm_seller_name ? String((typeof flipLastFirst === 'function' ? flipLastFirst(s.crm_seller_name) : s.crm_seller_name)).split(' ')[0] + ' (no account)' : 'Unlinked');
      const ctName = contractTypeLabelForSale(s);
      const noteTxt = s.notes || '';
      const rptM = (queueFilter === 'backend' && (state.reportingSubscriptions || []).length)
        ? reportingBackendMatch(s.customer_number)
        : null;
      return el('div', {
        class: 'card transition active:brightness-95',
        style: { padding: '8px 12px' },
        onclick: (e) => {
          if (e.target.closest('select, button, input, textarea, a')) return;
          openNewSaleModal(null, s);
        },
      },
        // Line 1: customer · revenue · status chip
        el('div', { class: 'flex items-center gap-2' },
          el('div', { class: 'font-semibold text-sm truncate min-w-0 flex-1', title: s.customer_name }, s.customer_name),
          el('span', { class: 'tabular-nums font-bold text-sm whitespace-nowrap' }, fmt.usd(s.revenue_amount)),
          statusChip(s.audit_status),
        ),
        // Line 2: # · sold · service on the left; rep (admin) · contract on the right
        el('div', { class: 'flex items-center justify-between gap-2 text-[11px] text-muted-', style: { marginTop: '2px' } },
          el('span', { class: 'truncate min-w-0' },
            [
              s.customer_number ? '#' + s.customer_number : null,
              'sold ' + fmt.dateShort(s.sold_date),
              s.crm_serviced_at ? '\u2713 ' + fmt.dateShort(String(s.crm_serviced_at).slice(0, 10)) : s.crm_initial_appt_at ? 'svc ' + fmt.dateShort(String(s.crm_initial_appt_at).slice(0, 10)) : 'not scheduled',
            ].filter(Boolean).join(' \u00b7 ')),
          el('span', { class: 'whitespace-nowrap shrink-0' }, (isAdmin && repFirst ? repFirst + ' \u00b7 ' : '') + ctName),
        ),
        // Backend queue: live account state cross-referenced from the snapshot.
        (queueFilter === 'backend' && (state.reportingSubscriptions || []).length) && el('div', {
          class: 'flex items-center gap-2 mt-1 text-[11px] flex-wrap',
        },
          rptM
            ? el('span', {
                class: 'inline-block px-2 py-0.5 rounded-full text-[10px] font-bold',
                style: rptM.isActive ? { background: 'rgba(223,100,58,.15)', color: '#DF643A' } : { background: 'rgba(220,38,38,.12)', color: '#B91C1C' },
              }, rptM.status)
            : el('span', { style: { color: 'var(--text-subtle)' } }, 'No CSV match'),
          rptM && el('span', { class: 'text-muted-', style: (rptM.daysPastDue > 0) ? { color: '#DC2626', fontWeight: '600' } : {} },
            (rptM.daysPastDue != null ? rptM.daysPastDue.toLocaleString() : '—') + ' days past due'),
          rptM && rptM.completedServices != null && el('span', { class: 'text-muted-' }, rptM.completedServices.toLocaleString() + ' svcs done'),
        ),
        // Optional note preview
        noteTxt && el('div', {
          class: 'mt-1 text-[11px] italic text-muted- truncate',
        }, noteTxt),
        // Admin-only inline audit controls. On Backend Lock queue, surface the
        // second-pass dropdowns instead so the reviewer can decide right here.
        isAdmin && el('div', { class: 'flex items-center gap-2 mt-1.5 flex-wrap' },
          queueFilter === 'backend'
            ? [auditor2Select(s.id), lockStatusSelect(s.id)]
            : [statusSelect(s.id), auditorSelect(s.id)],
        ),
      );
    }),
  );
}

// ── Backend cross-reference: rep-logged sales ↔ active Reporting snapshot ──
// A sale's customer_number is the FieldRoutes customer ID, which matches a
// reporting row's customer_id. We index the snapshot by that ID (cached per
// loaded snapshot) so the backend queue can show each account's CURRENT state.
let _reportingCustIndex = null, _reportingCustIndexFor = null;
function reportingCustomerIndex() {
  const sig = (state.reportingSubscriptionsLoadedFor || '') + ':' + (state.reportingSubscriptions || []).length;
  if (_reportingCustIndexFor === sig && _reportingCustIndex) return _reportingCustIndex;
  const map = new Map();
  for (const r of (state.reportingSubscriptions || [])) {
    const id = r.customer_id != null ? String(r.customer_id).trim() : '';
    if (!id) continue;
    if (!map.has(id)) map.set(id, []);
    map.get(id).push(r);
  }
  _reportingCustIndex = map;
  _reportingCustIndexFor = sig;
  return map;
}

// Current account state for one customer, for the backend cross-reference.
// Per the workflow: an upsell can change the subscription over time, so we
// report whatever is LIVE on the account now rather than the originally-sold
// sub. Returns null when the customer isn't in the active snapshot at all.
function reportingBackendMatch(custNumber, index) {
  const id = custNumber != null ? String(custNumber).trim() : '';
  if (!id) return null;
  const matched = (index || reportingCustomerIndex()).get(id);
  if (!matched || !matched.length) return null;
  const isActive = (r) => (r.subscription_status || '').toLowerCase() === 'active' && !r.subscription_date_canceled;
  const active = matched.filter(isActive);
  const pickBy = (arr, score) => arr.slice().sort((a, b) => score(b) - score(a))[0];
  let pick;
  if (active.length) {
    // The established live sub: most completed services, tie-broken by ARV.
    pick = pickBy(active, r => (Number(r.subscription_completed_services) || 0) * 1e6 + (Number(r.annual_recurring_value) || 0));
  } else {
    // Nothing active: prefer a Pending/Completed-initial sub (a frozen
    // re-keyed ghost must never outrank its live twin), then fall back to
    // the most recently canceled sub for context.
    const ps = matched.filter(r => ['pending', 'completed'].includes(String(r.initial_status || '').toLowerCase()));
    pick = ps.length
      ? pickBy(ps, r => (Number(r.subscription_completed_services) || 0) * 1e6 + (Number(r.annual_recurring_value) || 0))
      : (pickBy(matched, r => Date.parse(r.subscription_date_canceled || '') || 0) || matched[0]);
  }
  return {
    isActive: active.length > 0,
    status: active.length > 0 ? 'Active' : 'Inactive',
    subscription: pick.subscription || null,
    daysPastDue: pick.days_past_due != null ? Number(pick.days_past_due) : null,
    // Customer-level dollar balance (fieldRoutes_responsibleBalance) — same
    // on every sub row, so read it off the pick.
    balance: pick.responsible_balance != null ? Number(pick.responsible_balance) : null,
    completedServices: pick.subscription_completed_services != null ? Number(pick.subscription_completed_services) : null,
    cancelDate: pick.subscription_date_canceled || null,
    cancelReason: pick.subscription_cancellation_reason || null,
    matchedCount: matched.length,
  };
}

// CRM revenue verdict for one logged sale. The 30-min sync stamps crm_status
// on the row (authoritative, visible to everyone); when a sale is newer than
// the last stamp and this browser has the reporting snapshot loaded (admins),
// fall back to a LIVE check so a just-logged sale gets its verdict instantly.
function saleCrmVerdict(s, index) {
  if (s.crm_status) {
    return { status: s.crm_status, cv: s.crm_contract_value != null ? Number(s.crm_contract_value) : null, sub: s.crm_subscription || null, live: false };
  }
  const idx = index || reportingCustomerIndex();
  if (!idx || !idx.size) return { status: 'unchecked', cv: null, sub: null, live: true };   // reps have no snapshot — wait for the sync stamp
  const id = s.customer_number != null ? String(s.customer_number).trim() : '';
  const rows = id ? idx.get(id) : null;
  if (!rows || !rows.length) return { status: 'not_found', cv: null, sub: null, live: true };
  const rev = Number(s.revenue_amount) || 0;
  const soldT = Date.parse(s.sold_date || '') || 0;
  const near = soldT ? rows.filter(r => { const t = Date.parse(r.sold_date || ''); return t && Math.abs(t - soldT) <= 7 * 86400000; }) : [];
  const pool = near.length ? near : rows;
  let best = pool[0], bestDiff = Infinity;
  for (const r of pool) {
    const v = Number(r.subscription_contract_value) || 0;
    const d = Math.abs(v - rev);
    if (d < bestDiff) { bestDiff = d; best = r; }
  }
  const cv = Number(best.subscription_contract_value) || 0;
  return { status: bestDiff === 0 ? 'verified' : bestDiff <= 1 ? 'near_match' : 'revenue_mismatch', cv, sub: best.subscription || null, live: true,
    // Post-sale truth: did the CRM copy of this sale get CANCELLED after we
    // audited/paid it? Surfaced as a queue chip so pay reconciliation isn't manual.
    crmCancelled: best.subscription_date_canceled || null,
    crmCancelReason: best.subscription_date_canceled ? reportingCancelReasonOf(best) : null };
}

function salesTable(rows, { isAdmin = false, sortKey, sortDir, onSort, showBackend = false, showReportCols = false, showCrmAccount = false, rowStyle } = {}) {
  // Backend queue AND the pending queue (showCrmAccount) cross-reference the
  // active Reporting snapshot by customer #: live account status, current
  // sub, balance, aging, services done — the backend picture, up front.
  const rptIndex = (showBackend || showCrmAccount) ? reportingCustomerIndex() : null;
  const showRptStatus = !!(rptIndex && rptIndex.size);
  const cell = (content, extraClass = '') => el('td', {
    class: 'px-2 py-2 ' + extraClass,
  }, content);

  // Sortable header. Pass `sortableKey` to make it click-to-sort with an
  // arrow indicator on the active column. Pass `align: 'right'` for numeric
  // columns so the label hugs the right edge like the cells underneath.
  const headerCell = (label, opts = {}) => {
    const sortableKey = typeof opts === 'string' ? null : opts.sortableKey;
    const align = typeof opts === 'string' ? 'left' : (opts.align || 'left');
    const extraClass = typeof opts === 'string' ? opts : (opts.extraClass || '');
    const isActive = sortableKey && sortKey === sortableKey;
    const arrow = '';   // arrows retired app-wide — active header is highlighted
    const hlStyle = isActive ? { color: 'var(--accent)', fontWeight: '800' } : {};
    const baseClass = (align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left') + ' px-2 py-2 font-semibold whitespace-nowrap ' + extraClass;
    const title = typeof opts === 'string' ? '' : (opts.title || '');
    // Every header gets a short pop-up explainer (hover / tap) — per Isaac.
    const help = typeof opts === 'string' ? '' : (opts.help || title || '');
    const th = (!sortableKey || !onSort)
      ? el('th', { class: baseClass + (help ? ' cursor-help' : '') }, label + arrow)
      : el('th', {
          class: baseClass + ' cursor-pointer select-none hover:text-default transition',
          style: hlStyle,
          onclick: () => onSort(sortableKey),
        }, label + arrow);
    if (help && typeof attachExplainer === 'function') attachExplainer(th, { title: String(label).replace(' ✓', ''), desc: help + (sortableKey && onSort ? ' · Click to sort.' : '') });
    else if (title) th.title = title;
    return th;
  };
  const H = {
    customer: 'The customer, as entered on the sale. Click the name to open the sale details.',
    number:   'FieldRoutes customer number. This is what links the sale to the CRM for the automatic checks.',
    rep:      'The office rep who logged the sale and gets the commission.',
    office:   'The branch the customer belongs to.',
    service:  'The plan sold (e.g. Pest 4 = quarterly pest control).',
    contract: 'Agreement length — 12, 18 or 24 months — or Renewal for an existing customer re-signing.',
    source:   'Where the lead came from. Pay rate and renewal treatment depend on this.',
    initial:  'Price of the initial service.',
    monthly:  'Recurring monthly price after the initial.',
    revenue:  'Contract revenue the sale is credited for (initial + recurring for the term). Commission, goals and the leaderboard all run on this number.',
    sold:     'The date the sale was logged / signed.',
    pif:      'Paid in Full — the "Paid In Full" button on the customer card in FieldRoutes. Synced automatically; no backend hold and full commission pays out.',
    commercial: 'Commercial account — the Commercial Account toggle on the customer card in FieldRoutes. Synced automatically; pays the commercial rate.',
    comm:     'Commission paid — stamped by payroll when this sale goes out on a pay run.',
    upfront:  'Passed Audit — the office flagged this account Passed Audit in FieldRoutes (signed agreement, autopay on file, charged upfront). Makes the sale commissionable on the sale date and feeds the Passed Audit % pay tier.',
    status:   'Audit status. New sales sit in Pending until audited, then Approved, Cancelled, NSF, Rejected, and so on.',
    audit:    'The office audit flag on the customer card in FieldRoutes: Passed Audit, Failed Audit, or not audited yet. Synced automatically — set it in the CRM, not here.',
    crm:      'Automatic checks against FieldRoutes: revenue matches, initial appointment scheduled, billing on file, agreement signed. Green = confirmed in the CRM.',
  };

  return el('div', { class: 'card overflow-hidden' },
    el('div', { class: 'scroll-x' },
      el('table', { class: 'w-full text-xs' },
        el('thead', { class: 'text-[9px] uppercase tracking-wider text-muted- bg-card2-' },
          el('tr', {},
            headerCell('Customer Name', { sortableKey: 'customer_name', extraClass: 'pl-4', help: H.customer }),
            headerCell('Customer #',    { sortableKey: 'customer_number', help: H.number }),
            headerCell('Office Rep',    { sortableKey: 'rep', help: H.rep }),
            // Backend-lock review doesn't need office / service / source /
            // initial / monthly — the reviewer keys off revenue + contract +
            // the report data. Hiding those keeps the table scannable.
            !showBackend && headerCell('Office',      { sortableKey: 'office', help: H.office }),
            !showBackend && headerCell('Service Type',{ sortableKey: 'service_type', help: H.service }),
            headerCell('Contract Type', { sortableKey: 'contract', help: H.contract }),
            !showBackend && headerCell('Source',      { sortableKey: 'source', help: H.source }),
            !showBackend && headerCell('Initial',     { sortableKey: 'initial_amount', align: 'right', help: H.initial }),
            !showBackend && headerCell('Monthly',     { sortableKey: 'monthly_amount', align: 'right', help: H.monthly }),
            headerCell('Revenue',     { sortableKey: 'revenue_amount', align: 'right', help: H.revenue }),
            headerCell('Sold Date',   { sortableKey: 'sold_date', help: H.sold }),
            headerCell('Initial Date', { sortableKey: 'service_date', title: 'The initial appointment in FieldRoutes: the scheduled date until it happens, then the completed date with a \u2713. Commissionable status doesn\u2019t wait on this \u2014 a sale charged upfront is commissionable on the sale date.' }),
            // Three flags, sheet-style (per Isaac): PIF · COMM. (commission
            // paid out) · Upfront (payment collected at signing). Admins
            // toggle PIF / Upfront right here; COMM. is read-only — it is
            // stamped by payroll.
            headerCell('PIF',     { extraClass: 'text-center', align: 'center', help: H.pif }),
            headerCell('Passed Audit', { extraClass: 'text-center', align: 'center', help: H.upfront }),
            headerCell('Comm.', { extraClass: 'text-center', align: 'center', help: H.commercial }),
            headerCell('Status',      { sortableKey: 'audit_status', help: H.status }),
            headerCell('Audit',       { sortableKey: 'crm_audit', extraClass: 'text-center', align: 'center', help: H.audit }),
            // CRM revenue check + lifecycle chips — auto-verified against the
            // FieldRoutes warehouse (matched by customer #). Last so the
            // sheet-shaped columns read first.
            headerCell('CRM ✓', { help: H.crm }),
            // Pending Backend Lock pill: surface the second-pass review pair.
            showBackend && headerCell('Audit 2'),
            showBackend && headerCell('Lock'),
            // Live account state cross-referenced from the active Reporting
            // snapshot (matched by customer #). Drives backend decisions:
            // is the account still active, behind on payment, and serviced?
            showRptStatus && headerCell('Acct Status'),
            showRptStatus && headerCell('Live Sub'),
            showRptStatus && headerCell('Balance',       { align: 'right' }),
            showRptStatus && headerCell('Days Past Due', { align: 'right' }),
            showRptStatus && headerCell('Svcs Done',     { align: 'right' }),
            // Enriched columns from an uploaded backend report (xlookup'd by
            // customer #). Only show once a report exists so the table stays
            // narrow on the typical day-to-day pass.
            showReportCols && headerCell('Subscriptions',  { align: 'right' }),
            showReportCols && headerCell('Appts Done',     { align: 'right' }),
            showReportCols && headerCell('Aging',          { align: 'right' }),
            showReportCols && headerCell('Sub Type'),
            headerCell('Notes'),
          ),
        ),
        el('tbody', {},
          rows.map(s => {
            const rep = s.rep_id ? (state.allProfiles.find(p => p.id === s.rep_id) || (state.profile && state.profile.id === s.rep_id ? state.profile : null)) : null;
            const first = rep ? (rep.full_name || '').split(' ')[0] : (s.crm_seller_name ? String((typeof flipLastFirst === 'function' ? flipLastFirst(s.crm_seller_name) : s.crm_seller_name)).split(' ')[0] + ' (no account)' : 'Unlinked');
            const ctName = contractTypeLabelForSale(s);
            const noteTxt = s.notes || '';
            const rpt = showRptStatus ? reportingBackendMatch(s.customer_number, rptIndex) : null;
            // Per-row style override (e.g. "decided rows fade out" on Backend
            // Lock so the eye lands on rows still needing a decision).
            const extraRowStyle = rowStyle ? rowStyle(s) : null;
            return el('tr', {
              class: 'border-t border- hover:brightness-95 transition cursor-pointer',
              style: extraRowStyle || {},
              // Click anywhere on the row that ISN'T an interactive control to
              // open the sale in the same modal as "+ New Sale", pre-filled.
              onclick: (e) => {
                if (e.target.closest('select, button, input, textarea, a')) return;
                openNewSaleModal(null, s);
              },
            },
              el('td', { class: 'pl-4 pr-2 py-2 font-medium whitespace-nowrap max-w-[160px] truncate', title: s.customer_name }, s.customer_name),
              cell(el('span', { class: 'text-muted- tabular-nums' }, s.customer_number || '—'), 'whitespace-nowrap'),
              cell(
                el('div', { class: 'flex items-center gap-1.5' },
                  avatarNode(rep?.avatar_url, rep?.initials, 'w-5 h-5 text-[8px]'),
                  el('span', { class: 'text-[11px] font-medium whitespace-nowrap' }, first),
                ),
              ),
              !showBackend && cell(el('span', { class: 'text-muted- whitespace-nowrap' }, state.offices.find(o => o.id === s.office_id)?.name || '—')),
              // Base plan + the add-ons credited to the same rep ride on ONE row (per Isaac, Sep 29).
              !showBackend && cell((() => { const nm = nameFromId(state.serviceTypes, s.service_type_id) + (s.addon_names ? ' + ' + s.addon_names : ''); return el('span', { class: 'text-muted- max-w-[180px] truncate inline-block align-bottom', title: nm }, nm); })()),
              cell(el('span', { class: 'text-muted- whitespace-nowrap' }, ctName)),
              !showBackend && cell(el('span', { class: 'text-muted- whitespace-nowrap max-w-[110px] truncate inline-block align-bottom', title: nameFromId(state.sources, s.source_id) }, nameFromId(state.sources, s.source_id))),
              !showBackend && el('td', { class: 'px-2 py-2 text-right tabular-nums whitespace-nowrap' }, fmt.usd(s.initial_amount)),
              !showBackend && el('td', { class: 'px-2 py-2 text-right tabular-nums whitespace-nowrap text-muted-' }, fmt.usd(s.monthly_amount)),
              el('td', { class: 'px-2 py-2 text-right tabular-nums font-semibold whitespace-nowrap',
                title: s.commission_split ? 'Commissionable ' + fmt.usd(s.revenue_amount) + ' of ' + fmt.usd(s.total_revenue) + ' on the account (service fees and add-ons credited to other users are out)' : '' },
                fmt.usd(s.revenue_amount), s.commission_split && Number(s.total_revenue) > Number(s.revenue_amount) + 0.005 ? el('div', { class: 'text-[9px] font-normal', style: { color: 'var(--text-muted)' } }, 'of ' + fmt.usd(s.total_revenue)) : null),
              cell(el('span', { class: 'text-muted- tabular-nums whitespace-nowrap' }, fmt.dateShortYear(s.sold_date))),
              cell((() => {
                // Service Date (per Isaac): the initial service completion
                // stamped from FieldRoutes; the commissionable reasoning
                // rides in the tooltip.
                const c = commissionableDate(s);
                const svc = s.crm_serviced_at ? String(s.crm_serviced_at).slice(0, 10) : null;
                const sched = s.crm_initial_appt_at ? String(s.crm_initial_appt_at).slice(0, 10) : null;
                if (svc) return el('span', { class: 'tabular-nums whitespace-nowrap font-medium', title: 'Initial service completed ' + svc + ' \u00b7 ' + c.why, style: { color: 'var(--ok)' } }, '\u2713 ' + fmt.dateShortYear(svc));
                if (sched) { const past = sched < new Date().toISOString().slice(0, 10); return el('span', { class: 'tabular-nums whitespace-nowrap font-medium', title: (past ? 'Initial appointment was scheduled for ' + sched + ' but is not marked completed in FieldRoutes' : 'Initial appointment scheduled for ' + sched) + ' \u00b7 ' + c.why, style: past ? { color: '#B45309' } : {} }, (past ? '\u26a0 ' : '') + fmt.dateShortYear(sched)); }
                return el('span', { class: 'tabular-nums whitespace-nowrap text-muted-', title: 'No initial appointment on the subscription yet \u00b7 ' + c.why, style: { color: 'var(--text-subtle)' } }, 'not scheduled');
              })()),
              el('td', { class: 'px-2 py-2 text-center' }, saleFlagBox(s, 'paid_in_full', isAdmin, 'Paid in Full — the "Paid In Full" button on the FieldRoutes customer card')),
              el('td', { class: 'px-2 py-2 text-center' }, saleFlagBox(s, 'upfront_collected', isAdmin, 'Passed Audit — flagged in FieldRoutes (feeds the Passed Audit % pay tier)')),
              el('td', { class: 'px-2 py-2 text-center' }, saleFlagBox(s, 'is_commercial', false, 'Commercial Account toggle on the FieldRoutes customer card — pays the commercial rate')),
              // Status + the payroll stamp under it (per Isaac: the paid flag
              // lives here, not in its own column).
              el('td', { class: 'px-2 py-2 whitespace-nowrap' }, statusSelect(s.id),
                s.payroll_processed_at ? el('div', { class: 'text-[10px] font-semibold mt-0.5', style: { color: 'var(--ok)' }, title: 'Commission paid out on this pay run' }, '\u2713 Paid ' + fmt.dateShortYear(String(s.payroll_processed_at).slice(0, 10)))
                : s.staged_for_payroll ? el('div', { class: 'text-[10px] font-semibold mt-0.5', style: { color: 'var(--text-muted)' } }, 'Staged for payroll') : null),
              // Audit = the office's Passed / Failed Audit flag on the
              // FieldRoutes customer card (synced hourly) — not an assigned
              // auditor (per Isaac).
              el('td', { class: 'px-2 py-2 whitespace-nowrap text-center' }, saleAuditChip(s)),
              el('td', { class: 'px-2 py-2 whitespace-nowrap' }, (() => {
                const v = saleCrmVerdict(s, rptIndex);
                const chip = (txt, bg, colr, tip) => el('span', {
                  class: 'inline-block px-2 py-0.5 rounded-full text-[10px] font-bold',
                  style: { background: bg, color: colr }, title: tip,
                }, txt);
                // Lifecycle chips (stamped hourly by the sync once
                // sales_crm_lifecycle.sql has been run): serviced yet? paid /
                // current? Rendered alongside the value-exactness chip so an
                // signed-agreement chip rides along too (FieldRoutesContract).
                const lcChips = [];
                // Seller risk (per Isaac): this rep's 90-day cancel rate is ≥ 2× their
                // office's — flag the sale for a second-touch call before it churns.
                (() => { try { if (!isAdmin || typeof intelSellerRisk !== 'function') return; const m = intelSellerRisk(); const rk = m && m.get(String(rep?.full_name || '').toLowerCase()); if (rk) lcChips.push(chip('⚠ 2× cancels', 'rgba(220,38,38,.12)', '#B91C1C', 'Sold by a rep whose 90-day cancel rate (' + Math.round(rk.cxl * 100) + '%) is ≥ 2× their office (' + Math.round(rk.base * 100) + '%) over the last 12 months · ' + rk.n + ' accounts judged · worth a second-touch call')); } catch (e) {} })();
                // Inside Sales backend lock (per Isaac, Oct 14): N paid invoices, initial included — counted daily by the sync.
                if (s.crm_paid_invoices != null && (s.queue_type || 'office') === 'office') { const _N = Math.max(1, parseInt((((state._autolog || {}).backend || {}).office || {}).paid_invoices, 10) || 4); const _n = Number(s.crm_paid_invoices) || 0;
                  lcChips.push(_n >= _N ? chip('🧾 ' + _n + ' of ' + _N + ' paid', 'rgba(95,108,91,.16)', '#5F6C5B', 'Paid invoices on the plan since the sale (initial included) — backend lock reached' + (s.crm_paid_invoices_at ? ' · counted ' + String(s.crm_paid_invoices_at).slice(0, 10) : ''))
                    : chip('🧾 ' + _n + ' of ' + _N + ' paid', 'var(--card-2)', 'var(--text-muted)', 'Paid invoices on the plan since the sale (initial included) — the backend locks at ' + _N + (s.crm_paid_invoices_at ? ' · counted ' + String(s.crm_paid_invoices_at).slice(0, 10) : ''))); }
                if (s.sale_kind === 'upsell') lcChips.push(chip('＋ Upsell', 'rgba(156,63,30,.14)', '#9C3F1E', 'Add-on' + (s.crm_ticket_id ? ' · FieldRoutes ticket #' + s.crm_ticket_id : '') + (s.parent_subscription_id ? ' on subscription ' + s.parent_subscription_id : '')));
                // Add-on streak (docs/TECH_UPSELLS.md): backend pays after 5 paid
                // invoices ON/after the add-on date with the add-on still on each.
                (() => { const a = addOnOfSale(s); if (!a) return;
                  const n = Number(a.invoices_paid) || 0, st = a.streak_status || 'accruing';
                  const tip = (a.service_name || 'Add-on') + ' · added ' + (a.added_at || '?') + ' · ' + n + ' of 5 invoices paid' + (st === 'locked' ? ' · locked ' + (a.locked_at || '') : st === 'broken' || st === 'clawback' ? ' · streak broke ' + (a.broke_at || '') + (a.break_reason ? ' (' + a.break_reason.replace(/_/g, ' ') + ')' : '') : '') + (a.last_reconciled_at ? ' · checked ' + String(a.last_reconciled_at).slice(0, 10) : ' · not reconciled yet');
                  if (st === 'locked') lcChips.push(chip('🔒 5 of 5 paid', 'rgba(95,108,91,.16)', '#5F6C5B', tip));
                  else if (st === 'broken' || st === 'clawback') lcChips.push(chip('✗ Streak broke · ' + n + ' of 5', 'rgba(220,38,38,.12)', '#B91C1C', tip));
                  else lcChips.push(chip(n + ' of 5 paid', 'rgba(156,63,30,.14)', '#9C3F1E', tip)); })();
                // Eligibility (per Isaac): appointment + billing stamped by the
                // sync (20260916_sales_eligibility.sql). Every subscription is
                // logged; these show which can earn a payout.
                if (s.crm_initial_status != null) {
                  const st = String(s.crm_initial_status || '').toLowerCase();
                  const ok = st === 'pending' || st === 'completed';
                  lcChips.push(ok ? chip('✓ Appt', 'rgba(95,108,91,.16)', '#5F6C5B', 'Initial appointment ' + st)
                                  : chip('✗ No appt', 'rgba(220,38,38,.12)', '#B91C1C', 'No initial appointment on the books (' + (s.crm_initial_status || 'none') + ')'));
                }
                if (s.crm_autopay != null) {
                  lcChips.push(s.crm_autopay ? chip('✓ Billing', 'rgba(95,108,91,.16)', '#5F6C5B', 'Autopay on file in FieldRoutes')
                                             : chip('✗ No billing', 'rgba(220,38,38,.12)', '#B91C1C', 'No autopay on file — not commission-eligible until billing is added'));
                }
                if (s.crm_serviced_at) lcChips.push(chip('✓ Svc', 'rgba(95,108,91,.16)', '#5F6C5B',
                  'Initial service completed ' + s.crm_serviced_at + (s.crm_completed_services ? ' · ' + s.crm_completed_services + ' service(s) run' : '')));
                else if (s.crm_checked_at && s.crm_serviced_at === null && s.crm_completed_services === 0) lcChips.push(chip('⏳ Svc', 'var(--card-2)', 'var(--text-muted)', 'No initial service completed yet'));
                // Signed agreement (per Isaac) — stamped by the sync from the
                // FieldRoutes e-sign documents (sales_crm_agreement.sql).
                if (s.crm_contract_state === 'signed') lcChips.push(chip('✓ Signed', 'rgba(95,108,91,.16)', '#5F6C5B',
                  'Agreement e-signed' + (s.crm_contract_signed_at ? ' ' + s.crm_contract_signed_at : '')));
                else if (s.crm_contract_state === 'sent') lcChips.push(chip('✉ Sent', 'rgba(223,100,58,.14)', '#A9441F',
                  'Agreement sent for e-signature but not signed yet'));
                else if (s.crm_contract_state === 'none' && s.crm_checked_at) lcChips.push(chip('✗ No agreement', 'rgba(220,38,38,.12)', '#B91C1C',
                  'No e-sign document on this subscription or customer in FieldRoutes'));
                // Office audit (FieldRoutes customer flag, per Isaac Sep 17 2026):
                // Passed feeds the Charge Upfront % tier; Failed holds
                // auto-approval for manual review until the office re-flags.
                if (s.crm_audit === 'passed') lcChips.push(chip('✓ Audit', 'rgba(95,108,91,.16)', '#5F6C5B', 'Passed Audit flag in FieldRoutes — counts toward the Passed Audit % pay tier'));
                else if (s.crm_audit === 'failed') lcChips.push(chip('✗ Audit', 'rgba(220,38,38,.12)', '#B91C1C', 'Failed Audit flag in FieldRoutes — auto-approval is on hold. Review it here, or fix it in the CRM and the next sync resumes the flow.'));
                if (s.crm_days_past_due != null) {
                  lcChips.push(Number(s.crm_days_past_due) > 0
                    ? chip('⚠ ' + s.crm_days_past_due + 'd', 'rgba(220,38,38,.12)', '#B91C1C', 'Customer is ' + s.crm_days_past_due + ' day(s) past due' + (s.crm_balance != null ? ' · balance ' + fmt.usd(s.crm_balance) : ''))
                    : chip('✓ Paid', 'rgba(95,108,91,.16)', '#5F6C5B', 'Account is current' + (s.crm_balance != null ? ' · balance ' + fmt.usd(s.crm_balance) : '')));
                }
                // $2k+ annualized value → auditor must confirm whether the
                // property is commercial (commercial pays the half rate —
                // mark it via Edit → Commercial). Clears once marked.
                (() => {
                  const _m = Number(s.contract_months) || 12;
                  const _annual = _m > 12 ? (Number(s.revenue_amount) || 0) * 12 / _m : (Number(s.revenue_amount) || 0);
                  if (_annual > 2000 && !s.is_commercial) lcChips.push(chip('⚑ Comm?', 'rgba(156,63,30,.14)', '#9C3F1E',
                    'Annualized value ' + fmt.usd(_annual) + ' is over $2,000 — confirm whether this is a commercial property. Commercial pays the commercial (half) rate; mark it via Edit → Commercial.'));
                })();
                // Sentricon is ALWAYS a 12-month program — any other length
                // on the account is a data error (usually a blank agreement
                // length in FieldRoutes). Flag until the contract reads 12.
                (() => {
                  const _svc = String(s.crm_subscription || nameFromId(state.serviceTypes, s.service_type_id) || '');
                  if (/sentricon/i.test(_svc) && Number(s.contract_months) !== 12) {
                    lcChips.push(chip('⚑ Sentricon ≠ 12mo', 'rgba(223,100,58,.14)', '#A9441F',
                      'Sentricon accounts are always 12-month programs, but this one reads ' + (Number(s.contract_months) || 0) + ' month(s). Fix the agreement length in FieldRoutes (and Edit → contract here).'));
                  }
                })();
                // ↩ CRM copy cancelled AFTER this sale cleared audit — the
                // commission may need a clawback; don't let it hide.
                if (v.crmCancelled && !['cancelled', 'nsf', 'not_payable', 'rejected'].includes(s.audit_status)) {
                  lcChips.push(chip('↩ CRM cancelled', 'rgba(220,38,38,.14)', '#B91C1C',
                    'The CRM subscription behind this sale was cancelled ' + String(v.crmCancelled).slice(0, 10)
                    + (v.crmCancelReason ? ' (' + v.crmCancelReason + ')' : '') + ' — review the commission on this row.'));
                }
                // ⏱ Queue aging — how long this row has waited for an audit.
                if (s.audit_status === 'pending') {
                  const _ageD = Math.floor((Date.now() - (Date.parse(s.created_at || s.sold_date) || Date.now())) / 86400000);
                  if (_ageD >= 3) lcChips.push(chip('⏱ ' + _ageD + 'd', _ageD >= 10 ? 'rgba(220,38,38,.12)' : 'rgba(223,100,58,.14)', _ageD >= 10 ? '#B91C1C' : '#A9441F',
                    'Waiting on audit for ' + _ageD + ' days'));
                }
                const withLc = (node) => lcChips.length ? el('span', { class: 'inline-flex items-center gap-1 flex-wrap' }, node, ...lcChips) : node;
                if (v.status === 'verified') {
                  return withLc(chip('✓ ' + fmt.usd(v.cv), 'rgba(95,108,91,.16)', '#5F6C5B',
                    'EXACT CRM match — the warehouse shows this precise contract value on customer #' + (s.customer_number || '?')
                    + (v.sub ? ' (' + v.sub + ')' : '') + (v.live ? ' · live check' : '')));
                }
                if (v.status === 'near_match') {
                  const d = Math.abs((Number(s.revenue_amount) || 0) - (Number(v.cv) || 0));
                  return withLc(chip('≈ ' + fmt.usd(v.cv), 'rgba(240,172,30,.16)', '#A9441F',
                    'Off by ' + fmt.usd(d) + ' — logged ' + fmt.usd(s.revenue_amount) + ' vs ' + fmt.usd(v.cv) + ' in the CRM. Values must be exact so commissions never over/under-pay.'));
                }
                if (v.status === 'revenue_mismatch') {
                  return withLc(chip('⚠ CRM ' + fmt.usd(v.cv), 'rgba(220,38,38,.12)', '#B91C1C',
                    'Revenue differs: logged ' + fmt.usd(s.revenue_amount) + ' vs ' + fmt.usd(v.cv) + ' in the CRM'
                    + (v.sub ? ' (' + v.sub + ')' : '')
                    + ' — upsells can legitimately differ; worth a manual look.' + (v.live ? ' · live check' : '')));
                }
                if (v.status === 'unchecked') {
                  return el('span', { class: 'text-[10px]', style: { color: 'var(--text-subtle)' },
                    title: 'The CRM auto-check runs with the hourly sync — this sale hasn\'t been checked yet.' }, '… checking');
                }
                return el('span', { style: { color: 'var(--text-subtle)' }, class: 'text-[10px]',
                  title: 'Customer #' + (s.customer_number || '?') + ' isn\'t in the mirror yet — new accounts land after the nightly RevHawk refresh (or the 15-minute live pull, for the Sales queues).' },
                  'not in CRM yet');
              })()),

              // Pending Backend Lock pill: Audit 2 + Lock dropdowns inline so
              // the reviewer can decide right here without leaving the row.
              showBackend && el('td', { class: 'px-2 py-2 whitespace-nowrap' }, auditor2Select(s.id)),
              showBackend && el('td', { class: 'px-2 py-2 whitespace-nowrap' }, lockStatusSelect(s.id)),
              // Live account state from the active Reporting snapshot (matched
              // by customer #). "No match" = this customer isn't in the snapshot.
              showRptStatus && el('td', { class: 'px-2 py-2 whitespace-nowrap' },
                rpt
                  ? el('span', {
                      class: 'inline-block px-2 py-0.5 rounded-full text-[10px] font-bold',
                      style: rpt.isActive
                        ? { background: 'rgba(223,100,58,.15)', color: '#DF643A' }
                        : { background: 'rgba(220,38,38,.12)', color: '#B91C1C' },
                      title: (rpt.subscription ? 'Live sub: ' + rpt.subscription : '')
                        + (rpt.cancelDate ? ' \u00b7 canceled ' + fmt.dateShortYear(rpt.cancelDate) + (rpt.cancelReason ? ' (' + rpt.cancelReason + ')' : '') : '')
                        + (rpt.matchedCount > 1 ? ' \u00b7 ' + rpt.matchedCount + ' subs on file' : ''),
                    }, rpt.status)
                  : el('span', { style: { color: 'var(--text-subtle)' }, title: 'No matching customer in the active reporting snapshot' }, 'No match')),
              showRptStatus && cell(el('span', {
                class: 'text-muted- whitespace-nowrap max-w-[130px] truncate inline-block align-bottom',
                title: rpt && rpt.subscription ? 'Current subscription in the CRM: ' + rpt.subscription : 'No live subscription found',
              }, (rpt && rpt.subscription) || '\u2014')),
              showRptStatus && el('td', {
                class: 'px-2 py-2 text-right tabular-nums whitespace-nowrap',
                style: (rpt && rpt.balance > 0) ? { color: '#DC2626', fontWeight: '600' } : { color: 'var(--text-muted)' },
                title: 'Outstanding balance on the account in the CRM',
              }, rpt && rpt.balance != null ? fmt.usd(rpt.balance) : '\u2014'),
              showRptStatus && el('td', {
                class: 'px-2 py-2 text-right tabular-nums whitespace-nowrap',
                style: (rpt && rpt.daysPastDue > 0) ? { color: '#DC2626', fontWeight: '600' } : { color: 'var(--text-muted)' },
              }, rpt && rpt.daysPastDue != null ? rpt.daysPastDue.toLocaleString() : '\u2014'),
              showRptStatus && el('td', { class: 'px-2 py-2 text-right tabular-nums whitespace-nowrap text-muted-' },
                rpt && rpt.completedServices != null ? rpt.completedServices.toLocaleString() : '\u2014'),
              // Enriched columns from an uploaded backend report. Show '\u2014'
              // when this row didn't match any report row (so the gap is
              // visible and the reviewer knows it's missing data).
              showReportCols && el('td', { class: 'px-2 py-2 text-right tabular-nums whitespace-nowrap text-muted-' }, s.subscriptions != null ? fmt.int(s.subscriptions) : '\u2014'),
              showReportCols && el('td', { class: 'px-2 py-2 text-right tabular-nums whitespace-nowrap text-muted-' }, s.appointments_completed != null ? fmt.int(s.appointments_completed) : '\u2014'),
              showReportCols && el('td', { class: 'px-2 py-2 text-right tabular-nums whitespace-nowrap text-muted-' }, s.aging != null ? fmt.int(s.aging) : '\u2014'),
              showReportCols && cell(el('span', { class: 'text-muted- whitespace-nowrap max-w-[120px] truncate inline-block align-bottom', title: s.subscription_type || '' }, s.subscription_type || '\u2014')),
              // Notes \u2014 small note icon with a red badge ONLY when the sale
              // actually has a rep note. Hover to read.
              el('td', { class: 'px-2 py-2 whitespace-nowrap' }, (() => {
                const repNote = noteTxt;
                const hasNote = !!repNote;
                const tooltip = hasNote ? 'Note: ' + repNote : 'No notes';
                return el('span', {
                  class: 'relative inline-block',
                  title: tooltip,
                  style: { color: hasNote ? 'var(--text)' : 'var(--text-subtle)', verticalAlign: 'middle' },
                },
                  iconNote(),
                  hasNote && el('span', {
                    class: 'absolute rounded-full',
                    style: {
                      top: '-2px', right: '-2px',
                      width: '8px', height: '8px',
                      background: '#DC2626',
                      border: '1.5px solid var(--card)',
                    },
                  }),
                );
              })()),
            );
          }),
        ),
      ),
    ),
  );
}

// Status dropdown \u2014 sets a sale's audit_status. Admins and auditors get an
// editable select; everyone else sees the read-only chip. No more audit-note
// popover \u2014 picking a status writes immediately and stamps audited_by to the
// current user.
// Commissionable ("Bill") date — the rule per Isaac (Sep 17 2026):
//   · Charged upfront → the sale date, unless the account cancelled before
//     its initial service (pre-service cancel → not commissionable)
//   · Not charged upfront → the LATER of the initial completed service and
//     the first payment received (both stamped from FieldRoutes by the sync)
//   · A hand-entered commission_date on the sale wins over the derived one
//     (override for edge cases).
function commissionableDate(s) {
  if (s.commission_date) return { date: String(s.commission_date).slice(0, 10), short: '', why: 'Commission date entered on the sale (override)' };
  const cancelled = ['cancelled', 'nsf', 'not_payable', 'rejected'].includes(s.audit_status) || /cancel/i.test(String(s.crm_initial_status || ''));
  const serviced = s.crm_serviced_at ? String(s.crm_serviced_at).slice(0, 10) : null;
  const paid = s.crm_first_paid_at ? String(s.crm_first_paid_at).slice(0, 10) : null;
  if (s.upfront_collected) {
    if (cancelled && !serviced) return { date: null, short: 'pre-svc cancel', why: 'Passed audit but cancelled before the initial service — not commissionable' };
    return { date: String(s.sold_date || '').slice(0, 10) || null, short: '—', why: 'Passed audit — commissionable on the sale date' };
  }
  if (serviced && paid) { const d = serviced > paid ? serviced : paid; return { date: d, short: '', why: 'Initial service completed ' + serviced + ' · first payment ' + paid + ' — commissionable on the later of the two' }; }
  if (serviced && !paid) return { date: null, short: 'awaiting payment', why: 'Initial service completed ' + serviced + ' but no payment received yet' };
  if (!serviced && paid) return { date: null, short: 'awaiting service', why: 'Payment received ' + paid + ' but the initial service hasn’t been completed yet' };
  if (cancelled) return { date: null, short: 'cancelled', why: 'Cancelled before service and payment — not commissionable' };
  return { date: null, short: 'not yet', why: 'Not passed audit yet — becomes commissionable once the initial service is completed AND a payment is received' };
}
// Sheet-style flag box (per Isaac): PIF / Comm. / Upfront. Admin-editable
// boolean columns save straight to the sale; read-only ones just display.
// PIF · Comm. · Upfront are read-only marks (per Isaac — no checkboxes):
// a sage ✓ when the flag is set, a faint dash when it isn't. They are
// stamped by the CRM sync / payroll, never ticked by hand here.
function saleFlagBox(sale, field, editable, tip) {
  const on = field === '_comm_paid' ? !!sale.payroll_processed_at : !!sale[field];
  return el('span', {
    title: tip || '',
    class: 'inline-flex items-center justify-center rounded-full font-bold',
    style: on
      ? { width: '18px', height: '18px', fontSize: '11px', background: 'rgba(95,108,91,.16)', color: '#5F6C5B' }
      : { width: '18px', height: '18px', fontSize: '11px', color: 'var(--text-subtle)', opacity: '.6' },
  }, on ? '\u2713' : '\u2014');
}
// Audit column: the office's audit flag on the FieldRoutes customer card.
function saleAuditChip(sale) {
  const v = sale.crm_audit;
  const mk = (txt, bg, colr, tip) => el('span', { title: tip, class: 'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold whitespace-nowrap', style: { background: bg, color: colr } }, txt);
  if (v === 'passed') return mk('\u2713 Passed', 'rgba(95,108,91,.16)', '#5F6C5B', 'Passed Audit flag on the customer card in FieldRoutes');
  if (v === 'failed') return mk('\u2717 Failed', 'rgba(220,38,38,.12)', '#B91C1C', 'Failed Audit flag on the customer card in FieldRoutes — fix it in the CRM and the next sync clears it');
  return el('span', { class: 'text-[10px]', style: { color: 'var(--text-subtle)' }, title: 'No audit flag on the customer card yet' }, 'not yet');
}
// Sale statuses, in the order of RIDD's status list (per Isaac, Oct 15). 'serviced' stays
// labelled Commissionable. Re-Audit holds a sale on Upfront Sales (not payable, never auto-approved).
const SALE_STATUS_OPTIONS = [
  ['pending', 'Pending'], ['serviced', 'Commissionable'], ['below_minimums', 'Below Minimums'],
  ['cancelled', 'Cancelled'], ['re_audit', 'Re-Audit'], ['reschedule', 'Reschedule'],
  ['nsf', 'NSF'], ['not_payable', 'Not Payable'],
];
const SALE_STATUS_LABEL = Object.fromEntries(SALE_STATUS_OPTIONS);
// Status colors from RIDD's status list (per Isaac, Oct 15) — rows get a faint tint, the key shows the full color.
const SALE_STATUS_COLOR = {
  pending: '#8F9A8C', serviced: '#3E5A3A', below_minimums: '#B8862B', cancelled: '#E5532E',
  re_audit: '#B84A47', reschedule: '#C17A3B', nsf: '#1F1F1F', not_payable: '#6E6C5C',
};
const saleStatusTint = (st) => {
  const hex = SALE_STATUS_COLOR[st || 'pending'] || SALE_STATUS_COLOR.pending;
  const n = parseInt(hex.slice(1), 16), a = st === 'nsf' ? 0.08 : (!st || st === 'pending') ? 0.12 : 0.10;
  return 'rgba(' + (n >> 16) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
};
// Clickable key (per Isaac, Oct 15): a status filters the list to it (click again to clear).
// Cancelled / Reschedule / Not Payable live on Archived, so picking one jumps there.
const SALE_STATUS_ARCHIVED = new Set(['cancelled', 'reschedule', 'not_payable']);
function saleStatusKey() {
  const sf = state.salesFilters || (state.salesFilters = {});
  const pick = (v) => {
    if (sf.status === v) { sf.status = ''; }
    else {
      sf.status = v;
      const arch = SALE_STATUS_ARCHIVED.has(v);
      if (arch && state._salesQueueFilter !== 'cancels') state._salesQueueFilter = 'cancels';
      else if (!arch && state._salesQueueFilter === 'cancels') state._salesQueueFilter = 'upfront';
    }
    mountApp();
  };
  return el('div', { class: 'flex flex-wrap items-center justify-end', style: { columnGap: '4px', rowGap: '4px' } },
    ...SALE_STATUS_OPTIONS.map(([v, lbl]) => {
      const on = sf.status === v, dim = !!sf.status && !on;
      return el('button', {
        type: 'button', title: on ? 'Showing ' + lbl + ' only \u2014 click to show all' : 'Show ' + lbl + ' only',
        class: 'inline-flex items-center text-[10px] rounded-md cursor-pointer transition',
        style: { gap: '5px', padding: '2px 6px', border: '1px solid ' + (on ? SALE_STATUS_COLOR[v] : 'transparent'),
          background: on ? saleStatusTint(v) : 'transparent', color: on ? 'var(--text)' : 'var(--text-muted)', fontWeight: on ? '600' : '400', opacity: dim ? '.45' : '1' },
        onclick: () => pick(v),
      }, el('span', { style: { width: '9px', height: '9px', borderRadius: '3px', background: SALE_STATUS_COLOR[v], display: 'inline-block' } }), lbl);
    }));
}

function statusSelect(saleId) {
  const sale = state.allSales.find(x => x.id === saleId) || state.mySales.find(x => x.id === saleId);
  const role = state.profile?.role;
  const canAudit = isAdminRole(role) || role === 'auditor';
  const current = sale?.audit_status || 'pending';
  if (!canAudit) return statusChip(current);
  return el('select', {
    class: 'rounded-lg border px-2.5 py-1 text-[11px] font-medium cursor-pointer',
    style: { borderColor: 'var(--border-2)', background: 'var(--card)', color: 'var(--text)' },
    onchange: (e) => {
      const val = e.target.value;
      if (!val || val === current) return;
      auditSale(saleId, val);
    },
  },
    ...SALE_STATUS_OPTIONS.map(([v, lbl]) => el('option', { value: v, selected: current === v }, lbl)),
  );
}

// Audit cell \u2014 shows who audited the sale. Admins can reassign via the
// dropdown of admins + auditors; everyone else sees the name read-only.
function auditorSelect(saleId) {
  const sale = state.allSales.find(x => x.id === saleId) || state.mySales.find(x => x.id === saleId);
  const isAdmin = isAdminRole(state.profile?.role);
  const auditors = (state.allProfiles || []).filter(p => isAdminRole(p.role) || p.role === 'auditor');
  const currentId = sale?.audited_by || '';
  const current = auditors.find(p => p.id === currentId);
  if (!isAdmin) {
    return el('span', { class: 'text-xs whitespace-nowrap', style: { color: current ? 'var(--text)' : 'var(--text-subtle)' } },
      current?.full_name || '\u2014');
  }
  return el('select', {
    class: 'rounded-lg border px-2.5 py-1 text-[11px] cursor-pointer',
    style: { borderColor: 'var(--border-2)' },
    onchange: (e) => { assignAuditor(saleId, e.target.value || null); },
  },
    el('option', { value: '', selected: !currentId }, '\u2014 Unassigned \u2014'),
    ...auditors.map(p => el('option', {
      value: p.id, selected: p.id === currentId,
    }, p.full_name)),
  );
}

function assignAuditor(saleId, auditorId) {
  for (const list of [state.mySales, state.allSales]) {
    const sale = list.find(s => s.id === saleId);
    if (sale) {
      sale.audited_by = auditorId;
      sale.audited_at = auditorId ? new Date().toISOString() : null;
      // Assigning (or clearing) an auditor re-evaluates payroll staging in
      // case the status was already serviced/below_min — that combination
      // is what lets a sale graduate from the Sales tab to the Pay tab.
      _evalStaging(sale);
    }
  }
  if (DEMO) { saveDemoData(); mountApp(); return; }
  const sale = state.allSales.find(s => s.id === saleId) || state.mySales.find(s => s.id === saleId);
  const isPayrollStatus = sale?.audit_status === 'serviced' || sale?.audit_status === 'below_minimums';
  const willStage = !!auditorId && isPayrollStatus;
  supabase.from('sales').update({
    audited_by: auditorId,
    audited_at: auditorId ? new Date().toISOString() : null,
    staged_for_payroll: willStage,
    staged_at: willStage ? new Date().toISOString() : null,
  }).eq('id', saleId)
    .then(({ error }) => { if (error) toast(error.message, 'error'); mountApp(); });
}

// Second-pass auditor (backend lock review). Mirrors auditorSelect: admins
// pick from the same admin/auditor pool; everyone else sees read-only text.
function auditor2Select(saleId) {
  const sale = state.allSales.find(x => x.id === saleId) || state.mySales.find(x => x.id === saleId);
  const isAdmin = isAdminRole(state.profile?.role);
  const auditors = (state.allProfiles || []).filter(p => isAdminRole(p.role) || p.role === 'auditor');
  const currentId = sale?.audit_2_by || '';
  const current = auditors.find(p => p.id === currentId);
  if (!isAdmin) {
    return el('span', { class: 'text-xs whitespace-nowrap', style: { color: current ? 'var(--text)' : 'var(--text-subtle)' } },
      current?.full_name || '—');
  }
  return el('select', {
    class: 'rounded-lg border px-2.5 py-1 text-[11px] cursor-pointer',
    style: { borderColor: 'var(--border-2)' },
    onchange: (e) => { assignAuditor2(saleId, e.target.value || null); },
  },
    el('option', { value: '', selected: !currentId }, '— Unassigned —'),
    ...auditors.map(p => el('option', {
      value: p.id, selected: p.id === currentId,
    }, p.full_name)),
  );
}

function assignAuditor2(saleId, auditorId) {
  let saleSnap = null;
  for (const list of [state.mySales, state.allSales]) {
    const sale = list.find(s => s.id === saleId);
    if (sale) {
      sale.audit_2_by = auditorId;
      sale.audit_2_at = auditorId ? new Date().toISOString() : null;
      saleSnap = sale;
    }
  }
  const auditorName = (state.allProfiles || []).find(p => p.id === auditorId)?.full_name;
  logActivity('audit2_assigned', {
    sale_id: saleId,
    customer_name: saleSnap?.customer_name,
    new_status: auditorId ? 'auditor: ' + (auditorName || 'unknown') : 'unassigned',
    detail: auditorId ? null : 'cleared',
  });
  if (DEMO) { saveDemoData(); mountApp(); return; }
  supabase.from('sales').update({
    audit_2_by: auditorId,
    audit_2_at: auditorId ? new Date().toISOString() : null,
  }).eq('id', saleId)
    .then(({ error }) => { if (error) toast(error.message, 'error'); mountApp(); });
}

// Backend-lock status. Pending = under review, Lock = commission locked in,
// Chargeback = customer cancelled within window so the rep owes it back.
// Editable by admin AND auditor; reps see a read-only chip.
const LOCK_STATUSES = [
  { id: 'pending',    label: 'Pending',    bg: 'rgba(95,108,91,.18)', fg: 'var(--text-muted)' },
  { id: 'lock',       label: 'Lock',       bg: 'rgba(223,100,58,.20)',  fg: '#4F8E1C' },
  { id: 'chargeback', label: 'Chargeback', bg: 'rgba(220,38,38,.15)',   fg: '#B91C1C' },
];
function lockStatusChip(status) {
  const s = LOCK_STATUSES.find(x => x.id === status) || LOCK_STATUSES[0];
  return el('span', {
    class: 'inline-block px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider',
    style: { background: s.bg, color: s.fg },
  }, s.label);
}
function lockStatusSelect(saleId) {
  const sale = state.allSales.find(x => x.id === saleId) || state.mySales.find(x => x.id === saleId);
  const role = state.profile?.role;
  const canAudit = isAdminRole(role) || role === 'auditor';
  const current = sale?.lock_status || 'pending';
  if (!canAudit) return lockStatusChip(current);
  return el('select', {
    class: 'rounded-lg border px-2.5 py-1 text-[11px] font-medium cursor-pointer',
    style: { borderColor: 'var(--border-2)', background: 'var(--card)', color: 'var(--text)' },
    onchange: (e) => {
      const val = e.target.value;
      if (!val || val === current) return;
      setLockStatus(saleId, val);
    },
  },
    ...LOCK_STATUSES.map(s => el('option', { value: s.id, selected: current === s.id }, s.label)),
  );
}
function setLockStatus(saleId, status) {
  let saleSnap = null;
  let oldStatus = null;
  for (const list of [state.mySales, state.allSales]) {
    const sale = list.find(s => s.id === saleId);
    if (sale) {
      if (oldStatus == null) oldStatus = sale.lock_status || 'pending';
      sale.lock_status = status;
      // Stamp Audit 2 with whoever made the call so the History row shows
      // the reviewer alongside the status without a separate click.
      if (status !== 'pending' && !sale.audit_2_by) {
        sale.audit_2_by = state.profile.id;
        sale.audit_2_at = new Date().toISOString();
      }
      saleSnap = sale;
    }
  }
  logActivity('lock_status_changed', {
    sale_id: saleId,
    customer_name: saleSnap?.customer_name,
    old_status: oldStatus,
    new_status: status,
    rep_name: state.allProfiles.find(p => p.id === saleSnap?.rep_id)?.full_name,
  });
  if (DEMO) { saveDemoData(); mountApp(); return; }
  supabase.from('sales').update({
    lock_status: status,
    audit_2_by: state.profile.id,
    audit_2_at: new Date().toISOString(),
  }).eq('id', saleId)
    .then(({ error }) => { if (error) toast(error.message, 'error'); mountApp(); });
}

// Resolve contract type label for a sale (uses contract_type_id if available)
function contractTypeLabelForSale(s) {
  if (s.contract_type_id) {
    const ct = state.contractTypes.find(c => c.id === s.contract_type_id);
    if (ct) return ct.name;
  }
  const m = Number(s.contract_months);
  if (m === 0)  return 'One Time';
  if (m === 12) return '12 Months';
  if (m === 18) return '18 Months';
  if (m === 24) return '24 Months';
  return '—';
}

// ──────────────────────────────────────────────────────────────────────────
// (openNewSaleModal is defined below — Sales Log modal matching the mockup)
// ──────────────────────────────────────────────────────────────────────────

function openRepBreakdownModal() {
  const overlay = el('div', { class: 'modal-overlay' });
  const _escClose = (e) => { if (e.key === 'Escape' || !overlay.isConnected) { overlay.remove(); document.removeEventListener('keydown', _escClose); } };
  document.addEventListener('keydown', _escClose);
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

  const isAdmin = isAdminRole(state.profile?.role);
  const goal = getGoalForContext();
  const yearStart = new Date(new Date().getFullYear(), 0, 1);

  // Aggregate YTD revenue per rep
  const source = isAdmin ? state.allSales : state.mySales;
  const approvedYtd = source.filter(s => {
    if (!['approved','serviced'].includes(s.audit_status)) return false;
    return new Date(s.sold_date + 'T00:00') >= yearStart;
  });
  const byRep = {};
  for (const s of approvedYtd) {
    if (!byRep[s.rep_id]) byRep[s.rep_id] = { id: s.rep_id, name: '', revenue: 0, count: 0 };
    byRep[s.rep_id].revenue += Number(s.revenue_amount || 0);
    byRep[s.rep_id].count += 1;
  }
  // Resolve names from leaderboard
  for (const rep of Object.values(byRep)) {
    const lb = state.leaderboard.find(r => r.rep_id === rep.id);
    rep.name = lb?.full_name || (rep.id === state.profile.id ? state.profile.full_name : 'Rep');
  }
  const rows = Object.values(byRep).sort((a, b) => b.revenue - a.revenue);
  const totalYtd = rows.reduce((a, r) => a + r.revenue, 0);

  const modal = el('div', { class: 'card w-full max-w-2xl p-6 my-8' },
    el('div', { class: 'flex items-center justify-between mb-1' },
      el('h2', { class: 'text-xl font-bold' }, 'Rep Breakdown'),
      el('button', { class: 'text-2xl leading-none text-muted-', 'aria-label': 'Close', title: 'Close', onclick: () => overlay.remove() }, '×'),
    ),
    el('p', { class: 'text-xs text-muted- mb-4' }, 'Year-to-date contribution toward the ' + fmt.usd0(goal.amount) + ' goal'),
    rows.length === 0
      ? el('div', { class: 'p-6 text-center text-muted- text-sm' }, 'No approved sales yet this year.')
      : el('div', { class: 'flex flex-col gap-2' },
          rows.map((r, i) => {
            const pct = goal.amount > 0 ? r.revenue / goal.amount : 0;
            return el('div', { class: 'card-2 p-4 rounded-xl border border-' },
              el('div', { class: 'flex items-center justify-between mb-2' },
                el('div', { class: 'flex items-center gap-3' },
                  el('span', { class: 'text-xs font-bold tabular-nums text-muted-' }, '#' + (i + 1)),
                  el('span', { class: 'font-semibold' }, r.name),
                  el('span', { class: 'text-xs text-muted-' }, fmt.int(r.count) + ' sales'),
                ),
                el('div', { class: 'text-right' },
                  el('div', { class: 'text-sm font-bold tabular-nums' }, fmt.usd0(r.revenue)),
                  el('div', { class: 'text-[10px] text-muted-' }, fmt.pct(pct) + ' of goal'),
                ),
              ),
              el('div', { class: 'goal-track', style: { height: '6px' } },
                el('div', { class: 'goal-fill', style: { width: (pct * 100).toFixed(2) + '%' } }),
              ),
            );
          }),
        ),
    el('div', { class: 'flex items-center justify-between mt-4 pt-4 border-t border-' },
      el('span', { class: 'text-sm font-semibold' }, 'Total'),
      el('span', { class: 'text-lg font-bold tabular-nums', style: { color: 'var(--accent)' } }, fmt.usd0(totalYtd)),
    ),
  );

  overlay.append(modal);
  document.body.append(overlay);
}

// ──────────────────────────────────────────────────────────────────────────
// SALES LOG MODAL — matches the mockup exactly
// ──────────────────────────────────────────────────────────────────────────
function openNewSaleModal(defaultRepId, existingSale = null, opts = {}) {
  const isAdmin = isAdminRole(state.profile?.role);
  const profiles = state.allProfiles.length ? state.allProfiles : [state.profile];
  const isEdit = !!existingSale;
  // 👻 Claiming a ghost: same NEW-sale form, pre-filled from the CRM row
  // (opts.prefill, shaped like a sale). opts.onLogged fires after the insert.
  const prefill = (!isEdit && opts && opts.prefill) ? opts.prefill : null;
  // State captured inside the modal (for live footer + checkbox fields that aren't form-bound).
  // When editing, seed from the existing sale so the checkboxes/PPS state are correct on open.
  const modalState = {
    rep_id:         existingSale?.rep_id || prefill?.rep_id || defaultRepId || state.profile.id,
    paid_in_full:   !!existingSale?.paid_in_full,
    is_commercial:  !!existingSale?.is_commercial,
    upfront_collected: !!existingSale?.upfront_collected,
    pay_per_service:!!existingSale?.pay_per_service,
  };

  const overlay = el('div', { class: 'modal-overlay' });
  const _escClose = (e) => { if (e.key === 'Escape' || !overlay.isConnected) { overlay.remove(); document.removeEventListener('keydown', _escClose); } };
  document.addEventListener('keydown', _escClose);
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

  // Build a card-like modal with a sticky footer bar
  const card = el('div', { class: 'card w-full max-w-3xl my-8 overflow-hidden flex flex-col', style: { maxHeight: 'calc(100vh - 64px)' } });

  // ── HEADER ──
  const repSelect = el('select', {
    class: 'rounded-lg border px-2.5 py-1 text-[11px] font-medium',
    disabled: !isAdmin,
    onchange: e => { modalState.rep_id = e.target.value; updateFooter(); },
  },
    ...profiles.map(p => el('option', { value: p.id, selected: p.id === modalState.rep_id }, p.full_name)),
  );

  const header = el('div', { class: 'flex items-center justify-between px-6 py-4 border-b border-' },
    el('div', { class: 'flex items-center gap-4' },
      el('h2', { class: 'text-lg font-bold' }, isEdit ? 'Edit Sale' : 'Sales Log'),
      repSelect,
    ),
    el('button', {
      class: 'rounded-lg border px-2.5 py-1 text-[11px] text-muted- hover:text-default transition',
      style: { borderColor: 'var(--border-2)' },
      onclick: () => overlay.remove(),
    }, '← Back'),
  );

  // ── FORM ──
  const mk = (label, input, opts = {}) => el('label', { class: 'block text-sm' + (opts.fullWidth ? ' sm:col-span-2' : '') },
    el('span', { class: 'text-[10px] uppercase tracking-widest text-muted- block mb-1.5 font-semibold' }, label),
    input,
  );
  const inp = (name, attrs = {}) => el('input', { name, class: 'w-full rounded-lg border px-2.5 py-1 text-[11px]', ...attrs });
  const sel = (name, options, attrs = {}) => el('select', { name, class: 'w-full rounded-lg border px-2.5 py-1 text-[11px]', ...attrs },
    el('option', { value: '' }, '— select —'),
    ...options.map(o => el('option', { value: o.id, selected: attrs.value == o.id }, o.name)),
  );

  // Contract type dropdown (real RIDD categorical values). Default to 'Select Contract Type...'
  // The VALUE is the contract_type id; contract_months is derived via implied_months on submit.
  const contractTypeSelect = el('select', {
    name: 'contract_type_id',
    class: 'w-full rounded-lg border px-2.5 py-1 text-[11px]',
    required: true,
    onchange: () => { updateFooter(); rebuildServiceOptions(); checkValidity(); },
  },
    el('option', { value: '' }, 'Select Contract Type...'),
    // FULL LIST (Jul 2026 reversal): reps manually log EVERY sale again —
    // the manual log is the commission record of the ORIGINAL contract,
    // because CRM subscriptions get modified later (technician upsells etc.)
    // and paying off the live CRM value would overpay.
    // TECH PRESET: technicians only log UPSELLS, so their add form trims to
    // the upsell contract types (edit mode always keeps the full list).
    ...(() => {
      const techMode = !existingSale && (state._saleFormPreset === 'tech' || isTechProfile(state.profile));
      if (!techMode) return state.contractTypes.map(ct => el('option', { value: ct.id }, ct.name));
      const ups = state.contractTypes.filter(ct => /upsell/i.test(String(ct.name || '')));
      return (ups.length ? ups : state.contractTypes).map(ct => el('option', { value: ct.id }, ct.name));
    })(),
  );

  // The Service dropdown is filtered by contract type:
  //   "One Time Service" → only services whose name starts with "One Time"
  //   anything else      → only services whose name does NOT start with "One Time"
  //   no selection       → all services
  const serviceSelect = el('select', {
    name: 'service_type_id',
    class: 'w-full rounded-lg border px-2.5 py-1 text-[11px]',
    required: true,
    onchange: () => checkValidity(),
  });
  function rebuildServiceOptions() {
    const ctId   = Number(contractTypeSelect.value);
    const ct     = state.contractTypes.find(c => c.id === ctId);
    const isOneTime = ct?.name === 'One Time Service';
    const filtered = state.serviceTypes.filter(s => {
      if (!ct) return true;
      const startsOT = s.name.startsWith('One Time');
      return isOneTime ? startsOT : !startsOT;
    });
    const prevValue = serviceSelect.value;
    serviceSelect.innerHTML = '';
    serviceSelect.append(el('option', { value: '' }, 'Select Service...'));
    filtered.forEach(o => serviceSelect.append(el('option', { value: o.id }, o.name)));
    if (prevValue && filtered.some(s => String(s.id) === prevValue)) {
      serviceSelect.value = prevValue;
    } else {
      serviceSelect.value = '';
    }

    // One Time Service contracts have no recurring — lock and zero out that field.
    if (isOneTime) {
      modalState.pay_per_service = false;
      if (pps.checked) pps.checked = false;
      recurringInput.value = '0';
      recurringInput.disabled = true;
      recurringInput.style.opacity = '.5';
      recurringInput.style.cursor = 'not-allowed';
      recurringInput.required = false;
      pps.disabled = true;
      pps.parentElement && (pps.parentElement.style.opacity = '.5');
      renderRecurringHost();
    } else {
      recurringInput.disabled = false;
      recurringInput.style.opacity = '';
      recurringInput.style.cursor = '';
      pps.disabled = false;
      pps.parentElement && (pps.parentElement.style.opacity = '');
      recurringInput.required = !modalState.pay_per_service;
      renderRecurringHost();
    }
  }
  // Initial population happens at the bottom of the setup, after recurringInput/pps are declared.

  const initialInput = inp('initial_amount', {
    type: 'number', step: '0.01', min: 0, required: true, placeholder: '0',
    oninput: () => { updateFooter(); checkValidity(); },
  });

  // Recurring / Pay-Per-Service fields — swapped depending on PPS checkbox.
  // In PPS mode, the two fields replace the single recurring input with no
  // extra labels above — their labels become placeholders so the row keeps
  // the same height as the Initial ($) field next to it.
  const recurringInput = inp('monthly_amount', {
    type: 'number', step: '0.01', min: 0, required: true, placeholder: '0',
    oninput: () => { updateFooter(); checkValidity(); },
  });
  const numServicesInput = inp('num_services', {
    type: 'number', step: '1', min: 0, placeholder: '# of Services',
    oninput: () => { updateFooter(); checkValidity(); },
  });
  const amtPerServiceInput = inp('amount_per_service', {
    type: 'number', step: '0.01', min: 0, placeholder: 'Amount / Service',
    oninput: () => { updateFooter(); checkValidity(); },
  });

  const recurringHost = el('div', {});
  function renderRecurringHost() {
    recurringHost.innerHTML = '';
    if (modalState.pay_per_service) {
      numServicesInput.required = true;
      amtPerServiceInput.required = true;
      recurringInput.required = false;
      recurringHost.append(
        el('div', { class: 'grid grid-cols-2 gap-2' },
          numServicesInput,
          amtPerServiceInput,
        ),
      );
    } else {
      numServicesInput.required = false;
      amtPerServiceInput.required = false;
      recurringInput.required = true;
      recurringHost.append(recurringInput);
    }
  }

  const pps = el('input', {
    type: 'checkbox', class: 'accent-lime',
    tabindex: '-1',       // skip from tab order so Initial → Recurring is direct
    onchange: () => {
      modalState.pay_per_service = pps.checked;
      renderRecurringHost();
      updateFooter();
      checkValidity();
    },
  });

  // "Save & start another" toggle. When checked, submitting keeps the modal
  // open and resets the form so the rep can immediately log the next sale —
  // useful for entering a backlog. Hidden in edit mode (you only edit one).
  const addAnotherInput = el('input', { type: 'checkbox', class: 'accent-lime w-4 h-4' });
  const addAnotherToggle = isEdit ? null : el('label', {
    class: 'flex items-center gap-2 text-xs cursor-pointer select-none mt-4',
    style: { color: 'var(--text-muted)' },
  },
    addAnotherInput,
    el('span', {}, 'Save and start another sale after this one'),
  );

  const form = el('form', {
    class: 'p-6 overflow-y-auto flex-1',
    onsubmit: async (e) => {
      e.preventDefault();
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<span class="spinner"></span>';
      try {
        const data = Object.fromEntries(new FormData(form));
        const initial  = parseFloat(data.initial_amount) || 0;
        const monthly  = parseFloat(data.monthly_amount) || 0;
        const numSvcs  = parseFloat(data.num_services) || 0;
        const amtSvc   = parseFloat(data.amount_per_service) || 0;
        const ctId     = Number(data.contract_type_id);
        const ct       = state.contractTypes.find(c => c.id === ctId);
        const months   = ct?.implied_months != null ? ct.implied_months : 12; // default 12 for categorical
        // Revenue is always the FIRST 12 months of billing regardless of
        // contract length: initial covers month 1, then 11 monthly billings.
        // PPS still uses its own model (number of services × amount).
        const revenue  = modalState.pay_per_service
          ? initial + numSvcs * amtSvc
          : initial + monthly * 11;

        // Editable fields are the same whether logging or editing. Audit
        // state (audit_status, audited_by, audited_at, staged_for_payroll,
        // payroll_processed_at, created_at) is preserved across edits — only
        // the "what was sold" details change.
        const editableFields = {
          rep_id: modalState.rep_id,
          // First + Last inputs combine into the same stored field ("First Last").
          customer_name: [String(data.customer_first || '').trim(), String(data.customer_last || '').trim()].filter(Boolean).join(' '),
          customer_number: data.customer_number || null,
          office_id: Number(data.office_id),
          service_type_id: Number(data.service_type_id),
          source_id: Number(data.source_id),
          contract_type_id: ctId,
          contract_months: months,
          initial_amount: initial,
          monthly_amount: modalState.pay_per_service ? amtSvc : monthly,
          num_services: modalState.pay_per_service ? numSvcs : null,
          pay_per_service: modalState.pay_per_service,
          paid_in_full: modalState.paid_in_full || (ct?.name === 'Paid in Full'),
          is_commercial: modalState.is_commercial || (ct?.name === 'Commercial'),
          upfront_collected: !!modalState.upfront_collected,
          revenue_amount: revenue,
          sold_date: data.sold_date,
          commission_date: data.commission_date || null,
          notes: data.notes || null,
        };

        if (isEdit) {
          if (DEMO) {
            for (const list of [state.mySales, state.allSales]) {
              const target = list.find(s => s.id === existingSale.id);
              if (target) Object.assign(target, editableFields);
            }
            logActivity('sale_edited', {
              sale_id: existingSale.id,
              customer_name: editableFields.customer_name,
              new_status: existingSale.audit_status,
              rep_name: state.allProfiles.find(p => p.id === editableFields.rep_id)?.full_name,
            });
            toast('Sale updated', 'success');
            saveDemoData();
            overlay.remove();
            mountApp();
            return;
          }
          const { error } = await supabase.from('sales').update(editableFields).eq('id', existingSale.id);
          if (error) throw error;
          toast('Sale updated', 'success');
          await refreshSalesData();
          overlay.remove();
          mountApp();
          return;
        }

        const saleRow = {
          ...editableFields,
          logged_by: state.profile.id,
          audit_status: 'pending',
          created_at: new Date().toISOString(),
        };

        if (DEMO) {
          const id = Math.max(0, ...state.allSales.map(s => s.id || 0)) + 1;
          const row = { ...saleRow, id };
          if (row.rep_id === state.profile.id) state.mySales.unshift(row);
          state.allSales.unshift(row);
          logActivity('sale_logged', { sale_id: id, customer_name: row.customer_name, new_status: 'pending', rep_name: profiles.find(p => p.id === row.rep_id)?.full_name });
          notifySaleLogged(row);
          toast('Sale logged', 'success');
          saveDemoData();
          if (addAnotherInput.checked) { resetFormForAnother(); return; }
          overlay.remove();
          mountApp();
          return;
        }

        const { data: insRow, error } = await supabase.from('sales').insert(saleRow).select('id').maybeSingle();
        if (error) throw error;
        notifySaleLogged(saleRow);
        toast('Sale logged — awaiting audit', 'success');
        if (opts && typeof opts.onLogged === 'function') { try { await opts.onLogged(insRow ? insRow.id : null, saleRow); } catch (e) { console.warn('[ridd] onLogged hook failed', e); } }
        await refreshSalesData();
        if (addAnotherInput.checked) { resetFormForAnother(); return; }
        overlay.remove();
        mountApp();
      } catch (err) {
        toast(err.message || 'Failed to save', 'error');
        submitBtn.disabled = false;
        submitBtn.innerHTML = isEdit ? 'Save Changes' : 'Log Sale';
      }
    },
  });

  const today = new Date().toISOString().slice(0, 10);

  form.append(
    el('div', { class: 'grid grid-cols-1 sm:grid-cols-2 gap-5' },
      // Customer name — split First | Last inside the same half of the row.
      el('div', { class: 'grid grid-cols-2 gap-3' },
        mk('First Name', inp('customer_first', { required: true, placeholder: 'e.g. Jane', oninput: () => checkValidity() })),
        mk('Last Name',  inp('customer_last',  { required: true, placeholder: 'e.g. Smith', oninput: () => checkValidity() })),
      ),
      mk('Customer #',    inp('customer_number', {
        required: true,
        placeholder: 'e.g. 10042',
        inputmode: 'numeric',
        pattern: '[0-9]*',
        oninput: (e) => {
          // Strip anything that isn't a digit — pasted text, accidental
          // letters, etc. Re-set value preserves cursor at the end which
          // is what the user wants for an append-only numeric field.
          const cleaned = e.target.value.replace(/\D+/g, '');
          if (cleaned !== e.target.value) e.target.value = cleaned;
          checkValidity();
        },
      })),

      mk('Office', el('select', {
        name: 'office_id',
        class: 'w-full rounded-lg border px-2.5 py-1 text-[11px]',
        required: true,
        onchange: () => checkValidity(),
      },
        el('option', { value: '' }, 'Select Office...'),
        ...state.offices.map(o => el('option', { value: o.id }, o.name)),
      )),
      mk('Contract Type', contractTypeSelect),

      mk('Service', serviceSelect),
      mk('Source', el('select', {
        name: 'source_id',
        class: 'w-full rounded-lg border px-2.5 py-1 text-[11px]',
        required: true,
        onchange: () => { checkValidity(); updateFooter(); },
      },
        el('option', { value: '' }, 'Select Source...'),
        // FULL ACTIVE LIST (Jul 2026 reversal — manual logging is back for
        // every sale). Editing an older sale keeps its original source
        // selectable even if the CRM has since hidden it. TECH PRESET:
        // technicians see only their dedicated "Upsell - Service Pro" source.
        ...(() => {
          const active = state.sources.filter(o => o.is_active !== false);
          let opts = active;
          const techMode = !existingSale && (state._saleFormPreset === 'tech' || isTechProfile(state.profile));
          if (techMode) {
            const sp = active.filter(o => /^upsell\s*-\s*service\s*pro$/i.test(String(o.name || '').trim()));
            if (sp.length) opts = sp;
          }
          const curId = existingSale && existingSale.source_id;
          if (curId && !opts.some(o => o.id === curId)) {
            const cur = state.sources.find(o => o.id === curId);
            if (cur) opts = [cur, ...opts];
          }
          return opts.map(o => el('option', { value: o.id }, o.name));
        })(),
      )),

      mk('Initial ($)', initialInput),
      el('div', { class: 'block text-sm' },
        el('div', { class: 'flex items-center justify-between mb-1.5' },
          el('span', { class: 'text-[10px] uppercase tracking-widest text-muted- font-semibold' }, 'Recurring ($)'),
          el('label', { class: 'flex items-center gap-1.5 text-[11px] text-muted- cursor-pointer select-none' },
            'Pay Per Service',
            pps,
          ),
        ),
        recurringHost,
      ),

      mk('Sold Date', inp('sold_date', { type: 'date', required: true, value: today })),
      mk('Commission Date', inp('commission_date', { type: 'date', value: today })),
    ),

    // PIF + Commercial are back on the NEW-sale path too (per Isaac) — the
    // rep logging the sale knows both at signing time. They still auto-detect
    // downstream (PIF from CRM payments, $2k+ ACV commercial flag in the
    // queue), so these are the early manual call, not the only gate.
    el('div', { class: 'grid grid-cols-1 sm:grid-cols-2 gap-3 mt-5' },
      checkboxCard('Paid in Full', 'No hold on backend — full commission is paid upfront (auto-detected from CRM; override here)', (v) => { modalState.paid_in_full = v; updateFooter(); }, modalState.paid_in_full),
      checkboxCard('Commercial', 'Commercial property — pays the commercial rate (base − 3.5pts). $2k+ ACV rows are flagged in the queue for this check.', (v) => { modalState.is_commercial = v; updateFooter(); }, modalState.is_commercial),
      checkboxCard('Passed Audit', 'The office flagged this account Passed Audit in FieldRoutes (signed agreement, autopay on file, charged upfront) — feeds the Passed Audit % tier on the Pay tab (70%+ passed pays 100% of commission; lower tiers pay 95 / 90 / 85%).', (v) => { modalState.upfront_collected = v; updateFooter(); }, modalState.upfront_collected),
    ),

    mk('Notes',
      el('textarea', { name: 'notes', class: 'w-full rounded-lg border px-3 py-2.5 text-sm', rows: 2, placeholder: 'Optional...' }),
      { fullWidth: true },
    ),

    addAnotherToggle,
  );

  // ── FOOTER (sticky dark bar with live ACV + Projected Commission) ──
  const footerRep   = el('div', { class: 'text-base font-bold text-muted-' }, '—');
  const footerAcv   = el('div', { class: 'text-lg font-bold text-muted- tabular-nums' }, '$0.00');
  const footerComm  = el('div', { class: 'text-lg font-bold text-muted- tabular-nums' }, '$0.00');
  const footerStatus= el('div', { class: 'text-base font-bold text-muted-' }, 'Pending');
  const submitBtn   = el('button', {
    type: 'submit',
    class: 'fab w-full sm:w-auto',
    style: { position: 'static', padding: '14px 24px' },
  },
    el('span', {}, isEdit ? 'Save Changes' : 'Log Sale'),
  );

  // Footer is horizontal on desktop (4 stats + button), but on mobile the stats
  // collapse into a 2×2 grid above a full-width button — keeps the modal usable
  // on a phone where reps actually log sales.
  const footer = el('div', {
    class: 'px-4 sm:px-6 py-4 border-t border- flex flex-col sm:grid sm:grid-cols-[1fr_1fr_1.3fr_.7fr_auto] sm:items-center gap-3 sm:gap-4',
    style: { background: 'var(--header-bg)', color: 'var(--header-text)' },
  },
    el('div', { class: 'grid grid-cols-2 gap-3 sm:contents' },
      footerBlock('REP', footerRep),
      footerBlock('ACV', footerAcv),
      footerBlock('PROJECTED COMMISSION', footerComm),
      footerBlock('STATUS', footerStatus),
    ),
    submitBtn,
  );

  // Wire submit button to the form via requestSubmit()
  submitBtn.addEventListener('click', (e) => {
    e.preventDefault();
    if (!isFormValid()) { checkValidity(); return; }
    form.requestSubmit();
  });

  function updateFooter() {
    const initial  = parseFloat(initialInput.value) || 0;
    const monthly  = parseFloat(recurringInput.value) || 0;
    const numSvcs  = parseFloat(numServicesInput.value) || 0;
    const amtSvc   = parseFloat(amtPerServiceInput.value) || 0;
    const ctId     = Number(contractTypeSelect.value);
    const ct       = state.contractTypes.find(c => c.id === ctId);
    const months   = ct?.implied_months != null ? ct.implied_months : 12;
    // ACV logic:
    //   Non-PPS: initial + monthly*11 (initial covers month 1, then 11 monthly billings)
    //   PPS:     num_services * amt_per_service (no initial component on PPS)
    const acv = modalState.pay_per_service
      ? numSvcs * amtSvc
      : initial + monthly * 11;
    // Revenue is always the FIRST 12 months of billing regardless of
    // contract length: initial covers month 1, then 11 monthly billings.
    const revenue = modalState.pay_per_service
      ? initial + numSvcs * amtSvc
      : initial + monthly * 11;
    // Use the pricing engine for the projected commission preview —
    // source-aware so renewal sources preview their flat $/account pay.
    const srcId = Number(form.querySelector('select[name="source_id"]')?.value) || null;
    const mockSale = {
      contract_type_id: ctId, contract_months: months, audit_status: 'serviced',
      source_id: srcId, revenue_amount: revenue,
      paid_in_full: !!modalState.paid_in_full, is_commercial: !!modalState.is_commercial,
    };
    const projected = getCommissionAmount(modalState.rep_id, mockSale);
    const repName = profiles.find(p => p.id === modalState.rep_id)?.full_name || '';
    footerRep.textContent   = repName;
    footerAcv.textContent   = fmt.usd(acv);
    footerComm.textContent  = fmt.usd(projected);
    footerStatus.textContent= 'Pending';
  }

  // Validate the 8 top fields: customer_name, customer_number, office_id, contract_type_id,
  // service_type_id, source_id, initial_amount, recurring (or num_services + amount)
  function isFormValid() {
    const vals = Object.fromEntries(new FormData(form));
    const required = ['customer_name', 'customer_number', 'office_id', 'contract_type_id', 'service_type_id', 'source_id', 'initial_amount'];
    for (const k of required) {
      if (!vals[k] || String(vals[k]).trim() === '') return false;
    }
    if (modalState.pay_per_service) {
      if (!vals.num_services || !vals.amount_per_service) return false;
    } else {
      if (vals.monthly_amount == null || String(vals.monthly_amount).trim() === '') return false;
    }
    return true;
  }

  function checkValidity() {
    const ok = isFormValid();
    submitBtn.disabled = !ok;
    submitBtn.style.opacity = ok ? '1' : '.45';
    submitBtn.style.cursor  = ok ? 'pointer' : 'not-allowed';
  }

  // Reset the form in-place so the rep can immediately log another sale
  // without re-opening the modal. Keeps the rep (modalState.rep_id) and the
  // "add another" toggle, clears everything else.
  function resetFormForAnother() {
    const keepAddAnother = addAnotherInput.checked;
    form.reset();
    addAnotherInput.checked = keepAddAnother;
    // form.reset clears explicit value attrs too, so restore the date defaults
    const todayStr = new Date().toISOString().slice(0, 10);
    const soldEl = form.querySelector('input[name="sold_date"]');
    const commEl = form.querySelector('input[name="commission_date"]');
    if (soldEl) soldEl.value = todayStr;
    if (commEl) commEl.value = todayStr;
    // Sync the shadow state that lives outside form data
    modalState.paid_in_full = false;
    modalState.is_commercial = false;
    modalState.pay_per_service = false;
    pps.checked = false;
    // Rebuild the dependent UI (service options + recurring/PPS host)
    rebuildServiceOptions();
    renderRecurringHost();
    updateFooter();
    submitBtn.disabled = false;
    submitBtn.innerHTML = '';
    submitBtn.append(el('span', {}, 'Log Sale'));
    checkValidity();
    setTimeout(() => form.querySelector('input[name="customer_name"]')?.focus(), 0);
  }

  rebuildServiceOptions();
  renderRecurringHost();

  // Pre-fill all form fields when editing an existing sale (or claiming a
  // ghost). Has to run after rebuildServiceOptions so the service dropdown
  // has its filtered options.
  if (isEdit || prefill) {
    const seed = isEdit ? existingSale : prefill;
    const setVal = (name, v) => { const el = form.querySelector(`[name="${name}"]`); if (el && v != null) el.value = v; };
    // Split the stored name back into the First | Last inputs. Handles both
    // "Jane Smith" and "Smith, Jane" spellings.
    {
      const full = String(seed.customer_name || '').trim();
      let first = full, last = '';
      if (full.includes(',')) {
        const [l, f] = full.split(',');
        first = (f || '').trim(); last = (l || '').trim();
      } else {
        const i = full.lastIndexOf(' ');
        if (i > 0) { first = full.slice(0, i).trim(); last = full.slice(i + 1).trim(); }
      }
      setVal('customer_first', first);
      setVal('customer_last', last);
    }
    setVal('customer_number', seed.customer_number);
    setVal('office_id', seed.office_id);
    setVal('contract_type_id', seed.contract_type_id);
    rebuildServiceOptions(); // re-filter services for the chosen contract type
    setVal('service_type_id', seed.service_type_id);
    setVal('source_id', seed.source_id);
    setVal('initial_amount', seed.initial_amount);
    if (seed.pay_per_service) {
      pps.checked = true;
      renderRecurringHost();
      setVal('num_services', seed.num_services);
      setVal('amount_per_service', seed.monthly_amount);
    } else {
      setVal('monthly_amount', seed.monthly_amount);
    }
    setVal('sold_date', seed.sold_date);
    setVal('commission_date', seed.commission_date);
    setVal('notes', seed.notes);
    repSelect.value = seed.rep_id;
  }

  updateFooter();
  checkValidity();

  card.append(header, form, footer);
  overlay.append(card);
  document.body.append(overlay);
}

// Helper — render a compact label/value pair for the dark footer
function footerBlock(label, valueNode) {
  return el('div', {},
    el('div', { class: 'text-[9px] uppercase tracking-widest', style: { color: 'rgba(255,255,255,.6)' } }, label),
    valueNode,
  );
}

// Helper — big checkbox card (Paid in Full / Commercial)
function checkboxCard(title, desc, onChange, initialChecked = false) {
  const input = el('input', {
    type: 'checkbox',
    class: 'accent-lime w-4 h-4 mt-0.5 shrink-0',
    checked: initialChecked,
    onchange: (e) => onChange(e.target.checked),
  });
  return el('label', {
    class: 'card-2 rounded-xl border border- p-4 flex items-start gap-3 cursor-pointer hover:brightness-95 transition',
  },
    input,
    el('div', { class: 'flex-1 min-w-0' },
      el('div', { class: 'font-semibold text-sm' }, title),
      el('div', { class: 'text-xs text-muted- mt-0.5' }, desc),
    ),
  );
}

// Legacy wrapper — kept so any old callers of newSaleForm() still work
function newSaleForm(onDone) {
  // This was the inline form; now we route everything through the modal.
  setTimeout(() => { openNewSaleModal(); onDone?.(); }, 0);
  return el('div', {});
}

// ──────────────────────────────────────────────────────────────────────────
// VIEW: PAY — replicates your PAY STUB layout
// ──────────────────────────────────────────────────────────────────────────
// ──────────────────────────────────────────────────────────────────────────
// PAY PERIOD HELPERS — 26 biweekly periods per year, anchored to Jan 1
// ──────────────────────────────────────────────────────────────────────────
// Pay periods (per Isaac): bi-weekly, anchored to Sep 6 – Sep 19, 2026 and
// every 14 days either side of that — NOT Jan 1 blocks. A year's list is
// every period that starts in that year (the first one may spill in from
// December, so the whole year is covered).
const PAY_PERIOD_ANCHOR = '2026-09-06';
function getPayPeriods(year) {
  const [ay, am, ad] = PAY_PERIOD_ANCHOR.split('-').map(Number);
  const anchor = new Date(ay, am - 1, ad);
  const fmtOpt = { month: 'short', day: 'numeric' };
  const iso = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  // Walk back to the first period that touches Jan 1 of `year`.
  const jan1 = new Date(year, 0, 1);
  const dayDiff = Math.round((jan1 - anchor) / 86400000);
  let k = Math.floor(dayDiff / 14);
  const periods = [];
  for (let i = 0; i < 30; i++, k++) {
    const start = new Date(anchor); start.setDate(anchor.getDate() + k * 14);
    if (start.getFullYear() > year) break;
    const end = new Date(start); end.setDate(start.getDate() + 13); end.setHours(23, 59, 59, 999);
    if (end < jan1) continue;
    periods.push({
      id: periods.length + 1, start, end,
      label: `${start.toLocaleDateString('en-US', fmtOpt)} – ${end.toLocaleDateString('en-US', fmtOpt)}`,
      isoStart: iso(start), isoEnd: iso(end),
    });
  }
  return periods;
}
function currentPayPeriodId(year) {
  const now = new Date();
  const periods = getPayPeriods(year);
  const p = periods.find(p => now >= p.start && now <= p.end);
  if (p) return p.id;
  return now.getFullYear() > year ? periods.length : 1;
}


// ── Sales feed (per Isaac, Oct 14) ───────────────────────────────────────────
// The TV board's Latest-sales rows on the Sales tab: NAME | #id | service |
// term | source on the first line; sold date, the account's ADD-ONS (ticket
// items, from Oct 12 when office add-ons started) and the INITIAL date on the
// second; revenue, status and the CRM checks on the right. Add-ons are
// green when FieldRoutes credits someone (Commission To) and red when it
// credits nobody — whether or not that person has an app account.
const SALES_FEED_START = '2026-10-12';
let _salesAoPull = 0;
function salesFeedAddOnsPull() {
  if (Date.now() - _salesAoPull < 5 * 60000 || typeof supabase === 'undefined' || !supabase || (typeof DEMO !== 'undefined' && DEMO)) return;
  _salesAoPull = Date.now();
  // tv_add_ons(): every add-on with who FieldRoutes credits, readable on any login (reps' own RLS only shows theirs).
  Promise.resolve(supabase.rpc('tv_add_ons', { since: SALES_FEED_START })).then(({ data, error }) => {
    if (!error && Array.isArray(data)) { state._tvAddOns = data; if (state.view && /sales/.test(state.view)) mountApp(); }
  }).catch(() => { /* falls back to state.addOns */ });
  // Today's sales' sold time: the live pull's feed (same one the TV reads) until the snapshot has them.
  Promise.resolve(supabase.from('app_settings').select('value').eq('key', 'crm_live_recent').maybeSingle()).then(({ data }) => {
    const v = data && data.value; if (v && Array.isArray(v.rows) && (!state._crmLiveRecent || state._crmLiveRecent.at !== v.at)) state._crmLiveRecent = v;
  }).catch(() => { /* snapshot time only */ });
}
function saleAddOnsFor(sale) {
  const all = Array.isArray(state._tvAddOns) ? state._tvAddOns : (Array.isArray(state.addOns) ? state.addOns : []);
  const fee = /\bfee\b|\btax\b|discount|surcharge/i;
  const sub = String(sale.crm_subscription_id || ''), cust = String(sale.customer_number || ''), day = String(sale.sold_date || '').slice(0, 10);
  const d0 = day ? new Date(day + 'T00:00').getTime() : null;
  const seen = new Set(), out = [];
  for (const a of all) {
    if (!a || a.removed_at || fee.test(String(a.service_name || ''))) continue;
    const onSub = sub && String(a.subscription_id || '') === sub;
    const sameDay = !onSub && cust && String(a.customer_id || '') === cust && d0 != null && Math.abs(new Date(String(a.added_at || '').slice(0, 10) + 'T00:00').getTime() - d0) <= 86400000;
    if (!onSub && !sameDay) continue;
    const k = String(a.subscription_id) + '|' + String(a.service_name || '').toLowerCase(); if (seen.has(k)) continue; seen.add(k);
    out.push(a);
  }
  return out;
}
// Service + its add-ons as one phrase (per Isaac, Oct 15): "Pest 6 + Mole + Rodent" — what the customer has and
// what was added, at a glance. Each add-on green when FieldRoutes credits someone, red when it credits nobody.
// An add-on-only sale shows the plan it went on (muted) + the add-on. opts: { size, weight, ok, bad, muted }.
function saleBasePlanName(s, ao) {
  const fromAo = (ao || []).map(a => a && a.base_service).find(Boolean);
  if (fromAo) return fromAo;
  const sub = String(s.parent_subscription_id || s.crm_subscription_id || '');
  const r = sub ? (state.reportingSubscriptions || []).find(x => String(x.subscription_id) === sub) : null;
  return r ? (r.subscription || '') : '';
}
function saleServiceWithAddOns(s, svcName, ao, opts) {
  const o = Object.assign({ size: '13px', weight: '600', ok: '#15803D', bad: '#DC2626', muted: 'var(--text-muted)' }, opts || {});
  const addOnOnly = s.sale_kind === 'upsell';
  const base = addOnOnly ? saleBasePlanName(s, ao) : svcName;
  const list = (ao || []).length ? ao : (addOnOnly && s.crm_subscription ? [{ service_name: s.crm_subscription, credited_profile_id: s.rep_id || null, credited_employee_id: s.crm_seller_id || (s.rep_id ? 'x' : null) }] : []);
  return el('span', { style: { fontSize: o.size, fontWeight: o.weight, whiteSpace: 'nowrap' },
    title: list.map(a => (a.service_name || 'Add-on') + (saleAddOnCredited(a) ? ' \u00b7 credited in FieldRoutes' : ' \u2014 Commission To is N/A in FieldRoutes')).join('\n') },
    base ? el('span', { style: addOnOnly ? { color: o.muted } : {} }, base) : null,
    ...list.map((a, i) => el('span', { style: { color: saleAddOnCredited(a) ? o.ok : o.bad } }, (base || i ? ' + ' : '+ ') + (a.service_name || 'Add-on'))));
}
function saleAddOnCredited(a) {
  if (!('credited_employee_id' in a)) return !!a.credited_profile_id;
  const e = String(a.credited_employee_id == null ? '' : a.credited_employee_id).trim();
  return !!e && e !== '0' && !e.startsWith('-');
}
// Counts as a sale on the Upfront queue (per Isaac, Oct 15): an initial appointment booked after the sale
// (or already serviced). Signed agreement is the second requirement once FieldRoutes' form endpoint is in.
// Before the crm_initial_appt_at column exists (migration 20260921), fall back to the appointment status.
function saleHasInitialScheduled(s) {
  if (s.crm_serviced_at) return true;
  const a = s.crm_initial_appt_at ? String(s.crm_initial_appt_at).slice(0, 10) : '';
  if (a && a >= String(s.sold_date || '').slice(0, 10)) return true;
  // FieldRoutes' own initial-appointment status on the plan (Pending / Completed) — stamped every 15 min,
  // so it covers sales whose date hasn't been stamped yet. Add-on sales only count their own appointment.
  const st = String(s.crm_initial_status || '').toLowerCase();
  if (s.sale_kind === 'upsell') return st === 'pending' || st === 'completed';
  return s.crm_initial_status == null ? !('crm_initial_appt_at' in s) : (st === 'pending' || st === 'completed');
}
// Initial date (was "Service Date"): completed ✓ / scheduled 📅 / past-and-not-done ⚠ / not scheduled.
function saleInitialDateNode(s, small) {
  const c = (typeof commissionableDate === 'function') ? commissionableDate(s) : { why: '' };
  const svc = s.crm_serviced_at ? String(s.crm_serviced_at).slice(0, 10) : null;
  const _sold = String(s.sold_date || '').slice(0, 10);
  const _appt = s.crm_initial_appt_at ? String(s.crm_initial_appt_at).slice(0, 10) : null;
  const sched = _appt && (!_sold || _appt >= _sold) ? _appt : null;   // a date before the sale is an older plan appointment, not this sale's initial
  const cls = 'tabular-nums whitespace-nowrap' + (small ? '' : ' font-medium');
  if (svc) return el('span', { class: cls, title: 'Initial service completed ' + svc + ' · ' + c.why, style: { color: 'var(--ok)' } }, (small ? 'INITIAL ' : '') + '✓ ' + fmt.dateShortYear(svc));
  // Scheduled date + FieldRoutes says Completed (the completion date lags in RevHawk) → ✓ that date (per Isaac, Oct 15 — #183686).
  if (sched && s.sale_kind !== 'upsell' && String(s.crm_initial_status || '').toLowerCase() === 'completed') return el('span', { class: cls, title: 'Initial service completed (FieldRoutes) · ' + c.why, style: { color: 'var(--ok)' } }, (small ? 'INITIAL ' : '') + '\u2713 ' + fmt.dateShortYear(sched));
  if (sched) { const past = sched < new Date().toISOString().slice(0, 10); return el('span', { class: cls, title: (past ? 'Initial appointment was scheduled for ' + sched + ' but is not marked completed in FieldRoutes' : 'Initial appointment scheduled for ' + sched) + ' · ' + c.why, style: past ? { color: '#B45309' } : {} }, (small ? 'INITIAL ' : '') + (past ? '⚠ ' : '') + fmt.dateShortYear(sched)); }
  // No date stamped yet, but FieldRoutes' own initial status says it's done / booked (per Isaac, Oct 15 — #183711).
  const _ist = String(s.crm_initial_status || '').toLowerCase();
  if (s.sale_kind !== 'upsell' && _ist === 'completed') return el('span', { class: cls, title: 'FieldRoutes shows the initial appointment Completed · ' + c.why, style: { color: 'var(--ok)' } }, (small ? 'INITIAL ' : '') + '\u2713 done');
  if (s.sale_kind !== 'upsell' && _ist === 'pending') return el('span', { class: cls, title: 'FieldRoutes shows the initial appointment booked (Pending) · ' + c.why }, (small ? 'INITIAL ' : '') + 'booked');
  return el('span', { class: cls, title: 'No initial appointment on the subscription yet · ' + c.why, style: { color: 'var(--text-subtle)' } }, (small ? 'INITIAL ' : '') + 'not scheduled');
}
// Sold date + time (per Isaac, Oct 15). The CRM snapshot's sold_at is FieldRoutes' dateAdded on the company
// clock (UTC−7 year-round, same as the TV board); shown in Mountain time. Falls back to the date alone.
let _soldAtIdx = { src: null, map: null };
function saleSoldWhen(s) {
  const rows = state.reportingSubscriptions || [];
  if (_soldAtIdx.src !== rows) { const m = new Map(); for (const r of rows) if (r && r.subscription_id != null && r.sold_at) m.set(String(r.subscription_id), r.sold_at); _soldAtIdx = { src: rows, map: m }; }
  const live = state._crmLiveRecent && Array.isArray(state._crmLiveRecent.rows) ? state._crmLiveRecent.rows.find(x => String(x.subscriptionId) === String(s.crm_subscription_id || '')) : null;
  const raw = (live && live.soldAt) || (s.crm_subscription_id != null ? _soldAtIdx.map.get(String(s.crm_subscription_id)) : null);
  const m = String(raw || '').match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  if (!m) return fmt.dateShortYear(s.sold_date);
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4] + 7, +m[5]));
  try { return fmt.dateShortYear(s.sold_date) + ' \u00b7 ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Denver' }) + ' MT'; } catch (e) { return fmt.dateShortYear(s.sold_date); }
}
function salesFeed(rows, { isAdmin = false, title = '' } = {}) {
  salesFeedAddOnsPull();
  const sep = () => el('span', { style: { color: 'var(--border-2)', padding: '0 9px' } }, '|');
  const ok = '#15803D', bad = '#DC2626';
  // Title click flips newest-first ⇄ oldest-first (per Isaac, Oct 15).
  const _asc = !!state._salesFeedAsc;
  const sorted = [...rows].sort((a, b) => String(b.sold_date || '').localeCompare(String(a.sold_date || '')) || String(b.created_at || '').localeCompare(String(a.created_at || '')));
  if (_asc) sorted.reverse();
  return el('div', { class: 'card overflow-hidden' },
    el('div', { class: 'flex flex-wrap items-center justify-between gap-2 px-4 pt-4 pb-2' },
      el('button', { type: 'button', class: 'text-[10px] uppercase tracking-widest font-semibold text-muted- cursor-pointer inline-flex items-center', style: { gap: '6px', background: 'transparent', border: '0', padding: '0' },
        title: _asc ? 'Oldest first \u2014 click for newest first' : 'Newest first \u2014 click for oldest first',
        onclick: () => { state._salesFeedAsc = !_asc; mountApp(); } },
        title || 'Latest sales', el('span', { style: { fontSize: '11px', color: 'var(--text)' } }, _asc ? '\u2191' : '\u2193')),
      el('div', { class: 'flex flex-wrap items-center justify-end', style: { columnGap: '18px', rowGap: '6px' } },
        saleStatusKey(),
        el('div', { class: 'text-[10px] uppercase tracking-widest text-muted-' }, rows.length + ' since ' + fmt.dateShortYear(SALES_FEED_START)))),
    ...sorted.map((s, i, arr) => {
      const _numW = String(arr.length).length > 2 ? 30 : 22;
      const rep = (state.allProfiles || []).find(p => p.id === s.rep_id);
      const svcName = (typeof nameFromId === 'function' ? nameFromId(state.serviceTypes, s.service_type_id) : '') || s.crm_subscription || '—';
      const _src = typeof nameFromId === 'function' ? nameFromId(state.sources, s.source_id) : '';
      const src = _src && _src !== '\u2014' ? _src : '';
      const ao = saleAddOnsFor(s), unassigned = ao.filter(a => !saleAddOnCredited(a));
      // An add-on on its own (the upsell row the add-ons sync makes): no service type, and the term reads ADD ON (per Isaac, Oct 15).
      const addOnOnly = s.sale_kind === 'upsell' || (!s.service_type_id && ao.length > 0);
      const term = addOnOnly ? 'ADD ON' : Number(s.contract_months) > 1 ? Number(s.contract_months) + ' MO' : 'ONE-TIME';
      const aoNode = !ao.length
        ? el('span', { style: { color: 'var(--text-subtle)', letterSpacing: '.06em' } }, 'ADDONS +0')
        : el('span', { style: { color: unassigned.length ? bad : ok, fontWeight: '700', letterSpacing: '.06em' },
            title: ao.map(a => (a.service_name || 'Add-on') + (saleAddOnCredited(a) ? ' · credited in FieldRoutes' : ' — Commission To is N/A in FieldRoutes')).join('\n') },
            'ADDONS +' + ao.length + '  ·  ' + ao.map(a => String(a.service_name || 'Add-on').toUpperCase()).join(', '));
      const cell = (col, row, child, extra) => el('div', { style: { gridColumn: col, gridRow: String(row), minWidth: '0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', ...(extra || {}) } }, child);
      const small = { fontSize: '10px', color: 'var(--text-muted)', marginTop: '2px' };
      return el('div', {
        class: 'grid items-center gap-4 px-4 py-2.5 cursor-pointer transition hover:brightness-95',
        style: { gridTemplateColumns: (_numW + 'px') + ' minmax(0, 1fr) auto auto', borderTop: '1px solid var(--border)', background: saleStatusTint(s.audit_status), ...(s.crm_audit === 'passed' ? { boxShadow: 'inset 3px 0 0 #15803D' } : {}) },
        title: s.crm_audit === 'passed' ? 'Passed Audit flag on the customer card in FieldRoutes' : undefined,
        onclick: (e) => { if (e.target.closest('select, button, input, textarea, a')) return; openNewSaleModal(null, s); },
      },
        // Row number (per Isaac, Oct 15) — the TV's rank column: mono, muted, right-aligned, newest = 1.
        el('div', { class: 'tabular-nums text-right self-start', style: { fontFamily: 'var(--font-mono, ui-monospace, monospace)', fontSize: '12px', fontWeight: '600', color: 'var(--text-subtle)', paddingTop: '3px' } }, String(i + 1).padStart(2, '0')),
        // One line (per Isaac, Oct 15 — there's room): NAME | #id | service | add-ons | term | source | initial; sold date + time under the name.
        el('div', { style: { display: 'grid', gridTemplateColumns: 'max-content auto max-content auto max-content auto minmax(0, max-content) auto max-content auto minmax(0, max-content) auto max-content minmax(0, 1fr)', alignItems: 'baseline', minWidth: '0', overflow: 'hidden' } },
          // No app account yet: the FieldRoutes seller's name, marked (per Isaac, Oct 15).
          cell('1', 1, el('span', { class: 'font-black uppercase', style: { fontSize: '15px', letterSpacing: '.02em' }, title: rep ? '' : 'Credited in FieldRoutes · no app account linked yet' },
            rep ? rep.full_name : (s.crm_seller_name ? (typeof flipLastFirst === 'function' ? flipLastFirst(s.crm_seller_name) : s.crm_seller_name) : 'Unlinked seller'),
            /* NO APP ACCOUNT tag hidden (per Isaac, Oct 15) — FieldRoutes attribution is what counts */ null), { minWidth: 'max-content' }),
          cell('2', 1, (s.customer_number || s.customer_name) ? sep() : null),
          // Customer name beside the id (per Isaac, Oct 15).
          cell('3', 1, (s.customer_number || s.customer_name) ? el('span', { style: { fontSize: '12px' } },
            s.customer_number ? el('span', { class: 'tabular-nums text-muted-' }, '#' + s.customer_number) : null,
            s.customer_name ? el('span', { class: 'font-medium', style: { marginLeft: s.customer_number ? '6px' : '0' } }, s.customer_name) : null) : null, { minWidth: 'max-content' }),
          cell('4', 1, sep()),
          cell('5', 1, saleServiceWithAddOns(s, svcName, ao, { ok, bad })),   // "Pest 6 + Mole + Rodent" (per Isaac, Oct 15)
          cell('6', 1, null),
          cell('7', 1, null),
          cell('8', 1, sep()),
          cell('9', 1, el('span', { class: 'font-semibold', style: { fontSize: '13px' } }, term), { minWidth: 'max-content' }),
          cell('10', 1, src ? sep() : null),
          cell('11', 1, src ? el('span', { class: 'text-muted-', style: { fontSize: '11px' } }, src) : null),
          cell('12', 1, sep()),
          cell('13', 1, el('span', { style: { fontSize: '10px' } }, saleInitialDateNode(s, true)), { minWidth: 'max-content' }),
          cell('1 / 14', 2, el('span', { class: 'tabular-nums' }, 'Sold ' + saleSoldWhen(s),
            // Invoices paid toward the backend lock (initial counts) and days aging (per Isaac, Oct 15).
            (s.crm_paid_invoices != null || s.payroll_processed_at) ? el('span', { style: { marginLeft: '12px', color: (Number(s.crm_paid_invoices) || 0) >= 4 ? ok : 'var(--text-muted)', fontWeight: '600' } }, '\u{1F9FE} ' + (Number(s.crm_paid_invoices) || 0) + ' of 4 invoices paid') : null,
            el('span', { style: { marginLeft: '12px', color: Number(s.crm_days_past_due) > 0 ? bad : 'var(--text-muted)', fontWeight: Number(s.crm_days_past_due) > 0 ? '700' : '400' } }, 'Aging ' + (s.crm_days_past_due != null ? Number(s.crm_days_past_due) : 0) + 'd'),
            // Paid since the sale (per Isaac, Oct 15) — the customer's first real payment on/after this sale.
            s.crm_paid_since_sale === true ? el('span', { style: { marginLeft: '12px', color: ok, fontWeight: '600' }, title: 'A successful payment on the account since this sale' }, '\u{1F4B3} Paid' + (s.crm_paid_at ? ' ' + fmt.dateShort(s.crm_paid_at) : ''))
              : s.crm_paid_since_sale === false ? el('span', { style: { marginLeft: '12px', color: bad, fontWeight: '700' }, title: 'Card declined since this sale and nothing has gone through' }, '\u{1F4B3} Declined' + (s.crm_declined_at ? ' ' + fmt.dateShort(s.crm_declined_at) : ''))
              : el('span', { style: { marginLeft: '12px', color: 'var(--text-subtle)' }, title: 'No payment on the account since this sale yet' }, '\u{1F4B3} No payment yet'),
            // Below the pricing minimum (Configurations → Pricing minimums), per Isaac, Oct 15.
            s.crm_below_min ? el('span', { style: { marginLeft: '12px', color: SALE_STATUS_COLOR.below_minimums, fontWeight: '700' }, title: 'Under the pricing minimum in Configurations \u2192 Pricing minimums' }, '\u26A0 Below min: ' + s.crm_below_min) : null), small)),
        el('div', { class: 'text-right tabular-nums font-semibold', style: { fontSize: '17px' },
          title: s.commission_split ? 'Commissionable ' + fmt.usd(s.revenue_amount) + ' of ' + fmt.usd(s.total_revenue) + ' on the account' : '' },
          fmt.usd0 ? fmt.usd0(s.revenue_amount) : fmt.usd(s.revenue_amount),
          s.commission_split && Number(s.total_revenue) > Number(s.revenue_amount) + 0.005 ? el('div', { class: 'text-[9px] font-normal text-muted-' }, 'of ' + fmt.usd(s.total_revenue)) : null),
        el('div', { class: 'flex items-center gap-2' }, statusSelect(s.id), (s.crm_audit === 'failed' && typeof saleAuditChip === 'function') ? saleAuditChip(s) : null));
    }));
}

// ── Run payroll (per Isaac, Oct 15) ──────────────────────────────────────────
// Office Staff upfront run from the Sales tab: every Upfront sale that is
// commissionable (Commissionable / Below Minimums), not paid yet, and credited to
// a linked rep. Pay is computed by the SAME functions the Pay tab uses
// (isPayLines → getCommissionAmount / getCommissionRate, the Passed Audit tier via
// passedAuditPool + upfrontCollectedPct + upfrontTierPayPct, the period's Other
// Pay adjustments, and the rep's Golden Phone / Loyalty lines). Nothing new is
// invented here — this page only lays those numbers out per rep.
// Confirm stamps payroll_processed_at (+ the pay_runs snapshot, Slack DMs), then:
// one-time services go straight to History; everything else waits in Pending
// Backend Lock for 4 paid invoices.
function payrollRunCandidates(rows) {
  return (rows || []).filter(s => (s.audit_status === 'serviced' || s.audit_status === 'below_minimums') && !s.payroll_processed_at && s.rep_id);
}
function payrollRunStub(repId, sales, period) {
  const prof = (state.allProfiles || []).find(p => p.id === repId) || {};
  const pool = (typeof passedAuditPool === 'function') ? passedAuditPool(repId, period) : [];
  const pct = upfrontCollectedPct(pool.length ? pool : sales), mult = upfrontTierPayPct(pct, repId);
  // Per-sale pay exactly as the Pay tab totals it (sumUpfrontPay): the Passed Audit tier applies to the plan
  // commission; an add-on's flat slice (getAddonCommission) is paid as-is.
  const byId = new Map(sales.map(x => [x.id, x]));
  const lines = isPayLines(repId, sales, mult).map(l => {
    const sale = byId.get(l.sale_id); const add = (typeof getAddonCommission === 'function' && sale) ? getAddonCommission(repId, sale) : 0;
    return Object.assign(l, { addon: Math.round(add * 100) / 100, amount: Math.round(((l.base - add) * mult + add) * 100) / 100 });
  });
  const salesPay = lines.reduce((a, l) => a + l.amount, 0);
  // Same period-level lines as the Pay tab's pay-period stub (viewPay → totalPayPayPeriod).
  const isLoyalty = (prof.rep_type || 'sales_rep') === 'loyalty_rep' || (typeof scorecardDeptOf === 'function' && scorecardDeptOf(prof) === 'loyalty');
  const extras = [];
  if (isLoyalty) {
    if (Number(prof.loyalty_royalty_amount)) extras.push(['Loyalty Royalty', Number(prof.loyalty_royalty_amount)]);
    if (Number(prof.revhawk_pay_amount)) extras.push(['RevHawk', Number(prof.revhawk_pay_amount)]);
    if (Number(prof.loyalty_pay_amount)) extras.push(['Loyalty Pay', Number(prof.loyalty_pay_amount)]);
  } else if (Number(prof.golden_phone_amount)) extras.push(['Golden Phone', Number(prof.golden_phone_amount)]);
  const adj = (state.payAdjustments || []).filter(a => a.rep_id === repId && Number(a.period_year) === Number(period.start.getFullYear()) && Number(a.period_id) === Number(period.id));
  adj.forEach(a => extras.push([a.note || a.label || 'Other pay', Number(a.amount) || 0]));
  if (Number(prof.other_pay_amount)) extras.push(['Other pay', Number(prof.other_pay_amount)]);
  const total = salesPay + extras.reduce((a, x) => a + x[1], 0);
  return { prof, pct, mult, lines, salesPay, extras, total, revenue: lines.reduce((a, l) => a + l.revenue, 0) };
}
function openPayrollRun(rows) {
  const today = new Date();
  const period = getPayPeriods(today.getFullYear()).find(p => p.id === currentPayPeriodId(today.getFullYear())) || getPayPeriods(today.getFullYear())[0];
  const sales = payrollRunCandidates(rows);
  const held = (rows || []).filter(s => (s.audit_status === 'serviced' || s.audit_status === 'below_minimums') && !s.payroll_processed_at && !s.rep_id);
  const byRep = new Map(); sales.forEach(s => { if (!byRep.has(s.rep_id)) byRep.set(s.rep_id, []); byRep.get(s.rep_id).push(s); });
  const stubs = [...byRep.entries()].map(([rid, list]) => payrollRunStub(rid, list, period)).sort((a, b) => b.total - a.total);
  const grand = stubs.reduce((a, x) => a + x.total, 0);
  const saleById = new Map(sales.map(s => [s.id, s]));
  const money = (v) => fmt.usd(Math.round((Number(v) || 0) * 100) / 100);
  const pct = (v) => v == null ? '—' : Math.round(v * 100) + '%';
  const back = el('div', { style: { position: 'fixed', inset: '0', zIndex: '9000', background: 'var(--bg)', overflowY: 'auto' } });
  const close = () => back.remove();
  const th = (t, right) => el('th', { class: 'px-2 py-1.5 text-[9px] uppercase tracking-wider font-semibold whitespace-nowrap ' + (right ? 'text-right' : 'text-left'), style: { color: 'var(--text-muted)', background: 'var(--card-2)' } }, t);
  const td = (t, right, extra) => el('td', { class: 'px-2 py-1.5 tabular-nums whitespace-nowrap ' + (right ? 'text-right' : 'text-left'), style: extra || {} }, t);
  const stubCard = (x) => {
    const ownLines = x.lines.map(l => ({ l, s: saleById.get(l.sale_id) || {} }));
    return el('div', { class: 'card overflow-hidden', style: { breakInside: 'avoid' } },
      // Header bar — the same dark band the Pay tab's stub uses.
      el('div', { class: 'flex items-center justify-between px-4 py-2.5', style: { background: 'var(--text)', color: 'var(--card)' } },
        el('div', { class: 'flex items-center gap-2' }, avatarNode(x.prof.avatar_url, x.prof.initials, 'w-7 h-7 text-[10px]'),
          el('div', {}, el('div', { class: 'text-sm font-black uppercase tracking-wide' }, x.prof.full_name || 'Rep'),
            el('div', { class: 'text-[10px] uppercase tracking-widest', style: { opacity: '.7' } }, 'Pay stub · ' + period.label))),
        el('div', { class: 'text-right' }, el('div', { class: 'text-[9px] uppercase tracking-widest', style: { opacity: '.7' } }, 'Total pay'),
          el('div', { class: 'text-xl font-black tabular-nums' }, money(x.total)))),
      // How it was earned, in one line.
      el('div', { class: 'grid', style: { gap: '0', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', borderBottom: '1px solid var(--border)' } },
        ...[['Accounts', String(x.lines.length)], ['Revenue', money(x.revenue)], ['Passed Audit %', pct(x.pct)], ['Tier pays', Math.round((x.mult || 1) * 100) + '%']].map(([k, v], i) =>
          el('div', { class: 'px-4 py-2', style: { borderLeft: i ? '1px solid var(--border)' : '0' } },
            el('div', { class: 'text-[9px] uppercase tracking-widest font-semibold text-muted-' }, k), el('div', { class: 'text-sm font-bold tabular-nums' }, v)))),
      el('div', { class: 'scroll-x' }, el('table', { class: 'w-full text-xs' },
        el('thead', {}, el('tr', {}, th('Customer'), th('Plan'), th('Term'), th('Sold'), th('Revenue', 1), th('Rate', 1), th('Commission', 1), th('× Tier', 1), th('Pay', 1))),
        el('tbody', {}, ...ownLines.map(({ l, s }) => el('tr', { class: 'border-t border-' },
          td(el('span', {}, el('span', { class: 'text-muted-' }, '#' + (l.customer_number || '')), ' ', l.customer || '')),
          td(el('span', { style: { fontSize: '12px' } }, saleServiceWithAddOns(s, (typeof nameFromId === 'function' ? nameFromId(state.serviceTypes, s.service_type_id) : '') || s.crm_subscription || '—', saleAddOnsFor(s), { size: '12px', weight: '600' })),
            (l.status === 'below_minimums' ? el('span', { class: 'text-[9px] font-bold ml-1.5', style: { color: '#B45309' } }, 'BELOW MIN · HALF') : null)),
          td(s.sale_kind === 'upsell' ? 'Add on' : l.months > 1 ? l.months + ' mo' : 'One-time'),
          td(fmt.dateShortYear(l.sold_date)),
          td(money(l.revenue), 1),
          td(l.renewal ? 'flat' : l.rate == null ? '—' : (Math.round(l.rate * 10000) / 100) + '%', 1, { color: 'var(--text-muted)' }),
          td(money(l.base), 1),
          td(Math.round((l.tier_mult || 1) * 100) + '%', 1, { color: 'var(--text-muted)' }),
          td(money(l.amount), 1, { fontWeight: '700' }))),
          el('tr', { class: 'border-t', style: { borderColor: 'var(--text)' } }, td('Sales pay', 0, { fontWeight: '700' }), td(''), td(''), td(''), td(money(x.revenue), 1), td(''), td(''), td(''), td(money(x.salesPay), 1, { fontWeight: '800' })),
          ...x.extras.map(([k, v]) => el('tr', { class: 'border-t border-' }, td(k), td(''), td(''), td(''), td(''), td(''), td(''), td(''), td(money(v), 1))),
          el('tr', { style: { background: 'var(--accent)', color: 'var(--accent-text)' } }, td('Total pay', 0, { fontWeight: '800' }), td(''), td(''), td(''), td(''), td(''), td(''), td(''), td(money(x.total), 1, { fontWeight: '800' }))))),
      el('div', { class: 'px-4 py-2 text-[10px] text-muted-' },
        'Commission = revenue × the rep’s rate for that contract (renewals pay the flat renewal amount; Below Minimums pays half), then × the Passed Audit tier for the period. Backend (multi-year / renewal) pays at the backend lock, not on this stub.'));
  };
  let busy = false;
  const confirmBtn = el('button', { class: 'rounded-lg px-4 py-2 text-sm font-bold transition hover:brightness-95', style: { background: 'var(--accent)', color: 'var(--accent-text)' },
    disabled: !sales.length,
    onclick: async () => {
      if (busy || !sales.length) return; busy = true; confirmBtn.textContent = 'Running…';
      try { await confirmPayrollRun(sales, period); close(); } catch (e) { busy = false; confirmBtn.textContent = 'Confirm payroll'; toast(e.message || 'Payroll failed', 'error'); }
    } }, 'Confirm payroll');
  back.append(el('div', { class: 'max-w-5xl mx-auto px-4 sm:px-6 py-6 flex flex-col gap-5' },
    el('div', { class: 'flex items-start justify-between gap-4 flex-wrap' },
      el('div', {}, el('div', { class: 'text-[10px] uppercase tracking-widest font-semibold text-muted-' }, 'Office Staff · upfront payroll'),
        el('h2', { class: 'text-2xl font-black' }, 'Run payroll — ' + period.label),
        el('div', { class: 'text-xs text-muted-' }, stubs.length + ' rep' + (stubs.length === 1 ? '' : 's') + ' · ' + sales.length + ' commissionable account' + (sales.length === 1 ? '' : 's') + ' · ' + money(grand) + ' total')),
      el('div', { class: 'flex items-center gap-2' },
        el('button', { class: 'rounded-lg border px-4 py-2 text-sm font-semibold', style: { borderColor: 'var(--border-2)' }, onclick: close }, 'Cancel'), confirmBtn)),
    held.length ? el('div', { class: 'card px-4 py-2.5 text-xs', style: { borderColor: '#B45309' } }, held.length + ' commissionable sale' + (held.length === 1 ? '' : 's') + ' held: the FieldRoutes seller has no app account yet. They pay on the next run once the account is linked.') : null,
    !stubs.length ? el('div', { class: 'card p-10 text-center text-sm text-muted-' }, 'Nothing commissionable yet — approve sales (Commissionable) on Upfront Sales first.') : null,
    ...stubs.map(stubCard),
    el('div', { class: 'text-[11px] text-muted-' }, 'Confirm stamps these accounts paid for ' + period.label + ' and saves a snapshot of every number above. One-time services then move to History; every other account moves to Pending Backend Lock and locks after 4 paid invoices.')));
  document.body.append(back);
}
async function confirmPayrollRun(sales, period) {
  if (typeof DEMO !== 'undefined' && DEMO) { toast('Demo mode — payroll not written', 'warn'); return; }
  const now = new Date().toISOString();
  // Snapshot first (inputs read the rows before they flip).
  const byRep = new Map(); sales.forEach(s => { if (!byRep.has(s.rep_id)) byRep.set(s.rep_id, []); byRep.get(s.rep_id).push(s); });
  const snaps = [...byRep.entries()].map(([rid, list]) => { const st = payrollRunStub(rid, list, period); return [rid, list,
    { sales_pay: Math.round(st.salesPay * 100) / 100, total: Math.round(st.total * 100) / 100, accounts: list.length, revenue: Math.round(st.revenue * 100) / 100, extras: st.extras },
    isPayInputsSnapshot(rid, st.prof, { lines: st.lines, upfront_pct: st.pct, upfront_mult: st.mult, source: 'sales_tab_run' })]; });
  const ids = sales.map(s => s.id);
  const { error } = await supabase.from('sales').update({ staged_for_payroll: false, payroll_processed_at: now, payroll_period_id: period.id }).in('id', ids);
  if (error) throw error;
  // One-time services have no backend: straight to History. Add-ons and plans wait for 4 paid invoices.
  const oneTime = sales.filter(s => s.sale_kind !== 'upsell' && !(Number(s.contract_months) > 0)).map(s => s.id);
  if (oneTime.length) {
    const { error: e2 } = await supabase.from('sales').update({ lock_status: 'lock', audit_2_at: now, backend_payroll_processed_at: now, backend_payroll_period_id: period.id }).in('id', oneTime);
    if (e2) toast('Paid, but one-time services did not move to History (' + e2.message + ')', 'warn');
  }
  for (const [rid, list, totals, inputs] of snaps) await recordPayRun('upfront', rid, period, list, totals, inputs);
  if (typeof notifyPayrollRun === 'function') notifyPayrollRun(sales, period, 'upfront');
  if (typeof logActivity === 'function') logActivity('payroll_processed', { detail: period.label + ' · ' + sales.length + ' accounts (Sales tab run)' });
  toast('Payroll confirmed — ' + sales.length + ' accounts', 'success');
  await refreshSalesData(); mountApp();
}
