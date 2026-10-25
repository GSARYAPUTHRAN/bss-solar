import { describe, it, expect } from "vitest";
import { addDays, diffDays, istDateOf } from "./dates";
import { feasibilityPeriods, feasibilityStatus, KSEB_FEES } from "./kseb";
import { PLAN_TYPES } from "./plan";
import {
  FEASIBILITY_FILTERS,
  INCENTIVE_STATE,
  PLAN_FILTERS,
  PROJECT_LIST_FILTER_KEYS,
  PROJECT_SORT_COLUMNS,
  PROJECT_STATUS_FILTERS,
  PROJECT_STATUS_FILTER_LABELS,
  incentiveState,
  isFeasibilityFilter,
  isIncentiveFilter,
  isPlanFilter,
  isProjectSortColumn,
  isProjectStatusFilter,
  listRowFeasibility,
  listRowProgress,
  matchesCoordinator,
  matchesFeasibilityFilter,
  matchesIncentiveFilter,
  matchesProjectStatus,
  matchesSaleIncentiveFilter,
  saleIncentiveState,
  type FeasibilityColumns,
} from "./project-list";
import type { PlanType, ProjectCancellation, ProjectListRow } from "@/lib/types";

const TODAY = "2026-10-10";

/**
 * A `projects_list` row's feasibility columns as the view computes them
 * (migrations 20261010120600 and 20261022120200): the clock runs to
 * commissioning (its IST date) or cancellation, whichever came first, or today;
 * days-left is null once commissioned or cancelled / refunded.
 */
function viewRow(
  feasibilityDate: string | null,
  completedAt: string | null = null,
  {
    cancellation = null,
    cancelledOn = null,
    plan = "solar",
  }: {
    cancellation?: ProjectCancellation | null;
    cancelledOn?: string | null;
    plan?: PlanType;
  } = {},
): FeasibilityColumns {
  const isCompleted = completedAt !== null;
  const common = { is_completed: isCompleted, cancellation, plan_type: plan };
  if (!feasibilityDate) {
    return {
      ...common,
      feasibility_date: null,
      feasibility_periods: null,
      feasibility_renewals: null,
      feasibility_valid_until: null,
      feasibility_days_left: null,
      feasibility_extension_cost: 0,
    };
  }
  const stopped = [completedAt ? istDateOf(completedAt) : null, cancelledOn]
    .filter((d): d is string => d !== null)
    .sort()[0];
  const periods = feasibilityPeriods(feasibilityDate, stopped ?? TODAY);
  const validUntil = addDays(feasibilityDate, periods * KSEB_FEES.feasibilityValidityDays);
  return {
    ...common,
    feasibility_date: feasibilityDate,
    feasibility_periods: periods,
    feasibility_renewals: periods - 1,
    feasibility_valid_until: validUntil,
    feasibility_days_left:
      isCompleted || cancellation !== null ? null : diffDays(TODAY, validUntil),
    feasibility_extension_cost: (periods - 1) * KSEB_FEES.feasibilityRenewalFee,
  };
}

