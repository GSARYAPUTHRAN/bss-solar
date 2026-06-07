"use client";

import { Loader2 } from "lucide-react";
import { useLoading } from "@/lib/loading/loading-context";

export function GlobalLoader() {
  const { isLoading } = useLoading();

  if (!isLoading) return null;

  return (
    <>
      <div
        role="progressbar"
        aria-label="Loading"
        className="fixed inset-x-0 top-0 z-[100] h-0.5 overflow-hidden bg-primary/20"
      >
        <div className="h-full w-1/3 animate-[bss-loader_1.1s_ease-in-out_infinite] rounded-full bg-primary" />
      </div>
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 z-[90] flex items-start justify-center bg-background/25 pt-24 backdrop-blur-[1px]"
      >
        <div className="flex items-center gap-2 rounded-full border bg-card px-4 py-2 text-sm text-muted-foreground shadow-sm">
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
          Loading…
        </div>
      </div>
    </>
  );
}
