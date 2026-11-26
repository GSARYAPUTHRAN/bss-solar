import { Trash2 } from "lucide-react";
import { deletePayment } from "@/app/(app)/payments/actions";
import { ConfirmSubmit } from "@/components/confirm-submit";
import { formatCurrency, formatDate } from "@/lib/format";
import { entryName, stageLabel, type StagedPayment } from "./payment-ledger";

/** What the confirmation calls the entry: a refund and a write-off are not "payments". */
function noun(p: Pick<StagedPayment, "purpose">): string {
  return p.purpose === "write_off" ? "write-off" : p.purpose === "refund" ? "refund" : "payment";
}

/** What deleting an entry does to the books, in the words the confirmation uses. */
export function ledgerDeleteDescription(p: StagedPayment): string {
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

/**
 * The per-row delete of a ledger entry (stage payment, KSEB fee, refund,
 * write-off), as an icon button behind a confirmation that says what it does to
 * the books. Used by the project's payments section and, while a sale has no
 * project, by the work order's own ledger. Render it for deleters only
 * (`canDeleteRole`); `deletePayment` checks the role again, and refuses a delete
 * that would break the ledger.
 */
export function LedgerEntryDelete({
  payment,
  workOrderId,
}: {
  payment: StagedPayment;
  workOrderId: string;
}) {
  return (
    <ConfirmSubmit
      action={deletePayment}
      fields={{ id: payment.id, work_order_id: workOrderId }}
      triggerLabel={<Trash2 />}
      triggerAriaLabel={`Delete ${entryName(payment)}`}
      triggerVariant="ghost"
      triggerClassName="size-10 p-0 text-destructive hover:text-destructive md:size-8"
      title={`Delete this ${noun(payment)}?`}
      description={ledgerDeleteDescription(payment)}
      confirmLabel={`Delete ${noun(payment)}`}
      loadingText="Deleting…"
    />
  );
}