describe("listRowFeasibility", () => {
  // Every day from 100 days ago to 10 days ahead, active and commissioned: the
  // classification of the view's columns must equal kseb.ts's own answer.
  const offsets = Array.from({ length: 111 }, (_, i) => i - 100);

  it.each(offsets)("matches feasibilityStatus for an active project started %i days from today", (offset) => {
    const start = addDays(TODAY, offset);
    expect(listRowFeasibility(viewRow(start))).toEqual(
      feasibilityStatus({ feasibilityDate: start, today: TODAY }),
    );
  });

  it.each(offsets.filter((o) => o <= -5))(
    "matches feasibilityStatus for a project commissioned after starting %i days from today",
    (offset) => {
      const start = addDays(TODAY, offset);
      // Commissioned at 23:00 IST two days ago — the next UTC day is still the
      // same IST date, which is what the view uses.
      const completedAt = `${addDays(TODAY, -2)}T17:30:00.000Z`;
      expect(listRowFeasibility(viewRow(start, completedAt))).toEqual(
        feasibilityStatus({
          feasibilityDate: start,
          completedAt,
          isCompleted: true,
          today: TODAY,
        }),
      );
    },
  );

  // A cancelled / refunded project's clock stops on cancelled_on. Every pairing
  // of a feasibility start and a cancellation day, against kseb.ts.
  it("matches feasibilityStatus for a cancelled or refunded project", () => {
    for (const cancellation of ["cancelled", "refunded"] as const) {
      for (const start of [-100, -75, -40, -31, -30, -10, -1, 0].map((o) => addDays(TODAY, o))) {
        for (const stop of [-80, -45, -29, -5, 0, 3].map((o) => addDays(TODAY, o))) {
          expect(
            listRowFeasibility(viewRow(start, null, { cancellation, cancelledOn: stop })),
          ).toEqual(
            feasibilityStatus({
              feasibilityDate: start,
              cancelledOn: stop,
              isCancelled: true,
              today: TODAY,
            }),
          );
        }
      }
    }
  });

  it("matches feasibilityStatus when commissioned and cancelled — the earlier date stops the clock", () => {
    const start = addDays(TODAY, -90);
    const completedAt = `${addDays(TODAY, -50)}T06:00:00Z`;
    const cancelledOn = addDays(TODAY, -20);
    expect(
      listRowFeasibility(viewRow(start, completedAt, { cancellation: "cancelled", cancelledOn })),
    ).toEqual(
      feasibilityStatus({
        feasibilityDate: start,
        completedAt,
        isCompleted: true,
        cancelledOn,
        isCancelled: true,
        today: TODAY,
      }),
    );
  });

  it("is closed — never expiring — for a cancelled project inside the warning window", () => {
    // 5 days left had it stayed live.
    const live = viewRow(addDays(TODAY, -25));
    expect(listRowFeasibility(live).state).toBe("expiring");
    const cancelled = viewRow(addDays(TODAY, -25), null, {
      cancellation: "refunded",
      cancelledOn: addDays(TODAY, -3),
    });
    expect(listRowFeasibility(cancelled)).toMatchObject({ state: "closed", daysLeft: null });
  });

  it("is closed for a cancelled row even when a stale days-left is still present", () => {
    const row: FeasibilityColumns = {
      ...viewRow(addDays(TODAY, -25)),
      cancellation: "cancelled",
    };
    expect(row.feasibility_days_left).toBe(5);
    expect(listRowFeasibility(row)).toMatchObject({ state: "closed", daysLeft: null });
  });

  it("is not_set without a feasibility date", () => {
    expect(listRowFeasibility(viewRow(null)).state).toBe("not_set");
    expect(listRowFeasibility(viewRow(null, `${TODAY}T05:00:00Z`)).state).toBe("not_set");
    expect(
      listRowFeasibility(viewRow(null, null, { cancellation: "cancelled" })).state,
    ).toBe("not_set");
    expect(listRowFeasibility(viewRow(null, null, { plan: "custom" })).state).toBe("not_set");
  });

  it("coerces a numeric-string extension cost", () => {
    const row = { ...viewRow(addDays(TODAY, -45)), feasibility_extension_cost: "1000.00" };
    expect(listRowFeasibility(row as unknown as FeasibilityColumns).extensionCost).toBe(1000);
  });
});

