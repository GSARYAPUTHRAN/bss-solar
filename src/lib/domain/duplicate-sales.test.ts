import { describe, expect, it } from "vitest";
import {
  MAX_BULK_DELETE,
  MAX_KEEP_IDS,
  defaultSelection,
  deletionSummary,
  findDuplicateGroups,
  groupsLeftEmpty,
  normaliseConsumerNumber,
  parseKeepGroups,
  parseSaleIds,
  suggestKeeper,
  type CleanupSale,
  type DuplicateGroup,
} from "./duplicate-sales";

let next = 0;

/** A plain pending sale with nothing recorded; each gets its own id. */
function sale(over: Partial<CleanupSale> = {}): CleanupSale {
  next += 1;
  return {
    id: `wo-${String(next).padStart(3, "0")}`,
    clientName: `Client ${next}`,
    orderDate: "2026-02-12",
    // Each sale is written a second after the one before.
    createdAt: new Date(Date.UTC(2026, 1, 12) + next * 1000).toISOString(),
    consumerNumber: null,
    status: "pending",
    cancellation: null,
    coordinatorNames: ["Rahul Menon"],
    totalCost: 235000,
    amountReceived: 0,
    paymentCount: 0,
    projectId: null,
    currentStage: null,
    isCompleted: false,
    ticketCount: 0,
    planType: "solar",
    ...over,
  };
}

const ids = (sales: readonly CleanupSale[]) => sales.map((s) => s.id);
const groupIds = (groups: readonly DuplicateGroup[]) => groups.map((g) => ids(g.sales).sort());

describe("normaliseConsumerNumber", () => {
  it.each([
    ["1156304012345", "1156304012345"],
    [" 1156 3040 12345 ", "1156304012345"],
    ["1156-304-012345", "1156304012345"],
    ["1156/304/012345", "1156304012345"],
    ["1156.304.012345", "1156304012345"],
    ["1156 - 304 / 01.2345", "1156304012345"],
    ["AB-12cd", "ab12cd"],
    ["ab12CD", "ab12cd"],
    ["1156\t304\n012345", "1156304012345"],
  ])("reads %j as %j", (value, key) => {
    expect(normaliseConsumerNumber(value)).toBe(key);
  });

  it.each([null, undefined, "", "   ", " - / . ", "--"])("has no number in %j", (value) => {
    expect(normaliseConsumerNumber(value)).toBeNull();
  });

  it.each(["NA", "na", "N/A", "n.a.", "Nil", "NIL", "Applied", "Pending", "0", "000", "0-0/0"])(
    "reads the placeholder %j as no number",
    (value) => {
      expect(normaliseConsumerNumber(value)).toBeNull();
    },
  );

  it("keeps a number that has zeros in it, and one with letters", () => {
    expect(normaliseConsumerNumber("1000")).toBe("1000");
    expect(normaliseConsumerNumber("00 01")).toBe("0001");
    expect(normaliseConsumerNumber("KSEB-7")).toBe("kseb7");
  });

  it("keeps other punctuation, so different numbers stay different", () => {
    expect(normaliseConsumerNumber("12_34")).toBe("12_34");
    expect(normaliseConsumerNumber("12_34")).not.toBe(normaliseConsumerNumber("1234"));
  });
});

