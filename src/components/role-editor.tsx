"use client";

import { useState, useTransition } from "react";
import { useLoading } from "@/lib/loading/loading-context";
import { Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { updateUserRole } from "@/app/(app)/team/actions";
import { ROLE_LABELS, isSuperAdminRole, roleOptions } from "@/lib/domain/role";
import type { UserRole } from "@/lib/types";

/**
 * A role shown, not offered — where the viewer may not change it
 * (`roleChangeAuthority`): their own, another admin's for an admin, and the
 * Super Admin's for everyone. `reason` says why, on hover.
 */
export function RoleBadge({ role, reason }: { role: UserRole; reason?: string }) {
  // The Super Admin seat is the top of the hierarchy and is immutable from the
  // app — nobody, including the Super Admin, can change it here.
  if (isSuperAdminRole(role)) {
    return (
      <Badge
        variant="outline"
        className="gap-1.5 border-amber-300 font-medium text-amber-800 dark:border-amber-500/40 dark:text-amber-300"
        title="Set directly on the database — not editable here"
      >
        <ShieldCheck className="h-3.5 w-3.5" />
        {ROLE_LABELS.superadmin}
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="font-medium" title={reason}>
      {ROLE_LABELS[role]}
    </Badge>
  );
}

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
  const { trackPromise } = useLoading();

  // Render the immutable seat as a locked badge rather than a control that
  // would only be rejected on submit.
  if (isSuperAdminRole(role)) return <RoleBadge role={role} />;

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
        {/* Wide enough for the longest label ("Service Engineer"). */}
        <SelectTrigger className="w-44">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {roleOptions().map((o) => (
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
