-- ============================================================================
-- BSS Solar - Supabase PostgreSQL Schema
-- Run this in the Supabase SQL editor (or via the Supabase CLI migrations).
-- ============================================================================

-- ============ EXTENSIONS ============
create extension if not exists "uuid-ossp";

-- ============ ENUMS ============
create type user_role as enum ('admin', 'coordinator');
create type work_order_status as enum ('pending', 'approved', 'rejected');
create type milestone_status as enum ('pending', 'in_progress', 'completed');
create type ticket_type as enum ('routine_6m', 'adhoc');
create type ticket_status as enum ('open', 'scheduled', 'in_progress', 'completed', 'cancelled');
create type project_stage as enum (
  'site_feasibility_survey',
  'kseb_portal_registration',
  'kseb_feasibility_clearance',
  'material_dispatch',
  'structure_fabrication',
  'panel_installation',
  'wcr_submitted',
  'kseb_inspection_meter',
  'plant_commissioning'
);

-- ============ PROFILES (extends auth.users) ============
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  phone text,
  role user_role not null default 'coordinator',
  created_at timestamptz not null default now()
);

-- Auto-create profile on new auth user
create or replace function handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, role)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', new.email), 'coordinator');
  return new;
end; $$;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- Helper: is current user an admin?
create or replace function is_admin()
returns boolean language sql security definer stable set search_path = public as $$
  select exists(select 1 from profiles where id = auth.uid() and role = 'admin');
$$;

