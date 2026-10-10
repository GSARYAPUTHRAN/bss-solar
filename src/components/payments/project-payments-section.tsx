import { Trash2, Wallet } from "lucide-react";
import { deletePayment } from "@/app/(app)/payments/actions";
import { EmptyState, Section } from "@/components/layout";
import { ConfirmSubmit } from "@/components/confirm-submit";
import { Separator } from "@/components/ui/separator";
import { paymentsRepository } from "@/server/data/payments.repository";
import { ledgerTotals } from "@/lib/domain/payment";
import { formatCurrency, formatDate, todayISO } from "@/lib/format";
import { ContractSummary } from "./contract-summary";
import { PaymentLedger, stageLabel, type StagedPayment } from "./payment-ledger";
import { PaymentFormDialog, type EditablePayment } from "./payment-form-dialog";

/**
 * The payments section of a project: contract summary, the full ledger, and the
 * record / edit / delete controls the viewer is allowed. Composed by the
 * project detail page; the props are a frozen contract.
 *
 * The `viewer` flags only decide what is rendered — every action re-checks the
 * caller's role on the server, and RLS checks it again.
 */
export interface ProjectPaymentsSectionProps {
  workOrderId: string;
  /** For revalidation and notification links. */
  projectId: string | null;
  totalCost: number | string | null;
  advanceAmount: number | string | null;
  isCompleted: boolean;
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
  const { id, amount, paid_on, method, purpose, reference, notes } = p;
  return { id, amount, paid_on, method, purpose, reference, notes };
}

export async function ProjectPaymentsSection({
  workOrderId,
  totalCost,
  advanceAmount,
  isCompleted,
  viewer,
}: ProjectPaymentsSectionProps) {
  // The actions resolve the project from the work order on the server rather
  // than trusting a posted id, so `projectId` is not needed here.
  const payments = await paymentsRepository.listForWorkOrder(workOrderId);
  const totals = ledgerTotals(payments);
  const today = todayISO();
  const hasRowActions = viewer.canEdit || viewer.canDelete;

  const rowActions = (p: StagedPayment) => (
    <>
      {viewer.canEdit && (
        <PaymentFormDialog
          workOrderId={workOrderId}
          today={today}
          payment={editable(p)}
          editLabel={`Edit ${stageLabel(p).toLowerCase()} payment`}
        />
      )}
      {viewer.canDelete && (
        <ConfirmSubmit
          action={deletePayment}
          fields={{ id: p.id, work_order_id: workOrderId }}
          triggerLabel={<Trash2 />}
          triggerAriaLabel={`Delete ${stageLabel(p).toLowerCase()} payment`}
          triggerVariant="ghost"
          triggerClassName="size-10 p-0 text-destructive hover:text-destructive md:size-8"
          title="Delete this payment?"
          description={`${stageLabel(p)} · ${formatCurrency(p.amount)} received ${formatDate(p.paid_on)}. It is removed from the ledger for good and the balance due goes back up. This cannot be undone.`}
          confirmLabel="Delete payment"
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
            <PaymentFormDialog workOrderId={workOrderId} today={today} />
          ) : undefined
        }
        contentClassName="space-y-5"
      >
        <ContractSummary
          source={{
            total_cost: totalCost,
            advance_amount: advanceAmount,
            payments_total: totals.contract,
          }}
          isCompleted={isCompleted}
          ksebFeesCollected={totals.ksebFees}
        />

        <Separator />

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
      </Section>
    </div>
  );
}
