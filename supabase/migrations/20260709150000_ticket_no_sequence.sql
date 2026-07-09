-- ============================================================================
-- BSS Solar — Guaranteed-unique service ticket numbers
-- ----------------------------------------------------------------------------
-- Replaces the app's "YYMM + 4 random digits" generator (which collided against
-- the UNIQUE constraint as volume grew) with a monotonic DB sequence assigned
-- by a trigger. Explicitly-provided ticket numbers (e.g. seed/import) are kept.
-- ============================================================================

begin;

create sequence if not exists service_ticket_no_seq;

create or replace function public.assign_ticket_no()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
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

drop trigger if exists t_ticket_assign_no on public.service_tickets;
create trigger t_ticket_assign_no
  before insert on public.service_tickets
  for each row execute function public.assign_ticket_no();

grant usage, select on sequence service_ticket_no_seq
  to anon, authenticated, service_role;

commit;
