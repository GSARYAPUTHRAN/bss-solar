import { describe, expect, it } from "vitest";
import { formatCurrency, formatCurrencyWhole } from "@/lib/format";
import { CoordinatorDirectory } from "./coordinator-match";
import { planImport, type ImportPlan, type ImportRow } from "./import";
import {
  DUPLICATE_NAMES_SHOWN,
  dayLabel,
  duplicateChoiceOf,
  duplicateMessage,
  duplicateNames,
  duplicateNotice,
  duplicateSummary,
  duplicateTitle,
  findDuplicates,
  importAllLabel,
  importedAgainWarning,
  nameKeys,
  repeatOfSkippedMessage,
  repeatsOfSkipped,
  sameCustomer,
  sameCustomerGroups,
  skipLabel,
  undatedRows,
  wholeSheetDuplicated,
  type DuplicateMatch,
  type DuplicateNotice,
  type ExistingSale,
} from "./import-duplicates";

// Amounts are compared through the app's own formatters, so the assertions do
// not depend on the ICU build's rupee formatting.

const TODAY = "2026-11-24";

const RAHUL = { id: "id-rahul", fullName: "Rahul Menon", email: "coord@bsssolar.test", role: "coordinator" as const };
const DIRECTORY = new CoordinatorDirectory([RAHUL]);

const ROW: ImportRow = {
  row_no: 2,
  client_name: "Anand Kumar",
  client_phone: null,
  address: null,
  plan_type: "solar",
  plant_capacity: "3kW",
  total_cost: 195000,
  advance_amount: 0,
  advance_method: null,
  advance_paid_on: null,
  advance_reference: null,
  order_date: "2026-11-08",
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
};

const row = (row_no: number, client_name: string, order_date = "2026-11-08"): ImportRow => ({
  ...ROW,
  row_no,
  client_name,
  order_date,
});

const SALE: ExistingSale = {
  id: "wo-1",
  clientName: "R.Vijayakumar",
  orderDate: "2026-11-08",
  // 20:00 UTC on the 7th is 01:30 on the 8th in India.
  createdAt: "2026-11-07T20:00:00+00:00",
  coordinatorNames: ["Rahul Menon"],
  totalCost: 195000,
};

const sale = (over: Partial<ExistingSale>): ExistingSale => ({ ...SALE, ...over });

function plan(csv: string): ImportPlan {
  const res = planImport(csv, { today: TODAY, directory: DIRECTORY, defaultCoordinatorId: null });
  if (!res.ok) throw new Error(res.error);
  return res.data;
}

const notice = (over: Partial<DuplicateNotice> = {}): DuplicateNotice => ({
  kind: "check",
  count: 2,
  byNameOnly: 0,
  valid: 5,
  addedOn: ["2026-11-08"],
  names: ["R Vijayakumar", "Santhikumari"],
  ...over,
});

describe("nameKeys", () => {
  it("reads initials, dots and word order the same way", () => {
    const keys = ["R.Vijayakumar", "R Vijayakumar", "Vijayakumar R", "  vijayakumar,  r. "].map(
      (n) => nameKeys(n).sorted,
    );
    expect(new Set(keys)).toEqual(new Set(["r vijayakumar"]));
  });

  it("runs the words together in written order, so a split name is the same name", () => {
    expect(nameKeys("Santhi kumari").joined).toBe("santhikumari");
    expect(nameKeys("Santhikumari").joined).toBe("santhikumari");
    expect(nameKeys("Santhi kumari").sorted).not.toBe(nameKeys("Santhikumari").sorted);
  });

  it("runs initials written one after another into one word, so where they stand does not matter", () => {
    const keys = ["K.C Santhi", "K C Santhi", "Santhi KC", "santhi k.c."].map((n) => nameKeys(n).initials);
    expect(new Set(keys)).toEqual(new Set(["kc santhi"]));
    expect(nameKeys("M.S Rajan").initials).toBe(nameKeys("Rajan MS").initials);
    // Initials apart stay apart; a digit is no initial.
    expect(nameKeys("K Santhi C").initials).toBe("c k santhi");
    expect(nameKeys("Anand 2 3").initials).toBe("2 3 anand");
  });

  it("ignores case and keeps digits", () => {
    expect(nameKeys("ANAND kumar 2")).toEqual({
      sorted: "2 anand kumar",
      joined: "anandkumar2",
      initials: "2 anand kumar",
    });
  });

  it("keeps Malayalam words whole, vowel signs included", () => {
    // ു and ാ are combining marks: splitting on them would break the word apart.
    const sorted = ["അനിൽ", "കുമാർ"].sort().join(" ");
    expect(nameKeys("അനിൽ കുമാർ")).toEqual({ sorted, joined: "അനിൽകുമാർ", initials: sorted });
  });

  it("reads full-width letters as the letters they are", () => {
    expect(nameKeys("Ａｎａｎｄ").joined).toBe("anand");
  });

  it("is empty for a name with no letters or digits", () => {
    expect(nameKeys(" -- . ")).toEqual({ sorted: "", joined: "", initials: "" });
  });
});

