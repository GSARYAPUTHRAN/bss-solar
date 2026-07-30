/**
 * `superadmin` is a single privileged account that owns the destructive actions
 * (deleting users, projects and work orders). It holds every `admin` capability
 * on top of that — see lib/domain/role.ts.
 */
export type UserRole = "admin" | "coordinator" | "superadmin";
export type WorkOrderStatus = "pending" | "approved" | "rejected";
export type MilestoneStatus = "pending" | "in_progress" | "completed";
export type TicketType = "routine_6m" | "adhoc";
export type TicketStatus =
  | "open"
  | "scheduled"
  | "in_progress"
  | "completed"
  | "cancelled";

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

export interface Profile {
  id: string;
  full_name: string;
  phone: string | null;
  role: UserRole;
  created_at: string;
}

/** Office/field details captured on a work order after the sale. */
export interface WorkOrderDetails {
  consumer_number: string | null;
  notes: string | null;
  kseb_section: string | null;
  loan_bank_name: string | null;
  first_payment_date: string | null;
  first_payment_amount: number | null;
  second_payment_date: string | null;
  second_payment_amount: number | null;
}

export interface WorkOrder extends WorkOrderDetails {
  id: string;
  coordinator_id: string;
  client_name: string;
  client_phone: string | null;
  address: string | null;
  plant_capacity: string;
  advance_amount: number | null;
  total_cost: number;
  order_date: string;
  status: WorkOrderStatus;
  created_at: string;
  updated_at: string;
  // joined
  coordinator?: Pick<Profile, "id" | "full_name"> | null;
  project?: Pick<Project, "id" | "current_stage" | "is_completed"> | null;
}

export interface Project {
  id: string;
  work_order_id: string;
  coordinator_id: string;
  current_stage: ProjectStage;
  is_completed: boolean;
  started_at: string;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  // joined
  work_order?: WorkOrder | null;
  coordinator?: Pick<Profile, "id" | "full_name"> | null;
  milestones?: ProjectMilestone[];
}

/** Flattened rows from the list views (server-side pagination). */
export interface WorkOrderListRow extends WorkOrderDetails {
  id: string;
  coordinator_id: string;
  client_name: string;
  client_phone: string | null;
  address: string | null;
  plant_capacity: string;
  advance_amount: number | null;
  total_cost: number;
  order_date: string;
  status: WorkOrderStatus;
  created_at: string;
  updated_at: string;
  coordinator_name: string | null;
  project_id: string | null;
  current_stage: ProjectStage | null;
  is_completed: boolean | null;
  /** advance + both instalments, computed in the view. */
  amount_received: number | null;
  /** total_cost - amount_received (negative when overpaid). */
  balance_due: number | null;
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
}

export interface ProjectListRow {
  id: string;
  coordinator_id: string;
  current_stage: ProjectStage;
  is_completed: boolean;
  created_at: string;
  started_at: string;
  completed_at: string | null;
  client_name: string | null;
  plant_capacity: string | null;
  total_cost: number | null;
  coordinator_name: string | null;
  milestones_done: number;
  milestones_total: number;
  work_order_id: string | null;
  consumer_number: string | null;
  kseb_section: string | null;
  loan_bank_name: string | null;
  advance_amount: number | null;
  first_payment_date: string | null;
  first_payment_amount: number | null;
  second_payment_date: string | null;
  second_payment_amount: number | null;
  amount_received: number | null;
  balance_due: number | null;
  /** Commissioned, but money is still outstanding. */
  payment_pending: boolean | null;
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
