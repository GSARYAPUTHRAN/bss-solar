import { FormField, FormGrid } from "@/components/layout";
import { FormSelect } from "@/components/form-select";
import { Input } from "@/components/ui/input";
import { ADVANCE_METHOD_NONE } from "@/lib/domain/advance";
import { PAYMENT_METHOD_LABELS } from "@/lib/domain/payment";
import { PAYMENT_LIMITS } from "@/lib/domain/payment-limits";
import { formatDate } from "@/lib/format";
import type { PaymentMethod } from "@/lib/types";
import { TOUCH_INPUT, TOUCH_SELECT } from "./touch";

const LOCKED_HINT = "Set by the office after approval.";
const LOCKED_INPUT = `${TOUCH_INPUT} bg-muted/50`;

const METHOD_OPTIONS = [
  { value: ADVANCE_METHOD_NONE, label: "Not recorded" },
  ...Object.entries(PAYMENT_METHOD_LABELS).map(([value, label]) => ({ value, label })),
];

/**
 * How and when the booking advance was paid: method, date and reference. All
 * three are optional — they describe the advance, they are not the advance (the
 * amount is in the contract terms) — and a date can only be one that has
 * happened.
 *
 * They follow the advance's lock: a coordinator edits them while the order is
 * pending, the office always. When `locked` they are shown read-only and left
 * out of the submission; the server keeps what is stored.
 */
export function AdvanceDetailsFields({
  defaultMethod,
  defaultPaidOn,
  defaultReference,
  today,
  locked = false,
}: {
  defaultMethod?: PaymentMethod | null;
  defaultPaidOn?: string | null;
  defaultReference?: string | null;
  /** IST date from the server — the latest date the advance can have been received. */
  today: string;
  locked?: boolean;
}) {
  if (locked) {
    return (
      <div className="space-y-2">
        <FormGrid className="sm:grid-cols-3">
          <FormField label="Advance method" htmlFor="advance_method">
            <Input
              id="advance_method"
              value={defaultMethod ? PAYMENT_METHOD_LABELS[defaultMethod] : "—"}
              readOnly
              className={LOCKED_INPUT}
            />
          </FormField>
          <FormField label="Advance received on" htmlFor="advance_paid_on">
            <Input
              id="advance_paid_on"
              value={defaultPaidOn ? formatDate(defaultPaidOn) : "—"}
              readOnly
              className={LOCKED_INPUT}
            />
          </FormField>
          <FormField label="Advance reference" htmlFor="advance_reference">
            <Input
              id="advance_reference"
              value={defaultReference ?? "—"}
              readOnly
              className={LOCKED_INPUT}
            />
          </FormField>
        </FormGrid>
        <p className="text-xs text-muted-foreground">{LOCKED_HINT}</p>
      </div>
    );
  }

  return (
    <FormGrid className="sm:grid-cols-3">
      <FormField
        label="Advance method"
        htmlFor="advance_method"
        hint="Optional — how the advance was paid."
      >
        <FormSelect
          id="advance_method"
          name="advance_method"
          options={METHOD_OPTIONS}
          defaultValue={defaultMethod ?? ADVANCE_METHOD_NONE}
          className={TOUCH_SELECT}
        />
      </FormField>
      <FormField
        label="Advance received on"
        htmlFor="advance_paid_on"
        hint="Optional — when it came in."
      >
        <Input
          id="advance_paid_on"
          name="advance_paid_on"
          type="date"
          max={today}
          defaultValue={defaultPaidOn ?? ""}
          className={TOUCH_INPUT}
        />
      </FormField>
      <FormField
        label="Advance reference"
        htmlFor="advance_reference"
        hint="Optional — UTR, cheque or UPI reference."
      >
        <Input
          id="advance_reference"
          name="advance_reference"
          maxLength={PAYMENT_LIMITS.advanceReferenceLength}
          defaultValue={defaultReference ?? ""}
          className={TOUCH_INPUT}
        />
      </FormField>
    </FormGrid>
  );
}
