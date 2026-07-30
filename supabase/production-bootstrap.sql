-- ============================================================================
-- BSS Solar — Production bootstrap (run ONCE after creating the first Auth user)
--
-- 1. Supabase Dashboard → Authentication → Users → Add user
-- 2. Edit the email below to match that user
-- 3. Run this in SQL Editor
--
-- Do NOT run seed.sql on production.
-- ============================================================================

-- Promote first staff user to admin
update public.profiles
set
  role = 'admin',
  full_name = 'BSS Admin',
  phone = '+91 471 2439322'
where id = (
  select id from auth.users
  where email = 'admin@bsssolar.in'  -- ← change to your admin email
  limit 1
);

-- ============================================================================
-- SuperAdmin (optional, run once) — the single account allowed to DELETE users,
-- projects and work orders. Everything else an admin can do, it can do too.
--
-- You do NOT need SQL for this: while the seat is vacant any admin can appoint
-- the first holder from Team → role menu. Use the statement below only to
-- appoint (or recover) it directly against the database.
--
-- A partial unique index allows exactly one, so demote the current holder first:
--   update public.profiles set role = 'admin' where role = 'superadmin';
-- ============================================================================

-- update public.profiles
-- set role = 'superadmin'
-- where id = (
--   select id from auth.users
--   where email = 'superadmin@bsssolar.in'  -- ← change to your SuperAdmin email
--   limit 1
-- );

-- Verify
select p.id, p.full_name, p.role, u.email
from public.profiles p
join auth.users u on u.id = p.id
where p.role in ('admin', 'superadmin')
order by p.role desc;
