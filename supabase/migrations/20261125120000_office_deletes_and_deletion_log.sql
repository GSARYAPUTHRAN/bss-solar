-- ============================================================================
-- BSS Solar — Office deletes and the deletion log (2026-11-25)
-- ----------------------------------------------------------------------------
-- 1. Who may delete. can_delete() is the ONE database switch: the Super Admin
--    and, for now, the Admin. Its app twin is DELETE_ROLES in
--    src/lib/domain/role.ts; the two change together. The four SuperAdmin-only
--    DELETE policies (work orders, projects, payments, profiles) now ask it.
--    Profiles keep their own limits on top: the Super Admin's seat is never
--    deletable through the API, nobody deletes themselves, and an Admin
--    deletes coordinators and engineers only (never another Admin). So that
--    an Admin cannot first demote another Admin and then delete them, only
--    the Super Admin changes an Admin's role (guard_profile_role()).
--
-- 2. Two RPCs for the office:
--      delete_work_orders(ids)                 bulk delete (duplicate clean-up),
--                                              one statement, the caller's RLS;
--      delete_coordinator_incentive(wo, co)    removes an agreed incentive and
--                                              every instalment paid against it
--                                              (the membership stays).
--
-- 3. deleted_records: every delete made by a signed-in user is logged with a
--    full snapshot of the row, who did it and when. Cascaded children carry the
--    same tx, so a sale and everything that went with it read as one event:
--    its project (with the ids of the service tickets that were linked to it),
--    milestones, ledger, the people who shared it and their incentives.
--    Wipe and reset scripts, service-role clean-ups and SQL run by the owner
--    (no auth.uid()) are not logged. Rows are recovered with SQL from the
--    snapshot; there is no restore button. recent_deletion_txs(n) names the
--    n latest deletes, so Recently deleted reads each one whole.
--
-- Expand-only: the previous build shows deletes to the Super Admin alone and
-- deletes team members through the service role, so it keeps working. Its
-- Team page meets the stricter role rule as a refused change with the
-- database's message ("Only the Super Admin can change an admin's role").
-- Idempotent; safe to re-run.
-- ============================================================================

begin;
-- Fail fast rather than queue every request behind a long transaction.
set local lock_timeout = '10s';

-- ---------------------------------------------------------------------------
-- 1. The delete switch
-- ---------------------------------------------------------------------------
-- The one DB switch for who may delete. To make deletes Super Admin-only again,
-- change the list to ('superadmin') in a new migration and drop 'admin' from
-- DELETE_ROLES in src/lib/domain/role.ts. Compared as text, like is_admin().
create or replace function public.can_delete()
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from profiles
    where id = auth.uid() and role::text in ('admin', 'superadmin')
  );
$$;
grant execute on function public.can_delete() to anon, authenticated, service_role;

comment on function public.can_delete() is
  'The one DB switch for who may delete. To make deletes Super Admin-only again, change the list to (''superadmin'') in a new migration and drop ''admin'' from DELETE_ROLES in src/lib/domain/role.ts.';

drop policy if exists wo_delete on public.work_orders;
create policy wo_delete on public.work_orders
  for delete using (can_delete());

drop policy if exists proj_superadmin_delete on public.projects;
drop policy if exists proj_delete on public.projects;
create policy proj_delete on public.projects
  for delete using (can_delete());

drop policy if exists payment_superadmin_delete on public.payments;
drop policy if exists payment_delete on public.payments;
create policy payment_delete on public.payments
  for delete using (can_delete());

-- Never the Super Admin's seat (it was not protected here before), never
-- yourself, and an Admin deletes coordinators and engineers only. The team
-- page deletes through the auth admin API (service role), where the app's
-- teamDeleteAuthority applies the same rules.
drop policy if exists profiles_superadmin_delete on public.profiles;
drop policy if exists profiles_delete on public.profiles;
create policy profiles_delete on public.profiles
  for delete using (
    can_delete()
    and role::text <> 'superadmin'
    and id <> auth.uid()
    and (is_superadmin() or role::text in ('coordinator', 'service_engineer'))
  );

