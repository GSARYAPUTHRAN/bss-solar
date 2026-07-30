-- ============================================================================
-- BSS Solar - Local demo seed
-- Runs automatically on `supabase start` (first time) and `supabase db reset`.
--
-- Demo credentials (password for all staff: Coord@12345 / Admin@12345):
--   SuperAdmin   -> super@bsssolar.test   (BSS SuperAdmin)  Super@12345
--   Admin        -> admin@bsssolar.test
--   Coordinator  -> coord@bsssolar.test   (Rahul Menon)
--   Coordinator  -> priya@bsssolar.test   (Priya Suresh)
--   Coordinator  -> arun@bsssolar.test    (Arun Krishnan)
--   Coordinator  -> sneha@bsssolar.test    (Sneha Das)
--
-- NOTE: For local development only. Never run this against production.
-- ============================================================================

-- Fixed UUIDs
-- admin       : 00000000-0000-0000-0000-000000000001
-- coord rahul : 00000000-0000-0000-0000-000000000002
-- coord priya : 00000000-0000-0000-0000-000000000003
-- coord arun  : 00000000-0000-0000-0000-000000000004
-- coord sneha : 00000000-0000-0000-0000-000000000005
-- superadmin  : 00000000-0000-0000-0000-000000000006

-- ---------- Auth users ----------
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
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-0000-0000-000000000003',
    'authenticated', 'authenticated',
    'priya@bsssolar.test',
    crypt('Coord@12345', gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}',
    '{"full_name":"Priya Suresh"}',
    now(), now(), '', '', '', ''
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-0000-0000-000000000004',
    'authenticated', 'authenticated',
    'arun@bsssolar.test',
    crypt('Coord@12345', gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}',
    '{"full_name":"Arun Krishnan"}',
    now(), now(), '', '', '', ''
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-0000-0000-000000000005',
    'authenticated', 'authenticated',
    'sneha@bsssolar.test',
    crypt('Coord@12345', gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}',
    '{"full_name":"Sneha Das"}',
    now(), now(), '', '', '', ''
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-0000-0000-000000000006',
    'authenticated', 'authenticated',
    'super@bsssolar.test',
    crypt('Super@12345', gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}',
    '{"full_name":"BSS SuperAdmin"}',
    now(), now(), '', '', '', ''
  );

-- ---------- Auth identities ----------
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
  ),
  (
    '00000000-0000-0000-0000-000000000003',
    '00000000-0000-0000-0000-000000000003',
    '{"sub":"00000000-0000-0000-0000-000000000003","email":"priya@bsssolar.test"}',
    'email', now(), now(), now()
  ),
  (
    '00000000-0000-0000-0000-000000000004',
    '00000000-0000-0000-0000-000000000004',
    '{"sub":"00000000-0000-0000-0000-000000000004","email":"arun@bsssolar.test"}',
    'email', now(), now(), now()
  ),
  (
    '00000000-0000-0000-0000-000000000005',
    '00000000-0000-0000-0000-000000000005',
    '{"sub":"00000000-0000-0000-0000-000000000005","email":"sneha@bsssolar.test"}',
    'email', now(), now(), now()
  ),
  (
    '00000000-0000-0000-0000-000000000006',
    '00000000-0000-0000-0000-000000000006',
    '{"sub":"00000000-0000-0000-0000-000000000006","email":"super@bsssolar.test"}',
    'email', now(), now(), now()
  );

-- ---------- Profiles ----------
update public.profiles
  set role = 'admin', phone = '+91 471 2439322'
  where id = '00000000-0000-0000-0000-000000000001';

-- The single SuperAdmin (owns deletes for users / projects / work orders).
update public.profiles
  set role = 'superadmin', phone = '+91 471 2439300'
  where id = '00000000-0000-0000-0000-000000000006';

update public.profiles set phone = '+91 98470 10001' where id = '00000000-0000-0000-0000-000000000002';
update public.profiles set phone = '+91 98470 10002' where id = '00000000-0000-0000-0000-000000000003';
update public.profiles set phone = '+91 98470 10003' where id = '00000000-0000-0000-0000-000000000004';
update public.profiles set phone = '+91 98470 10004' where id = '00000000-0000-0000-0000-000000000005';

