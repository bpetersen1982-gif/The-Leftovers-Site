import { connection } from "next/server";
import type { ReactNode } from "react";
import { SiteChrome } from "@/components/site-chrome";

export default async function SiteLayout({ children }: { children: ReactNode }) {
  // Rendered per request so the CSP nonce applies (src/proxy.ts).
  await connection();
  return <SiteChrome>{children}</SiteChrome>;
}
