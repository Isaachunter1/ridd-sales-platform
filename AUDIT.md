# RIDD Sales Platform — Product, Engineering, UX & Architecture Audit

_Date: 2026-09-20. Scope: the whole app as of commit `7641e41`. Status of fixes is tracked at the bottom._ Constraint honoured throughout: this is a working product with deliberate decisions — findings are classified **A** (objectively problematic), **B** (inconsistent with the rest of the product) or **C** (subjective / potentially better). A and B are fair game; C is flagged, not pushed._

---

## 1. What the application is

A single-page internal operating system for RIDD Pest Control, replacing a family of Google Sheets (pay tab, IS pay, RIDD Reporting workbook). One code base serves five audiences through role-scoped navigation:

| Role (enum) | Who | Home | What they live in |
|---|---|---|---|
| `rep_sales`, `rep_partner`, `rep_team_lead` | D2D reps, partners, team leads | Indicators (player card) | Leaderboards, records, comps, Pay, Calendar |
| `rep_office`, `rep_office_lead`, `rep_loyalty`, `rep_loyalty_lead` | Office staff / inside sales / loyalty | Sales → Dashboard | Sales queue, Pay stub, Scorecards, Calendar, Comps |
| Technicians (CRM type, no app role) | Techs | Technicians dashboard | Route stats, upsells |
| `admin`, `admin_rep` (+ `is_owner`) | Isaac, managers | Sales (Office Staff) | Everything + Settings, Users, Reporting, Marketing, P&L |
| `auditor` | QA | Sales tab only | Audit queue |

**Stack.** Vanilla ES2020 JS (no framework), 30 files in `src/` concatenated by `tools/bundle.js` into one 3.9 MB `app.js` (1.06 MB gzipped, content-hashed and immutably cached). `index.html` carries a hand-tuned Tailwind subset (`tailwind.css`, prebuilt) plus ~900 lines of app CSS. Supabase (Postgres + Auth + Storage + Realtime) is the backend; Netlify hosts the static site and ~26 serverless functions. Chart.js for charts. No TypeScript, no test runner beyond three Node scripts; CI is `tools/ci-check.js` (syntax, Tailwind coverage, derive parity, engine smoke) and it **fails the deploy** on any error — a strong, cheap safety net.

**State.** One global `state` object; `mountApp()` re-renders the current view from scratch (496 call sites). Session/UI state lives on `state`, selected pieces persist to `localStorage` (156 references) and shared admin config persists to `indicator_config` (compare-and-swap RPC) and `app_settings`. Realtime channels wake reps when their sales change.

**Data model (Postgres).** `profiles` (role, office, FieldRoutes employee id, pay knobs), `sales` (one row per subscription, `queue_type` office/d2d/tech, CRM lifecycle stamps, audit status, pay stage), `commission_results`, `pay_adjustments`, `pay_overrides`, `scorecard_*`, `call_audits`, `calendar_store`, `indicator_config` + history, `indicator_rosters`, `app_settings` (kv), `reporting_uploads` (snapshot envelopes), `renewal_worklog`, `riddcoin_*`, `user_prefs`, `server_cache`. Bulk datasets are **gzipped JSON blobs** in Supabase Storage (`reporting/indicators/latest.json.gz`, a sanitized `latest-rep.json.gz`, `tech-stats.json.gz`), downloaded whole into the browser and cached in IndexedDB.

## 2. Integration & data-flow map

```
FieldRoutes (CRM)
  │  nightly + every 30 min (selling hours)          every 15 min (selling hours)
  ▼                                                   ▼
RevHawk BigQuery mirror ──► revhawk-sync-background ──► Supabase        fieldroutes-live-sync-background
  (FieldRoutesCustomer,      • snapshot envelope (reporting_uploads)      • subscription/search + get
   Subscription, Appt,       • indicators blob (full + rep-sanitized)      • customer/get, employee/get
   Ticket, Payment…)         • auto-log sales rows (queue_type)            • creates/true-ups `sales` rows
                             • lifecycle stamps: serviced/signed/paid/     (initial, monthly, ACV, contract)
                               balance/cancel, upfront → commissionable
                             • orphan + inactive-employee detection
                             • tech-stats blob (hourly, separate worker)
                             • crm-deleted-scan (nightly, customer/search)
QuickBooks (via Windsor.ai) ──► qbo-spend-refresh-background (6h / nightly) ──► server_cache kv ──► /api/qbo-spend ──► P&L, Marketing
GoHighLevel ──► /api/ghl-leads (on demand, admin)                       Windsor ──► /api/marketing-spend (admin)
Slack ◄── slack-dm / slack-paystub / teamlead-digest / feedback / commission-email (all JWT-gated, admin or self)
Browser ──► Supabase directly (RLS) for sales/profiles/config/scorecards/calendar; ──► Netlify fns for privileged work
```

