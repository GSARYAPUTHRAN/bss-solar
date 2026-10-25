"use client";

import {
  startTransition,
  useActionState,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";
import { Download, FileWarning, Loader2, Upload } from "lucide-react";
import { importProjects } from "@/app/(app)/onboarding/actions";
import { decodeCsvBytes } from "@/lib/csv";
import { IMPORT_TEMPLATE } from "@/lib/domain/import-template";
import {
  IMPORT_COUNT_STATUSES,
  IMPORT_INITIAL,
  type ImportMode,
  type ImportRowResult,
  type ImportRowStatus,
  type ImportState,
} from "@/lib/domain/import-results";
import { TONES, type StatusRegistry } from "@/lib/domain/status";
import { StatusBadge } from "@/components/common/status-badge";
import { FormError, FormField } from "@/components/layout";
import { FormSelect } from "@/components/form-select";
import { CoordinatorMatches } from "@/components/onboarding/coordinator-matches";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

/**
 * next.config raises the server-action body limit to 4 MB for this import
 * (`experimental.serverActions.bodySizeLimit`). Refusing a larger paste here,
 * with headroom for the other form fields, gives a clear message instead of a
 * failed request. Keep the two in step.
 */
const MAX_UPLOAD_BYTES = 3_800_000;

/** Said when a loaded file was not UTF-8 (see `decodeCsvBytes`). */
const NOT_UTF8_NOTICE =
  "This file was not UTF-8, so it was read as Windows-1252 — check names and notes with accents or dashes.";

/**
 * The CSV box keeps one size however much is pasted: the shared Textarea grows
 * with its text (`field-sizing-content`), which would push Check file, Import
 * and the results thousands of pixels down for a real sheet. The box scrolls,
 * and can still be dragged taller.
 */
const CSV_BOX_CLASS = "field-sizing-fixed h-60 resize-y overflow-y-auto font-mono text-xs";

/** What the default-coordinator select says (and posts) until someone is chosen. */
const NO_DEFAULT = "none";
const NO_DEFAULT_OPTION = {
  value: NO_DEFAULT,
  label: "No default — rows with a blank coordinator fail",
};

const IMPORT_ROW_STATUS: StatusRegistry<ImportRowStatus> = {
  ready: { label: "Ready", badgeClass: TONES.blue },
  imported: { label: "Imported", badgeClass: TONES.emerald },
  skipped: { label: "Skipped", badgeClass: TONES.amber },
  failed: { label: "Failed", badgeClass: TONES.red },
};

/** Save text as a CSV file. The BOM makes Excel read it as UTF-8. */
function downloadCsv(filename: string, text: string) {
  const blob = new Blob([`﻿${text}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** The button that sent the form: its own value, never a guess. */
function isMode(value: unknown): value is ImportMode {
  return value === "check" || value === "import";
}

export function BulkImportForm({
  coordinators,
}: {
  /** Accounts that may own a work order (never service engineers). */
  coordinators: { value: string; label: string }[];
}) {
  const [state, formAction, pending] = useActionState(importProjects, IMPORT_INITIAL);
  const [csv, setCsv] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  // The loaded file had to be read as Windows-1252: its names and notes may be off.
  const [notUtf8, setNotUtf8] = useState(false);
  const [skipExisting, setSkipExisting] = useState(true);
  const [tooLarge, setTooLarge] = useState<string | null>(null);
  // The button pressed last — for the pending label, and as the intent when the
  // browser does not say which button submitted the form.
  const [pressed, setPressed] = useState<ImportMode | null>(null);
  const pressedRef = useRef<ImportMode | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Clear so choosing the same (corrected) file again still fires a change.
    e.target.value = "";
    if (!file) return;
    // Not file.text(): it reads UTF-8 leniently, turning every byte it cannot
    // read into U+FFFD, and that would be imported as the name.
    const { text, windows1252 } = decodeCsvBytes(await file.arrayBuffer());
    setCsv(text);
    setFileName(file.name);
    setNotUtf8(windows1252);
    setTooLarge(null);
  }

  /**
   * Dispatched by hand rather than through `<form action>`: React resets a form
   * after an action, and Radix Select's hidden native select would then fall
   * back to its initial value while still showing the chosen one — the next
   * import would quietly use the wrong default coordinator.
   *
   * A hand-built FormData does not include the submit button, so the intent
   * (Check file / Import projects) is set from the button that submitted the
   * form. With no way to tell it is sent blank, which the server refuses — a
   * request that does not say what it wants never writes anything.
   */
  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const submitter = (e.nativeEvent as SubmitEvent).submitter;
    const fromButton = submitter instanceof HTMLButtonElement ? submitter.value : null;
    const intent = isMode(fromButton) ? fromButton : pressedRef.current;
    pressedRef.current = null;

    const bytes = new Blob([csv]).size;
    if (bytes > MAX_UPLOAD_BYTES) {
      setTooLarge(
        `This file is too large to upload in one go (${(bytes / 1_000_000).toFixed(1)} MB). Split it into smaller files and import them one after another.`,
      );
      return;
    }
    setTooLarge(null);
    setPressed(intent);
    const data = new FormData(e.currentTarget);
    data.set("intent", intent ?? "");
    startTransition(() => formAction(data));
  }

  return (
    <div className="space-y-6">
      <form onSubmit={onSubmit} className="space-y-5">
        <FormField
          label="Default coordinator for blank cells"
          htmlFor="default_coordinator_id"
          hint="Only used for rows whose coordinator cell is blank. Leave it at No default unless those rows really belong to one person — they cannot carry an incentive."
        >
          <FormSelect
            id="default_coordinator_id"
            name="default_coordinator_id"
            defaultValue={NO_DEFAULT}
            options={[NO_DEFAULT_OPTION, ...coordinators]}
          />
        </FormField>

        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <Button
            type="button"
            variant="outline"
            className="h-10 md:h-8"
            onClick={() => fileRef.current?.click()}
          >
            <Upload data-icon="inline-start" /> Choose CSV file
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="h-10 md:h-8"
            onClick={() => downloadCsv("bss-projects-template.csv", IMPORT_TEMPLATE)}
          >
            <Download data-icon="inline-start" /> Download template
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={onFile}
          />
        </div>

        <FormField
          label="CSV data"
          htmlFor="csv"
          hint={
            fileName
              ? `Loaded ${fileName}. You can still edit it here before importing.`
              : "The first line must be the header. Paste rows here or load a file above."
          }
        >
          <Textarea
            id="csv"
            name="csv"
            value={csv}
            onChange={(e) => {
              setCsv(e.target.value);
              setTooLarge(null);
            }}
            rows={10}
            spellCheck={false}
            autoComplete="off"
            className={CSV_BOX_CLASS}
            placeholder={IMPORT_TEMPLATE.split("\n").slice(0, 2).join("\n")}
          />
        </FormField>

        {notUtf8 && (
          <p
            role="status"
            className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200"
          >
            {NOT_UTF8_NOTICE}
          </p>
        )}

        <SkipExistingField checked={skipExisting} onChange={setSkipExisting} />

        <FormError message={tooLarge ?? state.error} />

        <div className="space-y-2">
          <div className="flex flex-col gap-2 sm:flex-row">
            {/* Check file first: it is what Enter would press, and it writes nothing. */}
            <Button
              type="submit"
              name="intent"
              value="check"
              variant="outline"
              disabled={pending}
              onClick={() => {
                pressedRef.current = "check";
              }}
              className="h-10 w-full sm:w-auto"
            >
              {pending && pressed === "check" && (
                <Loader2 className="animate-spin" data-icon="inline-start" />
              )}
              {pending && pressed === "check" ? "Checking…" : "Check file"}
            </Button>
            <Button
              type="submit"
              name="intent"
              value="import"
              disabled={pending}
              onClick={() => {
                pressedRef.current = "import";
              }}
              className="h-10 w-full sm:w-auto"
            >
              {pending && pressed === "import" && (
                <Loader2 className="animate-spin" data-icon="inline-start" />
              )}
              {pending && pressed === "import" ? "Importing…" : "Import projects"}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Check file validates every row and shows who each coordinator name became —
            nothing is written until you press Import projects.
          </p>
        </div>
      </form>

      {state.ran && state.results.length > 0 && <ImportResults state={state} />}
    </div>
  );
}

function SkipExistingField({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-start gap-3 rounded-lg border p-3">
      <Checkbox
        id="skip_existing"
        checked={checked}
        onCheckedChange={(value) => onChange(value === true)}
        aria-describedby="skip_existing_hint"
        className="mt-0.5"
      />
      <div className="space-y-1">
        <Label htmlFor="skip_existing" className="leading-snug">
          Skip rows whose consumer number already exists
        </Label>
        <p id="skip_existing_hint" className="text-xs text-muted-foreground">
          A row whose KSEB consumer number is already in the system is reported as
          skipped instead of creating a duplicate project. Rows without a consumer
          number are imported again every time, so to retry, upload the failed-rows
          download rather than the whole sheet. Turn off only to add a second plant
          on an existing connection.
        </p>
      </div>
      {/* An unchecked checkbox posts nothing; post the choice explicitly. */}
      <input type="hidden" name="skip_existing" value={checked ? "true" : "false"} />
    </div>
  );
}

type Filter = ImportRowStatus | "all";

/** File-level notes: legal, but probably not what was meant. */
function Warnings({ warnings }: { warnings: readonly string[] }) {
  if (warnings.length === 0) return null;
  return (
    <section
      aria-labelledby="import-warnings-title"
      className="space-y-1.5 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200"
    >
      <h3 id="import-warnings-title" className="text-sm font-semibold">
        Worth a look
      </h3>
      <ul className="list-disc space-y-1 pl-5 [overflow-wrap:anywhere]">
        {warnings.map((w) => (
          <li key={w}>{w}</li>
        ))}
      </ul>
    </section>
  );
}

function ImportResults({ state }: { state: ImportState }) {
  const checking = state.mode === "check";
  // The filter belongs to one run: a new result resets it (no effect needed).
  const [view, setView] = useState<{ of: ImportState; filter: Filter }>({
    of: state,
    filter: "all",
  });
  const filter = view.of === state ? view.filter : "all";
  const toggle = (status: ImportRowStatus) =>
    setView({ of: state, filter: filter === status ? "all" : status });

  const rows =
    filter === "all" ? state.results : state.results.filter((r) => r.status === filter);
  const statuses = IMPORT_COUNT_STATUSES[state.mode];

  return (
    <section aria-labelledby="import-results-title" className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h3 id="import-results-title" className="text-sm font-semibold">
          {checking ? "Check results — nothing was imported" : "Results"}
        </h3>
        {state.retryCsv && (
          <Button
            type="button"
            variant="outline"
            className="h-10 md:h-8"
            onClick={() => downloadCsv("bss-import-rows-to-fix.csv", state.retryCsv ?? "")}
          >
            <FileWarning data-icon="inline-start" /> Download failed rows
          </Button>
        )}
      </div>

      <Warnings warnings={state.warnings} />
      <CoordinatorMatches matches={state.coordinatorMatches} />

      <div className="space-y-2">
        <div
          className={cn("grid gap-2", statuses.length === 2 ? "grid-cols-2" : "grid-cols-3")}
          role="group"
          aria-label="Filter results"
        >
          {statuses.map((status) => (
            <button
              key={status}
              type="button"
              aria-pressed={filter === status}
              onClick={() => toggle(status)}
              className={cn(
                "flex min-h-10 flex-col items-start rounded-lg border px-3 py-2 text-left text-xs transition-colors hover:bg-muted sm:flex-row sm:items-baseline sm:gap-1.5",
                filter === status && "border-primary ring-2 ring-primary/30",
              )}
            >
              <span className="text-lg font-semibold tabular-nums">{state.counts[status]}</span>{" "}
              <span className="text-muted-foreground">{status}</span>
            </button>
          ))}
        </div>
        {checking && state.skipExisting && (
          <p className="text-xs text-muted-foreground">
            Ready rows will be imported — except those whose consumer number is already in
            the system or repeated earlier in this file, which are skipped.
          </p>
        )}
      </div>

      {checking && (
        <p className="text-xs text-muted-foreground">
          Nothing has been written. Fix the failed rows in the CSV above (or choose a default
          coordinator for blank cells), check again, then press Import projects.
        </p>
      )}
      {!checking && state.retryCsv && (
        <p className="text-xs text-muted-foreground">
          The download holds the skipped and failed rows exactly as uploaded, with the
          reason in an <span className="font-mono">import_error</span> column. Fix them
          and upload that file rather than the whole sheet — that column is ignored.
        </p>
      )}

      {rows.length === 0 ? (
        <p className="rounded-lg border p-4 text-sm text-muted-foreground">
          No {filter} rows.
        </p>
      ) : (
        <ResultList rows={rows} />
      )}
    </section>
  );
}

/** A list that reads as cards on a phone and as a table from md up. */
function ResultList({ rows }: { rows: ImportRowResult[] }) {
  const grid = "md:grid md:grid-cols-[3.5rem_minmax(0,12rem)_6rem_minmax(0,1fr)] md:gap-3";
  return (
    <div className="overflow-hidden rounded-lg border">
      <div
        aria-hidden
        className={cn(
          "hidden bg-muted/60 px-3 py-1.5 text-xs font-medium text-muted-foreground",
          grid,
        )}
      >
        <span>Row</span>
        <span>Client</span>
        <span>Status</span>
        <span>Details</span>
      </div>
      <ol className="divide-y md:max-h-[28rem] md:overflow-y-auto">
        {rows.map((r) => (
          <li
            key={r.row}
            className={cn("flex flex-col gap-1 px-3 py-2.5 text-sm md:items-start", grid)}
          >
            <span className="order-2 text-xs text-muted-foreground tabular-nums md:order-none md:text-sm md:text-foreground">
              <span className="md:sr-only">Row </span>
              {r.row}
            </span>
            <span className="order-1 flex items-center justify-between gap-2 font-medium break-words md:order-none md:block">
              {r.client || "—"}
              <span className="md:hidden">
                <StatusBadge registry={IMPORT_ROW_STATUS} value={r.status} />
              </span>
            </span>
            <span className="hidden md:block">
              <StatusBadge registry={IMPORT_ROW_STATUS} value={r.status} />
            </span>
            <div className="order-3 break-words text-muted-foreground md:order-none md:text-foreground">
              <p>{r.message}</p>
              {r.warnings.length > 0 && (
                <ul className="mt-1 space-y-0.5 text-xs text-amber-800 dark:text-amber-300">
                  {r.warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              )}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
