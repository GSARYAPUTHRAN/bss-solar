"use client";

import { useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";

/**
 * Shows a one-off toast from `?flash=<msg>&flashType=success|error` on the
 * destination page (server actions redirect with these), then strips the params
 * from the URL so a refresh doesn't re-fire it. Mounted once app-wide.
 */
export function FlashToast() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const flash = params.get("flash");
  const type = params.get("flashType");

  useEffect(() => {
    if (!flash) return;
    if (type === "error") toast.error(flash);
    else toast.success(flash);

    const next = new URLSearchParams(params);
    next.delete("flash");
    next.delete("flashType");
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    // Fire only when the flash message changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flash, type]);

  return null;
}
