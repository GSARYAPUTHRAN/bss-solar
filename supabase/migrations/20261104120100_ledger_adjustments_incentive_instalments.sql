-- ============================================================================
-- BSS Solar — Ledger adjustments, advance details, incentive instalments
-- (2026-11-04)
-- ----------------------------------------------------------------------------
-- 1. Payments ledger. Two new purposes (20261104120000): a REFUND is money
--    handed back to the customer, a WRITE-OFF is a balance the office decides
--    not to collect (a reason is required). KSEB fee lines gain paid_by_office:
--    false = the customer paid the fee through BSS, true = the BSS office paid
--    KSEB on the customer's behalf. Neither fee kind counts towards the contract.
--
--      net received = advance + Σ contract − Σ refund
--      balance due  = total − net received − Σ write_off
--
-- 2. The booking advance's method, date and reference (all optional) follow the
--    advance's lock: once an order has left 'pending' only the office edits them.
--
-- 3. Incentive instalments. coordinator_incentives.amount stays the AGREED
--    incentive (office-set); coordinator_incentive_payments holds the dated
--    instalments paid against it. paid = Σ instalments, pending = amount − paid.
--    coordinator_incentives.paid_on is now DERIVED by trigger (the date the
--    incentive was settled in full, else NULL), so every existing reader keeps
--    working. The previous build still writes (amount, paid_on) in one update:
--    marking an incentive paid there is turned into a settling instalment, so
--    nothing recorded in the deploy gap is lost; any other direct change of a
--    settled paid date is refused (it must go through the instalments).
--
-- 4. work_orders_list / projects_list / dashboard_metrics / incentive_summary
--    follow. Every existing view column keeps its name, type and position; new
--    ones are appended.
--
-- Expand-only: the live build keeps working against this schema until the code
-- deploys. Idempotent; safe to re-run.
-- ============================================================================

begin;
-- Fail fast rather than queue every request behind a long transaction.
set local lock_timeout = '10s';

-- ---------------------------------------------------------------------------
-- 1. Payments: paid_by_office, the write-off reason
-- ---------------------------------------------------------------------------
alter table public.payments
  add column if not exists paid_by_office boolean not null default false;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'payments_paid_by_office_only_kseb') then
    alter table public.payments add constraint payments_paid_by_office_only_kseb
      check (paid_by_office = false or purpose = 'kseb_fees');
  end if;
  -- A write-off without its reason is not recordable.
  if not exists (select 1 from pg_constraint where conname = 'payments_write_off_needs_reason') then
    alter table public.payments add constraint payments_write_off_needs_reason
      check (purpose <> 'write_off' or nullif(btrim(notes), '') is not null);
  end if;
end $$;

comment on column public.payments.paid_by_office is
  'kseb_fees only: false = the customer paid the fee through BSS, true = the BSS office paid KSEB for the customer.';

-- ---------------------------------------------------------------------------
-- 2. Advance details
-- ---------------------------------------------------------------------------
alter table public.work_orders
  add column if not exists advance_method public.payment_method,
  add column if not exists advance_paid_on date,
  add column if not exists advance_reference text;

-- Work-order guard: + the advance's method, date and reference are locked with
-- the advance itself (once an order has left 'pending', only the office).
create or replace function public.guard_work_order_update()
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
            or new.total_cost is distinct from old.total_cost
            or new.advance_method is distinct from old.advance_method
            or new.advance_paid_on is distinct from old.advance_paid_on
            or new.advance_reference is distinct from old.advance_reference) then
      raise exception 'Only the office can change the amounts of an approved or rejected work order'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Incentive instalments
