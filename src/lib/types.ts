/**
 * Roles — see lib/domain/role.ts for the hierarchy and the predicates every
 * guard must use.
 *   coordinator       field sales; their own work orders/projects.
 *   service_engineer  field service; only the tickets assigned to them.
 *   admin             office; everything except destructive actions.
 *   superadmin        exactly one; admin + every delete. Immutable from the app.
 */
export type UserRole = "admin" | "coordinator" | "superadmin" | "service_engineer";
export type WorkOrderStatus = "pending" | "approved" | "rejected";
export type MilestoneStatus = "pending" | "in_progress" | "completed";
export type TicketType = "routine_6m" | "adhoc";
export type TicketStatus =
  | "open"
  | "scheduled"
  | "in_progress"
  | "completed"
  | "cancelled";

/** How the customer funds the plant. */
export type FinancingType = "self" | "loan";

export type PaymentMethod =
  | "cash"
  | "upi"
  | "bank_transfer"
  | "cheque"
  | "loan_disbursement"
  | "other";

/**
 * What a ledger entry pays for. Only `contract` counts towards the contract
 * receivable; `kseb_fees` records KSEB charges collected through BSS.
 */
export type PaymentPurpose = "contract" | "kseb_fees";

export type ProjectStage =
  | "site_feasibility_survey"
  | "kseb_portal_registration"
  | "kseb_feasibility_clearance"
  | "material_dispatch"
  | "structure_fabrication"
  | "panel_installation"
  | "wcr_submitted"
  | "kseb_inspection_meter"
  | "plant_commissioning";

/**
 * What was sold. `solar` is a kW plant with the full KSEB process; `custom` is
 * anything else ("1 panel", "Inverter + panel") — no kW, no KSEB feasibility,
 * a single Handover step. Fixed once the work order has a project.
 */
export type PlanType = "solar" | "custom";

/** Why a project left the pipeline. `null` on the project = live. */
export type ProjectCancellation = "cancelled" | "refunded";

export interface Profile {
  id: string;
  full_name: string;
  phone: string | null;
  role: UserRole;
  created_at: string;
}

/** One person's office-set incentive on one sale (`coordinator_incentives`). */
export interface CoordinatorIncentive {
  amount: number | null;
  paid_on: string | null;
}

/**
 * One coordinator of a sale. The first (lowest `sort_order`) is
 * `work_orders.coordinator_id`.
 */
export interface SaleCoordinator {
  id: string;
  full_name: string;
  sort_order: number;
  /** Office: everyone's. Coordinator: own only (RLS). Null when hidden or not loaded. */
  incentive: CoordinatorIncentive | null;
}

/** The cancelled / refunded state of a project (columns on `projects`). */
export interface ProjectCancellationFields {
  cancellation: ProjectCancellation | null;
  /** IST calendar date the clock stopped; null when live or not recorded. */
  cancelled_on: string | null;
  /** Who recorded it (stamped by the database, never sent by a client). */
  cancelled_by: string | null;
  /** Kept after reinstating, as the history note. */
  cancellation_remarks: string | null;
}

/** Office/field details captured on a work order after the sale. */
export interface WorkOrderDetails {
  consumer_number: string | null;
  notes: string | null;
  kseb_section: string | null;
  financing_type: FinancingType;
  loan_bank_name: string | null;
}

export interface WorkOrder extends WorkOrderDetails {
  id: string;
  /** The first coordinator (derived by the database from `coordinators`). */
  coordinator_id: string;
  client_name: string;
  client_phone: string | null;
  address: string | null;
  /**
   * The plan label: a solar plant's capacity ("3kW"), or what a custom plan
   * sold ("Inverter + panel").
   */
  plant_capacity: string;
  plan_type: PlanType;
  /** Generated from `plant_capacity` by the database; null if unparseable or a custom plan. */
  plant_capacity_kw: number | null;
  /** Collected at booking — the first money in, before the ledger. */
  advance_amount: number | null;
  total_cost: number;
  order_date: string;
  status: WorkOrderStatus;
  created_at: string;
  updated_at: string;
  // joined
  /** Everyone who shares the sale, in order (the first logged it). */
  coordinators: SaleCoordinator[];
  /** @deprecated Use `coordinators`; the single-coordinator join is gone. */
  coordinator?: Pick<Profile, "id" | "full_name"> | null;
  project?: Pick<
    Project,
    "id" | "current_stage" | "is_completed" | "cancellation"
  > | null;
}

