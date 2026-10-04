import type { EditorialIRV1, EditorialLinePlan } from "../lib/editorial-ir";

export type PunctuationHalts = EditorialLinePlan["punctuationHalts"];

/** Shared inline construction for candidate measurement and final presentation.
 * Native language runs remain continuous unless an actual resource needs a span. */
export function appendEditorialInline(
  target: HTMLElement,
  text: string,
  ir: EditorialIRV1,
  start: number,
  end: number,
  halts: PunctuationHalts = [],
  deltas: ReadonlyMap<number, number> = new Map()
): void {
  const boundaries = new Set<number>([start, end, ...deltas.keys()]);
  for (const atom of ir.atoms) {
    if (atom.end <= start || atom.start >= end) continue;
    boundaries.add(Math.max(atom.start, start));
    boundaries.add(Math.min(atom.end, end));
  }
  for (const halt of halts) {
    if (halt.end <= start || halt.start >= end) continue;
    boundaries.add(Math.max(halt.start, start));
    boundaries.add(Math.min(halt.end, end));
  }
  const offsets = [...boundaries].sort((a, b) => a - b);
  for (let index = 0; index < offsets.length - 1; index += 1) {
    const from = offsets[index], to = offsets[index + 1];
    if (to <= from) continue;
    const atom = ir.atoms.find(candidate => from >= candidate.start && from < candidate.end);
    const halt = halts.some(range => from >= range.start && to <= range.end);
    const delta = deltas.get(to);
    const value = text.slice(from, to);
    if (!atom?.lang && !delta && !halt) {
      target.append(document.createTextNode(value));
      continue;
    }
    const span = document.createElement("span");
    if (atom?.lang) span.lang = atom.lang;
    if (halt) {
      span.className = "editorial-punctuation-halt";
      span.dataset.editorialPresentationHalt = from + ":" + to;
    }
    span.textContent = value;
    if (delta) span.style.marginInlineEnd = delta + "px";
    target.append(span);
  }
}
