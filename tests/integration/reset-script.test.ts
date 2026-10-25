import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { USERS, localDbUrl } from "./helpers";

/**
 * supabase/scripts/reset-business-data.sql wipes the production database
 * before the client's fresh bulk upload, so it must do exactly what it says
 * and refuse anything surprising. Every scenario runs the real script text —
 * only its keep-list swapped for seeded accounts — over a direct Postgres
 * connection inside a transaction that is ALWAYS rolled back, so the seed
 * survives for the rest of the suite.
 */

const SCRIPTS_DIR = new URL("../../supabase/scripts/", import.meta.url);
const RESET_SQL = readFileSync(fileURLToPath(new URL("reset-business-data.sql", SCRIPTS_DIR)), "utf8");
const PREVIEW_SQL = readFileSync(
  fileURLToPath(new URL("reset-business-data-preview.sql", SCRIPTS_DIR)),
  "utf8",
);

/** The operator edits exactly one `array[...]::text[]` literal per script. */
const KEEP_LIST = /array\[[^\]]*\]::text\[\]/g;
const SHIPPED_KEEP_LIST = ["admin@bsssolar.in", "gsputhran@yahoo.com"];

const BUSINESS_TABLES = [
  "notification_dedupe",
  "notifications",
  "coordinator_incentives",
  "work_order_coordinators",
  "payments",
  "service_tickets",
  "project_milestones",
  "projects",
  "work_orders",
] as const;

// localDbUrl() refuses any non-local host: destructive SQL, even rolled back,
// never runs against a hosted database.

function keepListLiteral(sql: string): string {
  const literals: string[] = sql.match(KEEP_LIST) ?? [];
  expect(literals, "exactly one keep-list literal").toHaveLength(1);
  return literals[0];
}

function keepListOf(sql: string): string[] {
  return [...keepListLiteral(sql).matchAll(/'((?:[^']|'')*)'/g)].map((m) =>
    m[1].replaceAll("''", "'"),
  );
}

/** The script exactly as shipped, with only its keep-list replaced. */
function withKeepList(sql: string, emails: readonly string[]): string {
  const quoted = emails.map((email) => `'${email.replaceAll("'", "''")}'`);
  return sql.replace(keepListLiteral(sql), () => `array[${quoted.join(", ")}]::text[]`);
}

let client: pg.Client;
let notices: { severity: string; message: string }[] = [];

beforeAll(async () => {
  client = new pg.Client({ connectionString: localDbUrl() });
  await client.connect();
  client.on("notice", (notice) => {
    notices.push({ severity: notice.severity ?? "", message: notice.message ?? "" });
  });
});

afterAll(async () => {
  await client?.end();
});

beforeEach(() => {
  notices = [];
});

/**
 * Runs `fn` in a transaction that is rolled back whatever happens. Other
 * sessions' writes are held off first, so the counts a test takes are exactly
 * the rows the script then sees.
 */
async function rolledBack(fn: () => Promise<void>): Promise<void> {
  await client.query("begin");
  try {
    const tables = ["auth.users", ...BUSINESS_TABLES.map((t) => `public.${t}`)];
    await client.query(`lock table ${tables.join(", ")} in exclusive mode`);
    await fn();
  } finally {
    await client.query("rollback");
  }
}

/** A multi-statement query resolves to one result per statement. */
async function runScript<Row extends pg.QueryResultRow>(sql: string): Promise<Row[]> {
  const results: unknown = await client.query(sql);
  const last = Array.isArray(results) ? results.at(-1) : results;
  return (last as pg.QueryResult<Row>).rows;
}

async function count(table: string): Promise<number> {
  const { rows } = await client.query<{ n: number }>(
    `select count(*)::int as n from ${client.escapeIdentifier(table)}`,
  );
  return rows[0].n;
}

async function accountEmails(): Promise<string[]> {
  const { rows } = await client.query<{ email: string }>(
    "select u.email from auth.users u join public.profiles p on p.id = u.id order by u.email",
  );
  return rows.map((r) => r.email);
}

async function snapshotCounts(): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const table of BUSINESS_TABLES) counts[table] = await count(table);
  const { rows } = await client.query<{ n: number }>("select count(*)::int as n from auth.users");
  counts["auth.users"] = rows[0].n;
  return counts;
}

