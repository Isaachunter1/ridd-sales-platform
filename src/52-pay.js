// ┌─ src/52-pay.js ─────────────────────────────────────────────────────
// │ Inside Sales Pay tab (upfront + backend payroll runs).
// │ Part of the app.js bundle (tools/bundle.js concatenates src/*.js in name order).
// └────────────────────────────────────────────────────────────────────────
// ──────────────────────────────────────────────────────────────────────────
// VIEW: PAY — biweekly pay stub + commissionable accounts table
// ──────────────────────────────────────────────────────────────────────────
function viewPay() {
  const today = new Date();
  if (state.payYear == null) state.payYear = today.getFullYear();
  if (state.payPeriodId == null) state.payPeriodId = currentPayPeriodId(state.payYear);

  const years = [];
  for (let y = today.getFullYear() - 2; y <= today.getFullYear() + 1; y++) years.push(y);

  const periods = getPayPeriods(state.payYear);
  const period  = periods.find(p => p.id === state.payPeriodId) || periods[0];
  const nowPid  = currentPayPeriodId(today.getFullYear());

  const isAdmin = isAdminRole(state.profile?.role);
  // Admins can spot-check any rep's pay stub without logging in as them.
  // `state.payViewRepId` is the override; default is self. Non-admins are
  // always pinned to themselves.
  const profilesForPicker = (state.allProfiles || []).filter(p =>
    p.is_active !== false && p.role !== 'auditor'
  );
  const viewedProfile = (isAdmin && state.payViewRepId)
    ? (profilesForPicker.find(p => p.id === state.payViewRepId) || state.profile)
    : state.profile;
  const repId = viewedProfile.id;

  // Scope sales to this rep and this period (by sold_date)
  const inPeriod = (s) => {
    const d = new Date(s.sold_date + 'T00:00');
    return d >= period.start && d <= period.end && s.rep_id === repId;
  };
  const periodSales = (isAdmin ? state.allSales : state.mySales).filter(inPeriod);

  // Buckets
  // "Pending Audit" surfaces every sale that still needs admin/auditor
  // attention before it can pay out: status=pending OR (status set to a
  // payroll-eligible state but not yet staged because no auditor was
  // assigned). In the new flow a sale only stages when both Status AND
  // Auditor are set, so unstaged serviced/below_min lives here.
  const pending = periodSales.filter(s =>
    s.audit_status === 'pending' ||
    ((s.audit_status === 'serviced' || s.audit_status === 'below_minimums') && !s.staged_for_payroll));
  const servicedStaged= periodSales.filter(s => s.audit_status === 'serviced'       && s.staged_for_payroll);
  const belowStaged   = periodSales.filter(s => s.audit_status === 'below_minimums' && s.staged_for_payroll);

  const sumRev = (arr) => arr.reduce((a, s) => a + Number(s.revenue_amount || 0), 0);
  const pendingRev   = sumRev(pending);
  const servicedRev  = sumRev(servicedStaged);
  const belowRev     = sumRev(belowStaged);

  // Per-sale commission via getCommissionAmount (source-aware):
  // standard sources pay revenue × rate, renewal sources pay flat $/account.
  // Serviced = full, Below Min = halved (configurable in Pricing).
  ensurePaySettings();
  const sumCommission = (arr) => arr.reduce((a, s) => a + getCommissionAmount(repId, s), 0);
  const pendingPay = pending.reduce((a, s) => {
    // Estimate pending at the serviced rate (optimistic)
    const estSale = { ...s, audit_status: 'serviced' };
    return a + getCommissionAmount(repId, estSale);
  }, 0);
  // Charge-upfront tier (sheet O29-O31): the share of this period's staged
  // accounts where payment was collected upfront sets a multiplier on the
  // WHOLE upfront commission (100 / 95 / 90 / 85%).
  const upfrontPct  = upfrontCollectedPct([...servicedStaged, ...belowStaged]);
  const upfrontMult = upfrontTierPayPct(upfrontPct);
  const salesPay   = sumCommission(servicedStaged) * upfrontMult;  // full commission × upfront tier
  const belowPay   = sumCommission(belowStaged) * upfrontMult;     // half commission × upfront tier

  // Close rate bonus (sheet O17): tiered — ≥60% pays 3% of subscription
  // revenue, ≥50% pays 2%, below that $0. Subscription revenue = serviced
  // 12/18/24/PIF revenue from standard sources (no commercial/OTS/upsells/
  // renewals). Close rate itself is manually maintained per rep.
  const closeRate = Number(viewedProfile.close_rate_target ?? 0.50);
  const periodSubscriptionRev = subscriptionRevenueOf(servicedStaged);
  const closeRateBonus = closeRateBonusFor(closeRate, periodSubscriptionRev);
  const meetsCloseRate = closeRateBonus > 0;

  // Backend bonus per sale (sheet O16/O18): 18mo ×2%, 24mo ×3%, renewal
  // sources ×2% of serviced revenue. The same sale earns this once (when
  // payroll runs); Pending Backend is the running tally of backend $$ still
  // in flight: (a) accounts already paid out where the backend audit hasn't
  // confirmed the lock yet, and (b) staged backend-eligible accounts in the
  // current period that are about to be paid.
  const isMultiYear = (s) => [18, 24].includes(Number(s.contract_months));
  const hasBackend  = (s) => getBackendAmount(s) > 0;
  const multiYearBonus = servicedStaged
    .filter(s => isMultiYear(s) && !isRenewalSource(s))
    .reduce((a, s) => a + getBackendAmount(s), 0);
  const renewalPayPeriod = servicedStaged
    .filter(s => isRenewalSource(s))
    .reduce((a, s) => a + getBackendAmount(s), 0);

  const aboutToRunBackendSales = [...servicedStaged, ...belowStaged].filter(hasBackend);
  const aboutToRunBackend = aboutToRunBackendSales.reduce((a, s) => a + getBackendAmount(s), 0);
  // Pending backend audit — backend-eligible sales already paid out in prior
  // payroll runs whose backend lock-in is still in review. Tracked via
  // backend_audited_at (nullable). Without that field set, we treat every
  // processed backend-eligible sale as still-pending-audit until confirmed.
  const allRepSales = (isAdmin ? state.allSales : state.mySales).filter(s => s.rep_id === repId);
  const pendingBackendAuditSales = allRepSales.filter(s =>
    hasBackend(s) && (s.audit_status === 'serviced' || s.audit_status === 'below_minimums') && s.payroll_processed_at && !s.backend_audited_at
  );
  const pendingBackendAudit = pendingBackendAuditSales.reduce((a, s) => a + getBackendAmount(s), 0);
  const pendingBackend = aboutToRunBackend + pendingBackendAudit;
  // ── Numbers driven by the two pay-stub templates ──
  // The Pay Period stub pays the regular biweekly commission. The Backend
  // stub adds backend pay (multi-year, close rate, renewal) plus quota /
  // golden phone / loyalty bonuses, and is delivered at quarter-end on top
  // of that period's regular stub. Lines we don't yet have data for render
  // at $0.00 — a placeholder until the source field exists.
  const periodTotalRevenue = sumRev(periodSales);
  // Quarterly Revenue uses the calendar quarter that contains period.start.
  const qStart = new Date(period.start.getFullYear(), Math.floor(period.start.getMonth() / 3) * 3, 1);
  const qEnd = new Date(period.start.getFullYear(), Math.floor(period.start.getMonth() / 3) * 3 + 3, 0, 23, 59, 59);
  const inQuarter = (s) => {
    const d = new Date(s.sold_date + 'T00:00');
    return d >= qStart && d <= qEnd && s.rep_id === repId;
  };
  const quarterSales = (isAdmin ? state.allSales : state.mySales).filter(inQuarter);
  const quarterRevenue = sumRev(quarterSales);
  // Renewal pay (sheet O18) — renewal-source serviced revenue × the
  // renewal backend rate. Multi-year and close-rate bonuses are computed
  // above; the three together make this period's backend contribution.
  const renewalPay = renewalPayPeriod;

  const payPeriodBackendPay = multiYearBonus + closeRateBonus + renewalPay;

  // Quarter Running counterparts — same three metrics computed across every
  // serviced sale in the calendar quarter so the rep can see cumulative-to-
  // date next to this period's contribution. Backend only accrues on
  // serviced accounts (sheet sums the Serviced block only).
  const quarterEligible = quarterSales.filter(s => s.audit_status === 'serviced' || s.audit_status === 'below_minimums');
  const quarterServiced = quarterSales.filter(s => s.audit_status === 'serviced');
  const multiYearBonusQuarter = quarterServiced.filter(s => isMultiYear(s) && !isRenewalSource(s)).reduce((a, s) => a + getBackendAmount(s), 0);
  const closeRateBonusQuarter = closeRateBonusFor(closeRate, subscriptionRevenueOf(quarterServiced));
  const renewalPayQuarter     = quarterServiced.filter(s => isRenewalSource(s)).reduce((a, s) => a + getBackendAmount(s), 0);
  const quarterlyBackendPay   = multiYearBonusQuarter + closeRateBonusQuarter + renewalPayQuarter;

  const pendingBackendRevenue = sumRev(pendingBackendAuditSales);

  // ── Rep-type-aware Upfront Pay ──
  // Sales reps see Sales Pay + Golden Phone + Other Pay.
  // Loyalty reps see Sales Pay + Loyalty Pay + Loyalty Royalty + Other Pay.
  // The four manual additives are set by admin in Users settings; default 0.
  // All five fields come from viewedProfile so admins can spot-check any rep.
  const repType            = viewedProfile.rep_type || 'sales_rep';
  const isLoyaltyRep       = repType === 'loyalty_rep';
  const goldenPhoneAmt     = Number(viewedProfile.golden_phone_amount    || 0);
  const loyaltyRoyaltyAmt  = Number(viewedProfile.loyalty_royalty_amount || 0);
  const loyaltyPayAmt      = Number(viewedProfile.loyalty_pay_amount     || 0);
  // Other Pay = this period's hand-entered lines (bonuses, comps…) — see
  // addPayAdjustment. The old static profile amount is folded in only if
  // someone still has one set, so nothing silently disappears.
  const periodAdjustments  = (state.payAdjustments || []).filter(a => a.rep_id === repId && Number(a.period_year) === Number(state.payYear) && Number(a.period_id) === Number(period.id));
  const otherPayAmt        = periodAdjustments.reduce((a, x) => a + Number(x.amount || 0), 0) + Number(viewedProfile.other_pay_amount || 0);
  const upfrontSalesPay    = salesPay + belowPay;
  const upfrontTotal       = upfrontSalesPay
    + (isLoyaltyRep ? loyaltyPayAmt : 0)
    + (isLoyaltyRep ? loyaltyRoyaltyAmt : goldenPhoneAmt)
    + otherPayAmt;

  // Commissionable accounts = staged sales (serviced or below min)
  const commissionable = [...servicedStaged, ...belowStaged];

  // ── Stub data: extra metrics ──
  // Admin-set per-rep bonuses paid at quarter end. Profile fields don't
  // exist in the DB schema yet — they render as $0 until populated.
  const quotaPayAmt      = Number(viewedProfile.quota_amount || 0);
  const revhawkPayAmt    = Number(viewedProfile.revhawk_pay_amount || 0);
  // Subscription Revenue: loyalty reps only — total recurring/subscription
  // revenue. Manual field for now; placeholder $0.
  const subscriptionRevenue = Number(viewedProfile.subscription_revenue || 0);
  // Eligible Revenue: quarter's staged sales revenue (eligible for backend payout).
  const eligibleRevenue = quarterEligible.reduce((a, s) => a + Number(s.revenue_amount || 0), 0);
  // Post-Service Cancels: quarter's cancelled sales that had previously been
  // staged for payroll (paid out then clawed back).
  const postServiceCancels = quarterSales
    .filter(s => s.audit_status === 'cancelled' && s.staged_at)
    .reduce((a, s) => a + Number(s.revenue_amount || 0), 0);

  // Pay-period total — labels and components differ by rep type. Sales reps
  // just see Sales Pay + Golden Phone. Loyalty reps see Sales Pay + Loyalty
  // Royalty + Revhawk + Loyalty Pay every period (Loyalty Pay still also
  // accrues to the Backend stub at quarter end).
  const periodicalBonusLabel = isLoyaltyRep ? 'Loyalty Royalty' : 'Golden Phone';
  const periodicalBonus      = isLoyaltyRep ? loyaltyRoyaltyAmt  : goldenPhoneAmt;
  const totalPayPayPeriod    = isLoyaltyRep
    ? upfrontSalesPay + loyaltyRoyaltyAmt + revhawkPayAmt + loyaltyPayAmt
    : upfrontSalesPay + goldenPhoneAmt;
  // Backend total = pay-period total + quarterly backend pay + quota +
  // loyalty bonus (both rep types get Loyalty Pay in Backend mode).
  const totalPayBackend = isLoyaltyRep
    ? upfrontSalesPay + loyaltyRoyaltyAmt + quarterlyBackendPay + quotaPayAmt + loyaltyPayAmt
    : upfrontSalesPay + goldenPhoneAmt    + quarterlyBackendPay + quotaPayAmt + loyaltyPayAmt;

  // ── Layout (per Isaac's pay-tab sheet, Sep 2026): three stacked blocks —
  // PAY STUB (this period's upfront), BACKEND PAY (the quarter's backend),
  // METRICS (the rates that drove the math). Same rows, app styling.
  const s = ensurePaySettings();
  const BASE_PCT = Number(viewedProfile.upfront_commission_rate || 0.07) * 100;
  const ctRate = (re) => { const cc = (s.contract_commissions || []).find(c => re.test(String(c.name || ''))); return cc ? Number(cc.rate) : null; };
  const upsellRate = ctRate(/^upsell/i), otsRate = ctRate(/one time/i);
  const commercialRate = BASE_PCT * (Number(s.commercial_multiplier ?? 50) / 100);
  const tierLabel = (() => {
    if (upfrontPct == null) return '—';
    const tiers = (s.upfront_tiers || []).slice().sort((a, b) => Number(b.min) - Number(a.min));
    for (const t of tiers) if (upfrontPct * 100 >= Number(t.min)) return Number(t.min) > 0 ? Number(t.min) + '% +' : '< ' + (tiers[tiers.length - 2] ? Number(tiers[tiers.length - 2].min) : 35) + '%';
    return '—';
  })();
  const hasSub = (x) => { const m = Number(x.contract_months); return !!x.paid_in_full || m === 12 || m === 18 || m === 24; };
  const eligibleBackendRevPeriod = servicedStaged.filter(x => hasBackend(x) || (!isRenewalSource(x) && hasSub(x))).reduce((a, x) => a + Number(x.revenue_amount || 0), 0);
  const otherPayTotal = upfrontTotal - upfrontSalesPay;
  // Cancels clawback: quarter sales cancelled after they'd been paid out —
  // the commission that was paid comes back off the backend stub.
  const cancelsClawback = quarterSales
    .filter(x => x.audit_status === 'cancelled' && x.staged_at)
    .reduce((a, x) => a + getCommissionAmount(repId, { ...x, audit_status: 'serviced' }), 0);
  const backendPayNet = quarterlyBackendPay - cancelsClawback;
  const pctS = (v, d = 0) => (v == null || !isFinite(v)) ? '—' : (Number(v).toFixed(d)) + '%';
  const signedPct = (v) => v == null ? '—' : (v > 0 ? '+' : '') + (Math.round(v * 100) / 100) + '%';

  // Stub primitives — bordered stack with dark section headers, matching
  // the sheet's look but on the app's tokens.
  const hdr = (label, right) => el('div', {
    class: 'grid px-3 py-2 text-[10px] font-black uppercase tracking-widest gap-3',
    style: { gridTemplateColumns: '1fr 1fr', background: 'var(--text)', color: 'var(--card)' },
  }, el('span', {}, label), right ? el('span', { class: 'text-left' }, right) : null);
  const tone = (t) => t === 'sand' ? { background: '#9C3F1E', color: '#fff' }
    : t === 'green' ? { background: '#5F6C5B', color: '#fff' }
    : t === 'total' ? { background: 'var(--accent)', color: 'var(--accent-text)' }
    : {};
  const row = (label, value, opts = {}) => el('div', {
    class: 'grid items-center px-3 py-1.5 border-t text-[11px] gap-3',
    style: Object.assign({ gridTemplateColumns: '1fr 1fr', borderColor: 'var(--border)' }, tone(opts.tone)),
  },
    el('span', { class: 'uppercase tracking-wide ' + (opts.tone ? 'font-bold' : 'font-semibold'), style: opts.red ? { color: '#DC2626' } : {} }, label),
    typeof value === 'string' || typeof value === 'number' ? el('span', { class: 'text-left tabular-nums ' + (opts.tone ? 'font-black' : 'font-semibold') }, value) : value);
  const $ = (v) => fmt.usd(v);
  const block = (...kids) => el('div', { class: 'card overflow-hidden' }, ...kids);

  // Agent picker (admins) / name (reps) inside the stub's AGENT row.
  const agentCell = (isAdmin && profilesForPicker.length > 0)
    ? el('select', {
        class: 'rounded-lg border px-2.5 py-1 text-[11px] font-semibold',
        style: { borderColor: 'var(--border-2)', background: 'var(--card)', maxWidth: '180px' },
        onchange: e => { state.payViewRepId = e.target.value === state.profile.id ? null : e.target.value; mountApp(); },
      },
        el('option', { value: state.profile.id, selected: !state.payViewRepId || state.payViewRepId === state.profile.id }, state.profile.full_name + ' (you)'),
        ...profilesForPicker.filter(p => p.id !== state.profile.id).map(p => el('option', { value: p.id, selected: state.payViewRepId === p.id }, p.full_name)))
    : el('span', { class: 'text-left font-semibold' }, viewedProfile.full_name);

  // Close rate is set per rep by an admin in Settings → Users (per Isaac —
  // hand-maintained, never derived). Read-only here.
  const closeRateCell = pctS(closeRate * 100, 2);

  const deptLabel = isLoyaltyRep ? 'LOYALTY' : 'INSIDE SALES';

  return el('div', { class: 'flex flex-col gap-4 w-full' },

    // ─── Toolbar: year + period (left) · admin Run / CSV (right) ───
    el('div', { class: 'flex items-center justify-between gap-3 flex-wrap' },
      el('div', { class: 'flex items-center gap-2 flex-wrap' },
        el('select', {
          class: 'rounded-lg border px-2.5 py-1 text-[11px]',
          onchange: e => { state.payYear = Number(e.target.value); state.payPeriodId = currentPayPeriodId(state.payYear); mountApp(); },
        }, ...years.map(y => el('option', { value: y, selected: y === state.payYear }, y))),
        el('select', {
          class: 'rounded-lg border px-2.5 py-1 text-[11px]',
          onchange: e => { state.payPeriodId = Number(e.target.value); mountApp(); },
        }, ...periods.map(p => el('option', { value: p.id, selected: p.id === state.payPeriodId },
          p.label + (p.id === nowPid && state.payYear === today.getFullYear() ? ' (Current)' : '')))),
      ),
      isAdmin && el('div', { class: 'flex items-center gap-2 flex-wrap' },
        el('button', {
          class: 'px-2.5 py-1 rounded-lg text-[11px] font-bold transition hover:brightness-95',
          style: { background: 'var(--accent)', color: 'var(--accent-text)', opacity: commissionable.length === 0 ? '.45' : '1', cursor: commissionable.length === 0 ? 'not-allowed' : 'pointer' },
          disabled: commissionable.length === 0,
          onclick: () => processPayroll(commissionable, period),
        }, 'Run Pay Period →'),
        el('button', {
          class: 'px-2.5 py-1 rounded-lg text-[11px] font-bold transition hover:brightness-95',
          style: { background: '#5F6C5B', color: '#fff' },
          onclick: () => processBackendPayroll(period, repId),
        }, 'Run Backend →'),
        el('button', {
          class: 'px-2.5 py-1 rounded-lg text-[11px] font-medium border',
          style: { borderColor: 'var(--border-2)', color: 'var(--text-muted)' },
          onclick: () => downloadPayrollCsv(commissionable, period),
        }, '↓ CSV'),
      ),
    ),

    // ─── Layout (per Isaac): left = Pay Stub then Backend Pay; right = By
    // Source (accounts + revenue only) then Metrics. ───
    el('div', { class: 'pay-3col items-start' },
      el('div', { class: 'flex flex-col gap-4' },

      // PAY STUB — this pay period's upfront
      block(
        hdr('Pay Stub', deptLabel),
        row('Agent', agentCell),
        row('Subscriptions', fmt.int(commissionable.length)),
        row('Eligible Backend Revenue', $(eligibleBackendRevPeriod)),
        row('Total Revenue', $(periodTotalRevenue)),
        row('Est. Multi-Year Pay', $(multiYearBonus)),
        row('Est. Close Rate % Pay', $(closeRateBonus)),
        row('Est. Renewal Pay', $(renewalPay)),
        row('Est. Backend Pay', $(payPeriodBackendPay)),
        row('Below Minimums', $(belowPay), { tone: 'sand' }),
        row('Sales Pay', $(salesPay), { tone: 'green' }),
        row('Other Pay', $(otherPayTotal), { tone: 'green' }),
        ...periodAdjustments.map(a => row('   · ' + (a.label || 'Other'), isAdmin
          ? el('span', { class: 'inline-flex items-center gap-2 tabular-nums' }, $(Number(a.amount || 0)),
              el('button', { class: 'text-[10px] font-bold', style: { color: '#B91C1C', background: 'none', border: 'none', cursor: 'pointer' }, title: 'Remove this line', onclick: async () => { if (await removePayAdjustment(a.id)) mountApp(); } }, '✕'))
          : $(Number(a.amount || 0)))),
        isAdmin ? (() => {
          const lab = el('input', { type: 'text', placeholder: 'Bonus, comp winnings…', class: 'rounded-lg border px-2 py-1 text-[11px]', style: { borderColor: 'var(--border-2)', background: 'var(--card)', color: 'var(--text)', width: '150px' } });
          const amt = el('input', { type: 'number', step: '0.01', placeholder: '$', class: 'rounded-lg border px-2 py-1 text-[11px] tabular-nums', style: { borderColor: 'var(--border-2)', background: 'var(--card)', color: 'var(--text)', width: '80px', textAlign: 'right' } });
          const add = async () => { const v = parseFloat(amt.value); if (!isFinite(v) || v === 0) return toast('Enter an amount', 'warn'); if (await addPayAdjustment(repId, state.payYear, period.id, Math.round(v * 100) / 100, lab.value.trim())) { toast('Added to this pay period', 'success'); mountApp(); } };
          amt.addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });
          return el('div', { class: 'flex items-center gap-2 px-3 py-1.5 border-t', style: { borderColor: 'var(--border)' } },
            el('span', { class: 'text-[10px] uppercase tracking-wide font-semibold text-muted-' }, '+ Other pay'), lab, amt,
            el('button', { class: 'px-2 py-1 rounded-lg text-[10px] font-bold', style: { background: 'var(--accent)', color: 'var(--accent-text)', border: 'none', cursor: 'pointer' }, onclick: add }, 'Add'));
        })() : null,
        row('Total Pay', $(upfrontTotal), { tone: 'total' }),
        pending.length ? el('div', { class: 'px-3 py-1.5 border-t text-[10px]', style: { borderColor: 'var(--border)', color: 'var(--text-muted)' } },
          pending.length + ' sale' + (pending.length === 1 ? '' : 's') + ' still pending audit (' + fmt.usd0(pendingRev) + ' · est. ' + fmt.usd0(pendingPay) + ' pay)') : null,
      ),

      // BACKEND PAY — the quarter that contains this period
      block(
        hdr('Backend Pay', 'Q' + (Math.floor(period.start.getMonth() / 3) + 1) + ' ' + period.start.getFullYear()),
        row('Eligible Subscriptions', fmt.int(quarterEligible.length)),
        row('Eligible Revenue', $(eligibleRevenue)),
        row('Multi-Year % Pay', $(multiYearBonusQuarter)),
        row('Close Rate % Pay', $(closeRateBonusQuarter)),
        row('Renewal Pay', $(renewalPayQuarter)),
        row('Cancels', el('span', { class: 'text-left tabular-nums font-semibold', style: { color: '#DC2626' } }, (cancelsClawback > 0 ? '-' : '') + $(cancelsClawback)), { red: true }),
        row('Backend Pay', $(backendPayNet), { tone: 'total' }),
        el('div', { class: 'px-3 py-1.5 border-t text-[10px]', style: { borderColor: 'var(--border)', color: 'var(--text-muted)' } },
          'Pending backend: ' + fmt.usd0(pendingBackend) + ' on ' + fmt.usd0(pendingBackendRevenue) + ' revenue awaiting the backend audit'),
      ),
      ),   // left column

      // BY SOURCE — accounts + revenue per source (the sheet's grid, trimmed
      // to what reps look at; hidden / unlisted sources flag in red).
      paySourceBreakdown(repId, { serviced: servicedStaged, below_minimums: belowStaged, pending }),

      // METRICS — the rates behind the numbers
      block(
        hdr('Metrics'),
        row('Upfront %', pctS(BASE_PCT, 2)),
        row('Close Rate %', closeRateCell),
        row('Charge Upfront %', upfrontPct == null ? '100.00%' : pctS(upfrontPct * 100, 2)),
        row('Upfront Tier', tierLabel === '—' ? '70% +' : tierLabel),
        row('Upfront Pay %', pctS(upfrontMult * 100, 2)),
        row('PIF Modifier', signedPct(Number(s.pif_modifier ?? 5))),
        row('Commercial Modifier', signedPct(commercialRate - BASE_PCT)),
        row('OTS Modifier', otsRate == null ? '—' : signedPct(otsRate - BASE_PCT)),
        row('Upsell Modifier', upsellRate == null ? '—' : signedPct(upsellRate - BASE_PCT)),
        row('Below Min Pay Modifier', pctS(Number(s.below_min_multiplier ?? 50), 2)),
        row('Close Rate Bonus %', pctS(closeRateTierPct(closeRate, s), 2)),
        row('18 Mo Backend Bonus %', pctS(Number(s.multi_year_rate_18), 2)),
        row('24 Mo Backend Bonus %', pctS(Number(s.multi_year_rate_24), 2)),
        row('Renewal Backend Bonus', pctS(Number(s.renewal_backend_rate), 2)),
        row('Upfront 12-Mo Pay', $(s.renewal_flat.m12)),
        row('Upfront 18-Mo Pay', $(s.renewal_flat.m18)),
        row('Upfront 24-Mo Pay', $(s.renewal_flat.m24)),
        row('Upfront PIF Pay', $(s.renewal_flat.pif)),
      ),
    ),
  );
}

