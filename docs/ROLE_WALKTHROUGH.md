# RIDD Sales Platform — Role Walkthrough

_Snapshot audited 2026-09-21, read-only. Question asked of every screen: how fast can this person do the five things they do every day? Clicks are counted from the post-login landing page on desktop; the nav menu (spider button) costs 1 click to open + 1 to pick. Phone paths add nothing except that sub-tabs become a `<select>`._

Role gating recap (`src/10-core.js`): `isAdminRole` = admin/admin_rep; `isOfficeLeadRole` = rep_office_lead/rep_loyalty_lead; `isPartnerRole` = rep_partner/rep_team_lead; everything else is a plain rep. `repTypeGroup` (`40-dashboard-and-rep-data.js:179`) sorts explicit roles into office/d2d; `defaultViewFor` (`:188`) lands office → `sales`, d2d → `d2d_dashboard`, admin → `dashboard`. `mountApp` (`30-shell-nav-mount.js:658-721`) enforces one sales world per group and bounces non-admins off `reporting|marketing|admin` to Indicators (`:686-690`).

---

## 1. Inside Sales rep (`rep_office`, legacy `rep` + Office Staff)

**Landing:** Sales tab, Upfront Sales queue (own rows only, `50-sales-queue.js:18`). Sub-tab bar: Dashboard · Sales · Pay · Scorecards · Calendar · Hall of Fame. Nav menu: Sales, Competitions, Indicators, Pricing, RIDDMADE. Above the queue: the "Today" strip (`85-exceptions.js:157`) when there is a running comp, a bounced sale, or an open shift.

| Daily job | Path from landing | Clicks | Must type/set |
|---|---|---|---|
| Today's sales + rank | Dashboard sub-tab. Date filter defaults Today; own row tinted on the leaderboard (`40:5859`). "This period" = date dropdown → This Week/Month (no pay-period option). | 1 (+1 for a period) | nothing |
| Sale synced / stage | Landing is Upfront. Pending Backend Lock = 1 pill; History = 1 pill. Status chip, Service Date, PIF/Upfront marks and the CRM ✓ chip row (`50:763-868`) explain the stage. Search box for a customer. | 0–1 | customer name if the queue is long |
| Pay + pending | Pay sub-tab; always opens on the current period (`30:1022`); pending-audit line at the bottom of the stub (`52:334`). Stub DMs need Slack opt-in: gear → My Settings → paste member ID (once). | 1 | Slack ID once |
| Inside Sales League | Nav → Competitions → poster landing → "Inside Sales League" button. Landing re-shows every visit (`30:1020`). | 3 | nothing |
| Shifts | Calendar sub-tab; month view; "Includes you" tint. | 1 | nothing |

**(c) Irrelevant / duplicated.** Revenue Pacer shows the *department* bars by default; the rep's own pacer is behind the Individual toggle (2nd click each visit). Hall of Fame sub-tab and Pricing nav entry are not daily. Dashboard KPI "Renewals" tile is an inside-sales metric, fine, but it deep-links to the *History* queue (`40:1040`) while Total/New go to Upfront.
**(d) Forgotten every visit.** `dashDateRange`, `dashLeaderTab`, `dashGoalMode`, `_salesQueueFilter`, `salesFilters`, `_compsLanding` are all session-only on `state` (`10:2493-2512`); nothing about them is in `user_prefs` (`40:3632`) or localStorage. Only the Indicators date default and layouts persist (`_repLayoutPrefs`). Resume restores tab + scroll for 5 minutes only (`10:2612`).
**(e) Should come from the CRM but doesn't.** Very little — the sync already stamps serviced date, first payment, autopay, e-sign, audit flag, PIF, commercial and charged-upfront (`revhawk-sync-background.js:1391-1460`). The one gap: no rank number is shown; the rep must scan the board, and if they have no sale in the window they are absent from it (`40:5720`).

## 2. Loyalty rep (`rep_loyalty`)

Same landing, nav and sub-tabs as §1. Differences per job:

| Daily job | Path | Clicks | Notes |
|---|---|---|---|
| Renewal sales | Dashboard → leaderboard *Renewals* pill (`40:5747`). Pill resets to Total every load (`10:2500`). | 2 | The Individual pacer races **new** revenue only; a loyalty rep's renewals show as a muted "+$X renewal" and the bar reads "behind" (`40:642-670`). |
| Renewal leaderboard | as above | 2 | |
| Pay | Pay sub-tab | 1 | Loyalty Royalty / Loyalty Pay rows appear only if `profile.rep_type === 'loyalty_rep'` (`52:154-155`) — the `rep_loyalty` role alone gives Golden Phone rows. |
| Comps | Nav → Competitions → ISL | 3 | ISL is the only Office Staff comp; there is no renewal-specific board. |
| Calendar | Calendar sub-tab → department dropdown → Loyalty | 2 | `calendarDepartment` boots as `inside_sales` (`10:2514`), is only persisted in DEMO (`saveDemoData`), and is never derived from `calendarAgentDept(me)` (`54:296`). |

