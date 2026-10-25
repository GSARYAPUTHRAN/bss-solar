-- ============================================================================
-- BSS Solar — WIPE: delete ALL business data and KEEP every account.
-- Work orders, projects and milestones, payments, service tickets, who shares
-- each sale, the coordinators' incentives and every notification go; the
-- accounts (sign-ins, names, roles) and each person's push subscriptions
-- stay, so the team does not have to be set up again before the next import.
--
-- Irreversible: take a backup first, and run wipe-business-data-preview.sql
-- to see exactly what goes. Nothing is deleted unless you type the phrase
-- below into `confirm`; the whole script is one transaction, so a failure
-- anywhere leaves everything as it was.
--
-- To also remove accounts, use reset-business-data.sql instead.
-- ============================================================================
do $wipe$
declare
  -- ▶ EDIT ME: to run the wipe, type exactly:  WIPE ALL BUSINESS DATA
  confirm constant text := '';

  -- Emptied completely, children before parents so each count is exact (the
  -- foreign keys would cascade anyway). A table added later must be listed
  -- here, or in kept_tables, deliberately: the script refuses to run otherwise.
  business_tables constant text[] := array[
    'notification_dedupe', 'notifications', 'coordinator_incentives',
    'work_order_coordinators', 'payments', 'service_tickets',
    'project_milestones', 'projects', 'work_orders'
  ];

  -- Never touched: the accounts' profiles and each user's push devices.
  kept_tables constant text[] := array['profiles', 'push_subscriptions'];

  unclassified text[];
  accounts_before bigint;
  profiles_before bigint;
  push_before bigint;
  accounts_after bigint;
  profiles_after bigint;
  push_after bigint;
  tbl text;
  n bigint;
  left_over bigint;
begin
  -- -------------------------------------------------------------------------
  -- 1. Validate. Every check runs before anything is touched, and any failure
  --    aborts the whole block — nothing is deleted.
  -- -------------------------------------------------------------------------
  if confirm is distinct from 'WIPE ALL BUSINESS DATA' then
    raise exception 'Wipe aborted: set confirm to ''WIPE ALL BUSINESS DATA'' at the top of the script — nothing was deleted.';
  end if;

  select coalesce(array_agg(c.relname::text order by c.relname), '{}')
    into unclassified
  from pg_class c
  where c.relnamespace = 'public'::regnamespace
    and c.relkind in ('r', 'p')
    and c.relname::text <> all (business_tables)
    and c.relname::text <> all (kept_tables);

  if cardinality(unclassified) > 0 then
    raise exception 'Wipe aborted: table(s) % are in neither business_tables nor kept_tables.',
      array_to_string(unclassified, ', ')
      using hint = 'Add each one to the right list at the top of this script (and to wipe-business-data-preview.sql) — nothing was deleted.';
  end if;

  if not exists (
    select 1 from public.profiles p where p.role::text in ('admin', 'superadmin')
  ) then
    raise exception 'Wipe aborted: no admin or Super Admin account exists, so nobody could import anything afterwards.'
      using hint = 'Appoint one with production-bootstrap.sql first — nothing was deleted.';
  end if;

  select count(*) into accounts_before from auth.users;
  select count(*) into profiles_before from public.profiles;
  select count(*) into push_before from public.push_subscriptions;

  -- -------------------------------------------------------------------------
  -- 2. Hold off the app's writes for the few seconds this takes (reads carry
  --    on), so nothing is created half-way through and the counts below mean
  --    what they say. Gives up rather than queueing behind a long transaction.
  -- -------------------------------------------------------------------------
  perform set_config('lock_timeout', '10s', true);
  foreach tbl in array business_tables || kept_tables loop
    if to_regclass(format('public.%I', tbl)) is not null then
      execute format('lock table public.%I in exclusive mode', tbl);
    end if;
  end loop;

  -- -------------------------------------------------------------------------
  -- 3. Delete.
  -- -------------------------------------------------------------------------
  foreach tbl in array business_tables loop
    if to_regclass(format('public.%I', tbl)) is null then
      raise notice '%: not present — skipped', tbl;
    else
      execute format('delete from public.%I', tbl);
      get diagnostics n = row_count;
      raise notice '%: % deleted', tbl, n;
    end if;
  end loop;

  -- Run the deferred checks (a sale keeps a coordinator) here, inside the
  -- block, so a problem aborts with everything rolled back, not at COMMIT.
  set constraints all immediate;

  -- The next service ticket is BSS-YYMM-0001 again.
  alter sequence public.service_ticket_no_seq restart;
  raise notice 'service_ticket_no_seq: restarted';

  -- -------------------------------------------------------------------------
  -- 4. Fail closed: every business table is empty and no account was touched.
  -- -------------------------------------------------------------------------
  foreach tbl in array business_tables loop
    if to_regclass(format('public.%I', tbl)) is not null then
      execute format('select count(*) from public.%I', tbl) into left_over;
      if left_over > 0 then
        raise exception 'Wipe failed: public.% still has % row(s). Everything was rolled back.', tbl, left_over;
      end if;
    end if;
  end loop;

  select count(*) into accounts_after from auth.users;
  select count(*) into profiles_after from public.profiles;
  select count(*) into push_after from public.push_subscriptions;

  if accounts_after <> accounts_before
     or profiles_after <> profiles_before
     or push_after <> push_before then
    raise exception 'Wipe failed: accounts changed (auth.users % -> %, profiles % -> %, push_subscriptions % -> %). Everything was rolled back.',
      accounts_before, accounts_after, profiles_before, profiles_after, push_before, push_after;
  end if;

  raise notice 'Wipe complete: % account(s) and % push subscription(s) kept.', accounts_after, push_after;
end
$wipe$;

-- What remains: every table of the schema with its row count (the business
-- tables should all read 0; profiles and push_subscriptions are as they were)
-- and the accounts by role. Built from the catalogue, so a table that is not
-- there simply is not listed.
select 'table' as kind, c.relname::text as name,
  (xpath(
    '/row/c/text()',
    query_to_xml(format('select count(*) as c from public.%I', c.relname), false, true, '')
  ))[1]::text as detail
from pg_class c
where c.relnamespace = 'public'::regnamespace
  and c.relkind in ('r', 'p')
union all
select 'account', coalesce(p.role::text, 'no profile'), count(*)::text
from auth.users u
left join public.profiles p on p.id = u.id
group by p.role
order by kind, name;
