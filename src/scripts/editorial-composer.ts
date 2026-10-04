import { EDITORIAL_FIT_PROFILES } from "../lib/editorial-constraints";
import type { EditorialIRV1, EditorialLayoutPlan } from "../lib/editorial-ir";
import { editorialInlineTarget, invalidateEditorialMeasurements, nativeEditorialLayoutAcceptable } from "./editorial-composer-geometry";
import { composableEditorialRoot, editorialIRForRoot } from "./editorial-composer-policy";
import {
  applyEditorialPlan,
  canonicalEditorialText,
  rememberEditorialCanonicalChildren,
  restoreEditorialPresentation
} from "./editorial-composer-renderer";
import { solveEditorialLayout } from "./editorial-composer-solver";

interface ResizeScheduleToken {
  bind: number;
  attention: number;
}

let resizeScheduledGeneration: ResizeScheduleToken | null = null;
let editorialResizeObserver: ResizeObserver | null = null;
let editorialAttentionObserver: IntersectionObserver | null = null;
let editorialFontEventsBound = false;
let attentionScheduledGeneration: number | null = null;
let attentionGeneration = 0;
let bindGeneration = 0;
let editorialScope: ParentNode = document;
const observedWidths = new WeakMap<Element, number>();
const deferredRoots = new Set<HTMLElement>();

function contentWidth(target: Element): number {
  const style = getComputedStyle(target);
  const padding = (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0);
  const border = (parseFloat(style.borderLeftWidth) || 0) + (parseFloat(style.borderRightWidth) || 0);
  const width = parseFloat(style.width);
  return Number.isFinite(width)
    ? width - (style.boxSizing === "border-box" ? padding + border : 0)
    : target.clientWidth - padding;
}

interface PreparedEditorialRoot {
  root: HTMLElement;
  text: string | null;
  ir: EditorialIRV1 | null;
  plan: EditorialLayoutPlan | null;
}

function prepareEditorialRoot(root: HTMLElement): PreparedEditorialRoot {
  const policy = composableEditorialRoot(root);
  if (!policy) return { root, text: null, ir: null, plan: null };
  rememberEditorialCanonicalChildren(root);
  const { role, locale } = policy;
  const text = canonicalEditorialText(root);
  const ir = editorialIRForRoot(root, text, role, locale);
  if (!ir) return { root, text, ir: null, plan: null };
  const target = editorialInlineTarget(root);
  if (target <= 0) return { root, text, ir, plan: null };
  const profile = EDITORIAL_FIT_PROFILES[role];
  if (nativeEditorialLayoutAcceptable(root, ir, profile, target)) {
    return { root, text, ir, plan: null };
  }
  const plan = solveEditorialLayout(text, ir, root, target);
  return { root, text, ir, plan: plan && plan.lines.length >= 2 ? plan : null };
}

function applyPreparedEditorialRoot(prepared: PreparedEditorialRoot): void {
  const { root, text, ir, plan } = prepared;
  if (text !== null && ir && plan) applyEditorialPlan(root, text, ir, plan);
  delete root.dataset.editorialPending;
}

function composeRoot(root: HTMLElement): void {
  applyPreparedEditorialRoot(prepareEditorialRoot(root));
}

function recomposeRoot(root: HTMLElement): void {
  if (root.dataset.editorialComposed !== undefined) restoreEditorialPresentation(root);
  composeRoot(root);
  const target = root.parentElement ?? root;
  // Presentation hanging can change an intrinsic grid track. Do not treat
  // our own materialization as an external container resize.
  observedWidths.set(target, contentWidth(target));
}

function viewportDistance(root: HTMLElement): number {
  const rect = root.getBoundingClientRect();
  if (rect.bottom < 0) return -rect.bottom;
  if (rect.top > window.innerHeight) return rect.top - window.innerHeight;
  return 0;
}

function attentionPriority(root: HTMLElement): number {
  const role = root.dataset.editorialRole;
  const roleBias = role === "display" ? -2 : role === "intro" ? -1 : 0;
  return viewportDistance(root) + roleBias;
}

function scheduleAttentionFlush(generation: number): void {
  if (generation !== attentionGeneration || deferredRoots.size === 0 || attentionScheduledGeneration === generation) return;
  attentionScheduledGeneration = generation;
  const run = () => {
    if (attentionScheduledGeneration === generation) attentionScheduledGeneration = null;
    if (generation !== attentionGeneration) return;

    let next: HTMLElement | null = null;
    let nextPriority = Number.POSITIVE_INFINITY;
    for (const root of deferredRoots) {
      if (!root.isConnected) {
        deferredRoots.delete(root);
        continue;
      }
      // Attention can move between observer delivery and the idle slice.
      // Keep the root observed so it can be queued again on re-entry.
      if (editorialAttentionObserver && viewportDistance(root) > window.innerHeight) {
        deferredRoots.delete(root);
        continue;
      }
      const priority = attentionPriority(root);
      if (priority < nextPriority) {
        next = root;
        nextPriority = priority;
      }
    }
    if (!next) return;

    const target = next.parentElement ?? next;
    const previous = observedWidths.get(target);
    if (previous !== undefined && Math.abs(contentWidth(target) - previous) >= 0.5) {
      // A container changed before its ResizeObserver delivery. Reschedule
      // the tree before accepting that width as our own presentation effect.
      scheduleResize();
      return;
    }

    deferredRoots.delete(next);
    editorialAttentionObserver?.unobserve(next);
    recomposeRoot(next);
    scheduleAttentionFlush(generation);
  };

  const idleWindow = window as Window & {
    requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
  };
  if (idleWindow.requestIdleCallback) idleWindow.requestIdleCallback(run, { timeout: 250 });
  else requestAnimationFrame(() => window.setTimeout(run, 0));
}

