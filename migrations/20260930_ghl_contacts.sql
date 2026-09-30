-- GoHighLevel contacts mirror (per Isaac, Sep 30) — the lead management
-- system of record for Marketing → Metrics (leads by provider / office,
-- last paid touch). Written ONLY by the ghl-contacts-sync-background
-- function (service role). No client policies: the app reads the compact
-- reporting/ghl/leads.json.gz the sync builds (admin-only storage).
create table if not exists public.ghl_contacts (
  id            text primary key,
  location_id   text,
  date_added    timestamptz,
  date_updated  timestamptz,
  source        text,
  first_attr    text,        -- first attribution: utm source / session source / gclid / fbclid
  last_attr     text,        -- last attribution, same shape
  phone10       text,
  email         text,
  postal_code   text,
  city          text,
  state         text,
  tags          text[],
  synced_at     timestamptz not null default now()
);
create index if not exists ghl_contacts_date_added_idx on public.ghl_contacts (date_added);
create index if not exists ghl_contacts_phone_idx on public.ghl_contacts (phone10);
create index if not exists ghl_contacts_email_idx on public.ghl_contacts (email);
alter table public.ghl_contacts enable row level security;
revoke all on public.ghl_contacts from anon, authenticated;
