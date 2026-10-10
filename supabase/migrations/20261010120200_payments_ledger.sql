-- ============================================================================
-- BSS Solar — Payments ledger (repayments in any number of stages)
-- ----------------------------------------------------------------------------
-- Collections were modelled as an advance + exactly two staged payments. Real
-- customers often pay in more than three stages, so every collection after the
-- booking advance is now a row in `payments`, keyed to the work order (the
-- money's natural anchor: it exists before approval and survives a project
-- being rebuilt).
--
--   contract received = work_orders.advance_amount + Σ payments (purpose = contract)
--
-- `purpose = kseb_fees` lets the office record KSEB charges collected through
-- BSS without inflating the contract receivable.
--
-- Expand/contract: the old first/second payment columns are migrated into the
-- ledger and left in place (DEPRECATED, unread by the app) so the build that is
-- live while this runs keeps working. Until the code deploy, that old build
-- still writes them, so a TEMPORARY trigger mirrors every such write into the
-- ledger. Drop the columns, the trigger and its function in the next release.
--
-- Re-runnable. Each migrated slot is keyed by `payments.legacy_slot` (1 or 2),
-- which the app never edits, so a re-run copies only a slot that has no ledger
-- row: it never adds a second copy, whatever the office has since changed on
-- the first (note, amount or date). It does restore a migrated row that has
-- since been deleted outright, so do not re-run it after such a deletion.
-- ============================================================================

begin;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'payment_method') then
    create type public.payment_method as enum (
      'cash', 'upi', 'bank_transfer', 'cheque', 'loan_disbursement', 'other'
    );
  end if;
  if not exists (select 1 from pg_type where typname = 'payment_purpose') then
    create type public.payment_purpose as enum ('contract', 'kseb_fees');
  end if;
end $$;

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  work_order_id uuid not null references public.work_orders(id) on delete cascade,
  amount numeric(12,2) not null
    constraint payments_amount_positive check (amount > 0),
  paid_on date not null,
  method public.payment_method not null default 'bank_transfer',
  purpose public.payment_purpose not null default 'contract',
  reference text,
  notes text,
  recorded_by uuid references public.profiles(id) on delete set null,
  -- Which deprecated work-order slot (1 = first, 2 = second payment) this row
  -- carries over; NULL for every payment recorded in the ledger itself.
  legacy_slot smallint
    constraint payments_legacy_slot_valid check (legacy_slot in (1, 2)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_payments_work_order
  on public.payments (work_order_id, paid_on);
create unique index if not exists uniq_payments_legacy_slot
  on public.payments (work_order_id, legacy_slot)
  where legacy_slot is not null;

drop trigger if exists t_payment_updated on public.payments;
create trigger t_payment_updated
  before update on public.payments
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- RLS — the office records and corrects payments; only the SuperAdmin deletes
-- (destructive actions are theirs alone); a coordinator reads the payments on
-- their own work orders.
-- ---------------------------------------------------------------------------
alter table public.payments enable row level security;

drop policy if exists payment_select on public.payments;
create policy payment_select on public.payments
  for select using (
    is_admin()
    or exists (
      select 1 from public.work_orders w
      where w.id = payments.work_order_id and w.coordinator_id = auth.uid()
    )
  );

drop policy if exists payment_admin_insert on public.payments;
create policy payment_admin_insert on public.payments
  for insert with check (is_admin());

drop policy if exists payment_admin_update on public.payments;
create policy payment_admin_update on public.payments
  for update using (is_admin()) with check (is_admin());

drop policy if exists payment_superadmin_delete on public.payments;
create policy payment_superadmin_delete on public.payments
  for delete using (is_superadmin());

grant select, insert, update, delete on public.payments
  to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Backfill the two fixed payment slots into the ledger, at most once per slot.
-- Writes to work_orders are held off until this migration commits, so no slot
-- the old build writes can slip between this copy and the mirror below.
-- ---------------------------------------------------------------------------
lock table public.work_orders in share row exclusive mode;

insert into public.payments (work_order_id, amount, paid_on, method, notes, legacy_slot)
select w.id, s.amount, coalesce(s.paid_on, w.order_date), 'other', s.note, s.slot
from public.work_orders w
cross join lateral (values
  (1::smallint, w.first_payment_amount, w.first_payment_date, 'Migrated: first payment'),
  (2::smallint, w.second_payment_amount, w.second_payment_date, 'Migrated: second payment')
) as s (slot, amount, paid_on, note)
where s.amount > 0
on conflict (work_order_id, legacy_slot) where legacy_slot is not null do nothing;

-- ---------------------------------------------------------------------------
-- TEMPORARY — drop this trigger and its function together with the deprecated
-- columns next release.
-- CI applies this migration before the new build deploys, and until then the
-- old build still writes the two slots (work-order form and edit, onboarding
-- importer). Each change is mirrored into the slot's ledger row so nothing
-- recorded in that gap is lost: a positive amount creates or updates the row,
-- a cleared or zero amount removes it. The new build never writes the slots,
-- so once it is live this never fires.
-- The slots now feed the office-only ledger, so they follow the same rule as
-- the advance and the total cost (guard_work_order_update): once an order has
-- left 'pending', only the office may change them.
-- ---------------------------------------------------------------------------
create or replace function public.mirror_legacy_payment_slots()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
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

drop trigger if exists t_wo_mirror_legacy_payments on public.work_orders;
create trigger t_wo_mirror_legacy_payments
  after insert or update of first_payment_amount, first_payment_date,
    second_payment_amount, second_payment_date
  on public.work_orders
  for each row execute function public.mirror_legacy_payment_slots();

comment on column public.work_orders.first_payment_amount is
  'DEPRECATED: superseded by the payments ledger (migrated 2026-10). Drop next release.';
comment on column public.work_orders.first_payment_date is
  'DEPRECATED: superseded by the payments ledger (migrated 2026-10). Drop next release.';
comment on column public.work_orders.second_payment_amount is
  'DEPRECATED: superseded by the payments ledger (migrated 2026-10). Drop next release.';
comment on column public.work_orders.second_payment_date is
  'DEPRECATED: superseded by the payments ledger (migrated 2026-10). Drop next release.';

commit;