-- ---------- Work Orders ----------
insert into public.work_orders (
  id, coordinator_id, client_name, client_phone, address,
  plant_capacity, advance_amount, total_cost, order_date, status
) values
  -- Rahul
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002',
   'Anand Kumar', '+91 98470 11111', 'Vytilla, Kochi, Kerala',
   '3kW', 20000, 195000, current_date - 30, 'approved'),
  ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000002',
   'Meera Nair', '+91 98470 22222', 'Kowdiar, Thiruvananthapuram, Kerala',
   '5kW', 30000, 310000, current_date - 10, 'pending'),
  ('10000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000002',
   'Joseph Thomas', '+91 98470 33333', 'Thrissur Round, Kerala',
   '8kW', 50000, 480000, current_date - 3, 'pending'),
  ('10000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000002',
   'Vijay Menon', '+91 98470 44444', 'Aluva, Ernakulam, Kerala',
   '5kW', 25000, 285000, current_date - 18, 'approved'),
  ('10000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000002',
   'Mary Jose', '+91 98470 55555', 'Pala, Kottayam, Kerala',
   '5kW', 40000, 320000, current_date - 90, 'approved'),
  -- Priya
  ('10000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000003',
   'Sajan Mathew', '+91 98470 66666', 'Kakkanad, Kochi, Kerala',
   '3kW', 15000, 175000, current_date - 14, 'approved'),
  ('10000000-0000-0000-0000-000000000007', '00000000-0000-0000-0000-000000000003',
   'Lakshmi Devi', '+91 98470 77777', 'Kazhakootam, Thiruvananthapuram, Kerala',
   '8kW', 60000, 520000, current_date - 22, 'approved'),
  ('10000000-0000-0000-0000-000000000008', '00000000-0000-0000-0000-000000000003',
   'Ramesh Pillai', '+91 98470 88888', 'Attingal, Kerala',
   '2kW', 10000, 125000, current_date - 5, 'pending'),
  -- Arun
  ('10000000-0000-0000-0000-000000000009', '00000000-0000-0000-0000-000000000004',
   'George Varghese', '+91 98470 99999', 'Angamaly, Kerala',
   '5kW', 35000, 295000, current_date - 40, 'approved'),
  ('10000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000004',
   'Deepa Pillai', '+91 98470 10101', 'Perumbavoor, Kerala',
   '10kW', 80000, 650000, current_date - 55, 'approved'),
  ('10000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000004',
   'Sunil Kumar', '+91 98470 20202', 'Muvattupuzha, Kerala',
   '3kW', 18000, 188000, current_date - 7, 'rejected'),
  -- Sneha
  ('10000000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-000000000005',
   'Rajesh Babu', '+91 98470 30303', 'Neyyattinkara, Kerala',
   '3kW', 22000, 198000, current_date - 48, 'approved'),
  ('10000000-0000-0000-0000-000000000013', '00000000-0000-0000-0000-000000000005',
   'Asha Mohan', '+91 98470 40404', 'Varkala, Kerala',
   '5kW', 28000, 305000, current_date - 12, 'pending'),
  -- Commissioned AND fully collected — the counterpart to Mary Jose below.
  ('10000000-0000-0000-0000-000000000014', '00000000-0000-0000-0000-000000000005',
   'Latha Krishnan', '+91 98470 50505', 'Kollam, Kerala',
   '4kW', 30000, 260000, current_date - 120, 'approved');

-- ---------- Extended work-order details (consumer no., KSEB, loan, payments) --
update public.work_orders set
  consumer_number = '1156789012345', kseb_section = 'Vytilla',
  loan_bank_name = 'State Bank of India',
  notes = 'Roof facing south-west; scaffolding needed for the north array.',
  first_payment_date = current_date - 20, first_payment_amount = 80000
  where id = '10000000-0000-0000-0000-000000000001';

