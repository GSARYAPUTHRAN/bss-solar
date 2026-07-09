import { PROJECT_STAGES } from "@/lib/constants";
import { todayISO } from "@/lib/format";
import type { ProjectStage } from "@/lib/types";

/** CSV columns accepted by the project onboarding importer. */
export const IMPORT_HEADERS = [
  "client_name",
  "client_phone",
  "address",
  "plant_capacity",
  "total_cost",
  "advance_amount",
  "order_date",
  "coordinator_email",
  "current_stage",
  "is_completed",
] as const;

/** A ready-to-edit sample the admin can download. */
export const IMPORT_TEMPLATE = [
  IMPORT_HEADERS.join(","),
  'Anand Kumar,+91 98470 11111,"Vytilla, Kochi, Kerala",3kW,195000,20000,2026-01-15,coord@bsssolar.test,material_dispatch,false',
  'Meera Nair,+91 98470 22222,"Kowdiar, Thiruvananthapuram",5kW,310000,0,2026-02-01,,plant_commissioning,true',
].join("\n");

// --- Import action state (kept here, not in the "use server" file, since a
// server-action module may only export async functions) ---
export interface ImportRowResult {
  row: number;
  client: string;
  ok: boolean;
  message: string;
}

export interface ImportState {
  ran: boolean;
  imported: number;
  failed: number;
  results: ImportRowResult[];
  error?: string;
}

export const IMPORT_INITIAL: ImportState = {
  ran: false,
  imported: 0,
  failed: 0,
  results: [],
};

const STAGE_VALUES = new Set<string>(PROJECT_STAGES.map((s) => s.value));
const STAGE_BY_LABEL = new Map(
  PROJECT_STAGES.map((s) => [s.label.toLowerCase(), s.value]),
);

export interface ParsedImportRow {
  client_name: string;
  client_phone: string | null;
  address: string | null;
  plant_capacity: string;
  total_cost: number;
  advance_amount: number;
  order_date: string;
  coordinator_email: string | null;
  current_stage: ProjectStage;
  is_completed: boolean;
}

/** Resolve a stage value or human label to a ProjectStage; null if unknown. */
export function normalizeStage(value: string): ProjectStage | null {
  const v = value.trim().toLowerCase();
  if (!v) return "site_feasibility_survey";
  if (STAGE_VALUES.has(v)) return v as ProjectStage;
  return STAGE_BY_LABEL.get(v) ?? null;
}

function clean(v: string | undefined): string | null {
  const s = (v ?? "").trim();
  return s.length ? s : null;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const TRUTHY = /^(true|yes|y|1)$/i;

/** Validate + normalize one CSV record. Returns `{ data }` or `{ error }`. */
export function parseImportRecord(
  rec: Record<string, string>,
): { data: ParsedImportRow } | { error: string } {
  const client_name = (rec.client_name ?? "").trim();
  const plant_capacity = (rec.plant_capacity ?? "").trim();
  if (!client_name) return { error: "client_name is required" };
  if (!plant_capacity) return { error: "plant_capacity is required" };

  const totalRaw = (rec.total_cost ?? "").trim();
  const total_cost = Number(totalRaw);
  if (!totalRaw || !Number.isFinite(total_cost) || total_cost < 0) {
    return { error: "total_cost must be a non-negative number" };
  }

  const advanceRaw = (rec.advance_amount ?? "").trim();
  const advance_amount = advanceRaw ? Number(advanceRaw) : 0;
  if (!Number.isFinite(advance_amount) || advance_amount < 0) {
    return { error: "advance_amount must be a non-negative number" };
  }

  const order_date = (rec.order_date ?? "").trim() || todayISO();
  if (!ISO_DATE.test(order_date)) {
    return { error: `order_date must be YYYY-MM-DD (got "${rec.order_date}")` };
  }

  const is_completed = TRUTHY.test((rec.is_completed ?? "").trim());
  const stage = normalizeStage(rec.current_stage ?? "");
  if (stage === null) {
    return { error: `unknown current_stage "${rec.current_stage}"` };
  }

  return {
    data: {
      client_name,
      client_phone: clean(rec.client_phone),
      address: clean(rec.address),
      plant_capacity,
      total_cost,
      advance_amount,
      order_date,
      coordinator_email: clean(rec.coordinator_email)?.toLowerCase() ?? null,
      current_stage: is_completed ? "plant_commissioning" : stage,
      is_completed,
    },
  };
}
