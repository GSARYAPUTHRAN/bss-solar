"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import {
  reinstateProject,
  setProjectCancellation,
} from "@/app/(app)/projects/actions";
import { FormError, FormField } from "@/components/layout";
import { Button, buttonVariants } from "@/components/ui/button";
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
  CANCELLATION,
  CANCELLATIONS,
  CANCELLATION_REMARKS_MAX,
} from "@/lib/domain/cancellation";
import { cancellationImpact } from "@/lib/domain/project-settings";
import { formatCurrency, formatDate } from "@/lib/format";
import type { ProjectCancellation } from "@/lib/types";
import { cn } from "@/lib/utils";
import type { VariantProps } from "class-variance-authority";
import { useProjectAction } from "./use-project-action";

type TriggerVariant = VariantProps<typeof buttonVariants>["variant"];

/** The submit button every form here ends with. */
function SaveButton({ pending, label, loading }: { pending: boolean; label: string; loading: string }) {
  return (
    <Button type="submit" className="h-10 md:h-8" disabled={pending}>
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

function CancelButton() {
  return (
    <DialogClose asChild>
      <Button type="button" variant="outline" className="h-10 md:h-8">
        Cancel
      </Button>
    </DialogClose>
  );
}

const REMARKS_PLACEHOLDER = "Why — and for a refund: how much was returned, when and how";

/**
 * Mark a live project cancelled or refunded (`mode="cancel"`), or correct an
 * existing record (`mode="edit"`). Office only — the page decides whether to
 * render it, the action and RLS decide again.
 *
 * The date is the day the feasibility clock stops. Left blank on a NEW
 * cancellation it is today; left blank when editing it keeps what was recorded,
 * even "not recorded" (an import that never knew), so correcting the remarks
 * never invents a date.
 */
export function CancellationDialog({
  projectId,
  mode,
  kind = "cancelled",
  triggerLabel,
  triggerVariant = "outline",
  today,
  orderDate,
  cancelledOn,
  remarks,
  money,
  clock,
  unpaid,
}: {
  projectId: string;
  mode: "cancel" | "edit";
  /** Pre-selected outcome (the recorded one when editing). */
  kind?: ProjectCancellation;
  triggerLabel: string;
  triggerVariant?: TriggerVariant;
  /** IST date from the server — the default and latest allowed date. */
  today: string;
  orderDate: string;
  /** The recorded date when editing; null = not recorded. */
  cancelledOn: string | null;
  remarks: string | null;
  /** What the ledger says: collected so far (advance + instalments) and what is left. */
  money: { received: number; balanceDue: number };
  /** The feasibility clock the cancellation would stop (null date = none runs). */
  clock: { feasibilityDate: string | null; completedAt: string | null; isCompleted: boolean };
  /** Incentives set and not paid: a cancellation does not touch them. */
  unpaid: { count: number; total: number };
}) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant={triggerVariant} className="h-10 md:h-8">
          {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {mode === "cancel" ? "Cancel or refund this project" : "Edit cancellation"}
          </DialogTitle>
          <DialogDescription>
            {mode === "cancel"
              ? "Takes it out of the active pipeline. Payments, milestones and incentives are left exactly as they are, and you can reinstate it later."
              : "Correct what was recorded. Reinstating is a separate step."}
          </DialogDescription>
        </DialogHeader>
        <CancellationForm
          projectId={projectId}
          mode={mode}
          kind={kind}
          today={today}
          orderDate={orderDate}
          cancelledOn={cancelledOn}
          remarks={remarks}
          money={money}
          clock={clock}
          unpaid={unpaid}
          onSaved={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

function CancellationForm({
  projectId,
  mode,
  kind: initialKind,
  today,
  orderDate,
  cancelledOn,
  remarks,
  money,
  clock,
  unpaid,
  onSaved,
}: {
  projectId: string;
  mode: "cancel" | "edit";
  kind: ProjectCancellation;
  today: string;
  orderDate: string;
  cancelledOn: string | null;
  remarks: string | null;
  money: { received: number; balanceDue: number };
  clock: { feasibilityDate: string | null; completedAt: string | null; isCompleted: boolean };
  unpaid: { count: number; total: number };
  onSaved: () => void;
}) {
  const { error, pending, onSubmit } = useProjectAction(setProjectCancellation, onSaved);
  const [kind, setKind] = useState(initialKind);
  // Controlled so the impact list can follow the day the clock would stop on.
  const [date, setDate] = useState(mode === "cancel" ? today : (cancelledOn ?? ""));

  const impact = cancellationImpact({
    ...money,
    ...clock,
    cancelledOn: date,
    today,
    unpaid,
  });
  const hasClock = clock.feasibilityDate !== null && !clock.isCompleted;

  return (
    <form onSubmit={onSubmit} className="space-y-4" aria-busy={pending}>
      <FormError message={error} />
      <input type="hidden" name="project_id" value={projectId} />

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Outcome</legend>
        <div className="grid grid-cols-2 gap-2">
          {CANCELLATIONS.map((value) => (
            <label
              key={value}
              className={cn(
                "flex h-10 cursor-pointer items-center gap-2 rounded-md border px-3 text-sm transition-colors",
                kind === value ? "border-primary bg-primary/5" : "hover:bg-accent/50",
              )}
            >
              <input
                type="radio"
                name="cancellation"
                value={value}
                checked={kind === value}
                onChange={() => setKind(value)}
                className="size-4 accent-primary"
                required
              />
              {CANCELLATION[value].label}
            </label>
          ))}
        </div>
      </fieldset>

      <FormField
        label="Cancelled on"
        htmlFor="cancelled_on"
        hint={
          mode === "edit" && cancelledOn === null
            ? "Not recorded — leave blank to keep it that way."
            : hasClock
              ? "The day the feasibility clock stops."
              : mode === "edit"
                ? "Leave blank to keep the recorded date."
                : "Defaults to today."
        }
      >
        <Input
          id="cancelled_on"
          name="cancelled_on"
          type="date"
          min={orderDate}
          max={today}
          value={date}
          onChange={(event) => setDate(event.target.value)}
          className="h-10"
        />
      </FormField>

      <FormField label="Remarks" htmlFor="cancellation_remarks">
        <Textarea
          id="cancellation_remarks"
          name="cancellation_remarks"
          rows={4}
          maxLength={CANCELLATION_REMARKS_MAX}
          defaultValue={remarks ?? ""}
          placeholder={REMARKS_PLACEHOLDER}
        />
      </FormField>

      {mode === "cancel" && (
        <div className="rounded-md border bg-muted/40 p-3 text-sm">
          <p className="font-medium">What this changes</p>
          <ul className="mt-1.5 list-disc space-y-1 pl-5 text-muted-foreground">
            {impact.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      )}

      <DialogFooter>
        <CancelButton />
        <SaveButton
          pending={pending}
          label={mode === "cancel" ? `Mark ${kind}` : "Save changes"}
          loading="Saving…"
        />
      </DialogFooter>
    </form>
  );
}

/**
 * Bring a cancelled or refunded project back into the pipeline at its current
 * stage. The remarks stay, editable, as the history note.
 *
 * A project's feasibility clock stopped on the day it was cancelled; reopening
 * it on the OLD date would count the whole cancelled stretch as renewals BSS
 * pays. `clockImpact` (worked out on the page) says what that costs, and the
 * optional new feasibility date lets the office restart the count instead — in
 * the same step, so the clock never runs on the old date in between.
 */
export function ReinstateDialog({
  projectId,
  today,
  orderDate,
  remarks,
  canSetFeasibility,
  clockImpact,
}: {
  projectId: string;
  today: string;
  orderDate: string;
  remarks: string | null;
  /** Solar plants only: a custom plan has no feasibility date. */
  canSetFeasibility: boolean;
  clockImpact: { feasibilityDate: string; costNow: number; costReopened: number } | null;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" className="h-10 md:h-8">
          Reinstate
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Reinstate this project</DialogTitle>
          <DialogDescription>
            The project returns to the active pipeline at its current stage.
          </DialogDescription>
        </DialogHeader>
        <ReinstateForm
          projectId={projectId}
          today={today}
          orderDate={orderDate}
          remarks={remarks}
          canSetFeasibility={canSetFeasibility}
          clockImpact={clockImpact}
          onSaved={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

function ReinstateForm({
  projectId,
  today,
  orderDate,
  remarks,
  canSetFeasibility,
  clockImpact,
  onSaved,
}: {
  projectId: string;
  today: string;
  orderDate: string;
  remarks: string | null;
  canSetFeasibility: boolean;
  clockImpact: { feasibilityDate: string; costNow: number; costReopened: number } | null;
  onSaved: () => void;
}) {
  const { error, pending, onSubmit } = useProjectAction(reinstateProject, onSaved);
  const [newDate, setNewDate] = useState("");

  return (
    <form onSubmit={onSubmit} className="space-y-4" aria-busy={pending}>
      <FormError message={error} />
      <input type="hidden" name="project_id" value={projectId} />

      <FormField
        label="Remarks"
        htmlFor="reinstate_remarks"
        hint="Kept on the project as notes from the earlier cancellation."
      >
        <Textarea
          id="reinstate_remarks"
          name="cancellation_remarks"
          rows={3}
          maxLength={CANCELLATION_REMARKS_MAX}
          defaultValue={remarks ?? ""}
        />
      </FormField>

      {canSetFeasibility && (
        <>
          {clockImpact && newDate === "" && (
            <p
              role="note"
              className="rounded-md bg-amber-100 px-3 py-2 text-sm text-amber-900 dark:bg-amber-500/15 dark:text-amber-200"
            >
              Reopening the clock on the old feasibility date (
              {formatDate(clockImpact.feasibilityDate)}) counts the cancelled months as
              renewals: renewal cost {formatCurrency(clockImpact.costNow)} →{" "}
              {formatCurrency(clockImpact.costReopened)}.
            </p>
          )}
          <FormField
            label="New feasibility date"
            htmlFor="reinstate_feasibility_date"
            hint="Set this if KSEB issued a fresh feasibility — the clock and its renewal cost then count from the new date, exactly as when the date is changed under KSEB & feasibility."
          >
            <Input
              id="reinstate_feasibility_date"
              name="feasibility_date"
              type="date"
              min={orderDate}
              max={today}
              value={newDate}
              onChange={(event) => setNewDate(event.target.value)}
              className="h-10"
            />
          </FormField>
        </>
      )}

      <DialogFooter>
        <CancelButton />
        <SaveButton pending={pending} label="Reinstate project" loading="Reinstating…" />
      </DialogFooter>
    </form>
  );
}
