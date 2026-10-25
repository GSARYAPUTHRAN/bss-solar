-- ============================================================================
-- BSS Solar — Shared coordinators (2026-10-22)
-- ----------------------------------------------------------------------------
-- A sale can be shared by up to max_sale_coordinators() coordinators.
-- work_order_coordinators is the single source of truth; a project's
-- coordinators are its work order's (projects.work_order_id).
--   work_orders.coordinator_id = the FIRST coordinator (lowest sort_order),
--                                kept by trigger; moves only with the list.
--   projects.coordinator_id    = DEPRECATED copy of it (dropped in the
--                                contract release).
-- Each coordinator's incentive is private (coordinator_incentives: own row,
-- office all). projects.coordinator_incentive / incentive_paid_on are
-- DEPRECATED; the build deployed before this release still writes them, so a
-- TEMPORARY trigger carries those writes over.
-- Expand-only: the previous build keeps working on this schema.
-- Idempotent; safe to re-run.
-- ============================================================================

begin;
-- Fail fast rather than queue every request behind a long transaction.
set local lock_timeout = '10s';

-- Old-build writes must not land between the backfill and the triggers that
-- keep it true (reads carry on).
lock table public.work_orders, public.projects in share row exclusive mode;

-- Most people who can share one sale (a typo guard). Mirrored as
-- MAX_SALE_COORDINATORS in lib/domain/coordinators.ts; a test pins the two.
create or replace function public.max_sale_coordinators()
returns integer language sql immutable as $$
  select 5;
$$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table if not exists public.work_order_coordinators (
  work_order_id  uuid not null references public.work_orders(id) on delete cascade,
  coordinator_id uuid not null references public.profiles(id) on delete restrict,
  -- Display order ("Ravi + Abhijith"); the lowest is the first coordinator,
  -- mirrored to work_orders.coordinator_id.
  sort_order smallint not null
    constraint work_order_coordinators_sort_order_positive check (sort_order >= 1),
  added_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (work_order_id, coordinator_id)
);
create index if not exists idx_woc_coordinator
  on public.work_order_coordinators (coordinator_id, work_order_id);

-- One row per membership (opened by trigger, removed with it). NO direct FK to
-- work_orders or profiles on purpose: either would make this table a PostgREST
-- junction and the existing embeds ambiguous.
create table if not exists public.coordinator_incentives (
  work_order_id  uuid not null,
  coordinator_id uuid not null,
  amount numeric(12,2)
    constraint coordinator_incentives_amount_non_negative check (amount is null or amount >= 0),
  paid_on date,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (work_order_id, coordinator_id),
  constraint coordinator_incentives_member_fkey
    foreign key (work_order_id, coordinator_id)
    references public.work_order_coordinators (work_order_id, coordinator_id)
    on delete cascade,
  constraint coordinator_incentives_paid_needs_amount
    check (paid_on is null or amount is not null)
);
create index if not exists idx_coordinator_incentives_coordinator
  on public.coordinator_incentives (coordinator_id)
  where amount is not null;

alter table public.work_order_coordinators enable row level security;
alter table public.coordinator_incentives enable row level security;

-- Writes only through SECURITY DEFINER code (triggers, set_work_order_coordinators,
-- import_projects). The office edits an incentive's amount and paid date only.
revoke insert, update, delete on public.work_order_coordinators from anon, authenticated;
revoke insert, update, delete on public.coordinator_incentives from anon, authenticated;
grant select on public.work_order_coordinators, public.coordinator_incentives to authenticated;
grant update (amount, paid_on) on public.coordinator_incentives to authenticated;
grant select, insert, update, delete
  on public.work_order_coordinators, public.coordinator_incentives to service_role;

-- ---------------------------------------------------------------------------
-- Membership helpers. SECURITY DEFINER: they read work_order_coordinators
-- without its RLS, so policies call them without recursing. Set-returning, so
-- a policy uses them as `x in (select f())` — one hashed subplan per statement.
-- Default EXECUTE (like is_admin()): policies are evaluated for anon too, where
-- they return nothing.
-- ---------------------------------------------------------------------------
create or replace function public.my_work_order_ids()
returns setof uuid language sql stable security definer set search_path = public as $$
  select work_order_id from work_order_coordinators where coordinator_id = auth.uid();
