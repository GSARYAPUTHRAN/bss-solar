import { describe, it, expect } from "vitest";
import { parseCsv } from "@/lib/csv";
import { planImport, validateImportHeaders, type ImportPlan, type ImportRow } from "./import";
import {
  IMPORT_INITIAL,
  chunk,
  importError,
  importedMessage,
  isImportRowStatus,
  summarizeImport,
  type ImportOutcome,
} from "./import-results";

const TODAY = "2026-10-10";

const ROW: ImportRow = {
  row_no: 2,
  client_name: "Anand Kumar",
  client_phone: null,
  address: null,
  plant_capacity: "3kW",
  total_cost: 195000,
  advance_amount: 20000,
  order_date: "2026-06-15",
  coordinator_email: null,
  financing_type: "self",
  loan_bank_name: null,
  consumer_number: null,
  kseb_section: null,
  notes: null,
  current_stage: "material_dispatch",
  is_completed: false,
  commissioned_on: null,
  feasibility_date: null,
  coordinator_incentive: null,
  incentive_paid_on: null,
  payments: [],
};

const payment = (amount: number, purpose: "contract" | "kseb_fees" = "contract") => ({
  amount,
  paid_on: "2026-07-01",
  method: "upi" as const,
  purpose,
  reference: null,
  notes: null,
});

function plan(csv: string): ImportPlan {
  const res = planImport(csv, TODAY);
  if (!res.ok) throw new Error(res.error);
  return res.data;
}

const outcomes = (...list: ImportOutcome[]) => new Map(list.map((o) => [o.row_no, o]));

/** The rows of a retry file; one this module wrote must always parse. */
function rowsOf(text: string | null): string[][] {
  const res = parseCsv(text ?? "");
  if ("error" in res) throw new Error(res.error);
  return res.rows;
}

describe("chunk", () => {
  it("splits into consecutive batches", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 200)).toEqual([]);
  });
  it("refuses a non-positive size", () => {
    expect(() => chunk([1], 0)).toThrow(RangeError);
  });
});

describe("isImportRowStatus", () => {
  it("knows the three RPC statuses only", () => {
    expect(["imported", "skipped", "failed", "ok"].map(isImportRowStatus)).toEqual([
      true,
      true,
      true,
      false,
    ]);
  });
});

describe("importError", () => {
  it("marks the run as done with no rows", () => {
    expect(importError("nope")).toEqual({ ...IMPORT_INITIAL, ran: true, error: "nope" });
  });
});

describe("importedMessage", () => {
  it("names the stage reached and the payments recorded", () => {
    expect(importedMessage(ROW)).toBe("Imported at Material Dispatch (Panels & Structure)");
    expect(importedMessage({ ...ROW, payments: [payment(1000), payment(500)] })).toBe(
      "Imported at Material Dispatch (Panels & Structure) · 2 payments recorded",
    );
  });

  it("states the outstanding balance of a commissioned project", () => {
    const done = { ...ROW, is_completed: true, current_stage: "plant_commissioning" as const };
    // KSEB fees do not reduce the contract balance.
    expect(
      importedMessage({ ...done, payments: [payment(100000), payment(4540, "kseb_fees")] }),
    ).toMatch(/^Commissioned · ₹75,000(\.00)? outstanding · 2 payments recorded$/);
    expect(importedMessage({ ...done, payments: [payment(175000)] })).toBe(
      "Commissioned · paid in full · 1 payment recorded",
    );
  });
});

