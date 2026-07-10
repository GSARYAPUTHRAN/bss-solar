import type { ReactNode } from "react";

/** A single column definition. */
export interface ColumnDef<T> {
  id: string;
  header: ReactNode;
  /** Cell renderer for a row. */
  cell: (row: T) => ReactNode;
  /** Tailwind classes applied to the body cell (e.g. "text-right"). */
  className?: string;
  /** Tailwind classes applied to the header cell. */
  headerClassName?: string;
  /** When true, the header becomes a sort toggle. */
  sortable?: boolean;
  /** Value used to sort rows for this column (client mode). */
  sortAccessor?: (row: T) => string | number;
  /** DB column to ORDER BY in server mode (defaults to `id`). */
  sortKey?: string;
  /** Hide the column entirely (e.g. admin-only columns). */
  hidden?: boolean;
}

export interface FilterOption {
  value: string;
  label: string;
}

/** A dropdown filter. The first option should be the "all" sentinel. */
export interface FilterDef<T> {
  id: string;
  placeholder?: string;
  options: FilterOption[];
  /** Predicate applied when a non-"all" value is selected (client mode). */
  predicate: (row: T, value: string) => boolean;
  /** DB column matched with eq() in server mode (defaults to the filter id). */
  column?: string;
  /** Tailwind width class for the trigger (default w-44). */
  widthClass?: string;
  hidden?: boolean;
}

/** Free-text search configuration. */
export interface SearchDef<T> {
  placeholder?: string;
  /** Row predicate for client mode. */
  predicate: (row: T, query: string) => boolean;
  /** DB columns matched with ilike in server mode. */
  columns?: string[];
}

export interface SortState {
  id: string;
  asc: boolean;
}
