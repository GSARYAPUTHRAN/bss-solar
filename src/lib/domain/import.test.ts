import { describe, it, expect } from "vitest";
import { toCsv } from "@/lib/csv";
import type { UserRole } from "@/lib/types";
import { CoordinatorDirectory, type DirectoryAccount } from "./coordinator-match";
import {
  IMPORT_COLUMN_GROUPS,
  IMPORT_HEADERS,
  IMPORT_HEADER_ALIASES,
  MAX_IMPORT_ROWS,
  NOT_RECORDED_LABEL,
  REQUIRED_IMPORT_HEADERS,
  parseImportRow,
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

const ctx = (paymentSlots: number[] = [], defaultCoordinator: DirectoryAccount | null = null) => ({
  today: TODAY,
  paymentSlots,
  directory: DIRECTORY,
  defaultCoordinator,
});

const BASE = {
  client_name: "Anand Kumar",
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
      client_name: "Anand Kumar",
      client_phone: null,
      address: null,
      plan_type: "solar",
      plant_capacity: "3kW",
      total_cost: 195000,
      advance_amount: 0,
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
      order_date: "2026-06-15",
      consumer_number: "1156789012345",
      kseb_section: "Vytilla",
      notes: "Scaffolding needed",
    });
    expect(row).toMatchObject({
      client_phone: "+91 98470 11111",
      address: "Vytilla, Kochi",
      advance_amount: 20000,
      order_date: "2026-06-15",
      consumer_number: "1156789012345",
      kseb_section: "Vytilla",
      notes: "Scaffolding needed",
    });
  });

  it("rejects an order date in the future or malformed", () => {
    expect(problems({ ...BASE, order_date: "2026-10-23" })).toMatch(/order_date .* future/);
    expect(problems({ ...BASE, order_date: "15/01/2026" })).toMatch(/did you mean 2026-01-15/);
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

describe("parseImportRow — incentive", () => {
  it("gives a single named coordinator the incentive and its paid date", () => {
    const row = parsed({ ...BASE, coordinator_incentive: "5000", incentive_paid_on: "2026-09-01" });
    expect(row.incentives).toEqual([
      { coordinator_id: RAHUL.id, amount: 5000, paid_on: "2026-09-01" },
    ]);
  });

  it("allows an unpaid incentive and an incentive of zero", () => {
    expect(parsed({ ...BASE, coordinator_incentive: "7000" }).incentives).toEqual([
      { coordinator_id: RAHUL.id, amount: 7000, paid_on: null },
    ]);
    expect(parsed({ ...BASE, coordinator_incentive: "0" }).incentives[0].amount).toBe(0);
  });

  it("rejects a paid date without an incentive, a negative incentive, a future paid date", () => {
    expect(problems({ ...BASE, incentive_paid_on: "2026-09-01" })).toMatch(
      /incentive_paid_on needs a coordinator_incentive/,
    );
    expect(problems({ ...BASE, coordinator_incentive: "-100" })).toMatch(
      /coordinator_incentive cannot be negative/,
    );
    expect(
      problems({ ...BASE, coordinator_incentive: "100", incentive_paid_on: "2026-11-30" }),
    ).toMatch(/incentive_paid_on 2026-11-30 is in the future/);
  });

  it("does not double-report a malformed incentive as missing", () => {
    const error = problems({
      ...BASE,
      coordinator_incentive: "abc",
      incentive_paid_on: "2026-09-01",
    });
    expect(error).toMatch(/coordinator_incentive must be an amount/);
    expect(error).not.toMatch(/needs a coordinator_incentive/);
  });

  it("is never split between the coordinators of a shared sale", () => {
    expect(
      problems({ ...BASE, coordinator: "Abhijith+Ravi", coordinator_incentive: "5000" }),
    ).toBe(
      "coordinator_incentive cannot be split automatically for a shared sale (Abhijith Nair, Ravi Kumar) — leave it blank and set each coordinator's incentive on the project page",
    );
    expect(
      problems({
        ...BASE,
        coordinator: "Abhijith+Ravi",
        coordinator_incentive: "5000",
        incentive_paid_on: "2026-09-01",
      }),
    ).toContain("incentive_paid_on cannot be split automatically for a shared sale");
    // Nothing to refuse when the shared sale carries none.
    expect(parsed({ ...BASE, coordinator: "Abhijith+Ravi" }).incentives).toEqual([]);
  });

  it("is refused on a row that fell back to the default coordinator", () => {
    const res = readImportRow(
      { ...BASE, coordinator: "", coordinator_incentive: "5000", incentive_paid_on: "2026-09-01" },
      2,
      ctx([], PRIYA),
    );
    expect(!res.parsed.ok && res.parsed.error).toBe(
      "coordinator_incentive needs the coordinator cell filled — name the coordinator this incentive belongs to; incentive_paid_on needs the coordinator cell filled — name the coordinator this incentive belongs to",
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
    ) => ({ amount, paid_on, method, purpose, reference, notes: null });
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