describe("matchesFeasibilityFilter", () => {
  const expiring = viewRow(addDays(TODAY, -25)); // 5 days left
  const extended = viewRow(addDays(TODAY, -40)); // 2nd period, 20 days left
  const onTrack = viewRow(addDays(TODAY, -10));
  const notSet = viewRow(null);

  it("selects the expiring clock", () => {
    expect(matchesFeasibilityFilter(expiring, "expiring")).toBe(true);
    expect(matchesFeasibilityFilter(onTrack, "expiring")).toBe(false);
    expect(matchesFeasibilityFilter(extended, "expiring")).toBe(false);
  });

  it("selects projects in a renewed period", () => {
    expect(matchesFeasibilityFilter(extended, "extended")).toBe(true);
    expect(matchesFeasibilityFilter(onTrack, "extended")).toBe(false);
  });

  it("selects active projects with no date", () => {
    expect(matchesFeasibilityFilter(notSet, "not_set")).toBe(true);
    expect(matchesFeasibilityFilter(onTrack, "not_set")).toBe(false);
  });

  it("never selects a cancelled or refunded project as expiring or missing its date", () => {
    for (const cancellation of ["cancelled", "refunded"] as const) {
      const expiringButCancelled = viewRow(addDays(TODAY, -25), null, {
        cancellation,
        cancelledOn: addDays(TODAY, -3),
      });
      expect(matchesFeasibilityFilter(expiringButCancelled, "expiring")).toBe(false);
      // …even a row that still carries the days-left it had before.
      expect(
        matchesFeasibilityFilter(
          { ...viewRow(addDays(TODAY, -25)), cancellation },
          "expiring",
        ),
      ).toBe(false);
      expect(
        matchesFeasibilityFilter(viewRow(null, null, { cancellation }), "not_set"),
      ).toBe(false);
    }
  });

  it("still lists a cancelled project whose renewals BSS already paid as extended", () => {
    const cancelled = viewRow(addDays(TODAY, -90), null, {
      cancellation: "refunded",
      cancelledOn: addDays(TODAY, -20),
    });
    expect(cancelled.feasibility_renewals).toBeGreaterThan(0);
    expect(matchesFeasibilityFilter(cancelled, "extended")).toBe(true);
  });

  it("does not miss a feasibility date on a custom plan, which has none", () => {
    expect(matchesFeasibilityFilter(viewRow(null, null, { plan: "custom" }), "not_set")).toBe(
      false,
    );
    expect(matchesFeasibilityFilter(viewRow(null, null, { plan: "solar" }), "not_set")).toBe(true);
  });

  it("never selects a commissioned project without renewals — its clock has stopped", () => {
    const done = viewRow(addDays(TODAY, -20), `${addDays(TODAY, -1)}T06:00:00Z`);
    const doneNoDate = viewRow(null, `${TODAY}T06:00:00Z`);
    for (const filter of FEASIBILITY_FILTERS) {
      expect(matchesFeasibilityFilter(done, filter)).toBe(false);
      expect(matchesFeasibilityFilter(doneNoDate, filter)).toBe(false);
    }
  });

  it("selects a commissioned project whose renewals BSS paid as extended", () => {
    // Commissioned in its second validity period: one renewal fee was borne.
    const renewed = viewRow(addDays(TODAY, -60), `${addDays(TODAY, -1)}T06:00:00Z`);
    expect(renewed.feasibility_renewals).toBeGreaterThan(0);
    expect(matchesFeasibilityFilter(renewed, "extended")).toBe(true);
    expect(matchesFeasibilityFilter(renewed, "expiring")).toBe(false);
  });

  it("lists every project behind the dashboard's extension cost, which counts them all", () => {
    const rows: FeasibilityColumns[] = [viewRow(null), viewRow(null, `${TODAY}T06:00:00Z`)];
    for (let offset = -100; offset <= 0; offset += 5) {
      rows.push(viewRow(addDays(TODAY, offset)));
      rows.push(viewRow(addDays(TODAY, offset), `${TODAY}T06:00:00Z`));
      // Renewal fees already borne stay a cost after a cancellation.
      rows.push(
        viewRow(addDays(TODAY, offset), null, {
          cancellation: "refunded",
          cancelledOn: addDays(TODAY, Math.min(offset + 40, 0)),
        }),
      );
    }
    const cost = (list: FeasibilityColumns[]) =>
      list.reduce((sum, r) => sum + Number(r.feasibility_extension_cost), 0);

    const extended = rows.filter((r) => matchesFeasibilityFilter(r, "extended"));
    expect(extended.some((r) => r.is_completed)).toBe(true);
    expect(cost(rows)).toBeGreaterThan(0);
    expect(cost(extended)).toBe(cost(rows));
  });

  it("agrees with the badge for every expiring row", () => {
    for (let offset = -100; offset <= 10; offset++) {
      const row = viewRow(addDays(TODAY, offset));
      expect(matchesFeasibilityFilter(row, "expiring")).toBe(
        listRowFeasibility(row).state === "expiring",
      );
    }
  });
});

