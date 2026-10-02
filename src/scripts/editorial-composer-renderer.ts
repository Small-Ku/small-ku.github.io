import type { EditorialIRV1, EditorialLayoutPlan } from "../lib/editorial-ir";
import { appendEditorialInline } from "./editorial-composer-inline";

const composed = new WeakSet<HTMLElement>();
const originalChildren = new WeakMap<HTMLElement, Node[]>();

export function rememberEditorialCanonicalChildren(root: HTMLElement): void {
  if (!originalChildren.has(root)) {
    originalChildren.set(root, Array.from(root.childNodes, (node) => node.cloneNode(true)));
  }
}

export function restoreEditorialPresentation(root: HTMLElement): void {
  if (!composed.has(root)) return;
  const children = originalChildren.get(root);
  if (children) root.replaceChildren(...children.map((node) => node.cloneNode(true)));
  composed.delete(root);
  delete root.dataset.editorialComposed;
  delete root.dataset.editorialTargetWidthPx;
}

export function applyEditorialPlan(root: HTMLElement, text: string, ir: EditorialIRV1, plan: EditorialLayoutPlan): void {
  const fragment = document.createDocumentFragment();
  for (const line of plan.lines) {
    const lineElement = document.createElement("span");
    lineElement.className = "editorial-composed-line";
    lineElement.dataset.editorialPresentationStructure = "line";
    lineElement.dataset.editorialLine = line.start + ":" + line.end;
    lineElement.dataset.editorialHaltCompressionPx = line.haltCompressionPx.toString();
    lineElement.dataset.editorialPostHaltAdvancePx = line.postHaltAdvancePx.toString();
    lineElement.dataset.editorialFinalAdvancePx = line.finalAdvancePx.toString();
    if (line.hangingStartPx > 0 || line.hangingEndPx > 0) {
      lineElement.dataset.editorialPresentationHang = line.hangingStartPx > 0 && line.hangingEndPx > 0 ? "both" : line.hangingStartPx > 0 ? "start" : "end";
      if (line.hangingStartPx > 0) {
        lineElement.dataset.editorialPresentationHangStartPx = line.hangingStartPx.toString();
        lineElement.style.position = "relative";
        lineElement.style.insetInlineStart = -line.hangingStartPx + "px";
      }
      if (line.hangingEndPx > 0) lineElement.dataset.editorialPresentationHangEndPx = line.hangingEndPx.toString();
    }

    const deltas = new Map<number, number>();
    for (const adjustment of line.adjustments) {
      if (adjustment.kind === "punctuation") {
        for (const glyph of adjustment.glyphs) {
          deltas.set(glyph.offset, (deltas.get(glyph.offset) ?? 0) + glyph.deltaPx);
        }
        continue;
      }
      const points = ir.adjustments.filter((point) =>
        point.offset > line.start && point.offset < line.end && point.kind === adjustment.kind
      );
      if (!points.length) continue;
      for (const point of points) {
        deltas.set(point.offset, (deltas.get(point.offset) ?? 0) + adjustment.deltaPx / points.length);
      }
    }

    appendEditorialInline(lineElement, text, ir, line.start, line.end, line.punctuationHalts, deltas);

    if (line.hyphen) {
      const marker = document.createElement("span");
      marker.className = "editorial-composed-hyphen";
      marker.dataset.editorialPresentationHyphen = "true";
      marker.setAttribute("aria-hidden", "true");
      lineElement.append(marker);
    }
    fragment.append(lineElement);
  }
  root.replaceChildren(fragment);
  root.dataset.editorialComposed = "true";
  root.dataset.editorialTargetWidthPx = plan.targetWidthPx.toString();
  composed.add(root);
}

export function canonicalEditorialText(root: HTMLElement): string {
  return root.textContent ?? "";
}
