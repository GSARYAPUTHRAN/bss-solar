import { Trash2, Wallet } from "lucide-react";
import { deletePayment } from "@/app/(app)/payments/actions";
import { EmptyState, Section } from "@/components/layout";
import { ConfirmSubmit } from "@/components/confirm-submit";
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
import { formatCurrency, formatDate, todayISO } from "@/lib/format";
import { AdvanceLine } from "./advance-line";
import { ContractSummary } from "./contract-summary";
import { PaymentLedger, entryName, stageLabel, type StagedPayment } from "./payment-ledger";
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
    /** SuperAdmin only. */
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

/** What the confirmation calls the entry: a refund and a write-off are not "payments". */
function noun(p: Pick<StagedPayment, "purpose">): string {
  return p.purpose === "write_off" ? "write-off" : p.purpose === "refund" ? "refund" : "payment";
}

/** What deleting an entry does to the books, in the words the confirmation uses. */
function deleteDescription(p: StagedPayment): string {
  const head = `${stageLabel(p)} · ${formatCurrency(p.amount)}`;
  const gone = "It is removed from the ledger for good";
  switch (p.purpose) {
    case "refund":
      return `${head} paid back ${formatDate(p.paid_on)}. ${gone}: the net received goes back up and the balance due falls by the same amount. This cannot be undone.`;
    case "write_off":
      return `${head} written off ${formatDate(p.paid_on)}. ${gone} and the ${formatCurrency(p.amount)} becomes due again. This cannot be undone.`;
    case "kseb_fees":
      return `${head} ${p.paid_by_office ? "paid by the office" : "received"} ${formatDate(p.paid_on)}. ${gone}. The contract balance is not affected. This cannot be undone.`;
    default:
      return `${head} received ${formatDate(p.paid_on)}. ${gone} and the balance due goes back up. This cannot be undone.`;
  }
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
      {viewer.canDelete && (
        <ConfirmSubmit
          action={deletePayment}
          fields={{ id: p.id, work_order_id: workOrderId }}
          triggerLabel={<Trash2 />}
          triggerAriaLabel={`Delete ${entryName(p)}`}
          triggerVariant="ghost"
          triggerClassName="size-10 p-0 text-destructive hover:text-destructive md:size-8"
          title={`Delete this ${noun(p)}?`}
          description={deleteDescription(p)}
          confirmLabel={`Delete ${noun(p)}`}
          loadingText="Deleting…"
        />
      )}
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
