import Link from "next/link";
import { Plus } from "lucide-react";
import { requireAdmin } from "@/lib/auth";
import { profilesRepository } from "@/server/data";
import { parsePageParams } from "@/lib/pagination";
import { Page, PageHeader } from "@/components/layout";
import { TeamTable } from "@/components/team-table";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Team" };

export default async function TeamPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const me = await requireAdmin();
  const params = parsePageParams(await searchParams, {
    filterKeys: ["role"],
    defaultSort: "full_name",
    defaultDir: "asc",
  });
  const pageResult = await profilesRepository.page(params);

  return (
    <Page>
      <PageHeader
        title="Team Management"
        description="Manage staff accounts and assign roles. Admins see all data; coordinators see only their own."
      >
        <Button asChild>
          <Link href="/team/new">
            <Plus className="mr-2 h-4 w-4" /> Add Member
          </Link>
        </Button>
      </PageHeader>
      <TeamTable
        profiles={pageResult.rows}
        meId={me.id}
        server={{
          total: pageResult.total,
          page: pageResult.page,
          pageSize: pageResult.pageSize,
        }}
      />
      <p className="text-xs text-muted-foreground">
        You cannot change your own role to avoid accidental lock-out.
      </p>
    </Page>
  );
}
