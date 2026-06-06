import Link from "next/link";
import { Plus } from "lucide-react";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getCoordinators } from "@/lib/queries";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { WorkOrdersTable } from "@/components/work-orders-table";
import type { WorkOrder } from "@/lib/types";

export default async function WorkOrdersPage() {
  const profile = await requireProfile();
  const supabase = await createClient();

  const { data } = await supabase
    .from("work_orders")
    .select(
      `*,
       coordinator:profiles!work_orders_coordinator_id_fkey(id, full_name),
       projects(id, current_stage, is_completed)`,
    )
    .order("order_date", { ascending: false });

  const workOrders: WorkOrder[] = (data ?? []).map((row) => {
    const record = row as unknown as WorkOrder & {
      projects?: WorkOrder["project"][] | null;
    };
    const projects = record.projects;
    return {
      ...record,
      project: projects && projects.length > 0 ? projects[0] : null,
    };
  });

  const coordinators =
    profile.role === "admin" ? await getCoordinators() : [];

  return (
    <div>
      <PageHeader
        title="Work Orders"
        description={
          profile.role === "admin"
            ? "All business logged across the team."
            : "Business you have logged."
        }
      >
        <Button asChild>
          <Link href="/work-orders/new">
            <Plus className="mr-2 h-4 w-4" /> New Work Order
          </Link>
        </Button>
      </PageHeader>

      <WorkOrdersTable
        workOrders={workOrders}
        coordinators={coordinators}
        isAdmin={profile.role === "admin"}
      />
    </div>
  );
}
