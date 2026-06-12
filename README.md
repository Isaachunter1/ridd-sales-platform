# RIDD Sales Platform

A single-file web app for RIDD Pest Control sales reps to log sales, watch their pay breakdown, and compete on live leaderboards and bingo-style competitions. Built to replace the "Isaac H. Pay Tab" Google Sheet workflow.

## Stack

- **Frontend:** `index.html` (single-file app — shell, palette, and all logic inlined) — vanilla ES modules, no build step, no installs
- **Styling:** Tailwind via CDN with a custom RIDD palette
- **Backend:** Supabase (Auth, Postgres, Row Level Security)
- **Hosting:** Netlify (static site)

## Palette

| Name | Hex | Use |
|---|---|---|
| White | `#FFFFFF` | Light app background |
| White Smoke | `#F3F3F3` | Text on dark |
| Eerie Black | `#1D1D1D` | Dark app background / text on light |
| Yellow Green | `#8DC63F` | Accent / CTAs / chart highlights |
| Battleship Gray | `#757667` | Secondary text / borders |

## Setup

### 1. Supabase

1. Open your Supabase project: `https://supabase.com/dashboard/project/iqlrndyuiolbxhhwmsqv`
2. Go to **Settings → API Keys → Publishable and secret API keys** → **Create new API keys**
3. Copy the **publishable key** (starts with `sb_publishable_`)
4. Open `index.html` and paste it into `RIDD_CONFIG.SUPABASE_PUBLISHABLE_KEY`

### 2. Run the schema

1. In Supabase, go to **SQL Editor → New query**
2. Paste the entire contents of `schema.sql`
3. Click **Run** — this creates all tables, enums, RLS policies, and seed data

### 3. Create your first admin

1. Open `index.html` in a browser (double-click or `python3 -m http.server`)
2. Click **Sign up**, create an account, confirm via email
3. Back in Supabase SQL Editor, run:
   ```sql
   select public.promote_to_admin('your-email@domain.com');
   ```
4. Sign out and back in — you'll see the **Admin** tab.

### 4. Run locally

No build step. Two options:

```bash
# Option 1: Python's built-in server
cd /Users/ice/Documents/ridd-sales-platform
python3 -m http.server 5173
# open http://localhost:5173
```

Or just double-click `index.html` — auth will work because Supabase allows `file://` origins by default, but if you hit CORS issues use the Python server.

## Features

### Tabs
- **Dashboard** — KPIs, active competitions, recent sales, monthly leaderboard
- **Sales** — log new sales, view pending audit queue
- **Pay** — RIDD-style pay stub (Pending / Below Min / Approved / Backend) plus a By Source grid mirroring the IS PAY sheet. Sources are fully dynamic: add or deactivate lead providers in Settings → Sources and pay updates automatically — standard sources pay % by contract type, renewal-tagged sources pay flat $/account ($25/30/35/35). Renewal amounts, backend rates (18mo 2% / 24mo 3% / renewal 2%) and close-rate bonus tiers (≥60%→3%, ≥50%→2%) are configurable in Settings → Pricing
- **Competitions** — live bingo cards and royalty-style rules with per-rep progress
- **History** — full searchable sales history with CSV export
- **Admin** (admins only) — audit queue, competition editor, reps list

### Bingo rule engine

Every competition rule (or bingo square) is a predicate against the rep's sales data:

| Field | Example |
|---|---|
| `label` | "5 Accounts Sold In A Day" |
| `metric` | `count`, `sum_revenue`, `sum_initial`, `sum_monthly`, `avg_initial`, `close_rate` |
| `window` | `day`, `week`, `month`, `competition` |
| `operator` | `>`, `>=`, `<`, `<=`, `=`, `!=` |
| `threshold` | `5` |
| `filters` | `{ "source_id": [8], "service_type_id": [1] }` |

When a sale is audited, the engine recomputes every rep's progress on every rule for every active competition and writes it to `competition_progress`. The frontend reads that table and colors in the bingo squares in real time.

### Leaderboard-only transparency

Reps see their own sales/pay/history + a monthly leaderboard view that aggregates approved sales count and revenue per rep. They cannot drill into another rep's individual sales.

## Deploy to Netlify

```bash
# Once you have a GitHub repo set up:
git add .
git commit -m "Initial RIDD Sales Platform"
git remote add origin git@github.com:<you>/ridd-sales-platform.git
git push -u origin main
```

Then in Netlify:
1. **Add new site → Import from Git** → pick `ridd-sales-platform`
2. Build settings: leave blank (no build), publish directory = `.` (root)
3. Deploy

The `netlify.toml` in this repo already handles headers and caching.

⚠️ Before deploying: you're putting the publishable key in committed code. That's fine because publishable keys are designed to be public (they only work when combined with RLS policies — which are set up in `schema.sql`). Just **never** commit a secret key (`sb_secret_*` or the service_role JWT).

## Files

```
ridd-sales-platform/
├── index.html          # App shell, palette, config, and all application logic
├── schema.sql          # Supabase migration (tables + RLS + seed + helpers)
├── netlify.toml        # Netlify deploy config
├── .gitignore
└── README.md
```
