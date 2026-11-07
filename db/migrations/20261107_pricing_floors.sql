-- Pricing floors + signed-contract rule + Flagged for Audit (per Isaac, Nov 7 2026).
--
--   · audit_status 'flagged_for_audit': the rules could not price it (a renewal under
--     Loyalty, a plan or add-on with no sheet) or a rep picked a status by hand — an
--     auditor decides; never auto-approved, never paid while flagged.
--   · sales.status_set_by: who set the current status — 'manual' (admin / auditor /
--     rep), 'pricing-floors' (the server job), null (the sync / default). The job only
--     reverses its own decisions and never touches a manual one.
--   · sales.requested_status: what a rep asked for when their pick was flagged.
--   · sales.audit_flag (+ _by): what an auditor should look at, shown on the row.
--   · sales.payroll_skipped_at: a Not Payable sale a payroll run went past — it moves
--     from Upfront to Archived; cleared if the sale recovers, so it comes back.
--   · reps may move their OWN pending sale to flagged_for_audit (the status picker on
--     their feed); everything else stays admin / auditor.
-- Safe to re-run.

alter type public.audit_status add value if not exists 'flagged_for_audit';

alter table public.sales add column if not exists status_set_by text;
alter table public.sales add column if not exists requested_status text;
alter table public.sales add column if not exists audit_flag text;
alter table public.sales add column if not exists audit_flag_by text;
alter table public.sales add column if not exists payroll_skipped_at timestamptz;

create index if not exists sales_audit_flag_idx on public.sales (audit_flag) where audit_flag is not null;

drop policy if exists "sales: self update pending" on public.sales;
create policy "sales: self update pending" on public.sales
  for update
  using (
    (rep_id = auth.uid() and audit_status = 'pending')
    or public.is_admin_or_auditor()
  )
  with check (
    -- text compare: the enum value added above can't be named in the same transaction
    (rep_id = auth.uid() and audit_status::text in ('pending', 'flagged_for_audit'))
    or public.is_admin_or_auditor()
  );

insert into public.schema_migrations (name) values ('20261107_pricing_floors.sql') on conflict do nothing;
