"use client";

import { useEffect, useRef, useState } from "react";
import { CircleMinus, Loader2, Pencil } from "lucide-react";
import { updatePayment, writeOffBalance } from "@/app/(app)/payments/actions";
import { FormError, FormField, FormGrid } from "@/components/layout";
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
import { PAYMENT_LIMITS } from "@/lib/domain/payment-limits";
import { formatCurrency } from "@/lib/format";
import type { Payment } from "@/lib/types";
import { usePaymentAction } from "./use-payment-action";

/** The fields of a write-off the dialog edits (the reason is the entry's note). */
export type EditableWriteOff = Pick<Payment, "id" | "amount" | "paid_on" | "notes">;

/** What was typed, as money — or null until it is a usable figure. */
function typedAmount(raw: string): string | null {
  const n = Number(raw);
  return raw.trim() !== "" && Number.isFinite(n) && n > 0 ? formatCurrency(n) : null;
}

/**
 * Write off a contract's balance — the office gives up what is still owed (the
 * customer is a few rupees short at handover). Office only. It shows the balance
 * due, holds the amount to it, requires a reason, and says plainly what it
 * does: the amount is closed for good and the sale reads as settled. No money
 * moves.
 *
 * Or correct `writeOff` when given. `balance` is the most it can be: the balance
 * due now (including the write-off's own amount when editing).
 */
export function WriteOffDialog({
  workOrderId,
  today,
  balance,
  writeOff,
  editLabel,
}: {
  workOrderId: string;
  /** IST date from the server — the default and latest allowed date. */
  today: string;
  balance: number;
  writeOff?: EditableWriteOff;
  /** Accessible name for the icon-only edit trigger. */
  editLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const editing = Boolean(writeOff);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {editing ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-10 md:size-8"
            aria-label={editLabel ?? "Edit write-off"}
          >
            <Pencil />
          </Button>
        ) : (
          <Button type="button" variant="outline" className="h-10 md:h-8">
            <CircleMinus data-icon="inline-start" /> Write off balance
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit write-off" : "Write off balance"}</DialogTitle>
          <DialogDescription>
            Give up part or all of what is still owed on this contract — for example when the
            customer is a few rupees short at handover. No money changes hands.
          </DialogDescription>
        </DialogHeader>
        <WriteOffForm
          workOrderId={workOrderId}
          today={today}
          balance={balance}
          writeOff={writeOff}
          onSaved={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

function WriteOffForm({
  workOrderId,
  today,
  balance,
  writeOff,
  onSaved,
}: {
  workOrderId: string;
  today: string;
  balance: number;
  writeOff?: EditableWriteOff;
  onSaved: () => void;
}) {
  const { error, pending, onSubmit } = usePaymentAction(
    writeOff ? updatePayment : writeOffBalance,
    onSaved,
  );
  const [amount, setAmount] = useState(String(writeOff?.amount ?? balance));
  const amountRef = useRef<HTMLInputElement>(null);
  const overBalance = amount !== "" && Number(amount) > balance;
  const typed = typedAmount(amount);

  // The server holds the same cap; this puts it in the browser first, in words.
  useEffect(() => {
    amountRef.current?.setCustomValidity(
      overBalance
        ? `The write-off cannot be more than the ${formatCurrency(balance)} balance due.`
        : "",
    );
  }, [overBalance, balance]);

  return (
    <form onSubmit={onSubmit} className="space-y-4" aria-busy={pending}>
      <FormError message={error} />
      {writeOff ? (
        <input type="hidden" name="id" value={writeOff.id} />
      ) : (
        <input type="hidden" name="work_order_id" value={workOrderId} />
      )}

      <p className="flex items-baseline justify-between gap-3 rounded-md bg-muted px-3 py-2 text-sm">
        <span className="text-muted-foreground">Balance due</span>
        <span className="font-semibold tabular-nums">{formatCurrency(balance)}</span>
      </p>

      <FormGrid>
        <FormField
          label="Amount to write off (INR)"
          htmlFor="write_off_amount"
          required
          hint={
            overBalance ? (
              <span className="text-destructive">
                The write-off cannot be more than the {formatCurrency(balance)} balance due.
              </span>
            ) : (
              `Up to ${formatCurrency(balance)}.`
            )
          }
        >
          <Input
            ref={amountRef}
            id="write_off_amount"
            name="amount"
            type="number"
            inputMode="decimal"
            min="0.01"
            max={balance}
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            aria-invalid={overBalance || undefined}
            className="h-10"
            required
          />
        </FormField>
        <FormField label="Written off on" htmlFor="write_off_paid_on" required>
          <Input
            id="write_off_paid_on"
            name="paid_on"
            type="date"
            max={today}
            defaultValue={writeOff?.paid_on ?? today}
            className="h-10"
            required
          />
        </FormField>
      </FormGrid>

      <FormField
        label="Reason"
        htmlFor="write_off_reason"
        required
        hint="Kept with the entry, so anyone reading the ledger can see why."
      >
        <Textarea
          id="write_off_reason"
          name="reason"
          rows={3}
          maxLength={PAYMENT_LIMITS.notesLength}
          placeholder="e.g. Customer was ₹800 short at handover; waived by the office"
          defaultValue={writeOff?.notes ?? ""}
          required
        />
      </FormField>

      <p
        role="note"
        className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-500/10 dark:text-amber-200"
      >
        This closes {typed ?? "this amount"} of the balance for good. It will no longer be collected, and once nothing
        is left the sale shows as settled. Only the SuperAdmin can undo it, by deleting the entry.
      </p>

      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="outline" className="h-10 md:h-8">
            Cancel
          </Button>
        </DialogClose>
        <Button type="submit" variant="destructive" className="h-10 md:h-8" disabled={pending}>
          {pending ? (
            <>
              <Loader2 className="animate-spin" data-icon="inline-start" />
              Saving…
            </>
          ) : writeOff ? (
            "Save write-off"
          ) : (
            `Write off ${typed ?? "balance"}`
          )}
        </Button>
      </DialogFooter>
    </form>
  );
}
