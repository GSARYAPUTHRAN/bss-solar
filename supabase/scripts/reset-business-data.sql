-- ============================================================================
-- BSS Solar — RESET: delete ALL business data and every account NOT listed in
-- keep_emails below. Irreversible: take a backup first, and run
-- reset-business-data-preview.sql (with the same list) to see what goes.
-- Afterwards, recreate the team's accounts BEFORE the bulk upload: the
-- importer matches each row's coordinator_email to an existing account.
-- ============================================================================
do $reset$
declare
  -- ▶ EDIT ME: the exact login email of every account to KEEP, one per line.
  --   Every other account is deleted.
  keep_emails constant text[] := array[
    'admin@bsssolar.in',
    'gsputhran@yahoo.com'
  ]::text[];

  -- Wiped completely, children before parents so each count is exact (the
  -- foreign keys would cascade anyway).
  business_tables constant text[] := array[
    'notification_dedupe', 'notifications', 'payments', 'service_tickets',
    'project_milestones', 'projects', 'work_orders'
  ];

  wanted text[];
  missing text[];
  keep_ids uuid[];
  tbl text;
  still_has_rows boolean;
  n bigint;
begin
  -- -------------------------------------------------------------------------
  -- 1. Validate. Every check runs before anything is touched, and any failure
  --    aborts the whole block — nothing is deleted.
  -- -------------------------------------------------------------------------
  select coalesce(array_agg(distinct e order by e), '{}')
    into wanted
  from (select lower(btrim(x)) as e from unnest(keep_emails) as x) s
  where e <> '';

  if cardinality(wanted) = 0 then
    raise exception 'Reset aborted: the keep-list is empty, so every account would be deleted.'
      using hint = 'List the accounts to keep in keep_emails at the top of the script.';
  end if;

  -- A typo would otherwise silently delete the very account it meant to keep.
  select coalesce(array_agg(w order by w), '{}')
    into missing
  from unnest(wanted) as w
  where not exists (select 1 from auth.users u where lower(u.email) = w);

  if cardinality(missing) > 0 then
    raise exception 'Reset aborted: no account has the email(s) %.', array_to_string(missing, ', ')
      using hint = 'Fix the keep-list (typo?) — nothing was deleted.';
  end if;

  select array_agg(u.id)
    into keep_ids
  from auth.users u
  where lower(u.email) = any (wanted);

  if not exists (
    select 1 from public.profiles p
    where p.id = any (keep_ids) and p.role::text in ('admin', 'superadmin')
  ) then
    raise exception 'Reset aborted: none of the kept accounts is an admin or the Super Admin, so nobody could run the office afterwards.'
      using hint = 'Keep at least one admin account.';
  end if;

  if not exists (
    select 1 from public.profiles p
    where p.id = any (keep_ids) and p.role::text = 'superadmin'
  ) then
    raise warning 'No Super Admin is kept: deleting records stays unavailable until production-bootstrap.sql appoints one.';
  end if;

  -- -------------------------------------------------------------------------
  -- 2. Hold off the app's writes for the few seconds this takes (reads carry
  --    on), so nothing is created half-way through. Gives up rather than
  --    queueing behind a long transaction.
  -- -------------------------------------------------------------------------
  perform set_config('lock_timeout', '10s', true);
  lock table public.work_orders, public.projects, public.project_milestones,
    public.service_tickets, public.payments, public.notifications,
    public.notification_dedupe, public.push_subscriptions, public.profiles
    in exclusive mode;

  -- -------------------------------------------------------------------------
  -- 3. Delete.
  -- -------------------------------------------------------------------------
  foreach tbl in array business_tables loop
    execute format('delete from public.%I', tbl);
    get diagnostics n = row_count;
    raise notice '%: % deleted', tbl, n;
  end loop;

  -- A push subscription is a kept user's device setting, not business data:
  -- removing it would silently stop their push alerts. Only the departing
  -- accounts' devices go (their profiles would cascade them anyway).
  delete from public.push_subscriptions where user_id <> all (keep_ids);
  get diagnostics n = row_count;
  raise notice 'push_subscriptions (removed accounts): % deleted', n;

  -- Profiles, sessions, identities and MFA factors cascade from auth.users.
  delete from auth.users where id <> all (keep_ids);
  get diagnostics n = row_count;
  raise notice 'auth.users (accounts not kept): % deleted', n;

  -- The next service ticket is BSS-YYMM-0001 again.
  alter sequence public.service_ticket_no_seq restart;
  raise notice 'service_ticket_no_seq: restarted';

  -- -------------------------------------------------------------------------
  -- 4. Fail closed: a table added after this script was written must be
  --    handled here deliberately, never survive (or vanish) by accident.
  -- -------------------------------------------------------------------------
  for tbl in
    select c.relname
    from pg_class c
    where c.relnamespace = 'public'::regnamespace
      and c.relkind in ('r', 'p')
      and c.relname not in ('profiles', 'push_subscriptions')
  loop
    execute format('select exists (select 1 from public.%I)', tbl) into still_has_rows;
    if still_has_rows then
      raise exception 'Reset aborted: table public.% still has rows after the reset.', tbl
        using hint = 'Add it to business_tables in this script (or exclude it on purpose). Everything was rolled back.';
    end if;
  end loop;

  raise notice 'Reset complete: % account(s) kept.', cardinality(keep_ids);
end
$reset$;

-- What remains: the kept accounts, then every table's row count (the business
-- tables should all read 0).
select 'account' as kind, u.email as name, coalesce(p.role::text, 'no profile') as detail
from auth.users u
left join public.profiles p on p.id = u.id
union all
select 'table', t.name, t.row_count::text
from (values
  ('notification_dedupe', (select count(*) from public.notification_dedupe)),
  ('notifications', (select count(*) from public.notifications)),
  ('payments', (select count(*) from public.payments)),
  ('profiles', (select count(*) from public.profiles)),
  ('project_milestones', (select count(*) from public.project_milestones)),
  ('projects', (select count(*) from public.projects)),
  ('push_subscriptions', (select count(*) from public.push_subscriptions)),
  ('service_tickets', (select count(*) from public.service_tickets)),
  ('work_orders', (select count(*) from public.work_orders))
) as t(name, row_count)
order by kind, name;
