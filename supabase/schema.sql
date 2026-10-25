-- ============================================================================
-- BSS Solar - Supabase PostgreSQL Schema (fresh provisioning)
-- ----------------------------------------------------------------------------
-- The FINAL state of every file in supabase/migrations, as one script for a
-- BRAND-NEW Supabase project: paste it into the SQL editor once, then run
-- production-bootstrap.sql after creating the Auth users. It is deliberately
-- not idempotent and carries no data backfills — an existing database is
-- upgraded by the migrations (CI applies them), never by this file.
--
-- Keep it in lock-step with the migrations: mirror every new migration here,
-- then run `node supabase/scripts/check-schema-sync.mjs`, which proves the two
-- produce the same public schema. Function bodies are copied verbatim from the
-- latest migration that defines them (Postgres stores bodies as written, so
-- that is what keeps the check exact).
-- ============================================================================

-- ============ EXTENSIONS ============
create extension if not exists "uuid-ossp";

-- ============ ENUMS ============
-- 'superadmin' is a single privileged account that owns destructive actions
-- (deleting users, projects, work orders and payments); 'admin' keeps
-- everything else. A 'service_engineer' works only the service tickets
-- assigned to them.
create type user_role as enum ('admin', 'coordinator', 'superadmin', 'service_engineer');
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
-- How the customer pays for the plant: self-financed or a bank loan.
create type financing_type as enum ('self', 'loan');
create type payment_method as enum (
  'cash', 'upi', 'bank_transfer', 'cheque', 'loan_disbursement', 'other'
);
-- `kseb_fees` records KSEB charges collected through BSS without inflating the
-- contract receivable.
create type payment_purpose as enum ('contract', 'kseb_fees');
-- A sale is a kW solar plant or a custom plan (e.g. "1 panel", "Inverter +
-- panel"): a custom plan's details live in work_orders.plant_capacity, it has no
-- kW, no KSEB feasibility and a single Handover milestone.
create type plan_type as enum ('solar', 'custom');
-- Why a project left the pipeline (projects.cancellation is NULL while live).
create type project_cancellation as enum ('cancelled', 'refunded');

-- ============ API ROLE GRANTS ============
-- PostgREST connects as anon / authenticated / service_role. They need object
-- privileges IN ADDITION to RLS (the real gate for anon/authenticated;
-- service_role bypasses RLS). Supabase projects ship these defaults already;
-- stating them makes the script self-sufficient. They are DEFAULT privileges
-- and come first on purpose: every object below inherits them, so the narrower
-- grants/revokes written next to the inbox, push and RPC objects stick.
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public
  grant select, insert, update, delete on tables to anon, authenticated, service_role;
alter default privileges in schema public
  grant usage, select on sequences to anon, authenticated, service_role;
alter default privileges in schema public
  grant execute on functions to anon, authenticated, service_role;

-- ============ PROFILES (extends auth.users) ============
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  phone text,
  role user_role not null default 'coordinator',
  created_at timestamptz not null default now()
);
create index idx_profiles_full_name on profiles (full_name);

-- There is exactly one SuperAdmin. Every row in the partial set shares the same
-- `role`, so a unique index over it caps the set at a single member. Compares
-- the enum directly — an enum->text cast is only STABLE, which a predicate rejects.
create unique index uniq_profiles_single_superadmin
  on profiles (role) where role = 'superadmin';

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

-- ============ ROLE HELPERS ============
-- SECURITY DEFINER so policies can call them without recursing through the RLS
-- on profiles.

-- Is the caller office staff or above? (admin OR superadmin)
create or replace function is_admin()
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from profiles
    where id = auth.uid() and role::text in ('admin', 'superadmin')
  );
$$;

-- Is the caller THE SuperAdmin? (gates every delete)
create or replace function is_superadmin()
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from profiles
    where id = auth.uid() and role::text = 'superadmin'
  );
$$;

create or replace function current_user_role()
returns user_role language sql security definer stable set search_path = public as $$
  select role from profiles where id = auth.uid();
$$;

create or replace function is_service_engineer()
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from profiles
    where id = auth.uid() and role = 'service_engineer'
  );
$$;

-- ============ CALENDAR, CAPACITY & KSEB HELPERS ============
-- Mirrored in lib/domain/{capacity,kseb}.ts — change both together.

-- "Today" in India. The database runs in UTC, so a bare current_date would be
-- yesterday for the first 5½ hours of every IST day.
create or replace function ist_today()
returns date language sql stable set search_path = public as $$
  select (now() at time zone 'Asia/Kolkata')::date;
$$;

-- Numeric capacity from the free-text label: the first number; a W / Wp unit
-- means watts (÷1000); kW, kWp, k or no unit means kilowatts; thousands
-- separators ignored; NULL when the label holds no number. IMMUTABLE because it
-- backs the generated work_orders.plant_capacity_kw — if it ever changes,
-- re-stamp that column (stored values do not recompute on their own).
create or replace function parse_capacity_kw(p_label text)
returns numeric language plpgsql immutable parallel safe as $$
declare
  m text[];
  n numeric;
begin
  if p_label is null then
    return null;
  end if;

  m := regexp_match(
    replace(lower(p_label), ',', ''),
    '([0-9]+(?:\.[0-9]+)?)\s*(kwp|kw|k|wp|w)?'
  );
  if m is null then
    return null;
  end if;

  n := m[1]::numeric;
  if m[2] in ('w', 'wp') then
    n := n / 1000;
  end if;
  return round(n, 2);
end;
$$;

-- KSEB feasibility is valid for 30 days. The customer pays the first ₹1,000;
-- every further 30-day period until commissioning costs BSS another ₹1,000.
--   periods  = max(1, ceil(max(as_of − started, 0) / 30))
--   renewals = periods − 1
create or replace function feasibility_validity_days()
returns integer language sql immutable as $$
  select 30;
$$;

create or replace function feasibility_renewal_fee()
returns numeric language sql immutable as $$
  select 1000::numeric;
$$;

create or replace function feasibility_periods(p_started date, p_as_of date)
returns integer language sql immutable as $$
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

