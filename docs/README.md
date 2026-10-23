# docs/

One line per file. **Current** = describes how things are; **historical** = a dated snapshot kept for the reasoning, paths may predate the Oct 2026 layout (`src/NN-*.js` → `app/src/<feature>/`, `tools/` → `app/scripts/` + `app/test/`, `migrations/` → `db/migrations/`).

| File | Status | What |
| --- | --- | --- |
| `ARCHITECTURE.md` | current | the target shape of the platform and the plan for the port (TJ, Oct 13 2026) |
| `DECISIONS.md` | current | one dated paragraph per decision; read before proposing to undo one |
| `RUNBOOK.md` | current | what goes wrong and where to look |
| `TECH_UPSELLS.md` | current | add-ons: the 5-paid-invoice streak and the ticket-item rules |
| `revhawk_sync_setup.md`, `revhawk_service_account_setup.md` | current, Netlify-era | the RevHawk → snapshot sync as a Netlify function; rewritten when `sync/` ports to the server |
| `DEPLOY_NEW_COMPANY.md`, `GENERALIZATION.md` | ask Isaac | multi-tenant deployment and the CRM-vocabulary layer; live or aspirational is not recorded |
| `ROLE_WALKTHROUGH.md` | current | what each role sees, screen by screen |
| `DESIGN_CONSISTENCY.md` | current | the UI conventions and the `uiBtn` migration note |
| `NUMBER_PROVENANCE.md` | current | where every reported number comes from and which rule it follows |
| `reporting_reconciliation.md` | historical | the Reporting-tab reconciliation against the CRM |
| `AUDIT.md` | historical (Sep 2026) | the platform audit the port and the deferred list were drawn from |
| `PRODUCT_IMPROVEMENT_PLAN.md` | historical | the prioritised plan that followed the audit |
| `design-kit/` | current | Cam's design kit (the login "door", wordmark, palette) |
