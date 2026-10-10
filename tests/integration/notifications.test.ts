import { randomUUID } from "node:crypto";
import { describe, it, expect, afterAll, beforeAll, vi } from "vitest";
import {
  describe as describeEvent,
  type NotificationEvent,
} from "@/lib/domain/notifications";
import type { PushConfig } from "@/server/notifications/config";
import { deliver } from "@/server/notifications/deliver";
import type { PushSender } from "@/server/notifications/push";
import {
  serviceRoleStore,
  type NewNotification,
} from "@/server/notifications/store";
import {
  anonClient,
  localConfig,
  serviceClient,
  signedInAs,
  USERS,
  withDb,
} from "./helpers";
import { createFixtures, must, uniqueTag } from "./fixtures";

/**
 * The notification inbox and Web Push subscriptions (migration
 * 20261010120500). Rows are written only by trusted server code with the
 * service role; a signed-in user reads, marks read (through an RPC) and clears
 * their OWN inbox, and cannot forge a notification for anyone — themselves
 * included. Sneha and Arun hold no seeded notifications, so these tests never
 * disturb the demo inbox.
 */
const svc = serviceClient();
const fx = createFixtures(svc);
/** The users these tests write for — neither has seeded inbox rows or devices. */
const TEST_RECIPIENTS = [USERS.sneha.id, USERS.arun.id];
/** Device keys for register_push_subscription; never used to encrypt anything. */
const keys = { p_p256dh: "BPublicKeyFixture", p_auth: "authSecretFixture" };

beforeAll(() => {
  // The app's own service-role store, pointed at the local stack.
  const { url, serviceKey } = localConfig();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", url);
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", serviceKey);
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await fx.cleanup();
  // Sweep anything a regressed guard let through (a write expected to fail),
  // and the record of the alerts these tests sent.
  await svc.from("notifications").delete().in("recipient_id", TEST_RECIPIENTS);
  await svc
    .from("notification_dedupe")
    .delete()
    .in("recipient_id", TEST_RECIPIENTS);
  await svc.from("push_subscriptions").delete().in("user_id", TEST_RECIPIENTS);
});

/** What the "Clear read" button does: mark everything read, delete read rows. */
async function clearInbox(user: typeof USERS.sneha) {
  const client = await signedInAs(user);
  must(await client.rpc("mark_notifications_read"), "mark read");
  const { error } = await client
    .from("notifications")
    .delete()
    .not("read_at", "is", null);
  expect(error).toBeNull();
}

async function readAt(id: string): Promise<string | null> {
  return must(
    await svc.from("notifications").select("read_at").eq("id", id).single(),
    "notification",
  ).read_at;
}