update public.work_orders set
  consumer_number = '1156789054321', kseb_section = 'Aluva',
  loan_bank_name = 'Federal Bank',
  first_payment_date = current_date - 12, first_payment_amount = 120000
  where id = '10000000-0000-0000-0000-000000000004';

-- Mary Jose: plant is COMMISSIONED but ₹1,80,000 is still outstanding.
update public.work_orders set
  consumer_number = '1156789099999', kseb_section = 'Pala',
  loan_bank_name = 'Canara Bank',
  notes = 'Second instalment pending — customer awaiting subsidy credit.',
  first_payment_date = current_date - 70, first_payment_amount = 100000
  where id = '10000000-0000-0000-0000-000000000005';

-- Latha Krishnan: commissioned and paid in full (advance + both instalments).
update public.work_orders set
  consumer_number = '1156789077777', kseb_section = 'Kollam',
  loan_bank_name = 'Union Bank of India',
  first_payment_date = current_date - 100, first_payment_amount = 130000,
  second_payment_date = current_date - 60, second_payment_amount = 100000
  where id = '10000000-0000-0000-0000-000000000014';

-- ---------- Projects (trigger seeds 9 milestones each) ----------
insert into public.projects (
  id, work_order_id, coordinator_id, current_stage, is_completed, started_at, completed_at
) values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-000000000002', 'material_dispatch', false, now() - interval '25 days', null),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000004',
   '00000000-0000-0000-0000-000000000002', 'structure_fabrication', false, now() - interval '15 days', null),
  ('20000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000006',
   '00000000-0000-0000-0000-000000000003', 'site_feasibility_survey', false, now() - interval '12 days', null),
  ('20000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000007',
   '00000000-0000-0000-0000-000000000003', 'kseb_portal_registration', false, now() - interval '20 days', null),
  ('20000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000009',
   '00000000-0000-0000-0000-000000000004', 'panel_installation', false, now() - interval '35 days', null),
  ('20000000-0000-0000-0000-000000000006', '10000000-0000-0000-0000-000000000010',
   '00000000-0000-0000-0000-000000000004', 'wcr_submitted', false, now() - interval '50 days', null),
  ('20000000-0000-0000-0000-000000000007', '10000000-0000-0000-0000-000000000012',
   '00000000-0000-0000-0000-000000000005', 'kseb_inspection_meter', false, now() - interval '42 days', null),
  ('20000000-0000-0000-0000-000000000008', '10000000-0000-0000-0000-000000000005',
   '00000000-0000-0000-0000-000000000002', 'plant_commissioning', true, now() - interval '85 days', now() - interval '5 days'),
  ('20000000-0000-0000-0000-000000000009', '10000000-0000-0000-0000-000000000014',
   '00000000-0000-0000-0000-000000000005', 'plant_commissioning', true, now() - interval '115 days', now() - interval '40 days');

-- ---------- Milestone progress per project ----------
-- Helper: complete sort_orders 1..(n-1), set sort_order n in_progress

-- P1: material_dispatch (sort 4)
update public.project_milestones set status = 'completed', completed_at = now() - interval '22 days'
  where project_id = '20000000-0000-0000-0000-000000000001' and sort_order < 4;
update public.project_milestones set status = 'in_progress'
  where project_id = '20000000-0000-0000-0000-000000000001' and sort_order = 4;

-- P2: structure_fabrication (sort 5)
update public.project_milestones set status = 'completed', completed_at = now() - interval '12 days'
  where project_id = '20000000-0000-0000-0000-000000000002' and sort_order < 5;
update public.project_milestones set status = 'in_progress'
  where project_id = '20000000-0000-0000-0000-000000000002' and sort_order = 5;

-- P3: site_feasibility_survey (sort 1)
update public.project_milestones set status = 'in_progress'
  where project_id = '20000000-0000-0000-0000-000000000003' and sort_order = 1;

-- P4: kseb_portal_registration (sort 2)
update public.project_milestones set status = 'completed', completed_at = now() - interval '18 days'
  where project_id = '20000000-0000-0000-0000-000000000004' and sort_order < 2;
