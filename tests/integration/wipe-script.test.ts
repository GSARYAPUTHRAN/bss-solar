import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { USERS, localDbUrl } from "./helpers";

/**
 * supabase/scripts/wipe-business-data.sql clears every sale — work orders,
 * projects, payments, tickets, who shares each sale, incentives, notifications —
 * and keeps every account, ahead of the client's fresh bulk upload. It must do
 * exactly that, refuse to run without the typed phrase, and refuse anything
 * surprising. Every scenario runs the real script text over a direct Postgres
 * connection inside a transaction that is ALWAYS rolled back, so the seed
 * survives for the rest of the suite.
 */

const SCRIPTS_DIR = new URL("../../supabase/scripts/", import.meta.url);
const readScript = (name: string) =>
  readFileSync(fileURLToPath(new URL(name, SCRIPTS_DIR)), "utf8").replace(/\r\n/g, "\n");
const WIPE_SQL = readScript("wipe-business-data.sql");
const PREVIEW_SQL = readScript("wipe-business-data-preview.sql");

const PHRASE = "WIPE ALL BUSINESS DATA";
/** The one literal the operator edits. */
const CONFIRM = /confirm constant text := '[^']*';/g;

/** Children before parents, so every per-table count is exact. */
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
const KEPT_TABLES = ["profiles", "push_subscriptions"] as const;

// localDbUrl() refuses any non-local host: destructive SQL, even rolled back,
// never runs against a hosted database.

/** The script exactly as shipped, with only its confirm phrase typed in. */
function confirmed(sql: string, phrase: string = PHRASE): string {
  const literals = sql.match(CONFIRM) ?? [];
  expect(literals, "exactly one confirm literal").toHaveLength(1);
  return sql.replace(CONFIRM, () => `confirm constant text := '${phrase.replaceAll("'", "''")}';`);
}

/**
 * The strings of the array a script declares as `name`, in order. The wipe
 * declares `name constant text[] := array[...]`; the preview `array[...]::text[]
 * as name`.
 */
function listOf(sql: string, name: string): string[] {
  const declared = new RegExp(
    `${name} constant text\\[\\] := array\\[([^\\]]*)\\]|array\\[([^\\]]*)\\]::text\\[\\] as ${name}\\b`,
  ).exec(sql);
  expect(declared, `${name} in the script`).not.toBeNull();
  const body = declared![1] ?? declared![2];
  return [...body.matchAll(/'([^']*)'/g)].map((m) => m[1]);
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
    const tables = [
      "auth.users",
      ...[...BUSINESS_TABLES, ...KEPT_TABLES].map((t) => `public.${t}`),
    ];
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
    `select count(*)::int as n from ${table}`,
  );
  return rows[0].n;
}

async function snapshot(): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const table of BUSINESS_TABLES) counts[table] = await count(`public.${table}`);
  for (const table of KEPT_TABLES) counts[table] = await count(`public.${table}`);
  counts["auth.users"] = await count("auth.users");
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