describe("the inbox", () => {
  it("shows a user only their own notifications", async () => {
    const mine = await fx.notification({ recipient_id: USERS.sneha.id });
    const theirs = await fx.notification({ recipient_id: USERS.arun.id });

    const sneha = await signedInAs(USERS.sneha);
    const rows = must(
      await sneha.from("notifications").select("id, recipient_id"),
      "inbox",
    );
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(mine);
    expect(ids).not.toContain(theirs);
    for (const row of rows) expect(row.recipient_id).toBe(USERS.sneha.id);
  });

  it.each([
    ["themselves", USERS.sneha.id],
    ["another user", USERS.arun.id],
  ])(
    "cannot be written to directly — not even for %s",
    async (_who, recipient) => {
      const sneha = await signedInAs(USERS.sneha);
      const title = `Forged ${uniqueTag()}`;
      const { error } = await sneha.from("notifications").insert({
        recipient_id: recipient,
        type: "work_order.approved",
        title,
      });
      expect(error?.code).toBe("42501");

      const forged = must(
        await svc.from("notifications").select("id").eq("title", title),
        "lookup",
      );
      expect(forged).toEqual([]);
    },
  );

  it("cannot be edited directly, so read state only moves through the RPC", async () => {
    const id = await fx.notification({ recipient_id: USERS.sneha.id });
    const sneha = await signedInAs(USERS.sneha);
    const { error } = await sneha
      .from("notifications")
      .update({ read_at: new Date().toISOString(), title: "Edited" })
      .eq("id", id);
    expect(error?.code).toBe("42501");
    expect(await readAt(id)).toBeNull();
  });

  it("marks only the caller's own rows read when given ids", async () => {
    const mine = await fx.notification({ recipient_id: USERS.sneha.id });
    const mineToo = await fx.notification({ recipient_id: USERS.sneha.id });
    const theirs = await fx.notification({ recipient_id: USERS.arun.id });

    const sneha = await signedInAs(USERS.sneha);
    const { data, error } = await sneha.rpc("mark_notifications_read", {
      p_ids: [mine, theirs],
    });
    expect(error).toBeNull();
    expect(data).toBe(1);
    expect(await readAt(mine)).not.toBeNull();
    expect(await readAt(mineToo)).toBeNull();
    expect(await readAt(theirs)).toBeNull();

    // Already-read rows are not touched (or counted) again.
    expect(
      (await sneha.rpc("mark_notifications_read", { p_ids: [mine] })).data,
    ).toBe(0);
  });

  it("marks everything the caller has unread when no ids are given", async () => {
    const a = await fx.notification({ recipient_id: USERS.sneha.id });
    const b = await fx.notification({ recipient_id: USERS.sneha.id });
    const theirs = await fx.notification({ recipient_id: USERS.arun.id });

    const sneha = await signedInAs(USERS.sneha);
    const { data, error } = await sneha.rpc("mark_notifications_read");
    expect(error).toBeNull();
    expect(data).toBeGreaterThanOrEqual(2);
    expect(await readAt(a)).not.toBeNull();
    expect(await readAt(b)).not.toBeNull();
    expect(await readAt(theirs)).toBeNull();

    const { count } = await sneha
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .is("read_at", null);
    expect(count).toBe(0);
  });

  it("lets a user delete their own notifications, and only those", async () => {
    const mine = await fx.notification({ recipient_id: USERS.sneha.id });
    const theirs = await fx.notification({ recipient_id: USERS.arun.id });
    const sneha = await signedInAs(USERS.sneha);

    const own = await sneha
      .from("notifications")
      .delete()
      .eq("id", mine)
      .select("id");
    expect(own.data).toEqual([{ id: mine }]);

    const other = await sneha
      .from("notifications")
      .delete()
      .eq("id", theirs)
      .select("id");
    expect(other.data ?? []).toEqual([]);
    expect(await readAt(theirs)).toBeNull(); // still there, still unread
  });

  it("is refused entirely to a signed-out caller", async () => {
    const anon = anonClient();
    const { data } = await anon.from("notifications").select("id");
    expect(data ?? []).toEqual([]);
    const { error } = await anon.rpc("mark_notifications_read");
    expect(error?.code).toBe("42501");
  });

  it("is published to Realtime so the bell updates live", async () => {
    const { rows } = await withDb((db) =>
      db.query(
        `select 1 from pg_publication_tables
          where pubname = 'supabase_realtime'
            and schemaname = 'public' and tablename = 'notifications'`,
      ),
    );
    expect(rows).toHaveLength(1);
  });
});