-- ---------------------------------------------------------------------------
-- Instalment writes (and the old build's direct paid_on writes) must not land
-- between the backfill and the triggers that keep it true (reads carry on).
lock table public.coordinator_incentives in share row exclusive mode;

-- One row per dated payment against a coordinator's incentive. The composite
-- foreign key (no direct one to work_orders) keeps PostgREST embeds from
-- projects / work_order_coordinators unambiguous; name the key in an embed.
create table if not exists public.coordinator_incentive_payments (
  id uuid primary key default gen_random_uuid(),
  work_order_id  uuid not null,
  coordinator_id uuid not null,
  amount numeric(12,2) not null
    constraint coordinator_incentive_payments_amount_positive check (amount > 0),
  paid_on date not null,
  note text,
  recorded_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint coordinator_incentive_payments_incentive_fkey
    foreign key (work_order_id, coordinator_id)
    references public.coordinator_incentives (work_order_id, coordinator_id)
    on delete cascade
);
create index if not exists idx_incentive_payments_incentive
  on public.coordinator_incentive_payments (work_order_id, coordinator_id, paid_on);

alter table public.coordinator_incentive_payments enable row level security;

-- The office records, corrects and removes instalments; a coordinator reads
-- their own. Column grants: who recorded it, when, and which incentive it
-- belongs to are never client-writable.
revoke all on public.coordinator_incentive_payments from anon, authenticated;
grant select on public.coordinator_incentive_payments to authenticated;
grant insert (work_order_id, coordinator_id, amount, paid_on, note)
  on public.coordinator_incentive_payments to authenticated;
grant update (amount, paid_on, note) on public.coordinator_incentive_payments to authenticated;
grant delete on public.coordinator_incentive_payments to authenticated;
grant select, insert, update, delete
  on public.coordinator_incentive_payments to service_role;

drop policy if exists cip_select on public.coordinator_incentive_payments;
create policy cip_select on public.coordinator_incentive_payments for select using (
  (select is_admin()) or coordinator_id = (select auth.uid())
);
drop policy if exists cip_admin_insert on public.coordinator_incentive_payments;
create policy cip_admin_insert on public.coordinator_incentive_payments
  for insert with check ((select is_admin()));
drop policy if exists cip_admin_update on public.coordinator_incentive_payments;
create policy cip_admin_update on public.coordinator_incentive_payments
  for update using ((select is_admin())) with check ((select is_admin()));
drop policy if exists cip_admin_delete on public.coordinator_incentive_payments;
create policy cip_admin_delete on public.coordinator_incentive_payments
  for delete using ((select is_admin()));

drop trigger if exists t_cip_updated on public.coordinator_incentive_payments;
create trigger t_cip_updated
  before update on public.coordinator_incentive_payments
  for each row execute function public.touch_updated_at();

-- Σ instalments, and the date an incentive was settled in full. Internal
-- (triggers only). Instalments never exceed the amount, so "settled" means
-- Σ = amount, and the instalment that settles it is the latest by date.
create or replace function public.incentive_paid(p_work_order_id uuid, p_coordinator_id uuid)
returns numeric language sql stable set search_path = public as $$
  select coalesce(sum(p.amount), 0)
  from coordinator_incentive_payments p
  where p.work_order_id = p_work_order_id and p.coordinator_id = p_coordinator_id;
$$;
revoke execute on function public.incentive_paid(uuid, uuid) from public, anon, authenticated;
grant execute on function public.incentive_paid(uuid, uuid) to service_role;

create or replace function public.incentive_paid_date(
  p_work_order_id uuid, p_coordinator_id uuid, p_amount numeric
)
returns date language sql stable set search_path = public as $$
  select case when p_amount > 0 and sum(p.amount) >= p_amount then max(p.paid_on) end
  from coordinator_incentive_payments p
  where p.work_order_id = p_work_order_id and p.coordinator_id = p_coordinator_id;
$$;
revoke execute on function public.incentive_paid_date(uuid, uuid, numeric) from public, anon, authenticated;
grant execute on function public.incentive_paid_date(uuid, uuid, numeric) to service_role;

-- An instalment needs the agreed amount, and the instalments together can never
-- exceed it. The incentive row is locked first, so two instalments recorded at
-- once cannot both slip under the cap. Who recorded it comes from the session.
create or replace function public.guard_incentive_payment()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_amount numeric;
  v_others numeric;
begin
  -- A BEFORE trigger runs ahead of the row policy, and this one reads an
  -- incentive its caller may not be allowed to see: without this a coordinator's
  -- insert aimed at a partner's incentive would learn from the messages below
  -- whether it is set and how much of it is still unpaid.
  if auth.uid() is not null and not public.is_admin() then
    raise exception 'new row violates row-level security policy for table "coordinator_incentive_payments"'
      using errcode = '42501';
  end if;

  if tg_op = 'INSERT' then
    new.recorded_by := coalesce(auth.uid(), new.recorded_by);
  else
    if new.work_order_id is distinct from old.work_order_id
       or new.coordinator_id is distinct from old.coordinator_id then
      raise exception 'A payment cannot move to another incentive' using errcode = '23514';
    end if;
    -- Never re-attributed; the FK's ON DELETE SET NULL (a profile deleted) passes.
    if new.recorded_by is not null and new.recorded_by is distinct from old.recorded_by then
      new.recorded_by := old.recorded_by;
    end if;
  end if;

  select i.amount into v_amount
  from coordinator_incentives i
  where i.work_order_id = new.work_order_id and i.coordinator_id = new.coordinator_id
  for update;
  if not found then
    return new;   -- the foreign key refuses it
  end if;
  if v_amount is null then
    raise exception 'Set the incentive amount first' using errcode = '23514';
  end if;

  select coalesce(sum(p.amount), 0) into v_others
  from coordinator_incentive_payments p
  where p.work_order_id = new.work_order_id
    and p.coordinator_id = new.coordinator_id
    and p.id <> new.id;
  if v_others + new.amount > v_amount then
    raise exception 'Instalments exceed the incentive' using errcode = '23514';
  end if;
  return new;
end;
$$;
drop trigger if exists t_cip_guard on public.coordinator_incentive_payments;
create trigger t_cip_guard
  before insert or update on public.coordinator_incentive_payments
  for each row execute function public.guard_incentive_payment();

-- coordinator_incentives.paid_on follows the instalments. The write is skipped
-- when nothing changes, so a part-payment does not restamp the incentive.
create or replace function public.sync_incentive_paid_on()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_wo uuid := case tg_op when 'DELETE' then old.work_order_id else new.work_order_id end;
  v_co uuid := case tg_op when 'DELETE' then old.coordinator_id else new.coordinator_id end;
begin
  update coordinator_incentives i
     set paid_on = incentive_paid_date(i.work_order_id, i.coordinator_id, i.amount)
   where i.work_order_id = v_wo
     and i.coordinator_id = v_co
     and i.amount > 0
     and i.paid_on is distinct from incentive_paid_date(i.work_order_id, i.coordinator_id, i.amount);
  return null;
end;
$$;
drop trigger if exists t_cip_sync_paid_on on public.coordinator_incentive_payments;
create trigger t_cip_sync_paid_on
  after insert or update or delete on public.coordinator_incentive_payments
  for each row execute function public.sync_incentive_paid_on();

-- The agreed amount can never drop below what has been paid out of it, and the
-- paid date is the derived one. The previous build writes (amount, paid_on) in
-- one update: a date newly set while part of the amount is unpaid means "paid
-- in full" there, kept as written for settle_incentive_paid_on to record as the
-- settling instalment. Any other direct change of the date — clearing or moving
-- the date of an incentive the instalments have settled — is refused. A stale
-- date that is merely re-sent, or left behind by a changed amount, is derived.
-- Runs before t_ci_touch, which then stamps the final figures.
create or replace function public.guard_incentive_paid()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_paid numeric := incentive_paid(new.work_order_id, new.coordinator_id);
  v_derived date;
begin
  if v_paid > 0 and (new.amount is null or new.amount < v_paid) then
    raise exception 'The incentive cannot be less than the % already paid', v_paid
      using errcode = '23514';
  end if;
  -- No amount: nothing to derive (coordinator_incentives_paid_needs_amount
  -- refuses a date). A zero incentive has no instalment to date it by.
  if new.amount is null or new.amount = 0 then
    return new;
  end if;

  v_derived := incentive_paid_date(new.work_order_id, new.coordinator_id, new.amount);
  if new.paid_on is distinct from old.paid_on and new.paid_on is distinct from v_derived then
    if new.paid_on is not null and v_paid < new.amount then
      return new;
    end if;
    raise exception 'The paid date follows the incentive payments — record, change or remove a payment instead'
      using errcode = '23514';
  end if;
  new.paid_on := v_derived;
  return new;
end;
$$;
drop trigger if exists t_ci_guard_paid on public.coordinator_incentives;
create trigger t_ci_guard_paid
  before update on public.coordinator_incentives
  for each row execute function public.guard_incentive_paid();

-- Records the instalment that settles an incentive the previous build marked
-- paid (the rest of the amount, on the date it entered).
create or replace function public.settle_incentive_paid_on()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_paid numeric := incentive_paid(new.work_order_id, new.coordinator_id);
begin
  if new.amount > 0 and v_paid < new.amount then
    insert into coordinator_incentive_payments
      (work_order_id, coordinator_id, amount, paid_on, note, recorded_by)
    values
      (new.work_order_id, new.coordinator_id, new.amount - v_paid, new.paid_on,
       'Marked paid', auth.uid());
  end if;
  return null;
end;
$$;
drop trigger if exists t_ci_settle_paid on public.coordinator_incentives;
create trigger t_ci_settle_paid
  after update of paid_on on public.coordinator_incentives
  for each row
  when (new.paid_on is not null and new.paid_on is distinct from old.paid_on)
  execute function public.settle_incentive_paid_on();

comment on column public.coordinator_incentives.amount is
  'The agreed incentive. What has been paid out of it is coordinator_incentive_payments.';
comment on column public.coordinator_incentives.paid_on is
  'DERIVED by trigger from coordinator_incentive_payments: the date the incentive was settled in full, NULL while any of it is unpaid.';

-- Backfill (lossless, re-runnable): an incentive already marked paid becomes ONE
-- instalment for its whole amount on that date. A zero incentive has nothing to
-- pay. Never into an incentive that already has instalments.
insert into public.coordinator_incentive_payments
  (work_order_id, coordinator_id, amount, paid_on, note, recorded_by)
select i.work_order_id, i.coordinator_id, i.amount, i.paid_on, 'Migrated', i.updated_by
from public.coordinator_incentives i
where i.amount > 0
  and i.paid_on is not null
  and not exists (
    select 1 from public.coordinator_incentive_payments p
    where p.work_order_id = i.work_order_id and p.coordinator_id = i.coordinator_id
  );

-- ---------------------------------------------------------------------------
-- 4. List views, KPIs and incentive totals
-- ---------------------------------------------------------------------------
-- DROP + CREATE in one transaction (readers never see the views missing); the
-- views stay SECURITY INVOKER, so the caller's RLS applies to every base table.
drop view if exists public.work_orders_list;
drop view if exists public.projects_list;

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
  -- Net of refunds: money handed back is no longer received.
  (coalesce(w.advance_amount, 0) + coalesce(pay.contract_total, 0)
     - coalesce(pay.refunded_total, 0))::numeric(12,2)
    as amount_received,
  -- Net received and written-off both reduce what is still due.
  (w.total_cost - coalesce(w.advance_amount, 0) - coalesce(pay.contract_total, 0)
     + coalesce(pay.refunded_total, 0) - coalesce(pay.written_off_total, 0))::numeric(12,2)
    as balance_due,
  -- 2026-10-22
  coalesce(team.ids, '{}'::uuid[]) as coordinator_ids,
  coalesce(team.names, '{}'::text[]) as coordinator_names,
  w.plan_type,
  pr.cancellation,
  pr.cancelled_on,
  -- 2026-11-04
  coalesce(pay.refunded_total, 0)::numeric(12,2) as refunded_total,
  coalesce(pay.written_off_total, 0)::numeric(12,2) as written_off_total,
  coalesce(pay.kseb_collected, 0)::numeric(12,2) as kseb_fees_collected,
  coalesce(pay.kseb_by_office, 0)::numeric(12,2) as kseb_fees_by_office
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
    max(p.paid_on) filter (where p.purpose = 'contract') as last_paid_on,
    sum(p.amount) filter (where p.purpose = 'refund') as refunded_total,
    sum(p.amount) filter (where p.purpose = 'write_off') as written_off_total,
    sum(p.amount) filter (where p.purpose = 'kseb_fees' and not p.paid_by_office) as kseb_collected,
    sum(p.amount) filter (where p.purpose = 'kseb_fees' and p.paid_by_office) as kseb_by_office
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
  (coalesce(wo.advance_amount, 0) + coalesce(pay.contract_total, 0)
     - coalesce(pay.refunded_total, 0))::numeric(12,2)
    as amount_received,
  (coalesce(wo.total_cost, 0) - coalesce(wo.advance_amount, 0)
     - coalesce(pay.contract_total, 0) + coalesce(pay.refunded_total, 0)
     - coalesce(pay.written_off_total, 0))::numeric(12,2) as balance_due,
  -- Commissioned, not fully collected, and not cancelled / refunded (whose
  -- balance is no longer receivable).
  (pr.is_completed and pr.cancellation is null
    and coalesce(wo.total_cost, 0) - coalesce(wo.advance_amount, 0)
        - coalesce(pay.contract_total, 0) + coalesce(pay.refunded_total, 0)
        - coalesce(pay.written_off_total, 0) > 0) as payment_pending,
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
  -- 2026-10-22. An incentive is unpaid while its instalments fall short of its
  -- agreed amount.
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
  coalesce(inc.paid_ids, '{}'::uuid[]) as incentive_paid_coordinator_ids,
  -- 2026-11-04
  coalesce(pay.refunded_total, 0)::numeric(12,2) as refunded_total,
  coalesce(pay.written_off_total, 0)::numeric(12,2) as written_off_total,
  coalesce(pay.kseb_collected, 0)::numeric(12,2) as kseb_fees_collected,
  coalesce(pay.kseb_by_office, 0)::numeric(12,2) as kseb_fees_by_office,
  coalesce(inc.paid, 0)::numeric(12,2) as incentive_paid
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
    max(p.paid_on) filter (where p.purpose = 'contract') as last_paid_on,
    sum(p.amount) filter (where p.purpose = 'refund') as refunded_total,
    sum(p.amount) filter (where p.purpose = 'write_off') as written_off_total,
    sum(p.amount) filter (where p.purpose = 'kseb_fees' and not p.paid_by_office) as kseb_collected,
    sum(p.amount) filter (where p.purpose = 'kseb_fees' and p.paid_by_office) as kseb_by_office
  from payments p
  where p.work_order_id = pr.work_order_id
) pay on true
left join lateral (
  -- RLS: the office sees everyone's; a coordinator only their own (instalments
  -- included).
  select
    sum(x.amount) as total,
    sum(x.paid) as paid,
    sum(x.amount - x.paid) as unpaid,
    count(*) as set_count,
    count(*) filter (where x.paid < x.amount) as unpaid_count,
    max(x.paid_on) as last_paid_on,
    array_agg(x.coordinator_id order by x.coordinator_id) filter (where x.paid < x.amount) as unpaid_ids,
    array_agg(x.coordinator_id order by x.coordinator_id) filter (where x.paid >= x.amount) as paid_ids
  from (
    select
      i.coordinator_id, i.amount, i.paid_on,
      coalesce((
        select sum(ip.amount)
        from coordinator_incentive_payments ip
        where ip.work_order_id = i.work_order_id and ip.coordinator_id = i.coordinator_id
      ), 0) as paid
    from coordinator_incentives i
    where i.work_order_id = pr.work_order_id and i.amount is not null
  ) x
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

