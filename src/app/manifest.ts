import type { MetadataRoute } from "next";

/**
 * Web app manifest. Lets band members add the admin area to their Home Screen, which
 * iPhones require before they allow push alerts.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "The Leftovers: Band",
    short_name: "Leftovers",
    description: "Band admin for The Leftovers.",
    start_url: "/admin",
    scope: "/",
    display: "standalone",
    background_color: "#0b0b0b",
    theme_color: "#0b0b0b",
    icons: [
      { src: "/brand/app-icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/brand/app-icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
