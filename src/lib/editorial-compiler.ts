import englishHyphenation from "hyphen/en/index.js";
import { loadDefaultTraditionalChineseParser } from "budoux";
import type { SiteLocale } from "./i18n";
import { CJK_CLOSING_PUNCTUATION as CLOSING, CJK_OPENING_PUNCTUATION as OPENING } from "./editorial-punctuation";
import type {
  CompiledEditorialText,
  DisplayBreakHint,
  EditorialAtom,
  EditorialBreakCandidate,
  EditorialRole,
  EditorialAdjustmentOpportunity
} from "./editorial-ir";

const { hyphenateSync } = englishHyphenation;
const chineseParser = loadDefaultTraditionalChineseParser();
const HAN = /\p{Script=Han}/u;
const LATIN = /\p{Script=Latin}/u;
const MARK = /\p{M}/u;
const NUMBER = /\p{N}/u;
const COMPACT_TOKEN = /[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)+/gu;

function kindOf(value: string): EditorialAtom["kind"] {
  if (/^\s+$/u.test(value)) return "space";
  if (HAN.test(value)) return "han";
  if (LATIN.test(value) || NUMBER.test(value) || MARK.test(value)) return "latin";
  if (/^[\p{P}\p{S}]$/u.test(value)) return "punctuation";
  return "other";
}

function points(text: string): Array<{ text: string; start: number; end: number }> {
  const result: Array<{ text: string; start: number; end: number }> = [];
  let offset = 0;
  for (const char of text) {
    const start = offset;
    offset += char.length;
    const previous = result.at(-1);
    if (previous && MARK.test(char)) {
      previous.text += char;
      previous.end = offset;
    } else result.push({ text: char, start, end: offset });
  }
  return result;
}

