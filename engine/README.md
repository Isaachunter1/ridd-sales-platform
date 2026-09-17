# RIDD Indicators Engine

The competition scorers from the RIDD Sales Platform, as a standalone module.
**It is not a port.** `engine/src/*.js` is bundled into the app itself (`app.js`)
and, unchanged, into `engine/dist/ridd-engine.js`. Same functions, same inputs,
same numbers — by construction. When the app's math changes, the engine changes
in the same commit and gets a new version.

## Get it

Pick one:

- **URL, pinned by version** (simplest for a server; no npm, no git):
  `https://riddsalesapp.netlify.app/engine/dist/ridd-engine.js` is always the
  version currently deployed; `https://riddsalesapp.netlify.app/engine/latest.json`
  says which. Save a copy per version on your side.
- **Git tag**: every engine release is tagged `engine-vX.Y.Z` in `ridd-sales-platform`;
  the file is `engine/dist/ridd-engine.js` at that tag (or run `npm run engine` to rebuild it from `engine/src`).

It is a UMD file: `require()` it in Node, `import` it after a bundler, or load it
with a `<script>` tag (exposes `window.RiddEngine`). No dependencies.

## Use it

```js
const { createEngine, version } = require('./ridd-engine.js');

const eng = createEngine({
  sales:  rows,      // see "Inputs"
  config: cfgRow,    // the indicator_config row (id = 1) from RIDD's Supabase
});

eng.competitions()               // the competition list as the app resolves it (defaults + admin edits)
eng.comps.nrla()                 // NRLA: { comp, cfg, teams, rounds, standings, seeds, ... }
eng.comps.springCleaning()       // Spring Cleaning: { ranked, scored, counting, pending, excluded, categories, ... }
eng.comps.topGun()               // Top Gun: { rookie, vet, pro, none } — each an array of rep rows
eng.comps.kobeWeek(rows, from, to)   // Kobe Week: one row per rep with bestWk / bestRev (defaults: this season's window)
eng.comps.lastManStanding()      // { rounds, alive, champion, rosterSize, ... }
eng.helpers.canonicalRepName(n)  // alias-merged spelling the app uses everywhere
eng.helpers.pendingServiced(row) // the Pending/Serviced revenue rule
eng.helpers.repTier(name)        // 'rookie' | 'vet' | ... (Manage Teams tags + sales-history default)
```

Every scorer takes an optional `rows` first argument to score a subset (a
branch, a window); omit it to use the rows you built the engine with.

## Inputs

**`sales`** — one object per subscription sale, the shape the app's snapshot uses
(`indicators/latest.json.gz` → `rawSales`). From `market_feed.indicator_sales`
map the same columns. The fields the scorers read:

| field | example | notes |
|---|---|---|
| `rep` | `"Murray, Karson"` | CRM "Sold By" spelling; the engine canonicalizes via the alias map |
| `repType` | `"Sales Rep"` | CRM employee type: Sales Rep · Office Staff · Technician |
| `office` | `"Atlanta"` | branch |
| `dateSold` | `"3/14/2026"` | M/D/YYYY (what the CRM exports) |
| `contractValue` | `1013.4` | subscription contract value |
| `initialPrice` | `99` | initial service price |
| `subscription` | `"Pest 4"` | service type name |
| `customerFlags` | `"Passed Audit, Paid In Full"` | comma-joined customer flags (audit gates) |
| `status` / `initialStatus` / `services` / `servicedDate` | | Pending/Serviced evidence |
| `customerId`, `source`, `autoPay`, `cancelDate`, `cancelReason` | | used by specific comps |

**`config`** — the `indicator_config` row as stored (`select * from indicator_config where id = 1`).
The engine reads `competitions` (`list`, `active`, `removed`, `repAlias`, `extras`,
`tierYears`), `rep_tiers`, `rep_teams`, `rep_active`, `rep_offices`, `team_excluded`.
Read it live from RIDD's Supabase with a read-only key rather than copying it —
that's the other half of "same numbers": same math **and** same config.

## Versioning

`engine/package.json` carries the version. A change to any file in `engine/src`
bumps it and the commit is tagged `engine-vX.Y.Z`. Patch = numbers identical,
internals only · minor = new scorer or new output field · major = an existing
output changes shape or meaning.

`npm run engine` rebuilds `dist` and runs `engine/test/smoke.js`, which is also
part of the app's CI — a scorer that starts depending on an app-only global
fails the deploy rather than your server.

## What's in this version (0.1.0)

NRLA, Spring Cleaning, Top Gun, Kobe Week, Last Man Standing, plus the shared
helpers (name canonicalization, Pending/Serviced rule, department classifier,
tiers, competition config). Not yet extracted: the leaderboard / Power Ranking,
records, class metrics, sales mix, scorecards — those are next.
