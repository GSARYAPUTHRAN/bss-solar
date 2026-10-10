import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { istToday, serviceClient, signedInAs, USERS, withDb } from "./helpers";
import { createFixtures, must } from "./fixtures";
import {
  FEASIBILITY_WARNING_DAYS,
  KSEB_FEES,
  feasibilityPeriods,
  feasibilityStatus,
  type FeasibilityState,
} from "@/lib/domain/kseb";
import { addDays } from "@/lib/domain/dates";
import { todayISO } from "@/lib/format";

/**
 * The KSEB feasibility clock exists twice: in SQL (`feasibility_periods()`, the
 * `projects_list` columns, the dashboard KPIs — migrations 20261010120300/0600)
 * and in `lib/domain/kseb.ts`, which pages use to badge a project. A day of
 * drift between them means a project shows "valid" while the daily alert says
 * "expiring", or BSS's renewal cost is mis-reported. These tests pin the two
 * together, using the database's own IST "today".
 */
const svc = serviceClient();
const fx = createFixtures(svc);

/** Elapsed-day boundaries around each 30-day validity period. */
const ELAPSED = [0, 1, 29, 30, 31, 59, 60, 61, 89, 90, 91, 365];
/** Starts across a leap February, a month end and a year end. */
const STARTS = ["2024-02-15", "2026-01-31", "2026-12-20"];

describe("feasibility_periods() ≡ feasibilityPeriods()", () => {
  it("agrees over a grid of start / as-of dates, including future starts", async () => {
    const pairs = STARTS.flatMap((start) => [
      ...ELAPSED.map((d) => [start, addDays(start, d)] as const),
      // A feasibility dated in the future is still in its first period.
      [start, addDays(start, -1)] as const,
      [start, addDays(start, -30)] as const,
    ]);

    const { rows } = await withDb((db) =>
      db.query<{ started: string; as_of: string; periods: number }>(
        `select g.started::text, g.as_of::text,
                public.feasibility_periods(g.started, g.as_of) as periods
           from unnest($1::date[], $2::date[]) with ordinality as g(started, as_of, n)
          order by g.n`,
        [pairs.map(([s]) => s), pairs.map(([, a]) => a)],
      ),
    );

    expect(rows).toHaveLength(pairs.length);
    for (const row of rows) {
      expect({
        ...row,
        app: feasibilityPeriods(row.started, row.as_of),
      }).toEqual({
        ...row,
        app: row.periods,
      });
    }
  });

  it("is null when either date is missing — the app's not_set state", async () => {
    const { rows } = await withDb((db) =>
      db.query<{ a: number | null; b: number | null; c: number | null }>(
        `select public.feasibility_periods(null, '2026-01-01') as a,
                public.feasibility_periods('2026-01-01', null) as b,
                public.feasibility_periods(null, null) as c`,
      ),
    );
    expect(rows[0]).toEqual({ a: null, b: null, c: null });
    expect(
      feasibilityStatus({ feasibilityDate: null, today: "2026-01-01" }),
    ).toMatchObject({
      state: "not_set",
      periods: null,
    });
  });

  it("uses the same validity and renewal fee as the app", async () => {
    const svcDays = must(
      await svc.rpc("feasibility_validity_days"),
      "validity days",
    );
    const svcFee = must(
      await svc.rpc("feasibility_renewal_fee"),
      "renewal fee",
    );
    expect(svcDays).toBe(KSEB_FEES.feasibilityValidityDays);
    expect(Number(svcFee)).toBe(KSEB_FEES.feasibilityRenewalFee);
  });

  it("ist_today() is the app's todayISO()", async () => {
    expect(await istToday()).toBe(todayISO());
  });
});

