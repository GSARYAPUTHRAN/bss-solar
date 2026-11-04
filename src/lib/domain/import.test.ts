import { describe, it, expect } from "vitest";
import { toCsv } from "@/lib/csv";
import { formatCurrency } from "@/lib/format";
import type { UserRole } from "@/lib/types";
import { CoordinatorDirectory, type DirectoryAccount } from "./coordinator-match";
import {
  IMPORT_COLUMN_GROUPS,
  IMPORT_HEADERS,
  IMPORT_HEADER_ALIASES,
  INCENTIVE_FIELDS,
  MAX_IMPORT_ROWS,
  NOT_RECORDED_LABEL,
  PAYMENT_FIELDS,
  REQUIRED_IMPORT_HEADERS,
  incentiveColumn,
  parseImportRow,
  paymentColumn,
  planImport,
  readImportRow,
  validateImportHeaders,
  type ImportPlan,
  type ImportPlanOptions,
  type ImportRow,
} from "./import";
import { ledgerTotals, paymentSummary } from "./payment";
import { stagesFor } from "./plan";

const TODAY = "2026-10-22";

let seq = 0;
function account(fullName: string, email: string | null, role: UserRole = "coordinator") {
  seq += 1;
  return {
    id: `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`,
    fullName,
    email,
    role,
  } satisfies DirectoryAccount;
}

const RAHUL = account("Rahul Menon", "coord@bsssolar.test");
const PRIYA = account("Priya Suresh", "priya@bsssolar.test");
const SUDHEESH = account("Sudheesh Pillai", "sudheesh@bsssolar.test");
const RAVI = account("Ravi Kumar", "ravi@bsssolar.test");
const ABHIJITH = account("Abhijith Nair", "abhijith@bsssolar.test");
const MANOHAR = account("Manohar Das", "manohar@bsssolar.test");
const NISHANTH = account("Nishanth Raj", "nishanth@bsssolar.test");
const ADMIN = account("BSS Admin", "admin@bsssolar.test", "admin");
const ENGINEER = account("Anil Kumar", "engineer@bsssolar.test", "service_engineer");

const DIRECTORY = new CoordinatorDirectory([
  RAHUL,
  PRIYA,
  SUDHEESH,
  RAVI,
  ABHIJITH,
  MANOHAR,
  NISHANTH,
  ADMIN,
  ENGINEER,
]);

const ctx = (
  paymentSlots: number[] = [],
  defaultCoordinator: DirectoryAccount | null = null,
  incentiveSlots: number[] = [],
) => ({
  today: TODAY,
  paymentSlots,
  incentiveSlots,
  directory: DIRECTORY,
  defaultCoordinator,
});

const BASE = {
  client_name: "Anil Varghese",
  plant_capacity: "3kW",
  total_cost: "195000",
  coordinator: "Rahul Menon",
};

function parsed(record: Record<string, string>, slots: number[] = []): ImportRow {
  const res = parseImportRow(record, 2, ctx(slots));
  if (!res.ok) throw new Error(`expected a valid row, got: ${res.error}`);
  return res.data;
}

function problems(record: Record<string, string>, slots: number[] = []): string {
  const res = parseImportRow(record, 2, ctx(slots));
  if (res.ok) throw new Error("expected the row to be rejected");
  return res.error;
}

describe("column catalogue", () => {
  it("groups every fixed column exactly once for the page reference", () => {
    const grouped = IMPORT_COLUMN_GROUPS.flatMap((g) => g.columns);
    expect([...grouped].sort()).toEqual([...IMPORT_HEADERS].sort());
  });

  it("starts with the required columns", () => {
    expect(IMPORT_HEADERS.slice(0, 3)).toEqual([...REQUIRED_IMPORT_HEADERS]);
  });

  it("has the columns of the shared, custom and cancelled kinds of sale", () => {
    expect(IMPORT_HEADERS).toEqual(
      expect.arrayContaining([
        "coordinator",
        "plan_type",
        "cancellation",
        "cancelled_on",
        "cancellation_remarks",
      ]),
    );
    expect(IMPORT_HEADERS).not.toContain("coordinator_email");
  });

  it("maps the old names onto columns that exist", () => {
    expect(IMPORT_HEADER_ALIASES).toEqual({
      coordinator_email: "coordinator",
      coordinators: "coordinator",
      plan: "plan_type",
    });
    for (const column of Object.values(IMPORT_HEADER_ALIASES)) {
      expect(IMPORT_HEADERS).toContain(column);
    }
  });
});

