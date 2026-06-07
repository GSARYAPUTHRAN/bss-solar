import Link from "next/link";
import { notFound } from "next/navigation";
import { CheckCircle2, XCircle, KanbanSquare } from "lucide-react";
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
import { Separator } from "@/components/ui/separator";
import { WorkOrderStatusBadge } from "@/components/status-badges";
import { formatCurrency, formatDate } from "@/lib/format";

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
  const isAdmin = profile.role === "admin";

  return (
    <Page size="narrow">
      <PageHeader
        title={wo.client_name}
        description="Work order details"
        backHref="/work-orders"
      />

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
            <Field
              label="Advance collected"
              value={formatCurrency(wo.advance_amount)}
            />
            <Field label="Total cost" value={formatCurrency(wo.total_cost)} />
            <Field
              label="Balance due"
              value={formatCurrency(
                Number(wo.total_cost) - Number(wo.advance_amount ?? 0),
              )}
            />
          </FieldGrid>

          {project && (
            <>
              <Separator />
              <div className="flex items-center justify-between rounded-md bg-emerald-50 px-4 py-3">
                <p className="text-sm text-emerald-800">
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
                <form action={deleteWorkOrder}>
                  <input type="hidden" name="id" value={wo.id} />
                  <SubmitButton variant="ghost" className="text-destructive" loadingText="Deleting…">
                    Delete
                  </SubmitButton>
                </form>
              </div>
            </>
          )}
      </Section>
    </Page>
  );
}
