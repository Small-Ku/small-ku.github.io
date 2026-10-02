import { composeEditorialTree } from "./editorial-composer";
import { shareVisualLine } from "../lib/visual-line-geometry";

interface LineSegment {
  start: number;
  end: number;
  hyphen?: boolean;
  hangingStartPx?: number;
  hangingEndPx?: number;
}

interface MorphSegment {
  start: number;
  end: number;
  name: string;
}

export interface WritingLineMorph {
  text: string;
  sourceTitle: HTMLElement;
  targetTitle: HTMLElement | null;
  sourceChildren: Node[];
  targetChildren: Node[] | null;
  sourceLines: LineSegment[];
  targetLines: LineSegment[];
  segments: MorphSegment[];
}

let activeWritingLineMorph: WritingLineMorph | null = null;

function titleTextElement(element: Element | null): HTMLElement | null {
  if (!(element instanceof HTMLElement)) return null;
  if (element.matches("h1, h2, h3")) return element;
  const ownText = Array.from(element.childNodes).some(
    (node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim()
  );
  if (ownText) return element;
  return element.querySelector<HTMLElement>("h1, h2, h3");
}

function titleTextNodes(title: HTMLElement): Text[] {
  const walker = document.createTreeWalker(title, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  while (walker.nextNode()) {
    if (walker.currentNode instanceof Text && walker.currentNode.data.length > 0) {
      nodes.push(walker.currentNode);
    }
  }
  return nodes;
}

function titleCanonicalText(title: HTMLElement): string {
  return titleTextNodes(title).map((node) => node.data).join("");
}

function rangeForOffsets(title: HTMLElement, start: number, end: number): Range | null {
  const nodes = titleTextNodes(title);
  const total = nodes.reduce((sum, node) => sum + node.data.length, 0);
  if (!nodes.length || start < 0 || end <= start || end > total) return null;

  const locate = (offset: number, startBoundary: boolean): { node: Text; offset: number } | null => {
    let base = 0;
    for (const [index, node] of nodes.entries()) {
      const nodeEnd = base + node.data.length;
      if (offset < nodeEnd) return { node, offset: offset - base };
      if (offset === nodeEnd) {
        if (startBoundary && index + 1 < nodes.length) {
          base = nodeEnd;
          continue;
        }
        return { node, offset: node.data.length };
      }
      base = nodeEnd;
    }
    const last = nodes.at(-1);
    return last ? { node: last, offset: last.data.length } : null;
  };

  const from = locate(start, true);
  const to = locate(end, false);
  if (!from || !to) return null;
  const range = document.createRange();
  range.setStart(from.node, from.offset);
  range.setEnd(to.node, to.offset);
  return range;
}

function textRangeRect(title: HTMLElement, start: number, end: number): DOMRect | null {
  const range = rangeForOffsets(title, start, end);
  if (!range) return null;
  const boxes = Array.from(range.getClientRects()).filter((box) => box.width > 0 && box.height > 0);
  if (!boxes.length) return null;
  return boxes.at(-1) ?? null;
}

function isPresentationStructure(source: Element): boolean {
  return source.hasAttribute("data-editorial-root")
    || source.hasAttribute("data-editorial-presentation-structure")
    || source.matches(".writing-line-run, .writing-line-fragment");
}

function appendInlineClone(target: Node, source: Node): void {
  if (source instanceof Text) {
    target.appendChild(source.cloneNode(true));
    return;
  }
  if (!(source instanceof Element)) return;

  if (isPresentationStructure(source)) {
    for (const child of Array.from(source.childNodes)) appendInlineClone(target, child);
    return;
  }
  if (source.hasAttribute("data-editorial-presentation-hyphen")) return;

  const clone = source.cloneNode(false);
  for (const child of Array.from(source.childNodes)) appendInlineClone(clone, child);
  target.appendChild(clone);
}

function cloneInlineRange(title: HTMLElement, start: number, end: number): DocumentFragment | null {
  const range = rangeForOffsets(title, start, end);
  if (!range) return null;
  const cloned = range.cloneContents();
  let fragment = document.createDocumentFragment();
  for (const child of Array.from(cloned.childNodes)) appendInlineClone(fragment, child);

  // A Range wholly inside one text node clones only that Text node. Rebuild
  // its non-structural inline ancestry so segmenting the title cannot silently
  // change language, shaping, emphasis, links, or boundary adjustment styles.
  if (range.startContainer === range.endContainer && range.startContainer instanceof Text) {
    let ancestor = range.startContainer.parentElement;
    while (ancestor && ancestor !== title) {
      if (!isPresentationStructure(ancestor)
        && !ancestor.hasAttribute("data-editorial-presentation-hyphen")) {
        const wrapper = ancestor.cloneNode(false);
        wrapper.appendChild(fragment);
        const outer = document.createDocumentFragment();
        outer.append(wrapper);
        fragment = outer;
      }
      ancestor = ancestor.parentElement;
    }
  }

  return fragment;
}

function graphemeOffsets(text: string): Array<{ start: number; end: number; text: string }> {
  if (typeof Intl.Segmenter === "function") {
    const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
    return Array.from(segmenter.segment(text), (segment) => ({
      start: segment.index,
      end: segment.index + segment.segment.length,
      text: segment.segment
    }));
  }

  const result: Array<{ start: number; end: number; text: string }> = [];
  let offset = 0;
  for (const value of Array.from(text)) {
    const start = offset;
    offset += value.length;
    result.push({ start, end: offset, text: value });
  }
  return result;
}

function validLinePlan(lines: LineSegment[], textLength: number): boolean {
  if (!lines.length || lines[0].start !== 0 || lines.at(-1)?.end !== textLength) return false;
  return lines.every((line, index) =>
    line.end > line.start
    && line.start >= 0
    && line.end <= textLength
    && (index === 0 || lines[index - 1].end === line.start)
  );
}

function presentationHyphenOffsets(title: HTMLElement): Set<number> {
  const offsets = new Set<number>();
  for (const marker of title.querySelectorAll<HTMLElement>("[data-editorial-presentation-hyphen]")) {
    const range = document.createRange();
    range.selectNodeContents(title);
    try {
      range.setEndBefore(marker);
      offsets.add(range.toString().length);
    } catch {
      // Detached presentation markers do not define line identity.
    }
  }
  return offsets;
}

function presentationLineHanging(title: HTMLElement): Map<string, { start: number; end: number }> {
  const hanging = new Map<string, { start: number; end: number }>();
  for (const line of title.querySelectorAll<HTMLElement>("[data-editorial-presentation-structure='line'][data-editorial-line]")) {
    const key = line.dataset.editorialLine;
    if (!key) continue;
    const start = Number.parseFloat(line.dataset.editorialPresentationHangStartPx ?? "0");
    const end = Number.parseFloat(line.dataset.editorialPresentationHangEndPx ?? "0");
    hanging.set(key, {
      start: Number.isFinite(start) ? Math.max(0, start) : 0,
      end: Number.isFinite(end) ? Math.max(0, end) : 0
    });
  }
  return hanging;
}

function titleLineSegments(title: HTMLElement): LineSegment[] {
  const text = titleCanonicalText(title);
  if (!text) return [];
  const presentationHyphens = presentationHyphenOffsets(title);
  const presentationHanging = presentationLineHanging(title);
  const visible: Array<{ start: number; rect: DOMRect }> = [];
  for (const grapheme of graphemeOffsets(text)) {
    if (/^\s+$/u.test(grapheme.text)) continue;
    const rect = textRangeRect(title, grapheme.start, grapheme.end);
    if (rect) visible.push({ start: grapheme.start, rect });
  }
  if (!visible.length) return [];

  const boundaries = [0];
  let previousRect = visible[0].rect;
  for (const fragment of visible.slice(1)) {
    if (!shareVisualLine(fragment.rect, previousRect)) boundaries.push(fragment.start);
    previousRect = fragment.rect;
  }
  boundaries.push(text.length);

  const unique = [...new Set(boundaries)].sort((a, b) => a - b);
  const lines = unique.slice(0, -1).map((start, index) => {
    const end = unique[index + 1];
    const trimmed = text.slice(start, end).replace(/\s+$/u, "");
    const hanging = presentationHanging.get(start + ":" + end);
    return {
      start,
      end,
      hyphen: presentationHyphens.has(end) || trimmed.charCodeAt(trimmed.length - 1) === 0x00ad,
      ...(hanging?.start ? { hangingStartPx: hanging.start } : {}),
      ...(hanging?.end ? { hangingEndPx: hanging.end } : {})
    };
  });
  return validLinePlan(lines, text.length) ? lines : [];
}

function writingRoot(scope: ParentNode, slug: string): HTMLElement | null {
  const selector = `[data-writing-slug="${CSS.escape(slug)}"]`;
  if (scope instanceof HTMLElement && scope.matches(selector)) return scope;
  return scope.querySelector<HTMLElement>(selector);
}

function measureIncomingWritingLines(
  nextDocument: Document,
  slug: string
): { text: string; lines: LineSegment[] } | null {
  const nextRoot = writingRoot(nextDocument, slug);
  if (!nextRoot) return null;
  const nextMain = nextRoot.closest("main") ?? nextDocument.querySelector("main");
  if (!nextMain) return null;

  // Model the destination viewport rather than inheriting the source page's
  // scrollbar-reduced containing block. A destination that does not need a
  // vertical scrollbar can be ~15px wider on Windows than a scrolling source;
  // using fixed inset: 0 therefore predicts the wrong line plan. Clone the
  // destination site shell into its own scroll container whose outer size is
  // the real visual viewport and let destination content decide the gutter.
  const shell = document.createElement("div");
  Object.assign(shell.style, {
    position: "fixed",
    insetInlineStart: "0",
    insetBlockStart: "0",
    inlineSize: `${window.innerWidth}px`,
    blockSize: `${window.innerHeight}px`,
    visibility: "hidden",
    pointerEvents: "none",
    overflowX: "hidden",
    overflowY: "auto"
  });
  shell.lang = nextDocument.documentElement.lang || document.documentElement.lang;

  const nextSiteShell = nextDocument.querySelector<HTMLElement>(".site-shell");
  const cloneSiteShell = nextSiteShell ? document.importNode(nextSiteShell, true) : null;
  const cloneMain = cloneSiteShell?.querySelector<HTMLElement>("main")
    ?? document.importNode(nextMain, true);
  if (cloneSiteShell) shell.append(cloneSiteShell);
  else shell.append(cloneMain);
  document.body.append(shell);
  const cloneRoot = writingRoot(cloneMain, slug);
  const slot = cloneRoot?.querySelector<HTMLElement>("[data-vt-writing-title]") ?? null;
  // The full destination shell stays in layout so scrollbar/container geometry is real,
  // but only the matched title needs editorial composition for line prediction.
  if (slot) composeEditorialTree(slot);

  const title = titleTextElement(slot);
  const result = title
    ? { text: titleCanonicalText(title), lines: titleLineSegments(title) }
    : null;
  shell.remove();
  return result && validLinePlan(result.lines, result.text.length) ? result : null;
}

function sameLinePlan(a: LineSegment[], b: LineSegment[]): boolean {
  return a.length === b.length && a.every((line, index) => {
    const other = b[index];
    return line.start === other.start && line.end === other.end
      && Boolean(line.hyphen) === Boolean(other.hyphen)
      && Math.abs((line.hangingStartPx ?? 0) - (other.hangingStartPx ?? 0)) <= 0.1
      && Math.abs((line.hangingEndPx ?? 0) - (other.hangingEndPx ?? 0)) <= 0.1;
  });
}

function atomicSegments(textLength: number, sourceLines: LineSegment[], targetLines: LineSegment[]): MorphSegment[] {
  const boundaries = new Set<number>([0, textLength]);
  for (const line of [...sourceLines, ...targetLines]) {
    boundaries.add(line.start);
    boundaries.add(line.end);
  }
  const offsets = [...boundaries].sort((a, b) => a - b);
  return offsets.slice(0, -1).map((start, index) => ({
    start,
    end: offsets[index + 1],
    name: "writing-line-" + (index + 1)
  })).filter((segment) => segment.end > segment.start);
}

function fragmentWritingTitle(
  title: HTMLElement,
  morph: WritingLineMorph,
  lines: LineSegment[]
): boolean {
  if (titleCanonicalText(title) !== morph.text || !validLinePlan(lines, morph.text.length)) return false;

  const prepared = lines.map((line) => {
    const segments = morph.segments.filter((segment) =>
      segment.start >= line.start && segment.end <= line.end
    );
    if (!segments.length || segments[0].start !== line.start || segments.at(-1)?.end !== line.end) {
      return null;
    }
    const contents = segments.map((segment) => ({
      segment,
      content: cloneInlineRange(title, segment.start, segment.end)
    }));
    if (contents.some((entry) => !entry.content)) return null;
    return { line, contents };
  });
  if (prepared.some((line) => line === null)) return false;

  const fragment = document.createDocumentFragment();
  for (const preparedLine of prepared) {
    if (!preparedLine) return false;
    const { line, contents } = preparedLine;
    const lineElement = document.createElement("span");
    lineElement.className = "writing-line-run";
    lineElement.style.display = "block";
    lineElement.style.whiteSpace = "nowrap";
    if ((line.hangingStartPx ?? 0) > 0) {
      lineElement.style.position = "relative";
      lineElement.style.insetInlineStart = -(line.hangingStartPx ?? 0) + "px";
    }

    for (const { segment, content } of contents) {
      const span = document.createElement("span");
      span.className = "writing-line-fragment";
      span.style.viewTransitionName = segment.name;
      span.style.whiteSpace = "nowrap";
      if (content) span.append(content);
      else span.textContent = morph.text.slice(segment.start, segment.end);
      lineElement.append(span);
    }

    if (line.hyphen) {
      const last = lineElement.querySelector<HTMLElement>(":scope > .writing-line-fragment:last-child");
      if (last) {
        const marker = document.createElement("span");
        marker.className = "editorial-composed-hyphen";
        marker.dataset.editorialPresentationHyphen = "true";
        marker.setAttribute("aria-hidden", "true");
        last.append(marker);
      }
    }
    fragment.append(lineElement);
  }

  title.replaceChildren(fragment);
  return true;
}

// Preserve the original child nodes themselves: renderer canonical/composed ownership
// is keyed by node identity, so cloning here would orphan its WeakMap/WeakSet state.
function restoreWritingTitle(title: HTMLElement | null, children: Node[] | null): void {
  if (!title?.querySelector(".writing-line-fragment")) return;
  if (children) title.replaceChildren(...children);
  else title.textContent = "";
}

export function cleanupWritingLineMorph(morph: WritingLineMorph | null): void {
  if (!morph) return;
  restoreWritingTitle(morph.sourceTitle, morph.sourceChildren);
  restoreWritingTitle(morph.targetTitle, morph.targetChildren);
  if (activeWritingLineMorph === morph) activeWritingLineMorph = null;
}

export function cleanupActiveWritingLineMorph(): void {
  cleanupWritingLineMorph(activeWritingLineMorph);
}

export function prepareWritingLineMorph(
  sourceRoot: Element | null,
  slug: string | null,
  nextDocument: Document,
  _destinationIsWriting: boolean,
  reducedMotion: boolean
): WritingLineMorph | null {
  if (!slug || reducedMotion) return null;

  const sourceSlot = sourceRoot?.querySelector<HTMLElement>("[data-vt-writing-title]") ?? null;
  const sourceTitle = titleTextElement(sourceSlot);
  if (!sourceTitle) return null;

  const text = titleCanonicalText(sourceTitle);
  const sourceLines = titleLineSegments(sourceTitle);
  const incoming = measureIncomingWritingLines(nextDocument, slug);
  if (!incoming || incoming.text !== text) return null;
  const targetLines = incoming.lines;
  if (!validLinePlan(sourceLines, text.length) || !validLinePlan(targetLines, text.length)) return null;
  if (sourceLines.length > 8 || targetLines.length > 8) return null;

  const segments = atomicSegments(text.length, sourceLines, targetLines);
  if (!segments.length || segments.length > 16) return null;

  const morph: WritingLineMorph = {
    text,
    sourceTitle,
    targetTitle: null,
    sourceChildren: Array.from(sourceTitle.childNodes),
    targetChildren: null,
    sourceLines,
    targetLines,
    segments
  };

  if (!fragmentWritingTitle(sourceTitle, morph, sourceLines)) return null;
  activeWritingLineMorph = morph;
  return morph;
}

export function retargetWritingLineMorph(morph: WritingLineMorph, targetSlot: HTMLElement): boolean {
  const target = titleTextElement(targetSlot);
  if (!target) return false;

  // The incoming document is composed before this point. If its real layout
  // differs from the hidden pre-measurement, prefer the stable whole-title
  // fallback rather than animating toward a line plan that will flash on cleanup.
  const actualLines = titleLineSegments(target);
  if (!sameLinePlan(actualLines, morph.targetLines)) return false;

  morph.targetChildren = Array.from(target.childNodes);
  if (!fragmentWritingTitle(target, morph, morph.targetLines)) {
    morph.targetChildren = null;
    return false;
  }
  morph.targetTitle = target;
  return true;
}
