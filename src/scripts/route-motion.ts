import { clampDocumentScroll } from "./soft-navigation-scroll";
import {
  cleanupActiveWritingLineMorph,
  cleanupWritingLineMorph,
  prepareWritingLineMorph,
  retargetWritingLineMorph,
  type WritingLineMorph
} from "./writing-line-transition";
import {
  applyViewTransitionTiming,
  calculateViewTransitionTiming,
  clearTransitionNames,
  nameTransitionElement,
  type RectLike,
  type RectMap
} from "./view-transition";

type RouteKind = "home" | "timeline" | "project" | "writing" | "other";
export interface RouteMeta { kind: RouteKind; id: string | null; locale: string | null; }
type MotionType =
  | "project-enter"
  | "project-exit"
  | "timeline-expand"
  | "timeline-collapse"
  | "writing-identity"
  | "representation-change"
  | null;

export interface MotionContext {
  type: MotionType;
  slug: string | null;
  sourceRoot: Element | null;
  sourcePrimaryRect: RectLike | null;
  sourceSharedRects?: RectMap;
  writingLineMorph?: WritingLineMorph | null;
}

interface MotionMeasurements {
  primaryRect: RectLike | null;
  sharedRects: RectMap;
}

const reduceMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function routeMeta(root: Document): RouteMeta {
  const rawKind = root.documentElement.dataset.routeKind;
  const kind: RouteKind = rawKind === "home" || rawKind === "timeline" || rawKind === "project" || rawKind === "writing"
    ? rawKind
    : "other";
  return {
    kind,
    id: root.documentElement.dataset.routeId || null,
    locale: root.documentElement.dataset.locale || null
  };
}

function rect(element: Element | null): RectLike | null {
  if (!element) return null;
  const value = element.getBoundingClientRect();
  if (value.width <= 0 || value.height <= 0) return null;
  return {
    x: value.x, y: value.y, width: value.width, height: value.height,
    top: value.top, right: value.right, bottom: value.bottom, left: value.left
  };
}

function visible(element: Element | null): boolean {
  const value = rect(element);
  return !!value && value.bottom > 0 && value.right > 0 && value.top < innerHeight && value.left < innerWidth;
}


const projectTransitionGroups = ["project-surface", "project-visual", "project-title"] as const;

function explicit2dTransform(value: string, rotation: number): string {
  if (!value || value === "none") return value;
  const matrix = new DOMMatrixReadOnly(value);
  const epsilon = 1e-6;
  const planar = matrix.is2D || (
    Math.abs(matrix.m13) <= epsilon &&
    Math.abs(matrix.m14) <= epsilon &&
    Math.abs(matrix.m23) <= epsilon &&
    Math.abs(matrix.m24) <= epsilon &&
    Math.abs(matrix.m31) <= epsilon &&
    Math.abs(matrix.m32) <= epsilon &&
    Math.abs(matrix.m34) <= epsilon &&
    Math.abs(matrix.m43) <= epsilon &&
    Math.abs(matrix.m33 - 1) <= epsilon &&
    Math.abs(matrix.m44 - 1) <= epsilon
  );
  if (!planar) return value;

  const a = matrix.m11;
  const b = matrix.m12;
  const c = matrix.m21;
  const d = matrix.m22;
  const scaleX = Math.hypot(a, b);
  if (scaleX < epsilon) return value;
  const determinant = a * d - b * c;
  const scaleY = determinant / scaleX;
  const skew = (a * c + b * d) / (scaleX * scaleX);
  if (Math.abs(skew) > 1e-4) return value;

  return `translate(${matrix.m41}px, ${matrix.m42}px) rotate(${rotation}deg) scale(${scaleX}, ${scaleY})`;
}

