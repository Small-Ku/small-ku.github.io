# Motion system

The motion system is semantic before it is visual. A change only animates when motion communicates what changed, and each animation owns a specific class of properties rather than treating every interaction as navigation.

## Motion ownership

The site distinguishes four scopes:

| Scope | Meaning | Examples | May own |
| --- | --- | --- | --- |
| **interaction** | a local control reveals or changes local UI | Header popover open/close | local opacity and small local displacement |
| **state** | the same interface changes visual state | Light ↔ Dark | color, background, border and other effect properties |
| **representation** | the same semantic route is rendered in another representation | English ↔ Traditional Chinese | effect-only content handoff; no route geometry |
| **route** | navigation changes place or preserves a real shared object across places | Project card ↔ Project hero, Latest Writing ↔ Timeline | shared geometry, container transforms and authored wayfinding |

Ownership is property-based rather than a single global priority. Independent scopes may coexist when they do not claim the same property. For example, the Appearance popover may remain open while theme colors transition because interaction owns the local popover geometry and state owns color properties.

When scopes do compete, the broader semantic action takes ownership. A Language popover therefore relinquishes its local exit motion immediately when a locale navigation begins; the representation handoff starts without waiting for the popover to finish closing.

Stable site chrome does not claim route geometry. Header shell, brand, and utility controls remain spatially stable while authored route motion happens underneath them. Stable geometry does not mean identical paint: the Header surface is route-dependent state (Home uses the field tint; other routes use the canvas tint) and may hand that paint state across with effect-only motion. Locale changes keep the same route surface and may hand off localized Header navigation text, but they do not move the Header through space.

## Identity, wayfinding, and continuity

The route motion grammar has three responsibilities:

- **identity / transformation** — a project card surface, visual, or title may remain the same object across routes;
- **wayfinding** — route semantics decide which identities are meaningful, not a universal full-page slide;
- **interaction continuity** — active transitions can be interrupted, target scrolling is settled before capture, browser history can replay reverse/forward relationships, and fragment navigation remains deterministic under manual scroll restoration.

An un-authored route navigation remains effectively instant. There is no generic page slide or generic page dissolve.

## View Transition coordinator

The site remains an Astro multi-page SSG. When the browser supports `document.startViewTransition()`, same-origin links are soft-enhanced:

```text
click
→ identify the source action and semantic route
→ fetch destination static HTML
→ classify motion ownership
→ relinquish conflicting local interaction motion
→ startViewTransition() when an authored route or representation handoff exists
→ install destination main content and locale-sensitive site chrome
→ synchronize route-sensitive head/root metadata
→ position destination viewport instantly
→ identify destination counterparts
→ measure shared route geometry when applicable
→ derive route duration from distance + area ratio
→ animate the authored snapshots
```

This avoids depending on cross-document `pageswap` / `pagereveal` support and keeps Firefox on the same deterministic same-document path as other supporting browsers.

The destination document remains the authority for rendered chrome. Soft navigation imports the destination Header, Footer, and skip link rather than reconstructing locale state in client-side code. Root locale metadata (`lang`, `data-locale`) and route metadata are synchronized in the same update.

## Stable Header chrome

The Header is persistent chrome, not a route object. Soft navigation preserves the Header shell DOM element and synchronizes its destination children, allowing route-dependent background paint to behave as state on the same surface. Its shell, brand, and utility controls have stable View Transition identities and never receive route geometry.

The localized primary navigation is separately identifiable so a representation change can perform a short opacity handoff. That handoff is effect-only: no translate, scale, container transform, or directional travel is allowed.

Header actions follow their semantic scope:

- Brand and Timeline links participate in route semantics only when the coordinator has an authored relationship for that navigation; otherwise the route change is instant.
- Language opens as a local interaction, then switches to representation ownership when another locale is selected.
- Appearance opens as a local interaction; selecting a theme remains a state change and does not invoke route View Transition motion.

## Representation changes

A locale navigation is a representation change when source and destination have the same route kind and route id while `data-locale` differs. Classification is derived from the source and destination documents so Back/Forward traversal receives the same semantics as a direct Header click.