-- KPIs (SECURITY INVOKER). Same return shape: only the incentive figure moves
-- to "agreed minus paid".
create or replace function public.dashboard_metrics()
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
    -- Every coordinator's agreed incentive not yet paid out in instalments (a
    -- coordinator's call: their own).
    coalesce(
      (select sum(i.amount - coalesce((
                select sum(ip.amount) from coordinator_incentive_payments ip
                where ip.work_order_id = i.work_order_id
                  and ip.coordinator_id = i.coordinator_id), 0))
         from coordinator_incentives i
         join projects p on p.work_order_id = i.work_order_id
        where i.amount is not null), 0
    )::numeric,
    (select count(*) from projects where cancellation = 'cancelled')::bigint,
    (select count(*) from projects where cancellation = 'refunded')::bigint;
$$;

-- Incentive totals per person (same signature). SECURITY INVOKER: a
-- coordinator's call only ever sums their own rows; the office may narrow to
-- one coordinator. A shared project counts once. paid = Σ instalments.
create or replace function public.incentive_summary(p_coordinator uuid default null)
returns table (
  projects bigint, pending_projects bigint,
  total numeric, paid numeric, pending numeric
)
language sql stable security invoker set search_path = public as $$
  select
    count(distinct i.work_order_id)::bigint,
    count(distinct i.work_order_id) filter (where ip.paid < i.amount)::bigint,
    coalesce(sum(i.amount), 0)::numeric,
    coalesce(sum(ip.paid), 0)::numeric,
    coalesce(sum(i.amount - ip.paid), 0)::numeric
  from coordinator_incentives i
  join projects p on p.work_order_id = i.work_order_id
  cross join lateral (
    select coalesce(sum(x.amount), 0) as paid
    from coordinator_incentive_payments x
    where x.work_order_id = i.work_order_id and x.coordinator_id = i.coordinator_id
  ) ip
  where i.amount is not null
    and (p_coordinator is null or i.coordinator_id = p_coordinator);
$$;

commit;
