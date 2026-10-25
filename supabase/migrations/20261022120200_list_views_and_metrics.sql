-- ============================================================================
-- BSS Solar — List views, KPIs and incentive totals for shared coordinators,
-- custom plans and cancellation (2026-10-22)
-- ----------------------------------------------------------------------------
-- Every existing view column keeps its name, type and position; new ones are
-- appended. coordinator_name now lists every coordinator ("A, B"), identical
-- for a single coordinator. Cancelled / refunded projects leave payment_pending
-- and feasibility_days_left; their clock stops at cancelled_on. The views stay
-- SECURITY INVOKER: incentive columns are the caller's (office: everyone's).
-- DROP + CREATE in one transaction (readers never see the views missing).
-- ============================================================================

begin;
set local lock_timeout = '10s';

drop view if exists public.work_orders_list;
drop view if exists public.projects_list;

-- Custom plans have no kW (nothing may price them per kW). The two views were
-- its only dependents (no index or column grant uses it). Drop + re-add rather
-- than ALTER COLUMN … SET EXPRESSION, which needs PG 17 — production's major
-- version is not pinned. The column moves to the end of the table; every
-- reader selects it by name. Re-runnable: the drop is guarded, the add
-- recreates the same definition.
alter table public.work_orders drop column if exists plant_capacity_kw;
alter table public.work_orders
  add column plant_capacity_kw numeric(10,2)
  generated always as (
    case when plan_type = 'solar'::public.plan_type
         then public.parse_capacity_kw(plant_capacity) end
  ) stored;

create view public.work_orders_list
with (security_invoker = true) as
select
  w.id, w.coordinator_id, w.client_name, w.client_phone, w.address,
  w.plant_capacity, w.plant_capacity_kw, w.advance_amount, w.total_cost,
  w.order_date, w.status, w.created_at, w.updated_at,
  team.label as coordinator_name,
  pr.id as project_id, pr.current_stage, pr.is_completed,
  w.consumer_number, w.notes, w.kseb_section,
  w.financing_type, w.loan_bank_name,
  coalesce(pay.contract_total, 0)::numeric(12,2) as payments_total,
  coalesce(pay.contract_count, 0)::integer as payment_count,
  pay.last_paid_on as last_payment_on,
  (coalesce(w.advance_amount, 0) + coalesce(pay.contract_total, 0))::numeric(12,2)
    as amount_received,
  (w.total_cost - coalesce(w.advance_amount, 0) - coalesce(pay.contract_total, 0))::numeric(12,2)
    as balance_due,
  -- 2026-10-22
  coalesce(team.ids, '{}'::uuid[]) as coordinator_ids,
  coalesce(team.names, '{}'::text[]) as coordinator_names,
  w.plan_type,
  pr.cancellation,
  pr.cancelled_on
from work_orders w
left join projects pr on pr.work_order_id = w.id
left join lateral (
  -- RLS: the office sees everyone; a member sees the sale's team and partners.
  select
    array_agg(c.coordinator_id order by c.sort_order, c.created_at, c.coordinator_id) as ids,
    array_agg(coalesce(p.full_name, 'Unknown') order by c.sort_order, c.created_at, c.coordinator_id) as names,
    string_agg(coalesce(p.full_name, 'Unknown'), ', ' order by c.sort_order, c.created_at, c.coordinator_id) as label
  from work_order_coordinators c
  left join profiles p on p.id = c.coordinator_id
  where c.work_order_id = w.id
) team on true
left join lateral (
  select
    sum(p.amount) filter (where p.purpose = 'contract') as contract_total,
    count(*) filter (where p.purpose = 'contract') as contract_count,
    max(p.paid_on) filter (where p.purpose = 'contract') as last_paid_on
  from payments p
  where p.work_order_id = w.id
) pay on true;