update public.project_milestones set status = 'in_progress'
  where project_id = '20000000-0000-0000-0000-000000000004' and sort_order = 2;

-- P5: panel_installation (sort 6)
update public.project_milestones set status = 'completed', completed_at = now() - interval '28 days'
  where project_id = '20000000-0000-0000-0000-000000000005' and sort_order < 6;
update public.project_milestones set status = 'in_progress'
  where project_id = '20000000-0000-0000-0000-000000000005' and sort_order = 6;

-- P6: wcr_submitted (sort 7)
update public.project_milestones set status = 'completed', completed_at = now() - interval '40 days'
  where project_id = '20000000-0000-0000-0000-000000000006' and sort_order < 7;
update public.project_milestones set status = 'in_progress'
  where project_id = '20000000-0000-0000-0000-000000000006' and sort_order = 7;

-- P7: kseb_inspection_meter (sort 8)
update public.project_milestones set status = 'completed', completed_at = now() - interval '35 days'
  where project_id = '20000000-0000-0000-0000-000000000007' and sort_order < 8;
update public.project_milestones set status = 'in_progress'
  where project_id = '20000000-0000-0000-0000-000000000007' and sort_order = 8;

-- P8: plant_commissioning — fully commissioned (payment still outstanding)
update public.project_milestones set status = 'completed', completed_at = now() - interval '5 days'
  where project_id = '20000000-0000-0000-0000-000000000008';

-- P9: plant_commissioning — fully commissioned and fully paid
update public.project_milestones set status = 'completed', completed_at = now() - interval '40 days'
  where project_id = '20000000-0000-0000-0000-000000000009';

-- ---------- Service Tickets ----------
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
  ),
  (
    '30000000-0000-0000-0000-000000000002',
    '20000000-0000-0000-0000-000000000005',
    'BSS-2606-1002', 'adhoc', 'in_progress',
    '00000000-0000-0000-0000-000000000004',
    current_date - 1, null,
    '5kW', 'Microtek', 'MSUN-5000', 'SN-5KW-00456',
    '200AH', 'Luminous', 4, 1,
    '540W', 'Waaree', 10, 5400, 2,
    '[]'::jsonb, '[]'::jsonb,
    null, null, null,
    'Inverter showing fault code E05 after recent rains',
    null, null,
    0, 0, 0, 0,
    '00000000-0000-0000-0000-000000000001'
  ),
  (
    '30000000-0000-0000-0000-000000000003',
    '20000000-0000-0000-0000-000000000008',
    'BSS-2606-1003', 'routine_6m', 'completed',
    '00000000-0000-0000-0000-000000000002',
    current_date - 30, current_date - 30,
    '5kW', 'Su-Kam', 'Shark 5000', 'SN-5KW-00789',
    '150AH', 'Exide', 4, 1,
    '545W', 'Adani', 10, 5450, 2,
    '[{"string":1,"voltage":"390","ampere":"8.1"},{"string":2,"voltage":"388","ampere":"7.9"}]'::jsonb,
    '[{"mppt":1,"in_volt":"395","out_volt":"230","in_ampere":"8.0","out_ampere":"14.2"}]'::jsonb,
    '27.1', '12.5', 'Normal',
    'Post-commissioning 6-month check',
    'None',
    'All parameters within range; plant commissioned successfully',
    1200, 0, 500, 1700,
    '00000000-0000-0000-0000-000000000001'
  ),
  (
    '30000000-0000-0000-0000-000000000004',
    '20000000-0000-0000-0000-000000000007',
    'BSS-2606-1004', 'routine_6m', 'scheduled',
    '00000000-0000-0000-0000-000000000005',
    current_date + 7, null,
    '3kW', 'Luminous', 'NXG-3000', 'SN-3KW-00234',
    '150AH', 'Exide', 2, 1,
    '545W', 'Adani', 6, 3270, 1,
    '[]'::jsonb, '[]'::jsonb,
    null, null, null,
    'Scheduled routine check before KSEB meter inspection',
    null, null,
    0, 0, 0, 0,
    '00000000-0000-0000-0000-000000000001'
  );
