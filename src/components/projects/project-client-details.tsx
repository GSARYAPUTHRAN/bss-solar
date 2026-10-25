import { Field, FieldGrid, Section } from "@/components/layout";
import { Separator } from "@/components/ui/separator";
import { FINANCING_LABELS } from "@/lib/domain/payment";
import { formatDate } from "@/lib/format";
import type { ProjectWorkOrder } from "@/server/data/projects.repository";
import { MapsLink, PhoneLink } from "./contact-links";

/**
 * Client and KSEB reference details. They live on the work order — nothing is
 * copied onto the project — so editing the work order updates this view.
 */
export function ProjectClientDetails({
  workOrder,
}: {
  workOrder: ProjectWorkOrder | null;
}) {
  const wo = workOrder;
  const financing = wo?.financing_type ?? "self";

  return (
    <Section
      title="Client & KSEB Details"
      description="Held on the work order — edit it there and this updates with it."
      contentClassName="space-y-6"
    >
      <FieldGrid cols={3}>
        <Field label="Client phone" value={<PhoneLink phone={wo?.client_phone} />} />
        <Field label="KSEB consumer number" value={wo?.consumer_number} />
        <Field label="KSEB section" value={wo?.kseb_section} />
        <Field
          label="Financing"
          value={
            financing === "loan" && wo?.loan_bank_name
              ? `${FINANCING_LABELS.loan} · ${wo.loan_bank_name}`
              : FINANCING_LABELS[financing]
          }
        />
        <Field label="Order date" value={formatDate(wo?.order_date)} />
        <Field label="Address" value={<MapsLink address={wo?.address} />} />
      </FieldGrid>

      {wo?.notes && (
        <>
          <Separator />
          <Field label="Notes" value={wo.notes} />
        </>
      )}
    </Section>
  );
}
