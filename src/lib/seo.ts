import { siteConfig } from "../site.config";

export type StructuredData = Record<string, unknown> | Array<Record<string, unknown>>;

export function absoluteUrl(pathOrUrl: string): string {
  return new URL(pathOrUrl, siteConfig.url).href;
}

export function jsonLd(value: StructuredData): string {
  // Avoid a literal </script> sequence if authored text ever contains markup.
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

export function websiteStructuredData(): StructuredData {
  const sameAs = siteConfig.social.map((item) => item.href);
  return [
    {
      "@context": "https://schema.org",
      "@type": "WebSite",
      name: siteConfig.title,
      url: siteConfig.url,
      description: siteConfig.description,
      inLanguage: siteConfig.language
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
}): StructuredData {
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
}): StructuredData {
  return {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: input.title,
    description: input.summary,
    url: input.url,
    datePublished: input.date,
    ...(input.updated ? { dateModified: input.updated } : {}),
    ...(input.tags.length > 0 ? { keywords: input.tags.join(", ") } : {}),
    author: { "@type": "Person", name: siteConfig.name, url: siteConfig.url }
  };
}
