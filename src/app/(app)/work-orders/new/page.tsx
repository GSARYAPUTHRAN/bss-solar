import Link from "next/link";
import { createWorkOrder } from "../actions";
import { requireProfile } from "@/lib/auth";
import { profilesRepository } from "@/server/data";
import {
  Page,
  PageHeader,
  Section,
  FormField,
  FormGrid,
  FormActions,
  FormError,
} from "@/components/layout";
import { Button } from "@/components/ui/button";
import { SubmitButton } from "@/components/submit-button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { CoordinatorSelect } from "@/components/coordinator-select";
import { COMMON_CAPACITIES } from "@/lib/constants";
import { todayISO } from "@/lib/format";

export const metadata = { title: "New Work Order" };

export default async function NewWorkOrderPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const profile = await requireProfile();
  const { error } = await searchParams;
  const coordinators =
    profile.role === "admin" ? await profilesRepository.coordinators() : [];
  const today = todayISO();

  return (
    <Page size="narrow">
      <PageHeader
        title="New Work Order"
        description="Log new business captured in the field."
        backHref="/work-orders"
      />

      <Section>
        <form action={createWorkOrder} className="space-y-5">
          <FormError message={error} />

          {profile.role === "admin" && (
            <FormField label="Coordinator" htmlFor="coordinator_id">
              <CoordinatorSelect
                id="coordinator_id"
                name="coordinator_id"
                coordinators={coordinators}
                defaultValue={profile.id}
                includeSelf={{ id: profile.id, full_name: `${profile.full_name} (me)` }}
              />
            </FormField>
          )}

          <FormGrid>
            <FormField label="Client name" htmlFor="client_name" required>
              <Input id="client_name" name="client_name" required />
            </FormField>
            <FormField label="Client phone" htmlFor="client_phone">
              <Input id="client_phone" name="client_phone" type="tel" />
            </FormField>
          </FormGrid>

          <FormField label="Address" htmlFor="address">
            <Textarea id="address" name="address" rows={2} />
          </FormField>

          <FormGrid>
            <FormField
              label="Solar plant capacity"
              htmlFor="plant_capacity"
              required
            >
              <Input
                id="plant_capacity"
                name="plant_capacity"
                list="capacities"
                placeholder="e.g. 3kW"
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
                defaultValue={today}
                required
              />
            </FormField>
          </FormGrid>

          <FormGrid>
            <FormField label="Advance collected (INR)" htmlFor="advance_amount">
              <Input
                id="advance_amount"
                name="advance_amount"
                type="number"
                min="0"
                step="0.01"
                defaultValue={0}
              />
            </FormField>
            <FormField label="Total cost (INR)" htmlFor="total_cost" required>
              <Input
                id="total_cost"
                name="total_cost"
                type="number"
                min="0"
                step="0.01"
                required
              />
            </FormField>
          </FormGrid>

          <FormActions>
            <Button variant="outline" asChild>
              <Link href="/work-orders">Cancel</Link>
            </Button>
            <SubmitButton loadingText="Creating…">Create Work Order</SubmitButton>
          </FormActions>
        </form>
      </Section>
    </Page>
  );
}
