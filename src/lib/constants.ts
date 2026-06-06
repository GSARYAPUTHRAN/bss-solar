import type {
  MilestoneStatus,
  ProjectStage,
  TicketStatus,
  TicketType,
  WorkOrderStatus,
} from "./types";

export const PROJECT_STAGES: { value: ProjectStage; label: string }[] = [
  { value: "site_feasibility_survey", label: "Site Feasibility Survey" },
  {
    value: "kseb_portal_registration",
    label: "KSEB Portal Registration / PM Surya Ghar",
  },
  { value: "kseb_feasibility_clearance", label: "KSEB Feasibility Clearance" },
  { value: "material_dispatch", label: "Material Dispatch (Panels & Structure)" },
  {
    value: "structure_fabrication_installation",
    label: "Structure Fabrication & Panel Installation",
  },
  { value: "wcr_submitted", label: "WCR Submitted to KSEB" },
  {
    value: "kseb_inspection_meter",
    label: "KSEB Inspection & Bi-directional Meter",
  },
  { value: "plant_commissioning", label: "Plant Commissioning" },
];

export const STAGE_LABELS: Record<ProjectStage, string> = Object.fromEntries(
  PROJECT_STAGES.map((s) => [s.value, s.label]),
) as Record<ProjectStage, string>;

export const STAGE_ORDER: ProjectStage[] = PROJECT_STAGES.map((s) => s.value);

export const MILESTONE_STATUS_LABELS: Record<MilestoneStatus, string> = {
  pending: "Pending",
  in_progress: "In Progress",
  completed: "Completed",
};

export const WORK_ORDER_STATUS_LABELS: Record<WorkOrderStatus, string> = {
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
};

export const TICKET_TYPE_LABELS: Record<TicketType, string> = {
  routine_6m: "Routine (6-Month Check)",
  adhoc: "Ad-hoc Issue",
};

export const TICKET_STATUS_LABELS: Record<TicketStatus, string> = {
  open: "Open",
  scheduled: "Scheduled",
  in_progress: "In Progress",
  completed: "Completed",
  cancelled: "Cancelled",
};

export const COMMON_CAPACITIES = ["1kW", "2kW", "3kW", "5kW", "8kW", "10kW"];

export const COMPANY = {
  name: "BSS Solar",
  fullName: "BSS Solar Solutions",
  tagline: "Empanelled Solar Implementation Agency",
  address: "Kerala, India",
  email: "service@bsssolar.in",
  phone: "+91 00000 00000",
};
