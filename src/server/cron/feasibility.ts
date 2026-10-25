import { createAdminClient } from "@/lib/supabase/admin";
import { feasibilityEvents, type NotificationEvent } from "@/lib/domain/notifications";
import type { ProjectCancellation } from "@/lib/types";
import { deliver, type DeliveryReport } from "@/server/notifications/deliver";
import { serviceRoleStore, type NotificationStore } from "@/server/notifications/store";

/**
 * Daily KSEB feasibility alerts. For every active project with a feasibility
 * date, emit the "expiring" / "extended" events its clock warrants today (see
 * feasibilityEvents) and deliver them. Dedupe keys on the notification rows
 * make re-runs harmless: a second run the same day inserts and pushes nothing.
 */

/** A project as the feasibility rules need it. */
export interface FeasibilityProject {
  projectId: string;
  /** Everyone on the sale, in order. */
  coordinatorIds: string[];
  clientName: string;
  feasibilityDate: string | null;
  completedAt: string | null;
  isCompleted: boolean;
  /** Cancelled or refunded: no clock runs, so no alerts (feasibilityEvents). */
  cancellation?: ProjectCancellation | null;
}

export interface FeasibilityAlertDeps {
  /** IST calendar date the alerts are computed for. */
  today: string;
  loadProjects(): Promise<FeasibilityProject[]>;
  deliver(event: NotificationEvent): Promise<DeliveryReport>;
  /** Deliveries in flight at once (each is a few DB round trips + pushes). */
  concurrency?: number;
}

export interface FeasibilityAlertReport {
  date: string;
  projectsScanned: number;
  events: number;
  delivered: number;
  /** Events whose delivery threw (logged; the run carries on). */
  failed: number;
  inserted: number;
  pushed: number;
  failedPushes: number;
  prunedSubscriptions: number;
}

const DEFAULT_CONCURRENCY = 4;

/** Run `task` over `items` with at most `limit` in flight. `task` must not throw. */
async function forEachLimited<T>(
  items: readonly T[],
  limit: number,
  task: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const item = items[next];
      next += 1;
      await task(item);
    }
  };
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker),
  );
}

export async function runFeasibilityAlerts(
  deps: FeasibilityAlertDeps,
): Promise<FeasibilityAlertReport> {
  const projects = await deps.loadProjects();

  const events: NotificationEvent[] = [];
  for (const project of projects) {
    try {
      events.push(...feasibilityEvents(project, deps.today));
    } catch (error) {
      // One malformed date must not cost every other project its alert.
      console.error(`[cron/feasibility] skipped project ${project.projectId}:`, error);
    }
  }

  const report: FeasibilityAlertReport = {
    date: deps.today,
    projectsScanned: projects.length,
    events: events.length,
    delivered: 0,
    failed: 0,
    inserted: 0,
    pushed: 0,
    failedPushes: 0,
    prunedSubscriptions: 0,
  };

  await forEachLimited(events, deps.concurrency ?? DEFAULT_CONCURRENCY, async (event) => {
    try {
      const result = await deps.deliver(event);
      report.delivered += 1;
      report.inserted += result.inserted;
      report.pushed += result.pushed;
      report.failedPushes += result.failedPushes;
      report.prunedSubscriptions += result.prunedSubscriptions;
    } catch (error) {
      report.failed += 1;
      console.error(`[cron/feasibility] ${event.type} delivery failed:`, error);
    }
  });

  return report;
}

/**
 * The office recipient list is identical for every event in a run: look it up
 * once instead of once per event. A failed lookup is not cached.
 */
export function withCachedOfficeIds(store: NotificationStore): NotificationStore {
  let office: Promise<string[]> | null = null;
  return {
    ...store,
    officeIds() {
      office ??= store.officeIds().catch((error: unknown) => {
        office = null;
        throw error;
      });
      return office;
    },
  };
}

/** Production delivery for one cron run (service role, shared office lookup). */
export function cronDeliverer(): (event: NotificationEvent) => Promise<DeliveryReport> {
  const store = withCachedOfficeIds(serviceRoleStore());
  return (event) => deliver(event, { store });
}

/** PostgREST's default max rows per request. */
const PAGE_SIZE = 1000;

/** One `work_order_coordinators` row as the embed returns it. */
interface MemberRow {
  coordinator_id: string;
  sort_order: number;
}

/**
 * Active projects that have a feasibility date: not commissioned, and not
 * cancelled or refunded (their clock stopped). Each carries EVERY coordinator of
 * its sale, in order, so each of them hears about the clock.
 */
export async function loadActiveFeasibilityProjects(): Promise<FeasibilityProject[]> {
  const db = createAdminClient();
  const projects: FeasibilityProject[] = [];

  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await db
      .from("projects")
      .select(
        `id, feasibility_date, completed_at, is_completed, cancellation,
         work_order:work_orders!projects_work_order_id_fkey(client_name,
           coordinators:work_order_coordinators!work_order_coordinators_work_order_id_fkey(coordinator_id, sort_order))`,
      )
      .eq("is_completed", false)
      .is("cancellation", null)
      .not("feasibility_date", "is", null)
      .order("id")
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`feasibility project lookup failed: ${error.message}`);

    const rows = (data ?? []) as unknown as {
      id: string;
      feasibility_date: string | null;
      completed_at: string | null;
      is_completed: boolean;
      cancellation: ProjectCancellation | null;
      work_order: { client_name: string; coordinators: MemberRow[] | null } | null;
    }[];
    for (const row of rows) {
      projects.push({
        projectId: row.id,
        coordinatorIds: [...(row.work_order?.coordinators ?? [])]
          .sort(
            (a, b) =>
              a.sort_order - b.sort_order ||
              (a.coordinator_id < b.coordinator_id ? -1 : 1),
          )
          .map((member) => member.coordinator_id),
        clientName: row.work_order?.client_name ?? "A project",
        feasibilityDate: row.feasibility_date,
        completedAt: row.completed_at,
        isCompleted: row.is_completed,
        cancellation: row.cancellation,
      });
    }
    if (rows.length < PAGE_SIZE) return projects;
  }
}