$$;

create or replace function public.my_project_ids()
returns setof uuid language sql stable security definer set search_path = public as $$
  select p.id
  from projects p
  join work_order_coordinators c on c.work_order_id = p.work_order_id
  where c.coordinator_id = auth.uid();
$$;

-- People the caller shares at least one sale with (not the caller).
create or replace function public.my_partner_ids()
returns setof uuid language sql stable security definer set search_path = public as $$
  select distinct theirs.coordinator_id
  from work_order_coordinators mine
  join work_order_coordinators theirs on theirs.work_order_id = mine.work_order_id
  where mine.coordinator_id = auth.uid()
    and theirs.coordinator_id <> auth.uid();
$$;

-- The first coordinator of a work order (internal: triggers and RPCs).
create or replace function public.first_coordinator(p_work_order_id uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select coordinator_id
  from work_order_coordinators
  where work_order_id = p_work_order_id
  order by sort_order, created_at, coordinator_id
  limit 1;
$$;
revoke execute on function public.first_coordinator(uuid) from public, anon, authenticated;
grant execute on function public.first_coordinator(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Membership triggers (created before the backfill so it is checked and opens
-- the incentive rows).
-- ---------------------------------------------------------------------------
-- Every context: a sale belongs to coordinators or office staff, never an
-- engineer; a membership row is added or removed, never re-pointed.
create or replace function public.guard_work_order_coordinator()
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
drop trigger if exists t_woc_guard on public.work_order_coordinators;
create trigger t_woc_guard
  before insert or update on public.work_order_coordinators
  for each row execute function public.guard_work_order_coordinator();

create or replace function public.open_coordinator_incentive()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into coordinator_incentives (work_order_id, coordinator_id)
  values (new.work_order_id, new.coordinator_id)
  on conflict do nothing;
  return null;
end;
$$;
drop trigger if exists t_woc_open_incentive on public.work_order_coordinators;
create trigger t_woc_open_incentive
  after insert on public.work_order_coordinators
  for each row execute function public.open_coordinator_incentive();

-- Stamps only a real change of the money: the FK's ON DELETE SET NULL of
-- updated_by (a profile deleted) must not re-attribute the row.
create or replace function public.touch_coordinator_incentive()
returns trigger language plpgsql as $$
begin
  if (new.amount, new.paid_on) is distinct from (old.amount, old.paid_on) then
    new.updated_at := now();
    new.updated_by := auth.uid();
  end if;
  return new;
end;
$$;
drop trigger if exists t_ci_touch on public.coordinator_incentives;
create trigger t_ci_touch
  before update on public.coordinator_incentives
  for each row execute function public.touch_coordinator_incentive();

-- ---------------------------------------------------------------------------
-- Backfill (lossless, re-runnable)
-- ---------------------------------------------------------------------------
-- 1. Every work order's coordinator becomes its first member.
insert into public.work_order_coordinators (work_order_id, coordinator_id, sort_order, created_at)
select w.id, w.coordinator_id, 1, w.created_at
from public.work_orders w
on conflict do nothing;

-- 2. A project whose coordinator differs from its work order's (no in-app path;
--    only hand-written SQL) keeps that person as a partner, so nobody loses
--    access or pay.
insert into public.work_order_coordinators (work_order_id, coordinator_id, sort_order, created_at)
select p.work_order_id, p.coordinator_id, 2, p.created_at
from public.projects p
join public.work_orders w on w.id = p.work_order_id
join public.profiles pf on pf.id = p.coordinator_id
  and pf.role::text in ('coordinator', 'admin', 'superadmin')
where p.coordinator_id <> w.coordinator_id
on conflict do nothing;

-- 3. The project's incentive belonged to the project's coordinator. Only into
--    an untouched row: a re-run never overwrites an incentive the office has
--    since set with the new build.
update public.coordinator_incentives i
   set amount = p.coordinator_incentive,
       paid_on = p.incentive_paid_on
  from public.projects p
 where p.work_order_id = i.work_order_id
   and p.coordinator_id = i.coordinator_id
   and (p.coordinator_incentive is not null or p.incentive_paid_on is not null)
   and i.amount is null and i.paid_on is null;

-- 4. R7: re-align any drifted copy (its incentive now lives on the partner's row).
update public.projects p
   set coordinator_id = w.coordinator_id,
       coordinator_incentive = null,
       incentive_paid_on = null
  from public.work_orders w
 where w.id = p.work_order_id
   and p.coordinator_id <> w.coordinator_id;

-- ---------------------------------------------------------------------------
-- Keeping work_orders.coordinator_id = first member, and projects in step
-- ---------------------------------------------------------------------------
-- Every new work order starts with its coordinator as first member (old-build
-- inserts, the app, the import and fixtures alike).
create or replace function public.seed_work_order_coordinator()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into work_order_coordinators (work_order_id, coordinator_id, sort_order, added_by, created_at)
  values (new.id, new.coordinator_id, 1, auth.uid(), new.created_at)
  on conflict do nothing;
  return null;
end;
$$;
drop trigger if exists t_wo_seed_coordinator on public.work_orders;
create trigger t_wo_seed_coordinator
  after insert on public.work_orders
  for each row execute function public.seed_work_order_coordinator();

create or replace function public.sync_work_order_first_coordinator()
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
drop trigger if exists t_woc_sync_first on public.work_order_coordinators;
create trigger t_woc_sync_first
  after insert or delete or update of sort_order on public.work_order_coordinators
  for each row execute function public.sync_work_order_first_coordinator();

-- At commit: a work order that still exists keeps at least one coordinator.
create or replace function public.require_work_order_coordinator()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from work_orders where id = old.work_order_id)
     and not exists (select 1 from work_order_coordinators where work_order_id = old.work_order_id) then
    raise exception 'A work order needs at least one coordinator' using errcode = '23514';
  end if;
  return null;
end;
$$;
drop trigger if exists t_woc_require_one on public.work_order_coordinators;
create constraint trigger t_woc_require_one
  after delete on public.work_order_coordinators
  deferrable initially deferred
  for each row execute function public.require_work_order_coordinator();

-- Owner role (every context, unchanged and FIRST: tests expect 23514), then:
-- coordinator_id only ever equals the first member.
create or replace function public.guard_work_order_owner()
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
-- (trigger t_wo_guard_owner unchanged: before insert or update of coordinator_id)

-- DEPRECATED copy on projects follows the work order.
create or replace function public.sync_project_coordinator()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update projects set coordinator_id = new.coordinator_id
   where work_order_id = new.id and coordinator_id is distinct from new.coordinator_id;
  return null;
end;
$$;
drop trigger if exists t_wo_sync_project_coordinator on public.work_orders;
create trigger t_wo_sync_project_coordinator
  after update of coordinator_id on public.work_orders
  for each row when (old.coordinator_id is distinct from new.coordinator_id)
  execute function public.sync_project_coordinator();

-- A project's coordinator is its work order's: set on insert whatever the
-- caller sent; refused when changed directly.
create or replace function public.derive_project_coordinator()
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
drop trigger if exists t_proj_coordinator on public.projects;
create trigger t_proj_coordinator
  before insert or update of coordinator_id, work_order_id on public.projects
  for each row execute function public.derive_project_coordinator();

-- TEMPORARY — drop in the contract release together with
-- projects.coordinator_incentive / incentive_paid_on. The build deployed before
-- this release writes a project's incentive there; carry it to the first
-- coordinator's own row. One-way: the new build never writes those columns.
-- set_work_order_coordinators clears them with the transaction-local switch
-- bss.skip_legacy_mirror = 'on', which must not wipe the incentive rows.
create or replace function public.mirror_legacy_project_incentive()
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
drop trigger if exists t_proj_mirror_legacy_incentive on public.projects;
create trigger t_proj_mirror_legacy_incentive
  after insert or update of coordinator_incentive, incentive_paid_on on public.projects
  for each row execute function public.mirror_legacy_project_incentive();

-- Role guard: shared ownership counts.
create or replace function public.guard_profile_role()
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

-- ---------------------------------------------------------------------------
-- RLS: membership replaces "coordinator_id = auth.uid()"
-- ---------------------------------------------------------------------------
drop policy if exists wo_select on public.work_orders;
create policy wo_select on public.work_orders for select using (
  (select is_admin())
  -- Row-intrinsic on purpose: INSERT … RETURNING checks this policy before the
  -- AFTER INSERT trigger has added the creator's membership row.
  or coordinator_id = (select auth.uid())
  or id in (select my_work_order_ids())
);
drop policy if exists wo_update on public.work_orders;
create policy wo_update on public.work_orders for update
  using ((select is_admin()) or id in (select my_work_order_ids()))
  with check ((select is_admin()) or id in (select my_work_order_ids()));
-- wo_insert and wo_delete: unchanged.

drop policy if exists proj_select on public.projects;
create policy proj_select on public.projects for select using (
  (select is_admin()) or work_order_id in (select my_work_order_ids())
);

drop policy if exists ms_select on public.project_milestones;
create policy ms_select on public.project_milestones for select using (
  (select is_admin()) or project_id in (select my_project_ids())
);

drop policy if exists ticket_select on public.service_tickets;
create policy ticket_select on public.service_tickets for select using (
  (select is_admin())
  or assigned_to = (select auth.uid())
  or project_id in (select my_project_ids())
);

drop policy if exists payment_select on public.payments;
create policy payment_select on public.payments for select using (
  (select is_admin()) or work_order_id in (select my_work_order_ids())
);

-- Partners see each other's profile row (name, role, phone, created_at) —
-- nobody else's.
drop policy if exists profiles_select_partners on public.profiles;
create policy profiles_select_partners on public.profiles for select using (
  id in (select my_partner_ids())
);

drop policy if exists woc_select on public.work_order_coordinators;
create policy woc_select on public.work_order_coordinators for select using (
  (select is_admin()) or work_order_id in (select my_work_order_ids())
);

drop policy if exists ci_select on public.coordinator_incentives;
create policy ci_select on public.coordinator_incentives for select using (
  (select is_admin()) or coordinator_id = (select auth.uid())
);
drop policy if exists ci_admin_update on public.coordinator_incentives;
create policy ci_admin_update on public.coordinator_incentives for update
  using ((select is_admin())) with check ((select is_admin()));

-- ---------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------
-- The only write path for who shares a sale. Office (or a server context):
-- any list. The first coordinator of a PENDING work order: add partners only
-- (appended; nobody removed or reordered), and only other coordinators — office
-- accounts join a sale through the office. Returns who was added / removed.
create or replace function public.set_work_order_coordinators(
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
revoke execute on function public.set_work_order_coordinators(uuid, uuid[]) from public, anon;
grant execute on function public.set_work_order_coordinators(uuid, uuid[]) to authenticated, service_role;

-- Accounts that can own a sale, for the partner picker and filters. Names and
-- roles only (no e-mail, no phone). Engineers get nothing; a server context
-- (service role, no auth.uid()) gets the full list.
create or replace function public.coordinator_directory()
returns table (id uuid, full_name text, role user_role)
language sql stable security definer set search_path = public as $$
  select p.id, p.full_name, p.role
  from profiles p
  where p.role::text in ('coordinator', 'admin', 'superadmin')
    and (auth.uid() is null
         or current_user_role()::text in ('coordinator', 'admin', 'superadmin'))
  order by p.full_name, p.id;
$$;
revoke execute on function public.coordinator_directory() from public, anon;
grant execute on function public.coordinator_directory() to authenticated, service_role;

-- Every account with its login e-mail, for the importer's name matching
-- (engineers included so a row can say "X is a service engineer"). Office only.
create or replace function public.account_directory()
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
revoke execute on function public.account_directory() from public, anon;
grant execute on function public.account_directory() to authenticated, service_role;

commit;
