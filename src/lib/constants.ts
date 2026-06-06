import type { ProjectStage, TicketType } from "./types";
import {
  MILESTONE_STATUS,
  TICKET_STATUS,
  WORK_ORDER_STATUS,
  statusLabels,
} from "./domain/status";

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

// Status labels are derived from the status registry (single source of truth).
export const MILESTONE_STATUS_LABELS = statusLabels(MILESTONE_STATUS);
export const WORK_ORDER_STATUS_LABELS = statusLabels(WORK_ORDER_STATUS);
export const TICKET_STATUS_LABELS = statusLabels(TICKET_STATUS);

export const TICKET_TYPE_LABELS: Record<TicketType, string> = {
  routine_6m: "Routine (6-Month Check)",
  adhoc: "Ad-hoc Issue",
};

export const COMMON_CAPACITIES = ["1kW", "2kW", "3kW", "5kW", "8kW", "10kW"];

export const COMPANY = {
  name: "BSS Solar",
  fullName: "BSS Solar Solutions",
  tagline: "Empanelled Solar Implementation Agency",
  // Official details (as printed on the physical BSS service form)
  org: "BHARAT SEVAK SAMAJ",
  subtitle: "National Development Agency, Promoted by Govt. of India",
  line1:
    "A channel partner of Ministry of New and Renewable Energy, Government of India",
  line2: "Empanelled agency of ANERT, Government of Kerala",
  officeLabel: "Central Program Office",
  address:
    "BSS Solar, Brahmins Colony, Kowdiar P.O., Thiruvananthapuram - 695003, Kerala, India",
  phone: "0471-2439322, 9048001332, 7736999199",
  website: "www.bsssolar.com",
  email: "bsssolarkerala@gmail.com",
};
