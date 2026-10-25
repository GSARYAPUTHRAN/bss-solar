"use client";

import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { capacityProblem, formatKw, parseCapacityKw } from "@/lib/domain/capacity";
import { registrationFee } from "@/lib/domain/kseb";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";
import { TOUCH_INPUT } from "./touch";

/**
 * The plant-capacity input of a SOLAR plan, with a live reading of what the
 * label means: the kW the database will derive from it (same rules as
 * `parse_capacity_kw()`) and the KSEB registration fee that follows. A label
 * that does not put a unit on its number ("1 panel") cannot be priced — it
 * would be read as 1 kW — so it is flagged as it is typed, and the browser will
 * not submit it (the server refuses it too, with the same rule:
 * `capacityProblem`). A label equal to `previous` (what is already stored) is
 * left alone, so an old order can be edited without retyping its capacity.
 */
export function CapacityField({
  id,
  name,
  defaultValue,
  suggestions,
  previous,
  onLabelChange,
}: {
  id: string;
  name: string;
  defaultValue?: string;
  suggestions: readonly string[];
  /** The stored label of a solar plan being edited. */
  previous?: string | null;
  /** Told of every keystroke, for a parent that keeps the label across plans. */
  onLabelChange?: (label: string) => void;
}) {
  const [label, setLabel] = useState(defaultValue ?? "");
  const fee = registrationFee(parseCapacityKw(label));
  const blank = label.trim() === "";
  const problem = blank ? null : capacityProblem(label, { previous });
  const invalid = problem !== null;
  const hintId = `${id}-hint`;
  const listId = `${id}-suggestions`;
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.setCustomValidity(problem ?? "");
  }, [problem]);

  return (
    <>
      <Input
        ref={inputRef}
        id={id}
        name={name}
        list={listId}
        placeholder="e.g. 3kW"
        value={label}
        onChange={(e) => {
          setLabel(e.target.value);
          onLabelChange?.(e.target.value);
        }}
        aria-describedby={hintId}
        aria-invalid={invalid || undefined}
        className={TOUCH_INPUT}
        required
      />
      <datalist id={listId}>
        {suggestions.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
      <p
        id={hintId}
        aria-live="polite"
        className={cn("text-xs", invalid ? "text-destructive" : "text-muted-foreground")}
      >
        {blank
          ? "Include the unit, e.g. 3kW, 5 kWp or 3000 W."
          : problem
            ? problem
            : fee
              ? `${formatKw(fee.kw)} · KSEB registration ${formatCurrency(fee.total)} (${formatCurrency(fee.base)} + ${formatCurrency(fee.gst)} GST)`
              : "Unchanged — KSEB fees cannot be priced from this capacity."}
      </p>
    </>
  );
}
