# RIDD Reporting ↔ FieldRoutes (RevHawk) Reconciliation Reference

_Last reconciled: 2026-06-17, against the live RevHawk mirror of FieldRoutes._

This document maps how the app's reporting is computed, where every number comes
from in FieldRoutes, and the ground-truth company totals so the logic can be
audited and trusted.

---

## 1. Data sources

There are **two** copies of the same FieldRoutes data, and it's important to know
which one each part of the app uses:

| Source | What it is | Used by |
|---|---|---|
| **Customer Report CSV** (uploaded) | A FieldRoutes export, frozen at upload time, parsed into a client-side "snapshot." | The whole app today — Overview, Audit, Cancellations, Sources, Inside Sales. |
| **RevHawk → BigQuery** | A **live** mirror of FieldRoutes (`revhawkdataconnect.org_ridd_pest_control_3f4149`, 25 tables). | Reconciliation / validation. Not yet wired into the app. |

The app reads the **uploaded snapshot**, so its numbers are as fresh as the last
upload. RevHawk is live, so it's the source of truth for "what does FieldRoutes
say right now." Small differences between the two are almost always upload-timing,
not logic errors.

The core table is **`FieldRoutesSubscription`** — one row per subscription ever
sold (84,187 rows). Almost all reporting derives from it.

---

## 2. Field crosswalk (FieldRoutes → app → meaning)

| FieldRoutes field | App CSV column | Meaning / notes |
|---|---|---|
| `fieldRoutes_activeText` | `subscription_status` | Status. **Only two values exist: `Active` and `Frozen`.** There is no "Cancelled" status — a cancel is `Frozen` + a cancel date. |
| `fieldRoutes_initialStatusText` | `initial_service` (proxy) | Initial appointment status. **`Completed` = serviced.** Other values: Pending, No Appointment, No Show, Cancelled. |
| `fieldRoutes_dateCancelled` | `subscription_date_canceled` | Cancel date. **Sentinel `0000-00-00 00:00:00` = NOT cancelled.** Any real date = cancelled. |
| `fieldRoutes_dateAdded` | `sold_date` | When the subscription was sold. Drives the audit date-range filter. |
| `fieldRoutes_contractValue` | `subscription_contract_value` | Total contract value (the "sold" dollar figure). |
| `fieldRoutes_annualRecurringValue` | (Active ARR) | Annualized recurring value — the basis for **Active ARR** on Overview. |
| `fieldRoutes_recurringCharge` | — | Per-cycle recurring charge. |
| `fieldRoutes_soldBy` | `sold_by` (id) | Rep — joins to `FieldRoutesEmployee.fieldRoutes_employeeID`. |
| `fieldRoutes_source` / `fieldRoutes_subSource` | `subscription_source` | Lead / sale source (Door to Door, Facebook, Inside Sale, Renewal …). |
| `fieldRoutes_officeID` | `office_name` (mapped) | Branch. Numeric here; names come from the CSV. |
| `fieldRoutes_daysPastDue`* | `days_past_due` | Delinquency. ≥ 7 days = **Aging**. (*derived from billing in RevHawk.) |

**Key gotchas**
- `0000-00-00` is the "empty date" sentinel — must be excluded or everything looks cancelled.
- For **serviced** subscriptions, status is either `Active` (open) or `Frozen` (and Frozen-serviced is **almost always cancelled**). There is essentially no "serviced + Frozen + open" bucket — which is exactly why **Serviced − Cancelled = Active** holds.
- `Frozen` is a catch-all for "not currently active" (cancelled, on hold, paused).

---

## 3. The audit revenue waterfall (final definitions)

Everything is scoped to **serviced** revenue, and the buckets are a clean partition:

```
Serviced  = subscriptions whose initial service Completed
  ├─ Active     = serviced & status Active & not cancelled   (the live book)
  │     └─ Aging = Active & 7+ days past due                 (at-risk slice)
  ├─ Cancelled  = serviced & has a real cancel date          (true churn)
  └─ Frozen/Other = serviced & not active & not cancelled    (~$0 in practice)

Serviced = Active + Cancelled + Frozen        ← ties exactly
```

- **Sold** is counted **per subscription** (a customer with 2 subs = 2 sold), not deduped per customer.
- **Pass %** = (Passed + No Audit) ÷ (Passed + Failed + No Audit) — No-Audit counts as passed; Pending excluded.
- **Attrition (of serviced)**: Cancel rate = Cancelled ÷ Serviced; "If aging churns" = (Cancelled + Aging) ÷ Serviced; Active retention = Active ÷ Serviced.

> Note: the audit's **Cancelled** is intentionally *serviced-only churn*. It is a
> smaller number than total cancellations, because accounts that were sold and
> cancelled **before** ever being serviced (sold-not-started / ROR) are excluded —
> those aren't service attrition.

---

## 4. Company ground truth (live RevHawk, all-time unless noted)

### Book of business
| Metric | Value |
|---|---|
| Total subscriptions (ever) | **84,187** |
| Active subscriptions (status Active, not cancelled) | **33,883** |
| Active customers (distinct) | **31,320** |
| Active ARR | **≈ $30.9M** |
| Cancelled subscriptions (ever) | **40,656** |

