# RIDD Sales Platform — Number Provenance Audit

_Snapshot audited 2026-09-21, read-only. Question asked of every number: can a user answer "why is this $X?" without leaving the app? Line refs are to `src/*.js` and `netlify/functions/*.js` in the snapshot._

## 0. The four feeds (cadence reference)

| Feed | Writer | Cadence | Age shown in UI? |
|---|---|---|---|
| **CRM dataset** (`state._indicatorRawSales`, `indicators/latest[-rep].json.gz`) | `revhawk-sync-background.js` → `derive-worker-background.js` (`lib/indicators-derive.js`) | Scheduler kicks hourly on the hour 8am–11pm ET (`revhawk-sync-scheduled.js`); reads RevHawk's BigQuery mirror, which itself replicates FieldRoutes **nightly (~2am)** for customers (subs may lag "many days", sync comment L280-291). Browser polls the blob ≤ every 2 min (`refreshIndicatorsFromCloud`). | Header "Last sync" pill (`30:861`, `appSyncStampStr`) = **time the sync job ran**, not the mirror's data-as-of time. |
| **Reporting snapshot** (`state.reportingSubscriptions`, `reporting_uploads` envelope + `snapshots/<id>.json.gz`) | same sync run, written before the derive | Same run; the browser loads the *active upload id* once per session (`prefetchReportingSnapshot`, `10:1733`) and is **not** part of the 5-min `resyncFromCloud` (`10:3655`). | "synced N ago" on the Reporting upload picker only (`76:188`). Health sheet shows load ok/err, not age. |
| **`sales` table** (`state.allSales` / `mySales`) | `fieldroutes-live-sync-background` (every 15 min, 7am–11pm ET, creates rows) + RevHawk run (auto-log, true-up, `crm_*` stamps within a 60-day window, auto-stage) + admin/auditor edits | Browser: boot, realtime channel, 5-min `refreshSalesData` | none (no health source for `sales`) |
| **QuickBooks ledger** (`state.reportingIsSpend`, `state.reportingLedger`) | `qbo-spend-refresh-background.js` via Windsor → `server_cache` kv; `qbo-spend.js` serves cache | Nightly (`marketing-refresh-scheduled`) + on demand when cache > 6 h | "pulled …" on the Spend card (`84:974`), "Last QB sync" on P&L (`80:1036`) |

## 1. Number-by-number provenance

Legend — Drill: **yes** = rows reachable in-app; **partial** = a related but not identical row set; **no**. Cadence keys: N = nightly mirror, H = hourly sync, L = 15-min live sync, S = on save.

### 1.1 Revenue

