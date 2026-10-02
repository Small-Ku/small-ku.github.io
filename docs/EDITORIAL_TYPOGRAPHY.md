# Editorial typography architecture

The typography system is an editorial line planner, not a BudouX wrapper and not generic full justification. It starts from canonical multilingual DOM, precomputes language-aware opportunities, measures the visitor's real browser geometry, and chooses the least intrusive line plan that satisfies the editorial policy.

Issue #4 is the typography authority and Issue #5 / `docs/MOTION.md` own the transition semantics. Prototype implementation details are not requirements.

## Core invariant

`LinePlan` is the typography truth.

Persistent `.editorial-composed-line` elements are disposable renderer output. They may exist while the current renderer needs exact breaks or per-line adjustments, but they are not line identity, not canonical content, and not a motion API.

The target flow is:

```text
canonical multilingual DOM
  -> build-time language-aware opportunities
  -> runtime computed font + container geometry
  -> abstract LinePlan
  -> browser-native layout first
  -> minimal reversible presentation materialization only when required
  -> live visual-line geometry
```

Metadata, accessibility, copy, search, and no-JavaScript rendering use canonical content. Presentation-only materialization must be reversible.

### Runtime module ownership

The browser runtime keeps those stages separate rather than treating composition as one DOM-mutating routine:

- `editorial-composer.ts` is the thin lifecycle facade: root orchestration, resize scheduling, and observer binding.
- `editorial-composer-policy.ts` owns runtime eligibility and IR/role/locale validation.
- `editorial-composer-geometry.ts` owns browser measurement, inline targets, live native-line geometry, and native-first acceptance.
- `editorial-composer-solver.ts` owns candidate fitting, penalties, Pareto pruning, and `LinePlan` selection; it does not mutate the live root.
- `editorial-composer-renderer.ts` owns reversible presentation materialization and canonical-DOM restoration.
- `editorial-composer-inline.ts` constructs matching multilingual inline runs for candidate measurement and rendering, including selected font-feature boundaries.

The dependency direction is policy/geometry -> solver -> renderer orchestration. Renderer state must not become input to solving, and motion must continue reading live `Range` geometry rather than importing renderer line identity.

## Why final widths stay runtime

The site uses a system font stack and responsive `clamp()`, `cqi`, `ch`, and `ic` measures. Glyph advances therefore depend on the visitor's OS font, shaping engine, browser, computed size, and container width.

Build time must not bake one Windows/Chromium pixel plan into static HTML. What build time can safely precompute is language structure: UTF-16 source ranges, legal breaks, semantic preferences, and adjustment opportunities.

No BudouX model or hyphenation dictionary belongs in the production browser bundle.

## Role policy

| Role | Runtime policy | Intent |
| --- | --- | --- |
| display | custom metric-aware planning | Exact editorial break selection is worth a small solver. |
| intro | browser-native first, planner when native geometry violates policy | Keep natural browser layout when it is already acceptable. |
| prose | English native-first; Traditional Chinese optical planning where needed | English keeps natural rag. Traditional Chinese may use bounded line-local fitting. |
| compact | native | Avoid ordinary discretionary hyphenation and fitting machinery for labels/cards. |
| technical | native emergency wrapping | URLs, code, and identifiers are not editorial prose. |

English and Traditional Chinese deliberately use different objectives. English may leave several em of natural right-edge variation. Traditional Chinese has a much tighter optical-edge tolerance. The final line is naturally ragged in both languages and is not required to be the shortest line.

For roles whose profile sets `nativeFirst: true`, native layout is accepted only when it already satisfies policy. Overflow, unknown/unsafe line breaks, semantic penalties of 4 or greater, or explicit art-direction force the planner. English intro keeps any otherwise-legal native rag. Traditional Chinese intro/prose additionally require every non-final native visual line to fall within the role's `residualToleranceEm` (with only a subpixel allowance); otherwise the custom optical solver runs. `display` remains planner-owned because its profile is not native-first.

## Editorial IR and LinePlan

All source offsets are UTF-16 code-unit offsets so they match DOM Range offsets and the motion geometry code.

The build-time IR contains:

- canonical atoms and language/script classification;
- legal break candidates and their reasons;
- semantic penalties/preferences;
- adjustment opportunities at canonical boundaries.

A discretionary English hyphen is represented by a legal break candidate with `hyphen: true`. Canonical text never contains U+00AD.

A runtime `LinePlan` separates logical layout from optical appearance. It records, per line:

- canonical `start` / `end` and whether a real hyphen is selected;
- natural and final logical advance;
- natural and final optical width;
- target optical width and signed optical residual;
- total word-space adjustment;
- punctuation compression;
- selected on/off `halt` punctuation ranges, the measured post-`halt` advance, and its effective reduction from native shaping;
- per-Han-gap line-local tracking;
- start/end hanging;
- fit penalty and adjustment utilisation.

Logical advance, punctuation compression, and hanging are intentionally separate. Hanging must never be faked by silently changing logical width.

## Break legality and hyphenation

