-- Paid since the sale (per Isaac, Oct 15 2026): has the customer made a successful payment on/after
-- the sale / add-on day? Drives auto-NSF (declined, never paid) and "charged upfront" for auto-approve.
alter table public.sales add column if not exists crm_paid_since_sale boolean;
alter table public.sales add column if not exists crm_paid_at date;
alter table public.sales add column if not exists crm_declined_at date;
alter table public.sales add column if not exists crm_payment_checked_at timestamptz;