describe("wipe-business-data.sql", () => {
  it("ships locked: the confirm phrase is empty, so running it as it is deletes nothing", async () => {
    expect(WIPE_SQL.match(CONFIRM)).toEqual(["confirm constant text := '';"]);
    await rolledBack(async () => {
      const before = await snapshot();
      await client.query("savepoint before_wipe");
      await expect(runScript(WIPE_SQL)).rejects.toThrow(
        /Wipe aborted: set confirm to 'WIPE ALL BUSINESS DATA'.*nothing was deleted/,
      );
      expect(deletionNotices()).toEqual([]);
      await client.query("rollback to savepoint before_wipe");
      expect(await snapshot()).toEqual(before);
    });
  });

  it.each([
    ["a different phrase", "wipe all business data"],
    ["a near miss", "WIPE ALL BUSINESS DATA "],
    ["part of it", "WIPE"],
    ["another script's word", "RESET"],
  ])("refuses %s", async (_what, phrase) => {
    await rolledBack(async () => {
      const before = await snapshot();
      await client.query("savepoint before_wipe");
      await expect(runScript(confirmed(WIPE_SQL, phrase))).rejects.toThrow(
        /Wipe aborted: set confirm/,
      );
      expect(deletionNotices()).toEqual([]);
      await client.query("rollback to savepoint before_wipe");
      expect(await snapshot()).toEqual(before);
    });
  });

  it("empties every business table and keeps every account and push subscription", async () => {
    await rolledBack(async () => {
      // A kept account's record of alerts already sent goes too: the projects
      // those alerts were about are gone.
      await client.query(
        `insert into public.notification_dedupe (recipient_id, dedupe_key)
         values ($1, 'feasibility.expiring:wipe-probe')`,
        [USERS.admin.id],
      );
      await addPushSubscription(USERS.admin.id, "https://push.test/wipe-admin-device");
      await addPushSubscription(USERS.rahul.id, "https://push.test/wipe-coordinator-device");
      const before = await snapshot();
      expect(before.work_orders).toBeGreaterThan(0);
      expect(before.work_order_coordinators).toBeGreaterThanOrEqual(before.work_orders);
      expect(before.coordinator_incentives).toBe(before.work_order_coordinators);
      expect(before.notification_dedupe).toBeGreaterThan(0);
      expect(before.push_subscriptions).toBeGreaterThanOrEqual(2);

      const { rows: accountsBefore } = await client.query(
        `select u.id, u.email, p.role::text, p.full_name, p.phone
           from auth.users u join public.profiles p on p.id = u.id order by u.id`,
      );
      const { rows: devicesBefore } = await client.query(
        "select user_id, endpoint from public.push_subscriptions order by endpoint",
      );

      const summary = await runScript<{ kind: string; name: string; detail: string }>(
        confirmed(WIPE_SQL),
      );

      for (const table of BUSINESS_TABLES) {
        expect(await count(`public.${table}`), table).toBe(0);
      }

      // Every account — sign-in, profile, role, name, phone — and every device is as it was.
      const { rows: accountsAfter } = await client.query(
        `select u.id, u.email, p.role::text, p.full_name, p.phone
           from auth.users u join public.profiles p on p.id = u.id order by u.id`,
      );
      expect(accountsAfter).toEqual(accountsBefore);
      const { rows: devicesAfter } = await client.query(
        "select user_id, endpoint from public.push_subscriptions order by endpoint",
      );
      expect(devicesAfter).toEqual(devicesBefore);

      // Ticket numbering starts again at 0001.
      const { rows: seq } = await client.query<{ last_value: string; is_called: boolean }>(
        "select last_value, is_called from public.service_ticket_no_seq",
      );
      expect(seq[0]).toEqual({ last_value: "1", is_called: false });

      // One notice per table, in order, with the real number of rows removed.
      expect(deletionNotices().map((n) => n.message)).toEqual(
        BUSINESS_TABLES.map((t) => `${t}: ${before[t]} deleted`),
      );
      expect(notices.map((n) => n.message)).toContain("service_ticket_no_seq: restarted");
      expect(notices.map((n) => n.message)).toContain(
        `Wipe complete: ${before["auth.users"]} account(s) and ${before.push_subscriptions} push subscription(s) kept.`,
      );

      // The summary the operator sees: every table's count (the business
      // tables at 0, the accounts' tables as they were) and the accounts by role.
      const tableCounts = Object.fromEntries(
        summary.filter((r) => r.kind === "table").map((r) => [r.name, r.detail]),
      );
      expect(tableCounts).toEqual({
        ...Object.fromEntries(BUSINESS_TABLES.map((t) => [t, "0"])),
        profiles: String(before.profiles),
        push_subscriptions: String(before.push_subscriptions),
      });
      const accounts = summary.filter((r) => r.kind === "account");
      expect(accounts.reduce((sum, r) => sum + Number(r.detail), 0)).toBe(
        before["auth.users"],
      );
      expect(accounts.map((r) => r.name)).toEqual(
        expect.arrayContaining(["admin", "superadmin", "coordinator", "service_engineer"]),
      );
    });
  });

  it("skips a business table that does not exist, and still reports", async () => {
    await rolledBack(async () => {
      await client.query("drop table public.notification_dedupe");
      const summary = await runScript<{ kind: string; name: string; detail: string }>(
        confirmed(WIPE_SQL),
      );
      expect(notices.map((n) => n.message)).toContain(
        "notification_dedupe: not present — skipped",
      );
      // Every other business table was still emptied, and the report built from
      // the catalogue simply does not list the missing one.
      for (const table of BUSINESS_TABLES.filter((t) => t !== "notification_dedupe")) {
        expect(await count(`public.${table}`), table).toBe(0);
      }
      expect(summary.filter((r) => r.kind === "table").map((r) => r.name)).not.toContain(
        "notification_dedupe",
      );
    });
  });

  it("can be run again: a second wipe finds nothing and still succeeds", async () => {
    await rolledBack(async () => {
      await runScript(confirmed(WIPE_SQL));
      notices = [];
      await runScript(confirmed(WIPE_SQL));
      expect(deletionNotices().map((n) => n.message)).toEqual(
        BUSINESS_TABLES.map((t) => `${t}: 0 deleted`),
      );
    });
  });

  describe("aborts without deleting anything", () => {
    it("when a table the script does not know about exists — even an empty one", async () => {
      await rolledBack(async () => {
        await client.query("create table public.wipe_probe (id int)");
        const before = await snapshot();
        await client.query("savepoint before_wipe");

        await expect(runScript(confirmed(WIPE_SQL))).rejects.toThrow(
          /table\(s\) wipe_probe are in neither business_tables nor kept_tables/,
        );
        expect(deletionNotices(), "no delete ran before the abort").toEqual([]);
        await client.query("rollback to savepoint before_wipe");
        expect(await snapshot()).toEqual(before);
      });
    });

    it("when no admin or Super Admin account exists", async () => {
      await rolledBack(async () => {
        await client.query(
          "update public.profiles set role = 'coordinator' where role::text in ('admin', 'superadmin')",
        );
        const before = await snapshot();
        await client.query("savepoint before_wipe");

        await expect(runScript(confirmed(WIPE_SQL))).rejects.toThrow(
          /no admin or Super Admin account exists/,
        );
        expect(deletionNotices()).toEqual([]);
        await client.query("rollback to savepoint before_wipe");
        expect(await snapshot()).toEqual(before);
      });
    });
  });

  describe("fails closed after deleting, taking everything back with it", () => {
    it("when a business table is not empty at the end", async () => {
      await rolledBack(async () => {
        // Something re-fills notification_dedupe after the script emptied it.
        await client.query(`
          create function public.wipe_probe_refill() returns trigger language plpgsql as $$
          begin
            insert into public.notification_dedupe (recipient_id, dedupe_key)
            values ('${USERS.admin.id}', 'refilled-by-probe');
            return null;
          end $$;
          create trigger wipe_probe_refill after delete on public.notifications
            for each statement execute function public.wipe_probe_refill();
        `);
        const before = await snapshot();
        await client.query("savepoint before_wipe");

        await expect(runScript(confirmed(WIPE_SQL))).rejects.toThrow(
          /Wipe failed: public\.notification_dedupe still has 1 row\(s\)\. Everything was rolled back\./,
        );
        await client.query("rollback to savepoint before_wipe");
        expect(await snapshot()).toEqual(before);
      });
    });

    it("when an account or a push subscription is touched", async () => {
      await rolledBack(async () => {
        await addPushSubscription(USERS.admin.id, "https://push.test/wipe-probe-device");
        await client.query(`
          create function public.wipe_probe_touch() returns trigger language plpgsql as $$
          begin
            delete from public.push_subscriptions;
            return null;
          end $$;
          create trigger wipe_probe_touch after delete on public.work_orders
            for each statement execute function public.wipe_probe_touch();
        `);
        const before = await snapshot();
        await client.query("savepoint before_wipe");

        await expect(runScript(confirmed(WIPE_SQL))).rejects.toThrow(
          /Wipe failed: accounts changed .*Everything was rolled back\./,
        );
        await client.query("rollback to savepoint before_wipe");
        expect(await snapshot()).toEqual(before);
      });
    });
  });

  it("leaves the schema able to take the next import: sales can be created again", async () => {
    await rolledBack(async () => {
      await runScript(confirmed(WIPE_SQL));
      await client.query(
        `insert into public.work_orders (coordinator_id, client_name, plant_capacity, total_cost)
         values ($1, 'After the wipe', '3kW', 100000)`,
        [USERS.rahul.id],
      );
      // The insert trigger made the creator the first member, with an open incentive.
      expect(await count("public.work_order_coordinators")).toBe(1);
      expect(await count("public.coordinator_incentives")).toBe(1);
    });
  });

  it("covers every table of the schema, so none is ever silently kept or lost", async () => {
    const { rows } = await client.query<{ relname: string }>(
      `select c.relname from pg_class c
        where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')
        order by c.relname`,
    );
    const classified = new Set<string>([...BUSINESS_TABLES, ...KEPT_TABLES]);
    expect(rows.map((r) => r.relname).filter((t) => !classified.has(t))).toEqual([]);
  });

  it("lists the same tables as its preview and as this test", () => {
    for (const sql of [WIPE_SQL, PREVIEW_SQL]) {
      expect(listOf(sql, "business_tables")).toEqual([...BUSINESS_TABLES]);
      expect(listOf(sql, "kept_tables")).toEqual([...KEPT_TABLES]);
    }
  });
});