create view public.projects_list
with (security_invoker = true) as
select
  pr.id, pr.coordinator_id, pr.work_order_id, pr.current_stage, pr.is_completed,
  pr.created_at, pr.started_at, pr.completed_at,
  wo.client_name, wo.client_phone, wo.address,
  wo.plant_capacity, wo.plant_capacity_kw, wo.total_cost, wo.advance_amount,
  team.label as coordinator_name,
  (select count(*) from project_milestones m
     where m.project_id = pr.id and m.status = 'completed') as milestones_done,
  (select count(*) from project_milestones m
     where m.project_id = pr.id) as milestones_total,
  wo.consumer_number, wo.kseb_section, wo.financing_type, wo.loan_bank_name,
  coalesce(pay.contract_total, 0)::numeric(12,2) as payments_total,
  coalesce(pay.contract_count, 0)::integer as payment_count,
  pay.last_paid_on as last_payment_on,
  (coalesce(wo.advance_amount, 0) + coalesce(pay.contract_total, 0))::numeric(12,2)
    as amount_received,
  (coalesce(wo.total_cost, 0) - coalesce(wo.advance_amount, 0)
     - coalesce(pay.contract_total, 0))::numeric(12,2) as balance_due,
  -- Commissioned, not fully collected, and not cancelled / refunded (whose
  -- balance is no longer receivable).
  (pr.is_completed and pr.cancellation is null
    and coalesce(wo.total_cost, 0) - coalesce(wo.advance_amount, 0)
        - coalesce(pay.contract_total, 0) > 0) as payment_pending,
  pr.feasibility_date,
  fz.periods as feasibility_periods,
  (fz.periods - 1) as feasibility_renewals,
  (pr.feasibility_date + fz.periods * feasibility_validity_days())
    as feasibility_valid_until,
  case when not pr.is_completed and pr.cancellation is null and pr.feasibility_date is not null
       then (pr.feasibility_date + fz.periods * feasibility_validity_days()) - ist_today()
  end as feasibility_days_left,
  coalesce((fz.periods - 1) * feasibility_renewal_fee(), 0)::numeric(12,2)
    as feasibility_extension_cost,
  -- DEPRECATED compat (read only by the build before 2026-10-22): the
  -- incentives the caller may see, and their paid date once all are paid.
  inc.total::numeric(12,2) as coordinator_incentive,
  case when inc.set_count > 0 and inc.unpaid_count = 0 then inc.last_paid_on end
    as incentive_paid_on,
  -- 2026-10-22
  coalesce(team.ids, '{}'::uuid[]) as coordinator_ids,
  coalesce(team.names, '{}'::text[]) as coordinator_names,
  wo.plan_type,
  pr.cancellation,
  pr.cancelled_on,
  pr.cancellation_remarks,
  inc.total::numeric(12,2) as incentive_total,
  coalesce(inc.unpaid, 0)::numeric(12,2) as incentive_unpaid,
  coalesce(inc.set_count, 0)::integer as incentive_count,
  coalesce(inc.unpaid_count, 0)::integer as incentive_unpaid_count,
  coalesce(inc.unpaid_ids, '{}'::uuid[]) as incentive_unpaid_coordinator_ids,
  coalesce(inc.paid_ids, '{}'::uuid[]) as incentive_paid_coordinator_ids