// The Pay tab's by-source grid. `salesByStatus` carries the same three
// buckets the stub uses; a segmented toggle picks which one renders.
// Sources hidden from the Pay tab's By Source grid (per Isaac) — admin
// toggles on Settings → Sources, shared across admins via the indicator
// config. A hidden source that still has sales is FLAGGED, never dropped.
function payHiddenSources() {
  state._compExtras = state._compExtras || {};
  const h = state._compExtras.payHiddenSources;
  return (h && typeof h === 'object') ? h : (state._compExtras.payHiddenSources = {});
}
function togglePayHiddenSource(id) {
  const h = payHiddenSources();
  if (h[id]) delete h[id]; else h[id] = true;
  saveDemoData();
  if (typeof saveIndicatorConfigToSupabase === 'function') saveIndicatorConfigToSupabase().catch(() => {});
  mountApp();
}

function paySourceBreakdown(repId, salesByStatus) {
  if (!state.paySourceStatus) state.paySourceStatus = 'serviced';
  const status = state.paySourceStatus;
  const rows = salesByStatus[status] || [];

  // Sheet columns E..L: 12 / 18 / 24 / PIF / Upsell-D2D / Upsell-Office /
  // Commercial / OTS. Commercial + PIF are flags in the app, checked first.
  const BUCKETS = [
    { key: 'm12',          label: '12'   },
    { key: 'm18',          label: '18'   },
    { key: 'm24',          label: '24'   },
    { key: 'pif',          label: 'PIF'  },
    { key: 'upsellD2D',    label: 'UP-D2D' },
    { key: 'upsellOffice', label: 'UP-OFF' },
    { key: 'commercial',   label: 'COMM' },
    { key: 'ots',          label: 'OTS'  },
  ];
  const bucketOf = (s) => {
    if (s.is_commercial) return 'commercial';
    if (s.paid_in_full)  return 'pif';
    const ctName = (state.contractTypes.find(c => c.id === s.contract_type_id)?.name || '');
    if (/upsell.*d2d/i.test(ctName))    return 'upsellD2D';
    if (/upsell.*office/i.test(ctName)) return 'upsellOffice';
    const m = Number(s.contract_months);
    if (m === 18) return 'm18';
    if (m === 24) return 'm24';
    if (!m)       return 'ots';
    return 'm12';
  };

  // Aggregate the selected bucket's sales per source.
  const agg = new Map(); // source_id → { accounts, revenue, pay, buckets:{} }
  for (const s of rows) {
    const id = s.source_id || 0;
    if (!agg.has(id)) agg.set(id, { accounts: 0, revenue: 0, pay: 0, buckets: {} });
    const a = agg.get(id);
    const rev = Number(s.revenue_amount || 0);
    a.accounts += 1;
    a.revenue  += rev;
    // Pending pay is estimated at the serviced rate (matches the stub).
    a.pay += getCommissionAmount(repId, status === 'pending' ? { ...s, audit_status: 'serviced' } : s);
    const b = bucketOf(s);
    a.buckets[b] = (a.buckets[b] || 0) + (isRenewalSource(s) ? 1 : rev);
  }

  // Every active source renders (zeros included — that's how new lead
  // providers show up with no extra setup); inactive ones only if they
  // still have sales in this bucket. Standard sources first, A→Z, then
  // renewal sources.
  const hidden = payHiddenSources();
  const sources = state.sources
    .filter(o => !hidden[o.id] && (o.is_active !== false || agg.has(o.id)))
    .sort((x, y) => (x.is_renewal - y.is_renewal) || x.name.localeCompare(y.name));
  // Flagged (per Isaac — mirrors the sheet): sales whose source is hidden
  // from this grid, or isn't in the Sources list at all. They still count
  // toward pay; the row is highlighted so someone fixes the source.
  const knownIds = new Set(state.sources.map(o => o.id));
  const flagged = [...agg.keys()]
    .filter(id => hidden[id] || !knownIds.has(id))
    .map(id => ({ id, name: knownIds.has(id) ? (state.sources.find(o => o.id === id)?.name || '?') : (id ? 'Unknown source #' + id : 'No source'), is_renewal: !!state.sources.find(o => o.id === id)?.is_renewal, _flag: hidden[id] ? 'hidden on Pay' : 'not in Sources' }))
    .sort((x, y) => x.name.localeCompare(y.name));

  const totals = { accounts: 0, revenue: 0, pay: 0 };
  for (const a of agg.values()) { totals.accounts += a.accounts; totals.revenue += a.revenue; totals.pay += a.pay; }

  const STATUSES = [
    { id: 'serviced',       label: 'SALES' },
    { id: 'below_minimums', label: 'BELOW MIN' },
    { id: 'pending',        label: 'PENDING' },
  ];

  const th = (txt, right) => el('th', {
    class: 'px-2 py-2 text-[10px] uppercase tracking-widest font-bold whitespace-nowrap' + (right ? ' text-left' : ' text-left'),
    style: { background: 'var(--brand-charcoal, #323230)', color: 'var(--brand-cream, #FBF4DA)' },
  }, txt);
  const td = (content, opts = {}) => el('td', {
    class: 'px-2 py-1.5 text-xs tabular-nums whitespace-nowrap' + (opts.right ? ' text-left' : ' text-left'),
    style: {
      borderBottom: '1px solid var(--border)',
      fontWeight: opts.bold ? '700' : '400',
      color: opts.dim ? 'var(--text-muted)' : 'var(--text)',
    },
  }, content);

  return el('div', { class: 'card overflow-hidden', style: { border: '1px solid #000', borderRadius: '0' } },
    el('div', { class: 'flex items-center justify-between flex-wrap gap-2', style: { padding: '10px 14px', background: '#000' } },
      el('div', { style: { color: '#fff', fontSize: '11px', fontWeight: '800', letterSpacing: '.18em', textTransform: 'uppercase' } }, 'By Source'),
      el('div', { class: 'inline-flex rounded overflow-hidden', style: { border: '1px solid #fff' } },
        ...STATUSES.map(t => el('button', {
          style: status === t.id
            ? { padding: '4px 10px', fontSize: '10px', fontWeight: '800', letterSpacing: '.12em', background: '#fff', color: '#000' }
            : { padding: '4px 10px', fontSize: '10px', fontWeight: '700', letterSpacing: '.12em', background: 'transparent', color: '#fff' },
          onclick: () => { state.paySourceStatus = t.id; mountApp(); },
        }, t.label)),
      ),
    ),
    el('div', { class: 'overflow-x-auto' },
      el('table', { class: 'w-full', style: { borderCollapse: 'collapse' } },
        el('thead', {}, el('tr', {},
          th('Source'), th('Accts', true), th('Revenue', true),
        )),
        el('tbody', {},
          ...sources.map(src => {
            const a = agg.get(src.id) || { accounts: 0, revenue: 0, pay: 0, buckets: {} };
            const zero = a.accounts === 0;
            return el('tr', {},
              td(el('span', {}, src.name, src.is_renewal ? el('span', { class: 'ml-1 text-[9px] uppercase tracking-wider', style: { color: 'var(--text-muted)' } }, 'flat') : null), { dim: zero }),
              td(zero ? '—' : fmt.int(a.accounts), { right: true, dim: zero }),
              td(zero ? '—' : fmt.usd(a.revenue), { right: true, dim: zero }),
            );
          }),
          ...flagged.map(src => {
            const a = agg.get(src.id);
            return el('tr', { style: { background: 'rgba(220,38,38,.08)' }, title: src._flag === 'hidden on Pay' ? 'This source is hidden on the Pay tab (Settings → Sources) but still has sales in this bucket.' : 'This source is not in Settings → Sources — check the sale\u2019s source.' },
              td(el('span', {}, el('span', { style: { color: '#DC2626', fontWeight: '800' } }, '\u26a0 '), src.name, el('span', { class: 'ml-1 text-[9px] uppercase tracking-wider', style: { color: '#DC2626' } }, src._flag)), {}),
              td(fmt.int(a.accounts), { right: true }),
              td(fmt.usd(a.revenue), { right: true }));
          }),
          el('tr', {},
            td('TOTAL', { bold: true }),
            td(fmt.int(totals.accounts), { right: true, bold: true }),
            td(fmt.usd(totals.revenue), { right: true, bold: true }),
          ),
        ),
      ),
    ),
  );
}

