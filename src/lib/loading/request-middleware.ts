type TrackFn = () => void;

let trackStart: TrackFn | null = null;
let trackEnd: TrackFn | null = null;

declare global {
  interface Window {
    __bssFetchPatched?: boolean;
  }
}

/** Bind loading handlers before installing the fetch interceptor. */
export function bindLoadingHandlers(start: TrackFn, end: TrackFn) {
  trackStart = start;
  trackEnd = end;
}

/**
 * Patches `window.fetch` so every client-side API call shows the global loader.
 * Safe to call multiple times — installs once.
 */
export function installRequestMiddleware() {
  if (typeof window === "undefined" || window.__bssFetchPatched) return;
  window.__bssFetchPatched = true;

  const nativeFetch = window.fetch.bind(window);

  window.fetch = async (input, init) => {
    trackStart?.();
    try {
      return await nativeFetch(input, init);
    } finally {
      trackEnd?.();
    }
  };
}