Hard constraints are feasibility rules, not aesthetic penalties. A plan is rejected when it would overflow after permitted shrink resources are exhausted, violate Chinese line-start/line-end punctuation legality, split a protected compact token, create an avoidable one-Han display line, exceed the line-count guard, lose canonical source mapping, or display an English hyphen at anything other than a real language-aware hyphenation point.

English rules:

- short headings may hyphenate;
- proper nouns may hyphenate when the language-aware engine exposes a real opportunity;
- consecutive hyphenated lines are allowed;
- abbreviations/initialisms are excluded from discretionary hyphenation;
- a number-to-Latin or Latin-to-number boundary may break without a visible hyphen;
- a visible hyphen appears only when the chosen break is a true hyphenation opportunity.

Author hints are preferences over existing legal opportunities. They do not manufacture arbitrary intra-word breaks. A `word + after` hint may prefer an already-emitted language-aware hyphenation point; an `afterText` hint may prefer an existing phrase/boundary opportunity.

## Fit and scoring model

The solver keeps a bounded Pareto set rather than treating every non-final line as a justification target.

Unsafe breaks remain infeasible/near-hard. Explicit art-direction preferences remain strong. After that, semantic break cost and geometric fit cost compete: a legal hyphen may beat grotesquely stretched English spacing, and a slightly weaker Chinese phrase boundary may beat excessive tracking.

### English

Latin glyphs are never tracked to fit a line.

Natural rag is cheap. Word-space adjustment has a nonlinear rising penalty, currently cubic for positive stretch. Rag outside the role's free-rag band also increases nonlinearly.

The emergency hard ceiling for one positive word-space adjustment is:

```text
min(5em, shortest rendered word width on that line)
```

The shortest word is measured in the actual rendered font, not by character count. This is a feasibility ceiling, not a normal target. A several-em natural rag should normally beat conspicuous inter-word gaps.

Shrink is also bounded. The exact comfort bands and role tuning values live in `src/lib/editorial-constraints.ts`; changing those values must not require changing solver architecture.

### Traditional Chinese

For a non-final line, spend resources in this order:

```text
better break
  -> measured discrete halt candidates
  -> residual punctuation compression / optical hanging
  -> line-local CJK tracking
  -> small residual optical mismatch
```

CJK tracking is a line-fitting resource, not a component-wide design value. Different lines may use different tracking; what stays consistent is the role budget.

Latin runs inside Chinese text still receive no intra-Latin fitting and Han-Latin boundaries are not used as a generic stretch resource.

## Punctuation and hanging

Punctuation has distinct concepts:

- logical advance: layout width before optical treatment;
- compression: advance-width reduction toward adjacent text;
- hanging: optical overhang beyond the nominal line edge.

Traditional Chinese punctuation compression is capped at **0.5em per punctuation glyph**. Opening punctuation compresses toward following text; closing punctuation compresses toward preceding text.

Hanging has separate `LinePlan` fields and budget. It is now a real fitting resource after punctuation compression and before CJK tracking shrink. Start hanging shifts the whole materialized line run toward inline-start while preserving internal glyph advances; end hanging leaves the line run in normal flow and permits only the plan-owned terminal optical overflow. Selected discretionary hyphens may use the same bounded end-hang resource. Compression and hanging therefore remain separate both in the plan and in presentation.

The Chinese URL/content locale remains `zh` under `/zh/`; document language is explicitly `zh-HK` so `locl` selects Hong Kong forms. `hreflang` is `zh-HK`, Open Graph locale is `zh_HK`, and structured data uses the document language. Traditional Chinese editorial roots/prose use the punctuation-only Zhudou Sans ahead of the normal sans fallback, with native `kern` and `locl` enabled; English runs retain the normal sans stack. Font settlement invalidates measurement and triggers canonical-DOM re-composition.

`halt` is an experimental binary font resource for eligible full-width CJK punctuation. It selects a 0.5em alternate advance for each affected glyph; it is never interpolated and is never globally enabled. The solver keeps the native-shaped candidate, then considers selected punctuation ranges only on overflowing non-final CJK candidates, accepting a feature choice only when its fitting cost improves. Final lines, compact/technical text, Latin text, and hard hyphens never receive planned `halt`.

Every candidate is measured as a complete multilingual inline sequence with `kern`/`locl` still enabled. `haltCompressionPx` is the browser-measured native-to-selected difference, not glyph count multiplied by 0.5em: native kerning, font fallback, and feature boundaries can change that difference. The prototype considers up to eight punctuation clusters, their individual on/off alternatives, and bounded multi-cluster combinations. Impossible candidates are pruned using an optimistic resource bound; final savings always come from browser measurement.

Some font/engine combinations kern half-width alternates again, reducing a selected pair below its combined half-width advances. Such candidates are rejected using live Range geometry, with an allowance for component-authored tracking and subpixel rounding; kerning is not disabled to manufacture a usable resource. The measurement box and final renderer share `editorial-composer-inline.ts` so language and selected feature boundaries match exactly.

Residual manual compression and hanging are fitted only after measuring the selected font result. Halt-selected glyphs have no additional manual compression budget. Other consecutive punctuation remains native-shaped and is excluded from manual compression; residual manual compression is restricted to isolated punctuation boundaries. `punctuationCompressionPx` records only that residual manual reduction, while `postHaltAdvancePx` records the font-shaped baseline on which it operates. Regional glyph selection remains separate from fitting policy.