### Sold production by year (by sold date)
| Year | Subs sold | Serviced | Cancelled | Contract value |
|---|---|---|---|---|
| 2026 (YTD) | 21,167 | 13,385 | 3,735 | $21.36M |
| 2025 | 28,872 | 22,078 | 12,327 | $28.81M |
| 2024 | 20,099 | 15,995 | 13,274 | $18.46M |
| 2023 | 6,457 | 4,532 | 4,692 | $5.95M |
| 2022 | 5,976 | 4,713 | 5,334 | $5.10M |
| 2021 | 1,557 | 1,269 | 1,259 | $1.11M |

### Active book by office (active, open subs)
| Office ID | Total subs | Active (open) | Serviced | Cancelled | Active ARR |
|---|---|---|---|---|---|
| 7 | 20,913 | 7,736 | 15,420 | 11,210 | $6.89M |
| 15 | 11,818 | 5,268 | 8,647 | 5,183 | $5.24M |
| 10 | 9,848 | 5,273 | 7,845 | 3,702 | $5.04M |
| 16 | 10,861 | 4,972 | 8,516 | 4,724 | $4.26M |
| 13 | 9,959 | 4,162 | 7,220 | 4,516 | $4.03M |
| 6 | 15,419 | 4,201 | 10,717 | 8,945 | $3.56M |
| 1 | 3,335 | 1,257 | 2,895 | 1,984 | $0.91M |
| 18 | 1,369 | 816 | 740 | 264 | $0.77M |
| −1 / −7 | (placeholders / unassigned) | | | | |

_Office names live in the uploaded CSV (`office_name`); RevHawk only stores the
numeric ID. (Office 10 & 13 are Hayden Hamel's — the Destin area.)_

### 2026 source mix (sold subscriptions)
| Source | Subs | Contract value |
|---|---|---|
| Door to Door | 16,757 | $17.25M |
| Upsell – Service Pro | 907 | $1.05M |
| Facebook | 830 | $0.62M |
| Inside Sale | 500 | $0.38M |
| Google Local Services | 294 | $0.21M |
| Upsell – Termite Pro | 286 | $0.48M |
| Renewal – Service Pro Upsell | 263 | $0.33M |
| Renewal – Outbound | 204 | $0.21M |
| Website | 196 | $0.20M |
| Renewal – Loyalty | 179 | $0.10M |

Door-to-Door is ~79% of sold subscriptions. Sources beginning **Renewal –** are
renewals (excluded from the Inside Sales pacer); **Upsell –** are upsells;
everything else is new business. This is the basis for the revenue taxonomy
(new / renewal / upsell) and the marketing "office-staff-only" filter.

---

## 5. Reconciliation example — Hayden Hamel

Live RevHawk, sold by Hayden (emp IDs 18524 + 18477), all-time:

| Serviced? | Status | Cancelled? | Subs | Contract value |
|---|---|---|---|---|
| Serviced | Active | No | 133 | $162,668 |
| Serviced | Active | Yes | 1 | $1,022 |
| Serviced | Frozen | Yes | 33 | $42,493 |
| Not serviced | Active | No | 22 | $31,561 |
| Not serviced | Frozen | Yes | 54 | $72,802 |
| Not serviced | Frozen | No | 32 | $31,100 |
| Not serviced | Active | Yes | 2 | $2,585 |

**Serviced = $162,668 + $1,022 + $42,493 = $206,183** (the card's ~$205K).
- **Active** (serviced, active, open) = **$162,668**
- **Cancelled** (serviced then cancelled) = $1,022 + $42,493 = **$43,515**
- **Frozen/Other** = **$0**
- ✓ $206,183 − $43,515 = $162,668 = Active.

The original "gap" was the **$42,493** of accounts that completed their initial
service and then cancelled (and so flipped to Frozen). They belong in Cancelled,
not in a mystery gap. The reason the old card didn't tie: its Cancelled figure was
computed over *all* sold accounts and excluded ROR/sold-not-started, so it was a
different population than "the cancels that came out of Serviced."

---

## 6. Reference codes

**Employee types** (`FieldRoutesEmployee.fieldRoutes_type`): `0` (676), `1` (211),
`2` (868). Maps to the app's Sold-By-Type taxonomy (Office Staff / Technician /
Sales Rep) — the CSV provides the text label directly, so the numeric code isn't
relied on in-app. _(Exact code→label mapping to confirm with FieldRoutes.)_

**Cancellation reasons** live in `FieldRoutesCancellationReason` (lookup) and are
attached to subscriptions via `FieldRoutesCancellationNote` — not stored directly
on the subscription row. The app currently reads the reason text from the CSV
(`subscription_cancellation_reason`).

---

## 7. Open items / opportunities

- **Wire RevHawk live into the app** so reporting stops depending on manual CSV
  uploads (the snapshot would refresh itself).
- **Office ID → name map** could be stored once so RevHawk queries show branch names.
- **Confirm employee type codes** (0/1/2 → Office/Tech/Sales) against FieldRoutes.
- **Cancellation-reason join** (Note → Reason) if reason-level reporting moves to RevHawk.