describe("validateImportHeaders", () => {
  it("accepts the required columns alone", () => {
    expect(validateImportHeaders(["client_name", "plant_capacity", "total_cost"])).toEqual({
      ok: true,
      data: {
        headers: ["client_name", "plant_capacity", "total_cost"],
        paymentSlots: [],
        incentiveSlots: [],
        canonical: {
          client_name: "client_name",
          plant_capacity: "plant_capacity",
          total_cost: "total_cost",
        },
      },
    });
  });

  it("detects any number of payment groups, in order, gaps allowed", () => {
    const res = validateImportHeaders([
      ...REQUIRED_IMPORT_HEADERS,
      "payment_10_amount",
      "payment_10_date",
      "payment_2_date",
      "payment_2_amount",
      "payment_2_method",
      "payment_1_amount",
      "payment_1_date",
    ]);
    expect(res.ok && res.data.paymentSlots).toEqual([1, 2, 10]);
  });

  it("ignores blank header cells and the import_error column of a retry file", () => {
    const res = validateImportHeaders([...REQUIRED_IMPORT_HEADERS, "", "import_error"]);
    expect(res.ok).toBe(true);
  });

  it("accepts the old names silently and maps them to their column", () => {
    const res = validateImportHeaders([
      ...REQUIRED_IMPORT_HEADERS,
      "coordinator_email",
      "plan",
    ]);
    expect(res.ok && res.data.canonical).toMatchObject({
      coordinator_email: "coordinator",
      plan: "plan_type",
    });
    const plural = validateImportHeaders([...REQUIRED_IMPORT_HEADERS, "coordinators"]);
    expect(plural.ok && plural.data.canonical.coordinators).toBe("coordinator");
  });

  it("refuses a column given twice under two names", () => {
    const res = validateImportHeaders([
      ...REQUIRED_IMPORT_HEADERS,
      "coordinator",
      "coordinator_email",
    ]);
    expect(res).toEqual({
      ok: false,
      error:
        'The header row needs fixing. "coordinator_email" and "coordinator" are the same column — keep one.',
    });
    const aliases = validateImportHeaders([
      ...REQUIRED_IMPORT_HEADERS,
      "coordinator_email",
      "coordinators",
      "plan",
      "plan_type",
    ]);
    expect(aliases.ok).toBe(false);
    if (aliases.ok) return;
    expect(aliases.error).toContain('"coordinator_email" and "coordinators" are the same column');
    expect(aliases.error).toContain('"plan" and "plan_type" are the same column');
  });

  it("rejects unknown columns, suggesting the intended one", () => {
    const res = validateImportHeaders([
      ...REQUIRED_IMPORT_HEADERS,
      "client nme",
      "payment_3_amout",
      "payment_3_date",
      "subsidy_amount",
      "coordinater",
    ]);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toMatch(/Unknown columns:/);
    expect(res.error).toContain('"client nme" (did you mean "client_name"?)');
    expect(res.error).toContain('"payment_3_amout" (did you mean "payment_3_amount"?)');
    expect(res.error).toContain('"coordinater" (did you mean "coordinator"?)');
    expect(res.error).toMatch(/"subsidy_amount"(?! \(did)/);
  });

  it("explains that the old instalment columns were renamed", () => {
    const res = validateImportHeaders([
      ...REQUIRED_IMPORT_HEADERS,
      "first_payment_amount",
      "first_payment_date",
      "second_payment_amount",
      "second_payment_date",
    ]);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toContain('rename "first_payment_amount" to "payment_1_amount"');
    expect(res.error).toContain('"second_payment_date" to "payment_2_date"');
    // Not also reported as unknown.
    expect(res.error).not.toMatch(/Unknown columns/);
  });

  it("reports missing required columns and duplicates", () => {
    const res = validateImportHeaders(["client_name", "client_name", "notes"]);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toContain('appear more than once: "client_name"');
    expect(res.error).toContain('Missing required columns: "plant_capacity", "total_cost"');
  });

  it("requires both an amount and a date column per payment group", () => {
    const res = validateImportHeaders([
      ...REQUIRED_IMPORT_HEADERS,
      "payment_1_amount",
      "payment_2_date",
      "payment_2_method",
    ]);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toContain('Payment 1 needs "payment_1_date" column');
    expect(res.error).toContain('Payment 2 needs "payment_2_amount" column');
  });

  it("treats object-prototype names as plain unknown columns", () => {
    const res = validateImportHeaders([...REQUIRED_IMPORT_HEADERS, "constructor"]);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toContain('Unknown columns: "constructor"');
    expect(res.error).not.toMatch(/rename/);
  });

  it("does not accept a payment group numbered 0", () => {
    const res = validateImportHeaders([
      ...REQUIRED_IMPORT_HEADERS,
      "payment_0_amount",
      "payment_0_date",
    ]);
    expect(res.ok).toBe(false);
  });
});

describe("parseImportRow — required columns and defaults", () => {
  it("normalises a minimal row with sensible defaults", () => {
    expect(parsed(BASE)).toEqual({
      row_no: 2,
      client_name: "Anil Varghese",
      client_phone: null,
      address: null,
      plan_type: "solar",
      plant_capacity: "3kW",
      total_cost: 195000,
      advance_amount: 0,
      advance_method: null,
      advance_paid_on: null,
      advance_reference: null,
      order_date: TODAY,
      coordinator_ids: [RAHUL.id],
      financing_type: "self",
      loan_bank_name: null,
      consumer_number: null,
      kseb_section: null,
      notes: null,
      current_stage: "site_feasibility_survey",
      is_completed: false,
      commissioned_on: null,
      feasibility_date: null,
      incentives: [],
      cancellation: null,
      cancelled_on: null,
      cancellation_remarks: null,
      payments: [],
    });
  });

  it("reports every missing required column at once", () => {
    const error = problems({ client_name: "", plant_capacity: "", total_cost: "", coordinator: "Rahul" });
    expect(error).toContain("client_name is required");
    expect(error).toContain("plant_capacity is required");
    expect(error).toContain("total_cost is required");
  });

  it("rejects a capacity that is not a kW capacity, with the way out", () => {
    for (const label of ["big", "0kW", "1 panel", "Inverter+panel"]) {
      expect(problems({ ...BASE, plant_capacity: label })).toBe(
        `plant_capacity "${label}" is not a kW capacity — write it like 3kW, or set plan_type to custom for a sale that is not a solar plant`,
      );
    }
    expect(parsed({ ...BASE, plant_capacity: "3000 W" }).plant_capacity).toBe("3000 W");
    expect(parsed({ ...BASE, plant_capacity: "3kW+inverter" }).plant_capacity).toBe(
      "3kW+inverter",
    );
    expect(parsed({ ...BASE, plant_capacity: "5 kWp" }).plant_capacity).toBe("5 kWp");
    expect(parsed({ ...BASE, plant_capacity: "3" }).plant_capacity).toBe("3");
  });

  it("rejects negative or non-numeric money", () => {
    expect(problems({ ...BASE, total_cost: "-1" })).toMatch(/total_cost cannot be negative/);
    expect(problems({ ...BASE, advance_amount: "abc" })).toMatch(/advance_amount must be/);
  });

  it("adds a sum in an amount cell", () => {
    const row = parsed({
      ...BASE,
      plant_capacity: "3kW+inverter",
      total_cost: "235000+23500",
      advance_amount: "₹10,000 + Rs. 500",
    });
    expect(row.total_cost).toBe(258500);
    expect(row.advance_amount).toBe(10500);
    expect(problems({ ...BASE, total_cost: "235000+" })).toBe(
      'total_cost "235000+" has an empty part — write it like 235000+23500',
    );
    expect(problems({ ...BASE, total_cost: "100+-5" })).toBe(
      'total_cost "100+-5" — each part of a sum must be a plain amount',
    );
  });

  it("keeps blank optional columns null rather than zero", () => {
    const row = parsed({ ...BASE, consumer_number: " " });
    expect(row.incentives).toEqual([]);
    expect(row.consumer_number).toBeNull();
  });

  it("carries the work-order columns through, trimmed", () => {
    const row = parsed({
      ...BASE,
      client_phone: " +91 98470 11111 ",
      address: "Vytilla, Kochi",
      advance_amount: "20,000",
      order_date: "2026-06-16",
      consumer_number: "1156789000111",
      kseb_section: "Vytilla",
      notes: "Scaffolding needed",
    });
    expect(row).toMatchObject({
      client_phone: "+91 98470 11111",
      address: "Vytilla, Kochi",
      advance_amount: 20000,
      order_date: "2026-06-16",
      consumer_number: "1156789000111",
      kseb_section: "Vytilla",
      notes: "Scaffolding needed",
    });
  });

  it("rejects an order date in the future or malformed", () => {
    expect(problems({ ...BASE, order_date: "2026-10-23" })).toMatch(/order_date .* future/);
    // Day first: 15/01/2026 is a date (see "dates are day first"); month-first is not.
    expect(problems({ ...BASE, order_date: "01/15/2026" })).toMatch(
      /order_date "01\/15\/2026" is not a real date.*did you mean 2026-01-15\?/,
    );
    expect(problems({ ...BASE, order_date: "soon" })).toMatch(/order_date "soon" is not a date/);
  });

  it("refuses a consumer number Excel turned into scientific notation", () => {
    expect(problems({ ...BASE, consumer_number: "1.15679E+12" })).toMatch(
      /scientific notation/,
    );
  });
});

describe("parseImportRow — a blank order_date", () => {
  it("is still today, but the row says so", () => {
    const reading = readImportRow(BASE, 2, ctx());
    expect(reading.parsed.ok && reading.parsed.data.order_date).toBe(TODAY);
    expect(reading.warnings).toEqual([`order_date is blank — today (${TODAY}) will be used`]);
  });

  it("carries no warning when the date is given", () => {
    expect(readImportRow({ ...BASE, order_date: "2026-06-15" }, 2, ctx()).warnings).toEqual([]);
  });

  it("is refused on a cancelled or refunded row — the import never invents dates", () => {
    expect(problems({ ...BASE, cancellation: "cancelled" })).toBe(
      "order_date is required for a cancelled or refunded row — the import never invents dates",
    );
  });
});

describe("parseImportRow — coordinators", () => {
  it("resolves a first name to the account's id", () => {
    expect(parsed({ ...BASE, coordinator: "sudheesh" }).coordinator_ids).toEqual([SUDHEESH.id]);
  });

  it("keeps several coordinators in the order written, first first", () => {
    expect(parsed({ ...BASE, coordinator: "Abhijith+Ravi" }).coordinator_ids).toEqual([
      ABHIJITH.id,
      RAVI.id,
    ]);
    expect(parsed({ ...BASE, coordinator: "Ravi + Abhijith" }).coordinator_ids).toEqual([
      RAVI.id,
      ABHIJITH.id,
    ]);
  });

  it("takes an e-mail, in any case", () => {
    expect(parsed({ ...BASE, coordinator: "Admin@BSSSolar.test" }).coordinator_ids).toEqual([
      ADMIN.id,
    ]);
  });

  it("keeps a bracketed remark in the notes, after the row's own notes", () => {
    const row = parsed({ ...BASE, coordinator: "sudheesh(sheeja)", notes: "Needs ladder" });
    expect(row.coordinator_ids).toEqual([SUDHEESH.id]);
    expect(row.notes).toBe(
      "Needs ladder\nCoordinator as written in the import sheet: sudheesh(sheeja)",
    );
    expect(parsed({ ...BASE, coordinator: "sudheesh(sheeja)" }).notes).toBe(
      "Coordinator as written in the import sheet: sudheesh(sheeja)",
    );
    expect(parsed({ ...BASE, coordinator: "sudheesh", notes: "Needs ladder" }).notes).toBe(
      "Needs ladder",
    );
  });

  it("refuses a name that is only close, and offers the account", () => {
    expect(problems({ ...BASE, coordinator: "Abhijit" })).toBe(
      'coordinator "Abhijit" is not a coordinator or office account — did you mean Abhijith Nair (abhijith@bsssolar.test)?',
    );
  });

  it("refuses an engineer, who cannot own a sale", () => {
    expect(problems({ ...BASE, coordinator: "Anil" })).toMatch(/a service engineer/);
  });

  it("refuses a blank cell when no default coordinator was chosen", () => {
    expect(problems({ ...BASE, coordinator: "" })).toBe(
      "coordinator is blank and no default coordinator was chosen — name the coordinator, or choose a default coordinator above",
    );
    expect(problems({ client_name: "A", plant_capacity: "3kW", total_cost: "1" })).toMatch(
      /^coordinator is blank and no default/,
    );
  });

  it("gives a blank cell to the default coordinator, when one was chosen", () => {
    const res = readImportRow({ ...BASE, coordinator: "" }, 2, ctx([], PRIYA));
    expect(res.parsed.ok && res.parsed.data.coordinator_ids).toEqual([PRIYA.id]);
    expect(res.defaulted).toBe(true);
    expect(res.blankCoordinator).toBe(true);
    expect(res.coordinators).toEqual(["Priya Suresh"]);
  });

  it("does not default a cell that names someone", () => {
    const res = readImportRow(BASE, 2, ctx([], PRIYA));
    expect(res.defaulted).toBe(false);
    expect(res.coordinators).toEqual(["Rahul Menon"]);
  });

  it("names the column the sheet used in its messages", () => {
    const named = { ...ctx(), columnNames: { coordinator: "coordinator_email" } as const };
    const res = parseImportRow({ ...BASE, coordinator: "Abhijit" }, 2, named);
    expect(!res.ok && res.error).toMatch(/^coordinator_email "Abhijit" is not/);
    const blank = parseImportRow({ ...BASE, coordinator: "" }, 2, named);
    expect(!blank.ok && blank.error).toMatch(/^coordinator_email is blank/);
  });

  it("reports the coordinator, the amount and the stage in one message", () => {
    const error = problems({
      ...BASE,
      coordinator: "Ravi+Abhijit",
      total_cost: "235000+",
      current_stage: "panel_instalation",
    });
    expect(error).toContain('coordinator "Abhijit" is not a coordinator or office account');
    expect(error).toContain('total_cost "235000+" has an empty part');
    expect(error).toContain('current_stage "panel_instalation" is not recognised');
    expect(error.split("; ")).toHaveLength(3);
  });

  it("lists the references the cell named, for the matches panel", () => {
    const res = readImportRow({ ...BASE, coordinator: "Ravi+Abhijit" }, 2, ctx());
    expect(res.references.map((r) => [r.written, r.account?.fullName ?? null])).toEqual([
      ["Ravi", "Ravi Kumar"],
      ["Abhijit", null],
    ]);
    expect(res.coordinators).toEqual([]);
  });
});

describe("parseImportRow — stage, commissioning and feasibility", () => {
  it("accepts a stage key or label", () => {
    expect(
      parsed({ ...BASE, current_stage: "Material Dispatch (Panels & Structure)" }).current_stage,
    ).toBe("material_dispatch");
    expect(problems({ ...BASE, current_stage: "bogus" })).toMatch(/current_stage "bogus"/);
  });

  it("starts a blank stage at the first KSEB stage", () => {
    expect(parsed(BASE).current_stage).toBe("site_feasibility_survey");
  });

  it("forces the final stage when commissioned", () => {
    const row = parsed({ ...BASE, is_completed: "yes", current_stage: "material_dispatch" });
    expect(row.is_completed).toBe(true);
    expect(row.current_stage).toBe("plant_commissioning");
  });

  it.each(["plant_complete", "completed", "Complete", "commissioned", "plant commissioned", "handed over"])(
    "reads the stage %j as commissioned",
    (alias) => {
      const row = parsed({ ...BASE, current_stage: alias });
      expect(row.is_completed).toBe(true);
      expect(row.current_stage).toBe("plant_commissioning");
      expect(row.commissioned_on).toBeNull();
    },
  );

  it("keeps naming the last stage separate from finishing it", () => {
    const row = parsed({ ...BASE, current_stage: "plant_commissioning" });
    expect(row.is_completed).toBe(false);
    expect(row.current_stage).toBe("plant_commissioning");
  });

  it("refuses a completion word the sheet contradicts with is_completed no", () => {
    expect(problems({ ...BASE, current_stage: "completed", is_completed: "no" })).toBe(
      'current_stage "completed" means commissioned, but is_completed is no — clear one of them',
    );
    expect(parsed({ ...BASE, current_stage: "plant_complete", is_completed: "yes" }).is_completed).toBe(
      true,
    );
  });

  it("points a stage of 'cancelled' at the cancellation column", () => {
    expect(problems({ ...BASE, current_stage: "cancelled" })).toBe(
      'current_stage "cancelled" is not a stage — put cancelled or refunded in the cancellation column and leave current_stage at the stage the project reached',
    );
  });

  it("treats a commissioning date with a blank is_completed as commissioned", () => {
    const row = parsed({ ...BASE, order_date: "2026-01-10", commissioned_on: "2026-03-01" });
    expect(row.is_completed).toBe(true);
    expect(row.commissioned_on).toBe("2026-03-01");
  });

  it("leaves the commissioning date unknown rather than invent one", () => {
    const row = parsed({ ...BASE, order_date: "2026-01-10", is_completed: "yes" });
    expect(row.is_completed).toBe(true);
    expect(row.commissioned_on).toBeNull();
  });

  it("rejects a commissioning date on a project marked not completed", () => {
    expect(
      problems({
        ...BASE,
        order_date: "2026-01-10",
        is_completed: "no",
        commissioned_on: "2026-03-01",
      }),
    ).toMatch(/commissioned_on is filled but is_completed is no/);
  });

  it("requires commissioned_on for a commissioned project with a feasibility date", () => {
    expect(
      problems({
        ...BASE,
        order_date: "2026-01-10",
        is_completed: "true",
        feasibility_date: "2026-02-01",
      }),
    ).toMatch(/commissioned_on is required/);
    expect(
      problems({
        ...BASE,
        order_date: "2026-01-10",
        current_stage: "plant_complete",
        feasibility_date: "2026-02-01",
      }),
    ).toMatch(/commissioned_on is required/);
  });

  it("rejects commissioning before feasibility or before the order", () => {
    const early = { ...BASE, order_date: "2026-01-10", is_completed: "yes" };
    expect(
      problems({ ...early, feasibility_date: "2026-03-01", commissioned_on: "2026-02-01" }),
    ).toMatch(/commissioned_on 2026-02-01 is before feasibility_date 2026-03-01/);
    expect(problems({ ...early, commissioned_on: "2026-01-01" })).toMatch(
      /commissioned_on 2026-01-01 is before order_date 2026-01-10/,
    );
  });

  it("asks for the order date when a blank one (today) would follow commissioning", () => {
    expect(problems({ ...BASE, is_completed: "yes", commissioned_on: "2026-03-01" })).toMatch(
      /order_date is needed — left blank it means today/,
    );
  });

  it("allows commissioning on the feasibility day itself", () => {
    const row = parsed({
      ...BASE,
      order_date: "2026-01-10",
      feasibility_date: "2026-02-01",
      commissioned_on: "2026-02-01",
    });
    expect(row.feasibility_date).toBe("2026-02-01");
  });

  it("rejects future feasibility and commissioning dates", () => {
    expect(problems({ ...BASE, feasibility_date: "2026-12-01" })).toMatch(
      /feasibility_date 2026-12-01 is in the future/,
    );
    expect(problems({ ...BASE, commissioned_on: "2027-01-01" })).toMatch(
      /commissioned_on 2027-01-01 is in the future/,
    );
  });

  it("rejects an unreadable is_completed", () => {
    expect(problems({ ...BASE, is_completed: "done" })).toMatch(/is_completed must be yes or no/);
  });
});

describe("parseImportRow — custom plans", () => {
  const CUSTOM = { ...BASE, plan_type: "custom", plant_capacity: "Inverter + panel" };

  it("takes free text for what was sold, with no kW in it", () => {
    const row = parsed(CUSTOM);
    expect(row).toMatchObject({
      plan_type: "custom",
      plant_capacity: "Inverter + panel",
      cancellation: null,
    });
    expect(parsed({ ...CUSTOM, plant_capacity: "1 panel" }).plant_capacity).toBe("1 panel");
  });

  it("reads the plan type in the sheet's spellings, and its old name", () => {
    expect(parsed({ ...CUSTOM, plan_type: "Custom plan" }).plan_type).toBe("custom");
    expect(parsed({ ...BASE, plan_type: "Solar plant" }).plan_type).toBe("solar");
    expect(parsed({ ...BASE, plan_type: "" }).plan_type).toBe("solar");
    expect(problems({ ...BASE, plan_type: "kustom" })).toBe(
      'plan_type "kustom" is not recognised — did you mean "custom"?',
    );
  });

  it("does not also call the capacity wrong when the plan type itself is unreadable", () => {
    const error = problems({ ...CUSTOM, plan_type: "kustom" });
    expect(error).toBe('plan_type "kustom" is not recognised — did you mean "custom"?');
  });

  it("holds a custom plan to 120 characters", () => {
    expect(parsed({ ...CUSTOM, plant_capacity: "x".repeat(120) }).plant_capacity).toHaveLength(120);
    expect(problems({ ...CUSTOM, plant_capacity: "x".repeat(121) })).toBe(
      "plant_capacity is too long for a custom plan (121 characters; the most is 120)",
    );
  });

  it("still requires something to say what was sold", () => {
    expect(problems({ ...CUSTOM, plant_capacity: "" })).toBe("plant_capacity is required");
  });

  it("has no KSEB feasibility", () => {
    expect(problems({ ...CUSTOM, feasibility_date: "2026-02-01" })).toBe(
      "feasibility_date is filled but plan_type is custom — a custom plan has no KSEB feasibility",
    );
  });

  it("has no KSEB stages: blank, plant_commissioning or a completion word", () => {
    expect(problems({ ...CUSTOM, current_stage: "panel_installation" })).toBe(
      "a custom plan has no KSEB stages — leave current_stage blank or write completed",
    );
    expect(parsed({ ...CUSTOM, current_stage: "plant_commissioning" }).current_stage).toBe(
      "plant_commissioning",
    );
    const done = parsed({ ...CUSTOM, current_stage: "completed" });
    expect(done).toMatchObject({ current_stage: "plant_commissioning", is_completed: true });
  });

  it("is open at its only step when the stage is blank and it is not completed", () => {
    const row = parsed(CUSTOM);
    expect(row.current_stage).toBe("plant_commissioning");
    expect(row.is_completed).toBe(false);
  });

  it("names the column the sheet used for the plan type", () => {
    const named = { ...ctx(), columnNames: { plan_type: "plan" } as const };
    const res = parseImportRow({ ...CUSTOM, feasibility_date: "2026-02-01" }, 2, named);
    expect(!res.ok && res.error).toContain("but plan is custom");
    const solar = parseImportRow({ ...BASE, plant_capacity: "1 panel" }, 2, named);
    expect(!solar.ok && solar.error).toContain("set plan to custom");
  });

  it("never carries a stage its plan has no milestone for", () => {
    const stages = ["", "site_feasibility_survey", "panel_installation", "plant_commissioning", "completed", "plant_complete"];
    for (const plan_type of ["", "solar", "custom"]) {
      for (const current_stage of stages) {
        for (const is_completed of ["", "yes", "no"]) {
          const res = parseImportRow(
            {
              ...BASE,
              plan_type,
              plant_capacity: plan_type === "custom" ? "Inverter + panel" : "3kW",
              current_stage,
              is_completed,
            },
            2,
            ctx(),
          );
          if (!res.ok) continue;
          expect(stagesFor(res.data.plan_type)).toContain(res.data.current_stage);
        }
      }
    }
  });
});

describe("parseImportRow — cancelled and refunded", () => {
  const REFUNDED = { ...BASE, order_date: "2025-01-13", cancellation: "refunded" };

  it("carries the cancellation, its date and remarks", () => {
    const row = parsed({
      ...REFUNDED,
      cancelled_on: "2025-02-01",
      cancellation_remarks: "REFUNDED",
    });
    expect(row).toMatchObject({
      cancellation: "refunded",
      cancelled_on: "2025-02-01",
      cancellation_remarks: "REFUNDED",
      current_stage: "site_feasibility_survey",
      is_completed: false,
    });
  });

  it.each([
    ["Cancelled", "cancelled"],
    ["canceled", "cancelled"],
    ["Refund", "refunded"],
    ["active", null],
    ["", null],
  ])("reads %j as %j", (cell, expected) => {
    expect(parsed({ ...REFUNDED, cancellation: cell }).cancellation).toBe(expected);
  });

  it("leaves the cancelled date unrecorded when the sheet has none and no clock runs", () => {
    expect(parsed(REFUNDED).cancelled_on).toBeNull();
  });

  it("requires the date when a feasibility date means a clock is running", () => {
    expect(problems({ ...REFUNDED, feasibility_date: "2025-02-01" })).toBe(
      "cancelled_on is required for a cancelled project with a feasibility_date — it stops the feasibility clock",
    );
    expect(
      parsed({ ...REFUNDED, feasibility_date: "2025-02-01", cancelled_on: "2025-03-01" })
        .cancelled_on,
    ).toBe("2025-03-01");
  });

  it("refuses a cancelled date before the order, or in the future", () => {
    expect(problems({ ...REFUNDED, cancelled_on: "2024-12-01" })).toBe(
      "cancelled_on 2024-12-01 is before order_date 2025-01-13",
    );
    expect(problems({ ...REFUNDED, cancelled_on: "2026-11-01" })).toMatch(
      /cancelled_on 2026-11-01 is in the future/,
    );
  });

  it("refuses a date or remarks without a cancellation", () => {
    expect(problems({ ...BASE, cancelled_on: "2026-01-01" })).toBe(
      "cancelled_on is filled but cancellation is blank",
    );
    expect(problems({ ...BASE, cancellation_remarks: "REFUNDED" })).toBe(
      "cancellation_remarks is filled but cancellation is blank — set cancellation or move the text to notes",
    );
  });

  it("does not call an unreadable cancellation cell blank", () => {
    const error = problems({ ...BASE, cancellation: "maybe", cancelled_on: "2026-01-01" });
    expect(error).toMatch(/cancellation "maybe" is not recognised/);
    expect(error).not.toMatch(/is blank/);
  });

  it("holds the remarks to 2000 characters", () => {
    expect(parsed({ ...REFUNDED, cancellation_remarks: "x".repeat(2000) }).cancellation_remarks)
      .toHaveLength(2000);
    expect(problems({ ...REFUNDED, cancellation_remarks: "x".repeat(2001) })).toBe(
      "cancellation_remarks is too long (2001 characters; the most is 2000)",
    );
  });

  it("allows a commissioned project to be cancelled afterwards", () => {
    const row = parsed({ ...REFUNDED, current_stage: "plant_complete" });
    expect(row).toMatchObject({ is_completed: true, cancellation: "refunded" });
  });

  it("stores a missing capacity as 'Not recorded' and a missing price as 0", () => {
    const row = parsed({ ...REFUNDED, plant_capacity: "", total_cost: "" });
    expect(row).toMatchObject({
      plan_type: "solar",
      plant_capacity: NOT_RECORDED_LABEL,
      total_cost: 0,
    });
    expect(NOT_RECORDED_LABEL).toBe("Not recorded");
    // The same for a custom plan, which keeps its plan.
    expect(
      parsed({ ...REFUNDED, plan_type: "custom", plant_capacity: "", total_cost: "" }),
    ).toMatchObject({ plan_type: "custom", plant_capacity: "Not recorded", total_cost: 0 });
  });

  it("does not compare payments with a price that was never written down", () => {
    const row = parsed(
      { ...REFUNDED, plant_capacity: "", total_cost: "", payment_1_amount: "10000", payment_1_date: "2025-01-13" },
      [1],
    );
    expect(row.payments).toHaveLength(1);
  });

  it("still compares payments with a price that is written down", () => {
    expect(
      problems({ ...REFUNDED, total_cost: "5000", payment_1_amount: "10000", payment_1_date: "2025-01-13" }, [1]),
    ).toMatch(/more than total_cost/);
  });

  it("refuses a blank total with an advance: stored as 0 total, the advance would be more than it", () => {
    const blankTotal = { ...REFUNDED, plant_capacity: "", total_cost: "" };
    const message =
      "total_cost is blank but advance_amount is filled — enter the total, or clear the advance";
    expect(problems({ ...blankTotal, advance_amount: "50000" })).toBe(message);
    expect(problems({ ...blankTotal, cancellation: "cancelled", advance_amount: "1" })).toBe(message);
    // Said with the row's other problems, not instead of them.
    expect(problems({ ...blankTotal, order_date: "", advance_amount: "50000" })).toMatch(
      /^order_date is required.*; total_cost is blank but advance_amount is filled/,
    );
  });

  it("lets a blank total through when there is no advance to be more than it", () => {
    const blankTotal = { ...REFUNDED, plant_capacity: "", total_cost: "" };
    for (const advance_amount of ["", "0"]) {
      expect(parsed({ ...blankTotal, advance_amount })).toMatchObject({
        total_cost: 0,
        advance_amount: 0,
      });
    }
  });

  it("does not add the advance message when the total is written, unreadable or on a live row", () => {
    expect(parsed({ ...REFUNDED, total_cost: "100000", advance_amount: "50000" })).toMatchObject({
      total_cost: 100000,
      advance_amount: 50000,
    });
    // A total that cannot be read is that problem, not a blank one.
    expect(problems({ ...REFUNDED, total_cost: "lots", advance_amount: "50000" })).not.toMatch(
      /is blank/,
    );
    // A live row's blank total is "required", whatever the advance.
    expect(problems({ ...BASE, total_cost: "", advance_amount: "50000" })).toBe(
      "total_cost is required",
    );
  });

  it("does not make a live row's missing capacity or price acceptable", () => {
    expect(problems({ ...BASE, plant_capacity: "", total_cost: "" })).toBe(
      "plant_capacity is required; total_cost is required",
    );
  });

  it("requires its order date", () => {
    expect(problems({ ...REFUNDED, order_date: "" })).toBe(
      "order_date is required for a cancelled or refunded row — the import never invents dates",
    );
  });
});

describe("parseImportRow — payments", () => {
  const slots = [1, 2, 3, 4, 5];
  const pay = (n: number, cells: Partial<Record<string, string>>) =>
    Object.fromEntries(Object.entries(cells).map(([f, v]) => [`payment_${n}_${f}`, v ?? ""]));

  it("reads any number of stages, defaulting method and purpose", () => {
    const row = parsed(
      {
        ...BASE,
        ...pay(1, { amount: "40000", date: "2026-06-30", method: "UPI", reference: "UPI 4411" }),
        ...pay(2, { amount: "4540", date: "2026-07-10", method: "cash", purpose: "KSEB fees" }),
        ...pay(3, { amount: "60,000", date: "2026-08-28", method: "Loan disbursement" }),
        ...pay(4, { amount: "50000", date: "2026-09-25", method: "Bank transfer" }),
        ...pay(5, { amount: "10000", date: "2026-10-01" }),
      },
      slots,
    );
    const entry = (
      amount: number,
      paid_on: string,
      method: string,
      purpose: string,
      reference: string | null = null,
    ) => ({ amount, paid_on, method, purpose, paid_by_office: false, reference, notes: null });
    expect(row.payments).toEqual([
      entry(40000, "2026-06-30", "upi", "contract", "UPI 4411"),
      entry(4540, "2026-07-10", "cash", "kseb_fees"),
      entry(60000, "2026-08-28", "loan_disbursement", "contract"),
      entry(50000, "2026-09-25", "bank_transfer", "contract"),
      entry(10000, "2026-10-01", "other", "contract"),
    ]);
    // KSEB fees never count towards the contract.
    expect(ledgerTotals(row.payments).contract).toBe(160000);
  });

  it("skips a blank group", () => {
    expect(parsed({ ...BASE, ...pay(1, { amount: "", date: "" }) }, [1]).payments).toEqual([]);
  });

  it("requires amount and date once any cell of the group is filled", () => {
    const error = problems(
      { ...BASE, ...pay(1, { method: "cash" }), ...pay(2, { amount: "1000" }) },
      [1, 2],
    );
    expect(error).toContain("payment_1_amount is required — other payment 1 cells are filled");
    expect(error).toContain("payment_1_date is required");
    expect(error).toContain("payment_2_date is required");
  });

  it("rejects zero, future, malformed and unknown values", () => {
    const error = problems(
      {
        ...BASE,
        ...pay(1, { amount: "0", date: "2026-11-01" }),
        ...pay(2, { amount: "100", date: "2026-07-01", method: "barter", purpose: "subsidy" }),
      },
      [1, 2],
    );
    expect(error).toContain("payment_1_amount must be more than zero");
    expect(error).toContain("payment_1_date 2026-11-01 is in the future");
    expect(error).toContain('payment_2_method "barter" is not recognised');
    expect(error).toContain('payment_2_purpose "subsidy" is not recognised');
  });

  it("guards against collecting more than the contract (a slipped digit)", () => {
    const error = problems(
      { ...BASE, advance_amount: "20000", ...pay(1, { amount: "1800000", date: "2026-07-01" }) },
      [1],
    );
    expect(error).toMatch(
      /advance_amount plus contract payments come to ₹18,20,000.*more than total_cost ₹1,95,000/,
    );
  });

  it("allows exactly the contract value, and KSEB fees on top of it", () => {
    const row = parsed(
      {
        ...BASE,
        advance_amount: "95000",
        ...pay(1, { amount: "100000", date: "2026-07-01" }),
        ...pay(2, { amount: "4540", date: "2026-07-02", purpose: "kseb_fees" }),
      },
      [1, 2],
    );
    expect(
      paymentSummary({ ...row, payments_total: ledgerTotals(row.payments).contract }).balanceDue,
    ).toBe(0);
  });
});

const HEADER = "client_name,plant_capacity,total_cost,coordinator";
const OPTIONS: ImportPlanOptions = { today: TODAY, directory: DIRECTORY, defaultCoordinatorId: null };

function plan(text: string, options: Partial<ImportPlanOptions> = {}): ImportPlan {
  const res = planImport(text, { ...OPTIONS, ...options });
  if (!res.ok) throw new Error(res.error);
  return res.data;
}

describe("planImport", () => {
  it("rejects an empty upload, a bad header and a header with no rows", () => {
    expect(planImport("   ", OPTIONS)).toEqual({
      ok: false,
      error: expect.stringMatching(/Paste CSV/),
    });
    expect(planImport("client_name,foo\nA,B", OPTIONS)).toEqual({
      ok: false,
      error: expect.stringMatching(/header row needs fixing/),
    });
    expect(planImport(`${HEADER}\n`, OPTIONS)).toEqual({
      ok: false,
      error: expect.stringMatching(/No data rows/),
    });
  });

  it(`caps an upload at ${MAX_IMPORT_ROWS} rows`, () => {
    const rows = Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, i) => `C${i},3kW,1000,Rahul`);
    const res = planImport([HEADER, ...rows].join("\n"), OPTIONS);
    expect(res).toEqual({ ok: false, error: expect.stringMatching(/Too many rows \(1001\)/) });
  });

  it("keeps every row when a cell holds a quote mark", () => {
    const res = plan(
      [
        "client_name,plant_capacity,total_cost,notes,consumer_number,coordinator",
        'Anand,3kW,195000,Needs 2" conduit,111,Rahul',
        "Meera,5kW,310000,,222,Rahul",
        "Joseph,8kW,480000,,333,Rahul",
      ].join("\n"),
    );
    const rows = res.rows.map((r) => {
      if (!r.parsed.ok) throw new Error(r.parsed.error);
      return [r.parsed.data.client_name, r.parsed.data.notes, r.parsed.data.consumer_number];
    });
    expect(rows).toEqual([
      ["Anand", 'Needs 2" conduit', "111"],
      ["Meera", null, "222"],
      ["Joseph", null, "333"],
    ]);
  });

  it("refuses a file whose quote never closes rather than merge the rows after it", () => {
    const res = planImport(
      [
        "client_name,plant_capacity,total_cost,notes",
        "Anand,3kW,195000,",
        'Meera,5kW,310000,"Balance due after subsidy',
        "Joseph,8kW,480000,",
      ].join("\n"),
      OPTIONS,
    );
    expect(res).toEqual({
      ok: false,
      error: expect.stringMatching(/^Unclosed quote starting on line 3\b/),
    });
  });

  it("fails a row with values past the last column, that problem first", () => {
    const res = plan(
      [
        "client_name,plant_capacity,total_cost,address,advance_amount,coordinator",
        // An unquoted comma in the address shifts the advance one column right.
        "Anand,3kW,195000,Vytilla, Kochi,20000,Rahul",
        "Meera,5kW,310000,Kowdiar,50000,Rahul,",
        "Joseph,8kW,480000,Kakkanad,10000,Rahul,NEFT 4471",
      ].join("\n"),
    );
    const [shifted, trailingComma, lastColumn] = res.rows.map((r) => r.parsed);

    expect(shifted.ok).toBe(false);
    if (shifted.ok) return;
    expect(shifted.error).toMatch(
      /^Row has 7 cells but the header has 6 — put values that contain commas in double quotes \(past the last column: "Rahul"\); /,
    );

    // A spreadsheet's trailing comma adds a blank cell, not a value.
    expect(trailingComma.ok).toBe(true);

    // An otherwise valid row still fails: its extra value has nowhere to go.
    expect(lastColumn).toEqual({
      ok: false,
      error:
        'Row has 7 cells but the header has 6 — put values that contain commas in double quotes (past the last column: "NEFT 4471")',
    });
  });

  it("numbers rows by sheet line and keeps each row's own result", () => {
    const res = plan([HEADER, "Anand,3kW,195000,Rahul", ",,,", "No Capacity,,1000,Rahul"].join("\n"));
    // The all-comma line is dropped by the CSV reader, but it is still line 3.
    expect(res.rows.map((r) => [r.rowNo, r.client, r.parsed.ok])).toEqual([
      [2, "Anand", true],
      [4, "No Capacity", false],
    ]);
    expect(res.rows[1].cells).toEqual({
      client_name: "No Capacity",
      plant_capacity: "",
      total_cost: "1000",
      coordinator: "Rahul",
    });
  });

  describe("the row numbers are the sheet's lines", () => {
    // Line 1 is blank, the header is line 2; blank and all-comma lines fall
    // between the rows, and B's note spans lines 6 and 7.
    const text = [
      "",
      "client_name,plant_capacity,total_cost,notes,coordinator,consumer_number",
      "A,3kW,1000,,Rahul,",
      "",
      ",,,,,",
      'B,3kW,2000,"two',
      'lines",Ravi,',
      "",
      "C,,3000,,Abhijit,",
    ].join("\n");

    it("count blank lines, all-comma lines and the lines of a multi-line cell", () => {
      const res = plan(text);
      expect(res.rows.map((r) => [r.rowNo, r.client, r.parsed.ok])).toEqual([
        [3, "A", true],
        [6, "B", true],
        [9, "C", false],
      ]);
      const [, b] = res.rows;
      expect(b.parsed.ok && b.parsed.data).toMatchObject({ row_no: 6, notes: "two\nlines" });
    });

    it("are the ones the matches panel and the warnings point at", () => {
      const res = plan(
        [
          "client_name,plant_capacity,total_cost,order_date,coordinator",
          "",
          "A,3kW,1000,2025-01-01,Rahul",
          "",
          "",
          "A,3kW,1000,2025-01-01,Rahul",
        ].join("\n"),
      );
      expect(res.coordinatorMatches.map((m) => [m.written, m.rows])).toEqual([["Rahul", [3, 6]]]);
      expect(res.warnings).toEqual([
        expect.stringMatching(/^2 rows have no consumer_number/),
        "Rows 3 and 6 look like the same sale (A, 2025-01-01, ₹1,000) — remove one if so",
      ]);
    });

    it("are the ones a failed row is reported under", () => {
      const res = plan(text);
      expect(res.rows.find((r) => !r.parsed.ok)?.rowNo).toBe(9);
      expect(res.coordinatorMatches.find((m) => m.written === "Abhijit")?.rows).toEqual([9]);
    });
  });

  it("reads a file whose coordinator column has an old name, and says so under that name", () => {
    const res = plan(
      [
        "client_name,plant_capacity,total_cost,coordinator_email",
        "Anand,3kW,195000,Rahul",
        "Meera,3kW,195000,Abhijit",
        "Joseph,3kW,195000,",
      ].join("\n"),
    );
    expect(res.rows[0].parsed.ok && res.rows[0].parsed.data.coordinator_ids).toEqual([RAHUL.id]);
    const abhijit = res.rows[1].parsed;
    expect(!abhijit.ok && abhijit.error).toMatch(/^coordinator_email "Abhijit" is not/);
    const blank = res.rows[2].parsed;
    expect(!blank.ok && blank.error).toMatch(/^coordinator_email is blank/);
    // The failed-rows download keeps the uploaded header.
    expect(res.headers).toContain("coordinator_email");
  });

  it("reads the plan type through its old name", () => {
    const res = plan(
      ["client_name,plant_capacity,total_cost,coordinator,plan", "Anand,1 panel,5000,Rahul,custom"].join(
        "\n",
      ),
    );
    expect(res.rows[0].parsed.ok && res.rows[0].parsed.data.plan_type).toBe("custom");
  });

  describe("the default coordinator", () => {
    const csv = [HEADER, "Anand,3kW,195000,", "Meera,3kW,195000,Rahul"].join("\n");

    it("is nobody unless chosen: a blank cell fails", () => {
      const res = plan(csv);
      expect(res.rows.map((r) => [r.parsed.ok, r.defaulted])).toEqual([
        [false, false],
        [true, false],
      ]);
    });

    it("fills blank cells when chosen, and marks those rows", () => {
      const res = plan(csv, { defaultCoordinatorId: PRIYA.id });
      expect(res.rows.map((r) => [r.parsed.ok, r.defaulted, r.coordinators])).toEqual([
        [true, true, ["Priya Suresh"]],
        [true, false, ["Rahul Menon"]],
      ]);
    });

    it("must be an account that can own a sale", () => {
      for (const id of [ENGINEER.id, "not-an-account"]) {
        expect(planImport(csv, { ...OPTIONS, defaultCoordinatorId: id })).toEqual({
          ok: false,
          error: "Select a default coordinator who is a coordinator or office account.",
        });
      }
      expect(planImport(csv, { ...OPTIONS, defaultCoordinatorId: ADMIN.id }).ok).toBe(true);
    });

    it("refuses an incentive on a defaulted row, whoever the default is", () => {
      const res = plan(
        "client_name,plant_capacity,total_cost,coordinator,coordinator_incentive\nAnand,3kW,1000,,500",
        { defaultCoordinatorId: PRIYA.id },
      );
      const row = res.rows[0].parsed;
      expect(!row.ok && row.error).toMatch(/^coordinator_incentive needs the coordinator cell filled/);
    });
  });

  describe("coordinator matches", () => {
    const text = [
      HEADER,
      "A,3kW,1000,Ravi + Abhijith",
      "B,3kW,1000,Abhijith+Ravi",
      "C,3kW,1000,sudheesh(sheeja)",
      "D,3kW,1000,Abhijit",
      "E,3kW,1000,",
      "F,3kW,1000,sudheesh",
      "G,3kW,1000,Abhijit",
      "H,3kW,1000,OFFICE",
    ].join("\n");
    const summary = (res: ImportPlan) =>
      res.coordinatorMatches.map((m) => [m.written, m.account?.fullName ?? null, m.rows]);

    it("lists each distinct reference once with every row it is on, problems first", () => {
      expect(summary(plan(text))).toEqual([
        ["Abhijit", null, [5, 8]],
        ["", null, [6]],
        ["OFFICE", null, [9]],
        ["Ravi", "Ravi Kumar", [2, 3]],
        ["Abhijith", "Abhijith Nair", [2, 3]],
        ["sudheesh", "Sudheesh Pillai", [4, 7]],
      ]);
    });

    it("says why each problem entry is one, in words that follow the written name", () => {
      const [close, blank, office] = plan(text).coordinatorMatches;
      expect(close.problem).toBe(
        "is not a coordinator or office account — did you mean Abhijith Nair (abhijith@bsssolar.test)?",
      );
      expect(blank.problem).toBe("no default coordinator was chosen — these rows fail");
      expect(office.problem).toMatch(/^is not an account — write the e-mail of the office account/);
    });

    it("shows the default coordinator against the blank cells when one was chosen", () => {
      const withDefault = plan(text, { defaultCoordinatorId: PRIYA.id });
      const blank = withDefault.coordinatorMatches.find((m) => m.written === "");
      expect(blank).toMatchObject({ account: PRIYA, problem: null, rows: [6] });
      // It is no longer a problem, so it sorts with the resolved ones.
      expect(summary(withDefault).map((m) => m[0])).toEqual([
        "Abhijit",
        "OFFICE",
        "Ravi",
        "Abhijith",
        "sudheesh",
        "",
      ]);
    });

    it("has no blank entry when no cell is blank", () => {
      expect(plan(`${HEADER}\nA,3kW,1,Rahul`).coordinatorMatches.map((m) => m.written)).toEqual([
        "Rahul",
      ]);
    });

    it("counts a failing row's references too — that is what the office must fix", () => {
      const res = plan(`${HEADER}\nA,,1,Abhijit`);
      expect(res.rows[0].parsed.ok).toBe(false);
      expect(res.coordinatorMatches[0]).toMatchObject({ written: "Abhijit", rows: [2] });
    });

    it("lists a cell that cannot be read, so every coordinator problem is in the panel", () => {
      const res = plan(`${HEADER}
A,3kW,1,sudheesh(sheeja
B,3kW,1,Rahul`);
      expect(res.coordinatorMatches[0]).toEqual({
        written: "sudheesh(sheeja",
        account: null,
        problem: "has an unclosed bracket",
        rows: [2],
      });
    });

    it("treats spelling variants of one reference as the same entry", () => {
      const res = plan(`${HEADER}\nA,3kW,1,Ravi\nB,3kW,1,  ravi `);
      expect(res.coordinatorMatches).toHaveLength(1);
      expect(res.coordinatorMatches[0].rows).toEqual([2, 3]);
    });
  });

  describe("row warnings", () => {
    it("carry a blank order_date on every row that has one", () => {
      const res = plan(
        "client_name,plant_capacity,total_cost,coordinator,order_date\nA,3kW,1,Rahul,\nB,3kW,1,Rahul,2026-01-02",
      );
      expect(res.rows.map((r) => r.warnings)).toEqual([
        [`order_date is blank — today (${TODAY}) will be used`],
        [],
      ]);
    });

    it("are dropped from a row that fails, whose message already says what to fix", () => {
      const res = plan(`${HEADER},order_date\nA,,1,Rahul,`);
      expect(res.rows[0].parsed.ok).toBe(false);
      expect(res.rows[0].warnings).toEqual([]);
    });
  });

  describe("file warnings", () => {
    it("count the rows without a consumer number, and say what to upload to retry", () => {
      const res = plan(
        [
          "client_name,plant_capacity,total_cost,coordinator,consumer_number",
          "A,3kW,1,Rahul,111",
          "B,3kW,2,Rahul,",
          "C,3kW,3,Rahul,",
        ].join("\n"),
      );
      expect(res.warnings).toEqual([
        "2 rows have no consumer_number — they will be imported again on every upload; to retry, upload only the failed-rows download",
      ]);
    });

    it("use the singular for one row, and are silent when every row has a number", () => {
      expect(
        plan("client_name,plant_capacity,total_cost,coordinator,consumer_number\nA,3kW,1,Rahul,").warnings,
      ).toEqual([
        "1 row has no consumer_number — it will be imported again on every upload; to retry, upload only the failed-rows download",
      ]);
      expect(
        plan("client_name,plant_capacity,total_cost,coordinator,consumer_number\nA,3kW,1,Rahul,9").warnings,
      ).toEqual([]);
    });

    it("count only the rows that will import", () => {
      const res = plan(`${HEADER}\nA,3kW,1,Rahul\nB,,1,Rahul`);
      expect(res.warnings[0]).toMatch(/^1 row has no consumer_number/);
    });

    it("name two rows that look like the same sale", () => {
      const res = plan(
        [
          "client_name,plant_capacity,total_cost,coordinator,order_date,consumer_number",
          "Prasad K,3kW,235000,Rahul,2025-01-08,1",
          "Other,3kW,100,Rahul,2025-01-08,2",
          "prasad  k.,3kW,235000,Priya,2025-01-08,3",
          "Prasad K,3kW,235000,Rahul,2025-01-09,4",
        ].join("\n"),
      );
      expect(res.warnings).toEqual([
        "Rows 2 and 4 look like the same sale (Prasad K, 2025-01-08, ₹2,35,000) — remove one if so",
      ]);
    });

    it("name three rows, and do not pair a row with a failed one", () => {
      const res = plan(
        [
          "client_name,plant_capacity,total_cost,coordinator,order_date,consumer_number",
          "Prasad K,3kW,1000,Rahul,2025-01-08,1",
          "Prasad K,3kW,1000,Rahul,2025-01-08,2",
          "Prasad K,3kW,1000,Rahul,2025-01-08,3",
          "Prasad K,not a capacity,1000,Rahul,2025-01-08,4",
        ].join("\n"),
      );
      expect(res.warnings).toEqual([
        "Rows 2, 3 and 4 look like the same sale (Prasad K, 2025-01-08, ₹1,000) — remove one if so",
      ]);
    });

    describe("a consumer number repeated within the file", () => {
      const COLUMNS = "client_name,plant_capacity,total_cost,coordinator,consumer_number";
      const sheet = (...rows: string[]) => [COLUMNS, ...rows].join("\n");
      // The wording, with the parts that vary.
      const repeats = (rows: string, number: string, first: number, rest = "the others are") =>
        `Rows ${rows} share consumer number ${number} — only the first (row ${first}) will be imported; ${rest} skipped. Turn off "Skip rows whose consumer number already exists" to import them all.`;

      it("is named, with the row that will go in, because the import skips the others", () => {
        const res = plan(
          sheet(
            "A,3kW,1,Rahul,1", // line 2
            "B,3kW,2,Rahul,NA", // 3
            "C,3kW,3,Rahul,2", // 4
            "D,3kW,4,Rahul,NA", // 5
            "E,3kW,5,Rahul,3", // 6
            "F,3kW,6,Rahul,4", // 7
            "G,3kW,7,Rahul,5", // 8
            "H,3kW,8,Rahul,NA", // 9
          ),
        );
        expect(res.warnings).toEqual([
          'Rows 3, 5 and 9 share consumer number NA — only the first (row 3) will be imported; the others are skipped. Turn off "Skip rows whose consumer number already exists" to import them all.',
        ]);
      });

      it("says 'the other' when only two rows share a number, and names every group", () => {
        const res = plan(
          sheet(
            "A,3kW,1,Rahul,10",
            "B,3kW,2,Rahul,20",
            "C,3kW,3,Rahul,10",
            "D,3kW,4,Rahul,20",
            "E,3kW,5,Rahul,20",
          ),
        );
        expect(res.warnings).toEqual([
          repeats("2 and 4", "10", 2, "the other is"),
          repeats("3, 5 and 6", "20", 3),
        ]);
      });

      it("ignores whitespace, as the database does, but not case", () => {
        const res = plan(
          sheet(
            "A,3kW,1,Rahul,1156 789",
            "B,3kW,2,Rahul,1156789",
            "C,3kW,3,Rahul,ab1",
            "D,3kW,4,Rahul,AB1",
          ),
        );
        expect(res.warnings).toEqual([repeats("2 and 3", "1156 789", 2, "the other is")]);
      });

      it("counts only the rows that will import: a failed row does not hold the number", () => {
        const res = plan(sheet("A,,1,Rahul,NA", "B,3kW,2,Rahul,NA", "C,3kW,3,Rahul,NA"));
        expect(res.rows[0].parsed.ok).toBe(false);
        expect(res.warnings).toEqual([repeats("3 and 4", "NA", 3, "the other is")]);
        // One valid row is no repeat.
        expect(plan(sheet("A,,1,Rahul,NA", "B,3kW,2,Rahul,NA")).warnings).toEqual([]);
      });

      it("leaves out rows with no number, which the first warning already counts", () => {
        const res = plan(sheet("A,3kW,1,Rahul,", "B,3kW,2,Rahul,", "C,3kW,3,Rahul,7"));
        expect(res.warnings).toHaveLength(1);
        expect(res.warnings[0]).toMatch(/^2 rows have no consumer_number/);
      });

      it("is only said when skipping is on: with it off every row imports", () => {
        const csv = sheet("A,3kW,1,Rahul,NA", "B,3kW,2,Rahul,NA");
        const warning = repeats("2 and 3", "NA", 2, "the other is");
        expect(plan(csv, { skipExisting: true }).warnings).toEqual([warning]);
        // Skipping is the default, as in the form.
        expect(plan(csv).warnings).toEqual([warning]);
        expect(plan(csv, { skipExisting: false }).warnings).toEqual([]);
      });

      it("counts the rest of a long list instead of printing it", () => {
        const rows = Array.from({ length: 15 }, (_, i) => `C${i},3kW,${i + 1},Rahul,-`);
        const [warning] = plan(sheet(...rows)).warnings;
        expect(warning).toMatch(
          /^Rows 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13 and 3 more share consumer number - — only the first \(row 2\) will be imported; the others are skipped\./,
        );
      });

      it("comes after the count of rows without a number and before a look-alike sale", () => {
        const res = plan(
          [
            "client_name,plant_capacity,total_cost,coordinator,order_date,consumer_number",
            "A,3kW,1000,Rahul,2025-01-08,NA",
            "A,3kW,1000,Rahul,2025-01-08,NA",
            "B,3kW,1,Rahul,2025-01-08,",
          ].join("\n"),
        );
        expect(res.warnings).toEqual([
          expect.stringMatching(/^1 row has no consumer_number/),
          expect.stringMatching(/^Rows 2 and 3 share consumer number NA/),
          expect.stringMatching(/^Rows 2 and 3 look like the same sale/),
        ]);
      });
    });

    describe("text damaged in reading (U+FFFD)", () => {
      const COLUMNS = "client_name,plant_capacity,total_cost,coordinator,notes";

      it("names the rows with a replacement character, failed rows too", () => {
        const res = plan(
          [
            COLUMNS,
            "Ravi \uFFFD K,3kW,1,Rahul,", // line 2: valid, damaged name
            "Clean,3kW,2,Rahul,fine", // 3
            "Meera,,3,Rahul,caf\uFFFD", // 4: fails, and damaged
          ].join("\n"),
        );
        expect(res.rows.map((r) => r.parsed.ok)).toEqual([true, true, false]);
        expect(res.warnings[0]).toBe(
          "Rows 2 and 4 contain the replacement character \uFFFD — text was damaged when the file was read, usually because it was not saved as CSV UTF-8. Fix those cells, or export the sheet again as CSV UTF-8.",
        );
      });

      it("says Row and that cell for one", () => {
        const res = plan([COLUMNS, "Ravi,3kW,1,Rahul,caf\uFFFD"].join("\n"));
        expect(res.warnings[0]).toMatch(
          /^Row 2 contains the replacement character \uFFFD — .* Fix that cell, or export/,
        );
      });

      it("comes first, and is silent for a file without one", () => {
        const damaged = plan([COLUMNS, "Ravi \uFFFD K,3kW,1,Rahul,"].join("\n"));
        expect(damaged.warnings).toHaveLength(2);
        expect(damaged.warnings[0]).toMatch(/^Row 2 contains the replacement character/);
        expect(damaged.warnings[1]).toMatch(/^1 row has no consumer_number/);
        expect(
          plan([COLUMNS, "Ravi – K,3kW,1,Rahul,café ₹"].join("\n")).warnings.join(),
        ).not.toMatch(/replacement character/);
      });
    });

    it("note completed rows whose commissioning date is not recorded", () => {
      const res = plan(
        [
          "client_name,plant_capacity,total_cost,coordinator,order_date,current_stage,commissioned_on,consumer_number",
          "A,3kW,1,Rahul,2025-01-08,plant_complete,,1",
          "B,3kW,2,Rahul,2025-01-08,plant_complete,2025-02-01,2",
          "C,3kW,3,Rahul,2025-01-08,,,3",
        ].join("\n"),
      );
      expect(res.warnings).toEqual([
        "1 completed row has no commissioned_on — it is imported as complete with the commissioning date not recorded",
      ]);
    });
  });
});

