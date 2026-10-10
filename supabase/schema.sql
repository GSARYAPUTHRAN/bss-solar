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
  coordinator_id uuid not null references profiles(id) on delete restrict,
  client_name text not null,
  client_phone text,
  address text,
  plant_capacity text not null,           -- e.g. '3kW', '5kW'
  -- KSEB registration is priced per kW; derived from the label so the two can
  -- never drift.
  plant_capacity_kw numeric(10,2)
    generated always as (parse_capacity_kw(plant_capacity)) stored,
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

  -- DEPRECATED fixed payment slots, superseded by the payments ledger. Kept
  -- only so a schema.sql database matches a migrated one; the app never reads
  -- them, and any write is mirrored into the ledger (mirror_legacy_payment_slots).
  -- Dropped in the next release (expand/contract).
  first_payment_date date,
  first_payment_amount numeric(12,2),
  second_payment_date date,
  second_payment_amount numeric(12,2),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on column work_orders.first_payment_amount is
  'DEPRECATED: superseded by the payments ledger (migrated 2026-10). Drop next release.';
comment on column work_orders.first_payment_date is
  'DEPRECATED: superseded by the payments ledger (migrated 2026-10). Drop next release.';
comment on column work_orders.second_payment_amount is
  'DEPRECATED: superseded by the payments ledger (migrated 2026-10). Drop next release.';
comment on column work_orders.second_payment_date is
  'DEPRECATED: superseded by the payments ledger (migrated 2026-10). Drop next release.';

create index idx_work_orders_coordinator on work_orders(coordinator_id);
create index idx_work_orders_status on work_orders(status);
create index idx_work_orders_order_date on work_orders(order_date);
create index idx_work_orders_consumer_number on work_orders(consumer_number);
create index idx_work_orders_created_at on work_orders (created_at desc);

-- ============ PROJECTS ============
create table projects (
  id uuid primary key default uuid_generate_v4(),
  work_order_id uuid not null unique references work_orders(id) on delete cascade,
  coordinator_id uuid not null references profiles(id) on delete restrict,
  current_stage project_stage not null default 'site_feasibility_survey',
  is_completed boolean not null default false,
  started_at timestamptz not null default now(),
  completed_at timestamptz,               -- commissioning; stops the feasibility clock

  -- KSEB feasibility clock start (see feasibility_periods above)
  feasibility_date date,

  -- Per-project incentive the office sets for the coordinator. Projects are
  -- office-write by RLS, so a coordinator can read it but never edit it.
  coordinator_incentive numeric(12,2)
    constraint projects_incentive_non_negative
    check (coordinator_incentive is null or coordinator_incentive >= 0),
  incentive_paid_on date,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- A paid date without an amount is meaningless.
  constraint projects_incentive_paid_needs_amount
    check (incentive_paid_on is null or coordinator_incentive is not null)
);
create index idx_projects_coordinator on projects(coordinator_id);
create index idx_projects_stage on projects(current_stage);
create index idx_projects_created_at on projects (created_at desc);
create index idx_projects_feasibility_date
  on projects (feasibility_date)
  where feasibility_date is not null;

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
BEGIN
  INSERT INTO project_milestones (project_id, stage, sort_order) VALUES
    (new.id, 'site_feasibility_survey', 1),
    (new.id, 'kseb_portal_registration', 2),
    (new.id, 'kseb_feasibility_clearance', 3),
    (new.id, 'material_dispatch', 4),
    (new.id, 'structure_fabrication', 5),
    (new.id, 'panel_installation', 6),
    (new.id, 'wcr_submitted', 7),
    (new.id, 'kseb_inspection_meter', 8),
    (new.id, 'plant_commissioning', 9);
  RETURN new;
