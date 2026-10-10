"use client";

import { startTransition, useActionState, useState, type FormEvent } from "react";
import { unstable_rethrow } from "next/navigation";
import { Loader2, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import {
  recordPayment,
  updatePayment,
  type PaymentFormState,
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
import { Textarea } from "@/components/ui/textarea";
import {
  PAYMENT_METHOD_LABELS,
  PAYMENT_PURPOSE_LABELS,
} from "@/lib/domain/payment";
import { PAYMENT_LIMITS } from "@/lib/domain/payment-limits";
import { fail } from "@/lib/result";
import type { Payment } from "@/lib/types";
import { SERVER_UNREACHABLE_MESSAGE } from "@/lib/constants";

/** The fields of an entry the dialog edits. */
export type EditablePayment = Pick<
  Payment,
  "id" | "amount" | "paid_on" | "method" | "purpose" | "reference" | "notes"
>;

const METHOD_OPTIONS = Object.entries(PAYMENT_METHOD_LABELS).map(([value, label]) => ({
  value,
  label,
}));
const PURPOSE_OPTIONS = Object.entries(PAYMENT_PURPOSE_LABELS).map(([value, label]) => ({
  value,
  label,
}));

/**
 * Record a new ledger entry, or edit `payment` when given. The form only mounts
 * while the dialog is open, so every opening starts from a clean action state.
 */
export function PaymentFormDialog({
  workOrderId,
  today,
  payment,
  editLabel,
}: {
  workOrderId: string;
  /** IST date from the server — the default and latest allowed date. */
  today: string;
  payment?: EditablePayment;
  /** Accessible name for the icon-only edit trigger, e.g. "Edit stage 2". */
  editLabel?: string;
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
              : "Add money received after the booking advance. Each entry becomes the next stage."}
          </DialogDescription>
        </DialogHeader>
        <PaymentForm
          workOrderId={workOrderId}
          today={today}
          payment={payment}
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
  onSaved,
}: {
  workOrderId: string;
  today: string;
  payment?: EditablePayment;
  onSaved: () => void;
}) {
  const [state, dispatch, pending] = useActionState(
    async (prev: PaymentFormState, formData: FormData): Promise<PaymentFormState> => {
      let result: PaymentFormState;
      try {
        result = await (payment ? updatePayment : recordPayment)(prev, formData);
      } catch (error) {
        // A redirect (session expired) still goes to the router. A request that
        // never completed is shown in the form instead of the error page, so
        // the dialog stays open with what was typed.
        unstable_rethrow(error);
        return fail(SERVER_UNREACHABLE_MESSAGE);
      }
      if (result?.ok) {
        toast.success(result.data.message);
        onSaved();
      }
      return result;
    },
    null,
  );
  const error = state && !state.ok ? state.error : undefined;

  // Dispatched from onSubmit rather than the `action` prop: React resets a form
  // after every action-prop submission, which would wipe what the user typed
  // when the server refuses it (e.g. an amount above the balance).
  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(() => dispatch(formData));
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" aria-busy={pending}>
      <FormError message={error} />
      {payment ? (
        <input type="hidden" name="id" value={payment.id} />
      ) : (
        <input type="hidden" name="work_order_id" value={workOrderId} />
      )}

      <FormGrid>
        <FormField label="Amount (INR)" htmlFor="payment_amount" required>
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
        <FormField label="Received on" htmlFor="payment_paid_on" required>
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
        <FormField
          label="Purpose"
          htmlFor="payment_purpose"
          hint="KSEB fees are tracked separately and never reduce the contract balance."
        >
          <FormSelect
            id="payment_purpose"
            name="purpose"
            options={PURPOSE_OPTIONS}
            defaultValue={payment?.purpose ?? "contract"}
            className="w-full data-[size=default]:h-10"
          />
        </FormField>
      </FormGrid>

      <FormField label="Reference" htmlFor="payment_reference" hint="UTR, cheque or UPI reference.">
        <Input
          id="payment_reference"
          name="reference"
          maxLength={PAYMENT_LIMITS.referenceLength}
          defaultValue={payment?.reference ?? ""}
          className="h-10"
        />
      </FormField>

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
            "Record payment"
          )}
        </Button>
      </DialogFooter>
    </form>
  );
}