/**
 * A made-up sheet that has every quirk of the one the office is bringing in
 * (BOM, Excel's CRLF, names joined with "+", a remark in brackets, a sum for a
 * price, "plant_complete", custom plans, a refund with no stage, an admin
 * e-mail, a quoted note) and none of its customers.
 */
describe("a sheet with every quirk of the real one", () => {
  const COLUMNS = [
    "client_name",
    "plan_type",
    "plant_capacity",
    "total_cost",
    "order_date",
    "coordinator",
    "current_stage",
    "is_completed",
    "cancellation",
    "cancellation_remarks",
    "notes",
    "payment_1_amount",
    "payment_1_date",
    "payment_2_amount",
    "payment_2_date",
    "payment_2_purpose",
  ];
  const SHEET: string[][] = [
    ["Customer 01", "", "3kW", "228000", "2025-01-01", "sudheesh", "plant_complete", "yes", "", "", "", "50000", "2025-01-01", "50000", "2025-01-19", ""],
    ["Customer 02", "", "3kW", "228000", "2025-01-03", "Ravi + Abhijith", "plant_complete", "yes", "", "", "", "10000", "2025-01-03", "140000", "2025-01-07", ""],
    ["Customer 03", "", "5kW", "350000", "2025-01-08", "Manohar", "plant_complete", "yes", "", "", "", "50000", "2025-01-08", "130000", "2025-01-15", ""],
    ["Customer 04", "", "5kW", "355000", "2025-01-10", "Abhijith+Ravi", "plant_complete", "yes", "", "", "", "10000", "2025-01-10", "40000", "2025-01-14", ""],
    ["Customer 05", "custom", "1 panel", "18000", "2025-01-10", "Sudheesh", "plant_complete", "yes", "", "", "", "18000", "2025-01-10", "", "", ""],
    ["Customer 06", "", "8kW", "550000", "2025-01-10", "Nishanth", "plant_complete", "yes", "", "", "", "110000", "2025-01-10", "200000", "2025-01-21", ""],
    ["Customer 07", "", "3kW", "235000", "2025-01-13", "Abhijith+Ravi", "", "", "refunded", "REFUNDED", "", "10000", "2025-01-13", "", "", ""],
    ["Customer 08", "custom", "Inverter+panel", "23500", "2025-01-23", "sudheesh", "plant_complete", "yes", "", "", "", "23500", "2025-01-23", "", "", ""],
    ["Customer 09(Spouse)", "", "5kW", "355000", "2025-01-15", "Abhijith+Ravi", "plant_complete", "yes", "", "", "", "189985.84", "2025-01-15", "67000", "2025-01-16", ""],
    ["Customer 10", "custom", "1kW", "23500", "2025-01-18", "sudheesh", "", "", "", "", "INCOMPLETE", "", "", "", "", ""],
    ["Customer 11", "custom", "1kW", "23000", "2025-01-20", "sudheesh(sheeja)", "plant_complete", "yes", "", "", "", "23000", "2025-01-20", "", "", ""],
    ["Customer 12", "", "3kW+inverter", "235000+23500", "2025-01-20", "Abhijith+Ravi", "plant_complete", "yes", "", "", "", "140000", "2025-01-20", "15000", "2025-02-22", ""],
    ["Customer 13", "", "3kW", "225000", "2025-01-22", "Abhijith+Ravi", "plant_complete", "yes", "", "", "KSEB feasibility fee Rs 1,180 recorded as a separate payment (not part of the contract price).", "5000", "2025-01-22", "1180", "2025-01-22", "kseb_fees"],
    ["Customer 14", "", "3kw+inverter", "230000+23500", "2025-01-30", "admin@bsssolar.test", "plant_complete", "yes", "", "", "", "140000", "2025-01-30", "60000", "2025-02-27", ""],
    ["Customer 02", "", "3kW", "228000", "2025-01-03", "Manohar", "plant_complete", "yes", "", "", "", "10000", "2025-01-03", "140000", "2025-01-07", ""],
  ];

  /** What Excel writes: a BOM, CRLF line ends. */
  const excel = (rows: string[][]) => `﻿${toCsv([COLUMNS, ...rows]).replaceAll("\n", "\r\n")}`;
  const sheet = plan(excel(SHEET));
  const row = (n: number) => {
    const found = sheet.rows.find((r) => r.rowNo === n);
    if (!found?.parsed.ok) throw new Error(`row ${n}: ${found?.parsed.ok === false ? found.parsed.error : "missing"}`);
    return found.parsed.data;
  };

  it("imports every row", () => {
    expect(sheet.rows.filter((r) => !r.parsed.ok).map((r) => r.parsed)).toEqual([]);
    expect(sheet.rows).toHaveLength(SHEET.length);
  });

  it("reads the shared sales in the order written", () => {
    expect(row(3).coordinator_ids).toEqual([RAVI.id, ABHIJITH.id]);
    expect(row(5).coordinator_ids).toEqual([ABHIJITH.id, RAVI.id]);
    expect(sheet.rows[1].coordinators).toEqual(["Ravi Kumar", "Abhijith Nair"]);
  });

  it("completes the plant_complete rows with the date left unrecorded", () => {
    expect(row(2)).toMatchObject({
      is_completed: true,
      current_stage: "plant_commissioning",
      commissioned_on: null,
    });
  });

  it("makes the 1 panel and Inverter+panel rows custom plans, handed over", () => {
    expect(row(6)).toMatchObject({
      plan_type: "custom",
      plant_capacity: "1 panel",
      is_completed: true,
      current_stage: "plant_commissioning",
    });
    expect(row(9)).toMatchObject({ plan_type: "custom", plant_capacity: "Inverter+panel" });
  });

  it("leaves a custom row with a blank stage open at its only step", () => {
    expect(row(11)).toMatchObject({
      plan_type: "custom",
      is_completed: false,
      current_stage: "plant_commissioning",
      notes: "INCOMPLETE",
    });
  });

  it("refunds the refunded row where it stood, with no invented dates", () => {
    expect(row(8)).toMatchObject({
      cancellation: "refunded",
      cancellation_remarks: "REFUNDED",
      cancelled_on: null,
      is_completed: false,
      current_stage: "site_feasibility_survey",
      order_date: "2025-01-13",
    });
  });

  it("keeps the remark in brackets in the notes, and the name out of the match", () => {
    expect(row(12)).toMatchObject({
      coordinator_ids: [SUDHEESH.id],
      notes: "Coordinator as written in the import sheet: sudheesh(sheeja)",
    });
  });

  it("adds the sums, whatever the case of kW", () => {
    expect(row(13)).toMatchObject({ total_cost: 258500, plant_capacity: "3kW+inverter" });
    expect(row(15)).toMatchObject({ total_cost: 253500, plant_capacity: "3kw+inverter" });
  });

  it("keeps the KSEB fee a separate payment and a quoted note whole", () => {
    const withFee = row(14);
    expect(withFee.payments.map((p) => p.purpose)).toEqual(["contract", "kseb_fees"]);
    expect(withFee.notes).toContain("Rs 1,180");
  });

  it("reads the office e-mail and the decimal payment", () => {
    expect(row(15).coordinator_ids).toEqual([ADMIN.id]);
    expect(row(10).payments[0].amount).toBe(189985.84);
  });

  it("carries every row to the database with a stage its plan has", () => {
    for (const r of sheet.rows) {
      if (!r.parsed.ok) continue;
      expect(stagesFor(r.parsed.data.plan_type)).toContain(r.parsed.data.current_stage);
      expect(r.parsed.data.coordinator_ids.length).toBeGreaterThan(0);
    }
  });

  it("matches every coordinator the sheet names", () => {
    expect(sheet.coordinatorMatches.every((m) => m.account !== null)).toBe(true);
    expect(sheet.coordinatorMatches.map((m) => m.account?.fullName)).toEqual(
      expect.arrayContaining([
        "Sudheesh Pillai",
        "Ravi Kumar",
        "Abhijith Nair",
        "Manohar Das",
        "Nishanth Raj",
        "BSS Admin",
      ]),
    );
  });

  it("warns about what the sheet cannot tell: no consumer numbers, a repeated sale, undated completions", () => {
    expect(sheet.warnings).toEqual([
      "15 rows have no consumer_number — they will be imported again on every upload; to retry, upload only the failed-rows download",
      "Rows 3 and 16 look like the same sale (Customer 02, 2025-01-03, ₹2,28,000) — remove one if so",
      "13 completed rows have no commissioned_on — they are imported as complete with the commissioning date not recorded",
    ]);
  });

  it("turns the same sheet's mistakes into refusals that say what to do", () => {
    const broken = plan(
      excel([
        // "Ravi+Abhijit": the typo is offered, not guessed.
        ["Customer 20", "", "3kW", "228000", "2025-01-03", "Ravi+Abhijit", "plant_complete", "yes", "", "", "", "", "", "", "", ""],
        // "1 panel" without the custom plan.
        ["Customer 21", "", "1 panel", "18000", "2025-01-10", "sudheesh", "plant_complete", "yes", "", "", "", "", "", "", "", ""],
        // OFFICE is not a person.
        ["Customer 22", "", "3kW", "228000", "2025-01-03", "OFFICE", "", "", "", "", "", "", "", "", "", ""],
        // Cancelled with only a note: no capacity, cost, date or coordinator.
        ["Customer 23", "", "", "", "", "", "", "", "cancelled", "", "Cancelled", "", "", "", "", ""],
      ]),
    );
    const errors = broken.rows.map((r) => (r.parsed.ok ? null : r.parsed.error));
    expect(errors[0]).toBe(
      'coordinator "Abhijit" is not a coordinator or office account — did you mean Abhijith Nair (abhijith@bsssolar.test)?',
    );
    expect(errors[1]).toBe(
      'plant_capacity "1 panel" is not a kW capacity — write it like 3kW, or set plan_type to custom for a sale that is not a solar plant',
    );
    expect(errors[2]).toMatch(/^coordinator "OFFICE" is not an account — write the e-mail of the office account/);
    expect(errors[3]).toBe(
      "order_date is required for a cancelled or refunded row — the import never invents dates; coordinator is blank and no default coordinator was chosen — name the coordinator, or choose a default coordinator above",
    );
  });

  it("imports the cancelled row once the sheet gives its date and coordinator", () => {
    const fixed = plan(
      excel([
        ["Customer 23", "", "", "", "2025-01-09", "Manohar", "", "", "cancelled", "", "Cancelled", "", "", "", "", ""],
      ]),
    );
    const data = fixed.rows[0].parsed;
    expect(data.ok && data.data).toMatchObject({
      plan_type: "solar",
      plant_capacity: "Not recorded",
      total_cost: 0,
      cancellation: "cancelled",
      cancelled_on: null,
      order_date: "2025-01-09",
      coordinator_ids: [MANOHAR.id],
      notes: "Cancelled",
    });
  });
});

