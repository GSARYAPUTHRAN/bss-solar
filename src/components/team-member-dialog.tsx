"use client";

import { startTransition, useActionState, useId, useState, type FormEvent } from "react";
import { unstable_rethrow } from "next/navigation";
import { Loader2, Pencil } from "lucide-react";
import { toast } from "sonner";
import { updateTeamMember, type TeamEditState } from "@/app/(app)/team/actions";
import { FormError, FormField } from "@/components/layout";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { MIN_PASSWORD_LENGTH, SERVER_UNREACHABLE_MESSAGE } from "@/lib/constants";
import { ROLE_LABELS, isSuperAdminRole } from "@/lib/domain/role";
import {
  ADMIN_LOGIN_RESERVED,
  TEAM_NAME_LENGTH,
  TEAM_PASSWORD_MAX_LENGTH,
  TEAM_PHONE_MAX_LENGTH,
  canEditMember,
  hasPlaceholderEmail,
  teamEditAuthority,
  type TeamEditAuthority,
  type TeamMember,
} from "@/lib/domain/team";
import { fail } from "@/lib/result";
import type { UserRole } from "@/lib/types";

/**
 * Correct a team member's name, phone, e-mail or password from the Team list.
 *
 * Only the fields the viewer may change are rendered (`teamEditAuthority`); the
 * server decides again, so hiding is a courtesy and never the protection. A
 * viewer with nothing to change on this member (an admin looking at the Super
 * Admin) gets no control at all. The role is shown, not editable: it has its own
 * editor in the list.
 *
 * The form only mounts while the dialog is open, so every opening starts from the
 * member as the page last rendered them — after a save the list re-renders with
 * the new name in the same response.
 */
export function TeamMemberDialog({
  member,
  viewer,
}: {
  member: TeamMember;
  viewer: { id: string; role: UserRole };
}) {
  const [open, setOpen] = useState(false);
  const allowed = teamEditAuthority(viewer, member);
  if (!canEditMember(allowed)) return null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-10 shrink-0 md:size-8"
          aria-label={`Edit ${member.full_name}`}
        >
          <Pencil />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{`Edit ${member.full_name}`}</DialogTitle>
          <DialogDescription>
            Correct this member&apos;s details. Changes take effect straight away.
          </DialogDescription>
        </DialogHeader>
        <MemberForm member={member} allowed={allowed} onSaved={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}

function MemberForm({
  member,
  allowed,
  onSaved,
}: {
  member: TeamMember;
  allowed: TeamEditAuthority;
  onSaved: () => void;
}) {
  const uid = useId();
  const [state, dispatch, pending] = useActionState(
    async (prev: TeamEditState, formData: FormData): Promise<TeamEditState> => {
      let result: TeamEditState;
      try {
        result = await updateTeamMember(prev, formData);
      } catch (error) {
        // A redirect (session expired) still goes to the router. A request that
        // never completed is shown in the form instead of the error page, so
        // the dialog stays open with what was typed.
        unstable_rethrow(error);
        return fail(SERVER_UNREACHABLE_MESSAGE);
      }
      if (result?.ok) {
        toast.success(result.data.message);
        onSaved();
      }
      return result;
    },
    null,
  );
  const error = state && !state.ok ? state.error : undefined;

  // Dispatched from onSubmit rather than the `action` prop: React resets a form
  // after every action-prop submission, which would wipe what the user typed
  // when the server refuses it (a duplicate name, a weak password).
  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(() => dispatch(formData));
  }

  const login = allowed.email || allowed.password;

  return (
    <form onSubmit={onSubmit} className="space-y-4" aria-busy={pending}>
      <FormError message={error} />
      <input type="hidden" name="id" value={member.id} />

      {allowed.name && (
        <FormField label="Full name" htmlFor={`${uid}-name`} required>
          <Input
            id={`${uid}-name`}
            name="full_name"
            defaultValue={member.full_name}
            minLength={TEAM_NAME_LENGTH.min}
            maxLength={TEAM_NAME_LENGTH.max}
            autoComplete="off"
            className="h-10"
            required
          />
        </FormField>
      )}

      {allowed.phone && (
        <FormField label="Phone" htmlFor={`${uid}-phone`}>
          <Input
            id={`${uid}-phone`}
            name="phone"
            type="tel"
            inputMode="tel"
            defaultValue={member.phone ?? ""}
            maxLength={TEAM_PHONE_MAX_LENGTH}
            autoComplete="off"
            className="h-10"
          />
        </FormField>
      )}

      {allowed.email && (
        <FormField
          label="E-mail"
          htmlFor={`${uid}-email`}
          required={member.email !== null}
          hint={
            hasPlaceholderEmail(member.email)
              ? "This account has no sign-in yet — set the real e-mail and a password to let them in."
              : undefined
          }
        >
          <Input
            id={`${uid}-email`}
            name="email"
            type="email"
            defaultValue={member.email ?? ""}
            autoComplete="off"
            className="h-10"
            required={member.email !== null}
          />
        </FormField>
      )}

      {allowed.password && (
        <FormField
          label="New password"
          htmlFor={`${uid}-password`}
          hint={`Leave blank to keep the current password. At least ${MIN_PASSWORD_LENGTH} characters.`}
        >
          <Input
            id={`${uid}-password`}
            name="password"
            type="password"
            minLength={MIN_PASSWORD_LENGTH}
            maxLength={TEAM_PASSWORD_MAX_LENGTH}
            // Stops the browser filling in the signed-in admin's own saved password.
            autoComplete="new-password"
            className="h-10"
          />
        </FormField>
      )}

      {/* An admin looking at another admin: say why there is no sign-in to edit. */}
      {!login && <p className="text-xs text-muted-foreground">{ADMIN_LOGIN_RESERVED}</p>}

      <p className="text-xs text-muted-foreground">
        Role:{" "}
        <span className="font-medium text-foreground">{ROLE_LABELS[member.role]}</span>.{" "}
        {isSuperAdminRole(member.role)
          ? "The Super Admin seat is set on the database and cannot be changed here."
          : "Roles are changed from the Role column of the list, not here."}
      </p>

      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="outline" className="h-10 md:h-8">
            Cancel
          </Button>
        </DialogClose>
        <Button type="submit" className="h-10 md:h-8" disabled={pending}>
          {pending ? (
            <>
              <Loader2 className="animate-spin" data-icon="inline-start" />
              Saving…
            </>
          ) : (
            "Save changes"
          )}
        </Button>
      </DialogFooter>
    </form>
  );
}
