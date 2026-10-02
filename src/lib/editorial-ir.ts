import type { SiteLocale } from "./i18n";

export type EditorialRole = "prose" | "display" | "intro" | "compact" | "technical";
export type EditorialAtomKind = "han" | "latin" | "space" | "punctuation" | "other";
export type EditorialBreakReason =
  | "native-cjk"
  | "cjk-punctuation"
  | "space"
  | "hard-hyphen"
  | "number-latin"
  | "liang"
  | "budoux"
  | "editorial"
  | "art-direction";

export type EditorialAdjustmentKind =
  | "han-gap"
  | "han-latin-gap"
  | "word-space"
  | "punctuation";

export type DisplayBreakHint =
  | { word: string; after: string }
  | { afterText: string };

export interface EditorialAtom {
  /** UTF-16 offsets into the canonical source string. */
  start: number;
  end: number;
  kind: EditorialAtomKind;
  lang?: "en";
}

export interface EditorialBreakCandidate {
  /** UTF-16 offset immediately after the preceding source text. */
  offset: number;
  reasons: EditorialBreakReason[];
  /** Metric-independent semantic cost; runtime geometry is scored separately. */
  semanticPenalty: number;
  /** A lexical/typographic boundary that preferred breaks must never cancel out. */
  unsafe?: boolean;
  /** Render a visible hyphen only if this candidate becomes the chosen break. */
  hyphen?: boolean;
}

export interface EditorialAdjustmentOpportunity {
  /** UTF-16 boundary whose spacing may be adjusted. */
  offset: number;
  kind: EditorialAdjustmentKind;
}

export interface EditorialIRV1 {
  version: 1;
  locale: SiteLocale;
  role: EditorialRole;
  canonicalLength: number;
  atoms: EditorialAtom[];
  breaks: EditorialBreakCandidate[];
  adjustments: EditorialAdjustmentOpportunity[];
}

export interface CompiledEditorialText {
  canonicalText: string;
  ir: EditorialIRV1;
}

export interface EditorialPunctuationCompression {
  /** The owning canonical glyph and its text-facing boundary. */
  glyphStart: number;
  glyphEnd: number;
  offset: number;
  direction: "opening" | "closing";
  deltaPx: number;
}

export type EditorialLineAdjustment = {
  kind: Exclude<EditorialAdjustmentKind, "punctuation">;
  deltaPx: number;
  count: number;
} | {
  kind: "punctuation";
  deltaPx: number;
  /** Unique glyph count, not the number of candidate boundaries. */
  count: number;
  glyphs: EditorialPunctuationCompression[];
};

export interface EditorialLinePlan {
  /** UTF-16 range in canonical text. */
  start: number;
  end: number;
  hyphen: boolean;
  final: boolean;
  /** Logical inline advance before and after line-fit resources. */
  naturalAdvancePx: number;
  /** Discrete font-feature choices at canonical punctuation ranges. */
  punctuationHalts: Array<{ start: number; end: number }>;
  /** Browser-measured advance with selected halt features, before residual fitting. */
  postHaltAdvancePx: number;
  /** Effective reduction from the already-kerned native baseline, not glyph count times 0.5em. */
  haltCompressionPx: number;
  finalAdvancePx: number;
  /** Optical line measure is separate from logical advance so hanging never masquerades as compression. */
  naturalOpticalWidthPx: number;
  finalOpticalWidthPx: number;
  targetOpticalWidthPx: number;
  /** Signed mismatch: positive means the optical edge remains short of the target. */
  residualOpticalPx: number;
  /** Total inter-word adjustment across this line; Latin letter spacing is never used as a fitting resource. */
  wordSpaceDeltaPx: number;
  /** Residual manual compression after font shaping; excludes glyphs with halt selected. */
  punctuationCompressionPx: number;
  /** Additional per-Han-gap tracking for this line. Different lines may legitimately use different values. */
  cjkTrackingPx: number;
  hangingStartPx: number;
  hangingEndPx: number;
  /** Cost of fitting resources plus residual rag; semantic break cost is scored separately. */
  fitPenalty: number;
  adjustmentUtilisation: number;
  adjustments: EditorialLineAdjustment[];
}

export interface EditorialLayoutPlan {
  canonicalLength: number;
  targetWidthPx: number;
  lines: EditorialLinePlan[];
}