END; $$;
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
  -- Which deprecated work-order slot (1 = first, 2 = second payment) this row
  -- carries over; NULL for every payment recorded in the ledger itself.
  legacy_slot smallint
    constraint payments_legacy_slot_valid check (legacy_slot in (1, 2)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_payments_work_order on payments (work_order_id, paid_on);
create unique index uniq_payments_legacy_slot
  on payments (work_order_id, legacy_slot)
  where legacy_slot is not null;

-- TEMPORARY — dropped together with the deprecated work_orders payment slots
-- next release. While a build that still writes those slots may be live, each
-- change is mirrored into the slot's ledger row (a positive amount creates or
-- updates it, a cleared or zero amount removes it). Once an order has left
-- 'pending', only the office may change the slots, as with the advance and the
-- total cost.
create or replace function mirror_legacy_payment_slots()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  s record;
begin
  for s in
    select v.*
    from (values
      (1::smallint, new.first_payment_amount, new.first_payment_date,
       old.first_payment_amount, old.first_payment_date, 'Migrated: first payment'),
      (2::smallint, new.second_payment_amount, new.second_payment_date,
       old.second_payment_amount, old.second_payment_date, 'Migrated: second payment')
    ) as v (slot, amount, paid_on, old_amount, old_paid_on, note)
    -- The old edit form re-sends every column: act only on a slot that changed.
    where (tg_op = 'INSERT' and v.amount > 0)
       or (tg_op = 'UPDATE'
           and (v.amount, v.paid_on) is distinct from (v.old_amount, v.old_paid_on))
  loop
    if tg_op = 'UPDATE' and old.status <> 'pending'
       and auth.uid() is not null and not public.is_admin() then
      raise exception 'Only the office can change the amounts of an approved or rejected work order'
        using errcode = '42501';
    end if;

    if s.amount is null or s.amount <= 0 then
      delete from payments
       where work_order_id = new.id and legacy_slot = s.slot;
    else
      insert into payments (work_order_id, amount, paid_on, method, purpose, notes, legacy_slot)
      values (new.id, s.amount, coalesce(s.paid_on, new.order_date), 'other', 'contract',
              s.note, s.slot)
      on conflict (work_order_id, legacy_slot) where legacy_slot is not null
      do update set amount = excluded.amount, paid_on = excluded.paid_on;
    end if;
  end loop;
  return null;
end;
$$;
create trigger t_wo_mirror_legacy_payments
  after insert or update of first_payment_amount, first_payment_date,
    second_payment_amount, second_payment_date
  on work_orders
  for each row execute function mirror_legacy_payment_slots();

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

-- PROFILES: user reads own; admin reads all; user updates own (never role — see
-- guard_profile_role). DELETE is SuperAdmin-only.
create policy profiles_select_self on profiles for select using (id = auth.uid() or is_admin());
create policy profiles_update_self on profiles for update using (id = auth.uid()) with check (id = auth.uid());
create policy profiles_admin_insert on profiles for insert with check (is_admin());
create policy profiles_admin_update on profiles for update using (is_admin()) with check (is_admin());
create policy profiles_superadmin_delete on profiles for delete using (is_superadmin());

-- WORK ORDERS: coordinator owns; admin all. Only a coordinator logs business
-- for themselves, and only as 'pending' (the office approves it); office staff
-- may log it on anyone's behalf; a service engineer cannot create one at all.
create policy wo_select on work_orders for select
  using (is_admin() or coordinator_id = auth.uid());
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
  using (is_admin() or coordinator_id = auth.uid())
  with check (is_admin() or coordinator_id = auth.uid());
create policy wo_delete on work_orders for delete using (is_superadmin());

-- PROJECTS: coordinator sees own (incl. their incentive, read-only); admin
-- writes (only admin creates via approval); DELETE is SuperAdmin-only.
create policy proj_select on projects for select
  using (is_admin() or coordinator_id = auth.uid());
create policy proj_admin_insert on projects for insert with check (is_admin());
create policy proj_admin_update on projects for update
  using (is_admin()) with check (is_admin());
create policy proj_superadmin_delete on projects for delete using (is_superadmin());

-- MILESTONES: visible to project owner + admin; admin writes
create policy ms_select on project_milestones for select using (
  is_admin() or exists (
    select 1 from projects p where p.id = project_milestones.project_id
    and p.coordinator_id = auth.uid()
  )
);
create policy ms_admin_write on project_milestones for all using (is_admin());

-- SERVICE TICKETS: admin all; the assigned engineer reads theirs and may move
-- its status (guard_service_ticket limits WHAT they change); a coordinator
-- reads tickets on their own projects.
create policy ticket_select on service_tickets for select using (
  is_admin()
  or assigned_to = auth.uid()
  or exists (
    select 1 from projects p
    where p.id = service_tickets.project_id and p.coordinator_id = auth.uid()
  )
);
create policy ticket_admin_write on service_tickets for all using (is_admin());
create policy ticket_engineer_update on service_tickets for update
  using (assigned_to = auth.uid() and is_service_engineer())
  with check (assigned_to = auth.uid() and is_service_engineer());

-- PAYMENTS: the office records and corrects; only the SuperAdmin deletes; a
-- coordinator reads the payments on their own work orders.
create policy payment_select on payments for select using (
  is_admin()
  or exists (
    select 1 from work_orders w
    where w.id = payments.work_order_id and w.coordinator_id = auth.uid()
  )
);
create policy payment_admin_insert on payments for insert with check (is_admin());
create policy payment_admin_update on payments for update
  using (is_admin()) with check (is_admin());
create policy payment_superadmin_delete on payments for delete using (is_superadmin());

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
-- work-order owner never becomes a service engineer, and an engineer hands over
-- open tickets before changing role.
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
         exists (select 1 from work_orders where coordinator_id = new.id)
      or exists (select 1 from projects where coordinator_id = new.id)
    ) then
      raise exception 'This member still owns work orders or projects — reassign them before making them a service engineer'
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
-- left 'pending' (both feed the money received and the balance).
create or replace function guard_work_order_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
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
-- engineer.
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
create view work_orders_list
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

