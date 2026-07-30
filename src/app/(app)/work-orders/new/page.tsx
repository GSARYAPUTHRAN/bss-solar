import { createWorkOrder } from "../actions";
import { requireProfile } from "@/lib/auth";
import { profilesRepository } from "@/server/data";
import { Page, PageHeader, Section } from "@/components/layout";
import { WorkOrderForm } from "@/components/work-order-form";
import { isOfficeRole } from "@/lib/domain/role";

export const metadata = { title: "New Work Order" };

export default async function NewWorkOrderPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const profile = await requireProfile();
  const { error } = await searchParams;
  const isOffice = isOfficeRole(profile.role);
  const coordinators = isOffice ? await profilesRepository.coordinators() : [];

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
          coordinators={isOffice ? coordinators : undefined}
          selfCoordinator={
            isOffice
              ? { id: profile.id, full_name: `${profile.full_name} (me)` }
              : undefined
          }
          cancelHref="/work-orders"
          submitLabel="Create Work Order"
          loadingText="Creating…"
        />
      </Section>
    </Page>
  );
}
