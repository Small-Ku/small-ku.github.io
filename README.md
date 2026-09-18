# Personal Site SSG Template

An opinionated Astro static-site template for a personal site with projects, writing, a merged chronology, and progressive View Transition motion.

The repository intentionally ships with **zero project entries and zero writing entries**. Empty collections are a supported first-class state: home, timeline, RSS, sitemap, robots, 404, and the static build must all work before anything is published.

## Current deployment identity

`src/site.config.ts` is the single site-identity authority. The packaged configuration points at the current GitHub Pages staging origin:

```text
https://small-ku.github.io
```

When the custom domain is ready, change only `siteConfig.url` to `https://kwoo.de`; `astro.config.ts`, canonical URLs, feeds, sitemap, JSON-LD, and robots derive from it.

## Start

With Aube:

```bash
aube dev
aube build
```

Or with the package manager used by CI:

```bash
pnpm install
pnpm dev
pnpm build
```

`pnpm build` runs `astro check && astro build`.

## Configure the site

Edit `src/site.config.ts` for identity and site chrome:

- name, title, description, canonical site URL;
- language and Open Graph locale;
- theme color;
- hero copy;
- primary navigation;
- social/profile links;
- home-page limits;
- footer note.

Project and writing content never belongs in site config.

## Add content

The live collections start empty:

```text
src/content/projects/.gitkeep
src/content/writing/.gitkeep
```

Copy the authoring skeletons from outside the collections:

```text
templates/project.md
templates/writing.md
```

Then place the new files under `src/content/projects/` or `src/content/writing/`. See `docs/CONTENT.md` for field semantics and build-time invariants.

## Publication model

- `draft: true` is available in development and excluded from production routes and discovery.
- project `visibility: public` participates in home/timeline/sitemap.
- project `visibility: unlisted` still gets a direct static route, but is excluded from discovery and emitted with `noindex`.
- static hosting does **not** provide private access control; there is intentionally no `private` visibility mode.
- timeline data is always derived from project + writing collections.
- RSS is derived from writing only.

## Production surfaces

```text
/                         home
/timeline/                 merged public projects + writing chronology
/projects/<id>/            generated project pages
/writing/<id>/             generated writing pages
/rss.xml                   writing feed
/sitemap.xml               canonical discoverable pages
/robots.txt                crawler policy + sitemap pointer
/404.html                  static not-found page
```

If a collection is empty, its dynamic route simply generates no detail pages.

## Build-time content checks

The content layer fails the build for structural mistakes that should not be silently hidden, including:

- writing that references an unknown project;
- published writing that references a draft project;
- duplicate `selectedOrder` among selected projects;
- `selectedOrder` on a non-selected project;
- selected projects that are not public;
- duplicate explicit canonical URLs.

## Motion and progressive enhancement

The static links are authoritative. JavaScript upgrades navigation to same-document View Transitions when supported; unsupported browsers and JavaScript-disabled browsing keep normal page navigation. `prefers-reduced-motion` suppresses displacement-heavy choreography.

The soft-navigation coordinator also synchronizes route-sensitive head metadata (description, canonical, robots, Open Graph, Twitter card, and JSON-LD) when swapping documents.

See `docs/ARCHITECTURE.md` and `MOTION.md`.

## Deployment

`.github/workflows/deploy.yml` publishes `master` with `withastro/action@v6` and `actions/deploy-pages@v5`. The CI package-manager version is pinned to pnpm 12.4.2 rather than `latest`.

Before changing DNS, verify the staging deployment at `https://small-ku.github.io/`. When switching to `kwoo.de`, update `siteConfig.url` in the same cutover commit used for the GitHub Pages custom-domain change.

## Empty-state invariant

A clean checkout with only `.gitkeep` files under both content folders must build. Do not solve an empty collection by adding fake content. Authoring examples stay outside the collections so they can never become accidental published entries.
