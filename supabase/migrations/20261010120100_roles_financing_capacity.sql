-- ============================================================================
-- BSS Solar — Role helpers, financing type, numeric plant capacity
-- ----------------------------------------------------------------------------
-- 1. Role helpers used by the policies/guards in the following migrations.
-- 2. Work orders record HOW the customer pays: self-financed or bank loan.
-- 3. KSEB registration is priced per kW, so capacity must be numeric. The text
--    label stays the single source of truth; `plant_capacity_kw` is GENERATED
--    from it, so the two can never drift. Mirrored in lib/domain/capacity.ts.
-- 4. Ownership integrity: a work order belongs to a coordinator or office staff,
--    never to a service engineer — and a service engineer cannot log one.
-- Idempotent; safe to re-run.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Role helpers (SECURITY DEFINER so policies can call them without
--    recursing through the RLS on profiles).
-- ---------------------------------------------------------------------------
create or replace function public.current_user_role()
returns public.user_role
language sql
security definer
stable
set search_path = public
as $$
  select role from profiles where id = auth.uid();
$$;

create or replace function public.is_service_engineer()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from profiles
    where id = auth.uid() and role = 'service_engineer'
  );
$$;

grant execute on function public.current_user_role() to anon, authenticated, service_role;
grant execute on function public.is_service_engineer() to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Financing type. Backfilled ONLY when the column is first added, so a
--    re-run never overwrites a value someone has since chosen deliberately.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'financing_type') then
    create type public.financing_type as enum ('self', 'loan');
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'work_orders'
      and column_name = 'financing_type'
  ) then
    alter table public.work_orders
      add column financing_type public.financing_type not null default 'self';
    update public.work_orders
      set financing_type = 'loan'
      where loan_bank_name is not null;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Numeric capacity, derived from the label.
--    Takes the first number; a W / Wp unit means watts (÷1000); kW, kWp, k or
--    no unit means kilowatts. Thousands separators are ignored. NULL when the
--    label holds no number. IMMUTABLE so it can back a generated column — if
--    this function ever changes, re-stamp the column (stored values do not
--    recompute on their own).
-- ---------------------------------------------------------------------------
create or replace function public.parse_capacity_kw(p_label text)
returns numeric
language plpgsql
immutable
parallel safe
as $$
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

grant execute on function public.parse_capacity_kw(text) to anon, authenticated, service_role;

alter table public.work_orders
  add column if not exists plant_capacity_kw numeric(10,2)
  generated always as (public.parse_capacity_kw(plant_capacity)) stored;

-- ---------------------------------------------------------------------------
-- 4. Ownership integrity.
-- ---------------------------------------------------------------------------
create or replace function public.guard_work_order_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
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

drop trigger if exists t_wo_guard_owner on public.work_orders;
create trigger t_wo_guard_owner
  before insert or update of coordinator_id on public.work_orders
  for each row execute function public.guard_work_order_owner();

-- Only a coordinator logs business for themselves; office staff may log it on
-- anyone's behalf. A service engineer cannot create a work order at all.
drop policy if exists wo_insert on public.work_orders;
create policy wo_insert on public.work_orders
  for insert
  with check (
    is_admin()
    or (coordinator_id = auth.uid() and current_user_role() = 'coordinator')
  );

commit;