-- Role guard (20261022120000) with one more rule: only the Super Admin changes
-- an Admin's role. Otherwise an Admin could demote another Admin and then
-- delete them, or change their sign-in. Nobody changes their own role either
-- (the app refuses it too): an Admin is caught here, the Super Admin by the
-- seat rule, everyone else by the first check.
create or replace function public.guard_profile_role()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.role is distinct from old.role and auth.uid() is not null then
    if not public.is_admin() then
      raise exception 'Only an administrator can change a user role'
        using errcode = '42501';
    end if;

    if new.role::text = 'superadmin' or old.role::text = 'superadmin' then
      raise exception 'The SuperAdmin role cannot be granted or revoked from the application'
        using errcode = '42501';
    end if;

    if old.role::text = 'admin' and not public.is_superadmin() then
      raise exception 'Only the Super Admin can change an admin''s role'
        using errcode = '42501';
    end if;
  end if;

  if new.role is distinct from old.role then
    if new.role::text = 'service_engineer' and (
         exists (select 1 from work_order_coordinators where coordinator_id = new.id)
      or exists (select 1 from work_orders where coordinator_id = new.id)
      or exists (select 1 from projects where coordinator_id = new.id)
    ) then
      raise exception 'This member still owns or shares work orders or projects — take them off those sales before making them a service engineer'
        using errcode = '23514';
    end if;
    if old.role::text = 'service_engineer' and exists (
      select 1 from service_tickets
      where assigned_to = new.id
        and status::text in ('open', 'scheduled', 'in_progress')
    ) then
      raise exception 'This engineer still holds open service tickets — reassign them before changing the role'
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Office RPCs
-- ---------------------------------------------------------------------------
-- Deletes the given sales in one statement (all or nothing) and returns the ids
-- that went. SECURITY INVOKER: wo_delete decides, so a caller who may not
-- delete removes nothing and gets '{}'. Ids that are already gone are skipped.
create or replace function public.delete_work_orders(p_ids uuid[])
returns uuid[] language plpgsql security invoker set search_path = public as $$
declare
  v_deleted uuid[];
begin
  if cardinality(p_ids) > 500 then
    raise exception 'At most 500 sales can be deleted at once' using errcode = '22023';
  end if;
  with gone as (
    delete from work_orders w where w.id = any (p_ids) returning w.id
  )
  select coalesce(array_agg(gone.id), '{}') into v_deleted from gone;
  return v_deleted;
end;
$$;
revoke execute on function public.delete_work_orders(uuid[]) from public, anon;
grant execute on function public.delete_work_orders(uuid[]) to authenticated, service_role;

-- "Delete an incentive": the agreed amount and every instalment paid against
-- it. The incentive row itself belongs to the membership and stays, with no
-- amount. Office only (can_delete()). The instalments are logged by their own
-- trigger; the agreed amount is logged here, since no row is deleted for it.
create or replace function public.delete_coordinator_incentive(
  p_work_order_id uuid,
  p_coordinator_id uuid
)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_row coordinator_incentives;
begin
  if not can_delete() then
    raise exception 'Only the office can delete an incentive' using errcode = '42501';
  end if;

  select * into v_row
  from coordinator_incentives i
  where i.work_order_id = p_work_order_id and i.coordinator_id = p_coordinator_id
  for update;
  if not found then
    raise exception 'That incentive was not found' using errcode = 'P0002';
  end if;

  -- Instalments first: the agreed amount can never drop below what has been
  -- paid out of it.
  delete from coordinator_incentive_payments p
  where p.work_order_id = p_work_order_id and p.coordinator_id = p_coordinator_id;

  if v_row.amount is not null then
    insert into deleted_records (table_name, record_id, snapshot, deleted_by, deleted_by_name)
    select 'coordinator_incentives',
           p_work_order_id::text || ':' || p_coordinator_id::text,
           to_jsonb(v_row), p.id, p.full_name
    from profiles p
    where p.id = auth.uid();
  end if;

  -- No amount, no paid date (coordinator_incentives_paid_needs_amount).
  update coordinator_incentives i
     set amount = null, paid_on = null
   where i.work_order_id = p_work_order_id and i.coordinator_id = p_coordinator_id;
end;
$$;
revoke execute on function public.delete_coordinator_incentive(uuid, uuid) from public, anon;
grant execute on function public.delete_coordinator_incentive(uuid, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Deletion log
-- ---------------------------------------------------------------------------
create table if not exists public.deleted_records (
  id bigint generated always as identity primary key,
  -- work_orders | projects | project_milestones | payments | service_tickets
  -- | work_order_coordinators | coordinator_incentives
  -- | coordinator_incentive_payments | profiles
  table_name text not null,
  -- The row's id; work_order_coordinators and coordinator_incentives (no id)
  -- as '<work_order_id>:<coordinator_id>'.
  record_id text not null,
  -- to_jsonb(old): everything needed to put the row back with SQL. A project's
  -- also lists the service tickets linked to it (service_ticket_ids).
  snapshot jsonb not null,
  deleted_by uuid references public.profiles(id) on delete set null,
  -- The actor's name when they deleted it (survives the actor's own deletion).
  deleted_by_name text,
  deleted_at timestamptz not null default now(),
  -- Groups a delete with its cascades (one transaction).
  tx bigint not null default txid_current()
);
create index if not exists idx_deleted_records_deleted_at
  on public.deleted_records (deleted_at desc);
create index if not exists idx_deleted_records_tx
  on public.deleted_records (tx);

comment on table public.deleted_records is
  'Every delete made by a signed-in user, with a full snapshot of the row (written by log_deletion()): work orders, projects (with service_ticket_ids, the tickets linked at the time), milestones, payments, service tickets, who shared a deleted sale, incentives, instalments and profiles. Rows of one delete share its tx. Restore with SQL from the snapshot (DEPLOY.md, "Restoring a deleted sale").';

alter table public.deleted_records enable row level security;

