import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";

const SIZES = {
  full: "max-w-7xl",
  wide: "max-w-5xl",
  narrow: "max-w-3xl",
  tight: "max-w-2xl",
} as const;

export type PageSize = keyof typeof SIZES;

/**
 * Page shell: centers content and applies a consistent max width + spacing.
 * Use as the outermost element of every route so layout stays uniform.
 */
export function Page({
  size = "full",
  className,
  children,
}: {
  size?: PageSize;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("mx-auto w-full space-y-6", SIZES[size], className)}>
      {children}
    </div>
  );
}

/**
 * Standard page heading with optional back link and trailing actions.
 */
export function PageHeader({
  title,
  description,
  backHref,
  children,
}: {
  title: string;
  description?: string;
  backHref?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="space-y-1">
        {backHref && (
          <Link
            href={backHref}
            className="inline-flex items-center gap-1 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back
          </Link>
        )}
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {description && (
          <p className="text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {children && (
        <div className="flex flex-wrap items-center gap-2">{children}</div>
      )}
    </div>
  );
}
