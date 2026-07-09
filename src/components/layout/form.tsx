import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/**
 * Inline error banner for server-action form failures.
 */
export function FormError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p
      role="alert"
      aria-live="assertive"
      className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
    >
      {message}
    </p>
  );
}

/**
 * A labelled form control. Wrap any input/select/textarea as children.
 */
export function FormField({
  label,
  htmlFor,
  required,
  hint,
  className,
  children,
}: {
  label: string;
  htmlFor?: string;
  required?: boolean;
  hint?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("space-y-2", className)}>
      <Label htmlFor={htmlFor}>
        {label}
        {required && <span className="ml-0.5 text-destructive">*</span>}
      </Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

/**
 * Responsive two-column grid for form fields.
 */
export function FormGrid({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("grid gap-5 sm:grid-cols-2", className)}>{children}</div>
  );
}

/**
 * Right-aligned footer for form action buttons.
 */
export function FormActions({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex justify-end gap-2 border-t pt-4">{children}</div>
  );
}
