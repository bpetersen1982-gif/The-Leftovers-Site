export type VideoErrorCode =
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "INVALID_STATE"
  | "TITLE_REQUIRED"
  | "POSTER_PAST_END"
  | "TOO_MANY_UPLOADS"
  | "VIDEO_DISABLED"
  | "STREAM_UNAVAILABLE"
  | "SHOW_NOT_FOUND";

const MESSAGES: Record<VideoErrorCode, string> = {
  FORBIDDEN: "You don't have permission to do that.",
  NOT_FOUND: "That video no longer exists.",
  CONFLICT: "Someone else changed this video while you were looking at it. Reload and try again.",
  INVALID_STATE: "This video can't do that right now. Reload to see its current status.",
  TITLE_REQUIRED: "Give the video a title first.",
  POSTER_PAST_END: "The poster time is past the end of the video.",
  TOO_MANY_UPLOADS: "Let the current uploads finish before adding more.",
  VIDEO_DISABLED: "Video isn't set up on this site yet.",
  STREAM_UNAVAILABLE: "Cloudflare Stream didn't respond. Nothing was changed; try again in a minute.",
  SHOW_NOT_FOUND: "That show no longer exists. Pick another.",
};

/** Expected, user-facing failures in video operations. */
export class VideoError extends Error {
  override readonly name = "VideoError";
  constructor(readonly code: VideoErrorCode) {
    super(MESSAGES[code]);
  }
}