describe("filter guards", () => {
  it("accept only the shared URL values", () => {
    expect(isFeasibilityFilter("expiring")).toBe(true);
    expect(isFeasibilityFilter("soon")).toBe(false);
    expect(isFeasibilityFilter(undefined)).toBe(false);
    expect(isIncentiveFilter("paid")).toBe(true);
    expect(isIncentiveFilter("all")).toBe(false);
    expect(isProjectStatusFilter("payment_pending")).toBe(true);
    expect(isProjectStatusFilter("")).toBe(false);
  });

  it("know the cancelled, refunded and closed statuses", () => {
    for (const status of ["cancelled", "refunded", "closed"]) {
      expect(isProjectStatusFilter(status)).toBe(true);
    }
    expect(isProjectStatusFilter("canceled")).toBe(false);
  });

  it("know the two plans", () => {
    expect(isPlanFilter("solar")).toBe(true);
    expect(isPlanFilter("custom")).toBe(true);
    expect(isPlanFilter("all")).toBe(false);
    expect(isPlanFilter(null)).toBe(false);
    expect([...PLAN_FILTERS]).toEqual([...PLAN_TYPES]);
  });

  it("read `plan` from the URL with the other list filters", () => {
    expect(PROJECT_LIST_FILTER_KEYS).toEqual([
      "status",
      "stage",
      "coordinator",
      "financing",
      "feasibility",
      "incentive",
      "plan",
    ]);
  });
});

describe("PROJECT_STATUS_FILTERS", () => {
  it("is every state a project can be filtered by, each with its label", () => {
    expect([...PROJECT_STATUS_FILTERS]).toEqual([
      "active",
      "completed",
      "payment_pending",
      "cancelled",
      "refunded",
      "closed",
    ]);
    expect(PROJECT_STATUS_FILTER_LABELS).toEqual({
      active: "Active",
      completed: "Commissioned",
      payment_pending: "Commissioned · payment pending",
      cancelled: "Cancelled",
      refunded: "Refunded",
      closed: "Cancelled or refunded",
    });
  });
});

describe("PROJECT_SORT_COLUMNS", () => {
  it("sorts by the sale's incentive total, not the old single-incentive column", () => {
    expect(PROJECT_SORT_COLUMNS).toContain("incentive_total");
    expect(PROJECT_SORT_COLUMNS).not.toContain("coordinator_incentive");
  });

  it("is the set the list's sortable columns send", () => {
    expect([...PROJECT_SORT_COLUMNS]).toEqual([
      "created_at",
      "client_name",
      "coordinator_name",
      "current_stage",
      "balance_due",
      "feasibility_days_left",
      "incentive_total",
    ]);
  });

  it("accepts only those columns from the URL", () => {
    for (const column of PROJECT_SORT_COLUMNS) expect(isProjectSortColumn(column)).toBe(true);
    for (const value of ["coordinator_incentive", "id; drop table", "", null, undefined]) {
      expect(isProjectSortColumn(value)).toBe(false);
    }
  });
});

describe("matchesProjectStatus", () => {
  type Row = Pick<ProjectListRow, "is_completed" | "payment_pending" | "cancellation">;
  const live: Row = { is_completed: false, payment_pending: false, cancellation: null };
  const commissioned: Row = { is_completed: true, payment_pending: false, cancellation: null };
  const unpaid: Row = { is_completed: true, payment_pending: true, cancellation: null };
  const cancelled: Row = { is_completed: false, payment_pending: false, cancellation: "cancelled" };
  const refunded: Row = { is_completed: false, payment_pending: false, cancellation: "refunded" };
  // Commissioned, then refunded: leaves both the commissioned count and pending payments.
  const commissionedThenRefunded: Row = {
    is_completed: true,
    payment_pending: false,
    cancellation: "refunded",
  };

  const selected = (row: Row) =>
    PROJECT_STATUS_FILTERS.filter((filter) => matchesProjectStatus(row, filter));

  it("puts each kind of project in exactly the filters it belongs to", () => {
    expect(selected(live)).toEqual(["active"]);
    expect(selected(commissioned)).toEqual(["completed"]);
    expect(selected(unpaid)).toEqual(["completed", "payment_pending"]);
    expect(selected(cancelled)).toEqual(["cancelled", "closed"]);
    expect(selected(refunded)).toEqual(["refunded", "closed"]);
    expect(selected(commissionedThenRefunded)).toEqual(["refunded", "closed"]);
  });

  it("keeps cancelled and refunded projects out of active and commissioned", () => {
    for (const row of [cancelled, refunded, commissionedThenRefunded]) {
      expect(matchesProjectStatus(row, "active")).toBe(false);
      expect(matchesProjectStatus(row, "completed")).toBe(false);
    }
  });

  it("never lists a cancelled project as payment pending, whatever the view said", () => {
    expect(
      matchesProjectStatus({ ...cancelled, payment_pending: true }, "payment_pending"),
    ).toBe(false);
  });

  it("treats a null payment_pending as not pending", () => {
    expect(matchesProjectStatus({ ...commissioned, payment_pending: null }, "payment_pending")).toBe(
      false,
    );
  });
});