describe("findDuplicateGroups — the same consumer number", () => {
  it("groups sales with one number however it was typed, on any date and any name", () => {
    const a = sale({ consumerNumber: "1156-304-012345", clientName: "Anil Kumar" });
    const b = sale({
      consumerNumber: "1156 304 012345",
      clientName: "Suresh P",
      orderDate: "2025-01-01",
    });
    const c = sale({ consumerNumber: "999" });
    const groups = findDuplicateGroups([a, b, c]);
    expect(groupIds(groups)).toEqual([[a.id, b.id].sort()]);
    expect(groups[0].reasons).toEqual(["consumer_number"]);
  });

  it("never groups by an empty or blank number", () => {
    const groups = findDuplicateGroups([
      sale({ consumerNumber: "" }),
      sale({ consumerNumber: "  " }),
      sale({ consumerNumber: null }),
      sale({ consumerNumber: "-/." }),
    ]);
    expect(groups).toEqual([]);
  });

  it("never groups different customers by a placeholder such as NA", () => {
    const anil = sale({ clientName: "Anil Kumar", consumerNumber: "NA", orderDate: "2025-01-10" });
    const meera = sale({ clientName: "Meera Nair", consumerNumber: "N/A", orderDate: "2025-03-02" });
    const rajan = sale({ clientName: "Rajan P", consumerNumber: "na", orderDate: "2025-06-20" });
    const nil = sale({ clientName: "Biju", consumerNumber: "Nil", orderDate: "2025-07-01" });
    const zero = sale({ clientName: "Sunil", consumerNumber: "0", orderDate: "2025-08-01" });
    const zeros = sale({ clientName: "Ravi", consumerNumber: "000", orderDate: "2025-09-01" });
    expect(findDuplicateGroups([anil, meera, rajan, nil, zero, zeros])).toEqual([]);
  });

  it("still groups one customer with a placeholder number by name and date", () => {
    const a = sale({ clientName: "Anil Kumar", consumerNumber: "NA" });
    const b = sale({ clientName: "Anil Kumar", consumerNumber: "1156304012345" });
    const groups = findDuplicateGroups([a, b]);
    expect(groupIds(groups)).toEqual([[a.id, b.id].sort()]);
    expect(groups[0].reasons).toEqual(["customer_and_date"]);
  });

  it("puts every sale with the number in one group", () => {
    const copies = [1, 2, 3, 4].map(() => sale({ consumerNumber: "77" }));
    expect(groupIds(findDuplicateGroups(copies))).toEqual([ids(copies).sort()]);
  });
});

describe("findDuplicateGroups — the same customer on the same date", () => {
  it.each([
    ["case", "ANIL KUMAR", "anil kumar"],
    ["word order", "Kumar Anil", "Anil Kumar"],
    ["spacing", "Santhi kumari", "Santhikumari"],
    ["initials", "K.C Santhi", "Santhi KC"],
    ["initials with dots", "R.Vijayakumar", "Vijayakumar R"],
  ])("ignores %s (%j and %j)", (_what, first, second) => {
    const a = sale({ clientName: first });
    const b = sale({ clientName: second });
    const groups = findDuplicateGroups([a, b]);
    expect(groupIds(groups)).toEqual([[a.id, b.id].sort()]);
    expect(groups[0].reasons).toEqual(["customer_and_date"]);
  });

  it("does not group one customer on different dates", () => {
    expect(
      findDuplicateGroups([
        sale({ clientName: "Anil Kumar", orderDate: "2026-02-12" }),
        sale({ clientName: "Anil Kumar", orderDate: "2026-02-13" }),
      ]),
    ).toEqual([]);
  });

  it("does not group different customers on one date", () => {
    expect(
      findDuplicateGroups([
        sale({ clientName: "Anil Kumar" }),
        sale({ clientName: "Sunil Kumar" }),
        sale({ clientName: "K.S Santhi" }),
        sale({ clientName: "Santhi KC" }),
      ]),
    ).toEqual([]);
  });

  it("does not match names with no letters or digits", () => {
    expect(findDuplicateGroups([sale({ clientName: "-" }), sale({ clientName: "." })])).toEqual(
      [],
    );
  });

  it("does not group one name on one date with two different consumer numbers: two connections", () => {
    expect(
      findDuplicateGroups([
        sale({ clientName: "Anil Kumar", consumerNumber: "1156000000001" }),
        sale({ clientName: "Kumar Anil", consumerNumber: "1156 000 000 002" }),
      ]),
    ).toEqual([]);
  });

  it("groups them when one of the two has no number", () => {
    const a = sale({ clientName: "Anil Kumar", consumerNumber: "1156000000001" });
    const b = sale({ clientName: "Kumar Anil", consumerNumber: null });
    expect(groupIds(findDuplicateGroups([a, b]))).toEqual([[a.id, b.id].sort()]);
  });

  it("leaves a sale without an order date out of this relation", () => {
    expect(
      findDuplicateGroups([
        sale({ clientName: "Anil Kumar", orderDate: "" }),
        sale({ clientName: "Anil Kumar", orderDate: "" }),
      ]),
    ).toEqual([]);
  });

  it("links names through each other: 'A B', 'B A' and 'BA' are one customer", () => {
    const a = sale({ clientName: "Santhi Kumari" });
    const b = sale({ clientName: "Kumari Santhi" });
    const c = sale({ clientName: "KumariSanthi" });
    expect(groupIds(findDuplicateGroups([a, b, c]))).toEqual([[a.id, b.id, c.id].sort()]);
  });
});

