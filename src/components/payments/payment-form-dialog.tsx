"use client";

import { useState } from "react";
import { Loader2, Pencil, Plus } from "lucide-react";
import {
  recordPayment,
  updatePayment,
} from "@/app/(app)/payments/actions";
import { FormError, FormField, FormGrid } from "@/components/layout";
import { FormSelect } from "@/components/form-select";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { PAYMENT_METHOD_LABELS } from "@/lib/domain/payment";
import {
  PAYMENT_KINDS,
  isPaymentKind,
  kindOfEntry,
  paymentKind,
  type PaymentKind,
} from "@/lib/domain/payment-kinds";
import { PAYMENT_LIMITS } from "@/lib/domain/payment-limits";
import { formatCurrency } from "@/lib/format";
import type { Payment } from "@/lib/types";
import { usePaymentAction } from "./use-payment-action";

/** The fields of an entry the dialog edits. */
export type EditablePayment = Pick<
  Payment,
  "id" | "amount" | "paid_on" | "method" | "purpose" | "paid_by_office" | "reference" | "notes"
>;

/**
 * The most each kind of entry can be right now, from what the ledger holds (see
 * `maxContractPayment` and `maxRefund`). Shown as a hint — the server decides —
 * so a typo is noticed before the round trip, not after it. When editing an
 * entry these exclude the entry's own amount.
 */
export interface PaymentLimits {
  contract: number;
  refund: number;
}

const METHOD_OPTIONS = Object.entries(PAYMENT_METHOD_LABELS).map(([value, label]) => ({
  value,
  label,
}));

function amountHint(kind: PaymentKind, limits?: PaymentLimits): string | undefined {
  if (!limits) return undefined;
  if (kind === "contract") {
    return limits.contract > 0
      ? `Up to ${formatCurrency(limits.contract)} — the balance due.`
      : "Nothing is due on this contract.";
  }
  if (kind === "refund") {
    return limits.refund > 0
      ? `Up to ${formatCurrency(limits.refund)} — what was collected, less refunds already made.`
      : "Nothing has been collected to refund.";
  }
  return undefined;
}

/**
 * Record a new ledger entry — a contract payment, a KSEB fee (the customer's or
 * the office's) or a refund — or edit `payment` when given. The form only mounts
 * while the dialog is open, so every opening starts from a clean action state.
 * Writing a balance off is its own dialog (`WriteOffDialog`).
 */
export function PaymentFormDialog({
  workOrderId,
  today,
  payment,
  editLabel,
  limits,
}: {
  workOrderId: string;
  /** IST date from the server — the default and latest allowed date. */
  today: string;
  payment?: EditablePayment;
  /** Accessible name for the icon-only edit trigger, e.g. "Edit stage 2". */
  editLabel?: string;
  limits?: PaymentLimits;
}) {
  const [open, setOpen] = useState(false);
  const editing = Boolean(payment);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {editing ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-10 md:size-8"
            aria-label={editLabel ?? "Edit payment"}
          >
            <Pencil />
          </Button>
        ) : (
          <Button type="button" className="h-10 md:h-8">
            <Plus data-icon="inline-start" /> Record payment
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit payment" : "Record payment"}</DialogTitle>
          <DialogDescription>
            {editing
              ? "Correct this ledger entry. The balance due updates straight away."
              : "Add money received after the booking advance, a KSEB fee, or a refund. To give up a balance instead, use Write off balance."}
          </DialogDescription>
        </DialogHeader>
        <PaymentForm
          workOrderId={workOrderId}
          today={today}
          payment={payment}
          limits={limits}
          onSaved={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

function PaymentForm({
  workOrderId,
  today,
  payment,
  limits,
  onSaved,
}: {
  workOrderId: string;
  today: string;
  payment?: EditablePayment;
  limits?: PaymentLimits;
  onSaved: () => void;
}) {
  const { error, pending, onSubmit } = usePaymentAction(
    payment ? updatePayment : recordPayment,
    onSaved,
  );
  const [kind, setKind] = useState<PaymentKind>(
    (payment && kindOfEntry(payment)) || "contract",
  );
  const info = paymentKind(kind);

  return (
    <form onSubmit={onSubmit} className="space-y-4" aria-busy={pending}>
      <FormError message={error} />
      {payment ? (
        <input type="hidden" name="id" value={payment.id} />
      ) : (
        <input type="hidden" name="work_order_id" value={workOrderId} />
      )}

      <FormField label="What is this for?" htmlFor="payment_kind" required hint={info.hint}>
        <Select
          name="kind"
          value={kind}
          onValueChange={(value) => {
            if (isPaymentKind(value)) setKind(value);
          }}
        >
          <SelectTrigger id="payment_kind" className="w-full data-[size=default]:h-10">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PAYMENT_KINDS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FormField>

      <FormGrid>
        <FormField
          label="Amount (INR)"
          htmlFor="payment_amount"
          required
          hint={amountHint(kind, limits)}
        >
          <Input
            id="payment_amount"
            name="amount"
            type="number"
            inputMode="decimal"
            min="0.01"
            max={PAYMENT_LIMITS.maxAmount}
            step="0.01"
            defaultValue={payment ? String(payment.amount) : ""}
            className="h-10"
            required
          />
        </FormField>
        <FormField label={info.dateLabel} htmlFor="payment_paid_on" required>
          <Input
            id="payment_paid_on"
            name="paid_on"
            type="date"
            max={today}
            defaultValue={payment?.paid_on ?? today}
            className="h-10"
            required
          />
        </FormField>
      </FormGrid>

      <FormGrid>
        <FormField label="Method" htmlFor="payment_method" required>
          <FormSelect
            id="payment_method"
            name="method"
            options={METHOD_OPTIONS}
            defaultValue={payment?.method ?? "bank_transfer"}
            className="w-full data-[size=default]:h-10"
          />
        </FormField>
        <FormField label="Reference" htmlFor="payment_reference" hint="UTR, cheque or UPI reference.">
          <Input
            id="payment_reference"
            name="reference"
            maxLength={PAYMENT_LIMITS.referenceLength}
            defaultValue={payment?.reference ?? ""}
            className="h-10"
          />
        </FormField>
      </FormGrid>

      <FormField label="Notes" htmlFor="payment_notes">
        <Textarea
          id="payment_notes"
          name="notes"
          rows={2}
          maxLength={PAYMENT_LIMITS.notesLength}
          defaultValue={payment?.notes ?? ""}
        />
      </FormField>

      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="outline" className="h-10 md:h-8">
            Cancel
          </Button>
        </DialogClose>
        <Button type="submit" className="h-10 md:h-8" disabled={pending}>
          {pending ? (
            <>
              <Loader2 className="animate-spin" data-icon="inline-start" />
              Saving…
            </>
          ) : payment ? (
            "Save changes"
          ) : (
            info.action
          )}
        </Button>
      </DialogFooter>
    </form>
  );
}
