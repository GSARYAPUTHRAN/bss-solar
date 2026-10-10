"use client";

import Link from "next/link";
import { UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ServiceEngineer } from "@/server/data/profiles.repository";

/**
 * Picks the service engineer who holds a ticket. Only engineers are offered —
 * the DB rejects anyone else. `current` keeps a legacy assignee who is no
 * longer an engineer selectable, so editing the sheet never silently drops
 * them; choosing someone else then requires an engineer.
 */
export function EngineerPicker({
  id = "assigned_to",
  name = "assigned_to",
  engineers,
  defaultValue,
  current,
  required,
}: {
  id?: string;
  name?: string;
  engineers: ServiceEngineer[];
  defaultValue?: string | null;
  current?: ServiceEngineer | null;
  required?: boolean;
}) {
  const options = engineers.map((e) => ({ value: e.id, label: e.full_name }));
  if (current && !engineers.some((e) => e.id === current.id)) {
    options.unshift({
      value: current.id,
      label: `${current.full_name} (not a service engineer)`,
    });
  }

  if (options.length === 0) {
    return (
      <div
        id={id}
        role="status"
        className="flex flex-col gap-3 rounded-md border border-dashed bg-muted/30 p-4 text-sm sm:flex-row sm:items-center sm:justify-between"
      >
        <p className="text-muted-foreground">
          No service engineers yet. Add one to the team to assign tickets.
        </p>
        <Button asChild variant="outline" className="h-10">
          <Link href="/team/new">
            <UserPlus className="mr-2 h-4 w-4" /> Add engineer
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <Select name={name} defaultValue={defaultValue ?? undefined} required={required}>
      <SelectTrigger id={id} className="h-10 w-full" aria-required={required}>
        <SelectValue placeholder="Select a service engineer" />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
