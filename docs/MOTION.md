# Motion system

The motion grammar is intentionally split into three responsibilities:

- **identity / transformation** — a project card surface, visual, or title may remain the same object across routes;
- **wayfinding** — route semantics decide which identities are meaningful, not a universal full-page slide;
- **interaction continuity** — active transitions can be interrupted, target scrolling is settled before capture, browser history can replay reverse/forward relationships, and fragment navigation remains deterministic under manual scroll restoration.

## View Transition coordinator

The site remains an Astro multi-page SSG. When the browser supports `document.startViewTransition()`, same-origin links are soft-enhanced:

```text
click
→ identify the exact source object
→ fetch destination static HTML
→ startViewTransition()
→ install destination main content and locale-sensitive site chrome
→ synchronize route-sensitive head/root metadata
→ position destination viewport instantly
→ identify destination counterpart
→ measure source + target geometry
→ derive duration from distance + area ratio
→ animate snapshots
```

This avoids depending on cross-document `pageswap` / `pagereveal` support and keeps Firefox on the same deterministic same-document path as other supporting browsers.

The destination document remains the authority for rendered chrome. Soft navigation therefore imports the destination Header, Footer, and skip link instead of trying to reconstruct locale state in client-side code. Root locale metadata (`lang`, `data-locale`) and route metadata are synchronized in the same update.

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

## Fragment navigation

The soft-navigation layer uses `history.scrollRestoration = "manual"`, so same-document fragments cannot be left half-managed by the browser and half-managed by the coordinator.

Fragment links therefore keep normal URL/history semantics while the coordinator owns the scroll operation. The same rule applies to repeated activation of the current fragment and direct loads such as `/#latest-writing`: after layout settles, the target position is reasserted deterministically.

Fragment positioning is settled before a destination View Transition snapshot when a soft navigation itself includes a fragment.

## Dynamic duration

The coordinator derives one route clock from the largest relevant matched movement. It combines:

- center-to-center travel normalized by viewport diagonal;
- logarithmic source/target area ratio.

The result is clamped to a bounded range so large displays do not produce excessively slow transitions. CSS consumes the runtime value through `--ft-motion-route`.

## Component interaction motion

Local controls may animate without participating in route identity, but they still use the shared motion vocabulary from `src/styles/tokens/_motion.scss`.

- **effect motion** covers opacity, color, and similar non-spatial state changes;
- **spatial motion** covers small geometric changes such as a popover entering from its trigger;
- component styles should consume shared duration/easing tokens rather than introduce anonymous timing curves inline;
- entry and exit may use different timing when that improves legibility, but both remain subordinate to route motion;
- a component interaction must not imply that an element is the same spatial identity across routes unless it actually participates in the View Transition coordinator.

Header popovers currently combine an effect-duration opacity transition with a short spatial translate/scale transition. Their enter easing is tokenized separately because the general route-oriented easing is visually too front-loaded for a top-layer surface appearing from zero opacity.

## Reduced motion

`prefers-reduced-motion: reduce` keeps navigation and state semantics while collapsing View Transition animation durations and removing supporting displacement. Component-level motion consumes the same zeroed duration tokens, so popovers and other local interactions settle immediately without changing their interaction semantics.

## Production-shell synchronization

Soft navigation does not replace the whole document, so route-sensitive state must be synchronized explicitly from the destination HTML.

The coordinator updates:

- `<main>` content;
- Header, Footer, and skip-link chrome;
- document title;
- root `lang`, `data-locale`, route kind, and route id;
- description and robots metadata;
- canonical URL;
- locale `hreflang` alternates and RSS alternates;
- Open Graph and Twitter metadata;
- JSON-LD.

This synchronization happens inside the same navigation update as viewport positioning and transition-name assignment so the visible document and its metadata cannot drift into different locale/route states.
