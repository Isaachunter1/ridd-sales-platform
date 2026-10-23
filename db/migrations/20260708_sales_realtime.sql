-- ────────────────────────────────────────────────────────────────────────
-- SALES REALTIME — lets a rep's open tab hear audit/status changes on
-- THEIR OWN sales the moment an admin makes them (RLS scopes the feed, so
-- each rep only receives rows they can already read). Powers the in-app
-- "✅ Jones — audit: serviced" / "💰 staged for payroll" toasts.
--
-- Run once in the Supabase SQL editor. Re-runnable.
-- ────────────────────────────────────────────────────────────────────────

do $$
begin
  alter publication supabase_realtime add table public.sales;
exception
  when duplicate_object then null;
end $$;
