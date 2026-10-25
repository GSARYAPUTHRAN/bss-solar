-- ============================================================================
-- BSS Solar — Custom plans and cancelled / refunded projects (2026-10-22)
-- ----------------------------------------------------------------------------
-- A custom plan (e.g. "1 panel", "Inverter + panel") is not a kW solar plant:
-- its details live in work_orders.plant_capacity (the plan label), it has no
-- kW (migration 20261022120200), no KSEB feasibility and a single Handover
-- milestone. The plan is fixed once a project exists.
-- The office may mark a project cancelled or refunded (with remarks) and
-- reinstate it. The clock stops at cancelled_on.
-- Expand-only; defaults keep every existing row solar and live. Idempotent.
-- ============================================================================

begin;
set local lock_timeout = '10s';

do $$
begin
  if not exists (select 1 from pg_type where typname = 'plan_type') then
    create type public.plan_type as enum ('solar', 'custom');
  end if;
  if not exists (select 1 from pg_type where typname = 'project_cancellation') then
    create type public.project_cancellation as enum ('cancelled', 'refunded');
  end if;
end $$;

-- plant_capacity: a solar plant's capacity ("3kW"), or what a custom plan sold.
alter table public.work_orders
  add column if not exists plan_type public.plan_type not null default 'solar';

alter table public.projects
  add column if not exists cancellation public.project_cancellation,     -- NULL = live
  add column if not exists cancelled_on date,                            -- IST date
  add column if not exists cancelled_by uuid references public.profiles(id) on delete set null,
  add column if not exists cancellation_remarks text;                    -- kept after reinstating

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'projects_cancelled_on_needs_cancellation') then
    alter table public.projects add constraint projects_cancelled_on_needs_cancellation
      check (cancelled_on is null or cancellation is not null);
  end if;
  -- A cancelled project with a running clock must say when it stopped.
  if not exists (select 1 from pg_constraint where conname = 'projects_cancellation_stops_clock') then
    alter table public.projects add constraint projects_cancellation_stops_clock
      check (cancellation is null or cancelled_on is not null or feasibility_date is null);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'projects_cancellation_remarks_length') then
    alter table public.projects add constraint projects_cancellation_remarks_length
      check (cancellation_remarks is null or char_length(cancellation_remarks) <= 2000);
  end if;
end $$;

create index if not exists idx_projects_cancellation
  on public.projects (cancellation) where cancellation is not null;

-- Milestones by plan. Mirrored by stagesFor() in lib/domain/plan.ts.
create or replace function public.seed_project_milestones()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (select w.plan_type from work_orders w where w.id = new.work_order_id) = 'custom' then
    -- No KSEB process: one Handover step.
    insert into project_milestones (project_id, stage, sort_order)
    values (new.id, 'plant_commissioning', 9);
  else
    insert into project_milestones (project_id, stage, sort_order) values
      (new.id, 'site_feasibility_survey', 1),
      (new.id, 'kseb_portal_registration', 2),
      (new.id, 'kseb_feasibility_clearance', 3),
      (new.id, 'material_dispatch', 4),
      (new.id, 'structure_fabrication', 5),
      (new.id, 'panel_installation', 6),
      (new.id, 'wcr_submitted', 7),
      (new.id, 'kseb_inspection_meter', 8),
      (new.id, 'plant_commissioning', 9);
  end if;
  return new;
end;
$$;
-- (trigger on_project_created unchanged)

-- Every context: a custom plan starts at its only stage and never has a KSEB
-- feasibility date.
create or replace function public.guard_project_plan()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (select w.plan_type from work_orders w where w.id = new.work_order_id) = 'custom' then
    if tg_op = 'INSERT' then
      new.current_stage := 'plant_commissioning';
    end if;
    if new.feasibility_date is not null then
      raise exception 'A custom plan has no KSEB feasibility date' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists t_proj_plan on public.projects;
create trigger t_proj_plan
  before insert or update of feasibility_date on public.projects
  for each row execute function public.guard_project_plan();

-- Who recorded the cancellation comes from the session, never from the
-- request. Stamped only when the status itself changes; otherwise a forged
-- cancelled_by is put back, while the FK's ON DELETE SET NULL (new value NULL,
-- a profile deleted) passes untouched instead of re-attributing the row.
create or replace function public.stamp_project_cancellation()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' or new.cancellation is distinct from old.cancellation then
    new.cancelled_by := case when new.cancellation is null then null else auth.uid() end;
  elsif new.cancelled_by is not null and new.cancelled_by is distinct from old.cancelled_by then
    new.cancelled_by := old.cancelled_by;
  end if;
  return new;
end;
$$;
drop trigger if exists t_proj_stamp_cancellation on public.projects;
create trigger t_proj_stamp_cancellation
  before insert or update of cancellation, cancelled_by on public.projects
  for each row execute function public.stamp_project_cancellation();

-- Work-order guard: + the plan is fixed once a project exists (every context).
create or replace function public.guard_work_order_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.plan_type is distinct from old.plan_type
     and exists (select 1 from projects p where p.work_order_id = new.id) then
    raise exception 'The plan is fixed once the work order has a project'
      using errcode = '23514';
  end if;

  if auth.uid() is not null and not public.is_admin() then
    if tg_op = 'INSERT' then
      if new.status is distinct from 'pending' then
        raise exception 'A new work order starts as pending; only the office can approve or reject it'
          using errcode = '42501';
      end if;
      return new;
    end if;

    if new.status is distinct from old.status then
      raise exception 'Only an administrator can change a work order status'
        using errcode = '42501';
    end if;
    if new.coordinator_id is distinct from old.coordinator_id then
      raise exception 'Only an administrator can reassign a work order'
        using errcode = '42501';
    end if;
    if old.status <> 'pending'
       and (coalesce(new.advance_amount, 0) is distinct from coalesce(old.advance_amount, 0)
            or new.total_cost is distinct from old.total_cost) then
      raise exception 'Only the office can change the amounts of an approved or rejected work order'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

commit;
