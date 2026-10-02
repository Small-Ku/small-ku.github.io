import { EDITORIAL_FIT_PROFILES, editorialFitMode, type EditorialFitProfile } from "../lib/editorial-constraints";
import { isHaltPunctuation, residualCjkPunctuationOpportunities, isClosingCjkPunctuation, isOpeningCjkPunctuation } from "../lib/editorial-punctuation";
import type {
  EditorialAdjustmentKind,
  EditorialIRV1,
  EditorialLinePlan,
  EditorialLayoutPlan,
  EditorialRole
} from "../lib/editorial-ir";
import { editorialMeasurementContext, editorialStyleSignature, measureEditorialInline, measureEditorialText } from "./editorial-composer-geometry";
import type { PunctuationHalts } from "./editorial-composer-inline";

interface Candidate {
  offset: number;
  semanticPenalty: number;
  hyphen: boolean;
  artDirected: boolean;
  unsafe: boolean;
}

interface PathState {
  at: number;
  lines: EditorialLinePlan[];
  maxUtil: number;
  totalResidual: number;
  totalFitPenalty: number;
  semantic: number;
  unsafeBreaks: number;
  artDirectedBreaks: number;
  hyphens: number;
  finalShort: number;
}
const punctuationSegmenter = new Intl.Segmenter("zh-HK", { granularity: "grapheme" });
function adjustmentCount(
  text: string,
  ir: EditorialIRV1,
  start: number,
  end: number,
  kind: EditorialAdjustmentKind,
  halts: PunctuationHalts = []
): number {
  if (kind === "punctuation") return residualCjkPunctuationOpportunities(text, ir.adjustments, start, end, halts).length;
  return ir.adjustments.filter((point) =>
    point.kind === kind
    && point.offset > start
    && point.offset < end
  ).length;
}

