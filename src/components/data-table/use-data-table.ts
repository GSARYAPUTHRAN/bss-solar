"use client";

import { useEffect, useMemo, useState } from "react";
import type { ColumnDef, FilterDef, SearchDef, SortState } from "./types";

const ALL = "all";

export interface UseDataTableOptions<T> {
  data: T[];
  columns: ColumnDef<T>[];
  filters?: FilterDef<T>[];
  search?: SearchDef<T>;
  initialSort?: SortState;
  initialPageSize?: number;
}

/**
 * Headless table state: search + dropdown filters + single-column sort +
 * client-side pagination. UI-agnostic so it can back any presentation.
 */
export function useDataTable<T>({
  data,
  columns,
  filters = [],
  search,
  initialSort,
  initialPageSize = 10,
}: UseDataTableOptions<T>) {
  const [query, setQuery] = useState("");
  const [filterValues, setFilterValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(filters.map((f) => [f.id, ALL])),
  );
  const [sort, setSort] = useState<SortState | null>(initialSort ?? null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(initialPageSize);

  const filterKey = JSON.stringify(filterValues);

  const filtered = useMemo(() => {
    let rows = [...data];

    const q = query.trim().toLowerCase();
    if (q && search) rows = rows.filter((r) => search.predicate(r, q));

    for (const f of filters) {
      const value = filterValues[f.id];
      if (value && value !== ALL) {
        rows = rows.filter((r) => f.predicate(r, value));
      }
    }

    if (sort) {
      const col = columns.find((c) => c.id === sort.id);
      const accessor = col?.sortAccessor;
      if (accessor) {
        rows.sort((a, b) => {
          const av = accessor(a);
          const bv = accessor(b);
          if (av < bv) return sort.asc ? -1 : 1;
          if (av > bv) return sort.asc ? 1 : -1;
          return 0;
        });
      }
    }

    return rows;
    // filterKey captures filterValues by content; columns/filters/search are stable configs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, query, filterKey, sort]);

  useEffect(() => {
    setPage(1);
  }, [query, filterKey, pageSize]);

  const total = filtered.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, pageCount);
  const paged = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);

  function setFilterValue(id: string, value: string) {
    setFilterValues((prev) => ({ ...prev, [id]: value }));
  }

  function toggleSort(id: string) {
    setSort((prev) =>
      prev && prev.id === id ? { id, asc: !prev.asc } : { id, asc: true },
    );
  }

  return {
    query,
    setQuery,
    filterValues,
    setFilterValue,
    sort,
    toggleSort,
    page: safePage,
    setPage,
    pageSize,
    setPageSize,
    total,
    paged,
  };
}
