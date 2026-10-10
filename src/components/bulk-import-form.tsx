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
import { IMPORT_TEMPLATE } from "@/lib/domain/import-template";
import {
  IMPORT_INITIAL,
  IMPORT_ROW_STATUSES,
  type ImportRowResult,
  type ImportRowStatus,
  type ImportState,
} from "@/lib/domain/import-results";
import type { StatusRegistry } from "@/lib/domain/status";
import { StatusBadge } from "@/components/common/status-badge";
import { FormError, FormField } from "@/components/layout";
import { FormSelect } from "@/components/form-select";
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

/** Same soft, dark-mode-safe tones as the status registries. */
const IMPORT_ROW_STATUS: StatusRegistry<ImportRowStatus> = {
  imported: {
    label: "Imported",
    badgeClass: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300",
  },
  skipped: {
    label: "Skipped",
    badgeClass: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
  },
  failed: {
    label: "Failed",
    badgeClass: "bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300",
  },
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

export function BulkImportForm({
  coordinators,
  defaultCoordinatorId,
}: {
  /** Accounts that may own a work order (never service engineers). */
  coordinators: { value: string; label: string }[];
  defaultCoordinatorId: string;
}) {
  const [state, formAction, pending] = useActionState(importProjects, IMPORT_INITIAL);
  const [csv, setCsv] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [skipExisting, setSkipExisting] = useState(true);
  const [tooLarge, setTooLarge] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Clear so choosing the same (corrected) file again still fires a change.
    e.target.value = "";
    if (!file) return;
    setCsv(await file.text());
    setFileName(file.name);
    setTooLarge(null);
  }

  /**
   * Dispatched by hand rather than through `<form action>`: React resets a form
   * after an action, and Radix Select's hidden native select would then fall
   * back to the initial coordinator while still showing the chosen one — the
   * next import would quietly assign rows to the wrong person.
   */
  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const bytes = new Blob([csv]).size;
    if (bytes > MAX_UPLOAD_BYTES) {
      setTooLarge(
        `This file is too large to upload in one go (${(bytes / 1_000_000).toFixed(1)} MB). Split it into smaller files and import them one after another.`,
      );
      return;
    }
    setTooLarge(null);
    const data = new FormData(e.currentTarget);
    startTransition(() => formAction(data));
  }

  return (
    <div className="space-y-6">
      <form onSubmit={onSubmit} className="space-y-5">
        <FormField
          label="Default coordinator"
          htmlFor="default_coordinator_id"
          hint="Owns every row whose coordinator_email is blank. A filled-in e-mail must match a coordinator or office account, or that row fails."
        >
          <FormSelect
            id="default_coordinator_id"
            name="default_coordinator_id"
            defaultValue={defaultCoordinatorId}
            options={coordinators}
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
            className="font-mono text-xs"
            placeholder={IMPORT_TEMPLATE.split("\n").slice(0, 2).join("\n")}
          />
        </FormField>

        <SkipExistingField checked={skipExisting} onChange={setSkipExisting} />

        <FormError message={tooLarge ?? state.error} />

        <Button type="submit" disabled={pending} className="h-10 w-full sm:w-auto">
          {pending && <Loader2 className="animate-spin" data-icon="inline-start" />}
          {pending ? "Importing…" : "Import projects"}
        </Button>
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

function ImportResults({ state }: { state: ImportState }) {
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

  return (
    <section aria-labelledby="import-results-title" className="space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h3 id="import-results-title" className="text-sm font-semibold">
          Results
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

      <div className="grid grid-cols-3 gap-2" role="group" aria-label="Filter results">
        {IMPORT_ROW_STATUSES.map((status) => (
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

      {state.retryCsv && (
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
            <span className="order-3 break-words text-muted-foreground md:order-none md:text-foreground">
              {r.message}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
