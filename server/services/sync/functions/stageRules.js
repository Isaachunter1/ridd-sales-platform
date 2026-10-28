// ┌─ stageRules — the auto-stage decisions, as pure functions ─────────────────
// │ Ported VERBATIM from netlify/functions/revhawk-sync-background.js (the
// │ 🤖 AUTO-STAGE block, Sep–Oct 2026). The lines inside each function are the
// │ Netlify lines unchanged — only the closure variables they read became
// │ arguments, and the update call moved out to the job. Rows in, updates out:
// │ nothing here touches Supabase or BigQuery, so it is fixture-tested
// │ (server/test/stage-rules.test.js).
// └─────────────────────────────────────────────────────────────────────────

// Pricing minimums (per Isaac, Oct 15) — see the comments inside. priorDone =
// customers with a completed service before their one-time sale (the job
// queries it; belowMinReason only reads it).
export function makePricing(AL2, priorDone = new Set()) {
  const PR = Object.assign({ initial_min: 39, fee: 4.87 }, AL2.pricing || {});
  PR.auto = PR.auto !== false;   // on unless switched off (per Isaac, Oct 15: under the minimum = the status IS Below Minimums)
  const PR_PLANS = Object.assign({ pest: [49, 69, 119], rodent: [49, 69, 119], mole: [69, 89, 139], mosquito: [69, 89, 139] }, PR.plans || {});
  const PR_TERM = Object.assign({ initial: 399, recurring: 29 }, PR.termite || {});
  // Renewals (per Isaac, Oct 15): initial minimum $0, recurring from the Loyalty pricing sheet.
  const PR_REN = Object.assign({ initial_min: 0 }, PR.renewal || {});
  const PR_REN_PLANS = Object.assign({ pest: [29, 49, 99], rodent: [29, 49, 99], mole: [49, 69, 119], mosquito: [49, 69, 119] }, PR_REN.plans || {});
  const PR_REN_TERM = Object.assign({ initial: 399, recurring: 29 }, PR_REN.termite || {});
  const belowMinReason = (r) => {
    const name = String((r && r.subscription) || '').trim();
    const renewal = /renew/i.test(String(r.subscription_source || '') + ' ' + String(r.lead_source || ''));
    // $4.87 service fee rides on the recurring charge (per Isaac, Oct 15) — not part of the plan price.
    // Taken off only when the charge carries it (same cents), so a fee-less $49.00 still reads $49.
    const _fee = Number(PR.fee) || 0, _rc = Number(r.recurring_charge) || 0;
    const _hasFee = _fee > 0 && _rc >= _fee && Math.round(_rc * 100) % 100 === Math.round(_fee * 100) % 100;
    const init = Number(r.initial_price), rec = _hasFee ? _rc - _fee : _rc;
    const money = (n) => '$' + (Math.round(n * 100) / 100).toFixed(2).replace(/\.00$/, '');
    let mInit, mRec, m;
    if ((m = name.match(/^(pest|rodent|mole|mosquito)\s+(4|6|12)\b/i))) {
      mInit = Number(renewal ? PR_REN.initial_min : PR.initial_min) || 0;
      mRec = Number(((renewal ? PR_REN_PLANS : PR_PLANS)[m[1].toLowerCase()] || [])[{ 4: 0, 6: 1, 12: 2 }[m[2]]]) || 0;
    } else if (/^termite\b/i.test(name)) { const T = renewal ? PR_REN_TERM : PR_TERM; mInit = Number(T.initial) || 0; mRec = Number(T.recurring) || 0; }
    else if (/^one[\s-]*time\b/i.test(name)) {
      // One-time services (per Isaac, Oct 15): the cheaper Current Customer price is only
      // allowed when the customer had a completed service (any kind) before this sale.
      const ot = oneTimeMin(name);
      if (!ot) return null;
      if (!isFinite(init) || init >= ot.nw - 0.001) return '';
      if (init >= ot.cur - 0.001) return priorDone.has(String(r.customer_id)) ? '' : 'Current-customer price ' + money(init) + ' but no completed service before the sale (new customer ' + money(ot.nw) + ')';
      return 'One-time ' + money(init) + ' < ' + money(ot.cur);
    }
    else return null;
    const out = [];
    if (mInit > 0 && isFinite(init) && init < mInit - 0.001) out.push('Initial ' + money(init) + ' < ' + money(mInit));
    if (mRec > 0 && rec < mRec - 0.001) out.push('Recurring ' + money(rec) + ' < ' + money(mRec));
    return out.length ? out.join(' · ') : '';
  };
  const PR_OT = Object.assign({ 'mosquito': [199, 99], 'pest': [199, 99], 'termite inspection': [199, 99], 'rodent': [249, 149],
    'german roach': [299, 199], 'interior flea': [299, 199], 'vehicle': [199, 199] }, PR.one_time || {});
  const oneTimeMin = (name) => {
    const n = String(name || '').toLowerCase();
    const k = Object.keys(PR_OT).sort((a, b) => b.length - a.length).find(t => n.includes(t));
    const v = k && PR_OT[k];
    return v ? { nw: Number(v[0]) || 0, cur: Number(v[1]) || 0 } : null;
  };
  return { PR, belowMinReason, oneTimeMin };
}

