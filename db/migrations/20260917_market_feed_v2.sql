-- market_feed v2: read-only views for riddmarket (Cam), no pay data, no customer names,
-- no contact info. Views run as owner (postgres) so RLS on the base tables is bypassed
-- on purpose — the column lists below are the access control. Keep them explicit.
-- Default privileges are scoped to the market_feed schema only (never public).

create schema if not exists market_feed;
grant usage on schema market_feed to market_ro;

-- Lookups (full)
create or replace view market_feed.offices as
  select id, name, created_at from public.offices;
create or replace view market_feed.service_types as
  select id, name, created_at from public.service_types;
create or replace view market_feed.sources as
  select id, name, is_renewal, is_active, fr_source_id, fr_visible, created_at from public.sources;

-- Reporting config (drop updated_by)
create or replace view market_feed.reporting_service_config as
  select service_name, category, is_recurring, is_hidden, recurring_override, lifecycle, updated_at from public.reporting_service_config;
create or replace view market_feed.reporting_source_config as
  select source, included, revenue_class, updated_at from public.reporting_source_config;
create or replace view market_feed.reporting_cancel_config as
  select reason, counts_attrition, updated_at from public.reporting_cancel_config;

-- Uploads (drop uploaded_by, storage_path, notes)
create or replace view market_feed.reporting_uploads as
  select id, uploaded_at, filename, row_count from public.reporting_uploads;

-- Subscriptions snapshot (drop customer first/last name)
create or replace view market_feed.reporting_subscriptions as
  select id, upload_id, customer_id, annual_recurring_value, subscription_contract_value, initial_price,
         sold_by_id, sold_by, sold_by_type, subscription, subscription_status, subscription_cancellation_reason,
         subscription_date_canceled, initial_service, subscription_completed_services, subscription_source,
         recurring_frequency, agreement_length, county, country, state, zip_code, office_name, days_past_due, customer_flags
  from public.reporting_subscriptions;

-- Sales (drop customer name/number, notes, and every payroll/commission column)
create or replace view market_feed.sales as
  select id, rep_id, office_id, service_type_id, contract_type_id, contract_months, source_id,
         initial_amount, monthly_amount, num_services, pay_per_service, revenue_amount, sold_date, bill_date,
         paid_in_full, is_commercial, audit_status, lock_status, subscriptions, appointments_completed, aging,
         subscription_type, queue_type, sale_kind, crm_subscription_id, crm_status, crm_subscription,
         crm_contract_value, crm_contract_state, crm_contract_signed_at, crm_initial_status, crm_autopay,
         parent_subscription_id, created_at, updated_at
  from public.sales;

-- Audits (drop customer name, notes, updated_by)
create or replace view market_feed.audit_accounts as
  select account_id, office, rep, sold_date, result, checks, updated_at from public.audit_accounts;

-- FieldRoutes roster (drop email, phone, username, last_login)
create or replace view market_feed.fieldroutes_employees as
  select employee_id, employee_ids, fname, lname, nickname, office_id, office_name, office_ids, type, type_label, active, synced_at
  from public.fieldroutes_employees;

-- Indicator rosters (drop updated_by)
create or replace view market_feed.indicator_rosters as
  select comp_id, team, rep_name, rep_id, updated_at from public.indicator_rosters;

grant select on all tables in schema market_feed to market_ro;
-- Future views in market_feed only (public keeps per-table grants)
alter default privileges for role postgres in schema market_feed grant select on tables to market_ro;

insert into public.schema_migrations (name) values ('20260917_market_feed_v2.sql') on conflict do nothing;