**Direction of writes.** The app never writes to FieldRoutes or QuickBooks. Everything is CRM → app. The only outbound side effects are Slack messages and emails. That is the right shape for an internal reporting/pay tool and it should stay that way.

**Idempotency.** Sales auto-log dedupes on `crm_subscription_id`; the nightly pass true-ups amounts rather than re-inserting; snapshot envelopes are append-only with a single active id; blob writes are single-writer (storage policy). Good.

## 3. What is already well designed (do not "fix")

- **Server-side security posture is real, not cosmetic.** Restrictive RLS on `sales` (own rows or admin/auditor), a sanitized rep blob with a storage policy that 403s the full one, a JWT access-token hook that kicks deactivated accounts within a token lifetime, admin-only Netlify functions behind a shared `requireRole` gate, service keys only in Netlify env. This is better than most internal tools.
- **CI-gated deploys.** Syntax, Tailwind-class coverage, derive parity, engine smoke — a failing check keeps the last good build live. Keep extending this rather than replacing it.
- **Compare-and-swap on shared config** (`save_indicator_config`) — two admins can't silently overwrite each other.
- **Single source of truth for competition math** (`engine/`), versioned and consumed unchanged by the app and by Cam's apps.
- **Reconciliation mindset.** Attrition Steps mirrors Isaac's hand method step by step with drill-through at every step; "Reconcile" diffs a hand export against the app. This is exactly the "why does this number say $X" capability the brief asks for. Extend this pattern; don't dilute it.
- **Role-scoped navigation and defaults** (partners land on their team; reps get their own card; office leads get the metric picker; comps filtered by type). The product already avoids one-dashboard-for-everyone.
- **Phone-first rules** written down in CONTRIBUTING.md and mostly followed.
- **Information density on the analyst surfaces** (Reporting, P&L, Retention) is a feature for this audience. Do not sparsify.
- **Brand: Archivo + JetBrains Mono, orange `#DF643A`, cream/sage palette on Pricing.** Consistent and recognisable. Keep.

## 4. Top 10 highest-impact issues

