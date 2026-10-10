-- ============================================================================
-- BSS Solar — Bulk project import, as one atomic-per-row database call
-- ----------------------------------------------------------------------------
-- The onboarding importer used to make ~8 HTTP round trips per CSV row with the
-- service-role key (insert work order, insert project, read milestones, update
-- milestones twice, update project …). A failure part-way left a half-imported
-- row behind, and a large file risked the serverless time limit.
--
-- `import_projects` takes rows the app has already validated and normalised
-- (lib/domain/import.ts) and, for each row, inside its own subtransaction:
--   resolves the coordinator (by email, in SQL — no auth admin API paging),
--   optionally skips a consumer number that already exists,
--   inserts the approved work order, the project (the trigger seeds the 9
--   milestones), advances the milestones to the requested stage, and records
--   every payment in the ledger.
-- A row either lands completely or not at all; one bad row never affects the
-- others. Runs with the caller's identity for authorisation (office only) and
-- for `payments.recorded_by`.
--
-- Input row (JSON): row_no, client_name, client_phone, address, plant_capacity,
--   total_cost, advance_amount, order_date, coordinator_email, current_stage,
--   is_completed, commissioned_on, consumer_number, kseb_section,
--   financing_type, loan_bank_name, notes, feasibility_date,
--   coordinator_incentive, incentive_paid_on,
--   payments: [{amount, paid_on, method, purpose, reference, notes}]
-- Output: one row per input row — status 'imported' | 'skipped' | 'failed'.
-- Idempotent definition; safe to re-run.
-- ============================================================================

begin;

create or replace function public.import_projects(
  p_rows jsonb,
  p_default_coordinator uuid,
  p_skip_existing boolean default true
)
returns table (row_no integer, status text, message text, work_order_id uuid)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  r jsonb;
  pay jsonb;
  v_row integer;
  v_email text;
  v_coordinator uuid;
  v_consumer text;
  v_existing text;
  v_wo uuid;
  v_project uuid;
  v_stage project_stage;
  v_target integer;
  v_completed boolean;
  v_completed_at timestamptz;
  v_order_date date;
begin
  if not is_admin() then
    raise exception 'Only office staff can import projects' using errcode = '42501';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'p_rows must be a JSON array' using errcode = '22023';
  end if;
  if not exists (
    select 1 from profiles
    where id = p_default_coordinator
      and role::text in ('coordinator', 'admin', 'superadmin')
  ) then
    raise exception 'The default coordinator must be a coordinator or office account'
      using errcode = '22023';
  end if;

  for r in select value from jsonb_array_elements(p_rows) loop
    v_row := (r->>'row_no')::integer;

    begin
      -- Coordinator: an email must match a sales/office account exactly. A
      -- silent fallback would misattribute the project (and its incentive).
      v_email := nullif(lower(btrim(r->>'coordinator_email')), '');
      v_coordinator := null;
      if v_email is null then
        v_coordinator := p_default_coordinator;
      else
        select p.id into v_coordinator
        from auth.users u
        join profiles p on p.id = u.id
        where lower(u.email) = v_email
          and p.role::text in ('coordinator', 'admin', 'superadmin');
        if v_coordinator is null then
          raise exception 'coordinator_email "%" is not a coordinator or office account', v_email;
        end if;
      end if;

      v_consumer := nullif(btrim(r->>'consumer_number'), '');
      if p_skip_existing and v_consumer is not null then
        select w.client_name into v_existing
        from work_orders w
        where w.consumer_number = v_consumer
        limit 1;
        if found then
          row_no := v_row;
          status := 'skipped';
          message := format('Consumer number %s already exists (%s)', v_consumer, v_existing);
          work_order_id := null;
          return next;
          continue;
        end if;
      end if;

      v_order_date := coalesce(nullif(r->>'order_date', '')::date, ist_today());

      insert into work_orders (
        coordinator_id, client_name, client_phone, address, plant_capacity,
        advance_amount, total_cost, order_date, status, consumer_number,
        kseb_section, financing_type, loan_bank_name, notes
      ) values (
        v_coordinator,
        btrim(r->>'client_name'),
        nullif(btrim(r->>'client_phone'), ''),
        nullif(btrim(r->>'address'), ''),
        btrim(r->>'plant_capacity'),
        coalesce(nullif(r->>'advance_amount', '')::numeric, 0),
        (r->>'total_cost')::numeric,
        v_order_date,
        'approved',
        v_consumer,
        nullif(btrim(r->>'kseb_section'), ''),
        coalesce(nullif(r->>'financing_type', '')::financing_type, 'self'),
        nullif(btrim(r->>'loan_bank_name'), ''),
        nullif(btrim(r->>'notes'), '')
      )
      returning id into v_wo;

      v_completed := coalesce((r->>'is_completed')::boolean, false);
      v_completed_at := case
        when v_completed then coalesce(
          (nullif(r->>'commissioned_on', '')::date + time '12:00')
            at time zone 'Asia/Kolkata',
          now()
        )
      end;

      insert into projects (
        work_order_id, coordinator_id, started_at, feasibility_date,
        coordinator_incentive, incentive_paid_on
      ) values (
        v_wo,
        v_coordinator,
        v_order_date::timestamp at time zone 'Asia/Kolkata',
        nullif(r->>'feasibility_date', '')::date,
        nullif(r->>'coordinator_incentive', '')::numeric,
        nullif(r->>'incentive_paid_on', '')::date
      )
      returning id into v_project;

      -- The insert trigger seeded the 9 milestones; advance them to the stage.
      v_stage := case
        when v_completed then 'plant_commissioning'::project_stage
        else coalesce(nullif(r->>'current_stage', '')::project_stage,
                      'site_feasibility_survey')
      end;
      select m.sort_order into v_target
      from project_milestones m
      where m.project_id = v_project and m.stage = v_stage;

      update project_milestones
         set status = 'completed',
             completed_at = coalesce(v_completed_at, now())
       where project_id = v_project
         and (v_completed or sort_order < v_target);

      if not v_completed then
        update project_milestones
           set status = 'in_progress', completed_at = null
         where project_id = v_project and sort_order = v_target;
      end if;

      update projects
         set current_stage = v_stage,
             is_completed = v_completed,
             completed_at = v_completed_at
       where id = v_project;

      for pay in
        select value from jsonb_array_elements(coalesce(r->'payments', '[]'::jsonb))
      loop
        insert into payments (
          work_order_id, amount, paid_on, method, purpose, reference, notes,
          recorded_by
        ) values (
          v_wo,
          (pay->>'amount')::numeric,
          (pay->>'paid_on')::date,
          coalesce(nullif(pay->>'method', '')::payment_method, 'other'),
          coalesce(nullif(pay->>'purpose', '')::payment_purpose, 'contract'),
          nullif(btrim(pay->>'reference'), ''),
          nullif(btrim(pay->>'notes'), ''),
          auth.uid()
        );
      end loop;

      row_no := v_row;
      status := 'imported';
      message := null;
      work_order_id := v_wo;
      return next;
    exception when others then
      -- The subtransaction for this row is rolled back in full.
      row_no := v_row;
      status := 'failed';
      message := sqlerrm;
      work_order_id := null;
      return next;
    end;
  end loop;
end;
$$;

revoke execute on function public.import_projects(jsonb, uuid, boolean) from public, anon;
grant execute on function public.import_projects(jsonb, uuid, boolean) to authenticated, service_role;

commit;
