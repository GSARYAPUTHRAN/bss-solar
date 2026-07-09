"use client";

import { AlertTriangle } from "lucide-react";
import { Page, EmptyState } from "@/components/layout";
import { Button } from "@/components/ui/button";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <Page>
      <EmptyState
        icon={AlertTriangle}
        title="Something went wrong"
        description="An unexpected error occurred while loading this page. You can try again — if it keeps happening, contact the office."
        action={<Button onClick={reset}>Try again</Button>}
        className="mt-10"
      />
      {error.digest && (
        <p className="mt-3 text-center text-xs text-muted-foreground">
          Reference: {error.digest}
        </p>
      )}
    </Page>
  );
}
