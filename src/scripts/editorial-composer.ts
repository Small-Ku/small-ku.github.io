import { EDITORIAL_FIT_PROFILES } from "../lib/editorial-constraints";
import { editorialInlineTarget, invalidateEditorialMeasurements, nativeEditorialLayoutAcceptable } from "./editorial-composer-geometry";
import { composableEditorialRoot, editorialIRForRoot } from "./editorial-composer-policy";
import {
  applyEditorialPlan,
  canonicalEditorialText,
  rememberEditorialCanonicalChildren,
  restoreEditorialPresentation
} from "./editorial-composer-renderer";
import { solveEditorialLayout } from "./editorial-composer-solver";

let resizeScheduled = false;
let editorialResizeObserver: ResizeObserver | null = null;
let editorialFontEventsBound = false;
const observedWidths = new WeakMap<Element, number>();

function composeRoot(root: HTMLElement): void {
  const policy = composableEditorialRoot(root);
  if (!policy) { delete root.dataset.editorialPending; return; }
  rememberEditorialCanonicalChildren(root);
  const { role, locale } = policy;
  const text = canonicalEditorialText(root);
  const ir = editorialIRForRoot(root, text, role, locale);
  if (!ir) { delete root.dataset.editorialPending; return; }
  const target = editorialInlineTarget(root);
  if (target <= 0) { delete root.dataset.editorialPending; return; }
  const profile = EDITORIAL_FIT_PROFILES[role];
  if (nativeEditorialLayoutAcceptable(root, ir, profile, target)) {
    delete root.dataset.editorialPending;
    return;
  }
  const plan = solveEditorialLayout(text, ir, root, target);
  if (!plan || plan.lines.length < 2) { delete root.dataset.editorialPending; return; }
  applyEditorialPlan(root, text, ir, plan);
  delete root.dataset.editorialPending;
}

function scheduleResize(): void {
  if (resizeScheduled) return;
  resizeScheduled = true;
  requestAnimationFrame(() => {
    resizeScheduled = false;
    document.querySelectorAll<HTMLElement>("[data-editorial-root][data-editorial-composed]").forEach((root) => {
      // Restore the canonical server DOM before re-solving to avoid composing
      // our own spans a second time.
      restoreEditorialPresentation(root);
    });
    document.querySelectorAll<HTMLElement>("[data-editorial-root]").forEach(composeRoot);
  });
}

export function composeEditorialTree(scope: ParentNode): void {
  scope.querySelectorAll<HTMLElement>("[data-editorial-root]").forEach(composeRoot);
}

export function bindEditorialComposer(scope: ParentNode = document): void {
  composeEditorialTree(scope);
  if (!editorialFontEventsBound && "fonts" in document) {
    editorialFontEventsBound = true;
    const fontSettled = () => {
      // Computed CSS can be identical before and after a fallback font is
      // replaced. Its style signature alone cannot invalidate cached advances.
      invalidateEditorialMeasurements();
      scheduleResize();
    };
    document.fonts.addEventListener("loadingdone", fontSettled);
  }
  if (typeof ResizeObserver !== "undefined") {
    editorialResizeObserver?.disconnect();
    editorialResizeObserver = new ResizeObserver((entries) => {
      let meaningful = false;
      for (const { target, contentRect } of entries) {
        const width = contentRect.width;
        const previous = observedWidths.get(target) ?? 0;
        observedWidths.set(target, width);
        if (width > 0 && Math.abs(width - previous) >= 0.5) meaningful = true;
      }
      if (meaningful) scheduleResize();
    });
    scope.querySelectorAll<HTMLElement>("[data-editorial-root]").forEach((root) => {
      if (composableEditorialRoot(root)) editorialResizeObserver?.observe(root.parentElement ?? root);
    });
  }
}
