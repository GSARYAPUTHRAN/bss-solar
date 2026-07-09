"use client";

import { useActionState, useRef, useState, type ChangeEvent } from "react";
import { CheckCircle2, Download, Loader2, Upload, XCircle } from "lucide-react";
import { importProjects } from "@/app/(app)/onboarding/actions";
import { IMPORT_TEMPLATE, IMPORT_INITIAL } from "@/lib/domain/import";
import { FormField } from "@/components/layout";
import { FormSelect } from "@/components/form-select";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export function BulkImportForm({
  members,
  defaultId,
}: {
  members: { id: string; full_name: string }[];
  defaultId: string;
}) {
  const [state, formAction, pending] = useActionState(
    importProjects,
    IMPORT_INITIAL,
  );
  const [csv, setCsv] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) setCsv(await file.text());
  }

  function downloadTemplate() {
    const blob = new Blob([IMPORT_TEMPLATE], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "bss-projects-template.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-5">
      <form action={formAction} className="space-y-5">
        <FormField
          label="Assign to (default coordinator)"
          htmlFor="default_coordinator_id"
          hint="Used when a row has no coordinator_email; a matching email overrides it."
        >
          <FormSelect
            id="default_coordinator_id"
            name="default_coordinator_id"
            defaultValue={defaultId}
            options={members.map((m) => ({ value: m.id, label: m.full_name }))}
          />
        </FormField>

        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => fileRef.current?.click()}
          >
            <Upload className="mr-2 h-4 w-4" /> Choose CSV file
          </Button>
          <Button type="button" variant="ghost" onClick={downloadTemplate}>
            <Download className="mr-2 h-4 w-4" /> Download template
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
          hint="The first row must be the header. Paste rows or load a file above."
        >
          <Textarea
            id="csv"
            name="csv"
            value={csv}
            onChange={(e) => setCsv(e.target.value)}
            rows={10}
            spellCheck={false}
            className="font-mono text-xs"
            placeholder={IMPORT_TEMPLATE}
          />
        </FormField>

        {state.error && (
          <p
            role="alert"
            className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            {state.error}
          </p>
        )}

        <Button type="submit" disabled={pending}>
          {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {pending ? "Importing…" : "Import projects"}
        </Button>
      </form>

      {state.ran && !state.error && (
        <div className="space-y-3 rounded-lg border p-4">
          <p className="text-sm font-medium">
            <span className="text-emerald-600 dark:text-emerald-400">
              {state.imported} imported
            </span>
            {state.failed > 0 && (
              <span className="text-destructive"> · {state.failed} failed</span>
            )}
          </p>
          <div className="max-h-72 overflow-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-muted/60 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-1.5">Row</th>
                  <th className="px-3 py-1.5">Client</th>
                  <th className="px-3 py-1.5">Result</th>
                </tr>
              </thead>
              <tbody>
                {state.results.map((r) => (
                  <tr key={r.row} className="border-t">
                    <td className="px-3 py-1.5 tabular-nums">{r.row}</td>
                    <td className="px-3 py-1.5">{r.client}</td>
                    <td className="px-3 py-1.5">
                      <span
                        className={`inline-flex items-center gap-1.5 ${
                          r.ok
                            ? "text-emerald-600 dark:text-emerald-400"
                            : "text-destructive"
                        }`}
                      >
                        {r.ok ? (
                          <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                        ) : (
                          <XCircle className="h-3.5 w-3.5 shrink-0" />
                        )}
                        {r.message}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