describe("findDuplicateGroups — both relations together", () => {
  it("merges transitively across the two relations and gives both reasons", () => {
    // A–B share a consumer number (different dates); B–C are one customer on B's date.
    const a = sale({ clientName: "Anil Kumar", consumerNumber: "123", orderDate: "2026-01-01" });
    const b = sale({ clientName: "Anil K", consumerNumber: "1-2-3", orderDate: "2026-03-03" });
    const c = sale({ clientName: "K Anil", orderDate: "2026-03-03" });
    const d = sale({ clientName: "Somebody Else", orderDate: "2026-03-03" });
    const groups = findDuplicateGroups([a, b, c, d]);
    expect(groupIds(groups)).toEqual([[a.id, b.id, c.id].sort()]);
    expect(groups[0].reasons).toEqual(["consumer_number", "customer_and_date"]);
  });

  it("never joins two consumer-number groups by a name-and-date match: two connections are two sales", () => {
    const a = sale({ clientName: "Meera Nair", consumerNumber: "11", orderDate: "2026-01-01" });
    const b = sale({ clientName: "Meera Nair", consumerNumber: "22", orderDate: "2026-01-01" });
    const a2 = sale({ clientName: "X", consumerNumber: "11", orderDate: "2025-05-05" });
    const b2 = sale({ clientName: "Y", consumerNumber: "22", orderDate: "2024-04-04" });
    expect(groupIds(findDuplicateGroups([a, b, a2, b2]))).toEqual([
      [a.id, a2.id].sort(),
      [b.id, b2.id].sort(),
    ]);
  });

  it("does not pull another customer's sale into one customer's copies (the Anil/Suresh probe)", () => {
    // Two Anil Kumar sales on one day for two connections, and a later sale to
    // Suresh Babu on the second connection.
    const anil1 = sale({ clientName: "Anil Kumar", consumerNumber: "111", orderDate: "2025-01-10" });
    const anil2 = sale({ clientName: "Anil Kumar", consumerNumber: "222", orderDate: "2025-01-10" });
    const suresh = sale({ clientName: "Suresh Babu", consumerNumber: "222", orderDate: "2025-04-01" });
    const groups = findDuplicateGroups([anil1, anil2, suresh]);

    // Only the shared connection is a group; Anil's first connection is alone.
    expect(groupIds(groups)).toEqual([[anil2.id, suresh.id].sort()]);
    expect(groups[0].reasons).toEqual(["consumer_number"]);
    // Suresh's sale is the newest, so it is suggested — but Anil's copy is another
    // customer, so nothing is ticked and nothing of either sale is lost by default.
    expect(groups[0].keeperId).toBe(suresh.id);
    expect(groups[0].differences[anil2.id]).toEqual(["orderDate", "clientName"]);
    expect(defaultSelection(groups)).toEqual([]);
    expect(deletionSummary(groups, defaultSelection(groups)).sales).toBe(0);
  });

  it("names a reason once even when it links several pairs", () => {
    const copies = [1, 2, 3].map(() => sale({ clientName: "Anil Kumar", consumerNumber: "5" }));
    expect(findDuplicateGroups(copies)[0].reasons).toEqual([
      "consumer_number",
      "customer_and_date",
    ]);
  });

  it("puts a sale in one group only", () => {
    const sales = [
      sale({ clientName: "Anil Kumar", consumerNumber: "1" }),
      sale({ clientName: "Anil Kumar" }),
      sale({ clientName: "Ravi", consumerNumber: "1", orderDate: "2020-01-01" }),
      sale({ clientName: "Biju", orderDate: "2020-01-01" }),
      sale({ clientName: "Biju", orderDate: "2020-01-01" }),
    ];
    const all = findDuplicateGroups(sales).flatMap((g) => ids(g.sales));
    expect(new Set(all).size).toBe(all.length);
    expect(all).toHaveLength(5);
  });

  it("reads a sale listed twice as one sale", () => {
    const a = sale({ clientName: "Anil Kumar" });
    expect(findDuplicateGroups([a, { ...a }])).toEqual([]);
    const b = sale({ clientName: "Anil Kumar" });
    expect(findDuplicateGroups([a, a, b])[0].sales).toHaveLength(2);
  });

  it("finds nothing among distinct sales or no sales", () => {
    expect(findDuplicateGroups([])).toEqual([]);
    expect(findDuplicateGroups([sale(), sale(), sale()])).toEqual([]);
  });

  it("includes rejected, cancelled and refunded sales", () => {
    const a = sale({ clientName: "Anil Kumar", status: "rejected" });
    const b = sale({ clientName: "Anil Kumar", status: "approved", cancellation: "refunded" });
    expect(groupIds(findDuplicateGroups([a, b]))).toEqual([[a.id, b.id].sort()]);
  });
});

