# Content authoring contract

The live collections deliberately contain no sample entries. Entries are intentionally flat (`*.md`, no nested content folders), so each filename maps unambiguously to one route ID. Start by copying `templates/project.md` or `templates/writing.md`; the templates are outside `src/content/` and therefore never publish by accident.

## Shared rules

`date` and `updated` accept `YYYY`, `YYYY-MM`, or `YYYY-MM-DD`. Chronology sorts by the authored date string, newest first, with explicit stable type/id tie-breakers.

`draft: true` is visible while developing and omitted from production builds. A production writing entry may not reference a draft project.

`canonicalUrl`, when present, declares another URL as canonical. Internal mirrored pages remain navigable, but sitemap output omits entries whose canonical lives elsewhere.

## Projects

Create `src/content/projects/my-project.md` from `templates/project.md`.

Core fields:

```yaml
title: My Project
kicker: Systems
summary: One or two sentences.
date: 2026-09
draft: false
status: Active
visibility: public
selected: false
tags: []
tone: violet
facts: []
```

Optional fields:

```yaml
updated: 2026-09-19
selectedOrder: 1
sourceUrl: https://github.com/example/project
externalUrl: https://example.com
canonicalUrl: https://example.com/original-page
visual:
  variant: network
  label: VISUAL LABEL
  alt: Description only when the abstract visual carries information
```

Project tone values:

```text
violet | teal | coral | neutral
```

Visual variants:

```text
network | matrix | stack
```

A project without `visual` uses the no-visual project layout and compact chronology band.

### Selection and visibility

`selected: true` makes a **public** project eligible for the home fan. `selectedOrder` is optional and only orders selected projects relative to one another. Duplicate selected orders fail the build.

Visibility is intentionally limited to:

```text
public | unlisted
```

`public` appears in the home/timeline discovery graph. `unlisted` still generates `/projects/<id>/` but is omitted from home, timeline, and sitemap and receives `noindex`. Static output cannot enforce private access, so the template does not pretend that a `private` flag is security.

## Writing

Create `src/content/writing/my-note.md` from `templates/writing.md`.

```yaml
title: My Note
summary: Short description shown in rows and metadata.
date: 2026-09-19
draft: false
kind: Research note
tags: []
relatedProjects: []
```

Optional:

```yaml
updated: 2026-09-20
canonicalUrl: https://example.com/original-article
```

`relatedProjects` contains project entry IDs, which are filenames without `.md`.

Unknown project IDs fail the build instead of silently disappearing. A published writing entry also cannot reference a draft project.

## Derived surfaces

Do not maintain timeline or feed entries manually:

```text
projects ─┐
          ├─ validate → normalize → stable chronology → Timeline
writing ──┘

writing ─── validate → RSS
```

Home independently selects public `selected: true` projects and newest writing, with limits from `src/site.config.ts`.
