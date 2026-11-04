import { HandCoins } from "lucide-react";
import { Section } from "@/components/layout";
import { incentivePending } from "@/lib/domain/incentives";
import type { DetailIncentive } from "@/server/data/projects.repository";
import { IncentiveBadge } from "./incentive-badge";
import { IncentiveFigures, InstalmentList } from "./incentive-instalments";

/**
 * A coordinator's own incentive on a sale, read-only: what the office agreed,
 * what has been paid of it, each payment and what is still to come. It is only
 * ever handed the viewer's own incentive (RLS hides a partner's, instalments
 * included), and nothing here can change it.
 */
export function OwnIncentiveSection({
  incentive,
  className,
}: {
  /** The viewer's own incentive; null when the office has not set one up for them. */
  incentive: DetailIncentive | null;
  className?: string;
}) {
  const amount = incentive?.amount ?? null;
  const paid = incentive?.paid ?? 0;

  return (
    <Section
      title="Your incentive payments"
      description="Only you and the office can see this."
      icon={HandCoins}
      className={className}
      actions={amount !== null && <IncentiveBadge amount={amount} paid={paid} />}
      contentClassName="space-y-3"
    >
      {amount === null ? (
        <p className="text-sm text-muted-foreground">
          The office has not set your incentive on this sale yet.
        </p>
      ) : (
        <>
          <IncentiveFigures
            amount={amount}
            paid={paid}
            pending={incentivePending({ amount, paid })}
          />
          <InstalmentList label="Payments to you" payments={incentive?.payments ?? []} />
        </>
      )}
    </Section>
  );
}
