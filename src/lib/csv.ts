/**
 * Minimal RFC-4180-ish CSV parser: handles quoted fields, embedded commas and
 * newlines, and "" escaped quotes. Returns rows of raw string cells; fully
 * empty rows are dropped. Pure and dependency-free so it is unit-testable and
 * safe to run in a server action.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const s = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

/**
 * Parse CSV text with a header row into records keyed by (lower-cased) header.
 * Returns `{ records }` or `{ error }` when the header is missing/empty.
 */
export function parseCsvRecords(
  text: string,
): { records: Record<string, string>[] } | { error: string } {
  const rows = parseCsv(text);
  if (rows.length === 0) return { error: "The file is empty." };
  const headers = rows[0].map((h) => h.trim().toLowerCase());
  if (headers.every((h) => h === "")) return { error: "Missing a header row." };

  const records = rows.slice(1).map((cells) => {
    const rec: Record<string, string> = {};
    headers.forEach((h, i) => {
      if (h) rec[h] = (cells[i] ?? "").trim();
    });
    return rec;
  });
  return { records };
}
