-- ═══════════════════════════════════════════════════════════════════════
-- MYSTERY BOX — cross-device "opened" state (rep-UX audit #11).
-- Before this, opening a box was recorded in localStorage only: a rep who
-- opened on their phone saw the same box unopened on desktop, and admins
-- had no record of who opened what. Run once in the Supabase SQL Editor.
--   · Each user writes/reads only THEIR OWN rows
--   · Admins can read everyone's (who-opened-what audit)
-- ═══════════════════════════════════════════════════════════════════════

create table if not exists mb_opened (
  profile_id uuid not null references profiles(id) on delete cascade,
  box_id     text not null,
  opened_at  timestamptz not null default now(),
  primary key (profile_id, box_id)
);

alter table mb_opened enable row level security;

drop policy if exists mb_opened_own_rw on mb_opened;
create policy mb_opened_own_rw on mb_opened
  for all using (profile_id = auth.uid()) with check (profile_id = auth.uid());

drop policy if exists mb_opened_admin_read on mb_opened;
create policy mb_opened_admin_read on mb_opened
  for select using (exists (
    select 1 from profiles p where p.id = auth.uid() and p.role in ('admin', 'admin_rep')
  ));