export interface Project extends ProjectCancellationFields {
  id: string;
  work_order_id: string;
  /** @deprecated Copy of the work order's first coordinator; use `coordinators`. */
  coordinator_id: string;
  current_stage: ProjectStage;
  is_completed: boolean;
  started_at: string;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  /** Date KSEB issued feasibility; starts the 30-day validity clock. */
  feasibility_date: string | null;
  /**
   * @deprecated Each coordinator's incentive is in `coordinators[].incentive`
   * (`coordinator_incentives`). Kept only for the build before 2026-10-22.
   */
  coordinator_incentive?: number | null;
  /** @deprecated See `coordinator_incentive`. */
  incentive_paid_on?: string | null;
  // joined
  work_order?: WorkOrder | null;
  /** @deprecated Use `coordinators`. */
  coordinator?: Pick<Profile, "id" | "full_name"> | null;
  /** The sale's coordinators (its work order's), when loaded. */
  coordinators?: SaleCoordinator[];
  milestones?: ProjectMilestone[];
}

/** One collection in the payments ledger. */
export interface Payment {
  id: string;
  work_order_id: string;
  amount: number;
  paid_on: string;
  method: PaymentMethod;
  purpose: PaymentPurpose;
  reference: string | null;
  notes: string | null;
  recorded_by: string | null;
  created_at: string;
  updated_at: string;
  // joined
  recorder?: Pick<Profile, "id" | "full_name"> | null;
}

/** Ledger aggregates exposed by the list views (contract purpose only). */
export interface LedgerAggregates {
  /** Σ contract payments in the ledger (excludes the booking advance). */
  payments_total: number | null;
  payment_count: number | null;
  last_payment_on: string | null;
  /** advance + payments_total. */
  amount_received: number | null;
  /** total_cost − amount_received (negative when overpaid). */
  balance_due: number | null;
}

/** Flattened rows from the list views (server-side pagination). */
export interface WorkOrderListRow extends WorkOrderDetails, LedgerAggregates {
  id: string;
  /** The first coordinator. */
  coordinator_id: string;
  client_name: string;
  client_phone: string | null;
  address: string | null;
  /** The plan label — a capacity, or what a custom plan sold. */
  plant_capacity: string;
  plant_capacity_kw: number | null;
  advance_amount: number | null;
  total_cost: number;
  order_date: string;
  status: WorkOrderStatus;
  created_at: string;
  updated_at: string;
  /** Every coordinator of the sale, first first ("Ravi, Abhijith"). */
  coordinator_name: string | null;
  project_id: string | null;
  current_stage: ProjectStage | null;
  is_completed: boolean | null;
  /** Everyone on the sale, in order — what the coordinator filter matches. */
  coordinator_ids: string[];
  coordinator_names: string[];
  plan_type: PlanType;
  /** The linked project's state; null while live or before approval. */
  cancellation: ProjectCancellation | null;
  cancelled_on: string | null;
}

export interface TicketListRow {
  id: string;
  ticket_no: string | null;
  ticket_type: TicketType;
  status: TicketStatus;
  scheduled_date: string | null;
  service_date: string | null;
  total: number | null;
  created_at: string;
  project_id: string | null;
  client_name: string | null;
  assigned_to: string | null;
  assignee_name: string | null;
}

/**
 * A service engineer's worklist row (`engineer_tickets()` RPC): the ticket plus
 * just enough site detail to do the job — never contract money or incentives.
 */
export interface EngineerTicketRow {
  id: string;
  ticket_no: string | null;
  ticket_type: TicketType;
  status: TicketStatus;
  scheduled_date: string | null;
  service_date: string | null;
  nature_of_complaint: string | null;
  created_at: string;
  project_id: string | null;
  client_name: string | null;
  client_phone: string | null;
  address: string | null;
  /** The capacity, or a custom plan's details. */
  plant_capacity: string | null;
  consumer_number: string | null;
  kseb_section: string | null;
}

