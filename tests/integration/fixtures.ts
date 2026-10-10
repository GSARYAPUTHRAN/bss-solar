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
    opts: { workOrder?: WorkOrderValues; project?: ProjectValues } = {},
  ): Promise<{ workOrderId: string; projectId: string }> {
    const coordinatorId = opts.workOrder?.coordinator_id ?? USERS.rahul.id;
    const workOrderId = await workOrder({
      ...opts.workOrder,
      coordinator_id: coordinatorId,
      status: "approved",
    });
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
