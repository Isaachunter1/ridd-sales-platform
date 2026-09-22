# Generalizing the RIDD Sales Platform for other pest-control companies

Status doc for the multi-company effort (started Sep 22 2026). Principle, per Isaac:
**the rules stay exactly as built; what a second company configures is the mapping
from their FieldRoutes labels to the buckets the rules read.** Nothing in here changes
a number for RIDD — every default is RIDD's current spelling or constant, and the
golden tests (`tools/attrition-test.js`, `ps-gate-test.js`, `commission-test.js`,
`upsell-test.js`) must stay green through every slice.

## What is already per-company (no work)

| Surface | Where | Notes |
|---|---|---|
| Supabase project + keys, public URL, company name / tagline / est. | `index.html` → `window.RIDD_CONFIG` | One object; a second deploy edits it. |
| RevHawk BigQuery project + dataset | `REVHAWK_PROJECT_ID`, `REVHAWK_DATASET` env | Sync reads whichever dataset the env names. |
| FieldRoutes API creds / subdomain | `FIELDROUTES_*` env | Used by the deleted-customer scan and pay runs. |
| Slack webhooks, Windsor, QBO | env | Optional integrations; absent = feature off. |
| Service types: lifecycle (recurring / one-time / retired), hidden | Reporting → Configurations → Service types (`reporting_service_config`) | Drives Attrition Steps 3, 4, 6. |
| Lead sources: excluded, revenue class (new / renewal / upsell) | Configurations → Lead sources (`reporting_source_config`) | Step 5 + P&L classes. |
| Cancel reasons: which are "retained" (company-ended) | Configurations → Cancellation reasons (`reporting_cancel_config`) | The retained-not-churn list. |
| Retention pop-exclusion list, one-visit exemption terms ("sentricon"), orphan auto-exclude | `adminRules` (persisted with indicator state) | Set from Configurations. |
| Branch renames / exclusions, home states, ZIP→state | Configurations + data-driven | Home states are inferred from the data. |
| Holidays | Configurations (`companyHolidayFor`) | |
| Offices, teams, reps, goals, avatars | Supabase tables | |
| Optional modules (riddmarket etc.) | `window.RIDD_MODULES` registry (`_visibleModules`) | The mechanism for company-specific add-ons already exists. |

## Slices done

- **1.** CRM vocabulary layer (below). **2.** Configurations → CRM vocabulary panel. **3.** Sold-Not-Started bucket + pop-exclusion default derives from tags. **4.** `RIDD_CONFIG.BRAND` (wordmark / mark / external link) and `RIDD_CONFIG.ENTITIES` (legal entities). **5.** Marketing P&L / CAC / Projections iterate the entity list (no hardcoded RPS office set). **6.** Operations baseline from `adminRules.opsBaseline` (RIDD 2025 sheet = default). **7.** `RIDD_CONFIG.FEATURES` switches (pay / competitions / hall_of_fame / scorecards / calendar / pricing) gate the nav and sub-tabs. See `docs/DEPLOY_NEW_COMPANY.md`.

## Slice 1 — CRM vocabulary layer (`src/12-crm-vocab.js`)

The app used to test RIDD spellings inline: `"3 Day ROR"`, `/renewal/`, `/combined/`,
`"Upsell - Service Pro"`, `"Door to Door"`, `"sales rep"`, `/office\s*staff/`,
`/technician/`, and the literal `3` for the rescission window — across ~10 files.
Those now go through one lookup with RIDD defaults:

| Bucket | Predicate | RIDD default (unchanged behaviour) |
|---|---|---|
| Cancel reason → `ror` / `combined` / `renewal` | `crmReasonIs(kind, reason)`, `crmReasonKind` | `/\bror\b|rescission/`, `/combined/`, `/renewal/` (legacy dashboard/audit paths keep their own broader `_ROR_REASON_RE` until a company configures a list) |
| Sold-by employee type → `sales_rep` / `office_staff` / `technician` | `crmSellerRole(label)`, `crmSellerIs` | `sales rep` / `office staff` / `technician` |
| Lead source → `d2d` / `tech_upsell` / `termite_upsell` / `unset` | `crmSourceIs`, `crmSourceChannel` | Door to Door / Upsell - Service Pro / Upsell - Termite Pro / N/A+blank |
| Rescission window (days) | `crmRorWindowDays()` | 3 |