describe("sameCustomer", () => {
  it.each([
    ["R.Vijayakumar", "R Vijayakumar"],
    ["R.Vijayakumar", "Vijayakumar R"],
    ["Santhi kumari", "Santhikumari"],
    ["Anand Kumar", "anand  KUMAR"],
    ["K.C Santhi", "Santhi KC"],
    ["M.S Rajan", "Rajan MS"],
    ["K C Santhi", "Santhi K.C."],
    ["Rajan M.S", "MS Rajan"],
  ])("%s is %s", (a, b) => {
    expect(sameCustomer(a, b)).toBe(true);
    expect(sameCustomer(b, a)).toBe(true);
  });

  it.each([
    ["Anand Kumar", "Anand Kumari"],
    ["Vijay Kumar R", "Vijayakumar R"],
    ["Meera Nair", "Meera"],
    // Other initials are another person.
    ["K.C Santhi", "K.S Santhi"],
    ["K.C Santhi", "Santhi KS"],
    ["M.S Rajan", "Rajan MK"],
    ["Santhi KC", "Santhi K"],
    ["M.S Rajan", "Rajan M"],
  ])("%s is not %s", (a, b) => {
    expect(sameCustomer(a, b)).toBe(false);
    expect(sameCustomer(b, a)).toBe(false);
  });

  it("never matches a name with nothing to compare", () => {
    expect(sameCustomer("--", "..")).toBe(false);
    expect(sameCustomer("", "")).toBe(false);
  });
});

describe("sameCustomerGroups", () => {
  const groups = (names: string[]) => sameCustomerGroups(names, (n) => n);

  it("groups the names of one customer, two or more to a group, in the order given", () => {
    expect(
      groups(["Meera Nair", "R.Vijayakumar", "Anand", "Vijayakumar R", "K.C Santhi", "Santhi KC", "R Vijayakumar"]),
    ).toEqual([
      ["R.Vijayakumar", "Vijayakumar R", "R Vijayakumar"],
      ["K.C Santhi", "Santhi KC"],
    ]);
  });

  it("links a group name to name, whichever key each pair shares", () => {
    // "A B" = "B A" (sorted), "B A" = "BA" (joined): one group, though "A B" ≠ "BA".
    expect(sameCustomer("A B", "BA")).toBe(false);
    expect(groups(["A B", "BA", "B A"])).toEqual([["A B", "BA", "B A"]]);
  });

  it("is empty when no two match, and never groups a name with nothing to compare", () => {
    expect(groups([])).toEqual([]);
    expect(groups(["Anand", "Meera"])).toEqual([]);
    expect(groups(["--", "--", ".."])).toEqual([]);
  });
});

