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
function viewSales() {
  const isAdmin = isAdminRole(state.profile?.role);
  // One renderer, three queues: Inside Sales ('sales'), D2D ('d2d_sales'),
  // Technicians ('tech_sales'). Rows carry queue_type from the sync.
  const _queue = SALES_QUEUE_OF_VIEW[state.view] || 'office';
  const _pool = _queue === 'office' ? (isAdmin ? state.allSales : state.mySales)
    : ((state.queueSales && state.queueSales[_queue]) || []).filter(s => isAdmin || s.rep_id === state.profile.id);
  const source  = _pool;
  // The Sales tab is the active queue — anything that still needs admin/auditor
  // attention OR is in flight to payroll. A sale falls off only when payroll
  // is RUN (payroll_processed_at set) AND the backend lock is decided
  // (lock_status set to lock or chargeback). At that point it lives in History.
  // Cancelled / Reschedule / Not Payable are terminal — they go straight to
  // History too (Cancelled is reinstateable from there).
  const ACTIVE_QUEUE = new Set(['pending', 'serviced', 'below_minimums', 'nsf']);
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
  const isUpfrontPending = (s) =>
    s.audit_status === 'pending' && lockOf(s) === 'pending' && !s.payroll_processed_at;
  // Pending Backend Lock includes:
  //   (a) audited sales still awaiting a Lock/Chargeback decision, AND
  //   (b) sales already marked Lock or Chargeback that haven't yet had
  //       backend payroll run on them. Marking Lock doesn't bounce the row
  //       off this tab — backend payroll does. The Lock dropdown stays
  //       interactive in case the reviewer needs to flip the decision.
  const isBackendPending = (s) =>
    ACTIVE_QUEUE.has(s.audit_status) &&
    s.audit_status !== 'pending' &&
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
  if (!state._salesSort) state._salesSort = { key: 'created_at', dir: 'desc' };
  const sortKey = state._salesSort.key;
  // Pending audit queue works OLDEST-FIRST by default (a pipeline, not a
  // feed) — until the user clicks a column, which takes over as usual.
  const sortDir = (queueFilter === 'upfront' && !state._salesSortTouched && sortKey === 'created_at') ? 'asc' : state._salesSort.dir;
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
      case 'commission_date': return s.commission_date || '';
      case 'audit_status':    return s.audit_status || '';
      case 'audited_by':      return (state.allProfiles.find(p => p.id === s.audited_by)?.full_name || '').toLowerCase();
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
    return 0;
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
      ...['pending','serviced','below_minimums','cancelled','nsf','not_payable','reschedule'].map(s =>
        el('option', { value: s, selected: sf.status === s }, s.replace('_',' '))),
    ),
    isAdmin && el('select', {
      class: 'rounded-xl px-2.5 py-1 text-[11px] font-medium cursor-pointer',
      style: { maxWidth: '140px' },
      onchange: e => { sf.repId = e.target.value; mountApp(); },
    },
      el('option', { value: '', selected: !sf.repId }, 'All reps'),
      ...(state.allProfiles||[]).map(p => el('option', { value: p.id, selected: sf.repId === p.id }, p.full_name)),
    ),
    el('select', {
      class: 'rounded-xl px-2.5 py-1 text-[11px] font-medium cursor-pointer',
      style: { maxWidth: '160px' },
      onchange: e => { sf.sourceId = e.target.value; mountApp(); },
    },
      el('option', { value: '', selected: !sf.sourceId }, 'All sources'),
      ...(state.sources||[]).map(src => el('option', { value: src.id, selected: String(sf.sourceId) === String(src.id) }, src.name)),
    ),
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
  const _tile = (label, list, accent) => el('div', { class: 'flex-1 min-w-0 px-3 py-2 text-center', style: { borderLeft: '1px solid var(--border)' } },
    el('div', { class: 'text-[9px] uppercase tracking-widest font-semibold', style: { color: 'var(--text-subtle)' } }, label),
    el('div', { class: 'text-base font-black tabular-nums', style: accent ? { color: 'var(--accent)' } : {} }, fmt.usd0(_sumRev(list))),
    el('div', { class: 'text-[10px] tabular-nums text-muted-' }, list.length.toLocaleString() + ' sale' + (list.length === 1 ? '' : 's')));
  const totalsStrip = isAdmin ? el('div', { class: 'card flex items-stretch overflow-x-auto' },
    _tile(_yr + ' sold', _ytd, true),
    _tile('Upfront', source.filter(isUpfrontPending)),
    _tile('Backend lock', source.filter(isBackendPending)),
    _tile('Archived', source.filter(isCancelled)),
    _tile('History', source.filter(isHistory))) : null;
  const queueRow = el('div', { class: 'flex flex-col gap-3' }, totalsStrip, el('div', { class: 'flex items-center justify-between gap-3 flex-wrap' }, queueToggle));
  const filterBar = queueFilter !== 'history'
    ? el('div', { class: 'flex flex-wrap gap-2 items-center' }, ...filterControls())
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
            : 'Nothing pending. Log a sale from the Dashboard.')
      : el('div', {},
          // Mobile: card list (hidden on sm+). Tapping a card opens the same
          // edit modal as clicking a desktop row, so the rep can fix details
          // or admins can audit on a phone without horizontal-scrolling a
          // 13-column table.
          salesCardsMobile(filtered, { isAdmin, queueFilter }),
          el('div', { class: 'hidden sm:block' },
            salesTable(filtered, { isAdmin, sortKey, sortDir,
              // Pending Backend Lock surfaces the second-pass review controls
              // (Audit 2 + Lock dropdown) plus any enriched columns from an
              // uploaded backend report so admins can decide row-by-row.
              showBackend: queueFilter === 'backend',
              // Pending queue (admins): live CRM account columns — status,
              // current sub, balance, aging, services done — so the backend
              // picture is visible while the sale is still upfront-pending.
              showCrmAccount: isAdmin && queueFilter === 'upfront',
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
  const row = (g) => el('div', {
    class: 'flex items-center justify-between gap-3 px-4 py-2 border-t flex-wrap',
    style: { borderColor: 'var(--border)', opacity: '.62' },
    title: 'In FieldRoutes this subscription is sold by ' + (repName(g.rep_id) || 'this rep') + ' with a signed agreement, but it was never logged here.',
  },
    el('div', { class: 'flex items-center gap-3 min-w-0 flex-wrap' },
      el('span', { class: 'text-[11px]' }, '\ud83d\udc7b'),
      el('span', { class: 'font-semibold text-sm truncate' }, g.customer_name || ('Customer ' + g.customer_number)),
      el('span', { class: 'text-[11px] text-muted- tabular-nums' }, '#' + g.customer_number),
      isAdmin ? el('span', { class: 'text-[11px] font-semibold' }, repName(g.rep_id)) : null,
      el('span', { class: 'text-[11px] text-muted-' }, g.crm_subscription + ' \u00b7 ' + (g.contract_months || 12) + ' mo' + (g.subscription_source ? ' \u00b7 ' + g.subscription_source : '')),
      el('span', { class: 'text-[11px] text-muted- tabular-nums' }, 'sold ' + g.sold_date + (g.contract_signed_at ? ' \u00b7 signed ' + g.contract_signed_at : '')),
      el('span', { class: 'text-sm font-bold tabular-nums' }, fmt.usd(g.revenue_amount || 0)),
    ),
    el('div', { class: 'flex items-center gap-2 shrink-0' },
      el('button', {
        class: 'rounded-lg px-2.5 py-1 text-[11px] font-bold transition hover:brightness-95',
        style: { background: 'var(--accent)', color: 'var(--accent-text)' },
        onclick: () => claim(g),
      }, 'Claim'),
      el('button', {
        class: 'rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition hover:brightness-95',
        style: { borderColor: 'var(--border-2)', color: 'var(--text-muted)' },
        onclick: () => { if (confirm('Mark this subscription as not yours? It will leave your board.')) resolve(g, 'dismissed'); },
      }, 'Not mine'),
    ),
  );
  return el('div', { class: 'card overflow-hidden mb-4' },
    el('div', { class: 'flex items-center justify-between gap-3 px-4 py-2.5' },
      el('div', { class: 'flex items-center gap-2' },
        el('span', { class: 'font-bold text-sm' }, 'Unlogged sales'),
        el('span', { class: 'text-[11px] text-muted-' }, mine.length + ' in FieldRoutes under ' + (isAdmin ? 'reps\u2019 names' : 'your name') + ', signed, not logged here')),
      el('span', { class: 'text-[10px] text-muted-' }, 'Claim to log it and start the audit \u00b7 Not mine to dismiss')),
    ...mine.map(row));
}

// Mobile-only card list. Mirrors salesTable for phones: each sale is a tap-
// target that opens the same edit modal as a desktop row. Admins also get the
// status + auditor dropdowns inline so they can audit on a phone. We keep this
// deliberately spare — no sort headers, no filter chips, no horizontal scroll.
function salesCardsMobile(rows, { isAdmin = false, queueFilter = 'upfront' } = {}) {
  return el('div', { class: 'flex flex-col gap-2 sm:hidden' },
    ...rows.map(s => {
      const rep = state.allProfiles.find(p => p.id === s.rep_id) || state.profile;
      const repFirst = (rep?.full_name || '').split(' ')[0];
      const ctName = contractTypeLabelForSale(s);
      const noteTxt = s.notes || '';
      const rptM = (queueFilter === 'backend' && (state.reportingSubscriptions || []).length)
        ? reportingBackendMatch(s.customer_number)
        : null;
      return el('div', {
        class: 'card p-4 transition active:brightness-95',
        onclick: (e) => {
          if (e.target.closest('select, button, input, textarea, a')) return;
          openNewSaleModal(null, s);
        },
      },
        // Top row: customer + status chip
        el('div', { class: 'flex items-start justify-between gap-3 mb-1' },
          el('div', { class: 'min-w-0 flex-1' },
            el('div', { class: 'font-semibold text-sm truncate', title: s.customer_name }, s.customer_name),
            el('div', { class: 'text-[11px] text-muted- mt-0.5' },
              [
                s.customer_number ? '#' + s.customer_number : null,
                fmt.dateShort(s.sold_date),
              ].filter(Boolean).join(' · '),
            ),
          ),
          statusChip(s.audit_status),
        ),
        // Middle row: rep (admin only) · contract · revenue
        el('div', { class: 'flex items-center justify-between gap-3 mt-2 text-[12px]' },
          el('div', { class: 'flex items-center gap-2 min-w-0' },
            isAdmin && avatarNode(rep?.avatar_url, rep?.initials, 'w-5 h-5 text-[8px]'),
            isAdmin && el('span', { class: 'text-[11px] font-medium truncate' }, repFirst),
            el('span', { class: 'text-muted- whitespace-nowrap' }, ctName),
          ),
          el('span', { class: 'tabular-nums font-bold whitespace-nowrap' }, fmt.usd(s.revenue_amount)),
        ),
        // Backend queue: live account state cross-referenced from the snapshot.
        (queueFilter === 'backend' && (state.reportingSubscriptions || []).length) && el('div', {
          class: 'flex items-center gap-2 mt-2 text-[11px] flex-wrap',
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
          class: 'mt-2 text-[11px] italic text-muted- line-clamp-2',
          style: { display: '-webkit-box', WebkitLineClamp: '2', WebkitBoxOrient: 'vertical', overflow: 'hidden' },
        }, noteTxt),
        // Admin-only inline audit controls. On Backend Lock queue, surface the
        // second-pass dropdowns instead so the reviewer can decide right here.
        isAdmin && el('div', { class: 'flex items-center gap-2 mt-3 flex-wrap' },
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
    const baseClass = (align === 'right' ? 'text-right' : 'text-left') + ' px-2 py-2 font-semibold whitespace-nowrap ' + extraClass;
    if (!sortableKey || !onSort) {
      return el('th', { class: baseClass }, label + arrow);
    }
    return el('th', {
      class: baseClass + ' cursor-pointer select-none hover:text-default transition',
      style: hlStyle,
      onclick: () => onSort(sortableKey),
    }, label + arrow);
  };

  return el('div', { class: 'card overflow-hidden' },
    el('div', { class: 'scroll-x' },
      el('table', { class: 'w-full text-[12px]' },
        el('thead', { class: 'text-[9px] uppercase tracking-wider text-muted- bg-card2-' },
          el('tr', {},
            headerCell('Customer',    { sortableKey: 'customer_name', extraClass: 'pl-4' }),
            headerCell('Cust #',      { sortableKey: 'customer_number' }),
            headerCell('Sold by', { sortableKey: 'rep' }),
            // Backend-lock review doesn't need office / service / source /
            // initial / monthly — the reviewer keys off revenue + contract +
            // the report data. Hiding those keeps the table scannable.
            !showBackend && headerCell('Office',      { sortableKey: 'office' }),
            !showBackend && headerCell('Service Type',{ sortableKey: 'service_type' }),
            headerCell('Contract',    { sortableKey: 'contract' }),
            !showBackend && headerCell('Source',      { sortableKey: 'source' }),
            !showBackend && headerCell('Initial',     { sortableKey: 'initial_amount', align: 'right' }),
            !showBackend && headerCell('Monthly',     { sortableKey: 'monthly_amount', align: 'right' }),
            headerCell('Revenue',     { sortableKey: 'revenue_amount', align: 'right' }),
            // CRM revenue check — auto-verified against the FieldRoutes
            // warehouse every 30 min (matched by customer #). Reps see it on
            // their own sales: "did my sale really go through?" answered.
            headerCell('CRM ✓'),
            headerCell('Sold',        { sortableKey: 'sold_date' }),
            headerCell('Commissionable', { sortableKey: 'commission_date' }),
            headerCell('Status',      { sortableKey: 'audit_status' }),
            headerCell('Audit',       { sortableKey: 'audited_by' }),
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
            const rep = state.allProfiles.find(p => p.id === s.rep_id) || state.profile;
            const first = (rep?.full_name || '').split(' ')[0];
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
              !showBackend && cell(el('span', { class: 'text-muted- max-w-[140px] truncate inline-block align-bottom', title: nameFromId(state.serviceTypes, s.service_type_id) }, nameFromId(state.serviceTypes, s.service_type_id))),
              cell(el('span', { class: 'text-muted- whitespace-nowrap' }, ctName)),
              !showBackend && cell(el('span', { class: 'text-muted- whitespace-nowrap max-w-[110px] truncate inline-block align-bottom', title: nameFromId(state.sources, s.source_id) }, nameFromId(state.sources, s.source_id))),
              !showBackend && el('td', { class: 'px-2 py-2 text-right tabular-nums whitespace-nowrap' }, fmt.usd(s.initial_amount)),
              !showBackend && el('td', { class: 'px-2 py-2 text-right tabular-nums whitespace-nowrap text-muted-' }, fmt.usd(s.monthly_amount)),
              el('td', { class: 'px-2 py-2 text-right tabular-nums font-semibold whitespace-nowrap' }, fmt.usd(s.revenue_amount)),
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
                if (s.sale_kind === 'upsell') lcChips.push(chip('＋ Upsell', 'rgba(168,85,247,.14)', '#7C3AED', 'Add-on' + (s.crm_ticket_id ? ' · FieldRoutes ticket #' + s.crm_ticket_id : '') + (s.parent_subscription_id ? ' on subscription ' + s.parent_subscription_id : '')));
                // Eligibility (per Isaac): appointment + billing stamped by the
                // sync (20260916_sales_eligibility.sql). Every subscription is
                // logged; these show which can earn a payout.
                if (s.crm_initial_status != null) {
                  const st = String(s.crm_initial_status || '').toLowerCase();
                  const ok = st === 'pending' || st === 'completed';
                  lcChips.push(ok ? chip('✓ Appt', 'rgba(223,100,58,.15)', '#DF643A', 'Initial appointment ' + st)
                                  : chip('✗ No appt', 'rgba(220,38,38,.12)', '#B91C1C', 'No initial appointment on the books (' + (s.crm_initial_status || 'none') + ')'));
                }
                if (s.crm_autopay != null) {
                  lcChips.push(s.crm_autopay ? chip('✓ Billing', 'rgba(223,100,58,.15)', '#DF643A', 'Autopay on file in FieldRoutes')
                                             : chip('✗ No billing', 'rgba(220,38,38,.12)', '#B91C1C', 'No autopay on file — not commission-eligible until billing is added'));
                }
                if (s.crm_serviced_at) lcChips.push(chip('✓ Svc', 'rgba(223,100,58,.15)', '#DF643A',
                  'Initial service completed ' + s.crm_serviced_at + (s.crm_completed_services ? ' · ' + s.crm_completed_services + ' service(s) run' : '')));
                else if (s.crm_checked_at && s.crm_serviced_at === null && s.crm_completed_services === 0) lcChips.push(chip('⏳ Svc', 'var(--card-2)', 'var(--text-muted)', 'No initial service completed yet'));
                // Signed agreement (per Isaac) — stamped by the sync from the
                // FieldRoutes e-sign documents (sales_crm_agreement.sql).
                if (s.crm_contract_state === 'signed') lcChips.push(chip('✓ Signed', 'rgba(223,100,58,.15)', '#DF643A',
                  'Agreement e-signed' + (s.crm_contract_signed_at ? ' ' + s.crm_contract_signed_at : '')));
                else if (s.crm_contract_state === 'sent') lcChips.push(chip('✉ Sent', 'rgba(245,158,11,.14)', '#B45309',
                  'Agreement sent for e-signature but not signed yet'));
                else if (s.crm_contract_state === 'none' && s.crm_checked_at) lcChips.push(chip('✗ No agreement', 'rgba(220,38,38,.12)', '#B91C1C',
                  'No e-sign document on this subscription or customer in FieldRoutes'));
                if (s.crm_days_past_due != null) {
                  lcChips.push(Number(s.crm_days_past_due) > 0
                    ? chip('⚠ ' + s.crm_days_past_due + 'd', 'rgba(220,38,38,.12)', '#B91C1C', 'Customer is ' + s.crm_days_past_due + ' day(s) past due' + (s.crm_balance != null ? ' · balance ' + fmt.usd(s.crm_balance) : ''))
                    : chip('✓ Paid', 'rgba(223,100,58,.15)', '#DF643A', 'Account is current' + (s.crm_balance != null ? ' · balance ' + fmt.usd(s.crm_balance) : '')));
                }
                // $2k+ annualized value → auditor must confirm whether the
                // property is commercial (commercial pays the half rate —
                // mark it via Edit → Commercial). Clears once marked.
                (() => {
                  const _m = Number(s.contract_months) || 12;
                  const _annual = _m > 12 ? (Number(s.revenue_amount) || 0) * 12 / _m : (Number(s.revenue_amount) || 0);
                  if (_annual > 2000 && !s.is_commercial) lcChips.push(chip('⚑ Comm?', 'rgba(168,85,247,.14)', '#7C3AED',
                    'Annualized value ' + fmt.usd(_annual) + ' is over $2,000 — confirm whether this is a commercial property. Commercial pays the commercial (half) rate; mark it via Edit → Commercial.'));
                })();
                // Sentricon is ALWAYS a 12-month program — any other length
                // on the account is a data error (usually a blank agreement
                // length in FieldRoutes). Flag until the contract reads 12.
                (() => {
                  const _svc = String(s.crm_subscription || nameFromId(state.serviceTypes, s.service_type_id) || '');
                  if (/sentricon/i.test(_svc) && Number(s.contract_months) !== 12) {
                    lcChips.push(chip('⚑ Sentricon ≠ 12mo', 'rgba(245,158,11,.14)', '#B45309',
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
                  if (_ageD >= 3) lcChips.push(chip('⏱ ' + _ageD + 'd', _ageD >= 10 ? 'rgba(220,38,38,.12)' : 'rgba(245,158,11,.14)', _ageD >= 10 ? '#B91C1C' : '#B45309',
                    'Waiting on audit for ' + _ageD + ' days'));
                }
                const withLc = (node) => lcChips.length ? el('span', { class: 'inline-flex items-center gap-1 flex-wrap' }, node, ...lcChips) : node;
                if (v.status === 'verified') {
                  return withLc(chip('✓ ' + fmt.usd(v.cv), 'rgba(223,100,58,.15)', '#DF643A',
                    'EXACT CRM match — the warehouse shows this precise contract value on customer #' + (s.customer_number || '?')
                    + (v.sub ? ' (' + v.sub + ')' : '') + (v.live ? ' · live check' : '')));
                }
                if (v.status === 'near_match') {
                  const d = Math.abs((Number(s.revenue_amount) || 0) - (Number(v.cv) || 0));
                  return withLc(chip('≈ ' + fmt.usd(v.cv), 'rgba(240,172,30,.16)', '#B45309',
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
                    title: 'The CRM auto-check runs every ~30 minutes — this sale hasn\'t been checked yet.' }, '… checking');
                }
                return el('span', { style: { color: 'var(--text-subtle)' }, class: 'text-[10px]',
                  title: 'Customer #' + (s.customer_number || '?') + ' isn\'t in the warehouse yet — new accounts appear within ~30 min of the CRM sync.' },
                  'not in CRM yet');
              })()),
              cell(el('span', { class: 'text-muted- tabular-nums whitespace-nowrap' }, fmt.dateShortYear(s.sold_date))),
              cell(el('span', { class: 'text-muted- tabular-nums whitespace-nowrap' }, s.commission_date ? fmt.dateShortYear(s.commission_date) : '—')),
              cell(statusSelect(s.id)),
              el('td', { class: 'px-2 py-2 whitespace-nowrap' }, auditorSelect(s.id)),
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
    el('option', { value: 'pending',         selected: current === 'pending' },         'Pending'),
    el('option', { value: 'serviced',        selected: current === 'serviced' },        'Serviced'),
    el('option', { value: 'below_minimums',  selected: current === 'below_minimums' },  'Below Minimums'),
    el('option', { value: 'cancelled',       selected: current === 'cancelled' },       'Cancelled'),
    el('option', { value: 'nsf',             selected: current === 'nsf' },             'NSF'),
    el('option', { value: 'not_payable',     selected: current === 'not_payable' },     'Not Payable'),
    el('option', { value: 'reschedule',      selected: current === 'reschedule' },      'Reschedule'),
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
  { id: 'pending',    label: 'Pending',    bg: 'rgba(117,118,103,.18)', fg: 'var(--text-muted)' },
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
      el('button', { class: 'text-2xl text-muted-', onclick: () => overlay.remove() }, '×'),
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
      checkboxCard('Charged Upfront', 'Payment collected at signing — feeds the Charge Upfront % tier on the Pay tab (70%+ collected pays 100% of commission; lower tiers pay 95 / 90 / 85%).', (v) => { modalState.upfront_collected = v; updateFooter(); }, modalState.upfront_collected),
    ),

    mk('Notes',
      el('textarea', { name: 'notes', class: 'w-full rounded-lg border px-3 py-2.5 text-sm', rows: 2, placeholder: 'Optional...' }),
      { fullWidth: true },
    ),

    addAnotherToggle,
  );

  // ── FOOTER (sticky dark bar with live ACV + Projected Commission) ──
  const footerRep   = el('div', { class: 'text-base font-bold text-smoke' }, '—');
  const footerAcv   = el('div', { class: 'text-lg font-bold text-smoke tabular-nums' }, '$0.00');
  const footerComm  = el('div', { class: 'text-lg font-bold text-smoke tabular-nums' }, '$0.00');
  const footerStatus= el('div', { class: 'text-base font-bold text-smoke' }, 'Pending');
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

