import { describe, expect, it, vi } from "vitest";
import { ROWS_PER_PAGE, readAllPages, type PageReply } from "./read-all";

/** A table of `n` rows, answered page by page the way PostgREST does. */
function table(n: number) {
  const rows = Array.from({ length: n }, (_, i) => ({ id: i }));
  return vi.fn(async (from: number, to: number): Promise<PageReply> => {
    if (from > 0 && from >= rows.length) {
      return { data: null, error: { code: "PGRST103", message: "Requested range not satisfiable" } };
    }
    return { data: rows.slice(from, to + 1), error: null };
  });
}

const failed = (message: string) => new Error(`failed: ${message}`);

describe("readAllPages", () => {
  it("reads a short table in one page", async () => {
    const page = table(3);
    expect(await readAllPages(page, failed)).toHaveLength(3);
    expect(page.mock.calls).toEqual([[0, ROWS_PER_PAGE - 1]]);
  });

  it("reads an empty table", async () => {
    expect(await readAllPages(table(0), failed)).toEqual([]);
  });

  it("reads past the cap until a short page", async () => {
    const page = table(2001);
    const rows = await readAllPages<{ id: number }>(page, failed);
    expect(rows.map((r) => r.id)).toEqual(Array.from({ length: 2001 }, (_, i) => i));
    expect(page.mock.calls).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
  });

  it("ends cleanly when the last page was exactly full", async () => {
    const page = table(2 * ROWS_PER_PAGE);
    expect(await readAllPages(page, failed)).toHaveLength(2 * ROWS_PER_PAGE);
    expect(page).toHaveBeenCalledTimes(3);
  });

  it("reads a null page as no rows", async () => {
    expect(await readAllPages(async () => ({ data: null, error: null }), failed)).toEqual([]);
  });

  it("throws the caller's error for any other failure", async () => {
    await expect(
      readAllPages(async () => ({ data: null, error: { code: "57014", message: "timeout" } }), failed),
    ).rejects.toThrow("failed: timeout");
  });

  it("throws for a failure on a later page, keeping nothing half-read", async () => {
    const page = vi
      .fn()
      .mockResolvedValueOnce({
        data: Array.from({ length: ROWS_PER_PAGE }, (_, i) => ({ id: i })),
        error: null,
      })
      .mockResolvedValueOnce({ data: null, error: { message: "connection reset" } });
    await expect(readAllPages(page, failed)).rejects.toThrow("failed: connection reset");
  });
});
