import Link from "next/link";
import { Plus } from "lucide-react";
import { requireAdmin } from "@/lib/auth";
import { profilesRepository } from "@/server/data";
import { parsePageParams } from "@/lib/pagination";
import { Page, PageHeader, FormError } from "@/components/layout";
import { TeamTable } from "@/components/team-table";
import { Button } from "@/components/ui/button";
import { isSuperAdminRole } from "@/lib/domain/role";

export const metadata = { title: "Team" };

export default async function TeamPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const me = await requireAdmin();
  const sp = await searchParams;
  const error = Array.isArray(sp.error) ? sp.error[0] : sp.error;

  const params = parsePageParams(sp, {
    filterKeys: ["role"],
    defaultSort: "full_name",
    defaultDir: "asc",
  });

  const pageResult = await profilesRepository.page(params);
  const isSuperAdmin = isSuperAdminRole(me.role);

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

      <FormError message={error} />

      <TeamTable
        profiles={pageResult.rows}
        meId={me.id}
        canDelete={isSuperAdmin}
        server={{
          total: pageResult.total,
          page: pageResult.page,
          pageSize: pageResult.pageSize,
        }}
      />
      <div className="space-y-1 text-xs text-muted-foreground">
        <p>You cannot change your own role to avoid accidental lock-out.</p>
        <p>
          There is exactly one <strong>Super Admin</strong> — the highest
          privilege, and the only role that can delete users, projects and work
          orders. That role is <strong>not editable here by anyone</strong>: it is
          set directly on the database, so it cannot be granted, revoked or
          reassigned from the app.
        </p>
      </div>
    </Page>
  );
}
