import { z } from "zod";
import { displayFilename } from "../photos/validation";

export { displayFilename };

/** File types Cloudflare Stream accepts that phones and cameras actually produce. */
export const VIDEO_EXTENSIONS = ["mp4", "m4v", "mov", "mkv", "webm", "avi", "3gp", "mpg", "mpeg", "ts", "mts"] as const;
export const MAX_VIDEO_TITLE = 120;
export const MAX_VIDEO_DESCRIPTION = 2_000;
export const MAX_CAPTIONS_BYTES = 512 * 1024;

export function videoUploadSchema(maxBytes: number) {
  return z.strictObject({
    filename: z
      .string()
      .min(1)
      .max(500)
      .refine((name) => {
        const extension = /\.([A-Za-z0-9]{1,5})$/.exec(name)?.[1]?.toLowerCase();
        return extension !== undefined && (VIDEO_EXTENSIONS as readonly string[]).includes(extension);
      }, "Upload a video file (.mp4, .mov, .m4v, .mkv, .webm, ...)."),
    size: z
      .number()
      .int()
      .min(1, "That file is empty.")
      .max(maxBytes, `Videos can be up to ${Math.round(maxBytes / 1024 ** 3)} GB.`),
  });
}
export type VideoUploadInput = z.infer<ReturnType<typeof videoUploadSchema>>;

export const videoRefSchema = z.strictObject({ id: z.uuid(), version: z.coerce.number().int().min(1) });
export type VideoRef = z.infer<typeof videoRefSchema>;

export const videoDetailsSchema = videoRefSchema.extend({
  title: z
    .string()
    .transform((value) => value.replace(/\s+/g, " ").trim())
    .pipe(z.string().max(MAX_VIDEO_TITLE, `Title must be ${MAX_VIDEO_TITLE} characters or fewer`)),
  description: z
    .string()
    .transform((value) => value.replace(/\r\n?/g, "\n").trim())
    .pipe(z.string().max(MAX_VIDEO_DESCRIPTION, `Description must be ${MAX_VIDEO_DESCRIPTION} characters or fewer`)),
  posterSeconds: z.coerce.number().min(0, "Pick a time from 0 seconds up.").max(6 * 3600),
  /** Optional show this video is from; "" = none. */
  showId: z
    .union([z.literal(""), z.uuid()])
    .optional()
    .transform((value) => value || null),
});
export type VideoDetailsInput = z.input<typeof videoDetailsSchema>;

/** Checks an uploaded captions file is WebVTT text (MED-8). Returns the cleaned text. */
export function parseWebVtt(raw: string): string {
  const text = raw.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  if (Buffer.byteLength(text, "utf8") > MAX_CAPTIONS_BYTES) throw new z.ZodError([{ code: "custom", path: ["captions"], message: "Captions files can be up to 512 KB.", input: undefined }]);
  if (!/^WEBVTT(?:[ \t][^\n]*)?\n/.test(`${text}\n`) || text.includes("\u0000")) {
    throw new z.ZodError([{ code: "custom", path: ["captions"], message: "That isn't a WebVTT (.vtt) captions file.", input: undefined }]);
  }
  if (!/-->/.test(text)) {
    throw new z.ZodError([{ code: "custom", path: ["captions"], message: "That captions file has no timed lines in it.", input: undefined }]);
  }
  return text;
}
