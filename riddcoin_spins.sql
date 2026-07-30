-- ═══════════════════════════════════════════════════════════════════════
-- RIDDCOIN SPINS — icybox-style chance purchases (Jul 2026).
-- Run AFTER riddcoin.sql, in the Supabase SQL Editor. Safe to re-run.
--
-- A "spin" is a riddcoin_items row whose description holds JSON:
--   {"spin":true,"pool":[{"name":"AirPods","odds":5,"rarity":"gold"}, …]}
-- The admin builds these in Marketplace → Manage → 🎰 Spin builder.
--
-- riddcoin_spin(item) is the ONLY way to play: it locks the item, checks
-- stock + balance, rolls the prize SERVER-SIDE from the pool odds, writes
-- one ledger spend row ("Spin: Gold Spin → AirPods"), decrements stock,
-- and returns the prize name. The client only animates the result —
-- nothing about the outcome is decided in the browser.
-- ═══════════════════════════════════════════════════════════════════════

create or replace function riddcoin_spin(p_item uuid)
returns text
language plpgsql security definer set search_path = public as $spin$
declare
  v_item    riddcoin_items%rowtype;
  v_balance integer;
  v_pool    jsonb;
  v_total   numeric := 0;
  v_roll    numeric;
  v_acc     numeric := 0;
  v_prize   text := null;
  v_entry   jsonb;
begin
  select * into v_item from riddcoin_items where id = p_item and active for update;
  if not found then raise exception 'spin not available'; end if;
  if v_item.stock is not null and v_item.stock <= 0 then raise exception 'out of stock'; end if;

  begin
    v_pool := (v_item.description)::jsonb -> 'pool';
  exception when others then
    v_pool := null;
  end;
  if v_pool is null or jsonb_typeof(v_pool) <> 'array' or jsonb_array_length(v_pool) = 0 then
    raise exception 'this item is not a spin';
  end if;

  select coalesce(sum(delta), 0) into v_balance from riddcoin_ledger where user_id = auth.uid();
  if v_balance < v_item.cost then raise exception 'not enough RIDDCOIN'; end if;

  for v_entry in select * from jsonb_array_elements(v_pool) loop
    v_total := v_total + coalesce((v_entry->>'odds')::numeric, 0);
  end loop;
  if v_total <= 0 then raise exception 'spin odds not configured'; end if;

  v_roll := random() * v_total;
  for v_entry in select * from jsonb_array_elements(v_pool) loop
    v_acc := v_acc + coalesce((v_entry->>'odds')::numeric, 0);
    if v_prize is null and v_roll <= v_acc then v_prize := v_entry->>'name'; end if;
  end loop;
  if v_prize is null then v_prize := v_pool->(jsonb_array_length(v_pool) - 1)->>'name'; end if;

  insert into riddcoin_ledger (user_id, delta, kind, reason, item_id, created_by)
    values (auth.uid(), -v_item.cost, 'spend', 'Spin: ' || v_item.name || ' → ' || v_prize, v_item.id, auth.uid());
  if v_item.stock is not null then
    update riddcoin_items set stock = stock - 1 where id = v_item.id;
  end if;
  return v_prize;
end $spin$;

grant execute on function riddcoin_spin(uuid) to authenticated;
