import Link from "next/link";
import { Plus } from "lucide-react";
import { requireAdmin } from "@/lib/auth";
import { profilesRepository } from "@/server/data";
import { parsePageParams } from "@/lib/pagination";
import { Page, PageHeader, FormError } from "@/components/layout";
import { TeamTable } from "@/components/team-table";
import { Button } from "@/components/ui/button";
import { isSuperAdminRole } from "@/lib/domain/role";
import type { TeamMember } from "@/lib/domain/team";

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

  const [pageResult, directory] = await Promise.all([
    profilesRepository.page(params),
    profilesRepository.accounts(),
  ]);
  const isSuperAdmin = isSuperAdminRole(me.role);

  // Login e-mails live in Auth, not on the profile: join them on for the Edit
  // dialog, which prefills them and tells accounts with no sign-in yet.
  const emails = new Map(directory.accounts.map((a) => [a.id, a.email]));
  const members: TeamMember[] = pageResult.rows.map((profile) => ({
    ...profile,
    email: emails.get(profile.id) ?? null,
  }));

  return (
    <Page>
      <PageHeader
        title="Team Management"
        description="Manage staff accounts and assign roles. Admins see all data; coordinators see only the sales they log or share; service engineers see only the tickets assigned to them."
      >
        <Button asChild>
          <Link href="/team/new">
            <Plus className="mr-2 h-4 w-4" /> Add Member
          </Link>
        </Button>
      </PageHeader>

      <FormError message={error} />
      <FormError
        message={
          directory.error
            ? "Members' sign-in e-mails could not be loaded, so editing them is unavailable right now. Reload to try again."
            : undefined
        }
      />

      <TeamTable
        profiles={members}
        viewer={{ id: me.id, role: me.role }}
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
          Use the pencil beside a name to correct a member&apos;s name, phone,
          e-mail or password — a member created with a placeholder e-mail has no
          sign-in until you set a real one. Admins can edit the name and phone of
          anyone except the Super Admin, and the e-mail and password of
          coordinators, service engineers and themselves; another admin&apos;s
          sign-in and the Super Admin&apos;s details are the Super Admin&apos;s
          alone to change.
        </p>
        <p>
          <strong>Service Engineers</strong> sign in on their phones to work the
          service tickets assigned to them — they can start work and mark a ticket
          completed, but never see work orders, projects or payments. A member who
          still holds open tickets must have them reassigned before their role
          changes or the account is deleted.
        </p>
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
