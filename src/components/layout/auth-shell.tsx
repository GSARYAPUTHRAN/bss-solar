import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { BssLogo } from "@/components/bss-logo";
import { COMPANY } from "@/lib/constants";

/**
 * Centered, branded shell for authentication pages (login / signup).
 */
export function AuthShell({
  title,
  description,
  footer,
  children,
}: {
  title: string;
  description?: string;
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="relative flex min-h-screen w-full items-center justify-center overflow-hidden bg-muted/40 p-4">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_50%_at_50%_0%,var(--color-primary)/12%,transparent)]"
      />
      <div className="relative w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <BssLogo variant="full" className="h-16 w-auto max-w-[220px]" priority />
          <p className="text-sm text-muted-foreground">{COMPANY.tagline}</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>{title}</CardTitle>
            {description && <CardDescription>{description}</CardDescription>}
          </CardHeader>
          <CardContent>
            {children}
            {footer && (
              <p className="mt-4 text-center text-sm text-muted-foreground">
                {footer}
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