// The settings the decisions read, worked out once per run (verbatim).
export function stageSettings(AL2) {
  const _aaQ = Array.isArray(AL2.auto_approve_queues) ? new Set(AL2.auto_approve_queues.map(String)) : null;
  const _aaFrom = /^\d{4}-\d{2}-\d{2}$/.test(String(AL2.auto_approve_from || '')) ? String(AL2.auto_approve_from) : '';
  const _autoApproveOn = (s) => (_aaQ ? _aaQ.has(String(s.queue_type || 'office')) : !!AL2.auto_approve)
    && (!_aaFrom || String(s.sold_date || '').slice(0, 10) >= _aaFrom);
  // Inside Sales backend lock (per Isaac, Oct 14): N paid invoices on the subscription
  // (the initial's invoice counts), and nothing else. Counted from RevHawk tickets
  // mapped to the plan (netlify/lib/invoice-map.js) and stamped on the sale as
  // crm_paid_invoices once a day per sale (each count scans the ticket tables).
  const OFFICE_PAID_N = Math.max(1, parseInt((((AL2.backend || {}).office) || {}).paid_invoices, 10) || 4);
  const lockDays = Math.max(0, Number(AL2.lock_days) || 90);
  const minSvc = Math.max(0, Number(AL2.lock_min_services) || 0);
  const _upFlag = String(AL2.upfront_flag ?? 'Passed Audit').trim().toLowerCase();
  const _upfrontOf = (r) => !!_upFlag && !!r && String(r.customer_flags || '').split(',').some(f => f.trim().toLowerCase() === _upFlag);
  return { _aaQ, _aaFrom, _autoApproveOn, OFFICE_PAID_N, lockDays, minSvc, _upfrontOf };
}

// Paid since the sale (per Isaac, Oct 15) — one sale's decision from the customer's FieldRoutes payments.
// Returns { v, upd }; upd.audit_status is set only when the queue moves (NSF in, or back to Pending).
export function paidSinceDecision(x, byCust, { stamp, _autoApproveOn, nsfNow }) {
  const isOk = (t) => String(t.st) === '1' && String(t.pm) !== '0' && (Number(t.amt) || 0) > 0 && String(t.wo || '0') !== '1' && String(t.cm || '0') !== '1';
  const isDecl = (t) => String(t.st) === '0';
  const day = String(x.sold_date || '').slice(0, 10);
  const mine = (byCust.get(String(x.customer_number).replace(/[^0-9]/g, '')) || []).filter(t => String(t.d || '') >= day);
  const ok = mine.filter(isOk).map(t => t.d).sort();
  const dec = mine.filter(isDecl).map(t => t.d).sort();
  const v = { paid: ok.length > 0, paidAt: ok[0] || null, declinedAt: ok.length ? null : (dec[dec.length - 1] || null) };
  const upd = { crm_paid_since_sale: v.paid ? true : (v.declinedAt ? false : null), crm_paid_at: v.paidAt, crm_declined_at: v.declinedAt, crm_payment_checked_at: stamp };
  const inScope = _autoApproveOn(x);
  const autoNsf = /Auto: NSF/.test(String(x.notes || ''));
  if (inScope && x.audit_status === 'pending' && !v.paid && v.declinedAt) {
    upd.audit_status = 'nsf'; upd.audited_at = stamp; nsfNow.add(x.id);
    upd.notes = ((x.notes || '') + ' · Auto: NSF — card declined ' + v.declinedAt + ', no payment since the sale').trim();
  } else if (x.audit_status === 'nsf' && v.paid && (autoNsf || inScope)) {   // per Isaac: NSF flips back as soon as they pay
    upd.audit_status = 'pending'; upd.audited_at = null;
    upd.notes = ((x.notes || '') + ' · Auto: paid ' + v.paidAt + ' — back to Pending').trim();
  }
  return { v, upd };
}

