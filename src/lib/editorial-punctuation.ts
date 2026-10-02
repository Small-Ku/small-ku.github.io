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

/** Full-width CJK punctuation with Zhudou's discrete half-width alternate.
 * ASCII hyphens, Latin quotation marks, and ordinary Latin are never eligible. */
export function isHaltPunctuation(value: string): boolean {
  return "、。，．！？；：（）［］｛｝〔〕〈〉《》「」『』【】〖〗〘〙〚〛".includes(value) && value.length === 1;
}
