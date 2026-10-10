-- ============================================================================
-- BSS Solar — Notifications (in-app inbox + Web Push subscriptions)
-- ----------------------------------------------------------------------------
-- `notifications` is each user's inbox. Rows are written ONLY by trusted server
-- code (service role) — there is deliberately no INSERT/UPDATE policy, so a
-- signed-in user cannot forge a notification for anyone, themselves included.
-- A user reads and clears their own inbox, and marks it read through
-- `mark_notifications_read()`.
--
-- `dedupe_key` makes scheduled alerts idempotent: the daily cron may run twice
-- without notifying twice. The unique index treats NULL keys as distinct, so
-- ordinary notifications never collide, and it doubles as the ON CONFLICT
-- arbiter for PostgREST upserts.
--
-- `push_subscriptions` holds each browser's Web Push endpoint. A device follows
-- whoever signed in on it last (shared phones are common in the field).
-- Idempotent; safe to re-run.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- Inbox
-- ---------------------------------------------------------------------------
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  type text not null,
  title text not null,
  body text,
  link text,
  dedupe_key text,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  -- In-app paths only: "/x" but never "//host" (an off-site redirect).
  constraint notifications_link_internal
    check (link is null or (link like '/%' and link not like '//%')),
  constraint notifications_title_present check (length(btrim(title)) > 0)
);

create index if not exists idx_notifications_recipient_created
  on public.notifications (recipient_id, created_at desc);
create index if not exists idx_notifications_unread
  on public.notifications (recipient_id)
  where read_at is null;
create unique index if not exists uniq_notifications_dedupe
  on public.notifications (recipient_id, dedupe_key);

alter table public.notifications enable row level security;

drop policy if exists notification_select_own on public.notifications;
create policy notification_select_own on public.notifications
  for select using (recipient_id = auth.uid());

drop policy if exists notification_delete_own on public.notifications;
create policy notification_delete_own on public.notifications
  for delete using (recipient_id = auth.uid());

revoke insert, update on public.notifications from anon, authenticated;
grant select, delete on public.notifications to authenticated;
grant select, insert, update, delete on public.notifications to service_role;

create or replace function public.mark_notifications_read(p_ids uuid[] default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
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

revoke execute on function public.mark_notifications_read(uuid[]) from public, anon;
grant execute on function public.mark_notifications_read(uuid[]) to authenticated, service_role;

-- Live bell: stream inserts to the recipient (Realtime applies the SELECT RLS).
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

-- ---------------------------------------------------------------------------
-- Web Push subscriptions
-- ---------------------------------------------------------------------------
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  constraint push_endpoint_https check (endpoint like 'https://%')
);

create index if not exists idx_push_subscriptions_user
  on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

drop policy if exists push_select_own on public.push_subscriptions;
create policy push_select_own on public.push_subscriptions
  for select using (user_id = auth.uid());

drop policy if exists push_delete_own on public.push_subscriptions;
create policy push_delete_own on public.push_subscriptions
  for delete using (user_id = auth.uid());

revoke insert, update on public.push_subscriptions from anon, authenticated;
grant select, delete on public.push_subscriptions to authenticated;
grant select, insert, update, delete on public.push_subscriptions to service_role;

create or replace function public.register_push_subscription(
  p_endpoint text,
  p_p256dh text,
  p_auth text,
  p_user_agent text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Sign in to enable notifications' using errcode = '42501';
  end if;
  if p_endpoint is null or p_endpoint not like 'https://%'
     or coalesce(length(p_p256dh), 0) = 0 or coalesce(length(p_auth), 0) = 0 then
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

  return v_id;
end;
$$;

create or replace function public.unregister_push_subscription(p_endpoint text)
returns void
language sql
security definer
set search_path = public
as $$
  delete from push_subscriptions
  where endpoint = p_endpoint and user_id = auth.uid();
$$;

revoke execute on function public.register_push_subscription(text, text, text, text) from public, anon;
revoke execute on function public.unregister_push_subscription(text) from public, anon;
grant execute on function public.register_push_subscription(text, text, text, text) to authenticated, service_role;
grant execute on function public.unregister_push_subscription(text) to authenticated, service_role;

commit;
