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
import {
  CoordinatorsField,
  type DirectoryPerson,
} from "@/components/work-orders/coordinators-field";
import { ContractTermsFields } from "@/components/work-orders/contract-terms-fields";
import { FinancingFields } from "@/components/work-orders/financing-fields";
import { PlanFields } from "@/components/work-orders/plan-fields";
import { TOUCH_INPUT } from "@/components/work-orders/touch";
import { todayISO } from "@/lib/format";
import { isOfficeRole } from "@/lib/domain/role";
import type { UserRole, WorkOrder } from "@/lib/types";

const PARTNERS_HINT =
  "Sold together? Add your partners — they see and edit this work order and get its updates. The office sets each person's incentive.";
const OFFICE_TEAM_HINT =
  "Everyone listed sees this sale and gets its updates; the first is the coordinator who logged it.";

/**
 * The single work-order body used by both create and edit, so a field added here
 * shows up in both places. `workOrder` present = edit mode.
 *
 * Who shares the sale is chosen on create only (`team`): a coordinator logs it
 * for themself and may add partners; the office may log it for anyone. Changing
 * the team of an existing order is its own action on the order's page — a
 * separate rule set the database enforces too.
 *
 * The plan (solar plant or custom plan) is chosen here while the order has no
 * project; after that it is fixed and only shown.
 *
 * Only the booking advance is captured here — every later collection is an
 * entry in the payments ledger on the project. Rules the browser can check
 * mirror the server's (a solar capacity needs a unit, the advance cannot exceed
 * the total), so it blocks those submits instead of a round trip that comes
 * back without what was typed.
 */
export function WorkOrderForm({
  action,
  workOrder,
  team,
  contractTermsLocked = false,
  error,
  cancelHref,
  submitLabel,
  loadingText,
}: {
  action: (formData: FormData) => void | Promise<void>;
  workOrder?: WorkOrder;
  /** Create only: who the sale can be shared with, and who is logging it. */
  team?: {
    directory: readonly DirectoryPerson[];
    viewer: { id: string; full_name: string; role: UserRole };
  };
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

      {team && (
        <CoordinatorsField
          directory={team.directory}
          viewer={team.viewer}
          mode={isOfficeRole(team.viewer.role) ? "full" : "partners"}
          hint={isOfficeRole(team.viewer.role) ? OFFICE_TEAM_HINT : PARTNERS_HINT}
        />
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

      <PlanFields
        defaultPlan={wo?.plan_type}
        defaultLabel={wo?.plant_capacity}
        lockedPlan={wo?.project ? wo.plan_type : null}
      >
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
      </PlanFields>

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