describe("findDuplicateGroups — the group", () => {
  it("has a stable key: the sorted ids, whatever the input order", () => {
    const a = sale({ id: "wo-b", clientName: "Anil Kumar" });
    const b = sale({ id: "wo-a", clientName: "Anil Kumar" });
    const c = sale({ id: "wo-c", clientName: "Anil Kumar" });
    expect(findDuplicateGroups([a, b, c])[0].key).toBe("wo-a,wo-b,wo-c");
    expect(findDuplicateGroups([c, a, b])[0].key).toBe("wo-a,wo-b,wo-c");
  });

  it("lists the keeper first, then the oldest written first", () => {
    const old = sale({ clientName: "Anil Kumar", createdAt: "2026-01-01T00:00:00Z" });
    const newest = sale({ clientName: "Anil Kumar", createdAt: "2026-03-01T00:00:00Z" });
    const keeper = sale({
      clientName: "Anil Kumar",
      createdAt: "2026-02-01T00:00:00Z",
      paymentCount: 2,
    });
    const middle = sale({ clientName: "Anil Kumar", createdAt: "2026-01-15T00:00:00Z" });
    const [group] = findDuplicateGroups([newest, middle, keeper, old]);
    expect(group.keeperId).toBe(keeper.id);
    expect(ids(group.sales)).toEqual([keeper.id, old.id, middle.id, newest.id]);
  });

  it("is the same whatever order the sales come in", () => {
    const sales = [
      sale({ clientName: "Anil Kumar", consumerNumber: "9" }),
      sale({ clientName: "Anil  Kumar" }),
      sale({ clientName: "Kumar Anil", amountReceived: 5 }),
      sale({ clientName: "Biju", orderDate: "2025-01-01" }),
      sale({ clientName: "biju", orderDate: "2025-01-01" }),
    ];
    const forward = findDuplicateGroups(sales);
    const backward = findDuplicateGroups([...sales].reverse());
    expect(backward).toEqual(forward);
  });

  it("sorts groups by the newest order date, then the kept copy's name", () => {
    const old1 = sale({ clientName: "Zeba", orderDate: "2025-01-01" });
    const old2 = sale({ clientName: "Zeba", orderDate: "2025-01-01" });
    // One copy of this group is newer than every other group's.
    const mixed1 = sale({ clientName: "Mixed", consumerNumber: "4", orderDate: "2024-01-01" });
    const mixed2 = sale({ clientName: "Other", consumerNumber: "4", orderDate: "2026-06-01" });
    const b1 = sale({ clientName: "Biju", orderDate: "2026-02-12" });
    const b2 = sale({ clientName: "Biju", orderDate: "2026-02-12" });
    const a1 = sale({ clientName: "Anil", orderDate: "2026-02-12" });
    const a2 = sale({ clientName: "Anil", orderDate: "2026-02-12" });
    const groups = findDuplicateGroups([old1, old2, b1, b2, a1, a2, mixed1, mixed2]);
    expect(groups.map((g) => g.sales[0].clientName)).toEqual(["Other", "Anil", "Biju", "Zeba"]);
  });

  describe("differences from the kept copy", () => {
    it("lists nothing for an identical copy, and never lists the keeper", () => {
      const keeper = sale({ clientName: "Anil Kumar", paymentCount: 1 });
      const copy = sale({ clientName: "Anil Kumar" });
      const [group] = findDuplicateGroups([keeper, copy]);
      expect(group.differences).toEqual({ [copy.id]: [] });
    });

    it("names every value that differs", () => {
      const keeper = sale({
        clientName: "Anil Kumar",
        consumerNumber: "55",
        isCompleted: true,
        totalCost: 235000,
        amountReceived: 100000,
        coordinatorNames: ["Rahul Menon", "Priya Suresh"],
        status: "approved",
        planType: "solar",
        orderDate: "2026-02-12",
      });
      const copy = sale({
        clientName: "Anil K",
        consumerNumber: "55",
        totalCost: 230000,
        amountReceived: 0,
        coordinatorNames: ["Rahul Menon"],
        status: "pending",
        planType: "custom",
        orderDate: "2026-02-10",
      });
      const [group] = findDuplicateGroups([copy, keeper]);
      expect(group.keeperId).toBe(keeper.id);
      expect(group.differences[copy.id]).toEqual([
        "totalCost",
        "coordinators",
        "amountReceived",
        "status",
        "plan",
        "orderDate",
        "clientName",
      ]);
    });

    it("counts the coordinators' order as a difference, as the page shows it", () => {
      const keeper = sale({ clientName: "Anil", coordinatorNames: ["A", "B"], paymentCount: 1 });
      const copy = sale({ clientName: "Anil", coordinatorNames: ["B", "A"] });
      expect(findDuplicateGroups([keeper, copy])[0].differences[copy.id]).toEqual([
        "coordinators",
      ]);
    });

    it("reads a cancelled or refunded project as its status", () => {
      const keeper = sale({ clientName: "Anil", status: "approved", paymentCount: 3 });
      const refunded = sale({ clientName: "Anil", status: "approved", cancellation: "refunded" });
      expect(findDuplicateGroups([keeper, refunded])[0].differences[refunded.id]).toEqual([
        "status",
      ]);
    });

    it("names a different consumer number only when both copies have one", () => {
      const keeper = sale({ clientName: "Anil", consumerNumber: "111", paymentCount: 1 });
      const sameTyped = sale({ clientName: "Anil", consumerNumber: "1-1-1" });
      const none = sale({ clientName: "Anil", consumerNumber: "NA" });
      const [group] = findDuplicateGroups([keeper, sameTyped, none]);
      expect(group.differences[sameTyped.id]).toEqual([]);
      expect(group.differences[none.id]).toEqual([]);
    });

    it("ignores spaces around the client's name", () => {
      const keeper = sale({ clientName: "Anil Kumar", paymentCount: 1 });
      const copy = sale({ clientName: " Anil Kumar " });
      expect(findDuplicateGroups([keeper, copy])[0].differences[copy.id]).toEqual([]);
    });
  });
});

