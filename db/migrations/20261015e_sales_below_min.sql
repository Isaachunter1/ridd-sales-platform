-- Pricing minimums (per Isaac, Oct 15 2026): why a sale is under the minimum ("Initial $1 < $39 · Recurring $45 < $49").
-- NULL = not checked or at/above the minimum. Minimums live in Configurations → Pricing minimums (app_settings.autolog.pricing).
alter table public.sales add column if not exists crm_below_min text;
