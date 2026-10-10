-- ============================================================================
-- BSS Solar — Service engineers
-- ----------------------------------------------------------------------------
-- A service engineer works the tickets assigned to them and nothing else:
--   - reads only their assigned tickets;
--   - may move a ticket's status to `in_progress` or `completed` — every other
--     column of the service sheet stays the office's (enforced by a trigger that
--     diffs the whole row, so new columns are protected automatically);
--   - gets the customer's site details (name, phone, address, capacity, KSEB
--     ids) through `engineer_tickets()`, a SECURITY DEFINER function that
--     returns exactly those columns. Engineers get NO table access to
--     work_orders / projects, so contract values, payments and coordinator
--     incentives never reach them.
-- A ticket can only be assigned to a service engineer.
-- Idempotent; safe to re-run.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
drop policy if exists ticket_select on public.service_tickets;
create policy ticket_select on public.service_tickets
  for select using (
    is_admin()
    or assigned_to = auth.uid()
    or exists (
      select 1 from public.projects p
      where p.id = service_tickets.project_id and p.coordinator_id = auth.uid()
    )
  );

drop policy if exists ticket_engineer_update on public.service_tickets;
create policy ticket_engineer_update on public.service_tickets
  for update
  using (assigned_to = auth.uid() and is_service_engineer())
  with check (assigned_to = auth.uid() and is_service_engineer());

-- ---------------------------------------------------------------------------
-- Guard
-- ---------------------------------------------------------------------------
create or replace function public.guard_service_ticket()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- (a) Only a service engineer can hold a ticket.
  if new.assigned_to is not null
     and (tg_op = 'INSERT' or new.assigned_to is distinct from old.assigned_to)
     and not exists (
       select 1 from profiles
       where id = new.assigned_to and role = 'service_engineer'
     ) then
    raise exception 'A service ticket can only be assigned to a service engineer'
      using errcode = '23514';
  end if;

  -- (b) Field staff move the status; the rest of the sheet is the office's.
  --     Server-side contexts (auth.uid() IS NULL) and office staff are exempt.
  if tg_op = 'UPDATE' and auth.uid() is not null and not is_admin() then
    if (to_jsonb(new) - array['status', 'updated_at'])
       is distinct from (to_jsonb(old) - array['status', 'updated_at']) then
      raise exception 'Service engineers can only change a ticket''s status'
        using errcode = '42501';
    end if;
    if new.status is distinct from old.status then
      -- A closed ticket stays closed; reopening is an office decision.
      if old.status::text not in ('open', 'scheduled', 'in_progress') then
        raise exception 'Service engineers cannot reopen a completed or cancelled ticket'
          using errcode = '42501';
      end if;
      if new.status::text not in ('in_progress', 'completed') then
        raise exception 'Service engineers can only mark a ticket in progress or completed'
          using errcode = '42501';
      end if;
    end if;
  end if;

  -- (c) Completing a ticket without a service date stamps today (IST). Runs
  --     after (b) so the engineer's own change set is still status-only.
  if new.status = 'completed' and new.service_date is null
     and (tg_op = 'INSERT' or old.status is distinct from 'completed') then
    new.service_date := ist_today();
  end if;

  return new;
end;
$$;

drop trigger if exists t_ticket_guard on public.service_tickets;
create trigger t_ticket_guard
  before insert or update on public.service_tickets
  for each row execute function public.guard_service_ticket();

-- ---------------------------------------------------------------------------
-- An engineer's worklist, with just enough site detail to do the job.
-- Filterable / orderable / paginated by PostgREST like a view.
-- ---------------------------------------------------------------------------
create or replace function public.engineer_tickets()
returns table (
  id uuid,
  ticket_no text,
  ticket_type public.ticket_type,
  status public.ticket_status,
  scheduled_date date,
  service_date date,
  nature_of_complaint text,
  created_at timestamptz,
  project_id uuid,
  client_name text,
  client_phone text,
  address text,
  plant_capacity text,
  consumer_number text,
  kseb_section text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    t.id, t.ticket_no, t.ticket_type, t.status, t.scheduled_date,
    t.service_date, t.nature_of_complaint, t.created_at, t.project_id,
    wo.client_name, wo.client_phone, wo.address, wo.plant_capacity,
    wo.consumer_number, wo.kseb_section
  from service_tickets t
  left join projects p on p.id = t.project_id
  left join work_orders wo on wo.id = p.work_order_id
  where t.assigned_to = auth.uid();
$$;

revoke execute on function public.engineer_tickets() from public, anon;
grant execute on function public.engineer_tickets() to authenticated, service_role;

create index if not exists idx_tickets_assigned_to
  on public.service_tickets (assigned_to)
  where assigned_to is not null;

commit;
