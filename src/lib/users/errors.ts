/**
 * Expected, user-facing failures in user/invite operations. Anything else thrown
 * from the service is unexpected and propagates to the error boundary and logs.
 */
export type UserServiceErrorCode =
  | "EMAIL_ALREADY_ACTIVE"
  | "INVITE_INVALID"
  | "INVITE_EXPIRED"
  | "INVITE_USED"
  | "INVITE_REVOKED"
  | "INVITE_NOT_PENDING"
  | "USER_NOT_FOUND"
  | "LAST_ADMIN"
  | "CANNOT_DEACTIVATE_SELF"
  | "ALREADY_IN_STATE";

const MESSAGES: Record<UserServiceErrorCode, string> = {
  EMAIL_ALREADY_ACTIVE: "Someone with that email already has an account.",
  INVITE_INVALID: "That invite link isn't valid. Ask an Admin to send a new one.",
  INVITE_EXPIRED: "That invite has expired. Ask an Admin to send a new one.",
  INVITE_USED: "That invite was already used. Log in instead.",
  INVITE_REVOKED: "That invite was cancelled. Ask an Admin to send a new one.",
  INVITE_NOT_PENDING: "That invite is no longer pending.",
  USER_NOT_FOUND: "That user doesn't exist.",
  LAST_ADMIN: "The site must always have at least one active Admin.",
  CANNOT_DEACTIVATE_SELF: "You can't remove your own account.",
  ALREADY_IN_STATE: "Nothing to change.",
};

export class UserServiceError extends Error {
  override readonly name = "UserServiceError";
  constructor(readonly code: UserServiceErrorCode) {
    super(MESSAGES[code]);
  }
}
