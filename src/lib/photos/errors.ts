/**
 * Expected, user-facing failures in photo operations. Anything else thrown from the
 * photo services is unexpected and propagates to the error boundary and logs.
 */
export type PhotoErrorCode =
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "INVALID_STATE"
  | "ALT_TEXT_REQUIRED"
  | "TOO_MANY_UPLOADS"
  | "UPLOAD_MISSING"
  | "STORAGE_DISABLED";

const MESSAGES: Record<PhotoErrorCode, string> = {
  FORBIDDEN: "You don't have permission to do that.",
  NOT_FOUND: "That photo no longer exists.",
  CONFLICT: "Someone else changed this photo while you were looking at it. Reload and try again.",
  INVALID_STATE: "This photo can't do that right now. Reload to see its current status.",
  ALT_TEXT_REQUIRED: "Add a short description (alt text) first. It's what screen readers read aloud.",
  TOO_MANY_UPLOADS: "That's a lot of uploads at once. Wait for these to finish, then add more.",
  UPLOAD_MISSING: "The file didn't finish uploading. Try that photo again.",
  STORAGE_DISABLED: "Photo uploads aren't set up on this site yet.",
};

export class PhotoError extends Error {
  override readonly name = "PhotoError";
  constructor(
    readonly code: PhotoErrorCode,
    message: string = MESSAGES[code],
  ) {
    super(message);
  }
}
