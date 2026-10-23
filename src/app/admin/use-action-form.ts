"use client";

import { type FormEvent, startTransition, useActionState } from "react";

/**
 * Like useActionState, but submits via onSubmit instead of <form action>.
 *
 * Why: React resets uncontrolled fields after a <form action> submission completes, so
 * a validation error would wipe everything the Admin just typed. Dispatching manually
 * keeps their input on screen. The clicked submit button's name/value is included.
 */
export function useActionForm<State>(
  action: (state: Awaited<State>, formData: FormData) => State | Promise<State>,
  initialState: Awaited<State>,
): [state: Awaited<State>, onSubmit: (event: FormEvent<HTMLFormElement>) => void, pending: boolean] {
  const [state, dispatch, pending] = useActionState(action, initialState);
  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const formData = new FormData(event.currentTarget, submitter instanceof HTMLElement ? submitter : null);
    startTransition(() => dispatch(formData));
  };
  return [state, onSubmit, pending];
}
