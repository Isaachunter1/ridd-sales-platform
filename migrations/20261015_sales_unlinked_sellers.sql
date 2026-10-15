-- 20261015_sales_unlinked_sellers.sql — re-runnable. Paste into the Supabase SQL editor.
-- Log every FieldRoutes sale, even when the seller has no app account yet (per Isaac,
-- Oct 15: "FR attribution is what matters most, whether they are in the app or not").
-- Such a sale is stored with rep_id NULL and the FieldRoutes seller on the row; the
-- 15-minute pull hands it to the rep the moment their app account is linked to that
-- FieldRoutes login. Unlinked rows show to admins only (RLS keys reps on rep_id).
alter table public.sales alter column rep_id drop not null;
alter table public.sales
  add column if not exists crm_seller_id   text,
  add column if not exists crm_seller_name text;
create index if not exists sales_unlinked_seller_idx on public.sales (crm_seller_id) where rep_id is null;
notify pgrst, 'reload schema';
