# RIDD Sales Platform — Design Consistency Audit

Scope: `src/*.js` (33 files, ~61k lines) + `index.html` CSS. Counts are `grep`/regex tallies over the snapshot; "examples" are `file:line`. Classes: **A** = objectively broken/contradictory, **B** = inconsistent with the rest of the product, **C** = subjective.

**Out of scope (intentionally distinct):** `67-tv-board.js` (TV board, own `T.*` palette), `95-pricing.js` (pricing slick, `C.*` palette), the NRLA / Hall of Fame / Mystery Box skins in `58-*` and `60-*` (own colours, `fontWeight: 900`, `#F2148C`/`#0E1C30` etc.), and the Competitions landing poster (`body.comp-landing`). Their counts are excluded where noted; where included they are a small minority.

**Two CSS facts that change the picture**
- `index.html:245` — `.rounded, .rounded-md, .rounded-lg, .rounded-xl, .rounded-2xl, .rounded-3xl { border-radius: 0 !important }`. Every radius utility except `rounded-full` is dead. `rounded-lg` (248 buttons) vs `rounded-xl` (35) vs `rounded` (32) vs `rounded-md` (9) look identical; the variance is pure noise.
- `index.html:261` — `h1, h2, h3 { font-family: var(--font-display); font-weight: 400 !important }`. Any `h2`/`h3` renders in Anton regardless of `font-bold`; a `div` with the same classes renders in Archivo. Card titles therefore come in two fonts depending on which tag the author picked (see §8).

---

## 1. Buttons

609 `el('button', …)` calls; 584 with a class string; **315 distinct class strings**. There is no shared button helper in `10-core.js`. Local helpers exist but are file-scoped: `btn` in `30-shell-nav-mount.js:70`, `56-calendar.js:1173`, `96-retention.js:2298` (+ pricing), `pill` in `98-admin.js:416`, `configInfoBtn` in `84-reporting-config-panels.js:23` (12 uses). Intent (primary/secondary/danger) is always set by inline `style`, never by class.

| Token axis | Variants (count) | Note |
|---|---|---|
| Size | `px-2.5 py-1` (≈350) · `px-2 py-0.5` (≈35) · `px-3 py-1.5` (7) · `px-4 py-2` (4) · `px-5`/`py-2.5`/`py-3` (9) | One dominant size |
| Font size | `text-[11px]` (376) · `text-[10px]` (60) · `text-xs` (19) · `text-[12px]`/`[13px]`/`[9px]` (7) | |
| Weight | `font-bold` (202) · `font-semibold` (174) · `font-black` (23) · `font-medium` (15) | bold vs semibold split ~50/50 on the *same* control |
| Radius | `rounded-lg` 248 · `rounded-full` 61 · `rounded-xl` 35 · `rounded` 32 · `rounded-md` 9 | all but `rounded-full` are no-ops |
| Primary bg | `var(--accent)` 110 · literal `#DF643A` 4 · `bg-lime` 4 (`10-core.js:3821`) | `#DF643A` is wrong in dark mode (accent is `#FF5F2E` there) |
| Secondary | `border` + `borderColor: var(--border-2)` vs `var(--border)` vs `bg: var(--card)` (15) vs `var(--card-2)` (15) vs `transparent` (34) | 5 looks for "bordered button" |
| Danger | `#DC2626` (23) · `#B91C1C` (6) · `text-red-500` (4) · `rgba(220,38,38,…)` (3) | |
| Icon/close | 87 close buttons, **33 distinct** class strings (§5) | |

Representative combos: `rounded-lg px-2.5 py-1 text-[11px] font-bold` (22, `56-calendar.js:544`) vs `… font-semibold` (15, `54-competitions.js:433`) vs `… font-bold transition hover:brightness-95` (17, `30-shell-nav-mount.js:1073`) vs `px-2.5 py-1 text-[11px] font-semibold transition` (14, `20-reporting-auditing.js:556`) vs `rounded-xl px-2.5 py-1 text-[11px] font-medium … border` (5, `64-indicators.js:9474`).

