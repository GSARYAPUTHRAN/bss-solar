-- ============================================================================
-- BSS Solar - Local demo seed
-- Runs automatically on `supabase start` (first time) and `supabase db reset`.
--
-- Demo credentials:
--   Admin       -> admin@bsssolar.test / Admin@12345
--   Coordinator -> coord@bsssolar.test / Coord@12345
--
-- NOTE: For local development only. Never run this against production.
-- ============================================================================

-- Fixed UUIDs so the data is stable across resets
-- admin       : 00000000-0000-0000-0000-000000000001
-- coordinator : 00000000-0000-0000-0000-000000000002

-- ---------- Auth users ----------
-- Inserting into auth.users fires the handle_new_user() trigger,
-- which auto-creates a matching row in public.profiles (role = coordinator).
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
) values
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-0000-0000-000000000001',
    'authenticated', 'authenticated',
    'admin@bsssolar.test',
    crypt('Admin@12345', gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}',
    '{"full_name":"BSS Admin"}',
    now(), now(), '', '', '', ''
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-0000-0000-000000000002',
    'authenticated', 'authenticated',
    'coord@bsssolar.test',
    crypt('Coord@12345', gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}',
    '{"full_name":"Rahul Menon"}',
    now(), now(), '', '', '', ''
  );

-- ---------- Auth identities (required for email/password sign-in) ----------
insert into auth.identities (
  provider_id, user_id, identity_data, provider,
  last_sign_in_at, created_at, updated_at
) values
  (
    '00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000001',
    '{"sub":"00000000-0000-0000-0000-000000000001","email":"admin@bsssolar.test"}',
    'email', now(), now(), now()
  ),
  (
    '00000000-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000002',
    '{"sub":"00000000-0000-0000-0000-000000000002","email":"coord@bsssolar.test"}',
    'email', now(), now(), now()
  );

-- ---------- Promote the admin + set phones ----------
update public.profiles
  set role = 'admin', phone = '+91 90000 00001'
  where id = '00000000-0000-0000-0000-000000000001';

update public.profiles
  set phone = '+91 90000 00002'
  where id = '00000000-0000-0000-0000-000000000002';

-- ---------- Sample Work Orders ----------
-- WO1: approved (will become a project below)
insert into public.work_orders (
  id, coordinator_id, client_name, client_phone, address,
  plant_capacity, advance_amount, total_cost, order_date, status
) values
  (
    '10000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000002',
    'Anand Kumar', '+91 98470 11111', 'Vytilla, Kochi, Kerala',
    '3kW', 20000, 195000, current_date - 30, 'approved'
  ),
  (
    '10000000-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000002',
    'Meera Nair', '+91 98470 22222', 'Kowdiar, Thiruvananthapuram, Kerala',
    '5kW', 30000, 310000, current_date - 10, 'pending'
  ),
  (
    '10000000-0000-0000-0000-000000000003',
    '00000000-0000-0000-0000-000000000002',
    'Joseph Thomas', '+91 98470 33333', 'Thrissur Round, Kerala',
    '8kW', 50000, 480000, current_date - 3, 'pending'
  );

-- ---------- Sample Project for the approved WO ----------
-- Inserting a project fires seed_project_milestones() -> 8 milestones created.
insert into public.projects (
  id, work_order_id, coordinator_id, current_stage, started_at
) values
  (
    '20000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000002',
    'material_dispatch',
    now() - interval '25 days'
  );

-- Mark early milestones as done / in-progress to make the tracker look realistic
update public.project_milestones
  set status = 'completed', completed_at = now() - interval '20 days'
  where project_id = '20000000-0000-0000-0000-000000000001'
    and sort_order <= 3;

update public.project_milestones
  set status = 'in_progress'
  where project_id = '20000000-0000-0000-0000-000000000001'
    and sort_order = 4;

-- ---------- Sample Service Ticket on the project ----------
insert into public.service_tickets (
  id, project_id, ticket_no, ticket_type, status, assigned_to,
  scheduled_date, service_date,
  sys_capacity, sys_make, sys_model, sys_serial_no,
  bat_capacity_ah, bat_make, bat_qty, bat_bank_nos,
  spv_module_capacity, spv_make, spv_total_nos, spv_total_watts, spv_no_of_strings,
  spv_string_readings, mppt_readings,
  battery_voltage, charging_current, battery_water_level,
  nature_of_complaint, defects_found, action_taken,
  service_charge, cost_of_spares, amc_charge, total,
  created_by
) values
  (
    '30000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000001',
    'BSS-2606-1001', 'routine_6m', 'completed',
    '00000000-0000-0000-0000-000000000002',
    current_date - 5, current_date - 5,
    '3kW', 'Luminous', 'NXG-3000', 'SN-3KW-00123',
    '150AH', 'Exide', 2, 1,
    '545W', 'Adani', 6, 3270, 1,
    '[{"string":1,"voltage":"385","ampere":"7.8"}]'::jsonb,
    '[{"mppt":1,"in_volt":"390","out_volt":"230","in_ampere":"7.5","out_ampere":"12.8"}]'::jsonb,
    '26.4', '11.2', 'Normal',
    'Routine 6-month preventive maintenance',
    'Minor dust accumulation on panels; loose DC connector',
    'Cleaned panels, re-terminated DC connector, tightened structure bolts',
    1500, 350, 0, 1850,
    '00000000-0000-0000-0000-000000000001'
  );
