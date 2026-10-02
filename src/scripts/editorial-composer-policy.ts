import { editorialFitMode } from "../lib/editorial-constraints";
import type { EditorialIRV1, EditorialRole } from "../lib/editorial-ir";

export function composableEditorialRoot(root: HTMLElement): { role: EditorialRole; locale: "en" | "zh" } | null {
  const role = root.dataset.editorialRole;
  const locale = root.dataset.editorialLocale;
  if (role !== "display" && role !== "intro" && role !== "prose" && role !== "compact" && role !== "technical") return null;
  if (locale !== "en" && locale !== "zh") return null;
  return editorialFitMode(role, locale) === "native" ? null : { role, locale };
}
export function validEditorialIR(value: unknown, canonicalLength: number, role: EditorialRole, locale: "en" | "zh"): value is EditorialIRV1 {
  if (!value || typeof value !== "object") return false;
  const ir = value as Partial<EditorialIRV1>;
  if (ir.version !== 1 || ir.canonicalLength !== canonicalLength || ir.role !== role || ir.locale !== locale) return false;
  if (!Array.isArray(ir.atoms) || !Array.isArray(ir.breaks) || !Array.isArray(ir.adjustments)) return false;
  let cursor = 0;
  for (const atom of ir.atoms) {
    if (!Number.isInteger(atom.start) || !Number.isInteger(atom.end) || atom.start !== cursor || atom.end <= atom.start || atom.end > canonicalLength) return false;
    cursor = atom.end;
  }
  if (cursor !== canonicalLength) return false;
  return ir.breaks.every((candidate) => Number.isInteger(candidate.offset) && candidate.offset > 0 && candidate.offset < canonicalLength && Array.isArray(candidate.reasons));
}