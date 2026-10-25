import { randomUUID } from "node:crypto";
import type { PostgrestError } from "@supabase/supabase-js";
import type { TablesInsert } from "@/lib/supabase/database.types";
import { serviceClient, USERS, type Db } from "./helpers";

/**
 * Unwraps a PostgREST result, failing loudly. A fixture that silently did not
 * land would make every later assertion in the test meaningless.
 */
export function must<T>(
  result: { data: T; error: PostgrestError | null },
  what: string,
): NonNullable<T> {
  if (result.error || result.data === null || result.data === undefined) {
    throw new Error(`${what}: ${result.error?.message ?? "no data returned"}`);
  }
  return result.data;
}

/** A short unique tag so fixture names/keys never collide across runs. */
export function uniqueTag(): string {
  return randomUUID().slice(0, 8);
}

type WorkOrderValues = Partial<TablesInsert<"work_orders">>;
type ProjectValues = Partial<TablesInsert<"projects">>;

/**
 * Throwaway rows for one suite, written past RLS with the service role and
 * removed by `cleanup()` — the seed that every other suite relies on stays
 * exactly as `supabase db reset` left it. Deleting a work order cascades to its
 * project, milestones and payments; tickets (`on delete set null`),
 * notifications and push subscriptions are removed explicitly.
 */
export function createFixtures(db: Db = serviceClient()) {
  const workOrders = new Set<string>();
  const tickets = new Set<string>();
  const notifications = new Set<string>();
  const pushEndpoints = new Set<string>();

  async function workOrder(values: WorkOrderValues = {}): Promise<string> {
    const { id } = must(
      await db
        .from("work_orders")
        .insert({
          coordinator_id: USERS.rahul.id,
          client_name: `Fixture ${uniqueTag()}`,
          plant_capacity: "5kW",
          total_cost: 300000,
          status: "approved",
          ...values,
        })
        .select("id")
        .single(),
      "fixture work order",
    );
    workOrders.add(id);
    return id;
  }

  /**
   * An approved work order with its project. Inserting an already-approved
   * work order does not fire the approval trigger, so the project is created
   * here (its insert trigger seeds the 9 milestones).
   */
  async function approvedProject(
    opts: {
      workOrder?: WorkOrderValues;
      project?: ProjectValues;
      /** Further coordinators of the sale, after the first (`workOrder.coordinator_id`, default Rahul). */
      partners?: readonly string[];
    } = {},
  ): Promise<{ workOrderId: string; projectId: string }> {
    const coordinatorId = opts.workOrder?.coordinator_id ?? USERS.rahul.id;
    const workOrderId = await workOrder({
      ...opts.workOrder,
      coordinator_id: coordinatorId,
      status: "approved",
    });
    if (opts.partners?.length) {
      await team(workOrderId, [coordinatorId, ...opts.partners]);
    }
    const { id: projectId } = must(
      await db
        .from("projects")
        .insert({
          work_order_id: workOrderId,
          coordinator_id: coordinatorId,
          ...opts.project,
        })
        .select("id")
        .single(),
      "fixture project",
    );
    return { workOrderId, projectId };
  }

  /**
   * Who shares a sale, through the one write path (set_work_order_coordinators).
   * As the service role there is no signed-in user, which the function treats as
   * a server context — the office's authority. Returns who was added / removed.
   */
  async function team(
    workOrderId: string,
    coordinatorIds: readonly string[],
  ): Promise<{ added: string[]; removed: string[] }> {
    const rows = must(
      await db.rpc("set_work_order_coordinators", {
        p_work_order_id: workOrderId,
        p_coordinator_ids: [...coordinatorIds],
      }),
      "fixture team",
    );
    return {
      added: rows.filter((r) => r.change === "added").map((r) => r.coordinator_id),
      removed: rows
        .filter((r) => r.change === "removed")
        .map((r) => r.coordinator_id),
    };
  }

  /** Sets one coordinator's incentive on a sale (what the office does on the project page). */
  async function incentive(
    workOrderId: string,
    coordinatorId: string,
    values: { amount: number | null; paid_on?: string | null },
  ): Promise<void> {
    const rows = must(
      await db
        .from("coordinator_incentives")
        .update({ amount: values.amount, paid_on: values.paid_on ?? null })
        .eq("work_order_id", workOrderId)
        .eq("coordinator_id", coordinatorId)
        .select("work_order_id"),
      "fixture incentive",
    );
    // No row means that person is not on the sale: fail loudly, not silently.
    if (rows.length !== 1) {
      throw new Error(`fixture incentive: ${coordinatorId} has no row on ${workOrderId}`);
    }
  }

  async function payment(
    workOrderId: string,
    values: Partial<TablesInsert<"payments">> = {},
  ): Promise<string> {
    const { id } = must(
      await db
        .from("payments")
        .insert({
          work_order_id: workOrderId,
          amount: 10000,
          paid_on: "2026-01-15",
          recorded_by: USERS.admin.id,
          ...values,
        })
        .select("id")
        .single(),
      "fixture payment",
    );
    return id;
  }

  async function ticket(
    values: Partial<TablesInsert<"service_tickets">> = {},
  ): Promise<string> {
    const { id } = must(
      await db
        .from("service_tickets")
        .insert({ ticket_type: "adhoc", status: "scheduled", ...values })
        .select("id")
        .single(),
      "fixture ticket",
    );
    tickets.add(id);
    return id;
  }

  async function notification(
    values: Pick<TablesInsert<"notifications">, "recipient_id"> &
      Partial<TablesInsert<"notifications">>,
  ): Promise<string> {
    const { id } = must(
      await db
        .from("notifications")
        .insert({
          type: "test.fixture",
          title: "Fixture notification",
          ...values,
        })
        .select("id")
        .single(),
      "fixture notification",
    );
    notifications.add(id);
    return id;
  }

  /**
   * A fresh endpoint on a real push service (register_push_subscription
   * accepts no other host), removed again on cleanup. Nothing is ever sent to
   * it: no integration test sends a real push.
   */
  function pushEndpoint(host = "fcm.googleapis.com"): string {
    const endpoint = `https://${host}/${randomUUID()}`;
    pushEndpoints.add(endpoint);
    return endpoint;
  }

  async function cleanup(): Promise<void> {
    if (tickets.size)
      await db
        .from("service_tickets")
        .delete()
        .in("id", [...tickets]);
    if (notifications.size) {
      await db
        .from("notifications")
        .delete()
        .in("id", [...notifications]);
    }
    if (pushEndpoints.size) {
      await db
        .from("push_subscriptions")
        .delete()
        .in("endpoint", [...pushEndpoints]);
    }
    if (workOrders.size)
      await db
        .from("work_orders")
        .delete()
        .in("id", [...workOrders]);
    tickets.clear();
    notifications.clear();
    pushEndpoints.clear();
    workOrders.clear();
  }

  return {
    workOrder,
    approvedProject,
    team,
    incentive,
    payment,
    ticket,
    notification,
    pushEndpoint,
    /** Adopt a work order created some other way (an RPC, an RLS-scoped insert). */
    trackWorkOrder: (id: string) => void workOrders.add(id),
    /** Adopt a notification created some other way (e.g. an upsert). */
    trackNotification: (id: string) => void notifications.add(id),
    cleanup,
  };
}

export type Fixtures = ReturnType<typeof createFixtures>;
