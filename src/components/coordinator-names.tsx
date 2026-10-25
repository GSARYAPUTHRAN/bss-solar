import { Badge } from "@/components/ui/badge";
import { coordinatorsLabel } from "@/lib/domain/coordinators";
import { cn } from "@/lib/utils";

/**
 * Who shares a sale. `inline` reads as one phrase ("Ravi & Abhijith") for table
 * cells and sub-lines; `chips` gives each person their own badge, wrapping, for
 * detail pages. An empty list reads as an em dash either way.
 */
export function CoordinatorNames({
  names,
  variant = "inline",
  className,
}: {
  names: readonly string[];
  variant?: "inline" | "chips";
  className?: string;
}) {
  const list = names.map((name) => name.trim()).filter(Boolean);

  if (variant === "chips" && list.length > 0) {
    return (
      <span className={cn("flex flex-wrap items-center gap-1.5", className)}>
        {list.map((name, i) => (
          <Badge key={`${i}-${name}`} variant="secondary">
            {name}
          </Badge>
        ))}
      </span>
    );
  }
  return <span className={className}>{coordinatorsLabel(list)}</span>;
}
