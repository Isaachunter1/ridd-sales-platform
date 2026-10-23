-- Re-Audit sale status (per Isaac, Oct 15 2026). Holds a sale on Upfront Sales for a second look;
-- not payable, and the RevHawk auto-approve only touches 'pending', so it never overrides it.
alter type public.audit_status add value if not exists 're_audit';
