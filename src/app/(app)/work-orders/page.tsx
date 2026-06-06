import Link from "next/link";
import { Plus } from "lucide-react";
import { requireProfile } from "@/lib/auth";
import { profilesRepository, workOrdersRepository } from "@/server/data";
import { Page, PageHeader } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { WorkOrdersTable } from "@/components/work-orders-table";

export default async function WorkOrdersPage() {
  const profile = await requireProfile();
  const isAdmin = profile.role === "admin";

  const [workOrders, coordinators] = await Promise.all([
    workOrdersRepository.list(),
    isAdmin ? profilesRepository.coordinators() : Promise.resolve([]),
  ]);

  return (
    <Page>
      <PageHeader
        title="Work Orders"
        description={
          isAdmin
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
        isAdmin={isAdmin}
      />
    </Page>
  );
}