// Stage a single sale for payroll
async function stageSale(saleId) {
  if (DEMO) {
    for (const list of [state.mySales, state.allSales]) {
      const s = list.find(x => x.id === saleId);
      if (s) { s.staged_for_payroll = true; s.staged_at = new Date().toISOString(); }
    }
    const sale = state.allSales.find(s => s.id === saleId);
    logActivity('staged', { sale_id: saleId, customer_name: sale?.customer_name, new_status: 'staged' });
    toast('Staged for payroll', 'success');
    saveDemoData();
    mountApp();
    return;
  }
  try {
    const { error } = await supabase.from('sales').update({
      staged_for_payroll: true,
      staged_at: new Date().toISOString(),
    }).eq('id', saleId);
    if (error) throw error;
    toast('Staged for payroll', 'success');
    await refreshSalesData();
    mountApp();
  } catch (err) { toast(err.message || 'Failed', 'error'); }
}

async function stageAllForPayroll(sales) {
  if (DEMO) {
    sales.forEach(s => {
      logActivity('staged', { sale_id: s.id, customer_name: s.customer_name, new_status: 'staged' });
      s.staged_for_payroll = true; s.staged_at = new Date().toISOString();
    });
    toast(`Staged ${sales.length} sale${sales.length === 1 ? '' : 's'}`, 'success');
    saveDemoData();
    mountApp();
    return;
  }
  try {
    const ids = sales.map(s => s.id);
    const { error } = await supabase.from('sales').update({
      staged_for_payroll: true,
      staged_at: new Date().toISOString(),
    }).in('id', ids);
    if (error) throw error;
    toast(`Staged ${sales.length} sales`, 'success');
    await refreshSalesData();
    mountApp();
  } catch (err) { toast(err.message || 'Failed', 'error'); }
}