describe("wipe-business-data-preview.sql", () => {
  type ReportRow = { section: string; item: string; detail: string };

  /**
   * Runs the preview in a READ ONLY transaction — so any write it attempted
   * would fail — and counts the tables in the same snapshot it reads.
   */
  async function preview(
    arrange: () => Promise<void> = async () => {},
  ): Promise<{ rows: ReportRow[]; before: Record<string, number> }> {
    await client.query("begin");
    try {
      await arrange();
      await client.query("set transaction read only");
      const before = await snapshot();
      const rows = await runScript<ReportRow>(PREVIEW_SQL);
      return { rows, before };
    } finally {
      await client.query("rollback");
    }
  }

  const detailOf = (rows: ReportRow[], section: string, item: string) =>
    rows.find((r) => r.section === section && r.item === item)?.detail;

  it("reports what the wipe would delete and keep, and is read-only", async () => {
    const { rows, before } = await preview();

    expect(detailOf(rows, "verdict", "wipe-business-data.sql")).toBe("READY");
    expect(rows.filter((r) => r.section === "check").map((r) => r.detail)).toEqual([
      "OK",
      "OK",
    ]);
    for (const table of BUSINESS_TABLES) {
      expect(detailOf(rows, "delete rows", table), table).toBe(String(before[table]));
    }
    // Nothing kept is listed as deleted.
    for (const table of KEPT_TABLES) {
      expect(detailOf(rows, "delete rows", table), table).toBeUndefined();
      expect(detailOf(rows, "keep rows", table), table).toBe(String(before[table]));
    }
    const kept = rows
      .filter((r) => r.section === "keep accounts")
      .reduce((sum, r) => sum + Number(r.detail), 0);
    expect(kept).toBe(before["auth.users"]);
    expect(detailOf(rows, "keep accounts", "admin")).toBeDefined();
    // The preview changed nothing (and a write would have failed: READ ONLY).
    expect(await snapshot()).toEqual(before);
  });

  it("flags an unclassified table exactly as the wipe would abort on it, and lists its rows", async () => {
    const { rows } = await preview(async () => {
      await client.query("create table public.wipe_probe (id int)");
      await client.query("insert into public.wipe_probe values (1), (2)");
    });

    expect(detailOf(rows, "verdict", "wipe-business-data.sql")).toBe(
      "WOULD ABORT — nothing would be deleted",
    );
    expect(
      detailOf(rows, "check", "every table is classified"),
    ).toMatch(/^ERROR: table\(s\) wipe_probe are in neither list/);
    // New tables show up in the report by themselves, with their rows.
    expect(detailOf(rows, "delete rows", "wipe_probe")).toBe("2");
  });

  it("flags a database with no admin, as the wipe would", async () => {
    const { rows } = await preview(async () => {
      await client.query(
        "update public.profiles set role = 'coordinator' where role::text in ('admin', 'superadmin')",
      );
    });
    expect(detailOf(rows, "verdict", "wipe-business-data.sql")).toBe(
      "WOULD ABORT — nothing would be deleted",
    );
    expect(detailOf(rows, "check", "an admin or the Super Admin account exists")).toMatch(
      /^ERROR: no admin or Super Admin account exists/,
    );
  });
});
