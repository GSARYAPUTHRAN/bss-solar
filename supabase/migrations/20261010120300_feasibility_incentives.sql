-- ============================================================================
-- BSS Solar — KSEB feasibility clock + coordinator incentives
-- ----------------------------------------------------------------------------
-- Feasibility: a KSEB feasibility is valid for 30 days. The customer pays the
-- first ₹1,000; every further 30-day period until the plant is commissioned
-- costs BSS another ₹1,000. The clock starts at `projects.feasibility_date` and
-- stops at commissioning (`projects.completed_at`).
--
--   periods  = max(1, ceil(max(as_of − started, 0) / 30))
--   renewals = periods − 1          (each one costs BSS ₹1,000)
--
-- These helpers are mirrored in lib/domain/kseb.ts and pinned to it by
-- tests/integration/feasibility.test.ts — change both together.
--
-- Incentives: a per-project amount the office sets for the coordinator. It lives
-- on `projects`, which is office-write by RLS, so a coordinator can read their
-- incentive but never edit it.
-- Idempotent; safe to re-run.
-- ============================================================================

begin;

alter table public.projects
  add column if not exists feasibility_date date,
  add column if not exists coordinator_incentive numeric(12,2),
  add column if not exists incentive_paid_on date;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'projects_incentive_non_negative'
  ) then
    alter table public.projects
      add constraint projects_incentive_non_negative
      check (coordinator_incentive is null or coordinator_incentive >= 0);
  end if;
  -- A paid date without an amount is meaningless.
  if not exists (
    select 1 from pg_constraint where conname = 'projects_incentive_paid_needs_amount'
  ) then
    alter table public.projects
      add constraint projects_incentive_paid_needs_amount
      check (incentive_paid_on is null or coordinator_incentive is not null);
  end if;
end $$;

create index if not exists idx_projects_feasibility_date
  on public.projects (feasibility_date)
  where feasibility_date is not null;

-- ---------------------------------------------------------------------------
-- Calendar + fee helpers.
-- ---------------------------------------------------------------------------

-- "Today" in India. The database runs in UTC, so a bare current_date would be
-- yesterday for the first 5½ hours of every IST day.
create or replace function public.ist_today()
returns date
language sql
stable
set search_path = public
as $$
  select (now() at time zone 'Asia/Kolkata')::date;
$$;

create or replace function public.feasibility_validity_days()
returns integer
language sql
immutable
as $$
  select 30;
$$;

create or replace function public.feasibility_renewal_fee()
returns numeric
language sql
immutable
as $$
  select 1000::numeric;
$$;

create or replace function public.feasibility_periods(p_started date, p_as_of date)
returns integer
language sql
immutable
as $$
  select case
    when p_started is null or p_as_of is null then null
    else greatest(
      1,
      ceil(
        greatest(p_as_of - p_started, 0)::numeric
        / public.feasibility_validity_days()
      )::integer
    )
  end;
$$;

grant execute on function public.ist_today() to anon, authenticated, service_role;
grant execute on function public.feasibility_validity_days() to anon, authenticated, service_role;
grant execute on function public.feasibility_renewal_fee() to anon, authenticated, service_role;
grant execute on function public.feasibility_periods(date, date) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Incentive totals. SECURITY INVOKER: a coordinator's call only ever sums their
-- own projects; the office may narrow to one coordinator.
-- ---------------------------------------------------------------------------
create or replace function public.incentive_summary(p_coordinator uuid default null)
returns table (projects bigint, total numeric, paid numeric, pending numeric)
language sql
stable
security invoker
set search_path = public
as $$
  select
    count(*)::bigint,
    coalesce(sum(coordinator_incentive), 0)::numeric,
    coalesce(sum(coordinator_incentive) filter (where incentive_paid_on is not null), 0)::numeric,
    coalesce(sum(coordinator_incentive) filter (where incentive_paid_on is null), 0)::numeric
  from projects
  where coordinator_incentive is not null
    and (p_coordinator is null or coordinator_id = p_coordinator);
$$;

grant execute on function public.incentive_summary(uuid) to anon, authenticated, service_role;

commit;
