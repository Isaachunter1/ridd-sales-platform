-- Eligibility stamps on sales (per Isaac, Sep 2026): EVERY subscription a rep
-- creates in FieldRoutes lands in the Sales tabs; these columns show whether
-- it can ever earn a payout — initial appointment on the books, billing on
-- file, signed agreement (crm_contract_state, from sales_crm_agreement).
-- Auto-approve waits for all the required ones (Settings → Configurations).
alter table public.sales add column if not exists crm_initial_status text;   -- Pending / Completed / Cancelled / None
alter table public.sales add column if not exists crm_autopay boolean;       -- billing on file in FieldRoutes