describe("summarizeImport", () => {
  const csv = [
    "client_name,plant_capacity,total_cost,consumer_number,coordinator_email",
    "Anand Kumar,3kW,195000,1156789012345,",
    "No Capacity,,1000,,",
    "Meera Nair,5kW,310000,1145678054321,",
    '"Joseph ""Jo"" Mathew",2kW,130000,,ghost@bsssolar.test',
  ].join("\n");

  it("merges validation failures and RPC outcomes in sheet order", () => {
    const state = summarizeImport(
      plan(csv),
      outcomes(
        { row_no: 2, status: "imported", message: null },
        {
          row_no: 4,
          status: "skipped",
          message: "Consumer number 1145678054321 already exists (Meera Nair)",
        },
        {
          row_no: 5,
          status: "failed",
          message: 'coordinator_email "ghost@bsssolar.test" is not a coordinator or office account',
        },
      ),
    );
    expect(state.ran).toBe(true);
    expect(state.counts).toEqual({ imported: 1, skipped: 1, failed: 2 });
    expect(state.results.map((r) => [r.row, r.status])).toEqual([
      [2, "imported"],
      [3, "failed"],
      [4, "skipped"],
      [5, "failed"],
    ]);
    expect(state.results[0].message).toBe("Imported at Site Feasibility Survey");
    expect(state.results[1].message).toMatch(/plant_capacity is required/);
    expect(state.results[2].message).toMatch(/already exists/);
    expect(state.results[3]).toMatchObject({ client: 'Joseph "Jo" Mathew' });
  });

  it("treats an unknown RPC status as a failure", () => {
    const state = summarizeImport(
      plan("client_name,plant_capacity,total_cost\nA,3kW,1"),
      outcomes({ row_no: 2, status: "weird", message: null }),
    );
    expect(state.results[0]).toMatchObject({ status: "failed", message: "Not imported" });
  });

  it("explains valid rows that were never sent", () => {
    const state = summarizeImport(
      plan("client_name,plant_capacity,total_cost\nA,3kW,1\nB,3kW,1"),
      outcomes({ row_no: 2, status: "imported", message: null }),
      { notRunReason: "Not imported — the import stopped early", error: "Stopped" },
    );
    expect(state.results[1]).toMatchObject({
      status: "failed",
      message: "Not imported — the import stopped early",
    });
    expect(state.error).toBe("Stopped");
  });

  describe("retryCsv", () => {
    it("is null when every row went in", () => {
      const state = summarizeImport(
        plan("client_name,plant_capacity,total_cost\nA,3kW,1"),
        outcomes({ row_no: 2, status: "imported", message: null }),
      );
      expect(state.retryCsv).toBeNull();
    });

    it("holds the skipped and failed rows as uploaded plus the reason", () => {
      const state = summarizeImport(
        plan(csv),
        outcomes(
          { row_no: 2, status: "imported", message: null },
          { row_no: 4, status: "skipped", message: "Consumer number exists" },
          { row_no: 5, status: "failed", message: "Unknown coordinator" },
        ),
      );
      const rows = rowsOf(state.retryCsv);
      expect(rows[0]).toEqual([
        "client_name",
        "plant_capacity",
        "total_cost",
        "consumer_number",
        "coordinator_email",
        "import_error",
      ]);
      expect(rows.slice(1).map((r) => [r[0], r[5]])).toEqual([
        ["No Capacity", "plant_capacity is required"],
        ["Meera Nair", "Consumer number exists"],
        ['Joseph "Jo" Mathew', "Unknown coordinator"],
      ]);
    });

    it("holds a row with values past the last column, those values in the reason", () => {
      const state = summarizeImport(
        plan(
          [
            "client_name,plant_capacity,total_cost,address",
            "Anand Kumar,3kW,195000,Vytilla, Kochi",
            "Meera Nair,5kW,310000,Kowdiar",
          ].join("\n"),
        ),
        outcomes({ row_no: 3, status: "imported", message: null }),
      );
      expect(state.counts).toEqual({ imported: 1, skipped: 0, failed: 1 });
      expect(rowsOf(state.retryCsv)).toEqual([
        ["client_name", "plant_capacity", "total_cost", "address", "import_error"],
        [
          "Anand Kumar",
          "3kW",
          "195000",
          "Vytilla",
          'Row has 5 cells but the header has 4 — put values that contain commas in double quotes (past the last column: "Kochi")',
        ],
      ]);
    });

    it("re-uploads as is: the import_error column is ignored, not replaced twice", () => {
      const first = summarizeImport(plan(csv), outcomes());
      const again = plan(first.retryCsv ?? "");
      expect(validateImportHeaders(rowsOf(first.retryCsv)[0]).ok).toBe(true);
      const second = summarizeImport(again, outcomes());
      const header = rowsOf(second.retryCsv)[0];
      expect(header.filter((h) => h === "import_error")).toHaveLength(1);
    });
  });
});