describe("findDuplicates", () => {
  it("is empty with nothing in the system, or nothing in the file", () => {
    expect(findDuplicates([row(2, "R Vijayakumar")], [])).toEqual(new Map());
    expect(findDuplicates([], [SALE])).toEqual(new Map());
  });

  it("matches the same customer on the same order date, by row number", () => {
    const found = findDuplicates(
      [row(2, "Vijayakumar R"), row(3, "Meera Nair"), row(5, "R. Vijayakumar")],
      [SALE],
    );
    expect([...found.keys()]).toEqual([2, 5]);
    expect(found.get(2)).toBe(SALE);
  });

  it("does not match the same customer on another day", () => {
    expect(findDuplicates([row(2, "R Vijayakumar", "2026-11-09")], [SALE]).size).toBe(0);
  });

  it("does not match another customer on the same day", () => {
    expect(findDuplicates([row(2, "Santhikumari")], [SALE]).size).toBe(0);
  });

  describe("a row whose order date was blank", () => {
    // Row 2 has no order date (today stands in); row 3 is dated.
    const planned = plan(
      [
        "client_name,plant_capacity,total_cost,order_date,coordinator",
        "Santhi kumari,3kW,195000,,Rahul",
        "Meera Nair,3kW,195000,2026-11-20,Rahul",
      ].join("\n"),
    );
    const valid = planned.rows.flatMap((r) => (r.parsed.ok ? [r.parsed.data] : []));
    const undated = undatedRows(planned);
    // Uploaded on 8 Nov with the same blank cell; this is the same sheet again.
    const earlier = sale({ id: "wo-s", clientName: "Santhikumari", orderDate: "2026-11-08" });

    it("is matched by the customer's name alone, against sales of any order date, and says so", () => {
      expect(valid[0].order_date).toBe(TODAY);
      expect(findDuplicates(valid, [earlier], undated).get(2)).toEqual({ ...earlier, byNameOnly: true });
      const today = sale({ id: "wo-t", clientName: "Santhikumari", orderDate: TODAY });
      expect(findDuplicates(valid, [today], undated).get(2)).toEqual({ ...today, byNameOnly: true });
    });

    it("names the oldest sale of that name", () => {
      const newer = { ...earlier, id: "wo-n", orderDate: "2026-11-20", createdAt: "2026-11-20T05:00:00Z" };
      const older = { ...earlier, id: "wo-o", clientName: "kumari Santhi", createdAt: "2026-10-01T05:00:00Z" };
      expect(findDuplicates(valid, [newer, older], undated).get(2)).toMatchObject({ id: "wo-o" });
    });

    it("leaves a dated row matched on its order date as before", () => {
      const meera = sale({ id: "wo-m", clientName: "Meera Nair", orderDate: "2026-11-19" });
      expect(findDuplicates(valid, [meera], undated).has(3)).toBe(false);
      const same = { ...meera, orderDate: "2026-11-20" };
      expect(findDuplicates(valid, [same], undated).get(3)).toBe(same);
    });

    it("is not matched by name when the rows say nothing of which had no order date", () => {
      expect(findDuplicates(valid, [earlier]).size).toBe(0);
    });
  });

  it("names the oldest sale when the customer is in more than once, whatever order they come in", () => {
    const newer = sale({ id: "wo-a", createdAt: "2026-11-20T05:00:00Z" });
    const older = sale({ id: "wo-z", createdAt: "2026-11-08T05:00:00Z" });
    const unknown = sale({ id: "wo-0", createdAt: "" });
    expect(findDuplicates([row(2, "R Vijayakumar")], [newer, unknown, older]).get(2)).toBe(older);
    // Same moment (one import transaction): the lower id, every time.
    const twin = sale({ id: "wo-b", createdAt: newer.createdAt });
    expect(findDuplicates([row(2, "R Vijayakumar")], [twin, newer]).get(2)).toBe(newer);
  });

  it("names the oldest sale whichever way of comparing names found each", () => {
    // The newer one matches the words sorted, the older one the words run together.
    const newer = sale({ id: "wo-a", clientName: "kumari Santhi", createdAt: "2026-11-20T05:00:00Z" });
    const older = sale({ id: "wo-z", clientName: "Santhikumari", createdAt: "2026-11-08T05:00:00Z" });
    expect(findDuplicates([row(2, "Santhi kumari")], [newer, older]).get(2)).toBe(older);
  });

  it("matches initials written run together, wherever they stand", () => {
    const santhi = sale({ clientName: "K.C Santhi" });
    expect(findDuplicates([row(2, "Santhi KC"), row(3, "Santhi KS")], [santhi])).toEqual(
      new Map([[2, santhi]]),
    );
  });

  it("marks every row that matches, two rows of the file matching one sale included", () => {
    const found = findDuplicates([row(2, "R Vijayakumar"), row(3, "Vijayakumar R")], [SALE]);
    expect(found.get(2)).toBe(SALE);
    expect(found.get(3)).toBe(SALE);
  });

  it("does not compare the rows of the file with each other", () => {
    expect(findDuplicates([row(2, "A B"), row(3, "B A")], []).size).toBe(0);
  });

  it("matches across a year and a leap day by the exact date", () => {
    const leap = sale({ orderDate: "2028-02-29" });
    expect(findDuplicates([row(2, "R Vijayakumar", "2028-02-29")], [leap]).size).toBe(1);
    expect(findDuplicates([row(2, "R Vijayakumar", "2028-03-01")], [leap]).size).toBe(0);
    expect(findDuplicates([row(2, "R Vijayakumar", "2027-11-08")], [SALE]).size).toBe(0);
  });
});

