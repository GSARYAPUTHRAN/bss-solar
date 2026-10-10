import { after } from "next/server";
import type { NotificationEvent } from "@/lib/domain/notifications";
import { deliver } from "./deliver";

export { deliver } from "./deliver";
export type { DeliveryReport, DeliveryDeps } from "./deliver";
export { isPushConfigured } from "./config";

/**
 * Announce events from a server action. Fire-and-forget: delivery runs after the
 * response is sent (`after`), so it never slows the user down, and a failure is
 * logged — a notification problem must never fail the business action that
 * triggered it. `after` callbacks still run when the action ends in redirect().
 */
export function notify(...events: NotificationEvent[]): void {
  if (events.length === 0) return;

  const run = async () => {
    for (const event of events) {
      try {
        await deliver(event);
      } catch (error) {
        console.error(`[notify] ${event.type} failed:`, error);
      }
    }
  };

  try {
    after(run);
  } catch {
    // Outside a request scope (scripts/tests): deliver without blocking.
    void run();
  }
}
