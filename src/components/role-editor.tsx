"use client";

import { useState, useTransition } from "react";
import { useLoading } from "@/lib/loading/loading-context";
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
import { roleOptions } from "@/lib/domain/role";
import type { UserRole } from "@/lib/types";

export function RoleEditor({
  userId,
  role,
  disabled,
  /**
   * Whether to offer the SuperAdmin seat. Decided on the server (only the sitting
   * SuperAdmin, or any admin while the seat is vacant) and re-checked there —
   * this just keeps an unusable option out of the menu.
   */
  canGrantSuperAdmin = false,
}: {
  userId: string;
  role: UserRole;
  disabled?: boolean;
  canGrantSuperAdmin?: boolean;
}) {
  const [value, setValue] = useState<UserRole>(role);
  const [pending, startTransition] = useTransition();
  const { trackPromise } = useLoading();

  // Always keep the current value selectable, even when the viewer could not
  // assign it, so the trigger never renders blank.
  const options = roleOptions(canGrantSuperAdmin || role === "superadmin");

  return (
    <div className="flex items-center gap-2">
      <Select
        value={value}
        disabled={disabled || pending}
        onValueChange={(next) => {
          const prev = value;
          setValue(next as UserRole);
          startTransition(() => {
            void trackPromise(
              updateUserRole(userId, next as UserRole).then((res) => {
                if (!res.ok) {
                  setValue(prev);
                  toast.error(res.error);
                } else {
                  toast.success("Role updated");
                }
                return res;
              }),
            );
          });
        }}
      >
        <SelectTrigger className="w-40">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {pending && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
    </div>
  );
}
