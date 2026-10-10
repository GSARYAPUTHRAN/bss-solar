-- ============================================================================
-- BSS Solar — List views + dashboard aggregate for the ledger / KSEB release
-- ----------------------------------------------------------------------------
-- The views drop the fixed first/second payment columns in favour of ledger
-- aggregates, and gain financing, numeric capacity, feasibility and incentive
-- columns. Removing columns needs DROP + CREATE (CREATE OR REPLACE can only
-- append); both happen in this one transaction, so readers never see the views
-- missing. They stay SECURITY INVOKER — the caller's RLS still applies to every
-- base table, including payments.
--
-- Money:        amount_received = advance + Σ contract payments
--               balance_due     = total_cost − amount_received
-- Feasibility:  periods / renewals / valid-until / days-left per
--               20261010120300_feasibility_incentives.sql (clock stops at
--               commissioning; "today" is IST).
-- Idempotent; safe to re-run.
-- ============================================================================

begin;

drop view if exists public.work_orders_list;
drop view if exists public.projects_list;
drop view if exists public.service_tickets_list;

-- ---------------------------------------------------------------------------
-- Work orders
-- ---------------------------------------------------------------------------
create view public.work_orders_list
with (security_invoker = true) as
select
  w.id, w.coordinator_id, w.client_name, w.client_phone, w.address,
  w.plant_capacity, w.plant_capacity_kw, w.advance_amount, w.total_cost,
  w.order_date, w.status, w.created_at, w.updated_at,
  co.full_name as coordinator_name,
  pr.id as project_id, pr.current_stage, pr.is_completed,
  w.consumer_number, w.notes, w.kseb_section,
  w.financing_type, w.loan_bank_name,
  coalesce(pay.contract_total, 0)::numeric(12,2) as payments_total,
  coalesce(pay.contract_count, 0)::integer as payment_count,
  pay.last_paid_on as last_payment_on,
  (coalesce(w.advance_amount, 0) + coalesce(pay.contract_total, 0))::numeric(12,2)
    as amount_received,
  (w.total_cost - coalesce(w.advance_amount, 0) - coalesce(pay.contract_total, 0))::numeric(12,2)
    as balance_due
from work_orders w
left join profiles co on co.id = w.coordinator_id
left join projects pr on pr.work_order_id = w.id
left join lateral (
  select
    sum(p.amount) filter (where p.purpose = 'contract') as contract_total,
    count(*) filter (where p.purpose = 'contract') as contract_count,
    max(p.paid_on) filter (where p.purpose = 'contract') as last_paid_on
  from payments p
  where p.work_order_id = w.id
) pay on true;

-- ---------------------------------------------------------------------------
-- Projects
-- ---------------------------------------------------------------------------
create view public.projects_list
with (security_invoker = true) as
select
  pr.id, pr.coordinator_id, pr.work_order_id, pr.current_stage, pr.is_completed,
  pr.created_at, pr.started_at, pr.completed_at,
  wo.client_name, wo.client_phone, wo.address,
  wo.plant_capacity, wo.plant_capacity_kw, wo.total_cost, wo.advance_amount,
  co.full_name as coordinator_name,
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
  -- The business case: commissioned, but the contract is not fully collected.
  (pr.is_completed
    and coalesce(wo.total_cost, 0) - coalesce(wo.advance_amount, 0)
        - coalesce(pay.contract_total, 0) > 0) as payment_pending,
  pr.feasibility_date,
  fz.periods as feasibility_periods,
  (fz.periods - 1) as feasibility_renewals,
  (pr.feasibility_date + fz.periods * feasibility_validity_days())
    as feasibility_valid_until,
  case when not pr.is_completed and pr.feasibility_date is not null
       then (pr.feasibility_date + fz.periods * feasibility_validity_days())
            - ist_today()
  end as feasibility_days_left,
  coalesce((fz.periods - 1) * feasibility_renewal_fee(), 0)::numeric(12,2)
    as feasibility_extension_cost,
  pr.coordinator_incentive, pr.incentive_paid_on
from projects pr
left join work_orders wo on wo.id = pr.work_order_id
left join profiles co on co.id = pr.coordinator_id
left join lateral (
  select
    sum(p.amount) filter (where p.purpose = 'contract') as contract_total,
    count(*) filter (where p.purpose = 'contract') as contract_count,
    max(p.paid_on) filter (where p.purpose = 'contract') as last_paid_on
  from payments p
  where p.work_order_id = pr.work_order_id
) pay on true
cross join lateral (
  -- The clock runs from the feasibility date until commissioning (or today).
  select feasibility_periods(
    pr.feasibility_date,
    coalesce((pr.completed_at at time zone 'Asia/Kolkata')::date, ist_today())
  ) as periods
) fz;

-- ---------------------------------------------------------------------------
-- Service tickets (+ who is working it)
-- ---------------------------------------------------------------------------
create view public.service_tickets_list
with (security_invoker = true) as
select
  t.id, t.ticket_no, t.ticket_type, t.status, t.scheduled_date, t.service_date,
  t.total, t.created_at, t.project_id,
  wo.client_name,
  t.assigned_to,
  eng.full_name as assignee_name
from service_tickets t
left join projects pr on pr.id = t.project_id
left join work_orders wo on wo.id = pr.work_order_id
left join profiles eng on eng.id = t.assigned_to;

grant select on public.work_orders_list, public.projects_list, public.service_tickets_list
  to anon, authenticated, service_role;

-- The fixed-slot payment helper is superseded by the ledger aggregates above.
drop function if exists public.wo_amount_received(numeric, numeric, numeric);

-- ---------------------------------------------------------------------------
-- Dashboard KPIs (SECURITY INVOKER — respects the caller's RLS). The return
-- type grows, so the function is dropped first; callers reading only the
-- original fields are unaffected.
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
  outstanding_amount numeric,
  feasibility_expiring bigint,
  feasibility_extension_cost numeric,
  incentive_pending numeric
)
language sql
stable
security invoker
set search_path = public
as $$
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
    )::numeric,
    (select count(*) from projects_list
       where feasibility_days_left between 0 and 7)::bigint,
    coalesce(
      (select sum(feasibility_extension_cost) from projects_list), 0
    )::numeric,
    coalesce(
      (select sum(coordinator_incentive) from projects
         where coordinator_incentive is not null and incentive_paid_on is null), 0
    )::numeric;
$$;

grant execute on function public.dashboard_metrics() to anon, authenticated, service_role;

commit;
