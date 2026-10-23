import type { MetadataRoute } from "next";

const SITE_URL = "https://theleftoversband.com";

/** Public pages only; admin, login, and invite routes are excluded (SEC-7). */
export default function sitemap(): MetadataRoute.Sitemap {
  return ["", "/about", "/members", "/contact", "/privacy", "/copyright"].map((path) => ({
    url: `${SITE_URL}${path}`,
    changeFrequency: path === "" ? "weekly" : "monthly",
    priority: path === "" ? 1 : 0.6,
  }));
}