(c)/(d)/(e) as §1, plus: the Goals tab computes a per-rep quarterly *renewal* quota (`98-admin.js:938-964`) that never reaches the rep's screen.

## 3. Managers

### Office lead (`rep_office_lead` / `rep_loyalty_lead`)
**Landing:** Sales tab (own sales only — the queue pool is `mySales` for every non-admin, `50:18`). Nav/sub-tabs as §1; Calendar gains "+ New shift", Min/shift and swap approvals (`calendarCanManage`, `54:280`); Scorecards shows the whole department roster (`66:69-73`).

| Daily job | Path | Clicks | Notes |
|---|---|---|---|
| Team today / week | Dashboard → leaderboard (all office staff, Today) | 1 (+1 range) | Pacer is personal-only for leads; the per-rep roster view is admin-only (`40:656-667`). |
| Quiet / slipping | "Needs attention" card (collapsed) → expand | 2 | Quiet-reps rule is skipped for office scope (`85:46`); Attrition/Audits/Pending rows link to `reporting`, which the route guard bounces to Indicators (`30:686`). Player cards from the leaderboard (dept scope, `40:3818`) are the working path. |
| Attrition / cancels | Nav → Indicators (opens in Teams mode, `64:77-81`) | 2 | Office leads get the Teams lens although their unit is a department. |
| Failed audits / queue | none in their world; Audit chip is visible only on their own rows | — | The CRM Failed-Audit flag per rep is in Indicators (`audit_fail`) only. |
| Scorecards, call grading, 1:1s | Scorecards sub-tab; period defaults to latest; dept pinned | 1 | Good. |
| Competitions | Nav → Competitions → ISL | 3 | |

### D2D partner / team lead (`rep_partner` / `rep_team_lead`)
**Landing:** D2D Dashboard (`92-commission-engine.js:244`): Needs-attention card, Today strip, range select, hero Today/Week/Month/Year, leaderboard (company-wide, Teams/Offices standings toggle), Sales (own rows), Pay (placeholder, `94:5-14`). Nav: Sales, Competitions, Indicators, Pricing, RIDDMADE.

| Daily job | Path | Clicks | Notes |
|---|---|---|---|
| Team today/week | Landing hero + leaderboard; Team Standings toggle | 0–1 | No "my team only" filter on the leaderboard; standings card lists all teams. |
| Quiet / slipping | Needs attention → expand → "Leaderboard →" | 2–3 | Works (item 2). Items 3-5 never appear: the snapshot is prefetched only for admins/office staff (`10:1737`). |
| Team attrition / cancels | Nav → Indicators (Teams mode, team player cards `64:8805`) | 2 | Good once there. |
| Failed audits | Indicators table `audit_fail` column / player card | 2 | No audit queue: Sales tab is self-only (`50:19`) although drill reach is "team". |
| Scorecards / 1:1s | not in the D2D group | — | By design (office tool). |
| Competitions | Nav → Competitions → landing → comp button | 3 | Today-strip chip is the shortcut, but it routes to the legacy `competitions` view (`85:174`), not `nrla`. |

**(d)** `_d2dLbRange`, `_d2dStandings`, `_excOpen`, `indicatorsGroupBy` are session-only. **(e)** Team membership is app-only (Manage Teams), which is right — the CRM has no team concept.

## 4. Admin (Isaac — `admin`, `is_owner`)

**Landing:** Inside Sales Dashboard with the Office Staff ⇄ D2D Sales ⇄ Technicians toggle riding the sub-tab bar (`30:68`). Nav: Sales, Competitions, Indicators, Reporting, Pricing, RIDDMADE; gear → Resync · theme · Settings · Feedback · TV Display · Sign out.

