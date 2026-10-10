"use client";

import { useState } from "react";
import { FormField, FormGrid } from "@/components/layout";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { isFinancingType } from "@/lib/domain/payment";
import { FINANCING, statusOptions } from "@/lib/domain/status";
import type { FinancingType } from "@/lib/types";
import { TOUCH_INPUT, TOUCH_SELECT } from "./touch";

const OPTIONS = statusOptions(FINANCING);

/**
 * How the customer funds the plant. The bank name only exists for a loan, so it
 * appears when "Bank loan" is chosen (the server also drops it for
 * self-financed orders, so a switch never leaves a stale bank behind).
 */
export function FinancingFields({
  defaultFinancing = "self",
  defaultBank,
}: {
  defaultFinancing?: FinancingType;
  defaultBank?: string | null;
}) {
  const [financing, setFinancing] = useState<FinancingType>(defaultFinancing);

  return (
    <FormGrid>
      <FormField label="Financing" htmlFor="financing_type" required>
        <Select
          name="financing_type"
          value={financing}
          onValueChange={(v) => {
            if (isFinancingType(v)) setFinancing(v);
          }}
        >
          <SelectTrigger id="financing_type" className={TOUCH_SELECT}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FormField>

      {financing === "loan" && (
        <FormField
          label="Loan bank name"
          htmlFor="loan_bank_name"
          hint="Optional — add it once the loan is sanctioned."
        >
          <Input
            id="loan_bank_name"
            name="loan_bank_name"
            placeholder="e.g. State Bank of India"
            defaultValue={defaultBank ?? ""}
            className={TOUCH_INPUT}
          />
        </FormField>
      )}
    </FormGrid>
  );
}
