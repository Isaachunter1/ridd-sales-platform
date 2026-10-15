-- Campaign + click id on GoHighLevel contacts (per Isaac, Oct 15 — Marketing Pulse campaign drilldowns).
-- Written by ghl-contacts-sync-background from the contact's first / last attribution (UTM campaign or
-- campaign name; gclid / fbclid presence). The sync re-walks existing contacts once to fill them in.
alter table public.ghl_contacts add column if not exists first_campaign text;
alter table public.ghl_contacts add column if not exists last_campaign  text;
alter table public.ghl_contacts add column if not exists first_click    text;   -- 'gclid' | 'fbclid'
alter table public.ghl_contacts add column if not exists last_click     text;
