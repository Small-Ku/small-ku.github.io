# Architecture

## Authorities

The site has three deliberately separate authorities:

1. `src/site.config.ts` — site identity, canonical origin, navigation, and chrome.
2. `src/content/projects/` — project content.
3. `src/content/writing/` — writing content.

There is no timeline database, no separate related-writing index, and no route manifest to keep in sync by hand.

`astro.config.ts` imports `siteConfig.url`, so canonical site identity cannot drift between the Astro config and page metadata.

## Locale and translation boundary

The static site exposes English at the default root and Traditional Chinese under `/zh/`:

```text
/                 document language en
/zh/              document language zh-Hant
```

Astro's static i18n routing uses `en` and `zh` as URL locale tokens with an unprefixed default
locale. The document language and browser-facing `hreflang` remain `en` and `zh-Hant`; this is
the static equivalent of mapping a custom path to a browser language code. Astro's object-form
custom locale paths currently require server output, which is incompatible with GitHub Pages.

Content is filtered by locale before any home, timeline, detail, RSS, or sitemap surface is
derived. `translationKey` connects translated entries without making one locale a fallback for
another.

## Content pipeline

`src/lib/content.ts` loads both collections, validates cross-entry invariants, applies draft publication semantics, and exposes normalized views. Public project discovery is separated from direct-route generation so `unlisted` has precise static-site semantics.

Production behavior:

```text
all authored entries
       ↓ remove drafts
       ↓ validate the published graph
       ├─ all generated projects (public + unlisted)
       ├─ listed projects (public only)
       └─ writing
```

Development keeps drafts available so unfinished routes can be previewed and validates the draft-inclusive graph, catching relation mistakes before publication.

## Derived views

- Home selected work: public projects with `selected: true`.
- Home latest writing: newest published writing.
- Timeline: public projects + writing, stable chronological sort.
- Related writing: writing filtered by project ID.
- RSS: writing only.
- Sitemap: home, timeline, public internal-canonical projects, internal-canonical writing.

## Static routes and empty collections

The template must build when both content collections are empty. Dynamic `getStaticPaths()` calls simply return no project/writing detail routes; home, timeline, 404, RSS, sitemap, and robots still render.

Examples therefore live in `templates/`, never inside the content collections.

## SEO boundary

`SiteLayout.astro` owns document-level metadata: canonical, robots, Open Graph, Twitter card, RSS discovery, and JSON-LD. Detail pages provide `CreativeWork` or `Article` structured data through layout props.

The same canonical origin feeds `robots.txt`, sitemap, RSS, and JSON-LD.

## Navigation boundary

Static anchors are always the baseline. `src/scripts/navigation.ts` progressively upgrades internal navigation with same-document View Transitions. Its update callback swaps only main content but also synchronizes route-sensitive head metadata so browser state does not retain the previous route's canonical/SEO metadata.

The motion layer consumes generic route kind/id and `data-vt-*` contracts. It does not know specific project IDs or writing slugs.
