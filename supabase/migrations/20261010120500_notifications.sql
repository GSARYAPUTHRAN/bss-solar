-- ============================================================================
-- BSS Solar — Notifications (in-app inbox + Web Push subscriptions)
-- ----------------------------------------------------------------------------
-- `notifications` is each user's inbox. Rows are written ONLY by trusted server
-- code (service role) — there is deliberately no INSERT/UPDATE policy, so a
-- signed-in user cannot forge a notification for anyone, themselves included.
-- A user reads and clears their own inbox, and marks it read through
-- `mark_notifications_read()`.
--
-- `dedupe_key` makes scheduled alerts idempotent: the daily cron may run every
-- day without notifying twice. Which keys each user has been sent is recorded
-- in `notification_dedupe`, apart from the inbox, so a user clearing read rows
-- never frees a key for the next run to send again. `insert_notifications()`
-- claims the keys and writes the inbox rows in one statement. NULL keys never
-- collide, so ordinary notifications always land.
--
-- `push_subscriptions` holds each browser's Web Push endpoint. A device follows
-- whoever signed in on it last (shared phones are common in the field). Only
-- real push-service endpoints are accepted, at most 10 per user.
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
  -- In-app paths only. Browsers treat "//host", "/\host" and paths carrying
  -- control characters ("/\t/host") as off-site, so the second character may be
  -- neither "/" nor "\" and no control character may appear anywhere.
  constraint notifications_link_internal
    check (link is null or (link ~ '^/([^/\\]|$)' and link !~ '[[:cntrl:]]')),
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

-- ---------------------------------------------------------------------------
-- Dedupe record: which keyed alerts each user has been sent. Service role
-- only — RLS on with no policy, and no grant to signed-in users — because a
-- key a user could delete is a key the cron would send again.
-- ---------------------------------------------------------------------------
create table if not exists public.notification_dedupe (
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  dedupe_key text not null,
  created_at timestamptz not null default now(),
  primary key (recipient_id, dedupe_key)
);

alter table public.notification_dedupe enable row level security;

revoke all on public.notification_dedupe from anon, authenticated;
grant select, insert, update, delete on public.notification_dedupe to service_role;

-- Keys already in an inbox count as sent (a no-op on the first run, where the
-- inbox is new as well).
insert into public.notification_dedupe (recipient_id, dedupe_key, created_at)
select n.recipient_id, n.dedupe_key, min(n.created_at)
from public.notifications n
where n.dedupe_key is not null
group by n.recipient_id, n.dedupe_key
on conflict do nothing;

-- The fan-out's only write path (src/server/notifications/store.ts). A row
-- with a dedupe_key is written only when this call claims its key; one whose
-- key was claimed before — even if the user has since cleared that row from
-- their inbox — is skipped. Rows without a key are always written. Claims and
-- rows land in one statement, so a failed write releases its claims. Returns
-- the rows written: the recipients to push to.
create or replace function public.insert_notifications(p_rows jsonb)
returns table (id uuid, recipient_id uuid)
language sql
security definer
set search_path = public
as $$
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

revoke execute on function public.insert_notifications(jsonb) from public, anon, authenticated;
grant execute on function public.insert_notifications(jsonb) to service_role;

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
  constraint push_endpoint_https check (endpoint like 'https://%'),
  constraint push_endpoint_length check (length(endpoint) <= 2048)
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

-- Every notification makes the server POST to each of the recipient's
-- endpoints, so only a real push service is accepted (anything else would let
-- a user aim those requests at a host of their choosing): https on the default
-- port, no credentials, and a host of FCM (Chrome), Mozilla (Firefox), Apple
-- (Safari) or WNS (Edge on Windows). Mirrored, with the length limits, in
-- lib/domain/notification-input.ts. A user keeps their 10 most recently seen
-- devices: registering an 11th drops the one seen longest ago.
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
