-- ────────────────────────────────────────────────────────────────────────
-- P0-2 (AUDIT.md): scorecards, call audits and 1:1 meeting notes were
-- writable — and readable — by ANY signed-in user. The app only lets
-- admins and team leads grade, but the database didn't enforce it, so a
-- rep could rewrite a colleague's graded calls from the browser console.
--
-- Now: leads + admins read/write everything in these tables; everyone
-- else can read their OWN rows only and write nothing.
-- Re-runnable. Run in the Supabase SQL editor.
-- ────────────────────────────────────────────────────────────────────────
create or replace function public.is_lead_or_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and role::text in ('admin', 'admin_rep', 'rep_office_lead', 'rep_loyalty_lead', 'rep_partner', 'rep_team_lead')
  );
$$;
grant execute on function public.is_lead_or_admin() to authenticated;

-- scorecard_cards
drop policy if exists scorecard_cards_rw on public.scorecard_cards;
drop policy if exists scorecard_cards_read on public.scorecard_cards;
drop policy if exists scorecard_cards_write on public.scorecard_cards;
create policy scorecard_cards_read on public.scorecard_cards
  for select to authenticated using (profile_id = auth.uid() or public.is_lead_or_admin());
create policy scorecard_cards_write on public.scorecard_cards
  for all to authenticated using (public.is_lead_or_admin()) with check (public.is_lead_or_admin());

-- call_audits
drop policy if exists call_audits_rw on public.call_audits;
drop policy if exists call_audits_read on public.call_audits;
drop policy if exists call_audits_write on public.call_audits;
create policy call_audits_read on public.call_audits
  for select to authenticated using (profile_id = auth.uid() or public.is_lead_or_admin());
create policy call_audits_write on public.call_audits
  for all to authenticated using (public.is_lead_or_admin()) with check (public.is_lead_or_admin());

-- scorecard_meetings (1:1 notes)
drop policy if exists scorecard_meetings_rw on public.scorecard_meetings;
drop policy if exists scorecard_meetings_read on public.scorecard_meetings;
drop policy if exists scorecard_meetings_write on public.scorecard_meetings;
create policy scorecard_meetings_read on public.scorecard_meetings
  for select to authenticated using (profile_id = auth.uid() or public.is_lead_or_admin());
create policy scorecard_meetings_write on public.scorecard_meetings
  for all to authenticated using (public.is_lead_or_admin()) with check (public.is_lead_or_admin());
