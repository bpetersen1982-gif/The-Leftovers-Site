import type { MetadataRoute } from "next";
import { connection } from "next/server";
import { db } from "@/lib/db";
import { listPublicAlbumPaths } from "@/lib/photos/album-queries";

const SITE_URL = "https://theleftoversband.com";
const STATIC_PATHS = ["", "/book", "/about", "/members", "/photos", "/videos", "/contact", "/privacy", "/copyright"] as const;

/**
 * Public pages only; admin, login, and invite routes are excluded (SEC-7). Built per
 * request so new public albums show up without a redeploy.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  await connection();
  const albums = await listPublicAlbumPaths(db());
  return [
    ...STATIC_PATHS.map((path) => ({
      url: `${SITE_URL}${path}`,
      changeFrequency: path === "" ? ("weekly" as const) : ("monthly" as const),
      priority: path === "" ? 1 : 0.6,
    })),
    ...albums.map((album) => ({
      url: `${SITE_URL}/photos/albums/${album.slug}`,
      lastModified: album.updatedAt,
      changeFrequency: "monthly" as const,
      priority: 0.5,
    })),
  ];
}