describe("suggestKeeper", () => {
  it("is null for no copies, and the only copy of one", () => {
    expect(suggestKeeper([])).toBeNull();
    const only = sale();
    expect(suggestKeeper([only])).toBe(only);
  });

  /** Two copies alike except for `better`, which must be kept. */
  function prefers(better: Partial<CleanupSale>, worse: Partial<CleanupSale>) {
    const shared = { createdAt: "2026-02-12T00:00:00Z" };
    const a = sale({ ...shared, ...worse });
    const b = sale({ ...shared, ...better });
    expect(suggestKeeper([a, b])?.id).toBe(b.id);
    expect(suggestKeeper([b, a])?.id).toBe(b.id);
  }

  it("keeps a live copy over a cancelled or refunded one, even one that got further or was written later", () => {
    for (const cancellation of ["cancelled", "refunded"] as const) {
      prefers(
        { cancellation: null, currentStage: "site_feasibility_survey", createdAt: "2026-01-01T00:00:00Z" },
        {
          cancellation,
          isCompleted: true,
          currentStage: "plant_commissioning",
          paymentCount: 9,
          ticketCount: 9,
          amountReceived: 999999,
          status: "approved",
        },
      );
    }
  });

  it("ticks the cancelled copy, not the live one, when a sale was cancelled to get it out of the way", () => {
    // Imported twice; the office cancelled the newer copy. Nothing else differs.
    const live = sale({ clientName: "Anil Kumar", status: "approved", createdAt: "2026-02-01T00:00:00Z" });
    const cancelled = sale({
      clientName: "Anil Kumar",
      status: "approved",
      cancellation: "cancelled",
      createdAt: "2026-02-02T00:00:00Z",
    });
    const groups = findDuplicateGroups([live, cancelled]);
    expect(groups[0].keeperId).toBe(live.id);
    expect(defaultSelection(groups)).toEqual([cancelled.id]);
  });

  it("keeps a live re-sale with money over the refunded sale on the same connection", () => {
    const refunded = sale({
      clientName: "Anil Kumar",
      consumerNumber: "1156304012345",
      status: "approved",
      cancellation: "refunded",
      currentStage: "kseb_feasibility_clearance",
      paymentCount: 2,
      orderDate: "2025-06-01",
      createdAt: "2026-03-01T00:00:00Z",
    });
    const resale = sale({
      clientName: "Anil Kumar",
      consumerNumber: "1156304012345",
      status: "approved",
      currentStage: "site_feasibility_survey",
      paymentCount: 1,
      amountReceived: 50000,
      orderDate: "2025-09-01",
      createdAt: "2026-01-01T00:00:00Z",
    });
    expect(findDuplicateGroups([refunded, resale])[0].keeperId).toBe(resale.id);
  });

  it("then the most ledger entries and service tickets together — before the stage", () => {
    prefers({ paymentCount: 1, ticketCount: 2 }, { paymentCount: 2, amountReceived: 99999 });
    prefers({ ticketCount: 1 }, { amountReceived: 50000 });
    // Money recorded on a copy outranks a copy that only moved on in the pipeline.
    prefers(
      { currentStage: "site_feasibility_survey", paymentCount: 3, amountReceived: 200000 },
      { currentStage: "panel_installation" },
    );
    prefers(
      { paymentCount: 1 },
      { isCompleted: true, currentStage: "plant_commissioning" },
    );
  });

  it("counts every kind of ledger entry: KSEB fees and write-offs keep an older copy", () => {
    // The repository counts every ledger row, whatever its purpose.
    const older = sale({ clientName: "Anil", paymentCount: 3, createdAt: "2026-01-01T00:00:00Z" });
    const newer = sale({ clientName: "Anil", createdAt: "2026-02-01T00:00:00Z" });
    const groups = findDuplicateGroups([older, newer]);
    expect(groups[0].keeperId).toBe(older.id);
    expect(deletionSummary(groups, defaultSelection(groups)).ledgerEntries).toBe(0);
  });

  it("then the most money received", () => {
    prefers({ amountReceived: 20000, status: "pending" }, { amountReceived: 10000, status: "approved" });
    prefers(
      { amountReceived: 1 },
      { isCompleted: true, currentStage: "plant_commissioning" },
    );
  });

  it("then the commissioned copy", () => {
    prefers(
      { isCompleted: true, currentStage: "plant_commissioning" },
      { isCompleted: false, currentStage: "plant_commissioning", status: "approved" },
    );
  });

  it("then the project that got further", () => {
    prefers(
      { currentStage: "material_dispatch", status: "pending" },
      { currentStage: "kseb_portal_registration", status: "approved" },
    );
  });

  it("counts any stage above no project at all", () => {
    prefers(
      { currentStage: "site_feasibility_survey", projectId: "p-1" },
      { currentStage: null, status: "approved" },
    );
  });

  it("then approved over pending over rejected", () => {
    prefers({ status: "approved" }, { status: "pending" });
    prefers({ status: "pending" }, { status: "rejected" });
    prefers({ status: "approved", createdAt: "2020-01-01T00:00:00Z" }, { status: "rejected" });
  });

  it("then the newest written", () => {
    prefers({ createdAt: "2026-02-13T00:00:00Z" }, { createdAt: "2026-02-12T00:00:00Z" });
    prefers({ createdAt: "2026-02-12T00:00:00Z" }, { createdAt: "" });
  });

  it("then the id, so a full tie always keeps the same copy", () => {
    const shared = { createdAt: "2026-02-12T00:00:00Z" };
    const a = sale({ ...shared, id: "wo-a" });
    const b = sale({ ...shared, id: "wo-b" });
    expect(suggestKeeper([a, b])?.id).toBe("wo-a");
    expect(suggestKeeper([b, a])?.id).toBe("wo-a");
  });

  it("does not reorder the list it was given", () => {
    const list = [sale(), sale({ paymentCount: 1 })];
    const before = ids(list);
    suggestKeeper(list);
    expect(ids(list)).toEqual(before);
  });
});

