-- Saved quotes from the Pricing tab (per Isaac, Nov 24 2026): a rep saves the quote they built under a customer
-- name and reopens it later (callbacks). D2D Pricing / minimums only (sales reps). Saved to the rep's account, so it follows them across devices; admins see
-- everyone's. snapshot = the builder's picks (tier, frequency, plan, extras, one-time, custom prices) — no card or
-- account details, just the name the rep typed.
create table if not exists public.pricing_quotes (
  id            uuid primary key default gen_random_uuid(),
  rep_id        uuid not null references public.profiles(id) on delete cascade,
  customer_name text not null check (char_length(customer_name) between 1 and 120),
  tier          text,
  initial       numeric,
  monthly       numeric,
  snapshot      jsonb not null,
  created_at    timestamptz not null default now()
);
create index if not exists pricing_quotes_rep_idx on public.pricing_quotes (rep_id, created_at desc);
alter table public.pricing_quotes enable row level security;
revoke all on public.pricing_quotes from anon;
grant select, insert, delete on public.pricing_quotes to authenticated;
drop policy if exists "pricing quotes: read own or admin" on public.pricing_quotes;
create policy "pricing quotes: read own or admin" on public.pricing_quotes for select to authenticated
  using (rep_id = auth.uid() or public.is_admin());
drop policy if exists "pricing quotes: insert own" on public.pricing_quotes;
create policy "pricing quotes: insert own" on public.pricing_quotes for insert to authenticated
  with check (rep_id = auth.uid());
drop policy if exists "pricing quotes: delete own or admin" on public.pricing_quotes;
create policy "pricing quotes: delete own or admin" on public.pricing_quotes for delete to authenticated
  using (rep_id = auth.uid() or public.is_admin());
