"use client";

import { useRef, useState, type RefObject } from "react";
import { AlertTriangle } from "lucide-react";
import {
  DUPLICATE_ACKNOWLEDGEMENT,
  DUPLICATE_CHECK_NOTE,
  NOTHING_IMPORTED_YET,
  NOTHING_NEW_TO_IMPORT,
  duplicateNames,
  duplicateSummary,
  duplicateTitle,
  importAllLabel,
  skipLabel,
  type DuplicateChoice,
  type DuplicateNotice,
} from "@/lib/domain/import-duplicates";
import { Button } from "@/components/ui/button";
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
import { cn } from "@/lib/utils";

/** Buttons whose labels carry counts wrap on a phone instead of overflowing. */
const WRAPPING_BUTTON = "h-auto min-h-10 whitespace-normal py-2 text-center md:min-h-8";

/**
 * The warning that rows of the sheet are already in the system (same customer,
 * same order date). Opened by the import form when a result carries a notice:
 *
 *   - after Check file (`check`): what was found, and that Import will ask — OK;
 *   - after Import projects stopped without writing (`confirm`): skip those rows
 *     and import the rest, or — only after ticking that duplicates will be
 *     created — import every row anyway, or cancel.
 *
 * The choice is the server's to enforce; this only asks. Escape, the overlay
 * and Cancel all close it without choosing, and focus starts on the safe button.
 */
export function DuplicateDialog({
  notice,
  open,
  onClose,
  onChoose,
}: {
  notice: DuplicateNotice | null;
  open: boolean;
  onClose: () => void;
  onChoose: (choice: DuplicateChoice) => void;
}) {
  const safeRef = useRef<HTMLButtonElement>(null);
  return (
    <Dialog
      open={open && notice !== null}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      {notice && (
        <DialogContent
          showCloseButton={false}
          className="max-h-[90dvh] overflow-y-auto sm:max-w-lg"
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            safeRef.current?.focus();
          }}
        >
          {/* Mounted with the content, so the tick box starts clear every time it opens. */}
          <DuplicateWarning
            notice={notice}
            safeRef={safeRef}
            onClose={onClose}
            onChoose={onChoose}
          />
        </DialogContent>
      )}
    </Dialog>
  );
}

function DuplicateWarning({
  notice,
  safeRef,
  onClose,
  onChoose,
}: {
  notice: DuplicateNotice;
  safeRef: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
  onChoose: (choice: DuplicateChoice) => void;
}) {
  const [understood, setUnderstood] = useState(false);
  const confirming = notice.kind === "confirm";
  const skip = confirming ? skipLabel(notice) : null;

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-start gap-2 leading-snug">
          <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
          {duplicateTitle(notice)}
        </DialogTitle>
        <DialogDescription>{duplicateSummary(notice)}</DialogDescription>
      </DialogHeader>

      <div className="space-y-1 rounded-md bg-muted px-3 py-2">
        <p className="text-xs text-muted-foreground">
          {notice.count === 1 ? "The row's customer" : "These rows' customers"}
        </p>
        <p className="text-sm font-medium [overflow-wrap:anywhere]">{duplicateNames(notice)}</p>
      </div>

      <p className="text-sm">
        {!confirming ? DUPLICATE_CHECK_NOTE : skip ? NOTHING_IMPORTED_YET : NOTHING_NEW_TO_IMPORT}
      </p>

      {confirming && (
        <div className="space-y-3 rounded-lg border border-destructive/30 p-3">
          <div className="flex min-h-10 items-start gap-3">
            <Checkbox
              id="duplicates_understood"
              checked={understood}
              onCheckedChange={(value) => setUnderstood(value === true)}
              className="mt-0.5"
            />
            <Label htmlFor="duplicates_understood" className="leading-snug">
              {DUPLICATE_ACKNOWLEDGEMENT}
            </Label>
          </div>
          <Button
            type="button"
            variant="destructive"
            disabled={!understood}
            onClick={() => onChoose("include")}
            className={cn("w-full sm:w-auto", WRAPPING_BUTTON)}
          >
            {importAllLabel(notice)}
          </Button>
        </div>
      )}

      <DialogFooter>
        {confirming ? (
          <>
            <Button
              ref={skip ? undefined : safeRef}
              type="button"
              variant="outline"
              onClick={onClose}
              className="h-10 md:h-8"
            >
              {skip ? "Cancel" : "Close"}
            </Button>
            {skip && (
              <Button
                ref={safeRef}
                type="button"
                onClick={() => onChoose("skip")}
                className={WRAPPING_BUTTON}
              >
                {skip}
              </Button>
            )}
          </>
        ) : (
          <Button ref={safeRef} type="button" onClick={onClose} className="h-10 md:h-8">
            OK
          </Button>
        )}
      </DialogFooter>
    </>
  );
}
