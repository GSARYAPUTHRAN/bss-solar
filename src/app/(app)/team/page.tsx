import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { RoleEditor } from "@/components/role-editor";
import { formatDate } from "@/lib/format";
import type { Profile } from "@/lib/types";

function initials(name: string) {
  return name
    .split(" ")
    .map((n) => n[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export default async function TeamPage() {
  const me = await requireAdmin();
  const supabase = await createClient();

  const { data } = await supabase
    .from("profiles")
    .select("*")
    .order("created_at", { ascending: true });

  const profiles = (data as Profile[]) ?? [];

  return (
    <div>
      <PageHeader
        title="Team Management"
        description="Manage staff accounts and assign roles. Admins see all data; coordinators see only their own."
      />

      <Card className="p-4">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Member</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Joined</TableHead>
                <TableHead>Role</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {profiles.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={4}
                    className="h-24 text-center text-muted-foreground"
                  >
                    No team members yet.
                  </TableCell>
                </TableRow>
              ) : (
                profiles.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <Avatar className="h-8 w-8">
                          <AvatarFallback className="bg-amber-100 text-xs font-semibold text-amber-800">
                            {initials(p.full_name)}
                          </AvatarFallback>
                        </Avatar>
                        <span className="font-medium">
                          {p.full_name}
                          {p.id === me.id && (
                            <span className="ml-2 text-xs text-muted-foreground">
                              (you)
                            </span>
                          )}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>{p.phone ?? "—"}</TableCell>
                    <TableCell>{formatDate(p.created_at)}</TableCell>
                    <TableCell>
                      <RoleEditor
                        userId={p.id}
                        role={p.role}
                        disabled={p.id === me.id}
                      />
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          You cannot change your own role to avoid accidental lock-out.
        </p>
      </Card>
    </div>
  );
}