| Daily job | Path | Clicks | Must set |
|---|---|---|---|
| Audit queue (Upfront) | Sales sub-tab → Status dropdown per row | 1 + 1/row | Status. **But** staging also needs `audited_by` (`99:1192-1202`) and the desktop table no longer has the Auditor dropdown — the Audit column now shows the CRM flag (`50:684, 762`). Only the phone card list still renders `auditorSelect` (`50:501`). |
| Pending Backend Lock | Sales → Backend pill → Audit 2 + Lock per row | 2 + 2/row | Sync auto-locks/chargebacks (`sync:1540-1545`), so mostly review. |
| Payroll | Pay sub-tab → Agent picker → Run Pay Period → confirm | 4 **per rep** | `commissionable` is scoped to the viewed rep (`52:171,286`). "Run Backend" is also per rep. D2D commissions: no route at all (`viewD2dUpfront` unreachable). |
| Sync health | Header "Last sync" stamp → Data sources sheet | 1 | Sheet lists client loaders only (`10:3756`); server heartbeat/errors live in `/api/sync-status`, which the tooltip tells you to open by hand (`30:885`). Settings → Admin → Data Integrity for the deeper checks (3). |
| Reporting | Nav → Reporting → sub-tab (Overview default) | 2–3 | Snapshot is prefetched at login (`10:1733`); good. Sub-tab remembered 5 min. |
| Settings | Gear → Settings → section (Users default) | 2–3 | Users are prefilled from the CRM roster; Role **and** Rep Type must both be set for office staff (`99:2776-2783`). Close rate per rep is hand-maintained. |

**(c)** Admin sees every rep's Today strip logic skipped (correct), but the Dashboard exception feed sits above a department pacer they rarely need daily. **(d)** Sales filters, queue pill, pay agent picker, Reporting sub-tab beyond 5 min, admin section beyond 5 min — all reset. **(e)** `upfront_collected`, PIF, commercial, serviced, first-paid, e-sign and audit flag are already synced; the ISL still gates "agreement on file" on `contract > 1` (`60:3192-3197`) although `contract_state` is in the mirror (`crm_subscriptions`, derive worker col list) but not in the indicators row shape (`64:5412-5436`).

---

## Findings (ranked by impact)

