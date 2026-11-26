"use client";

import { useRef, useState, useTransition, type ReactNode, type RefObject } from "react";
import Link from "next/link";
import { unstable_rethrow, useRouter } from "next/navigation";
import { AlertTriangle, ListMinus, ListX, Loader2, RotateCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { deleteWorkOrders } from "@/app/(app)/work-orders/actions";
import { EmptyState, FormError } from "@/components/layout";
import { CoordinatorNames } from "@/components/coordinator-names";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { SERVER_UNREACHABLE_MESSAGE } from "@/lib/constants";
import { CANCELLATION } from "@/lib/domain/cancellation";
import {
  MAX_BULK_DELETE,
  STALE_SELECTION,
  defaultSelection,
  deletionSummary,
  type CleanupSale,
  type DeletionSummary,
  type DifferenceField,
  type DuplicateGroup,
  type DuplicateReason,
} from "@/lib/domain/duplicate-sales";
import { completionLabel, stageLabel } from "@/lib/domain/plan";
import { WORK_ORDER_STATUS } from "@/lib/domain/status";
import { formatCurrencyWhole, formatDate, formatDateTime } from "@/lib/format";

/**
 * The duplicate clean-up (/work-orders/duplicates): every group of sales that
 * look like one sale, the suggested copy to keep marked "Keep" and the copies
 * that are plainly the same sale ticked for deletion (`defaultSelection`). The
 * office reviews each group — values that differ from the kept copy stand out,
 * and every row says whether it stays — changes the ticks, and deletes the
 * ticked copies in one go after a confirmation that says what goes with them.
 *
 * The groups come from the server (`findDuplicateGroups`); after a delete the
 * page is refreshed, and a group still there as it was keeps the person's
 * ticks — only a new or changed group starts from the suggestion. The delete
 * names the copies each group keeps, so a page left open while a kept copy was
 * deleted elsewhere deletes nothing. Rows never navigate on a click: only the
 * client's name is a link, and it opens the copy in a new tab so the ticks here
 * are never lost.
 */

export const REASON_LABELS: Record<DuplicateReason, string> = {
  consumer_number: "Same consumer number",
  customer_and_date: "Same customer & date",
};

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** "a, b and c". */
function listed(parts: readonly string[]): string {
  return parts.length <= 1
    ? parts.join("")
    : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
}

/**
 * Where the sale stands, in one word or two: a cancelled or refunded project
 * says so; else how far its project got; else the work order's status.
 */
export function saleStanding(sale: CleanupSale): string {
  if (sale.cancellation) return CANCELLATION[sale.cancellation].label;
  if (sale.projectId && sale.isCompleted) return completionLabel(sale.planType);
  if (sale.projectId && sale.currentStage) return stageLabel(sale.currentStage, sale.planType);
  return WORK_ORDER_STATUS[sale.status]?.label ?? sale.status;
}

/** "3 groups · 4 extra copies selected". */
export function selectionLine(groups: number, selected: number): string {
  return `${plural(groups, "group")} · ${plural(selected, "extra copy", "extra copies")} selected`;
}

/**
 * The confirmation's totals: "3 sales, with 2 projects and 5 ledger entries; 1
 * service ticket will lose its project link."
 */
export function summaryText(summary: DeletionSummary): string {
  const base = `${plural(summary.sales, "sale")}, with ${plural(summary.projects, "project")} and ${plural(summary.ledgerEntries, "ledger entry", "ledger entries")}`;
  if (summary.tickets === 0) return `${base}.`;
  const tickets = plural(summary.tickets, "service ticket");
  return `${base}; ${tickets} will lose ${summary.tickets === 1 ? "its" : "their"} project link.`;
}

/** What the toast says once the server answers. */
export function deletedMessage(deleted: number, requested: number): string {
  return deleted >= requested
    ? `${plural(deleted, "duplicate sale")} deleted.`
    : `${deleted} of ${requested} deleted; the others were already gone.`;
}

/** The warning when no copy of a sale would be left. */
export function wholeGroupsWarning(names: readonly string[]): string | null {
  if (names.length === 0) return null;
  return `Every copy of ${listed(names)} is selected — nothing of ${names.length === 1 ? "that sale" : "those sales"} will be left.`;
}

/** What the page says when the server refused a delete from an out-of-date page. */
export const STALE_NOTICE =
  "Nothing was deleted: a copy you meant to keep had already been deleted elsewhere. The groups below are now up to date — check the selection again.";

/** The ids in the order the page lists them. */
function inPageOrder(groups: readonly DuplicateGroup[], selected: ReadonlySet<string>): string[] {
  return groups.flatMap((g) => g.sales.map((s) => s.id)).filter((id) => selected.has(id));
}

function sameSet(a: ReadonlySet<string>, b: readonly string[]): boolean {
  return a.size === b.length && b.every((id) => a.has(id));
}

/** One string per set of groups; a group's key joins its ids with ",", so "|" is safe. */
function signatureOf(groups: readonly DuplicateGroup[]): string {
  return groups.map((g) => g.key).join("|");
}

/**
 * The ticks once the groups have changed (after a delete, or Back): a group
 * still on the page with the same copies keeps what the person chose; a new or
 * changed group starts from the suggestion. Otherwise a copy someone unticked
 * on purpose would be ticked again by a delete in another group.
 */
export function carriedSelection(
  groups: readonly DuplicateGroup[],
  before: { signature: string; selected: ReadonlySet<string> },
): Set<string> {
  const unchanged = new Set(before.signature.split("|"));
  return new Set(
    groups.flatMap((g) =>
      unchanged.has(g.key)
        ? g.sales.filter((s) => before.selected.has(s.id)).map((s) => s.id)
        : defaultSelection([g]),
    ),
  );
}

/**
 * The copies a delete means to keep, for the server to check they still exist:
 * for each group with a copy selected, the copies that are not. A group with
 * every copy selected is left out — the page has already warned that nothing
 * of it will be left.
 */
export function keepGroups(
  groups: readonly DuplicateGroup[],
  selected: ReadonlySet<string>,
): string[][] {
  return groups.flatMap((g) => {
    const kept = g.sales.filter((s) => !selected.has(s.id)).map((s) => s.id);
    return kept.length > 0 && kept.length < g.sales.length ? [kept] : [];
  });
}

export function DuplicateCleanup({ groups }: { groups: readonly DuplicateGroup[] }) {
  const router = useRouter();
  // The same groups re-rendered keep what the person chose; when they change
  // (after a delete and refresh), only new or changed groups are re-suggested.
  const signature = signatureOf(groups);
  const [choice, setChoice] = useState(() => ({
    signature,
    selected: new Set(defaultSelection(groups)),
  }));
  let selected: ReadonlySet<string> = choice.selected;
  if (choice.signature !== signature) {
    const carried = carriedSelection(groups, choice);
    selected = carried;
    setChoice({ signature, selected: carried });
  }

  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [notice, setNotice] = useState<string | undefined>();
  const [pending, startTransition] = useTransition();

  if (groups.length === 0) {
    return (
      <div className="space-y-4">
        {/* A refused delete's re-read can leave nothing to show: still say why. */}
        <FormError message={notice} />
        <EmptyState
          title="No duplicate sales found."
          description="No two sales share a KSEB consumer number, or the same customer on the same order date."
          action={
            <Button asChild variant="outline" className="h-10">
              <Link href="/work-orders">Back to Work orders</Link>
            </Button>
          }
        />
      </div>
    );
  }

  const ids = inPageOrder(groups, selected);
  const suggested = defaultSelection(groups);
  const tooMany = ids.length > MAX_BULK_DELETE;

  function toggle(id: string, on: boolean) {
    const next = new Set(selected);
    if (on) next.add(id);
    else next.delete(id);
    setChoice({ signature, selected: next });
  }

  function reset() {
    setChoice({ signature, selected: new Set(suggested) });
  }

  function clear() {
    setChoice({ signature, selected: new Set() });
  }

  /** Only takes ticks away, so it never selects the last copy of a sale. */
  function selectFirstAllowed() {
    setChoice({ signature, selected: new Set(ids.slice(0, MAX_BULK_DELETE)) });
  }

  function openConfirm() {
    setError(undefined);
    setNotice(undefined);
    setConfirming(true);
  }

  function onDelete() {
    setError(undefined);
    const keep = keepGroups(groups, selected);
    startTransition(async () => {
      try {
        const result = await deleteWorkOrders(ids, keep);
        if (!result.ok) {
          if (result.error === STALE_SELECTION) {
            // A copy meant to stay went elsewhere since the page loaded: read
            // the groups again and have the person look before deleting.
            setConfirming(false);
            setNotice(STALE_NOTICE);
            router.refresh();
            return;
          }
          setError(result.error);
          return;
        }
        toast.success(deletedMessage(result.deleted, result.requested));
        setConfirming(false);
        router.refresh();
      } catch (caught) {
        // A failed request would otherwise reach the error page; a redirect
        // (session expired) still goes to the router.
        unstable_rethrow(caught);
        setError(SERVER_UNREACHABLE_MESSAGE);
      }
    });
  }

  const summary = deletionSummary(groups, ids);
  const wholeNames = groups
    .filter((g) => summary.wholeGroups.includes(g.key))
    .map((g) => g.sales[0].clientName);

  return (
    <div className="space-y-4">
      <p className="text-sm font-medium" data-testid="duplicate-summary">
        {selectionLine(groups.length, ids.length)}
      </p>

      {groups.map((group) => (
        <GroupCard key={group.key} group={group} selected={selected} onToggle={toggle} />
      ))}

      {/* Stays in view while the groups scroll past. */}
      <div
        role="region"
        aria-label="Selected copies"
        className="sticky bottom-0 z-20 space-y-2 rounded-lg border bg-background/95 p-3 shadow-sm backdrop-blur"
      >
        <FormError message={notice} />
        {tooMany && (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-destructive">
              At most {MAX_BULK_DELETE} sales can be deleted at once — select fewer.
            </p>
            <Button
              type="button"
              variant="outline"
              className="h-10"
              onClick={selectFirstAllowed}
              disabled={pending}
            >
              <ListMinus data-icon="inline-start" />
              Select the first {MAX_BULK_DELETE}
            </Button>
          </div>
        )}
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            className="h-10"
            onClick={reset}
            disabled={pending || sameSet(selected, suggested)}
          >
            <RotateCcw data-icon="inline-start" />
            Reset selection
          </Button>
          <Button
            type="button"
            variant="outline"
            className="h-10"
            onClick={clear}
            disabled={pending || ids.length === 0}
          >
            <ListX data-icon="inline-start" />
            Clear selection
          </Button>
          <Button
            type="button"
            variant="destructive"
            className="h-10"
            onClick={openConfirm}
            disabled={pending || ids.length === 0 || tooMany}
          >
            <Trash2 data-icon="inline-start" />
            Delete selected ({ids.length})
          </Button>
        </div>
      </div>

      <ConfirmDeleteDialog
        open={confirming}
        onOpenChange={(next) => {
          if (!pending) setConfirming(next);
        }}
        summary={summary}
        warning={wholeGroupsWarning(wholeNames)}
        error={error}
        pending={pending}
        onConfirm={onDelete}
      />
    </div>
  );
}

// --- One group -------------------------------------------------------------------

/** A value as the row shows it, in amber when it differs from the kept copy's. */
function Value({ differs, children }: { differs: boolean; children: ReactNode }) {
  if (!differs) return <>{children}</>;
  return (
    <span className="font-medium text-amber-700 dark:text-amber-400">
      {children}
      <span className="sr-only"> (differs from the kept copy)</span>
    </span>
  );
}

function GroupCard({
  group,
  selected,
  onToggle,
}: {
  group: DuplicateGroup;
  selected: ReadonlySet<string>;
  onToggle: (id: string, on: boolean) => void;
}) {
  const keeper = group.sales[0];
  const titleId = `duplicates-${group.keeperId}`;
  // The plan is shown only when it tells the copies apart (or is the rarer custom).
  const showPlan = group.sales.some(
    (s) => s.planType !== keeper.planType || s.planType === "custom",
  );

  return (
    <Card role="group" aria-labelledby={titleId}>
      <CardHeader className="gap-1.5">
        <CardTitle id={titleId} className="text-base [overflow-wrap:anywhere]">
          {keeper.clientName || "Unnamed customer"}
          <span className="ml-2 text-sm font-normal text-muted-foreground">
            {formatDate(keeper.orderDate)}
          </span>
        </CardTitle>
        <div className="flex flex-wrap items-center gap-1.5">
          {group.reasons.map((reason) => (
            <Badge key={reason} variant="outline" className="font-normal">
              {REASON_LABELS[reason]}
            </Badge>
          ))}
          <span className="text-xs text-muted-foreground">
            {plural(group.sales.length, "copy", "copies")}
          </span>
        </div>
      </CardHeader>
      <CardContent className="px-0">
        {/* Scrolls sideways inside the card on a phone; the page never does. */}
        <Table aria-label={`Copies of ${keeper.clientName}`}>
          <TableHeader>
            <TableRow>
              <TableHead className="w-12 pl-4">
                <span className="sr-only">Delete</span>
              </TableHead>
              <TableHead>Client</TableHead>
              <TableHead>Order date</TableHead>
              <TableHead>Added</TableHead>
              <TableHead>Coordinators</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead className="text-right">Received</TableHead>
              <TableHead className="text-right">Ledger entries</TableHead>
              <TableHead>Stage / status</TableHead>
              <TableHead className="text-right">Tickets</TableHead>
              <TableHead className="pr-4">Consumer no.</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {group.sales.map((sale) => (
              <CopyRow
                key={sale.id}
                sale={sale}
                isKeeper={sale.id === group.keeperId}
                differences={group.differences[sale.id] ?? []}
                showPlan={showPlan}
                checked={selected.has(sale.id)}
                onToggle={onToggle}
              />
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function CopyRow({
  sale,
  isKeeper,
  differences,
  showPlan,
  checked,
  onToggle,
}: {
  sale: CleanupSale;
  isKeeper: boolean;
  differences: readonly DifferenceField[];
  showPlan: boolean;
  checked: boolean;
  onToggle: (id: string, on: boolean) => void;
}) {
  const differs = (field: DifferenceField) => differences.includes(field);
  const name = sale.clientName || "Unnamed customer";

  return (
    <TableRow data-state={checked ? "selected" : undefined}>
      <TableCell className="pl-4">
        {/* The pseudo-element widens the box's hit area to 40px. */}
        <Checkbox
          checked={checked}
          onCheckedChange={(value) => onToggle(sale.id, value === true)}
          aria-label={`Delete ${name} — added ${formatDateTime(sale.createdAt)}`}
          className="after:-inset-3"
        />
      </TableCell>
      {/* A floor on the width: with `anywhere` wrapping, the table squeezed names
          down to a letter or two per line ("ANAN / D / KUMA / R"). */}
      <TableCell className="min-w-40 max-w-56 whitespace-normal">
        <span className="flex flex-wrap items-center gap-x-2">
          {/* A new tab: going to the copy and Back would lose the ticks here. */}
          <Link
            href={`/work-orders/${sale.id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-10 items-center font-medium break-words hover:underline"
          >
            <Value differs={differs("clientName")}>{name}</Value>
            <span className="sr-only"> (opens in a new tab)</span>
          </Link>
          <KeepBadge isKeeper={isKeeper} checked={checked} />
        </span>
      </TableCell>
      <TableCell>
        <Value differs={differs("orderDate")}>{formatDate(sale.orderDate)}</Value>
      </TableCell>
      <TableCell className="text-muted-foreground">{formatDateTime(sale.createdAt)}</TableCell>
      <TableCell className="max-w-48 whitespace-normal">
        <Value differs={differs("coordinators")}>
          <CoordinatorNames names={sale.coordinatorNames} />
        </Value>
      </TableCell>
      <TableCell className="text-right tabular-nums">
        <Value differs={differs("totalCost")}>{formatCurrencyWhole(sale.totalCost)}</Value>
      </TableCell>
      <TableCell className="text-right tabular-nums">
        <Value differs={differs("amountReceived")}>
          {formatCurrencyWhole(sale.amountReceived)}
        </Value>
      </TableCell>
      <TableCell className="text-right tabular-nums">{sale.paymentCount}</TableCell>
      <TableCell>
        <Value differs={differs("status")}>{saleStanding(sale)}</Value>
        {showPlan && (
          <span className="block text-xs">
            <Value differs={differs("plan")}>
              {sale.planType === "custom" ? "Custom plan" : "Solar plan"}
            </Value>
          </span>
        )}
      </TableCell>
      <TableCell className="text-right tabular-nums">{sale.ticketCount}</TableCell>
      <TableCell className="pr-4">
        <Value differs={differs("consumerNumber")}>{sale.consumerNumber ?? "—"}</Value>
      </TableCell>
    </TableRow>
  );
}

/**
 * Whether the copy stays, by its tick: the suggested copy says "Keep" until it
 * is ticked, and then that it will be deleted after all; any other copy left
 * unticked says "Kept". A ticked copy needs no badge — its row is shaded.
 */
function KeepBadge({ isKeeper, checked }: { isKeeper: boolean; checked: boolean }) {
  if (isKeeper && checked) {
    return (
      <Badge
        variant="outline"
        className="border-amber-300 text-amber-800 dark:border-amber-500/40 dark:text-amber-300"
      >
        Suggested keep — will be deleted
      </Badge>
    );
  }
  if (isKeeper) {
    return (
      <Badge className="border-transparent bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300">
        Keep
      </Badge>
    );
  }
  if (!checked) {
    return (
      <Badge variant="outline" className="font-normal text-muted-foreground">
        Kept
      </Badge>
    );
  }
  return null;
}

// --- The confirmation --------------------------------------------------------------

/**
 * Says what the delete takes with it, warns when a sale would be gone entirely,
 * and asks for a tick before the destructive button works. Escape, the overlay
 * and Cancel close it (not while deleting); focus starts on Cancel.
 */
function ConfirmDeleteDialog({
  open,
  onOpenChange,
  summary,
  warning,
  error,
  pending,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  summary: DeletionSummary;
  warning: string | null;
  error?: string;
  pending: boolean;
  onConfirm: () => void;
}) {
  const safeRef = useRef<HTMLButtonElement>(null);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="max-h-[90dvh] overflow-y-auto sm:max-w-lg"
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          safeRef.current?.focus();
        }}
      >
        {/* Mounted with the content, so the tick box starts clear every time it opens. */}
        <ConfirmBody
          summary={summary}
          warning={warning}
          error={error}
          pending={pending}
          safeRef={safeRef}
          onCancel={() => onOpenChange(false)}
          onConfirm={onConfirm}
        />
      </DialogContent>
    </Dialog>
  );
}

function ConfirmBody({
  summary,
  warning,
  error,
  pending,
  safeRef,
  onCancel,
  onConfirm,
}: {
  summary: DeletionSummary;
  warning: string | null;
  error?: string;
  pending: boolean;
  safeRef: RefObject<HTMLButtonElement | null>;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const [understood, setUnderstood] = useState(false);
  const n = summary.sales;
  const sales = plural(n, "sale");

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-start gap-2 leading-snug">
          <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0 text-destructive" />
          Delete {sales}?
        </DialogTitle>
        <DialogDescription>{summaryText(summary)}</DialogDescription>
      </DialogHeader>

      <p className="text-sm">
        Each sale goes for good with its project, milestones, ledger entries and every
        coordinator&apos;s incentive. This cannot be undone.
      </p>

      {warning && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive [overflow-wrap:anywhere]">
          {warning}
        </p>
      )}

      <FormError message={error} />

      <div className="flex min-h-10 items-start gap-3 rounded-lg border border-destructive/30 p-3">
        <Checkbox
          id="duplicates_delete_understood"
          checked={understood}
          onCheckedChange={(value) => setUnderstood(value === true)}
          className="mt-0.5 after:-inset-3"
        />
        <Label htmlFor="duplicates_delete_understood" className="leading-snug">
          {n === 1
            ? "I understand this sale is deleted permanently"
            : "I understand these sales are deleted permanently"}
        </Label>
      </div>

      <DialogFooter>
        <Button
          ref={safeRef}
          type="button"
          variant="outline"
          className="h-10"
          onClick={onCancel}
          disabled={pending}
        >
          Cancel
        </Button>
        <Button
          type="button"
          variant="destructive"
          className="h-10"
          onClick={onConfirm}
          disabled={!understood || pending}
        >
          {pending ? (
            <>
              <Loader2 className="animate-spin" data-icon="inline-start" />
              Deleting…
            </>
          ) : (
            `Delete ${sales}`
          )}
        </Button>
      </DialogFooter>
    </>
  );
}
