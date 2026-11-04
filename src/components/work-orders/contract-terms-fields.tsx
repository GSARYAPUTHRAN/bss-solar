"use client";

import { useEffect, useRef, useState } from "react";
import { FormField, FormGrid } from "@/components/layout";
import { Input } from "@/components/ui/input";
import { ADVANCE_METHOD_NONE, ADVANCE_WITHOUT_AMOUNT_ERROR } from "@/lib/domain/advance";
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
 * An advance larger than the total, or details of an advance (how, when, which
 * reference) with no advance amount, is blocked in the browser with the server's
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
  const [detailsFilled, setDetailsFilled] = useState(false);
  const advanceRef = useRef<HTMLInputElement>(null);
  const overTotal =
    advance !== "" && total !== "" && Number(advance) > Number(total);
  // How, when or by what reference the advance was paid, with no advance to
  // describe: the server refuses it, so say so before the form is sent.
  const detailsWithoutAdvance = detailsFilled && (advance === "" || Number(advance) <= 0);

  // The advance's method, date and reference live in a sibling component
  // (AdvanceDetailsFields, rendered on the server): watch the form for them.
  useEffect(() => {
    const form = advanceRef.current?.form;
    if (!form) return;
    const read = () => {
      const data = new FormData(form);
      const method = data.get("advance_method");
      const filled = (name: string) => String(data.get(name) ?? "").trim() !== "";
      setDetailsFilled(
        (typeof method === "string" && method !== "" && method !== ADVANCE_METHOD_NONE) ||
          filled("advance_paid_on") ||
          filled("advance_reference"),
      );
    };
    read();
    form.addEventListener("input", read);
    form.addEventListener("change", read);
    return () => {
      form.removeEventListener("input", read);
      form.removeEventListener("change", read);
    };
  }, []);

  useEffect(() => {
    advanceRef.current?.setCustomValidity(
      overTotal
        ? ADVANCE_OVER_TOTAL_ERROR
        : detailsWithoutAdvance
          ? ADVANCE_WITHOUT_AMOUNT_ERROR
          : "",
    );
  }, [overTotal, detailsWithoutAdvance]);

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
          ) : detailsWithoutAdvance ? (
            <span className="text-destructive">{ADVANCE_WITHOUT_AMOUNT_ERROR}</span>
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
          aria-invalid={overTotal || detailsWithoutAdvance || undefined}
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
