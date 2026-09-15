# Building a module inside the RIDD Sales Platform (e.g. riddmarket)

The sales app is one shell (`index.html` + `app.js`) with a plug-in point so another
product can live inside it — same login, same nav, same look — without touching
`app.js`. This is how riddmarket is built.

## What you get

- **One login.** Reps are already signed in; your module receives their `profile`
  (`id`, `role`, `full_name`, `email`, office/team fields).
- **The shared Supabase client** (`ctx.supabase`) — already authenticated as the
  signed-in user. Row Level Security is the security boundary; the client has the
  anon/publishable key only.
- **The shell:** nav entry, page header, theme, `el()` builder, `toast()`,
  `fmt`, and the drill-down table (`ctx.openReportingDrillModal`).

## Rules (non-negotiable)

1. **Never the service-role key.** Not in your code, not in your own Netlify env.
   If you need privileged work, write a function in `netlify/functions/` in THIS
   repo (it runs with the sales app's runtime secrets) and gate it with
   `requireRole` from `netlify/lib/auth-gate.js`.
2. **Your tables live in schema `market`**, with RLS enabled from the first
   migration. `market_schema.sql` creates the schema, grants, a template table with
   policies, and `market.my_role()` / `market.is_admin()` helpers. Nothing new in
   `public`. Read reps through `public.profiles_roster`, never `public.profiles`.
3. **Your code lives in `modules/market.js`.** You do not edit `app.js`,
   `index.html` (other than the one script tag already there) or `tailwind.css`.
   Need a shell change? Open a PR that touches only that.
4. **Your state lives under `ctx.store.market`** (`state.modules.market`). Don't
   write to other keys on `state`.
5. **CI must pass:** `node tools/ci-check.js` before every push. It checks
   function syntax, inline scripts, Tailwind utilities (use classes that exist in
   `tailwind.css`, otherwise inline `style`), and the derive parity tests.
6. **Phones are first-class.** Anything wider than a phone scrolls inside its own
   box (`overflow: auto`), first column frozen, no page-level sideways scroll.
7. **Branch + PR.** Push to a branch, open a PR; `main` deploys to every rep.

## Registering

```js
window.registerRiddModule({
  id: 'market',                 // view key and URL hash (#market); [a-z0-9_]
  label: 'Market',              // nav text
  title: 'RIDD Market',         // page header
  icon: () => svgNode,          // Node or () => Node
  canView: (ctx) => !!ctx.profile,          // who gets the nav entry
  onEnter: (ctx) => { /* first load */ },   // optional
  render: (ctx) => el('div', {}, 'hello'),  // returns a Node; re-runs on every mountApp()
});
```

`ctx` = `{ profile, role, isAdmin, userCan, el, state, supabase, mountApp, toast, fmt, openReportingDrillModal, store }`.

`render` is synchronous and is called on every re-render — load data in `onEnter`
(or on demand), stash it in `ctx.store.market`, and call `ctx.mountApp()` when it
lands. See `modules/market.js` for a working skeleton that reads `market.listings`.

## Database

```sql
-- run once: market_schema.sql  (Supabase → SQL editor)
-- then: Project Settings → API → Exposed schemas → add `market`
```

From the client: `ctx.supabase.schema('market').from('listings').select('*')`.

Policies follow one pattern: everyone signed in can read, you can write your own
rows (`created_by = auth.uid()`), admins can do anything (`market.is_admin()`).
Copy the `market.listings` template for each new table.

## Access you need

- GitHub: collaborator on the repo (PR-only to `main`).
- Supabase: project member, **Developer** role (SQL editor + logs; no billing, no
  secrets). The project URL and anon key are in the deployed app's
  `window.RIDD_CONFIG` — they're public by design.
- Netlify: nothing. Deploys run from `main`.
