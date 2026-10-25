"use client";

import { Loader2, Users } from "lucide-react";
import { updateCoordinatorIncentive } from "@/app/(app)/projects/actions";
import { FormError, FormField, Section } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { SaleCoordinator } from "@/lib/types";
import { IncentiveBadge } from "./incentive-badge";
import { useProjectAction } from "./use-project-action";

/**
 * Office only: one form per coordinator of the sale — their own incentive and
 * when it was paid. Private to that person and the office (RLS), so a shared
 * sale never splits or reveals anyone's pay. Clearing the amount removes the
 * incentive; the person is told about every change, removal included.
 *
 * Stays editable on a cancelled or refunded project on purpose: a cancellation
 * leaves incentives alone, and this is where the office clears one that will
 * not be paid.
 */
export function CoordinatorIncentivesSection({
  projectId,
  coordinators,
  today,
  className,
}: {
  projectId: string;
  coordinators: readonly SaleCoordinator[];
  /** IST date from the server — an incentive cannot have been paid later. */
  today: string;
  className?: string;
}) {
  return (
    <Section
      title="Coordinator incentives"
      description="Office only — each person sees just their own. Leave the amount empty for no incentive."
      icon={Users}
      className={className}
      contentClassName="space-y-3"
    >
      {coordinators.map((coordinator, index) => (
        // Re-mounted when the saved values change, so the inputs always show
        // what is stored (including a change made by someone else).
        <IncentiveRow
          key={`${coordinator.id}:${coordinator.incentive?.amount ?? ""}:${coordinator.incentive?.paid_on ?? ""}`}
          projectId={projectId}
          coordinator={coordinator}
          first={index === 0 && coordinators.length > 1}
          today={today}
        />
      ))}
    </Section>
  );
}

function IncentiveRow({
  projectId,
  coordinator,
  first,
  today,
}: {
  projectId: string;
  coordinator: SaleCoordinator;
  /** The one who logged a shared sale. */
  first: boolean;
  today: string;
}) {
  const { error, pending, onSubmit } = useProjectAction(updateCoordinatorIncentive);
  const amount = coordinator.incentive?.amount ?? null;
  const paidOn = coordinator.incentive?.paid_on ?? null;
  const amountId = `incentive-amount-${coordinator.id}`;
  const paidOnId = `incentive-paid-on-${coordinator.id}`;

  return (
    <form
      onSubmit={onSubmit}
      aria-label={`Incentive for ${coordinator.full_name}`}
      aria-busy={pending}
      className="space-y-3 rounded-md border p-3"
    >
      <input type="hidden" name="project_id" value={projectId} />
      <input type="hidden" name="coordinator_id" value={coordinator.id} />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="min-w-0 text-sm font-medium">
          {coordinator.full_name}
          {first && (
            <span className="ml-2 text-xs font-normal text-muted-foreground">logged the sale</span>
          )}
        </p>
        <IncentiveBadge incentive={amount} paidOn={paidOn} />
      </div>

      <FormError message={error} />

      <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <FormField label="Amount (₹)" htmlFor={amountId}>
          <Input
            id={amountId}
            name="amount"
            type="number"
            inputMode="decimal"
            min={0}
            step="0.01"
            placeholder="e.g. 2500"
            defaultValue={amount ?? ""}
            className="h-10"
          />
        </FormField>
        <FormField label="Paid on" htmlFor={paidOnId}>
          <Input
            id={paidOnId}
            name="paid_on"
            type="date"
            max={today}
            defaultValue={paidOn ?? ""}
            className="h-10"
          />
        </FormField>
        <Button type="submit" className="h-10 w-full sm:w-auto" disabled={pending}>
          {pending ? (
            <>
              <Loader2 className="animate-spin" data-icon="inline-start" />
              Saving…
            </>
          ) : (
            "Save"
          )}
        </Button>
      </div>
    </form>
  );
}