Browser-native `text-spacing-trim` is progressive enhancement for native layout. Custom candidate measurement and materialized lines both explicitly use `text-spacing-trim: space-all` so the solver measures the same baseline that the renderer uses. The custom path must not also apply an independent `chws`/trim resource that the solver did not account for.

A selected presentation hyphen may hang optically within its 0.5em budget. The hyphen remains generated/presentation-only, so neither the hyphen nor generated line-break content alters canonical selection or clipboard text.

## Runtime metric cache

Token measurement depends on computed typography, not on a precompiled platform assumption. A measurement cache key must include enough state to invalidate shaping changes, including:

- font family;
- font size;
- font weight;
- font stretch/style;
- letter spacing;
- font kerning/features/variant/variation settings;
- language;
- role.

Container inline size is not part of token measurement. It selects and solves a plan from measured token advances.

Resize and font settlement may trigger re-solving. Coalesce resize work and restore canonical DOM before re-materializing so the composer never measures its own old presentation structure as source content.

## DOM and serialization

`EditorialText.astro` is the server boundary for editorial display/intro text. It compiles canonical text to IR, renders canonical-language content, and serializes only the compact IR needed by the browser.

The Traditional Chinese prose rehype transform remains build-time-only. It annotates eligible plain paragraphs with IR and language spans; it must not turn arbitrary rich prose structure into a second canonical serialization.

The current renderer still materializes inline line wrappers plus language/adjustment runs to express selected boundaries. Per-code-point wrapping has been removed, and selected line breaks are now forced by presentation-only generated newlines rather than block boxes. That keeps native selection and clipboard text canonical while preserving the same measured visual-line geometry. The old `editorial-copy.ts` compensation is no longer bound into production; its dirty prototype file is retained locally only to respect worktree-preservation constraints. The remaining line/run materialization is still presentation output rather than architecture truth and should continue shrinking where browser-native layout can express the selected `LinePlan`.

## Motion ownership

Typography owns final live geometry; motion does not own or trust typography wrappers.

Writing transitions re-derive actual visual lines from the live DOM using grapheme-safe `Range.getClientRects()`. `LinePlan` may explain why the renderer produced those lines, but transition segmentation uses measured visual geometry.

Visual-line detection compares the central vertical bands of glyph Range boxes rather than requiring identical tops: multilingual fallback fonts can have different ascents on the same baseline. Typography's native acceptance and motion use the same geometric rule. Temporary fragments retain component-authored tracking; tracking is never normalized to compensate for segmentation.

The motion invariant is:

```text
canonical DOM
  -> opportunities
  -> runtime geometry
  -> LinePlan
  -> optional presentation renderer
  -> live Range geometry
  -> M:N transition fragments
```

If measured geometry disagrees with the expected layout, motion falls back to measured ranges or opacity/translation handoff rather than distorting glyphs. Scroll intent still wins and skips the transition.

Presentation hyphens are temporary, aria-hidden, and excluded from canonical copy. Cleanup must restore the canonical DOM exactly.

## Acceptance and browser review

Acceptance is expressed as generic invariants, not named-string golden line breaks.

The browser harness should verify across routes, roles, locales, and viewports:

- canonical length remains unchanged;
- no U+00AD, U+200B, or U+2060 leaks into canonical/presentation text;
- no inline/intra-Latin letter tracking is introduced by the composer;
- English positive word-space adjustment stays below `min(5em, shortest rendered word width)`;
- Han-Latin fitting is not used as a generic resource;
- CJK Han-gap adjustment stays within the role budget;
- punctuation compression stays toward text and no more than 0.5em per glyph;
- start/end hanging stays within the 0.5em role budget, any local overflow is no larger than the owning hang allowance, and the page itself gains no horizontal overflow;
- non-final CJK layout-box/edge metrics are reported without pretending raw box width is final optical acceptance once hanging exists;
- resize/font settlement can re-solve;
- copy/selection remains canonical;
- M:N motion, cleanup, and scroll interruption remain stable.

Metrics do not decide beauty. Human screenshots remain required for English rag rhythm, Chinese optical edge comfort, punctuation colour, and the sharpness of the final live-DOM motion handoff.

Primary review engines are Thorium/Chromium via CDP and SkyKakapo/Gecko via WebDriver BiDi. Do not add a full browser-test framework merely for these checks.

## Temporary fixtures and artifacts

Local bilingual review fixtures use the `typography-fixture*.md` convention and remain temporary/draft content. They are review corpus, not acceptance or production content.

Temporary fixtures, screenshots, JSON reports, logs, HARs, and browser harnesses live under `.editorial-review/` (or the established local fixture paths) and are excluded only through the checkout's `.git/info/exclude`. Do not add them to repository `.gitignore`.

## Dependency and build policy

The application dependency graph is owned by `aube-lock.yaml`; do not regenerate `pnpm-lock.yaml` as the application lock.

Known production validation command:

```powershell
mise x aube@2.2.17 -- aube run build
```