describe("defaultSelection", () => {
  it("selects every copy but the keepers, in page order", () => {
    const g1 = [1, 2, 3].map(() => sale({ clientName: "Anil", orderDate: "2026-05-01" }));
    g1[1].paymentCount = 4;
    const g2 = [1, 2].map(() => sale({ clientName: "Biju", orderDate: "2026-01-01" }));
    const groups = findDuplicateGroups([...g1, ...g2]);
    const selection = defaultSelection(groups);
    expect(selection).toEqual([
      ...groups[0].sales.slice(1).map((s) => s.id),
      ...groups[1].sales.slice(1).map((s) => s.id),
    ]);
    expect(selection).not.toContain(groups[0].keeperId);
    expect(selection).not.toContain(groups[1].keeperId);
    expect(selection).toHaveLength(3);
  });

  it("is empty with no groups", () => {
    expect(defaultSelection([])).toEqual([]);
  });

  it("leaves another customer's sale unticked when a chain pulled it in", () => {
    // A–B: one customer on one day (B has no number); A–C: one connection, but C
    // is another customer. C has the most work, so it is suggested.
    const a = sale({ clientName: "Anil Kumar", consumerNumber: "111", orderDate: "2025-01-10" });
    const b = sale({ clientName: "Anil Kumar", orderDate: "2025-01-10" });
    const c = sale({
      clientName: "Suresh Babu",
      consumerNumber: "111",
      orderDate: "2025-04-01",
      paymentCount: 2,
    });
    const groups = findDuplicateGroups([a, b, c]);
    expect(groupIds(groups)).toEqual([[a.id, b.id, c.id].sort()]);
    expect(groups[0].keeperId).toBe(c.id);
    expect(defaultSelection(groups)).toEqual([]);
  });

  it("ticks the keeper's own copies in a chain and leaves the other customer's", () => {
    const a = sale({
      clientName: "Anil Kumar",
      consumerNumber: "111",
      orderDate: "2025-01-10",
      paymentCount: 2,
    });
    const b = sale({ clientName: "Kumar Anil", orderDate: "2025-01-10" });
    const c = sale({ clientName: "Suresh Babu", consumerNumber: "111", orderDate: "2025-04-01" });
    const groups = findDuplicateGroups([a, b, c]);
    expect(groups[0].keeperId).toBe(a.id);
    expect(defaultSelection(groups)).toEqual([b.id]);
  });

  it("leaves a copy on another connection unticked, and names the difference", () => {
    // B has no number, so it joins both; A and C are one customer's two connections.
    const a = sale({ clientName: "Anil Kumar", consumerNumber: "111", paymentCount: 2 });
    const b = sale({ clientName: "Anil Kumar" });
    const c = sale({ clientName: "Anil Kumar", consumerNumber: "222" });
    const groups = findDuplicateGroups([a, b, c]);
    expect(groupIds(groups)).toEqual([[a.id, b.id, c.id].sort()]);
    expect(groups[0].keeperId).toBe(a.id);
    expect(defaultSelection(groups)).toEqual([b.id]);
    expect(groups[0].differences[b.id]).toEqual([]);
    expect(groups[0].differences[c.id]).toEqual(["consumerNumber"]);
  });
});