Representation motion uses `--ft-motion-representation` with `--ft-ease-representation` and only crossfades content representation. The root snapshot uses `plus-lighter` blending so complementary old/new opacity does not dim an otherwise unchanged canvas at the midpoint. The root content and localized Header navigation may hand off; Header shell, brand, and utility controls stay spatially stable. Representation motion never uses the dynamic route clock because no travel distance or area transformation is being represented.

A Header locale link carries `data-motion-intent="representation"` only as an early interaction hint. It lets the open Language popover relinquish immediately on click instead of waiting for destination HTML to be fetched. The fetched documents remain the authority for classifying the actual navigation.

## Navigation intent

Soft navigation acknowledges user intent before destination acquisition. Pointer/keyboard activation first marks the eligible source with `data-nav-pressed`; click promotes that source to `data-nav-pending` and marks the root with `data-navigation-state="pending"` before awaiting the destination. Destination fetching starts immediately. After the destination is classified, un-authored soft navigation waits for a three-animation-frame paint barrier so a cache hit cannot erase acknowledgement before the browser has an opportunity to paint it. Authored route/representation motion takes ownership immediately instead of paying that barrier. The barrier is skipped for hidden documents and reduced motion, and it never delays an already-slower network fetch. This feedback belongs to interaction continuity, not route motion.

The activating component owns the visual vocabulary. Home Timeline keeps its 1px hover underline, then strengthens the underline and moves its fixed-geometry directional icon on pressed/pending intent; Header brand/nav, text links, buttons, project rows, writing rows, and continuation rows map the same framework states onto their existing interaction language. `aria-current` remains navigation semantics rather than a persistent pending-like highlight. Under reduced motion state acknowledgement remains while directional/pressed displacement is removed.

Directional UI affordances use project-local SVG icons rather than font glyphs. Their viewBox, stroke, optical size, baseline box, and transform origin therefore remain stable across Windows, Android, iOS/macOS, and font fallback differences; typography-only marks remain text.

If acquisition exceeds 300ms the intent escalates to `busy` and the activating link exposes `aria-busy="true"`; a live-region loading announcement is delayed until 500ms so normal fast navigations do not create accessibility chatter. Once destination HTML is ready, pending/busy state is cleared before route or representation ownership begins.

Destination acquisition reuses one session-level Promise cache. Pointer hover and keyboard focus opportunistically prefetch eligible same-origin links, and primary Header navigation is prefetched during browser idle time. Prefetch reduces latency but never replaces immediate intent acknowledgement: cache misses and slow responses remain valid states.

Repeated acquisition of the same document, including URLs that differ only by fragment, reuses the same cached document Promise.

## State changes

Theme switching is an effect-only state change. Background, border, and foreground colors use effect-duration tokens and do not use spatial aliases, transforms, or `document.startViewTransition()`.

The Appearance popover is independent local interaction state, so it may remain open while the selected theme updates.

## Local interaction motion

Local controls may animate without participating in route identity, but they consume the shared vocabulary from `src/styles/tokens/_motion.scss`.

- **effect motion** covers opacity, color, and similar non-spatial state changes;
- **spatial motion** covers small geometric changes inside the current composition;
- component styles consume shared duration/easing tokens rather than introducing anonymous timing curves inline;
- entry and exit may use different timing when that improves legibility;
- a component interaction must not imply cross-route spatial identity unless it actually participates in the coordinator.

Header popovers combine opacity with a short vertical displacement from their trigger. They deliberately do not scale: zoom would imply a surface transformation stronger than the local disclosure relationship requires. Normal dismissals play the authored exit; a representation navigation disables that exit before closing the popover so ownership can transfer immediately.

## Project transform

A project navigation may pair:

```text
card surface  ↔ hero surface
card visual   ↔ hero visual
card title    ↔ hero title
```

The surface owns the large container transform. Shared visual/title groups stay above it. New-only project content is revealed after spatial ownership is clear. Selected-work fan placement is expressed in layout geometry (flex flow plus relative offsets); transforms are reserved for rotation and interaction scale, so a shared descendant never depends on an engine reconstructing a large translated ancestor offset to discover which card is left, center, or right.

