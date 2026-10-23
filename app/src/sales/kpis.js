// ──────────────────────────────────────────────────────────────────────────
// KPI helpers
// ──────────────────────────────────────────────────────────────────────────
function computeMyKpis() {
  const mine = state.mySales;
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const mtd = mine.filter(s => new Date(s.sold_date + 'T00:00') >= monthStart);
  const approved = mtd.filter(s => ['approved','serviced'].includes(s.audit_status));
  const pending  = mine.filter(s => s.audit_status === 'pending');
  const below    = mine.filter(s => s.audit_status === 'below_minimums');

  const revenueMtd  = approved.reduce((a, s) => a + Number(s.revenue_amount || 0), 0);
  const repId = state.profile.id;
  const estPay      = approved.reduce((a, s) => a + Number(s.revenue_amount || 0) * getCommissionRate(repId, s), 0)
                    + below.reduce((a, s) => a + Number(s.revenue_amount || 0) * getCommissionRate(repId, s), 0);
  const closeRate   = mtd.length ? approved.length / mtd.length : 0;

  return {
    approvedCount: approved.length,
    pendingCount: pending.length,
    belowCount: below.length,
    revenueMtd, estPay, closeRate,
  };
}
function sumSales(sales, predicate) {
  const matched = sales.filter(predicate);
  return {
    count: matched.length,
    revenue: matched.reduce((a, s) => a + Number(s.revenue_amount || 0), 0),
  };
}
function isCompActive(c) {
  const now = new Date();
  return new Date(c.start_date) <= now && new Date(c.end_date + 'T23:59') >= now;
}

