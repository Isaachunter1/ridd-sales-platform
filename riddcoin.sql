-- ═══════════════════════════════════════════════════════════════════════
-- RIDDCOIN — incentive currency + marketplace (Jul 2026)
-- Run in the Supabase SQL Editor. Idempotent — safe to run again.
--
-- Model:
--   riddcoin_ledger  — append-only history. Every earn/spend/adjust is one
--                      row with WHO it hit, WHO did it, WHY, and WHEN.
--                      A user's balance = SUM(delta) of their rows.
--   riddcoin_items   — the marketplace catalog (name, cost, stock).
--
-- Writes go through TWO rpcs only (both SECURITY DEFINER):
--   riddcoin_grant(target, amount, note) — admins add/deduct coin.
--   riddcoin_spend(item)                 — a user redeems an item for
--                                          themselves; balance + stock are
--                                          checked atomically.
-- Direct INSERT/UPDATE/DELETE on the tables is denied to clients, so the
-- ledger can never be edited or backfilled from a browser console.
-- ═══════════════════════════════════════════════════════════════════════

create table if not exists riddcoin_items (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  description text,
  cost        integer not null check (cost > 0),
  stock       integer,              -- null = unlimited
  active      boolean not null default true,
  sort        integer not null default 0,
  created_at  timestamptz not null default now()
);

create table if not exists riddcoin_ledger (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references profiles(id) on delete cascade,
  delta       integer not null check (delta <> 0),   -- + earn · − spend/deduct
  kind        text not null check (kind in ('grant','deduct','spend','refund')),
  reason      text not null,
  item_id     uuid references riddcoin_items(id),
  created_by  uuid references profiles(id),
  created_at  timestamptz not null default now()
);
create index if not exists riddcoin_ledger_user_idx on riddcoin_ledger (user_id, created_at desc);

alter table riddcoin_items  enable row level security;
alter table riddcoin_ledger enable row level security;

-- Admin test (matches the app's admin roles).
create or replace function riddcoin_is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('admin','admin_rep'));
$$;

-- READS: everyone sees the catalog; users see their OWN ledger, admins all.
drop policy if exists riddcoin_items_read  on riddcoin_items;
create policy riddcoin_items_read on riddcoin_items
  for select to authenticated using (active or riddcoin_is_admin());
drop policy if exists riddcoin_ledger_read on riddcoin_ledger;
create policy riddcoin_ledger_read on riddcoin_ledger
  for select to authenticated using (user_id = auth.uid() or riddcoin_is_admin());
-- No insert/update/delete policies → client writes are denied; the RPCs
-- below (SECURITY DEFINER) are the only write path.

-- Admins manage the catalog through this rpc.
create or replace function riddcoin_save_item(
  p_id uuid, p_name text, p_cost integer, p_stock integer,
  p_active boolean, p_description text default null, p_delete boolean default false
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not riddcoin_is_admin() then raise exception 'admin only'; end if;
  if p_delete then
    delete from riddcoin_items where id = p_id;
    return p_id;
  end if;
  if p_id is null then
    insert into riddcoin_items (name, cost, stock, active, description)
      values (trim(p_name), p_cost, p_stock, coalesce(p_active, true), p_description)
      returning id into v_id;
  else
    update riddcoin_items
      set name = trim(p_name), cost = p_cost, stock = p_stock,
          active = coalesce(p_active, true), description = p_description
      where id = p_id returning id into v_id;
  end if;
  return v_id;
end $$;

-- Admins add (+amount) or deduct (−amount) coin, with a required reason.
create or replace function riddcoin_grant(p_user uuid, p_amount integer, p_reason text)
returns integer
language plpgsql security definer set search_path = public as $$
declare v_balance integer;
begin
  if not riddcoin_is_admin() then raise exception 'admin only'; end if;
  if p_amount = 0 then raise exception 'amount cannot be zero'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'a reason is required'; end if;
  insert into riddcoin_ledger (user_id, delta, kind, reason, created_by)
    values (p_user, p_amount, case when p_amount > 0 then 'grant' else 'deduct' end, trim(p_reason), auth.uid());
  select coalesce(sum(delta), 0) into v_balance from riddcoin_ledger where user_id = p_user;
  return v_balance;
end $$;

-- A user redeems an item FOR THEMSELVES. Atomic: the item row is locked,
-- stock and balance are re-checked inside the transaction, then the spend
-- row lands and stock decrements. Returns the new balance.
create or replace function riddcoin_spend(p_item uuid)
returns integer
language plpgsql security definer set search_path = public as $$
declare v_item riddcoin_items%rowtype; v_balance integer;
begin
  select * into v_item from riddcoin_items where id = p_item and active for update;
  if not found then raise exception 'item not available'; end if;
  if v_item.stock is not null and v_item.stock <= 0 then raise exception 'out of stock'; end if;
  select coalesce(sum(delta), 0) into v_balance from riddcoin_ledger where user_id = auth.uid();
  if v_balance < v_item.cost then raise exception 'not enough RIDDCOIN (balance %, cost %)', v_balance, v_item.cost; end if;
  insert into riddcoin_ledger (user_id, delta, kind, reason, item_id, created_by)
    values (auth.uid(), -v_item.cost, 'spend', 'Marketplace: ' || v_item.name, v_item.id, auth.uid());
  if v_item.stock is not null then
    update riddcoin_items set stock = stock - 1 where id = v_item.id;
  end if;
  return v_balance - v_item.cost;
end $$;

grant execute on function riddcoin_is_admin() to authenticated;
grant execute on function riddcoin_save_item(uuid, text, integer, integer, boolean, text, boolean) to authenticated;
grant execute on function riddcoin_grant(uuid, integer, text) to authenticated;
grant execute on function riddcoin_spend(uuid) to authenticated;
