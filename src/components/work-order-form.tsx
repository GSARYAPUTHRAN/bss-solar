import Link from "next/link";
import {
  FormField,
  FormGrid,
  FormActions,
  FormError,
} from "@/components/layout";
import { Button } from "@/components/ui/button";
import { SubmitButton } from "@/components/submit-button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { CoordinatorSelect } from "@/components/coordinator-select";
import { CapacityField } from "@/components/work-orders/capacity-field";
import { ContractTermsFields } from "@/components/work-orders/contract-terms-fields";
import { FinancingFields } from "@/components/work-orders/financing-fields";
import { TOUCH_INPUT } from "@/components/work-orders/touch";
import { COMMON_CAPACITIES } from "@/lib/constants";
import { todayISO } from "@/lib/format";
import type { Coordinator } from "@/server/data";
import type { WorkOrder } from "@/lib/types";

/**
 * The single work-order body used by both create and edit, so a field added here
 * shows up in both places. `workOrder` present = edit mode.
 *
 * The coordinator picker only renders on create: reassigning an existing order is
 * a separate admin transition (and a DB trigger rejects it from a coordinator).
 *
 * Only the booking advance is captured here — every later collection is an
 * entry in the payments ledger on the project. Rules the browser can check
 * mirror the server's (capacity needs a number, the advance cannot exceed the
 * total), so it blocks those submits instead of a round trip that comes back
 * without what was typed.
 */
export function WorkOrderForm({
  action,
  workOrder,
  coordinators,
  selfCoordinator,
  contractTermsLocked = false,
  error,
  cancelHref,
  submitLabel,
  loadingText,
}: {
  action: (formData: FormData) => void | Promise<void>;
  workOrder?: WorkOrder;
  /** Provide to render the coordinator picker (admins creating on behalf). */
  coordinators?: Coordinator[];
  selfCoordinator?: Coordinator;
  /** Show the total cost and advance read-only (see `canEditContractTerms`). */
  contractTermsLocked?: boolean;
  error?: string;
  cancelHref: string;
  submitLabel: string;
  loadingText: string;
}) {
  const wo = workOrder;

  return (
    <form action={action} className="space-y-5">
      <FormError message={error} />
      {wo && <input type="hidden" name="id" value={wo.id} />}

      {coordinators && selfCoordinator && (
        <FormField label="Coordinator" htmlFor="coordinator_id">
          <CoordinatorSelect
            id="coordinator_id"
            name="coordinator_id"
            coordinators={coordinators}
            defaultValue={selfCoordinator.id}
            includeSelf={selfCoordinator}
          />
        </FormField>
      )}

      <FormGrid>
        <FormField label="Client name" htmlFor="client_name" required>
          <Input
            id="client_name"
            name="client_name"
            defaultValue={wo?.client_name}
            className={TOUCH_INPUT}
            required
          />
        </FormField>
        <FormField label="Client phone" htmlFor="client_phone">
          <Input
            id="client_phone"
            name="client_phone"
            type="tel"
            autoComplete="off"
            defaultValue={wo?.client_phone ?? ""}
            className={TOUCH_INPUT}
          />
        </FormField>
      </FormGrid>

      <FormField label="Address" htmlFor="address">
        <Textarea
          id="address"
          name="address"
          rows={2}
          defaultValue={wo?.address ?? ""}
        />
      </FormField>

      <FormGrid>
        <FormField label="Solar plant capacity" htmlFor="plant_capacity" required>
          <CapacityField
            id="plant_capacity"
            name="plant_capacity"
            defaultValue={wo?.plant_capacity}
            suggestions={COMMON_CAPACITIES}
          />
        </FormField>
        <FormField label="Order date" htmlFor="order_date" required>
          <Input
            id="order_date"
            name="order_date"
            type="date"
            defaultValue={wo?.order_date ?? todayISO()}
            className={TOUCH_INPUT}
            required
          />
        </FormField>
      </FormGrid>

      <Separator />

      <FormGrid>
        <FormField
          label="KSEB consumer number"
          htmlFor="consumer_number"
          hint="Searchable from the work-order list."
        >
          <Input
            id="consumer_number"
            name="consumer_number"
            inputMode="numeric"
            defaultValue={wo?.consumer_number ?? ""}
            className={TOUCH_INPUT}
          />
        </FormField>
        <FormField label="KSEB section" htmlFor="kseb_section">
          <Input
            id="kseb_section"
            name="kseb_section"
            placeholder="e.g. Vytilla"
            defaultValue={wo?.kseb_section ?? ""}
            className={TOUCH_INPUT}
          />
        </FormField>
      </FormGrid>

      <FinancingFields
        defaultFinancing={wo?.financing_type}
        defaultBank={wo?.loan_bank_name}
      />

      <FormField
        label="Notes"
        htmlFor="notes"
        hint="Site conditions, customer commitments, anything the office should know."
      >
        <Textarea
          id="notes"
          name="notes"
          rows={3}
          defaultValue={wo?.notes ?? ""}
        />
      </FormField>

      <Separator />

      <ContractTermsFields
        defaultAdvance={wo ? wo.advance_amount : 0}
        defaultTotal={wo?.total_cost}
        locked={contractTermsLocked}
      />

      <FormActions>
        <Button variant="outline" className={TOUCH_INPUT} asChild>
          <Link href={cancelHref}>Cancel</Link>
        </Button>
        <SubmitButton className={TOUCH_INPUT} loadingText={loadingText}>
          {submitLabel}
        </SubmitButton>
      </FormActions>
    </form>
  );
}
