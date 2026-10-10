-- ============================================================================
-- BSS Solar — Production bootstrap (run ONCE after creating the Auth users)
--
-- 1. Supabase Dashboard → Authentication → Users → Add user (tick Auto confirm).
--    Create the admin, and the Super Admin if you want one. You choose their
--    passwords there — this script never sets or contains a password.
-- 2. Edit the two emails below to match those users EXACTLY.
-- 3. Run this in SQL Editor and read the output of each statement.
--
-- Each UPDATE ends in RETURNING, so it reports what it changed:
--   one row back  -> applied
--   ZERO rows back -> no auth user has that email. Nothing happened. Fix the
--                     email (or create the user first) and run it again.
--   A bare `UPDATE 0` is the failure mode this guards against — Postgres does
--   not raise when a `where id = (select …)` subquery finds nothing.
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
)
returning id, full_name, role;

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
-- (uncomment the line below) — the unique index refuses a second holder.

-- update public.profiles set role = 'admin' where role = 'superadmin';

update public.profiles
set
  role = 'superadmin',
  full_name = 'BSS Super Admin'
where id = (
  select id from auth.users
  where email = 'superadmin@bsssolar.in'  -- ← change to your Super Admin email
  limit 1
)
returning id, full_name, role;

-- ---------- Verify ----------------------------------------------------------
-- Expect one 'superadmin' row and at least one 'admin' row. If the superadmin
-- row is missing, the UPDATE above matched nothing — see the note in the header.
select p.id, p.full_name, p.role, u.email
from public.profiles p
join auth.users u on u.id = p.id
where p.role in ('admin', 'superadmin')
order by p.role desc, p.full_name;

-- ---------- Troubleshooting -------------------------------------------------
-- Every account and the role it currently holds, to find an email typo:
-- select u.email, p.full_name, p.role,
--        u.email_confirmed_at is not null as confirmed
-- from auth.users u
-- left join public.profiles p on p.id = u.id
-- order by p.role desc nulls last, u.email;
