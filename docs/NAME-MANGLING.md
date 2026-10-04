# Production name mangling

`build/name-mangling.mjs` is a site-specific Astro integration. It runs only on
production builds. Source SCSS and Astro class names remain semantic; development
and `astro check` do not run its transforms. Set `SITE_NAME_MANGLING=0` for an
unmangled diagnostic build. No mapping manifest or source map is published.

## JavaScript boundary

Vite 8.3.0 / Rolldown 1.2.9 already use Oxc 0.150.0 to shorten lexical identifiers.
The capability test confirms this with both the installed minifier and the actual
production bundle. There is no extra JavaScript minifier or lexical mangling pass.

Property mangling uses native Rolldown `output.minify.mangleProps` in Vite's
**client environment**. Astro 7 calls `astro:build:setup` once with `target=server`
while building multiple Vite environments, so gating on `target=client` would
silently do nothing. SSR/prerender properties retain their source names.

The anchored positive set contains eight fields:

| Owned record | Properties |
| --- | --- |
| `MotionContext` in `src/scripts/route-motion.ts` | `sourceRoot`, `sourcePrimaryRect`, `sourceSharedRects`, `writingLineMorph` |
| `MotionMeasurements` in that module | `primaryRect`, `sharedRects` |
| `WritingLineMorph` in `src/scripts/writing-line-transition.ts` | `sourceTitle`, `targetTitle` |

These are internal records passed between bundled site functions. All access is
direct; no record is serialized, stored, reflected over, attached to a browser
global, or exported to external code. `Object.entries(context.sourceSharedRects)`
enumerates the **RectMap's View Transition identity keys**, not MotionContext
field names. Those identity keys remain unchanged.