-- ============ WORK ORDERS ============
create table work_orders (
  id uuid primary key default uuid_generate_v4(),
  -- The FIRST coordinator (work_order_coordinators, sort_order 1), kept by
  -- trigger: the rest of the team lives in work_order_coordinators.
  coordinator_id uuid not null references profiles(id) on delete restrict,
  client_name text not null,
  client_phone text,
  address text,
  -- A solar plant's capacity ('3kW', '5kW'), or what a custom plan sold.
  plant_capacity text not null,
  plan_type plan_type not null default 'solar',
  -- KSEB registration is priced per kW; derived from the label so the two can
  -- never drift. NULL for a custom plan: nothing may price it per kW.
  plant_capacity_kw numeric(10,2)
    generated always as (
      case when plan_type = 'solar'::plan_type
           then parse_capacity_kw(plant_capacity) end
    ) stored,
  advance_amount numeric(12,2) default 0, -- the booking advance (first money in)
  total_cost numeric(12,2) not null default 0,
  order_date date not null default current_date,
  status work_order_status not null default 'pending',

  -- Office/field details captured after the sale
  consumer_number text,                   -- KSEB consumer number
  notes text,
  kseb_section text,                      -- KSEB section office
  financing_type financing_type not null default 'self',
  loan_bank_name text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_work_orders_coordinator on work_orders(coordinator_id);
create index idx_work_orders_status on work_orders(status);
create index idx_work_orders_order_date on work_orders(order_date);
create index idx_work_orders_consumer_number on work_orders(consumer_number);
create index idx_work_orders_created_at on work_orders (created_at desc);

-- ============ PROJECTS ============
create table projects (
  id uuid primary key default uuid_generate_v4(),
  work_order_id uuid not null unique references work_orders(id) on delete cascade,
  -- DEPRECATED copy of the work order's first coordinator (forced equal by
  -- trigger; dropped in the contract release).
  coordinator_id uuid not null references profiles(id) on delete restrict,
  current_stage project_stage not null default 'site_feasibility_survey',
  is_completed boolean not null default false,
  started_at timestamptz not null default now(),
  completed_at timestamptz,               -- commissioning; stops the feasibility clock

  -- KSEB feasibility clock start (see feasibility_periods above)
  feasibility_date date,

  -- DEPRECATED (dropped in the contract release): the single per-project
  -- incentive of the previous build. Incentives now live per person in
  -- coordinator_incentives; a TEMPORARY trigger carries legacy writes over.
  coordinator_incentive numeric(12,2)
    constraint projects_incentive_non_negative
    check (coordinator_incentive is null or coordinator_incentive >= 0),
  incentive_paid_on date,

  -- Cancelled / refunded (office only, by RLS; reversible). NULL = live.
  cancellation project_cancellation,
  cancelled_on date,                      -- IST date; stops the feasibility clock
  cancelled_by uuid references profiles(id) on delete set null,
  cancellation_remarks text,              -- kept after reinstating

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- A paid date without an amount is meaningless.
  constraint projects_incentive_paid_needs_amount
    check (incentive_paid_on is null or coordinator_incentive is not null),
  constraint projects_cancelled_on_needs_cancellation
    check (cancelled_on is null or cancellation is not null),
  -- A cancelled project with a running clock must say when it stopped.
  constraint projects_cancellation_stops_clock
    check (cancellation is null or cancelled_on is not null or feasibility_date is null),
  constraint projects_cancellation_remarks_length
    check (cancellation_remarks is null or char_length(cancellation_remarks) <= 2000)
);
create index idx_projects_coordinator on projects(coordinator_id);
create index idx_projects_stage on projects(current_stage);
create index idx_projects_created_at on projects (created_at desc);
create index idx_projects_feasibility_date
  on projects (feasibility_date)
  where feasibility_date is not null;
create index idx_projects_cancellation
  on projects (cancellation) where cancellation is not null;

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

-- Auto-seed the project's milestones when it is created: the nine KSEB stages of
-- a solar plant, or the single Handover step of a custom plan. Mirrored by
-- stagesFor() in lib/domain/plan.ts.
create or replace function seed_project_milestones()
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
create trigger on_project_created
  after insert on projects
  for each row execute function seed_project_milestones();

-- ============ SHARED COORDINATORS (sale team + private incentives) ============
-- work_order_coordinators is the single source of truth for who shares a sale;
-- a project's coordinators are its work order's. work_orders.coordinator_id is
-- the FIRST coordinator (lowest sort_order), kept by trigger.
-- Each person's incentive lives in coordinator_incentives (one row per
-- membership, opened and closed by trigger; the office edits amount and paid
-- date only) and is private: office all, a coordinator their own row.

-- Most people who can share one sale (a typo guard). Mirrored as
-- MAX_SALE_COORDINATORS in lib/domain/coordinators.ts; a test pins the two.
create or replace function max_sale_coordinators()
returns integer language sql immutable as $$
  select 5;
$$;

create table work_order_coordinators (
  work_order_id  uuid not null references work_orders(id) on delete cascade,
  coordinator_id uuid not null references profiles(id) on delete restrict,
  -- Display order ("Ravi + Abhijith"); the lowest is the first coordinator,
  -- mirrored to work_orders.coordinator_id.
  sort_order smallint not null
    constraint work_order_coordinators_sort_order_positive check (sort_order >= 1),
  added_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (work_order_id, coordinator_id)
);
create index idx_woc_coordinator
  on work_order_coordinators (coordinator_id, work_order_id);

-- One row per membership (opened by trigger, removed with it). NO direct FK to
-- work_orders or profiles on purpose: either would make this table a PostgREST
-- junction and the existing embeds ambiguous.
create table coordinator_incentives (
  work_order_id  uuid not null,
  coordinator_id uuid not null,
  amount numeric(12,2)
    constraint coordinator_incentives_amount_non_negative check (amount is null or amount >= 0),
  paid_on date,
  updated_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (work_order_id, coordinator_id),
  constraint coordinator_incentives_member_fkey
    foreign key (work_order_id, coordinator_id)
    references work_order_coordinators (work_order_id, coordinator_id)
    on delete cascade,
  constraint coordinator_incentives_paid_needs_amount
    check (paid_on is null or amount is not null)
);
create index idx_coordinator_incentives_coordinator
  on coordinator_incentives (coordinator_id)
  where amount is not null;

-- Writes only through SECURITY DEFINER code (triggers, set_work_order_coordinators,
-- import_projects). The office edits an incentive's amount and paid date only.
revoke insert, update, delete on work_order_coordinators from anon, authenticated;
revoke insert, update, delete on coordinator_incentives from anon, authenticated;
grant select on work_order_coordinators, coordinator_incentives to authenticated;
grant update (amount, paid_on) on coordinator_incentives to authenticated;
grant select, insert, update, delete
  on work_order_coordinators, coordinator_incentives to service_role;

-- Membership helpers. SECURITY DEFINER: they read work_order_coordinators
-- without its RLS, so policies call them without recursing. Set-returning, so
-- a policy uses them as `x in (select f())` — one hashed subplan per statement.
-- Default EXECUTE (like is_admin()): policies are evaluated for anon too, where
-- they return nothing.
create or replace function my_work_order_ids()
returns setof uuid language sql stable security definer set search_path = public as $$
  select work_order_id from work_order_coordinators where coordinator_id = auth.uid();
$$;

create or replace function my_project_ids()
returns setof uuid language sql stable security definer set search_path = public as $$
  select p.id
  from projects p
  join work_order_coordinators c on c.work_order_id = p.work_order_id
  where c.coordinator_id = auth.uid();
$$;

-- People the caller shares at least one sale with (not the caller).
create or replace function my_partner_ids()
returns setof uuid language sql stable security definer set search_path = public as $$
  select distinct theirs.coordinator_id
  from work_order_coordinators mine
  join work_order_coordinators theirs on theirs.work_order_id = mine.work_order_id
  where mine.coordinator_id = auth.uid()
    and theirs.coordinator_id <> auth.uid();
$$;