1. **P0 · Three background workers accept unauthenticated POSTs** (`fieldroutes-live-sync-background`, `tech-stats-background`, `crm-deleted-scan-background`). Anyone who knows the URL can burn the FieldRoutes API quota or BigQuery budget. The RevHawk worker already checks `x-sync-secret`; these don't. (A)
2. **P0 · Scorecards, call audits, calendar and scorecard meetings are writable by any signed-in user** (`using (true) with check (true)`). A rep can edit a colleague's graded calls or a lead's scorecard from the console. Scorecards feed coaching and, via bonuses, pay. (A)
3. **P1 · Pay is computed in the browser and persisted from the browser.** `commission_results` is written by an admin session after the client engine runs. Correct today, but not auditable: there's no server-side recompute, no snapshot of the inputs (rates, sales rows, adjustments) the number was derived from, and no "explain this stub" trail. (A — traceability)
4. **P1 · Full re-render on every interaction.** `mountApp()` rebuilds the whole view (496 call sites). On Indicators / Retention with 77k-row datasets this is the source of every "molasses" report and the reason so many controls needed a staged Apply. (A — performance)
5. **P1 · Bundle weight.** 3.9 MB / 1.06 MB gz, unminified, everything loaded for every role. A rep on a phone parses the P&L, Marketing and Retention code they can never open. Immutable caching hides this on repeat visits, not on first open or after each deploy. (A)
6. **P1 · No test coverage on money.** Commission engine, pay stub, attrition, retention book, P&L rollups have zero automated tests; the only guards are the derive-parity and engine-smoke scripts. Every one of the pay/attrition rule changes this month shipped on inspection alone. (A)
7. **P1 · Deleted / stale CRM records leak into every metric.** Now mitigated by the nightly deleted-customer scan and the orphan rule, but the mirror itself never forgets; until the scan has run at least once, a handful of deleted accounts count as live. Needs a visible "unresolved" state, not silence. (A)
8. **P1 · Mobile: swipeable tables were a per-table fight.** Root cause was one CSS rule (`.card > div > table { display:block }`) that turns tables into block scrollers and breaks sticky columns. Fixed table-by-table this week (records, ZIP, audit, marketing, P&L, monthly churn); the rule itself should be inverted so the default is "real table inside `.scroll-x`, first column frozen". (B)
9. **P1 · Inconsistent control chrome.** Same intent, different components: native `<select>` vs custom dropdown-with-Apply vs pill tabs vs bordered buttons, `rounded-lg` vs `rounded-xl` vs square, 24/26/28 px heights, "Filters · 2" badges in some places and orange outlines in others. Users re-learn each card. (B)
10. **P1 · Silent failure paths.** `console.warn` is the terminal state for: roster mirror failures, `app_settings` reads, IndexedDB cache misses, QBO cache read errors, tech-stats refresh, and several Supabase upserts. Users see stale numbers with no indicator. (A — reliability)

## 5. Findings by priority

Each item: **Problem · Where · Who · Why it matters · Solution · Risk · Impact · Complexity · Class**

### P0 — Critical

**P0-1 Unauthenticated background workers** · `netlify/functions/{fieldroutes-live-sync,tech-stats,crm-deleted-scan}-background.js` · everyone (quota, cost) · Any anonymous POST triggers FieldRoutes/BigQuery work; repeated calls exhaust the CRM read quota the live sync depends on · Require `x-sync-secret` (same env var the RevHawk worker uses) and pass it from the scheduled kickers; reject otherwise · Low (three kickers to update) · High · S · **A**

**P0-2 Open write policies on coaching/scheduling tables** · `scorecard_cards`, `call_audits`, `scorecard_meetings`, `calendar_store` · reps → leads/admins · Any authenticated user can rewrite another person's graded calls, scorecard, meeting notes or the whole company calendar blob · Restrict writes: `call_audits`/`scorecard_*` to admin + the lead roles (`rep_office_lead`, `rep_loyalty_lead`, `rep_partner`, `rep_team_lead`) and the row's own rep for self-entries; `calendar_store` writes to admin + leads, reps only through an RPC that edits their own shift/swap entries · Medium (the calendar is a single JSON blob edited by many — an RPC is the safe path) · High · M · **A**

**P0-3 Pay/commission has no server-side truth or input snapshot** · `src/92-commission-engine.js`, `src/52-pay.js`, `commission_results` · admins, reps, payroll · A stub is whatever the admin's browser computed at the moment of save; if rates or sales rows change afterwards there is no record of what the number was built from, and nothing can recompute it · (1) On save, store an `inputs` JSON alongside each result: rate table version, list of sale ids with the amounts used, adjustments applied, engine version. (2) Add `tools/pay-test.js` with fixture sales → expected stub, run in CI. (3) Later: move the engine to a Netlify function so the server computes and the client displays · Medium — additive first, no behaviour change · High (payroll auditability) · M/L · **A**

**P0-4 Owner/admin role change path was locked for a day** (fixed in `8de1bff`) — recorded here because the class of bug matters: a gate that depends on data the migration hasn't created yet. Rule going forward: feature gates default open until their backing data exists. · **A**

### P1 — High impact

**P1-1 Full-view re-render model** · `mountApp()` everywhere · all users, worst for admins on big tabs · Every toggle rebuilds thousands of DOM nodes and recomputes derived datasets; caches (`_indSalesCache`, memoised retention sets) exist but are per-render band-aids · Introduce `mountCard(id)`: cards register a render function; state setters name the card(s) they dirty; `mountApp()` stays as the fallback. Migrate the heaviest cards first (Indicators table, Performance Trends, Leaderboard, Retention steps) · Medium — mechanical but touches many call sites · High (perceived speed) · L · **A**

