-- ============================================================================
-- BSS Solar — Add the 'superadmin' value to user_role
-- ----------------------------------------------------------------------------
-- Kept in its OWN migration on purpose: PostgreSQL refuses to *use* a newly
-- added enum value inside the transaction that added it ("unsafe use of new
-- value of enum type"). Everything that references 'superadmin' therefore lives
-- in the next migration, which runs in a later transaction.
-- ============================================================================

alter type user_role add value if not exists 'superadmin';
