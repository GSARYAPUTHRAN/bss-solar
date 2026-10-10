-- ============================================================================
-- BSS Solar — PREVIEW of reset-business-data.sql. Read-only: changes nothing.
-- Use the SAME keep-list as the reset, run it, and read the report: the
-- verdict, the checks the reset will apply, the accounts kept and deleted, and
-- how many rows each table would lose.
-- ============================================================================
with params as (
  select
    -- ▶ EDIT ME: the same emails as keep_emails in reset-business-data.sql.
    array[
      'admin@bsssolar.in',
      'gsputhran@yahoo.com'
    ]::text[] as keep_emails
),
wanted as (
  select distinct lower(btrim(x)) as email
  from params, unnest(params.keep_emails) as x
  where lower(btrim(x)) <> ''
),
accounts as (
  select
    u.id,
    u.email,
    coalesce(p.role::text, 'no profile') as role,
    exists (select 1 from wanted w where w.email = lower(u.email)) as kept
  from auth.users u
  left join public.profiles p on p.id = u.id
),
-- The reset's own checks, in its order; `blocking` ones make it abort.
checks as (
  select 1 as ord, true as blocking, 'keep-list is not empty' as item,
    case when exists (select 1 from wanted) then null
         else 'the keep-list is empty, so every account would be deleted'
    end as problem
  union all
  select 2, true, 'every kept email is an account',
    (select 'no account has the email(s) ' || string_agg(w.email, ', ' order by w.email)
     from wanted w
     where not exists (select 1 from auth.users u where lower(u.email) = w.email))
  union all
  select 3, true, 'an admin or the Super Admin is kept',
    case when exists (select 1 from accounts where kept and role in ('admin', 'superadmin'))
         then null
         else 'none of the kept accounts is an admin or the Super Admin'
    end
  union all
  select 4, false, 'the Super Admin is kept',
    case when exists (select 1 from accounts where kept and role = 'superadmin')
         then null
         else 'no Super Admin would remain: deleting records stays unavailable until production-bootstrap.sql appoints one'
    end
),
report as (
  select 0 as ord, 'verdict' as section, 'reset-business-data.sql' as item,
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
  select 20, 'keep account', coalesce(email, '(no email)'), role
  from accounts where kept
  union all
  select 30, 'delete accounts', role, count(*)::text
  from accounts where not kept
  group by role
  union all
  select 40, 'delete rows', t.name, t.row_count::text
  from (values
    ('notification_dedupe', (select count(*) from public.notification_dedupe)),
    ('notifications', (select count(*) from public.notifications)),
    ('payments', (select count(*) from public.payments)),
    ('service_tickets', (select count(*) from public.service_tickets)),
    ('project_milestones', (select count(*) from public.project_milestones)),
    ('projects', (select count(*) from public.projects)),
    ('work_orders', (select count(*) from public.work_orders)),
    ('push_subscriptions (accounts not kept)',
      (select count(*) from public.push_subscriptions s
       where s.user_id not in (select id from accounts where kept)))
  ) as t(name, row_count)
)
select section, item, detail
from report
order by ord, section, item;
