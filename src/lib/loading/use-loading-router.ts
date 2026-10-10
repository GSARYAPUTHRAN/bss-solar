"use client";

import { useRouter } from "next/navigation";
import { useLoading } from "@/lib/loading/loading-context";

/**
 * True when `href` resolves to the page already showing. The loading provider
 * only clears the global loader when the pathname/search changes, so starting
 * it for a same-URL navigation would leave it spinning forever.
 */
export function isSameLocation(href: string, current: Location): boolean {
  try {
    const target = new URL(href, current.href);
    return (
      target.origin === current.origin &&
      target.pathname === current.pathname &&
      target.search === current.search
    );
  } catch {
    return false;
  }
}

/** Drop-in replacement for `useRouter` that triggers the global loader on navigation. */
export function useLoadingRouter() {
  const router = useRouter();
  const { trackStart } = useLoading();

  const start = (href: string) => {
    if (!isSameLocation(href, window.location)) trackStart();
  };

  return {
    ...router,
    push: (href: string, options?: Parameters<typeof router.push>[1]) => {
      start(href);
      return router.push(href, options);
    },
    replace: (href: string, options?: Parameters<typeof router.replace>[1]) => {
      start(href);
      return router.replace(href, options);
    },
  };
}
