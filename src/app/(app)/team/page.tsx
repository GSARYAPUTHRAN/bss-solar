import Link from "next/link";
import { Plus } from "lucide-react";
import { requireAdmin } from "@/lib/auth";
import { profilesRepository } from "@/server/data";
import { Page, PageHeader } from "@/components/layout";
import { TeamTable } from "@/components/team-table";
import { Button } from "@/components/ui/button";

export default async function TeamPage() {
  const me = await requireAdmin();
  const profiles = await profilesRepository.list();

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
      <TeamTable profiles={profiles} meId={me.id} />
      <p className="text-xs text-muted-foreground">
        You cannot change your own role to avoid accidental lock-out.
      </p>
    </Page>
  );
}
