import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DirectoryAccount } from "@/lib/domain/coordinator-match";
import {
  duplicateMessage,
  importedAgainWarning,
  type ExistingSale,
} from "@/lib/domain/import-duplicates";
import { IMPORT_INITIAL } from "@/lib/domain/import-results";
import { todayISO } from "@/lib/format";
import type { Profile } from "@/lib/types";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireAdmin: vi.fn() }));
vi.mock("@/server/data/imports.repository", () => ({
  importsRepository: { directory: vi.fn(), existingSales: vi.fn(), run: vi.fn() },
}));

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { importsRepository } from "@/server/data/imports.repository";
import { importProjects } from "./actions";

const repo = vi.mocked(importsRepository);

const ADMIN_ID = "00000000-0000-4000-8000-0000000000a1";
const ADMIN = { id: ADMIN_ID, role: "admin", full_name: "BSS Admin" } as Profile;

const account = (id: number, fullName: string, email: string, role: DirectoryAccount["role"] = "coordinator") =>
  ({ id: `00000000-0000-4000-8000-${String(id).padStart(12, "0")}`, fullName, email, role }) satisfies DirectoryAccount;
const RAHUL = account(1, "Rahul Menon", "coord@bsssolar.test");
const PRIYA = account(2, "Priya Suresh", "priya@bsssolar.test");
const ENGINEER = account(3, "Anil Kumar", "engineer@bsssolar.test", "service_engineer");

const HEADER = "client_name,plant_capacity,total_cost,order_date,coordinator";
const GOOD = `${HEADER}\nAnand Kumar,3kW,195000,2025-01-10,Rahul`;

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

const post = (fields: Record<string, string>) =>
  importProjects(IMPORT_INITIAL, form({ default_coordinator_id: "none", skip_existing: "true", ...fields }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAdmin).mockResolvedValue(ADMIN);
  repo.directory.mockResolvedValue({ accounts: [RAHUL, PRIYA, ENGINEER], error: null });
  repo.existingSales.mockResolvedValue({ sales: [], error: null });
  repo.run.mockImplementation(async (batch) => ({
    outcomes: batch.map((r) => ({ row_no: r.row_no, status: "imported", message: null })),
    failure: null,
  }));
});