describe("deletionSummary", () => {
  const keeper = sale({
    clientName: "Anil",
    projectId: "p-1",
    currentStage: "material_dispatch",
    paymentCount: 3,
    ticketCount: 1,
  });
  const copyWithWork = sale({
    clientName: "Anil",
    projectId: "p-2",
    currentStage: "site_feasibility_survey",
    paymentCount: 2,
    ticketCount: 2,
  });
  const bareCopy = sale({ clientName: "Anil" });
  const other1 = sale({ clientName: "Biju", orderDate: "2025-01-01" });
  const other2 = sale({ clientName: "Biju", orderDate: "2025-01-01", paymentCount: 1 });
  const groups = findDuplicateGroups([keeper, copyWithWork, bareCopy, other1, other2]);

  it("counts the default selection: no group is wiped", () => {
    expect(deletionSummary(groups, defaultSelection(groups))).toEqual({
      sales: 3,
      projects: 1,
      ledgerEntries: 2,
      tickets: 2,
      wholeGroups: [],
    });
  });

  it("names a group whose every copy is selected", () => {
    const all = [keeper.id, copyWithWork.id, bareCopy.id];
    const summary = deletionSummary(groups, new Set([...all, other1.id]));
    expect(summary).toEqual({
      sales: 4,
      projects: 2,
      ledgerEntries: 5,
      tickets: 3,
      wholeGroups: [groups.find((g) => g.keeperId === keeper.id)!.key],
    });
  });

  it("names several wiped groups in page order", () => {
    const every = groups.flatMap((g) => g.sales.map((s) => s.id));
    expect(deletionSummary(groups, every).wholeGroups).toEqual(groups.map((g) => g.key));
  });

  it("is all zeros for nothing selected", () => {
    expect(deletionSummary(groups, [])).toEqual({
      sales: 0,
      projects: 0,
      ledgerEntries: 0,
      tickets: 0,
      wholeGroups: [],
    });
  });

  it("ignores ids in no group and counts a repeated id once", () => {
    expect(deletionSummary(groups, ["not-a-sale", bareCopy.id, bareCopy.id]).sales).toBe(1);
  });
});

