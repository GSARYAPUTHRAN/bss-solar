"use client";

import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { formatKw, parseCapacityKw } from "@/lib/domain/capacity";
import { registrationFee } from "@/lib/domain/kseb";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";
import { TOUCH_INPUT } from "./touch";

const NEEDS_NUMBER = "Add a number so KSEB fees can be priced, e.g. 3kW.";

/**
 * The plant-capacity input with a live reading of what the label means: the
 * kW the database will derive from it (same rules as `parse_capacity_kw()`) and
 * the KSEB registration fee that follows. A label without a number cannot be
 * priced: it is flagged as it is typed, and the browser will not submit it
 * (the server refuses it too).
 */
export function CapacityField({
  id,
  name,
  defaultValue,
  suggestions,
}: {
  id: string;
  name: string;
  defaultValue?: string;
  suggestions: readonly string[];
}) {
  const [label, setLabel] = useState(defaultValue ?? "");
  const kw = parseCapacityKw(label);
  const fee = registrationFee(kw);
  const blank = label.trim() === "";
  const invalid = !blank && !fee;
  const hintId = `${id}-hint`;
  const listId = `${id}-suggestions`;
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.setCustomValidity(invalid ? NEEDS_NUMBER : "");
  }, [invalid]);

  return (
    <>
      <Input
        ref={inputRef}
        id={id}
        name={name}
        list={listId}
        placeholder="e.g. 3kW"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
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
          ? "Include the number, e.g. 3kW, 5 kWp or 3000 W."
          : fee
            ? `${formatKw(fee.kw)} · KSEB registration ${formatCurrency(fee.total)} (${formatCurrency(fee.base)} + ${formatCurrency(fee.gst)} GST)`
            : NEEDS_NUMBER}
      </p>
    </>
  );
}
