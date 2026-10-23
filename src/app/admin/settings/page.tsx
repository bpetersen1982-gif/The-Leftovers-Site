import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth/session";
import { getSiteSettings } from "@/lib/content/service";
import { db } from "@/lib/db";
import { SettingsForm } from "./settings-form";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  await requirePermission("settings:edit");
  const settings = await getSiteSettings(db());
  const social = Object.fromEntries(settings.socialLinks.map((link) => [link.platform, link.url]));

  return (
    <div className="space-y-6">
      <h1 className="font-heading text-3xl font-bold tracking-wider uppercase">Site settings</h1>
      <SettingsForm
        initial={{
          bookingEmail: settings.bookingEmail,
          generalEmail: settings.generalEmail,
          copyrightEmail: settings.copyrightEmail,
          social,
          version: settings.version,
        }}
      />
    </div>
  );
}
