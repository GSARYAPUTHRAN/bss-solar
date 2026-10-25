-- ============================================================================
-- BSS Solar — PREVIEW of wipe-business-data.sql. Read-only: changes nothing.
-- Run it, and read the report: the verdict, the checks the wipe will apply,
-- how many rows each table would lose, and what stays (every account and
-- every push subscription).
--
-- It does not ask for the confirmation phrase — the wipe itself does, and
-- will not delete anything without it.
-- ============================================================================
with params as (
  select
    -- ▶ KEEP IN STEP with the two lists at the top of wipe-business-data.sql.
    array[
      'notification_dedupe', 'notifications', 'coordinator_incentives',
      'work_order_coordinators', 'payments', 'service_tickets',
      'project_milestones', 'projects', 'work_orders'
    ]::text[] as business_tables,
    array['profiles', 'push_subscriptions']::text[] as kept_tables
),
-- Every table of the public schema, with its row count (any table added later
-- shows up here by itself).
tables as (
  select
    c.relname::text as name,
    (xpath(
      '/row/c/text()',
      query_to_xml(format('select count(*) as c from public.%I', c.relname), false, true, '')
    ))[1]::text::bigint as row_count
  from pg_class c
  where c.relnamespace = 'public'::regnamespace
    and c.relkind in ('r', 'p')
),
accounts as (
  select u.id, coalesce(p.role::text, 'no profile') as role
  from auth.users u
  left join public.profiles p on p.id = u.id
),
-- The wipe's own checks, in its order; `blocking` ones make it abort.
checks as (
  select 1 as ord, true as blocking, 'every table is classified' as item,
    (select 'table(s) ' || string_agg(t.name, ', ' order by t.name)
            || ' are in neither list of the wipe script — add each one deliberately'
     from tables t, params p
     where t.name <> all (p.business_tables) and t.name <> all (p.kept_tables)) as problem
  union all
  select 2, true, 'an admin or the Super Admin account exists',
    case when exists (select 1 from accounts where role in ('admin', 'superadmin'))
         then null
         else 'no admin or Super Admin account exists, so nobody could import afterwards'
    end
),
report as (
  select 0 as ord, 'verdict' as section, 'wipe-business-data.sql' as item,
    case when exists (select 1 from checks where blocking and problem is not null)
         then 'WOULD ABORT — nothing would be deleted'
         else 'READY'
    end as detail
  union all
  select 10 + ord, 'check', item,
    case when problem is null then 'OK'
         when blocking then 'ERROR: ' || problem
         else 'WARNING: ' || problem
    end
  from checks
  union all
  select 20, 'delete rows', t.name, t.row_count::text
  from tables t, params p
  where t.name <> all (p.kept_tables)
  union all
  select 30, 'keep accounts', role, count(*)::text
  from accounts
  group by role
  union all
  select 40, 'keep rows', t.name, t.row_count::text
  from tables t, params p
  where t.name = any (p.kept_tables)
)
select section, item, detail
from report
order by ord, section, item;
