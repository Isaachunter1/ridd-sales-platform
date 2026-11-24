-- GoHighLevel "opportunity created" events (per Isaac, Nov 24 2026): the stage an opportunity was CREATED in
-- (New Lead - Calls / New Lead - Forms / AI Calls), captured the moment Pest AI's workflow fires — reps disposition
-- calls within minutes, so the hourly sync almost never sees a call card in its first stage. Written ONLY by
-- netlify/functions/ghl-opp-webhook.js (service role); the contacts sync reads it when it builds
-- reporting/ghl/leads.json.gz. First event per opportunity wins (later re-fires never overwrite it).
create table if not exists public.ghl_opp_created (
  opp_id       text primary key,          -- GoHighLevel opportunity id, or 'c:<contact id>:<epoch ms>' when the payload had none
  contact_id   text,
  created_at   timestamptz,
  received_at  timestamptz not null default now(),
  stage_id     text,
  stage_name   text,
  pipeline_id  text,
  source       text
);
create index if not exists ghl_opp_created_contact_idx on public.ghl_opp_created (contact_id);
create index if not exists ghl_opp_created_received_idx on public.ghl_opp_created (received_at);
alter table public.ghl_opp_created enable row level security;
revoke all on public.ghl_opp_created from anon, authenticated;