**P1-2 Role-split bundles** · `tools/bundle.js` · reps on phones · 1 MB gz for a player card · Build two bundles: `app-rep.js` (core, shell, dashboard, indicators, calendar, comps, pay, pricing) and `app-admin.js` (everything). Serve by role after login; keep one index.html · Low-medium (bundle script + a loader) · High (first open, post-deploy reload) · M · **A**

**P1-3 Minify** · `tools/build.js` · everyone · Unminified 3.9 MB; a terser pass typically halves gz size · Add `terser` to the build step; keep source maps for `client-error` stacks · Low · Medium · S · **A**

**P1-4 Money tests** · engine, pay, attrition, P&L · admins, payroll · See P0-3; also attrition (`_attrRevParts`, `_reporting3dayRor`, `retenIsRorSub`), P&L margin rollups · Fixture-based tests in `tools/` wired into `npm run check` — small JSON fixtures per rule, one expected number each · Low · High · M · **A**

**P1-5 Table CSS default inverted** · `index.html` phone rules · phone users · One rule made every table a block scroller; six tables were individually rescued this week; the rest will bite one at a time · Replace `.card > div > table { display:block }` with: tables are real tables inside `.scroll-x`; `.frozen-table` becomes the default for any table with more than 3 columns (add the class in the shared `table()` helper); keep `fit-table` for fixed-layout tables · Medium — sweep every table once, visually verify on a phone · High · M · **B**

**P1-6 Control chrome tokens** · everywhere · everyone · Selects, buttons, pills and filter panels differ in radius, height, border and active styling · Define four control classes in CSS — `.ctl` (26 px, square, border-2), `.ctl-primary` (accent fill), `.ctl-select` (native select styled to `.ctl`), `.pill-tabs` (exists) — and sweep call sites. Keep the "button reads its current value" convention Isaac set · Low risk, wide surface · Medium-high (learnability) · M · **B**

