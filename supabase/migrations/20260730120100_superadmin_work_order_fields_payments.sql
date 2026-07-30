-- ============================================================================
-- BSS Solar — SuperAdmin role, extended work-order record, payment tracking
-- ----------------------------------------------------------------------------
-- 1. SuperAdmin — a single privileged account that owns *destructive* actions
--    (deleting users, projects and work orders). Regular admins keep every
--    other capability but can no longer delete.
-- 2. Extra work-order fields captured by the office after the sale
--    (consumer number, KSEB section, loan bank, notes, two staged payments).
-- 3. Payment tracking — amount received / balance due are derived from the work
--    order, so a *commissioned project with an outstanding balance* becomes a
--    first-class, queryable state (`projects_list.payment_pending`).
--
-- Backward compatible with the currently-deployed code: every column/view
-- column is additive, dashboard_metrics only gains trailing fields, and the one
-- behaviour change (delete becomes SuperAdmin-only) fails closed.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Role helpers. `is_admin()` stays the "office staff or above" predicate so
--    every existing policy keeps working for the SuperAdmin too; the new
--    `is_superadmin()` gates deletes. Compared as text so this file never
--    depends on the enum label having been committed by a prior statement.
-- ---------------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from profiles
    where id = auth.uid() and role::text in ('admin', 'superadmin')
  );
$$;

create or replace function public.is_superadmin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from profiles
    where id = auth.uid() and role::text = 'superadmin'
  );
$$;

grant execute on function public.is_admin() to anon, authenticated, service_role;
grant execute on function public.is_superadmin() to anon, authenticated, service_role;

-- There is exactly one SuperAdmin. Every row in the partial set shares the same
-- `role`, so a unique index over it caps the set at a single member. The
-- predicate compares the enum directly (an enum->text cast is only STABLE, which
-- an index predicate rejects); safe because the label was committed by the
-- preceding migration.
create unique index if not exists uniq_profiles_single_superadmin
  on public.profiles (role)
  where role = 'superadmin';

-- ---------------------------------------------------------------------------
-- 2. Role-change guard. Non-admins still cannot touch roles at all. Granting or
--    revoking SuperAdmin is reserved to the SuperAdmin — except while the seat
--    is vacant, when any admin may appoint the first one (bootstrap / recovery).
-- ---------------------------------------------------------------------------
create or replace function public.guard_profile_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role is distinct from old.role and auth.uid() is not null then
    if not public.is_admin() then
      raise exception 'Only an administrator can change a user role'
        using errcode = '42501';
    end if;

    if (new.role::text = 'superadmin' or old.role::text = 'superadmin')
       and not public.is_superadmin()
       and exists (select 1 from profiles where role::text = 'superadmin') then
      raise exception 'Only the SuperAdmin can grant or revoke the SuperAdmin role'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists t_profiles_guard_role on public.profiles;
create trigger t_profiles_guard_role
  before update on public.profiles
  for each row execute function public.guard_profile_role();

-- ---------------------------------------------------------------------------
-- 3. Deletes become SuperAdmin-only.
--    The blanket `FOR ALL` admin policies included DELETE, so they are split
--    into explicit per-command policies. SELECT keeps flowing through the
--    existing *_select policies (which already allow is_admin()).
-- ---------------------------------------------------------------------------
drop policy if exists profiles_admin_all on public.profiles;
drop policy if exists profiles_admin_insert on public.profiles;
create policy profiles_admin_insert on public.profiles
  for insert with check (is_admin());
drop policy if exists profiles_admin_update on public.profiles;
create policy profiles_admin_update on public.profiles
  for update using (is_admin()) with check (is_admin());
drop policy if exists profiles_superadmin_delete on public.profiles;
create policy profiles_superadmin_delete on public.profiles
  for delete using (is_superadmin());

drop policy if exists proj_admin_write on public.projects;
drop policy if exists proj_admin_insert on public.projects;
create policy proj_admin_insert on public.projects
  for insert with check (is_admin());
drop policy if exists proj_admin_update on public.projects;
create policy proj_admin_update on public.projects
  for update using (is_admin()) with check (is_admin());
drop policy if exists proj_superadmin_delete on public.projects;
create policy proj_superadmin_delete on public.projects
  for delete using (is_superadmin());

drop policy if exists wo_delete on public.work_orders;
create policy wo_delete on public.work_orders
  for delete using (is_superadmin());

-- ---------------------------------------------------------------------------
-- 4. Extended work-order record.
-- ---------------------------------------------------------------------------
alter table public.work_orders
  add column if not exists consumer_number       text,
  add column if not exists notes                 text,
  add column if not exists kseb_section          text,
  add column if not exists loan_bank_name        text,
  add column if not exists first_payment_date    date,
  add column if not exists first_payment_amount  numeric(12,2),
  add column if not exists second_payment_date   date,
  add column if not exists second_payment_amount numeric(12,2);

