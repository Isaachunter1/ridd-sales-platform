// ┌─ account-integrity ─────────────────────────────────────────────────────
// │ Reporting → Auditing → Account Integrity (per Isaac, Oct 20 + Oct 27):
// │ customer-record edits and duplicate contact details worth an audit look —
// │ one-digit phone changes, small email edits, autopay turned off soon after
// │ the sale, the rep's own contact info on a customer, and one phone / email /
// │ address / card shared by accounts FieldRoutes doesn't link. The rules are
// │ in functions/integrityFlags.js.
// │
// │ Writes public.account_integrity_flags (admins only under RLS — it holds
// │ customer names and contact details). Each run inserts its rows, then
// │ deletes every older run's, so a failed run leaves the last good set.
// │ Nothing is published to the bucket; a dry run writes the rows to
// │ server/dryrun/integrity/account-integrity.json for review.
// └─────────────────────────────────────────────────────────────────────────
import { job } from '../../../runtime/job.js';
import { fetchIntegrityRows } from '../functions/fetchIntegrityRows.js';
import { integrityFlags, summarize } from '../functions/integrityFlags.js';

const EDIT_DAYS = 90;       // change-log edits looked at
const CONTACT_DAYS = 365;   // customers sold in the last year are compared for shared details
const iso = (d) => d.toISOString().slice(0, 10);

export default job('account-integrity', {
  schedule: '15 9 * * *',   // 09:15 UTC — overnight in every RIDD market, after RevHawk's nightly refresh
  description: 'Account Integrity flags (Auditing tab) → public.account_integrity_flags',
  timeoutMinutes: 20,
  onFail: 'Auditing → Account Integrity keeps showing the last good set until this recovers.',
}, async (ctx) => {
  const day = 86400000;
  const editsStart = iso(new Date(ctx.now.getTime() - EDIT_DAYS * day));
  const contactsStart = iso(new Date(ctx.now.getTime() - CONTACT_DAYS * day));

  await ctx.stage('querying');
  const rows = await fetchIntegrityRows({ editsStart, contactsStart });
  ctx.log.info('rows', { edits: rows.edits.length, contacts: rows.contacts.length, employees: rows.employees.length });

  await ctx.stage('flagging');
  const computedAt = ctx.now.toISOString();
  const version = ctx.env.JOB_VERSION || null;
  const flags = integrityFlags(rows).map(f => ({ ...f, computed_at: computedAt, source_version: version, window_start: editsStart }));
  const summary = { ...summarize(flags), edits: rows.edits.length, customers: rows.contacts.length };

  if (ctx.dryRun) {
    await ctx.publish('integrity/account-integrity.json', Buffer.from(JSON.stringify({ computedAt, summary, flags }, null, 1)));
    return summary;
  }

  await ctx.stage('writing');
  for (let i = 0; i < flags.length; i += 500) {
    const { error } = await ctx.supabase.from('account_integrity_flags').insert(flags.slice(i, i + 500));
    if (error) throw new Error('insert account_integrity_flags failed: ' + error.message + ' (run db/migrations/20261027_account_integrity_flags.sql?)');
  }
  const { error: delErr } = await ctx.supabase.from('account_integrity_flags').delete().lt('computed_at', computedAt);
  if (delErr) throw new Error('clearing older flags failed: ' + delErr.message);
  return summary;
});