-- The first coordinator of a work order (internal: triggers and RPCs).
create or replace function first_coordinator(p_work_order_id uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select coordinator_id
  from work_order_coordinators
  where work_order_id = p_work_order_id
  order by sort_order, created_at, coordinator_id
  limit 1;
$$;
revoke execute on function first_coordinator(uuid) from public, anon, authenticated;
grant execute on function first_coordinator(uuid) to service_role;

-- ============ SERVICE TICKETS (BSS Service Sheet) ============
create table service_tickets (
  id uuid primary key default uuid_generate_v4(),
  project_id uuid references projects(id) on delete set null,
  ticket_no text unique,                       -- human-friendly ref for PDF
  ticket_type ticket_type not null default 'routine_6m',
  status ticket_status not null default 'open',
  assigned_to uuid references profiles(id) on delete set null, -- a service engineer
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
create index idx_tickets_created_at on service_tickets (created_at desc);
create index idx_tickets_assigned_to
  on service_tickets (assigned_to)
  where assigned_to is not null;

-- ============ PAYMENTS LEDGER ============
-- Every collection after the booking advance, in any number of stages, keyed to
-- the work order (the money's natural anchor: it exists before approval and
-- survives a project being rebuilt).
--   contract received = work_orders.advance_amount + Σ payments (purpose = contract)
create table payments (
  id uuid primary key default gen_random_uuid(),
  work_order_id uuid not null references work_orders(id) on delete cascade,
  amount numeric(12,2) not null
    constraint payments_amount_positive check (amount > 0),
  paid_on date not null,
  method payment_method not null default 'bank_transfer',
  purpose payment_purpose not null default 'contract',
  reference text,
  notes text,
  recorded_by uuid references profiles(id) on delete set null,
  -- Which of the old fixed work-order slots (1 = first, 2 = second payment,
  -- dropped 2026-10) this row was carried over from; NULL for every payment
  -- recorded in the ledger itself.
  legacy_slot smallint
    constraint payments_legacy_slot_valid check (legacy_slot in (1, 2)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_payments_work_order on payments (work_order_id, paid_on);
create unique index uniq_payments_legacy_slot
  on payments (work_order_id, legacy_slot)
  where legacy_slot is not null;

-- ============ NOTIFICATIONS (in-app inbox) ============
-- Rows are written ONLY by trusted server code (service role, through
-- insert_notifications()): there is no INSERT/UPDATE policy or grant, so a
-- signed-in user cannot forge a notification for anyone, themselves included.
-- A user reads and clears their own inbox and marks it read through
-- mark_notifications_read().
create table notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references profiles(id) on delete cascade,
  type text not null,
  title text not null,
  body text,
  link text,
  dedupe_key text,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  -- In-app paths only. Browsers treat "//host", "/\host" and paths carrying
  -- control characters ("/\t/host") as off-site, so the second character may be
  -- neither "/" nor "\" and no control character may appear anywhere.
  constraint notifications_link_internal
    check (link is null or (link ~ '^/([^/\\]|$)' and link !~ '[[:cntrl:]]')),
  constraint notifications_title_present check (length(btrim(title)) > 0)
);
create index idx_notifications_recipient_created
  on notifications (recipient_id, created_at desc);
create index idx_notifications_unread
  on notifications (recipient_id)
  where read_at is null;
-- One row per keyed alert in an inbox. NULL keys never collide, and the index
-- is the ON CONFLICT arbiter of insert_notifications().
create unique index uniq_notifications_dedupe
  on notifications (recipient_id, dedupe_key);

revoke insert, update on notifications from anon, authenticated;
grant select, delete on notifications to authenticated;
grant select, insert, update, delete on notifications to service_role;

-- Which keyed alerts (dedupe_key) each user has been sent, so the daily cron
-- may run every day without notifying twice. Kept apart from the inbox, which
-- the user may clear: a key a user could delete is a key the cron would send
-- again. Service role only — RLS on with no policy, no grant to users.
create table notification_dedupe (
  recipient_id uuid not null references profiles(id) on delete cascade,
  dedupe_key text not null,
  created_at timestamptz not null default now(),
  primary key (recipient_id, dedupe_key)
);

revoke all on notification_dedupe from anon, authenticated;
grant select, insert, update, delete on notification_dedupe to service_role;

-- ============ WEB PUSH SUBSCRIPTIONS ============
-- One row per browser endpoint. A device follows whoever signed in on it last
-- (shared phones are common in the field); writes go through the RPCs below,
-- which accept only real push-service endpoints, at most 10 per user.
create table push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  constraint push_endpoint_https check (endpoint like 'https://%'),
  constraint push_endpoint_length check (length(endpoint) <= 2048)
);
create index idx_push_subscriptions_user on push_subscriptions (user_id);

revoke insert, update on push_subscriptions from anon, authenticated;
grant select, delete on push_subscriptions to authenticated;
grant select, insert, update, delete on push_subscriptions to service_role;

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
create trigger t_payment_updated before update on payments
  for each row execute function touch_updated_at();

-- ============ ROW LEVEL SECURITY ============
alter table profiles enable row level security;
alter table work_orders enable row level security;
alter table projects enable row level security;
alter table project_milestones enable row level security;
alter table service_tickets enable row level security;
alter table payments enable row level security;
alter table notifications enable row level security;
alter table notification_dedupe enable row level security;
alter table push_subscriptions enable row level security;
alter table work_order_coordinators enable row level security;
alter table coordinator_incentives enable row level security;

-- PROFILES: user reads own; admin reads all; user updates own (never role — see
-- guard_profile_role). DELETE is SuperAdmin-only.
create policy profiles_select_self on profiles for select using (id = auth.uid() or is_admin());
create policy profiles_update_self on profiles for update using (id = auth.uid()) with check (id = auth.uid());
create policy profiles_admin_insert on profiles for insert with check (is_admin());
create policy profiles_admin_update on profiles for update using (is_admin()) with check (is_admin());
create policy profiles_superadmin_delete on profiles for delete using (is_superadmin());
-- Partners (people who share a sale) see each other's profile row — name, role,
-- phone, created_at — nobody else's.
create policy profiles_select_partners on profiles for select using (
  id in (select my_partner_ids())
);

-- WORK ORDERS: every coordinator of the sale (work_order_coordinators) reads and
-- edits it; admin all. Only a coordinator logs business for themselves, and only
-- as 'pending' (the office approves it); office staff may log it on anyone's
-- behalf; a service engineer cannot create one at all.
create policy wo_select on work_orders for select using (
  (select is_admin())
  -- Row-intrinsic on purpose: INSERT … RETURNING checks this policy before the
  -- AFTER INSERT trigger has added the creator's membership row.
  or coordinator_id = (select auth.uid())
  or id in (select my_work_order_ids())
);
create policy wo_insert on work_orders for insert
  with check (
    is_admin()
    or (
      coordinator_id = auth.uid()
      and current_user_role() = 'coordinator'
      and status = 'pending'
    )
  );
create policy wo_update on work_orders for update
  using ((select is_admin()) or id in (select my_work_order_ids()))
  with check ((select is_admin()) or id in (select my_work_order_ids()));
create policy wo_delete on work_orders for delete using (is_superadmin());

-- PROJECTS: every coordinator of the sale reads them (their own incentive lives
-- in coordinator_incentives, read-only); admin writes (only admin creates via
-- approval); DELETE is SuperAdmin-only.
create policy proj_select on projects for select using (
  (select is_admin()) or work_order_id in (select my_work_order_ids())
);
create policy proj_admin_insert on projects for insert with check (is_admin());
create policy proj_admin_update on projects for update
  using (is_admin()) with check (is_admin());
create policy proj_superadmin_delete on projects for delete using (is_superadmin());

-- MILESTONES: visible to the project's coordinators + admin; admin writes
create policy ms_select on project_milestones for select using (
  (select is_admin()) or project_id in (select my_project_ids())
);
create policy ms_admin_write on project_milestones for all using (is_admin());

-- SERVICE TICKETS: admin all; the assigned engineer reads theirs and may move
-- its status (guard_service_ticket limits WHAT they change); a coordinator
-- reads tickets on their projects (every coordinator of the sale).
create policy ticket_select on service_tickets for select using (
  (select is_admin())
  or assigned_to = (select auth.uid())
  or project_id in (select my_project_ids())
);
create policy ticket_admin_write on service_tickets for all using (is_admin());
create policy ticket_engineer_update on service_tickets for update
  using (assigned_to = auth.uid() and is_service_engineer())
  with check (assigned_to = auth.uid() and is_service_engineer());

-- PAYMENTS: the office records and corrects; only the SuperAdmin deletes; a
-- coordinator reads the payments on their work orders (every coordinator of the
-- sale).
create policy payment_select on payments for select using (
  (select is_admin()) or work_order_id in (select my_work_order_ids())
);
create policy payment_admin_insert on payments for insert with check (is_admin());
create policy payment_admin_update on payments for update
  using (is_admin()) with check (is_admin());
create policy payment_superadmin_delete on payments for delete using (is_superadmin());

-- SALE TEAMS AND INCENTIVES: a sale's team is visible to its members; an
-- incentive only to the office and the person it belongs to (RLS cannot hide
-- columns, which is why it is a table of its own). No INSERT/DELETE policy and
-- no grant: rows come and go with the membership, by trigger. The office may
-- UPDATE amount and paid_on (column grant).
create policy woc_select on work_order_coordinators for select using (
  (select is_admin()) or work_order_id in (select my_work_order_ids())
);
create policy ci_select on coordinator_incentives for select using (
  (select is_admin()) or coordinator_id = (select auth.uid())
);
create policy ci_admin_update on coordinator_incentives for update
  using ((select is_admin())) with check ((select is_admin()));

-- NOTIFICATIONS / PUSH: own rows only; no INSERT/UPDATE policies (see above).
create policy notification_select_own on notifications for select
  using (recipient_id = auth.uid());
create policy notification_delete_own on notifications for delete
  using (recipient_id = auth.uid());
create policy push_select_own on push_subscriptions for select
  using (user_id = auth.uid());
create policy push_delete_own on push_subscriptions for delete
  using (user_id = auth.uid());

-- ============ SECURITY & DATA-INTEGRITY GUARDS ============
-- Guards allow server-side contexts (service-role key / superuser: auth.uid()
-- is NULL) and admins; only a logged-in NON-admin is restricted.

-- Only an admin may change a profile's role (blocks privilege escalation), and
-- the SuperAdmin role is IMMUTABLE from the application: no signed-in user — not
-- an admin, not even the SuperAdmin themselves — can grant or revoke it. Only a
-- server-side context (service-role / migration superuser, auth.uid() IS NULL)
-- can, which is the deliberate provisioning path (production-bootstrap.sql).
-- Two integrity rules apply in EVERY context, the service role included: a
-- coordinator who owns or shares work orders never becomes a service engineer,
-- and an engineer hands over open tickets before changing role.
create or replace function guard_profile_role()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.role is distinct from old.role and auth.uid() is not null then
    if not public.is_admin() then
      raise exception 'Only an administrator can change a user role'
        using errcode = '42501';
    end if;

    if new.role::text = 'superadmin' or old.role::text = 'superadmin' then
      raise exception 'The SuperAdmin role cannot be granted or revoked from the application'
        using errcode = '42501';
    end if;
  end if;

  if new.role is distinct from old.role then
    if new.role::text = 'service_engineer' and (
         exists (select 1 from work_order_coordinators where coordinator_id = new.id)
      or exists (select 1 from work_orders where coordinator_id = new.id)
      or exists (select 1 from projects where coordinator_id = new.id)
    ) then
      raise exception 'This member still owns or shares work orders or projects — take them off those sales before making them a service engineer'
        using errcode = '23514';
    end if;
    if old.role::text = 'service_engineer' and exists (
      select 1 from service_tickets
      where assigned_to = new.id
        and status::text in ('open', 'scheduled', 'in_progress')
    ) then
      raise exception 'This engineer still holds open service tickets — reassign them before changing the role'
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;
create trigger t_profiles_guard_role before update on profiles
  for each row execute function guard_profile_role();

-- Office decisions on a work order. A signed-in non-admin may create one only
-- as 'pending' (an order inserted as 'approved' would skip approval and never
-- get its project — t_wo_create_project fires on UPDATE only), may never change
-- its status or owner, and may not change its advance or total cost once it has
-- left 'pending' (both feed the money received and the balance). In EVERY
-- context the plan is fixed once the work order has a project.
create or replace function guard_work_order_update()
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
create trigger t_wo_guard before insert or update on work_orders
  for each row execute function guard_work_order_update();

-- A work order belongs to a coordinator or office staff, never to a service
-- engineer; and coordinator_id only ever equals the first member of its team
-- (the role check stays first: tests expect 23514 for an engineer).
create or replace function guard_work_order_owner()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' or new.coordinator_id is distinct from old.coordinator_id then
    if not exists (
      select 1 from profiles
      where id = new.coordinator_id
        and role::text in ('coordinator', 'admin', 'superadmin')
    ) then
      raise exception 'A work order can only be owned by a coordinator or office staff'
        using errcode = '23514';
    end if;
  end if;
  if tg_op = 'UPDATE'
     and new.coordinator_id is distinct from old.coordinator_id
     and new.coordinator_id is distinct from first_coordinator(new.id) then
    raise exception 'Change who shares a work order with set_work_order_coordinators()'
      using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger t_wo_guard_owner
  before insert or update of coordinator_id on work_orders
  for each row execute function guard_work_order_owner();

-- Atomically create the project when a work order is approved (un-bypassable).
create or replace function create_project_on_approval()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'approved' and old.status is distinct from 'approved' then
    insert into public.projects (work_order_id, coordinator_id)
    values (new.id, new.coordinator_id)
    on conflict (work_order_id) do nothing;
  end if;
  return new;
end;
$$;
create trigger t_wo_create_project after update on work_orders
  for each row execute function create_project_on_approval();

-- ---- Sale teams: membership, first coordinator, projects in step ----------
-- Every context: a sale belongs to coordinators or office staff, never an
-- engineer; a membership row is added or removed, never re-pointed.
create or replace function guard_work_order_coordinator()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and (new.work_order_id is distinct from old.work_order_id
                           or new.coordinator_id is distinct from old.coordinator_id) then
    raise exception 'Add or remove a coordinator instead of changing one'
      using errcode = '23514';
  end if;
  if tg_op = 'INSERT' and not exists (
    select 1 from profiles
    where id = new.coordinator_id and role::text in ('coordinator', 'admin', 'superadmin')
  ) then
    raise exception 'A work order can only be owned by a coordinator or office staff'
      using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger t_woc_guard
  before insert or update on work_order_coordinators
  for each row execute function guard_work_order_coordinator();

create or replace function open_coordinator_incentive()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into coordinator_incentives (work_order_id, coordinator_id)
  values (new.work_order_id, new.coordinator_id)
  on conflict do nothing;
  return null;
end;
$$;
create trigger t_woc_open_incentive
  after insert on work_order_coordinators
  for each row execute function open_coordinator_incentive();

-- Stamps only a real change of the money: the FK's ON DELETE SET NULL of
-- updated_by (a profile deleted) must not re-attribute the row.
create or replace function touch_coordinator_incentive()
returns trigger language plpgsql as $$
begin
  if (new.amount, new.paid_on) is distinct from (old.amount, old.paid_on) then
    new.updated_at := now();
    new.updated_by := auth.uid();
  end if;
  return new;
end;
$$;
create trigger t_ci_touch
  before update on coordinator_incentives
  for each row execute function touch_coordinator_incentive();

-- Every new work order starts with its coordinator as first member (the app,
-- the import and fixtures alike).
create or replace function seed_work_order_coordinator()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into work_order_coordinators (work_order_id, coordinator_id, sort_order, added_by, created_at)
  values (new.id, new.coordinator_id, 1, auth.uid(), new.created_at)
  on conflict do nothing;
  return null;
end;
$$;
create trigger t_wo_seed_coordinator
  after insert on work_orders
  for each row execute function seed_work_order_coordinator();

create or replace function sync_work_order_first_coordinator()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_wo uuid := case tg_op when 'DELETE' then old.work_order_id else new.work_order_id end;
  v_first uuid := first_coordinator(v_wo);
begin
  -- No member left: the work order is being deleted (cascade) or emptied; the
  -- deferred t_woc_require_one decides.
  if v_first is not null then
    update work_orders set coordinator_id = v_first
     where id = v_wo and coordinator_id is distinct from v_first;
  end if;
  return null;
end;
$$;
create trigger t_woc_sync_first
  after insert or delete or update of sort_order on work_order_coordinators
  for each row execute function sync_work_order_first_coordinator();

-- At commit: a work order that still exists keeps at least one coordinator.
create or replace function require_work_order_coordinator()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from work_orders where id = old.work_order_id)
     and not exists (select 1 from work_order_coordinators where work_order_id = old.work_order_id) then
    raise exception 'A work order needs at least one coordinator' using errcode = '23514';
  end if;
  return null;
end;
$$;
create constraint trigger t_woc_require_one
  after delete on work_order_coordinators
  deferrable initially deferred
  for each row execute function require_work_order_coordinator();

-- DEPRECATED copy on projects follows the work order.
create or replace function sync_project_coordinator()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update projects set coordinator_id = new.coordinator_id
   where work_order_id = new.id and coordinator_id is distinct from new.coordinator_id;
  return null;
end;
$$;
create trigger t_wo_sync_project_coordinator
  after update of coordinator_id on work_orders
  for each row when (old.coordinator_id is distinct from new.coordinator_id)
  execute function sync_project_coordinator();

-- A project's coordinator is its work order's: set on insert whatever the
-- caller sent; refused when changed directly.
create or replace function derive_project_coordinator()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_coordinator uuid;
begin
  select coordinator_id into v_coordinator from work_orders where id = new.work_order_id;
  if tg_op = 'INSERT' then
    new.coordinator_id := coalesce(v_coordinator, new.coordinator_id);
  elsif new.coordinator_id is distinct from v_coordinator then
    raise exception 'A project''s coordinators are its work order''s — change them on the work order'
      using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger t_proj_coordinator
  before insert or update of coordinator_id, work_order_id on projects
  for each row execute function derive_project_coordinator();

-- TEMPORARY — drop in the contract release together with
-- projects.coordinator_incentive / incentive_paid_on. The build deployed before
-- the shared-coordinators release writes a project's incentive there; carry it
-- to the first coordinator's own row. One-way: the new build never writes those
-- columns. set_work_order_coordinators clears them with the transaction-local
-- switch bss.skip_legacy_mirror = 'on', which must not wipe the incentive rows.
create or replace function mirror_legacy_project_incentive()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if current_setting('bss.skip_legacy_mirror', true) = 'on' then
    return null;
  end if;
  if tg_op = 'INSERT' and new.coordinator_incentive is null and new.incentive_paid_on is null then
    return null;
  end if;
  -- `update of <column>` fires when the column is merely named in SET, so the
  -- old build's "Project settings" save (which always writes both) would push
  -- its stale or blank form values over the real row. Only a real change of
  -- the legacy values is carried over.
  if tg_op = 'UPDATE'
     and (new.coordinator_incentive, new.incentive_paid_on)
         is not distinct from (old.coordinator_incentive, old.incentive_paid_on) then
    return null;
  end if;
  update coordinator_incentives i
     set amount = new.coordinator_incentive,
         paid_on = new.incentive_paid_on
   where i.work_order_id = new.work_order_id
     and i.coordinator_id = new.coordinator_id
     and (i.amount, i.paid_on) is distinct from (new.coordinator_incentive, new.incentive_paid_on);
  return null;
end;
$$;
create trigger t_proj_mirror_legacy_incentive
  after insert or update of coordinator_incentive, incentive_paid_on on projects
  for each row execute function mirror_legacy_project_incentive();

-- ---- Plans and cancellation ------------------------------------------------
-- Every context: a custom plan starts at its only stage and never has a KSEB
-- feasibility date.
create or replace function guard_project_plan()
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
create trigger t_proj_plan
  before insert or update of feasibility_date on projects
  for each row execute function guard_project_plan();

-- Who recorded the cancellation comes from the session, never from the
-- request. Stamped only when the status itself changes; otherwise a forged
-- cancelled_by is put back, while the FK's ON DELETE SET NULL (new value NULL,
-- a profile deleted) passes untouched instead of re-attributing the row.
create or replace function stamp_project_cancellation()
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
create trigger t_proj_stamp_cancellation
  before insert or update of cancellation, cancelled_by on projects
  for each row execute function stamp_project_cancellation();

