import { ContentPage, contentPageMetadata } from "../content-page";

export const metadata = contentPageMetadata("privacy", "How The Leftovers handle your information.");

export default function PrivacyPage() {
  return <ContentPage slug="privacy" />;
}
