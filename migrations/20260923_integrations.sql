-- Data sources (per Isaac, Sep 23): integrations configured from Settings →
-- Data sources so the product can be onboarded per company. Secrets are only
-- ever read by the Netlify functions (service role); admins see a masked view.
create table if not exists public.integrations (
  id text primary key,                       -- 'fieldroutes' | 'revhawk' | …
  config jsonb not null default '{}'::jsonb,  -- non-secret settings (subdomain, domain, enabled…)
  secrets jsonb not null default '{}'::jsonb, -- api keys / tokens — never exposed to the browser
  status jsonb not null default '{}'::jsonb,  -- last test / last run, written by the functions
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);
alter table public.integrations enable row level security;
-- No direct client access at all: reads go through the masked view, writes through the integrations-admin function.
create or replace view public.integrations_public as
  select id, config, status, updated_at,
         (select jsonb_object_agg(k, case when v is null or v = '' then false else true end) from jsonb_each_text(secrets) as s(k, v)) as secrets_set
    from public.integrations;
grant select on public.integrations_public to authenticated;
insert into public.schema_migrations (name) values ('20260923_integrations.sql') on conflict do nothing;
