-- ═══════════════════════════════════════════════════════════════════════
-- PER-REP COMMISSION OVERRIDES (per Isaac, Sep 17 2026)
-- Settings → Commissions holds the DEFAULT pay rules; a rep can carry
-- overrides for any of those metrics. Stored on the profile so the pay
-- engine merges default + rep in one place (effectivePaySettings). Only
-- the keys that differ from default are stored — everything else inherits
-- live, so a default change still reaches every rep without an override.
-- Run in the Supabase SQL Editor. Safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════
alter table public.profiles add column if not exists pay_overrides jsonb;
comment on column public.profiles.pay_overrides is 'Per-rep commission overrides: { upfront_pct, ots_rate, upsell_rate, pif_modifier, commercial_multiplier, below_min_multiplier, close_min, close_rate, close2_min, close2_rate, upfront_tiers, multi_year_rate_18, multi_year_rate_24, renewal_backend_rate, renewal_flat:{m12,m18,m24,pif} } — absent key = inherits the default';
notify pgrst, 'reload schema';
