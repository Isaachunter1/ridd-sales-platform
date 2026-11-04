-- 20261104_indicator_config_wipe_guard.sql
--
-- Why (Nov 2 2026, 22:41 UTC): an admin's browser pushed an EMPTY indicator
-- config (0 teams, 0 rep assignments, 0 tiers, 0 competitions) over a copy
-- that held 10 teams and 803 assignments. The compare-and-swap in
-- save_indicator_config passed because the device's baseline was current —
-- CAS protects against stale edits, not against a current device whose
-- in-memory state had not loaded yet. Every save since layered on the
-- empty base; restored from indicator_config_history snapshot 6773.
--
-- The guard: a payload that would take teams OR the current year's rep
-- assignments from "some" to "none" is refused with { wiped: true } unless
-- the caller passes allow_wipe => true (the app's explicit "Reset all"
-- path). Teams and rosters are only ever emptied on purpose, one at a time,
-- never all at once by a background save.
--
-- Signature changes (a third, defaulted parameter): existing callers that
-- pass two arguments keep working. The app sends allow_wipe only from an
-- explicit reset.

drop function if exists public.save_indicator_config(jsonb, timestamptz);

create or replace function public.save_indicator_config(payload jsonb, based_on timestamptz, allow_wipe boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  cur timestamptz;
  caller_role text;
  cur_teams int;
  new_teams int;
  yr text := to_char(now(), 'YYYY');
  cur_reps int;
  new_reps int;
begin
  -- Server-side admin check (SECURITY DEFINER bypasses RLS, so gate here).
  select role::text into caller_role from public.profiles where id = auth.uid();
  if caller_role is null or caller_role not like 'admin%' then
    return jsonb_build_object('ok', false, 'error', 'admins only');
  end if;

  select updated_at,
         coalesce(jsonb_array_length(case when jsonb_typeof(teams) = 'array' then teams else '[]'::jsonb end), 0),
         coalesce((select count(*) from jsonb_object_keys(coalesce(rep_teams -> yr, '{}'::jsonb))), 0)
    into cur, cur_teams, cur_reps
    from public.indicator_config where id = 1;

  -- The swap: only land if the caller's edits were based on the CURRENT
  -- server copy. A missing baseline (based_on null) with an existing server
  -- row also conflicts — a device that has never synced must read first.
  if cur is not null and (based_on is null or cur > based_on) then
    return jsonb_build_object('ok', false, 'conflict', true, 'server_updated_at', cur);
  end if;

  -- WIPE GUARD: some → none on teams or this year's roster is never a background save.
  new_teams := coalesce(jsonb_array_length(case when jsonb_typeof(payload -> 'teams') = 'array' then payload -> 'teams' else '[]'::jsonb end), 0);
  new_reps  := coalesce((select count(*) from jsonb_object_keys(coalesce(payload -> 'rep_teams' -> yr, '{}'::jsonb))), 0);
  if not allow_wipe and ((cur_teams > 1 and new_teams = 0) or (cur_reps > 20 and new_reps = 0)) then
    return jsonb_build_object('ok', false, 'wiped', true, 'server_updated_at', cur,
      'error', format('refused: this save would drop teams %s→%s and %s rep assignments %s→%s', cur_teams, new_teams, yr, cur_reps, new_reps));
  end if;

  insert into public.indicator_config
  select * from jsonb_populate_record(
    null::public.indicator_config,
    payload || jsonb_build_object('id', 1, 'updated_at', to_jsonb(now()))
  )
  on conflict (id) do update set
    teams         = excluded.teams,
    team_colors   = excluded.team_colors,
    team_logos    = excluded.team_logos,
    team_excluded = excluded.team_excluded,
    competitions  = excluded.competitions,
    rep_teams     = excluded.rep_teams,
    rep_tiers     = excluded.rep_tiers,
    rep_active    = excluded.rep_active,
    rep_offices   = excluded.rep_offices,
    updated_at    = excluded.updated_at,
    updated_by    = excluded.updated_by;

  select updated_at into cur from public.indicator_config where id = 1;
  return jsonb_build_object('ok', true, 'server_updated_at', cur);
end $$;

revoke all on function public.save_indicator_config(jsonb, timestamptz, boolean) from public;
grant execute on function public.save_indicator_config(jsonb, timestamptz, boolean) to authenticated;