describe("importProjects — what the request asks for", () => {
  it.each([
    ["missing", {}],
    ["blank", { intent: "" }],
    ["unknown", { intent: "delete" }],
    ["upper case", { intent: "IMPORT" }],
  ])("never imports when the intent is %s", async (_label, extra) => {
    const state = await post({ csv: GOOD, ...extra });

    expect(state.error).toBe("Choose Check file or Import projects.");
    expect(state.results).toEqual([]);
    expect(repo.run).not.toHaveBeenCalled();
    expect(repo.directory).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("takes an intent that is a file upload for no intent at all", async () => {
    const fd = form({ csv: GOOD });
    fd.set("intent", new File(["import"], "import.txt"));
    const state = await importProjects(IMPORT_INITIAL, fd);
    expect(state.error).toBe("Choose Check file or Import projects.");
    expect(repo.run).not.toHaveBeenCalled();
  });

  it("is for office staff only: nothing runs when the sign-in check refuses", async () => {
    vi.mocked(requireAdmin).mockRejectedValue(new Error("REDIRECT:/"));
    await expect(post({ csv: GOOD, intent: "import" })).rejects.toThrow("REDIRECT:/");
    expect(repo.directory).not.toHaveBeenCalled();
    expect(repo.run).not.toHaveBeenCalled();
  });
});

describe("importProjects — Check file", () => {
  it("validates every row and never calls the import RPC", async () => {
    const state = await post({
      csv: `${GOOD}\nBroken,,1,2025-01-10,Rahul\nTypo,3kW,1,2025-01-10,Rahull`,
      intent: "check",
    });

    expect(repo.run).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
    expect(state.mode).toBe("check");
    expect(state.counts).toEqual({ ready: 1, duplicate: 0, imported: 0, skipped: 0, failed: 2 });
    expect(state.results.map((r) => r.status)).toEqual(["ready", "failed", "failed"]);
    expect(state.results[0].message).toBe("Ready · At Site Feasibility Survey · Rahul Menon");
    expect(state.results[2].message).toMatch(
      /did you mean Rahul Menon \(coord@bsssolar.test\)\?/,
    );
  });

  it("shows who each name became and what is worth a look", async () => {
    const state = await post({ csv: `${GOOD}\nB,3kW,5,2025-01-10,Rahull`, intent: "check" });
    expect(state.coordinatorMatches.map((m) => [m.written, m.account?.fullName ?? null])).toEqual([
      ["Rahull", null],
      ["Rahul", "Rahul Menon"],
    ]);
    expect(state.warnings[0]).toMatch(/^1 row has no consumer_number/);
  });

  describe("a consumer number repeated in the file", () => {
    const REPEATED = `client_name,plant_capacity,total_cost,order_date,coordinator,consumer_number\nA,3kW,1,2025-01-10,Rahul,NA\n\nB,3kW,2,2025-01-10,Rahul,NA`;

    it("is predicted, because the import will skip every row after the first", async () => {
      const state = await post({ csv: REPEATED, intent: "check", skip_existing: "true" });
      expect(state.counts).toMatchObject({ ready: 2, failed: 0 });
      expect(state.warnings).toEqual([
        expect.stringMatching(
          /^Rows 2 and 4 share consumer number NA — only the first \(row 2\) will be imported; the other is skipped\./,
        ),
      ]);
      expect(repo.run).not.toHaveBeenCalled();
    });

    it("is not predicted when the form says not to skip, and a request that omits it skips", async () => {
      const off = await post({ csv: REPEATED, intent: "check", skip_existing: "false" });
      expect(off.warnings).toEqual([]);
      const omitted = importProjects(
        IMPORT_INITIAL,
        form({ default_coordinator_id: "none", csv: REPEATED, intent: "check" }),
      );
      expect((await omitted).warnings).toHaveLength(1);
    });
  });

  it("reports the file-level problems of a check as an error, still without importing", async () => {
    const state = await post({ csv: "client_name,foo\nA,B", intent: "check" });
    expect(state.error).toMatch(/header row needs fixing/);
    expect(state.mode).toBe("check");
    expect(repo.run).not.toHaveBeenCalled();
  });
});

describe("importProjects — Import projects", () => {
  it("sends the valid rows with their resolved coordinators and reports them by name", async () => {
    const state = await post({
      csv: `${HEADER}\nA,3kW,1,2025-01-10,Rahul & Priya\nB,,1,2025-01-10,Rahul`,
      intent: "import",
    });

    expect(repo.run).toHaveBeenCalledTimes(1);
    const [batch, defaultCoordinator, skipExisting] = repo.run.mock.calls[0];
    expect(batch.map((r) => [r.row_no, r.coordinator_ids])).toEqual([[2, [RAHUL.id, PRIYA.id]]]);
    // No default chosen: the RPC's own default is the admin running the import.
    expect(defaultCoordinator).toBe(ADMIN_ID);
    expect(skipExisting).toBe(true);

    expect(state.mode).toBe("import");
    expect(state.counts).toEqual({ ready: 0, duplicate: 0, imported: 1, skipped: 0, failed: 1 });
    expect(state.results[0].message).toBe(
      "Imported at Site Feasibility Survey · Rahul Menon & Priya Suresh",
    );
    expect(revalidatePath).toHaveBeenCalledWith("/projects");
    expect(revalidatePath).toHaveBeenCalledWith("/work-orders");
    expect(revalidatePath).toHaveBeenCalledWith("/");
  });

  it("does not refresh the lists when nothing went in", async () => {
    const state = await post({ csv: `${HEADER}\nA,,1,2025-01-10,Rahul`, intent: "import" });
    expect(state.counts.imported).toBe(0);
    expect(repo.run).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("passes skip-existing through, and turns it off only when told to", async () => {
    await post({ csv: GOOD, intent: "import", skip_existing: "false" });
    expect(repo.run.mock.calls[0][2]).toBe(false);
    await post({ csv: GOOD, intent: "import", skip_existing: "maybe" });
    expect(repo.run.mock.calls[1][2]).toBe(true);
  });

  it("reports the RPC's skipped and failed rows beside the validation failures", async () => {
    repo.run.mockResolvedValue({
      outcomes: [
        { row_no: 2, status: "skipped", message: "Consumer number 1 already exists (Someone)" },
        { row_no: 3, status: "failed", message: "A coordinator is listed twice" },
      ],
      failure: null,
    });
    const state = await post({
      csv: `${HEADER}\nA,3kW,1,2025-01-10,Rahul\nB,3kW,1,2025-01-10,Priya\nC,,1,2025-01-10,Rahul`,
      intent: "import",
    });
    expect(state.counts).toEqual({ ready: 0, duplicate: 0, imported: 0, skipped: 1, failed: 2 });
    expect(state.retryCsv).toContain("import_error");
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("sends 200 rows to the database at a time, in order", async () => {
    const rows = Array.from({ length: 450 }, (_, i) => `C${i},3kW,1,2025-01-10,Rahul`);
    const state = await post({ csv: [HEADER, ...rows].join("\n"), intent: "import" });
    expect(repo.run.mock.calls.map(([batch]) => batch.length)).toEqual([200, 200, 50]);
    expect(state.counts.imported).toBe(450);
  });

  it("says nothing was imported when the first batch is refused", async () => {
    repo.run.mockResolvedValue({
      outcomes: [],
      failure: { code: "42501", message: "Only office staff can import projects" },
    });
    const state = await post({ csv: GOOD, intent: "import" });
    expect(state.error).toBe("Nothing was imported. Only office staff can import projects.");
    expect(state.results[0]).toMatchObject({
      status: "failed",
      message: expect.stringMatching(/^Not imported — the import stopped before this row/),
    });
  });

  it("stops after the batch that failed and says which rows were processed", async () => {
    const rows = Array.from({ length: 250 }, (_, i) => `C${i},3kW,1,2025-01-10,Rahul`);
    repo.run
      .mockImplementationOnce(async (batch) => ({
        outcomes: batch.map((r) => ({ row_no: r.row_no, status: "imported", message: null })),
        failure: null,
      }))
      .mockResolvedValueOnce({ outcomes: [], failure: { code: "57014", message: "timeout" } });
    const state = await post({ csv: [HEADER, ...rows].join("\n"), intent: "import" });
    expect(repo.run).toHaveBeenCalledTimes(2);
    expect(state.counts).toMatchObject({ imported: 200, failed: 50 });
    expect(state.error).toBe(
      "The import stopped at row 202. The database took too long. Upload the remaining rows in a smaller file. Earlier rows were processed; download the rows that did not go in to retry them.",
    );
  });

  it.each([
    [undefined, /^Nothing was imported\. The connection to the database failed/],
    ["", /^Nothing was imported\. The connection to the database failed/],
    ["22023", /^Nothing was imported\. p_rows must be a JSON array\./],
    ["XX000", /^Nothing was imported\. The database could not run the import \(p_rows must be a JSON array\)\./],
  ])("words an RPC refusal with code %j for the office", async (code, expected) => {
    repo.run.mockResolvedValue({
      outcomes: [],
      failure: { code, message: "p_rows must be a JSON array" },
    });
    const state = await post({ csv: GOOD, intent: "import" });
    expect(state.error).toMatch(expected);
  });
});

describe("importProjects — the default coordinator", () => {
  const BLANK = `${HEADER}\nA,3kW,1,2025-01-10,`;

  it('"none" means no default: a blank coordinator cell fails the row', async () => {
    const state = await post({ csv: BLANK, intent: "import", default_coordinator_id: "none" });
    expect(repo.run).not.toHaveBeenCalled();
    expect(state.results[0].message).toMatch(/^coordinator is blank and no default coordinator/);
  });

  it("a missing or blank field is also no default", async () => {
    const absent: Record<string, string>[] = [{}, { default_coordinator_id: "" }];
    for (const fields of absent) {
      const fd = form({ csv: BLANK, intent: "check", ...fields });
      const state = await importProjects(IMPORT_INITIAL, fd);
      expect(state.counts.failed).toBe(1);
    }
  });

  it("a chosen default fills the blank cells, and is the RPC's default too", async () => {
    const state = await post({ csv: BLANK, intent: "import", default_coordinator_id: PRIYA.id });
    expect(repo.run).toHaveBeenCalledTimes(1);
    expect(repo.run.mock.calls[0][0][0].coordinator_ids).toEqual([PRIYA.id]);
    expect(repo.run.mock.calls[0][1]).toBe(PRIYA.id);
    expect(state.results[0].message).toBe(
      "Imported at Site Feasibility Survey · Priya Suresh (default coordinator)",
    );
  });

  it("is shown against the blank cells in a check", async () => {
    const state = await post({ csv: BLANK, intent: "check", default_coordinator_id: PRIYA.id });
    expect(state.coordinatorMatches).toEqual([
      { written: "", account: PRIYA, problem: null, rows: [2] },
    ]);
  });

  it("must be an account id", async () => {
    const state = await post({ csv: BLANK, intent: "import", default_coordinator_id: "everyone" });
    expect(state.error).toBe("Select a default coordinator.");
    expect(repo.directory).not.toHaveBeenCalled();
    expect(repo.run).not.toHaveBeenCalled();
  });

  it("must be someone who can own a sale — a service engineer cannot", async () => {
    const state = await post({ csv: GOOD, intent: "import", default_coordinator_id: ENGINEER.id });
    expect(state.error).toBe("Select a default coordinator who is a coordinator or office account.");
    expect(repo.run).not.toHaveBeenCalled();
  });
});

describe("importProjects — the team's accounts", () => {
  it("stops, writing nothing, when they cannot be read", async () => {
    repo.directory.mockResolvedValue({ accounts: [], error: "boom" });
    for (const intent of ["check", "import"]) {
      const state = await post({ csv: GOOD, intent });
      expect(state.error).toBe("Could not read the team's accounts — please try again.");
      expect(state.mode).toBe(intent);
    }
    expect(repo.run).not.toHaveBeenCalled();
  });
});

describe("importProjects — the row the database is sent (import_projects v4)", () => {
  const COLUMNS = [
    "client_name",
    "plant_capacity",
    "total_cost",
    "advance_amount",
    "advance_method",
    "advance_date",
    "order_date",
    "coordinator",
    "incentive_1_coordinator",
    "incentive_1_amount",
    "incentive_1_date",
    "incentive_2_coordinator",
    "incentive_2_amount",
    "incentive_2_date",
    "payment_1_amount",
    "payment_1_date",
    "payment_1_purpose",
    "payment_1_reference",
    "payment_1_paid_by_office",
    "payment_2_amount",
    "payment_2_date",
    "payment_2_purpose",
    "payment_2_reference",
  ];
  const SHEET = [
    COLUMNS.join(","),
    [
      "Mohan Das",
      "3kW+2kW",
      "250000",
      "50000",
      "UPI",
      "04-02-25",
      "04/02/2025",
      "Rahul & Priya",
      "Rahul",
      "20000",
      "15/05/2025",
      "Priya",
      "15000",
      "",
      "4540",
      "20/03/2025",
      "kseb_fees",
      "KSEB fee",
      "yes",
      "800",
      "21/03/2025",
      "write_off",
      "Short by 800",
    ].join(","),
  ].join("\n");

  it("sends the advance, the incentives with their instalments and the ledger lines as the RPC reads them", async () => {
    const state = await post({ csv: SHEET, intent: "import" });
    expect(state.counts.imported).toBe(1);

    const [row] = repo.run.mock.calls[0][0];
    expect(row).toMatchObject({
      row_no: 2,
      plant_capacity: "5kW",
      advance_amount: 50000,
      advance_method: "upi",
      advance_paid_on: "2025-02-04",
      advance_reference: null,
      order_date: "2025-02-04",
    });
    expect(row.incentives).toEqual([
      {
        coordinator_id: RAHUL.id,
        amount: 20000,
        payments: [{ amount: 20000, paid_on: "2025-05-15", note: null }],
      },
      { coordinator_id: PRIYA.id, amount: 15000, payments: [] },
    ]);
    expect(row.payments).toEqual([
      {
        amount: 4540,
        paid_on: "2025-03-20",
        method: "other",
        purpose: "kseb_fees",
        paid_by_office: true,
        reference: "KSEB fee",
        notes: null,
      },
      {
        amount: 800,
        paid_on: "2025-03-21",
        method: "other",
        purpose: "write_off",
        paid_by_office: false,
        reference: null,
        notes: "Short by 800",
      },
    ]);
  });

  it("sends nothing the RPC would read as the previous build's shape", async () => {
    await post({ csv: SHEET, intent: "import" });
    const [row] = repo.run.mock.calls[0][0];
    // A v3 incentive was {coordinator_id, amount, paid_on}: a paid_on beside payments would be counted twice.
    for (const incentive of row.incentives) expect(incentive).not.toHaveProperty("paid_on");
    expect(row).not.toHaveProperty("coordinator_incentive");
    expect(row).not.toHaveProperty("incentive_paid_on");
  });

  it("tells the office how the dates were read, in a check and in an import", async () => {
    for (const intent of ["check", "import"]) {
      const state = await post({ csv: SHEET, intent });
      expect(state.notes).toEqual([
        expect.stringMatching(/^\d+ date cells were written day first \(in 1 row\) and read that way/),
      ]);
    }
  });

  it("never sends a template example, and says to delete it", async () => {
    const csv = [
      "client_name,plant_capacity,total_cost,order_date,coordinator,consumer_number",
      "Anand Kumar,3kW,195000,2026-06-15,Rahul,1156789012345",
      "Real Customer,3kW,195000,2025-01-10,Rahul,",
    ].join("\n");
    const state = await post({ csv, intent: "import" });
    expect(repo.run.mock.calls[0][0].map((r) => r.client_name)).toEqual(["Real Customer"]);
    expect(state.results[0]).toMatchObject({
      status: "failed",
      message: "this is one of the template's example rows — delete it",
    });
    expect(state.retryCsv).toContain("Anand Kumar");
  });
});

describe("importProjects — sales already in the system", () => {
  /** In the system: R.Vijayakumar booked on 10 Jan 2025, added on 8 Nov 2026 (IST). */
  const VIJAYAKUMAR: ExistingSale = {
    id: "wo-1",
    clientName: "R.Vijayakumar",
    orderDate: "2025-01-10",
    createdAt: "2026-11-08T05:00:00Z",
    coordinatorNames: ["Rahul Menon"],
    totalCost: 195000,
  };
  // Row 2 is the same sale written another way; row 3 is new; row 4 fails validation.
  const SHEET = [
    HEADER,
    "Vijayakumar R,3kW,195000,2025-01-10,Rahul",
    "Meera Nair,3kW,195000,2025-01-10,Rahul",
    "Broken,,1,2025-01-11,Rahul",
  ].join("\n");

  beforeEach(() => {
    repo.existingSales.mockResolvedValue({ sales: [VIJAYAKUMAR], error: null });
  });

  it("reads the sales once, and not at all when no row is valid", async () => {
    await post({ csv: SHEET, intent: "check" });
    expect(repo.existingSales).toHaveBeenCalledTimes(1);
    await post({ csv: `${HEADER}\nBroken,,1,2025-01-11,Rahul`, intent: "check" });
    expect(repo.existingSales).toHaveBeenCalledTimes(1);
  });

  describe("a row with no order date", () => {
    // The same sheet as the one that went in on 8 Nov, whose order_date cell was blank then too.
    const UNDATED = `${HEADER}\nVijayakumar R,3kW,195000,,Rahul\nMeera Nair,3kW,195000,,Rahul`;
    const BY_NAME = { ...VIJAYAKUMAR, byNameOnly: true };

    it("is matched by the customer's name alone, whatever the sale's order date, and says so", async () => {
      expect(VIJAYAKUMAR.orderDate).not.toBe(todayISO());
      const state = await post({ csv: UNDATED, intent: "check" });
      expect(state.counts).toMatchObject({ ready: 1, duplicate: 1 });
      expect(state.results[0]).toMatchObject({ status: "duplicate", message: duplicateMessage(BY_NAME) });
      expect(state.results[0].message).toMatch(/a sale with this name \(no order date in the sheet to compare\)/);
      expect(state.duplicates).toMatchObject({ count: 1, byNameOnly: 1, valid: 2 });
    });

    it("is skipped as chosen, saying it matched by name", async () => {
      const state = await post({ csv: UNDATED, intent: "import", duplicates: "skip" });
      expect(repo.run.mock.calls[0][0].map((r) => r.client_name)).toEqual(["Meera Nair"]);
      expect(state.results[0]).toMatchObject({ status: "skipped", message: duplicateMessage(BY_NAME) });
    });
  });

  it("does not look anything up for a request that is refused first", async () => {
    await post({ csv: SHEET });
    repo.directory.mockResolvedValue({ accounts: [], error: "boom" });
    await post({ csv: SHEET, intent: "import" });
    expect(repo.existingSales).not.toHaveBeenCalled();
  });

  describe("Check file", () => {
    it("marks them, counts them, and opens the warning — writing nothing", async () => {
      const state = await post({ csv: SHEET, intent: "check" });
      expect(repo.run).not.toHaveBeenCalled();
      expect(state.mode).toBe("check");
      expect(state.counts).toEqual({ ready: 1, duplicate: 1, imported: 0, skipped: 0, failed: 1 });
      expect(state.results[0]).toMatchObject({
        status: "duplicate",
        message: duplicateMessage(VIJAYAKUMAR),
      });
      expect(state.results[0].message).toMatch(/added on 8 Nov 2026/);
      expect(state.duplicates).toEqual({
        kind: "check",
        count: 1,
        byNameOnly: 0,
        valid: 2,
        addedOn: ["2026-11-08"],
        names: ["Vijayakumar R"],
      });
    });

    it("ignores a choice posted with it: a check never writes", async () => {
      const state = await post({ csv: SHEET, intent: "check", duplicates: "include" });
      expect(state.duplicates?.kind).toBe("check");
      expect(repo.run).not.toHaveBeenCalled();
    });

    it("opens no warning when nothing matches", async () => {
      repo.existingSales.mockResolvedValue({ sales: [], error: null });
      const state = await post({ csv: SHEET, intent: "check" });
      expect(state.duplicates).toBeNull();
      expect(state.counts.duplicate).toBe(0);
    });
  });

  describe("Import projects without a choice", () => {
    it.each([
      ["no choice", {}],
      ["a blank choice", { duplicates: "" }],
      ["an unknown choice", { duplicates: "yes" }],
      ["an upper-case choice", { duplicates: "SKIP" }],
    ])("writes NOTHING with %s, and asks", async (_label, extra) => {
      const state = await post({ csv: SHEET, intent: "import", ...extra });
      expect(repo.run).not.toHaveBeenCalled();
      expect(revalidatePath).not.toHaveBeenCalled();
      expect(state.mode).toBe("check");
      expect(state.counts).toMatchObject({ imported: 0, skipped: 0, ready: 1, duplicate: 1, failed: 1 });
      expect(state.duplicates).toEqual({
        kind: "confirm",
        count: 1,
        byNameOnly: 0,
        valid: 2,
        addedOn: ["2026-11-08"],
        names: ["Vijayakumar R"],
      });
      expect(state.error).toBeUndefined();
    });

    it("imports exactly as before when nothing matches — no choice needed", async () => {
      repo.existingSales.mockResolvedValue({ sales: [], error: null });
      const state = await post({ csv: SHEET, intent: "import" });
      expect(repo.run).toHaveBeenCalledTimes(1);
      expect(repo.run.mock.calls[0][0].map((r) => r.row_no)).toEqual([2, 3]);
      expect(state.counts).toMatchObject({ imported: 2, failed: 1 });
      expect(state.duplicates).toBeNull();
    });

    it("does not stop for a sale on another day, or another customer that day", async () => {
      repo.existingSales.mockResolvedValue({
        sales: [
          { ...VIJAYAKUMAR, orderDate: "2025-01-11" },
          { ...VIJAYAKUMAR, id: "wo-2", clientName: "Vijay Kumar R" },
        ],
        error: null,
      });
      const state = await post({ csv: SHEET, intent: "import" });
      expect(repo.run).toHaveBeenCalledTimes(1);
      expect(state.counts.imported).toBe(2);
    });
  });

  describe("duplicates=skip", () => {
    it("never sends them, imports the rest and reports them as skipped with the sale they match", async () => {
      const state = await post({ csv: SHEET, intent: "import", duplicates: "skip" });
      expect(repo.run).toHaveBeenCalledTimes(1);
      expect(repo.run.mock.calls[0][0].map((r) => r.client_name)).toEqual(["Meera Nair"]);
      expect(state.mode).toBe("import");
      expect(state.counts).toEqual({ ready: 0, duplicate: 0, imported: 1, skipped: 1, failed: 1 });
      expect(state.results[0]).toMatchObject({
        status: "skipped",
        message: duplicateMessage(VIJAYAKUMAR),
      });
      expect(state.duplicates).toBeNull();
      expect(revalidatePath).toHaveBeenCalledWith("/projects");
    });

    it("sends nothing at all when every valid row is already in", async () => {
      const state = await post({
        csv: `${HEADER}\nVijayakumar R,3kW,195000,2025-01-10,Rahul`,
        intent: "import",
        duplicates: "skip",
      });
      expect(repo.run).not.toHaveBeenCalled();
      expect(state.counts).toMatchObject({ imported: 0, skipped: 1 });
      expect(state.error).toBeUndefined();
      expect(revalidatePath).not.toHaveBeenCalled();
    });

    it("keeps skipping by consumer number, and passes the same settings through", async () => {
      await post({
        csv: SHEET,
        intent: "import",
        duplicates: "skip",
        skip_existing: "false",
        default_coordinator_id: PRIYA.id,
      });
      expect(repo.run.mock.calls[0][1]).toBe(PRIYA.id);
      expect(repo.run.mock.calls[0][2]).toBe(false);
    });

    it("says nothing was imported when the only batch sent is refused", async () => {
      repo.run.mockResolvedValue({
        outcomes: [],
        failure: { code: "42501", message: "Only office staff can import projects" },
      });
      const state = await post({ csv: SHEET, intent: "import", duplicates: "skip" });
      expect(state.error).toBe("Nothing was imported. Only office staff can import projects.");
      expect(state.results.map((r) => r.status)).toEqual(["skipped", "failed", "failed"]);
    });

    describe("with a later row sharing a skipped row's consumer number", () => {
      // Row 2 is already in; row 3 repeats its consumer number (spaced apart),
      // so Check file said the import skips it; row 4 is new.
      const NUMBERED = [
        `${HEADER},consumer_number`,
        "Vijayakumar R,3kW,195000,2025-01-10,Rahul,1156 789",
        "Meera Nair,3kW,195000,2025-01-10,Rahul,1156789",
        "Joseph Mathew,3kW,195000,2025-01-10,Rahul,999",
      ].join("\n");

      it("holds that row back too — it would go in in the skipped row's place — and says why", async () => {
        const state = await post({ csv: NUMBERED, intent: "import", duplicates: "skip" });
        expect(repo.run).toHaveBeenCalledTimes(1);
        expect(repo.run.mock.calls[0][0].map((r) => r.row_no)).toEqual([4]);
        expect(state.counts).toEqual({ ready: 0, duplicate: 0, imported: 1, skipped: 2, failed: 0 });
        expect(state.results[1]).toMatchObject({
          status: "skipped",
          message: "Consumer number 1156789 repeats row 2, which is already in the system — skipped with it",
        });
        // It goes in the download with the reason, as any skipped row does.
        expect(state.retryCsv).toContain("repeats row 2");
      });

      it("sends it when consumer numbers are not skipped, or when every row is imported anyway", async () => {
        await post({ csv: NUMBERED, intent: "import", duplicates: "skip", skip_existing: "false" });
        expect(repo.run.mock.calls[0][0].map((r) => r.row_no)).toEqual([3, 4]);
        await post({ csv: NUMBERED, intent: "import", duplicates: "include" });
        expect(repo.run.mock.calls[1][0].map((r) => r.row_no)).toEqual([2, 3, 4]);
      });

      it("still says nothing was imported when the batch sent is refused", async () => {
        repo.run.mockResolvedValue({ outcomes: [], failure: { code: "57014", message: "timeout" } });
        const state = await post({ csv: NUMBERED, intent: "import", duplicates: "skip" });
        expect(state.error).toMatch(/^Nothing was imported\. /);
        expect(state.results.map((r) => r.status)).toEqual(["skipped", "skipped", "failed"]);
      });
    });
  });

  describe("duplicates=include", () => {
    it("sends every valid row, and puts the duplicate on record under the row", async () => {
      const state = await post({ csv: SHEET, intent: "import", duplicates: "include" });
      expect(repo.run).toHaveBeenCalledTimes(1);
      expect(repo.run.mock.calls[0][0].map((r) => r.row_no)).toEqual([2, 3]);
      expect(state.counts).toEqual({ ready: 0, duplicate: 0, imported: 2, skipped: 0, failed: 1 });
      expect(state.results[0].warnings).toEqual([importedAgainWarning(VIJAYAKUMAR)]);
      expect(state.results[1].warnings).toEqual([]);
      expect(state.duplicates).toBeNull();
    });
  });

  describe("when the sales cannot be read", () => {
    beforeEach(() => {
      repo.existingSales.mockResolvedValue({ sales: [], error: "boom" });
    });

    it.each([
      ["a check", { intent: "check" }],
      ["an import without a choice", { intent: "import" }],
      ["an import that skips them", { intent: "import", duplicates: "skip" }],
    ])("stops %s, writing nothing — unknown is not none", async (_label, extra) => {
      const state = await post({ csv: SHEET, ...extra });
      expect(state.error).toBe(
        "Could not check which of these sales are already in the system — please try again.",
      );
      expect(state.results).toEqual([]);
      expect(repo.run).not.toHaveBeenCalled();
    });

    it("still imports everything when told to import them all anyway", async () => {
      const state = await post({ csv: SHEET, intent: "import", duplicates: "include" });
      expect(repo.run).toHaveBeenCalledTimes(1);
      expect(state.counts.imported).toBe(2);
    });
  });
});
