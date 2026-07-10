-- ============================================================================
-- BSS Solar — Dashboard aggregates + indexes (scalability)
-- ----------------------------------------------------------------------------
-- Replaces the dashboard's "load every row and count in JS" with a single
-- aggregate query, and adds indexes for the columns list queries sort on.
-- The function is SECURITY INVOKER so its counts respect the caller's RLS
-- (an admin sees org-wide totals; a coordinator would see only their own).
-- ============================================================================

begin;

create or replace function public.dashboard_metrics()
returns table (
  total_work_orders bigint,
  pending_approvals bigint,
  active_projects bigint,
  commissioned bigint,
  open_tickets bigint,
  approved_pipeline numeric
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
    )::numeric;
$$;

grant execute on function public.dashboard_metrics()
  to anon, authenticated, service_role;

-- Indexes for the ORDER BY columns used by list queries.
create index if not exists idx_projects_created_at on projects (created_at desc);
create index if not exists idx_tickets_created_at on service_tickets (created_at desc);
create index if not exists idx_work_orders_created_at on work_orders (created_at desc);
create index if not exists idx_profiles_full_name on profiles (full_name);

commit;
