import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowRight,
  CheckCircle2,
  KanbanSquare,
  Pencil,
  XCircle,
} from "lucide-react";
import { requireWorkOrderRole } from "@/lib/auth";
import { workOrdersRepository } from "@/server/data";
import { paymentsRepository } from "@/server/data/payments.repository";
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
import { FinancingBadge, WorkOrderStatusBadge } from "@/components/status-badges";
import { AddressLink, PhoneLink } from "@/components/tickets/contact-links";
import { ContractSummary } from "@/components/payments/contract-summary";
import { PaymentLedger } from "@/components/payments/payment-ledger";
import { PAYMENTS_ANCHOR } from "@/components/payments/project-payments-section";
import { KsebFeesEstimate } from "@/components/work-orders/kseb-fees-estimate";
import { formatDate } from "@/lib/format";
import { ledgerTotals } from "@/lib/domain/payment";
import { isOfficeRole, isSuperAdminRole } from "@/lib/domain/role";

export const metadata = { title: "Work Order" };

export default async function WorkOrderDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const profile = await requireWorkOrderRole();
  const { id } = await params;
  const { error } = await searchParams;

  // RLS returns nothing for someone else's order, so both reads 404 together.
  const [wo, payments] = await Promise.all([
    workOrdersRepository.byId(id),
    paymentsRepository.listForWorkOrder(id),
  ]);
  if (!wo) notFound();

  const project = wo.project;
  const isAdmin = isOfficeRole(profile.role);
  const isSuperAdmin = isSuperAdminRole(profile.role);
  // Coordinators may edit their own orders; RLS returns nothing for anyone else,
  // so reaching this page at all means the row is theirs.
  const canEdit = isAdmin || wo.coordinator_id === profile.id;
  const totals = ledgerTotals(payments);
  const paymentSource = {
    total_cost: wo.total_cost,
    advance_amount: wo.advance_amount,
    payments_total: totals.contract,
  };

  return (
    <Page size="narrow">
      <PageHeader
        title={wo.client_name}
        description="Work order details"
        backHref="/work-orders"
      >
        {canEdit && (
          <Button variant="outline" className="h-10 md:h-8" asChild>
            <Link href={`/work-orders/${wo.id}/edit`}>
              <Pencil className="mr-2 h-4 w-4" /> Edit
            </Link>
          </Button>
        )}
      </PageHeader>

      <FormError message={error} />

      <Section
        title="Order Information"
        actions={
          <div className="flex flex-wrap justify-end gap-1.5">
            <FinancingBadge financing={wo.financing_type} bank={wo.loan_bank_name} />
            <WorkOrderStatusBadge status={wo.status} />
          </div>
        }
        contentClassName="space-y-6"
      >
        <FieldGrid>
          <Field label="Client name" value={wo.client_name} />
          <Field label="Client phone" value={<PhoneLink phone={wo.client_phone} />} />
          <Field
            label="Address"
            value={<AddressLink address={wo.address} />}
            className="sm:col-span-2"
          />
          <Field label="Coordinator" value={wo.coordinator?.full_name} />
          <Field label="Plant capacity" value={wo.plant_capacity} />
          <Field label="Order date" value={formatDate(wo.order_date)} />
          <Field label="KSEB consumer number" value={wo.consumer_number} />
          <Field label="KSEB section" value={wo.kseb_section} />
          <Field
            label="Financing"
            value={
              wo.financing_type === "loan"
                ? `Bank loan · ${wo.loan_bank_name ?? "bank not yet recorded"}`
                : "Self-financed"
            }
          />
        </FieldGrid>

        {wo.notes && (
          <>
            <Separator />
            <Field label="Notes" value={wo.notes} />
          </>
        )}

        <Separator />

        <KsebFeesEstimate kw={wo.plant_capacity_kw} />

        <Separator />

        <div className="space-y-4">
          <h3 className="text-sm font-semibold">Payments</h3>
          <ContractSummary
            source={paymentSource}
            isCompleted={project?.is_completed}
            ksebFeesCollected={totals.ksebFees}
          />
          {payments.length > 0 ? (
            <PaymentLedger payments={payments} compact />
          ) : (
            <p className="text-sm text-muted-foreground">
              No instalments recorded after the advance yet.
            </p>
          )}
          {project && (
            <Link
              href={`/projects/${project.id}#${PAYMENTS_ANCHOR}`}
              className="inline-flex min-h-10 items-center gap-1 text-sm font-medium text-primary hover:underline"
            >
              {isAdmin ? "Record or correct payments on the project" : "Open the payments ledger"}
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          )}
        </div>

        {project && (
          <>
            <Separator />
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-emerald-50 px-4 py-3 dark:bg-emerald-500/10">
              <p className="text-sm text-emerald-800 dark:text-emerald-300">
                This work order is an active project.
              </p>
              <Button size="sm" variant="outline" className="h-10 md:h-7" asChild>
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
              {wo.status !== "approved" && (
                <form action={approveWorkOrder}>
                  <input type="hidden" name="id" value={wo.id} />
                  <SubmitButton className="h-10 md:h-8" loadingText="Approving…">
                    <CheckCircle2 className="mr-2 h-4 w-4" /> Approve & Create
                    Project
                  </SubmitButton>
                </form>
              )}
              {wo.status === "pending" && (
                <form action={rejectWorkOrder}>
                  <input type="hidden" name="id" value={wo.id} />
                  <SubmitButton
                    variant="outline"
                    className="h-10 md:h-8"
                    loadingText="Rejecting…"
                  >
                    <XCircle className="mr-2 h-4 w-4" /> Reject
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
                  triggerClassName="h-10 text-destructive hover:text-destructive md:h-8"
                  title="Delete this work order?"
                  description="This permanently removes the work order, its payments ledger and any linked project and milestones. This cannot be undone."
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
