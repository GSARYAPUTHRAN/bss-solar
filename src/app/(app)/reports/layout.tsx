import { requireAdmin } from "@/lib/auth";
import { Page, PageHeader } from "@/components/layout";
import { ReportsNav } from "@/components/reports/reports-nav";

/**
 * Shell shared by every Reports page: the heading and the tabs between them.
 * Office only. Each page also calls requireAdmin() itself, because a layout is
 * not re-rendered on client navigation and must not be the only gate.
 */
export default async function ReportsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireAdmin();

  return (
    <Page>
      <PageHeader
        title="Reports"
        description="Monthly figures for the management team, and service work by engineer."
      />
      <ReportsNav />
      {children}
    </Page>
  );
}
