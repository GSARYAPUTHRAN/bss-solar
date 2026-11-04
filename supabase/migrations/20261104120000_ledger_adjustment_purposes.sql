-- ============================================================================
-- BSS Solar — Add 'refund' and 'write_off' to payment_purpose (2026-11-04)
-- ----------------------------------------------------------------------------
-- A refund is money handed BACK to the customer; a write-off is a balance the
-- office decides it will not collect. Both are dated ledger entries.
--
-- Kept in its OWN migration on purpose: PostgreSQL refuses to *use* a newly
-- added enum value inside the transaction that added it ("unsafe use of new
-- value of enum type"). Everything that references 'refund' or 'write_off'
-- (the write-off reason check, the list views, import_projects) lives in the
-- following migrations, which run in later transactions.
-- Idempotent; safe to re-run.
-- ============================================================================

alter type public.payment_purpose add value if not exists 'refund';
alter type public.payment_purpose add value if not exists 'write_off';
