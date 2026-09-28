import { siteConfig } from "../site.config";
import type { SiteLocale } from "./i18n";

export type StructuredData = Record<string, unknown> | Array<Record<string, unknown>>;

export function absoluteUrl(pathOrUrl: string): string {
  return new URL(pathOrUrl, siteConfig.url).href;
}

export function jsonLd(value: StructuredData): string {
  // Avoid a literal </script> sequence if authored text ever contains markup.
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

export function websiteStructuredData(locale: SiteLocale = "en"): StructuredData {
  const localeConfig = siteConfig.locales[locale];
  const sameAs = siteConfig.social.map((item) => item.href);
  return [
    {
      "@context": "https://schema.org",
      "@type": "WebSite",
      name: localeConfig.title,
      url: siteConfig.url,
      description: localeConfig.description,
      inLanguage: localeConfig.language
    },
    {
      "@context": "https://schema.org",
      "@type": "Person",
      name: siteConfig.name,
      url: siteConfig.url,
      ...(sameAs.length > 0 ? { sameAs } : {})
    }
  ];
}

export function projectStructuredData(input: {
  title: string;
  summary: string;
  url: string;
  date: string;
  updated?: string;
  tags: string[];
  sourceUrl?: string;
  locale?: SiteLocale;
}): StructuredData {
  const locale = input.locale ?? "en";
  return {
    "@context": "https://schema.org",
    "@type": "CreativeWork",
    name: input.title,
    description: input.summary,
    url: input.url,
    dateCreated: input.date,
    ...(input.updated ? { dateModified: input.updated } : {}),
    ...(input.tags.length > 0 ? { keywords: input.tags.join(", ") } : {}),
    ...(input.sourceUrl ? { sameAs: input.sourceUrl } : {}),
    inLanguage: siteConfig.locales[locale].language,
    author: { "@type": "Person", name: siteConfig.name, url: siteConfig.url }
  };
}

export function articleStructuredData(input: {
  title: string;
  summary: string;
  url: string;
  date: string;
  updated?: string;
  tags: string[];
  locale?: SiteLocale;
}): StructuredData {
  const locale = input.locale ?? "en";
  return {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: input.title,
    description: input.summary,
    url: input.url,
    datePublished: input.date,
    ...(input.updated ? { dateModified: input.updated } : {}),
    ...(input.tags.length > 0 ? { keywords: input.tags.join(", ") } : {}),
    inLanguage: siteConfig.locales[locale].language,
    author: { "@type": "Person", name: siteConfig.name, url: siteConfig.url }
  };
}