// ---------------------------------------------------------------------------
// Release 2026-11: day-first dates, advance details, incentive instalments,
// refunds and write-offs, template examples, capacity sums, the file notes.
// Every client below is invented; the sheet shapes are the clerk's.
// ---------------------------------------------------------------------------

/** A group of cells: group("payment", 2, { amount: "5" }) → { payment_2_amount: "5" }. */
const group = (prefix: "payment" | "incentive", n: number, cells: Record<string, string>) =>
  Object.fromEntries(Object.entries(cells).map(([field, value]) => [`${prefix}_${n}_${field}`, value]));

/** Read a row of a file that has these payment and incentive groups. */
function readWith(
  record: Record<string, string>,
  slots: { payments?: number[]; incentives?: number[]; defaultCoordinator?: DirectoryAccount | null } = {},
) {
  return readImportRow(
    record,
    2,
    ctx(slots.payments ?? [], slots.defaultCoordinator ?? null, slots.incentives ?? []),
  );
}

/** The row, or throw: for rows that must be valid. */
function rowWith(record: Record<string, string>, slots: Parameters<typeof readWith>[1] = {}): ImportRow {
  const reading = readWith(record, slots);
  if (!reading.parsed.ok) throw new Error(`expected a valid row, got: ${reading.parsed.error}`);
  return reading.parsed.data;
}

