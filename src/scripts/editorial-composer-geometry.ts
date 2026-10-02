import { editorialFitMode, type EditorialFitProfile } from "../lib/editorial-constraints";
import type { EditorialIRV1 } from "../lib/editorial-ir";
import { shareVisualLine } from "../lib/visual-line-geometry";
import { appendEditorialInline, type PunctuationHalts } from "./editorial-composer-inline";

const measurementCache = new Map<string, number>();

export function invalidateEditorialMeasurements(): void {
  measurementCache.clear();
}

export function editorialStyleSignature(style: CSSStyleDeclaration, lang: string, role: string): string {
  return [style.fontFamily, style.fontSize, style.fontWeight, style.fontStretch, style.fontStyle,
    style.letterSpacing, style.fontKerning, style.fontFeatureSettings, style.fontVariant,
    style.fontVariationSettings, style.textAutospace, lang, role].join("|");
}

function measurementBox(host: HTMLElement, lang: string): HTMLElement {
  const box = document.createElement("span");
  const style = getComputedStyle(host);
  Object.assign(box.style, {
    position: "fixed", insetInlineStart: "-100000px", insetBlockStart: "0", display: "inline-block",
    whiteSpace: "pre", inlineSize: "max-content", blockSize: "auto", visibility: "hidden", pointerEvents: "none",
    font: style.font, fontFamily: style.fontFamily, fontSize: style.fontSize, fontWeight: style.fontWeight,
    fontStretch: style.fontStretch, fontStyle: style.fontStyle, letterSpacing: style.letterSpacing,
    fontKerning: style.fontKerning, fontFeatureSettings: style.fontFeatureSettings,
    fontVariationSettings: style.fontVariationSettings, fontVariant: style.fontVariant,
    // Match the custom renderer's untrimmed baseline. Native trim must not
    // silently shrink the measurement and then disappear on materialization.
    textSpacingTrim: "space-all", textAutospace: style.textAutospace
  });
  box.lang = lang;
  box.dataset.editorialRoot = "";
  return box;
}

function measuredWidth(box: HTMLElement, key: string, valid?: (box: HTMLElement) => boolean): number {
  document.body.append(box);
  const width = !valid || valid(box) ? box.getBoundingClientRect().width : Number.POSITIVE_INFINITY;
  box.remove();
  // Discrete alternatives add cache entries. Evict one oldest measurement
  // rather than dropping every still-useful width during an active solve.
  if (measurementCache.size >= 8000) {
    const oldest = measurementCache.keys().next().value;
    if (oldest !== undefined) measurementCache.delete(oldest);
  }
  measurementCache.set(key, width);
  return width;
}

export function measureEditorialText(host: HTMLElement, text: string, lang: string, signature: string): number {
  const key = `${signature}\u0000${text}`;
  const cached = measurementCache.get(key);
  if (cached !== undefined) return cached;
  const box = measurementBox(host, lang);
  box.textContent = text;
  return measuredWidth(box, key);
}

export function editorialLanguage(host: HTMLElement, ir: EditorialIRV1): string {
  return host.closest("[lang]")?.getAttribute("lang") || (ir.locale === "zh" ? "zh-HK" : "en");
}

/** Measure native kern/locl and optional discrete halt on the entire candidate,
 * preserving language runs. Kerning savings are never inferred additively. */
export function measureEditorialInline(
  host: HTMLElement, text: string, ir: EditorialIRV1, start: number, end: number, halts: PunctuationHalts = []
): number {
  const lang = editorialLanguage(host, ir);
  const runs = ir.atoms.filter(atom => atom.end > start && atom.start < end)
    .map(atom => `${Math.max(start, atom.start) - start}:${Math.min(end, atom.end) - start}:${atom.lang ?? ""}`).join(",");
  const features = halts.filter(range => range.end > start && range.start < end)
    .map(range => `${Math.max(start, range.start) - start}:${Math.min(end, range.end) - start}`).join(",");
  const key = `${editorialStyleSignature(getComputedStyle(host), lang, ir.role)}|inline:${runs}|halt:${features}\u0000${text.slice(start, end)}`;
  const cached = measurementCache.get(key);
  if (cached !== undefined) return cached;
  const box = measurementBox(host, lang);
  appendEditorialInline(box, text, ir, start, end, halts);
  return measuredWidth(box, key, halts.length ? candidate => {
    const nodes = rangesFromTextNodes(candidate);
    const locate = (offset: number, startBoundary: boolean): { node: Text; offset: number } | null => {
      let base = 0;
      for (const [index, node] of nodes.entries()) {
        if (offset < base + node.length || offset === base + node.length && (!startBoundary || index === nodes.length - 1)) {
          return { node, offset: offset - base };
        }
        base += node.length;
      }
      return null;
    };
    const style = getComputedStyle(candidate);
    const em = parseFloat(style.fontSize) || 16;
    const tracking = parseFloat(style.letterSpacing) || 0;
    return halts.every(halt => {
      const from = Math.max(start, halt.start), to = Math.min(end, halt.end);
      if (to <= from) return true;
      const first = locate(from - start, true), last = locate(to - start, false);
      if (!first || !last) return false;
      const range = document.createRange();
      range.setStart(first.node, first.offset);
      range.setEnd(last.node, last.offset);
      const count = Array.from(text.slice(from, to)).length;
      // Some font/engine combinations still kern half-width alternates by
      // another half-em. Reject that double squeeze while leaving kern enabled.
      return range.getBoundingClientRect().width >= count * (0.5 * em + tracking) - 0.5;
    });
  } : undefined);
}

