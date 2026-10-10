import { describe, expect, it, vi } from "vitest";
import { RANGE_NOT_SATISFIABLE, fetchCountedPage, rangeFor } from "./pagination";

/** A supabase-js page response (the builders are thenables resolving to this). */
function response<T>(
  data: T[] | null,
  count: number | null,
  error: { code?: string; message: string } | null = null,
) {
  return Promise.resolve({ data, count, error });
}

/** What PostgREST 16 answers for an offset past the last row (HTTP 416). */
const PAST_THE_END = {
  code: RANGE_NOT_SATISFIABLE,
  message: "Requested range not satisfiable",
};

describe("rangeFor", () => {
  it("turns a 1-based page into an inclusive range", () => {
    expect(rangeFor(1, 20)).toEqual([0, 19]);
    expect(rangeFor(3, 10)).toEqual([20, 29]);
  });
});

describe("fetchCountedPage", () => {
  it("returns the page and the total, without a second query", async () => {
    const countOnly = vi.fn(() => response(null, 0));
    const page = await fetchCountedPage(
      { rows: () => response([{ id: "a" }, { id: "b" }], 22), countOnly },
      "notifications",
    );
    expect(page).toEqual({ rows: [{ id: "a" }, { id: "b" }], total: 22 });
    expect(countOnly).not.toHaveBeenCalled();
  });

  it("treats a missing count or data as nothing", async () => {
    await expect(
      fetchCountedPage(
        { rows: () => response(null, null), countOnly: () => response(null, 0) },
        "notifications",
      ),
    ).resolves.toEqual({ rows: [], total: 0 });
  });

  it("answers a page past the end with no rows and the real total", async () => {
    // e.g. "Mark all read" on page 2 of the unread filter: 9 rows left in all.
    const countOnly = vi.fn(() => response(null, 9));
    const page = await fetchCountedPage(
      { rows: () => response(null, null, PAST_THE_END), countOnly },
      "notifications",
    );
    expect(page).toEqual({ rows: [], total: 9 });
    expect(countOnly).toHaveBeenCalledTimes(1);
  });

  it("reports a total of 0 when nothing is left at all", async () => {
    await expect(
      fetchCountedPage(
        {
          rows: () => response(null, null, PAST_THE_END),
          countOnly: () => response(null, 0),
        },
        "notifications",
      ),
    ).resolves.toEqual({ rows: [], total: 0 });
  });

  it("throws on any other failure instead of reading as an empty list", async () => {
    const countOnly = vi.fn(() => response(null, 0));
    await expect(
      fetchCountedPage(
        {
          rows: () =>
            response(null, null, { code: "42501", message: "permission denied for table" }),
          countOnly,
        },
        "your service tickets",
      ),
    ).rejects.toThrow("Could not load your service tickets: permission denied for table");
    expect(countOnly).not.toHaveBeenCalled();
  });

  it("throws when the follow-up count fails", async () => {
    await expect(
      fetchCountedPage(
        {
          rows: () => response(null, null, PAST_THE_END),
          countOnly: () => response(null, null, { message: "FetchError: socket hang up" }),
        },
        "projects",
      ),
    ).rejects.toThrow("Could not load projects: FetchError: socket hang up");
  });
});
