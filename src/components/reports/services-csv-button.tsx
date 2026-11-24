"use client";

import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Byte-order mark: Excel reads the file as UTF-8 only with it. */
const BOM = "﻿";

/** Save CSV text as a file, in the browser — no round trip to the server. */
export function saveCsv(filename: string, csv: string): void {
  const blob = new Blob([`${BOM}${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoked on the next tick: some browsers start the download after click() returns.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * "Services (CSV)": the period's completed visits — every one, not just the
 * rows the page lists. `csv` is built on the server (`servicesCsv`); a period
 * with no visits still downloads, as the header row alone.
 */
export function ServicesCsvButton({ csv, filename }: { csv: string; filename: string }) {
  return (
    <Button
      type="button"
      variant="outline"
      className="h-10 w-full sm:w-auto"
      onClick={() => saveCsv(filename, csv)}
    >
      <Download className="mr-2 h-4 w-4" />
      Services (CSV)
    </Button>
  );
}
