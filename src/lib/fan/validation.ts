import { z } from "zod";
import { ACCEPTED_EXTENSIONS, ACCEPTED_TYPES } from "../photos/image";

/** Requirements FAN-1, FAN-2, FAN-4. */
export const MAX_FAN_MESSAGE = 1_000;
export const MAX_FAN_NAME = 40;
export const MAX_FAN_PHOTO_BYTES = 10 * 1024 * 1024;
export const MAX_FAN_ALT = 250;
export const MAX_DECISION_REASON = 250;

/**
 * Anything that looks like a link (FAN-4: links disallowed). Deliberately broad: a missed
 * spam link is worse than asking a fan to drop a ".com".
 */
const LINK_PATTERN = /(https?:\/\/|www\.|\b[a-z0-9-]{2,}\.(com|net|org|io|co|xyz|ru|info|biz|me|us|ly|gg|link|click|top|site|online|shop|app)\b|\[url|<a\s)/i;

export function containsLink(value: string): boolean {
  return LINK_PATTERN.test(value);
}

const noLinks = (label: string) => (value: string) => !containsLink(value) || `${label} can't include links or web addresses.`;

const displayName = z
  .string()
  .transform((value) => value.replace(/\s+/g, " ").trim())
  .pipe(z.string().min(1, "Add a name (a first name or nickname is fine).").max(MAX_FAN_NAME, `Names can be up to ${MAX_FAN_NAME} characters.`))
  .superRefine((value, context) => {
    const result = noLinks("Your name")(value);
    if (result !== true) context.addIssue({ code: "custom", message: result });
  });

const message = z
  .string()
  .transform((value) => value.replace(/\r\n?/g, "\n").replace(/\n{3,}/g, "\n\n").trim())
  .pipe(z.string().min(1, "Write a message.").max(MAX_FAN_MESSAGE, `Messages can be up to ${MAX_FAN_MESSAGE} characters.`))
  .superRefine((value, context) => {
    const result = noLinks("Messages")(value);
    if (result !== true) context.addIssue({ code: "custom", message: result });
  });

const photoSchema = z
  .strictObject({
    filename: z.string().min(1).max(500),
    contentType: z.string().refine((value) => value in ACCEPTED_TYPES, "Photos can be JPEG, PNG, WebP, or HEIC."),
    size: z.number().int().min(1, "That photo is empty.").max(MAX_FAN_PHOTO_BYTES, "Photos can be up to 10 MB."),
    altText: z
      .string()
      .transform((value) => value.replace(/\s+/g, " ").trim())
      .pipe(z.string().max(MAX_FAN_ALT, `Keep the description under ${MAX_FAN_ALT} characters.`)),
    consent: z.literal(true, "Confirm you took the photo and we can show it."),
  })
  .superRefine((value, context) => {
    const extension = /\.([A-Za-z0-9]{1,5})$/.exec(value.filename)?.[1]?.toLowerCase();
    const kind = extension ? ACCEPTED_EXTENSIONS[extension] : undefined;
    if (!kind || kind !== ACCEPTED_TYPES[value.contentType]) {
      context.addIssue({ code: "custom", path: ["filename"], message: "Photos can be .jpg, .png, .webp, or .heic." });
    }
  });

export const fanPostSchema = z.strictObject({
  displayName,
  message,
  email: z
    .string()
    .trim()
    .toLowerCase()
    .transform((value) => value || null)
    .pipe(z.email("That email doesn't look right.").max(254).nullable()),
  showId: z
    .union([z.literal(""), z.uuid()])
    .transform((value) => value || null),
  photo: photoSchema.nullable(),
});
export type FanPostInput = z.input<typeof fanPostSchema>;

export const fanPostRefSchema = z.strictObject({ id: z.uuid(), version: z.coerce.number().int().min(1) });
export type FanPostRef = z.infer<typeof fanPostRefSchema>;

export const decisionReasonSchema = z
  .string()
  .transform((value) => value.replace(/\s+/g, " ").trim())
  .pipe(z.string().max(MAX_DECISION_REASON, `Keep the reason under ${MAX_DECISION_REASON} characters.`));
