"use client";

import { useRouter } from "next/navigation";
import { useLoading } from "@/lib/loading/loading-context";

/** Drop-in replacement for `useRouter` that triggers the global loader on navigation. */
export function useLoadingRouter() {
  const router = useRouter();
  const { trackStart } = useLoading();

  return {
    ...router,
    push: (href: string, options?: Parameters<typeof router.push>[1]) => {
      trackStart();
      return router.push(href, options);
    },
    replace: (href: string, options?: Parameters<typeof router.replace>[1]) => {
      trackStart();
      return router.replace(href, options);
    },
  };
}
