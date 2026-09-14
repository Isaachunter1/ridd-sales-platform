-- Server-only key/value cache for Netlify functions (QuickBooks spend via
-- Windsor, etc.). RLS enabled with NO policies: only the service-role key
-- (functions) can read/write — signed-in users can't see it. Run once in
-- Supabase → SQL editor.
create table if not exists public.server_cache (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.server_cache enable row level security;
