-- ────────────────────────────────────────────────────────────────────────
-- AUDITING TAB SCHEMA
--
-- One row per audited account (D2D). Audit CSVs (one per branch, same
-- format as the Destin D2D Audit sheet) are uploaded on the Auditing tab
-- and upserted here by account_id, so re-uploads update results in place
-- and every admin sees the same data.
--
-- Re-runnable: every statement uses IF NOT EXISTS / OR REPLACE.
-- ────────────────────────────────────────────────────────────────────────

create table if not exists public.audit_accounts (
  account_id  text primary key,          -- FieldRoutes customer/account ID
  office      text,                      -- branch (from CSV column or picked at upload)
  rep         text,                      -- sales rep name
  customer    text,                      -- customer name
  sold_date   text,                      -- as written in the sheet (e.g. '3/14')
  result      text,                      -- 'passed' | 'failed'
  checks      jsonb,                     -- {apruv:'Yes'|'No', card_on_file:..., ...}
  notes       text,
  updated_at  timestamptz default now(),
  updated_by  uuid references auth.users(id)
);

create index if not exists audit_accounts_office_idx on public.audit_accounts (office);
create index if not exists audit_accounts_rep_idx    on public.audit_accounts (rep);

alter table public.audit_accounts enable row level security;

drop policy if exists "audit_accounts: admin all" on public.audit_accounts;
create policy "audit_accounts: admin all"
  on public.audit_accounts
  for all using (public.is_admin()) with check (public.is_admin());

grant select, insert, update, delete on public.audit_accounts to authenticated;
