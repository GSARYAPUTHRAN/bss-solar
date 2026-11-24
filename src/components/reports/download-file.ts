import { toCsv } from "@/lib/csv";

/**
 * Save rows as a CSV file in the browser: UTF-8 with a byte-order mark (so
 * Excel reads ₹, Malayalam names and dashes correctly) and RFC-4180 quoting.
 */
export function downloadCsv(filename: string, rows: readonly (readonly string[])[]): void {
  const blob = new Blob([`﻿${toCsv(rows)}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke after the click has been handled, or some browsers cancel the save.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