// Quarterly backend payroll. Stamps backend_payroll_processed_at on every
// locked sale that hasn't yet had backend payroll run on it. The data flow
// is intentionally simple — once locked, the backend amount on each sale
// is final and gets cleared from "Quarter Running" once this fires.
function processBackendPayroll(period, repId) {
  // Default to the current user if no rep is passed (preserves old call sites).
  const targetRepId = repId || state.profile.id;
  // Both Lock and Chargeback are "decided" backend states — Lock confirms
  // the commission, Chargeback claws it back. Both get stamped with
  // backend_payroll_processed_at on the quarter-end run, which is what
  // graduates them from Pending Backend Lock to History.
  const eligible = (DEMO ? state.allSales : state.mySales).filter(s =>
    s.rep_id === targetRepId &&
    (s.lock_status === 'lock' || s.lock_status === 'chargeback') &&
    !s.backend_payroll_processed_at
  );
  if (eligible.length === 0) {
    toast('No decided sales waiting on backend payroll.', 'warn');
    return;
  }
  const lockCount  = eligible.filter(s => s.lock_status === 'lock').length;
  const cbCount    = eligible.filter(s => s.lock_status === 'chargeback').length;
  const breakdown  = [
    lockCount && `${lockCount} locked`,
    cbCount   && `${cbCount} chargeback`,
  ].filter(Boolean).join(' · ');
  if (!confirm(`Run backend payroll for ${eligible.length} account${eligible.length === 1 ? '' : 's'} (${breakdown})? This typically runs once per quarter.`)) return;
  if (DEMO) {
    eligible.forEach(s => {
      s.backend_payroll_processed_at = new Date().toISOString();
      s.backend_payroll_period = period.id;
      logActivity('backend_payroll_processed', {
        sale_id: s.id, customer_name: s.customer_name,
        new_status: s.lock_status === 'chargeback' ? 'chargeback paid' : 'backend paid',
        detail: period.label,
        rep_name: state.allProfiles.find(p => p.id === s.rep_id)?.full_name,
      });
    });
    toast(`Backend payroll processed for ${eligible.length} accounts`, 'success');
    notifyPayrollRun(eligible, period, 'backend');
    saveDemoData();
    mountApp();
    return;
  }
  (async () => {
    try {
      const ids = eligible.map(s => s.id);
      const { error } = await supabase.from('sales').update({
        backend_payroll_processed_at: new Date().toISOString(),
        backend_payroll_period_id: period.id,
      }).in('id', ids);
      if (error) throw error;
      toast(`Backend payroll processed for ${eligible.length} accounts`, 'success');
      notifyPayrollRun(eligible, period, 'backend');
      await refreshSalesData();
      mountApp();
    } catch (err) { toast(err.message || 'Failed', 'error'); }
  })();
}