**A — the toolbar-height rule only matches one radius.** `index.html:266` `button.rounded-xl.px-2\.5.py-1.text-\[11px\]:not(.w-full)` normalises padding/height "everywhere (per Isaac)" but only 35 buttons use `rounded-xl`; the 248 `rounded-lg` siblings in the same toolbars keep `py-1` and sit ~2px shorter. Either widen the selector to `.rounded-lg` too or (better) route through a helper.

**Toggles / segmented controls.** `.pill-tabs` CSS exists (`index.html:750`) but is used **once**. 22 buttons implement on/off state with ternary backgrounds in 8 different pairs: `var(--card-2)/transparent` (13, `60-nrla:3246`), `rgba(223,100,58,.10)/transparent` (2, `80-putis-shid.js:1159`), `var(--accent)/var(--border-2)` (2, `98-admin.js:40`), `#DF643A/transparent` (`64-indicators.js:7768`), `#323230/transparent` (`60-nrla:4762`), plus 49 `? 'var(--accent)' : …` ternaries on borders/colours for "selected chip".

**Canonical (already dominant):** `px-2.5 py-1 text-[11px] font-bold` (≈200 sites) with `transition hover:brightness-95`; primary = `background: var(--accent); color: var(--accent-text)`; secondary = `border; borderColor: var(--border-2); background: var(--card)`; ghost = no border, `color: var(--text-muted)`; danger = `#DC2626` text on secondary shell; radius: drop the class entirely (it is dead). Pills/chips stay `rounded-full px-2.5 py-0.5 text-[11px] font-semibold` (8 + 4 + 4 uses, `60-nrla:374`, `62-manage-teams.js:396`).

**Migration (B):** add `uiBtn(kind, label, opts)` to `src/10-core.js` next to `el` (`kind ∈ primary|secondary|ghost|danger|pill|toggle`), returning `el('button', {class, style, onclick, title})`. Route the ~530 in-scope buttons through it file by file; the 315 class strings collapse to 6. Replace the 4 `bg-lime text-eerie` primaries (`10-core.js:3821`, `99-commission:…`) first — they depend on a legacy palette that may not even be in the prebuilt Tailwind (config `content: ['index.html']` cannot see classes used only in `src/*.js`). Make the 22 toggles use `.pill-tabs`.

---

## 2. Spacing

| Card padding (419 `.card` strings) | count | Section gap (all class strings) | count |
|---|---|---|---|
| `p-4` | 72 | `gap-2` | 481 |
| `p-5` | 49 | `gap-3` | 303 |
| `p-3` | 33 | `gap-4` | 150 |
| `p-6` | 20 | `gap-1.5` | 126 |
| `p-4 sm:p-5` | 9 | `gap-5` | 21 |
| `p-2.5` / `p-1.5` | 18 | `gap-6` | 4 |
| `p-8`/`p-10`/`p-12` (empty states) | 48 | | |

Header row bottom margin on `flex … justify-between` rows: `mb-1` 23 · `mb-3` 19 · `mb-2` 12 · `mb-4` 8 · `mb-5`/`mb-1.5`/`mb-0.5` 7.

Empty-state cards alone have 8 spellings: `card p-10 text-center text-sm text-muted-` (14) · `card p-8 … text-sm text-muted-` (9) · `card p-10 text-center` (6) · `card p-8 text-center text-sm` (4) · `card p-12 …` (3) · `card p-8 text-center text-xs …` (1) · `card p-8 text-center text-muted- text-sm` (1, reordered).

