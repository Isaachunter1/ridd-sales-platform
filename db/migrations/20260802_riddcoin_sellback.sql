-- ═══════════════════════════════════════════════════════════════════════
-- RIDDCOIN SELL-BACK — reps can sell a spin-won prize back to RIDD for
-- 90% of its configured Value, so they can keep spinning for the prize
-- they actually want. Run AFTER riddcoin.sql + riddcoin_spins.sql.
--
--   · Each prize in a spin pool carries {"value": N} (set in Spin builder)
--   · riddcoin_sellback(ledger_row) verifies: the row is YOURS, it's a
--     spin winning, it hasn't been sold back already, and the prize has a
--     value — then credits floor(value * 0.9) as a 'refund' ledger row
--     linked to the original (ref_id), which is what blocks double-sells.
-- ═══════════════════════════════════════════════════════════════════════

alter table riddcoin_ledger add column if not exists ref_id uuid references riddcoin_ledger(id);

create or replace function riddcoin_sellback(p_ledger uuid)
returns integer
language plpgsql security definer set search_path = public as $sb$
declare
  v_row    riddcoin_ledger%rowtype;
  v_item   riddcoin_items%rowtype;
  v_prize  text;
  v_pool   jsonb;
  v_entry  jsonb;
  v_val    numeric := null;
  v_payout integer;
begin
  select * into v_row from riddcoin_ledger where id = p_ledger and user_id = auth.uid() for update;
  if not found then raise exception 'not your item'; end if;
  if v_row.kind <> 'spend' or v_row.reason not like 'Spin: %' then
    raise exception 'only spin winnings can be sold back';
  end if;
  if exists (select 1 from riddcoin_ledger where ref_id = p_ledger) then
    raise exception 'already sold back';
  end if;

  v_prize := split_part(v_row.reason, ' → ', 2);
  if coalesce(v_prize, '') = '' then raise exception 'cannot determine the prize'; end if;

  select * into v_item from riddcoin_items where id = v_row.item_id;
  if not found then raise exception 'spin config missing'; end if;
  begin
    v_pool := (v_item.description)::jsonb -> 'pool';
  exception when others then
    v_pool := null;
  end;
  if v_pool is null or jsonb_typeof(v_pool) <> 'array' then raise exception 'spin config missing'; end if;

  for v_entry in select * from jsonb_array_elements(v_pool) loop
    if v_entry->>'name' = v_prize then v_val := (v_entry->>'value')::numeric; end if;
  end loop;
  if v_val is null or v_val <= 0 then raise exception 'no sell-back value set for this prize'; end if;

  v_payout := floor(v_val * 0.9);
  insert into riddcoin_ledger (user_id, delta, kind, reason, item_id, created_by, ref_id)
    values (auth.uid(), v_payout, 'refund',
            'Sold back: ' || v_prize || ' (90% of ' || v_val || ')',
            v_row.item_id, auth.uid(), p_ledger);
  return v_payout;
end $sb$;

grant execute on function riddcoin_sellback(uuid) to authenticated;
