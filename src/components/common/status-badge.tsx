import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { StatusRegistry } from "@/lib/domain/status";

/**
 * Renders a soft badge for any registry-backed status value. New statuses are
 * supported automatically by extending the registry — no component changes.
 */
export function StatusBadge<K extends string>({
  registry,
  value,
}: {
  registry: StatusRegistry<K>;
  value: K;
}) {
  const meta = registry[value];
  if (!meta) return null;
  return (
    <Badge className={cn("border-transparent", meta.badgeClass)}>
      {meta.label}
    </Badge>
  );
}
