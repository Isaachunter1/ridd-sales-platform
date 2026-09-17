-- Derived Indicators dataset as tables (written by derive-worker-background
-- every sync, replace-all, stamped computed_at). indicator_sales = the exact
-- per-sale rows the app's Indicators pages compute from (customer identity
-- stripped); indicator_weekly = the weekly branch rows. Exposed to riddmarket
-- through market_feed.
create table if not exists public.indicator_sales (
  id bigserial primary key,
  computed_at timestamptz not null,
  office text, subscription text, active text, cancel_reason text, cancel_date text,
  rep text, rep_id text, rep_type text, week integer, date_sold text, status text,
  auto_pay text, customer_flags text, serviced_date text, initial_status text, age integer,
  source text, contract text, initial_price numeric, contract_value numeric, recurring numeric, services integer
);
create index if not exists indicator_sales_rep_idx on public.indicator_sales (rep_id);
create index if not exists indicator_sales_week_idx on public.indicator_sales (week);
create index if not exists indicator_sales_computed_idx on public.indicator_sales (computed_at);
alter table public.indicator_sales enable row level security;
create policy "indicator_sales read (app users)" on public.indicator_sales for select to authenticated using (true);

create table if not exists public.indicator_weekly (
  id bigserial primary key,
  computed_at timestamptz not null,
  week integer, date_label text, iso_start text, branch text,
  sold_accounts integer, revenue numeric, avg_initial numeric, avg_initial_count integer,
  auto_pay_pct numeric, audit_fail integer, last_resort integer, multi_years integer, twelve_month integer, reps integer
);
create index if not exists indicator_weekly_computed_idx on public.indicator_weekly (computed_at);
alter table public.indicator_weekly enable row level security;
create policy "indicator_weekly read (app users)" on public.indicator_weekly for select to authenticated using (true);

create or replace view market_feed.indicator_sales as select * from public.indicator_sales;
create or replace view market_feed.indicator_weekly as select * from public.indicator_weekly;
grant select on market_feed.indicator_sales, market_feed.indicator_weekly to market_ro;
insert into public.schema_migrations (name) values ('20260917_indicator_tables.sql') on conflict do nothing;
