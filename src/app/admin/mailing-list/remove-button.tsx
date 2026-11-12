"use client";

import { INITIAL_ACTION_STATE } from "../action-state";
import { FormMessage } from "../form-ui";
import { useActionForm } from "../use-action-form";
import { removeSubscriberAction } from "./actions";

export function RemoveSubscriberButton({ id, email }: { id: string; email: string }) {
  const [state, onSubmit, pending] = useActionForm(removeSubscriberAction, INITIAL_ACTION_STATE);
  return (
    <form
      onSubmit={(event) => {
        if (!window.confirm(`Remove ${email} from the mailing list? Their address is deleted.`)) {
          event.preventDefault();
          return;
        }
        onSubmit(event);
      }}
    >
      <input type="hidden" name="id" value={id} />
      <button type="submit" disabled={pending} className="text-sm underline">
        Remove<span className="sr-only"> {email}</span>
      </button>
      <FormMessage ok={state.ok} message={state.ok ? null : state.message} />
    </form>
  );
}
