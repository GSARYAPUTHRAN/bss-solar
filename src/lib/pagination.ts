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