function englishRanges(text: string): Array<{ start: number; end: number }> {
  const runs: Array<{ start: number; end: number }> = [];
  const token = /\p{Script=Latin}[\p{Script=Latin}\p{M}\p{N}]*(?:[’'\-][\p{Script=Latin}\p{M}\p{N}]+)*/gu;
  for (const match of text.matchAll(token)) {
    const start = match.index ?? 0;
    runs.push({ start, end: start + match[0].length });
  }
  return runs;
}

function isEnglishOffset(offset: number, ranges: Array<{ start: number; end: number }>): boolean {
  return ranges.some((range) => offset >= range.start && offset < range.end);
}

function isCjk(value: string): boolean {
  return HAN.test(value) || /^[，。！？；：、（）［］｛｝《》「」『』【】]$/u.test(value);
}

function punctuationLegal(text: string, offset: number): boolean {
  const sequence = points(text);
  const before = sequence.find((item) => item.end === offset)?.text;
  const after = sequence.find((item) => item.start === offset)?.text;
  return !(before && OPENING.has(before)) && !(after && CLOSING.has(after));
}

function mergeBreak(
  map: Map<number, EditorialBreakCandidate>,
  offset: number,
  reason: EditorialBreakCandidate["reasons"][number],
  semanticPenalty = 0,
  hyphen = false
): void {
  const existing = map.get(offset);
  const current: EditorialBreakCandidate = existing
    ? { ...existing, reasons: [...existing.reasons] }
    : { offset, reasons: [], semanticPenalty };
  if (!current.reasons.includes(reason)) current.reasons.push(reason);
  current.semanticPenalty = existing ? Math.min(existing.semanticPenalty, semanticPenalty) : semanticPenalty;
  current.unsafe = existing
    ? Boolean(existing.unsafe) && semanticPenalty >= 4
    : semanticPenalty >= 4;
  if (!current.unsafe) delete current.unsafe;
  if (hyphen) current.hyphen = true;
  map.set(offset, current);
}

function isInitialismLike(word: string): boolean {
  const letters = Array.from(word).filter((char) => LATIN.test(char));
  if (letters.length < 2 || letters.length > 10) return false;
  return letters.every((char) => char === char.toLocaleUpperCase("en") && char !== char.toLocaleLowerCase("en"));
}

function liangOffsets(word: string, base: number): number[] {
  if (isInitialismLike(word)) return [];
  const marked = hyphenateSync(word);
  const offsets: number[] = [];
  let sourceOffset = 0;
  for (const char of marked) {
    if (char === "\u00ad") offsets.push(base + sourceOffset);
    else sourceOffset += char.length;
  }
  return offsets;
}

export function compileEditorialText(
  canonicalText: string,
  locale: SiteLocale,
  role: EditorialRole,
  displayBreakHints: DisplayBreakHint[] = []
): CompiledEditorialText {
  const graphemes = points(canonicalText);
  const english = englishRanges(canonicalText);
  const atoms: EditorialAtom[] = [];
  for (const point of graphemes) {
    const kind = kindOf(point.text);
    const previous = atoms.at(-1);
    const lang = isEnglishOffset(point.start, english) ? "en" as const : undefined;
    if (previous && previous.end === point.start && previous.kind === kind && previous.lang === lang) previous.end = point.end;
    else atoms.push({ start: point.start, end: point.end, kind, ...(lang ? { lang } : {}) });
  }

  const breaks = new Map<number, EditorialBreakCandidate>();
  const addLegal = (offset: number, reason: EditorialBreakCandidate["reasons"][number], penalty = 0, hyphen = false) => {
    if (offset > 0 && offset < canonicalText.length && punctuationLegal(canonicalText, offset)) mergeBreak(breaks, offset, reason, penalty, hyphen);
  };

  for (const point of graphemes) {
    if (/\s/u.test(point.text)) addLegal(point.end, "space");
    const codePoint = point.text.codePointAt(0);
    if (point.text === "-" || codePoint === 0x2010) addLegal(point.end, "hard-hyphen");
    if (/^[\uFF0C\u3002\uFF01\uFF1F\uFF1B\uFF1A]$/u.test(point.text)) addLegal(point.end, "cjk-punctuation", -2);
    const next = graphemes.find((candidate) => candidate.start === point.end);
    if (next && ((NUMBER.test(point.text) && LATIN.test(next.text)) || (LATIN.test(point.text) && NUMBER.test(next.text)))) {
      addLegal(point.end, "number-latin", 0.25, false);
    }
    if (next && ((isCjk(point.text) && isCjk(next.text))
      || (locale === "zh" && ((isCjk(point.text) && kindOf(next.text) === "latin") || (kindOf(point.text) === "latin" && isCjk(next.text)))))) {
      addLegal(point.end, "native-cjk", 0.7);
    }
  }

  if (locale === "zh" && canonicalText) {
    let offset = 0;
    const phrases = chineseParser.parse(canonicalText);
    const phraseBoundaries = new Set<number>();
    for (const phrase of phrases) {
      const start = offset;
      offset += phrase.length;
      if (offset < canonicalText.length) {
        phraseBoundaries.add(offset);
        if (breaks.has(offset)) mergeBreak(breaks, offset, "budoux", 0.15);
      }
      const end = start + phrase.length;
      // Breaking inside a short BudouX lexical unit is possible, but carries
      // a semantic cost instead of becoming a blanket nowrap span.
      if (/^\p{Script=Han}{2,5}$/u.test(phrase)) {
        for (const point of graphemes) if (point.start >= start && point.end < end) addLegal(point.end, "native-cjk", 5);
      }
    }
    for (const candidate of breaks.values()) {
      if (!phraseBoundaries.has(candidate.offset) && candidate.reasons.includes("native-cjk")) {
        candidate.semanticPenalty = Math.max(candidate.semanticPenalty, 5);
        candidate.unsafe = true;
      }
    }
  }

  if (role === "display") {
    for (const run of english) {
      const word = canonicalText.slice(run.start, run.end);
      for (const offset of liangOffsets(word, run.start)) addLegal(offset, "liang", 1.2, true);
    }
    for (const hint of displayBreakHints) {
      if ("afterText" in hint) {
        const phrase = hint.afterText.trim();
        if (!phrase) continue;
        const haystack = canonicalText.toLocaleLowerCase("en");
        const needle = phrase.toLocaleLowerCase("en");
        let from = 0;
        while (from < canonicalText.length) {
          const index = haystack.indexOf(needle, from);
          if (index < 0) break;
          let offset = index + phrase.length;
          while (offset < canonicalText.length && /\s/u.test(canonicalText[offset])) offset += 1;

          const insideEnglishToken = english.some((range) => offset > range.start && offset < range.end);
          const existing = breaks.get(offset);
          if (!insideEnglishToken && existing) {
            mergeBreak(breaks, offset, "art-direction", -8, existing.hyphen === true);
          } else if (insideEnglishToken && existing?.hyphen) {
            // Art direction may prefer a real language-aware hyphenation point,
            // but it must never manufacture an intra-word break of its own.
            mergeBreak(breaks, offset, "art-direction", -8, true);
          }

          from = index + phrase.length;
        }
        continue;
      }

      const word = hint.word.trim();
      const preferred = hint.after;
      if (!word || !preferred || !word.toLocaleLowerCase("en").startsWith(preferred.toLocaleLowerCase("en"))) continue;
      let from = 0;
      while (from < canonicalText.length) {
        const index = canonicalText.toLocaleLowerCase("en").indexOf(word.toLocaleLowerCase("en"), from);
        if (index < 0) break;
        const offset = index + preferred.length;
        const insideToken = english.some((range) =>
          index >= range.start && offset > range.start && offset < range.end && index + word.length <= range.end
        );
        const existing = breaks.get(offset);
        if (insideToken && existing?.hyphen && existing.reasons.includes("liang")) {
          mergeBreak(breaks, offset, "editorial", -8, true);
        }
        from = index + word.length;
      }
    }
  }

  const protectedRanges: Array<{ start: number; end: number }> = [];
  if (role === "compact") {
    for (const match of canonicalText.matchAll(COMPACT_TOKEN)) {
      const start = match.index ?? 0;
      protectedRanges.push({ start, end: start + match[0].length });
    }
  }
  for (const range of protectedRanges) for (const offset of breaks.keys()) {
    if (offset > range.start && offset < range.end) breaks.delete(offset);
  }

  const adjustments: EditorialAdjustmentOpportunity[] = [];
  for (let index = 0; index < graphemes.length - 1; index += 1) {
    const current = graphemes[index];
    const next = graphemes[index + 1];
    if (current.end !== next.start) continue;
    const left = kindOf(current.text);
    const right = kindOf(next.text);

    if (left === "space") {
      adjustments.push({ offset: current.end, kind: "word-space" });
      continue;
    }

    // Candidate text-facing boundaries. Runtime resolves glyph ownership so an
    // ambiguous quote cannot spend both its opening and closing budgets.
    if (OPENING.has(current.text) || CLOSING.has(next.text)) {
      adjustments.push({ offset: current.end, kind: "punctuation" });
      continue;
    }

    if (left === "han" && right === "han") adjustments.push({ offset: current.end, kind: "han-gap" });
  }

  return {
    canonicalText,
    ir: {
      version: 1,
      locale,
      role,
      canonicalLength: canonicalText.length,
      atoms,
      breaks: [...breaks.values()].sort((a, b) => a.offset - b.offset),
      adjustments
    }
  };
}
