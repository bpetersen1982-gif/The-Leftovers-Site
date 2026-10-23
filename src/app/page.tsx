import Image from "next/image";
import { connection } from "next/server";

const BOOKING_EMAIL = "booking@theleftoversband.com";

/** Structured data so search engines know this is a band, not the HBO series (SEO-3). */
const musicGroupJsonLd = {
  "@context": "https://schema.org",
  "@type": "MusicGroup",
  name: "The Leftovers",
  url: "https://theleftoversband.com",
  genre: ["Rock", "Alternative Rock", "Cover band"],
  description: "90s & 2000s rock and alternative cover band from Lincoln, Nebraska.",
  foundingLocation: { "@type": "Place", name: "Lincoln, Nebraska" },
  email: BOOKING_EMAIL,
};

export default async function HomePage() {
  // Rendered per request so the CSP nonce applies (see src/proxy.ts).
  await connection();

  return (
    <main className="flex min-h-dvh flex-col">
      <section
        aria-labelledby="hero-heading"
        className="relative isolate flex flex-1 flex-col items-center justify-center overflow-hidden px-6 py-20 text-center"
      >
        {/*
          Temporary atmosphere image (design/README.md). CSS background rather than next/image
          `fill`, because fill relies on inline style attributes that the strict CSP blocks.
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
            Bars, weddings, festivals, graduations, private parties. Tell us your date and we&apos;ll get back to
            you.
          </p>
          <a href={`mailto:${BOOKING_EMAIL}`} className="btn-primary mt-5">
            {BOOKING_EMAIL}
          </a>
        </div>
      </section>

      <footer className="border-t border-olive/60 px-6 py-6 text-center text-sm text-cream/90">
        <p>&copy; {new Date().getUTCFullYear()} The Leftovers &middot; Lincoln, Nebraska</p>
      </footer>

      <script
        type="application/ld+json"
        // JSON.stringify of a static object we control; "<" is escaped so it can't close the tag.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(musicGroupJsonLd).replaceAll("<", "\\u003c") }}
      />
    </main>
  );
}