Stored as `adminRules.crmVocab` (`setCrmVocab(obj)`); a configured list matches by
normalized equality, an unconfigured bucket falls back to the default pattern.
Wired into: retention steps (ROR / combined / renewal / timing-ROR seller + window),
CRM reconciliation source rules, `isOfficeStaffProfile` / `isTechProfile`, role
fallback, roster import, admin hygiene panels, audit-report ROR rows, dashboard
`_is3DayROR` / `_isCombinedSub`.

## Remaining RIDD-specific surfaces (the backlog)

Grouped by the kind of work. Effort is rough.

### A. Move to config (small, behaviour-preserving)
- `RETEN_POP_EXCL_REASONS_DEFAULT` (66) — default list of pop-excluded reasons; should derive from the vocab tags (`ror` + `combined` + `renewal` reasons found in the data) instead of a RIDD list.
- ~~`_ROR_REASON_RE` / `_COMBINED_REASON_RE` / `_SNS_REASON_RE`~~ — vocab-aware (slices 1 + 3). The engine's own `_isSoldNotStarted` (`engine/src/10-sales-helpers.js`) is pure and keeps its regex; the engine is versioned separately.
- Cancel-reason "meaning" inference in Cancel Analysis (`70-reporting-core` source kind guess `/renewal/`, `/upsell/`) — default guesses, fine, but should consult the vocab first.
- ~~`OPS_BASELINE_2025`~~ → `adminRules.opsBaseline` (done; no Configurations UI for it yet — set via the store).
- ~~Company-wide goals~~ — already `state.companyGoal` from the Goals settings; nothing hardcoded.
- ~~`COMPANY_NAMES` / `COMPANY_COLORS` (58)~~ → `RIDD_CONFIG.ENTITIES` (done). Still hardcoded: the marketing matrices in 84 key on `B.rpc` / `B.rps` / `'RIDD'` scope ids — needs to iterate the entity list.
- Timezone offsets by office (`40:2120` returns 3 for Eastern) — should come from office config.
- 3-day ROR being **door-to-door only** (`_reporting3dayRorByDates`) — a rule, keep; but "which seller types get a rescission right" could be a vocab flag later.

### B. Branding (small)
- ~~Wordmark, mark, menu link~~ → `RIDD_CONFIG.BRAND` (done). Still hardcoded: "RIDDMADE" strings inside comps posters / emails / TV board footers, `ridd.com` demo emails, accent colour CSS vars (edit in index.html).

### C. Modules that are RIDD programs, not industry features (medium — toggle, don't rewrite)
- Inside Sales commission calculator + pay runs (`52-pay`, `99-commission-*`) — RIDD's comp plan.
- Competitions engine: NRLA, Spring Cleaning, Top Gun, Kobe, LMS (`54`, `60`, engine/) — RIDD's comps.
- RIDDcoin (`74`), Hall of Fame (`58`), Pricing tab (`95`, RIDD's 2026 slicks), Slicks.
- ~~Route through a per-company list~~ → `RIDD_CONFIG.FEATURES` (done). Not yet gated: Settings-tab sections that belong to a feature (pay periods, comp admin) still render for admins; the views stay reachable by hash.

### D. Data feed (the gating question for any prospect)
- Sync is RevHawk-only (`revhawk-sync-background`). A company without RevHawk needs a FieldRoutes-API adapter that produces the same row shape (`subscriptions` mirror columns). The rest of the app never sees the difference.

### E. Onboarding wizard (medium)
- After the first sync: list the distinct cancel reasons, sources, employee types, service types and offices from *their* data; the admin tags each into the vocab buckets (Slice 1) and the existing Configurations lists. Untagged values default to the conservative side (unknown reason = churn, unknown source = normal acquisition, unknown seller type = not a rep).
- Writes: `adminRules.crmVocab`, `reporting_*_config` rows, offices/teams.

### F. Tenancy (later — only past ~5 customers)
- Today: one Supabase project + one Netlify site per company (hard isolation, hours to stand up). True multi-tenant = `company_id` on every table + RLS + every query; defer.

## Order of work
1. ✅ Vocabulary layer.
2. A (config moves) — each one a small commit with golden tests green.
3. Configurations → **CRM vocabulary** panel (tag lists, ROR window) so RIDD admins can see the mapping; RIDD leaves it at defaults.
4. B branding block; C module list; second-deploy checklist (`docs/DEPLOY_NEW_COMPANY.md`).
5. E onboarding wizard on top of 3.
6. D FieldRoutes-API adapter when the first non-RevHawk prospect appears.
