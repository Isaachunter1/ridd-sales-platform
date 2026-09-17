## Brand — RIDD 2.0

**Palette. Do not introduce colors outside this set.**

```
charcoal  #323230
cream     #FBF4DA
sage      #5F6C5B
orange    #DF643A
black     #000000   public site page ground only — see below
white     #FFFFFF   public site ink and light ground only — see below
```

**`black` is a ground, not a fifth brand color.** It exists so the public site
can be a near-black field with one lit subject on it, and it is the ground for
every section, the top bar and the footer under `app/(site)`. It is not ink, it
is not a fill, and it is not available to /deck or /admin — with one exception.

**The exception is `::selection`, which is global.** Selecting text replaces the
background AND the ink, so the surface underneath stops mattering and one rule
serves every route. The pair is orange ground, black ink, at 6.02:1. It has to
be black: charcoal on orange is 3.68:1 and fails the moment anyone drags across
body copy. `::-moz-selection` is declared separately because Firefox drops the
whole rule if the two selectors share a list.

**Which surface gets which ground:**

```
black      page ground — every section on the public site, edge to edge
charcoal   PANELS raised off that ground: the apply modal, the sticky CTA bar,
           video poster plates. Also the entire deck canvas and admin.
cream      ink only on the public site. It grounds nothing there.
sage       not used on the public site at all.
white      the light section's ground, and — Cameron, 2026-09-10 (Q-0209) —
           the timed "Add 1% to your commission" popup, a white box with
           black ink and no border (the backdrop is its edge). The apply
           modal is NOT this: it stays a charcoal panel.
```

**Charcoal was NOT repointed and must not be.** The two are different surfaces
now, not two names for one thing. Repointing charcoal would take the deck and
admin to black with it, and the deck's contrast table below is computed against
charcoal.

**A charcoal panel on black measures 1.63:1** — far too little to perceive on
its own. Every charcoal panel on the public site needs a border or a shadow to
have an edge at all; the apply modal's `border-cream` is load-bearing for that
reason, not decorative. This is the trade the token makes and it is the one
thing to remember about it. (The commission popup escaped the trade by going
white — Q-0209 — and `<ApplyForm>` now takes its ink from whichever surface
holds it, so the same form reads white on charcoal, white on black and black
on white without three copies.)

**AMENDMENT — Cameron, 2026-08-11: `white #FFFFFF` joins the palette, scoped to
the landing page and /about only** — the same route group as `black`, and the
same rule. Two applications and no others:

1. **All light INK on the public site is white**, on every ground it appears on.
2. **The light section's GROUND is white.** Black ink on it is unchanged.

**Cream remains the token for /deck and /admin** and was not repointed, exactly
as charcoal was not when black arrived. A file under `components/deck/` that
says `text-cream` is correct and must stay.

The gain is small and it is not the reason: white on black is 21.00:1 against
cream's 19.05:1, and black on white is 21.00:1 against 19.07:1. The reason is
coherence — once the page ground is pure black, cream ink and a cream light
section read as a third temperature belonging to neither end of the page.

**AMENDMENT — Cameron, 2026-08-11: orange is legal as a full section ground on
the landing page, ONE SECTION MAXIMUM.** Ink on that ground is **black**, at a
measured 6.02:1. This is a signed exception to the rule below and it does not
generalise: a second orange section on the same page breaks it, and orange
elsewhere — other routes, the deck, admin — stays CTA-only exactly as before.
The section is `TheNumbers` in `app/(site)/page.tsx`.

The reason it is safe to ground a section in orange but not to sprinkle it: at
6.02:1 black on orange clears the small-text bar, so a section on that ground
can still carry provenance lines at full ink. A ground that forced the source
notes to be dimmed or dropped would have been the wrong ground, and that test —
**can the caveats live here at full ink?** — is the one to apply before any
future ground is legalised.

**Orange is an accent, not a ground.** It marks and points — a rule, a single
word, a small block. It does not fill a card or a section. Section colorways
draw from charcoal, cream, and sage.

