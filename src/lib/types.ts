export type UserRole = "admin" | "coordinator";
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
  | "structure_fabrication_installation"
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

export interface WorkOrder {
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
