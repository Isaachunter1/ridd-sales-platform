-- Re-seed every lookup table the app needs to render the new-sale form.
-- Idempotent — unique constraints + 'on conflict do nothing' make it safe
-- to re-run. Paste this into Supabase SQL Editor → Run.

-- Schema update: admins can hide a source from the new-sale dropdown
-- without deleting it. Safe to re-run.
alter table public.sources
  add column if not exists is_active boolean not null default true;

insert into public.offices (name) values
  ('Atlanta'),
  ('Charleston'),
  ('Destin'),
  ('Detroit'),
  ('Myrtle Beach'),
  ('Raleigh'),
  ('Salt Lake'),
  ('Virginia Beach')
on conflict do nothing;
-- Full RIDD service type catalog (from SALES sheet column E validation)
insert into public.service_types (name) values
  ('Carpenter Bee 12'), ('Carpenter Bee 4'), ('Carpenter Bee 6'),
  ('German Roach 12'), ('German Roach 4'), ('German Roach 6'), ('German Roach Mole 4'),
  ('Interior Flea 12'), ('Interior Flea 4'), ('Interior Flea 6'),
  ('Mole 12'), ('Mole 4'), ('Mole 6'),
  ('Mole Mosquito 12'), ('Mole Mosquito 4'), ('Mole Mosquito 6'), ('Mole Mosquito 6 Seasonal'),
  ('Mole Mosquito Rodent 4'), ('Mole Mosquito Snake 6'),
  ('Mole Rodent 4'), ('Mole Rodent 6'),
  ('Mole Snake 4'), ('Mole Snake 6'),
  ('Mosquito 12'), ('Mosquito 4'), ('Mosquito 6'),
  ('Mosquito Rodent 12'), ('Mosquito Rodent 4'), ('Mosquito Rodent 6'),
  ('Mosquito Rodent 6 Seasonal'), ('Mosquito Rodent Snake 6 Seasonal'),
  ('Mosquito Snake 4'), ('Mosquito Snake 6'),
  ('One Time German Roach'), ('One Time Interior Flea'), ('One Time Mosquito'),
  ('One Time Pest Control'), ('One Time Rodent'), ('One Time Termite Inspection'),
  ('One Time Vehicle Inpsection'),
  ('Pest 12'), ('Pest 4'), ('Pest 4 - Spanish'), ('Pest 6'), ('Pest 6 - Spanish'),
  ('Pest Carpenter Bee 4'), ('Pest Carpenter Bee 6'), ('Pest Carpenter Bee Mole 4'),
  ('Pest Carpenter Bee Mole 6'), ('Pest Carpenter Bee Mosquito 4 Seasonal'),
  ('Pest German Roach 12'), ('Pest German Roach 4'), ('Pest German Roach 6'),
  ('Pest German Roach Mole 4'), ('Pest German Roach Mole 6'),
  ('Pest German Roach Mole Mosquito 4'), ('Pest German Roach Mole Mosquito 6'),
  ('Pest German Roach Mole Mosquito Snake 6'),
  ('Pest German Roach Mole Rodent 4'), ('Pest German Roach Mole Rodent 6'),
  ('Pest German Roach Mole Snake 4'), ('Pest German Roach Mole Snake Rodent 4'),
  ('Pest German Roach Mosquito 4'), ('Pest German Roach Mosquito 4 Seasonal'),
  ('Pest German Roach Mosquito 6'), ('Pest German Roach Mosquito Snake 4'),
  ('Pest German Roach Rodent 12'), ('Pest German Roach Rodent 4'),
  ('Pest German Roach Rodent 6'), ('Pest German Roach Rodent Snake 6'),
  ('Pest German Roach Snake 4'), ('Pest German Roach Snake 6'),
  ('Pest Interior 4'), ('Pest Interior 6'),
  ('Pest Interior Flea 4'), ('Pest Interior Flea Mole 4'), ('Pest Interior Flea Mosquito 4'),
  ('Pest Mole 12'), ('Pest Mole 4'), ('Pest Mole 6'),
  ('Pest Mole Mosquito 4'), ('Pest Mole Mosquito 4 Seasonal'),
  ('Pest Mole Mosquito 6'), ('Pest Mole Mosquito 6 Seasonal'),
  ('Pest Mole Mosquito Snake 12'), ('Pest Mole Mosquito Snake 4'),
  ('Pest Mole Mosquito Snake 6'), ('Pest Mole Mosquito Snake 6 Seasonal'),
  ('Pest Mole Rodent 4'), ('Pest Mole Rodent 6'), ('Pest Mole Rodent Snake 6'),
  ('Pest Mole Snake 4'), ('Pest Mole Snake 6'), ('Pest Mole Snake Rodent 4'),
  ('Pest Mosquito 12'), ('Pest Mosquito 4'), ('Pest Mosquito 4 - Spanish'),
  ('Pest Mosquito 4 Seasonal'), ('Pest Mosquito 6'), ('Pest Mosquito 6 - Spanish'),
  ('Pest Mosquito 6 Seasonal'), ('Pest Mosquito 6 Seasonal - Spanish'),
  ('Pest Mosquito Mole 12'),
  ('Pest Mosquito Snake 4'), ('Pest Mosquito Snake 4 Seasonal'),
  ('Pest Mosquito Snake 6'), ('Pest Mosquito Snake 6 Seasonal'),
  ('Pest Rodent 12'), ('Pest Rodent 4'), ('Pest Rodent 6'),
  ('Pest Rodent Mole 4'), ('Pest Rodent Snake 4'), ('Pest Rodent Snake 6'),
  ('Pest Snake 12'), ('Pest Snake 4'), ('Pest Snake 6'),
  ('RIDD Package 12'), ('RIDD Package 4'), ('RIDD Package 4 - Spanish'),
  ('RIDD Package 4 Seasonal'), ('RIDD Package 6'), ('RIDD Package 6 - Spanish'),
  ('RIDD Package 6 Seasonal'),
  ('RIDD Package Carpenter Bee 4'), ('RIDD Package Carpenter Bee 6 Seasonal'),
  ('RIDD Package Carpenter Bee Mole 6'), ('RIDD Package Carpenter Bee Mole 6 Seasonal'),
  ('RIDD Package Flea Mole Snake 6'),
  ('RIDD Package German Roach 12'), ('RIDD Package German Roach 4'),
  ('RIDD Package German Roach 4 Seasonal'), ('RIDD Package German Roach 6'),
  ('RIDD Package German Roach 6 Seasonal'),
  ('RIDD Package German Roach Interior Flea 4'), ('RIDD Package German Roach Interior Flea 6'),
  ('RIDD Package German Roach Mole 4'), ('RIDD Package German Roach Mole 6'),
  ('RIDD Package German Roach Mole 6 Seasonal'),
  ('RIDD Package German Roach Snake 12'), ('RIDD Package German Roach Snake 4'),
  ('RIDD Package German Roach Snake 6'), ('RIDD Package German Roach Snake 6 Seasonal'),
  ('RIDD Package Interior Flea 4'), ('RIDD Package Interior Flea 6'),
  ('RIDD Package Interior Flea 6 Seasonal'),
  ('RIDD Package Interior Flea Mole 6'),
  ('RIDD Package Interior Flea Snake 6 Seasonal'),
  ('RIDD Package Mole 12'), ('RIDD Package Mole 4'), ('RIDD Package Mole 6'),
  ('RIDD Package Mole 6 Seasonal'),
  ('RIDD Package Mole Snake 12'), ('RIDD Package Mole Snake 4'),
  ('RIDD Package Mole Snake 6'), ('RIDD Package Mole Snake 6 Seasonal'),
  ('RIDD Package Snake 12'), ('RIDD Package Snake 4'), ('RIDD Package Snake 6'),
  ('RIDD Package Snake 6 Seasonal'),
  ('Rodent 12'), ('Rodent 4'), ('Rodent 6'),
  ('Rodent Snake 4'), ('Rodent Snake 6'),
  ('Sentricon - Retreat'),
  ('Snake 12'), ('Snake 4'), ('Snake 6'),
  ('Solo Seasonal Mosquito')
on conflict do nothing;
-- Full RIDD sources catalog (from SALES sheet column G validation)
insert into public.sources (name, is_renewal) values
  ('Angi', false), ('Baton', false), ('Bing Ads', false), ('eLocal', false),
  ('Facebook', false), ('Google Ads', false), ('Google Local Services', false),
  ('Inside Sale', false), ('Pest Net', false), ('Referral', false),
  ('Service Direct', false), ('Website', false), ('Yelp', false),
  ('Renewal - Inbound', true), ('Renewal - Loyalty', true),
  ('Renewal - Outbound', true), ('Renewal - Service Pro Upsell', true)
on conflict do nothing;
-- Commercial + Paid in Full are checkbox modifiers on the sale, not contract types
insert into public.contract_types (name, implied_months) values
  ('12 Months', 12),
  ('18 Months', 18),
  ('24 Months', 24),
  ('Upsell - D2D', null),
  ('Upsell - Office', null),
  ('One Time Service', 0)
on conflict do nothing;

-- Sanity check — should each return a non-zero count.
select 'offices'        as table_name, count(*) from public.offices
union all
select 'service_types',                count(*) from public.service_types
union all
select 'sources',                      count(*) from public.sources
union all
select 'contract_types',               count(*) from public.contract_types;
