-- ============================================================================
-- BSS Solar — Add the 'service_engineer' value to user_role
-- ----------------------------------------------------------------------------
-- Kept in its OWN migration on purpose: PostgreSQL refuses to *use* a newly
-- added enum value inside the transaction that added it ("unsafe use of new
-- value of enum type"). Everything that references 'service_engineer' lives in
-- the following migrations, which run in later transactions.
-- ============================================================================

alter type user_role add value if not exists 'service_engineer';
