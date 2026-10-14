-- 20261014c_sales_paid_invoices.sql — re-runnable. Paste into the Supabase SQL editor.
-- Inside Sales backend lock = 4 paid invoices on the plan, the initial's invoice
-- included (per Isaac, Oct 14). The RevHawk sync counts them once a day per sale
-- still waiting on its backend lock and stamps the count here; the Sales tab shows
-- "3 of 4 invoices paid" from it. Without these columns the count is skipped and
-- Inside Sales sales simply wait (nothing locks on the old rules).
alter table public.sales
  add column if not exists crm_paid_invoices    integer,
  add column if not exists crm_paid_invoices_at timestamptz;