**P1-7 Silent failure paths** · `src/10-core.js` loaders, sync callers · everyone · Stale data with no signal · A single `state._health` map {source → {ok, at, error}} fed by every loader; the header "Last sync" pill already exists — make it reflect the worst source and open a small status sheet (what's stale, since when, retry). Toasts only for user-initiated actions · Low · High (trust) · M · **A**

**P1-8 Deleted-CRM-record visibility** · Retention steps, Configurations · admins · The scan is nightly; between deploy and first run nothing says "unverified" · Show "FieldRoutes check has not run yet" prominently on the step (done) and add a "Run now" button for admins (kick the background worker with the secret) · Low · Medium · S · **A**

**P1-9 Users editor is a 3,100-line file with pay knobs that moved elsewhere** · `src/99-commission-rates-and-misc.js` · admins · Hidden inputs still submit retired pay fields (`golden_phone_amount`, `close_rate_pct`…) so a save can't wipe them — correct, but the form model is now spread across two places · Extract `userEditor.js`; the form's payload builder lists exactly the fields the modal owns; pay fields are owned by Commissions settings only · Medium · Medium · M · **A**

**P1-10 Attrition definitions live in four places** · leaderboard (`_attrRevParts`), player card (`retentionBlock`), landing tiles (`_landingAttritionPct`), Retention tab (`retenIsRorSub`/`_reporting3dayRor`) · admins, reps · Today they agree (unified this week) but nothing keeps them agreeing · One `attrition.js` module exporting the predicates + a fixture test; every surface imports it · Low · High (the "$X" question) · S/M · **A**

**P1-11 Sales queue "claim" and edit still route through the retired manual form** · `src/50-sales-queue.js` · office staff, admins · Fine functionally; the form still shows "Log Sale" affordances in places · Rename submit to "Save", drop fields that only made sense for from-scratch entry once the upsell change lands · Low · Low-medium · S · **B**

### P2 — Polish

- **P2-1** Phone tap targets: several 22–24 px controls (pill tabs, tiny "hide" links, chip ✕) sit under the 44 px guideline. Raise hit areas with padding, not visual size. (A)
- **P2-2** Number formatting: `$1,052.09` vs `$1,052` vs `$1.05M` across adjacent cards; percentages at 0/1 decimals inconsistently. Adopt: currency whole dollars except unit economics (ACV, per-job) at 2 dp; percentages 1 dp; compact `$1.2M` only in chart axes. (B)
- **P2-3** Terminology: Branch vs Office (partially fixed: Records, Indicators picker); "Serviced" vs "Commissionable" (fixed on Sales); "Cancel %" vs "Attrition %" (fixed on leaderboard). Sweep remaining strings. (B)
- **P2-4** Empty states: many tables render a bare "—" row or nothing. Standard empty state component: one line of what would be here + the one action that fills it. (B)
- **P2-5** Loading: the Retention tab shows nothing while 77k rows crunch. Skeleton rows for the card shells; already have "Downloading snapshot…" toast for the fetch. (A)
- **P2-6** Confirmations: 43 `confirm()` calls (blocking native dialogs). Replace destructive ones with the two-tap pattern used for ownership transfer. (B)
- **P2-7** Focus states: verified present — `:focus-visible` rings exist (ink outline + accent box-shadow on inputs). Two competing rules (`index.html` ~971 and ~1152) should be merged into one so the ring is identical on buttons and inputs. (B)
- **P2-8** Icon set: emoji icons (🏢 ⇄ ⬇ 📈) mixed with SVG line icons. Keep emoji where they are part of the brand voice (comps, RIDDcoin), use SVG in chrome. (C)
- **P2-9** Card density: some cards nest a card inside a card with the same border (Retention what-if, Daily Pulse drill). Flatten the inner to a `card-2` background. (B)
- **P2-10** Date formats: `9/18/2026`, `2026-09-18`, `Sep 18`, `Wednesday, September 6th, 2026` in adjacent places. Short `Sep 18, 2026` in tables; long form only in headers/tooltips. (B)

### P3 — Future opportunities

- **P3-1 Server-computed pay.** Move the commission engine into a Netlify function; the app renders results and reasons. Enables payroll exports that are provably reproducible.
- **P3-2 Change log for money-affecting config.** `indicator_config_history` exists; extend to pay settings, cancel-reason config, service-type config, with a "what changed since last payroll" view.
- **P3-3 Exception feed for managers.** One list: reps with zero sales in 3 days, attrition spikes by team, failed audits, aging accounts, stalled queues — each row deep-links to the drill that explains it. Most of the data already exists in cards; this is the manager's morning page.
- **P3-4 Rep "today" strip.** Reps land on a player card; a thin strip above it with today's actionable items (open shifts, comps ending this week, pay stub ready, calls to grade) would cut the hunting.
- **P3-5 Retention outreach loop.** Daily Pulse now lists churned accounts by reason; a "save attempt" workflow (who called, outcome) would close the loop and feed the save-back rule that already exists in the data model.
- **P3-6 Upsell change readiness** (Isaac's next build): sales and upsells now come only from FieldRoutes. Define the upsell record shape once (ticket → sale row → pay line) with a fixture test before building UI on it.
- **P3-7 Per-role bundles + offline shell** for reps in the field (service worker caching the rep bundle and last blob).

## 6. Role-by-role read

**Sales reps (D2D).** Land on their player card with team toggle; leaderboard, records, comps and pay within one tap. Strong. Friction: the Filters panel exposes Group/Date they rarely change; Performance Trends offers 11 metrics where three matter to a rep. Suggest (C) a rep-default metric list with "More…". Biggest wins: bundle size on phones (P1-2), tap targets (P2-1).

**Office staff / inside sales.** Sales queue is the core loop; with manual logging retired the queue is now a review/claim surface. Dashboard leaderboard + latest sales are tight. Friction: Pay stub and Scorecards are separate tabs with separate period pickers — a shared period selector in the group header would remove repeated picking (B). Team leads get the Metric picker and their team's Sales Mix (done this week).

**Managers / partners.** Team-scoped Indicators, Class Metrics, Sales Mix, Performance Trends all default to their team (done). Missing: the exception feed (P3-3) — today a manager reads six cards to find the one problem.

**Admins.** Configurations are thorough and every rule is drillable. Friction: Settings is one long page with ~14 cards; a left rail exists on desktop but the phone dropdown hides where a setting lives. Owner/admin role model now explicit. Highest value: money tests + input snapshots (P0-3, P1-4) so payroll review is defensible.

**Leadership.** Reporting Overview (Daily Pulse, headline metrics), P&L (branch × month with per-job unit economics), Retention, Marketing CAC. Dense and correct in spirit. Friction: no single "this week vs plan" page; the Revenue Pacer on the office dashboard is the closest thing. (C) A leadership landing that pins Pacer + Pulse + attrition trailing-12 + cash/debt would take one screen.

## 7. Design system status

There **is** a de-facto system: Archivo/JetBrains Mono, `--accent` orange, `--card`/`--card-2`/`--border` tokens, `.card`, `.pill-tabs`, `.icon-btn`, `.scroll-x`, `.frozen-table` (new). What is missing is a documented control layer (P1-6) and consistent spacing on card headers (`px-5 py-3` vs `p-4` vs `px-4 pt-4 pb-2`). Recommend a `DESIGN.md` that lists the tokens and the six control classes, and a CI check that flags new inline `borderRadius`/`height` on buttons.

## 8. Reliability scenarios

| Scenario | Today | Recommendation |
|---|---|---|
| CRM/RevHawk down | Scheduled kicker logs + Slack alert; app shows last blob with "SYNC DOWN" in header | Good. Add per-source health (P1-7). |
| FieldRoutes API quota exhausted | Live sync errors silently per batch | Count 429s, back off, surface in health. |
| Duplicate/late sync runs | Envelope append + single active id; sales dedupe on `crm_subscription_id` | Good. |
| Double-click Save | Submit button disabled during round-trip (user editor); not everywhere | Standardise on the `_submitBtn` pattern in a shared `withBusy(btn, fn)` helper. |
| Two admins edit config | CAS on `indicator_config` | Good; extend to `app_settings` keys that admins edit (pay_settings, commission_config) — currently last-write-wins. |
| Refresh mid-action | Staged filter panels lose staged edits (fine); sale edit modal loses input | Acceptable. |
| Permissions change | JWT hook enforces within 60 min; app re-checks `is_active`/role on focus | Good. |
| Incomplete data (new customer row lags sub row) | 7-day grace for orphans; `??` state grouping | Good, now visible. |

## 9. Security summary

Strong: RLS on sales/profiles/blobs, JWT gate on privileged functions, service key server-only, access-token hook, owner model for admin changes (DB trigger). Gaps: P0-1, P0-2, `sync-status` and `client-error` are anonymous (timestamps / error spam only — low), `slack-paystub` gate is in place (the commented block is dead text — delete it to avoid confusion). Secrets: none in repo (verified `grep` for service key patterns).

## 10. Performance notes (measured where possible)

- Bundle: 3,942,107 B raw / 1,059,065 B gz. Target after minify + role split: ~350 KB gz for reps.
- Rep blob: ~77k rows JSON.gz parsed on the main thread; IndexedDB warm cache helps repeat opens. Consider moving parse + first derive into a Web Worker (M).
- `mountApp()` on Indicators (admin, 90 days): re-crunches indicatorSales() per dept + charts; caches exist. The re-render model (P1-1) is the lever.

---

## Implementation log

| Item | Commit | Status |
|---|---|---|
| P0-1 secret-gate background workers | `7e6bfbc` | done |
| P0-2 scorecard / call-audit / meeting RLS | `1623ec4` (migration `20260920_scorecard_write_policies.sql`) | done — run in Supabase |
| P1-4 / P1-10 attrition golden tests in CI | `27c9197` | done |
| P1-5 table CSS default inverted | `e83ef0c` | done — verify each tab on a phone |
| P1-8 Run FieldRoutes check now | `e8a3e7c` | done |
| Calendar write policy (P0-2 part 2) | — | pending: needs an RPC for rep shift edits before the blob can be locked |
