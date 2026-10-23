import type { Block } from "./blocks";

/**
 * Admin-editable pages (requirements CNT-1). Each has default copy so the site reads
 * correctly before anyone edits it; once an Admin saves, the stored version is used.
 */
export const PAGE_SLUGS = ["home", "about", "contact", "privacy", "copyright"] as const;
export type PageSlug = (typeof PAGE_SLUGS)[number];

export function isPageSlug(value: string): value is PageSlug {
  return (PAGE_SLUGS as readonly string[]).includes(value);
}

export interface PageDefinition {
  readonly slug: PageSlug;
  readonly title: string;
  readonly path: string;
  /** Shown to Admins in the editor list. */
  readonly description: string;
  readonly defaultContent: readonly Block[];
}

export const PAGES: Record<PageSlug, PageDefinition> = {
  home: {
    slug: "home",
    title: "Home",
    path: "/",
    description: "Intro text under the logo on the home page.",
    defaultContent: [
      { type: "heading", text: "Real music. No bullshit." },
      {
        type: "paragraph",
        text: "The Leftovers play the 90s and 2000s rock and alternative songs you know, with the attitude you remember. Bars, weddings, festivals, graduations, and private parties around Lincoln, Nebraska.",
      },
    ],
  },
  about: {
    slug: "about",
    title: "About",
    path: "/about",
    description: "The band's story.",
    defaultContent: [
      {
        type: "paragraph",
        text: "The Leftovers are a 90s and 2000s rock and alternative cover band based in Lincoln, Nebraska.",
      },
    ],
  },
  contact: {
    slug: "contact",
    title: "Contact",
    path: "/contact",
    description: "Intro text above the contact emails.",
    defaultContent: [
      {
        type: "paragraph",
        text: "Booking a show, planning a wedding, or just want to say hi? Email us and a band member will get back to you.",
      },
    ],
  },
  privacy: {
    slug: "privacy",
    title: "Privacy",
    path: "/privacy",
    description: "Privacy policy. Review before launch; this is not legal advice.",
    defaultContent: [
      { type: "heading", text: "What we collect" },
      {
        type: "list",
        items: [
          "If you email us or send a booking request, we keep your name, contact details, and event details so we can reply and plan the show.",
          "Band members who log in have an account with their name and email.",
          "We don't sell or share your information, and we don't use advertising trackers.",
        ],
      },
      { type: "heading", text: "Cookies" },
      {
        type: "paragraph",
        text: "Visitors don't get tracking cookies. Band members who log in get a login cookie that keeps them signed in.",
      },
      { type: "heading", text: "Your choices" },
      {
        type: "paragraph",
        text: "To see, correct, or delete information we have about you, email us at the address on our Contact page.",
      },
    ],
  },
  copyright: {
    slug: "copyright",
    title: "Copyright",
    path: "/copyright",
    description: "How rights holders send takedown notices (email only).",
    defaultContent: [
      {
        type: "paragraph",
        text: "We respect the rights of songwriters and other creators. If you believe something on this site infringes your copyright, email us at the copyright address below. We review every notice and remove material that infringes.",
      },
      { type: "heading", text: "Include in your notice" },
      {
        type: "list",
        items: [
          "Your name and contact information.",
          "The work you believe is infringed.",
          "A link to the material on this site.",
          "A statement that you have a good-faith belief the use isn't authorized.",
          "A statement, under penalty of perjury, that your notice is accurate and you're the rights holder or authorized to act for them.",
          "Your physical or electronic signature.",
        ],
      },
    ],
  },
};