create index if not exists idx_work_orders_consumer_number
  on public.work_orders (consumer_number);

-- ---------------------------------------------------------------------------
-- 5. Payment maths — one definition shared by both list views and the dashboard
--    aggregate, mirrored in the app by lib/domain/payment.ts.
-- ---------------------------------------------------------------------------
create or replace function public.wo_amount_received(
  advance numeric,
  first_payment numeric,
  second_payment numeric
)
returns numeric
language sql
immutable
as $$
  select coalesce(advance, 0) + coalesce(first_payment, 0)
       + coalesce(second_payment, 0);
$$;

grant execute on function
  public.wo_amount_received(numeric, numeric, numeric)
  to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. List views gain the new fields plus the derived payment columns. Columns
--    are APPENDED so `create or replace view` accepts the new definition, and
--    the views stay SECURITY INVOKER (the caller's RLS still applies).
-- ---------------------------------------------------------------------------
create or replace view public.work_orders_list
with (security_invoker = true) as
select
  w.id, w.coordinator_id, w.client_name, w.client_phone, w.address,
  w.plant_capacity, w.advance_amount, w.total_cost, w.order_date, w.status,
  w.created_at, w.updated_at,
  co.full_name as coordinator_name,
  pr.id as project_id, pr.current_stage, pr.is_completed,
  w.consumer_number, w.notes, w.kseb_section, w.loan_bank_name,
  w.first_payment_date, w.first_payment_amount,
  w.second_payment_date, w.second_payment_amount,
  wo_amount_received(
    w.advance_amount, w.first_payment_amount, w.second_payment_amount
  ) as amount_received,
  w.total_cost - wo_amount_received(
    w.advance_amount, w.first_payment_amount, w.second_payment_amount
  ) as balance_due
from work_orders w
left join profiles co on co.id = w.coordinator_id
left join projects pr on pr.work_order_id = w.id;

create or replace view public.projects_list
with (security_invoker = true) as
select
  pr.id, pr.coordinator_id, pr.current_stage, pr.is_completed,
  pr.created_at, pr.started_at, pr.completed_at,
  wo.client_name, wo.plant_capacity, wo.total_cost,
  co.full_name as coordinator_name,
  (select count(*) from project_milestones m
     where m.project_id = pr.id and m.status = 'completed') as milestones_done,
  (select count(*) from project_milestones m
     where m.project_id = pr.id) as milestones_total,
  pr.work_order_id,
  wo.consumer_number, wo.kseb_section, wo.loan_bank_name,
  wo.advance_amount,
  wo.first_payment_date, wo.first_payment_amount,
  wo.second_payment_date, wo.second_payment_amount,
  wo_amount_received(
    wo.advance_amount, wo.first_payment_amount, wo.second_payment_amount
  ) as amount_received,
  coalesce(wo.total_cost, 0) - wo_amount_received(
    wo.advance_amount, wo.first_payment_amount, wo.second_payment_amount
  ) as balance_due,
  -- The business case: the plant is commissioned but the money is not fully in.
  (
    pr.is_completed
    and coalesce(wo.total_cost, 0) - wo_amount_received(
      wo.advance_amount, wo.first_payment_amount, wo.second_payment_amount
    ) > 0
  ) as payment_pending
from projects pr
left join work_orders wo on wo.id = pr.work_order_id
left join profiles co on co.id = pr.coordinator_id;

grant select on public.work_orders_list, public.service_tickets_list,
  public.projects_list to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7. Dashboard aggregate gains the commissioned-but-unpaid KPIs. The return
--    type changes, so the function is dropped first; callers that only read the
--    original fields are unaffected.
-- ---------------------------------------------------------------------------
drop function if exists public.dashboard_metrics();
create function public.dashboard_metrics()
returns table (
  total_work_orders bigint,
  pending_approvals bigint,
  active_projects bigint,
  commissioned bigint,
  open_tickets bigint,
  approved_pipeline numeric,
  commissioned_unpaid bigint,
  outstanding_amount numeric
)
language sql stable security invoker set search_path = public as $$
  select
    (select count(*) from work_orders)::bigint,
    (select count(*) from work_orders where status = 'pending')::bigint,
    (select count(*) from projects where not is_completed)::bigint,
    (select count(*) from projects where is_completed)::bigint,
    (select count(*) from service_tickets
       where status in ('open', 'scheduled', 'in_progress'))::bigint,
    coalesce(
      (select sum(total_cost) from work_orders where status = 'approved'), 0
    )::numeric,
    (select count(*) from projects_list where payment_pending)::bigint,
    coalesce(
      (select sum(balance_due) from projects_list where payment_pending), 0
    )::numeric;
$$;

grant execute on function public.dashboard_metrics()
  to anon, authenticated, service_role;

commit;