| # | Number · where | Source feed | Gates (functions) | Cadence | Drill | Ambiguity / divergence |
|---|---|---|---|---|---|---|
| R1 | **Total / New / Renewal Revenue** tiles · Sales Dashboard (`40:viewDashboard`) | CRM dataset (office dept) + app upsell rows + today's unmatched app rows | `warRoomCrmSales` → `indicatorSales` pinned to `office`+`pending_serviced` (`frPendingServiced`, `FR_GLOBAL_EXCLUDED_SERVICES`, `deletedCustIdSet`, `_indExclDrop`, `reportingExcludedSources`, `_indicatorDeptOf`); `dashboardSales` adds upsells (`contract_type`/`source` name ~/upsell/) and `_pendingSync` rows; `EXCLUDE_DASH` on `audit_status`; renewal = `_crmRenewal ?? sources.is_renewal`; `sumRev` (engine) | N+H (+L for today's optimistic rows) | **no** — the Revenue triple has no onClick (`40:1048`); Sales tiles link to the Sales queue, a different row set | Info button (`configInfoBtn`, `40:539`) says "hourly sync" — the mirror is nightly. "Today" mixes two feeds without a visible split. |
| R2 | **Revenue Pacer** YTD dept bars / Individual "My Pacer" | same pool | `goalYtdRevenue(true)` (dept) / per-rep sums in `viewDashboard` (Individual) — both `EXCLUDE_*` sets, Jan-1 window | N+H | **no** | Individual bar races NEW only; renewal shown as "+$X renewal". |
| R3 | **Rep Leaderboard Revenue / ACV / Rev-per-day** · Indicators (`64:~2433` repMap) | CRM dataset | `indicatorSales` (dept + acct-status filter + Filters panel) then `_repLeaderboardRows` scope; `getCanonicalRepName` merge | N+H | **yes** — `openIndicatorRepCard` lists accounts; admin `openCrmReconcileModal` names the excluding rule per account | Records (best day/week) gate separately via `_recordEligible` — by design, but the tooltip is the only warning. |
| R4 | **Power Rank / branch Revenue** · Indicators table (`64:445 powerRankCompare`, `indicatorMetricHelp('_points')`) | CRM dataset (`indicatorsData` weekly rows derived server-side) | `indicators-derive.js` (server) + `indicatorSales` client filters; excluded-team rules when comps mode on | N+H | **partial** — explainer tooltip; no row drill from the branch cell | Weekly rows are derived on the server with `_MY_EXCL_DERIVE`; the client re-derives per-rep tables from raw rows — two code paths kept in parity only by `tools/derive-parity-test.js`. |
| R5 | **Subscriptions Serviced / Active / Customers Active / Active ARR / Cancelled** · Reporting Overview `COLUMN_CARDS` (`82:280`) | Reporting snapshot | `reportingFilters()` (`isHidden`, `reportingExcludedSources`, `reportingNeverStarted`, `reportingApplyBranchRules`, `isRecurring` via `reportingServiceRecurringMap`, `isRealCancel`); "Serviced" card deliberately uses `retenGroundZero` + `initial_service` (pre-rule) | N+H (session-static) | **yes** — every card drills via `openReportingDrillModal` (`82:355`) | Card "Serviced" counts BEFORE exclusions; the other four AFTER — stated only in the sub-line. |
| R6 | **Daily Pulse Sold / Serviced / Churned** (`82:543 pulseCard`) | Reporting snapshot `scope.visible` | Sold = `subscription_contract_value` by `sold_date`; Serviced = `annual_recurring_value` by `initial_serviced_date`; Churned = ARV by `subscription_date_canceled` where `isRealCancel` (`reportingExcludeRorChurn`, excluded reasons, recurring only) | N+H | **yes** — stats and table cells open `openPulseDayDrill` / `openReportingDrillModal` | "Sold" is contract value, "Serviced/Churned" are ARR — three units in one row, labeled only in the caption. "Sold · today" ≠ Dashboard "Total Revenue" today (different feed, gates, and no optimistic rows). |
| R7 | **P&L (Putis Shid) Revenue, COGS, Selling expense, EBITDA, Adjusted EBITDA** (`80:putisDerive`) | QuickBooks GL via Windsor (`state.reportingLedger.months`) | `putisClassify` (account-name → bucket via `PUTIS_GROUP`, branch via `putisBranchOf`); `jobs` from RevHawk cached beside the ledger | nightly / 6 h | **no** for ledger rows (only FieldRoutes-side rows have `row.drill`, `80:482`); tooltips explain formulas | Accounts that don't match `PUTIS_GROUP` are silently dropped (`putisClassify` returns null) — no "unclassified $" line. Branch attribution by name prefix; "Corporate" catches everything else. |
| R8 | **Marketing "New revenue" / ROAS / CAC / Cost per job** (Reporting → Marketing, `84:_mktgPnl`, `_mktgActuals`) | Reporting snapshot + QuickBooks spend + hand-entered wages/incentives (`_compExtras.marketing`) | Office Staff only (`reportingIsOfficeStaff`), `reportingSourceClass !== 'renewal'`, `initial_status` pending/completed gate, `reportingExcludedSources` | N+H / QB 6 h / S | **no** (matrix cells have no drill) | "New revenue" here = new **+ upsell**; Dashboard "New Revenue" = everything not renewal (incl. upsells); `reportingIsPacer` "new" = new **excluding upsells**. Three "new revenue"s. |
| R9 | **Marketing tab revenue by source** (`72:viewMarketing`) | CRM dataset (`_indicatorRawSales`) | `frPendingServiced` only; every non-"Door to Door" source, **all rep types**, no excluded-source config, no deleted-customer set | N+H | **no** | Includes technician upsells and renewals that R8 excludes — same word "marketing revenue". |

