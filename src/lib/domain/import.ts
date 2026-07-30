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
  "consumer_number",
  "kseb_section",
  "loan_bank_name",
  "first_payment_amount",
  "first_payment_date",
  "second_payment_amount",
  "second_payment_date",
  "notes",
] as const;

/** A ready-to-edit sample the admin can download. */
export const IMPORT_TEMPLATE = [
  IMPORT_HEADERS.join(","),
  'Anand Kumar,+91 98470 11111,"Vytilla, Kochi, Kerala",3kW,195000,20000,2026-01-15,coord@bsssolar.test,material_dispatch,false,1156789012345,Vytilla,State Bank of India,80000,2026-02-10,,,Scaffolding needed for the north array',
  // Commissioned but only part-paid — shows up under "Commissioned · payment pending".
  'Meera Nair,+91 98470 22222,"Kowdiar, Thiruvananthapuram",5kW,310000,0,2026-02-01,,plant_commissioning,true,1156789054321,Kowdiar,,150000,2026-03-01,,,Balance due after subsidy credit',
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
  consumer_number: string | null;
  kseb_section: string | null;
  loan_bank_name: string | null;
  notes: string | null;
  first_payment_amount: number | null;
  first_payment_date: string | null;
  second_payment_amount: number | null;
  second_payment_date: string | null;
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

/**
 * Optional non-negative money column: `{ value }` when blank (null) or valid,
 * `{ error }` otherwise — never a silent 0, which would misstate a balance.
 */
function optionalAmount(
  raw: string | undefined,
  field: string,
): { value: number | null } | { error: string } {
  const s = (raw ?? "").trim();
  if (!s) return { value: null };
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) {
    return { error: `${field} must be a non-negative number` };
  }
  return { value: n };
}

/** Optional ISO date column. */
function optionalDate(
  raw: string | undefined,
  field: string,
): { value: string | null } | { error: string } {
  const s = (raw ?? "").trim();
  if (!s) return { value: null };
  if (!ISO_DATE.test(s)) {
    return { error: `${field} must be YYYY-MM-DD (got "${s}")` };
  }
  return { value: s };
}

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

  const first = optionalAmount(rec.first_payment_amount, "first_payment_amount");
  if ("error" in first) return first;
  const firstDate = optionalDate(rec.first_payment_date, "first_payment_date");
  if ("error" in firstDate) return firstDate;
  const second = optionalAmount(
    rec.second_payment_amount,
    "second_payment_amount",
  );
  if ("error" in second) return second;
  const secondDate = optionalDate(rec.second_payment_date, "second_payment_date");
  if ("error" in secondDate) return secondDate;

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
      consumer_number: clean(rec.consumer_number),
      kseb_section: clean(rec.kseb_section),
      loan_bank_name: clean(rec.loan_bank_name),
      notes: clean(rec.notes),
      first_payment_amount: first.value,
      first_payment_date: firstDate.value,
      second_payment_amount: second.value,
      second_payment_date: secondDate.value,
    },
  };
}