function stabilizeProjectTransitionRotation(context: MotionContext): void {
  if (!context.slug) return;
  const fanRotation = projectFanRotation(projectRoot(document, context.slug, false));
  for (const name of projectTransitionGroups) {
    const pseudo = `::view-transition-group(${name})`;
    const generated = document.getAnimations().find((candidate) => {
      const effect = candidate.effect;
      return effect instanceof KeyframeEffect && effect.pseudoElement === pseudo;
    });
    const effect = generated?.effect;
    if (!(effect instanceof KeyframeEffect)) continue;

    const sourceFrames = effect.getKeyframes();
    if (sourceFrames.length < 2 || sourceFrames.some((frame) => typeof frame.transform !== "string")) continue;
    effect.setKeyframes(sourceFrames.map((frame, index) => {
      const progress = typeof frame.offset === "number"
        ? frame.offset
        : sourceFrames.length === 1 ? 1 : index / (sourceFrames.length - 1);
      const rotation = fanRotation * progress;
      const { computedOffset: _computedOffset, ...authored } = frame;
      return {
        ...authored,
        transform: explicit2dTransform(frame.transform as string, rotation)
      };
    }));
  }
}

export function relinquishOpenSiteMenus(): void {
  document.querySelectorAll<HTMLElement>(".site-menu:popover-open").forEach((menu) => {
    menu.dataset.motionRelinquish = "true";
    menu.hidePopover();
    requestAnimationFrame(() => { delete menu.dataset.motionRelinquish; });
  });
}

function nameLatestWritingRows(kind: "home" | "timeline"): void {
  const selector = kind === "home"
    ? ".latest-writing [data-latest-rank]"
    : ".timeline-entry[data-latest-rank] > .writing-entry";

  document.querySelectorAll<HTMLElement>(selector).forEach((element) => {
    const rank = Number(element.dataset.latestRank);
    if (rank >= 1 && rank <= 3) nameTransitionElement(element, `latest-writing-${rank}`);
  });
}

function latestWritingRects(kind: "home" | "timeline"): RectMap {
  const selector = kind === "home"
    ? ".latest-writing [data-latest-rank]"
    : ".timeline-entry[data-latest-rank] > .writing-entry";
  const result: RectMap = {};

  document.querySelectorAll<HTMLElement>(selector).forEach((element) => {
    const rank = Number(element.dataset.latestRank);
    const value = rect(element);
    if (rank >= 1 && rank <= 3 && value) result[`latest-writing-${rank}`] = value;
  });
  return result;
}

function projectSharedRects(root: Element | null): RectMap {
  const result: RectMap = {};
  const visual = rect(root?.querySelector("[data-vt-project-visual]") ?? null);
  const title = rect(root?.querySelector("[data-vt-project-title]") ?? null);
  if (visual) result["project-visual"] = visual;
  if (title) result["project-title"] = title;
  return result;
}

function writingSharedRects(root: Element | null): RectMap {
  const title = rect(root?.querySelector("[data-vt-writing-title]") ?? null);
  return title ? { "writing-title": title } : {};
}

function projectRoot(scope: ParentNode, slug: string, destination: boolean): Element | null {
  const marker = destination ? "data-vt-project-destination" : "data-vt-project-origin";
  return scope.querySelector(`[${marker}][data-work-slug="${CSS.escape(slug)}"]`);
}

