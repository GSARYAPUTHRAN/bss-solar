"use client";

import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ArrowUpDown, Search } from "lucide-react";
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
import { cn } from "@/lib/utils";
import { useDataTable } from "./use-data-table";
import type { ColumnDef, FilterDef, SearchDef, SortState } from "./types";

export interface DataTableProps<T> {
  data: T[];
  columns: ColumnDef<T>[];
  filters?: FilterDef<T>[];
  search?: SearchDef<T>;
  initialSort?: SortState;
  pageSize?: number;
  /** Plural noun for the pagination summary (e.g. "work orders"). */
  noun?: string;
  emptyMessage?: string;
  /** Stable row key (defaults to `row.id`). */
  getRowId?: (row: T) => string;
  /** If provided, clicking a row navigates here. */
  getRowHref?: (row: T) => string;
  /** Alternative to navigation: arbitrary row click handler. */
  onRowClick?: (row: T) => void;
  /** Extra controls rendered at the end of the toolbar. */
  toolbarEnd?: ReactNode;
}

export function DataTable<T>({
  data,
  columns,
  filters,
  search,
  initialSort,
  pageSize = 10,
  noun = "rows",
  emptyMessage = "No records found.",
  getRowId = (row) => (row as { id: string }).id,
  getRowHref,
  onRowClick,
  toolbarEnd,
}: DataTableProps<T>) {
  const router = useRouter();
  const visibleColumns = columns.filter((c) => !c.hidden);
  const visibleFilters = (filters ?? []).filter((f) => !f.hidden);

  const table = useDataTable({
    data,
    columns: visibleColumns,
    filters: visibleFilters,
    search,
    initialSort,
    initialPageSize: pageSize,
  });

  const hasToolbar = Boolean(search) || visibleFilters.length > 0 || !!toolbarEnd;
  const clickable = Boolean(getRowHref || onRowClick);

  function handleRowClick(row: T) {
    const href = getRowHref?.(row);
    if (href) router.push(href);
    else onRowClick?.(row);
  }

  return (
    <Card className="p-4">
      {hasToolbar && (
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
          {search && (
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder={search.placeholder ?? "Search…"}
                value={table.query}
                onChange={(e) => table.setQuery(e.target.value)}
                className="pl-8"
              />
            </div>
          )}
          {visibleFilters.map((filter) => (
            <Select
              key={filter.id}
              value={table.filterValues[filter.id] ?? "all"}
              onValueChange={(v) => table.setFilterValue(filter.id, v)}
            >
              <SelectTrigger className={cn("w-full sm:w-44", filter.widthClass)}>
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
          {toolbarEnd}
        </div>
      )}

      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              {visibleColumns.map((col) => (
                <TableHead key={col.id} className={col.headerClassName}>
                  {col.sortable ? (
                    <button
                      type="button"
                      onClick={() => table.toggleSort(col.id)}
                      className="flex items-center gap-1 hover:text-foreground"
                    >
                      {col.header}
                      <ArrowUpDown className="h-3.5 w-3.5" />
                    </button>
                  ) : (
                    col.header
                  )}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {table.paged.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={visibleColumns.length}
                  className="h-24 text-center text-muted-foreground"
                >
                  {emptyMessage}
                </TableCell>
              </TableRow>
            ) : (
              table.paged.map((row) => (
                <TableRow
                  key={getRowId(row)}
                  className={clickable ? "cursor-pointer" : undefined}
                  onClick={clickable ? () => handleRowClick(row) : undefined}
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
        page={table.page}
        pageSize={table.pageSize}
        total={table.total}
        noun={noun}
        onPageChange={table.setPage}
        onPageSizeChange={table.setPageSize}
      />
    </Card>
  );
}
