import { z } from "zod";
import { personNameSchema } from "../users/validation";
import { blockSourceSchema } from "./blocks";

export const instrumentSchema = z
  .string()
  .trim()
  .max(60, "Instrument must be 60 characters or fewer")
  .regex(/^[\p{L}\p{M}\p{N} ,.&/'()-]*$/u, "Instrument can only contain letters, numbers, and basic punctuation");

export const memberInputSchema = z.strictObject({
  name: personNameSchema,
  instrument: instrumentSchema,
  bio: blockSourceSchema,
  isVisible: z.boolean(),
});

export const memberUpdateSchema = memberInputSchema.extend({
  id: z.uuid(),
  version: z.coerce.number().int().min(1),
});

export type MemberInput = z.infer<typeof memberInputSchema>;
