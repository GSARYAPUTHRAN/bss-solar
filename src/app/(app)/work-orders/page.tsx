import Link from "next/link";
import { Plus } from "lucide-react";
import { requireProfile } from "@/lib/auth";
import { profilesRepository, workOrdersRepository } from "@/server/data";
import { parsePageParams } from "@/lib/pagination";
import { Page, PageHeader } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { WorkOrdersTable } from "@/components/work-orders-table";

export const metadata = { title: "Work Orders" };

export default async function WorkOrdersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const profile = await requireProfile();
  const isAdmin = profile.role === "admin";

  const params = parsePageParams(await searchParams, {
    filterKeys: ["status", "coordinator"],
    defaultSort: "order_date",
    defaultDir: "desc",
  });

  const [pageResult, coordinators] = await Promise.all([
    workOrdersRepository.page(params),
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
        workOrders={pageResult.rows}
        coordinators={coordinators}
        isAdmin={isAdmin}
        server={{
          total: pageResult.total,
          page: pageResult.page,
          pageSize: pageResult.pageSize,
        }}
      />
    </Page>
  );
}