from projects pr
left join work_orders wo on wo.id = pr.work_order_id
left join lateral (
  select
    array_agg(c.coordinator_id order by c.sort_order, c.created_at, c.coordinator_id) as ids,
    array_agg(coalesce(p.full_name, 'Unknown') order by c.sort_order, c.created_at, c.coordinator_id) as names,
    string_agg(coalesce(p.full_name, 'Unknown'), ', ' order by c.sort_order, c.created_at, c.coordinator_id) as label
  from work_order_coordinators c
  left join profiles p on p.id = c.coordinator_id
  where c.work_order_id = pr.work_order_id
) team on true
left join lateral (
  select
    sum(p.amount) filter (where p.purpose = 'contract') as contract_total,
    count(*) filter (where p.purpose = 'contract') as contract_count,
    max(p.paid_on) filter (where p.purpose = 'contract') as last_paid_on
  from payments p
  where p.work_order_id = pr.work_order_id
) pay on true
left join lateral (
  -- RLS: the office sees everyone's; a coordinator only their own.
  select
    sum(i.amount) as total,
    sum(i.amount) filter (where i.paid_on is null) as unpaid,
    count(*) as set_count,
    count(*) filter (where i.paid_on is null) as unpaid_count,
    max(i.paid_on) as last_paid_on,
    array_agg(i.coordinator_id order by i.coordinator_id) filter (where i.paid_on is null) as unpaid_ids,
    array_agg(i.coordinator_id order by i.coordinator_id) filter (where i.paid_on is not null) as paid_ids
  from coordinator_incentives i
  where i.work_order_id = pr.work_order_id and i.amount is not null
) inc on true
cross join lateral (
  -- The clock runs from the feasibility date until commissioning or
  -- cancellation, whichever came first (or today).
  select feasibility_periods(
    pr.feasibility_date,
    coalesce(least((pr.completed_at at time zone 'Asia/Kolkata')::date, pr.cancelled_on), ist_today())
  ) as periods
) fz;

grant select on public.work_orders_list, public.projects_list
  to anon, authenticated, service_role;

-- KPIs (SECURITY INVOKER). Return type grows → drop + create; callers read by name.
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
  outstanding_amount numeric,
  feasibility_expiring bigint,
  feasibility_extension_cost numeric,
  incentive_pending numeric,
  cancelled_projects bigint,
  refunded_projects bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    (select count(*) from work_orders)::bigint,
    (select count(*) from work_orders where status = 'pending')::bigint,
    (select count(*) from projects where not is_completed and cancellation is null)::bigint,
    (select count(*) from projects where is_completed and cancellation is null)::bigint,
    (select count(*) from service_tickets
       where status in ('open', 'scheduled', 'in_progress'))::bigint,
    coalesce(
      (select sum(w.total_cost) from work_orders w
        where w.status = 'approved'
          and not exists (
            select 1 from projects p
            where p.work_order_id = w.id and p.cancellation is not null)), 0
    )::numeric,
    (select count(*) from projects_list where payment_pending)::bigint,
    coalesce(
      (select sum(balance_due) from projects_list where payment_pending), 0
    )::numeric,
    (select count(*) from projects_list
       where feasibility_days_left between 0 and 7)::bigint,
    -- Renewal fees already borne stay a cost, cancelled projects included.
    coalesce(
      (select sum(feasibility_extension_cost) from projects_list), 0
    )::numeric,
    -- Every coordinator's unpaid incentive (a coordinator's call: their own).
    coalesce(
      (select sum(i.amount) from coordinator_incentives i
         join projects p on p.work_order_id = i.work_order_id
        where i.amount is not null and i.paid_on is null), 0
    )::numeric,
    (select count(*) from projects where cancellation = 'cancelled')::bigint,
    (select count(*) from projects where cancellation = 'refunded')::bigint;
$$;
grant execute on function public.dashboard_metrics() to anon, authenticated, service_role;

-- Incentive totals per person (same signature). SECURITY INVOKER: a
-- coordinator's call only ever sums their own rows; the office may narrow to
-- one coordinator. A shared project counts once.
create or replace function public.incentive_summary(p_coordinator uuid default null)
returns table (
  projects bigint, pending_projects bigint,
  total numeric, paid numeric, pending numeric
)
language sql stable security invoker set search_path = public as $$
  select
    count(distinct i.work_order_id)::bigint,
    count(distinct i.work_order_id) filter (where i.paid_on is null)::bigint,
    coalesce(sum(i.amount), 0)::numeric,
    coalesce(sum(i.amount) filter (where i.paid_on is not null), 0)::numeric,
    coalesce(sum(i.amount) filter (where i.paid_on is null), 0)::numeric
  from coordinator_incentives i
  join projects p on p.work_order_id = i.work_order_id
  where i.amount is not null
    and (p_coordinator is null or i.coordinator_id = p_coordinator);
$$;

commit;