// One CRM-born sale against its snapshot row → the update to write ({} = leave it alone).
// d carries the run's state, exactly the closure variables the Netlify loop read.
export function decideStage(s, r, d) {
  const { AL2, PR, today, stamp, paidSince, nsfNow, belowMin, paidBySale, OFFICE_PAID_N, lockDays, minSvc, _autoApproveOn, _upfrontOf, belowMinReason } = d;
  const cancelled = !!r.subscription_date_canceled || /cancel|inactive/i.test(String(r.subscription_status || ''));
  // Serviced = the initial's completion date, or FieldRoutes' own 'Completed' initial status while the
  // appointment row still lags in RevHawk (per Isaac, Oct 15 — #183686 completed, row still Pending).
  // Renewals (per Isaac, Oct 15): no new initial — commissionable on their next service (completed on/after
  // the save) or their next paid invoice (the paid-since-sale check → upfront below). No appointment needed.
  const _isRenewal = /renew/i.test(String(r.subscription_source || '') + ' ' + String(r.lead_source || ''));
  const serviced = _isRenewal
    ? ((!!r.initial_serviced_date && String(r.initial_serviced_date).slice(0, 10) >= String(s.sold_date || '').slice(0, 10))
      || (!!r.last_completed_date && String(r.last_completed_date).slice(0, 10) >= String(s.sold_date || '').slice(0, 10)))
    : (!!r.initial_serviced_date || /^completed$/i.test(String(r.initial_status || '').trim()));
  const completed = Number(r.subscription_completed_services) || 0;
  const dpd = Number(r.days_past_due) || 0;
  // Signed = the snapshot's e-sign document OR the sale row's own stamp, which the
  // 15-minute live pull sets from FieldRoutes' "signed contract" note (per Isaac,
  // Oct 14 — the e-sign document lags same-day, the note doesn't).
  const signed = String(r.contract_state || 'none') === 'signed' || String(s.crm_contract_state || '') === 'signed';
  const oneTime = (Number(s.contract_months) || 0) <= 0;
  const hasAppt = ['pending', 'completed'].includes(String(r.initial_status || '').trim().toLowerCase()) || /renew/i.test(String(r.subscription_source || '') + ' ' + String(r.lead_source || ''));
  const hasBilling = (() => { const a = String(r.customer_auto_pay || '').trim().toLowerCase(); return !!a && !['no', '0', 'false', 'none', 'null'].includes(a); })();
  // Guard rails per rep type (Configurations → Commission Rules →
  // Upfront Commission Approval): AL2.approval[office|d2d|tech] =
  // { appt, autopay, signed }; the old company-wide require_* flags
  // are the fallback for a type with nothing set.
  const _ap = ((AL2.approval || {})[String(s.queue_type || 'office')]) || {};
  const needAppt = _ap.appt != null ? !!_ap.appt : AL2.require_appt !== false;
  const needPay  = _ap.autopay != null ? !!_ap.autopay : AL2.require_billing !== false;
  const needSign = _ap.signed != null ? !!_ap.signed : AL2.require_signed !== false;
  const eligible = (!needAppt || hasAppt) && (!needPay || hasBilling) && (!needSign || signed || oneTime);
  // Charged upfront (the configured customer flag) — per Isaac:
  // commissionable on the sale date, no need to wait for service;
  // and if it cancels while still pending it goes to Archived.
  // Charged upfront = the configured customer flag, OR a real payment since the sale (per Isaac, Oct 15).
  const upfront = _upfrontOf(r) || !!(paidSince.get(s.id) || {}).paid;
  // Checked from the new-flow start (sales before it were sold on the old pricing).
  const _pmFrom = /^\d{4}-\d{2}-\d{2}$/.test(String(AL2.auto_approve_from || '')) ? String(AL2.auto_approve_from) : '2026-10-12';
  if (['pending', 'serviced', 'below_minimums'].includes(s.audit_status) && !s.payroll_processed_at && String(s.sold_date || '') >= _pmFrom) { const bm = belowMinReason(r); if (bm != null) belowMin.set(s.id, bm); }
  const upd = {};
  if (s.audit_status === 'pending' && !s.payroll_processed_at) {
    if (cancelled && (!serviced || upfront)) { upd.audit_status = 'cancelled'; upd.audited_at = stamp; upd.notes = ((s.notes || '') + (upfront && serviced ? ' · Auto: cancelled in CRM (charged upfront)' : ' · Auto: cancelled in CRM before service')).trim(); }
    // Renewals are exempt from the audit flag (per Isaac, Oct 28): a Passed / Failed Audit flag on the account is
    // from the ORIGINAL sale, never the renewal — a renewal is approved on its next treatment or next paid bill.
    else if (!nsfNow.has(s.id) && _autoApproveOn(s) && s.rep_id && eligible && (serviced || upfront) && dpd <= 0 && (_isRenewal || s.crm_audit !== 'failed')) {
      // Below the pricing minimum → approved as Below Minimums (when that switch is on).
      const bm = belowMin.get(s.id);
      upd.audit_status = (PR.auto && bm) ? 'below_minimums' : 'serviced'; upd.audited_at = stamp;
      if (upd.audit_status === 'below_minimums') upd.notes = ((s.notes || '') + ' · Auto: Below Minimums — ' + bm).trim();
    }
  }
  // Already approved, not paid yet: Commissionable under a minimum → Below Minimums; an auto Below Minimums
  // that's back at/above the minimums (pricing changed) → Commissionable. A manual call is left alone.
  if (PR.auto && !s.payroll_processed_at && !upd.audit_status && belowMin.has(s.id) && _autoApproveOn(s)) {
    const bm = belowMin.get(s.id);
    if (s.audit_status === 'serviced' && bm) { upd.audit_status = 'below_minimums'; upd.notes = ((s.notes || '') + ' · Auto: Below Minimums — ' + bm).trim(); }
    else if (s.audit_status === 'below_minimums' && !bm && /Auto: Below Minimums/.test(String(s.notes || ''))) { upd.audit_status = 'serviced'; upd.notes = ((s.notes || '') + ' · Auto: back at/above the pricing minimums').trim(); }
  }
  const lock = s.lock_status || 'pending';
  if (lock === 'pending' && s.payroll_processed_at && ['approved', 'serviced', 'below_minimums'].includes(upd.audit_status || s.audit_status)) {   // Below Minimums locks the same way (it was stuck before)
    const ageDays = (today - (Date.parse(String(s.sold_date || '')) || today)) / 86400000;
    if (cancelled) { upd.lock_status = 'chargeback'; upd.audit_2_at = stamp; }
    else if (s.queue_type === 'd2d') {
      // Sales Reps (per Isaac, Sep 23): every account sold in a year locks on
      // Jan 31 of the FOLLOWING year, always. Plus (Sep 30) any indications
      // set in the Sales Reps column of Backend lock — AL2.backend.d2d;
      // all default OFF, so the Jan 31 rule alone applies until set.
      const sy = Number(String(s.sold_date || '').slice(0, 4)) || new Date(today).getFullYear();
      const _bd = (AL2.backend || {}).d2d || {};
      const dDays = Math.max(0, Number(_bd.min_days) || 0), dSvc = Math.max(0, Number(_bd.min_services) || 0), dDpd = Math.max(0, Number(_bd.max_dpd) || 0);
      const dAfter = Math.max(0, completed - (serviced ? 1 : 0));
      const dOk = ageDays >= dDays && dAfter >= dSvc && !(dDpd > 0 && dpd >= dDpd) && (!_bd.autopay || hasBilling) && (!_bd.signed || signed || oneTime);
      if (today >= Date.UTC(sy + 1, 0, 31) && dOk) { upd.lock_status = 'lock'; upd.audit_2_at = stamp; }
    }
    else if ((s.queue_type || 'office') === 'office') {
      // Inside Sales (per Isaac, Oct 14): locks at N paid invoices (initial included), nothing else.
      const n = paidBySale.get(s.id);
      if (n != null && n >= OFFICE_PAID_N) { upd.lock_status = 'lock'; upd.audit_2_at = stamp; }
    }
    else {
      // Technicians backend (per Isaac, Sep 23 — Inside Sales moved to paid invoices Oct 14): the
      // account stays PENDING until every configured indication
      // holds — Configurations → Commission Rules → Backend lock,
      // AL2.backend[office|tech] = { min_days, min_services (completed
      // AFTER the initial), max_dpd (a balance past due this many days
      // blocks), autopay, signed }. Old lock_days / lock_min_services
      // are the fallback.
      const _bk = ((AL2.backend || {})[s.queue_type === 'tech' ? 'tech' : 'office']) || {};
      const bDays = _bk.min_days != null ? Math.max(0, Number(_bk.min_days) || 0) : lockDays;
      const bSvc = _bk.min_services != null ? Math.max(0, Number(_bk.min_services) || 0) : Math.max(0, minSvc - 1);
      const bDpd = _bk.max_dpd != null ? Math.max(0, Number(_bk.max_dpd) || 0) : 7;
      const bPay = _bk.autopay != null ? !!_bk.autopay : true;
      const bSign = _bk.signed != null ? !!_bk.signed : true;
      const afterInitial = Math.max(0, completed - (serviced ? 1 : 0));
      const ok = ageDays >= bDays && afterInitial >= bSvc && !(bDpd > 0 && dpd >= bDpd) && (!bPay || hasBilling) && (!bSign || signed || oneTime);
      if (ok) { upd.lock_status = 'lock'; upd.audit_2_at = stamp; }
    }
  }
  return upd;
}