/** Why the row is refused, or throw: for rows that must be refused. */
function refusedWith(record: Record<string, string>, slots: Parameters<typeof readWith>[1] = {}): string {
  const reading = readWith(record, slots);
  if (reading.parsed.ok) throw new Error("expected the row to be refused");
  return reading.parsed.error;
}

describe("column catalogue — advance details and the incentive and payment groups", () => {
  it("puts the advance's method, date and reference right after its amount", () => {
    const at = IMPORT_HEADERS.indexOf("advance_amount");
    expect(IMPORT_HEADERS.slice(at, at + 4)).toEqual([
      "advance_amount",
      "advance_method",
      "advance_date",
      "advance_reference",
    ]);
  });

  it("has the columns of a payment group, paid_by_office included, and an incentive group", () => {
    expect(PAYMENT_FIELDS).toEqual(["amount", "date", "method", "purpose", "reference", "paid_by_office"]);
    expect(INCENTIVE_FIELDS).toEqual(["coordinator", "amount", "date"]);
    expect(paymentColumn(3, "paid_by_office")).toBe("payment_3_paid_by_office");
    expect(incentiveColumn(2, "date")).toBe("incentive_2_date");
  });

  it("documents the advance columns with the work order", () => {
    const workOrder = IMPORT_COLUMN_GROUPS.find((g) => g.title === "Work order");
    expect(workOrder?.columns).toEqual(
      expect.arrayContaining(["advance_method", "advance_date", "advance_reference"]),
    );
  });
});

describe("validateImportHeaders — incentive groups", () => {
  const REQUIRED = [...REQUIRED_IMPORT_HEADERS];

  it("finds the groups, in order, gaps allowed — and ignores the one-coordinator shorthand", () => {
    const res = validateImportHeaders([
      ...REQUIRED,
      "incentive_3_amount",
      "incentive_1_coordinator",
      "incentive_1_amount",
      "incentive_1_date",
      "coordinator_incentive",
      "incentive_paid_on",
    ]);
    expect(res).toMatchObject({ ok: true, data: { incentiveSlots: [1, 3], paymentSlots: [] } });
  });

  it("takes a group of its amount alone: the coordinator and the date are optional", () => {
    expect(validateImportHeaders([...REQUIRED, "incentive_1_amount"])).toMatchObject({
      ok: true,
      data: { incentiveSlots: [1] },
    });
  });

  it("asks for the amount column of a group that has none", () => {
    expect(validateImportHeaders([...REQUIRED, "incentive_1_date", "incentive_2_amount"])).toEqual({
      ok: false,
      error: 'The header row needs fixing. Incentive 1 needs an "incentive_1_amount" column.',
    });
  });

  it("suggests the group column a typo was after", () => {
    const res = validateImportHeaders([...REQUIRED, "incentive_1_amout"]);
    expect(!res.ok && res.error).toBe(
      'The header row needs fixing. Unknown columns: "incentive_1_amout" (did you mean "incentive_1_amount"?).',
    );
  });

  it("does not take incentive_0 or a field it does not have for a group", () => {
    for (const bad of ["incentive_0_amount", "incentive_1_note", "incentive_amount"]) {
      const res = validateImportHeaders([...REQUIRED, bad]);
      expect(!res.ok && res.error).toContain(`"${bad}"`);
    }
  });

  it("accepts paid_by_office in a payment group, which still needs its amount and date", () => {
    expect(
      validateImportHeaders([...REQUIRED, "payment_1_amount", "payment_1_date", "payment_1_paid_by_office"]),
    ).toMatchObject({ ok: true, data: { paymentSlots: [1] } });
    const res = validateImportHeaders([...REQUIRED, "payment_1_paid_by_office"]);
    expect(!res.ok && res.error).toMatch(/Payment 1 needs "payment_1_amount", "payment_1_date" columns/);
  });
});

describe("parseImportRow — dates are day first", () => {
  const DONE = {
    ...BASE,
    is_completed: "yes",
    order_date: "13/02/2025",
    commissioned_on: "20-03-2025",
    feasibility_date: "01.03.2025",
  };

  it("reads every date column of the sheet day first", () => {
    const row = rowWith({
      ...DONE,
      advance_amount: "10000",
      advance_date: "13/02/25",
      ...group("payment", 1, { amount: "5000", date: "14/02/2025" }),
    }, { payments: [1] });
    expect(row).toMatchObject({
      order_date: "2025-02-13",
      commissioned_on: "2025-03-20",
      feasibility_date: "2025-03-01",
      advance_paid_on: "2025-02-13",
    });
    expect(row.payments[0].paid_on).toBe("2025-02-14");
  });

  it("reads the cancellation date day first too", () => {
    const row = rowWith({
      ...BASE,
      order_date: "13/01/2025",
      cancellation: "cancelled",
      cancelled_on: "20/02/2025",
    });
    expect(row).toMatchObject({ cancelled_on: "2025-02-20", cancellation: "cancelled" });
  });

  it("reads 04-02-25 as 4 February, the way the clerk's Excel shows it — never 2 April", () => {
    expect(rowWith({ ...BASE, order_date: "04-02-25" }).order_date).toBe("2025-02-04");
    expect(rowWith({ ...BASE, order_date: "04/02/2025" }).order_date).toBe("2025-02-04");
  });

  it("still takes ISO", () => {
    expect(rowWith({ ...BASE, order_date: "2025-02-13" }).order_date).toBe("2025-02-13");
  });

  it("says which cell has a date that does not exist, and what it is", () => {
    expect(refusedWith({ ...BASE, order_date: "31/04/2025" })).toBe(
      'order_date "31/04/2025" is not a real date — dates are written day first, like 13/02/2025',
    );
    expect(refusedWith({ ...BASE, order_date: "02/13/2025" })).toContain("did you mean 2025-02-13?");
    expect(refusedWith({ ...BASE, commissioned_on: "tomorrow" })).toMatch(
      /commissioned_on "tomorrow" is not a date/,
    );
  });

  it("holds a day-first date to today, naming both spellings", () => {
    expect(refusedWith({ ...BASE, order_date: "23/10/2026" })).toBe(
      "order_date 23/10/2026 (2026-10-23) is in the future",
    );
    expect(rowWith({ ...BASE, order_date: "22/10/2026" }).order_date).toBe("2026-10-22");
  });

  it("reports the cell, not the row, for each date that is wrong", () => {
    const error = refusedWith({
      ...BASE,
      order_date: "32/01/2025",
      ...group("payment", 1, { amount: "1000", date: "x" }),
    }, { payments: [1] });
    expect(error).toContain('order_date "32/01/2025" is not a real date');
    expect(error).toContain('payment_1_date "x" is not a date');
  });

  it("reports the day-first dates it read, for the file's note — all of them, whatever the row", () => {
    const reading = readWith({
      ...BASE,
      order_date: "13/02/2025",
      commissioned_on: "2025-03-20",
      is_completed: "yes",
      ...group("payment", 1, { amount: "1000", date: "04-02-25" }),
    }, { payments: [1] });
    expect(reading.dayFirst).toEqual([
      { iso: "2025-02-13", written: "13/02/2025", dayFirst: true },
      { iso: "2025-02-04", written: "04-02-25", dayFirst: true },
    ]);
    expect(readWith({ ...BASE, order_date: "2025-02-13" }).dayFirst).toEqual([]);
  });

  it("keeps the order date it read, for the month check — null when blank or unreadable", () => {
    expect(readWith({ ...BASE, order_date: "13/02/2025" }).orderDate).toBe("2025-02-13");
    expect(readWith(BASE).orderDate).toBeNull();
    expect(readWith({ ...BASE, order_date: "31/04/2025" }).orderDate).toBeNull();
  });
});

describe("parseImportRow — the advance's method, date and reference", () => {
  const ADVANCE = {
    ...BASE,
    advance_amount: "50000",
    advance_method: "UPI",
    advance_date: "04/02/2025",
    advance_reference: " UPI 440011 ",
  };

  it("carries them to the row, the method as its key and the date as ISO", () => {
    expect(rowWith(ADVANCE)).toMatchObject({
      advance_amount: 50000,
      advance_method: "upi",
      advance_paid_on: "2025-02-04",
      advance_reference: "UPI 440011",
    });
  });

  it("leaves them not recorded when blank — never guessed from the order date or 'other'", () => {
    expect(rowWith({ ...BASE, advance_amount: "50000" })).toMatchObject({
      advance_method: null,
      advance_paid_on: null,
      advance_reference: null,
    });
  });

  it("takes any one of them on its own", () => {
    expect(rowWith({ ...BASE, advance_amount: "5000", advance_method: "cash" })).toMatchObject({
      advance_method: "cash",
      advance_paid_on: null,
    });
    expect(rowWith({ ...BASE, advance_amount: "5000", advance_date: "2025-02-04" }).advance_paid_on).toBe(
      "2025-02-04",
    );
  });

  it("refuses details of an advance that is blank or zero, naming the columns", () => {
    expect(refusedWith({ ...BASE, advance_method: "upi" })).toBe(
      "advance_method is filled but advance_amount is blank or zero — enter the advance, or clear it",
    );
    expect(refusedWith({ ...ADVANCE, advance_amount: "0" })).toBe(
      "advance_method, advance_date, advance_reference are filled but advance_amount is blank or zero — enter the advance, or clear them",
    );
  });

  it("does not also call a malformed advance amount blank", () => {
    const error = refusedWith({ ...ADVANCE, advance_amount: "abc" });
    expect(error).toMatch(/advance_amount must be an amount/);
    expect(error).not.toMatch(/blank or zero/);
  });

  it("names the column of a method it does not know, and suggests one", () => {
    expect(refusedWith({ ...ADVANCE, advance_method: "chque" })).toBe(
      'advance_method "chque" is not recognised — did you mean "cheque"?',
    );
  });

  it("refuses an advance date in the future, and one that is not a date", () => {
    expect(refusedWith({ ...ADVANCE, advance_date: "2026-11-01" })).toBe(
      "advance_date 2026-11-01 is in the future",
    );
    expect(refusedWith({ ...ADVANCE, advance_date: "later" })).toMatch(/advance_date "later" is not a date/);
  });

  it("holds the reference to its limit", () => {
    expect(refusedWith({ ...ADVANCE, advance_reference: "x".repeat(101) })).toBe(
      "advance_reference is too long (101 characters; the most is 100)",
    );
    expect(rowWith({ ...ADVANCE, advance_reference: "x".repeat(100) }).advance_reference).toHaveLength(100);
  });
});

describe("parseImportRow — a capacity written as a sum", () => {
  it("stores the total and says how it was read", () => {
    const reading = readWith({ ...BASE, plant_capacity: "3kW+2kW" });
    expect(reading.parsed.ok && reading.parsed.data.plant_capacity).toBe("5kW");
    expect(reading.warnings).toContain('plant_capacity "3kW+2kW" read as 5 kW');
  });

  it("adds watts and kilowatts, and keeps the fractions", () => {
    expect(rowWith({ ...BASE, plant_capacity: "3kW + 500W" }).plant_capacity).toBe("3.5kW");
    expect(rowWith({ ...BASE, plant_capacity: "2000W+3KWp" }).plant_capacity).toBe("5kW");
  });

  it("leaves 3kW+inverter as it is: its first number is the capacity", () => {
    const reading = readWith({ ...BASE, plant_capacity: "3kW+inverter" });
    expect(reading.parsed.ok && reading.parsed.data.plant_capacity).toBe("3kW+inverter");
    expect(reading.warnings.filter((w) => w.includes("read as"))).toEqual([]);
  });

  it("leaves a plain capacity without a note", () => {
    expect(readWith({ ...BASE, plant_capacity: "5 kWp" }).warnings).toEqual([
      `order_date is blank — today (${TODAY}) will be used`,
    ]);
  });

  it("does not touch what a custom plan says it sold", () => {
    expect(
      rowWith({ ...BASE, plan_type: "custom", plant_capacity: "3kW+2kW inverter" }).plant_capacity,
    ).toBe("3kW+2kW inverter");
    expect(
      rowWith({ ...BASE, plan_type: "custom", plant_capacity: "3kW+2kW" }).plant_capacity,
    ).toBe("3kW+2kW");
  });

  it("totals a cancelled row's capacity too", () => {
    const row = rowWith({
      ...BASE,
      plant_capacity: "1kW+2kW",
      order_date: "2025-01-13",
      cancellation: "cancelled",
    });
    expect(row.plant_capacity).toBe("3kW");
  });

  it("is worded in the sheet's terms by the results line, not by the row", () => {
    const reading = readWith({ ...BASE, plant_capacity: "3kW+2kW" });
    expect(reading.warnings[0]).toBe('plant_capacity "3kW+2kW" read as 5 kW');
  });
});

