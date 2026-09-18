import type { APIRoute } from "astro";
import { contentKey, getContentIndex, projectHref, writingHref } from "../lib/content";
import { supportedLocales, localizedPath } from "../lib/i18n";
import { absoluteUrl } from "../lib/seo";
import { escapeXml, fullDate } from "../lib/xml";

export const prerender = true;

const ownsCanonical = (internalUrl: string, explicit?: string) =>
  !explicit || new URL(explicit).href === new URL(internalUrl).href;

export const GET: APIRoute = async () => {
  const pages: Array<{ loc: string; lastmod?: string }> = [];
  for (const locale of supportedLocales) {
    const { listedProjects, writing } = await getContentIndex(locale);
    pages.push(
      { loc: absoluteUrl(localizedPath(locale, "/")) },
      { loc: absoluteUrl(localizedPath(locale, "/timeline/")) },
      ...listedProjects.flatMap((entry) => {
        const loc = absoluteUrl(projectHref(contentKey(entry), locale));
        return ownsCanonical(loc, entry.data.canonicalUrl)
          ? [{ loc, lastmod: fullDate(entry.data.updated ?? entry.data.date) }]
          : [];
      }),
      ...writing.flatMap((entry) => {
        const loc = absoluteUrl(writingHref(contentKey(entry), locale));
        return ownsCanonical(loc, entry.data.canonicalUrl)
          ? [{ loc, lastmod: fullDate(entry.data.updated ?? entry.data.date) }]
          : [];
      })
    );
  }

  const body = pages.map(({ loc, lastmod }) => [
    "  <url>",
    `    <loc>${escapeXml(loc)}</loc>`,
    ...(lastmod ? [`    <lastmod>${escapeXml(lastmod)}</lastmod>`] : []),
    "  </url>"
  ].join("\n")).join("\n");

  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`,
    { headers: { "Content-Type": "application/xml; charset=utf-8" } }
  );
};
