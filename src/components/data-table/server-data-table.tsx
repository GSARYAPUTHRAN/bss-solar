"use client";

import { useCallback, useRef, useState, useTransition, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowDown, ArrowUp, ArrowUpDown, Loader2, Search } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DataPagination } from "@/components/data-pagination";
import { useLoadingRouter } from "@/lib/loading/use-loading-router";
import { cn } from "@/lib/utils";
import type { ColumnDef, FilterDef, SearchDef } from "./types";

const ALL = "all";

export interface ServerDataTableProps<T> {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
  columns: ColumnDef<T>[];
  filters?: FilterDef<T>[];
  search?: SearchDef<T>;
  noun?: string;
  emptyMessage?: string;
  emptyState?: ReactNode;
  getRowId?: (row: T) => string;
  getRowHref?: (row: T) => string;
  defaultSort?: { key: string; asc: boolean };
}

export function ServerDataTable<T>({
  rows,
  total,
  page,
  pageSize,
  columns,
  filters,
  search,
  noun = "rows",
  emptyMessage = "No records found.",
  emptyState,
  getRowId = (row) => (row as { id: string }).id,
  getRowHref,
  defaultSort,
}: ServerDataTableProps<T>) {
  const router = useRouter();
  const navRouter = useLoadingRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const visibleColumns = columns.filter((c) => !c.hidden);
  const visibleFilters = (filters ?? []).filter((f) => !f.hidden);

  const currentSort = sp.get("sort") ?? defaultSort?.key ?? null;
  const currentDir =
    sp.get("dir") ?? (defaultSort && !defaultSort.asc ? "desc" : "asc");

  const update = useCallback(
    (changes: Record<string, string | null>, resetPage = true) => {
      const params = new URLSearchParams(sp.toString());
      for (const [k, v] of Object.entries(changes)) {
        if (v === null || v === "" || v === ALL) params.delete(k);
        else params.set(k, v);
      }
      if (resetPage && !("page" in changes)) params.delete("page");
      const qs = params.toString();
      startTransition(() =>
        router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }),
      );
    },
    [sp, pathname, router],
  );

  // Debounced free-text search.
  const [term, setTerm] = useState(sp.get("q") ?? "");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function onSearch(value: string) {
    setTerm(value);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => update({ q: value }), 350);
  }

  function toggleSort(col: ColumnDef<T>) {
    const key = col.sortKey ?? col.id;
    if (currentSort === key) {
      update({ sort: key, dir: currentDir === "asc" ? "desc" : "asc" }, false);
    } else {
      update({ sort: key, dir: "asc" }, false);
    }
  }

  const clickable = Boolean(getRowHref);
  const hasToolbar = Boolean(search) || visibleFilters.length > 0;

  return (
    <Card className="p-4">
      {hasToolbar && (
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
          {search && (
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                aria-label="Search"
                placeholder={search.placeholder ?? "Search…"}
                value={term}
                onChange={(e) => onSearch(e.target.value)}
                className="pl-8"
              />
            </div>
          )}
          {visibleFilters.map((filter) => (
            <Select
              key={filter.id}
              value={sp.get(filter.id) ?? ALL}
              onValueChange={(v) => update({ [filter.id]: v })}
            >
              <SelectTrigger
                aria-label={filter.placeholder}
                className={cn("w-full sm:w-44", filter.widthClass)}
              >
                <SelectValue placeholder={filter.placeholder} />
              </SelectTrigger>
              <SelectContent>
                {filter.options.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ))}
        </div>
      )}

      <div className="relative overflow-x-auto">
        {isPending && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/40">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        )}
        <Table className={cn(isPending && "opacity-60 transition-opacity")}>
          <TableHeader>
            <TableRow>
              {visibleColumns.map((col) => {
                const key = col.sortKey ?? col.id;
                const active = col.sortable && currentSort === key;
                return (
                  <TableHead key={col.id} className={col.headerClassName}>
                    {col.sortable ? (
                      <button
                        type="button"
                        onClick={() => toggleSort(col)}
                        className="flex items-center gap-1 hover:text-foreground"
                        aria-label={`Sort by ${typeof col.header === "string" ? col.header : col.id}`}
                      >
                        {col.header}
                        {active ? (
                          currentDir === "asc" ? (
                            <ArrowUp className="h-3.5 w-3.5" />
                          ) : (
                            <ArrowDown className="h-3.5 w-3.5" />
                          )
                        ) : (
                          <ArrowUpDown className="h-3.5 w-3.5 opacity-50" />
                        )}
                      </button>
                    ) : (
                      col.header
                    )}
                  </TableHead>
                );
              })}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={visibleColumns.length} className="p-0">
                  {total === 0 && emptyState ? (
                    <div className="py-6">{emptyState}</div>
                  ) : (
                    <div className="flex h-24 items-center justify-center text-muted-foreground">
                      {total === 0
                        ? emptyMessage
                        : "No matches for your search or filters."}
                    </div>
                  )}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => (
                <TableRow
                  key={getRowId(row)}
                  className={clickable ? "cursor-pointer" : undefined}
                  onClick={
                    clickable
                      ? () => {
                          const href = getRowHref?.(row);
                          if (href) navRouter.push(href);
                        }
                      : undefined
                  }
                >
                  {visibleColumns.map((col) => (
                    <TableCell key={col.id} className={col.className}>
                      {col.cell(row)}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <DataPagination
        page={page}
        pageSize={pageSize}
        total={total}
        noun={noun}
        onPageChange={(p) => update({ page: String(p) }, false)}
        onPageSizeChange={(s) => update({ size: String(s), page: null }, false)}
      />
    </Card>
  );
}