function processPayroll(sales, period) {
  if (!sales.length) return;
  if (!confirm(`Process payroll for ${sales.length} account${sales.length === 1 ? '' : 's'} in ${period.label}?`)) return;
  if (DEMO) {
    sales.forEach(s => {
      logActivity('payroll_processed', { sale_id: s.id, customer_name: s.customer_name, new_status: 'paid', detail: period.label });
      s.staged_for_payroll = false; s.payroll_processed_at = new Date().toISOString(); s.payroll_period = period.id;
    });
    toast(`Payroll processed for ${sales.length} accounts`, 'success');
    // Fire pay stub DMs in the background — won't block the toast / re-render.
    notifyPayrollRun(sales, period, 'upfront');
    saveDemoData();
    mountApp();
    return;
  }
  // Real: set a flag. In a real deployment this would also generate a payroll record.
  (async () => {
    try {
      const ids = sales.map(s => s.id);
      const { error } = await supabase.from('sales').update({
        staged_for_payroll: false,
        payroll_processed_at: new Date().toISOString(),
        payroll_period_id: period.id,
      }).in('id', ids);
      if (error) throw error;
      toast(`Payroll processed for ${sales.length} accounts`, 'success');
      notifyPayrollRun(sales, period, 'upfront');
      await refreshSalesData();
      mountApp();
    } catch (err) { toast(err.message || 'Failed', 'error'); }
  })();
}

