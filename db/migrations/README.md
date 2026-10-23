# Database migrations

Every change to the Supabase database lives here as a re-runnable `.sql` file,
named `YYYYMMDD_<what>.sql` so the folder reads as a history. `schema.sql`
(20260429) is the base; everything after it is additive and safe to re-run
(`if not exists`, `create or replace`, `drop policy if exists … create policy`).

## Applying

Supabase → SQL Editor → paste the file → Run. Then record it:

```sql
insert into public.schema_migrations (name) values ('20260916_sales_autolog_eligibility.sql')
on conflict do nothing;
```

`20260916_schema_migrations.sql` creates that table; `select * from
public.schema_migrations order by name` shows what has been applied, so a new
environment (staging, a second project) can be brought up by running whatever
is missing, in name order.

## Writing one

- One concern per file. Name it for what it does, not when.
- Re-runnable: guard every statement so a second run is a no-op.
- Never the service-role key, never data files, never customer rows.
- Put it in the PR that needs it; Isaac applies it before merging.

`one-off/` holds scripts that were run once by hand (seeding, backfills) and
are kept for the record — they are not part of bringing up a database.