**Canonical:** content card `p-4` (72 + the 9 `p-4 sm:p-5`); KPI/hero card `p-5`; sub-tile `p-3`; grid gap `gap-3`; inline control gap `gap-2`; card header `mb-3`; empty state `card p-10 text-center text-sm text-muted-`.
**Migration (B):** replace `p-5`→`p-4` on the 49 non-KPI cards, `p-6`→`p-4` (20), `gap-4`→`gap-3` on card grids (150, many are flex rows and can stay), and unify empty states through one `emptyCard(msg)` helper (48 sites). Class C for `mb-1` vs `mb-3` header margins — depends on whether a subtitle follows.

---

## 3. Cards and stat tiles

**Card variants.** 419 `.card` uses; 142 add `overflow-hidden` (needed only when a table bleeds to the edge); 26 add a coloured `borderLeft: 3px/4px` (`56-calendar` 4, `60-nrla` 9, `94-commission-view` 4, `66-scorecards` 3, …) — a "status stripe" with no shared semantics (colour chosen ad hoc). Sub-panels inside cards use `rounded-xl p-3` + inline `background: var(--card-2)` (5, `20-reporting-auditing.js:271`) *or* `rounded-lg border p-3` + `var(--card-2)` (6, `40-dashboard:699`) *or* `flex-1 px-3 py-2 rounded-xl` (`70-reporting-core.js:606`, `96-retention.js:671`). `card-2` background is set inline 236 times vs the `.bg-card2-` class 4 times; `.card-2` CSS class itself is unused in src.

**Stat tiles — 19 distinct implementations** (helper name → label / value classes):

| Helper (file:line) | Label | Value |
|---|---|---|
| `kpi` `40-dashboard:318` / `kpiTripleCard` `:1066` / `92-commission-engine.js:317` | `text-[9px] sm:text-[10px] … tracking-widest font-semibold` | `font-display text-2xl sm:text-4xl` |
| `kpiCard` `40-dashboard:1082` | `text-[10px] … tracking-widest font-semibold` | `font-display text-4xl sm:text-5xl` |
| `tile` `40-dashboard:699`, `stat` `64-indicators.js:1878`, `statBox` `:1778` | `text-[9px] … font-semibold` | `text-lg font-black` / `text-lg font-bold` |
| `tile`+`attrTile` `20-reporting-auditing.js:241,271` (duplicated verbatim at `40-dashboard:5051,5065`) | `text-[9px] … tracking-widest` (no weight) | inline |
| `statTile` `82-reporting-overview.js:16`, `kpi` `72-marketing.js:122` | `text-[10px]`/`[9px]` … `font-semibold` | `text-2xl font-bold` |
| Daily Pulse stat buttons `82-reporting-overview.js:462,674` | `text-[9px] … font-semibold` | `text-base font-black` |
| Retention tiles `96-retention.js:671,1971`, `70-reporting-core.js:606` | `text-[9px] … font-semibold` | `text-lg font-black leading-tight` / `text-base font-black` |
| `84-reporting-config-panels.js:628` | `text-[10px] uppercase tracking-wider` | `text-xl font-black` |
| `99-commission-rates:1622` | `text-[9px] … font-semibold` | `text-lg font-bold` |
| `92-commission-engine.js:785` | label *below* value, `text-[10px] … mt-0.5` | `text-2xl font-display` |
| `60-nrla:2748` (comp skin, out of scope) | | |

Eyebrow labels overall (492 uppercase+tracking strings): `text-[10px]` 266 · `text-[9px]` 169 · `text-xs` 25 · `text-[11px]` 24 · `text-sm` 5 · `text-[8px]` 4; `tracking-widest` 327 vs `tracking-wider` 159; weight `font-semibold` 186 · `font-bold` 162 · `font-black` 30.

**Canonical:** label `text-[10px] uppercase tracking-widest font-semibold text-muted-` (92 exact uses, the single most common); hero value `font-display text-2xl sm:text-4xl tabular-nums leading-none` (dashboard `kpi`); compact tile value `text-lg font-bold tabular-nums`. Sub-panel `p-3` + `background: var(--card-2)` + `border` (`var(--border)`), no radius class.
**Migration (B):** add `statTile({label, value, sub, onClick, tone})` and `kpiHero(...)` to `10-core.js`; delete the duplicated `tile/attrTile` pair in `40-dashboard:5051-5065` (verbatim copy of `20-reporting-auditing.js:241-271`); route the ~19 local helpers through them. Card "status stripe": either one `tone` option on the card helper or drop the 26 `borderLeft`s (C).

