import { createWorkOrder } from "../actions";
import { requireWorkOrderRole } from "@/lib/auth";
import { profilesRepository } from "@/server/data";
import { Page, PageHeader, Section } from "@/components/layout";
import { WorkOrderForm } from "@/components/work-order-form";

export const metadata = { title: "New Work Order" };

export default async function NewWorkOrderPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const profile = await requireWorkOrderRole();
  const { error } = await searchParams;
  // Everyone who can share a sale: a coordinator picks partners from it, the
  // office picks who the sale is logged for.
  const directory = await profilesRepository.coordinatorDirectory();

  return (
    <Page size="narrow">
      <PageHeader
        title="New Work Order"
        description="Log new business captured in the field."
        backHref="/work-orders"
      />

      <Section>
        <WorkOrderForm
          action={createWorkOrder}
          error={error}
          team={{
            directory,
            viewer: { id: profile.id, full_name: profile.full_name, role: profile.role },
          }}
          cancelHref="/work-orders"
          submitLabel="Create Work Order"
          loadingText="Creating…"
        />
      </Section>
    </Page>
  );
}
