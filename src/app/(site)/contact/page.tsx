import { BlockContent } from "@/components/block-content";
import { PageBody } from "@/components/site-chrome";
import { getPage, getSiteSettings } from "@/lib/content/service";
import { SOCIAL_PLATFORMS } from "@/lib/content/settings";
import { db } from "@/lib/db";
import { contentPageMetadata } from "../content-page";

export const metadata = contentPageMetadata("contact", "Contact and booking for The Leftovers, Lincoln, Nebraska.");

export default async function ContactPage() {
  const [page, settings] = await Promise.all([getPage(db(), "contact"), getSiteSettings(db())]);
  const contacts = [
    { label: "Booking", email: settings.bookingEmail },
    { label: "Everything else", email: settings.generalEmail },
  ];

  return (
    <PageBody title="Contact">
      <BlockContent blocks={page.blocks} />
      <ul className="mt-8 grid gap-4 sm:grid-cols-2">
        {contacts.map((contact) => (
          <li key={contact.label} className="panel-paper px-5 py-5">
            <h2 className="font-heading text-xl font-bold uppercase">{contact.label}</h2>
            <a href={`mailto:${contact.email}`} className="mt-2 block font-semibold break-all underline">
              {contact.email}
            </a>
          </li>
        ))}
      </ul>
      {settings.socialLinks.length > 0 && (
        <section aria-labelledby="follow" className="mt-10">
          <h2 id="follow" className="font-heading text-2xl font-bold tracking-wider uppercase">
            Follow us
          </h2>
          <ul className="mt-3 flex flex-wrap gap-4">
            {settings.socialLinks.map((link) => (
              <li key={link.platform}>
                <a href={link.url} rel="noopener noreferrer" target="_blank" className="btn-primary">
                  {SOCIAL_PLATFORMS[link.platform].label}
                  <span className="sr-only"> (opens in a new tab)</span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}
    </PageBody>
  );
}
