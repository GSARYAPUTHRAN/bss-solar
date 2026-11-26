import { deleteWorkOrder } from "@/app/(app)/work-orders/actions";
import { ConfirmSubmit } from "@/components/confirm-submit";

/** What the page knows about the sale, to say what goes with it. */
export interface SaleToDelete {
  id: string;
  clientName: string;
  /** Whether the sale has a project (approved): it goes too, with its milestones. */
  hasProject: boolean;
  /** Ledger entries recorded against the sale (payments, KSEB fees, refunds, write-offs). */
  ledgerEntries: number;
}

function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** "a, b and c". */
function listed(parts: readonly string[]): string {
  return parts.length <= 1
    ? parts.join("")
    : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
}

/**
 * What deleting a whole sale takes with it, for its confirmation: "This
 * permanently deletes the sale Anil Kumar, its project and milestones, 3 ledger
 * entries and every coordinator's incentive. Service tickets stay but lose their
 * link to the project. This cannot be undone."
 */
export function saleDeleteDescription(sale: SaleToDelete): string {
  const client = sale.clientName.trim();
  const parts = [client ? `the sale ${client}` : "this sale"];
  if (sale.hasProject) parts.push("its project and milestones");
  if (sale.ledgerEntries > 0) {
    parts.push(count(sale.ledgerEntries, "ledger entry", "ledger entries"));
  }
  parts.push("every coordinator's incentive");
  const tickets = sale.hasProject
    ? " Service tickets stay but lose their link to the project."
    : "";
  return `This permanently deletes ${listed(parts)}.${tickets} This cannot be undone.`;
}

/**
 * Delete a whole sale (the work order and everything on it) behind a
 * confirmation that lists what goes with it. Render it for deleters only
 * (`canDeleteRole`); `deleteWorkOrder` checks the role again.
 *
 * On the work order's page it is "Delete" (the work order); on the project page
 * (`back="projects"`) it is "Delete sale", next to "Delete project", and lands
 * on the projects list afterwards.
 */
export function DeleteSaleButton({
  sale,
  back,
  projectId,
  triggerClassName = "h-10 text-destructive hover:text-destructive md:h-8",
}: {
  sale: SaleToDelete;
  back?: "projects";
  /** With `back="projects"`: the project page a refusal is shown on. */
  projectId?: string;
  triggerClassName?: string;
}) {
  const fromProject = back === "projects";
  const noun = fromProject ? "sale" : "work order";
  return (
    <ConfirmSubmit
      action={deleteWorkOrder}
      fields={
        fromProject
          ? { id: sale.id, back: "projects", ...(projectId ? { project_id: projectId } : {}) }
          : { id: sale.id }
      }
      triggerLabel={fromProject ? "Delete sale" : "Delete"}
      triggerVariant="ghost"
      triggerClassName={triggerClassName}
      title={`Delete this ${noun}?`}
      description={saleDeleteDescription(sale)}
      confirmLabel={`Delete ${noun}`}
      loadingText="Deleting…"
    />
  );
}
