-- pay_upfront_collected.sql — re-runnable. Adds the "Charged Upfront" flag
-- from the Sales_Loyalty Reporting sheet (SALES!Upfront column): TRUE when
-- payment was collected at signing. Feeds the Charge Upfront % tier that
-- multiplies the whole upfront commission (>=70% -> 100%, >=50% -> 95%,
-- >=35% -> 90%, <35% -> 85%). Tier thresholds are editable in Settings ->
-- Pricing; per-sale flag is set on the New Sale / Edit modal.
alter table public.sales add column if not exists upfront_collected boolean default false;
