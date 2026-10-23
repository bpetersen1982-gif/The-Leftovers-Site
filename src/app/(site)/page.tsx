import Image from "next/image";
import Link from "next/link";
import { BlockContent } from "@/components/block-content";
import { getPage, getSiteSettings } from "@/lib/content/service";
import { db } from "@/lib/db";

const SITE_URL = "https://theleftoversband.com";

export default async function HomePage() {
  const [intro, settings] = await Promise.all([getPage(db(), "home"), getSiteSettings(db())]);

  /** Structured data so search engines know this is a band, not the HBO series (SEO-3). */
  const musicGroupJsonLd = {
    "@context": "https://schema.org",
    "@type": "MusicGroup",
    name: "The Leftovers",
    url: SITE_URL,
    genre: ["Rock", "Alternative Rock", "Cover band"],
    description: "90s & 2000s rock and alternative cover band from Lincoln, Nebraska.",
    foundingLocation: { "@type": "Place", name: "Lincoln, Nebraska" },
    email: settings.bookingEmail,
    sameAs: settings.socialLinks.map((link) => link.url),
  };

  return (
    <main>
      <section
        aria-labelledby="hero-heading"
        className="relative isolate flex min-h-[70dvh] flex-col items-center justify-center overflow-hidden px-6 py-20 text-center"
      >
        {/*
          Temporary atmosphere image (design/README.md). CSS background rather than next/image
          `fill`, because fill relies on inline style attributes; kept simple and decorative.
        */}
        <div aria-hidden="true" className="hero-atmosphere absolute inset-0 -z-10" />
        <div aria-hidden="true" className="absolute inset-0 -z-10 bg-gradient-to-b from-ink/60 via-ink/70 to-ink" />

        <h1 id="hero-heading" className="sr-only">
          The Leftovers
        </h1>
        <Image
          src="/brand/logo-wordmark.png"
          alt="The Leftovers"
          width={315}
          height={166}
          priority
          className="h-auto w-64 sm:w-80"
        />
        <p className="mt-6 font-heading text-lg tracking-[0.2em] uppercase sm:text-xl">
          90s &amp; 2000s Rock &amp; Alternative Covers
        </p>
        <p className="mt-2 font-heading tracking-[0.3em] text-cream/90 uppercase">Lincoln, NE</p>
      </section>

      {intro.blocks.length > 0 && (
        <section aria-label="About the band" className="mx-auto max-w-3xl px-6 pb-12">
          <BlockContent blocks={intro.blocks} />
        </section>
      )}

      <section aria-labelledby="booking-heading" className="px-6 pb-16">
        <div className="panel-paper relative mx-auto max-w-xl px-6 py-8 text-center shadow-2xl">
          <Image
            src="/brand/tape-light.png"
            alt=""
            width={113}
            height={58}
            className="absolute -top-6 left-1/2 w-24 -translate-x-1/2 rotate-[-4deg]"
          />
          <h2 id="booking-heading" className="font-heading text-2xl font-bold tracking-wider uppercase">
            Book the band
          </h2>
          <p className="mt-3 leading-relaxed">
            Bars, weddings, festivals, graduations, private parties. Tell us your date and we&apos;ll get back to you.
          </p>
          <div className="mt-5 flex flex-wrap items-center justify-center gap-4">
            <Link href="/book" className="btn-primary">
              Check dates
            </Link>
            <a href={`mailto:${settings.bookingEmail}`} className="font-semibold break-all underline">
              {settings.bookingEmail}
            </a>
          </div>
        </div>
      </section>

      <script
        type="application/ld+json"
        // JSON.stringify of server data; "<" is escaped so it can't close the tag.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(musicGroupJsonLd).replaceAll("<", "\\u003c") }}
      />
    </main>
  );
}
