import Link from "next/link";
import { BssLogo } from "@/components/bss-logo";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background px-4 text-center">
      <BssLogo variant="full" className="h-12 w-auto max-w-[200px]" />
      <div className="space-y-1">
        <p className="text-5xl font-bold tracking-tight">404</p>
        <p className="text-muted-foreground">
          We couldn&apos;t find that page.
        </p>
      </div>
      <Button asChild>
        <Link href="/">Go to the console</Link>
      </Button>
    </main>
  );
}
