import { z } from "zod";

export const ROLE_VALUES = ["ADMIN", "MEMBER"] as const;

/** Lowercased, trimmed email. Used everywhere an email is accepted. */
export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254, "Email is too long")
  .pipe(z.email("Enter a valid email address"));

export const personNameSchema = z
  .string()
  .trim()
  .min(1, "Enter a name")
  .max(80, "Name must be 80 characters or fewer")
  // Letters (any language), spaces, and common name punctuation only.
  .regex(/^[\p{L}\p{M} .'-]+$/u, "Name can only contain letters, spaces, apostrophes, periods, and hyphens");

export const inviteInputSchema = z.strictObject({
  email: emailSchema,
  name: personNameSchema,
  role: z.enum(ROLE_VALUES),
});

export const userIdSchema = z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/, "Invalid user id");
export const inviteIdSchema = z.uuid();

export const changeRoleInputSchema = z.strictObject({
  userId: userIdSchema,
  role: z.enum(ROLE_VALUES),
});
