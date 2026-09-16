-- Tracks which migration files have been applied to this database.
create table if not exists public.schema_migrations (
  name        text primary key,
  applied_at  timestamptz not null default now()
);
alter table public.schema_migrations enable row level security;
drop policy if exists "schema_migrations: admin read" on public.schema_migrations;
create policy "schema_migrations: admin read" on public.schema_migrations
  for select using (public.is_admin());