function shortestRenderedWordWidth(
  text: string,
  start: number,
  end: number,
  measure: (start: number, end: number) => number
): number {
  const slice = text.slice(start, end);
  const token = /\p{L}[\p{L}\p{M}\p{N}]*(?:[’'\-][\p{L}\p{M}\p{N}]+)*/gu;
  let shortest = Number.POSITIVE_INFINITY;
  for (const match of slice.matchAll(token)) {
    const from = start + (match.index ?? 0);
    shortest = Math.min(shortest, measure(from, from + match[0].length));
  }
  return shortest;
}

function powerPenalty(value: number, scale: number, exponent: number): number {
  if (value <= 0) return 0;
  return Math.pow(value / Math.max(0.001, scale), exponent);
}

function makeLinePlan(
  start: number,
  end: number,
  hyphen: boolean,
  final: boolean,
  target: number,
  naturalAdvance: number,
  wordSpaceDeltaPx: number,
  punctuationCompressionPx: number,
  cjkTrackingPx: number,
  hanGapCount: number,
  hangingStartPx: number,
  hangingEndPx: number,
  fitPenalty: number,
  adjustmentUtilisation: number,
  adjustments: EditorialLinePlan["adjustments"]
): EditorialLinePlan {
  const finalAdvancePx = naturalAdvance
    + wordSpaceDeltaPx
    - punctuationCompressionPx
    + cjkTrackingPx * hanGapCount;
  const naturalOpticalWidthPx = naturalAdvance;
  const finalOpticalWidthPx = finalAdvancePx - hangingStartPx - hangingEndPx;
  return {
    start,
    end,
    hyphen,
    final,
    naturalAdvancePx: naturalAdvance,
    punctuationHalts: [],
    postHaltAdvancePx: naturalAdvance,
    haltCompressionPx: 0,
    finalAdvancePx,
    naturalOpticalWidthPx,
    finalOpticalWidthPx,
    targetOpticalWidthPx: target,
    residualOpticalPx: target - finalOpticalWidthPx,
    wordSpaceDeltaPx,
    punctuationCompressionPx,
    cjkTrackingPx,
    hangingStartPx,
    hangingEndPx,
    fitPenalty,
    adjustmentUtilisation,
    adjustments
  };
}

function fitEnglishLine(
  text: string,
  ir: EditorialIRV1,
  start: number,
  end: number,
  hyphen: boolean,
  final: boolean,
  target: number,
  naturalAdvance: number,
  hyphenWidth: number,
  host: HTMLElement,
  style: CSSStyleDeclaration,
  profile: EditorialFitProfile,
  measure: (start: number, end: number) => number
): EditorialLinePlan | null {
  const em = parseFloat(style.fontSize) || 16;
  const wordSpaces = adjustmentCount(text, ir, start, end, "word-space");
  const budget = profile.english;
  const spaceWidth = wordSpaces
    ? measureEditorialText(host, " ", "en", editorialStyleSignature(style, "en", "space"), style)
    : 0;
  const rawOverflow = Math.max(0, naturalAdvance - target);
  const hyphenHangCapacity = hyphen
    ? Math.min(budget.maxHyphenHangEm * em, hyphenWidth)
    : 0;
  const hangingEndPx = Math.min(rawOverflow, hyphenHangCapacity);
  const hangingUtilisation = hyphenHangCapacity > 0 ? hangingEndPx / hyphenHangCapacity : 0;
  const hangingPenalty = powerPenalty(hangingUtilisation, 1, 2) * 0.15;
  const overflow = Math.max(0, rawOverflow - hangingEndPx);
  const adjustments: EditorialLinePlan["adjustments"] = [];

  if (overflow > 0) {
    const shrinkCapacity = wordSpaces * spaceWidth * (1 - budget.minWordSpaceShrinkRatio);
    if (overflow > shrinkCapacity + 0.25) return null;
    const wordSpaceDeltaPx = -overflow;
    if (wordSpaces && wordSpaceDeltaPx) {
      adjustments.push({ kind: "word-space", deltaPx: wordSpaceDeltaPx, count: wordSpaces });
    }
    const utilisation = shrinkCapacity > 0 ? Math.min(1, overflow / shrinkCapacity) : 0;
    return makeLinePlan(
      start, end, hyphen, final, target, naturalAdvance,
      wordSpaceDeltaPx, 0, 0, 0, 0, hangingEndPx,
      powerPenalty(utilisation, 1, 2) + hangingPenalty,
      Math.max(utilisation, hangingUtilisation),
      adjustments
    );
  }

  if (final || naturalAdvance >= target) {
    return makeLinePlan(
      start, end, hyphen, final, target, naturalAdvance,
      0, 0, 0, 0, 0, hangingEndPx,
      hangingPenalty, hangingUtilisation, adjustments
    );
  }

  const deficit = target - naturalAdvance;
  const freeRagPx = budget.freeRagEm * em;
  if (wordSpaces === 0) {
    const ragPenalty = powerPenalty(
      Math.max(0, deficit - freeRagPx),
      Math.max(em, freeRagPx),
      budget.ragPenaltyExponent
    );
    return makeLinePlan(
      start, end, hyphen, final, target, naturalAdvance,
      0, 0, 0, 0, 0, 0,
      ragPenalty, 0, adjustments
    );
  }

  const shortestWord = shortestRenderedWordWidth(text, start, end, measure);
  const hardPerSpace = Math.min(
    budget.emergencyWordSpaceExtraEm * em,
    Number.isFinite(shortestWord) ? shortestWord : budget.emergencyWordSpaceExtraEm * em
  );
  const hardTotal = wordSpaces * hardPerSpace;
  const comfortPerSpace = Math.min(budget.comfortableWordSpaceExtraEm * em, hardPerSpace);
  const maxStretch = Math.min(deficit, hardTotal);

  let bestStretch = 0;
  let bestPenalty = powerPenalty(Math.max(0, deficit - freeRagPx), Math.max(em, freeRagPx), budget.ragPenaltyExponent);
  const candidates = new Set<number>([0, maxStretch]);
  candidates.add(Math.min(maxStretch, comfortPerSpace * wordSpaces));
  candidates.add(Math.min(maxStretch, Math.max(0, deficit - freeRagPx)));
  for (let step = 1; step < 24; step += 1) candidates.add(maxStretch * step / 24);

  for (const stretch of candidates) {
    const perSpace = stretch / wordSpaces;
    const spacingPenalty = powerPenalty(perSpace, Math.max(0.01 * em, comfortPerSpace), budget.wordSpacePenaltyExponent);
    const remainingRag = Math.max(0, deficit - stretch);
    const ragPenalty = powerPenalty(
      Math.max(0, remainingRag - freeRagPx),
      Math.max(em, freeRagPx),
      budget.ragPenaltyExponent
    );
    const penalty = spacingPenalty + ragPenalty;
    if (penalty + 1e-6 < bestPenalty) {
      bestPenalty = penalty;
      bestStretch = stretch;
    }
  }

  if (bestStretch > 0) adjustments.push({ kind: "word-space", deltaPx: bestStretch, count: wordSpaces });
  const utilisation = hardTotal > 0 ? Math.min(1, bestStretch / hardTotal) : 0;
  return makeLinePlan(
    start, end, hyphen, final, target, naturalAdvance,
    bestStretch, 0, 0, 0, 0, 0,
    bestPenalty,
    utilisation,
    adjustments
  );
}

function fitCjkLine(
  text: string,
  ir: EditorialIRV1,
  start: number,
  end: number,
  hyphen: boolean,
  final: boolean,
  target: number,
  naturalAdvance: number,
  hyphenWidth: number,
  style: CSSStyleDeclaration,
  profile: EditorialFitProfile,
  measure: (start: number, end: number) => number,
  halts: PunctuationHalts = []
): EditorialLinePlan | null {
  const em = parseFloat(style.fontSize) || 16;
  const budget = profile.cjk;
  const punctuation = residualCjkPunctuationOpportunities(text, ir.adjustments, start, end, halts).map(point => ({
    ...point,
    // An ambiguous, narrow quote must not acquire a negative logical advance.
    // Ordinary punctuation retains its existing half-em capacity.
    capacity: point.ambiguous
      ? Math.max(0, Math.min(budget.maxPunctuationCompressionEm * em, measure(point.glyphStart, point.glyphEnd)))
      : budget.maxPunctuationCompressionEm * em
  }));
  const punctuationCount = punctuation.length;
  const hanGapCount = adjustmentCount(text, ir, start, end, "han-gap");
  const punctuationCapacity = punctuation.reduce((total, point) => total + point.capacity, 0);
  const trackingExpandCapacity = hanGapCount * budget.maxTrackingExpandEm * em;
  const trackingShrinkCapacity = hanGapCount * budget.maxTrackingShrinkEm * em;
  const glyphs = Array.from(text.slice(start, end));
  const firstGlyph = glyphs[0] ?? "";
  const lastGlyph = glyphs.at(-1) ?? "";
  const startHangCapacity = firstGlyph && isOpeningCjkPunctuation(firstGlyph)
    ? Math.min(budget.maxPunctuationHangEm * em, measure(start, start + firstGlyph.length))
    : 0;
  const endHangCapacity = hyphen
    ? Math.min(profile.english.maxHyphenHangEm * em, hyphenWidth)
    : lastGlyph && isClosingCjkPunctuation(lastGlyph)
      ? Math.min(budget.maxPunctuationHangEm * em, measure(end - lastGlyph.length, end))
      : 0;
  const adjustments: EditorialLinePlan["adjustments"] = [];

  let punctuationCompressionPx = 0;
  let cjkTrackingPx = 0;
  let hangingStartPx = 0;
  let hangingEndPx = 0;
  let remaining = target - naturalAdvance;
  let punctuationUtilisation = 0;
  let trackingUtilisation = 0;

  if (remaining < 0) {
    let overflow = -remaining;
    punctuationCompressionPx = Math.min(overflow, punctuationCapacity);
    overflow -= punctuationCompressionPx;
    if (punctuationCompressionPx > 0) {
      adjustments.push({
        kind: "punctuation", deltaPx: -punctuationCompressionPx, count: punctuationCount,
        glyphs: punctuation.map(point => ({
          glyphStart: point.glyphStart, glyphEnd: point.glyphEnd, offset: point.offset, direction: point.direction,
          deltaPx: -punctuationCompressionPx * point.capacity / punctuationCapacity
        }))
      });
      punctuationUtilisation = punctuationCapacity > 0 ? punctuationCompressionPx / punctuationCapacity : 0;
    }

    if (overflow > 0 && endHangCapacity > 0) {
      hangingEndPx = Math.min(overflow, endHangCapacity);
      overflow -= hangingEndPx;
    }
    if (overflow > 0 && startHangCapacity > 0) {
      hangingStartPx = Math.min(overflow, startHangCapacity);
      overflow -= hangingStartPx;
    }
    if (overflow > 0 && hanGapCount > 0) {
      const trackingShrink = Math.min(overflow, trackingShrinkCapacity);
      cjkTrackingPx = -trackingShrink / hanGapCount;
      overflow -= trackingShrink;
      if (trackingShrink > 0) {
        adjustments.push({ kind: "han-gap", deltaPx: -trackingShrink, count: hanGapCount });
        trackingUtilisation = trackingShrinkCapacity > 0 ? trackingShrink / trackingShrinkCapacity : 0;
      }
    }
    if (overflow > 0.25) return null;
  } else if (!final && remaining > 0 && hanGapCount > 0) {
    const trackingExpand = Math.min(remaining, trackingExpandCapacity);
    cjkTrackingPx = trackingExpand / hanGapCount;
    if (trackingExpand > 0) {
      adjustments.push({ kind: "han-gap", deltaPx: trackingExpand, count: hanGapCount });
      trackingUtilisation = trackingExpandCapacity > 0 ? trackingExpand / trackingExpandCapacity : 0;
    }
  }

  const hangingUtilisation = Math.max(
    startHangCapacity > 0 ? hangingStartPx / startHangCapacity : 0,
    endHangCapacity > 0 ? hangingEndPx / endHangCapacity : 0
  );
  const provisional = makeLinePlan(
    start, end, hyphen, final, target, naturalAdvance,
    0, punctuationCompressionPx, cjkTrackingPx, hanGapCount, hangingStartPx, hangingEndPx,
    0, Math.max(punctuationUtilisation, hangingUtilisation, trackingUtilisation), adjustments
  );

  const residual = final ? 0 : Math.max(0, Math.abs(provisional.residualOpticalPx) - budget.residualToleranceEm * em);
  const fitPenalty =
    powerPenalty(punctuationUtilisation, 1, 2) * 0.25
    + powerPenalty(hangingUtilisation, 1, 2) * 0.45
    + powerPenalty(trackingUtilisation, 1, 2) * 2
    + powerPenalty(residual, Math.max(0.02 * em, budget.residualToleranceEm * em), 2) * 8;

  return { ...provisional, fitPenalty };
}

/** Search a bounded set of on/off punctuation clusters. Every alternative is
 * measured with native kern/locl still enabled; no 0.5em savings are summed. */
function fitCjkWithHalt(
  text: string, ir: EditorialIRV1, start: number, end: number,
  hyphen: boolean, final: boolean, target: number, naturalAdvance: number, hyphenWidth: number,
  style: CSSStyleDeclaration, profile: EditorialFitProfile,
  measure: (start: number, end: number) => number,
  measureInline: (start: number, end: number, halts?: PunctuationHalts) => number
): EditorialLinePlan | null {
  let best = fitCjkLine(text, ir, start, end, hyphen, final, target, naturalAdvance, hyphenWidth, style, profile, measure);
  // Halt never changes a final line or an already-short candidate. Native
  // shaping remains the cheapest choice when discrete compression cannot help.
  if (final || naturalAdvance <= target || !style.fontFamily.includes("Zhudou Sans")) return best;
  if (best && best.fitPenalty < 0.08) return best;
  const em = parseFloat(style.fontSize) || 16;
  const groups: PunctuationHalts = [];
  for (const part of punctuationSegmenter.segment(text.slice(start, end))) {
    const glyph = part.segment;
    const offset = start + part.index;
    const atom = ir.atoms.find(candidate => offset >= candidate.start && offset < candidate.end);
    if (isHaltPunctuation(glyph) && !atom?.lang) {
      const previous = groups.at(-1);
      if (previous?.end === offset) previous.end += glyph.length;
      else groups.push({ start: offset, end: offset + glyph.length });
    }
  }
  const boundedGroups = groups.slice(0, 8);
  const haltCapacity = boundedGroups.reduce((sum, range) => sum + (range.end - range.start) * 0.5 * em, 0);
  const residualCapacity = adjustmentCount(text, ir, start, end, "punctuation") * profile.cjk.maxPunctuationCompressionEm * em
    + adjustmentCount(text, ir, start, end, "han-gap") * profile.cjk.maxTrackingShrinkEm * em
    + 2 * profile.cjk.maxPunctuationHangEm * em;
  // Optimistic upper bound only prunes impossible candidates; actual savings
  // and the selected plan still come from whole-sequence browser measurement.
  if (naturalAdvance - target > haltCapacity + residualCapacity + 0.25) return best;
  const alternatives = boundedGroups.map(group => ({
    group,
    advance: measureInline(start, end, [group]) + (hyphen ? hyphenWidth : 0)
  })).filter(choice => choice.advance < naturalAdvance - 0.25);

  const consider = (halts: PunctuationHalts, advance: number) => {
    const reduction = naturalAdvance - advance;
    const glyphCount = halts.reduce((sum, range) => sum + Array.from(text.slice(range.start, range.end)).length, 0);
    // Feature selection is binary. Reject unexpected metrics instead of
    // interpreting halt as a continuously adjustable advance reduction.
    if (reduction <= 0.25 || reduction > glyphCount * 0.5 * em + 0.5) return;
    const shapedMeasure = (from: number, to: number) => measureInline(from, to, halts);
    const fitted = fitCjkLine(text, ir, start, end, hyphen, final, target, advance, hyphenWidth, style, profile, shapedMeasure, halts);
    if (!fitted) return;
    const fitPenalty = fitted.fitPenalty + 0.08 * glyphCount;
    if (best && fitPenalty >= best.fitPenalty - 0.0001) return;
    best = {
      ...fitted,
      naturalAdvancePx: naturalAdvance,
      naturalOpticalWidthPx: naturalAdvance,
      punctuationHalts: halts,
      postHaltAdvancePx: advance,
      haltCompressionPx: reduction,
      fitPenalty,
      adjustmentUtilisation: Math.max(fitted.adjustmentUtilisation, reduction / (glyphCount * 0.5 * em))
    };
  };
  for (const choice of alternatives) consider([choice.group], choice.advance);
  // Multi-cluster options remain measured as whole sequences. Prefixes in
  // descending effective saving bound work without assuming additive kerning.
  alternatives.sort((a, b) => a.advance - b.advance);
  for (let count = 2; count <= alternatives.length; count += 1) {
    const halts = alternatives.slice(0, count).map(choice => choice.group).sort((a, b) => a.start - b.start);
    consider(halts, measureInline(start, end, halts) + (hyphen ? hyphenWidth : 0));
  }
  return best;
}

function fitLine(
  text: string,
  ir: EditorialIRV1,
  start: number,
  end: number,
  hyphen: boolean,
  final: boolean,
  target: number,
  naturalAdvance: number,
  hyphenWidth: number,
  host: HTMLElement,
  style: CSSStyleDeclaration,
  profile: EditorialFitProfile,
  measure: (start: number, end: number) => number,
  measureInline: (start: number, end: number, halts?: PunctuationHalts) => number,
  enableHalt: boolean
): EditorialLinePlan | null {
  const mode = editorialFitMode(ir.role as EditorialRole, ir.locale);
  if (mode === "english-rag") {
    return fitEnglishLine(
      text, ir, start, end, hyphen, final, target, naturalAdvance, hyphenWidth,
      host, style, profile, measure
    );
  }
  if (mode === "cjk-optical") {
    if (!enableHalt) return fitCjkLine(text, ir, start, end, hyphen, final, target, naturalAdvance, hyphenWidth, style, profile, measure);
    return fitCjkWithHalt(text, ir, start, end, hyphen, final, target, naturalAdvance, hyphenWidth, style, profile, measure, measureInline);
  }
  if (naturalAdvance > target + 0.25) return null;
  return makeLinePlan(start, end, hyphen, final, target, naturalAdvance, 0, 0, 0, 0, 0, 0, 0, 0, []);
}
function semanticTier(state: PathState): number {
  return state.unsafeBreaks > 0 ? 1 : 0;
}

function semanticFitCost(state: PathState): number {
  // Positive penalties accumulate: adding neutral lines must not dilute a weak
  // or undesirable break. Negative values are preferences, so compare their
  // average strength rather than rewarding paths merely for creating more
  // preferred line endings.
  if (state.semantic >= 0) return state.semantic;
  return state.semantic / Math.max(1, state.lines.length);
}

function compositionPenalty(state: PathState): number {
  return state.totalFitPenalty + semanticFitCost(state);
}

function compare(a: PathState, b: PathState): number {
  return semanticTier(a) - semanticTier(b)
    || a.unsafeBreaks - b.unsafeBreaks
    || b.artDirectedBreaks - a.artDirectedBreaks
    || compositionPenalty(a) - compositionPenalty(b)
    || a.totalResidual - b.totalResidual
    || a.maxUtil - b.maxUtil
    || a.hyphens - b.hyphens
    || a.lines.length - b.lines.length
    || a.finalShort - b.finalShort;
}

function compareShapePartial(a: PathState, b: PathState): number {
  return semanticTier(a) - semanticTier(b)
    || a.unsafeBreaks - b.unsafeBreaks
    || b.artDirectedBreaks - a.artDirectedBreaks
    || compositionPenalty(a) - compositionPenalty(b)
    || stateBalanceTier(a, true) - stateBalanceTier(b, true)
    || stateBalanceRatio(a, true) - stateBalanceRatio(b, true)
    || a.totalResidual - b.totalResidual
    || a.maxUtil - b.maxUtil
    || a.hyphens - b.hyphens
    || a.lines.length - b.lines.length;
}
function partialMinWidth(state: PathState): number {
  if (!state.lines.length) return Number.POSITIVE_INFINITY;
  return Math.min(...state.lines.map((line) => line.finalOpticalWidthPx));
}

function shapeDominates(a: PathState, b: PathState): boolean {
  return semanticTier(a) <= semanticTier(b)
    && a.unsafeBreaks <= b.unsafeBreaks
    && a.artDirectedBreaks >= b.artDirectedBreaks
    && a.lines.length === b.lines.length
    && a.hyphens <= b.hyphens
    && compositionPenalty(a) <= compositionPenalty(b) + 0.01
    && a.totalResidual <= b.totalResidual + 0.25
    && a.maxUtil <= b.maxUtil + 0.01
    && stateBalanceRatio(a, true) <= stateBalanceRatio(b, true) + 0.01
    && partialMinWidth(a) + 0.5 >= partialMinWidth(b);
}

function paretoInsert(bucket: PathState[], state: PathState, preserveShape = false, limit = 32): void {
  if (preserveShape) {
    if (bucket.some((other) => shapeDominates(other, state))) return;
    for (let index = bucket.length - 1; index >= 0; index -= 1) {
      if (shapeDominates(state, bucket[index])) bucket.splice(index, 1);
    }
  } else {
    const dominated = bucket.some((other) => other.maxUtil <= state.maxUtil && compositionPenalty(other) <= compositionPenalty(state) && other.totalResidual <= state.totalResidual && other.unsafeBreaks <= state.unsafeBreaks
      && other.artDirectedBreaks >= state.artDirectedBreaks
      && other.hyphens <= state.hyphens && other.finalShort <= state.finalShort
      && other.lines.length <= state.lines.length);
    if (dominated) return;
    for (let index = bucket.length - 1; index >= 0; index -= 1) {
      const other = bucket[index];
      if (state.maxUtil <= other.maxUtil && compositionPenalty(state) <= compositionPenalty(other) && state.totalResidual <= other.totalResidual && state.unsafeBreaks <= other.unsafeBreaks
        && state.artDirectedBreaks >= other.artDirectedBreaks
        && state.hyphens <= other.hyphens && state.finalShort <= other.finalShort
        && state.lines.length <= other.lines.length) bucket.splice(index, 1);
    }
  }
  bucket.push(state);
  bucket.sort(preserveShape ? compareShapePartial : compare);
  bucket.length = Math.min(bucket.length, limit);
}

interface SolveResult {
  plan: EditorialLayoutPlan;
  state: PathState;
}

function stateBalanceRatio(state: PathState, includeFinal = false): number {
  const lines = includeFinal ? state.lines : state.lines.slice(0, -1);
  const widths = lines.map((line) => line.finalOpticalWidthPx);
  if (widths.length <= 1) return 0;
  const mean = widths.reduce((total, width) => total + width, 0) / widths.length;
  return (Math.max(...widths) - Math.min(...widths)) / Math.max(1, mean);
}

function stateBalanceTier(state: PathState, includeFinal = false): number {
  const ratio = stateBalanceRatio(state, includeFinal);
  if (ratio <= 0.08) return 0;
  if (ratio <= 0.20) return 1;
  if (ratio <= 0.32) return 2;
  return 3;
}

function stateFinalTier(state: PathState, target: number): number {
  const finalLine = state.lines.at(-1);
  if (!finalLine) return 5;
  const ratio = finalLine.finalOpticalWidthPx / Math.max(1, target);
  if (ratio >= 0.34) return 0;
  if (ratio >= 0.28) return 1;
  if (ratio >= 0.20) return 2;
  if (ratio >= 0.14) return 3;
  return 4;
}

function displayBalanceRatio(state: PathState): number {
  return stateBalanceRatio(state, false);
}


function nonFinalFillDeficit(state: PathState, target: number): number {
  const lines = state.lines.slice(0, -1);
  if (!lines.length) return 0;
  return lines.reduce((total, line) => total + Math.max(0, target - line.finalOpticalWidthPx), 0)
    / (lines.length * Math.max(1, target));
}

function displayBalanceTier(state: PathState): number {
  const ratio = displayBalanceRatio(state);
  if (ratio <= 0.08) return 0;
  if (ratio <= 0.20) return 1;
  if (ratio <= 0.32) return 2;
  return 3;
}

function stateShapeTier(state: PathState, target: number): number {
  return displayBalanceTier(state) + stateFinalTier(state, target);
}

function compareFinalStates(a: PathState, b: PathState, target: number, role: EditorialRole): number {
  const semantic = semanticTier(a) - semanticTier(b);
  if (semantic) return semantic;
  if (a.unsafeBreaks !== b.unsafeBreaks) return a.unsafeBreaks - b.unsafeBreaks;
  if (a.artDirectedBreaks !== b.artDirectedBreaks) return b.artDirectedBreaks - a.artDirectedBreaks;

  const cost = compositionPenalty(a) - compositionPenalty(b);
  if (Math.abs(cost) > 1e-6) return cost;

  if (role === "intro") {
    return stateFinalTier(a, target) - stateFinalTier(b, target)
      || stateBalanceTier(a, false) - stateBalanceTier(b, false)
      || stateBalanceRatio(a, false) - stateBalanceRatio(b, false)
      || nonFinalFillDeficit(a, target) - nonFinalFillDeficit(b, target)
      || a.totalResidual - b.totalResidual
      || a.maxUtil - b.maxUtil
      || a.hyphens - b.hyphens
      || a.lines.length - b.lines.length;
  }

  return stateShapeTier(a, target) - stateShapeTier(b, target)
    || displayBalanceTier(a) - displayBalanceTier(b)
    || displayBalanceRatio(a) - displayBalanceRatio(b)
    || nonFinalFillDeficit(a, target) - nonFinalFillDeficit(b, target)
    || a.totalResidual - b.totalResidual
    || a.maxUtil - b.maxUtil
    || a.hyphens - b.hyphens
    || a.lines.length - b.lines.length
    || stateFinalTier(a, target) - stateFinalTier(b, target);
}

function solveAtTarget(text: string, ir: EditorialIRV1, host: HTMLElement, target: number, enableHalt: boolean): SolveResult | null {
  const role = ir.role as EditorialRole;
  const profile = EDITORIAL_FIT_PROFILES[role];
  const context = editorialMeasurementContext(host, ir);
  const { style, language, signature } = context;
  const measureInline = (start: number, end: number, halts: PunctuationHalts = []) =>
    measureEditorialInline(host, text, ir, start, end, halts, context);
  const measure = (start: number, end: number) => ir.locale === "zh"
    ? measureInline(start, end)
    : measureEditorialText(host, text.slice(start, end), language, signature, style);
  const hyphenWidth = measureEditorialText(host, "\u2010", "en", signature, style);
  const candidates: Candidate[] = [
    { offset: 0, semanticPenalty: 0, hyphen: false, artDirected: false, unsafe: false },
    ...ir.breaks.map((item) => ({
      offset: item.offset,
      semanticPenalty: item.semanticPenalty,
      hyphen: item.hyphen ?? false,
      artDirected: item.reasons.includes("art-direction"),
      unsafe: item.unsafe === true
    })),
    { offset: text.length, semanticPenalty: 0, hyphen: false, artDirected: false, unsafe: false }
  ];
  const buckets = new Map<number, PathState[]>();
  buckets.set(0, [{ at: 0, lines: [], maxUtil: 0, totalResidual: 0, totalFitPenalty: 0, semantic: 0, unsafeBreaks: 0, artDirectedBreaks: 0, hyphens: 0, finalShort: 0 }]);
  for (const from of candidates) {
    const states = buckets.get(from.offset) ?? [];
    if (!states.length || from.offset === text.length) continue;
    for (const to of candidates) {
      if (to.offset <= from.offset) continue;
      const final = to.offset === text.length;
      const raw = text.slice(from.offset, to.offset);
      const start = raw.search(/\S/u);
      const end = raw.search(/\s*$/u);
      if (start < 0) continue;
      const widthStart = from.offset + start;
      const widthEnd = Math.max(widthStart, from.offset + end);
      const natural = measure(widthStart, widthEnd) + (to.hyphen ? hyphenWidth : 0);
      if (!final && Array.from(text.slice(widthStart, widthEnd)).length === 1 && /\p{Script=Han}/u.test(text.slice(widthStart, widthEnd))) continue;
      const fittedLine = fitLine(
        text,
        ir,
        widthStart,
        widthEnd,
        to.hyphen,
        final,
        target,
        natural,
        hyphenWidth,
        host,
        style,
        profile,
        measure,
        measureInline,
        enableHalt
      );
      if (!fittedLine) continue;
      const line: EditorialLinePlan = { ...fittedLine, start: from.offset, end: to.offset };
      const utilization = line.adjustmentUtilisation;
      const residual = final ? 0 : Math.abs(line.residualOpticalPx);
      for (const state of states) {
        if (state.lines.length >= 8) continue;
        const next: PathState = {
          at: to.offset,
          lines: [...state.lines, line],
          maxUtil: Math.max(state.maxUtil, utilization),
          totalResidual: state.totalResidual + residual,
          totalFitPenalty: state.totalFitPenalty + line.fitPenalty,
          semantic: state.semantic + to.semanticPenalty,
          unsafeBreaks: state.unsafeBreaks + (to.unsafe ? 1 : 0),
          artDirectedBreaks: state.artDirectedBreaks + (to.artDirected ? 1 : 0),
          hyphens: state.hyphens + (to.hyphen ? 1 : 0),
          finalShort: state.finalShort + (final ? Math.max(0, target - line.finalOpticalWidthPx) : 0)
        };
        const bucket = buckets.get(to.offset) ?? [];
        const preserveShape = ir.locale === "zh" && (role === "display" || role === "intro" || role === "prose");
        paretoInsert(bucket, next, preserveShape, preserveShape ? (role === "prose" ? 32 : 64) : 32);
        buckets.set(to.offset, bucket);
      }
    }
  }
  const completed = buckets.get(text.length) ?? [];
  const winner = completed.sort((a, b) => compareFinalStates(a, b, target, role))[0];
  return winner ? { plan: { canonicalLength: text.length, targetWidthPx: target, lines: winner.lines }, state: winner } : null;
}

export function solveEditorialLayout(text: string, ir: EditorialIRV1, host: HTMLElement, maxTarget: number, enableHalt = true): EditorialLayoutPlan | null {
  return solveAtTarget(text, ir, host, maxTarget, enableHalt)?.plan ?? null;
}