function projectFanRotation(root: Element | null): number {
  if (!(root instanceof HTMLElement)) return 0;
  const value = getComputedStyle(root).getPropertyValue("--fan-r").trim();
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function nameProject(root: Element | null, includeExtras = false): boolean {
  if (!root) return false;
  const surface = root.querySelector("[data-vt-project-surface]");
  const visual = root.querySelector("[data-vt-project-visual]");
  const title = root.querySelector("[data-vt-project-title]");
  if (!surface || !title) return false;

  nameTransitionElement(surface, "project-surface");
  if (visual) nameTransitionElement(visual, "project-visual");
  nameTransitionElement(title, "project-title");

  if (includeExtras) {
    nameTransitionElement(root.querySelector("[data-vt-project-eyebrow]"), "project-eyebrow");
    nameTransitionElement(root.querySelector("[data-vt-project-supporting]"), "project-supporting-content");
    nameTransitionElement(root.querySelector("[data-vt-project-facts]"), "project-facts");
    nameTransitionElement(document.querySelector("[data-vt-project-support]"), "project-body");
  }
  return true;
}

export function createRouteMotionContext(anchor: HTMLAnchorElement, from: RouteMeta, to: RouteMeta, push: boolean): MotionContext {
  const fromKind = from.kind;
  const toKind = to.kind;
  const slug = to.id ?? from.id;

  const sameIdentity = from.kind === to.kind && from.id === to.id;
  if (sameIdentity && from.locale && to.locale && from.locale !== to.locale) {
    return { type: "representation-change", slug, sourceRoot: null, sourcePrimaryRect: null };
  }

  if ((fromKind === "home" || fromKind === "timeline") && toKind === "project" && slug) {
    const sourceRoot = anchor.closest(`[data-vt-project-origin][data-work-slug="${CSS.escape(slug)}"]`);
    const primary = sourceRoot?.querySelector("[data-vt-project-surface]") ?? null;
    return {
      type: sourceRoot ? "project-enter" : null,
      slug,
      sourceRoot,
      sourcePrimaryRect: rect(primary),
      sourceSharedRects: projectSharedRects(sourceRoot)
    };
  }

  if (fromKind === "project" && (toKind === "home" || toKind === "timeline") && slug) {
    const sourceRoot = projectRoot(document, slug, true);
    if (toKind === "home" && sourceRoot?.getAttribute("data-project-selected") === "false") {
      return { type: null, slug, sourceRoot: null, sourcePrimaryRect: null };
    }
    const primary = sourceRoot?.querySelector("[data-vt-project-surface]") ?? null;
    return {
      type: sourceRoot ? "project-exit" : null,
      slug,
      sourceRoot,
      sourcePrimaryRect: rect(primary),
      sourceSharedRects: projectSharedRects(sourceRoot)
    };
  }

  if (fromKind === "home" && toKind === "timeline") {
    // A direct "View all" click and a browser Forward traversal back to the
    // Timeline share the same portal semantics. Header/nav Timeline links still
    // use a normal navigation because they did not originate from the portal.
    const sourceRoot = anchor.matches("[data-vt-timeline-origin]")
      ? anchor
      : !push
        ? document.querySelector("[data-vt-timeline-origin]")
        : null;
    const primary = sourceRoot?.querySelector("[data-vt-timeline-surface]") ?? null;
    return {
      type: sourceRoot ? "timeline-expand" : null,
      slug: null,
      sourceRoot,
      sourcePrimaryRect: rect(primary),
      sourceSharedRects: sourceRoot ? latestWritingRects("home") : {}
    };
  }

  if (fromKind === "timeline" && toKind === "home" && !push) {
    const sourceRoot = document.querySelector("[data-vt-timeline-destination]");
    const primary = sourceRoot?.querySelector("[data-vt-timeline-surface]") ?? null;
    return {
      type: sourceRoot ? "timeline-collapse" : null,
      slug: null,
      sourceRoot,
      sourcePrimaryRect: rect(primary),
      sourceSharedRects: latestWritingRects("timeline")
    };
  }

  if ((fromKind === "home" || fromKind === "timeline") && toKind === "writing") {
    const sourceRoot = anchor.closest("[data-writing-slug]");
    const title = sourceRoot?.querySelector("[data-vt-writing-title]") ?? null;
    return {
      type: title ? "writing-identity" : null,
      slug,
      sourceRoot,
      sourcePrimaryRect: rect(title),
      sourceSharedRects: writingSharedRects(sourceRoot)
    };
  }

  if (fromKind === "writing" && (toKind === "timeline" || (!push && toKind === "home"))) {
    const sourceRoot = document.querySelector(`[data-writing-slug="${CSS.escape(slug ?? "")}"]`);
    const title = sourceRoot?.querySelector("[data-vt-writing-title]") ?? null;
    return {
      type: title ? "writing-identity" : null,
      slug,
      sourceRoot,
      sourcePrimaryRect: rect(title),
      sourceSharedRects: writingSharedRects(sourceRoot)
    };
  }

  return { type: null, slug, sourceRoot: null, sourcePrimaryRect: null };
}

export function prepareOutgoingRouteMotion(context: MotionContext, nextDocument: Document): void {
  clearTransitionNames();
  document.documentElement.dataset.motionType = context.type ?? "none";

  if (context.type === "project-enter") nameProject(context.sourceRoot, false);
  if (context.type === "project-exit") nameProject(context.sourceRoot, true);
  if (context.type === "timeline-expand") {
    nameTransitionElement(context.sourceRoot, "timeline-origin-content");
    nameTransitionElement(context.sourceRoot?.querySelector("[data-vt-timeline-surface]") ?? null, "timeline-surface");
    nameLatestWritingRows("home");
  }
  if (context.type === "timeline-collapse") {
    nameTransitionElement(context.sourceRoot, "timeline-destination-content");
    nameTransitionElement(context.sourceRoot?.querySelector("[data-vt-timeline-surface]") ?? null, "timeline-surface");
    nameLatestWritingRows("timeline");
  }
  if (context.type === "writing-identity") {
    context.writingLineMorph = prepareWritingLineMorph(
      context.sourceRoot,
      context.slug,
      nextDocument,
      routeMeta(nextDocument).kind === "writing",
      reduceMotion()
    );
    if (!context.writingLineMorph) {
      nameTransitionElement(context.sourceRoot?.querySelector("[data-vt-writing-title]") ?? null, "writing-title");
    }
  }
}

export function prepareIncomingRouteMotion(context: MotionContext): MotionMeasurements {
  if (context.type === "project-enter" && context.slug) {
    const target = projectRoot(document, context.slug, true);
    nameProject(target, true);
    return {
      primaryRect: rect(target?.querySelector("[data-vt-project-surface]") ?? null),
      sharedRects: projectSharedRects(target)
    };
  }

  if (context.type === "project-exit" && context.slug) {
    const target = projectRoot(document, context.slug, false);
    // Shared transforms only make sense when the restored/aligned destination is painted.
    if (!visible(target)) return { primaryRect: null, sharedRects: {} };
    nameProject(target, false);
    return {
      primaryRect: rect(target?.querySelector("[data-vt-project-surface]") ?? null),
      sharedRects: projectSharedRects(target)
    };
  }

  if (context.type === "timeline-expand") {
    const target = document.querySelector("[data-vt-timeline-destination]");
    nameTransitionElement(target, "timeline-destination-content");
    nameTransitionElement(target?.querySelector("[data-vt-timeline-surface]") ?? null, "timeline-surface");
    // r22 accidentally named the latest rows only on the outgoing Home side.
    // A shared transform requires the same names on the incoming Timeline side.
    nameLatestWritingRows("timeline");
    return {
      primaryRect: rect(target?.querySelector("[data-vt-timeline-surface]") ?? null),
      sharedRects: latestWritingRects("timeline")
    };
  }

  if (context.type === "timeline-collapse") {
    const target = document.querySelector("[data-vt-timeline-origin]");
    nameTransitionElement(target, "timeline-origin-content");
    nameTransitionElement(target?.querySelector("[data-vt-timeline-surface]") ?? null, "timeline-surface");
    nameLatestWritingRows("home");
    return {
      primaryRect: rect(target?.querySelector("[data-vt-timeline-surface]") ?? null),
      sharedRects: latestWritingRects("home")
    };
  }

  if (context.type === "writing-identity" && context.slug) {
    const root = document.querySelector(`[data-writing-slug="${CSS.escape(context.slug)}"]`);
    const target = root?.querySelector<HTMLElement>("[data-vt-writing-title]") ?? null;
    if (target && context.writingLineMorph) {
      if (!retargetWritingLineMorph(context.writingLineMorph, target)) {
        cleanupWritingLineMorph(context.writingLineMorph);
        context.writingLineMorph = null;
        nameTransitionElement(target, "writing-title");
      }
    } else {
      nameTransitionElement(target, "writing-title");
    }
    return { primaryRect: rect(target), sharedRects: writingSharedRects(root) };
  }

  return { primaryRect: null, sharedRects: {} };
}

function alignedLatestWritingScroll(context: MotionContext): number | null {
  if (context.type !== "timeline-expand") return null;

  const targets = latestWritingRects("timeline");
  const headerBottom = rect(document.querySelector(".site-header"))?.bottom ?? 0;
  const candidates: number[] = [];
  const fallback: number[] = [];

  for (const [name, source] of Object.entries(context.sourceSharedRects ?? {})) {
    const target = targets[name];
    if (!target) continue;
    // getBoundingClientRect() is viewport-relative on both pages. Scrolling the
    // destination by this delta moves its row back onto the source row's Y.
    const delta = target.top - source.top;
    fallback.push(delta);
    if (source.bottom > headerBottom && source.top < innerHeight) candidates.push(delta);
  }

  const values = candidates.length ? candidates : fallback;
  if (!values.length) return null;
  values.sort((a, b) => a - b);
  const middle = Math.floor(values.length / 2);
  const delta = values.length % 2
    ? values[middle]
    : (values[middle - 1] + values[middle]) / 2;
  return clampDocumentScroll(window.scrollY + delta);
}

function alignedWritingTargetScroll(context: MotionContext, destination: RouteMeta): number | null {
  if (context.type !== "writing-identity" || !context.slug) return null;
  if (destination.kind !== "home" && destination.kind !== "timeline") return null;

  const target = document.querySelector(`[data-writing-slug="${CSS.escape(context.slug)}"]`);
  const targetTitle = target?.querySelector("[data-vt-writing-title]") ?? null;
  const targetRect = rect(targetTitle);
  if (!targetRect) return null;

  const headerBottom = rect(document.querySelector(".site-header"))?.bottom ?? 0;
  const sourceTop = context.sourcePrimaryRect?.top ?? headerBottom + 24;
  const desiredTop = Math.max(headerBottom + 24, Math.min(sourceTop, innerHeight * 0.72));
  return clampDocumentScroll(window.scrollY + targetRect.top - desiredTop);
}

function alignedTimelineTargetScroll(context: MotionContext, destination: RouteMeta, push: boolean): number | null {
  if (!push || destination.kind !== "timeline") return null;

  // "View all" preserves the current reading context: install the Timeline,
  // then position it so the shared rows stay in approximately the same viewport
  // Y coordinates instead of first drifting down toward the Timeline header.
  const latestWritingScroll = alignedLatestWritingScroll(context);
  if (latestWritingScroll !== null) return latestWritingScroll;

  if (!context.slug) return null;
  let target: Element | null = null;
  if (context.type === "project-exit") {
    target = projectRoot(document, context.slug, false);
  } else if (context.type === "writing-identity") {
    target = document.querySelector(`[data-writing-slug="${CSS.escape(context.slug)}"]`);
  }
  const targetRect = rect(target);
  if (!targetRect) return null;

  const headerHeight = rect(document.querySelector(".site-header"))?.height ?? 0;
  const desiredTop = Math.max(headerHeight + 24, Math.min(innerHeight * 0.18, 160));
  return clampDocumentScroll(window.scrollY + targetRect.top - desiredTop);
}


export function hasRouteMotion(context: MotionContext): boolean {
  return context.type !== null;
}

export function routeMotionAnimated(context: MotionContext): boolean {
  return !reduceMotion() && hasRouteMotion(context);
}

export function prepareRouteMotionBeforeCapture(context: MotionContext): void {
  if (context.type === "representation-change") relinquishOpenSiteMenus();
}

export function alignedRouteTargetScroll(
  context: MotionContext,
  destination: RouteMeta,
  push: boolean
): number | null {
  return alignedWritingTargetScroll(context, destination)
    ?? alignedTimelineTargetScroll(context, destination, push);
}

export function configureIncomingRouteMotion(
  context: MotionContext,
  target: MotionMeasurements
): void {
  if (context.type === "project-exit" && !target.primaryRect) {
    // The logical target exists but is not in the restored viewport. Do not
    // make a shared object fly offscreen merely to preserve a technical match.
    clearTransitionNames();
    document.documentElement.dataset.motionType = "none";
    return;
  }

  if (context.type === "representation-change") return;

  const timingMultiplier = context.type === "writing-identity"
    ? 0.72
    : context.type === "timeline-expand" || context.type === "timeline-collapse"
      ? 1.04
      : 1;

  applyViewTransitionTiming(calculateViewTransitionTiming(
    context.sourcePrimaryRect,
    target.primaryRect,
    context.sourceSharedRects,
    target.sharedRects,
    {
      multiplier: timingMultiplier,
      fallbackDuration: context.type === "writing-identity" ? 360 : 560,
      reducedMotion: reduceMotion()
    }
  ));
}

export function onRouteMotionReady(context: MotionContext): void {
  if (context.type === "project-exit") stabilizeProjectTransitionRotation(context);
}

export function cleanupActiveRouteMotion(): void {
  cleanupActiveWritingLineMorph();
}

export function cleanupRouteMotion(context: MotionContext): void {
  cleanupWritingLineMorph(context.writingLineMorph ?? null);
  clearTransitionNames();
  document.documentElement.dataset.motionType = "none";
}
