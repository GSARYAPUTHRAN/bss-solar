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
-- live while this runs keeps working. Drop them in the next release.
-- Idempotent; safe to re-run.
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
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_payments_work_order
  on public.payments (work_order_id, paid_on);

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
-- Backfill the two fixed payment slots into the ledger (once per slot).
-- ---------------------------------------------------------------------------
insert into public.payments (work_order_id, amount, paid_on, method, notes)
select w.id, w.first_payment_amount,
       coalesce(w.first_payment_date, w.order_date), 'other',
       'Migrated: first payment'
from public.work_orders w
where w.first_payment_amount > 0
  and not exists (
    select 1 from public.payments p
    where p.work_order_id = w.id and p.notes = 'Migrated: first payment'
  );

insert into public.payments (work_order_id, amount, paid_on, method, notes)
select w.id, w.second_payment_amount,
       coalesce(w.second_payment_date, w.order_date), 'other',
       'Migrated: second payment'
from public.work_orders w
where w.second_payment_amount > 0
  and not exists (
    select 1 from public.payments p
    where p.work_order_id = w.id and p.notes = 'Migrated: second payment'
  );

comment on column public.work_orders.first_payment_amount is
  'DEPRECATED: superseded by the payments ledger (migrated 2026-10). Drop next release.';
comment on column public.work_orders.first_payment_date is
  'DEPRECATED: superseded by the payments ledger (migrated 2026-10). Drop next release.';
comment on column public.work_orders.second_payment_amount is
  'DEPRECATED: superseded by the payments ledger (migrated 2026-10). Drop next release.';
comment on column public.work_orders.second_payment_date is
  'DEPRECATED: superseded by the payments ledger (migrated 2026-10). Drop next release.';

commit;
