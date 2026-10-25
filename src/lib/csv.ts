/**
 * Minimal RFC-4180-ish CSV parser: handles quoted fields, embedded commas and
 * newlines, and "" escaped quotes. Returns rows of raw string cells; fully
 * empty rows are dropped. Pure and dependency-free so it is unit-testable and
 * safe to run in a server action.
 *
 * `lines[i]` is the line of the text that `rows[i]` starts on (the first line
 * is 1). Dropped rows and the extra lines of a quoted value that spans several
 * count, so it is the line number a text editor — or the CSV box — shows.
 *
 * A quote opens a quoted field only at the start of a cell (spaces before it
 * are dropped); anywhere else it is an ordinary character, so `2" conduit`
 * reads as typed. A quoted field that never closes, or is followed by more
 * than spaces before the next comma or line, is an `{ error }` naming the
 * line: read on, it would silently merge or split every cell after it.
 */
export function parseCsv(
  text: string,
): { rows: string[][]; lines: number[] } | { error: string } {
  const rows: string[][] = [];
  const lines: number[] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  // The current cell was a quoted field that has closed: only spaces may follow.
  let quoteClosed = false;
  let line = 1;
  // The line the current row started on: `line` moves on inside a quoted value.
  let rowLine = 1;
  let quoteLine = 1;
  // Excel's "CSV UTF-8" export starts with a byte-order mark; left in place it
  // would glue itself to the first header and make it an unknown column.
  const s = text
    .replace(/^﻿/, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");

  const endField = () => {
    row.push(field);
    field = "";
    quoteClosed = false;
  };

  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
          quoteClosed = true;
        }
      } else {
        if (c === "\n") line++;
        field += c;
      }
    } else if (c === ",") {
      endField();
    } else if (c === "\n") {
      endField();
      rows.push(row);
      lines.push(rowLine);
      row = [];
      line++;
      rowLine = line;
    } else if (quoteClosed) {
      if (c.trim() !== "") {
        return {
          error: `Unexpected text after a closing quote on line ${line} — inside a quoted value, write each " as "".`,
        };
      }
    } else if (c === '"' && field.trim() === "") {
      inQuotes = true;
      quoteLine = line;
      field = "";
    } else {
      field += c;
    }
  }
  if (inQuotes) {
    return {
      error: `Unclosed quote starting on line ${quoteLine} — add the closing " or remove the opening one.`,
    };
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
    lines.push(rowLine);
  }

  // The blank rows go, and their lines with them — the lines left keep their numbers.
  const kept = rows.flatMap((r, i) => (r.some((cell) => cell.trim() !== "") ? [i] : []));
  return { rows: kept.map((i) => rows[i]), lines: kept.map((i) => lines[i]) };
}

/**
 * A CSV file's bytes as text. UTF-8 is tried strictly; a file that is not
 * valid UTF-8 — Excel's plain "CSV (Comma delimited)" on Windows is Windows-1252
 * — is read as Windows-1252 instead, and `windows1252` says so. Read leniently
 * as UTF-8 every en dash, curly quote and accented letter in such a file would
 * silently become U+FFFD.
 */
export function decodeCsvBytes(bytes: ArrayBuffer | Uint8Array): {
  text: string;
  windows1252: boolean;
} {
  try {
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(bytes), windows1252: false };
  } catch {
    return { text: new TextDecoder("windows-1252").decode(bytes), windows1252: true };
  }
}

/** One data row of `parseCsvRecords`. */
export interface CsvRecord {
  /** Trimmed cells keyed by lower-cased header; "" where the row is short. */
  cells: Record<string, string>;
  /**
   * The line of the text the row starts on, the first line being 1. Blank
   * lines count, and so does every line of a quoted value that spans several:
   * it is the number the CSV box (or a text editor) shows beside the row.
   */
  line: number;
  /**
   * Set when the row has values past the header's last column. No column
   * holds them, so the row cannot go in as it stands — usually an unquoted
   * comma split one value in two. The message quotes them because nothing
   * else keyed by header (the failed-rows download included) carries them.
   */
  problem?: string;
}

/** Cells up to the last non-blank one: trailing commas from a spreadsheet do not count. */
function filledWidth(cells: readonly string[]): number {
  return cells.findLastIndex((cell) => cell.trim() !== "") + 1;
}

/**
 * Parse CSV text with a header row into records keyed by (lower-cased) header.
 * `headers` is the header row as written (trimmed, lower-cased, duplicates and
 * blanks kept) so callers can validate it; blank headers are not keyed.
 * Returns `{ headers, records }`, or `{ error }` when the text is not valid
 * CSV or the header is missing.
 */
export function parseCsvRecords(
  text: string,
): { headers: string[]; records: CsvRecord[] } | { error: string } {
  const csv = parseCsv(text);
  if ("error" in csv) return csv;
  const { rows, lines } = csv;
  if (rows.length === 0) return { error: "The file is empty." };
  const headers = rows[0].map((h) => h.trim().toLowerCase());
  if (headers.every((h) => h === "")) return { error: "Missing a header row." };
  const width = filledWidth(headers);

  const records = rows.slice(1).map((row, i): CsvRecord => {
    const line = lines[i + 1];
    const cells: Record<string, string> = {};
    headers.forEach((h, col) => {
      if (h) cells[h] = (row[col] ?? "").trim();
    });
    const extra = row.slice(width).map((cell) => cell.trim()).filter(Boolean);
    if (extra.length === 0) return { cells, line };
    return {
      cells,
      line,
      problem: `Row has ${filledWidth(row)} cells but the header has ${width} — put values that contain commas in double quotes (past the last column: ${extra
        .map((cell) => `"${cell}"`)
        .join(", ")})`,
    };
  });
  return { headers, records };
}

/** Quote a cell only when it would otherwise change meaning when re-parsed. */
function csvCell(value: string): string {
  return /[",\r\n]|^\s|\s$/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

/**
 * Serialize rows to CSV text that `parseCsv` reads back cell-for-cell.
 *
 * Cells are written verbatim — deliberately no spreadsheet-formula escaping:
 * this is used to hand an admin back their own data for correction and
 * re-upload, and prefixing values such as "+91 98470 11111" would corrupt them.
 */
export function toCsv(rows: readonly (readonly string[])[]): string {
  return rows.map((row) => row.map(csvCell).join(",")).join("\n");
}
