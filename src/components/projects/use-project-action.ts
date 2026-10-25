"use client";

import { startTransition, useActionState, type FormEvent } from "react";
import { unstable_rethrow } from "next/navigation";
import { toast } from "sonner";
import type { ProjectFormState } from "@/app/(app)/projects/actions";
import { SERVER_UNREACHABLE_MESSAGE } from "@/lib/constants";
import { fail } from "@/lib/result";

/**
 * Run one of the project actions that answer with a result (cancel/refund,
 * reinstate, a coordinator's incentive) from a form.
 *
 *   - success: the action's message is toasted, then `onSaved` runs (a dialog
 *     closes);
 *   - refusal: the message comes back as `error`, for the form to show next to
 *     what was typed;
 *   - a request that never completed (offline, dropped mobile data) is shown the
 *     same way instead of the error page; a redirect (session expired) still
 *     goes to the router.
 *
 * `onSubmit` dispatches from the event rather than the form's `action` prop:
 * React resets a form after every action-prop submission, which would wipe what
 * the person typed when the server refuses it.
 */
export function useProjectAction(
  action: (prev: ProjectFormState, formData: FormData) => Promise<ProjectFormState>,
  onSaved?: () => void,
) {
  const [state, dispatch, pending] = useActionState(
    async (prev: ProjectFormState, formData: FormData): Promise<ProjectFormState> => {
      let result: ProjectFormState;
      try {
        result = await action(prev, formData);
      } catch (error) {
        unstable_rethrow(error);
        return fail(SERVER_UNREACHABLE_MESSAGE);
      }
      if (result?.ok) {
        toast.success(result.data.message);
        onSaved?.();
      }
      return result;
    },
    null,
  );

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(() => dispatch(formData));
  }

  return { error: state && !state.ok ? state.error : undefined, pending, onSubmit };
}
