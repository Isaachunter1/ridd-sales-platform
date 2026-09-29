-- 20260929_add_ons_lifecycle.sql — re-runnable. Paste into the Supabase SQL editor
-- (after 20260922_add_ons.sql).
-- Add-on lifecycle (per Isaac, Sep 29): add-ons live as line items on the
-- subscription's RECURRING ticket (FieldRoutes templateType 'R'). The sync
-- now reads those tickets directly and records when each add-on appeared,
-- who it is credited to, when it disappeared (item removed or subscription
-- cancelled), and the base plan it sits on.
alter table public.add_ons add column if not exists recurring_ticket_id text;
alter table public.add_ons add column if not exists base_service text;          -- the subscription's service type (the base plan)
alter table public.add_ons add column if not exists last_seen_at timestamptz;   -- last sweep that found the item on the recurring ticket
alter table public.add_ons add column if not exists removed_at date;            -- item gone from the recurring ticket, or subscription cancelled
alter table public.add_ons add column if not exists removed_reason text;        -- 'item_removed' | 'subscription_cancelled'
create index if not exists add_ons_open_idx on public.add_ons (subscription_id) where removed_at is null;