describe("matchesCoordinator", () => {
  it("matches any member of the sale", () => {
    const row = { coordinator_ids: ["rahul", "priya"] };
    expect(matchesCoordinator(row, "rahul")).toBe(true);
    expect(matchesCoordinator(row, "priya")).toBe(true);
    expect(matchesCoordinator(row, "arun")).toBe(false);
  });

  it("matches nobody on a row with no team", () => {
    expect(matchesCoordinator({ coordinator_ids: [] }, "rahul")).toBe(false);
    expect(matchesCoordinator({ coordinator_ids: null }, "rahul")).toBe(false);
  });
});

describe("incentives", () => {
  it("derives the state from amount and paid-on", () => {
    expect(incentiveState({ coordinator_incentive: null, incentive_paid_on: null })).toBe(
      "not_set",
    );
    expect(incentiveState({ coordinator_incentive: 0, incentive_paid_on: null })).toBe(
      "pending",
    );
    expect(
      incentiveState({ coordinator_incentive: 3000, incentive_paid_on: "2026-10-01" }),
    ).toBe("paid");
  });

  it("filters by state", () => {
    const pending = { coordinator_incentive: 3000, incentive_paid_on: null };
    expect(matchesIncentiveFilter(pending, "pending")).toBe(true);
    expect(matchesIncentiveFilter(pending, "paid")).toBe(false);
    expect(
      matchesIncentiveFilter({ coordinator_incentive: null, incentive_paid_on: null }, "pending"),
    ).toBe(false);
  });

  it("never calls one person's incentive partly paid", () => {
    for (const row of [
      { coordinator_incentive: null, incentive_paid_on: null },
      { coordinator_incentive: 0, incentive_paid_on: null },
      { coordinator_incentive: 3000, incentive_paid_on: "2026-10-01" },
    ]) {
      expect(incentiveState(row)).not.toBe("partly_paid");
    }
  });

  it("labels the partly paid state in blue between pending and paid", () => {
    expect(INCENTIVE_STATE.partly_paid).toEqual({
      label: "Partly paid",
      badgeClass: expect.stringContaining("blue"),
    });
    expect(Object.keys(INCENTIVE_STATE)).toEqual(["not_set", "pending", "partly_paid", "paid"]);
  });
});

describe("saleIncentiveState", () => {
  const state = (incentive_count: number, incentive_unpaid_count: number) =>
    saleIncentiveState({ incentive_count, incentive_unpaid_count });

  it("is not set when nobody has an incentive", () => {
    expect(state(0, 0)).toBe("not_set");
  });

  it("is pending while none of them has been paid", () => {
    expect(state(1, 1)).toBe("pending");
    expect(state(3, 3)).toBe("pending");
  });

  it("is partly paid when some have been and some have not", () => {
    expect(state(2, 1)).toBe("partly_paid");
    expect(state(3, 1)).toBe("partly_paid");
    expect(state(3, 2)).toBe("partly_paid");
  });

  it("is paid when every incentive that is set has been paid", () => {
    expect(state(1, 0)).toBe("paid");
    expect(state(3, 0)).toBe("paid");
  });

  it("coerces counts that arrive as strings or are missing", () => {
    const row = { incentive_count: "2", incentive_unpaid_count: "1" } as unknown as {
      incentive_count: number;
      incentive_unpaid_count: number;
    };
    expect(saleIncentiveState(row)).toBe("partly_paid");
    const blank = {} as { incentive_count: number; incentive_unpaid_count: number };
    expect(saleIncentiveState(blank)).toBe("not_set");
  });
});

