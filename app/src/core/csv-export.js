// ──────────────────────────────────────────────────────────────────────────
// Utility: CSV export
// ──────────────────────────────────────────────────────────────────────────
function downloadCsv(rows) {
  if (!rows.length) return toast('Nothing to export', 'warn');
  const headers = [
    'customer_name','customer_number','office','service_type','source',
    'initial','monthly','revenue','sold_date','bill_date','status',
    'audit_1','audit_2','lock_status','notes',
  ];
  const auditorName = (id) => (state.allProfiles || []).find(p => p.id === id)?.full_name || '';
  const lines = [headers.join(',')];
  for (const s of rows) {
    lines.push([
      csvEsc(s.customer_name),
      csvEsc(s.customer_number || ''),
      csvEsc(nameFromId(state.offices, s.office_id)),
      csvEsc(nameFromId(state.serviceTypes, s.service_type_id)),
      csvEsc(nameFromId(state.sources, s.source_id)),
      s.initial_amount, s.monthly_amount, s.revenue_amount,
      s.sold_date, s.bill_date || '', s.audit_status,
      csvEsc(auditorName(s.audited_by)),
      csvEsc(auditorName(s.audit_2_by)),
      s.lock_status || 'pending',
      csvEsc(s.notes || ''),
    ].join(','));
  }
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: `ridd-sales-${new Date().toISOString().slice(0,10)}.csv` });
  document.body.append(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}
function csvEsc(v) {
  if (v == null) return '';
  const s = String(v);
  if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

