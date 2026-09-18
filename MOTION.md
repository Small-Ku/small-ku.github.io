# Motion system

The motion grammar is intentionally split into three responsibilities:

- **identity / transformation** — a project card surface, visual, or title may remain the same object across routes;
- **wayfinding** — route semantics decide which identities are meaningful, not a universal full-page slide;
- **interaction continuity** — active transitions can be interrupted, target scrolling is settled before capture, and browser history can replay reverse/forward relationships.

## View Transition coordinator

The site remains an Astro multi-page SSG. When the browser supports `document.startViewTransition()`, same-origin links are soft-enhanced:

```text
click
→ identify the exact source object
→ fetch destination static HTML
→ startViewTransition()
→ replace <main>
→ position destination viewport instantly
→ identify destination counterpart
→ measure source + target geometry
→ derive duration from distance + area ratio
→ animate snapshots
```

This avoids depending on cross-document `pageswap` / `pagereveal` support and keeps Firefox on the same deterministic same-document path as other supporting browsers.

## Project transform

A project navigation may pair:

```text
card surface  ↔ hero surface
card visual   ↔ hero visual
card title    ↔ hero title
```

The surface owns the large container transform. Shared visual/title groups stay above it. New-only project content is revealed after spatial ownership is clear.

Visual snapshots deliberately allow geometry squeeze plus crossfade when source and destination aspect ratios differ. Typography uses a crisper handoff rather than intentionally distorting glyphs.

## Timeline portal

When latest writing exists, `View all in timeline` can pair the latest rows above the expanding timeline surface. Destination scroll is positioned before the new snapshot is captured so scrolling and shared-element movement do not race.

Back/Forward history traversals preserve the same relationship where the corresponding source/target object exists.

## Dynamic duration

The coordinator derives one route clock from the largest relevant matched movement. It combines:

- center-to-center travel normalized by viewport diagonal;
- logarithmic source/target area ratio.

The result is clamped to a bounded range so large displays do not produce excessively slow transitions. CSS consumes the runtime value through `--ft-motion-route`.

## Reduced motion

`prefers-reduced-motion: reduce` keeps navigation and state semantics while collapsing View Transition animation durations and removing supporting displacement.

## Production-shell head synchronization

Soft navigation swaps `<main>` rather than replacing the whole document. Because route-sensitive metadata is part of document identity, the coordinator also replaces the destination document's description, robots directive, canonical link, Open Graph metadata, Twitter metadata, and JSON-LD during the same update. This does not change transition geometry; it prevents stale head state after a successful soft navigation.