-- Service tickets: (a) only a service engineer can hold one; (b) field staff
-- may change ONLY the status, and only to in_progress / completed — the trigger
-- diffs the whole row, so new columns are protected automatically; (c)
-- completing a ticket without a service date stamps today (IST).
create or replace function guard_service_ticket()
returns trigger language plpgsql security definer set search_path = public as $$
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
create trigger t_ticket_guard
  before insert or update on service_tickets
  for each row execute function guard_service_ticket();

-- ============ SERVICE TICKET NUMBERING ============
-- Monotonic, collision-free ticket numbers assigned on insert when not supplied.
create sequence if not exists service_ticket_no_seq;
create or replace function assign_ticket_no()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.ticket_no is null then
    new.ticket_no :=
      'BSS-'
      || to_char((now() at time zone 'Asia/Kolkata'), 'YYMM')
      || '-'
      || lpad(nextval('service_ticket_no_seq')::text, 4, '0');
  end if;
  return new;
end;
$$;
create trigger t_ticket_assign_no before insert on service_tickets
  for each row execute function assign_ticket_no();

-- ============ FLATTENED LIST VIEWS (server-side pagination) ============
-- SECURITY INVOKER: the caller's RLS on every base table (payments included)
-- still applies.
--   amount_received = advance + Σ contract payments
--   balance_due     = total_cost − amount_received
-- coordinator_name lists every coordinator of the sale ("A, B"). Cancelled /
-- refunded projects leave payment_pending and feasibility_days_left, and their
-- feasibility clock stops at cancelled_on. The incentive columns are the
-- caller's (RLS on coordinator_incentives: the office sees everyone's, a
-- coordinator only their own). coordinator_id, coordinator_incentive and
-- incentive_paid_on are DEPRECATED compat columns for the previous build.
create view work_orders_list
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

