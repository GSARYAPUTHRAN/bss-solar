"use client";

import { useEffect, useRef, useState } from "react";
import { FormField, FormGrid } from "@/components/layout";
import { Input } from "@/components/ui/input";
import { ADVANCE_OVER_TOTAL_ERROR } from "@/lib/domain/payment";
import { formatCurrency } from "@/lib/format";
import { TOUCH_INPUT } from "./touch";

const ADVANCE_HINT =
  "Collected at booking. Later instalments go in the project's payments ledger.";
const LOCKED_HINT = "Set by the office after approval.";
const LOCKED_INPUT = `${TOUCH_INPUT} bg-muted/50`;

/** Value for a `type="number"` input — blank rather than a misleading 0. */
function amountValue(value: number | null | undefined): string {
  return value === null || value === undefined ? "" : String(value);
}

/**
 * The contract terms: booking advance and total cost.
 *
 * An advance larger than the total is blocked in the browser with the server's
 * own message, so the form is never sent only to come back without what was
 * typed. When `locked` (a coordinator, once the office has reviewed the order —
 * see `canEditContractTerms`) the values are shown read-only and left out of
 * the submission; the server keeps the stored terms.
 */
export function ContractTermsFields({
  defaultAdvance,
  defaultTotal,
  locked = false,
}: {
  defaultAdvance?: number | null;
  defaultTotal?: number | null;
  locked?: boolean;
}) {
  const [advance, setAdvance] = useState(amountValue(defaultAdvance));
  const [total, setTotal] = useState(amountValue(defaultTotal));
  const advanceRef = useRef<HTMLInputElement>(null);
  const overTotal =
    advance !== "" && total !== "" && Number(advance) > Number(total);

  useEffect(() => {
    advanceRef.current?.setCustomValidity(overTotal ? ADVANCE_OVER_TOTAL_ERROR : "");
  }, [overTotal]);

  if (locked) {
    return (
      <FormGrid>
        <FormField label="Advance collected (INR)" htmlFor="advance_amount" hint={LOCKED_HINT}>
          <Input
            id="advance_amount"
            value={formatCurrency(defaultAdvance)}
            readOnly
            className={LOCKED_INPUT}
          />
        </FormField>
        <FormField label="Total cost (INR)" htmlFor="total_cost" hint={LOCKED_HINT}>
          <Input
            id="total_cost"
            value={formatCurrency(defaultTotal)}
            readOnly
            className={LOCKED_INPUT}
          />
        </FormField>
      </FormGrid>
    );
  }

  return (
    <FormGrid>
      <FormField
        label="Advance collected (INR)"
        htmlFor="advance_amount"
        hint={
          overTotal ? (
            <span className="text-destructive">{ADVANCE_OVER_TOTAL_ERROR}</span>
          ) : (
            ADVANCE_HINT
          )
        }
      >
        <Input
          ref={advanceRef}
          id="advance_amount"
          name="advance_amount"
          type="number"
          inputMode="decimal"
          min="0"
          step="0.01"
          value={advance}
          onChange={(e) => setAdvance(e.target.value)}
          aria-invalid={overTotal || undefined}
          className={TOUCH_INPUT}
        />
      </FormField>
      <FormField label="Total cost (INR)" htmlFor="total_cost" required>
        <Input
          id="total_cost"
          name="total_cost"
          type="number"
          inputMode="decimal"
          min="0"
          step="0.01"
          value={total}
          onChange={(e) => setTotal(e.target.value)}
          className={TOUCH_INPUT}
          required
        />
      </FormField>
    </FormGrid>
  );
}
