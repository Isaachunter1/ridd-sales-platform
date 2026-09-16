-- Automated upsells (per Isaac, Sep 2026). RIDD is moving from "change the
-- subscription's service type" to "add an add-on via a service ticket" in
-- FieldRoutes. Once that switch is made in the CRM, flip Upsells to
-- Automatic in Settings → Configurations → Auto-log and the sync creates one
-- sale per add-on ticket (sale_kind = 'upsell'), attributed to the employee
-- who created the ticket. Until then the Log Sale form stays for upsells.
alter table public.sales add column if not exists sale_kind text not null default 'sale';   -- 'sale' | 'upsell'
alter table public.sales add column if not exists crm_ticket_id text;                        -- FieldRoutes ticket the upsell came from
alter table public.sales add column if not exists parent_subscription_id text;               -- the subscription the add-on rides on
create unique index if not exists sales_crm_ticket_uidx on public.sales (crm_ticket_id) where crm_ticket_id is not null;
