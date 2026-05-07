// Shared sample data so all mockups show identical numbers.
// Tweak here once and reload all three.
window.MOCK = {
  rep: 'Isaac Hunter',
  year: 2026,
  periodLabel: 'Apr 22 – May 5',
  periodId: 9,
  // Pay Period stub
  totalRevenue:      4250.00,
  quarterlyRevenue: 14800.00,
  // Pending Revenue = revenue from sales already paid upfront but still
  // awaiting a backend-lock decision. Grows period over period until lock.
  pendingRevenue:    8650.00,
  multiYearPay:        85.00,
  closeRatePay:        42.00,
  renewalPay:           0.00,
  payPeriodBackend:   127.00,
  quarterlyBackend:   384.00,
  goldenPhone:          0.00,
  salesPay:           297.50,
  // Total Pay (regular stub) = Golden Phone + Sales Pay. Backend pay is
  // delivered separately on the Backend Pay Period stub at quarter end.
  get totalPay() { return this.goldenPhone + this.salesPay; },
  // Backend Pay Period stub adds
  postServiceCancels:   0.00,
  pendingBackend:     650.00,
  quotaPay:             0.00,
  // Upfront Pay extras (rep-type-aware)
  // repType: 'sales_rep' shows Golden Phone; 'loyalty_rep' shows Loyalty Pay + Loyalty Royalty.
  repType:           'sales_rep',
  loyaltyPay:          80.00,
  loyaltyRoyalty:     150.00,
  otherPay:            25.00,
  // Stat-card numbers
  pendingAuditCount: 4,  pendingAuditRev: 1850,
  servicedCount:     7,  servicedRev:     4250,
  belowMinCount:     1,  belowMinRev:      350,
};
window.fmt$ = (n) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
