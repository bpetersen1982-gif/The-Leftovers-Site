import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/admin", "/login", "/invite", "/api"] }],
    sitemap: "https://theleftoversband.com/sitemap.xml",
  };
}