describe("undatedRows", () => {
  it("is the valid rows whose order_date cell was blank", () => {
    const planned = plan(
      [
        "client_name,plant_capacity,total_cost,order_date,coordinator",
        "Blank,3kW,1,,Rahul",
        `Dated today,3kW,1,${TODAY},Rahul`,
        "Failed,,1,,Rahul",
        "Spaces,3kW,1,   ,Rahul",
      ].join("\n"),
    );
    expect(undatedRows(planned)).toEqual(new Set([2, 5]));
  });

  it("is every valid row when the sheet has no order_date column", () => {
    const planned = plan("client_name,plant_capacity,total_cost,coordinator\nA,3kW,1,Rahul\nB,3kW,2,Rahul");
    expect(undatedRows(planned)).toEqual(new Set([2, 3]));
  });
});

describe("repeatsOfSkipped", () => {
  const numbered = (row_no: number, consumer_number: string | null): ImportRow => ({
    ...row(row_no, `Customer ${row_no}`),
    consumer_number,
  });

  it("holds back the later rows sharing the number of a row skipped as already in the system", () => {
    const rows = [
      numbered(2, "1156 789"), // already in: skipped
      numbered(3, "1156789"), // the RPC would have skipped it as a repeat of row 2
      numbered(4, "999"),
      numbered(5, "1156789"),
    ];
    const held = repeatsOfSkipped(rows, new Map([[2, SALE]]));
    expect([...held.keys()]).toEqual([3, 5]);
    expect(held.get(5)).toBe(rows[0]);
  });

  it("leaves a number whose first row goes in to the RPC, which skips the repeats itself", () => {
    const rows = [numbered(2, "NA"), numbered(3, "NA"), numbered(4, "NA")];
    expect(repeatsOfSkipped(rows, new Map([[3, SALE]])).size).toBe(0);
  });

  it("does not hold back a row skipped already, nothing for rows without a number, and keeps case", () => {
    const rows = [numbered(2, "ab1"), numbered(3, "ab1"), numbered(4, "AB1"), numbered(5, null), numbered(6, null)];
    const held = repeatsOfSkipped(rows, new Map([[2, SALE], [3, SALE], [5, SALE]]));
    expect(held.size).toBe(0);
  });

  it("says which row it repeats, by the number as this row wrote it", () => {
    expect(repeatOfSkippedMessage(numbered(5, "1156789"), numbered(2, "1156 789"))).toBe(
      "Consumer number 1156789 repeats row 2, which is already in the system — skipped with it",
    );
  });
});

