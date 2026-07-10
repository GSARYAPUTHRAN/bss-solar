-- ============================================================================
-- BSS Solar — Security & data-integrity hardening
-- ----------------------------------------------------------------------------
-- Closes three confirmed defects on the live multi-tenant database:
--   1. Privilege escalation — a coordinator could set their own profiles.role
--      to 'admin' (profiles_update_self had no WITH CHECK / column guard).
--   2. Self-approval — a coordinator could set work_orders.status = 'approved'
--      (and reassign coordinator_id) directly via the anon key, bypassing the
--      admin-only approveWorkOrder action.
--   3. Desync — an approval that did not run the app action left an approved
--      work order with no backing project/milestones.
--
-- The guards intentionally allow server-side contexts (service-role key and
-- the superuser that runs seed/migrations) where auth.uid() is NULL, and admins
-- (is_admin()); only a logged-in NON-admin is restricted. Idempotent & atomic.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Prevent role self-escalation.
--    A column-level BEFORE trigger is used (not just RLS) because a WITH CHECK
--    clause cannot compare the new row against the old role value.
-- ---------------------------------------------------------------------------
create or replace function public.guard_profile_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role is distinct from old.role
     and auth.uid() is not null
     and not public.is_admin() then
    raise exception 'Only an administrator can change a user role'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists t_profiles_guard_role on public.profiles;
create trigger t_profiles_guard_role
  before update on public.profiles
  for each row execute function public.guard_profile_role();

-- A user may only ever target their own profile row (admins are covered by the
-- separate profiles_admin_all policy). WITH CHECK stops repointing id.
drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
  for update
  using (id = auth.uid())
  with check (id = auth.uid());

-- ---------------------------------------------------------------------------
-- 2. Prevent coordinators from self-approving work orders or reassigning them.
--    Status and coordinator_id changes become admin-only; other columns remain
--    editable by the owner (RLS still scopes rows to the owner/admin).
-- ---------------------------------------------------------------------------
create or replace function public.guard_work_order_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null and not public.is_admin() then
    if new.status is distinct from old.status then
      raise exception 'Only an administrator can change a work order status'
        using errcode = '42501';
    end if;
    if new.coordinator_id is distinct from old.coordinator_id then
      raise exception 'Only an administrator can reassign a work order'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists t_wo_guard on public.work_orders;
create trigger t_wo_guard
  before update on public.work_orders
  for each row execute function public.guard_work_order_update();

-- Retain ownership on update (defense in depth alongside the trigger).
drop policy if exists wo_update on public.work_orders;
create policy wo_update on public.work_orders
  for update
  using (is_admin() or coordinator_id = auth.uid())
  with check (is_admin() or coordinator_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 3. Make CRM -> project promotion atomic and un-bypassable.
--    Whenever a work order transitions INTO 'approved', ensure its project
--    exists. on_project_created then seeds the 9 milestones. Idempotent via
--    the unique (work_order_id) constraint.
-- ---------------------------------------------------------------------------
create or replace function public.create_project_on_approval()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'approved' and old.status is distinct from 'approved' then
    insert into public.projects (work_order_id, coordinator_id)
    values (new.id, new.coordinator_id)
    on conflict (work_order_id) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists t_wo_create_project on public.work_orders;
create trigger t_wo_create_project
  after update on public.work_orders
  for each row execute function public.create_project_on_approval();

commit;