export interface ProjectListRow extends LedgerAggregates {
  id: string;
  /** @deprecated Use `coordinator_ids`. */
  coordinator_id: string;
  work_order_id: string | null;
  current_stage: ProjectStage;
  is_completed: boolean;
  created_at: string;
  started_at: string;
  completed_at: string | null;
  client_name: string | null;
  client_phone: string | null;
  address: string | null;
  plant_capacity: string | null;
  plant_capacity_kw: number | null;
  total_cost: number | null;
  advance_amount: number | null;
  /** Every coordinator of the sale, first first ("Ravi, Abhijith"). */
  coordinator_name: string | null;
  milestones_done: number;
  milestones_total: number;
  consumer_number: string | null;
  kseb_section: string | null;
  financing_type: FinancingType | null;
  loan_bank_name: string | null;
  /** Commissioned, not cancelled or refunded, and the contract is not fully collected. */
  payment_pending: boolean | null;
  feasibility_date: string | null;
  feasibility_periods: number | null;
  feasibility_renewals: number | null;
  feasibility_valid_until: string | null;
  /** Days left in the current validity period; null once commissioned or cancelled. */
  feasibility_days_left: number | null;
  /** Renewals × ₹1,000 — borne by BSS. */
  feasibility_extension_cost: number | null;
  /**
   * @deprecated The caller's visible incentives, summed — use `incentive_total`.
   * Kept in the view for the build before 2026-10-22.
   */
  coordinator_incentive: number | null;
  /** @deprecated See `coordinator_incentive`. */
  incentive_paid_on: string | null;
  /** Everyone on the sale, in order — what the coordinator filter matches. */
  coordinator_ids: string[];
  coordinator_names: string[];
  plan_type: PlanType;
  cancellation: ProjectCancellation | null;
  cancelled_on: string | null;
  cancellation_remarks: string | null;
  /**
   * Σ the incentives the caller may see (office: everyone's on the sale; a
   * coordinator: their own). Null when none is set.
   */
  incentive_total: number | null;
  /** The part of `incentive_total` not yet paid. */
  incentive_unpaid: number;
  /** How many people have an incentive set (visible to the caller). */
  incentive_count: number;
  incentive_unpaid_count: number;
  incentive_unpaid_coordinator_ids: string[];
  incentive_paid_coordinator_ids: string[];
}

export interface ProjectMilestone {
  id: string;
  project_id: string;
  stage: ProjectStage;
  sort_order: number;
  status: MilestoneStatus;
  notes: string | null;
  completed_at: string | null;
}

/** One entry in a user's notification inbox. */
export interface AppNotification {
  id: string;
  recipient_id: string;
  type: string;
  title: string;
  body: string | null;
  /** In-app path, always starting with "/". */
  link: string | null;
  read_at: string | null;
  created_at: string;
}

export interface SpvStringReading {
  string: number;
  voltage: string;
  ampere: string;
}

export interface MpptReading {
  mppt: number;
  in_volt: string;
  out_volt: string;
  in_ampere: string;
  out_ampere: string;
}

export interface ServiceTicket {
  id: string;
  project_id: string | null;
  ticket_no: string | null;
  ticket_type: TicketType;
  status: TicketStatus;
  assigned_to: string | null;
  scheduled_date: string | null;
  service_date: string | null;

  sys_capacity: string | null;
  sys_loading_capacity: string | null;
  sys_make: string | null;
  sys_model: string | null;
  sys_serial_no: string | null;

  bat_capacity_ah: string | null;
  bat_make: string | null;
  bat_model: string | null;
  bat_qty: number | null;
  bat_bank_nos: number | null;

  spv_module_capacity: string | null;
  spv_make: string | null;
  spv_voc: string | null;
  spv_total_nos: number | null;
  spv_total_watts: number | null;
  spv_no_of_strings: number | null;

  spv_string_readings: SpvStringReading[];
  mppt_readings: MpptReading[];
  battery_voltage: string | null;
  charging_current: string | null;
  battery_water_level: string | null;

  nature_of_complaint: string | null;
  defects_found: string | null;
  action_taken: string | null;

  service_charge: number | null;
  cost_of_spares: number | null;
  amc_charge: number | null;
  total: number | null;

  created_by: string | null;
  created_at: string;
  updated_at: string;

  // joined
  project?:
    | (Pick<Project, "id" | "work_order_id"> & {
        work_order?: Pick<WorkOrder, "client_name" | "address" | "client_phone"> | null;
      })
    | null;
  assignee?: Pick<Profile, "id" | "full_name"> | null;
}