describe("matchesSaleIncentiveFilter", () => {
  type Row = Parameters<typeof matchesSaleIncentiveFilter>[0];
  const none: Row = {
    incentive_count: 0,
    incentive_unpaid_count: 0,
    incentive_unpaid_coordinator_ids: [],
    incentive_paid_coordinator_ids: [],
  };
  const allUnpaid: Row = {
    incentive_count: 2,
    incentive_unpaid_count: 2,
    incentive_unpaid_coordinator_ids: ["rahul", "priya"],
    incentive_paid_coordinator_ids: [],
  };
  const partly: Row = {
    incentive_count: 2,
    incentive_unpaid_count: 1,
    incentive_unpaid_coordinator_ids: ["priya"],
    incentive_paid_coordinator_ids: ["rahul"],
  };
  const allPaid: Row = {
    incentive_count: 2,
    incentive_unpaid_count: 0,
    incentive_unpaid_coordinator_ids: [],
    incentive_paid_coordinator_ids: ["rahul", "priya"],
  };

  describe("on the whole sale", () => {
    it("pending is any unpaid incentive — a partly paid sale still has one", () => {
      expect(matchesSaleIncentiveFilter(allUnpaid, "pending")).toBe(true);
      expect(matchesSaleIncentiveFilter(partly, "pending")).toBe(true);
      expect(matchesSaleIncentiveFilter(allPaid, "pending")).toBe(false);
      expect(matchesSaleIncentiveFilter(none, "pending")).toBe(false);
    });

    it("paid needs an incentive set and none unpaid", () => {
      expect(matchesSaleIncentiveFilter(allPaid, "paid")).toBe(true);
      expect(matchesSaleIncentiveFilter(partly, "paid")).toBe(false);
      expect(matchesSaleIncentiveFilter(allUnpaid, "paid")).toBe(false);
      expect(matchesSaleIncentiveFilter(none, "paid")).toBe(false);
    });

    it("treats a blank or null coordinator as the whole sale", () => {
      expect(matchesSaleIncentiveFilter(partly, "pending", null)).toBe(true);
      expect(matchesSaleIncentiveFilter(partly, "pending", "")).toBe(true);
      expect(matchesSaleIncentiveFilter(partly, "paid", undefined)).toBe(false);
    });
  });

  describe("narrowed to one coordinator", () => {
    it("pending is that person's own unpaid incentive", () => {
      expect(matchesSaleIncentiveFilter(partly, "pending", "priya")).toBe(true);
      expect(matchesSaleIncentiveFilter(partly, "pending", "rahul")).toBe(false);
      expect(matchesSaleIncentiveFilter(allUnpaid, "pending", "rahul")).toBe(true);
    });

    it("paid is that person's own paid incentive", () => {
      expect(matchesSaleIncentiveFilter(partly, "paid", "rahul")).toBe(true);
      expect(matchesSaleIncentiveFilter(partly, "paid", "priya")).toBe(false);
      expect(matchesSaleIncentiveFilter(allPaid, "paid", "priya")).toBe(true);
    });

    it("matches nothing for someone with no incentive on the sale", () => {
      for (const filter of ["pending", "paid"] as const) {
        expect(matchesSaleIncentiveFilter(partly, filter, "arun")).toBe(false);
        expect(matchesSaleIncentiveFilter(none, filter, "rahul")).toBe(false);
      }
    });
  });

  it("agrees with saleIncentiveState for the whole-sale filters", () => {
    for (const row of [none, allUnpaid, partly, allPaid]) {
      const s = saleIncentiveState(row);
      expect(matchesSaleIncentiveFilter(row, "pending")).toBe(s === "pending" || s === "partly_paid");
      expect(matchesSaleIncentiveFilter(row, "paid")).toBe(s === "paid");
    }
  });
});

describe("listRowProgress", () => {
  it("uses the view's counts", () => {
    expect(listRowProgress({ milestones_done: 3, milestones_total: 9 })).toEqual({
      done: 3,
      total: 9,
      pct: 33,
    });
  });

  it("falls back to the nine standard stages when the count is missing", () => {
    expect(listRowProgress({ milestones_done: 0, milestones_total: 0 })).toEqual({
      done: 0,
      total: 9,
      pct: 0,
    });
  });

  it("coerces bigint counts that arrive as strings, and never exceeds 100%", () => {
    const row = { milestones_done: "12", milestones_total: "9" } as unknown as {
      milestones_done: number;
      milestones_total: number;
    };
    expect(listRowProgress(row)).toEqual({ done: 9, total: 9, pct: 100 });
  });
});
