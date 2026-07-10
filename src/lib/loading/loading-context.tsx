"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { usePathname, useSearchParams } from "next/navigation";
import {
  bindLoadingHandlers,
  installRequestMiddleware,
} from "@/lib/loading/request-middleware";

interface LoadingContextValue {
  isLoading: boolean;
  trackStart: () => void;
  trackEnd: () => void;
  trackPromise: <T>(promise: Promise<T>) => Promise<T>;
}

const LoadingContext = createContext<LoadingContextValue | null>(null);

export function LoadingProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState(0);
  const [visible, setVisible] = useState(false);
  const showTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const trackStart = useCallback(() => {
    setPending((n) => n + 1);
  }, []);

  const trackEnd = useCallback(() => {
    setPending((n) => Math.max(0, n - 1));
  }, []);

  const trackPromise = useCallback(
    async <T,>(promise: Promise<T>) => {
      trackStart();
      try {
        return await promise;
      } finally {
        trackEnd();
      }
    },
    [trackStart, trackEnd],
  );

  // Delay showing loader to avoid flash on fast requests.
  useEffect(() => {
    if (pending > 0) {
      showTimer.current = setTimeout(() => setVisible(true), 150);
    } else {
      if (showTimer.current) clearTimeout(showTimer.current);
      // Deliberate: hide as soon as the in-flight counter drains.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setVisible(false);
    }
    return () => {
      if (showTimer.current) clearTimeout(showTimer.current);
    };
  }, [pending]);

  // Navigation or server-action redirect completed — reset the loader.
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    setPending(0);
    setVisible(false);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [pathname, searchParams]);

  // Install fetch middleware + form submit tracking.
  useEffect(() => {
    bindLoadingHandlers(trackStart, trackEnd);
    installRequestMiddleware();

    const onSubmit = (event: Event) => {
      const form = event.target;
      if (form instanceof HTMLFormElement && form.method.toLowerCase() !== "get") {
        trackStart();
      }
    };

    const onClick = (event: MouseEvent) => {
      const anchor = (event.target as HTMLElement).closest("a");
      if (!anchor?.href || anchor.target === "_blank") return;
      const url = new URL(anchor.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname === pathname && url.search === window.location.search) return;
      trackStart();
    };

    document.addEventListener("submit", onSubmit, true);
    document.addEventListener("click", onClick, true);
    return () => {
      document.removeEventListener("submit", onSubmit, true);
      document.removeEventListener("click", onClick, true);
    };
  }, [pathname, trackStart, trackEnd]);

  const value = useMemo(
    () => ({ isLoading: visible, trackStart, trackEnd, trackPromise }),
    [visible, trackStart, trackEnd, trackPromise],
  );

  return (
    <LoadingContext.Provider value={value}>{children}</LoadingContext.Provider>
  );
}

export function useLoading() {
  const ctx = useContext(LoadingContext);
  if (!ctx) {
    throw new Error("useLoading must be used within LoadingProvider");
  }
  return ctx;
}