describe("parseSaleIds", () => {
  const uuid = (i: number) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;

  it("accepts a list of work-order ids", () => {
    expect(parseSaleIds([uuid(1), uuid(2)])).toEqual({ ok: true, data: [uuid(1), uuid(2)] });
  });

  it("drops repeats, whatever their case", () => {
    const upper = uuid(1).replace("4000", "4ABC");
    expect(parseSaleIds([uuid(1), uuid(1), upper, upper.toLowerCase()])).toEqual({
      ok: true,
      data: [uuid(1), upper.toLowerCase()],
    });
  });

  it("refuses an empty selection", () => {
    expect(parseSaleIds([])).toEqual({ ok: false, error: "Choose at least one sale to delete." });
  });

  it("takes exactly the limit, and refuses one more", () => {
    const most = Array.from({ length: MAX_BULK_DELETE }, (_, i) => uuid(i));
    expect(MAX_BULK_DELETE).toBe(500);
    expect(parseSaleIds(most)).toEqual({ ok: true, data: most });
    expect(parseSaleIds([...most, uuid(MAX_BULK_DELETE)])).toEqual({
      ok: false,
      error: "At most 500 sales can be deleted at once — select fewer.",
    });
  });

  it("counts the limit after repeats are dropped", () => {
    const most = Array.from({ length: MAX_BULK_DELETE }, (_, i) => uuid(i));
    expect(parseSaleIds([...most, ...most])).toEqual({ ok: true, data: most });
  });

  it.each([
    ["a non-uuid", [uuid(1), "wo-1"]],
    ["an empty string", [""]],
    ["a number", [42]],
    ["null", [null]],
    ["an object", [{ id: uuid(1) }]],
    ["a uuid with spaces", [` ${uuid(1)}`]],
    ["a SQL fragment", [`${uuid(1)}'); delete from work_orders; --`]],
  ])("refuses a list with %s", (_what, list) => {
    expect(parseSaleIds(list)).toEqual({
      ok: false,
      error: "That selection is not valid — reload the page and try again.",
    });
  });

  it.each([null, undefined, "id", 5, { ids: [] }])("refuses %j instead of a list", (input) => {
    expect(parseSaleIds(input)).toEqual({ ok: false, error: "Choose the sales to delete." });
  });
});

describe("parseKeepGroups", () => {
  const uuid = (i: number) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
  const INVALID = {
    ok: false,
    error: "That selection is not valid — reload the page and try again.",
  };

  it("accepts groups of work-order ids, lower-cased and each once", () => {
    expect(parseKeepGroups([[uuid(1)], [uuid(2), uuid(3).toUpperCase(), uuid(3)]])).toEqual({
      ok: true,
      data: [[uuid(1)], [uuid(2), uuid(3)]],
    });
    expect(parseKeepGroups([])).toEqual({ ok: true, data: [] });
  });

  it("takes exactly MAX_KEEP_IDS ids in all, and refuses one more", () => {
    expect(MAX_KEEP_IDS).toBe(5000);
    const groups = Array.from({ length: 50 }, (_, g) =>
      Array.from({ length: 100 }, (_, i) => uuid(g * 100 + i)),
    );
    expect(parseKeepGroups(groups)).toMatchObject({ ok: true });
    expect(parseKeepGroups([...groups, [uuid(99999)]])).toEqual(INVALID);
  });

  it.each([
    ["not a list", "keep"],
    ["null", null],
    ["undefined", undefined],
    ["a group that is not a list", [uuid(1)]],
    ["an empty group", [[]]],
    ["a non-uuid", [[uuid(1), "wo-1"]]],
    ["a number", [[42]]],
  ])("refuses %s", (_what, input) => {
    expect(parseKeepGroups(input)).toEqual(INVALID);
  });
});

describe("groupsLeftEmpty", () => {
  it("is empty when every group still has a copy that is not being deleted", () => {
    expect(groupsLeftEmpty([["a"], ["b", "c"]], ["a", "c"], ["x"])).toEqual([]);
  });

  it("names a group none of whose copies still exist", () => {
    expect(groupsLeftEmpty([["a"], ["b", "c"]], ["a"], [])).toEqual([["b", "c"]]);
  });

  it("does not count a copy that is about to be deleted too", () => {
    expect(groupsLeftEmpty([["a", "b"]], ["a", "b"], ["a", "b"])).toEqual([["a", "b"]]);
    expect(groupsLeftEmpty([["a", "b"]], ["a", "b"], ["a"])).toEqual([]);
  });

  it("is empty for nothing to keep", () => {
    expect(groupsLeftEmpty([], [], ["a"])).toEqual([]);
  });
});
