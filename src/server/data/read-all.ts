import { RANGE_NOT_SATISFIABLE } from "@/lib/pagination";

/**
 * Reading a whole table past PostgREST's cap. PostgREST answers at most 1000
 * rows a request (`max_rows`), so a read that must see every row pages through
 * with `.range()` on a unique order (`id`) until a short page.
 */

export const ROWS_PER_PAGE = 1000;

/** What one page query resolves to; rows are typed by the caller's `T`. */
export type PageReply = {
  data: unknown;
  error: { code?: string; message: string } | null;
};

/**
 * Every row of a query, page by page. `page` builds the query for one range
 * (inclusive) and must order by a unique column. A page that starts past the
 * end — the previous page was exactly full — ends the read; any other failure
 * throws `failed(message)`, never a silently short list.
 */
export async function readAllPages<T>(
  page: (from: number, to: number) => PromiseLike<PageReply>,
  failed: (message: string) => Error,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += ROWS_PER_PAGE) {
    const { data, error } = await page(from, from + ROWS_PER_PAGE - 1);
    if (error) {
      if (error.code === RANGE_NOT_SATISFIABLE) return rows;
      throw failed(error.message);
    }
    const batch = (data ?? []) as T[];
    rows.push(...batch);
    if (batch.length < ROWS_PER_PAGE) return rows;
  }
}
