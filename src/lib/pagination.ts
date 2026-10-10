export const PAGE_SIZES = [10, 25, 50, 100] as const;
export const DEFAULT_PAGE_SIZE = 10;

export interface PageParams {
  page: number; // 1-based
  pageSize: number;
  q: string;
  sort: string | null;
  dir: "asc" | "desc";
  filters: Record<string, string>;
}

export interface PageResult<T> {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
}

type RawParams = Record<string, string | string[] | undefined>;

/** Parse list URL search params into a normalized PageParams. */
export function parsePageParams(
  searchParams: RawParams,
  opts: {
    filterKeys?: string[];
    defaultSort?: string;
    defaultDir?: "asc" | "desc";
  } = {},
): PageParams {
  const get = (k: string) => {
    const v = searchParams[k];
    return Array.isArray(v) ? v[0] : v;
  };

  const page = Math.max(1, parseInt(get("page") ?? "1", 10) || 1);
  const sizeRaw = parseInt(get("size") ?? "", 10);
  const pageSize = (PAGE_SIZES as readonly number[]).includes(sizeRaw)
    ? sizeRaw
    : DEFAULT_PAGE_SIZE;
  const q = (get("q") ?? "").trim();
  const sort = get("sort") ?? opts.defaultSort ?? null;
  const dirRaw = get("dir");
  const dir: "asc" | "desc" =
    dirRaw === "asc" ? "asc" : dirRaw === "desc" ? "desc" : opts.defaultDir ?? "desc";

  const filters: Record<string, string> = {};
  for (const key of opts.filterKeys ?? []) {
    const val = get(key);
    if (val && val !== "all") filters[key] = val;
  }

  return { page, pageSize, q, sort, dir, filters };
}

/** Neutralize PostgREST `or()`/ilike metacharacters in a user search term. */
export function sanitizeSearch(q: string): string {
  return q.replace(/[,()%*\\]/g, " ").trim();
}

/** Convert 1-based page + size to an inclusive .range() tuple. */
export function rangeFor(page: number, pageSize: number): [number, number] {
  const from = (page - 1) * pageSize;
  return [from, from + pageSize - 1];
}

/** PostgREST's code for HTTP 416, "Requested range not satisfiable". */
export const RANGE_NOT_SATISFIABLE = "PGRST103";

/** What a counted supabase-js query resolves to, as far as paging needs it. */
interface CountedResponse<T> {
  data: T[] | null;
  count: number | null;
  error: { code?: string; message: string } | null;
}

/**
 * Run a counted page query (`count: "exact"` + `.range()`).
 *
 * PostgREST does not answer a page past the end with an empty page: it returns
 * HTTP 416 (PGRST103) and no count. That is an ordinary state for a list — a
 * stale `?page=` after rows were read, cleared or completed — so it comes back
 * as no rows with the real total, read by `countOnly` (a `head: true` count
 * with the same filters), and the page can offer a way back. Any other failure
 * throws: an empty list would claim there is nothing there.
 */
export async function fetchCountedPage<T>(
  query: {
    rows: () => PromiseLike<CountedResponse<T>>;
    countOnly: () => PromiseLike<Omit<CountedResponse<unknown>, "data">>;
  },
  what: string,
): Promise<{ rows: T[]; total: number }> {
  const res = await query.rows();
  if (!res.error) return { rows: res.data ?? [], total: res.count ?? 0 };
  if (res.error.code !== RANGE_NOT_SATISFIABLE) {
    throw new Error(`Could not load ${what}: ${res.error.message}`);
  }

  const head = await query.countOnly();
  if (head.error) throw new Error(`Could not load ${what}: ${head.error.message}`);
  return { rows: [], total: head.count ?? 0 };
}
