import { useSyncExternalStore } from "react";

/** Tailwind's `md` breakpoint — below it, pickers open as a bottom sheet. */
const DESKTOP_QUERY = "(min-width: 768px)";

function subscribe(onChange: () => void): () => void {
  const query = window.matchMedia?.(DESKTOP_QUERY);
  query?.addEventListener("change", onChange);
  return () => query?.removeEventListener("change", onChange);
}

function snapshot(): boolean {
  return window.matchMedia?.(DESKTOP_QUERY).matches ?? false;
}

/**
 * Whether the viewport is `md` or wider. Phone-first: the server render and any
 * environment without `matchMedia` answer "no", so the phone layout (a bottom
 * sheet) is the one that is always correct before the browser says otherwise.
 */
export function useIsDesktop(): boolean {
  return useSyncExternalStore(subscribe, snapshot, () => false);
}
