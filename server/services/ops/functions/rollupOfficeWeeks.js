// Pure: day rows → office × Sun–Sat week cells + the payload shape the
// Reporting → Operations tab reads. No I/O, so it is fixture-testable
// (test/ops-rollup.test.js). Ported from ops-stats-background.js unchanged;
// generatedAt is injected so two runs over the same rows produce the same bytes.

export const OFFICE_NAMES = {
  '1': 'Salt Lake', '6': 'Charleston', '7': 'Myrtle Beach', '10': 'Destin',
  '13': 'Atlanta', '15': 'Virginia Beach', '16': 'Raleigh', '18': 'Detroit', '19': 'Joplin', '20': 'Little Rock',
};

// Sun–Sat week start for an ISO date.
export function weekStartOf(iso) {
  const d = new Date(iso + 'T12:00:00Z'); const dow = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() - dow); return d.toISOString().slice(0, 10);
}

export const DEFINITIONS = {
  done: 'Completed appointments in the week (service types only; Tech Follow Up, Meeting Day and uncategorised types excluded)',
  sch: 'Appointments not cancelled (same type rule) — completed + still pending',
  resvc: 'Completed appointments whose service type is flagged Reservice',
  prod: 'Ticket production ($) on completed non-reservice appointments',
  routes: 'Distinct route-days with at least one completed service stop',
  mins: 'Check-in → check-out minutes on completed stops (minsn = stops with both stamps)',
  hours: 'FieldRoutes time clock, paid categories, technicians only (management hours are entered by hand)',
  fr_reviews: 'Reviews logged in FieldRoutes (Google reviews are entered by hand)',
};

export function rollupOfficeWeeks({ appt, clock, reviews, start, end, year, generatedAt }) {
  const cells = {};
  const cell = (o, w) => { const k = o + '|' + w; return cells[k] || (cells[k] = { done: 0, sch: 0, resvc: 0, prod: 0, routes: 0, mins: 0, minsn: 0, rtypes: {}, hours: 0, people: 0, fr_reviews: 0, fr_reviews_good: 0 }); };
  for (const r of appt) {
    const c = cell(String(r.office_id), weekStartOf(r.d));
    c.done += +r.done || 0; c.sch += +r.sch || 0; c.resvc += +r.resvc || 0; c.prod += +r.prod || 0; c.routes += +r.routes || 0;
    c.mins += +r.mins || 0; c.minsn += +r.minsn || 0;
    String(r.rtypes || '').split('|').filter(Boolean).forEach(t => { c.rtypes[t] = (c.rtypes[t] || 0) + 1; });
  }
  for (const r of clock) { const c = cell(String(r.office_id), weekStartOf(r.d)); c.hours += +r.hours || 0; c.people = Math.max(c.people, +r.people || 0); }
  for (const r of reviews) { const c = cell(String(r.office_id), weekStartOf(r.d)); c.fr_reviews += +r.n || 0; c.fr_reviews_good += +r.good || 0; }
  for (const k of Object.keys(cells)) { cells[k].hours = Math.round(cells[k].hours * 10) / 10; }
  const weeks = []; for (let d = new Date(start + 'T12:00:00Z'); d.toISOString().slice(0, 10) <= end; d.setUTCDate(d.getUTCDate() + 7)) weeks.push(d.toISOString().slice(0, 10));
  return { generatedAt, year, start, end, weeks, officeNames: OFFICE_NAMES, cells, definitions: DEFINITIONS };
}
