"use client";

import { Suspense, type ReactNode } from "react";
import { Analytics } from "@vercel/analytics/react";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { LoadingProvider } from "@/lib/loading/loading-context";
import { GlobalLoader } from "@/components/global-loader";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={null}>
      <LoadingProvider>
        {children}
        <GlobalLoader />
        <Analytics />
        <SpeedInsights />
      </LoadingProvider>
    </Suspense>
  );
}
