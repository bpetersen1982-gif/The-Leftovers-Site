import { z } from "zod";
import { emailSchema } from "../users/validation";

/** Social platforms the site knows how to label (requirements FAN-9). */
export const SOCIAL_PLATFORMS = {
  instagram: { label: "Instagram", hosts: ["instagram.com", "www.instagram.com"] },
  facebook: { label: "Facebook", hosts: ["facebook.com", "www.facebook.com", "m.facebook.com"] },
  tiktok: { label: "TikTok", hosts: ["tiktok.com", "www.tiktok.com"] },
  youtube: { label: "YouTube", hosts: ["youtube.com", "www.youtube.com", "m.youtube.com"] },
  spotify: { label: "Spotify", hosts: ["open.spotify.com"] },
  x: { label: "X", hosts: ["x.com", "twitter.com", "www.x.com", "www.twitter.com"] },
} as const;

export type SocialPlatform = keyof typeof SOCIAL_PLATFORMS;
export const SOCIAL_PLATFORM_KEYS = Object.keys(SOCIAL_PLATFORMS) as SocialPlatform[];

/**
 * A social link must be https and on the platform's own domain, so a link in the footer
 * can never point visitors somewhere unexpected (open-redirect style abuse, phishing).
 */
export function socialUrlSchema(platform: SocialPlatform) {
  return z
    .string()
    .trim()
    .max(300)
    .refine((value) => {
      try {
        const url = new URL(value);
        return url.protocol === "https:" && (SOCIAL_PLATFORMS[platform].hosts as readonly string[]).includes(url.hostname);
      } catch {
        return false;
      }
    }, `Must be an https link on ${SOCIAL_PLATFORMS[platform].hosts[0]}`);
}

export const socialLinkSchema = z
  .strictObject({ platform: z.enum(SOCIAL_PLATFORM_KEYS as [SocialPlatform, ...SocialPlatform[]]), url: z.string() })
  .superRefine((link, ctx) => {
    const result = socialUrlSchema(link.platform).safeParse(link.url);
    if (!result.success) ctx.addIssue({ code: "custom", path: ["url"], message: result.error.issues[0]?.message ?? "Invalid link" });
  });

export type SocialLink = z.infer<typeof socialLinkSchema>;

export const siteSettingsInputSchema = z.strictObject({
  bookingEmail: emailSchema,
  generalEmail: emailSchema,
  copyrightEmail: emailSchema,
  socialLinks: z.array(socialLinkSchema).max(SOCIAL_PLATFORM_KEYS.length),
  version: z.coerce.number().int().min(1),
});

export type SiteSettingsInput = z.infer<typeof siteSettingsInputSchema>;

export interface SiteSettings {
  readonly bookingEmail: string;
  readonly generalEmail: string;
  readonly copyrightEmail: string;
  readonly socialLinks: readonly SocialLink[];
  readonly version: number;
}

export const DEFAULT_SETTINGS: SiteSettings = {
  bookingEmail: "booking@theleftoversband.com",
  generalEmail: "hello@theleftoversband.com",
  copyrightEmail: "copyright@theleftoversband.com",
  socialLinks: [],
  version: 1,
};

/** Reads stored social links defensively; invalid entries are dropped, not rendered. */
export function readSocialLinks(value: unknown): SocialLink[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const parsed = socialLinkSchema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });
}
