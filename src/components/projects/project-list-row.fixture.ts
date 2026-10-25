import type { ProjectListRow } from "@/lib/types";

/** The seeded coordinators' ids (supabase/seed.sql). */
export const RAHUL = "00000000-0000-0000-0000-000000000002";
export const PRIYA = "00000000-0000-0000-0000-000000000003";
export const ARUN = "00000000-0000-0000-0000-000000000004";

/**
 * A live solar project of one coordinator (Rahul), half-way through, with no
 * incentive set. A test overrides only what it is about. The deprecated
 * single-incentive columns are left blank on purpose: nothing may read them.
 */
export function projectListRow(overrides: Partial<ProjectListRow> = {}): ProjectListRow {
  return {
    id: "20000000-0000-0000-0000-000000000001",
    coordinator_id: RAHUL,
    work_order_id: null,
    current_stage: "panel_installation",
    is_completed: false,
    created_at: "2026-09-01T04:30:00Z",
    started_at: "2026-09-01T04:30:00Z",
    completed_at: null,
    client_name: "Anand Kumar",
    client_phone: null,
    address: null,
    plant_capacity: "3kW",
    plant_capacity_kw: 3,
    total_cost: 195000,
    advance_amount: 20000,
    coordinator_name: "Rahul Menon",
    milestones_done: 4,
    milestones_total: 8,
    consumer_number: null,
    kseb_section: null,
    financing_type: "self",
    loan_bank_name: null,
    payment_pending: false,
    feasibility_date: null,
    feasibility_periods: null,
    feasibility_renewals: null,
    feasibility_valid_until: null,
    feasibility_days_left: null,
    feasibility_extension_cost: 0,
    coordinator_incentive: null,
    incentive_paid_on: null,
    coordinator_ids: [RAHUL],
    coordinator_names: ["Rahul Menon"],
    plan_type: "solar",
    cancellation: null,
    cancelled_on: null,
    cancellation_remarks: null,
    incentive_total: null,
    incentive_unpaid: 0,
    incentive_count: 0,
    incentive_unpaid_count: 0,
    incentive_unpaid_coordinator_ids: [],
    incentive_paid_coordinator_ids: [],
    payments_total: 0,
    payment_count: 0,
    last_payment_on: null,
    amount_received: 20000,
    balance_due: 175000,
    ...overrides,
  };
}

/** A sale shared by Rahul and Priya. */
export function sharedSale(overrides: Partial<ProjectListRow> = {}): ProjectListRow {
  return projectListRow({
    coordinator_ids: [RAHUL, PRIYA],
    coordinator_names: ["Rahul Menon", "Priya Suresh"],
    coordinator_name: "Rahul Menon, Priya Suresh",
    ...overrides,
  });
}

/** One incentive, set and not yet paid (the viewer's own, or the sale's only one). */
export const PENDING_INCENTIVE: Partial<ProjectListRow> = {
  incentive_total: 5000,
  incentive_unpaid: 5000,
  incentive_count: 1,
  incentive_unpaid_count: 1,
  incentive_unpaid_coordinator_ids: [RAHUL],
};
