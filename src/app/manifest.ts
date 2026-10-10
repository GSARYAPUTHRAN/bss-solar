import type { MetadataRoute } from "next";

/** `--background` of the light theme (src/app/globals.css), as hex. */
const BACKGROUND = "#fdfcf9";

/**
 * Web app manifest: makes the console installable ("Add to Home Screen"),
 * which iOS requires before it allows Web Push, and gives field staff a
 * full-screen app on their phones. Icons come from scripts/generate-icons.mjs.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "BSS Solar Operations",
    short_name: "BSS Ops",
    description:
      "BSS Solar operations console: work orders, KSEB/ANERT projects, payments and service tickets.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: BACKGROUND,
    theme_color: BACKGROUND,
    categories: ["business", "productivity"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
