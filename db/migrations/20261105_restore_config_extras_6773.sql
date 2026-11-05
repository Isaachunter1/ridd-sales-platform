-- 20261105_restore_config_extras_6773.sql
--
-- One-off repair, run once (Nov 5 2026). The Nov 2 empty-config push (history 6774) wiped more than
-- teams and rosters: the competitions jsonb lost its extras (ISL divisions + history, KOTH / Kobe Week
-- freezes, Permissions overrides + scopes, hidden pay sources), the rep aliases (duplicate merges),
-- tier years and dismissed dupes. The in-app "Config history → Restore" (run today from snapshot 6773)
-- only brings back teams / rosters / tiers / offices / the comps list — those other keys are still the
-- regenerated post-wipe defaults.
--
-- This puts the Nov 2 12:14 PM (snapshot 6773) values back for exactly those keys and leaves everything
-- else as it is now (marketing settings, admin rules, comp schedule, partner teams, teams, rosters).
-- updated_at moves forward so every open admin tab re-reads the row instead of pushing over it.
--
-- Safe to re-run; refuses to run if snapshot 6773 has been pruned.

do $$
declare
  old_c jsonb;
  cur_c jsonb;
  keep_extras text[] := array['isl', 'koth', 'kobe_week', 'perms', 'permScopes', 'payHiddenSources'];
  k text;
  new_extras jsonb;
  new_c jsonb;
begin
  select config -> 'competitions' into old_c from public.indicator_config_history where id = 6773;
  if old_c is null then
    raise exception 'indicator_config_history 6773 not found — nothing restored';
  end if;
  select competitions into cur_c from public.indicator_config where id = 1;

  -- extras: current block + the lost keys from the snapshot (snapshot wins only for those keys)
  new_extras := coalesce(cur_c -> 'extras', '{}'::jsonb);
  foreach k in array keep_extras loop
    if old_c -> 'extras' ? k then
      new_extras := new_extras || jsonb_build_object(k, old_c -> 'extras' -> k);
    end if;
  end loop;

  new_c := cur_c
    || jsonb_build_object('extras', new_extras)
    -- rep aliases: snapshot's real merges, plus anything added since (snapshot wins on a clash)
    || jsonb_build_object('repAlias', coalesce(cur_c -> 'repAlias', '{}'::jsonb) || coalesce(old_c -> 'repAlias', '{}'::jsonb))
    || jsonb_build_object('tierYears',      coalesce(old_c -> 'tierYears',      cur_c -> 'tierYears',      '{}'::jsonb))
    || jsonb_build_object('dupesDismissed', coalesce(old_c -> 'dupesDismissed', cur_c -> 'dupesDismissed', '[]'::jsonb))
    || jsonb_build_object('rankExclude',    coalesce(old_c -> 'rankExclude',    cur_c -> 'rankExclude',    '{}'::jsonb));

  update public.indicator_config
     set competitions = new_c,
         updated_at   = now()
   where id = 1;

  raise notice 'restored extras keys %, repAlias now % entries, tierYears % entries',
    (select array_agg(x) from jsonb_object_keys(new_extras) x),
    (select count(*) from jsonb_object_keys(new_c -> 'repAlias')),
    (select count(*) from jsonb_object_keys(new_c -> 'tierYears'));
end $$;

-- Check: all six extras keys present, tierYears > 0
select jsonb_object_keys(competitions -> 'extras') as extras_key from public.indicator_config where id = 1;