export function editorialInlineTarget(element: HTMLElement): number {
  const parent = element.parentElement ?? element;
  const style = getComputedStyle(parent);
  return Math.max(0, parent.clientWidth - parseFloat(style.paddingInlineStart || "0") - parseFloat(style.paddingInlineEnd || "0"));
}

function rangesFromTextNodes(root: HTMLElement): Text[] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  while (walker.nextNode()) if (walker.currentNode instanceof Text) nodes.push(walker.currentNode);
  return nodes;
}

interface NativeLineGeometry {
  start: number;
  end: number;
  width: number;
}

function nativeLineGeometry(root: HTMLElement, textLength: number): NativeLineGeometry[] {
  const nodes = rangesFromTextNodes(root);
  const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  const visual: Array<{ start: number; end: number; top: number; height: number; left: number; right: number }> = [];
  let base = 0;

  for (const node of nodes) {
    for (const part of segmenter.segment(node.data)) {
      const start = base + part.index;
      const end = start + part.segment.length;
      if (/^\s+$/u.test(part.segment)) continue;
      const range = document.createRange();
      range.setStart(node, part.index);
      range.setEnd(node, part.index + part.segment.length);
      const rects = Array.from(range.getClientRects()).filter((rect) => rect.width || rect.height);
      if (!rects.length) continue;
      visual.push({
        start,
        end,
        top: rects.at(-1)?.top ?? rects[0].top,
        height: rects.at(-1)?.height ?? rects[0].height,
        left: Math.min(...rects.map((rect) => rect.left)),
        right: Math.max(...rects.map((rect) => rect.right))
      });
    }
    base += node.data.length;
  }
  if (!visual.length) return [];

  const groups: Array<{ first: number; left: number; right: number; top: number; height: number }> = [];
  for (const grapheme of visual) {
    const current = groups.at(-1);
    if (!current || !shareVisualLine(grapheme, current)) {
      groups.push({ first: grapheme.start, left: grapheme.left, right: grapheme.right, top: grapheme.top, height: grapheme.height });
      continue;
    }
    current.left = Math.min(current.left, grapheme.left);
    current.right = Math.max(current.right, grapheme.right);
  }

  return groups.map((group, index) => ({
    start: index === 0 ? 0 : group.first,
    end: index + 1 < groups.length ? groups[index + 1].first : textLength,
    width: group.right - group.left
  }));
}

export function nativeEditorialLayoutAcceptable(
  root: HTMLElement,
  ir: EditorialIRV1,
  profile: EditorialFitProfile,
  target: number
): boolean {
  if (!profile.nativeFirst) return false;
  if (ir.breaks.some((candidate) => candidate.reasons.includes("art-direction"))) return false;

  const host = root.parentElement ?? root;
  if (host.scrollWidth > host.clientWidth + 1) return false;

  const lines = nativeLineGeometry(root, ir.canonicalLength);
  if (!lines.length) return false;
  if (lines.length === 1) return true;

  const candidates = new Map(ir.breaks.map((candidate) => [candidate.offset, candidate]));
  for (const line of lines.slice(0, -1)) {
    const candidate = candidates.get(line.end);
    if (!candidate || candidate.unsafe === true || candidate.semanticPenalty >= 4) return false;
  }

  const mode = editorialFitMode(ir.role, ir.locale);
  if (mode === "english-rag") return true;
  if (mode !== "cjk-optical") return false;

  const em = parseFloat(getComputedStyle(root).fontSize) || 16;
  const tolerance = profile.cjk.residualToleranceEm * em;
  return lines.slice(0, -1).every((line) => Math.abs(target - line.width) <= tolerance + 0.5);
}
