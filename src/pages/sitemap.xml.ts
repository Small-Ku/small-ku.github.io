import type { APIRoute } from "astro";
import { getContentIndex, projectHref, writingHref } from "../lib/content";
import { absoluteUrl } from "../lib/seo";
import { escapeXml, fullDate } from "../lib/xml";

export const prerender = true;

const ownsCanonical = (internalUrl: string, explicit?: string) =>
  !explicit || new URL(explicit).href === new URL(internalUrl).href;

export const GET: APIRoute = async () => {
  const { listedProjects, writing } = await getContentIndex();
  const projectPages = listedProjects.flatMap((entry) => {
    const loc = absoluteUrl(projectHref(entry.id));
    return ownsCanonical(loc, entry.data.canonicalUrl)
      ? [{ loc, lastmod: fullDate(entry.data.updated ?? entry.data.date) }]
      : [];
  });
  const writingPages = writing.flatMap((entry) => {
    const loc = absoluteUrl(writingHref(entry.id));
    return ownsCanonical(loc, entry.data.canonicalUrl)
      ? [{ loc, lastmod: fullDate(entry.data.updated ?? entry.data.date) }]
      : [];
  });

  const pages: Array<{ loc: string; lastmod?: string }> = [
    { loc: absoluteUrl("/") },
    { loc: absoluteUrl("/timeline/") },
    ...projectPages,
    ...writingPages
  ];

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