function queueAttentionRoot(root: HTMLElement, generation: number): void {
  if (generation !== attentionGeneration || !root.isConnected) return;
  deferredRoots.add(root);
  scheduleAttentionFlush(generation);
}

function visibleRoot(root: HTMLElement): boolean {
  const rect = root.getBoundingClientRect();
  return rect.bottom >= 0 && rect.top <= window.innerHeight;
}

function immediateEditorialRoot(root: HTMLElement): boolean {
  if (!visibleRoot(root)) return false;
  const role = root.dataset.editorialRole;
  return role === "display" || role === "intro";
}

function scheduleEditorialTree(scope: ParentNode): void {
  const roots = Array.from(scope.querySelectorAll<HTMLElement>("[data-editorial-root]"));
  const generation = ++attentionGeneration;
  deferredRoots.clear();
  editorialAttentionObserver?.disconnect();
  editorialAttentionObserver = null;

  // All geometry must start from canonical layout. Leaving another root's
  // presentation in an intrinsic grid can inflate this root's target width.
  // Deferred canonical roots retain their original child nodes.
  for (const root of roots) {
    if (root.dataset.editorialComposed !== undefined) restoreEditorialPresentation(root);
  }
  for (const root of roots) {
    const target = root.parentElement ?? root;
    observedWidths.set(target, contentWidth(target));
  }

  const immediate = new Set<HTMLElement>();
  for (const root of roots) {
    if (!immediateEditorialRoot(root)) continue;
    immediate.add(root);
    recomposeRoot(root);
  }

  const deferred = roots.filter((root) => !immediate.has(root));
  if (!deferred.length) {
    editorialAttentionObserver = null;
    return;
  }

  if (typeof IntersectionObserver === "undefined") {
    for (const root of deferred) queueAttentionRoot(root, generation);
    return;
  }

  const observer = new IntersectionObserver((entries) => {
    if (generation !== attentionGeneration) return;
    for (const entry of entries) {
      const root = entry.target as HTMLElement;
      if (!entry.isIntersecting) {
        deferredRoots.delete(root);
        continue;
      }
      // A jump/fragment can bypass the near-viewport lead-in. Pending
      // display text must be ready for that viewport's next paint.
      if (immediateEditorialRoot(root)) {
        observer.unobserve(root);
        deferredRoots.delete(root);
        recomposeRoot(root);
        continue;
      }
      queueAttentionRoot(root, generation);
    }
  }, { rootMargin: `${window.innerHeight}px 0px` });
  editorialAttentionObserver = observer;

  for (const root of deferred) editorialAttentionObserver.observe(root);
}

function scheduleResize(): void {
  const token: ResizeScheduleToken = { bind: bindGeneration, attention: attentionGeneration };
  const pending = resizeScheduledGeneration;
  if (pending?.bind === token.bind && pending.attention === token.attention) return;
  resizeScheduledGeneration = token;
  requestAnimationFrame(() => {
    if (resizeScheduledGeneration === token) resizeScheduledGeneration = null;
    if (token.bind !== bindGeneration || token.attention !== attentionGeneration) return;
    scheduleEditorialTree(editorialScope);
  });
}

export function composeEditorialTree(scope: ParentNode): void {
  const roots = Array.from(scope.querySelectorAll<HTMLElement>("[data-editorial-root]"));

  // A synchronous caller needs one coherent canonical geometry world. Cancel
  // deferred attention work, restore every root first, solve every root without
  // presentation side effects, then materialize the prepared plans together.
  ++attentionGeneration;
  deferredRoots.clear();
  editorialAttentionObserver?.disconnect();
  editorialAttentionObserver = null;
  for (const root of roots) {
    if (root.dataset.editorialComposed !== undefined) restoreEditorialPresentation(root);
  }

  const prepared = roots.map(prepareEditorialRoot);
  prepared.forEach(applyPreparedEditorialRoot);

  // Keep ResizeObserver bookkeeping aligned with the resulting presentation so
  // our own atomic materialization is not misclassified as an external resize.
  for (const root of roots) {
    const target = root.parentElement ?? root;
    observedWidths.set(target, contentWidth(target));
  }
}

export function bindEditorialComposer(scope: ParentNode = document): void {
  const generation = ++bindGeneration;
  editorialScope = scope;
  // Invalidate the outgoing page immediately, including when initial binding
  // waits for a frame. Already-delivered observer callbacks are guarded too.
  ++attentionGeneration;
  deferredRoots.clear();
  editorialAttentionObserver?.disconnect();
  editorialAttentionObserver = null;
  editorialResizeObserver?.disconnect();
  const bind = () => {
    if (generation !== bindGeneration) return;
    scheduleEditorialTree(scope);
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
        if (generation !== bindGeneration) return;
        let meaningful = false;
        for (const { target, contentRect } of entries) {
          const width = contentRect.width;
          const previous = observedWidths.get(target);
          observedWidths.set(target, width);
          if (previous !== undefined && width > 0 && Math.abs(width - previous) >= 0.5) meaningful = true;
        }
        if (meaningful) scheduleResize();
      });
      scope.querySelectorAll<HTMLElement>("[data-editorial-root]").forEach((root) => {
        if (composableEditorialRoot(root)) {
          const target = root.parentElement ?? root;
          // Seed content-box width so the initial observer delivery is a
          // no-op, while a resize before that delivery still invalidates.
          observedWidths.set(target, contentWidth(target));
          editorialResizeObserver?.observe(target);
        }
      });
    }
  };

  if (scope === document) requestAnimationFrame(bind);
  else bind();
}
