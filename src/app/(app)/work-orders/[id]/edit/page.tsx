import { notFound } from "next/navigation";
import { requireWorkOrderRole } from "@/lib/auth";
import { canEditContractTerms } from "@/lib/domain/payment";
import { workOrdersRepository } from "@/server/data";
import { updateWorkOrder } from "../../actions";
import { Page, PageHeader, Section } from "@/components/layout";
import { WorkOrderForm } from "@/components/work-order-form";

export const metadata = { title: "Edit Work Order" };

/**
 * Open to coordinators for their own orders (RLS returns nothing for anyone
 * else, so an unauthorised id 404s) as well as to the office. Once the office
 * has reviewed an order, a coordinator sees its total cost and advance
 * read-only.
 */
export default async function EditWorkOrderPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const profile = await requireWorkOrderRole();
  const { id } = await params;
  const { error } = await searchParams;

  const wo = await workOrdersRepository.byId(id);
  if (!wo) notFound();

  return (
    <Page size="narrow">
      <PageHeader
        title={`Edit — ${wo.client_name}`}
        description="Changes flow straight through to the linked project."
        backHref={`/work-orders/${wo.id}`}
      />

      <Section>
        <WorkOrderForm
          action={updateWorkOrder}
          workOrder={wo}
          contractTermsLocked={!canEditContractTerms(profile.role, wo.status)}
          error={error}
          cancelHref={`/work-orders/${wo.id}`}
          submitLabel="Save Changes"
          loadingText="Saving…"
        />
      </Section>
    </Page>
  );
}