---

## 4. Tables

133 `el('table')`; class strings: `w-full text-xs` 36 · `w-full text-[12px]` 21 (identical size to `text-xs`) · `w-full text-sm` 18 · `w-full` 13 · `w-full text-[11px]` 10 · `… frozen-table` 15.

**Header cells** (423 `th`): 60+ distinct class strings. Padding: `px-2` 161 vs `px-3` 122 vs `px-4` 21; `py-2` 232 vs `py-1.5` 54 vs `py-2.5` 52 vs `py-1` 21. Weight `font-semibold` 153 vs `font-bold` 46 vs none ≈220 (relying on the `thead` row). Top combos: `text-left px-2 py-2 font-semibold` 33, `text-left px-2 py-2.5 font-bold` 31, `text-left px-2 py-2` 15, `px-3 py-2` 14. `thead`/`tr` header rows (125): `text-[10px] uppercase tracking-wider` 16 · `text-[9px] uppercase tracking-wider text-muted-` 11 · `text-[10px] … text-muted-` 10 · `tracking-widest` variants 5 · `text-battleship bg-eerie3` 2 (legacy, `A`).

**Rows.** `border-t` on `tr` 114 (dominant) vs `border-b` 3 vs `divide-y` 2; hover `hover:brightness-95` on 6 rows, `hover:bg-card2-` 1, most rows no hover. Numeric: 152 `td text-right`, 315 `tabular-nums` on td; 94 right-aligned `th` — many money columns are left-aligned.

**Sticky / scroll.** `frozen-table` 19, `fit-table` 2, `records-table` 1, inline `position: 'sticky'` 85 (17 directly on `th`), `sticky top-0` class 10. Wrappers: `scroll-x` 46 · `overflow-x-auto` 41 · `overflow-auto` class 20 · inline `overflow: 'auto'` 17. (`index.html:843` already styles `.scroll-x, .overflow-x-auto, div[style*="overflow: auto"]` together — three spellings of one thing.)

**Sort arrows — 3 families in 7 tables:** `↑ ↓` (`60-nrla:2572,3163`, `96-retention.js:1852,2168`), `▲ ▼` (`70-reporting-core.js:422`, `80-putis-shid.js:567`), `▾ ▴` (`92-commission-engine.js:505`).

**Empty rows / show more.** 20+ "No … yet." strings with and without trailing period ("No sales" ×4, "No sales yet." ×1, "No data" ×2). Expand affordances: "View all " 4, "Show all" 5, "Show more ·"/"Show more (" 2, "Show top 10/25" 3, "See all of", "Expand", "Collapse".

**Canonical:** table `w-full text-xs`; `thead tr` = `text-[10px] uppercase tracking-wider text-muted-`; `th` = `text-left px-2 py-2 font-semibold` (+ `text-right` for numeric); `td` = `px-2 py-2`, numeric `text-right tabular-nums`; rows `border-t` `var(--border)`; wrapper `scroll-x`; sticky via `frozen-table`; sort glyph `▲/▼` (matches the `▾` used in select-style buttons less, but `▲▼` are the only pair rendered at consistent width in Archivo — pick one and ship a `sortGlyph(dir)` helper); "show more" label `Show all (N)`.
**Migration (B):** `th(label, {num, sort})` / `tbl()` helper in `10-core.js`; replace `text-[12px]`→`text-xs` (59 sites, zero visual change); replace inline `overflow: 'auto'` (17) and `overflow-auto` (20) with `scroll-x`; 6 sort sites → helper. Migrate the 2 `text-battleship bg-eerie3` header rows (A).

