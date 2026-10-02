import type { EditorialRole } from "./editorial-ir";
import type { SiteLocale } from "./i18n";

export type EditorialFitMode = "native" | "english-rag" | "cjk-optical";

export interface EnglishLineFitBudget {
  /** Natural spacing is always cheapest; this is the low-cost adjustment band. */
  comfortableWordSpaceExtraEm: number;
  /** Emergency hard ceiling per individual word space, further capped by the shortest rendered word. */
  emergencyWordSpaceExtraEm: 5;
  minWordSpaceShrinkRatio: number;
  /** Visible discretionary hyphens may hang optically without changing logical advance. */
  maxHyphenHangEm: number;
  /** Rag inside this band is effectively free so a natural edge beats conspicuous spacing. */
  freeRagEm: number;
  wordSpacePenaltyExponent: number;
  ragPenaltyExponent: number;
}

export interface CjkLineFitBudget {
  /** Hard requirement from the editorial spec. Compression is toward adjacent text, never expansion. */
  maxPunctuationCompressionEm: 0.5;
  /** Reserved for the renderer: optical hanging is distinct from advance-width compression. */
  maxPunctuationHangEm: number;
  /** Additional per-line CJK tracking. Latin glyphs are never tracked to fit a line. */
  maxTrackingExpandEm: number;
  maxTrackingShrinkEm: number;
  /** Small optical mismatch is allowed after cheaper fitting resources are exhausted. */
  residualToleranceEm: number;
}

export interface EditorialFitProfile {
  nativeFirst: boolean;
  english: EnglishLineFitBudget;
  cjk: CjkLineFitBudget;
}

const english = (
  comfortableWordSpaceExtraEm: number,
  minWordSpaceShrinkRatio: number,
  freeRagEm: number
): EnglishLineFitBudget => ({
  comfortableWordSpaceExtraEm,
  emergencyWordSpaceExtraEm: 5,
  minWordSpaceShrinkRatio,
  maxHyphenHangEm: 0.5,
  freeRagEm,
  wordSpacePenaltyExponent: 3,
  ragPenaltyExponent: 2
});

const cjk = (
  maxTrackingExpandEm: number,
  maxTrackingShrinkEm: number,
  residualToleranceEm: number
): CjkLineFitBudget => ({
  maxPunctuationCompressionEm: 0.5,
  maxPunctuationHangEm: 0.5,
  maxTrackingExpandEm,
  maxTrackingShrinkEm,
  residualToleranceEm
});

export const EDITORIAL_FIT_PROFILES: Record<EditorialRole, EditorialFitProfile> = {
  display: {
    nativeFirst: false,
    english: english(0.08, 0.90, 3),
    cjk: cjk(0.08, 0.05, 0.12)
  },
  intro: {
    nativeFirst: true,
    english: english(0.06, 0.92, 2.5),
    cjk: cjk(0.06, 0.04, 0.10)
  },
  prose: {
    nativeFirst: true,
    english: english(0.05, 0.90, 2),
    cjk: cjk(0.04, 0.03, 0.08)
  },
  compact: {
    nativeFirst: true,
    english: english(0, 1, Number.POSITIVE_INFINITY),
    cjk: cjk(0, 0, Number.POSITIVE_INFINITY)
  },
  technical: {
    nativeFirst: true,
    english: english(0, 1, Number.POSITIVE_INFINITY),
    cjk: cjk(0, 0, Number.POSITIVE_INFINITY)
  }
};

export function editorialFitMode(role: EditorialRole, locale: SiteLocale): EditorialFitMode {
  if (role === "compact" || role === "technical") return "native";
  if (locale === "zh") return "cjk-optical";
  if (role === "display" || role === "intro") return "english-rag";
  return "native";
}