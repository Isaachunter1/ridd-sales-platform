# RIDD Pricing — D2D slick + quote builder (drop-in)

The D2D pricing slick from the RIDD sales app, packaged to plug into any page.
Plain JavaScript, no framework, no build step, no backend. Three files:

| file | what |
|---|---|
| `ridd-pricing.js` | the whole thing — prices, math, slick, quote/receipt. Exposes `window.RiddPricing`. |
| `ridd-pricing.css` | ~50 lines: the few utility classes it uses, the desktop two-column layout, phone tweaks. |
| `demo.html` | open it in a browser — that's the finished component. |

## Plug it in

```html
<link rel="stylesheet" href="ridd-pricing.css">
<link href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700;900&display=swap" rel="stylesheet">

<div id="pricing"></div>

<script src="ridd-pricing.js"></script>
<script>
  RiddPricing.mount(document.getElementById('pricing'), {
    persist: true,        // remember the quote in localStorage (false = fresh each visit)
    headerOffsetPx: 64,   // height of YOUR fixed header so the pinned quote sits under it
  });
</script>
```

React / Vue / Svelte: call `RiddPricing.mount(ref.current, opts)` once in an effect / onMount.
Everything renders inside the container you pass; nothing touches the rest of the page.

## What the rep gets

- The D2D slick exactly as printed: Home Essentials (Pest / Rodent), Yard Essentials
  (Tick-Flea-Mosquito / Mole), Termite Defense, Add-Ons, Bundle & Save, Google reviews.
- Circled **M** next to the D2D bubble flips every number to D2D **minimums**; tap again for display.
- Tap a plan's frequency tile to pick the base (tap again to clear). Add-ons are greyed until a
  Home/Yard base exists — add-ons can't be sold alone. Termite Defense is a separate subscription
  and stacks on top of any plan (or stands alone).
- The quote is a receipt: each line with initial + monthly, totals for **Initial** and **Monthly**.
  Tap **Monthly** to reveal/hide **First Year** (initial + 11 payments).
- Pencil on each receipt line = custom price. Hard floor = the D2D minimum for that line;
  anything under it is refused and the floor is shown. **Reset** clears everything.
- Phone: quote pinned on top, slick below. Desktop (≥1024px): slick left, quote sticky on the right.

## Changing prices

Top of `ridd-pricing.js`:

```js
const PRICING_TIERS = [
  { id: 'd2d',     init: 399, home: [79, 99, 149], yard: [99, 119, 169], termite: [999, 49], addons: [['tfm', 100, 50], ...] },
  { id: 'd2d_min', init: 99,  home: [49, 69, 119], yard: [69, 89, 139], termite: [399, 29], addons: [['tfm', 0, 40],   ...] },
];
```

`home` / `yard` = monthly for [Quarterly, Bi-Monthly, Monthly]. `addons` = [service, initial, monthly].
`termite` = [initial, monthly]. The `d2d_min` row is also the floor for custom prices.

Keep the **order-independence rule** when you change numbers: for any service sold both as a
base and as an add-on (Pest, Rodent, TFM, Mole), `base monthly − add-on monthly` must be the same
across all four, so a customer lands on the same total whichever plan is sold first.

## API (if you need it)

```js
RiddPricing.TIERS      // the price table above
RiddPricing.quote(st)  // { lines, init, mo, acv, ok } for a selection state
RiddPricing.floor(st, 'base' | 'termite' | 'addon:tfm')   // { init, mo } floor for a line
```