---

## 5. Modals and sheets

**Overlay builders — 4 kinds.**
| Kind | Count | Example |
|---|---|---|
| `class: 'modal-overlay'` (z-2000, blur, animation) | 74 | `70-reporting-core.js:710` |
| `fixed inset-0 bg-black/70 z-40 flex items-start justify-center p-4 overflow-y-auto` | 7 | `40-dashboard:1977`, `60-nrla:1885,5131`, `64-indicators.js:394`, `74-riddcoin.js:88,130`, `99-commission:1304` |
| inline `position:'fixed', inset:'0'` | 4 | `64-indicators.js:7382` (+ TV board / mystery-box, out of scope) |
| native `confirm()` 45 · `prompt()` 7 · `alert()` 1 | 53 | `60-nrla` 13, `66-scorecards` 5, `99-commission` 5, `62-manage-teams` 4, `74-riddcoin` 4 |

**A:** the 7 `z-40` overlays sit *below* Leaflet panes (z 400–1000) and below the `.modal-overlay` z-2000 that `index.html:739` was explicitly raised for; they also miss the frosted backdrop, rise-in animation and reduced-motion rule. `64-indicators.js:394` and `99-commission:1304` can open over map views.

**Modal card:** 70 strings, 32 distinct. `card w-full max-w-lg my-8 overflow-hidden flex flex-col` 12 · `max-w-md …` 8 · `max-w-2xl …` 7 · `max-w-sm my-8 overflow-hidden` 5 · `max-w-3xl p-6 my-8 overflow-y-auto` 3 · `max-w-2xl p-6 my-8 overflow-y-auto` 3 · `max-w-5xl p-6 …` 2, plus one-offs `my-4`, `p-5 flex flex-col gap-3/4`, `w-full w-full`. Inline widths instead of `max-w-*`: `min(520px, 94vw)` ×2 (health sheet `10-core.js:3772`, `88-geographic:596`), `min(980px, 94vw)`, `min(720px, 94vw)`, `min(1200px, 94vw)`, `min(440px, 92vw)`, `min(460px, 94vw)`, `min(360px, calc(100vw - 36px))`. Scroll: `maxHeight: calc(100vh - 64px)` 49 (dominant) vs `80vh` 3, `88vh` 3, `70vh` 7, `60/62vh` 6. Two scroll models coexist: whole card scrolls (`p-6 overflow-y-auto`, 12) vs header fixed + body scrolls (`overflow-hidden flex flex-col`, 40).

**Close button:** 87 instances, 33 class strings, 4 glyphs (`×` 76, `×` 7, `✕` 5, `'Close'` text 5). Top: `text-2xl leading-none` 26 · `text-2xl text-muted-` 9 · `text-xl leading-none cursor-pointer px-2` 6 · `text-xl leading-none` 6 · `text-xl leading-none text-muted-` 5. Only 1 has `aria-label`. Escape-to-close is wired on 23 of ~85 overlays; click-outside on 76.

**Canonical:** `modal-overlay` + `card w-full max-w-{sm|md|lg|2xl|3xl|5xl} my-8 overflow-hidden flex flex-col` with `maxHeight: calc(100vh - 64px)`, header row `px-5 py-3 border-b`, scrolling body; close = `×` with `text-2xl leading-none text-muted-` + `aria-label="Close"`; Escape + click-outside always.
**Migration:** `openModal({title, width, body, footer})` in `10-core.js` handling overlay, Esc, click-outside, focus return; port the 7 `z-40` overlays first (A), then the 74 (B). Replace the 45 `confirm()`s with `confirmModal(msg)` (B — native dialogs break the frosted look and the `button:active` motion language; keep `prompt()` only where a free-text reason is required, or build `promptModal`).

---

## 6. Feedback language

