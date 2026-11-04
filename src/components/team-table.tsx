"use client";

import { Trash2 } from "lucide-react";
import { DataTable, ServerDataTable } from "@/components/data-table";
import type { ColumnDef, FilterDef, SearchDef } from "@/components/data-table";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { RoleEditor } from "@/components/role-editor";
import { ConfirmSubmit } from "@/components/confirm-submit";
import { TeamMemberDialog } from "@/components/team-member-dialog";
import { deleteTeamMember } from "@/app/(app)/team/actions";
import { ROLE_LABELS } from "@/lib/domain/role";
import { hasPlaceholderEmail, type TeamMember } from "@/lib/domain/team";
import { formatDate } from "@/lib/format";
import type { UserRole } from "@/lib/types";

function initials(name: string) {
  return name
    .split(" ")
    .map((n) => n[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export function TeamTable({
  profiles,
  viewer,
  canDelete = false,
  server,
}: {
  profiles: TeamMember[];
  /** Who is looking: sets who they may edit (server re-checks) and marks their own row. */
  viewer: { id: string; role: UserRole };
  /** Show the delete action — SuperAdmin only (server re-checks). */
  canDelete?: boolean;
  server?: { total: number; page: number; pageSize: number };
}) {
  const columns: ColumnDef<TeamMember>[] = [
    {
      id: "member",
      header: "Member",
      sortable: true,
      sortKey: "full_name",
      sortAccessor: (p) => p.full_name.toLowerCase(),
      cell: (p) => (
        <div className="flex items-center gap-3">
          <Avatar className="h-8 w-8">
            <AvatarFallback className="bg-amber-100 text-xs font-semibold text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">
              {initials(p.full_name)}
            </AvatarFallback>
          </Avatar>
          <span className="font-medium">
            {p.full_name}
            {p.id === viewer.id && (
              <span className="ml-2 text-xs text-muted-foreground">(you)</span>
            )}
            {hasPlaceholderEmail(p.email) && (
              <span className="block text-xs font-normal text-muted-foreground">
                No sign-in yet
              </span>
            )}
          </span>
          {/* Beside the name, not at the row's end: on a phone the table scrolls
              sideways and this stays in view. */}
          <TeamMemberDialog member={p} viewer={viewer} />
        </div>
      ),
    },
    { id: "phone", header: "Phone", cell: (p) => p.phone ?? "—" },
    {
      id: "joined",
      header: "Joined",
      sortable: true,
      sortKey: "created_at",
      sortAccessor: (p) => p.created_at,
      cell: (p) => formatDate(p.created_at),
    },
    {
      id: "role",
      header: "Role",
      cell: (p) => (
        <RoleEditor userId={p.id} role={p.role} disabled={p.id === viewer.id} />
      ),
    },
    {
      id: "actions",
      header: "",
      headerClassName: "w-10",
      hidden: !canDelete,
      // Never offer to delete yourself, nor the Super Admin account.
      cell: (p) =>
        p.id === viewer.id || p.role === "superadmin" ? null : (
          <ConfirmSubmit
            action={deleteTeamMember}
            fields={{ user_id: p.id }}
            triggerLabel={<Trash2 className="h-4 w-4" />}
            triggerAriaLabel={`Delete ${p.full_name}`}
            triggerVariant="ghost"
            triggerClassName="text-destructive hover:text-destructive"
            title={`Delete ${p.full_name}?`}
            description="This permanently removes the staff account and its sign-in. A member who still owns or shares work orders or projects, or still holds open service tickets, cannot be deleted — take them off those sales (Change coordinators on each work order) or reassign the tickets first. This cannot be undone."
            confirmLabel="Delete member"
            loadingText="Deleting…"
          />
        ),
    },
  ];

  const filters: FilterDef<TeamMember>[] = [
    {
      id: "role",
      placeholder: "Role",
      options: [
        { value: "all", label: "All roles" },
        ...(Object.keys(ROLE_LABELS) as (keyof typeof ROLE_LABELS)[]).map(
          (role) => ({ value: role, label: ROLE_LABELS[role] }),
        ),
      ],
      predicate: (p, v) => p.role === v,
    },
  ];

  const search: SearchDef<TeamMember> = {
    placeholder: "Search name or phone…",
    columns: ["full_name", "phone"],
    predicate: (p, q) =>
      p.full_name.toLowerCase().includes(q) ||
      (p.phone ?? "").toLowerCase().includes(q),
  };

  if (server) {
    return (
      <ServerDataTable
        rows={profiles}
        total={server.total}
        page={server.page}
        pageSize={server.pageSize}
        columns={columns}
        filters={filters}
        search={search}
        noun="members"
        emptyMessage="No team members found."
        defaultSort={{ key: "full_name", asc: true }}
      />
    );
  }

  return (
    <DataTable
      data={profiles}
      columns={columns}
      filters={filters}
      search={search}
      noun="members"
      emptyMessage="No team members found."
    />
  );
}
