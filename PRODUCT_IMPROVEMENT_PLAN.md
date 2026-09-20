# Product Improvement Plan

Ordered by the brief's priority: data integrity → security → reliability → correctness → usability → performance → polish → delight. Each step is small enough to ship on its own, CI-gated, and reversible. "Class" follows AUDIT.md (A objective / B consistency / C subjective).

## Sprint 0 — Close the doors (this week)

1. **P0-1** Secret-gate the three open background workers; scheduled kickers pass `x-sync-secret`. _S · A_
2. **P0-2** Tighten write policies on `call_audits`, `scorecard_cards`, `scorecard_meetings`; calendar writes through an RPC scoped to the caller's own entries for reps. Ship as one re-runnable migration + app fallback (rep calendar edits go through the RPC). _M · A_
3. Delete the dead auth comment block in `slack-paystub.js`. _S_
4. Run `20260920_owner_admin.sql`; claim Admin - Owner. _S_

## Sprint 1 — Make money auditable

5. **P1-10** `src/attrition.js`: one module for the ROR / one-time / renewal / serviced predicates; leaderboard, player card, landing tiles, Retention import it. Fixture test in `tools/attrition-test.js`, wired into `npm run check`. _S/M · A_
6. **P1-4 / P0-3 (part 1)** `tools/pay-test.js`: fixture sales → expected stub lines for each rep type; runs in CI. _M · A_
7. **P0-3 (part 2)** `commission_results.inputs` (jsonb): engine version, rate table hash, sale ids + amounts, adjustments. "Explain" button on a stub line shows the inputs. _M · A_
8. **P3-2 (part 1)** Extend config history to `pay_settings` / `commission_config` writes (trigger copying old → history). _S · A_

## Sprint 2 — Reliability you can see

9. **P1-7** `state._health` + header status sheet; loaders report ok/stale/error; toasts only for user actions. _M · A_
10. **P1-8** "Run FieldRoutes check now" (admin) on the deleted-accounts step; 429 back-off counter in the live sync. _S · A_
11. `withBusy(btn, fn)` helper; apply to every Save/Send/Export. _S · A_
12. CAS for admin-edited `app_settings` keys (pay_settings, commission_config, autolog). _M · A_

## Sprint 3 — Phone and consistency

13. **P1-5** Invert the table CSS default; sweep every table; verify on a phone per tab. _M · B_
14. **P1-6** Control classes (`.ctl`, `.ctl-primary`, `.ctl-select`) + sweep. Keep "button shows its value" convention. _M · B_
15. **P2-1** Tap targets ≥ 40 px via padding. _S · A_
16. **P2-2 / P2-3 / P2-10** Formatting + terminology sweep with a small `fmt` audit script that greps for raw `toFixed(` and `toLocaleString(` outside `fmt`. _S · B_
17. **P2-7** Merge the two `:focus-visible` rules into one. _S · B_

## Sprint 4 — Speed

18. **P1-3** Minify with source maps. _S · A_
19. **P1-2** Role-split bundles (`app-rep`, `app-admin`) with a tiny loader. _M · A_
20. **P1-1** `mountCard(id)` incremental render for the four heaviest cards; measure before/after with `performance.mark`. _L · A_
21. Blob parse + first derive in a Web Worker. _M · A_

## Sprint 5 — Product

22. **P3-3** Manager exception feed (one page, deep links). _M_
23. **P3-4** Rep "today" strip above the player card. _S/M_
24. **P3-6** Upsell record shape + fixture before the upsell UI build. _M_
25. **P3-5** Save-attempt loop off the Daily Pulse churn list. _M_
26. **P3-1** Server-computed pay (after 6–7 are stable). _L_

## Final polish pass (after each sprint, 30 minutes)

Spacing on card headers, radii, icon sizes, wrapping at 375 px, empty states, tooltips on every icon-only button, capitalisation, currency/date formats.

## Explicitly not doing

- No framework migration, no rewrite. The bundle/render model is improvable in place.
- No visual redesign. Brand, palette, typography, navigation and information density stay.
- No changes to CRM/QuickBooks sync semantics beyond auth gating and health reporting.
- No feature additions that don't map to a named problem above.
