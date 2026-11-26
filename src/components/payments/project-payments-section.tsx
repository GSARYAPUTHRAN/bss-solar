import { Wallet } from "lucide-react";
import { EmptyState, Section } from "@/components/layout";
import { Separator } from "@/components/ui/separator";
import { paymentsRepository } from "@/server/data/payments.repository";
import { workOrdersRepository } from "@/server/data/work-orders.repository";
import type { AdvanceDetails } from "@/lib/domain/advance";
import {
  amount as amountOf,
  ledgerTotals,
  maxContractPayment,
  maxRefund,
  maxWriteOff,
  withLedger,
  type PaymentSource,
} from "@/lib/domain/payment";
import type { ProjectCancellation } from "@/lib/types";
import { todayISO } from "@/lib/format";
import { AdvanceLine } from "./advance-line";
import { ContractSummary } from "./contract-summary";
import { LedgerEntryDelete } from "./ledger-entry-delete";
import { PaymentLedger, entryName, type StagedPayment } from "./payment-ledger";
import { PaymentFormDialog, type EditablePayment } from "./payment-form-dialog";
import { WriteOffDialog } from "./write-off-dialog";

/**
 * The payments section of a project: contract summary, the full ledger, and the
 * record / write-off / edit / delete controls the viewer is allowed. Composed by
 * the project detail page; the props are a frozen contract (new ones are
 * optional).
 *
 * The `viewer` flags only decide what is rendered — every action re-checks the
 * caller's role on the server, and RLS checks it again. Writing a balance off is
 * office-only like recording (`canRecord`).
 */
export interface ProjectPaymentsSectionProps {
  workOrderId: string;
  /** For revalidation and notification links. */
  projectId: string | null;
  totalCost: number | string | null;
  advanceAmount: number | string | null;
  /**
   * How and when the advance was paid. A caller that has the work order passes
   * it; the section reads it from the work order otherwise.
   */
  advance?: Partial<AdvanceDetails>;
  isCompleted: boolean;
  /**
   * Set when the project is cancelled or refunded: the balance is no longer
   * receivable (the ledger stays as history).
   */
  cancellation?: ProjectCancellation | null;
  viewer: {
    /** Office staff. */
    canRecord: boolean;
    canEdit: boolean;
    /** Deleters only (`canDeleteRole`: DELETE_ROLES). */
    canDelete: boolean;
  };
}

/** Anchor for "go to payments" links (e.g. from the work-order page). */
export const PAYMENTS_ANCHOR = "payments";

/** Only what the edit dialog needs crosses to the client. */
function editable(p: StagedPayment): EditablePayment {
  const { id, amount, paid_on, method, purpose, paid_by_office, reference, notes } = p;
  return { id, amount, paid_on, method, purpose, paid_by_office, reference, notes };
}

export async function ProjectPaymentsSection({
  workOrderId,
  totalCost,
  advanceAmount,
  advance,
  isCompleted,
  cancellation,
  viewer,
}: ProjectPaymentsSectionProps) {
  // The actions resolve the project from the work order on the server rather
  // than trusting a posted id, so `projectId` is not needed here.
  const [payments, advanceDetails] = await Promise.all([
    paymentsRepository.listForWorkOrder(workOrderId),
    advance ?? workOrdersRepository.advanceDetails(workOrderId),
  ]);
  const totals = ledgerTotals(payments);
  const terms = { total_cost: totalCost, advance_amount: advanceAmount };
  const source = withLedger(terms, payments);
  const today = todayISO();
  const hasRowActions = viewer.canEdit || viewer.canDelete;

  /** What the ledger would hold without one entry — the room an edit of it has. */
  const without = (id: string) =>
    withLedger(
      terms,
      payments.filter((p) => p.id !== id),
    );
  const limitsFor = (room: PaymentSource) => ({
    contract: maxContractPayment(room),
    refund: maxRefund(room),
  });
  // A cancelled or refunded sale's balance is not receivable, so there is none
  // to give up.
  const writeOffBalance = cancellation ? 0 : maxWriteOff(source);

  const rowActions = (p: StagedPayment) => (
    <>
      {viewer.canEdit &&
        (p.purpose === "write_off" ? (
          <WriteOffDialog
            workOrderId={workOrderId}
            today={today}
            balance={maxWriteOff(without(p.id))}
            writeOff={{ id: p.id, amount: p.amount, paid_on: p.paid_on, notes: p.notes }}
            editLabel={`Edit ${entryName(p)}`}
          />
        ) : (
          <PaymentFormDialog
            workOrderId={workOrderId}
            today={today}
            payment={editable(p)}
            limits={limitsFor(without(p.id))}
            editLabel={`Edit ${entryName(p)}`}
          />
        ))}
      {viewer.canDelete && <LedgerEntryDelete payment={p} workOrderId={workOrderId} />}
    </>
  );

  return (
    <div id={PAYMENTS_ANCHOR} className="scroll-mt-20">
      <Section
        title="Payments"
        icon={Wallet}
        actions={
          viewer.canRecord ? (
            <div className="flex flex-wrap justify-end gap-2">
              <PaymentFormDialog
                workOrderId={workOrderId}
                today={today}
                limits={limitsFor(source)}
              />
              {writeOffBalance > 0 && (
                <WriteOffDialog
                  workOrderId={workOrderId}
                  today={today}
                  balance={writeOffBalance}
                />
              )}
            </div>
          ) : undefined
        }
        contentClassName="space-y-5"
      >
        <ContractSummary
          source={source}
          isCompleted={isCompleted}
          cancellation={cancellation}
          ksebFeesCollected={totals.ksebFees}
          ksebFeesByOffice={totals.ksebFeesByOffice}
        />

        <Separator />

        <div className="space-y-3">
          <AdvanceLine amount={amountOf(advanceAmount)} details={advanceDetails ?? undefined} />

          {payments.length === 0 ? (
            <EmptyState
              icon={Wallet}
              title="No instalments recorded yet"
              description={
                viewer.canRecord
                  ? "Record each payment as it comes in — the customer can pay in as many stages as they need."
                  : "Payments the office records against this project will appear here."
              }
            />
          ) : (
            <div className="space-y-2">
              <h3 className="text-sm font-semibold">
                Ledger
                <span className="ml-2 font-normal text-muted-foreground">
                  {totals.count} instalment{totals.count === 1 ? "" : "s"} after the
                  advance
                </span>
              </h3>
              <PaymentLedger
                payments={payments}
                renderActions={hasRowActions ? rowActions : undefined}
              />
            </div>
          )}
        </div>
      </Section>
    </div>
  );
}
