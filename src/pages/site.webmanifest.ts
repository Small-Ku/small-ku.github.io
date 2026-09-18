import type { APIRoute } from "astro";
import { siteConfig } from "../site.config";

export const prerender = true;

export const GET: APIRoute = () => {
  const manifest = {
    name: siteConfig.title,
    short_name: siteConfig.name,
    start_url: "/",
    scope: "/",
    display: "browser",
    background_color: siteConfig.themeColor.light,
    theme_color: siteConfig.themeColor.light,
    icons: [
      { src: "/favicon.svg", sizes: "any", type: "image/svg+xml" },
      { src: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }
    ]
  };

  return new Response(JSON.stringify(manifest), {
    headers: {
      "Content-Type": "application/manifest+json; charset=utf-8",
      "Cache-Control": "public, max-age=3600"
    }
  });
};