create view projects_list
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

create view service_tickets_list
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

-- ============ AGGREGATES (scalability) ============
-- Single aggregate queries instead of loading every row to count in the app.
-- SECURITY INVOKER: they respect the caller's RLS (a coordinator's call only
-- ever sums their own rows).
create or replace function dashboard_metrics()
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

-- Incentive totals per person; the office may narrow to one coordinator. A shared
-- project counts once.
create or replace function incentive_summary(p_coordinator uuid default null)
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

-- ============ RPCs ============
-- SECURITY DEFINER entry points with exactly the reach their callers need.
-- EXECUTE is revoked from PUBLIC/anon on each: they are for signed-in users.

-- A service engineer's worklist, with just enough site detail to do the job.
-- Engineers get NO table access to work_orders / projects, so contract values,
-- payments and coordinator incentives never reach them. Filterable, orderable
-- and paginated by PostgREST like a view.
create or replace function engineer_tickets()
returns table (
  id uuid,
  ticket_no text,
  ticket_type ticket_type,
  status ticket_status,
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
language sql stable security definer set search_path = public as $$
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
revoke execute on function engineer_tickets() from public, anon;
grant execute on function engineer_tickets() to authenticated, service_role;

-- The only write path for who shares a sale. Office (or a server context): any
-- list. The first coordinator of a PENDING work order: add partners only
-- (appended; nobody removed or reordered), and only other coordinators — office
-- accounts join a sale through the office. Returns who was added / removed.
create or replace function set_work_order_coordinators(
  p_work_order_id uuid,
  p_coordinator_ids uuid[]
)
returns table (coordinator_id uuid, change text)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_office boolean := auth.uid() is null or is_admin();
  v_status work_order_status;
  v_before uuid[];
  v_after uuid[];
  v_problem text;
begin
  -- Serialises concurrent changes to one work order.
  select w.status into v_status from work_orders w where w.id = p_work_order_id for update;
  if not found then
    raise exception 'Work order not found' using errcode = 'P0002';
  end if;

  select coalesce(array_agg(c.coordinator_id order by c.sort_order, c.created_at, c.coordinator_id), '{}')
    into v_before
  from work_order_coordinators c where c.work_order_id = p_work_order_id;

  -- De-duplicate (first occurrence wins), drop NULLs, keep order.
  select coalesce(array_agg(t.x order by t.first_ord), '{}')
    into v_after
  from (
    select u.x, min(u.ord) as first_ord
    from unnest(coalesce(p_coordinator_ids, '{}'::uuid[])) with ordinality u(x, ord)
    where u.x is not null
    group by u.x
  ) t;

  if not v_office then
    if not (auth.uid() = any (v_before)) then
      raise exception 'Work order not found' using errcode = 'P0002';   -- no existence leak
    end if;
    if v_before[1] is distinct from auth.uid() or current_user_role()::text <> 'coordinator' then
      raise exception 'Only the office or the coordinator who logged this work order can add partners'
        using errcode = '42501';
    end if;
    if v_status <> 'pending' then
      raise exception 'Only the office can change who shares an approved or rejected work order'
        using errcode = '42501';
    end if;
    if not (v_after @> v_before) then
      raise exception 'Only the office can take a coordinator off a work order'
        using errcode = '42501';
    end if;
    -- Partners are appended; the existing order (and the first coordinator) stays.
    v_after := v_before || array(
      select u.x from unnest(v_after) with ordinality u(x, ord)
      where not (u.x = any (v_before)) order by u.ord
    );
  end if;

  if cardinality(v_after) = 0 then
    raise exception 'A work order needs at least one coordinator' using errcode = '22023';
  end if;
  if cardinality(v_after) > max_sale_coordinators() then
    raise exception 'A sale can have at most % coordinators', max_sale_coordinators()
      using errcode = '22023';
  end if;

  select string_agg(coalesce(p.full_name, u.x::text), ', ' order by u.ord) into v_problem
  from unnest(v_after) with ordinality u(x, ord)
  left join profiles p on p.id = u.x
  where p.id is null or p.role::text not in ('coordinator', 'admin', 'superadmin');
  if v_problem is not null then
    raise exception 'Only coordinator or office accounts can share a sale: %', v_problem
      using errcode = '23514';
  end if;

  -- A coordinator brings other COORDINATORS onto a sale they logged; office
  -- accounts (admin, SuperAdmin) are the office's to add. A partner is not asked,
  -- and sharing a sale opens their profile row (name, role, phone) to the others
  -- on it (profiles_select_partners), so the owner's and the office's accounts
  -- are out of reach. Accepted: a coordinator can still add any other coordinator
  -- to a sale they log; the office can take them off again.
  if not v_office then
    select string_agg(coalesce(p.full_name, u.x::text), ', ' order by u.ord) into v_problem
    from unnest(v_after) with ordinality u(x, ord)
    join profiles p on p.id = u.x
    where not (u.x = any (v_before))
      and p.role::text <> 'coordinator';
    if v_problem is not null then
      raise exception 'Only the office can add an office account to a sale: %', v_problem
        using errcode = '42501';
    end if;
  end if;

  select string_agg(p.full_name, ', ' order by p.full_name) into v_problem
  from coordinator_incentives i
  join profiles p on p.id = i.coordinator_id
  where i.work_order_id = p_work_order_id
    and i.amount is not null
    and not (i.coordinator_id = any (v_after));
  if v_problem is not null then
    raise exception '% still has an incentive on this sale — clear it before taking them off', v_problem
      using errcode = '23514';
  end if;

  -- Add / re-order first, then remove: the sale is never without a coordinator.
  insert into work_order_coordinators as c (work_order_id, coordinator_id, sort_order, added_by)
  select p_work_order_id, u.x, u.ord::smallint, auth.uid()
  from unnest(v_after) with ordinality u(x, ord)
  on conflict (work_order_id, coordinator_id) do update
    set sort_order = excluded.sort_order
    where c.sort_order is distinct from excluded.sort_order;

  delete from work_order_coordinators c
   where c.work_order_id = p_work_order_id
     and not (c.coordinator_id = any (v_after));

  -- The DEPRECATED legacy incentive on projects is the old first coordinator's
  -- (backfill / old build) and proj_select is membership-based: once the team
  -- changes, nobody else may read it there. The new build never reads it; the
  -- old build never calls this RPC. The switch keeps the mirror from clearing
  -- the real incentive row.
  if v_after is distinct from v_before then
    perform set_config('bss.skip_legacy_mirror', 'on', true);
    update projects
       set coordinator_incentive = null, incentive_paid_on = null
     where work_order_id = p_work_order_id
       and (coordinator_incentive is not null or incentive_paid_on is not null);
    perform set_config('bss.skip_legacy_mirror', 'off', true);
  end if;

  return query
    select u.x, 'added'::text from unnest(v_after) as u(x) where not (u.x = any (v_before))
    union all
    select u.x, 'removed'::text from unnest(v_before) as u(x) where not (u.x = any (v_after));
end;
$$;
revoke execute on function set_work_order_coordinators(uuid, uuid[]) from public, anon;
grant execute on function set_work_order_coordinators(uuid, uuid[]) to authenticated, service_role;

-- Accounts that can own a sale, for the partner picker and filters. Names and
-- roles only (no e-mail, no phone). Engineers get nothing; a server context
-- (service role, no auth.uid()) gets the full list.
create or replace function coordinator_directory()
returns table (id uuid, full_name text, role user_role)
language sql stable security definer set search_path = public as $$
  select p.id, p.full_name, p.role
  from profiles p
  where p.role::text in ('coordinator', 'admin', 'superadmin')
    and (auth.uid() is null
         or current_user_role()::text in ('coordinator', 'admin', 'superadmin'))
  order by p.full_name, p.id;
$$;
revoke execute on function coordinator_directory() from public, anon;
grant execute on function coordinator_directory() to authenticated, service_role;

-- Every account with its login e-mail, for the importer's name matching
-- (engineers included so a row can say "X is a service engineer"). Office only.
create or replace function account_directory()
returns table (id uuid, full_name text, email text, role user_role)
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is not null and not is_admin() then
    raise exception 'Only office staff can read the account directory' using errcode = '42501';
  end if;
  return query
    select p.id, p.full_name, lower(u.email)::text, p.role
    from profiles p
    left join auth.users u on u.id = p.id
    order by p.full_name, p.id;
end;
$$;
revoke execute on function account_directory() from public, anon;
grant execute on function account_directory() to authenticated, service_role;

-- Marks the caller's own notifications read; NULL = every unread one.
create or replace function mark_notifications_read(p_ids uuid[] default null)
returns integer language plpgsql security definer set search_path = public as $$
declare
  affected integer;
begin
  update notifications
     set read_at = now()
   where recipient_id = auth.uid()
     and read_at is null
     and (p_ids is null or id = any (p_ids));
  get diagnostics affected = row_count;
  return affected;
end;
$$;
revoke execute on function mark_notifications_read(uuid[]) from public, anon;
grant execute on function mark_notifications_read(uuid[]) to authenticated, service_role;

-- The notification fan-out's only write path (server code, service role only).
-- A row with a dedupe_key is written only when this call claims its key in
-- notification_dedupe, so an alert the user has since cleared from their inbox
-- is not sent again; rows without a key are always written. Claims and rows
-- land in one statement. Returns the rows written: the recipients to push to.
create or replace function insert_notifications(p_rows jsonb)
returns table (id uuid, recipient_id uuid)
language sql security definer set search_path = public as $$
  with incoming as (
    select r.*
    from jsonb_to_recordset(p_rows)
      as r (recipient_id uuid, type text, title text, body text, link text, dedupe_key text)
  ),
  claimed as (
    insert into notification_dedupe (recipient_id, dedupe_key)
    select distinct i.recipient_id, i.dedupe_key
    from incoming i
    where i.dedupe_key is not null
    on conflict do nothing
    returning notification_dedupe.recipient_id, notification_dedupe.dedupe_key
  )
  insert into notifications (recipient_id, type, title, body, link, dedupe_key)
  select i.recipient_id, i.type, i.title, i.body, i.link, i.dedupe_key
  from incoming i
  where i.dedupe_key is null
     or exists (
       select 1 from claimed c
       where c.recipient_id = i.recipient_id and c.dedupe_key = i.dedupe_key
     )
  -- A repeat within one batch, or a row written straight into the inbox.
  on conflict (recipient_id, dedupe_key) do nothing
  returning notifications.id, notifications.recipient_id;
$$;
revoke execute on function insert_notifications(jsonb) from public, anon, authenticated;
grant execute on function insert_notifications(jsonb) to service_role;

-- Upserts a browser's push endpoint and (re)assigns it to the caller. Only a
-- real push service is accepted — every notification makes the server POST to
-- each endpoint, so anything else would let a user aim those requests at a
-- host of their choosing — and a user keeps their 10 most recently seen
-- devices. Mirrored in lib/domain/notification-input.ts.
create or replace function register_push_subscription(
  p_endpoint text,
  p_p256dh text,
  p_auth text,
  p_user_agent text default null
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_host text;
begin
  if auth.uid() is null then
    raise exception 'Sign in to enable notifications' using errcode = '42501';
  end if;

  -- The authority must be a plain host name, optionally with :443.
  v_host := substring(
    lower(substring(p_endpoint from '^https://([^/?#]*)'))
    from '^([a-z0-9-]+(?:\.[a-z0-9-]+)*)(?::443)?$'
  );
  if v_host is null
     or length(p_endpoint) > 2048
     or not (
       v_host in ('fcm.googleapis.com', 'updates.push.services.mozilla.com', 'web.push.apple.com')
       or v_host ~ '\.(push\.apple\.com|notify\.windows\.com|push\.services\.mozilla\.com)$'
     )
     or coalesce(length(p_p256dh), 0) not between 1 and 512
     or coalesce(length(p_auth), 0) not between 1 and 512 then
    raise exception 'Invalid push subscription' using errcode = '22023';
  end if;

  insert into push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth, left(p_user_agent, 300))
  on conflict (endpoint) do update
    set user_id      = excluded.user_id,
        p256dh       = excluded.p256dh,
        auth         = excluded.auth,
        user_agent   = excluded.user_agent,
        last_seen_at = now()
  returning id into v_id;

  delete from push_subscriptions
   where id in (
     select id from push_subscriptions
      where user_id = auth.uid()
      order by last_seen_at desc, created_at desc, id desc
      offset 10
   );

  return v_id;
end;
$$;

create or replace function unregister_push_subscription(p_endpoint text)
returns void language sql security definer set search_path = public as $$
  delete from push_subscriptions
  where endpoint = p_endpoint and user_id = auth.uid();
$$;

revoke execute on function register_push_subscription(text, text, text, text) from public, anon;
revoke execute on function unregister_push_subscription(text) from public, anon;
grant execute on function register_push_subscription(text, text, text, text) to authenticated, service_role;
grant execute on function unregister_push_subscription(text) to authenticated, service_role;

-- Bulk project import (onboarding CSV), atomic per row. Takes rows the app has
-- already validated and normalised (lib/domain/import.ts); for each row, inside
-- its own subtransaction: resolves who shares the sale, optionally skips an
-- existing consumer number, inserts the approved work order, its extra
-- coordinators and its project (the trigger seeds the plan's milestones),
-- advances the milestones to the requested stage, sets the cancellation, the
-- incentives and records every payment in the ledger. Office only; runs with
-- the caller's identity for payments.recorded_by and cancelled_by. Concurrent
-- imports run one after the other. A commissioning date the sheet does not give
-- stays unknown — it is never invented.
-- Row (JSON): row_no, client_name, client_phone, address, plant_capacity (the
-- plan label), plan_type, total_cost, advance_amount, order_date,
-- coordinator_ids (1..max_sale_coordinators(), first = first coordinator),
-- current_stage, is_completed, commissioned_on, consumer_number, kseb_section,
-- financing_type, loan_bank_name, notes, feasibility_date, cancellation,
-- cancelled_on, cancellation_remarks, incentives [{coordinator_id, amount,
-- paid_on}], payments [{amount, paid_on, method, purpose, reference, notes}].
-- Still accepted from the previous build: coordinator_email (blank = the
-- default coordinator), coordinator_incentive and incentive_paid_on (its only
-- coordinator's; refused on a shared sale — use incentives).
create or replace function import_projects(
  p_rows jsonb,
  p_default_coordinator uuid,
  p_skip_existing boolean default true
)
returns table (row_no integer, status text, message text, work_order_id uuid)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  r jsonb;
  pay jsonb;
  inc jsonb;
  v_row integer;
  v_email text;
  v_ids uuid[];
  v_problem text;
  v_consumer text;
  v_existing text;
  v_wo uuid;
  v_project uuid;
  v_plan plan_type;
  v_stage project_stage;
  v_target integer;
  v_completed boolean;
  v_completed_at timestamptz;
  v_order_date date;
  v_feasibility date;
  v_cancellation project_cancellation;
  v_cancelled_on date;
  v_remarks text;
  v_incentive_for uuid;
begin
  if not is_admin() then
    raise exception 'Only office staff can import projects' using errcode = '42501';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'p_rows must be a JSON array' using errcode = '22023';
  end if;
  if not exists (
    select 1 from profiles
    where id = p_default_coordinator
      and role::text in ('coordinator', 'admin', 'superadmin')
  ) then
    raise exception 'The default coordinator must be a coordinator or office account'
      using errcode = '22023';
  end if;

  -- One import at a time (a double submit, a second tab): a concurrent batch
  -- waits here until this one commits, so its skip-existing check below sees
  -- every consumer number this batch imported.
  perform pg_advisory_xact_lock(hashtext('import_projects'));

  for r in select value from jsonb_array_elements(p_rows) loop
    v_row := (r->>'row_no')::integer;

    begin
      -- 1. Who shares the sale. This build sends resolved, ordered ids; the
      --    build before it sends coordinator_email (blank = the default).
      v_ids := null;
      if jsonb_typeof(r->'coordinator_ids') = 'array'
         and jsonb_array_length(r->'coordinator_ids') > 0 then
        select array_agg(t.x::uuid order by t.ord) into v_ids
        from jsonb_array_elements_text(r->'coordinator_ids') with ordinality t(x, ord);
        if cardinality(v_ids) > max_sale_coordinators() then
          raise exception 'A sale can have at most % coordinators', max_sale_coordinators();
        end if;
        if cardinality(v_ids) <> (select count(distinct u.x) from unnest(v_ids) as u(x)) then
          raise exception 'A coordinator is listed twice';
        end if;
        select string_agg(coalesce(p.full_name, u.x::text), ', ' order by u.ord) into v_problem
        from unnest(v_ids) with ordinality u(x, ord)
        left join profiles p on p.id = u.x
        where p.id is null or p.role::text not in ('coordinator', 'admin', 'superadmin');
        if v_problem is not null then
          raise exception 'Not a coordinator or office account: %', v_problem;
        end if;
      else
        v_email := nullif(lower(btrim(r->>'coordinator_email')), '');
        if v_email is null then
          v_ids := array[p_default_coordinator];
        else
          select array[p.id] into v_ids
          from auth.users u
          join profiles p on p.id = u.id
          where lower(u.email) = v_email
            and p.role::text in ('coordinator', 'admin', 'superadmin');
          if v_ids is null then
            raise exception 'coordinator_email "%" is not a coordinator or office account', v_email;
          end if;
        end if;
      end if;

      -- 2. Skip a consumer number already in the system (unchanged).
      v_consumer := nullif(btrim(r->>'consumer_number'), '');
      if p_skip_existing and v_consumer is not null then
        -- Compare ignoring whitespace: "1156 789" and "1156789" are one connection.
        select w.client_name into v_existing
        from work_orders w
        where regexp_replace(w.consumer_number, '\s', '', 'g')
            = regexp_replace(v_consumer, '\s', '', 'g')
        limit 1;
        if found then
          row_no := v_row;
          status := 'skipped';
          message := format('Consumer number %s already exists (%s)', v_consumer, v_existing);
          work_order_id := null;
          return next;
          continue;
        end if;
      end if;

      -- 3. Plan, completion, clock and cancellation, checked together.
      v_plan := coalesce(nullif(r->>'plan_type', '')::plan_type, 'solar');
      v_order_date := coalesce(nullif(r->>'order_date', '')::date, ist_today());
      v_feasibility := nullif(r->>'feasibility_date', '')::date;
      v_completed := coalesce((r->>'is_completed')::boolean, false);
      v_cancellation := nullif(r->>'cancellation', '')::project_cancellation;
      v_cancelled_on := nullif(r->>'cancelled_on', '')::date;
      v_remarks := nullif(btrim(r->>'cancellation_remarks'), '');
      if v_plan = 'custom' and v_feasibility is not null then
        raise exception 'A custom plan has no KSEB feasibility date';
      end if;
      if v_completed and v_feasibility is not null
         and nullif(r->>'commissioned_on', '') is null then
        raise exception 'commissioned_on is required when a commissioned project has a feasibility_date';
      end if;
      if v_cancellation is null and (v_cancelled_on is not null or v_remarks is not null) then
        raise exception 'cancelled_on and cancellation_remarks need a cancellation';
      end if;
      if v_cancellation is not null and v_feasibility is not null and v_cancelled_on is null then
        raise exception 'cancelled_on is required when a cancelled project has a feasibility_date';
      end if;

      insert into work_orders (
        coordinator_id, client_name, client_phone, address, plant_capacity, plan_type,
        advance_amount, total_cost, order_date, status, consumer_number,
        kseb_section, financing_type, loan_bank_name, notes
      ) values (
        v_ids[1],
        btrim(r->>'client_name'),
        nullif(btrim(r->>'client_phone'), ''),
        nullif(btrim(r->>'address'), ''),
        btrim(r->>'plant_capacity'),
        v_plan,
        coalesce(nullif(r->>'advance_amount', '')::numeric, 0),
        (r->>'total_cost')::numeric,
        v_order_date,
        'approved',
        v_consumer,
        nullif(btrim(r->>'kseb_section'), ''),
        coalesce(nullif(r->>'financing_type', '')::financing_type, 'self'),
        nullif(btrim(r->>'loan_bank_name'), ''),
        nullif(btrim(r->>'notes'), '')
      )
      returning id into v_wo;

      -- The insert trigger added v_ids[1] as first member; add the partners.
      insert into work_order_coordinators (work_order_id, coordinator_id, sort_order, added_by)
      select v_wo, u.x, u.ord::smallint, auth.uid()
      from unnest(v_ids) with ordinality u(x, ord)
      where u.ord > 1;

      -- A commissioning date the sheet does not give stays unknown (never invented).
      v_completed_at := case when v_completed then
        (nullif(r->>'commissioned_on', '')::date + time '12:00') at time zone 'Asia/Kolkata'
      end;

      -- coordinator_id comes from the work order (t_proj_coordinator); the
      -- milestones from the plan (on_project_created).
      insert into projects (work_order_id, started_at, feasibility_date)
      values (v_wo, v_order_date::timestamp at time zone 'Asia/Kolkata', v_feasibility)
      returning id into v_project;

      v_stage := case
        when v_completed then 'plant_commissioning'::project_stage
        else coalesce(
          nullif(r->>'current_stage', '')::project_stage,
          (select m.stage from project_milestones m
            where m.project_id = v_project order by m.sort_order limit 1))
      end;
      select m.sort_order into v_target
      from project_milestones m
      where m.project_id = v_project and m.stage = v_stage;
      if v_target is null then
        raise exception 'current_stage % does not apply to a % plan', v_stage, v_plan;
      end if;

      update project_milestones
         set status = 'completed', completed_at = v_completed_at
       where project_id = v_project and (v_completed or sort_order < v_target);
      if not v_completed then
        update project_milestones
           set status = 'in_progress', completed_at = null
         where project_id = v_project and sort_order = v_target;
      end if;

      update projects
         set current_stage = v_stage,
             is_completed = v_completed,
             completed_at = v_completed_at,
             cancellation = v_cancellation,
             cancelled_on = v_cancelled_on,
             cancellation_remarks = v_remarks
       where id = v_project;

      -- 4. Incentives, one per coordinator; the previous build's single
      --    incentive belongs to its only coordinator.
      if jsonb_typeof(r->'incentives') = 'array' then
        for inc in select value from jsonb_array_elements(r->'incentives') loop
          v_incentive_for := (inc->>'coordinator_id')::uuid;
          if not (v_incentive_for = any (v_ids)) then
            raise exception 'An incentive names someone who is not a coordinator on this sale';
          end if;
          update coordinator_incentives
             set amount = nullif(inc->>'amount', '')::numeric,
                 paid_on = nullif(inc->>'paid_on', '')::date
           where work_order_id = v_wo and coordinator_id = v_incentive_for;
        end loop;
      elsif nullif(r->>'coordinator_incentive', '') is not null
         or nullif(r->>'incentive_paid_on', '') is not null then
        -- The previous build's single incentive belongs to its only coordinator;
        -- never guess a split. It is written where its project page still reads
        -- it, and the temporary legacy mirror carries it to that coordinator's
        -- own row. Dropped with the mirror in the contract release.
        if cardinality(v_ids) > 1 then
          raise exception 'A shared sale takes its incentives per coordinator (incentives), not coordinator_incentive';
        end if;
        update projects
           set coordinator_incentive = nullif(r->>'coordinator_incentive', '')::numeric,
               incentive_paid_on = nullif(r->>'incentive_paid_on', '')::date
         where id = v_project;
      end if;

      -- 5. Payments (unchanged).
      for pay in
        select value from jsonb_array_elements(coalesce(r->'payments', '[]'::jsonb))
      loop
        insert into payments (
          work_order_id, amount, paid_on, method, purpose, reference, notes,
          recorded_by
        ) values (
          v_wo,
          (pay->>'amount')::numeric,
          (pay->>'paid_on')::date,
          coalesce(nullif(pay->>'method', '')::payment_method, 'other'),
          coalesce(nullif(pay->>'purpose', '')::payment_purpose, 'contract'),
          nullif(btrim(pay->>'reference'), ''),
          nullif(btrim(pay->>'notes'), ''),
          auth.uid()
        );
      end loop;

      row_no := v_row;
      status := 'imported';
      message := null;
      work_order_id := v_wo;
      return next;
    exception when others then
      -- The row's subtransaction (membership, incentives included) rolls back.
      row_no := v_row;
      status := 'failed';
      message := sqlerrm;
      work_order_id := null;
      return next;
    end;
  end loop;
end;
$$;
revoke execute on function import_projects(jsonb, uuid, boolean) from public, anon;
grant execute on function import_projects(jsonb, uuid, boolean) to authenticated, service_role;

-- ============ REALTIME ============
-- Live bell: stream inbox inserts to the recipient (Realtime applies the
-- SELECT RLS). Guarded so the script also runs where the publication is absent.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public' and tablename = 'notifications'
     ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;
