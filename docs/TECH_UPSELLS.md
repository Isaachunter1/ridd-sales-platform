# Technician upsells, add-ons and pay — build spec

Status: **skeleton** (Sep 22 2026). Data model + workers exist; no pay math,
no new tabs yet. This file is the source of truth for what the old in-house
platform did (Isaac's screenshots, Sep 22) and the COO's payout rules, so the
build lands on the right infrastructure.

## 1. The business change

RIDD is consolidating 200+ service types to **< 25**. Everything else becomes an
**add-on**: a ticket item on the customer's invoice in FieldRoutes (Invoices →
Add Ticket Item), credited **per line** to the employee who sold it. The dummy
account [68003] / sub 193894 shows the shape: Pest 4 base $49 + add-on lines
$54.87, add-on lines assigned to Isaac; the same add-on is charged separately on
the initial ticket and on the recurring ticket, but it is **one add-on**.

RevHawk mirrors tickets (= invoices) and applied payments, but **not ticket
items** (`FieldRoutesTicket.fieldRoutes_items` is empty on all 1.1M rows). So:

| Need | Source |
|---|---|
| add-on appeared / who sold it / amounts | FieldRoutes API `ticketItem` (live) — `fieldroutes-addons-sync-background.js` |
| invoices on the subscription, paid or not | RevHawk `FieldRoutesTicket` + `FieldRoutesAppliedPayment` — `addon-reconcile-background.js` |
| add-on still on each invoice | FieldRoutes API `ticketItem` per ticket until RevHawk adds a TicketItem table (ask them) |
| subscription active / cancelled | RevHawk `FieldRoutesSubscription` |

## 2. Lifecycle of one add-on (`public.add_ons`)

```
added_at ──▶ upfront commissionable ──▶ 5 paid invoices in a row ──▶ locked ──▶ backend paid (quarterly)
             tech: serviced appt after     ON or after added_at,                       │
             the add-on                    add-on STILL on each invoice,     break after payout → clawback
             office: a paid invoice        unpaid invoices wait (no count,
             WITH the add-on               no break); item removed = break;
                                           subscription cancelled = break
```

`netlify/lib/add-on-streak.js` is the pure rule; `tools/addon-test.js` pins it.
`streak_status`: accruing → locked | broken | clawback (| cancelled). `invoices`
jsonb holds the qualifying tickets so "3 of 5" is auditable.

## 3. What the old platform showed (technician view)

Tabs: **Leaderboard · Production Pay · Sales Commissions** (+ **Overrides** for
managers).

**Leaderboard** — Service Pros / Offices toggle, period picker (Last Week…),
rank + Total Sold Revenue + Total Active Revenue for the viewer, podium top 3,
then a ranked table (Rank, Name, Total Sold, Office). *App equivalent today:*
Indicators leaderboard scoped by `board_scope`; needs a technician revenue
pool (personal subscriptions + add-ons) and an "active" variant.

**Production Pay** (bi-weekly, Sun–Sat ×2; pay day the Friday after) —
hours worked, expected paycheck, total earned wages, then the bonus:
- Qualified Production = 80h-capped serviced production × **production rate 22%**
- Bonus = Qualified Production − 80h workweek pay
- Qualifiers: worked ≥ **72 h**, QP > wages, sales ≥ **$200** in the period
- daily table (date, qualified production, rate, total production) + calendar
  with Last/This Pay Period and Pay Day bands
*Inputs the app already has:* tech-stats (production per appointment via
`FieldRoutesTicket.productionValue`, check-in/out hours) — `tech-stats-background.js`.
*Missing:* hourly wage per tech, pay-period calendar, production rate setting.

**Sales Commissions** (quarterly; "These lock each quarter, subject to RIDD's
audit") — per rep: rate **25%**, Expected Net Payout = gross commission −
upfront advances already paid (**$50/job**) − clawbacks + reverse clawbacks −
manual deductions. Sales Volume split **Personal** vs **Upsells** with "N of M
qualified". Sales Detail rows: OK ✓/✗, customer #id, chips **SERVICED · ACTIVE ·
APAY · NO BALANCE** (+ `bal $200` when a balance exists), subscription name with
class line (`Ancillary · Passed Audit`, `Upsell · Upsell`, `Pest`), Sold date,
Contract value, Comm. (= rate × CV when all four chips are ✓, else $0).

**Overrides** (manager) — rate **5%** on qualified sales across a branch scope
(`Technician Sales`), **excluding the manager's own sales**; same Personal /
Upsells split; clawbacks / reverse clawbacks mirrored at 5%; By Branch table
(Sales, Qualified CV, Serviced production + qualified÷serviced ratio "for
context only", Gross, Adjustments, Net); By Rep table (Sales, Qualified CV, Rep
payout, Your gross, Adjustments, Your net); deduction rows show the reason
(`Not active`, `Has balance`, `Canceled — reverted`, `Now serviced`) and the
"Tech side" amount alongside the manager's.

A sale from Q2 can be clawed back in Q3 and re-qualify in Q4 — so pay is a
**ledger of events per quarter**, not a recomputation.

## 4. Data model (migration `20260922_add_ons.sql`)

- `add_ons` — one row per (subscription, add-on service); credited employee +
  profile; initial/recurring amounts; streak fields; payout stamps; `sale_id`.
- `sales.add_on_id` — the queue row an add-on created (chip "N of 5 paid").
- `tech_pay_ledger` — append-only, every pay event per rep per quarter:
  commission, upfront_advance, clawback, reverse_clawback, manual,
  override_commission / override_clawback / override_reverse; `snapshot` keeps
  the four chips as judged; `run_id` → `pay_runs`.
- `tech_override_scopes` — manager rate + offices (+ seller roles), own sales excluded.
- `tech_pay_quarters` — quarter lock.

Existing pieces reused: `sales.sale_kind='upsell'`, `crm_ticket_id`,
`parent_subscription_id`, `crm_*` lifecycle stamps (serviced / autopay /
balance / signed), `pay_runs`, the Technicians Sales queues (Upfront / Pending
Backend Lock / Archived / History), `app_settings.autolog` (`upsells`,
`upsell_services`).

## 5. Qualification (from the chips) — to implement in the pay layer

A technician sale is **qualified** for the quarter when all four hold at the
time of the run: initial service **serviced**; subscription **active**;
**autopay** on file; **no balance**. `audit` (Passed / Failed) is shown, not a
gate, in the old platform. Add-ons additionally carry the 5-invoice streak for
the **backend** portion. Upfront commissionable: tech = serviced appointment
after the add-on date; office staff = also a paid invoice that includes the
add-on.

## 6. Open items (need Isaac / COO / vendors)

1. Confirm FieldRoutes `ticketItem` endpoint + field names on the dummy
   account's recurring ticket (`normalizeItem()` TODOs).
2. Ask RevHawk for a `FieldRoutesTicketItem` table (removes the per-ticket API calls).
3. Contract value of an add-on for commission: initial + recurring × remaining
   services on the parent? (old platform showed $275 for `Pest Rodent 4`).
4. Upfront advance ($50/job) — paid on which pay period; is it per add-on or per subscription?
5. Hourly wages / production rate / pay-period calendar for Production Pay.
6. One-time import of add-ons mid-streak from the old platform (`source='import'`).
7. Which app tabs: Technicians → Sales sub-tabs get Upsells / Commissions /
   Production Pay; Reporting → Operations gets the manager Overrides view.