### 1.2 Sales counts

| # | Number · where | Source | Gates | Cadence | Drill | Ambiguity |
|---|---|---|---|---|---|---|
| C1 | **Total / New Sales / Renewals** tiles · Dashboard | CRM pool (R1) | as R1 | N+H(+L) | **partial** — tile opens Sales queue (`sales` table, own rows for reps), whose count is a different population | **A**: the tile's number is not the list it opens. |
| C2 | **Sales queue counts / History** (`50:salesTable`, `mySales`/`allSales`) | `sales` table | RLS (own rows), `_salesQueueFilter`, `audit_status`/`lock_status` stages set by `revhawk-sync` auto-stage + admin | L + H + S | **yes** — the row is the record | Row `revenue_amount` is frozen at first sight; live CRM value only as a chip (`saleCrmVerdict`). |
| C3 | **Indicators counts, Accts/Day, MY %, Auto Pay %** | CRM dataset | `indicatorSales` + repMap | N+H | **yes** (player card) | Landing tiles (`_landingTiles`) recompute from `frPendingServiced` directly, bypassing the Filters panel/exclusions used by the leaderboard. |
| C4 | **Reporting subscription counts** | Reporting snapshot | `reportingFilters` | N+H | **yes** | Snapshot is loaded once per session; a 9-hour tab shows the morning's numbers with a green header pill (pill tracks the *indicators* blob). |
| C5 | **Sold / Serviced counts in Marketing P&L "jobs"** | Reporting snapshot | `_mktgActuals` gate | N+H | **no** | "Cost per job" divides QB spend by *subscriptions sold*; Putis "COGS ÷ job" divides by *completed appointments* — both labeled "job". |

### 1.3 Commissions and pay

| # | Number · where | Source | Gates / rates | Cadence | Drill | Ambiguity |
|---|---|---|---|---|---|---|
| P1 | **Inside Sales Pay Stub** — Sales Pay, Below Min, Other Pay, Total Pay (`52:viewPay`) | `sales` (`mySales`/`allSales`), `app_settings.pay_settings` (`ensurePaySettings`/`effectivePaySettings` + `profile.pay_overrides`), `pay_adjustments`, profile knobs (`golden_phone_amount`, `close_rate_target`…) | `inPeriod` by `sold_date`; `staged_for_payroll` + `audit_status`; `getCommissionAmount` → `getCommissionRate`, `isRenewalSource` (**`sources.is_renewal`**), `upfrontCollectedPct` (× `upfrontTierPayPct`), `closeRateBonusFor`, `getBackendAmount` | S (sales) / boot only for `pay_adjustments` (`10:3483`; not in `resyncFromCloud`) | **partial** — By-Source grid + Metrics block show rates; no per-sale line "revenue × rate × tier = $" | **A**: recomputed on every render from *current* rates; nothing persists the amount paid (`processPayroll` only stamps `payroll_processed_at`). A rate edit silently rewrites every historical stub. No `inputs` block (D2D engine has one). |
| P2 | **Backend Pay** block (quarter) | same | `quarterServiced`, `cancelsClawback` (`audit_status==='cancelled' && staged_at`) | S | **partial** | "Pending backend" line mixes about-to-run and awaiting-audit. |
| P3 | **Payroll CSV** (`52:downloadPayrollCsv`) | same | `getCommissionRate(repId, s)` with **`repId = state.profile.id`** (the viewer, not `viewedProfile`) and **no upfront-tier multiplier** | on click | n/a | **A**: admin exporting another rep's stub gets rates resolved against the admin's own `pay_overrides`; `commission` column ≠ stub Sales Pay whenever tier < 100 %. File name carries the admin's name. |
| P4 | **Slack pay-stub DM** (`52:notifyPayrollRun`) | same | recomputes `salesPay`/`belowPay` from the run's rows only | on payroll run | n/a | Total omits Golden Phone / Other Pay; a rep's DM total ≠ tab "Total Pay". |
| P5 | **Office-staff commission via calculator** (`94:commissionComputeOfficeStaff`) | `allSales` | `audit_status` only — ignores `staged_for_payroll`, adjustments, clawback | — | unrouted today | Second IS-pay implementation; will disagree with P1 the day it is routed. |
| P6 | **D2D backend commission** (`92:commissionCompute`, `commissionRenderCards`) | Reporting snapshot rows matched on `sold_by_id`; `app_settings.commission_config` (`commissionRatesFor`, `commissionManual`, `serviceCategories`) | Gates `global / source / renewal / sns` (counted, shown); `reportingExcludedCancelReasons`; ROR = date ≤ 3 d (any reason, any rep type) | N+H / S | **yes** — `explain` card + "Show the N sales behind these numbers"; snapshot with `inputs` published to `commission_results` | Currently **unreachable**: `viewCommission` (`94:5`) is a placeholder; `commissionMyPay`/`viewD2dUpfront` are not routed. "FINAL ATTRITION" here is count-based `(cancels − ROR − afterLock) ÷ sold` — a fifth attrition definition. |
| P7 | **Technician pay** (`tech_pay`) | — | — | — | — | Placeholder card (`30:1104`). Technician production numbers come from `indicators/tech-stats.json.gz` (hourly, `tech-stats-background.js`) with no drill. |
| P8 | **Pay adjustments** ("Other pay" lines) | `pay_adjustments` table | rep + year + period | S (admin) | **yes** (listed on stub) | Not refreshed on the 5-min resync — a rep's open tab misses same-day bonuses until reload. |