create view projects_list
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
  incentive_pending numeric
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

-- Incentive totals; the office may narrow to one coordinator.
create or replace function incentive_summary(p_coordinator uuid default null)
returns table (
  projects bigint, pending_projects bigint,
  total numeric, paid numeric, pending numeric
)
language sql stable security invoker set search_path = public as $$
  select
    count(*)::bigint,
    count(*) filter (where incentive_paid_on is null)::bigint,
    coalesce(sum(coordinator_incentive), 0)::numeric,
    coalesce(sum(coordinator_incentive) filter (where incentive_paid_on is not null), 0)::numeric,
    coalesce(sum(coordinator_incentive) filter (where incentive_paid_on is null), 0)::numeric
  from projects
  where coordinator_incentive is not null
    and (p_coordinator is null or coordinator_id = p_coordinator);
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
-- its own subtransaction: resolves the coordinator by email, optionally skips
-- an existing consumer number, inserts the approved work order and its project
-- (the trigger seeds the 9 milestones), advances the milestones to the
-- requested stage and records every payment in the ledger. Office only; runs
-- with the caller's identity for payments.recorded_by. Concurrent imports run
-- one after the other.
create or replace function import_projects(
  p_rows jsonb,
  p_default_coordinator uuid,
  p_skip_existing boolean default true
)
returns table (row_no integer, status text, message text, work_order_id uuid)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  r jsonb;
  pay jsonb;
  v_row integer;
  v_email text;
  v_coordinator uuid;
  v_consumer text;
  v_existing text;
  v_wo uuid;
  v_project uuid;
  v_stage project_stage;
  v_target integer;
  v_completed boolean;
  v_completed_at timestamptz;
  v_order_date date;
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
      -- Coordinator: an email must match a sales/office account exactly. A
      -- silent fallback would misattribute the project (and its incentive).
      v_email := nullif(lower(btrim(r->>'coordinator_email')), '');
      v_coordinator := null;
      if v_email is null then
        v_coordinator := p_default_coordinator;
      else
        select p.id into v_coordinator
        from auth.users u
        join profiles p on p.id = u.id
        where lower(u.email) = v_email
          and p.role::text in ('coordinator', 'admin', 'superadmin');
        if v_coordinator is null then
          raise exception 'coordinator_email "%" is not a coordinator or office account', v_email;
        end if;
      end if;

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

      v_order_date := coalesce(nullif(r->>'order_date', '')::date, ist_today());

      insert into work_orders (
        coordinator_id, client_name, client_phone, address, plant_capacity,
        advance_amount, total_cost, order_date, status, consumer_number,
        kseb_section, financing_type, loan_bank_name, notes
      ) values (
        v_coordinator,
        btrim(r->>'client_name'),
        nullif(btrim(r->>'client_phone'), ''),
        nullif(btrim(r->>'address'), ''),
        btrim(r->>'plant_capacity'),
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

      v_completed := coalesce((r->>'is_completed')::boolean, false);
      v_completed_at := case
        when v_completed then coalesce(
          (nullif(r->>'commissioned_on', '')::date + time '12:00')
            at time zone 'Asia/Kolkata',
          now()
        )
      end;

      insert into projects (
        work_order_id, coordinator_id, started_at, feasibility_date,
        coordinator_incentive, incentive_paid_on
      ) values (
        v_wo,
        v_coordinator,
        v_order_date::timestamp at time zone 'Asia/Kolkata',
        nullif(r->>'feasibility_date', '')::date,
        nullif(r->>'coordinator_incentive', '')::numeric,
        nullif(r->>'incentive_paid_on', '')::date
      )
      returning id into v_project;

      -- The insert trigger seeded the 9 milestones; advance them to the stage.
      v_stage := case
        when v_completed then 'plant_commissioning'::project_stage
        else coalesce(nullif(r->>'current_stage', '')::project_stage,
                      'site_feasibility_survey')
      end;
      select m.sort_order into v_target
      from project_milestones m
      where m.project_id = v_project and m.stage = v_stage;

      update project_milestones
         set status = 'completed',
             completed_at = coalesce(v_completed_at, now())
       where project_id = v_project
         and (v_completed or sort_order < v_target);

      if not v_completed then
        update project_milestones
           set status = 'in_progress', completed_at = null
         where project_id = v_project and sort_order = v_target;
      end if;

      update projects
         set current_stage = v_stage,
             is_completed = v_completed,
             completed_at = v_completed_at
       where id = v_project;

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
      -- The subtransaction for this row is rolled back in full.
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