// Group sales by rep, build a per-rep summary in the active metric, and
// fan out DMs via slack.sendDM. Respects the `paystub_dm_enabled` admin
// toggle; quietly no-ops when off so the payroll flow itself is unaffected.
// `kind` is either 'upfront' (biweekly upfront commission run) or 'backend'
// (quarterly backend lock + chargeback run).
function notifyPayrollRun(sales, period, kind) {
  const settings = state.appSettings || {};
  if (!settings.paystub_dm_enabled) return;
  if (!sales || !sales.length) return;

  const byRep = new Map();
  for (const s of sales) {
    if (!byRep.has(s.rep_id)) byRep.set(s.rep_id, []);
    byRep.get(s.rep_id).push(s);
  }

  for (const [repId, repSales] of byRep) {
    const profile = (state.allProfiles || []).find(p => p.id === repId);
    if (!profile) continue;

    let summary;
    if (kind === 'backend') {
      const lockSales   = repSales.filter(s => s.lock_status === 'lock');
      const chargeback  = repSales.filter(s => s.lock_status === 'chargeback');
      const lockBonus  = lockSales.reduce((a, s) => a + getBackendAmount(s), 0);
      const cbClawback = chargeback.reduce((a, s) => a + getBackendAmount(s), 0);
      summary = {
        serviced: lockSales.length,
        below: chargeback.length,
        bonuses: lockBonus,
        total: lockBonus - cbClawback,
      };
    } else {
      const serviced = repSales.filter(s => s.audit_status === 'serviced');
      const below    = repSales.filter(s => s.audit_status === 'below_minimums');
      const _upM = upfrontTierPayPct(upfrontCollectedPct([...serviced, ...below]));
      const salesPay = serviced.reduce((a, s) => a + getCommissionAmount(repId, s), 0) * _upM;
      const belowPay = below.reduce((a, s) => a + getCommissionAmount(repId, s), 0) * _upM;
      summary = {
        serviced: serviced.length,
        below: below.length,
        salesPay, belowPay,
        total: salesPay + belowPay,
      };
    }

    const payload = slack.formatPayStub(profile, period, summary, kind);
    // Fire-and-forget — the helper handles its own toasts/logging.
    slack.sendDM([repId], payload, kind === 'backend' ? 'paystub_backend' : 'paystub_upfront');
  }
}