| # | Class | Finding | Where | Minimal fix |
|---|---|---|---|---|
| 1 | **A** | Auto-approved sales can never be staged from a desktop. The sync sets `audit_status='serviced'` but not `audited_by`/`staged_for_payroll` (`revhawk-sync-background.js:1538`); `_evalStaging` requires an auditor (`99:1192`); the desktop table has no Auditor control (`50-sales-queue.js` `salesTable` `:683-684, :758-762`). Pay tab then lists them as pending (`52:48-50`) and "Run Pay Period" stays disabled. | sync + `salesTable` + `_evalStaging` | In the auto-approve branch add `upd.staged_for_payroll = true; upd.staged_at = stamp;` (the CRM flag *is* the audit now). In `auditSale` (`99:1230`) also write `audited_by: sale.audited_by || state.profile.id` — which is what its own comment at `50:943` already claims it does. |
| 2 | **A** | `downloadPayrollCsv` computes rates and the filename from `state.profile.id` (the admin), not the viewed rep (`52-pay.js:756, :779`): per-rep pay overrides are ignored in the export. | `downloadPayrollCsv` | Add a `repId` parameter; call `downloadPayrollCsv(commissionable, period, repId)` at `52:296`. |
| 3 | **A** | D2D Pay is a dead end for reps ("being rebuilt") and admins have no entry point to run D2D commissions (`94-commission-view.js:5-14`; `viewD2dUpfront` `92:703` orphaned). | `viewCommission` | Until the rebuild lands: `return isAdminRole(role) ? viewD2dUpfront() : commissionMyPay();` — both functions exist and are RLS-safe. Or drop `['commission','Pay']` from `D2D_SALES_TABS` (`30:40`). |
| 4 | **A** | Manager exception rows deep-link to `reporting` (`85-exceptions.js:92, :109, :126`); office leads and partners are bounced to Indicators by `ADMIN_ONLY_VIEWS` (`30:686`). | `exceptionFeedItems` | Compute `const _adm = isAdminRole(state.profile?.role)`; for non-admins set `onClick: go('indicators')` (Attrition/Pending) and drop the button on Audits, or point Audits at `go('sales',{_salesQueueFilter:'backend'})` for office leads. |
| 5 | **A** | Rep Today-strip comp chip navigates to the legacy `competitions` view while patching `_compsTabSel/_compsRepTypeTab`, which belong to `viewNrlaPublic` (`85:174`). | `repTodayStrip` | `go('nrla', {...})`. |
| 6 | **A** | Loyalty reps open Calendar on Inside Sales every session (`56-calendar.js:36-46`; `10:2514`; only persisted in DEMO). | `viewCalendar` | At the top: `if (!state._calDeptInit && !isAdmin) { state._calDeptInit = true; state.calendarDepartment = calendarAgentDept(me); }`. |
| 7 | **A** | Individual pacer is a NEW-revenue pacer for everyone; loyalty reps (renewal quota) always read "behind" (`40-dashboard-and-rep-data.js:642-670`). | `viewDashboard` Individual branch | If `scorecardDeptOf(me) === 'loyalty'` use `renByRep` for `rev`, `g.monthly_renewal` for `_shape`, and swap the subtitle to "YTD renewal revenue". |
| 8 | **A** | Sync health sheet shows client loaders only; server heartbeat (stage/ok/errors, recent snapshots) is in `/api/sync-status` and the tooltip sends admins there by hand (`30:885`, `10:3756`). | `openHealthSheet` | For admins, `fetch('/api/sync-status')` on open and render `lastRun.stage/ok/ms` + `recentSnapshots[0].uploaded_at` as the first row. |
| 9 | **A** | Per-rep quarterly quotas exist (`98-admin.js:938-964`) but never reach a rep's screen. | `viewDashboard` My Pacer tiles (`40:718`) | Add one tile: `Q quota` = `g.quarterly_new[q]/g.is_reps` (or renewal/loyalty_reps) vs quarter-to-date revenue. |
| 10 | **B** | Loyalty detection differs: Pay and Calendar use `rep_type` only (`52:154`, `54:297`); Scorecards accept the role too (`64:10613`). A `rep_loyalty` user without `rep_type` gets Golden Phone rows and files under Inside Sales shifts. | three call sites | Reuse `scorecardDeptOf(p) === 'loyalty'` in both places (or one `isLoyaltyProfile(p)` helper in `10-core.js`). |
| 11 | **B** | Office leads (reach = dept) get the personal pacer only; the roster view is admin-only (`40:665-667`). | `viewDashboard` | `const mine = me && !isAdminRole(me.role) && !isOfficeLeadRole(me.role) ? … ` and filter `sellers` to `scorecardDeptOf(p) === scorecardDeptOf(me)` for leads. |
| 12 | **B** | Payroll runs per rep (`52:171, :286`); admins iterate the agent picker N times. `processPayroll` already accepts any list. | `viewPay` toolbar | Add "Run all staged →" calling `processPayroll(state.allSales.filter(s => inPeriodAnyRep(s) && s.staged_for_payroll), period)`. |
| 13 | **B** | Partners' Sales queue is self-only (`50:19`) though their permission reach is "team". | `viewSales` | For `isPartnerRole`, also keep rows whose rep's `getRepTeam(full_name)` is in `myReachTeams()`. |
| 14 | **B** | Leaderboard pill defaults to Total for loyalty reps and resets every load (`10:2500`). | state init / `leaderboardSection` | `if (!state._lbTabInit) { state._lbTabInit = true; if (scorecardDeptOf(me)==='loyalty') state.dashLeaderTab='renewals'; }`. |
| 15 | **B** | Dashboard KPI "Renewals" opens the History queue; Total/New open Upfront (`40:1038-1040`). | `viewDashboard` | Drop the `_salesQueueFilter:'history'` patch (or set `sf.sourceId` to a renewal source). |
| 16 | **B** | "Quiet reps" rule skips office scope (`85:46`), so office leads never get it. | `exceptionFeedItems` | For `scope.kind==='office'` run the same 14-day/3-day test over `dashboardSales()` grouped by `rep_id`. |
| 17 | **B** | Settings → Admin says "Manual syncs are retired" while the gear offers Resync (`98:~590` vs `30:955`). | `adminUploads` copy | Update the sentence. |
| 18 | **C** | Competitions always reopens on the poster (`30:1020`); office staff have exactly one comp, so it is a pure extra click. | `mountApp` | Skip the landing when `landingComps.length === 1` for non-admins. |
| 19 | **C** | No "You are #N" on the Dashboard leaderboard; a rep with no sale in the window is absent. | `leaderboardSection` | A one-line "Your rank: #N of M" under the header. |
| 20 | **C** | Dashboard date filter has no "This pay period" option though `getPayPeriods` exists. | `viewDashboard` select | Add `pay_period` to `getDateRange`. |
| 21 | **C** | ISL and comps gate "agreement on file" on `contract > 1` while `contract_state` is synced (`60:3185-3197`, `64:5412`). | derive worker / indicator row | Carry `contractSigned` into the indicators row; `islQualifies` already prefers it. |
| 22 | **C** | Close rate per rep is hand-maintained in Users (`52:81`). | — | Leave unless a lead source exists in FieldRoutes/GHL. |

**Not findings (intentional, confirmed in code comments):** office staff landing on Sales rather than Dashboard; session-only leaderboard rep filter; comps pinned to the viewer's rep type; scorecards being an office-only tool; manual sale logging retired.
