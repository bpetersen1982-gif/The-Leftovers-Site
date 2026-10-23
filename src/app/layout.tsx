import type { Metadata, Viewport } from "next";
import { Oswald, Rock_Salt, Special_Elite } from "next/font/google";
import type { ReactNode } from "react";
import "./globals.css";

// Self-hosted at build time by next/font (no requests to Google at runtime; CSP font-src 'self').
const rockSalt = Rock_Salt({ weight: "400", subsets: ["latin"], variable: "--font-rock-salt", display: "swap" });
const oswald = Oswald({ subsets: ["latin"], variable: "--font-oswald", display: "swap" });
const specialElite = Special_Elite({ weight: "400", subsets: ["latin"], variable: "--font-special-elite", display: "swap" });

const SITE_URL = "https://theleftoversband.com";
const DESCRIPTION = "The Leftovers: 90s & 2000s rock and alternative cover band from Lincoln, Nebraska.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "The Leftovers — Lincoln, NE 90s & 2000s Rock Cover Band",
    template: "%s | The Leftovers",
  },
  description: DESCRIPTION,
  icons: { icon: "/brand/icon-star.png" },
  openGraph: { type: "website", siteName: "The Leftovers", url: SITE_URL, description: DESCRIPTION },
};

export const viewport: Viewport = {
  themeColor: "#0b0b0b",
  colorScheme: "dark",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" className={`${rockSalt.variable} ${oswald.variable} ${specialElite.variable}`}>
      <body>{children}</body>
    </html>
  );
}
