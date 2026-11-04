"use client";

import { Loader2, Users } from "lucide-react";
import { updateCoordinatorIncentive } from "@/app/(app)/projects/actions";
import { FormError, FormField, Section } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { incentivePending } from "@/lib/domain/incentives";
import { formatCurrency } from "@/lib/format";
import type { ProjectCoordinator } from "@/server/data/projects.repository";
import { IncentiveBadge } from "./incentive-badge";
import { IncentiveFigures, InstalmentList } from "./incentive-instalments";
import {
  InstalmentDialog,
  RemoveInstalmentDialog,
} from "./incentive-payment-dialogs";
import { useProjectAction } from "./use-project-action";

/**
 * Office only: one block per coordinator of the sale — their agreed incentive,
 * the instalments paid against it, and the way to record one. Private to that
 * person and the office (RLS), so a shared sale never splits or reveals anyone's
 * pay. Clearing the amount removes the incentive; the person is told when the
 * amount changes and when an instalment is paid.
 *
 * Stays editable on a cancelled or refunded project on purpose: a cancellation
 * leaves incentives alone, and this is where the office lowers or clears one
 * that will not be paid in full.
 */
export function CoordinatorIncentivesSection({
  projectId,
  coordinators,
  today,
  className,
}: {
  projectId: string;
  coordinators: readonly ProjectCoordinator[];
  /** IST date from the server — an instalment cannot be dated later. */
  today: string;
  className?: string;
}) {
  return (
    <Section
      title="Coordinator incentives"
      description="Office only — each person sees just their own. Agree an amount, then record each payment as it is made."
      icon={Users}
      className={className}
      contentClassName="space-y-3"
    >
      {coordinators.map((coordinator, index) => (
        <IncentiveBlock
          key={coordinator.id}
          projectId={projectId}
          coordinator={coordinator}
          first={index === 0 && coordinators.length > 1}
          today={today}
        />
      ))}
    </Section>
  );
}

function IncentiveBlock({
  projectId,
  coordinator,
  first,
  today,
}: {
  projectId: string;
  coordinator: ProjectCoordinator;
  /** The one who logged a shared sale. */
  first: boolean;
  today: string;
}) {
  const { incentive } = coordinator;
  const amount = incentive?.amount ?? null;
  const paid = incentive?.paid ?? 0;
  const pending = incentivePending({ amount, paid });
  const headingId = `incentive-${coordinator.id}`;

  return (
    <div
      role="group"
      aria-labelledby={headingId}
      className="space-y-3 rounded-md border p-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="min-w-0 text-sm">
          <span id={headingId} className="font-medium">
            Incentive for {coordinator.full_name}
          </span>
          {first && <span className="ml-2 text-xs text-muted-foreground">logged the sale</span>}
        </p>
        <IncentiveBadge amount={amount} paid={paid} />
      </div>

      {/* Re-mounted when the saved amount changes, so the input always shows
          what is stored (including a change made by someone else). */}
      <AgreedAmountForm
        key={`${coordinator.id}:${amount ?? ""}`}
        projectId={projectId}
        coordinator={coordinator}
        paid={paid}
      />

      {amount !== null && (
        <div className="space-y-3">
          <IncentiveFigures amount={amount} paid={paid} pending={pending} />
          <InstalmentList
            label={`Payments to ${coordinator.full_name}`}
            payments={incentive?.payments ?? []}
            renderActions={(payment) => (
              <>
                <InstalmentDialog
                  projectId={projectId}
                  payee={coordinator}
                  incentive={{ amount, paid }}
                  today={today}
                  payment={payment}
                />
                <RemoveInstalmentDialog
                  projectId={projectId}
                  payee={coordinator}
                  payment={payment}
                />
              </>
            )}
          />
          <div className="space-y-1.5">
            <InstalmentDialog
              projectId={projectId}
              payee={coordinator}
              incentive={{ amount, paid }}
              today={today}
            />
            {pending <= 0 && (
              <p className="text-xs text-muted-foreground">
                {amount === 0
                  ? "Nothing is owed on a zero incentive."
                  : "Fully paid — nothing more to record."}
              </p>
            )}
          </div>
        </div>
      )}
      {amount === null && (
        <p className="text-xs text-muted-foreground">
          Set the agreed amount to start recording payments.
        </p>
      )}
    </div>
  );
}

/** The agreed amount: office-set, never below what is already paid. */
function AgreedAmountForm({
  projectId,
  coordinator,
  paid,
}: {
  projectId: string;
  coordinator: ProjectCoordinator;
  paid: number;
}) {
  const { error, pending, onSubmit } = useProjectAction(updateCoordinatorIncentive);
  const amountId = `incentive-amount-${coordinator.id}`;

  return (
    <form
      onSubmit={onSubmit}
      aria-label={`Agreed incentive for ${coordinator.full_name}`}
      aria-busy={pending}
      className="space-y-3"
    >
      <input type="hidden" name="project_id" value={projectId} />
      <input type="hidden" name="coordinator_id" value={coordinator.id} />

      <FormError message={error} />

      <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
        <FormField
          label="Agreed amount (₹)"
          htmlFor={amountId}
          hint={
            paid > 0
              ? `Cannot be less than the ${formatCurrency(paid)} already paid. Remove those payments first to clear it.`
              : "Leave empty for no incentive."
          }
        >
          <Input
            id={amountId}
            name="amount"
            type="number"
            inputMode="decimal"
            min={paid}
            step="0.01"
            placeholder="e.g. 2500"
            defaultValue={coordinator.incentive?.amount ?? ""}
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
