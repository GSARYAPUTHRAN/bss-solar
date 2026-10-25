import { describe, it, expect } from "vitest";
import { parseCsv } from "@/lib/csv";
import { CoordinatorDirectory } from "./coordinator-match";
import { planImport, validateImportHeaders, type ImportPlan, type ImportRow } from "./import";
import {
  IMPORT_COUNT_STATUSES,
  IMPORT_INITIAL,
  chunk,
  checkedState,
  importError,
  importedMessage,
  isImportRowStatus,
  isOutcomeStatus,
  readyMessage,
  summarizeImport,
  type ImportOutcome,
} from "./import-results";

const TODAY = "2026-10-10";

const RAHUL = { id: "id-rahul", fullName: "Rahul Menon", email: "coord@bsssolar.test", role: "coordinator" as const };
const PRIYA = { id: "id-priya", fullName: "Priya Suresh", email: "priya@bsssolar.test", role: "coordinator" as const };
const DIRECTORY = new CoordinatorDirectory([RAHUL, PRIYA]);

const ROW: ImportRow = {
  row_no: 2,
  client_name: "Anand Kumar",
  client_phone: null,
  address: null,
  plan_type: "solar",
  plant_capacity: "3kW",
  total_cost: 195000,
  advance_amount: 20000,
  order_date: "2026-06-15",
  coordinator_ids: [RAHUL.id],
  financing_type: "self",
  loan_bank_name: null,
  consumer_number: null,
  kseb_section: null,
  notes: null,
  current_stage: "material_dispatch",
  is_completed: false,
  commissioned_on: null,
  feasibility_date: null,
  incentives: [],
  cancellation: null,
  cancelled_on: null,
  cancellation_remarks: null,
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

function plan(csv: string, defaultCoordinatorId: string | null = null): ImportPlan {
  const res = planImport(csv, { today: TODAY, directory: DIRECTORY, defaultCoordinatorId });
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

describe("row statuses", () => {
  it("knows the four a result can show", () => {
    expect(["ready", "imported", "skipped", "failed", "ok"].map(isImportRowStatus)).toEqual([
      true,
      true,
      true,
      true,
      false,
    ]);
  });

  it("takes only the three the RPC reports from an outcome — never 'ready'", () => {
    expect(["imported", "skipped", "failed", "ready", "ok"].map(isOutcomeStatus)).toEqual([
      true,
      true,
      true,
      false,
      false,
    ]);
  });

  it("shows Ready and Failed for a check, never Imported or Skipped", () => {
    expect(IMPORT_COUNT_STATUSES.check).toEqual(["ready", "failed"]);
    expect(IMPORT_COUNT_STATUSES.import).toEqual(["imported", "skipped", "failed"]);
  });
});

describe("importError", () => {
  it("marks the run as done with no rows", () => {
    expect(importError("nope")).toEqual({ ...IMPORT_INITIAL, ran: true, error: "nope" });
    expect(importError("nope", "check").mode).toBe("check");
  });
});

describe("importedMessage", () => {
  const rahul = ["Rahul Menon"];

  it("names the stage reached, the payments recorded and the coordinator", () => {
    expect(importedMessage(ROW, rahul, false)).toBe(
      "Imported at Material Dispatch (Panels & Structure) · Rahul Menon",
    );
    expect(importedMessage({ ...ROW, payments: [payment(1000), payment(500)] }, rahul, false)).toBe(
      "Imported at Material Dispatch (Panels & Structure) · 2 payments recorded · Rahul Menon",
    );
  });

  it("states the outstanding balance of a commissioned project", () => {
    const done = { ...ROW, is_completed: true, current_stage: "plant_commissioning" as const };
    // KSEB fees do not reduce the contract balance.
    expect(
      importedMessage({ ...done, payments: [payment(100000), payment(4540, "kseb_fees")] }, rahul, false),
    ).toMatch(/^Commissioned · ₹75,000(\.00)? outstanding · 2 payments recorded · Rahul Menon$/);
    expect(importedMessage({ ...done, payments: [payment(175000)] }, rahul, false)).toBe(
      "Commissioned · paid in full · 1 payment recorded · Rahul Menon",
    );
  });

  it("names every coordinator of a shared sale, and the default one as such", () => {
    expect(importedMessage(ROW, ["Abhijith Nair", "Ravi Kumar"], false)).toBe(
      "Imported at Material Dispatch (Panels & Structure) · Abhijith Nair & Ravi Kumar",
    );
    expect(importedMessage(ROW, rahul, true)).toBe(
      "Imported at Material Dispatch (Panels & Structure) · Rahul Menon (default coordinator)",
    );
  });

  it("calls a finished custom plan handed over, with what was sold", () => {
    const custom = {
      ...ROW,
      plan_type: "custom" as const,
      plant_capacity: "Inverter + panel",
      total_cost: 23500,
      advance_amount: 0,
      is_completed: true,
      current_stage: "plant_commissioning" as const,
      payments: [payment(23500)],
    };
    expect(importedMessage(custom, rahul, false)).toBe(
      'Handed over · paid in full · Custom plan "Inverter + panel" · 1 payment recorded · Rahul Menon',
    );
  });

  it("calls an open custom plan by its only step", () => {
    const open = {
      ...ROW,
      plan_type: "custom" as const,
      plant_capacity: "1 panel",
      current_stage: "plant_commissioning" as const,
    };
    expect(importedMessage(open, rahul, false)).toBe(
      'Imported at Handover · Custom plan "1 panel" · Rahul Menon',
    );
  });

  it("says Refunded or Cancelled, and does not claim a balance is outstanding", () => {
    const refunded = { ...ROW, cancellation: "refunded" as const, payments: [payment(10000)] };
    expect(importedMessage(refunded, rahul, false)).toBe(
      "Imported at Material Dispatch (Panels & Structure) · Refunded · 1 payment recorded · Rahul Menon",
    );
    const done = {
      ...ROW,
      cancellation: "cancelled" as const,
      is_completed: true,
      current_stage: "plant_commissioning" as const,
    };
    expect(importedMessage(done, rahul, false)).toBe("Commissioned · Cancelled · Rahul Menon");
  });
});

describe("readyMessage", () => {
  it("says what the row would become, before anything is written", () => {
    expect(
      readyMessage({ ...ROW, payments: [payment(1000)] }, ["Rahul Menon"], false),
    ).toBe("Ready · At Material Dispatch (Panels & Structure) · 1 payment to record · Rahul Menon");
    expect(readyMessage(ROW, ["Priya Suresh"], true)).toMatch(
      / · Priya Suresh \(default coordinator\)$/,
    );
  });
});

describe("summarizeImport", () => {
  const csv = [
    "client_name,plant_capacity,total_cost,consumer_number,coordinator",
    "Anand Kumar,3kW,195000,1156789012345,Rahul",
    "No Capacity,,1000,,Rahul",
    "Meera Nair,5kW,310000,1145678054321,Priya",
    '"Joseph ""Jo"" Mathew",2kW,130000,,Rahul',
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
          message: "Not a coordinator or office account: someone",
        },
      ),
    );
    expect(state.ran).toBe(true);
    expect(state.mode).toBe("import");
    expect(state.counts).toEqual({ ready: 0, imported: 1, skipped: 1, failed: 2 });
    expect(state.results.map((r) => [r.row, r.status])).toEqual([
      [2, "imported"],
      [3, "failed"],
      [4, "skipped"],
      [5, "failed"],
    ]);
    expect(state.results[0].message).toBe(
      "Imported at Site Feasibility Survey · Rahul Menon",
    );
    expect(state.results[1].message).toMatch(/plant_capacity is required/);
    expect(state.results[2].message).toMatch(/already exists/);
    expect(state.results[3]).toMatchObject({ client: 'Joseph "Jo" Mathew' });
  });

  it("names a row's coordinators, and marks one that took the default", () => {
    const state = summarizeImport(
      plan(
        [
          "client_name,plant_capacity,total_cost,coordinator",
          "A,3kW,1,Rahul & Priya",
          "B,3kW,1,",
        ].join("\n"),
        PRIYA.id,
      ),
      outcomes(
        { row_no: 2, status: "imported", message: null },
        { row_no: 3, status: "imported", message: null },
      ),
    );
    expect(state.results.map((r) => r.message)).toEqual([
      "Imported at Site Feasibility Survey · Rahul Menon & Priya Suresh",
      "Imported at Site Feasibility Survey · Priya Suresh (default coordinator)",
    ]);
  });

  it("carries the coordinator matches and the file warnings of the plan", () => {
    const planned = plan(csv);
    const state = summarizeImport(planned, outcomes());
    expect(state.coordinatorMatches).toBe(planned.coordinatorMatches);
    expect(state.warnings).toBe(planned.warnings);
    expect(state.warnings[0]).toMatch(/consumer_number/);
  });

  it("shows a row's own warnings under an imported row only", () => {
    const state = summarizeImport(
      plan("client_name,plant_capacity,total_cost,coordinator\nA,3kW,1,Rahul"),
      outcomes({ row_no: 2, status: "imported", message: null }),
    );
    expect(state.results[0].warnings).toEqual([`order_date is blank — today (${TODAY}) will be used`]);
    const skipped = summarizeImport(
      plan("client_name,plant_capacity,total_cost,coordinator\nA,3kW,1,Rahul"),
      outcomes({ row_no: 2, status: "skipped", message: "exists" }),
    );
    expect(skipped.results[0].warnings).toEqual([]);
  });

  it("treats an unknown RPC status — 'ready' included — as a failure", () => {
    for (const status of ["weird", "ready"]) {
      const state = summarizeImport(
        plan("client_name,plant_capacity,total_cost,coordinator\nA,3kW,1,Rahul"),
        outcomes({ row_no: 2, status, message: null }),
      );
      expect(state.results[0]).toMatchObject({ status: "failed", message: "Not imported" });
    }
  });

  it("explains valid rows that were never sent", () => {
    const state = summarizeImport(
      plan("client_name,plant_capacity,total_cost,coordinator\nA,3kW,1,Rahul\nB,3kW,1,Rahul"),
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
        plan("client_name,plant_capacity,total_cost,coordinator\nA,3kW,1,Rahul"),
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
        "coordinator",
        "import_error",
      ]);
      expect(rows.slice(1).map((r) => [r[0], r[5]])).toEqual([
        ["No Capacity", "plant_capacity is required"],
        ["Meera Nair", "Consumer number exists"],
        ['Joseph "Jo" Mathew', "Unknown coordinator"],
      ]);
    });

    it("keeps the headers and cells the sheet had, old column name included", () => {
      const state = summarizeImport(
        plan(
          [
            "client_name,plant_capacity,total_cost,coordinator_email",
            "Anand Kumar,3kW,195000,Abhijit",
          ].join("\n"),
        ),
        outcomes(),
      );
      const rows = rowsOf(state.retryCsv);
      expect(rows[0]).toEqual([
        "client_name",
        "plant_capacity",
        "total_cost",
        "coordinator_email",
        "import_error",
      ]);
      expect(rows[1].slice(0, 4)).toEqual(["Anand Kumar", "3kW", "195000", "Abhijit"]);
      expect(rows[1][4]).toMatch(/^coordinator_email "Abhijit" is not a coordinator/);
    });

    it("holds a row with values past the last column, those values in the reason", () => {
      const state = summarizeImport(
        plan(
          [
            "client_name,plant_capacity,total_cost,address,coordinator",
            "Anand Kumar,3kW,195000,Vytilla, Kochi,Rahul",
            "Meera Nair,5kW,310000,Kowdiar,Rahul",
          ].join("\n"),
        ),
        outcomes({ row_no: 3, status: "imported", message: null }),
      );
      expect(state.counts).toEqual({ ready: 0, imported: 1, skipped: 0, failed: 1 });
      const rows = rowsOf(state.retryCsv);
      expect(rows[0]).toEqual([
        "client_name",
        "plant_capacity",
        "total_cost",
        "address",
        "coordinator",
        "import_error",
      ]);
      expect(rows[1].slice(0, 5)).toEqual(["Anand Kumar", "3kW", "195000", "Vytilla", "Kochi"]);
      expect(rows[1][5]).toMatch(
        /^Row has 6 cells but the header has 5 .* \(past the last column: "Rahul"\); /,
      );
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

describe("checkedState", () => {
  const csv = [
    "client_name,plant_capacity,total_cost,consumer_number,coordinator",
    "Anand Kumar,3kW,195000,1156789012345,Rahul",
    "No Capacity,,1000,,Rahul",
    "Meera Nair,5kW,310000,1145678054321,Abhijit",
    "Joseph Mathew,2kW,130000,,Rahul & Priya",
  ].join("\n");

  it("reports ready and failed rows in sheet order, importing nothing", () => {
    const state = checkedState(plan(csv));
    expect(state.ran).toBe(true);
    expect(state.mode).toBe("check");
    expect(state.counts).toEqual({ ready: 2, imported: 0, skipped: 0, failed: 2 });
    expect(state.results.map((r) => [r.row, r.status])).toEqual([
      [2, "ready"],
      [3, "failed"],
      [4, "failed"],
      [5, "ready"],
    ]);
    expect(state.results[0].message).toBe(
      "Ready · At Site Feasibility Survey · Rahul Menon",
    );
    expect(state.results[3].message).toBe(
      "Ready · At Site Feasibility Survey · Rahul Menon & Priya Suresh",
    );
    expect(state.results[2].message).toMatch(/^coordinator "Abhijit" is not a coordinator or office account/);
  });

  it("downloads only the failed rows — a ready row is not something to fix", () => {
    const rows = rowsOf(checkedState(plan(csv)).retryCsv);
    expect(rows.slice(1).map((r) => r[0])).toEqual(["No Capacity", "Meera Nair"]);
  });

  it("numbers rows by the sheet's lines, blank ones counted, in a check and in an import", () => {
    const spaced = [
      "client_name,plant_capacity,total_cost,coordinator",
      "",
      "Anand Kumar,3kW,195000,Rahul",
      ",,,",
      "No Capacity,,1000,Rahul",
    ].join("\n");
    const planned = plan(spaced);

    const checked = checkedState(planned);
    expect(checked.results.map((r) => [r.row, r.client, r.status])).toEqual([
      [3, "Anand Kumar", "ready"],
      [5, "No Capacity", "failed"],
    ]);
    expect(rowsOf(checked.retryCsv).slice(1).map((r) => r[0])).toEqual(["No Capacity"]);

    // The row number the RPC is sent is the one its outcome comes back under.
    const sent = planned.rows.flatMap((r) => (r.parsed.ok ? [r.parsed.data.row_no] : []));
    expect(sent).toEqual([3]);
    const imported = summarizeImport(planned, outcomes({ row_no: 3, status: "imported", message: null }));
    expect(imported.results.map((r) => [r.row, r.status])).toEqual([
      [3, "imported"],
      [5, "failed"],
    ]);
  });

  it("has no download when every row is ready", () => {
    const state = checkedState(plan("client_name,plant_capacity,total_cost,coordinator\nA,3kW,1,Rahul"));
    expect(state.retryCsv).toBeNull();
    expect(state.counts.failed).toBe(0);
  });

  it("carries the matches, the file warnings and the row warnings", () => {
    const planned = plan(csv);
    const state = checkedState(planned);
    expect(state.coordinatorMatches).toBe(planned.coordinatorMatches);
    expect(state.warnings).toBe(planned.warnings);
    expect(state.results[0].warnings).toEqual([`order_date is blank — today (${TODAY}) will be used`]);
    // The problem entry (Abhijit) comes before the resolved ones.
    expect(state.coordinatorMatches[0]).toMatchObject({ written: "Abhijit", account: null });
  });

  it("remembers whether existing consumer numbers will be skipped", () => {
    expect(checkedState(plan(csv)).skipExisting).toBe(true);
    expect(checkedState(plan(csv), { skipExisting: false }).skipExisting).toBe(false);
  });
});