describe("projects_list feasibility columns ≡ feasibilityStatus()", () => {
  let today = "";
  /** Fixture client name → the state the business rules say it must be in. */
  const expected = new Map<
    string,
    {
      state: FeasibilityState;
      daysLeft: number | null;
      renewals: number | null;
    }
  >();

  async function project(
    name: string,
    feasibilityDate: string | null,
    want: {
      state: FeasibilityState;
      daysLeft: number | null;
      renewals: number | null;
    },
    completedAt: string | null = null,
  ) {
    expected.set(name, want);
    await fx.approvedProject({
      workOrder: { client_name: name },
      project: {
        feasibility_date: feasibilityDate,
        ...(completedAt && {
          is_completed: true,
          current_stage: "plant_commissioning",
          completed_at: completedAt,
        }),
      },
    });
  }

  beforeAll(async () => {
    today = await istToday();
    const ago = (days: number) => addDays(today, -days);
    const warn = FEASIBILITY_WARNING_DAYS;

    await project("Feasibility Fresh", today, {
      state: "on_track",
      daysLeft: 30,
      renewals: 0,
    });
    await project("Feasibility Warning Edge", ago(30 - warn), {
      state: "expiring",
      daysLeft: warn,
      renewals: 0,
    });
    await project("Feasibility Before Warning", ago(30 - warn - 1), {
      state: "on_track",
      daysLeft: warn + 1,
      renewals: 0,
    });
    await project("Feasibility Last Day", ago(30), {
      state: "expiring",
      daysLeft: 0,
      renewals: 0,
    });
    await project("Feasibility Renewed Once", ago(31), {
      state: "extended",
      daysLeft: 29,
      renewals: 1,
    });
    await project("Feasibility Renewed Twice", ago(61), {
      state: "extended",
      daysLeft: 29,
      renewals: 2,
    });
    await project("Feasibility Future", addDays(today, 5), {
      state: "on_track",
      daysLeft: 35,
      renewals: 0,
    });
    await project("Feasibility Not Set", null, {
      state: "not_set",
      daysLeft: null,
      renewals: null,
    });
    // Commissioned at 01:30 IST on day 31 — still day 30 in UTC. The clock
    // stops on the IST date, so this is a second period (one BSS renewal).
    const start = ago(200);
    await project(
      "Feasibility Commissioned IST",
      start,
      { state: "closed", daysLeft: null, renewals: 1 },
      `${addDays(start, 30)}T20:00:00Z`,
    );
  });

  afterAll(() => fx.cleanup());

  it("agrees for every project, row for row", async () => {
    const rows = must(
      await svc
        .from("projects_list")
        .select(
          "client_name, is_completed, completed_at, feasibility_date, feasibility_periods, feasibility_renewals, feasibility_valid_until, feasibility_days_left, feasibility_extension_cost",
        ),
      "projects_list",
    );
    expect(rows.length).toBeGreaterThan(expected.size);

    for (const row of rows) {
      const app = feasibilityStatus({
        feasibilityDate: row.feasibility_date,
        completedAt: row.completed_at,
        isCompleted: row.is_completed,
        today,
      });
      expect({
        client: row.client_name,
        periods: row.feasibility_periods,
        // SQL has no renewals for a project without a date; the app says 0.
        renewals: row.feasibility_renewals ?? 0,
        validUntil: row.feasibility_valid_until,
        daysLeft: row.feasibility_days_left,
        extensionCost: Number(row.feasibility_extension_cost),
      }).toEqual({
        client: row.client_name,
        periods: app.periods,
        renewals: app.renewals,
        validUntil: app.validUntil,
        daysLeft: app.daysLeft,
        extensionCost: app.extensionCost,
      });
    }
  });

  it("puts each boundary case in the state the business rules require", async () => {
    const rows = must(
      await svc
        .from("projects_list")
        .select(
          "client_name, is_completed, completed_at, feasibility_date, feasibility_renewals, feasibility_days_left, feasibility_extension_cost",
        )
        .in("client_name", [...expected.keys()]),
      "fixture projects",
    );
    expect(rows).toHaveLength(expected.size);

    for (const row of rows) {
      const want = expected.get(row.client_name!)!;
      const app = feasibilityStatus({
        feasibilityDate: row.feasibility_date,
        completedAt: row.completed_at,
        isCompleted: row.is_completed,
        today,
      });
      expect({ client: row.client_name, state: app.state }).toEqual({
        client: row.client_name,
        state: want.state,
      });
      expect(row.feasibility_days_left).toBe(want.daysLeft);
      expect(row.feasibility_renewals).toBe(want.renewals);
      expect(Number(row.feasibility_extension_cost)).toBe(
        (want.renewals ?? 0) * KSEB_FEES.feasibilityRenewalFee,
      );
    }
  });

  it("dashboard feasibility and incentive KPIs agree with the app's rules", async () => {
    const admin = await signedInAs(USERS.admin);
    const m = must(
      await admin.rpc("dashboard_metrics").single(),
      "dashboard_metrics",
    );

    const projects = must(
      await svc
        .from("projects")
        .select(
          "feasibility_date, completed_at, is_completed, coordinator_incentive, incentive_paid_on",
        ),
      "projects",
    );
    const statuses = projects.map((p) =>
      feasibilityStatus({
        feasibilityDate: p.feasibility_date,
        completedAt: p.completed_at,
        isCompleted: p.is_completed,
        today,
      }),
    );
    const expiring = statuses.filter((s) => s.state === "expiring").length;
    const extensionCost = statuses.reduce((sum, s) => sum + s.extensionCost, 0);
    const incentivePending = projects
      .filter(
        (p) => p.coordinator_incentive !== null && p.incentive_paid_on === null,
      )
      .reduce((sum, p) => sum + Number(p.coordinator_incentive), 0);

    // Two expiring fixtures plus the seeded project five days from expiry.
    expect(expiring).toBeGreaterThanOrEqual(3);
    expect(Number(m.feasibility_expiring)).toBe(expiring);
    expect(Number(m.feasibility_extension_cost)).toBe(extensionCost);
    expect(Number(m.incentive_pending)).toBe(incentivePending);
  });
});