**The palette governs the interface, not photographs.** Anything *drawn* — type,
rules, fills, borders, swatches, chart bars, map dots — comes from the four
colors above. Anything *photographed* does not: the RedTag polos are grey, light
blue, white, navy and red, and reproducing them accurately is the point of
showing them. Rep portraits are the same. The line is whether the color is a
design decision or a fact about the thing in the frame. Do not use this as a
route to smuggle a fifth color into the UI by putting it in an image.

**The exemption follows the subject, not the medium — a drawn rendering of
physical merchandise is product imagery.** The apparel flats in
`public/images/merch/` are vector artwork, not photographs, and they carry red,
royal blue, purple, forest green and Realtree camo. They are still exempt: the
colors are facts about garments that exist, and a hoodie drawn in sage would be
a lie about the product. Drawn *interface* — type, rules, fills, borders,
swatches, chart bars, map dots — stays governed, with no exception. The test is
unchanged and it is about the subject: is this color a design decision, or a
fact about a thing? An illustration invented to decorate a section is a design
decision and gets the four colors.

**Contrast constraints. These ratios were measured, not estimated** — computed
from the palette hex values with the WCAG 2.1 relative-luminance formula.
Measure any new ink/ground pair before using it, and record the result here.

```
ground     ink        ratio     small text (4.5:1)  display (3:1)
cream      charcoal   11.66:1   pass                pass
charcoal   cream      11.66:1   pass                pass
sage       cream       5.04:1   pass                pass
sage       charcoal    2.31:1   FAIL                FAIL
orange     charcoal    3.68:1   FAIL                pass
orange     cream       3.16:1   FAIL                pass
cream      orange      3.16:1   FAIL                pass
charcoal   orange      3.68:1   FAIL                pass
sage       orange      1.59:1   FAIL                FAIL

black      cream      19.05:1   pass                pass
black      orange      6.02:1   pass                pass
black      sage        3.78:1   FAIL                pass
black      charcoal    1.63:1   FAIL                FAIL
orange     black       6.02:1   pass                pass
cream      black      19.07:1   pass                pass

black      white      21.00:1   pass                pass
white      black      21.00:1   pass                pass
charcoal   white      12.85:1   pass                pass
orange     white       3.49:1   FAIL                pass
```

**White tints on black, and black tints on white** — a tint is a different ink
from the colour it came from, so each is listed separately:

```
ground   ink         ratio    small (4.5:1)   role
black    white/70     9.79:1  pass            dimmed labels
black    white/60     7.37:1  pass            list ordinals
black    white/45     4.43:1  FAIL            SpecMark — decorative, aria-hidden
black    white/25     2.04:1  FAIL            hairlines — non-text
white    black/70     8.59:1  pass            section markers on the light ground
white    black/55     4.74:1  pass            list ordinals on the light ground
white    black/20     1.66:1  FAIL            hairlines — non-text
```

The three failures are the same two exempt categories as before and each is
slightly BETTER than its cream predecessor: `white/45` is 4.43:1 where
`cream/45` was 4.11:1, and `white/25` is 2.04:1 where `cream/25` was 1.93:1.
Neither may be used for anything a reader has to read.

**The three grounds the landing page now uses**, and what each takes as ink:

```
ground   ink     ratio     used for
black    white   21.00:1   the hero's type over the photograph, and every
                           section from the culture break down
white    black   21.00:1   the light section, "SIMPLE. NOT EASY."
orange   black    6.02:1   the one saturated section, "BUILT TO BREAK RECORDS."
```

**Alpha tints are different inks from the colors they came from**, and the page
uses four of them. Composited and measured on both grounds:

```
ground     ink         ratio    small (4.5:1)  role
charcoal   cream/70    6.61:1   pass           dimmed labels
charcoal   cream/60    5.28:1   pass           list ordinals
charcoal   cream/45    3.66:1   FAIL           SpecMark — decorative
charcoal   cream/25    2.13:1   FAIL           hairlines — non-text
black      cream/70    9.13:1   pass           dimmed labels
black      cream/60    6.76:1   pass           list ordinals
black      cream/45    4.11:1   FAIL           SpecMark — decorative
black      cream/25    1.93:1   FAIL           hairlines — non-text
```