async function addPushSubscription(userId: string, endpoint: string): Promise<void> {
  await client.query(
    `insert into public.push_subscriptions (user_id, endpoint, p256dh, auth)
     values ($1, $2, 'test-p256dh', 'test-auth')`,
    [userId, endpoint],
  );
}

const deletionNotices = () => notices.filter((n) => / deleted$/.test(n.message));

describe("reset-business-data.sql", () => {
  it("ships with the client's keep-list, and the preview uses the same one", () => {
    expect(keepListOf(RESET_SQL)).toEqual(SHIPPED_KEEP_LIST);
    expect(keepListOf(PREVIEW_SQL)).toEqual(SHIPPED_KEEP_LIST);
  });

  it("keeps only the listed accounts and empties every business table", async () => {
    await rolledBack(async () => {
      // A kept account's record of alerts already sent goes too: the projects
      // those alerts were about are gone.
      await client.query(
        `insert into public.notification_dedupe (recipient_id, dedupe_key)
         values ($1, 'feasibility.expiring:reset-probe')`,
        [USERS.admin.id],
      );
      const before = await snapshotCounts();
      expect(before.work_orders).toBeGreaterThan(0);
      expect(before.notification_dedupe).toBeGreaterThan(0);
      // Who shares each sale, and each person's incentive, go with the sales.
      expect(before.work_order_coordinators).toBeGreaterThanOrEqual(before.work_orders);
      expect(before.coordinator_incentives).toBe(before.work_order_coordinators);
      await addPushSubscription(USERS.admin.id, "https://push.test/kept-admin-device");
      await addPushSubscription(USERS.rahul.id, "https://push.test/removed-coordinator-device");

      const summary = await runScript<{ kind: string; name: string; detail: string }>(
        withKeepList(RESET_SQL, [USERS.admin.email, USERS.superadmin.email]),
      );

      expect(await accountEmails()).toEqual([USERS.admin.email, USERS.superadmin.email].sort());
      const { rows: users } = await client.query("select id from auth.users");
      expect(users).toHaveLength(2);
      for (const table of BUSINESS_TABLES) expect(await count(table), table).toBe(0);

      // The kept admin's device keeps receiving push; the departed user's is gone.
      const { rows: devices } = await client.query<{ endpoint: string }>(
        "select endpoint from public.push_subscriptions",
      );
      expect(devices.map((d) => d.endpoint)).toEqual(["https://push.test/kept-admin-device"]);

      // Ticket numbering starts again at 0001.
      const { rows: seq } = await client.query<{ last_value: string; is_called: boolean }>(
        "select last_value, is_called from public.service_ticket_no_seq",
      );
      expect(seq[0]).toEqual({ last_value: "1", is_called: false });

      // One notice per table, with the real number of rows removed.
      for (const table of BUSINESS_TABLES) {
        expect(notices.map((n) => n.message)).toContain(`${table}: ${before[table]} deleted`);
      }
      expect(notices.map((n) => n.message)).toContain(
        `auth.users (accounts not kept): ${before["auth.users"] - 2} deleted`,
      );

      // The summary the operator sees: the kept accounts, then the row counts.
      expect(summary.filter((r) => r.kind === "account")).toEqual([
        { kind: "account", name: USERS.admin.email, detail: "admin" },
        { kind: "account", name: USERS.superadmin.email, detail: "superadmin" },
      ]);
      const tableCounts = Object.fromEntries(
        summary.filter((r) => r.kind === "table").map((r) => [r.name, r.detail]),
      );
      expect(tableCounts).toMatchObject({ profiles: "2", push_subscriptions: "1" });
      for (const table of BUSINESS_TABLES) expect(tableCounts[table], table).toBe("0");
    });
  });

  it("matches emails case-insensitively, ignores blanks and duplicates, and warns when no Super Admin is kept", async () => {
    await rolledBack(async () => {
      await runScript(
        withKeepList(RESET_SQL, [` ${USERS.admin.email.toUpperCase()} `, "", USERS.admin.email]),
      );

      expect(await accountEmails()).toEqual([USERS.admin.email]);
      expect(notices).toContainEqual(
        expect.objectContaining({ severity: "WARNING", message: expect.stringMatching(/No Super Admin is kept/) }),
      );
    });
  });

  describe("aborts without deleting anything", () => {
    it.each([
      {
        scenario: "an email that is not an account (a typo)",
        keep: [USERS.admin.email, "admin@bsssolar.tset", "nobody@bsssolar.test"],
        error: /no account has the email\(s\) admin@bsssolar\.tset, nobody@bsssolar\.test/,
      },
      {
        scenario: "only a coordinator is kept (nobody could run the office)",
        keep: [USERS.rahul.email],
        error: /none of the kept accounts is an admin or the Super Admin/,
      },
      {
        scenario: "an empty keep-list",
        keep: [],
        error: /the keep-list is empty/,
      },
      {
        scenario: "a keep-list of blanks",
        keep: ["  ", ""],
        error: /the keep-list is empty/,
      },
    ])("$scenario", async ({ keep, error }) => {
      await rolledBack(async () => {
        const before = await snapshotCounts();
        await client.query("savepoint before_reset");

        await expect(runScript(withKeepList(RESET_SQL, keep))).rejects.toThrow(error);

        expect(deletionNotices(), "no delete ran before the abort").toEqual([]);
        await client.query("rollback to savepoint before_reset");
        expect(await snapshotCounts()).toEqual(before);
      });
    });

    it("when a table the script does not know about still holds rows", async () => {
      await rolledBack(async () => {
        await client.query("create table public.reset_probe (id int)");
        await client.query("insert into public.reset_probe values (1)");

        await expect(
          runScript(withKeepList(RESET_SQL, [USERS.admin.email, USERS.superadmin.email])),
        ).rejects.toThrow(/table public\.reset_probe still has rows/);
      });
    });
  });
});

