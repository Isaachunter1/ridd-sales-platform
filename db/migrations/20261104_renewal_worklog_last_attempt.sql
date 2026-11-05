-- 20261104_renewal_worklog_last_attempt.sql
--
-- Renewals board (per Isaac, Nov 4 2026): Contacting is gone — everyone being worked stays in Eligible, where a
-- call attempt drops the customer to the bottom of the list for 2 days and a Needs-follow-up time brings them back
-- to the top when it comes due. That needs the time of the last ATTEMPT on its own: updated_at also moves when a
-- rep edits notes, so it can't be the cool-down clock.
--
-- The app writes last_attempt_at on every disposition and, until this has run, retries the save without it (the
-- board then reads updated_at as the last try). Safe to run any time.

alter table public.renewal_worklog add column if not exists last_attempt_at timestamptz;

-- Backfill: rows already carrying attempts — their last save is the best available stamp.
update public.renewal_worklog set last_attempt_at = updated_at where last_attempt_at is null and coalesce(attempts, 0) > 0;
