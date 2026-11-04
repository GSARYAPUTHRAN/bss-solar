-- ============================================================================
-- BSS Solar — Bulk project import v4: advance details, refunds and write-offs,
-- KSEB fees paid by the office, incentive instalments (2026-11-04)
-- ----------------------------------------------------------------------------
-- Same signature and return type as before (a replace, never an overload), and
-- every v3 row shape is still accepted. For each row, inside its own
-- subtransaction: resolves who shares the sale, optionally skips a consumer
-- number that already exists, inserts the approved work order, its extra
-- coordinators, the project (the plan's milestones are seeded by trigger),
-- advances the milestones to the requested stage, sets the cancellation, the
-- incentives (agreed amount first, then each dated instalment — the triggers
-- enforce the rules) and every payment. A row lands completely or not at all;
-- one bad row never affects the others. Office only; runs with the caller's
-- identity for payments.recorded_by, cancelled_by and the incentive stamps.
-- Concurrent imports run one after the other. A commissioning date the sheet
-- does not give stays unknown — it is never invented.
--
-- Input row (JSON): row_no, client_name, client_phone, address, plant_capacity
--   (the plan label), plan_type ('solar' | 'custom', default solar), total_cost,
--   advance_amount, advance_method, advance_paid_on, advance_reference,
--   order_date, coordinator_ids [uuid, 1..max_sale_coordinators(), first = first
--   coordinator], current_stage, is_completed, commissioned_on, consumer_number,
--   kseb_section, financing_type, loan_bank_name, notes, feasibility_date,
--   cancellation ('cancelled' | 'refunded'), cancelled_on, cancellation_remarks,
--   incentives: [{coordinator_id, amount (the agreed total),
--                 payments: [{amount, paid_on, note}]}]
--     — or the v3 element {coordinator_id, amount, paid_on}: a paid_on with a
--       positive amount is ONE instalment for the whole amount. An element has
--       either payments or paid_on, and each coordinator appears once;
--   payments: [{amount, paid_on, method, purpose, reference, notes,
--               paid_by_office}] — purpose contract | kseb_fees | refund |
--     write_off; paid_by_office only with kseb_fees; a write_off needs its reason
--     in notes (reference is used when notes is blank).
-- Still accepted from the previous builds: coordinator_email (blank = the
-- default coordinator), coordinator_incentive and incentive_paid_on (its only
-- coordinator's; refused on a shared sale — use incentives).
-- Refund and write-off CAPS are the app's checks (as for the contract stages):
-- the rows arrive validated.
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
  inc jsonb;
  ins jsonb;
  v_row integer;
  v_email text;
  v_ids uuid[];
  v_problem text;
  v_consumer text;
  v_existing text;
  v_wo uuid;
  v_project uuid;
  v_plan plan_type;
  v_stage project_stage;
  v_target integer;
  v_completed boolean;
  v_completed_at timestamptz;
  v_order_date date;
  v_feasibility date;
  v_cancellation project_cancellation;
  v_cancelled_on date;
  v_remarks text;
  v_incentive_for uuid;
  v_incentive_seen uuid[];
  v_incentive_amount numeric;
  v_purpose payment_purpose;
  v_notes text;
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

  -- One import at a time (a double submit, a second tab): a concurrent batch
  -- waits here until this one commits, so its skip-existing check below sees
  -- every consumer number this batch imported.
  perform pg_advisory_xact_lock(hashtext('import_projects'));

  for r in select value from jsonb_array_elements(p_rows) loop
    v_row := (r->>'row_no')::integer;

    begin
      -- 1. Who shares the sale. This build sends resolved, ordered ids; the
      --    build before it sends coordinator_email (blank = the default).
      v_ids := null;
      if jsonb_typeof(r->'coordinator_ids') = 'array'
         and jsonb_array_length(r->'coordinator_ids') > 0 then
        select array_agg(t.x::uuid order by t.ord) into v_ids
        from jsonb_array_elements_text(r->'coordinator_ids') with ordinality t(x, ord);
        if cardinality(v_ids) > max_sale_coordinators() then
          raise exception 'A sale can have at most % coordinators', max_sale_coordinators();
        end if;
        if cardinality(v_ids) <> (select count(distinct u.x) from unnest(v_ids) as u(x)) then
          raise exception 'A coordinator is listed twice';
        end if;
        select string_agg(coalesce(p.full_name, u.x::text), ', ' order by u.ord) into v_problem
        from unnest(v_ids) with ordinality u(x, ord)
        left join profiles p on p.id = u.x
        where p.id is null or p.role::text not in ('coordinator', 'admin', 'superadmin');
        if v_problem is not null then
          raise exception 'Not a coordinator or office account: %', v_problem;
        end if;
      else
        v_email := nullif(lower(btrim(r->>'coordinator_email')), '');
        if v_email is null then
          v_ids := array[p_default_coordinator];
        else
          select array[p.id] into v_ids
          from auth.users u
          join profiles p on p.id = u.id
          where lower(u.email) = v_email
            and p.role::text in ('coordinator', 'admin', 'superadmin');
          if v_ids is null then
            raise exception 'coordinator_email "%" is not a coordinator or office account', v_email;
          end if;
        end if;
      end if;

      -- 2. Skip a consumer number already in the system (unchanged).
      v_consumer := nullif(btrim(r->>'consumer_number'), '');
      if p_skip_existing and v_consumer is not null then
        -- Compare ignoring whitespace: "1156 789" and "1156789" are one connection.
        select w.client_name into v_existing
        from work_orders w
        where regexp_replace(w.consumer_number, '\s', '', 'g')
            = regexp_replace(v_consumer, '\s', '', 'g')
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

      -- 3. Plan, completion, clock and cancellation, checked together.
      v_plan := coalesce(nullif(r->>'plan_type', '')::plan_type, 'solar');
      v_order_date := coalesce(nullif(r->>'order_date', '')::date, ist_today());
      v_feasibility := nullif(r->>'feasibility_date', '')::date;
      v_completed := coalesce((r->>'is_completed')::boolean, false);
      v_cancellation := nullif(r->>'cancellation', '')::project_cancellation;
      v_cancelled_on := nullif(r->>'cancelled_on', '')::date;
      v_remarks := nullif(btrim(r->>'cancellation_remarks'), '');
      if v_plan = 'custom' and v_feasibility is not null then
        raise exception 'A custom plan has no KSEB feasibility date';
      end if;
      if v_completed and v_feasibility is not null
         and nullif(r->>'commissioned_on', '') is null then
        raise exception 'commissioned_on is required when a commissioned project has a feasibility_date';
      end if;
      if v_cancellation is null and (v_cancelled_on is not null or v_remarks is not null) then
        raise exception 'cancelled_on and cancellation_remarks need a cancellation';
      end if;
      if v_cancellation is not null and v_feasibility is not null and v_cancelled_on is null then
        raise exception 'cancelled_on is required when a cancelled project has a feasibility_date';
      end if;

      insert into work_orders (
        coordinator_id, client_name, client_phone, address, plant_capacity, plan_type,
        advance_amount, advance_method, advance_paid_on, advance_reference,
        total_cost, order_date, status, consumer_number,
        kseb_section, financing_type, loan_bank_name, notes
      ) values (
        v_ids[1],
        btrim(r->>'client_name'),
        nullif(btrim(r->>'client_phone'), ''),
        nullif(btrim(r->>'address'), ''),
        btrim(r->>'plant_capacity'),
        v_plan,
        coalesce(nullif(r->>'advance_amount', '')::numeric, 0),
        nullif(r->>'advance_method', '')::payment_method,
        nullif(r->>'advance_paid_on', '')::date,
        nullif(btrim(r->>'advance_reference'), ''),
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

      -- The insert trigger added v_ids[1] as first member; add the partners.
      insert into work_order_coordinators (work_order_id, coordinator_id, sort_order, added_by)
      select v_wo, u.x, u.ord::smallint, auth.uid()
      from unnest(v_ids) with ordinality u(x, ord)
      where u.ord > 1;

      -- A commissioning date the sheet does not give stays unknown (never invented).
      v_completed_at := case when v_completed then
        (nullif(r->>'commissioned_on', '')::date + time '12:00') at time zone 'Asia/Kolkata'
      end;

      -- coordinator_id comes from the work order (t_proj_coordinator); the
      -- milestones from the plan (on_project_created).
      insert into projects (work_order_id, started_at, feasibility_date)
      values (v_wo, v_order_date::timestamp at time zone 'Asia/Kolkata', v_feasibility)
      returning id into v_project;

      v_stage := case
        when v_completed then 'plant_commissioning'::project_stage
        else coalesce(
          nullif(r->>'current_stage', '')::project_stage,
          (select m.stage from project_milestones m
            where m.project_id = v_project order by m.sort_order limit 1))
      end;
      select m.sort_order into v_target
      from project_milestones m
      where m.project_id = v_project and m.stage = v_stage;
      if v_target is null then
        raise exception 'current_stage % does not apply to a % plan', v_stage, v_plan;
      end if;

      update project_milestones
         set status = 'completed', completed_at = v_completed_at
       where project_id = v_project and (v_completed or sort_order < v_target);
      if not v_completed then
        update project_milestones
           set status = 'in_progress', completed_at = null
         where project_id = v_project and sort_order = v_target;
      end if;

      update projects
         set current_stage = v_stage,
             is_completed = v_completed,
             completed_at = v_completed_at,
             cancellation = v_cancellation,
             cancelled_on = v_cancelled_on,
             cancellation_remarks = v_remarks
       where id = v_project;

      -- 4. Incentives, one per coordinator: the agreed amount first, then each
      --    dated instalment (coordinator_incentive_payments' triggers refuse an
      --    instalment before the amount, or beyond it). The previous build's
      --    single incentive belongs to its only coordinator.
      if jsonb_typeof(r->'incentives') = 'array' then
        v_incentive_seen := '{}';
        for inc in select value from jsonb_array_elements(r->'incentives') loop
          v_incentive_for := (inc->>'coordinator_id')::uuid;
          if not (v_incentive_for = any (v_ids)) then
            raise exception 'An incentive names someone who is not a coordinator on this sale';
          end if;
          if v_incentive_for = any (v_incentive_seen) then
            raise exception 'An incentive is listed twice for one coordinator';
          end if;
          v_incentive_seen := v_incentive_seen || v_incentive_for;
          if jsonb_typeof(inc->'payments') = 'array'
             and nullif(inc->>'paid_on', '') is not null then
            raise exception 'An incentive takes payments or paid_on, not both';
          end if;

          v_incentive_amount := nullif(inc->>'amount', '')::numeric;
          update coordinator_incentives
             set amount = v_incentive_amount
           where work_order_id = v_wo and coordinator_id = v_incentive_for;

          if jsonb_typeof(inc->'payments') = 'array' then
            for ins in select value from jsonb_array_elements(inc->'payments') loop
              insert into coordinator_incentive_payments
                (work_order_id, coordinator_id, amount, paid_on, note)
              values (
                v_wo, v_incentive_for,
                (ins->>'amount')::numeric,
                (ins->>'paid_on')::date,
                nullif(btrim(ins->>'note'), '')
              );
            end loop;
          elsif nullif(inc->>'paid_on', '') is not null then
            -- The v3 shape: an amount with a paid date is paid in full that day.
            -- A zero incentive has nothing to pay; no amount cannot be paid.
            if v_incentive_amount is null then
              raise exception 'An incentive cannot be paid without an amount';
            elsif v_incentive_amount > 0 then
              insert into coordinator_incentive_payments
                (work_order_id, coordinator_id, amount, paid_on)
              values (v_wo, v_incentive_for, v_incentive_amount, (inc->>'paid_on')::date);
            end if;
          end if;
        end loop;
      elsif nullif(r->>'coordinator_incentive', '') is not null
         or nullif(r->>'incentive_paid_on', '') is not null then
        -- The previous build's single incentive belongs to its only coordinator;
        -- never guess a split. It is written where its project page still reads
        -- it, and the temporary legacy mirror carries it to that coordinator's
        -- own row (a paid date becomes the settling instalment). Dropped with
        -- the mirror in the contract release.
        if cardinality(v_ids) > 1 then
          raise exception 'A shared sale takes its incentives per coordinator (incentives), not coordinator_incentive';
        end if;
        update projects
           set coordinator_incentive = nullif(r->>'coordinator_incentive', '')::numeric,
               incentive_paid_on = nullif(r->>'incentive_paid_on', '')::date
         where id = v_project;
      end if;

      -- 5. Payments. A write-off's reason is its notes (the sheet's reference
      --    column carries it when no notes are given).
      for pay in
        select value from jsonb_array_elements(coalesce(r->'payments', '[]'::jsonb))
      loop
        v_purpose := coalesce(nullif(pay->>'purpose', '')::payment_purpose, 'contract');
        v_notes := nullif(btrim(pay->>'notes'), '');
        if v_purpose = 'write_off' then
          v_notes := coalesce(v_notes, nullif(btrim(pay->>'reference'), ''));
        end if;
        insert into payments (
          work_order_id, amount, paid_on, method, purpose, reference, notes,
          paid_by_office, recorded_by
        ) values (
          v_wo,
          (pay->>'amount')::numeric,
          (pay->>'paid_on')::date,
          coalesce(nullif(pay->>'method', '')::payment_method, 'other'),
          v_purpose,
          nullif(btrim(pay->>'reference'), ''),
          v_notes,
          coalesce((nullif(pay->>'paid_by_office', ''))::boolean, false),
          auth.uid()
        );
      end loop;

      row_no := v_row;
      status := 'imported';
      message := null;
      work_order_id := v_wo;
      return next;
    exception when others then
      -- The row's subtransaction (membership, incentives included) rolls back.
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