describe("parseImportRow — the one-coordinator incentive shorthand", () => {
  const PAID = "2026-09-01";

  it("gives a single named coordinator the incentive as one paid instalment", () => {
    const row = rowWith({ ...BASE, coordinator_incentive: "5000", incentive_paid_on: PAID });
    expect(row.incentives).toEqual([
      { coordinator_id: RAHUL.id, amount: 5000, payments: [{ amount: 5000, paid_on: PAID, note: null }] },
    ]);
  });

  it("reads the date day first", () => {
    const row = rowWith({ ...BASE, coordinator_incentive: "5000", incentive_paid_on: "01/09/2026" });
    expect(row.incentives[0].payments[0].paid_on).toBe("2026-09-01");
  });

  it("allows an unpaid incentive (no instalment) and an incentive of zero", () => {
    expect(rowWith({ ...BASE, coordinator_incentive: "7000" }).incentives).toEqual([
      { coordinator_id: RAHUL.id, amount: 7000, payments: [] },
    ]);
    expect(rowWith({ ...BASE, coordinator_incentive: "0" }).incentives).toEqual([
      { coordinator_id: RAHUL.id, amount: 0, payments: [] },
    ]);
  });

  it("reads a sum as the instalments of one incentive, one date for each", () => {
    const row = rowWith({
      ...BASE,
      coordinator_incentive: "20000+2360+2360",
      incentive_paid_on: "15/05/2025+16/05/2025+21/05/2025",
    });
    expect(row.incentives).toEqual([
      {
        coordinator_id: RAHUL.id,
        amount: 24720,
        payments: [
          { amount: 20000, paid_on: "2025-05-15", note: null },
          { amount: 2360, paid_on: "2025-05-16", note: null },
          { amount: 2360, paid_on: "2025-05-21", note: null },
        ],
      },
    ]);
  });

  it("takes spaces around the +, and a mix of date shapes", () => {
    const row = rowWith({
      ...BASE,
      coordinator_incentive: "₹12,000 + Rs. 5000",
      incentive_paid_on: "2025-05-15 + 16-05-2025",
    });
    expect(row.incentives[0]).toMatchObject({
      amount: 17000,
      payments: [{ paid_on: "2025-05-15" }, { paid_on: "2025-05-16" }],
    });
  });

  it("makes a sum with no dates an unpaid incentive of the total", () => {
    expect(rowWith({ ...BASE, coordinator_incentive: "12000+5000" }).incentives).toEqual([
      { coordinator_id: RAHUL.id, amount: 17000, payments: [] },
    ]);
  });

  it("refuses several amounts with a single date: one date per amount", () => {
    expect(
      refusedWith({ ...BASE, coordinator_incentive: "12000+5000", incentive_paid_on: PAID }),
    ).toBe(
      "incentive_paid_on has 1 date for 2 amounts in coordinator_incentive — one date per amount, joined by + in the same order (or leave it blank for an incentive not yet paid)",
    );
  });

  it("refuses more dates than amounts, and fewer", () => {
    expect(
      refusedWith({ ...BASE, coordinator_incentive: "5000", incentive_paid_on: "2025-05-15+2025-05-16" }),
    ).toMatch(/incentive_paid_on has 2 dates for 1 amount in coordinator_incentive — one date per amount/);
    expect(
      refusedWith({
        ...BASE,
        coordinator_incentive: "1000+2000+3000",
        incentive_paid_on: "2025-05-15+2025-05-16",
      }),
    ).toMatch(/has 2 dates for 3 amounts/);
  });

  it("names a date that is missing between the +", () => {
    expect(
      refusedWith({ ...BASE, coordinator_incentive: "1000+2000", incentive_paid_on: "2025-05-15+" }),
    ).toBe(
      'incentive_paid_on "2025-05-15+" has an empty date — write one date per amount, joined by +',
    );
  });

  it("reports a date that is wrong by itself, without a count complaint on top", () => {
    const error = refusedWith({
      ...BASE,
      coordinator_incentive: "1000+2000",
      incentive_paid_on: "2025-05-15+31/04/2025",
    });
    expect(error).toMatch(/incentive_paid_on "31\/04\/2025" is not a real date/);
    expect(error).not.toMatch(/one date per amount/);
  });

  it("refuses to date a payment of zero", () => {
    expect(
      refusedWith({ ...BASE, coordinator_incentive: "0+5000", incentive_paid_on: "2025-05-15+2025-05-16" }),
    ).toBe(
      "incentive_paid_on dates a payment of zero — every part of coordinator_incentive that has a date must be more than zero",
    );
    expect(
      refusedWith({ ...BASE, coordinator_incentive: "0", incentive_paid_on: PAID }),
    ).toMatch(/dates a payment of zero/);
  });

  it("rejects a paid date without an incentive, a negative incentive, a future paid date", () => {
    expect(refusedWith({ ...BASE, incentive_paid_on: PAID })).toMatch(
      /incentive_paid_on needs a coordinator_incentive/,
    );
    expect(refusedWith({ ...BASE, coordinator_incentive: "-100" })).toMatch(
      /coordinator_incentive cannot be negative/,
    );
    expect(
      refusedWith({ ...BASE, coordinator_incentive: "100", incentive_paid_on: "2026-11-30" }),
    ).toMatch(/incentive_paid_on 2026-11-30 is in the future/);
  });

  it("does not double-report a malformed incentive as missing", () => {
    const error = refusedWith({ ...BASE, coordinator_incentive: "abc", incentive_paid_on: PAID });
    expect(error).toMatch(/coordinator_incentive must be an amount/);
    expect(error).not.toMatch(/needs a coordinator_incentive/);
  });

  it("is never split between the coordinators of a shared sale, and points at the incentive_N columns", () => {
    expect(refusedWith({ ...BASE, coordinator: "Abhijith+Ravi", coordinator_incentive: "5000" })).toBe(
      "coordinator_incentive cannot be split automatically for a shared sale (Abhijith Nair, Ravi Kumar) — use the incentive_N_coordinator, incentive_N_amount and incentive_N_date columns to say who gets what",
    );
    expect(
      refusedWith({
        ...BASE,
        coordinator: "Abhijith+Ravi",
        coordinator_incentive: "5000",
        incentive_paid_on: PAID,
      }),
    ).toContain("incentive_paid_on cannot be split automatically for a shared sale");
    // Nothing to refuse when the shared sale carries none.
    expect(rowWith({ ...BASE, coordinator: "Abhijith+Ravi" }).incentives).toEqual([]);
  });

  it("is refused on a row that fell back to the default coordinator", () => {
    const error = refusedWith(
      { ...BASE, coordinator: "", coordinator_incentive: "5000", incentive_paid_on: PAID },
      { defaultCoordinator: PRIYA },
    );
    expect(error).toBe(
      "coordinator_incentive needs the coordinator cell filled — name the coordinator this incentive belongs to; incentive_paid_on needs the coordinator cell filled — name the coordinator this incentive belongs to",
    );
  });
});

describe("parseImportRow — incentive_N groups", () => {
  const slots = { incentives: [1, 2, 3] };
  const SHARED = { ...BASE, coordinator: "Ravi + Abhijith" };

  it("gives each coordinator of a shared sale their own incentive", () => {
    const row = rowWith(
      {
        ...SHARED,
        ...group("incentive", 1, { coordinator: "Ravi", amount: "20000", date: "2025-05-15" }),
        ...group("incentive", 2, { coordinator: "Abhijith", amount: "15000", date: "2025-05-16" }),
      },
      slots,
    );
    expect(row.incentives).toEqual([
      {
        coordinator_id: RAVI.id,
        amount: 20000,
        payments: [{ amount: 20000, paid_on: "2025-05-15", note: null }],
      },
      {
        coordinator_id: ABHIJITH.id,
        amount: 15000,
        payments: [{ amount: 15000, paid_on: "2025-05-16", note: null }],
      },
    ]);
  });

  it("takes a group with a date as paid and one without as the unpaid part of the agreed total", () => {
    const row = rowWith(
      {
        ...SHARED,
        ...group("incentive", 1, { coordinator: "Ravi", amount: "12000", date: "20/03/2025" }),
        ...group("incentive", 2, { coordinator: "Ravi", amount: "3000" }),
      },
      slots,
    );
    expect(row.incentives).toEqual([
      {
        coordinator_id: RAVI.id,
        amount: 15000,
        payments: [{ amount: 12000, paid_on: "2025-03-20", note: null }],
      },
    ]);
  });

  it("adds a coordinator's groups wherever they are, in the order the coordinators first appear", () => {
    const row = rowWith(
      {
        ...SHARED,
        ...group("incentive", 1, { coordinator: "Abhijith", amount: "1000", date: "2025-05-01" }),
        ...group("incentive", 2, { coordinator: "Ravi", amount: "2000", date: "2025-05-02" }),
        ...group("incentive", 3, { coordinator: "abhijith", amount: "500", date: "2025-05-03" }),
      },
      slots,
    );
    expect(row.incentives.map((i) => [i.coordinator_id, i.amount, i.payments.length])).toEqual([
      [ABHIJITH.id, 1500, 2],
      [RAVI.id, 2000, 1],
    ]);
    expect(row.incentives[0].payments.map((p) => p.paid_on)).toEqual(["2025-05-01", "2025-05-03"]);
  });

  it("adds in paise, so three parts of 0.1 are exactly 0.3", () => {
    const row = rowWith(
      {
        ...BASE,
        ...group("incentive", 1, { amount: "0.1" }),
        ...group("incentive", 2, { amount: "0.1" }),
        ...group("incentive", 3, { amount: "0.1" }),
      },
      slots,
    );
    expect(row.incentives[0].amount).toBe(0.3);
  });

  it("gives a single-coordinator sale's blank incentive coordinator to its coordinator", () => {
    const row = rowWith({ ...BASE, ...group("incentive", 1, { amount: "5000", date: "2025-05-01" }) }, slots);
    expect(row.incentives).toEqual([
      {
        coordinator_id: RAHUL.id,
        amount: 5000,
        payments: [{ amount: 5000, paid_on: "2025-05-01", note: null }],
      },
    ]);
  });

  it("resolves the incentive coordinator like the coordinator column: a first name, a full name, an e-mail", () => {
    const row = rowWith(
      {
        ...SHARED,
        ...group("incentive", 1, { coordinator: "ravi", amount: "1" }),
        ...group("incentive", 2, { coordinator: "Abhijith Nair", amount: "2" }),
      },
      slots,
    );
    expect(row.incentives.map((i) => i.coordinator_id)).toEqual([RAVI.id, ABHIJITH.id]);
    expect(
      rowWith(
        { ...SHARED, ...group("incentive", 1, { coordinator: "ravi@bsssolar.test", amount: "1" }) },
        slots,
      ).incentives[0].coordinator_id,
    ).toBe(RAVI.id);
  });

  it("requires the coordinator on a shared sale", () => {
    expect(refusedWith({ ...SHARED, ...group("incentive", 1, { amount: "5000" }) }, slots)).toBe(
      "incentive_1_coordinator is required on a shared sale (Ravi Kumar, Abhijith Nair) — name who this incentive is for",
    );
  });

  it("refuses a coordinator who is not on the sale, and says who is", () => {
    expect(
      refusedWith(
        { ...SHARED, ...group("incentive", 1, { coordinator: "Manohar", amount: "5000" }) },
        slots,
      ),
    ).toBe(
      'incentive_1_coordinator "Manohar" is not a coordinator on this sale (Ravi Kumar, Abhijith Nair) — name one of them',
    );
  });

  it("refuses a cell that names two people: each person has their own group", () => {
    expect(
      refusedWith(
        { ...SHARED, ...group("incentive", 1, { coordinator: "Ravi & Abhijith", amount: "5000" }) },
        slots,
      ),
    ).toBe(
      'incentive_1_coordinator "Ravi & Abhijith" names 2 people — an incentive belongs to one coordinator; give each their own incentive_N group',
    );
  });

  it("refuses a name that is no account, with the suggestion, and lists it in the references", () => {
    const reading = readWith(
      { ...SHARED, ...group("incentive", 1, { coordinator: "Abhijit", amount: "5000" }) },
      slots,
    );
    expect(!reading.parsed.ok && reading.parsed.error).toBe(
      'incentive_1_coordinator "Abhijit" is not a coordinator or office account — did you mean Abhijith Nair (abhijith@bsssolar.test)?',
    );
    expect(reading.references.map((r) => [r.written, r.account?.fullName ?? null])).toEqual([
      ["Ravi", "Ravi Kumar"],
      ["Abhijith", "Abhijith Nair"],
      ["Abhijit", null],
    ]);
  });

  it("requires an amount once any cell of the group is filled, and more than zero", () => {
    expect(
      refusedWith({ ...BASE, ...group("incentive", 1, { date: "2025-05-01" }) }, slots),
    ).toBe("incentive_1_amount is required — other incentive 1 cells are filled");
    expect(refusedWith({ ...BASE, ...group("incentive", 1, { amount: "0" }) }, slots)).toBe(
      "incentive_1_amount must be more than zero",
    );
  });

  it("skips a group that is blank, wherever it is", () => {
    const row = rowWith(
      { ...BASE, ...group("incentive", 2, { amount: "1000", date: "2025-05-01" }) },
      slots,
    );
    expect(row.incentives).toHaveLength(1);
    expect(rowWith({ ...BASE, ...group("incentive", 1, { amount: " " }) }, slots).incentives).toEqual([]);
  });

  it("refuses a date in the future or not a date, naming the cell", () => {
    expect(
      refusedWith({ ...BASE, ...group("incentive", 1, { amount: "1", date: "23/10/2026" }) }, slots),
    ).toBe("incentive_1_date 23/10/2026 (2026-10-23) is in the future");
    expect(
      refusedWith({ ...BASE, ...group("incentive", 2, { amount: "1", date: "soon" }) }, slots),
    ).toMatch(/incentive_2_date "soon" is not a date/);
  });

  it("refuses a blank incentive coordinator on a row that took the default coordinator", () => {
    expect(
      refusedWith(
        { ...BASE, coordinator: "", ...group("incentive", 1, { amount: "5000" }) },
        { ...slots, defaultCoordinator: PRIYA },
      ),
    ).toBe(
      "incentive_1_coordinator needs the coordinator cell filled — name the coordinator this incentive belongs to",
    );
  });

  it("takes the default coordinator named outright", () => {
    const row = rowWith(
      { ...BASE, coordinator: "", ...group("incentive", 1, { coordinator: "Priya", amount: "5000" }) },
      { ...slots, defaultCoordinator: PRIYA },
    );
    expect(row.incentives[0].coordinator_id).toBe(PRIYA.id);
  });

  it("does not add noise when the coordinator cell itself is refused", () => {
    const error = refusedWith(
      { ...BASE, coordinator: "Gireesh", ...group("incentive", 1, { amount: "5000" }) },
      slots,
    );
    expect(error).toMatch(/^coordinator "Gireesh" is not a coordinator or office account/);
    expect(error).not.toMatch(/incentive_1/);
  });

  it("is refused in a row that also uses the one-coordinator shorthand", () => {
    expect(
      refusedWith(
        {
          ...BASE,
          coordinator_incentive: "5000",
          incentive_paid_on: "2025-05-01",
          ...group("incentive", 1, { amount: "5000" }),
          ...group("incentive", 3, { amount: "100" }),
        },
        slots,
      ),
    ).toBe(
      "coordinator_incentive and incentive_paid_on and incentive_1_*, incentive_3_* are both filled — use either the shorthand or the incentive_N_* columns, not both",
    );
  });

  it("lets a file hold both kinds of column when each row uses one", () => {
    expect(rowWith({ ...BASE, coordinator_incentive: "5000" }, slots).incentives).toHaveLength(1);
    expect(rowWith({ ...BASE, ...group("incentive", 1, { amount: "5000" }) }, slots).incentives).toHaveLength(1);
  });
});