// Slack-side reactions to a freshly logged sale: First Blood (rep's first
// sale of the calendar day) and Sale Broadcast (every sale). Both go to
// the channel webhook configured in the admin Slack tab. Quietly no-ops
// when the toggles are off, the channel is unset, or the webhook is empty.
function notifySaleLogged(row) {
  const settings = state.appSettings || {};
  const profile  = (state.allProfiles || []).find(p => p.id === row.rep_id);
  if (!profile) return;

  // First Blood — fires only when this is the rep's first sale of the day.
  // Look at every sale already in state for this rep on the same sold_date;
  // if there's exactly one (the row we just logged), it's first blood.
  if (settings.first_blood?.enabled) {
    const sameDay = (state.allSales || []).filter(s =>
      s.rep_id === row.rep_id && s.sold_date === row.sold_date);
    if (sameDay.length <= 1) {
      const channel = settings.sale_broadcast?.channel || (settings.slack_channels?.[0]?.name);
      if (channel) {
        slack.sendChannel(channel, slack.formatFirstBlood(profile, settings.first_blood), 'first_blood');
      }
    }
  }

  // Sale Broadcast — fires for every sale.
  if (settings.sale_broadcast?.enabled && settings.sale_broadcast?.channel) {
    slack.sendChannel(settings.sale_broadcast.channel, slack.formatSaleBroadcast(profile, row), 'sale_broadcast');
  }
}

function downloadPayrollCsv(sales, period) {
  if (!sales.length) return toast('Nothing to export', 'warn');
  const repId = state.profile.id;
  const headers = ['customer_name','customer_number','contract','revenue','rate','commission','backend_est','sold_date','status'];
  const lines = [headers.join(',')];
  for (const s of sales) {
    const r = Number(s.revenue_amount || 0);
    const renewal = isRenewalSource(s);
    const saleRate = renewal ? null : getCommissionRate(repId, s);
    const commission = getCommissionAmount(repId, s);
    const backend = getBackendAmount(s);
    lines.push([
      csvEsc(s.customer_name),
      csvEsc(s.customer_number || ''),
      csvEsc(contractTypeLabelForSale(s)),
      r.toFixed(2),
      renewal ? 'flat' : (saleRate * 100).toFixed(2) + '%',
      commission.toFixed(2),
      backend.toFixed(2),
      s.sold_date,
      s.audit_status,
    ].join(','));
  }
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: `ridd-payroll-${state.profile.full_name.replace(/\s+/g, '-')}-${period.isoStart}.csv` });
  document.body.append(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

