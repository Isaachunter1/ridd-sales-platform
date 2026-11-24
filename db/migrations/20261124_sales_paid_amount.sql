-- Passed Audit, computed (per Isaac, Nov 23 2026): total collected since the sale, so the sync can check the
-- "charged upfront at least $39" part of the rule. Stamped by the paid-since-sale check (revhawk sync).
alter table public.sales add column if not exists crm_paid_amount numeric;
