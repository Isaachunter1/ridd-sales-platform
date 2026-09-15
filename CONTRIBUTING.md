# Contributing to the RIDD Sales Platform

`main` is production — every merge deploys to every rep. So:

1. Branch from `main`: `git checkout -b <yourname>/<feature>`.
2. Build. Run `node tools/ci-check.js` before every push (syntax, Tailwind
   utilities, derive parity). Use classes that exist in `tailwind.css`, otherwise
   inline `style`.
3. Push the branch and open a pull request. Netlify posts a deploy-preview URL
   on the PR — test there.
4. Isaac reviews and merges. Nobody pushes to `main` directly (the branch rule
   blocks it).

Rules of the road:

- **No secrets in the repo.** Supabase service keys, RevHawk credentials and
  anything else sensitive live in Netlify environment variables. The anon key
  and project URL in `index.html` are public by design.
- **No customer data files.** Spreadsheets and CSV exports go in `Claude outputs/`
  (ignored) or outside the repo, never committed.
- **Database changes ship as SQL in the PR** (a `.sql` file at the repo root,
  re-runnable). Isaac runs it in the Supabase SQL editor before merging.
- **Phones are first-class.** Anything wider than a phone scrolls inside its own
  box, first column frozen, no page-level sideways scroll.
- **Netlify and Supabase dashboards are Isaac-only.** Ask if you need a setting
  changed there.