-- ============ WORK ORDERS ============
create table work_orders (
  id uuid primary key default uuid_generate_v4(),
  coordinator_id uuid not null references profiles(id) on delete restrict,
  client_name text not null,
  client_phone text,
  address text,
  plant_capacity text not null,           -- e.g. '3kW', '5kW'
  advance_amount numeric(12,2) default 0,
  total_cost numeric(12,2) not null default 0,
  order_date date not null default current_date,
  status work_order_status not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_work_orders_coordinator on work_orders(coordinator_id);
create index idx_work_orders_status on work_orders(status);
create index idx_work_orders_order_date on work_orders(order_date);

-- ============ PROJECTS ============
create table projects (
  id uuid primary key default uuid_generate_v4(),
  work_order_id uuid not null unique references work_orders(id) on delete cascade,
  coordinator_id uuid not null references profiles(id) on delete restrict,
  current_stage project_stage not null default 'site_feasibility_survey',
  is_completed boolean not null default false,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_projects_coordinator on projects(coordinator_id);
create index idx_projects_stage on projects(current_stage);

-- ============ PROJECT MILESTONES (Kanban) ============
create table project_milestones (
  id uuid primary key default uuid_generate_v4(),
  project_id uuid not null references projects(id) on delete cascade,
  stage project_stage not null,
  sort_order int not null,
  status milestone_status not null default 'pending',
  notes text,
  completed_at timestamptz,
  unique (project_id, stage)
);
create index idx_milestones_project on project_milestones(project_id);

-- Auto-seed the 9 milestones when a project is created
create or replace function seed_project_milestones()
returns trigger language plpgsql as $$
begin
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
  return new;
end; $$;
create trigger on_project_created
  after insert on projects
  for each row execute function seed_project_milestones();

-- ============ SERVICE TICKETS (BSS Service Sheet) ============
create table service_tickets (
  id uuid primary key default uuid_generate_v4(),
  project_id uuid references projects(id) on delete set null,
  ticket_no text unique,                       -- human-friendly ref for PDF
  ticket_type ticket_type not null default 'routine_6m',
  status ticket_status not null default 'open',
  assigned_to uuid references profiles(id) on delete set null,
  scheduled_date date,
  service_date date,

  -- System Details
  sys_capacity text,
  sys_loading_capacity text,
  sys_make text,
  sys_model text,
  sys_serial_no text,

  -- Battery Details
  bat_capacity_ah text,
  bat_make text,
  bat_model text,
  bat_qty int,
  bat_bank_nos int,

  -- SPV Details
  spv_module_capacity text,
  spv_make text,
  spv_voc text,
  spv_total_nos int,
  spv_total_watts numeric(12,2),
  spv_no_of_strings int,

  -- Post-Service Status (variable arrays as JSONB)
  -- spv_strings: [{ "string": 1, "voltage": "", "ampere": "" }, ... up to 5]
  spv_string_readings jsonb default '[]'::jsonb,
  -- mppt: [{ "mppt": 1, "in_volt":"", "out_volt":"", "in_ampere":"", "out_ampere":"" }, {mppt:2,...}]
  mppt_readings jsonb default '[]'::jsonb,
  battery_voltage text,
  charging_current text,
  battery_water_level text,

  -- Resolution
  nature_of_complaint text,
  defects_found text,
  action_taken text,

  -- Financials
  service_charge numeric(12,2) default 0,
  cost_of_spares numeric(12,2) default 0,
  amc_charge numeric(12,2) default 0,
  total numeric(12,2) default 0,

  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_tickets_project on service_tickets(project_id);
create index idx_tickets_status on service_tickets(status);
create index idx_tickets_type on service_tickets(ticket_type);

-- ============ updated_at AUTO-TOUCH ============
create or replace function touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;
create trigger t_wo_updated before update on work_orders
  for each row execute function touch_updated_at();
create trigger t_proj_updated before update on projects
  for each row execute function touch_updated_at();
create trigger t_ticket_updated before update on service_tickets
  for each row execute function touch_updated_at();

-- ============ ROW LEVEL SECURITY ============
alter table profiles enable row level security;
alter table work_orders enable row level security;
alter table projects enable row level security;
alter table project_milestones enable row level security;
alter table service_tickets enable row level security;

-- PROFILES: user reads own; admin reads all; user updates own (never role — see guard_profile_role)
create policy profiles_select_self on profiles for select using (id = auth.uid() or is_admin());
create policy profiles_update_self on profiles for update using (id = auth.uid()) with check (id = auth.uid());
create policy profiles_admin_all on profiles for all using (is_admin());

-- WORK ORDERS: coordinator owns; admin all
create policy wo_select on work_orders for select
  using (is_admin() or coordinator_id = auth.uid());
create policy wo_insert on work_orders for insert
  with check (coordinator_id = auth.uid() or is_admin());
create policy wo_update on work_orders for update
  using (is_admin() or coordinator_id = auth.uid())
  with check (is_admin() or coordinator_id = auth.uid());
create policy wo_delete on work_orders for delete using (is_admin());

-- PROJECTS: coordinator sees own; admin all (only admin creates via approval)
create policy proj_select on projects for select
  using (is_admin() or coordinator_id = auth.uid());
create policy proj_admin_write on projects for all using (is_admin());

-- MILESTONES: visible to project owner + admin; admin writes
create policy ms_select on project_milestones for select using (
  is_admin() or exists (
    select 1 from projects p where p.id = project_milestones.project_id
    and p.coordinator_id = auth.uid()
  )
);
create policy ms_admin_write on project_milestones for all using (is_admin());

-- SERVICE TICKETS: admin all; coordinator reads tickets on own projects
create policy ticket_select on service_tickets for select using (
  is_admin() or exists (
    select 1 from projects p where p.id = service_tickets.project_id
    and p.coordinator_id = auth.uid()
  )
);
create policy ticket_admin_write on service_tickets for all using (is_admin());

-- ============ SECURITY & DATA-INTEGRITY GUARDS ============
-- Guards allow server-side contexts (service-role key / superuser: auth.uid()
-- is NULL) and admins; only a logged-in NON-admin is restricted.

-- Only an admin may change a profile's role (blocks privilege escalation).
create or replace function guard_profile_role()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.role is distinct from old.role
     and auth.uid() is not null and not is_admin() then
    raise exception 'Only an administrator can change a user role' using errcode = '42501';
  end if;
  return new;
end; $$;
create trigger t_profiles_guard_role before update on profiles
  for each row execute function guard_profile_role();

-- Only an admin may change work order status / reassign ownership.
create or replace function guard_work_order_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not is_admin() then
    if new.status is distinct from old.status then
      raise exception 'Only an administrator can change a work order status' using errcode = '42501';
    end if;
    if new.coordinator_id is distinct from old.coordinator_id then
      raise exception 'Only an administrator can reassign a work order' using errcode = '42501';
    end if;
  end if;
  return new;
end; $$;
create trigger t_wo_guard before update on work_orders
  for each row execute function guard_work_order_update();

-- Atomically create the project when a work order is approved (un-bypassable).
create or replace function create_project_on_approval()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'approved' and old.status is distinct from 'approved' then
    insert into projects (work_order_id, coordinator_id)
    values (new.id, new.coordinator_id)
    on conflict (work_order_id) do nothing;
  end if;
  return new;
end; $$;
create trigger t_wo_create_project after update on work_orders
  for each row execute function create_project_on_approval();

-- ============ API ROLE GRANTS ============
-- PostgREST roles need table privileges IN ADDITION to RLS (the real gate for
-- anon/authenticated; service_role bypasses RLS). Idempotent.
grant usage on schema public to anon, authenticated, service_role;
grant select, insert, update, delete on all tables in schema public
  to anon, authenticated, service_role;
grant usage, select on all sequences in schema public
  to anon, authenticated, service_role;
grant execute on all functions in schema public
  to anon, authenticated, service_role;
alter default privileges in schema public
  grant select, insert, update, delete on tables to anon, authenticated, service_role;
alter default privileges in schema public
  grant usage, select on sequences to anon, authenticated, service_role;
alter default privileges in schema public
  grant execute on functions to anon, authenticated, service_role;

-- ============ DASHBOARD AGGREGATES (scalability) ============
-- Single aggregate query for the dashboard KPIs (SECURITY INVOKER: respects
-- the caller's RLS). Avoids loading every row to count in the app.
create or replace function dashboard_metrics()
returns table (
  total_work_orders bigint,
  pending_approvals bigint,
  active_projects bigint,
  commissioned bigint,
  open_tickets bigint,
  approved_pipeline numeric
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
    )::numeric;
$$;
grant execute on function dashboard_metrics() to anon, authenticated, service_role;

create index if not exists idx_projects_created_at on projects (created_at desc);
create index if not exists idx_tickets_created_at on service_tickets (created_at desc);
create index if not exists idx_work_orders_created_at on work_orders (created_at desc);
create index if not exists idx_profiles_full_name on profiles (full_name);
