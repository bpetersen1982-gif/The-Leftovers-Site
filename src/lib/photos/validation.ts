import { z } from "zod";
import { ACCEPTED_EXTENSIONS, ACCEPTED_TYPES, type ImageKind } from "./image";

/** Requirements MED-2: 25 MB per photo. */
export const MAX_PHOTO_BYTES = 25 * 1024 * 1024;
export const MAX_ALT_TEXT = 250;
export const MAX_CAPTION = 500;
export const MAX_CREDIT = 100;
export const MAX_REJECTION_REASON = 250;
/** Most photos one request can approve/reject/submit at once. */
export const MAX_BULK = 100;
const MAX_FILENAME = 120;

/** Removes path parts and control characters; the result is for display only. */
export function displayFilename(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? "";
  const cleaned = base.replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, "").trim();
  return cleaned.slice(0, MAX_FILENAME) || "photo";
}

function extensionKind(filename: string): ImageKind | undefined {
  const extension = /\.([A-Za-z0-9]{1,5})$/.exec(filename)?.[1];
  return extension ? ACCEPTED_EXTENSIONS[extension.toLowerCase()] : undefined;
}

export const uploadRequestSchema = z
  .strictObject({
    filename: z.string().min(1).max(500),
    contentType: z.string().refine((value) => value in ACCEPTED_TYPES, "Only JPEG, PNG, WebP, and HEIC photos can be uploaded."),
    size: z
      .number()
      .int()
      .min(1, "That file is empty.")
      .max(MAX_PHOTO_BYTES, "Photos can be up to 25 MB."),
  })
  .superRefine((value, context) => {
    const fromExtension = extensionKind(value.filename);
    if (!fromExtension) {
      context.addIssue({ code: "custom", path: ["filename"], message: "Only .jpg, .png, .webp, and .heic files can be uploaded." });
    } else if (fromExtension !== ACCEPTED_TYPES[value.contentType]) {
      context.addIssue({ code: "custom", path: ["filename"], message: "The file name doesn't match the file type." });
    }
  });

export type UploadRequest = z.infer<typeof uploadRequestSchema>;

const singleLine = (max: number, label: string) =>
  z
    .string()
    .transform((value) => value.replace(/\s+/g, " ").trim())
    .pipe(z.string().max(max, `${label} must be ${max} characters or fewer`));

export const photoRefSchema = z.strictObject({
  id: z.uuid(),
  version: z.coerce.number().int().min(1),
});
export type PhotoRef = z.infer<typeof photoRefSchema>;

export const photoDetailsSchema = photoRefSchema.extend({
  altText: singleLine(MAX_ALT_TEXT, "Alt text"),
  caption: singleLine(MAX_CAPTION, "Caption"),
  credit: singleLine(MAX_CREDIT, "Photo credit"),
});
export type PhotoDetailsInput = z.infer<typeof photoDetailsSchema>;

export const bulkRefsSchema = z.array(photoRefSchema).min(1, "Pick at least one photo.").max(MAX_BULK);

export const rejectionReasonSchema = singleLine(MAX_REJECTION_REASON, "Reason");
