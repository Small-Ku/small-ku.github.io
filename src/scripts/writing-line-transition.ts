export interface WritingLineMorph {
  text: string;
  sourceTitle: HTMLElement;
  targetTitle: HTMLElement | null;
  segments: Array<{
    start: number;
    end: number;
    name: string;
  }>;
}

let activeWritingLineMorph: WritingLineMorph | null = null;

function titleTextElement(element: Element | null): HTMLElement | null {
  if (!(element instanceof HTMLElement)) return null;
  const ownText = Array.from(element.childNodes).some(
    (node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim()
  );
  if (ownText) return element;
  return element.querySelector<HTMLElement>("h1, h2, h3");
}

function titleTextNode(element: Element | null): Text | null {
  const textElement = titleTextElement(element);
  if (!textElement) return null;
  const nodes = Array.from(textElement.childNodes).filter(
    (node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim()
  );
  return nodes.length === 1 && nodes[0] instanceof Text ? nodes[0] : null;
}

function textRangeTop(title: HTMLElement, start: number, end: number): number | null {
  const node = titleTextNode(title);
  if (!node || start < 0 || end <= start || end > node.data.length) return null;

  const range = document.createRange();
  range.setStart(node, start);
  range.setEnd(node, end);
  const boxes = Array.from(range.getClientRects()).filter((box) => box.width > 0 && box.height > 0);
  if (!boxes.length) return null;
  return Math.min(...boxes.map((box) => box.top));
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

function titleLineSegments(title: HTMLElement): Array<{ start: number; end: number }> {
  const node = titleTextNode(title);
  if (!node) return [];

  const fragments: Array<{ start: number; end: number; top: number }> = [];
  for (const grapheme of graphemeOffsets(node.data)) {
    if (/^\s+$/u.test(grapheme.text)) continue;
    const top = textRangeTop(title, grapheme.start, grapheme.end);
    if (top !== null) fragments.push({ start: grapheme.start, end: grapheme.end, top });
  }
  if (!fragments.length) return [];

  const lines: Array<{ start: number; end: number; top: number }> = [];
  for (const fragment of fragments) {
    const current = lines.at(-1);
    if (!current || Math.abs(fragment.top - current.top) > 1) {
      lines.push({ ...fragment });
    } else {
      current.end = fragment.end;
    }
  }
  return lines.map(({ start, end }) => ({ start, end }));
}

function measureIncomingArticleLines(nextDocument: Document, slug: string): Array<{ start: number; end: number }> {
  const root = nextDocument.querySelector('[data-writing-slug="' + CSS.escape(slug) + '"]');
  if (!(root instanceof HTMLElement) || !root.classList.contains("article-head")) return [];

  const shell = document.createElement("div");
  Object.assign(shell.style, {
    position: "fixed",
    inset: "0",
    visibility: "hidden",
    pointerEvents: "none",
    overflow: "hidden"
  });
  const clone = document.importNode(root, true);
  shell.append(clone);
  document.body.append(shell);

  const slot = clone.querySelector<HTMLElement>("[data-vt-writing-title]");
  const title = titleTextElement(slot);
  const lines = title ? titleLineSegments(title) : [];
  shell.remove();
  return lines;
}

function fragmentWritingTitle(title: HTMLElement, morph: WritingLineMorph): boolean {
  const node = titleTextNode(title);
  if (!node || node.data !== morph.text || title.childNodes.length !== 1) return false;

  const fragment = document.createDocumentFragment();
  let cursor = 0;
  for (const segment of morph.segments) {
    if (segment.start < cursor || segment.end <= segment.start || segment.end > morph.text.length) return false;
    if (segment.start > cursor) fragment.append(document.createTextNode(morph.text.slice(cursor, segment.start)));

    const span = document.createElement("span");
    span.className = "writing-line-fragment";
    span.textContent = morph.text.slice(segment.start, segment.end);
    span.style.viewTransitionName = segment.name;
    span.style.whiteSpace = "nowrap";
    fragment.append(span);
    cursor = segment.end;
  }
  if (cursor < morph.text.length) fragment.append(document.createTextNode(morph.text.slice(cursor)));
  title.replaceChildren(fragment);
  return true;
}

function restoreWritingTitle(title: HTMLElement | null, text: string): void {
  if (!title?.querySelector(":scope > .writing-line-fragment")) return;
  title.textContent = text;
}

export function cleanupWritingLineMorph(morph: WritingLineMorph | null): void {
  if (!morph) return;
  restoreWritingTitle(morph.sourceTitle, morph.text);
  restoreWritingTitle(morph.targetTitle, morph.text);
  if (activeWritingLineMorph === morph) activeWritingLineMorph = null;
}

export function cleanupActiveWritingLineMorph(): void {
  cleanupWritingLineMorph(activeWritingLineMorph);
}

export function prepareWritingLineMorph(
  sourceRoot: Element | null,
  slug: string | null,
  nextDocument: Document,
  destinationIsWriting: boolean,
  reducedMotion: boolean
): WritingLineMorph | null {
  if (!slug || reducedMotion) return null;

  const sourceSlot = sourceRoot?.querySelector<HTMLElement>("[data-vt-writing-title]") ?? null;
  const sourceTitle = titleTextElement(sourceSlot);
  const sourceNode = titleTextNode(sourceTitle);
  if (!sourceTitle || !sourceNode) return null;

  const ranges = destinationIsWriting
    ? measureIncomingArticleLines(nextDocument, slug)
    : titleLineSegments(sourceTitle);
  if (!ranges.length || ranges.length > 8) return null;

  const morph: WritingLineMorph = {
    text: sourceNode.data,
    sourceTitle,
    targetTitle: null,
    segments: ranges.map((range, index) => ({
      ...range,
      name: "writing-line-" + (index + 1)
    }))
  };

  if (!fragmentWritingTitle(sourceTitle, morph)) return null;
  activeWritingLineMorph = morph;
  return morph;
}

export function retargetWritingLineMorph(morph: WritingLineMorph, targetSlot: HTMLElement): boolean {
  const target = titleTextElement(targetSlot);
  if (!target || !fragmentWritingTitle(target, morph)) return false;
  morph.targetTitle = target;
  return true;
}