352 `toast()` calls: error 127 · success 113 · warn 79 · info 21. The `toast` helper itself (`10-core.js:2456`) still paints with legacy classes `bg-eerie3 border-battleship text-smoke` / `bg-lime text-eerie border-lime-600` and `rounded-xl` — **A** if those tokens are absent from the prebuilt Tailwind, B otherwise (they are not the brand palette either way).

| Convention | Observed |
|---|---|
| Success punctuation | 65 no terminator · 5 `…` · 3 `!` (`'📣 Sent — thank you!'` `30-shell:529`, `'🎁 You won: …!'` `74-riddcoin:241`) · 2 `.` |
| Emoji / check prefix | 5 success (`🎰`, `📣`, `🎉`, `🎁`, `🎲` info) vs 108 plain; `'✓ hit'` inline in tiles |
| "Saved" | `'Saved'` 3 · `'Saved (demo)'` · `'Saved — applies on the next sync'` · `'Saved locally — server sync failed'` ×6 · `'Competition saved'` · `'Exempt services saved'` |
| Error phrasing | `'X failed: ' + e.message` ≈49 · `'Could not …'` 31 · `'Failed to …'` 5 · bare `err.message` fallbacks 77 (raw Supabase/HTTP text shown to reps) |
| Loading copy | `'Loading…'` · `'Loading the snapshot…'` · `'Loading snapshot… '` · `'Loading the CRM snapshot…'` · `'Loading the latest data…'` · `'Loading your commission…'` · `'Refreshing…'` · `'Refreshing your data…'` (12 variants) |
| Spinner | `.spinner` CSS used 2×; no skeletons; most loads are text-only |
| Inline error text | `color: '#DC2626'` on 71 spans/divs, `text-red-*` 4; no shared `errorText()` |

Native `confirm()` copy is also inconsistent: some end with "?" some don't, some include "This cannot be undone." (not tallied).

**Canonical (dominant):** sentence case, no terminal punctuation, em-dash for a clause (`'Saved — applies on the next sync'`), no emoji; errors `'<Verb> failed — <plain reason>'`; success verb-first (`'Sale logged'`, `'Competition saved'`). Loading: `'Loading…'` or `'Loading <noun>…'`, single ellipsis char.
**Migration (B):** fix the 3 `!` and 5 emoji successes; wrap `e.message` through a `friendlyError(e)` mapper (77 sites) so raw PostgREST text never reaches a toast; re-skin `toast()` to `card` tokens + `borderLeft: 3px` accent/`#DC2626` (one place, A/B); add `loadingRow(msg)` and use `.spinner`.

---

## 7. Formatting

**Money.** `fmt.usd0` 379 · `fmt.usd` 53 · `fmt.usdShort` 1 vs **37 local money helpers** (`money`, `money2`, `usd`, `usd2`, `fmtMoney` — `60-nrla` 7, `98-admin` 6, `94-commission-view` 5, `64-indicators` 4, …) and 95 manual `'$' +` concatenations, 252 bare `toLocaleString()` (locale-dependent; `fmt.*` pins `en-US`). Cents: `fmt.usd` (2dp) in pay/commission; `usd2` in `60-nrla:5175` reimplements it with `undefined` locale. `58-hall-of-fame:1539` guards `typeof fmt !== 'undefined'` — `fmt` is a global from `10-core.js`.

**Percentages.** `toFixed(1)+'%'` 113 · `Math.round(x)+'%'` 51 · `toFixed(0)+'%'` 33 · `toFixed(2)+'%'` 16 · `fmt.pct` (2dp) 13; **47 local `pctS`/`pct` definitions** with three different precisions (`20-auditing:234` 1dp, `40-dashboard:293` 0dp, `52-pay:227` param). Same metric (completion rate) shows as `87%` in the tech dashboard and `87.3%` in Reporting.