Fan → Project entry uses the browser-generated shared-element animation unchanged: Chromium and Gecko both preserve the source card's signed fan angle on entry. Project → fan exit needs one correction after `transition.ready`: the restored destination card is the authority for `--fan-r`, and the existing `project-surface`, `project-visual`, and `project-title` `KeyframeEffect`s are rewritten in place so their generated translate/scale geometry keeps browser ownership while rotation progresses from `0deg` to that destination angle. No second animation or persistent override lifecycle is created; the corrected effect disappears with the View Transition pseudo-tree. Generated transforms may be serialized as `matrix(...)` or as a planar `matrix3d(...)`; both are accepted when the latter has no Z/perspective terms, while genuinely 3D matrices remain untouched.

Visual snapshots deliberately allow geometry squeeze plus crossfade when source and destination aspect ratios differ. Typography uses a crisper handoff rather than intentionally distorting glyphs.

When a Project card and its detail title render different line plans, their canonical text is segmented at the union of both grapheme-safe line boundaries. Those fragments share transition names while the Project surface and visual retain their existing groups. Matching line plans or a destination layout that changes after measurement uses the whole-title snapshot fallback. Writing identity uses the same title-line mechanism.

## Timeline portal

When latest writing exists, `View all in timeline` can pair the latest rows above the expanding timeline surface. Destination scroll is positioned before the new snapshot is captured so scrolling and shared-element movement do not race.

Back/Forward history traversals preserve the same relationship where the corresponding source/target object exists.

## Timeline hairline geometry

Timeline rules are layout relationships rather than icons. Every chronology spine segment therefore uses the same SVG stroke primitive: straight Writing/Project rails use `ChronologyRail`, while an L-shaped continuation connector uses one responsive path for its vertical rail, corner, and horizontal branch. All of them share the `chronology-stroke` contract and `vector-effect: non-scaling-stroke`, so a chronology cannot switch from a CSS 1px rectangle to a differently rasterized SVG stroke partway down the page. The path uses `shape-rendering="crispEdges"` together with the runtime `--ft-device-hairline` token. The token starts from an ideal 1 CSS px rule, rounds its physical thickness upward to a whole device-pixel count, then converts that count back to CSS pixels: `ceil(devicePixelRatio) / devicePixelRatio`. At 1.5 dppx this is 1.333… CSS px / exactly 2 physical pixels. Because the snapped stroke edges are separated by an integer physical width, vertical and horizontal thickness remains stable as fluid layout moves the connector across subpixel CSS positions.

The hairline token is established before first paint and is recomputed when the browser resolution media query changes (with window resize as a fallback), so browser zoom or moving the window between monitors with different DPR cannot leave stale raster thickness. The connector branch position is fixed by `--continuation-branch-offset`; the label line box is explicitly 1rem so its center shares that same Y authority. The label/action content masks the path with the canvas surface and preserves the same rail-to-right-label composition at every breakpoint. Mobile still uses its actual 12px grid gap and desktop its 16px gap, but the connector does not quantize the global page gutter with CSS `round()`: CSS-pixel rounding cannot guarantee device-pixel alignment at fractional DPR and should not perturb the responsive page grid merely to chase raster phase. Straight chronology rails may remain CSS rules when they have no perpendicular join to reconcile.

## Fragment navigation

The soft-navigation layer uses `history.scrollRestoration = "manual"`, so same-document fragments cannot be left half-managed by the browser and half-managed by the coordinator.

Fragment links keep normal URL/history semantics while the coordinator owns the scroll operation. The same rule applies to repeated activation of the current fragment and direct loads such as `/#latest-writing`: after layout settles, the target position is reasserted deterministically.

Fragment positioning is settled before a destination View Transition snapshot when a soft navigation itself includes a fragment.

## Dynamic route duration

The coordinator derives one route clock from the largest relevant matched movement. It combines:

- center-to-center travel normalized by viewport diagonal;
- logarithmic source/target area ratio.

The result is clamped to a bounded range so large displays do not produce excessively slow transitions. CSS consumes the runtime value through `--ft-motion-route`.

Representation, state, and interaction motion do not borrow this geometry-derived clock.

## Reduced motion

`prefers-reduced-motion: reduce` keeps navigation, state, and representation semantics while collapsing authored durations and removing supporting displacement. A locale switch still reaches the localized destination, theme selection still updates state, and popover semantics remain intact; only the animated handoff is removed.

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
