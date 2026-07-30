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
import { COMMON_CAPACITIES } from "@/lib/constants";
import { todayISO } from "@/lib/format";
import type { Coordinator } from "@/server/data";
import type { WorkOrder } from "@/lib/types";

/** Value for a `type="number"` input — blank rather than a misleading 0. */
function amountValue(value: number | null | undefined): string {
  return value === null || value === undefined ? "" : String(value);
}

/**
 * The single work-order body used by both create and edit, so a field added here
 * shows up in both places. `workOrder` present = edit mode.
 *
 * The coordinator picker only renders on create: reassigning an existing order is
 * a separate admin transition (and a DB trigger rejects it from a coordinator).
 */
export function WorkOrderForm({
  action,
  workOrder,
  coordinators,
  selfCoordinator,
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
            required
          />
        </FormField>
        <FormField label="Client phone" htmlFor="client_phone">
          <Input
            id="client_phone"
            name="client_phone"
            type="tel"
            defaultValue={wo?.client_phone ?? ""}
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
          <Input
            id="plant_capacity"
            name="plant_capacity"
            list="capacities"
            placeholder="e.g. 3kW"
            defaultValue={wo?.plant_capacity}
            required
          />
          <datalist id="capacities">
            {COMMON_CAPACITIES.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </FormField>
        <FormField label="Order date" htmlFor="order_date" required>
          <Input
            id="order_date"
            name="order_date"
            type="date"
            defaultValue={wo?.order_date ?? todayISO()}
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
            defaultValue={wo?.consumer_number ?? ""}
          />
        </FormField>
        <FormField label="KSEB section" htmlFor="kseb_section">
          <Input
            id="kseb_section"
            name="kseb_section"
            placeholder="e.g. Vytilla"
            defaultValue={wo?.kseb_section ?? ""}
          />
        </FormField>
      </FormGrid>

      <FormField label="Loan bank name" htmlFor="loan_bank_name">
        <Input
          id="loan_bank_name"
          name="loan_bank_name"
          placeholder="Leave blank if self-financed"
          defaultValue={wo?.loan_bank_name ?? ""}
        />
      </FormField>

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

      <FormGrid>
        <FormField label="Advance collected (INR)" htmlFor="advance_amount">
          <Input
            id="advance_amount"
            name="advance_amount"
            type="number"
            min="0"
            step="0.01"
            defaultValue={wo ? amountValue(wo.advance_amount) : 0}
          />
        </FormField>
        <FormField label="Total cost (INR)" htmlFor="total_cost" required>
          <Input
            id="total_cost"
            name="total_cost"
            type="number"
            min="0"
            step="0.01"
            defaultValue={wo ? amountValue(wo.total_cost) : ""}
            required
          />
        </FormField>
      </FormGrid>

      <FormGrid>
        <FormField label="First payment amount (INR)" htmlFor="first_payment_amount">
          <Input
            id="first_payment_amount"
            name="first_payment_amount"
            type="number"
            min="0"
            step="0.01"
            defaultValue={amountValue(wo?.first_payment_amount)}
          />
        </FormField>
        <FormField label="First payment date" htmlFor="first_payment_date">
          <Input
            id="first_payment_date"
            name="first_payment_date"
            type="date"
            defaultValue={wo?.first_payment_date ?? ""}
          />
        </FormField>
      </FormGrid>

      <FormGrid>
        <FormField label="Second payment amount (INR)" htmlFor="second_payment_amount">
          <Input
            id="second_payment_amount"
            name="second_payment_amount"
            type="number"
            min="0"
            step="0.01"
            defaultValue={amountValue(wo?.second_payment_amount)}
          />
        </FormField>
        <FormField label="Second payment date" htmlFor="second_payment_date">
          <Input
            id="second_payment_date"
            name="second_payment_date"
            type="date"
            defaultValue={wo?.second_payment_date ?? ""}
          />
        </FormField>
      </FormGrid>

      <FormActions>
        <Button variant="outline" asChild>
          <Link href={cancelHref}>Cancel</Link>
        </Button>
        <SubmitButton loadingText={loadingText}>{submitLabel}</SubmitButton>
      </FormActions>
    </form>
  );
}