-- Deleters read the log. Nobody writes it through the API: the trigger is a
-- definer function, and the team page's service role logs the accounts it
-- deletes through the auth admin API.
revoke all on public.deleted_records from anon, authenticated;
revoke all on sequence public.deleted_records_id_seq from anon, authenticated;
grant select on public.deleted_records to authenticated;
grant all on public.deleted_records to service_role;

drop policy if exists deleted_records_select on public.deleted_records;
create policy deleted_records_select on public.deleted_records
  for select using (can_delete());

-- The latest deletes, newest first: the tx of each (at most 200), so that
-- Recently deleted reads every row of a delete, however many one bulk
-- clean-up logged. SECURITY INVOKER: the log's own policy decides, so anyone
-- who may not read it gets nothing.
create or replace function public.recent_deletion_txs(p_limit int default 50)
returns setof bigint language sql stable security invoker set search_path = public as $$
  select r.tx
  from deleted_records r
  group by r.tx
  order by max(r.deleted_at) desc, max(r.id) desc
  limit least(greatest(coalesce(p_limit, 50), 1), 200);
$$;
revoke execute on function public.recent_deletion_txs(int) from public, anon;
grant execute on function public.recent_deletion_txs(int) to authenticated, service_role;

-- One row per deleted row, cascaded children included (auth.uid() is still the
-- caller's inside a cascade). Only for a signed-in user. The actor's profile
-- may be gone by the time this runs (deleted in the same statement): the row
-- is still logged, with their id and name left empty.
-- Who shared a sale is logged only when the sale goes with them: taking
-- someone off a sale that stays is an edit, not a delete. A project's service
-- tickets stay but lose their link (on delete set null), so its snapshot also
-- lists which were linked (service_ticket_ids); its trigger runs BEFORE the
-- delete for that reason, ahead of the SET NULL.
create or replace function public.log_deletion()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_old jsonb := to_jsonb(old);
  v_by uuid;
  v_name text;
begin
  if v_uid is not null
     and not (tg_table_name = 'work_order_coordinators' and exists (
       select 1 from work_orders w where w.id = (v_old ->> 'work_order_id')::uuid
     )) then
    if tg_table_name = 'projects' then
      v_old := v_old || jsonb_build_object('service_ticket_ids', coalesce(
        (select jsonb_agg(t.id order by t.id)
           from service_tickets t
          where t.project_id = (v_old ->> 'id')::uuid),
        '[]'::jsonb));
    end if;
    select p.id, p.full_name into v_by, v_name from profiles p where p.id = v_uid;
    insert into deleted_records (table_name, record_id, snapshot, deleted_by, deleted_by_name)
    values (
      tg_table_name,
      case
        when tg_table_name in ('coordinator_incentives', 'work_order_coordinators')
          then (v_old ->> 'work_order_id') || ':' || (v_old ->> 'coordinator_id')
        else v_old ->> 'id'
      end,
      v_old,
      v_by,
      v_name
    );
  end if;
  -- A BEFORE trigger hands the row back: NULL would silently skip the delete.
  if tg_when = 'BEFORE' then
    return old;
  end if;
  return null;
end;
$$;

drop trigger if exists t_work_orders_log_delete on public.work_orders;
create trigger t_work_orders_log_delete
  after delete on public.work_orders
  for each row execute function public.log_deletion();

-- BEFORE, to read the project's tickets ahead of the SET NULL that unlinks
-- them. It fires for a project deleted with its sale too, and a delete that
-- fails takes its log row with it.
drop trigger if exists t_projects_log_delete on public.projects;
create trigger t_projects_log_delete
  before delete on public.projects
  for each row execute function public.log_deletion();

drop trigger if exists t_project_milestones_log_delete on public.project_milestones;
create trigger t_project_milestones_log_delete
  after delete on public.project_milestones
  for each row execute function public.log_deletion();

drop trigger if exists t_payments_log_delete on public.payments;
create trigger t_payments_log_delete
  after delete on public.payments
  for each row execute function public.log_deletion();

drop trigger if exists t_service_tickets_log_delete on public.service_tickets;
create trigger t_service_tickets_log_delete
  after delete on public.service_tickets
  for each row execute function public.log_deletion();

-- An incentive row goes with its membership; one without an amount is noise.
drop trigger if exists t_coordinator_incentives_log_delete on public.coordinator_incentives;
create trigger t_coordinator_incentives_log_delete
  after delete on public.coordinator_incentives
  for each row
  when (old.amount is not null)
  execute function public.log_deletion();

-- Only with its sale (see log_deletion()).
drop trigger if exists t_work_order_coordinators_log_delete on public.work_order_coordinators;
create trigger t_work_order_coordinators_log_delete
  after delete on public.work_order_coordinators
  for each row execute function public.log_deletion();

drop trigger if exists t_coordinator_incentive_payments_log_delete
  on public.coordinator_incentive_payments;
create trigger t_coordinator_incentive_payments_log_delete
  after delete on public.coordinator_incentive_payments
  for each row execute function public.log_deletion();

drop trigger if exists t_profiles_log_delete on public.profiles;
create trigger t_profiles_log_delete
  after delete on public.profiles
  for each row execute function public.log_deletion();

commit;
