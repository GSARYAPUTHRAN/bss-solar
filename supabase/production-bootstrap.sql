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

-- Verify
select p.id, p.full_name, p.role, u.email
from public.profiles p
join auth.users u on u.id = p.id
where p.role = 'admin';