**Dates.** 108 `toLocaleDateString` calls with 20 option sets; top: `{month:'numeric',day:'numeric'}` 15 · `{month:'short',day:'numeric'}` 14 · `()` bare 10 · `{month:'long',year:'numeric'}` 10 · `{month:'short',year:'numeric'}` 7. 30 local `fmtD/fmtDate/fmtDay/fmtFull/fmtLock/fmtShort` helpers. 107 `toISOString().slice(0,10)` — most are keys, but several render raw `2026-09-06` (e.g. `20-reporting-auditing.js:624` `fmtD` returns ISO for display). `fmt.date` (M/D/YYYY) is defined and used **0** times; `fmt.dateShort` 17, `dateShortYear` 6. So the same day appears as `9/6`, `Sep 6`, `9/6/26`, `2026-09-06`, `Saturday, September 6`.

**Counts / signs / placeholders.** `fmt.int` 230 vs bare `toLocaleString()` 252. Signs: `'+'` prefix 28, unicode minus `−`/`−` 52 (`signed` in `80-putis-shid`) vs hyphen elsewhere (`fmt.usdShort` emits `-$`). Empty placeholder: `'—'` 475 + `'—'` 65 (same glyph, 2 spellings) vs `'–'` en-dash 18 vs `'n/a'` 4 vs `'-'` 2.

**Statuses / semantic colour.** Good: sage `#5F6C5B` 85 + `rgba(95,108,91,…)` 33 **and** green `#16A34A` 17 (`40-dashboard:720-723`, `76-reporting-view`, `82-overview`, `85-exceptions`, `96-retention`). Bad: `#DC2626` 181 + `rgba(220,38,38,…)` 69 + `#B91C1C` 52 + `#EF4444`/`#f87171` 3. Warn: `#A9441F` 118 (brand rust) + `#9C3F1E` 34 + one-offs `#D97706`/`#B45309`/`#CA8A04`. Accent: `var(--accent)` 476 vs literal `#DF643A` 211 + `rgba(223,100,58,…)` 129 — the literal is off-brand in dark mode (`--accent` is `#FF5F2E` there), **A** for the 40+ literal-orange *text* uses on dark card surfaces. Status badges: `.chip-*` CSS (7 classes, via `statusChip`, 9 uses) · `lockStatusChip` (`50-sales-queue:1121`, `px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider`, inline bg/fg) · `badgeChip` · `statusPill` (HoF) · `99-commission:309` event chips (inline rgba) · "Live" rendered 4 ways (`'LIVE'` orange `64-indicators:7746`, `'Live'` sage `99-commission:667`, `#FFB899` bg `60-nrla:4728`). Retention health buckets `76-reporting-view.js:309` colour "Healthy" as **orange `#DF643A`** and "Watch"/"At Risk" both `#A9441F` — two buckets indistinguishable (**A**).

**Canonical:** money `fmt.usd0` (cents only in pay/commission via `fmt.usd`); percent `fmt.pct1` (add; 1dp is 113 vs 84 for 0dp) with `fmt.pct0` for KPI tiles; dates `fmt.dateShort` (M/D) in tables, `fmt.dateMed` = `{month:'short', day:'numeric'}` (add) in prose/tiles, ISO never shown; counts `fmt.int`; signs `fmt.signed(n, kind)` with unicode minus; placeholder `'—'`. Semantic tokens: add `--ok: #5F6C5B`, `--bad: #DC2626`, `--warn: #A9441F` to `:root` and one `statusBadge(kind, label)` helper.
**Migration (B):** delete the 37 money + 47 pct + 30 date local helpers and point at `fmt.*` (≈114 definitions, ~600 call sites, mechanical); replace `'—'`→`'—'` (65) and `'–'`→`'—'` (18); `#16A34A`→`var(--ok)` (17, B) ; literal `#DF643A`→`var(--accent)` (211, A in dark mode); fix the retention bucket palette (A).

---

## 8. Typography

