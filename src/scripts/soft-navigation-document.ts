const documentCache = new Map<string, Promise<Document>>();

function documentCacheKey(url: URL): string {
  const key = new URL(url.href);
  key.hash = "";
  return key.href;
}

export async function fetchNavigationDocument(url: URL): Promise<Document> {
  const key = documentCacheKey(url);
  let pending = documentCache.get(key);
  if (!pending) {
    pending = fetch(key, { headers: { "X-Template-Navigation": "1" } }).then(async (response) => {
      if (!response.ok) throw new Error("Navigation fetch failed: " + response.status);
      const html = await response.text();
      return new DOMParser().parseFromString(html, "text/html");
    }).catch((error) => {
      documentCache.delete(key);
      throw error;
    });
    documentCache.set(key, pending);
  }
  return pending;
}

function syncDocumentHead(nextDocument: Document): void {
  const selectors = [
    'meta[name="description"]',
    'meta[name="robots"]',
    'link[rel="canonical"]',
    'link[rel="alternate"][hreflang]',
    'link[rel="alternate"][type="application/rss+xml"]',
    'meta[property^="og:"]',
    'meta[name^="twitter:"]',
    'script[type="application/ld+json"]'
  ];

  for (const selector of selectors) {
    document.head.querySelectorAll(selector).forEach((node) => node.remove());
    nextDocument.head.querySelectorAll(selector).forEach((node) => {
      document.head.append(document.importNode(node, true));
    });
  }
}

function replaceSiteChrome(selector: string, nextDocument: Document): void {
  const current = document.querySelector(selector);
  const next = nextDocument.querySelector(selector);
  if (!current || !next) throw new Error("Missing site chrome element: " + selector);
  current.replaceWith(document.importNode(next, true));
}

function syncSiteHeader(nextDocument: Document): void {
  const current = document.querySelector<HTMLElement>(".site-header");
  const next = nextDocument.querySelector<HTMLElement>(".site-header");
  if (!current || !next) throw new Error("Missing site header");

  // The Header shell is stable chrome. Preserve the element itself so route-
  // dependent surface color can transition as state while destination markup
  // remains authoritative for localized/navigation content.
  current.replaceChildren(...Array.from(next.childNodes).map((node) => document.importNode(node, true)));
}

function syncDocumentRoot(nextDocument: Document): void {
  const root = document.documentElement;
  const nextRoot = nextDocument.documentElement;
  root.lang = nextRoot.lang;

  const nextLocale = nextRoot.dataset.locale;
  if (nextLocale) root.dataset.locale = nextLocale;
  else delete root.dataset.locale;

  const nextKind = nextRoot.dataset.routeKind;
  root.dataset.routeKind = nextKind === "home"
    || nextKind === "timeline"
    || nextKind === "project"
    || nextKind === "writing"
    ? nextKind
    : "other";

  const nextId = nextRoot.dataset.routeId;
  if (nextId) root.dataset.routeId = nextId;
  else delete root.dataset.routeId;
}

export function installNavigationDocument(nextDocument: Document): HTMLElement {
  const currentMain = document.querySelector<HTMLElement>("main");
  const nextMain = nextDocument.querySelector<HTMLElement>("main");
  if (!currentMain || !nextMain) throw new Error("Missing main element in navigation document");

  nextMain.querySelectorAll("script").forEach((script) => script.remove());
  currentMain.replaceChildren(...Array.from(nextMain.childNodes).map((node) => document.importNode(node, true)));
  syncSiteHeader(nextDocument);
  replaceSiteChrome(".site-footer", nextDocument);
  replaceSiteChrome(".skip-link", nextDocument);

  document.title = nextDocument.title;
  syncDocumentHead(nextDocument);
  syncDocumentRoot(nextDocument);

  const announcer = document.querySelector<HTMLElement>("[data-route-announcer]");
  if (announcer) announcer.textContent = nextDocument.title;

  return currentMain;
}