describe("notification integrity", () => {
  it("keeps (recipient, dedupe_key) unique so scheduled alerts are idempotent", async () => {
    const key = `feasibility:test:${uniqueTag()}`;
    await fx.notification({ recipient_id: USERS.sneha.id, dedupe_key: key });

    const again = await svc.from("notifications").insert({
      recipient_id: USERS.sneha.id,
      type: "test.fixture",
      title: "Again",
      dedupe_key: key,
    });
    expect(again.error?.code).toBe("23505");

    // The same key for someone else is a different alert.
    await fx.notification({ recipient_id: USERS.arun.id, dedupe_key: key });
  });

  it("never treats NULL keys as duplicates", async () => {
    await fx.notification({ recipient_id: USERS.sneha.id, dedupe_key: null });
    await fx.notification({ recipient_id: USERS.sneha.id, dedupe_key: null });
  });

  it.each(["https://evil.example", "//evil.example", "projects/1"])(
    "rejects the off-site or relative link %s",
    async (link) => {
      const { error } = await svc.from("notifications").insert({
        recipient_id: USERS.sneha.id,
        type: "test.fixture",
        title: "Link",
        link,
      });
      expect(error?.code).toBe("23514");
      expect(error?.message).toMatch(/notifications_link_internal/);
    },
  );

  // URL parsers fold "\" into "/" and strip tabs/newlines, so each of these
  // resolves to https://evil.example/ when rendered as an href. The
  // notifications_link_internal check must refuse them, not just a literal "//".
  it.each([String.raw`/\evil.example`, "/\t/evil.example", "/\n/evil.example"])(
    "rejects the disguised off-site link %j",
    async (link) => {
      const { error } = await svc.from("notifications").insert({
        recipient_id: USERS.sneha.id,
        type: "test.fixture",
        title: "Link",
        link,
      });
      expect(error?.code).toBe("23514");
    },
  );

  it("accepts in-app links and no link", async () => {
    await fx.notification({
      recipient_id: USERS.sneha.id,
      link: "/projects/abc?tab=payments",
    });
    await fx.notification({ recipient_id: USERS.sneha.id, link: null });
  });

  it("requires a title", async () => {
    const { error } = await svc.from("notifications").insert({
      recipient_id: USERS.sneha.id,
      type: "test.fixture",
      title: "   ",
    });
    expect(error?.code).toBe("23514");
  });
});

describe("insert_notifications(), the fan-out's write path", () => {
  /** A row exactly as the store sends it. */
  const row = (
    recipient: string,
    dedupe_key: string | null,
    link = "/projects",
  ) =>
    ({
      recipient_id: recipient,
      type: "test.fixture",
      title: "Fan-out",
      body: null,
      link,
      dedupe_key,
    }) satisfies NewNotification;

  /** The exact call src/server/notifications/store.ts makes. */
  async function insert(rows: ReturnType<typeof row>[]) {
    const written = must(
      await svc.rpc("insert_notifications", { p_rows: rows }),
      "insert_notifications",
    );
    written.forEach((r) => fx.trackNotification(r.id));
    return written.map((r) => r.recipient_id);
  }

  async function inboxRows(recipient: string, key: string) {
    return must(
      await svc
        .from("notifications")
        .select("id")
        .eq("recipient_id", recipient)
        .eq("dedupe_key", key),
      "inbox lookup",
    );
  }

  it("writes a keyed alert once per recipient, and keyless rows every time", async () => {
    const key = `feasibility:test:${uniqueTag()}`;

    expect(
      await insert([
        row(USERS.sneha.id, key),
        row(USERS.arun.id, key),
        row(USERS.sneha.id, null),
      ]),
    ).toEqual([USERS.sneha.id, USERS.arun.id, USERS.sneha.id]);

    // The repeat is skipped, not an error; the keyless row lands again.
    expect(
      await insert([row(USERS.sneha.id, key), row(USERS.sneha.id, null)]),
    ).toEqual([USERS.sneha.id]);
    expect(await inboxRows(USERS.sneha.id, key)).toHaveLength(1);
  });

  it("writes a key repeated within one batch once", async () => {
    const key = `feasibility:test:${uniqueTag()}`;
    expect(
      await insert([row(USERS.sneha.id, key), row(USERS.sneha.id, key)]),
    ).toEqual([USERS.sneha.id]);
  });

  it("never writes an alert again once the user has cleared it from their inbox", async () => {
    const key = `feasibility:test:${uniqueTag()}`;
    expect(await insert([row(USERS.sneha.id, key)])).toEqual([USERS.sneha.id]);

    await clearInbox(USERS.sneha);
    expect(await inboxRows(USERS.sneha.id, key)).toEqual([]);

    expect(await insert([row(USERS.sneha.id, key)])).toEqual([]);
    expect(await inboxRows(USERS.sneha.id, key)).toEqual([]);
  });

  it("releases its claims when the write fails, so a retry still delivers", async () => {
    const key = `feasibility:test:${uniqueTag()}`;
    const { error } = await svc.rpc("insert_notifications", {
      p_rows: [row(USERS.sneha.id, key, "https://evil.example")],
    });
    expect(error?.code).toBe("23514");

    expect(await insert([row(USERS.sneha.id, key)])).toEqual([USERS.sneha.id]);
  });

  it("is the service role's alone, as is the record of what was sent", async () => {
    const sneha = await signedInAs(USERS.sneha);
    const p_rows = [row(USERS.sneha.id, `forged:${uniqueTag()}`)];

    expect(
      (await sneha.rpc("insert_notifications", { p_rows })).error?.code,
    ).toBe("42501");
    expect(
      (await anonClient().rpc("insert_notifications", { p_rows })).error?.code,
    ).toBe("42501");
    expect(
      (await sneha.from("notification_dedupe").select("dedupe_key")).error
        ?.code,
    ).toBe("42501");
    expect(
      (
        await sneha
          .from("notification_dedupe")
          .delete()
          .eq("recipient_id", USERS.sneha.id)
      ).error?.code,
    ).toBe("42501");
  });
});

