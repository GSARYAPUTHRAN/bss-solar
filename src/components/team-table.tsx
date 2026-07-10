"use client";

import { DataTable, ServerDataTable } from "@/components/data-table";
import type { ColumnDef, FilterDef, SearchDef } from "@/components/data-table";
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

export function TeamTable({
  profiles,
  meId,
  server,
}: {
  profiles: Profile[];
  meId: string;
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
        <RoleEditor userId={p.id} role={p.role} disabled={p.id === meId} />
      ),
    },
  ];

  const filters: FilterDef<Profile>[] = [
    {
      id: "role",
      placeholder: "Role",
      options: [
        { value: "all", label: "All roles" },
        { value: "admin", label: "Admin" },
        { value: "coordinator", label: "Coordinator" },
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
