-- ============================================================================
-- BSS Solar — Flattened list views for server-side pagination
-- ----------------------------------------------------------------------------
-- These views denormalize the display/search columns (client name, coordinator
-- name, milestone counts) so list pages can paginate, filter, sort and search
-- entirely in Postgres via .range()/.ilike()/.order()/count. They are
-- SECURITY INVOKER, so the caller's RLS on the base tables still applies (a
-- coordinator only ever sees their own rows through the view).
-- ============================================================================

begin;

create or replace view work_orders_list
with (security_invoker = true) as
select
  w.id, w.coordinator_id, w.client_name, w.client_phone, w.address,
  w.plant_capacity, w.advance_amount, w.total_cost, w.order_date, w.status,
  w.created_at, w.updated_at,
  co.full_name as coordinator_name,
  pr.id as project_id, pr.current_stage, pr.is_completed
from work_orders w
left join profiles co on co.id = w.coordinator_id
left join projects pr on pr.work_order_id = w.id;

create or replace view service_tickets_list
with (security_invoker = true) as
select
  t.id, t.ticket_no, t.ticket_type, t.status, t.scheduled_date, t.service_date,
  t.total, t.created_at, t.project_id,
  wo.client_name
from service_tickets t
left join projects pr on pr.id = t.project_id
left join work_orders wo on wo.id = pr.work_order_id;

create or replace view projects_list
with (security_invoker = true) as
select
  pr.id, pr.coordinator_id, pr.current_stage, pr.is_completed,
  pr.created_at, pr.started_at, pr.completed_at,
  wo.client_name, wo.plant_capacity, wo.total_cost,
  co.full_name as coordinator_name,
  (select count(*) from project_milestones m
     where m.project_id = pr.id and m.status = 'completed') as milestones_done,
  (select count(*) from project_milestones m
     where m.project_id = pr.id) as milestones_total
from projects pr
left join work_orders wo on wo.id = pr.work_order_id
left join profiles co on co.id = pr.coordinator_id;

grant select on work_orders_list, service_tickets_list, projects_list
  to anon, authenticated, service_role;

commit;
