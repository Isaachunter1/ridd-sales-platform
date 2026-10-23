// ──────────────────────────────────────────────────────────────────────────
// BINGO / RULE ENGINE
// Evaluates rules against sales data and writes results back to
// competition_progress. Runs after any audit action.
// ──────────────────────────────────────────────────────────────────────────
async function recomputeAllProgress() {
  if (DEMO) return;
  if (!state.competitions.length || !state.compRules.length) return;
  try {
    // Need EVERY rep's sales for full leaderboard eval, not just mine.
    // If I'm not an admin I can only see my own, so I only compute my own progress.
    const scope = isAdminRole(state.profile?.role) ? state.allSales : state.mySales;
    const salesByRep = groupBy(scope, s => s.rep_id);
    const repIds = Object.keys(salesByRep);
    if (!isAdminRole(state.profile?.role) && !repIds.includes(state.profile.id)) repIds.push(state.profile.id);

    const rows = [];
    for (const comp of state.competitions) {
      const rules = state.compRules.filter(r => r.competition_id === comp.id);
      if (!rules.length) continue;
      for (const repId of repIds) {
        const repSales = salesByRep[repId] || [];
        for (const rule of rules) {
          const val = evaluateRule(rule, comp, repSales);
          const met = compare(val, rule.operator, Number(rule.threshold));
          rows.push({
            competition_id: comp.id,
            rule_id: rule.id,
            rep_id: repId,
            current_value: val,
            met,
            last_computed_at: new Date().toISOString(),
          });
        }
      }
    }
    if (!rows.length) return;
    const { error } = await supabase.from('competition_progress').upsert(rows, { onConflict: 'rule_id,rep_id' });
    if (error) console.warn('progress upsert', error);
    // refresh cached
    const { data: refreshed } = await supabase.from('competition_progress').select('*');
    state.compProgress = refreshed || [];
  } catch (err) {
    console.warn('recomputeAllProgress', err);
  }
}

function evaluateRule(rule, comp, sales) {
  // filter sales to the rule window
  const now = new Date();
  const startWin = windowStart(rule.window, comp);
  const endWin   = windowEnd(rule.window, comp);

  // only count approved/serviced sales toward competitions
  const eligible = sales.filter(s => {
    if (!['approved','serviced'].includes(s.audit_status)) return false;
    const d = new Date(s.sold_date + 'T00:00');
    if (d < startWin || d > endWin) return false;
    // filters
    const f = rule.filters || {};
    if (f.source_id && Array.isArray(f.source_id) && !f.source_id.includes(s.source_id)) return false;
    if (f.service_type_id && Array.isArray(f.service_type_id) && !f.service_type_id.includes(s.service_type_id)) return false;
    if (f.office_id && Array.isArray(f.office_id) && !f.office_id.includes(s.office_id)) return false;
    if (f.min_revenue && Number(s.revenue_amount) < f.min_revenue) return false;
    return true;
  });

  switch (rule.metric) {
    case 'count':        return eligible.length;
    case 'sum_revenue':  return eligible.reduce((a, s) => a + Number(s.revenue_amount || 0), 0);
    case 'sum_initial':  return eligible.reduce((a, s) => a + Number(s.initial_amount || 0), 0);
    case 'sum_monthly':  return eligible.reduce((a, s) => a + Number(s.monthly_amount || 0), 0);
    case 'avg_initial':  return eligible.length ? eligible.reduce((a, s) => a + Number(s.initial_amount || 0), 0) / eligible.length : 0;
    case 'close_rate':   return 0.6; // placeholder — needs lead data
    default: return 0;
  }
}

function windowStart(window, comp) {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  switch (window) {
    case 'day':         return d;
    case 'week': { const s = new Date(d); s.setDate(s.getDate() - s.getDay()); return s; }
    case 'month':       return new Date(now.getFullYear(), now.getMonth(), 1);
    case 'competition': return new Date(comp.start_date + 'T00:00');
    default: return new Date(0);
  }
}
function windowEnd(window, comp) {
  const now = new Date();
  switch (window) {
    case 'day':         return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
    case 'week':        return now;
    case 'month':       return now;
    case 'competition': return new Date(comp.end_date + 'T23:59');
    default: return now;
  }
}
function compare(a, op, b) {
  switch (op) {
    case '>':  return a > b;
    case '>=': return a >= b;
    case '<':  return a < b;
    case '<=': return a <= b;
    case '=':  return a === b;
    case '!=': return a !== b;
    default:   return false;
  }
}
function metricLabel(m) {
  return ({
    count: 'Count',
    sum_revenue: 'Σ Revenue',
    sum_initial: 'Σ Initial',
    sum_monthly: 'Σ Monthly',
    avg_initial: 'Avg Initial',
    close_rate: 'Close rate',
    saves_count: 'Saves',
  })[m] || m;
}
function groupBy(arr, fn) {
  return arr.reduce((acc, x) => { const k = fn(x); (acc[k] ||= []).push(x); return acc; }, {});
}

