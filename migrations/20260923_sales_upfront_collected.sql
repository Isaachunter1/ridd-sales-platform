-- Charge-upfront flag on sales (Passed Audit customer flag, stamped by the
-- sync; the Log Sale form's "Charged Upfront" checkbox writes it too). The
-- column was referenced from Sep 17 but never created, which made every
-- auto-log insert fail until Sep 23.
alter table public.sales add column if not exists upfront_collected boolean not null default false;
insert into public.schema_migrations (name) values ('20260923_sales_upfront_collected.sql') on conflict do nothing;
