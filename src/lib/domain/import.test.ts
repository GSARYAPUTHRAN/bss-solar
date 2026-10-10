import { describe, it, expect } from "vitest";
import {
  IMPORT_COLUMN_GROUPS,
  IMPORT_HEADERS,
  MAX_IMPORT_ROWS,
  REQUIRED_IMPORT_HEADERS,
  parseImportRow,
  planImport,
  validateImportHeaders,
  type ImportRow,
} from "./import";
import { ledgerTotals, paymentSummary } from "./payment";

const TODAY = "2026-10-10";
const ctx = (paymentSlots: number[] = []) => ({ today: TODAY, paymentSlots });

const BASE = {
  client_name: "Anand Kumar",
  plant_capacity: "3kW",
  total_cost: "195000",
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
});

describe("validateImportHeaders", () => {
  it("accepts the required columns alone", () => {
    expect(validateImportHeaders(["client_name", "plant_capacity", "total_cost"])).toEqual({
      ok: true,
      data: { headers: ["client_name", "plant_capacity", "total_cost"], paymentSlots: [] },
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

  it("rejects unknown columns, suggesting the intended one", () => {
    const res = validateImportHeaders([
      ...REQUIRED_IMPORT_HEADERS,
      "client nme",
      "payment_3_amout",
      "payment_3_date",
      "subsidy_amount",
    ]);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toMatch(/Unknown columns:/);
    expect(res.error).toContain('"client nme" (did you mean "client_name"?)');
    expect(res.error).toContain('"payment_3_amout" (did you mean "payment_3_amount"?)');
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
      plant_capacity: "3kW",
      total_cost: 195000,
      advance_amount: 0,
      order_date: TODAY,
      coordinator_email: null,
      financing_type: "self",
      loan_bank_name: null,
      consumer_number: null,
      kseb_section: null,
      notes: null,
      current_stage: "site_feasibility_survey",
      is_completed: false,
      commissioned_on: null,
      feasibility_date: null,
      coordinator_incentive: null,
      incentive_paid_on: null,
      payments: [],
    });
  });

  it("reports every missing required column at once", () => {
    const error = problems({ client_name: "", plant_capacity: "", total_cost: "" });
    expect(error).toContain("client_name is required");
    expect(error).toContain("plant_capacity is required");
    expect(error).toContain("total_cost is required");
  });

  it("rejects a capacity with no number in it", () => {
    expect(problems({ ...BASE, plant_capacity: "big" })).toMatch(
      /plant_capacity "big" has no capacity/,
    );
    expect(problems({ ...BASE, plant_capacity: "0kW" })).toMatch(/has no capacity/);
    expect(parsed({ ...BASE, plant_capacity: "3000 W" }).plant_capacity).toBe("3000 W");
  });

  it("rejects negative or non-numeric money", () => {
    expect(problems({ ...BASE, total_cost: "-1" })).toMatch(/total_cost cannot be negative/);
    expect(problems({ ...BASE, advance_amount: "abc" })).toMatch(/advance_amount must be/);
  });

  it("keeps blank optional columns null rather than zero", () => {
    const row = parsed({ ...BASE, coordinator_incentive: "", consumer_number: " " });
    expect(row.coordinator_incentive).toBeNull();
    expect(row.consumer_number).toBeNull();
  });

  it("carries the work-order columns through, trimmed", () => {
    const row = parsed({
      ...BASE,
      client_phone: " +91 98470 11111 ",
      address: "Vytilla, Kochi",
      advance_amount: "20,000",
      order_date: "2026-06-15",
      coordinator_email: "Coord@BSSSolar.test",
      consumer_number: "1156789012345",
      kseb_section: "Vytilla",
      notes: "Scaffolding needed",
    });
    expect(row).toMatchObject({
      client_phone: "+91 98470 11111",
      address: "Vytilla, Kochi",
      advance_amount: 20000,
      order_date: "2026-06-15",
      coordinator_email: "coord@bsssolar.test",
      consumer_number: "1156789012345",
      kseb_section: "Vytilla",
      notes: "Scaffolding needed",
    });
  });

  it("rejects an order date in the future or malformed", () => {
    expect(problems({ ...BASE, order_date: "2026-10-11" })).toMatch(/order_date .* future/);
    expect(problems({ ...BASE, order_date: "15/01/2026" })).toMatch(/did you mean 2026-01-15/);
  });

  it("refuses a consumer number Excel turned into scientific notation", () => {
    expect(problems({ ...BASE, consumer_number: "1.15679E+12" })).toMatch(
      /scientific notation/,
    );
  });
});

describe("parseImportRow — financing", () => {
  it("defaults to self-financed", () => {
    expect(parsed(BASE).financing_type).toBe("self");
  });

  it("reads loan spellings and keeps the bank", () => {
    const row = parsed({ ...BASE, financing_type: "Bank loan", loan_bank_name: "SBI" });
    expect(row.financing_type).toBe("loan");
    expect(row.loan_bank_name).toBe("SBI");
  });

  it("treats a named bank with blank financing as a loan", () => {
    expect(parsed({ ...BASE, loan_bank_name: "Federal Bank" }).financing_type).toBe("loan");
  });

  it("rejects self-financing with a loan bank filled in", () => {
    expect(problems({ ...BASE, financing_type: "no", loan_bank_name: "SBI" })).toMatch(
      /loan_bank_name "SBI" is filled but financing_type is self/,
    );
  });

  it("rejects an unknown financing value", () => {
    expect(problems({ ...BASE, financing_type: "subsidy" })).toMatch(/use loan or self/);
  });
});

describe("parseImportRow — stage, commissioning and feasibility", () => {
  it("accepts a stage key or label", () => {
    expect(parsed({ ...BASE, current_stage: "Material Dispatch (Panels & Structure)" })
      .current_stage).toBe("material_dispatch");
    expect(problems({ ...BASE, current_stage: "bogus" })).toMatch(/current_stage "bogus"/);
  });

  it("forces the final stage when commissioned", () => {
    const row = parsed({ ...BASE, is_completed: "yes", current_stage: "material_dispatch" });
    expect(row.is_completed).toBe(true);
    expect(row.current_stage).toBe("plant_commissioning");
  });

  it("treats a commissioning date with a blank is_completed as commissioned", () => {
    const row = parsed({ ...BASE, order_date: "2026-01-10", commissioned_on: "2026-03-01" });
    expect(row.is_completed).toBe(true);
    expect(row.commissioned_on).toBe("2026-03-01");
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

describe("parseImportRow — incentive", () => {
  it("carries the incentive and its paid date", () => {
    const row = parsed({ ...BASE, coordinator_incentive: "5000", incentive_paid_on: "2026-09-01" });
    expect(row.coordinator_incentive).toBe(5000);
    expect(row.incentive_paid_on).toBe("2026-09-01");
  });

  it("allows an incentive of zero", () => {
    expect(parsed({ ...BASE, coordinator_incentive: "0" }).coordinator_incentive).toBe(0);
  });

  it("rejects a paid date without an incentive, a negative incentive, a future paid date", () => {
    expect(problems({ ...BASE, incentive_paid_on: "2026-09-01" })).toMatch(
      /incentive_paid_on needs a coordinator_incentive/,
    );
    expect(problems({ ...BASE, coordinator_incentive: "-100" })).toMatch(
      /coordinator_incentive cannot be negative/,
    );
    expect(
      problems({ ...BASE, coordinator_incentive: "100", incentive_paid_on: "2026-10-30" }),
    ).toMatch(/incentive_paid_on 2026-10-30 is in the future/);
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
    expect(paymentSummary({ ...row, payments_total: ledgerTotals(row.payments).contract })
      .balanceDue).toBe(0);
  });
});

describe("planImport", () => {
  it("rejects an empty upload, a bad header and a header with no rows", () => {
    expect(planImport("   ", TODAY)).toEqual({
      ok: false,
      error: expect.stringMatching(/Paste CSV/),
    });
    expect(planImport("client_name,foo\nA,B", TODAY)).toEqual({
      ok: false,
      error: expect.stringMatching(/header row needs fixing/),
    });
    expect(planImport("client_name,plant_capacity,total_cost\n", TODAY)).toEqual({
      ok: false,
      error: expect.stringMatching(/No data rows/),
    });
  });

  it(`caps an upload at ${MAX_IMPORT_ROWS} rows`, () => {
    const rows = Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, i) => `C${i},3kW,1000`);
    const res = planImport(["client_name,plant_capacity,total_cost", ...rows].join("\n"), TODAY);
    expect(res).toEqual({ ok: false, error: expect.stringMatching(/Too many rows \(1001\)/) });
  });

  it("keeps every row when a cell holds a quote mark", () => {
    const res = planImport(
      [
        "client_name,plant_capacity,total_cost,notes,consumer_number",
        'Anand,3kW,195000,Needs 2" conduit,111',
        "Meera,5kW,310000,,222",
        "Joseph,8kW,480000,,333",
      ].join("\n"),
      TODAY,
    );
    if (!res.ok) throw new Error(res.error);
    const rows = res.data.rows.map((r) => {
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
      TODAY,
    );
    expect(res).toEqual({
      ok: false,
      error: expect.stringMatching(/^Unclosed quote starting on line 3\b/),
    });
  });

  it("fails a row with values past the last column, that problem first", () => {
    const res = planImport(
      [
        "client_name,plant_capacity,total_cost,address,advance_amount",
        // An unquoted comma in the address shifts the advance one column right.
        "Anand,3kW,195000,Vytilla, Kochi,20000",
        "Meera,5kW,310000,Kowdiar,50000,",
        "Joseph,8kW,480000,Kakkanad,10000,NEFT 4471",
      ].join("\n"),
      TODAY,
    );
    if (!res.ok) throw new Error(res.error);
    const [shifted, trailingComma, lastColumn] = res.data.rows.map((r) => r.parsed);

    expect(shifted.ok).toBe(false);
    if (shifted.ok) return;
    expect(shifted.error).toMatch(
      /^Row has 6 cells but the header has 5 — put values that contain commas in double quotes \(past the last column: "20000"\); /,
    );
    expect(shifted.error).toMatch(/advance_amount must be/);

    // A spreadsheet's trailing comma adds a blank cell, not a value.
    expect(trailingComma.ok).toBe(true);

    // An otherwise valid row still fails: its extra value has nowhere to go.
    expect(lastColumn).toEqual({
      ok: false,
      error:
        'Row has 6 cells but the header has 5 — put values that contain commas in double quotes (past the last column: "NEFT 4471")',
    });
  });

  it("numbers rows by sheet line and keeps each row's own result", () => {
    const res = planImport(
      ["client_name,plant_capacity,total_cost", "Anand,3kW,195000", ",,", "No Capacity,,1000"].join(
        "\n",
      ),
      TODAY,
    );
    if (!res.ok) throw new Error(res.error);
    // The fully blank line is dropped by the CSV reader.
    expect(res.data.rows.map((r) => [r.rowNo, r.client, r.parsed.ok])).toEqual([
      [2, "Anand", true],
      [3, "No Capacity", false],
    ]);
    expect(res.data.rows[1].cells).toEqual({
      client_name: "No Capacity",
      plant_capacity: "",
      total_cost: "1000",
    });
  });
});
