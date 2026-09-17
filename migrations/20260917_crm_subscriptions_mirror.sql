-- Live CRM subscription mirror + riddmarket views.
-- revhawk-sync-background writes every FieldRoutes subscription here each run
-- (one row per subscription_id, stale rows deleted). The app keeps reading the
-- gzipped snapshot; this table exists so the same rows are queryable in SQL.

create table if not exists public.crm_subscriptions (
  subscription_id text primary key,
  customer_id text,
  sold_date date,
  sold_at timestamp,
  sold_by_id text,
  sold_by text,
  sold_by_type text,
  subscription text,
  subscription_status text,
  initial_status text,
  initial_service date,
  initial_serviced_date date,
  subscription_completed_services integer,
  subscription_cancellation_reason text,
  subscription_date_canceled date,
  subscription_source text,
  lead_source text,
  recurring_frequency text,
  agreement_length integer,
  annual_recurring_value numeric,
  subscription_contract_value numeric,
  initial_price numeric,
  customer_auto_pay text,
  customer_flags text,
  customer_missing boolean not null default false,
  contract_state text,
  contract_signed_at date,
  county text,
  state text,
  zip_code text,
  office_name text,
  days_past_due integer,
  responsible_balance numeric,
  first_name text,
  last_name text,
  phone text,
  email text,
  synced_at timestamptz not null default now()
);
create index if not exists crm_subscriptions_sold_date_idx on public.crm_subscriptions (sold_date);
create index if not exists crm_subscriptions_sold_by_idx on public.crm_subscriptions (sold_by_id);
create index if not exists crm_subscriptions_customer_idx on public.crm_subscriptions (customer_id);
alter table public.crm_subscriptions enable row level security;
create policy "crm_subscriptions read (app users)" on public.crm_subscriptions
  for select to authenticated using (true);
-- writes come from the sync (service role) only

-- riddmarket: no names, contact info, or balances
create or replace view market_feed.crm_subscriptions as
  select subscription_id, customer_id, sold_date, sold_at, sold_by_id, sold_by, sold_by_type, subscription,
         subscription_status, initial_status, initial_service, initial_serviced_date, subscription_completed_services,
         subscription_cancellation_reason, subscription_date_canceled, subscription_source, lead_source, recurring_frequency,
         agreement_length, annual_recurring_value, subscription_contract_value, initial_price, customer_auto_pay, customer_flags,
         customer_missing, contract_state, contract_signed_at, county, state, zip_code, office_name, days_past_due, synced_at
  from public.crm_subscriptions;
grant select on market_feed.crm_subscriptions to market_ro;

-- A rep's OWN sales with the customer name, scoped by the logged-in user
-- (same rule as the app: rep_id = auth.uid()). Granted to authenticated, not
-- market_ro, so the name only ever reaches the rep it belongs to.
create or replace view market_feed.my_sales as
  select s.id, s.rep_id, s.customer_name, s.customer_number, s.office_id, s.service_type_id, s.contract_type_id,
         s.contract_months, s.source_id, s.initial_amount, s.monthly_amount, s.num_services, s.revenue_amount,
         s.sold_date, s.paid_in_full, s.is_commercial, s.audit_status, s.lock_status, s.subscription_type,
         s.queue_type, s.sale_kind, s.crm_subscription_id, s.crm_status, s.crm_contract_state, s.crm_initial_status,
         s.crm_autopay, s.created_at
  from public.sales s
  where s.rep_id = auth.uid();
grant select on market_feed.my_sales to authenticated;

insert into public.schema_migrations (name) values ('20260917_crm_subscriptions_mirror.sql') on conflict do nothing;
