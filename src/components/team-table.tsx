"use client";

import { Trash2 } from "lucide-react";
import { DataTable, ServerDataTable } from "@/components/data-table";
import type { ColumnDef, FilterDef, SearchDef } from "@/components/data-table";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { RoleEditor } from "@/components/role-editor";
import { ConfirmSubmit } from "@/components/confirm-submit";
import { deleteTeamMember } from "@/app/(app)/team/actions";
import { ROLE_LABELS } from "@/lib/domain/role";
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

export function TeamTable({
  profiles,
  meId,
  canGrantSuperAdmin = false,
  canDelete = false,
  server,
}: {
  profiles: Profile[];
  meId: string;
  /** Offer the SuperAdmin seat in the role picker (server re-checks). */
  canGrantSuperAdmin?: boolean;
  /** Show the delete action — SuperAdmin only (server re-checks). */
  canDelete?: boolean;
  server?: { total: number; page: number; pageSize: number };
}) {
  const columns: ColumnDef<Profile>[] = [
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
            {p.id === meId && (
              <span className="ml-2 text-xs text-muted-foreground">(you)</span>
            )}
          </span>
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
        <RoleEditor
          userId={p.id}
          role={p.role}
          disabled={p.id === meId}
          canGrantSuperAdmin={canGrantSuperAdmin}
        />
      ),
    },
    {
      id: "actions",
      header: "",
      headerClassName: "w-10",
      hidden: !canDelete,
      cell: (p) =>
        p.id === meId ? null : (
          <ConfirmSubmit
            action={deleteTeamMember}
            fields={{ user_id: p.id }}
            triggerLabel={<Trash2 className="h-4 w-4" />}
            triggerAriaLabel={`Delete ${p.full_name}`}
            triggerVariant="ghost"
            triggerClassName="text-destructive hover:text-destructive"
            title={`Delete ${p.full_name}?`}
            description="This permanently removes the staff account and its sign-in. A member who still owns work orders or projects cannot be deleted — reassign or delete that business first. This cannot be undone."
            confirmLabel="Delete member"
            loadingText="Deleting…"
          />
        ),
    },
  ];

  const filters: FilterDef<Profile>[] = [
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

  const search: SearchDef<Profile> = {
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
