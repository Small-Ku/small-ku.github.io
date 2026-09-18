import type { APIRoute } from "astro";
import { getWriting, writingHref } from "../lib/content";
import { absoluteUrl } from "../lib/seo";
import { siteConfig } from "../site.config";
import { escapeXml, rfc822Date } from "../lib/xml";

export const prerender = true;

export const GET: APIRoute = async () => {
  const writing = await getWriting();
  const self = absoluteUrl("/rss.xml");
  const channel = absoluteUrl("/");

  const items = writing.map((entry) => {
    const link = entry.data.canonicalUrl ?? absoluteUrl(writingHref(entry.id));
    const pubDate = rfc822Date(entry.data.date);
    return [
      "    <item>",
      `      <title>${escapeXml(entry.data.title)}</title>`,
      `      <description>${escapeXml(entry.data.summary)}</description>`,
      `      <link>${escapeXml(link)}</link>`,
      `      <guid isPermaLink="true">${escapeXml(link)}</guid>`,
      ...(pubDate ? [`      <pubDate>${escapeXml(pubDate)}</pubDate>`] : []),
      ...entry.data.tags.map((tag) => `      <category>${escapeXml(tag)}</category>`),
      "    </item>"
    ].join("\n");
  }).join("\n");

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
    "  <channel>",
    `    <title>${escapeXml(siteConfig.title)}</title>`,
    `    <description>${escapeXml(siteConfig.description)}</description>`,
    `    <link>${escapeXml(channel)}</link>`,
    `    <language>${escapeXml(siteConfig.language)}</language>`,
    `    <atom:link href="${escapeXml(self)}" rel="self" type="application/rss+xml" />`,
    items,
    "  </channel>",
    "</rss>",
    ""
  ].filter(Boolean).join("\n");

  return new Response(xml, { headers: { "Content-Type": "application/rss+xml; charset=utf-8" } });
};
