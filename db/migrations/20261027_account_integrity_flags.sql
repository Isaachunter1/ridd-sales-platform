-- Account Integrity (per Isaac, Oct 20 + Oct 27) — Reporting → Auditing →
-- Account Integrity reads this; server/services/crm/jobs/account-integrity.js
-- writes it nightly with the service role (inserts its run, then deletes older
-- runs). Holds customer names and contact details: ADMINS ONLY. Developers,
-- auditors, reps and office staff get nothing (the developer role must never
-- see customer PII or QuickBooks — per Isaac).
--
-- Idempotent: safe to run twice.
create table if not exists public.account_integrity_flags (
  id                    bigint generated always as identity primary key,
  kind                  text        not null check (kind in ('phone_one_digit', 'email_small_edit', 'autopay_off', 'rep_own_contact', 'shared_contact', 'shared_card')),
  severity              text        not null check (severity in ('red', 'amber')),
  customer_id           text        not null,
  customer_name         text,
  office                text,
  rep_name              text,        -- the rep who sold the account
  changed_by            text,        -- who made the edit (change-log flags)
  field                 text,
  old_value             text,
  new_value             text,
  changed_at            timestamptz,
  sold_on               date,
  days_after_sale       integer,
  group_key             text,        -- shared_* flags: one key per set of accounts sharing the detail
  related_customer_ids  text[],
  detail                text        not null,
  window_start          date,
  computed_at           timestamptz not null,
  source_version        text
);

create index if not exists account_integrity_flags_kind_idx on public.account_integrity_flags (kind, severity);
create index if not exists account_integrity_flags_computed_idx on public.account_integrity_flags (computed_at);

alter table public.account_integrity_flags enable row level security;

drop policy if exists account_integrity_flags_admin_read on public.account_integrity_flags;
create policy account_integrity_flags_admin_read on public.account_integrity_flags
  for select to authenticated
  using (public.is_admin());
-- No insert / update / delete policies: only the server (service role) writes.

comment on table public.account_integrity_flags is 'Account Integrity flags (Auditing tab). Written nightly by the account-integrity server job; admins read.';
