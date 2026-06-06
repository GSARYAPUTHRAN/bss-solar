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
  /** When true, the header becomes a sort toggle (requires sortAccessor). */
  sortable?: boolean;
  /** Value used to sort rows for this column. */
  sortAccessor?: (row: T) => string | number;
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
  /** Predicate applied when a non-"all" value is selected. */
  predicate: (row: T, value: string) => boolean;
  /** Tailwind width class for the trigger (default w-44). */
  widthClass?: string;
  hidden?: boolean;
}

/** Free-text search configuration. */
export interface SearchDef<T> {
  placeholder?: string;
  predicate: (row: T, query: string) => boolean;
}

export interface SortState {
  id: string;
  asc: boolean;
}
