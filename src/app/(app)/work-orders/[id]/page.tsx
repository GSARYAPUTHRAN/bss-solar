import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CheckCircle2, XCircle, KanbanSquare } from "lucide-react";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  approveWorkOrder,
  rejectWorkOrder,
  deleteWorkOrder,
} from "../actions";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { WorkOrderStatusBadge } from "@/components/status-badges";
import { formatCurrency, formatDate } from "@/lib/format";
import type { WorkOrder } from "@/lib/types";

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-0.5 text-sm font-medium">{value ?? "—"}</p>
    </div>
  );
}

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
  const supabase = await createClient();

  const { data } = await supabase
    .from("work_orders")
    .select(
      `*,
       coordinator:profiles!work_orders_coordinator_id_fkey(id, full_name),
       projects(id, current_stage, is_completed)`,
    )
    .eq("id", id)
    .maybeSingle();

  if (!data) notFound();

  const projects = (data as Record<string, unknown>).projects as
    | { id: string }[]
    | null;
  const project = projects && projects.length > 0 ? projects[0] : null;
  const wo = data as WorkOrder;
  const isAdmin = profile.role === "admin";

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title={wo.client_name} description="Work order details">
        <Button variant="outline" asChild>
          <Link href="/work-orders">
            <ArrowLeft className="mr-2 h-4 w-4" /> Back
          </Link>
        </Button>
      </PageHeader>

      {error && (
        <p className="mb-4 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Order Information</CardTitle>
          <WorkOrderStatusBadge status={wo.status} />
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-5 sm:grid-cols-2">
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
          </div>

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
                      <Button type="submit">
                        <CheckCircle2 className="mr-2 h-4 w-4" /> Approve & Create
                        Project
                      </Button>
                    </form>
                    <form action={rejectWorkOrder}>
                      <input type="hidden" name="id" value={wo.id} />
                      <Button type="submit" variant="outline">
                        <XCircle className="mr-2 h-4 w-4" /> Reject
                      </Button>
                    </form>
                  </>
                )}
                {wo.status === "rejected" && (
                  <form action={approveWorkOrder}>
                    <input type="hidden" name="id" value={wo.id} />
                    <Button type="submit">
                      <CheckCircle2 className="mr-2 h-4 w-4" /> Approve & Create
                      Project
                    </Button>
                  </form>
                )}
                <div className="flex-1" />
                <form action={deleteWorkOrder}>
                  <input type="hidden" name="id" value={wo.id} />
                  <Button type="submit" variant="ghost" className="text-destructive">
                    Delete
                  </Button>
                </form>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