### 1.4 Renewals

| # | Number | Definition | Where it disagrees |
|---|---|---|---|
| N1 | Dashboard renewal split (R1), Indicators renewal revenue (`_indicatorIsRenewal`), Retention `retenExclRenewalSubs`, D2D gate | `reportingSourceClass(source)` — admin override `reporting_source_config.revenue_class` (Configurations → Lead Sources), else name ~/renewal/ | — |
| N2 | Pay (`isRenewalSource` → flat $/account, renewal backend %), Dashboard split for **app-logged** rows, Settings → Sources badge | `sources.is_renewal` (Supabase `sources`), set once at insert by name regex (`revhawk-sync:1295`), displayed read-only (`98:1193`) | **B**: retagging a source in Configurations changes every board but not pay; the two flags can disagree with no warning. |
| N3 | "Renewals" KPI tile → History queue | count of `approved` renewal rows in R1 | tile opens `_salesQueueFilter='history'` — unrelated population (C1). |

### 1.5 Goals

| # | Number | Store | Notes |
|---|---|---|---|
| G1 | Dashboard company goal / monthly allocation (`state.companyGoal`, `getGoalForContext`, `goalYtdRevenue`) | `app_settings.company_goal` (`loadCompanyGoal`; default `{amount: 6,000,000}` when the key is missing, `10:2503`) | Admin Goals tab (`98:874`) derives `new_amount`/`renewal_amount` 75/25 when unset. |
| G2 | Rep goal (`getGoalForContext` non-admin) | `profile.annual_revenue_goal`, **silent fallback 250,000** (`40:1146`) — used for `goalProgress`/`daysLeft` (`40:800`) | Individual pacer says "No annual goal set" while the header logic still uses $250k. |
| G3 | Reporting Inside Sales pacer goal (`isAnnualGoalFor`, `84:533`) | `adminRules.isAnnualGoal[yr]` → localStorage → `IS_ANNUAL_GOAL` constant | Third store; not linked to G1. |
| G4 | Marketing report goals (`_mktgStore().settings.isGoal = 4,000,000`, `renewalsGoal`) | `_compExtras.marketing` | Fourth store; hard-coded default differs from G1's $6M. |

### 1.6 CRM statuses on a sale row (`50:763-868`)

