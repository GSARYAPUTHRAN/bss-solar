-- ============================================================================
-- BSS Solar — API role grants
-- ----------------------------------------------------------------------------
-- PostgREST connects as anon / authenticated / service_role. These roles need
-- table/sequence/function privileges IN ADDITION to Row Level Security (which
-- remains the real access gate for anon/authenticated; service_role bypasses
-- RLS). Without these grants a migration-provisioned database returns
-- "permission denied for table ..." for every query — i.e. a non-functional app.
--
-- This mirrors Supabase's standard default grants and is idempotent, so it is a
-- no-op on databases that were provisioned via the SQL Editor (which already
-- had them). Default privileges cover future tables/sequences/functions.
-- ============================================================================

begin;

grant usage on schema public to anon, authenticated, service_role;

grant select, insert, update, delete on all tables in schema public
  to anon, authenticated, service_role;
grant usage, select on all sequences in schema public
  to anon, authenticated, service_role;
grant execute on all functions in schema public
  to anon, authenticated, service_role;

alter default privileges in schema public
  grant select, insert, update, delete on tables
  to anon, authenticated, service_role;
alter default privileges in schema public
  grant usage, select on sequences
  to anon, authenticated, service_role;
alter default privileges in schema public
  grant execute on functions
  to anon, authenticated, service_role;

commit;