describe("reset-business-data-preview.sql", () => {
  type ReportRow = { section: string; item: string; detail: string };

  /**
   * Runs the preview in a READ ONLY transaction — so any write it attempted
   * would fail — and counts the tables in the same snapshot it reads.
   */
  async function preview(
    keep: readonly string[],
  ): Promise<{ rows: ReportRow[]; before: Record<string, number> }> {
    await client.query("begin isolation level repeatable read, read only");
    try {
      const before = await snapshotCounts();
      const rows = await runScript<ReportRow>(withKeepList(PREVIEW_SQL, keep));
      return { rows, before };
    } finally {
      await client.query("rollback");
    }
  }

  const detailOf = (rows: ReportRow[], section: string, item: string) =>
    rows.find((r) => r.section === section && r.item === item)?.detail;

  it("reports what the reset would keep and delete", async () => {
    const { rows, before } = await preview([USERS.admin.email, USERS.superadmin.email]);

    expect(detailOf(rows, "verdict", "reset-business-data.sql")).toBe("READY");
    expect(rows.filter((r) => r.section === "check").map((r) => r.detail)).toEqual([
      "OK",
      "OK",
      "OK",
      "OK",
    ]);
    expect(rows.filter((r) => r.section === "keep account")).toEqual([
      { section: "keep account", item: USERS.admin.email, detail: "admin" },
      { section: "keep account", item: USERS.superadmin.email, detail: "superadmin" },
    ]);
    const deletedAccounts = rows
      .filter((r) => r.section === "delete accounts")
      .reduce((sum, r) => sum + Number(r.detail), 0);
    expect(deletedAccounts).toBe(before["auth.users"] - 2);
    for (const table of BUSINESS_TABLES) {
      expect(detailOf(rows, "delete rows", table), table).toBe(String(before[table]));
    }
  });

  it.each([
    {
      scenario: "a typo",
      keep: [USERS.admin.email, "nobody@bsssolar.test"],
      problem: "ERROR: no account has the email(s) nobody@bsssolar.test",
    },
    {
      scenario: "a coordinator-only list",
      keep: [USERS.rahul.email],
      problem: "ERROR: none of the kept accounts is an admin or the Super Admin",
    },
    {
      scenario: "an empty list",
      keep: [],
      problem: "ERROR: the keep-list is empty, so every account would be deleted",
    },
  ])("flags $scenario exactly as the reset would abort on it", async ({ keep, problem }) => {
    const { rows } = await preview(keep);

    expect(detailOf(rows, "verdict", "reset-business-data.sql")).toBe(
      "WOULD ABORT — nothing would be deleted",
    );
    expect(rows.filter((r) => r.section === "check").map((r) => r.detail)).toContain(problem);
  });
});