describe("parseImportRow — paid_by_office, refunds and write-offs", () => {
  const slots = { payments: [1, 2, 3, 4] };
  const COLLECTED = {
    ...BASE,
    advance_amount: "50000",
    ...group("payment", 1, { amount: "100000", date: "2025-01-10" }),
  };

  it("says whether the office or the customer paid a KSEB fee, the customer by default", () => {
    const row = rowWith(
      {
        ...BASE,
        ...group("payment", 1, { amount: "4540", date: "2025-01-10", purpose: "kseb_fees" }),
        ...group("payment", 2, {
          amount: "1180",
          date: "2025-01-11",
          purpose: "kseb_fees",
          paid_by_office: "yes",
        }),
        ...group("payment", 3, {
          amount: "100",
          date: "2025-01-12",
          purpose: "kseb_fees",
          paid_by_office: "no",
        }),
      },
      slots,
    );
    expect(row.payments.map((p) => p.paid_by_office)).toEqual([false, true, false]);
  });

  it("refuses paid_by_office yes on anything but a KSEB fee, but not a no", () => {
    expect(
      refusedWith(
        {
          ...BASE,
          ...group("payment", 1, { amount: "100", date: "2025-01-10", paid_by_office: "yes" }),
        },
        slots,
      ),
    ).toBe(
      "payment_1_paid_by_office is only for a payment_1_purpose of kseb_fees — the office pays KSEB, not the contract",
    );
    expect(
      rowWith(
        { ...BASE, ...group("payment", 1, { amount: "100", date: "2025-01-10", paid_by_office: "no" }) },
        slots,
      ).payments[0].paid_by_office,
    ).toBe(false);
  });

  it("does not also say paid_by_office is misplaced when the purpose could not be read", () => {
    const error = refusedWith(
      {
        ...BASE,
        ...group("payment", 1, {
          amount: "100",
          date: "2025-01-10",
          purpose: "subsidy",
          paid_by_office: "yes",
        }),
      },
      slots,
    );
    expect(error).toMatch(/payment_1_purpose "subsidy" is not recognised/);
    expect(error).not.toMatch(/paid_by_office is only/);
  });

  it("refuses a paid_by_office that is not yes or no", () => {
    expect(
      refusedWith(
        {
          ...BASE,
          ...group("payment", 1, {
            amount: "100",
            date: "2025-01-10",
            purpose: "kseb_fees",
            paid_by_office: "maybe",
          }),
        },
        slots,
      ),
    ).toBe('payment_1_paid_by_office must be yes or no (got "maybe")');
  });

  it("records a refund as money going back, with its method and reference", () => {
    const row = rowWith(
      {
        ...COLLECTED,
        ...group("payment", 2, {
          amount: "10000",
          date: "2025-02-01",
          method: "NEFT",
          purpose: "Refund",
          reference: "NEFT 123",
        }),
      },
      slots,
    );
    expect(row.payments[1]).toEqual({
      amount: 10000,
      paid_on: "2025-02-01",
      method: "bank_transfer",
      purpose: "refund",
      paid_by_office: false,
      reference: "NEFT 123",
      notes: null,
    });
  });

  it("allows a refund of everything that was collected, the advance included", () => {
    expect(
      rowWith(
        { ...COLLECTED, ...group("payment", 2, { amount: "150000", date: "2025-02-01", purpose: "refund" }) },
        slots,
      ).payments,
    ).toHaveLength(2);
  });

  it("refuses a refund of more than was collected, naming the limit", () => {
    expect(
      refusedWith(
        { ...COLLECTED, ...group("payment", 2, { amount: "150001", date: "2025-02-01", purpose: "refund" }) },
        slots,
      ),
    ).toBe(
      `payment_2_amount ${formatCurrency(150001)} is more than the ${formatCurrency(150000)} BSS held on 2025-02-01 (advance plus contract payments, less earlier refunds) — a refund cannot exceed what was collected`,
    );
  });

  it("judges a refund by when it happened, not by its place in the sheet", () => {
    // payment_1 is the refund, dated before the 100,000 came in: only the 50,000 advance is held.
    const sheet = {
      ...BASE,
      advance_amount: "50000",
      ...group("payment", 1, { amount: "60000", date: "2025-01-05", purpose: "refund" }),
      ...group("payment", 2, { amount: "100000", date: "2025-01-10" }),
    };
    expect(refusedWith(sheet, slots)).toMatch(/payment_1_amount .* is more than the .*50,000/);
    expect(
      rowWith({ ...sheet, ...group("payment", 1, { amount: "40000", date: "2025-01-05", purpose: "refund" }) }, slots)
        .payments,
    ).toHaveLength(2);
  });

  it("does not let two refunds take the same money", () => {
    const error = refusedWith(
      {
        ...COLLECTED,
        ...group("payment", 2, { amount: "100000", date: "2025-02-01", purpose: "refund" }),
        ...group("payment", 3, { amount: "60000", date: "2025-02-02", purpose: "refund" }),
      },
      slots,
    );
    expect(error).toMatch(/^payment_3_amount .* is more than the .*50,000/);
  });

  it("lets a customer who overpaid be refunded the excess: the contract is judged at the end", () => {
    const row = rowWith(
      {
        ...BASE,
        advance_amount: "20000",
        ...group("payment", 1, { amount: "190000", date: "2025-01-10" }),
        ...group("payment", 2, { amount: "15000", date: "2025-01-20", purpose: "refund" }),
      },
      slots,
    );
    expect(row.payments).toHaveLength(2);
  });

  it("lets a refunded customer pay again", () => {
    const row = rowWith(
      {
        ...BASE,
        advance_amount: "195000",
        ...group("payment", 1, { amount: "95000", date: "2025-01-20", purpose: "refund" }),
        ...group("payment", 2, { amount: "95000", date: "2025-01-25" }),
      },
      slots,
    );
    expect(row.payments).toHaveLength(2);
  });

  it("records a write-off with its reason as the note — the reference cell is the reason", () => {
    const row = rowWith(
      {
        ...BASE,
        advance_amount: "100000",
        ...group("payment", 1, { amount: "94200", date: "2025-01-10" }),
        ...group("payment", 2, {
          amount: "800",
          date: "2025-01-11",
          purpose: "write_off",
          reference: "  Short at handover, waived  ",
        }),
      },
      slots,
    );
    expect(row.payments[1]).toEqual({
      amount: 800,
      paid_on: "2025-01-11",
      method: "other",
      purpose: "write_off",
      paid_by_office: false,
      reference: null,
      notes: "Short at handover, waived",
    });
  });

  it("takes the row's notes as the reason when the write-off has no reference", () => {
    const row = rowWith(
      {
        ...BASE,
        notes: "Customer short by 800",
        advance_amount: "100000",
        ...group("payment", 1, { amount: "94200", date: "2025-01-10" }),
        ...group("payment", 2, { amount: "800", date: "2025-01-11", purpose: "write off" }),
      },
      slots,
    );
    expect(row.payments[1]).toMatchObject({ purpose: "write_off", reference: null, notes: "Customer short by 800" });
  });

  it("refuses a write-off with no reason anywhere", () => {
    expect(
      refusedWith(
        {
          ...BASE,
          advance_amount: "100000",
          ...group("payment", 1, { amount: "94200", date: "2025-01-10" }),
          ...group("payment", 2, { amount: "800", date: "2025-01-11", purpose: "write_off" }),
        },
        slots,
      ),
    ).toBe(
      "payment_2_reference is required for a write_off — say why the balance is being written off (or fill the row's notes)",
    );
  });

  it("holds a write-off's reason to the length of a note", () => {
    expect(
      refusedWith(
        {
          ...BASE,
          advance_amount: "100000",
          ...group("payment", 1, { amount: "94200", date: "2025-01-10" }),
          ...group("payment", 2, {
            amount: "800",
            date: "2025-01-11",
            purpose: "write_off",
            reference: "x".repeat(501),
          }),
        },
        slots,
      ),
    ).toBe("payment_2_reference is too long for a write-off reason (501 characters; the most is 500)");
  });

  it("allows a write-off of exactly the balance, and refuses more", () => {
    const sheet = {
      ...BASE,
      advance_amount: "100000",
      ...group("payment", 1, { amount: "94200", date: "2025-01-10" }),
    };
    const off = (amount: string) =>
      group("payment", 2, { amount, date: "2025-01-11", purpose: "write_off", reference: "waived" });
    expect(rowWith({ ...sheet, ...off("800") }, slots).payments).toHaveLength(2);
    expect(refusedWith({ ...sheet, ...off("800.01") }, slots)).toBe(
      `payment_2_amount ${formatCurrency(800.01)} is more than the ${formatCurrency(800)} still due on 2025-01-11 — a write-off cannot exceed the balance`,
    );
  });

  it("does not let a balance be written off twice", () => {
    expect(
      refusedWith(
        {
          ...BASE,
          advance_amount: "100000",
          ...group("payment", 1, { amount: "94200", date: "2025-01-10" }),
          ...group("payment", 2, { amount: "800", date: "2025-01-11", purpose: "write_off", reference: "a" }),
          ...group("payment", 3, { amount: "1", date: "2025-01-12", purpose: "write_off", reference: "b" }),
        },
        slots,
      ),
    ).toMatch(/^payment_3_amount .* is more than the .*0\.00 still due on 2025-01-12/);
  });

  it("knows nothing is due when the total cost is not recorded", () => {
    expect(
      refusedWith(
        {
          ...BASE,
          total_cost: "",
          order_date: "2025-01-10",
          cancellation: "cancelled",
          ...group("payment", 1, { amount: "10000", date: "2025-01-10" }),
          ...group("payment", 2, { amount: "800", date: "2025-01-11", purpose: "write_off", reference: "x" }),
        },
        slots,
      ),
    ).toBe("payment_2_purpose write_off needs a total_cost — the balance is not known");
  });

  it("still refunds a cancelled sale whose price was lost", () => {
    const row = rowWith(
      {
        ...BASE,
        total_cost: "",
        order_date: "2025-01-10",
        cancellation: "refunded",
        ...group("payment", 1, { amount: "10000", date: "2025-01-10" }),
        ...group("payment", 2, { amount: "10000", date: "2025-02-20", purpose: "refund" }),
      },
      slots,
    );
    expect(row).toMatchObject({ total_cost: 0, cancellation: "refunded" });
    expect(row.payments.map((p) => p.purpose)).toEqual(["contract", "refund"]);
  });

  it("does not count KSEB fees, whoever paid them, towards the contract", () => {
    expect(
      rowWith(
        {
          ...BASE,
          advance_amount: "195000",
          ...group("payment", 1, { amount: "9999", date: "2025-01-10", purpose: "kseb_fees" }),
          ...group("payment", 2, {
            amount: "9999",
            date: "2025-01-10",
            purpose: "kseb_fees",
            paid_by_office: "yes",
          }),
        },
        slots,
      ).payments,
    ).toHaveLength(2);
  });

  it("tells an overpayment what to do: record a refund, or a write-off", () => {
    const error = refusedWith(
      { ...BASE, advance_amount: "20000", ...group("payment", 1, { amount: "1800000", date: "2025-01-10" }) },
      slots,
    );
    expect(error).toBe(
      `advance_amount plus contract payments come to ${formatCurrency(1820000)}, more than total_cost ${formatCurrency(195000)} — check for a typo. If money was returned, record it as a refund (payment_N_purpose = refund); if a few rupees are simply not coming, record a write-off (payment_N_purpose = write_off, with the reason in payment_N_reference or notes)`,
    );
  });

  it("refuses a write-off while the sale is still overpaid, and the overpayment with it", () => {
    const error = refusedWith(
      {
        ...BASE,
        advance_amount: "20000",
        ...group("payment", 1, { amount: "200000", date: "2025-01-10" }),
        ...group("payment", 2, { amount: "1000", date: "2025-01-20", purpose: "refund" }),
        ...group("payment", 3, { amount: "1000", date: "2025-01-21", purpose: "write_off" }),
      },
      slots,
    );
    // 20,000 + 200,000 − 1,000 is still 24,000 over the sale: a write-off has nothing to close.
    expect(error).toMatch(/payment_3_amount .* still due on 2025-01-21/);
    expect(error).toMatch(/\(less refunds, plus write-offs\) come to .*, more than total_cost/);
  });

  it("allows exactly the contract once refunds and write-offs are counted", () => {
    expect(
      rowWith(
        {
          ...BASE,
          advance_amount: "20000",
          ...group("payment", 1, { amount: "175000", date: "2025-01-10" }),
          ...group("payment", 2, { amount: "10000", date: "2025-01-20", purpose: "refund" }),
          ...group("payment", 3, { amount: "10000", date: "2025-01-21" }),
        },
        slots,
      ).payments,
    ).toHaveLength(3);
  });
});

describe("parseImportRow — the template's example rows", () => {
  const EXAMPLE = "this is one of the template's example rows — delete it";

  // The cells that identified each example in the template before this release,
  // so a sheet filled in from that copy is still caught.
  const OLD_COPIES: [string, Record<string, string>][] = [
    [
      "Anand Kumar",
      { client_name: "Anand Kumar", plant_capacity: "3kW", total_cost: "195000", consumer_number: "1156789012345" },
    ],
    [
      "Meera Nair",
      { client_name: "Meera Nair", plant_capacity: "5kW", total_cost: "310000", consumer_number: "1145678054321" },
    ],
    [
      "Sreeja Pillai",
      { client_name: "Sreeja Pillai", plant_capacity: "2kW", total_cost: "130000" },
    ],
    [
      "Joseph Mathew",
      {
        client_name: "Joseph Mathew",
        plant_capacity: "3kW+inverter",
        total_cost: "235000+23500",
        consumer_number: "1167890123456",
      },
    ],
    [
      "Rakesh Varma",
      {
        client_name: "Rakesh Varma",
        plan_type: "custom",
        plant_capacity: "Inverter + panel",
        total_cost: "23500",
        order_date: "2026-04-20",
      },
    ],
    [
      "Suma Devi",
      { client_name: "Suma Devi", plant_capacity: "3kW", total_cost: "235000", order_date: "2026-01-13" },
    ],
  ];

  it.each(OLD_COPIES)("refuses %s as it was in the template, and says to delete it", (_name, cells) => {
    expect(refusedWith({ coordinator: "Rahul Menon", ...cells })).toBe(EXAMPLE);
  });

  it("reports only that, however much else is wrong with the row", () => {
    const reading = readWith({
      client_name: "Anand Kumar",
      plant_capacity: "banana",
      total_cost: "195000",
      consumer_number: "1156789012345",
      coordinator: "Nobody At All",
      order_date: "not a date",
    });
    expect(!reading.parsed.ok && reading.parsed.error).toBe(EXAMPLE);
    // …and the example's coordinator is not one of the file's matches.
    expect(reading.references).toEqual([]);
    expect(reading.blankCoordinator).toBe(false);
  });

  it("knows the example by its client name, case and spacing aside", () => {
    expect(refusedWith({ ...OLD_COPIES[0][1], client_name: "  anand   KUMAR ", coordinator: "Rahul" })).toBe(
      EXAMPLE,
    );
  });

  it("knows the example by its consumer number alone, whatever else was changed", () => {
    expect(
      refusedWith({
        client_name: "Anand Kumar",
        plant_capacity: "9kW",
        total_cost: "999999",
        consumer_number: "1156 7890 12345",
        coordinator: "Rahul",
        order_date: "2025-01-01",
      }),
    ).toBe(EXAMPLE);
  });

  it("knows the example by its total cost and order date when it has no consumer number", () => {
    expect(
      refusedWith({
        client_name: "Suma Devi",
        plant_capacity: "3kW",
        total_cost: "235000",
        order_date: "13/01/2026",
        coordinator: "Rahul",
      }),
    ).toBe(EXAMPLE);
  });

  it("does not take a real customer of the same name for the example", () => {
    // A different consumer number, cost or date: someone else.
    const others: Record<string, string>[] = [
      { consumer_number: "1156789099999", total_cost: "250000" },
      { total_cost: "195000", order_date: "2025-03-10" },
      { total_cost: "200000" },
    ];
    for (const over of others) {
      expect(
        rowWith({ client_name: "Anand Kumar", plant_capacity: "3kW", coordinator: "Rahul", ...over })
          .client_name,
      ).toBe("Anand Kumar");
    }
  });

  it("does not take another customer with the example's number and date for it", () => {
    expect(
      rowWith({
        client_name: "Someone Else",
        plant_capacity: "3kW",
        total_cost: "195000",
        consumer_number: "1156789012345",
        order_date: "2026-06-15",
        coordinator: "Rahul",
      }).client_name,
    ).toBe("Someone Else");
  });

  it("does not take the example's cost and date alone for it when the name differs", () => {
    expect(
      rowWith({
        client_name: "Rakesh Varma Junior",
        plan_type: "custom",
        plant_capacity: "Inverter + panel",
        total_cost: "23500",
        order_date: "2026-04-20",
        coordinator: "Rahul",
      }).client_name,
    ).toBe("Rakesh Varma Junior");
  });

  it("does not match a date it could not read", () => {
    const error = refusedWith({
      client_name: "Suma Devi",
      plant_capacity: "3kW",
      total_cost: "235000",
      order_date: "01/13/2026",
      coordinator: "Rahul",
    });
    expect(error).toMatch(/^order_date "01\/13\/2026" is not a real date/);
  });
});

describe("planImport — incentive columns and the notes", () => {
  const COLUMNS = [
    "client_name",
    "plant_capacity",
    "total_cost",
    "order_date",
    "coordinator",
    "incentive_1_coordinator",
    "incentive_1_amount",
    "incentive_1_date",
    "incentive_2_coordinator",
    "incentive_2_amount",
    "incentive_2_date",
  ].join(",");

  it("reads the groups the header has, for a shared sale, and keeps the incentive people in the matches", () => {
    const planned = plan(
      [
        COLUMNS,
        "Kumar One,3kW,195000,13/02/2025,Ravi+Abhijith,Ravi,20000,15/05/2025,Abhijith,15000,",
      ].join("\n"),
    );
    const row = planned.rows[0].parsed;
    expect(row.ok && row.data.incentives).toEqual([
      {
        coordinator_id: RAVI.id,
        amount: 20000,
        payments: [{ amount: 20000, paid_on: "2025-05-15", note: null }],
      },
      { coordinator_id: ABHIJITH.id, amount: 15000, payments: [] },
    ]);
  });

  it("lists an unknown name from an incentive column among the matches, problems first", () => {
    const planned = plan(
      [COLUMNS, "Kumar Two,3kW,195000,13/02/2025,Ravi+Abhijith,Gireesh,20000,15/05/2025,,,"].join("\n"),
    );
    expect(planned.rows[0].parsed).toMatchObject({ ok: false });
    expect(planned.coordinatorMatches.map((m) => [m.written, m.account?.fullName ?? null])).toEqual([
      ["Gireesh", null],
      ["Ravi", "Ravi Kumar"],
      ["Abhijith", "Abhijith Nair"],
    ]);
    expect(planned.coordinatorMatches[0].rows).toEqual([2]);
  });

  it("gives no notes for a sheet of ISO dates", () => {
    expect(plan([COLUMNS, "Kumar Three,3kW,195000,2025-02-13,Ravi,,5000,2025-05-15,,,"].join("\n")).notes).toEqual(
      [],
    );
  });

  it("notes how many date cells were read day first, in how many rows, with an example", () => {
    const planned = plan(
      [
        COLUMNS,
        "Kumar Four,3kW,195000,13/02/2025,Ravi,,5000,15/05/2025,,,",
        "Kumar Five,3kW,195000,2025-02-14,Ravi,,5000,2025-05-15,,,",
        "Kumar Six,3kW,195000,04-02-25,Ravi,,,,,,",
      ].join("\n"),
    );
    expect(planned.notes).toEqual([
      '3 date cells were written day first (in 2 rows) and read that way — "13/02/2025" is 13 Feb 2025. Dates are never read month first.',
    ]);
  });

  it("says 'cell' and 'row' for one", () => {
    const planned = plan([COLUMNS, "Kumar Seven,3kW,195000,13/02/2025,Ravi,,,,,,"].join("\n"));
    expect(planned.notes).toEqual([
      '1 date cell was written day first (in 1 row) and read that way — "13/02/2025" is 13 Feb 2025. Dates are never read month first.',
    ]);
  });

  it("counts the day-first dates of a row that failed too — it will be fixed and checked again", () => {
    const planned = plan([COLUMNS, "Kumar Eight,,195000,13/02/2025,Ravi,,,,,,"].join("\n"));
    expect(planned.rows[0].parsed.ok).toBe(false);
    expect(planned.notes).toHaveLength(1);
  });

  it("does not count the dates of a template example that is to be deleted", () => {
    const planned = plan(
      [
        "client_name,plant_capacity,total_cost,order_date,coordinator,consumer_number",
        "Anand Kumar,3kW,195000,15/06/2026,Rahul,1156789012345",
      ].join("\n"),
    );
    expect(planned.notes).toEqual([]);
  });
});

