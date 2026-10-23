import { getSiteSettings } from "@/lib/content/service";
import { db } from "@/lib/db";
import { ContentPage, contentPageMetadata } from "../content-page";

export const metadata = contentPageMetadata("copyright", "How to send The Leftovers a copyright notice.");

/** Requirements LEG-1: notices by email only. There is deliberately no form or button. */
export default async function CopyrightPage() {
  const settings = await getSiteSettings(db());
  return (
    <ContentPage slug="copyright">
      <section aria-labelledby="send-notice" className="panel-paper mt-8 px-5 py-5">
        <h2 id="send-notice" className="font-heading text-xl font-bold uppercase">
          Send notices to
        </h2>
        <p className="mt-2">
          <a href={`mailto:${settings.copyrightEmail}`} className="font-semibold break-all underline">
            {settings.copyrightEmail}
          </a>
        </p>
      </section>
    </ContentPage>
  );
}
