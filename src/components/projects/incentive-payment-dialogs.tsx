"use client";

import { useState } from "react";
import { Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import {
  deleteIncentivePayment,
  recordIncentivePayment,
  updateIncentivePayment,
} from "@/app/(app)/projects/actions";
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
import { incentivePending } from "@/lib/domain/incentives";
import { INCENTIVE_NOTE_MAX } from "@/lib/domain/project-settings";
import { round2 } from "@/lib/domain/rounding";
import { formatCurrency, formatDate } from "@/lib/format";
import type { CoordinatorIncentive } from "@/lib/types";
import type { IncentiveInstalment } from "@/server/data/projects.repository";
import { useProjectAction } from "./use-project-action";

/** The person an instalment is paid to. */
interface Payee {
  id: string;
  full_name: string;
}

/**
 * The incentive an instalment is against, as the page loaded it: the agreed
 * amount (null while unset) and Σ instalments recorded, the one being edited
 * included.
 */
type Incentive = Pick<CoordinatorIncentive, "amount" | "paid">;

function CancelButton() {
  return (
    <DialogClose asChild>
      <Button type="button" variant="outline" className="h-10 md:h-8">
        Cancel
      </Button>
    </DialogClose>
  );
}

function SubmitButton({
  pending,
  label,
  loading,
  destructive,
}: {
  pending: boolean;
  label: string;
  loading: string;
  destructive?: boolean;
}) {
  return (
    <Button
      type="submit"
      variant={destructive ? "destructive" : "default"}
      className="h-10 md:h-8"
      disabled={pending}
    >
      {pending ? (
        <>
          <Loader2 className="animate-spin" data-icon="inline-start" />
          {loading}
        </>
      ) : (
        label
      )}
    </Button>
  );
}

/**
 * Record an instalment paid to `payee` against their incentive, or correct
 * `payment` when given. Office only — the page decides whether to render it, the
 * action and RLS decide again. The form only mounts while the dialog is open, so
 * every opening starts clean.
 *
 * The amount is held to what is still to pay (with the instalment being edited
 * taken out of what counts as paid) and the date to today — the same rules
 * `planIncentiveInstalment` and the database apply.
 */
export function InstalmentDialog({
  projectId,
  payee,
  incentive,
  today,
  payment,
}: {
  projectId: string;
  payee: Payee;
  incentive: Incentive;
  /** IST date from the server — the default and latest allowed date. */
  today: string;
  /** The instalment to correct; omit to record a new one. */
  payment?: IncentiveInstalment;
}) {
  const [open, setOpen] = useState(false);
  const editing = Boolean(payment);
  const room = incentivePending({
    amount: incentive.amount,
    paid: round2(incentive.paid - (payment?.amount ?? 0)),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {payment ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-10 md:size-8"
            aria-label={`Edit the ${formatCurrency(payment.amount)} payment of ${formatDate(payment.paid_on)} to ${payee.full_name}`}
          >
            <Pencil />
          </Button>
        ) : (
          <Button
            type="button"
            className="h-10 w-full sm:w-auto md:h-8"
            disabled={room <= 0}
            aria-label={`Record payment for ${payee.full_name}`}
          >
            <Plus data-icon="inline-start" /> Record payment
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit payment" : "Record payment"}</DialogTitle>
          <DialogDescription>
            {payee.full_name} · {formatCurrency(incentive.paid)} paid of{" "}
            {formatCurrency(incentive.amount)} agreed.
          </DialogDescription>
        </DialogHeader>
        <InstalmentForm
          projectId={projectId}
          payee={payee}
          today={today}
          room={room}
          payment={payment}
          onSaved={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

function InstalmentForm({
  projectId,
  payee,
  today,
  room,
  payment,
  onSaved,
}: {
  projectId: string;
  payee: Payee;
  today: string;
  room: number;
  payment?: IncentiveInstalment;
  onSaved: () => void;
}) {
  const { error, pending, onSubmit } = useProjectAction(
    payment ? updateIncentivePayment : recordIncentivePayment,
    onSaved,
  );
  const id = (field: string) => `instalment-${payment?.id ?? payee.id}-${field}`;

  return (
    <form onSubmit={onSubmit} className="space-y-4" aria-busy={pending}>
      <FormError message={error} />
      <input type="hidden" name="project_id" value={projectId} />
      {payment ? (
        <input type="hidden" name="payment_id" value={payment.id} />
      ) : (
        <input type="hidden" name="coordinator_id" value={payee.id} />
      )}

      <FormGrid className="gap-4">
        <FormField
          label="Amount (₹)"
          htmlFor={id("amount")}
          required
          hint={
            payment
              ? `Up to ${formatCurrency(room)} — this payment and what is still to pay.`
              : `Up to ${formatCurrency(room)} — what is still to pay.`
          }
        >
          <Input
            id={id("amount")}
            name="amount"
            type="number"
            inputMode="decimal"
            min="0.01"
            max={room}
            step="0.01"
            defaultValue={payment ? String(payment.amount) : ""}
            className="h-10"
            required
          />
        </FormField>
        <FormField label="Paid on" htmlFor={id("paid_on")} required>
          <Input
            id={id("paid_on")}
            name="paid_on"
            type="date"
            max={today}
            defaultValue={payment?.paid_on ?? today}
            className="h-10"
            required
          />
        </FormField>
      </FormGrid>

      <FormField label="Note" htmlFor={id("note")} hint="Cheque or UPI reference, or what it covers.">
        <Input
          id={id("note")}
          name="note"
          maxLength={INCENTIVE_NOTE_MAX}
          defaultValue={payment?.note ?? ""}
          className="h-10"
        />
      </FormField>

      <DialogFooter>
        <CancelButton />
        <SubmitButton
          pending={pending}
          label={payment ? "Save changes" : "Record payment"}
          loading="Saving…"
        />
      </DialogFooter>
    </form>
  );
}

/**
 * Take a mistaken instalment off an incentive (office only). Says what happens
 * first: that much is owed again; the agreed amount is untouched.
 */
export function RemoveInstalmentDialog({
  projectId,
  payee,
  payment,
}: {
  projectId: string;
  payee: Payee;
  payment: IncentiveInstalment;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-10 text-destructive hover:text-destructive md:size-8"
          aria-label={`Remove the ${formatCurrency(payment.amount)} payment of ${formatDate(payment.paid_on)} to ${payee.full_name}`}
        >
          <Trash2 />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Remove this payment?</DialogTitle>
          <DialogDescription>
            {formatCurrency(payment.amount)} paid on {formatDate(payment.paid_on)} comes off{" "}
            {payee.full_name}&rsquo;s incentive, and is owed to them again. The agreed amount
            stays as it is.
          </DialogDescription>
        </DialogHeader>
        <RemoveForm
          projectId={projectId}
          paymentId={payment.id}
          onSaved={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

function RemoveForm({
  projectId,
  paymentId,
  onSaved,
}: {
  projectId: string;
  paymentId: string;
  onSaved: () => void;
}) {
  const { error, pending, onSubmit } = useProjectAction(deleteIncentivePayment, onSaved);
  return (
    <form onSubmit={onSubmit} className="space-y-4" aria-busy={pending}>
      <FormError message={error} />
      <input type="hidden" name="project_id" value={projectId} />
      <input type="hidden" name="payment_id" value={paymentId} />
      <DialogFooter>
        <CancelButton />
        <SubmitButton destructive pending={pending} label="Remove payment" loading="Removing…" />
      </DialogFooter>
    </form>
  );
}
