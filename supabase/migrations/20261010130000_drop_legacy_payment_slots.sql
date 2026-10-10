-- ============================================================================
-- BSS Solar — Drop the deprecated fixed payment slots (contract step)
-- ----------------------------------------------------------------------------
-- 20261010120200_payments_ledger.sql copied work_orders.first/second_payment_
-- {amount,date} into the `payments` ledger and left them in place, DEPRECATED,
-- with a TEMPORARY trigger mirroring every write the old build made to them.
-- The app has neither read nor written them since, so this removes the four
-- columns (their comments go with them) and the mirror.
--
-- Apply ONLY once the build that shipped the ledger is live on production: the
-- build before it writes these columns and would fail every work-order save.
-- CI migrates on master before production deploys, so merge this to master only
-- after that build is live there.
--
-- Fails closed: a slot that holds money but has no ledger row would be lost, so
-- the drop is refused and the transaction rolled back, naming the work orders.
--
-- payments.legacy_slot stays: it records which ledger rows came from the slots.
--
-- Re-runnable: once the columns are gone every statement is a no-op.
-- ============================================================================

begin;

-- No write may land between the check and the drop.
lock table public.work_orders in access exclusive mode;

do $$
declare
  missing text;
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'work_orders'
       and column_name in ('first_payment_amount', 'second_payment_amount')
  ) then
    return;
  end if;

  select string_agg(format('%s (slot %s)', w.id, s.slot), ', ' order by w.id, s.slot)
    into missing
    from public.work_orders w
    cross join lateral (values
      (1::smallint, w.first_payment_amount),
      (2::smallint, w.second_payment_amount)
    ) as s (slot, amount)
   where s.amount > 0
     and not exists (
       select 1 from public.payments p
        where p.work_order_id = w.id and p.legacy_slot = s.slot
     );

  if missing is not null then
    raise exception 'Refusing to drop the old payment slots: these hold money that is not in the payments ledger: %', missing
      using hint = 'Re-run 20261010120200_payments_ledger.sql to copy them in, or, if their ledger rows were deleted on purpose, clear those slots first.';
  end if;
end $$;

drop trigger if exists t_wo_mirror_legacy_payments on public.work_orders;
drop function if exists public.mirror_legacy_payment_slots();

alter table public.work_orders
  drop column if exists first_payment_amount,
  drop column if exists first_payment_date,
  drop column if exists second_payment_amount,
  drop column if exists second_payment_date;

commit;
