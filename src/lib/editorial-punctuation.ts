export const CJK_OPENING_PUNCTUATION = new Set(Array.from("([{（［｛〔〈《「『【〖〘〚“‘«〝﹙﹛﹝\""));
export const CJK_CLOSING_PUNCTUATION = new Set(Array.from("、。，．！？；：)]}）］｝〕〉》」』】〗〙〛”’»〞﹚﹜﹞\""));

export function isOpeningCjkPunctuation(value: string): boolean {
  return CJK_OPENING_PUNCTUATION.has(value);
}

export function isClosingCjkPunctuation(value: string): boolean {
  return CJK_CLOSING_PUNCTUATION.has(value);
}
export function isCjkPunctuationAdjustmentBoundary(text: string, offset: number): boolean {
  if (offset <= 0 || offset >= text.length) return false;
  const before = Array.from(text.slice(0, offset)).at(-1) ?? "";
  const after = Array.from(text.slice(offset))[0] ?? "";
  return isOpeningCjkPunctuation(before) || isClosingCjkPunctuation(after);
}

/** Consecutive punctuation keeps its native kern/locl shaping. Reserve manual
 * compression for isolated punctuation so a font-owned cluster is not squeezed
 * again, or split by an adjustment margin that would undo its kerning. */
export function isResidualCjkPunctuationAdjustmentBoundary(text: string, offset: number): boolean {
  if (!isCjkPunctuationAdjustmentBoundary(text, offset)) return false;
  const before = Array.from(text.slice(0, offset));
  const after = Array.from(text.slice(offset));
  const isPunctuation = (value: string) => /^[\p{P}\p{S}]$/u.test(value);
  const isolatedOpening = isOpeningCjkPunctuation(before.at(-1) ?? "")
    && !isPunctuation(before.at(-2) ?? "") && !isPunctuation(after[0] ?? "");
  const isolatedClosing = isClosingCjkPunctuation(after[0] ?? "")
    && !isPunctuation(before.at(-1) ?? "") && !isPunctuation(after[1] ?? "");
  return isolatedOpening || isolatedClosing;
}

export interface ResidualPunctuationOpportunity {
  offset: number;
  glyphStart: number;
  glyphEnd: number;
  direction: "opening" | "closing";
  ambiguous: boolean;
}

/** Assign one directional resource to each isolated glyph. Boundary candidates
 * are not glyph budgets: U+0022 can otherwise be counted on both sides. Quote
 * pairing is canonical-text-wide so a line break cannot change its direction. */
export function compileResidualCjkPunctuationOpportunities(
  text: string,
  points: ReadonlyArray<{ offset: number; kind: string }>
): ResidualPunctuationOpportunity[] {
  const boundaries = new Set(points.filter(point => point.kind === "punctuation").map(point => point.offset));
  const opportunities: ResidualPunctuationOpportunity[] = [];
  let cursor = 0;
  let quoteOpen = true;
  for (const glyph of text) {
    const glyphStart = cursor;
    cursor += glyph.length;
    const opening = isOpeningCjkPunctuation(glyph);
    const closing = isClosingCjkPunctuation(glyph);
    const ambiguous = opening && closing;
    const direction = opening && (!closing || quoteOpen) ? "opening" : "closing";
    if (ambiguous) quoteOpen = !quoteOpen;
    if (!opening && !closing) continue;
    const offset = direction === "opening" ? cursor : glyphStart;
    if (offset <= 0 || offset >= text.length || !boundaries.has(offset)) continue;
    if (!isResidualCjkPunctuationAdjustmentBoundary(text, offset)) continue;
    opportunities.push({ offset, glyphStart, glyphEnd: cursor, direction, ambiguous });
  }
  return opportunities;
}

/** Candidate filtering uses canonical ownership without reclassifying text.
 * Halt removes only opportunities whose owning glyph overlaps a selected range. */
export function filterResidualCjkPunctuationOpportunities(
  opportunities: ReadonlyArray<ResidualPunctuationOpportunity>,
  start: number,
  end: number,
  halts: ReadonlyArray<{ start: number; end: number }> = []
): ResidualPunctuationOpportunity[] {
  return opportunities.filter(point =>
    point.glyphStart >= start && point.glyphEnd <= end
    && point.offset > start && point.offset < end
    && !halts.some(halt => point.glyphStart < halt.end && point.glyphEnd > halt.start)
  );
}

/** Full-width CJK punctuation with Zhudou's discrete half-width alternate.
 * ASCII hyphens, Latin quotation marks, and ordinary Latin are never eligible. */
export function isHaltPunctuation(value: string): boolean {
  return "、。，．！？；：（）［］｛｝〔〕〈〉《》「」『』【】〖〗〘〙〚〛".includes(value) && value.length === 1;
}