describe("delivering a scheduled alert", () => {
  /** Push "configured" with keys no push service would accept: `send` is faked. */
  const PUSH: PushConfig = {
    publicKey: "test-public-key",
    privateKey: "test-private-key",
    subject: "mailto:ops@bss.example",
  };

  it("is not sent again after the user clears it with Clear read", async () => {
    // The daily cron's renewal alert, for Sneha alone (no office recipients).
    const event: NotificationEvent = {
      type: "feasibility.extended",
      actorId: null,
      coordinatorId: USERS.sneha.id,
      projectId: randomUUID(),
      clientName: `Dedupe ${uniqueTag()}`,
      renewals: 1,
      validUntil: "2026-11-09",
      extensionCost: 1000,
    };
    const store = { ...serviceRoleStore(), officeIds: async () => [] };
    const send = vi.fn<PushSender>().mockResolvedValue({ statusCode: 201 });
    const endpoint = fx.pushEndpoint();
    const sneha = await signedInAs(USERS.sneha);
    must(
      await sneha.rpc("register_push_subscription", {
        p_endpoint: endpoint,
        ...keys,
      }),
      "register device",
    );
    const key = describeEvent(event).dedupeKey;
    expect(key).not.toBeNull();
    const inbox = async () =>
      must(
        await svc
          .from("notifications")
          .select("id")
          .eq("recipient_id", USERS.sneha.id)
          .eq("dedupe_key", key!),
        "inbox",
      );

    const first = await deliver(event, { store, push: PUSH, send });
    expect(first).toMatchObject({ recipients: 1, inserted: 1 });
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ endpoint }),
      expect.any(String),
      expect.any(Object),
    );
    expect(await inbox()).toHaveLength(1);

    await clearInbox(USERS.sneha);
    expect(await inbox()).toEqual([]);
    send.mockClear();

    // The next morning's run: same alert, same key.
    const second = await deliver(event, { store, push: PUSH, send });
    expect(second).toMatchObject({ recipients: 1, inserted: 0, pushed: 0 });
    expect(send).not.toHaveBeenCalled();
    expect(await inbox()).toEqual([]);
  });
});