| Field | Origin | Written by | Cadence | Shown as |
|---|---|---|---|---|
| `audit_status` (pending / serviced / below_minimums / cancelled / nsf…) | app stage | admin/auditor `statusSelect`; auto-stage in `revhawk-sync` (`AL2.auto_approve`, serviced‖upfront, dpd ≤ 0, `crm_audit !== 'failed'`) | S / H | Status select |
| `crm_status` (verified / near_match / revenue_mismatch / not_found) | contract-value match | `revhawk-sync` verify pass (60-day window, `1337`); client `saleCrmVerdict` live path only when `crm_status` is null | H | ✓/≈/⚠ chip. Rows > 60 days old keep the last stamp forever — no "last checked" shown (`crm_checked_at` exists but isn't rendered). |
| `crm_audit` (passed / failed) & `upfront_collected` | FieldRoutes customer flags `Passed Audit` / `Failed Audit` (`AL.upfront_flag`, `AL.audit_fail_flag`) | sync `_auditOf` / `_hasFlag` | H | Audit chip + "Charged Upfront" ✓ — **two columns, one flag**; the ✓ tooltip says "payment collected at signing" while the code says "has Passed Audit flag". |
| `crm_initial_status`, `crm_autopay`, `crm_contract_state` | mirror `initial_status`, `customer_auto_pay`, contract docs | sync | H | ✓ Appt / ✓ Billing / ✓ Signed chips (eligibility) |
| `subscription_status`, cancel reason, `crm_deleted` | mirror `activeText`, `FieldRoutesCancellationNote` (latest), nightly `crm-deleted-scan` (`app_settings.crm_deleted` → `_crmDeletedIds`) | sync / scan | N | "↩ CRM cancelled" chip only on the **client** verdict path (`saleCrmVerdict` L593) — never set when the server stamp exists, i.e. effectively never for synced rows. |
| Sold-Not-Started | three predicates: `_isSoldNotStarted` (reason regex), `frPendingServiced` (initial status / active), `reportingNeverStarted` (frozen or reason) | client | — | Different SNS tests on Indicators vs Reporting; same phrase. |
| 3-day ROR | `_is3DayROR` (reason regex **or** ≤ 3 days, any rep type) · `_reporting3dayRor` (≤ 3 days, **Sales Rep only**, no reason test) · `retenIsRorSub` (reason **or** timing toggle) · `commissionCompute` (≤ 3 days, any reason) · `_isRorReason` | client | — | Four ROR definitions behind one label. |

### 1.7 Attrition / cancel / churn family

| Label on screen | Where | Formula | Function |
|---|---|---|---|
| **Attrition %** | Indicators rep leaderboard column, player-card headline | cancelled $ ÷ serviced $ (contract value), ROR + one-time removed both sides, saved accounts kept | `_attrRevParts` (golden-tested) |
| **Attrition** | Indicators landing tile (rep / team) | cancelled $ ÷ serviced $ **including** ROR + one-time (`_ror`/`_isOTS` are defined but never applied, `64:8718-8731`) | `_landingAttritionPct` |
| **Cancel %** | Rep leaderboard, Reps table, Performance Trends | count: `_repCancelCounts` ÷ `cancelEligible` (toggles for ROR / one-time / renewal) | `_repCancelExcluded` |
| **Attrition %** | Retention → Attrition by Rep / Source / Contract | count: counted cancels ÷ subs in the retention book (`retenPopulationExcluded` steps) | `96:~2084` |
| **Cancellation Rate** | Reporting Overview card / compare | `realCancels ÷ recurring rows` (all-time visible set) | `70:1168` |
| **Churned** | Daily Pulse | ARR of `isRealCancel` rows by cancel date | `82:566` |
| **Monthly churn** | P&L KPIs, Retention LTV | cancels ÷ book-months, trailing 24 mo | `80:PUTIS_KPI_TIPS.monthlyChurn`, `96:1649` |
| **FINAL ATTRITION** | D2D commission cards | (cancels − ROR − after-lock) ÷ sold, count | `commissionCompute` |

Seven formulas, three of them labeled "Attrition %"/"Attrition". AUDIT.md P1-10 recorded these as "unified this week"; the landing tile was not.

## 2. Findings

### (a) Numbers with no drill / explanation path

1. Dashboard **Total / New / Renewal Revenue** tiles and **Revenue Pacer** actuals (R1, R2). The Sales tiles link to a different list (C1).
2. Inside Sales **Sales Pay / Below Min / Total Pay / Backend Pay** — no per-sale line showing revenue × rate × tier (P1, P2); no record of what was paid.
3. **P&L ledger rows** (Revenue, COGS, Selling expense, EBITDA…) — no account-level view; unclassified GL accounts vanish (R7).
4. **Marketing P&L / CAC / Cost per job** matrices and the **Marketing tab** channel table (R8, R9).
5. **Power Rank** branch cells (R4) — tooltip only.
6. **Technician production** numbers (tech-stats blob) and Technician Pay (P7).
7. **Goal targets** — nothing links a pacer bar to the Goals tab that set it (G1–G4).

### (b) Same label, different definition — or different labels, same definition

| Label | Definitions | Class |
|---|---|---|
| "Attrition %" / "Attrition" | revenue (leaderboard) · revenue incl. ROR/OTS (landing tile) · count (Retention by Rep) · count (D2D FINAL ATTRITION) | **A** — a rep sees two different "Attrition" numbers for themselves on the same page (tile vs card) |
| "New Revenue" | Dashboard (non-renewal incl. upsells) · Marketing P&L (new + upsell, office only) · IS pacer (new only) | B |
| "Renewal" | `reportingSourceClass` vs `sources.is_renewal` | B (A for pay if the two ever disagree) |
| "3-day ROR" | four predicates (§1.6) | B |
| "Sold-Not-Started" | three predicates | B |
| "Last sync" / "hourly" / "every ~30 min" / "nightly" | header pill, dashboard info, queue chips (`50:863,866`), Settings → Sources ("every 30 min", `98:1184`) | B |
| "job" | subscription sold (Marketing) vs completed appointment (Putis) | B |
| "Serviced" | Overview card (pre-rule count) vs Daily Pulse (ARR) vs queue chip (initial completed) | B |
| "Churned" vs "Cancelled" vs "Cancels" vs "Subs lost" | same `isRealCancel` rows on Overview, three labels; leaderboard "Cancels" is `_repCancelCounts` (different rules) | B |
| Same definition, different labels: "Charged Upfront ✓" and "✓ Audit / Passed" are one FieldRoutes flag | | B |

### (c) Numbers whose source can be stale without the UI saying so

1. **Reporting snapshot** — loaded once per session; header pill reflects the *indicators* blob only. Overview, Daily Pulse, Retention, Marketing P&L, D2D commission all read it (C4). **A**.
2. **Header "Last sync"** = sync-job time; underlying RevHawk mirror is nightly for customers. No "data as of" (the sync could stamp `MAX(updatedAt)` but doesn't). **A** (users read "10:05 AM" as live).
3. **`crm_status` / lifecycle chips** on sales older than 60 days — never re-verified; `crm_checked_at` not displayed. B.
4. **`pay_adjustments`** — boot-only load. C.
5. **QuickBooks spend / ledger** — `stale:true` flag is returned by `qbo-spend.js` but the UI only shows "refreshing…"; a failed nightly pull shows yesterday's "pulled" stamp only on the Spend card, not on P&L KPIs. B.
6. **`company_goal` / `commission_config` / `pay_settings`** — `console.warn` on load failure for `company_goal` (no `healthReport`); the $6M default renders as if real. B.
7. **Monthly metric archive** (`derive-worker` `metrics-YYYY-MM`) — immutable once written; computed **without** the P/S gate, global exclusions or deleted-customer set, and served from Admin as "month metrics". C (admin-only download today).
8. **Deleted-CRM scan** — handled (AUDIT P1-8).

### (d) Computed in two places that can disagree

| What | Place 1 | Place 2 | Risk |
|---|---|---|---|
| CRM verdict | server verify pass (`revhawk-sync:1337`, P/S-preferring pool, exact-cents) | client `saleCrmVerdict` (no P/S preference, adds `crmCancelled`) | different verdict for the same row depending on which path ran; the "↩ CRM cancelled" chip only exists on the client path → **A** (clawback signal effectively dead for synced rows) |
| Inside Sales pay | `viewPay` (staged gate, adjustments, clawback, tier) | `commissionComputeOfficeStaff` · `notifyPayrollRun` · `downloadPayrollCsv` (each a subset, CSV with wrong repId) | **A** (CSV) / B |
| Indicators weekly rows | server `indicators-derive.js` | client `parseIndicatorsCsv` legacy path (manual CSV mode) | guarded by parity test; B |
| Renewal flag | `revenue_class` config | `sources.is_renewal` | B |
| Pending/Serviced gate | client `frPendingServiced` (serviced evidence → active → SNS → initial status) | sync auto-log `_hasAppt` / Marketing `_mktgActuals.gate` / `commissionCompute` sns gate (initial status only) | rows with a serviced date but a cancelled initial count on Indicators and not in Marketing/D2D pay; B |
| Attrition | `_attrRevParts` | `_landingAttritionPct` | **A** (see b) |
| Auto-stage "serviced" | server (`revhawk-sync:1538`, uses `initial_serviced_date`) | client chips (`crm_serviced_at`) | same source; fine |
| Goal allocation | `companyGoal.monthly_new` | `IS_SEASONAL` fallback in three files (`40`, `84`, `98`) | C |

## 3. Minimal fixes (business logic untouched)

| Finding | Class | Minimal fix (file · function) |
|---|---|---|
| Attrition tile ≠ leaderboard | A | `64:_landingTiles` — label the tile **"Attrition (incl. ROR + one-time)"** or call `_attrRevParts` so the number matches the card; keep the current subtitle either way. Add the tile to `tools/attrition-test.js`. |
| Payroll CSV uses viewer's id and drops the tier | A | `52:downloadPayrollCsv(sales, period, repId, upfrontMult)` — pass `viewedProfile.id` and `upfrontMult` from `viewPay`; add `tier_mult` and `rate_source` (default / override) columns; name the file after the viewed rep. |
| IS pay has no persisted inputs | A | On `processPayroll` / `processBackendPayroll` (`52`), write one `pay_runs` row `{rep_id, period, kind, inputs, totals}` mirroring the `inputs` shape in `92:commissionCompute` (rates from `effectivePaySettings`, per-sale `{id, rev, rate, tier, amount}`, adjustments). Render it through the existing `explain` card (`commissionRenderCards`) under the stub. History periods read the stored row instead of recomputing. |
| Dashboard revenue tiles have no drill; Sales tiles open the wrong list | A | `40:viewDashboard kpiTripleCard` — give all six tiles an onClick that calls `openReportingDrillModal` with the `approved`/`approvedNew`/`approvedRenewal` rows mapped to the drill's row shape (they already carry `customer_name`, `sold_date`, `revenue_amount`, `_crmRep`, `_pendingSync`). Show `_pendingSync` rows flagged "not in CRM yet". |
| "Last sync" implies live data | A | `revhawk-sync-background.js` — stamp `dataAsOf = MAX(updatedAt)` from the `sub`/`cust` CTEs into the payload; `10:appSyncStampStr` shows "Synced 10:05 AM · data as of Sep 20 2:10 AM". Rewrite the dashboard info text (`40:540`) and queue tooltips (`50:863,866`, `98:1184`) to one sentence sourced from a single `SYNC_CADENCE_TEXT` constant. |
| Reporting snapshot silently stale | A | `10:healthReport('reporting', …)` already fires; add `state.reportingSnapshotAt = upload.uploaded_at` and make `indicatorsSyncStaleness` take the older of the two stamps; show "snapshot from 8:05 AM · newer available — reload" via `loadReportingUploads` in `resyncFromCloud`. |
| "↩ CRM cancelled" chip never fires for synced rows | A | Sync already knows `best.subscription_date_canceled`; stamp `crm_cancelled_at` (one nullable column) in the verify pass and read it in `saleCrmVerdict` when `crm_status` is present. |
| Renewal flag in two stores | B | `revhawk-sync` source mirror (`1295-1307`): when updating a `sources` row, also read `reporting_source_config.revenue_class` and set `is_renewal = (class==='renewal')` if a class is set; Settings → Sources badge tooltip names the source of truth. Pay math unchanged. |
| Three "new revenue" definitions | B | Suffix labels: Dashboard "New Revenue (excl. renewals)", Marketing "New + upsell revenue", IS pacer "New (excl. renewals & upsells)". Cite the gate in the card `note`/`title` — the strings are already per-card. |
| Four ROR / three SNS predicates | B | Extract `_isRorRow(r, {source:'indicators'|'reporting'})` into `engine/src/10-sales-helpers.js`; keep each caller's current behaviour via the option, but document the option in every tooltip that says "3-day ROR". No math change. |
| Charged Upfront ✓ vs Audit chip | B | Rename the column header to "Passed Audit (CRM)" and drop the "payment collected at signing" tooltip (`50:756`), or hide the ✓ column since `saleAuditChip` shows the same flag. |
| Sync cadence wording | B | One constant, see above. |
| "job" ambiguity | B | Marketing "Cost per subscription sold"; Putis keeps "per completed job". |
| Goal stores | B | Keep the four stores, but have `isAnnualGoalFor` and `_mktgStore().settings.isGoal` **default** to `state.companyGoal.new_amount` when unset, and show "from Goals tab" / "set here" in the field's helper text. |
| P&L unclassified accounts | B | `80:putisMonthly` — accumulate `unclassified[acct] += amt`; add an "Unclassified (not in P&L)" line with a drill listing accounts (reuse `openReportingDrillModal` with `{last_name: acct, subscription_contract_value: amt}` rows). |
| Rep goal $250k fallback | C | `40:getGoalForContext` return `amount: 0` when unset; the pacer already handles 0. |
| Pay adjustments not resynced | C | add `safe(() => loadPayAdjustments())` to `resyncFromCloud`. |

## 4. One "why this number?" affordance

The codebase already has the three pieces: a **calculation explainer** (`attachExplainer` + `indicatorMetricHelp`), a **rows drill** (`openReportingDrillModal` / `openIndicatorRepCard` / `openLandingTileDrill`), and a **computed-inputs card** (`commissionRenderCards().explain`, fed by an `inputs` object). Proposal — one helper, no new UI language:

```js
// src/40 (next to attachExplainer)
function whyNumber(node, spec) {
  // spec = { label, value, formula, feed, asOf, gates: [{rule, n, rev}], rows, rowShape, inputs }
  attachExplainer(node, { title: spec.label, desc: spec.formula + '\n' + spec.feed + ' · as of ' + spec.asOf + '\n' + spec.gates.map(g => '− ' + g.rule + ' (' + g.n + ')').join('\n') });
  if (spec.rows) node.onclick = () => openReportingDrillModal({ chartTitle: spec.label, sliceLabel: spec.value + ' · ' + spec.rows.length + ' rows', rows: spec.rows.map(spec.rowShape || (r => r)), summary: spec.inputs ? commissionRenderCards({ inputs: spec.inputs }).explain : null });
}
```

Rules for adoption:

1. Every headline money number gets `whyNumber` — hover/tap = formula + feed + as-of + gate counts (the `gates` object `commissionCompute` already builds is the model); click = the rows.
2. `feed`/`asOf` come from one place: `dataSources()` returning `{indicators: {at, dataAsOf}, reporting: {at}, sales: {at}, qbo: {pulledAt}}` — the same map the health sheet (`openHealthSheet`) lists, so the pill, the sheet and every tooltip agree.
3. Gate counts are computed by the function that filters (e.g. `indicatorSales` records `{global, deleted, excludedSource, notPS, filters}` on `_indSalesCache`), so the tooltip shows "− 41 not Pending/Serviced" instead of prose.
4. Money numbers that are persisted (pay runs, commission results) pass `inputs`; the drill's `summary` slot then renders the existing `explain` card unchanged.

Start with R1/C1 (Dashboard tiles), P1 (IS stub), the landing Attrition tile and the P&L ledger rows — the four places where a user today cannot answer "why $X" at all.