The two failures are both exempt and both were already failing on charcoal:
`cream/45` is `SpecMark`, which is `aria-hidden` and carries no information, and
`cream/25` is a hairline, which is not text. Neither is a regression and neither
may be used for anything a reader has to read.

**Orange gains a size on black.** At 3.68:1 on charcoal it was display type
only; at 6.02:1 on black it clears the small-text bar, so orange ink is legal at
any size on the public site.

**The reverse also holds, and the Apply CTAs use it: black ink on an orange
plate is 6.02:1, against charcoal's 3.68:1.** The hero CTA and the sticky mobile
bar are both `text-black` for that reason. They are still 20px extrabold, but
the size is now a design decision rather than a floor they have to clear.

**The deck's orange CTA stays charcoal.** `black` is a public-site token and the
deck ground is charcoal; `components/deck/culture-screens.tsx` is display type
at 34px and clears the 3:1 bar on 3.68:1 as it always did. Do not "fix" it to
match the landing page.

**Scrim floors are lower on black.** Cream over a veil on a WHITE pixel — the
worst case any photograph can present — reaches 3:1 at a 45% black veil and
4.5:1 at 57%. The charcoal equivalents were 56% and 70%.

**Scrim a photograph, do not grade it.** The hero briefly shipped with a
gamma curve baked into the file instead of a layer over it. Gamma crushes the
midtones hardest — on a lit studio wall that is the whole picture — so the frame
went muddy rather than dark, and being in a file it could only be adjusted by
re-encoding. A flat scrim dims linearly and is one number. `HERO_SCRIM` in
`app/(site)/page.tsx` is that number, with its measured floor written beside it.

**A photograph on black shows its rectangle where it would not on charcoal.**
A picture fading out over charcoal met a ground already at 50; over black the
same fade left a measurable edge. Every full-bleed image on the public site
needs its edges taken to 0 explicitly.

**The reference implementation for that is gone — deleted 2026-08-26, and the
rule above outlives it.** `app/(site)/product.tsx` held the radial mask, the
two-stop veil and the four-sided edge seat, and it was orphaned once the hero
became video and the photo breaks came out; nothing had imported it for two
commits. Its `.hero-mask` and `.drift` rules went out of `globals.css` with it.
The landing page now has no `<Image>` at all, so there is currently nothing on
the public site this rule governs — it binds the next full-bleed frame, not
anything shipping today. The technique is recoverable in full at `9bc462a`
(`git show 9bc462a:'app/(site)/product.tsx'`), with the measured numbers in its
comments: the mask's outer stop must land INSIDE the frame — at `transparent
97%` the top edge measured 25–32/255 against pure black, and pulling it to
86–88% took it to 0.

That paragraph previously also cited "the measurement harness that checks it."
**No such harness has ever been in this repo** — `scripts/` holds only
`check-server-actions.sh`, `faststart.mjs`, `ingest-images.py` and
`make-favicon.mjs`, and the only script ever deleted from it was
`grade-hero.mjs`, which baked a gamma curve and is a different thing. The edge
measurements above were taken by hand. That is the fourth stale claim this file
has carried as a fact; the standing rule applies — date the verification or do
not claim one.

Note the last three: orange as **ink** is display-type only on every ground it
is legal on, and illegal on sage entirely. "Display" means 18.66px bold or 24px
regular and up — an eyebrow, a date, a caption or a list label in orange fails
regardless of which ground it sits on.

The hard rules that follow from those numbers:

- **Charcoal ink on sage is prohibited.** At 2.31:1 it fails even the display
  threshold. There is no size at which it becomes acceptable.
- **Charcoal on orange is display type only.** 3.68:1 clears the 3:1 large-text
  bar and nothing else — headlines and figures, never body copy, never a
  disclaimer. Cream on orange (3.16:1) carries the same restriction.
- **Sage grounds take cream ink, and have almost no headroom.** 5.04:1 passes
  small text by half a point. Anything that lowers effective contrast — opacity,
  a tint, a hairline weight at small size — pushes it under. Dimming cream on
  sage to 70% measures 3.38:1, which fails.

**Earnings disclaimers render at full ink and are never dimmed.** The legibility
of an earnings caveat is a compliance surface, not a styling decision — these
figures go to 18–25 year olds and the caveat is what qualifies them. Give
disclaimer text its hierarchy through size, tracking, spacing and measure;
never through opacity. See `<PageDisclaimer>` in
`components/page-disclaimer.tsx` — the layouts render it; `<Stat>` does not.

**The wordmark RIDDMADE never carries a period as part of the mark — but the
word may end a sentence and take normal punctuation.** The distinction is
whether the full stop belongs to the mark or to the sentence around it.

```
RIDDMADE.        WRONG — a standalone lockup with a period baked into it,
                 as a top-bar label, a spec-texture string or a page title