describe("duplicateNotice", () => {
  const CSV = [
    "client_name,plant_capacity,total_cost,order_date,coordinator",
    "Vijayakumar R,3kW,195000,2026-11-08,Rahul",
    "No Capacity,,1000,2026-11-08,Rahul",
    "Meera Nair,3kW,195000,2026-11-08,Rahul",
    "Santhi kumari,3kW,195000,2026-11-09,Rahul",
  ].join("\n");

  it("is null when no row matches", () => {
    expect(duplicateNotice(plan(CSV), new Map(), "check")).toBeNull();
  });

  it("counts the matching rows against the valid ones only, and names them as the sheet wrote them", () => {
    const planned = plan(CSV);
    const matches = new Map([
      [2, SALE],
      [5, sale({ id: "wo-2", clientName: "Santhikumari", orderDate: "2026-11-09", createdAt: "2026-11-12T10:00:00Z" })],
    ]);
    expect(duplicateNotice(planned, matches, "confirm")).toEqual({
      kind: "confirm",
      count: 2,
      byNameOnly: 0,
      valid: 3,
      // IST: SALE went in at 01:30 on the 8th.
      addedOn: ["2026-11-08", "2026-11-12"],
      names: ["Vijayakumar R", "Santhi kumari"],
    });
  });

  it("lists each day once, oldest first, and leaves out a sale with no known time", () => {
    const planned = plan(CSV);
    const matches = new Map([
      [4, sale({ id: "wo-3", clientName: "Meera Nair", createdAt: "2026-11-08T09:00:00Z" })],
      [2, SALE],
      [5, sale({ id: "wo-4", clientName: "Santhikumari", orderDate: "2026-11-09", createdAt: "" })],
    ]);
    const result = duplicateNotice(planned, matches, "check");
    expect(result?.addedOn).toEqual(["2026-11-08"]);
    expect(result?.names).toEqual(["Vijayakumar R", "Meera Nair", "Santhi kumari"]);
  });

  it("ignores a match on a row that failed validation", () => {
    const planned = plan(CSV);
    expect(duplicateNotice(planned, new Map([[3, SALE]]), "check")).toBeNull();
  });

  it("counts the rows matched by name alone", () => {
    const planned = plan(CSV);
    const matches = new Map<number, DuplicateMatch>([
      [2, SALE],
      [4, { ...sale({ id: "wo-3", clientName: "Meera Nair" }), byNameOnly: true }],
      [5, { ...sale({ id: "wo-4", clientName: "Santhikumari" }), byNameOnly: true }],
    ]);
    expect(duplicateNotice(planned, matches, "check")).toMatchObject({ count: 3, byNameOnly: 2 });
  });
});

