-- ============================================================================
-- BSS Solar — Production bootstrap (run ONCE after creating the Auth users)
--
-- 1. Supabase Dashboard → Authentication → Users → Add user (tick Auto confirm)
--    Create the admin, and the Super Admin if you want one.
-- 2. Edit the two emails below to match those users.
-- 3. Run this in SQL Editor.
--
-- Do NOT run seed.sql on production.
-- ============================================================================

-- ---------- Admin (office staff) --------------------------------------------
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

-- ---------- Super Admin (highest privilege) ---------------------------------
-- The single account allowed to DELETE users, projects and work orders, on top
-- of everything an admin can do.
--
-- This role is IMMUTABLE from the application: nobody — not an admin, not even
-- the Super Admin — can grant, revoke or reassign it through the UI. A database
-- trigger rejects any such change from a signed-in user, and a partial unique
-- index allows exactly one holder. This statement is therefore the ONLY way to
-- appoint or move the seat, and the recovery path if the account is ever lost.
--
-- To hand the seat to someone else, demote the current holder in the SAME run
-- (uncomment both statements) — the unique index refuses a second holder.

-- update public.profiles set role = 'admin' where role = 'superadmin';

update public.profiles
set
  role = 'superadmin',
  full_name = 'BSS Super Admin'
where id = (
  select id from auth.users
  where email = 'superadmin@bsssolar.in'  -- ← change to your Super Admin email
  limit 1
);

-- ---------- Verify ----------------------------------------------------------
select p.id, p.full_name, p.role, u.email
from public.profiles p
join auth.users u on u.id = p.id
where p.role in ('admin', 'superadmin')
order by p.role desc, p.full_name;
