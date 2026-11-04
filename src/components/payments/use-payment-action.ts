"use client";

import { startTransition, useActionState, type FormEvent } from "react";
import { unstable_rethrow } from "next/navigation";
import { toast } from "sonner";
import type { PaymentFormState } from "@/app/(app)/payments/actions";
import { SERVER_UNREACHABLE_MESSAGE } from "@/lib/constants";
import { fail } from "@/lib/result";

/**
 * Runs a ledger server action from a dialog form: pending state, the server's
 * refusal as an inline error (the dialog stays open and keeps what was typed),
 * a toast and `onSaved` on success.
 *
 * Dispatched from `onSubmit` rather than the form's `action` prop: React resets
 * a form after every action-prop submission, which would wipe what the user
 * typed when the server refuses it (an amount above the balance, a refund above
 * what was collected).
 */
export function usePaymentAction(
  run: (prev: PaymentFormState, formData: FormData) => Promise<PaymentFormState>,
  onSaved: () => void,
) {
  const [state, dispatch, pending] = useActionState(
    async (prev: PaymentFormState, formData: FormData): Promise<PaymentFormState> => {
      let result: PaymentFormState;
      try {
        result = await run(prev, formData);
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

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(() => dispatch(formData));
  }

  return { error: state && !state.ok ? state.error : undefined, pending, onSubmit };
}
