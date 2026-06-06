"use client";

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { updateUserRole } from "@/app/(app)/team/actions";
import type { UserRole } from "@/lib/types";

export function RoleEditor({
  userId,
  role,
  disabled,
}: {
  userId: string;
  role: UserRole;
  disabled?: boolean;
}) {
  const [value, setValue] = useState<UserRole>(role);
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex items-center gap-2">
      <Select
        value={value}
        disabled={disabled || pending}
        onValueChange={(next) => {
          const prev = value;
          setValue(next as UserRole);
          startTransition(async () => {
            const res = await updateUserRole(userId, next as UserRole);
            if (res?.error) {
              setValue(prev);
              toast.error(res.error);
            } else {
              toast.success("Role updated");
            }
          });
        }}
      >
        <SelectTrigger className="w-40">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="admin">Admin</SelectItem>
          <SelectItem value="coordinator">Coordinator</SelectItem>
        </SelectContent>
      </Select>
      {pending && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
    </div>
  );
}