describe("planImport — the month spread", () => {
  const HEADER_DATES = "client_name,plant_capacity,total_cost,order_date,coordinator";
  const sheet = (...dates: string[]) =>
    [HEADER_DATES, ...dates.map((d, i) => `Customer ${i + 1},3kW,195000,${d},Rahul`)].join("\n");

  it("lists the rows outside the month most of the sheet is in", () => {
    const planned = plan(sheet("2025-02-03", "2025-02-05", "2025-02-07", "2025-02-09", "2025-04-02"));
    expect(planned.warnings).toContain(
      "4 of 5 order dates are in February 2025, but row 6 is in April 2025 — may be a day/month mix-up. Check that date.",
    );
  });

  it("names every other month and every row, in the sheet's lines", () => {
    const planned = plan(
      sheet("2025-02-03", "2025-02-05", "2025-02-07", "2025-02-09", "2025-02-11", "2025-03-02", "2025-04-03", "2025-03-09"),
    );
    expect(planned.warnings).toContain(
      "5 of 8 order dates are in February 2025, but rows 7, 8 and 9 are in March 2025 and April 2025 — may be a day/month mix-up. Check those dates.",
    );
  });

  it("is quiet when 60% is not reached, and 60% exactly is enough", () => {
    expect(
      plan(sheet("2025-02-03", "2025-02-05", "2025-02-07", "2025-03-02", "2025-03-04")).warnings.filter((w) =>
        w.includes("mix-up"),
      ),
    ).toEqual([
      "3 of 5 order dates are in February 2025, but rows 5 and 6 are in March 2025 — may be a day/month mix-up. Check those dates.",
    ]);
    expect(
      plan(sheet("2025-02-03", "2025-02-05", "2025-03-02", "2025-03-04", "2025-04-04")).warnings.filter((w) =>
        w.includes("mix-up"),
      ),
    ).toEqual([]);
  });

  it("is quiet when every row is in one month", () => {
    expect(
      plan(sheet("2025-02-03", "2025-02-05", "2025-02-28")).warnings.filter((w) => w.includes("mix-up")),
    ).toEqual([]);
  });

  it("is quiet for one row, or two of two months", () => {
    expect(plan(sheet("2025-02-03")).warnings.filter((w) => w.includes("mix-up"))).toEqual([]);
    expect(
      plan(sheet("2025-02-03", "2025-03-03")).warnings.filter((w) => w.includes("mix-up")),
    ).toEqual([]);
  });

  it("separates the same month of different years", () => {
    const planned = plan(sheet("2025-02-03", "2025-02-05", "2025-02-07", "2024-02-09"));
    expect(planned.warnings).toContain(
      "3 of 4 order dates are in February 2025, but row 5 is in February 2024 — may be a day/month mix-up. Check that date.",
    );
  });

  it("reads the dates day first, as the sheet is read", () => {
    // 04/02/2025 is 4 February — the clerk's Excel shows a swapped 2 April as 04-02-25 in some cells.
    const planned = plan(sheet("04/02/2025", "05/02/2025", "06/02/2025", "07/04/2025"));
    expect(planned.warnings).toContain(
      "3 of 4 order dates are in February 2025, but row 5 is in April 2025 — may be a day/month mix-up. Check that date.",
    );
  });

  it("ignores blank order dates, which are not a month", () => {
    const planned = plan(sheet("2025-02-03", "2025-02-05", "", "", "", "2025-04-02", "2025-02-06"));
    expect(planned.warnings.filter((w) => w.includes("mix-up"))).toEqual([
      "3 of 4 order dates are in February 2025, but row 7 is in April 2025 — may be a day/month mix-up. Check that date.",
    ]);
  });

  it("counts rows that fail for something else, whose date is readable", () => {
    const csv = [
      HEADER_DATES,
      "A,3kW,195000,2025-02-03,Rahul",
      "B,3kW,195000,2025-02-05,Rahul",
      "C,3kW,195000,2025-02-07,Nobody At All",
      "D,3kW,195000,2025-04-09,Nobody At All",
    ].join("\n");
    expect(plan(csv).warnings.filter((w) => w.includes("mix-up"))).toEqual([
      "3 of 4 order dates are in February 2025, but row 5 is in April 2025 — may be a day/month mix-up. Check that date.",
    ]);
  });

  it("takes the earlier month when two are equally common and both are most of the sheet", () => {
    // 3 + 3 of 6 is 50%: neither is a majority, so nothing is said.
    expect(
      plan(sheet("2025-02-03", "2025-02-05", "2025-02-07", "2025-03-03", "2025-03-05", "2025-03-07")).warnings.filter(
        (w) => w.includes("mix-up"),
      ),
    ).toEqual([]);
  });

  it("leaves the template's examples out of it: they are deleted, whatever their dates", () => {
    const csv = [
      "client_name,plant_capacity,total_cost,order_date,coordinator,consumer_number",
      "A,3kW,195000,2025-02-03,Rahul,",
      "B,3kW,195000,2025-02-05,Rahul,",
      "C,3kW,195000,2025-02-07,Rahul,",
      "Anand Kumar,3kW,195000,2026-06-15,Rahul,1156789012345",
    ].join("\n");
    const planned = plan(csv);
    expect(planned.warnings.filter((w) => w.includes("mix-up"))).toEqual([]);
    expect(planned.rows[3].parsed).toEqual({
      ok: false,
      error: "this is one of the template's example rows — delete it",
    });
  });

  it("lists past three other months by count", () => {
    const planned = plan(
      sheet(
        ...Array.from({ length: 12 }, () => "2025-02-03"),
        "2025-03-01",
        "2025-04-01",
        "2025-05-01",
        "2025-06-01",
      ),
    );
    expect(planned.warnings).toContain(
      "12 of 16 order dates are in February 2025, but rows 14, 15, 16 and 17 are in March 2025, April 2025, May 2025 and 1 more — may be a day/month mix-up. Check those dates.",
    );
  });
});

describe("planImport — row notes on a refunded sale and on dates", () => {
  const COLUMNS = [
    "client_name",
    "plant_capacity",
    "total_cost",
    "advance_amount",
    "advance_date",
    "order_date",
    "coordinator",
    "cancellation",
    "payment_1_amount",
    "payment_1_date",
    "payment_1_purpose",
    "payment_2_amount",
    "payment_2_date",
    "payment_2_purpose",
    "payment_3_amount",
    "payment_3_date",
    "payment_3_purpose",
  ];
  const SALE = {
    plant_capacity: "3kW",
    total_cost: "195000",
    order_date: "2026-06-15",
    coordinator: "Rahul",
  };
  const csv = (...sales: Record<string, string>[]) =>
    [
      COLUMNS.join(","),
      ...sales.map((sale) => COLUMNS.map((c) => sale[c] ?? "").join(",")),
    ].join("\n");
  const warningsOf = (...sales: Record<string, string>[]) =>
    plan(csv(...sales.map((sale) => ({ ...SALE, ...sale })))).rows.map((r) => r.warnings);

  it("says so when a sale marked refunded still holds the customer's money", () => {
    expect(
      warningsOf({ client_name: "Asha Nair", advance_amount: "30000", cancellation: "refunded" }),
    ).toEqual([
      [
        expect.stringMatching(
          /^marked refunded, but ₹30,000 \(advance plus payments, less refunds\) is still held in the ledger — if it was handed back, add a refund line/,
        ),
      ],
    ]);
  });

  it("counts the payments and subtracts the refunds already recorded", () => {
    const [partly, fully, none] = warningsOf(
      // ₹30,000 + ₹40,000 held, ₹50,000 handed back: ₹20,000 still held.
      {
        client_name: "Asha Nair",
        advance_amount: "30000",
        cancellation: "refunded",
        payment_1_amount: "40000",
        payment_1_date: "2026-06-20",
        payment_2_amount: "50000",
        payment_2_date: "2026-07-01",
        payment_2_purpose: "refund",
      },
      {
        client_name: "Bina Das",
        advance_amount: "30000",
        cancellation: "refunded",
        payment_1_amount: "30000",
        payment_1_date: "2026-07-01",
        payment_1_purpose: "refund",
      },
      { client_name: "Cini Roy", cancellation: "refunded" },
    );
    expect(partly).toEqual([expect.stringContaining("₹20,000 (advance plus payments, less refunds)")]);
    expect(fully).toEqual([]);
    expect(none).toEqual([]);
  });

  it("leaves a cancelled sale and a live one alone", () => {
    expect(
      warningsOf(
        { client_name: "Dev Kumar", advance_amount: "30000", cancellation: "cancelled" },
        { client_name: "Esha Pillai", advance_amount: "30000" },
      ),
    ).toEqual([[], []]);
  });

  it("flags a payment, or an advance, dated before the order", () => {
    const [payment, advance] = warningsOf(
      { client_name: "Farid Khan", payment_1_amount: "50000", payment_1_date: "2026-01-08" },
      { client_name: "Gita Menon", advance_amount: "30000", advance_date: "2026-05-01" },
    );
    expect(payment).toEqual([
      "payment_1_date 08 Jan 2026 — before order_date 15 Jun 2026; check the day and month",
    ]);
    expect(advance).toEqual([
      "advance_date 01 May 2026 — before order_date 15 Jun 2026; check the day and month",
    ]);
  });

  it("flags contract payments whose dates run backwards, once", () => {
    const [row] = warningsOf({
      client_name: "Hari Das",
      order_date: "2026-03-01",
      payment_1_amount: "50000",
      payment_1_date: "2026-03-26",
      payment_2_amount: "40000",
      payment_2_date: "2026-03-08",
      payment_3_amount: "30000",
      payment_3_date: "2026-03-05",
    });
    expect(row).toEqual([
      "payment_2_date 08 Mar 2026 is earlier than payment_1_date 26 Mar 2026 — payments run backwards; check the day and month",
    ]);
  });

  it("does not call a refund that follows its payment backwards, nor an ordered sheet suspicious", () => {
    expect(
      warningsOf({
        client_name: "Indu Nair",
        advance_amount: "30000",
        advance_date: "2026-06-15",
        payment_1_amount: "50000",
        payment_1_date: "2026-06-20",
        payment_2_amount: "10000",
        payment_2_date: "2026-06-18",
        payment_2_purpose: "refund",
      }),
    ).toEqual([[]]);
  });

  it("flags a year typed wrongly, without also calling it 'before the order'", () => {
    const [row] = warningsOf({
      client_name: "Jose Mathew",
      payment_1_amount: "50000",
      payment_1_date: "1026-06-20",
    });
    expect(row).toEqual([
      "payment_1_date 20 Jun 1026 — before 2015, which is most likely a mistyped year",
    ]);
  });

  it("names at most three dates and counts the rest", () => {
    const [row] = warningsOf({
      client_name: "Kavya Rao",
      advance_amount: "10000",
      advance_date: "2026-01-01",
      payment_1_amount: "5000",
      payment_1_date: "2026-01-02",
      payment_2_amount: "5000",
      payment_2_date: "2026-01-03",
      payment_3_amount: "5000",
      payment_3_date: "2026-01-04",
    });
    expect(row).toEqual([
      "advance_date 01 Jan 2026; payment_1_date 02 Jan 2026; payment_2_date 03 Jan 2026 and 1 more — before order_date 15 Jun 2026; check the day and month",
    ]);
  });

  it("says nothing about dates when the order date was left blank", () => {
    const [row] = warningsOf({
      client_name: "Lal Joseph",
      order_date: "",
      payment_1_amount: "50000",
      payment_1_date: "2026-01-08",
    });
    expect(row).toEqual([`order_date is blank — today (${TODAY}) will be used`]);
  });
});

describe("planImport — a monthly sheet as the clerk types it (invented customers)", () => {
  const COLUMNS = [
    "client_name",
    "plant_capacity",
    "total_cost",
    "advance_amount",
    "advance_method",
    "advance_date",
    "order_date",
    "coordinator",
    "consumer_number",
    "coordinator_incentive",
    "incentive_paid_on",
    "current_stage",
    "payment_1_amount",
    "payment_1_date",
    "payment_1_purpose",
    "payment_1_reference",
    "payment_2_amount",
    "payment_2_date",
    "payment_2_purpose",
    "payment_2_reference",
    "incentive_1_coordinator",
    "incentive_1_amount",
    "incentive_1_date",
    "incentive_2_coordinator",
    "incentive_2_amount",
    "incentive_2_date",
  ];
  const record = (cells: Record<string, string>) =>
    COLUMNS.map((c) => (cells[c] ?? "").replaceAll(",", ";")).join(",");

  const sheet = [
    COLUMNS.join(","),
    // Sale one: the advance by UPI, two payments, the incentive paid in three instalments.
    record({
      client_name: "Mohan Das",
      plant_capacity: "3kW+2kW",
      total_cost: "250000",
      advance_amount: "50000",
      advance_method: "UPI",
      advance_date: "04-02-25",
      order_date: "04/02/2025",
      coordinator: "Ravi",
      current_stage: "plant_complete",
      coordinator_incentive: "20000+2360+2360",
      incentive_paid_on: "15/05/2025+16/05/2025+21/05/2025",
      payment_1_amount: "100000",
      payment_1_date: "20/03/2025",
      payment_2_amount: "100000",
      payment_2_date: "22/04/2025",
    }),
    // Sale two: shared, different incentives per person, a KSEB fee the office paid.
    record({
      client_name: "Latha Varma",
      plant_capacity: "5kW",
      total_cost: "355000",
      order_date: "13/02/2025",
      coordinator: "Ravi + Abhijith",
      current_stage: "plant_complete",
      incentive_1_coordinator: "Ravi",
      incentive_1_amount: "20000",
      incentive_1_date: "15/05/2025",
      incentive_2_coordinator: "Abhijith",
      incentive_2_amount: "15000",
      payment_1_amount: "354200",
      payment_1_date: "14/03/2025",
      payment_2_amount: "800",
      payment_2_date: "14/03/2025",
      payment_2_purpose: "write_off",
      payment_2_reference: "Short by Rs 800, waived",
    }),
    // Sale three: refunded ten thousand on a live project.
    record({
      client_name: "Geetha Pillai",
      plant_capacity: "3kW",
      total_cost: "235000",
      order_date: "15/02/2025",
      coordinator: "Manohar",
      payment_1_amount: "50000",
      payment_1_date: "15/02/2025",
      payment_2_amount: "10000",
      payment_2_date: "28/02/2025",
      payment_2_purpose: "refund",
      payment_2_reference: "NEFT back to customer",
    }),
    // Sale four: a coordinator with no account yet.
    record({
      client_name: "Hari Nair",
      plant_capacity: "3kW",
      total_cost: "235000",
      order_date: "17/02/2025",
      coordinator: "Gireesh",
    }),
  ].join("\n");

  const planned = plan(sheet);
  const row = (n: number) => {
    const found = planned.rows.find((r) => r.rowNo === n);
    if (!found?.parsed.ok) throw new Error(`row ${n}: ${found?.parsed.ok === false ? found.parsed.error : "missing"}`);
    return found.parsed.data;
  };

  it("makes three of the four rows ready — only the account-less coordinator is refused", () => {
    expect(planned.rows.map((r) => r.parsed.ok)).toEqual([true, true, true, false]);
    expect(!planned.rows[3].parsed.ok && planned.rows[3].parsed.error).toMatch(
      /^coordinator "Gireesh" is not a coordinator or office account/,
    );
  });

  it("reads the advance and its details, and the capacity written as a sum", () => {
    expect(row(2)).toMatchObject({
      advance_amount: 50000,
      advance_method: "upi",
      advance_paid_on: "2025-02-04",
      order_date: "2025-02-04",
      plant_capacity: "5kW",
    });
  });

  it("splits the one-coordinator incentive into its three dated instalments", () => {
    expect(row(2).incentives).toEqual([
      {
        coordinator_id: RAVI.id,
        amount: 24720,
        payments: [
          { amount: 20000, paid_on: "2025-05-15", note: null },
          { amount: 2360, paid_on: "2025-05-16", note: null },
          { amount: 2360, paid_on: "2025-05-21", note: null },
        ],
      },
    ]);
  });

  it("gives each person of the shared sale their own, one paid and one not yet", () => {
    expect(row(3).incentives).toEqual([
      {
        coordinator_id: RAVI.id,
        amount: 20000,
        payments: [{ amount: 20000, paid_on: "2025-05-15", note: null }],
      },
      { coordinator_id: ABHIJITH.id, amount: 15000, payments: [] },
    ]);
  });

  it("settles the sale that was ₹800 short with a write-off carrying its reason", () => {
    expect(row(3).payments[1]).toMatchObject({
      purpose: "write_off",
      amount: 800,
      notes: "Short by Rs 800; waived",
      reference: null,
    });
  });

  it("keeps the refund a line of the ledger", () => {
    expect(row(4).payments.map((p) => [p.purpose, p.amount])).toEqual([
      ["contract", 50000],
      ["refund", 10000],
    ]);
  });

  it("says what it did to the dates, and finds nothing odd about the months", () => {
    expect(planned.notes).toEqual([
      expect.stringMatching(/^\d+ date cells were written day first \(in 4 rows\)/),
    ]);
    expect(planned.warnings.filter((w) => w.includes("mix-up"))).toEqual([]);
  });

  it("lists Gireesh among the matches, first, with the row that needs him", () => {
    expect(planned.coordinatorMatches[0]).toMatchObject({ written: "Gireesh", account: null, rows: [5] });
  });
});
