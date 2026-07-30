import Link from "next/link";
import { notFound } from "next/navigation";
import { CheckCircle2, XCircle, KanbanSquare, Pencil } from "lucide-react";
import { requireProfile } from "@/lib/auth";
import { workOrdersRepository } from "@/server/data";
import {
  approveWorkOrder,
  rejectWorkOrder,
  deleteWorkOrder,
} from "../actions";
import { Page, PageHeader, Section, Field, FieldGrid, FormError } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { SubmitButton } from "@/components/submit-button";
import { ConfirmSubmit } from "@/components/confirm-submit";
import { Separator } from "@/components/ui/separator";
import { PaymentBadge, WorkOrderStatusBadge } from "@/components/status-badges";
import { formatCurrency, formatDate } from "@/lib/format";
import { paymentSummary } from "@/lib/domain/payment";
import { isOfficeRole, isSuperAdminRole } from "@/lib/domain/role";

export default async function WorkOrderDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const profile = await requireProfile();
  const { id } = await params;
  const { error } = await searchParams;

  const wo = await workOrdersRepository.byId(id);
  if (!wo) notFound();

  const project = wo.project;
  const isAdmin = isOfficeRole(profile.role);
  const isSuperAdmin = isSuperAdminRole(profile.role);
  // Coordinators may edit their own orders; RLS returns nothing for anyone else,
  // so reaching this page at all means the row is theirs.
  const canEdit = isAdmin || wo.coordinator_id === profile.id;
  const payment = paymentSummary(wo);

  return (
    <Page size="narrow">
      <PageHeader
        title={wo.client_name}
        description="Work order details"
        backHref="/work-orders"
      >
        {canEdit && (
          <Button variant="outline" asChild>
            <Link href={`/work-orders/${wo.id}/edit`}>
              <Pencil className="mr-2 h-4 w-4" /> Edit
            </Link>
          </Button>
        )}
      </PageHeader>

      <FormError message={error} />

      <Section
        title="Order Information"
        actions={<WorkOrderStatusBadge status={wo.status} />}
        contentClassName="space-y-6"
      >
          <FieldGrid>
            <Field label="Client name" value={wo.client_name} />
            <Field label="Client phone" value={wo.client_phone} />
            <Field label="Address" value={wo.address} />
            <Field label="Coordinator" value={wo.coordinator?.full_name} />
            <Field label="Plant capacity" value={wo.plant_capacity} />
            <Field label="Order date" value={formatDate(wo.order_date)} />
            <Field label="KSEB consumer number" value={wo.consumer_number} />
            <Field label="KSEB section" value={wo.kseb_section} />
            <Field label="Loan bank" value={wo.loan_bank_name} />
          </FieldGrid>

          {wo.notes && (
            <>
              <Separator />
              <Field label="Notes" value={wo.notes} />
            </>
          )}

          <Separator />

          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">Payments</h3>
              <PaymentBadge source={wo} isCompleted={project?.is_completed} />
            </div>
            <FieldGrid cols={3}>
              <Field label="Total cost" value={formatCurrency(wo.total_cost)} />
              <Field
                label="Advance collected"
                value={formatCurrency(wo.advance_amount)}
              />
              <Field
                label="First payment"
                value={
                  wo.first_payment_amount === null
                    ? null
                    : `${formatCurrency(wo.first_payment_amount)} · ${formatDate(wo.first_payment_date)}`
                }
              />
              <Field
                label="Second payment"
                value={
                  wo.second_payment_amount === null
                    ? null
                    : `${formatCurrency(wo.second_payment_amount)} · ${formatDate(wo.second_payment_date)}`
                }
              />
              <Field
                label="Total received"
                value={formatCurrency(payment.received)}
              />
              <Field
                label="Balance due"
                value={formatCurrency(payment.balanceDue)}
              />
            </FieldGrid>
          </div>

          {project && (
            <>
              <Separator />
              <div className="flex items-center justify-between rounded-md bg-emerald-50 px-4 py-3 dark:bg-emerald-500/10">
                <p className="text-sm text-emerald-800 dark:text-emerald-300">
                  This work order is an active project.
                </p>
                <Button size="sm" variant="outline" asChild>
                  <Link href={`/projects/${project.id}`}>
                    <KanbanSquare className="mr-2 h-4 w-4" /> View Project
                  </Link>
                </Button>
              </div>
            </>
          )}

          {isAdmin && (
            <>
              <Separator />
              <div className="flex flex-wrap items-center gap-2">
                {wo.status === "pending" && (
                  <>
                    <form action={approveWorkOrder}>
                      <input type="hidden" name="id" value={wo.id} />
                      <SubmitButton loadingText="Approving…">
                        <CheckCircle2 className="mr-2 h-4 w-4" /> Approve & Create
                        Project
                      </SubmitButton>
                    </form>
                    <form action={rejectWorkOrder}>
                      <input type="hidden" name="id" value={wo.id} />
                      <SubmitButton variant="outline" loadingText="Rejecting…">
                        <XCircle className="mr-2 h-4 w-4" /> Reject
                      </SubmitButton>
                    </form>
                  </>
                )}
                {wo.status === "rejected" && (
                  <form action={approveWorkOrder}>
                    <input type="hidden" name="id" value={wo.id} />
                    <SubmitButton loadingText="Approving…">
                      <CheckCircle2 className="mr-2 h-4 w-4" /> Approve & Create
                      Project
                    </SubmitButton>
                  </form>
                )}
                <div className="flex-1" />
                {isSuperAdmin && (
                  <ConfirmSubmit
                    action={deleteWorkOrder}
                    fields={{ id: wo.id }}
                    triggerLabel="Delete"
                    triggerVariant="ghost"
                    triggerClassName="text-destructive hover:text-destructive"
                    title="Delete this work order?"
                    description="This permanently removes the work order and any linked project and milestones. This cannot be undone."
                    confirmLabel="Delete work order"
                    loadingText="Deleting…"
                  />
                )}
              </div>
            </>
          )}
      </Section>
    </Page>
  );
}
