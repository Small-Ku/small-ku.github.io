import type { APIRoute } from "astro";
import { siteConfig } from "../site.config";

export const prerender = true;

export const GET: APIRoute = () => {
  const sitemap = new URL("/sitemap.xml", siteConfig.url).href;
  return new Response(`User-agent: *\nAllow: /\n\nSitemap: ${sitemap}\n`, {
    headers: { "Content-Type": "text/plain; charset=utf-8" }
  });
};
