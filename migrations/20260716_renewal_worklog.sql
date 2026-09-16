-- ══════════════════════════════════════════════════════════════════════
-- RENEWAL WORKLOG — the shared disposition layer for the Renewals tab.
-- Run once in the Supabase SQL editor. Modeled on the old tracking sheet:
-- Result (Resigned / Not Interested / No Answer / Follow Up), Attempts,
-- Notes, Office Rep — but shared live across every agent instead of a
-- Google Sheet refreshed by hand.
-- ══════════════════════════════════════════════════════════════════════

create table if not exists public.renewal_worklog (
  customer_id text primary key,
  result      text default '',
  attempts    int  default 0,
  notes       text default '',
  worked_by   text default '',
  updated_at  timestamptz default now()
);

alter table public.renewal_worklog enable row level security;

-- Any signed-in user (agents work the list; admins review it).
create policy "renewal worklog read"  on public.renewal_worklog
  for select to authenticated using (true);
create policy "renewal worklog write" on public.renewal_worklog
  for insert to authenticated with check (true);
create policy "renewal worklog update" on public.renewal_worklog
  for update to authenticated using (true);

-- Verify: open the Renewals tab, set a Result on any row, then:
--   select * from renewal_worklog order by updated_at desc limit 5;
