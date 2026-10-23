/** Result shape shared by admin server actions and their forms. */
export interface ActionState {
  readonly ok: boolean;
  readonly message: string | null;
  readonly fieldErrors?: Partial<Record<string, string>>;
}

export const INITIAL_ACTION_STATE: ActionState = { ok: false, message: null };