describe("push subscriptions", () => {
  async function subscription(endpoint: string) {
    return must(
      await svc
        .from("push_subscriptions")
        .select("id, user_id, p256dh, auth, user_agent")
        .eq("endpoint", endpoint),
      "subscription",
    );
  }

  it("registers a device, and re-registering updates it in place", async () => {
    const endpoint = fx.pushEndpoint();
    const sneha = await signedInAs(USERS.sneha);

    const first = await sneha.rpc("register_push_subscription", {
      p_endpoint: endpoint,
      ...keys,
      p_user_agent: "Mobile Safari",
    });
    expect(first.error).toBeNull();

    const again = await sneha.rpc("register_push_subscription", {
      p_endpoint: endpoint,
      p_p256dh: "BRotatedKey",
      p_auth: "rotatedAuth",
    });
    expect(again.data).toBe(first.data);

    expect(await subscription(endpoint)).toEqual([
      {
        id: first.data,
        user_id: USERS.sneha.id,
        p256dh: "BRotatedKey",
        auth: "rotatedAuth",
        user_agent: null,
      },
    ]);
    const visible = must(
      await sneha
        .from("push_subscriptions")
        .select("endpoint")
        .eq("endpoint", endpoint),
      "own subscriptions",
    );
    expect(visible).toHaveLength(1);
  });

  it("hands a shared device to whoever signed in on it last", async () => {
    const endpoint = fx.pushEndpoint();
    const sneha = await signedInAs(USERS.sneha);
    const arun = await signedInAs(USERS.arun);

    const mine = await sneha.rpc("register_push_subscription", {
      p_endpoint: endpoint,
      ...keys,
    });
    const theirs = await arun.rpc("register_push_subscription", {
      p_endpoint: endpoint,
      ...keys,
    });
    expect(theirs.data).toBe(mine.data);
    expect((await subscription(endpoint)).map((s) => s.user_id)).toEqual([
      USERS.arun.id,
    ]);

    const snehaSees = must(
      await sneha
        .from("push_subscriptions")
        .select("id")
        .eq("endpoint", endpoint),
      "sneha's subscriptions",
    );
    expect(snehaSees).toEqual([]);
  });

  it.each([
    "fcm.googleapis.com",
    "FCM.googleapis.com:443",
    "updates.push.services.mozilla.com",
    "web.push.apple.com",
    "api.push.apple.com",
    "wns2-par02p.notify.windows.com",
  ])("accepts an endpoint on the push service %s", async (host) => {
    const endpoint = fx.pushEndpoint(host);
    const sneha = await signedInAs(USERS.sneha);
    const { error } = await sneha.rpc("register_push_subscription", {
      p_endpoint: endpoint,
      ...keys,
    });
    expect(error).toBeNull();
    expect(await subscription(endpoint)).toHaveLength(1);
  });

  // Every notification makes the server POST to the endpoint: anything but a
  // real push service would let a user aim those requests wherever they like.
  it.each([
    ["a non-https endpoint", "http://fcm.googleapis.com/x"],
    ["a host that is not a push service", "https://push.example.test/x"],
    ["a look-alike host", "https://fcm.googleapis.com.evil.example/x"],
    [
      "a sub-domain of an exact-match host",
      "https://evil.fcm.googleapis.com/x",
    ],
    ["an explicit port", "https://fcm.googleapis.com:8443/x"],
    ["credentials in the URL", "https://user:pass@fcm.googleapis.com/x"],
    ["an IP address", "https://192.0.2.1/x"],
    [
      "an endpoint over 2048 characters",
      `https://fcm.googleapis.com/${"a".repeat(2048)}`,
    ],
  ])("rejects %s", async (_what, p_endpoint) => {
    const sneha = await signedInAs(USERS.sneha);
    const { error } = await sneha.rpc("register_push_subscription", {
      p_endpoint,
      ...keys,
    });
    expect(error?.code).toBe("22023");
    expect(await subscription(p_endpoint)).toEqual([]);
  });

  it.each([
    ["an empty key", { p_p256dh: "", p_auth: "a" }],
    ["an oversized key", { p_p256dh: "B".repeat(513), p_auth: "a" }],
  ])("rejects %s", async (_what, badKeys) => {
    const sneha = await signedInAs(USERS.sneha);
    const { error } = await sneha.rpc("register_push_subscription", {
      p_endpoint: "https://fcm.googleapis.com/x",
      ...badKeys,
    });
    expect(error?.code).toBe("22023");
  });

  it("keeps a user's 10 most recently seen devices", async () => {
    const sneha = await signedInAs(USERS.sneha);
    const arun = await signedInAs(USERS.arun);
    const register = async (client: typeof sneha, endpoint: string) =>
      must(
        await client.rpc("register_push_subscription", {
          p_endpoint: endpoint,
          ...keys,
        }),
        "register",
      );
    const devicesOf = async (userId: string) =>
      must(
        await svc
          .from("push_subscriptions")
          .select("endpoint")
          .eq("user_id", userId)
          .order("last_seen_at"),
        "devices",
      ).map((s) => s.endpoint);

    const arunsDevice = fx.pushEndpoint();
    await register(arun, arunsDevice);

    // Twelve devices in turn: only the ten seen last are kept.
    const endpoints = Array.from({ length: 12 }, () => fx.pushEndpoint());
    for (const endpoint of endpoints) await register(sneha, endpoint);
    expect(await devicesOf(USERS.sneha.id)).toEqual(endpoints.slice(2));

    // Seeing a device again makes it the newest, so the next one evicts the
    // device seen longest ago instead.
    await register(sneha, endpoints[2]);
    const thirteenth = fx.pushEndpoint();
    await register(sneha, thirteenth);
    expect(await devicesOf(USERS.sneha.id)).toEqual([
      ...endpoints.slice(4),
      endpoints[2],
      thirteenth,
    ]);

    // The cap is per user: another user's device is untouched.
    expect(await devicesOf(USERS.arun.id)).toContain(arunsDevice);

    // ...so the fan-out's lookup returns every recipient's devices, newest first.
    const expected = must(
      await svc
        .from("push_subscriptions")
        .select("id, endpoint, p256dh, auth")
        .in("user_id", TEST_RECIPIENTS)
        .order("user_id")
        .order("last_seen_at", { ascending: false })
        .order("id"),
      "devices",
    );
    expect(await serviceRoleStore().subscriptionsFor(TEST_RECIPIENTS)).toEqual(
      expected,
    );
  });

  it("is refused to a signed-out caller, and cannot be written directly", async () => {
    const endpoint = fx.pushEndpoint();
    const anon = await anonClient().rpc("register_push_subscription", {
      p_endpoint: endpoint,
      ...keys,
    });
    expect(anon.error?.code).toBe("42501");

    const sneha = await signedInAs(USERS.sneha);
    const direct = await sneha.from("push_subscriptions").insert({
      user_id: USERS.sneha.id,
      endpoint,
      p256dh: keys.p_p256dh,
      auth: keys.p_auth,
    });
    expect(direct.error?.code).toBe("42501");
    expect(await subscription(endpoint)).toEqual([]);
  });

  it("unregisters only the caller's own device", async () => {
    const endpoint = fx.pushEndpoint();
    const arun = await signedInAs(USERS.arun);
    must(
      await arun.rpc("register_push_subscription", {
        p_endpoint: endpoint,
        ...keys,
      }),
      "register",
    );

    const sneha = await signedInAs(USERS.sneha);
    expect(
      (
        await sneha.rpc("unregister_push_subscription", {
          p_endpoint: endpoint,
        })
      ).error,
    ).toBeNull();
    expect(await subscription(endpoint)).toHaveLength(1);

    expect(
      (await arun.rpc("unregister_push_subscription", { p_endpoint: endpoint }))
        .error,
    ).toBeNull();
    expect(await subscription(endpoint)).toEqual([]);
  });
});
