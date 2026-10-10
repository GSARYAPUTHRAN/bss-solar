import { Section } from "@/components/layout";

/**
 * CONTRACT STUB — owned by the payments slice, composed by the project detail
 * page. The props are frozen; the implementation fetches the ledger itself via
 * `paymentsRepository.listForWorkOrder(workOrderId)` and renders:
 *   - the contract summary (total, advance, ledger total, received, balance);
 *   - the ledger with stage numbers, dates, method, purpose, reference;
 *   - "Record payment" (viewer.canRecord), edit (viewer.canEdit) and delete
 *     (viewer.canDelete) controls.
 */
export interface ProjectPaymentsSectionProps {
  workOrderId: string;
  /** For revalidation and notification links. */
  projectId: string | null;
  totalCost: number | string | null;
  advanceAmount: number | string | null;
  isCompleted: boolean;
  viewer: {
    /** Office staff. */
    canRecord: boolean;
    canEdit: boolean;
    /** SuperAdmin only. */
    canDelete: boolean;
  };
}

export async function ProjectPaymentsSection(props: ProjectPaymentsSectionProps) {
  void props;
  return (
    <Section title="Payments">
      <p className="text-sm text-muted-foreground">Payments ledger — pending implementation.</p>
    </Section>
  );
}
