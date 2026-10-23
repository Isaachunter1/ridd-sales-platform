-- ══════════════════════════════════════════════════════════════════════
-- SECURITY HARDENING — run in the Supabase SQL editor, section by section.
-- Apple mindset: the DATABASE enforces who sees what; the UI hiding
-- something is never the security boundary. Anyone's session token can
-- query Supabase directly from a browser console — these policies are
-- what actually stands in the way.
-- ══════════════════════════════════════════════════════════════════════

-- Helper: the caller's role, usable inside policies.
create or replace function public.caller_role() returns text
language sql stable security definer set search_path = public as
$$ select role from public.profiles where id = auth.uid() $$;

-- ── 1. SALES: reps read their OWN rows only ─────────────────────────────
-- The app no longer needs company-wide `sales` reads on rep accounts: the
-- War Room / leaderboards read the CRM shared dataset, and reps' Sales/Pay
-- tabs read their own rows. Without this, ANY rep can pull every customer
-- name/number in the company from the console.
-- (Review your existing policies first: Auth → Policies → sales. This adds
-- a RESTRICTIVE policy, which combines with existing ones via AND.)
create policy "sales read: own rows or admin/auditor"
  on public.sales as restrictive for select to authenticated
  using (
    rep_id = auth.uid()
    or public.caller_role() in ('admin', 'admin_rep', 'auditor')
  );

-- Writes: reps may only insert/update their own sales; audit-status and
-- payroll fields should only move under admin/auditor sessions.
create policy "sales write: own rows or admin/auditor"
  on public.sales as restrictive for update to authenticated
  using (rep_id = auth.uid() or public.caller_role() in ('admin', 'admin_rep', 'auditor'));
create policy "sales insert: own rows or admin/auditor"
  on public.sales as restrictive for insert to authenticated
  with check (rep_id = auth.uid() or public.caller_role() in ('admin', 'admin_rep', 'auditor'));

-- ── 2. SHARED DATASET BLOBS: full copy is admin/auditor-only ────────────
-- The sync now publishes TWO blobs: indicators/latest.json.gz (full) and
-- indicators/latest-rep.json.gz (customer name/id stripped). Reps' apps
-- download the sanitized one; this policy makes the full one 403 for them
-- even if someone hand-crafts the request.
create policy "full indicators blob: admin/auditor only"
  on storage.objects as restrictive for select to authenticated
  using (
    not (bucket_id = 'reporting' and name = 'indicators/latest.json.gz')
    or public.caller_role() in ('admin', 'admin_rep', 'auditor')
  );

-- ── 3. BLOB WRITES: server only (from storage_single_writer.sql — run it
--      too if you haven't). Stops any browser overwriting the dataset. ──

-- ── 4. VERIFY after running ─────────────────────────────────────────────
-- As an ADMIN:  app loads normally, Retention/Indicators/War Room all work.
-- As a REP (View as → or a test account):
--   · dashboard, leaderboards, comps still populate (rep blob)
--   · their own Sales/Pay tabs work
--   · in the browser console:
--       (await supabase.from('sales').select('*').limit(5)).data
--     returns ONLY their own rows.
--   · downloading indicators/latest.json.gz returns 403; latest-rep works.
-- If anything breaks, drop the restrictive policy by name, e.g.:
--   drop policy "sales read: own rows or admin/auditor" on public.sales;