HOW TO BE        RIGHT — the word ends a sentence, so the sentence takes
RIDDMADE.        its full stop as it normally would
```

So `RIDDMADE · Disclosure` and the bare `RIDDMADE` in the top bar are correct
with no period, and `HOW TO BE RIDDMADE.` is correct with one. The lowercase
Instagram handle `@riddmade` is a handle, not the wordmark, and is unaffected.

**TYPE LAW v2.1 — Cameron, 2026-08-28. Three roles on the deck; the mono is
untouchable.** Cameron: "helvetica just isnt a good typeface for a headline...
i love the current mono treatments" → headlines got their own face, chosen
off a seven-face specimen: **Anton**.

```
Anton           the HEADLINE   400 (its only weight) — deck-only, loaded in
                               app/deck/layout.tsx; headlines, rank/tier
                               names, REP NAMES on plates and rosters
Archivo         the voice      600 — deck prose, UI text
IBM Plex Mono   the machine    Regular 400 — labels, marginalia, dates, FIGURES
```

The `font-headline` utility resolves `--font-headline`, which is re-declared
inside `.deck-type` — **the re-declaration is load-bearing**: var() inside a
custom property substitutes where the property is DECLARED, so the @theme
copy resolves its Anton reference at `:root` (where Anton is not loaded) and
bakes in the Archivo fallback. Outside /deck, font-headline degrades to
Archivo by that same fallback. `Anton-Regular.woff2` is the complete upstream
build (google/fonts, converted to woff2, no subsetting) and **draws the
ʻokina natively — the roster string passed with zero missing glyphs and no
hand-mapping**, the first face in this repo not to need it. Anton has one
weight: an unlayered rule pins `font-weight: 400` on `.deck-type
.font-headline` so a stray `font-semibold` cannot synthesize a faux bold.
Landing page: unaffected, still the original stack.

The heavy weight is reserved **strictly for the RIDDMADE wordmark lockup**
(Archivo Expanded Black, `wdth` 125 / weight 900) — it is a logo, not a text
style. Money and every number render in the mono: an instrument reading, not a
headline. **The landing page joined the system 2026-08-28 evening** (merge
`72e4160` + the mono-figures commit after it) — the first migration that day
was an Archivo-for-serif swap and Cameron reverted it on sight ("yeahhh
no"); what stuck, hours later, was Anton: he approved it on the deck first,
then ordered it onto the page with mono body and mono figures. The lesson
both attempts wrote: the page did not want the voice face promoted — it
wanted a real headline face. Scoping: a `site-type` class on the (site)
layout re-values --font-headline → Anton; **NEWSREADER IS FULLY RETIRED —
Cameron, 2026-09-01 (queue Q-0058)**: /admin and the login door were the
serif's last surfaces and he ordered them onto the current system, so
`--font-body` resolves the mono at the ROOT now, the Newsreader loads
(~half MB, preloaded on every route) are gone from `app/layout.tsx`, and
the `.woff2` files stay in `public/fonts` with their OFL license only in
case a future surface earns a serif deliberately. **Every login door is
the market door's white room since 2026-09-15 (Q-0275** — Cameron: "i want
them all to have the same feel"): `components/door.tsx` is the one shell —
wordmark top left, the app's name in mono top right, LOGIN eyebrow, mono
labels over hairlines, one black plate — and /login, /deck/login,
/slicks/login and /market/login stand in it with their own forms and
actions unchanged. The plate is Archivo on purpose: that is what the signed
market plate renders in, and Anton under /deck would break the match.
`IBMPlexMono-Regular.woff2` is
IBM's complete build (45KB, OFL, from their own npm package — not a language
subset), and it **passed the roster string in-browser with zero missing
glyphs**, ʻokina and Vietnamese included, no hand-mapping needed.

**The deck object world** (`components/deck/door-world.tsx`): /deck opens on a
CSS-3D door — rotating, KNOCK to open, camera through — then four places, each
an object with a small mono word. Objects carry, words whisper (the CoMinVi
lesson). Compensation = the banded stack; Results = the drawn card (palette,
not Amex's); Competitions and Culture are **photo slots awaiting Cameron's
shoot of the real NRLA trophy and the clubs, on black** — the Locomotive ring
is a photograph, not a 3D model, and the real prizes will out-aura anything
drawn. The door shows once per page load (module flag, no storage); reduced
motion lands directly in the world.

**Type (original stack — retired everywhere except /admin's prose).** All
faces remain self-hosted from `/public/fonts`. No Google Fonts CDN, no Adobe
Fonts. The "numerals are Archivo, always" rule is dead on every surface:
figures are the mono, everywhere.

**Required character coverage.** The bundled `.woff2` files must cover Latin,
Latin Extended-A, Vietnamese, and the spacing modifier letters needed for the
ʻokina:

```
Latin-1 Supplement    U+00C0–00FF   Spanish        Núñez
Latin Extended-A      U+0100–017F   Polish/Turkish Kowalczyk, Şahin, Māhoe (ā)
Latin Extended Add'l  U+1E00–1EFF   Vietnamese     Nguyễn
Spacing Modifier Ltrs U+02BB        Tongan/Samoan  Tuʻuholoaki (ʻokina)
```

Rep names include Spanish, Vietnamese, Tongan/Samoan, and Eastern European
spellings, and the roster turns over every season — coverage that looks
sufficient today will not be next March. A name that renders half in Archivo
and half in Helvetica is worse than no branding at all, and it happens to the
specific people we recruit.

**Do not subset these fonts for performance.** They are the full upstream
variable fonts (~628 KB preloaded), not the ~25 KB `latin` subsets
`next/font/google` ships. That cost is accepted and deliberate. Before swapping
any font file, re-verify against this string:

```
Nguyễn · Núñez · Fifita · Māhoe · Tuʻuholoaki · Kowalczyk · Şahin
```

**Reference: Aimé Leon Dore, Porsche, Kith. Not Supreme.**
The old red-and-black Tiled deck is superseded — do not port its palette.

**Layout system — the "SS26 card."** Lifted from @riddmade's strongest recurring
Instagram template: section label, small-caps disclaimer paragraph, `CONTAINS:`
list, blackletter R, and a `RIDDMADE /?/ STUDIOS · DESIGNED IN UTAH` footer.
Layout and typography stay constant; only the ground color changes per section.
Section colorways come from charcoal, cream, and sage. Build these as shared
design tokens, not page-specific styles — Phase 2's manual inherits them.

"Small caps" in this template means true uppercase at a reduced size with wide
tracking. Neither Archivo nor Newsreader ships an `smcp` table, so never reach
for `font-variant: small-caps` — the browser synthesizes it by scaling capitals
down, and the stroke weight goes wrong against everything around it.

The blackletter R is an SVG in `/public`, not a typeface. Do not load a third
font family to render one glyph.