**Card titles.** `h3 text-sm font-bold` 36 (+`mb-*` variants 22) · `h2 text-base font-bold` 27 · `h3 text-base font-bold` 24 · `h2 text-lg font-bold` 20 · `h2 text-xl font-bold` 15 · `div text-sm font-bold` 30 · `div font-display text-lg` 9 · `h2 font-display text-lg` 2 · `h3 text-xs font-bold uppercase tracking-widest text-muted-` 6. Because of `index.html:261`, the 36 `h3.text-sm.font-bold` render as 14px Anton (regular) while the 30 `div.text-sm.font-bold` render as 14px Archivo Bold — the same "card title" in two typefaces (**A**, contradictory). `h1` count 14, `h4` 4.

**Eyebrows** — see §3 (6 sizes, 2 trackings, 3 weights). `.hb-kicker` CSS is defined and used 0 times in src.

**Muted text.** `.text-muted-` 853 · inline `color: 'var(--text-muted)'` 456 · inline `var(--text-subtle)` 273 · `.text-subtle-` 1 · `opacity-*` as muted 5. Two greys with no rule for which is which.

**Body sizes.** `text-[11px]` 938 · `text-xs` 419 · `text-sm` 352 · `text-[12px]` 59 (= `text-xs`) · `text-[13px]` 15; inline `fontSize` 250+ (`'11px'` 45, `'13px'` 42, `'10px'` 41, `'9px'` 25, plus `11.5px`, `10.5px`, `9.5px`, `8px`), mostly in the skins but ~60 in core views.

**Legacy palette classes (pre-brand):** 88 uses — `text-battle-2` 25 (`10-core.js:3520`, `64-indicators` 8, `54-competitions` 6, `99-commission` 5, `40-dashboard` 4), `text-battleship` 8, `text-eerie` 7, `bg-lime` 8, `text-lime` 8, `bg-eerie3` 4, `border-eerie3` 4, `text-smoke` 6, `border-lime*` 3, `border-battleship` 2. These names do not exist in the CSS var set; the prebuilt Tailwind only scans `index.html`, so they render unstyled unless a safelist exists (**A** — verify against `tailwind.config.js`; either way they are the old palette).

**Canonical:** card title = `h3` with `text-sm` → make the rule explicit: section/page titles use `h2/h3` (Anton), card titles use `div.text-sm.font-bold` (Archivo) — pick the `div` form since it is what `kpiCard`, the health sheet and most newer files use, and rename the 36+22 `h3.text-sm` to `div`; eyebrow = `text-[10px] uppercase tracking-widest font-semibold text-muted-`; muted = `.text-muted-` class, subtle = `.text-subtle-` class (inline var only inside `style` objects that already exist); body = `text-xs` for tables, `text-[11px]` for controls, `text-sm` for prose.
**Migration:** `text-[12px]`→`text-xs` (59, zero visual change); `text-battle-2`/`text-battleship`/`text-smoke`→`text-muted-` (39), `text-eerie`→`text-default`, `bg-lime`→`var(--accent)` primary, `bg-eerie3`/`border-eerie3`→`bg-card2-`/`border-` (A, 88 sites); inline `color: var(--text-muted)`→`.text-muted-` where the style object has no other keys (B, ~300 of 456).

---

## Priority order

1. **A** — 7 `z-40` overlays (§5), retention bucket colours + orange literal on dark (§7), `h3` vs `div` card titles (§8), legacy palette in `toast()` and 88 class sites (§6/§8), toolbar-height selector (§1), 2 legacy table header rows (§4).
2. **B, highest leverage** — `uiBtn`, `statTile`, `openModal`/`confirmModal`, `th/tbl`, and `fmt.pct1/dateMed/signed` helpers in `10-core.js`; then delete the ~114 file-local formatters and 315 button class strings behind them.
3. **B, mechanical** — dead radius classes (dropped, not replaced), `text-[12px]`→`text-xs`, `'—'`→`'—'`, `overflow: auto`→`scroll-x`, card padding to `p-4`, empty-state helper, one sort glyph.
4. **C** — header `mb-1` vs `mb-3`, 26 `borderLeft` stripes, `gap-4` on flex rows.
