import { describe, it, expect } from "vitest";
import { addDays, diffDays, istDateOf } from "./dates";
import { feasibilityPeriods, feasibilityStatus, KSEB_FEES } from "./kseb";
import {
  FEASIBILITY_FILTERS,
  incentiveState,
  isFeasibilityFilter,
  isIncentiveFilter,
  isProjectStatusFilter,
  listRowFeasibility,
  listRowProgress,
  matchesFeasibilityFilter,
  matchesIncentiveFilter,
  type FeasibilityColumns,
} from "./project-list";

const TODAY = "2026-10-10";

/**
 * A `projects_list` row's feasibility columns as the view computes them
 * (migration 20261010120600): the clock runs to commissioning (its IST date)
 * or today, and days-left is null once commissioned.
 */
function viewRow(
  feasibilityDate: string | null,
  completedAt: string | null = null,
): FeasibilityColumns {
  const isCompleted = completedAt !== null;
  if (!feasibilityDate) {
    return {
      is_completed: isCompleted,
      feasibility_date: null,
      feasibility_periods: null,
      feasibility_renewals: null,
      feasibility_valid_until: null,
      feasibility_days_left: null,
      feasibility_extension_cost: 0,
    };
  }
  const asOf = completedAt ? istDateOf(completedAt) : TODAY;
  const periods = feasibilityPeriods(feasibilityDate, asOf);
  const validUntil = addDays(feasibilityDate, periods * KSEB_FEES.feasibilityValidityDays);
  return {
    is_completed: isCompleted,
    feasibility_date: feasibilityDate,
    feasibility_periods: periods,
    feasibility_renewals: periods - 1,
    feasibility_valid_until: validUntil,
    feasibility_days_left: isCompleted ? null : diffDays(TODAY, validUntil),
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

  it("is not_set without a feasibility date", () => {
    expect(listRowFeasibility(viewRow(null)).state).toBe("not_set");
    expect(listRowFeasibility(viewRow(null, `${TODAY}T05:00:00Z`)).state).toBe("not_set");
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