describe("the words", () => {
  it("writes a day without a leading zero or ICU", () => {
    expect(dayLabel("2026-11-08")).toBe("8 Nov 2026");
    expect(dayLabel("2028-02-29")).toBe("29 Feb 2028");
    expect(dayLabel("2026-01-01")).toBe("1 Jan 2026");
  });

  it("says which sale a row matches: its name, the day it went in, who has it and its value", () => {
    expect(duplicateMessage(SALE)).toBe(
      `Already in the system — R.Vijayakumar, added on 8 Nov 2026 (Rahul Menon, ${formatCurrencyWhole(195000)})`,
    );
    expect(
      duplicateMessage(sale({ coordinatorNames: ["Rahul Menon", "Priya Suresh"], totalCost: 1234.5 })),
    ).toBe(
      `Already in the system — R.Vijayakumar, added on 8 Nov 2026 (Rahul Menon & Priya Suresh, ${formatCurrency(1234.5)})`,
    );
  });

  it("leaves out what it does not know", () => {
    expect(duplicateMessage(sale({ createdAt: "", coordinatorNames: [] }))).toBe(
      `Already in the system — R.Vijayakumar (${formatCurrencyWhole(195000)})`,
    );
  });

  it("puts a row imported anyway on record as a duplicate", () => {
    expect(importedAgainWarning(SALE)).toBe(
      `Imported again as chosen — this sale was already in the system: R.Vijayakumar, added on 8 Nov 2026 (Rahul Menon, ${formatCurrencyWhole(195000)})`,
    );
  });

  it("says a row with no order date matched by name only, and gives the sale's order date", () => {
    const byName = { ...sale({ orderDate: "2025-01-10" }), byNameOnly: true };
    expect(duplicateMessage(byName)).toBe(
      `Already in the system — a sale with this name (no order date in the sheet to compare): R.Vijayakumar, ordered 10 Jan 2025, added on 8 Nov 2026 (Rahul Menon, ${formatCurrencyWhole(195000)})`,
    );
    expect(importedAgainWarning(byName)).toBe(
      `Imported again as chosen — a sale with this name was already in the system (no order date in the sheet to compare): R.Vijayakumar, ordered 10 Jan 2025, added on 8 Nov 2026 (Rahul Menon, ${formatCurrencyWhole(195000)})`,
    );
    expect(duplicateMessage({ ...byName, createdAt: "", coordinatorNames: [] })).toBe(
      `Already in the system — a sale with this name (no order date in the sheet to compare): R.Vijayakumar, ordered 10 Jan 2025 (${formatCurrencyWhole(195000)})`,
    );
  });

  it("names up to ten customers, then counts the rest", () => {
    expect(duplicateNames({ names: ["A"] })).toBe("A");
    expect(duplicateNames({ names: ["A", "B"] })).toBe("A and B");
    expect(duplicateNames({ names: ["A", "B", "C"] })).toBe("A, B and C");
    const ten = Array.from({ length: DUPLICATE_NAMES_SHOWN }, (_, i) => `C${i + 1}`);
    expect(duplicateNames({ names: ten })).toBe("C1, C2, C3, C4, C5, C6, C7, C8, C9 and C10");
    expect(duplicateNames({ names: [...ten, "C11", "C12", "C13"] })).toBe(
      "C1, C2, C3, C4, C5, C6, C7, C8, C9, C10 and 3 more",
    );
  });

  it("calls a sheet whose every row is in already uploaded", () => {
    expect(wholeSheetDuplicated({ count: 3, valid: 3 })).toBe(true);
    expect(duplicateTitle({ count: 3, valid: 3 })).toBe("This sheet was already uploaded");
    expect(duplicateTitle({ count: 2, valid: 3 })).toBe(
      "Some of these sales are already in the system",
    );
  });

  describe("duplicateSummary", () => {
    it("says how many of the rows match, and when those sales were added", () => {
      expect(duplicateSummary(notice())).toBe(
        "2 of 5 rows match sales already in the system (same customer and order date). They were added on 8 Nov 2026.",
      );
    });

    it("speaks of one row in the singular", () => {
      expect(duplicateSummary(notice({ count: 1, valid: 1 }))).toBe(
        "1 of 1 row matches a sale already in the system (same customer and order date). It was added on 8 Nov 2026.",
      );
      expect(duplicateSummary(notice({ count: 1, valid: 4 }))).toMatch(
        /^1 of 4 rows matches a sale .* It was added on/,
      );
    });

    it("names up to three days, and gives a span for more", () => {
      expect(duplicateSummary(notice({ addedOn: ["2026-11-08", "2026-11-09", "2026-11-12"] }))).toMatch(
        /They were added on 8 Nov 2026, 9 Nov 2026 and 12 Nov 2026\.$/,
      );
      expect(
        duplicateSummary(notice({ addedOn: ["2026-10-30", "2026-11-08", "2026-11-09", "2026-11-12"] })),
      ).toMatch(/They were added between 30 Oct 2026 and 12 Nov 2026\.$/);
    });

    it("says nothing of when, when it is not known", () => {
      expect(duplicateSummary(notice({ addedOn: [] }))).toBe(
        "2 of 5 rows match sales already in the system (same customer and order date).",
      );
    });

    it("says when rows with no order date were matched by name alone", () => {
      expect(duplicateSummary(notice({ count: 1, valid: 1, byNameOnly: 1 }))).toBe(
        "1 of 1 row matches a sale already in the system (same customer name; no order date in the sheet to compare). It was added on 8 Nov 2026.",
      );
      expect(duplicateSummary(notice({ byNameOnly: 2 }))).toMatch(
        /^2 of 5 rows match sales already in the system \(same customer name; no order date in the sheet to compare\)\./,
      );
      expect(duplicateSummary(notice({ count: 3, byNameOnly: 1 }))).toMatch(
        /^3 of 5 rows match sales already in the system \(same customer and order date; 1 with no order date in the sheet matches by name alone\)\./,
      );
      expect(duplicateSummary(notice({ count: 4, byNameOnly: 2 }))).toMatch(
        /\(same customer and order date; 2 with no order date in the sheet match by name alone\)\./,
      );
    });
  });

  it("offers to skip only when something would be left to import", () => {
    expect(skipLabel({ count: 2, valid: 5 })).toBe(
      "Skip the 2 already in the system and import the other 3",
    );
    expect(skipLabel({ count: 5, valid: 5 })).toBeNull();
  });

  it("says how many rows importing anyway sends", () => {
    expect(importAllLabel({ valid: 5 })).toBe("Import all 5 anyway");
    expect(importAllLabel({ valid: 1 })).toBe("Import it anyway");
  });
});

describe("duplicateChoiceOf", () => {
  it("takes skip or include, and nothing else", () => {
    expect(duplicateChoiceOf("skip")).toBe("skip");
    expect(duplicateChoiceOf("include")).toBe("include");
    for (const other of [null, undefined, "", "SKIP", "yes", new File(["skip"], "x.txt")]) {
      expect(duplicateChoiceOf(other)).toBeNull();
    }
  });
});
