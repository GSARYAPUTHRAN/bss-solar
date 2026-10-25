import Link from "next/link";
import { Plus } from "lucide-react";
import { requireWorkOrderRole } from "@/lib/auth";
import { profilesRepository, workOrdersRepository } from "@/server/data";
import { parsePageParams } from "@/lib/pagination";
import { Page, PageHeader } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { WorkOrdersTable } from "@/components/work-orders-table";
import { isOfficeRole } from "@/lib/domain/role";

export const metadata = { title: "Work Orders" };

export default async function WorkOrdersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const profile = await requireWorkOrderRole();
  const isAdmin = isOfficeRole(profile.role);

  const params = parsePageParams(await searchParams, {
    filterKeys: ["status", "coordinator", "payment", "financing", "plan"],
    defaultSort: "order_date",
    defaultDir: "desc",
  });

  const [pageResult, coordinators] = await Promise.all([
    workOrdersRepository.page(params),
    // The office filters by coordinator: anyone who can own or share a sale.
    isAdmin ? profilesRepository.coordinatorDirectory() : Promise.resolve([]),
  ]);

  return (
    <Page>
      <PageHeader
        title="Work Orders"
        description={
          isAdmin
            ? "All business logged across the team."
            : "Sales you logged or share."
        }
      >
        <Button asChild className="h-10 md:h-8">
          <Link href="/work-orders/new">
            <Plus className="mr-2 h-4 w-4" /> New Work Order
          </Link>
        </Button>
      </PageHeader>

      <WorkOrdersTable
        workOrders={pageResult.rows}
        coordinators={coordinators}
        isAdmin={isAdmin}
        viewerId={profile.id}
        server={{
          total: pageResult.total,
          page: pageResult.page,
          pageSize: pageResult.pageSize,
        }}
      />
    </Page>
  );
}