All other property names are preserved, including DOM/browser APIs, dataset
keys, CustomEvent detail, history state, theme storage, content/schema keys,
JSON-LD, and quoted contracts. Oxc's quoted reservation applies per occurrence,
so `quoted:false` alone cannot protect mixed quoted/unquoted use of a selected
name. The source audit rejects quoted uses of any selected field; emitted JS is
also checked for leftover selected names. See the
[Oxc property mangling contract](https://oxc.rs/docs/guide/usage/minifier/mangling).

Rolldown 1.2.9 refuses property mangling with multiple output chunks. That
restriction is retained and tested, rather than forcing all future bundles into
one chunk or inventing a cross-chunk cache protocol. Identical inputs produce
identical names; no persistent cache or prior build is needed.

## CSS and HTML boundary

The plan compiles the owned `src/styles/index.scss` entry with the installed
Sass, collects class selector AST nodes with Lightning CSS 1.33.0, and reserves
runtime contracts found in TypeScript and Astro script ASTs. Conservative literal
substring and template-prefix matches may reserve extra classes. Class attribute
selectors such as `[class~="name"]` also reserve the affected names.

The remaining classes receive `a..z,A..Z,aa,ab,...`, weighted by **CSS selector
occurrence count**, with ordinal spelling as a deterministic tie breaker. Existing
selector names and reservations are excluded from the replacement namespace.
This mapping is independent of content order, locale, and filesystem enumeration.

There are currently **181 renamed stylesheet classes and 20 reserved stylesheet
classes**. Examples include `fan-card -> a`, `prose -> g`, `icon -> h`, and
`selected-fan__track -> j`. Runtime selectors such as `.site-header`, `.site-nav`,
`.site-menu`, `.site-footer`, `.skip-link`, `article-head`, `is-active`, and
`theme-transition` retain their names. `writing-line-fragment` is created only by
runtime JS and remains intact as well.

The CSS visitor runs in Vite's **Lightning CSS transform stage**, after Sass and
before asset hashing. Vite explicitly removes visitors from its final CSS
minifier, so configuring a minifier visitor would be ineffective. The visitor
recurses through selector ASTs, including `:is`, `:not`, `:has`, and nested rules;
it changes only class nodes. CSS grammar is not parsed with regex.

`astro:build:generated` parses rendered HTML with parse5 and changes only the
source ranges of `class` attributes. It preserves text, other attributes, script
data, and asset references without reserializing the document. This covers SSR
`class:list`, component class props, conditionals, and tone template strings after
they have concrete values. Runtime JS class strings are reserved, so they need
no rewrite. An authored class that collides with a generated short name fails
the build instead of silently acquiring unrelated styles.

Hashed JS/CSS are **read but never modified** by the HTML hook. It rejects stale
class selector references, unreserved emitted JS/inline script contracts, inline
styles that escaped the CSS transform, selected properties that escaped native
mangling, and public source maps. JSON data scripts are preserved as data.

IDs and fragments, data/ARIA attributes, browser property names, View Transition
names and pseudo-element identities, CSS custom properties, and keyframe names
are outside the renamed namespace.

## Validation and measurements

Exact base: `f93b1e15494b88fda0cc5d61b5d3fc59a54e130c` (`origin/master` when this
branch was created). Its predecessor worktree was left intact: local `cd70ffe`
and remote `f93b1e1` have identical trees, differing in commit identity/message.
No typography branch or content source was incorporated.

The unchanged empty collections produce 5 HTML pages and 15 total output files.
Values below are bytes, summed **per file**. Gzip uses level 9; Brotli uses Node
zlib quality 11 as a transport proxy. These are local measurements, not measured
GitHub Pages transfer sizes.

| Output | Raw before -> after | Gzip before -> after | Brotli proxy before -> after |
| --- | ---: | ---: | ---: |
| JS | 26,230 -> 25,442 | 8,029 -> 7,946 | 7,215 -> 7,151 |
| CSS | 70,538 -> 55,821 | 12,464 -> 11,093 | 10,681 -> 9,715 |
| HTML | 37,318 -> 34,545 | 12,407 -> 11,841 | 9,808 -> 9,363 |
| Other assets/metadata | 16,110 -> 16,110 | 15,568 -> 15,568 | 15,166 -> 15,166 |
| **All output** | **150,196 -> 131,918** | **48,468 -> 46,448** | **42,870 -> 41,395** |

All-output savings are **18,278 raw bytes (12.17%)**, **2,020 gzip bytes (4.17%)**,
and **1,475 Brotli proxy bytes (3.44%)**. Within JS/CSS/HTML alone the reductions
are 13.63%, 6.14%, and 5.32%, respectively.

A narrow identity-transform capability control was run to isolate the required
parser path. Switching to Lightning CSS's transform stage with no renaming adds
581 raw CSS bytes / 80 gzip / 75 Brotli compared with the exact base. The final
figures above include that cost. Disabling the integration reproduces all 15
exact-base paths and SHA-256 digests. No generic minifier benchmark was repeated.

Completed checks:

- Normal `astro check && astro build`: the check reports zero
  errors/warnings/hints; the build succeeds with the expected empty-collection
  warnings.
- Seven installed-tool/parser/invariant tests, including quoted properties,
  nested/escaped selectors, template content, collisions, source maps,
  development bypass, and Rolldown's multiple-chunk rejection.
- Four Chromium Playwright tests against temporary bilingual content fixtures.
  Eight representative surfaces are pixel-identical to the unmangled build,
  including all four project tones. Soft navigation retains the document and
  Header, updates locale/canonical metadata, rebinds filter/theme controls, and
  positions fragments. Native View Transitions exercise the renamed records and
  runtime writing fragments, including cleanup. Unsupported-API and no-JS
  navigation also pass.
- The integrity build observes final `generateBundle` JS/CSS bytes after Vite's
  internal CSS hash marker removal, compares every byte with final disk output,
  and verifies all generated asset references resolve.
- Two separately materialized source copies, each installed with
  `pnpm install --frozen-lockfile` and built with `pnpm build`, emit identical
  filenames and SHA-256 digests for all 15 files. The Aube build matches too.
- HTML contract comparison allows only class values and correctly replaced
  hashed asset URLs to differ; all other nodes/attributes/text must match.
  Other output assets and metadata remain byte-identical.

The pnpm 12 lockfile previously contained only its package-manager document.
Its site-dependency document is now populated from the preserved Aube graph, so
the normal frozen CI install is usable. Existing package versions and snapshots
are preserved. Astro's compiler, Lightning CSS, and Vite are direct development
dependencies at their already installed versions; parse5 is the HTML parser, and
Playwright is test-only tooling.

## Reproduce

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm test:mangling
pnpm build:integrity
pnpm exec playwright install chromium
pnpm test:browser
pnpm stats
```

`test:browser` creates uniquely named test content with exclusive file creation,
builds an unmangled baseline and an integrity-checked mangled output, then removes
only the fixture files it created in `finally`. It never publishes the fixtures.
The last `dist` after this test contains fixture routes; run `pnpm build` again
before publishing to restore the ordinary empty-state output.

To compare a saved baseline, run
`node tests/output-contracts.mjs <baseline-directory> <output-directory>`.
`node scripts/output-stats.mjs <directory>` reports compression totals and
SHA-256 for every output path, allowing independent build comparisons.

## Extension limits

This is an audited optimization for the current site, not whole-program string
or ownership inference. Current constructed selectors use preserved data
attributes, CSS.escape, and View Transition identities. Arbitrary class-name
synthesis, selector construction from unrelated fragments, reflection over the
selected records, client libraries with similarly named properties, and future
browser-exposed contracts require explicit review and reservation before they
are added. Literal/template scans are conservative guards, not a proof for
arbitrary future JavaScript. New private properties should be added only after
their ownership and all access sites have been reviewed.

Cross-chunk property mangling, View Transition identity mangling, IDs/fragments,
dataset/content schemas, custom properties, and keyframes are deferred. Browser
validation is local Chromium; hosted deployment acceptance and other browser
engines remain separate checks.
