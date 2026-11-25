# DECISIONS.md

One dated paragraph per decision. Read before proposing to undo one. Add to the top.

**2026-10-28 · FieldRoutes call diet, edited in place in `netlify/` (Isaac's call).** We kept hitting FieldRoutes' rate limits; the app made ~15–18k calls a day. Isaac approved fixing the two big workers where they are instead of porting first, since the limit is hurting now. Changes: the live pull runs every 5 min (was 2) with a one-at-a-time lock; `subscription/search` uses `includeData=1` (a record missing any field the worker reads is still fetched with `get`); the add-ons sync reads plans changed since its last finished run (calendar day in Pacific time, 3-hour margin, marker never moves on a failed run) instead of the last 3 days, plus any plan whose sale row was logged since; the office list is cached a day in `app_settings.fr_office_cache`; a rate-limit response stops the run (no retries) and a stopped run never publishes the TV feeds; the nightly full sweep and reconcile run once (`minute < 5`), not three times. Expected: ~2–3k calls a day. The port to `server/` still happens on the normal schedule and carries these rules with it.

**2026-10-28 · Renewals are exempt from the audit flag.** A renewal's account still carries the Passed / Failed Audit flag from the original sale, so the flag says nothing about the renewal (per Isaac). Auto-approval (`server/services/sync/functions/stageRules.js`) no longer holds a renewal on a Failed Audit flag; it is approved on its next treatment (completed on/after the save) or its next paid bill, as before. The app hides the flag on renewals (Sales tab, Pay) and pay math already exempted them (`passedAuditExempt`). To pull it forward, `staging` was ported out of the sync worker ahead of the port order.

**2026-10-20 · The Tailwind rebuild is not part of the port.** `tailwind.css` as committed is stale: a rebuild over `app/src/**/*.js` adds 83 selectors and drops 40, and the app has been relying on hand-written gap-fill rules (now at the end of `app/src/styles/app.css`) for the missing ones. Swapping hand-written definitions for Tailwind's can move pixels, so it is its own commit after the port, verified on a deploy preview, with the gap-fill rules deleted one by one as Tailwind covers them. `npm run tailwind` and the repointed `app/tailwind.config.js` are ready for it.

**2026-10-20 · Images and `vendor-supabase.js` stay at the public root.** The architecture doc puts them in `app/public/img/` and `vendor/`; `app.js` names them by their root path (`'kobe-snake.png'`, `import './vendor-supabase.js'`). Moving them means editing code, which breaks the byte-identical check that the port rests on. They move in the ESM phase, when the import lines are rewritten anyway.

**2026-10-20 · The engine build writes two copies.** `packages/engine/dist/ridd-engine.js` is the package's `main` (what `smoke.js` and an `npm install` of the package load); `app/public/engine/dist/ridd-engine.js` + `latest.json` are what Netlify serves at the URLs Cam's server already uses. Two writes of the same bytes beat a redirect, which would have needed a publish-dir target anyway.

**2026-10-20 · `netlify.toml` stays at the repo root during the port.** Netlify resolves `netlify/functions` relative to the base directory, and the functions stay there until the last one ports. The file publishes `app/public` and runs the build from the root; it moves into `app/` when `netlify/` is deleted.

**2026-10-20 · One scope, explicit order.** The app bundle stays one concatenated module scope (no ESM yet); the concatenation order moved from filename numbers to `app/src/bundle.order.js`. Folders now say what a file is; the order file says when it runs. The bundler fails on a file that is on disk but unlisted, listed but missing, or listed twice.

**2026-10-20 · The health route is `/health`, not `/healthz`.** Google's front end in front of Cloud Run answers its own 404 for `/healthz`; the request never reaches the container (verified on the first deploy: `/` and `/api/sync-status` got through, `/healthz` did not). `/api/health` is the same handler so the Netlify `/api/*` redirect covers it.

**2026-10-20 · `GET /api/sync-status` stays open through the port.** The Netlify function had no auth and the app's health sheet calls it without an `Authorization` header. It returns timestamps only. Closing it is a two-sided change (caller + `requireRole()`), which is a behaviour change, so it waits until after the port and ships in one commit.

**2026-10-20 · Admin "Refresh now" goes to `POST /api/jobs/<name>`.** The server also answers `POST /jobs/<name>` (what Cloud Scheduler calls), but putting the admin kick under `/api/` means the app's single Netlify `/api/*` redirect covers it and the browser never needs the Cloud Run URL. Same handler; two paths.

**2026-10-20 · Cloud Scheduler schedules stay in UTC by default.** The Netlify crons were UTC and "schedules are carried over as-is". A job that needs a local wall-clock time sets `tz` on itself (the kill switch is `America/New_York`); `scripts/schedules.js` honours it. The 8am–11pm ET gating that some Netlify kickers did inside the function is preserved inside those jobs when they port, not moved into the cron.

**2026-10-20 · The lock is a partial unique index on `job_runs`.** One `running` row per job name, enforced by Postgres. A second kick inserts, gets 23505, answers 409. No advisory locks, no separate lock table, nothing to leak when a process dies; the 5 a.m. kill switch marks abandoned rows stale. Same table is the history and the health source.

**2026-10-20 · `DRY_RUN` means compute everything, write nothing, publish to disk.** `ctx.publish()` is the one path for published files; in a dry run it writes `server/dryrun/<path>`. That file is the port's proof: diffed against the Netlify output for the same window. Table writes check `ctx.dryRun` themselves. A dry run takes no lock, posts nothing to Slack, and writes no heartbeat.

**2026-10-20 · A missing env var does not crash the container.** `config/env.js` names the missing variables; `index.js` answers 503 on every route except `/health`, which lists them. Reason: in the Cloud Run console a revision has to exist before secrets can be attached to it, so the first deploy is always unconfigured. The doc's "exits with a one-line message" became "answers with a one-line message"; the information is the same.

**2026-10-20 · The old `x-sync-secret` gate's open-when-unset behaviour is gone.** `API_TOKEN` is required. A fresh environment without it answers 503, not "anyone may kick a job".

**2026-10-20 · SQL in `.sql` files with BigQuery named parameters.** Every query the Netlify worker built as a template literal becomes a file beside the function that runs it, with `{{T:Table}}` for the dataset prefix and `@start`/`@end` as parameters. Same query text, same plan; no string-built dates. Incident comments move with the SQL.

**2026-10-20 · One Express service on Cloud Run, Scheduler → HTTP.** Over Supabase Edge Functions (Deno, time limits, compute inside the system we least want to be bound to), over Cloud Run Jobs from day one (per-job switch later if any job passes an hour), over Cloud Run for the app too (Netlify previews are the human checkpoint). See `docs/ARCHITECTURE.md` → Considered and not chosen.

**2026-10-20 · Fixture test per pure function.** `rollupOfficeWeeks` has one; every `functions/*.js` that computes gets one when it ports. Ten rows in, known output out. The model makes tests pass reliably and notices silent breakage unreliably.

**2026-10-13 · (from the architecture doc)** No TypeScript on the app, no Kubernetes, no message queue, no GraphQL, no microservices, no ORM, no validation framework, no logging framework. None solves a problem this system has; each adds a layer the person running it day to day cannot see through.

**2026-11-16** — services/dashp: a pass-through, not a mirror. Technician and d2d commission results are computed on DASHP, a separate platform with its own database, and exposed through a read-only, rate-limited API (60 requests a minute, refreshed hourly). The server forwards five allowlisted GETs with the API key and returns DASHP's answer unchanged; admins only. This is an exception to "the server never proxies ordinary reads": the data is not in our Supabase, so there is no table to put a policy on, and the key is a secret. Nothing is stored or recalculated here. If the screens ever need to work while DASHP is down, the next step is an hourly job that copies the results into our own tables and lets the browser read them under RLS.

**2026-11-18 — services/slack: the end-of-day rep DM is a server job, not a browser feature.** The Notifications page was cleared down to the Slack connection and one thing that fires: `rep-eod`, an hourly job that sends each Inside Sales / Loyalty rep a DM once a day after the configured Mountain hour (revenue, subscriptions, pace for day/week/month/year, ACV vs $700, multi-year % vs 60%, Plaibook close rate). It reads the same published `indicators/latest.json.gz` the Revenue Pacer reads and copies the pacer's work-day arithmetic into `functions/eodReport.js` (pinned by `test/eod-report.test.js`) so the DM and the app agree. The bot token moves to the server as `SLACK_BOT_TOKEN`; the Netlify `slack-dm` function keeps its own copy until it ports. Send-time is a setting, so the wall-clock gate lives inside the job (DECISIONS 2026-10-20) and `app_settings.eod_report_state` makes a second kick in the same day a no-op. Sale Broadcast, First Blood and Pay Stub DMs lost their settings UI; their flags are forced off on the page’s next render so nothing fires from a switch nobody can see. Job kicks now carry the query string through as `ctx.params` (`?force=1`, `?preview=<profile id>` are the Settings buttons).

**2026-11-18 — services/marketing: LTV is a nightly cohort file; the browser models it.** `ltv-cohorts` runs one BigQuery query over every residential customer since 2021 (first recurring subscription = cohort month; collected payments and survivors by month since start; grouped all / office / Office Staff vs other / office×seller / FieldRoutes source) and publishes `marketing/ltv.json` (~45k rows → a few hundred KB). The projection — own curve while 150+ customers back a month, then the all-RIDD curve scaled to the population’s first months — lives in `app/src/integrations/marketing-ltv.js`, not the job, so the method can change without a Cloud Run deploy and the drill can show the choice. CAC stays the dashboard’s own month cell so LTV / CAC divides the same number the Cost-per-job tile shows. Not chosen: per-customer LTV in Supabase (nothing reads it per customer yet) and running the cohort math in the browser (payments are 1.9M rows — rule 2).

**2026-11-18 — POST /api/crm/customer-notes: the one on-demand BigQuery read.** The Sales export needs FieldRoutes general and cancellation notes, which the reporting snapshot never carried and which are too large and too sensitive to publish for every customer. The endpoint takes up to 400 customer ids the caller’s screen already shows and returns the newest five notes of each kind; system traffic (SMS, email, hook logs) is filtered in the SQL. It needs the BigQuery credential, so it is a server endpoint, not a browser read — the exception rule 1 allows. If exports grow past a few hundred accounts, the next step is a notes column in the snapshot, not a bigger endpoint.

**2026-11-23 — Office Staff backend goes monthly on 2027-01-01.** Isaac: backend locks at "4 invoices paid since the time the sale happens … new sale … add on … everything" (already the rule since Oct 14: `crm_paid_invoices` counted from each sale's own `sold_date`, initial invoice included), and "we are going to pay out backends every month on whatever is eligible from that month … instead of doing it quarterly", with "the close rate bonus will also move to monthly". Isaac runs one last manual quarterly backend, hands over every account still waiting, and monthly payouts start in February 2027. Rules: an account belongs to the month it locked (`audit_2_at`, the lock stamp); from `BACKEND_MONTHLY_FIRST_RUN` (2027-02-01) Run payroll's backend box carries every account decided (Lock / Chargeback) before the current month began — last month's plus stragglers — and those locked this month wait. Chargebacks settle on the same monthly run (confirmed by Isaac, Nov 23: "We can also chargeback any accounts that need to be charged back monthly as well"). The close-rate bonus rides the same run, on the rep's Plaibook close rate for the last full calendar month (`plaibook-close-rates` switches its window to `month` on 2027-01-01), × the subscription revenue of the accounts locked that month. Before the switch everything is unchanged (quarterly).

**2026-11-23 (final) — peak = as sold + the rep's own later changes + the service fee.** Isaac: "peak revenue definition as revenue when contract is sold + any additional revenue that the sales rep added to an account after the fact … then the downgrades and tech upsells and office upsells aren't even relevant" and "you need to also add the service fees to peak revenue too". Every money change in the changelog carries `employeeID`: a change by the selling rep (any of their branch IDs, from `fieldroutes_employees.employee_ids`) is kept, a +$4.87 recurring change is kept whoever made it, everything else is undone as a delta (new − old), so a rep's later upsell survives an earlier office cut. No timing cut-off any more. Reggie Grayek, P/S, sold 1/1–11/22: today $719,729 → peak $727,293 (34 accounts cut by others, +$10,632; 82 upsold by others, −$3,069). Supersedes the two entries below.

**2026-11-23 (later) — peak keeps the +$4.87 service fee.** Isaac: "the reduced after the sale is essentially just what we need to add BACK to whatever the revenue is today. But it should also net with the upsell amount. The service fee is revenue that should still count towards the sales reps." The office adds a flat +$4.87/mo to the recurring charge after the initial (292 of Reggie Grayek's 332 changed accounts); a recurring-charge change of exactly +$4.87 is never undone. Net effect per account: peak = today + saves − upsells. Reggie, P/S, sold 1/1–11/22: today $719,729 → peak $727,248 (104 accounts differ: saves added back, upsells taken off). When add-ons / ticket items carry who sold what, attribution moves there.

**2026-11-23 — services/indicators: peak value is the rep's contract just BEFORE the initial is completed.** Isaac (Nov 23): "contract values just PRIOR to appointments being completed" — "sum revenue AFTER the contract is signed from the sales reps". Same formula as Nov 19; the cut-off moves from the end of the completion day to the completion timestamp itself, so a tech's upsell on the initial visit (or any change logged at or after completion) is a modification and is undone. Edits between signing and completion stay — that is still the rep's contract. Supersedes the Nov 19 entry below. Changelog and appointment times are both FieldRoutes' own office-time strings, compared to the second.

**2026-11-19 — services/indicators: peak value is the value right after the initial, not the high-water mark.** Isaac's definition (Nov 19): "the revenue of a subscription immediately after the initial service was completed… before any technician or office rep changed or modified the subscription" — we adjust subscriptions up for upsells and down to save cancels, and peak is the value before either. Rule: `initial + recurring × 11` when billed monthly (billingFrequency 30), `initial + recurring × annualRecurringServices` when billed per service (0 / −1), with the parts as they stood at the END of the initial's completion day (a change that day is the tech selling on the visit, so it counts as the sale); untouched subscriptions are worth what they are today and are not published. The old Netlify build took the *highest* value after the initial and only published accounts below it — 16,951 of the 19,767 subscriptions changed after their 2026 initial were only adjusted UP, so under the new rule peak sits *below* today for those, and the app no longer clamps Peak to `max(current, peak)`. `peak-values` is the port of the frozen Netlify block (its `legacyPeaks` is pinned in the test for the diff) publishing `indicators/peak-values-v2.json`; the Netlify block still writes the old `peak-values.json` daily until the sync ports, which is why the path changed rather than the file.

## 2026-11-23 — Office Staff: pre-service cancel before payroll comes off
Per Isaac: an Office Staff sale with a paid initial is payable before the appointment (unchanged —
"charged upfront" approves it). If the customer cancels before the initial is serviced AND before the
payroll run, the auto-stage pass moves it Commissionable/Below Minimums → Cancelled. If payroll already
ran, it is not reopened — the existing lock pass marks it a chargeback for the next monthly run.
Code: server/services/sync/functions/stageRules.js decideStage + the same block in
netlify/functions/revhawk-sync-background.js (both, until the staging switch). Tests in stage-rules.test.js.

## 2026-11-23 — Unlinked sellers still turn Commissionable
Per Isaac: a sale whose FieldRoutes seller has no app account (rep_id null, e.g. McKay Hansen #19934) moves
through auto-approve like any other — the approval no longer requires rep_id. Payroll still holds those rows
("held" in openPayrollRun) until the account is linked; the live sync then attaches rep_id automatically.
Commissions → Office Staff lists each unlinked seller as its own row ("No app account", estimated at base rates).

## 2026-11-24 — Payable = the FieldRoutes Passed Audit flag
Per Isaac: the computed Passed Audit (7bc9e61) is reverted — every account is still checked by hand. A new
account becomes payable (auto-approve → Commissionable / Below Minimums) when the office puts the Passed Audit
flag on it in FieldRoutes; no waiting on the service or a payment. Office Staff only: Sales Reps and Technicians
are untouched (another developer owns them). Renewals keep their rule (next service or next paid bill). Add-ons and renewals stay out of the Passed Audit %. Pre-service cancels before payroll still come
off; after payroll they're a chargeback.

## 2026-11-24 — Add-ons count as new sales from Jan 1 2027 (NOT BUILT YET)
Per Isaac: add-ons in their new form (FieldRoutes ticket items — Office Staff is mostly on it already) count as new
sales for every rep type starting 2027-01-01. Nothing counts them yet: "new sales" on Overview (branch scorecard),
Marketing and the leaderboards still reads subscriptions only. Which screens and whether they count as a sale, as
revenue, or both is to be confirmed before any number changes.

## 2026-11-24 — Market Watch: RIDD P&L lines mapped to the public companies' categories
Per Isaac: COGS is tech wages, auto and fuel, and product; operating expenses are marketing, office and
sales-related costs (commissions included); adjusted EBITDA adds back every sales-related expense,
housing and door-to-door commissions included.
Market Watch uses the P&L tab's own QuickBooks grouping (putisClassify / putisDerive), last 12 closed months:
cost of services = QuickBooks COGS (merchant fees included, as QuickBooks books them);
selling & marketing = Advertising & Marketing + Selling Expenses + Incentive Costs + Housing;
"EBITDA before selling costs" = EBITDA + that selling & marketing total.
OPEN: the P&L tab's "Adjusted EBITDA" adds back commissions + marketing + incentives but NOT housing.
Not changed — waiting on Isaac. Admin only; a Developer sees "admin only", never sample or real numbers.

## 2026-11-24 — Market Watch simplified; Rollins is the benchmark
Per Isaac: lead with what moves the business, Rollins as the benchmark, plus its share price and next earnings date.
Page order: share price + next earnings, RIDD vs Rollins (first 9 months of 2026 vs RIDD's last 12 closed months),
What to act on (Rollins' own statements with a question for RIDD — suggestions, not findings), then the old tables folded away.
Share price comes from a new function, /api/market-quote (fixed symbol ROL, public data, no secrets). NOT TESTED against
the live sources from the build machine (network blocked) — if both sources fail the card shows a link instead of a number.
Next earnings date is not announced; the page says "Mid-February 2027" as expected from the last three Q4 calls. Set
MARKET_WATCH.nextEarnings.date when Rollins announces it.

## 2026-11-24 — Owner layout / admin settings no longer lost on a save conflict
Card and column orders "kept moving back": when another browser saved the shared config first, the conflict handler adopted
the server copy and replayed only tier tags and team renames. Admin rules set just before the conflict are now replayed too.

## 2026-11-24 — Auditing tasks: three sections, merged families, new checks
Per Isaac's review of the task list. Presentation: Affects pay / Affects billing or the customer / Affects reporting;
same-job tasks sit under one row (Wrong office, Renewals, Sold never serviced, Attribution, Below minimum). Every
member keeps its own key and accounts. Cancellation opens split by the rule broken. Marketing data diagnostics card removed.
New checks and their rules:
- Passed audit: Office Staff sale flagged Passed Audit, not yet paid, account not on autopay.
- Below minimum (Office Staff): unpaid sales the existing pricing check marked (sales.crm_below_min) — no new floor invented.
- Below minimum (Technician): a technician's sale this year of the customer's FIRST plan with a free initial. Isaac: technicians
  may give an add-on a free initial, not a normal service type; Sales Reps may sell a $1 initial (so no initial check for them).
  "Add-on" is read as "the customer already had a plan" — CONFIRM with Isaac.
- Autopay: active recurring plan not on autopay.
- Not serviced: active plan, no completed service in more than 2x its frequency; mosquito/seasonal and custom frequencies left out.
- Agreement: "sent" under 7 days old is no longer a task unless an initial is booked (7 days is our threshold, not Isaac's).
Not built: seller with no app account (Isaac: not needed here); recurring price vs the Price Sheet floor beyond the existing
pricing check; Sold By changed after the sale (the change log only records service and term changes — needs the sync extended).
Sales Rep Audit Report: Pending no longer counts anything never serviced that was sold 30+ days ago (Isaac: those are deleted
accounts). Team-colour row wash removed; red is the only cell colour, with a legend. Table scrolls one direction at a time.

## 2026-11-25 — Channel metrics (provider budgets) and the Source check audit task
Per Isaac: a provider that runs out of budget emails for more; he wants one glance on Marketing to decide. "Funnel by channel"
is replaced by Channel metrics (one row per source: budget, QuickBooks spend and run-out pace, Pest AI leads, bookings,
serviced, FieldRoutes revenue, CAC, return, share of sales confirmed by a Pest AI lead, and a Suggestion). Channel payback is
off. Budgets are typed by the owner and saved in adminRules.provBudgets.
The Suggestion is a written rule, ours not Isaac's — CONFIRM the thresholds: Raise = CAC at or under the all-provider CAC and
within 15% of the provider's own 3-month CAC; Cut = CAC at least 1.5x the all-provider CAC, or spend past two all-provider
CACs with no sale; needs 5 bookings or 30 leads. Spend is QuickBooks, so a provider that bills late reads low.
Auditing → Attribution → Source check: new sales of this month and last whose Pest AI opportunity source maps to a different
channel than the FieldRoutes source (or has none / is unmapped). Sales with nothing in Pest AI stay under No GHL lead.

## 2026-11-25 — Marketing → Budget tab
Per Isaac: his old "LP Spend Projections" sheet, in the app. Year grid of provider budgets by month (admins type them;
adminRules.provBudgetsYM), with QuickBooks spend under each cell, and a Plan vs actual table for one month.
"Expected at this budget" = the provider's own last three closed months (cost per lead, cost per booking, revenue per
booking) applied to the dollars — NOT typed targets. Isaac's sheet had an assumptions box (seasonal allocation, incentives %)
that was cut off in the screenshot: ask whether expectations should come from typed targets instead.
Read: bookings so far ÷ bookings the spend so far should have bought; Ahead >= 110%, Behind < 90%, needs 3 expected bookings
(our thresholds). Channel metrics' budget box now reads and writes the same month store.
Not built: the seasonal allocation row and the revenue-by-branch projection block of the sheet.

## 2026-11-25 — PestBooker is a sales rep, not a source
Per Isaac. Auditing → Attribution → PestBooker lists new sales (this month and last) with PestBooker as the FieldRoutes
source or as the Pest AI opportunity source: set Sold By to PestBooker and the source, in both, to the real channel.
Those sales are out of Source check (a PestBooker stamp proves nothing about the real source). Source check itself only
compares a Pest AI lead within 30 days before the sale with a real lead source.
NOT changed: Marketing still shows PestBooker as a channel row wherever a lead or sale carries it — it empties as the
sources are fixed. Decide with Isaac whether to hide it now.

## 2026-11-25 — Reporting shows the previous sync at once; one snapshot load at a time
A RevHawk snapshot lands every ~5 minutes with a new upload id, so the per-upload IndexedDB cache almost never hit on a
refresh: every reload re-downloaded 12 MB before any sales number showed (and each render started another download).
Now (1) concurrent callers share one load per upload, and (2) on a cold start the last snapshot this browser has in
IndexedDB is shown immediately and replaced when the newest finishes — the same hand-over that already happens when a
sync lands mid-session. Marketing says "from the previous sync" while that is the case.
Source check list: columns are FieldRoutes source / Pest AI source (last touch) / Pest AI first touch / Lead date.
Open: bare GoHighLevel source "Google" maps to Google Ads by rule; Isaac's Nov 25 example (a Reserve with Google booking)
carried it and should be Organic — he is having Pest AI stamp Organic. "Google | <office>" already maps to Organic.

## 2026-11-24 — Add-ons with no rep: only list ones with an appointment behind them
Isaac: "the only ones that really matter are ones where a appointment is scheduled after the add on" (#186193 was listed with no contract, payment or appointment).
An add-on is listed only when its plan has an initial booked (initial pending with an appointment date) or a service completed on or after the add-on date. The rest are counted in a "Not listed: N more" note, not dropped silently. The Commissions "Fix first" banner now loads the FieldRoutes snapshot itself so it can make the same check, and shows nothing until that is in.

## 2026-11-24 — Add-ons with no rep: a real customer lists even with no appointment
Isaac: "what if a rep forgets to schedule an appointment for the upsell WITH the add on?"
An add-on with no appointment behind it still lists when the plan is active and has a completed service, a signed agreement or autopay on — flagged "not serviced since the add-on, check a visit is booked". Only frozen/cancelled plans and plans that never started (none of the three, e.g. #186193) stay off, and are counted in the note. The snapshot has no future-appointment date for existing customers, so the flag says to check rather than claiming none is booked.

## 2026-11-24 — Add-ons task runs two checks: no rep, and no visit booked
Isaac: "is the add on assigned to a rep and did they also book the appointment FOR that add on?"
The task now covers every add-on, not only uncredited ones. No rep: as before. No visit: a real customer (active, with a completed service, signed agreement or autopay) with no initial booked, no service completed on or after the add-on date, and no next service on the plan's calendar (next_appt_date). One day's grace on the no-visit check. FieldRoutes books visits on the plan, not the add-on line, so "a visit for the add-on" means a visit on that plan on or after the add-on date. Each row is tagged No rep, No visit, or both.

## 2026-11-24 — Channel metrics: descriptions out, pacer in the Read column
Isaac: "get rid of the description and then on the read column get rid of the description and show like a pacer with revenue, spend, and projected".
The card's header and footer sentences are gone. Under the Read pill, the sentence is replaced by a small grid: spend and revenue so far, and each projected to month end at the current daily pace (so far ÷ days gone × days in the month). Projected spend turns red when it lands over the budget. A closed month shows finals only. The reasoning sentence stays as the cell's hover text.

## 2026-11-24 — Spend tab: every known lead vendor is a channel; "Not marketing" says where the charge belongs
Isaac: Yelp was missing from "Pick a channel"; and the Advertising & Marketing account holds charges that are not marketing (Ruth's Chris = incentive, Kixie = technology, Wave = consulting/wages).
The channel list now includes every vendor in the app's source list (Yelp, eLocal, Click-To-Buy…). "Not marketing" became four picks — Incentives, Technology, Wages & consulting, Other — all backed out of marketing spend exactly as before (rule stays SPQ_SKIP; the reason is kept in qbSkipWhy). The channel table shows the backed-out dollars by reason under the Total row. Nothing is moved into the incentives or wages tables automatically.

## 2026-11-24 — Spend tab: Agency is a batch of named agencies
Isaac: "I want them to be batched under agency but we have multiple agencies that can fall under that category too."
The Agency pick is now a group: each agency by name, plus "+ New agency…". The rule stays SPQ_TOOLS, so agency dollars are still spread across markets with the media and the Agency row total is unchanged; the agency's name is kept beside the rule (qbAgency, list in agencies). The channel table shows one Agency row with a sub-row per agency (not added to the total twice). Charges already under Agency show as "Not named yet" until an agency is picked.

## 2026-11-24 — Active ARR by branch: legend out, swatch in the Branch column
Isaac: hide the legend under the bar (the columns below carry the same numbers); keep the segments clickable; put each branch's colour beside its name in the table.

## 2026-11-24 — Channels × offices: performance only, the "no lead" red moved out
Isaac asked whether the table duplicates the Auditing tasks. The red "+N no lead" layer did (Auditing → Attribution has No GHL lead and Source check on the same lookup), so it is gone from the cells; the header count links to Auditing. The table stays because it is the only place that shows leads, booked and booking rate by channel BY OFFICE. Also: Channel metrics Read pacer became two thin bars.

## 2026-11-24 — Time to close: every row drills to its sales and leads
Isaac: "let me drill down into each of those and see the data for those leads so I can verify we are pulling in things correctly."
Clicking a channel (or All channels) opens the timed sales behind it, slowest first: customer, office, rep, FieldRoutes source, Pest AI source/channel/type/stage, lead-in and sold stamps (both on the Mountain clock), time to close, CSV export. Sales left out because the lead is stamped after the sale are listed at the bottom, marked not timed.

## 2026-11-24 — Marketing → Media plan: the 2027 media calendar as a model in the app
Isaac: use the "RIDD 2027 Media & Spend Calendar" sheet as budget projections across channels, adjustable, with plan, progress and what is excelling / lagging in one place.
New sub-tab (integrations/marketing-plan.js). Levers, seasonal curve, LSA plan by month and channel mix are the sheet's values (built Nov 19) and are editable by admins; saved in adminRules.mediaPlan[year]. Arithmetic is the sheet's: budget = target × ratio; pool = budget − fee × 12 − LSA; month = pool × curve; channel = month × mix share. Checked against the sheet for the $7M case (total $2,730,000, pool $1,814,566, every month and the Facebook row to the dollar).
The plan is each channel's monthly budget when nothing is typed on the Budget tab (mkbBudgetOf falls back to mkpBudgetFor), so Channel metrics reads it. Search and Performance Max are one "Google Ads" line for actuals because QuickBooks cannot split them.
Read on Progress is derived, not typed: a channel's spend ÷ new revenue against the plan's media ratio ((budget − agency fee) ÷ target, 34.2% at the defaults); Excelling ≤ 85% of it, Lagging ≥ 115%, needs 5 sales.
Not brought over: rep capacity & hiring, market flighting, the new-channels list, the 5–10M scenarios.
OPEN: the sheet's 2026 base is $5.20M of inside-sales new revenue (Jan 1–Nov 18); the Marketing tab's own New revenue for 2026 reads $3.32M. Progress uses the Marketing tab's number, so the $7M target and the actuals are not yet on the same basis.

## 2026-11-25 — Media plan: the 2026 base is $3.32M, not $5.20M
Isaac: "we are only at 3.32m so that was a typo in that google sheet." The Marketing tab's New revenue is the right basis, so Progress and the target are on the same footing and nothing needs reconciling. The sheet will be rebuilt later once Isaac has the full picture; the levers in the app stay as they are until then.
