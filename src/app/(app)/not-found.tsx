import Link from "next/link";
import { FileQuestion } from "lucide-react";
import { Page, EmptyState } from "@/components/layout";
import { Button } from "@/components/ui/button";

export default function AppNotFound() {
  return (
    <Page>
      <EmptyState
        icon={FileQuestion}
        title="Page not found"
        description="The record you're looking for doesn't exist or may have been moved or deleted."
        action={
          <Button asChild>
            <Link href="/work-orders">Back to work orders</Link>
          </Button>
        }
        className="mt-10"
      />
    </Page>
  );
}
