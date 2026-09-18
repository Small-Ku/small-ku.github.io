import { bindFilterSwitch } from "./filter-switch";
import { bindTimelineFilter } from "./timeline";

type RouteKind = "home" | "timeline" | "project" | "writing" | "other";
interface RouteMeta { kind: RouteKind; id: string | null; }
type MotionType =
  | "project-enter"
  | "project-exit"
  | "timeline-expand"
  | "timeline-collapse"
  | "writing-identity"
  | null;

type RectLike = Pick<DOMRect, "x" | "y" | "width" | "height" | "top" | "right" | "bottom" | "left">;
type RectMap = Record<string, RectLike>;

interface MotionContext {
  type: MotionType;
  slug: string | null;
  sourceRoot: Element | null;
  sourcePrimaryRect: RectLike | null;
  sourceSharedRects?: RectMap;
}

interface MotionMeasurements {
  primaryRect: RectLike | null;
  sharedRects: RectMap;
}

interface MotionTiming {
  duration: number;
  distance: number;
  areaRatio: number;
}

interface HistoryMotionState {
  ftNav?: true;
  scrollY?: number;
}

const cache = new Map<string, Promise<Document>>();
let navigationSerial = 0;
const reduceMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const toUrl = (value: string | URL) => value instanceof URL ? value : new URL(value, location.href);
function routeMeta(root: Document): RouteMeta {
  const rawKind = root.documentElement.dataset.routeKind;
  const kind: RouteKind = rawKind === "home" || rawKind === "timeline" || rawKind === "project" || rawKind === "writing"
    ? rawKind
    : "other";
  return { kind, id: root.documentElement.dataset.routeId || null };
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

function dynamicTiming(
  from: RectLike | null,
  to: RectLike | null,
  type: MotionType,
  fromShared: RectMap = {},
  toShared: RectMap = {}
): MotionTiming {
  if (reduceMotion()) return { duration: 1, distance: 0, areaRatio: 1 };

  const pairs: Array<[RectLike, RectLike]> = [];
  if (from && to) pairs.push([from, to]);
  for (const [name, fromRect] of Object.entries(fromShared)) {
    const toRect = toShared[name];
    if (toRect) pairs.push([fromRect, toRect]);
  }

  if (pairs.length === 0) {
    return { duration: type === "writing-identity" ? 360 : 560, distance: 0, areaRatio: 1 };
  }

  const viewportDiagonal = Math.max(1, Math.hypot(innerWidth, innerHeight));
  let maxDistance = 0;
  let maxDistanceNorm = 0;
  let maxAreaRatio = 1;
  let maxAreaNorm = 0;

  for (const [fromRect, toRect] of pairs) {
    const fromCx = fromRect.left + fromRect.width / 2;
    const fromCy = fromRect.top + fromRect.height / 2;
    const toCx = toRect.left + toRect.width / 2;
    const toCy = toRect.top + toRect.height / 2;
    const distance = Math.hypot(toCx - fromCx, toCy - fromCy);
    const distanceNorm = Math.min(1, distance / viewportDiagonal);

    const fromArea = Math.max(1, fromRect.width * fromRect.height);
    const toArea = Math.max(1, toRect.width * toRect.height);
    const areaRatio = Math.max(fromArea, toArea) / Math.min(fromArea, toArea);
    const areaNorm = Math.min(1, Math.abs(Math.log(areaRatio)) / Math.log(12));

    if (distanceNorm > maxDistanceNorm) {
      maxDistanceNorm = distanceNorm;
      maxDistance = distance;
    }
    if (areaNorm > maxAreaNorm) {
      maxAreaNorm = areaNorm;
      maxAreaRatio = areaRatio;
    }
  }

  // Old and new measurements are both viewport-relative at capture time. The
  // old rects therefore include the source page's current scroll position; the
  // new rects include the destination scroll applied inside the VT update. The
  // slowest shared object, not only the surface, is allowed to set the clock.
  const duration = 320 + 240 * Math.sqrt(maxDistanceNorm) + 200 * maxAreaNorm;
  const multiplier = type === "writing-identity"
    ? 0.72
    : type === "timeline-expand" || type === "timeline-collapse"
      ? 1.04
      : 1;
  return {
    duration: Math.round(Math.min(820, Math.max(340, duration * multiplier))),
    distance: Math.round(maxDistance),
    areaRatio: maxAreaRatio
  };
}

function setTiming(timing: MotionTiming): void {
  const root = document.documentElement;
  root.style.setProperty("--ft-motion-route", `${timing.duration}ms`);
  root.style.setProperty("--ft-motion-distance", `${timing.distance}px`);
  root.style.setProperty("--ft-motion-area-ratio", timing.areaRatio.toFixed(3));
}

function clearTransitionNames(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>("[style*='view-transition-name']").forEach((element) => {
    element.style.removeProperty("view-transition-name");
  });
}

function nameElement(element: Element | null, name: string): boolean {
  if (!(element instanceof HTMLElement)) return false;
  element.style.viewTransitionName = name;
  return true;
}

function nameLatestWritingRows(kind: "home" | "timeline"): void {
  const selector = kind === "home"
    ? ".latest-writing [data-latest-rank]"
    : ".timeline-entry[data-latest-rank] > .writing-entry";

  document.querySelectorAll<HTMLElement>(selector).forEach((element) => {
    const rank = Number(element.dataset.latestRank);
    if (rank >= 1 && rank <= 3) nameElement(element, `latest-writing-${rank}`);
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

function nameProject(root: Element | null, includeExtras = false): boolean {
  if (!root) return false;
  const surface = root.querySelector("[data-vt-project-surface]");
  const visual = root.querySelector("[data-vt-project-visual]");
  const title = root.querySelector("[data-vt-project-title]");
  if (!surface || !title) return false;

  nameElement(surface, "project-surface");
  if (visual) nameElement(visual, "project-visual");
  nameElement(title, "project-title");

  if (includeExtras) {
    nameElement(root.querySelector("[data-vt-project-eyebrow]"), "project-eyebrow");
    nameElement(root.querySelector("[data-vt-project-supporting]"), "project-supporting-content");
    nameElement(root.querySelector("[data-vt-project-facts]"), "project-facts");
    nameElement(document.querySelector("[data-vt-project-support]"), "project-body");
  }
  return true;
}

function sourceContext(anchor: HTMLAnchorElement, from: RouteMeta, to: RouteMeta, push: boolean): MotionContext {
  const fromKind = from.kind;
  const toKind = to.kind;
  const slug = to.id ?? from.id;

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

function nameOutgoing(context: MotionContext): void {
  clearTransitionNames();
  document.documentElement.dataset.motionType = context.type ?? "none";

  if (context.type === "project-enter") nameProject(context.sourceRoot, false);
  if (context.type === "project-exit") nameProject(context.sourceRoot, true);
  if (context.type === "timeline-expand") {
    nameElement(context.sourceRoot, "timeline-origin-content");
    nameElement(context.sourceRoot?.querySelector("[data-vt-timeline-surface]") ?? null, "timeline-surface");
    nameLatestWritingRows("home");
  }
  if (context.type === "timeline-collapse") {
    nameElement(context.sourceRoot, "timeline-destination-content");
    nameElement(context.sourceRoot?.querySelector("[data-vt-timeline-surface]") ?? null, "timeline-surface");
    nameLatestWritingRows("timeline");
  }
  if (context.type === "writing-identity") {
    nameElement(context.sourceRoot?.querySelector("[data-vt-writing-title]") ?? null, "writing-title");
  }
}

function nameIncoming(context: MotionContext): MotionMeasurements {
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
    nameElement(target, "timeline-destination-content");
    nameElement(target?.querySelector("[data-vt-timeline-surface]") ?? null, "timeline-surface");
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
    nameElement(target, "timeline-origin-content");
    nameElement(target?.querySelector("[data-vt-timeline-surface]") ?? null, "timeline-surface");
    nameLatestWritingRows("home");
    return {
      primaryRect: rect(target?.querySelector("[data-vt-timeline-surface]") ?? null),
      sharedRects: latestWritingRects("home")
    };
  }

  if (context.type === "writing-identity" && context.slug) {
    const root = document.querySelector(`[data-writing-slug="${CSS.escape(context.slug)}"]`);
    const target = root?.querySelector("[data-vt-writing-title]") ?? null;
    nameElement(target, "writing-title");
    return { primaryRect: rect(target), sharedRects: writingSharedRects(root) };
  }

  return { primaryRect: null, sharedRects: {} };
}

async function fetchDocument(url: URL): Promise<Document> {
  const key = url.href;
  let pending = cache.get(key);
  if (!pending) {
    pending = fetch(key, { headers: { "X-Template-Navigation": "1" } }).then(async (response) => {
      if (!response.ok) throw new Error(`Navigation fetch failed: ${response.status}`);
      const html = await response.text();
      return new DOMParser().parseFromString(html, "text/html");
    }).catch((error) => {
      cache.delete(key);
      throw error;
    });
    cache.set(key, pending);
  }
  return pending;
}

function updateHeader(url: URL): void {
  document.querySelectorAll<HTMLAnchorElement>(".site-nav a[href]").forEach((link) => {
    const href = new URL(link.href, location.href);
    const exact = href.pathname === "/" ? url.pathname === "/" : url.pathname.startsWith(href.pathname);
    if (exact) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
}

function syncDocumentHead(nextDocument: Document): void {
  const selectors = [
    'meta[name="description"]',
    'meta[name="robots"]',
    'link[rel="canonical"]',
    'meta[property^="og:"]',
    'meta[name^="twitter:"]',
    'script[type="application/ld+json"]'
  ];

  for (const selector of selectors) {
    document.head.querySelectorAll(selector).forEach((node) => node.remove());
    nextDocument.head.querySelectorAll(selector).forEach((node) => {
      document.head.append(document.importNode(node, true));
    });
  }
}

function installDocument(nextDocument: Document, url: URL): void {
  const currentMain = document.querySelector("main");
  const nextMain = nextDocument.querySelector("main");
  if (!currentMain || !nextMain) throw new Error("Missing main element in navigation document");

  nextMain.querySelectorAll("script").forEach((script) => script.remove());
  currentMain.replaceChildren(...Array.from(nextMain.childNodes).map((node) => document.importNode(node, true)));

  document.title = nextDocument.title;
  syncDocumentHead(nextDocument);
  const announcer = document.querySelector<HTMLElement>("[data-route-announcer]");
  if (announcer) announcer.textContent = nextDocument.title;

  const nextMeta = routeMeta(nextDocument);
  document.documentElement.dataset.routeKind = nextMeta.kind;
  if (nextMeta.id) document.documentElement.dataset.routeId = nextMeta.id;
  else delete document.documentElement.dataset.routeId;
  updateHeader(url);
  bindFilterSwitch(currentMain);
  bindTimelineFilter();
}

function saveCurrentScroll(): void {
  const state: HistoryMotionState = { ...(history.state ?? {}), ftNav: true, scrollY: window.scrollY };
  history.replaceState(state, "", location.href);
}

function destinationScroll(push: boolean, state: HistoryMotionState | null): number {
  return push ? 0 : Math.max(0, state?.scrollY ?? 0);
}

function scrollInstant(top: number): void {
  const clamped = Math.max(0, top);
  // User-driven anchor jumps may be smooth, but route preparation must settle the
  // destination viewport before the new View Transition snapshot is captured.
  window.scrollTo({
    top: clamped,
    left: 0,
    behavior: "instant"
  });
  // Flush layout so geometry reads in the same update callback observe the new scroll.
  void document.documentElement.getBoundingClientRect();
}

function clampDocumentScroll(top: number): number {
  const max = Math.max(0, (document.scrollingElement?.scrollHeight ?? document.documentElement.scrollHeight) - innerHeight);
  return Math.min(max, Math.max(0, top));
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

function focusMainAfterNavigation(): void {
  document.querySelector<HTMLElement>("main")?.focus({ preventScroll: true });
}

async function performNavigation(url: URL, anchor: HTMLAnchorElement | null, push: boolean, state: HistoryMotionState | null): Promise<void> {
  const serial = ++navigationSerial;
  const from = routeMeta(document);
  const nextDocument = await fetchDocument(url);
  if (serial !== navigationSerial) return;
  const to = routeMeta(nextDocument);

  const syntheticAnchor = anchor ?? document.createElement("a");
  if (!anchor) syntheticAnchor.href = url.href;
  const context = sourceContext(syntheticAnchor, from, to, push);
  const targetScroll = destinationScroll(push, state);

  if (push) saveCurrentScroll();
  (document as Document & { activeViewTransition?: { skipTransition(): void } }).activeViewTransition?.skipTransition();
  nameOutgoing(context);

  const update = async () => {
    installDocument(nextDocument, url);
    scrollInstant(targetScroll);

    const alignedScroll = alignedTimelineTargetScroll(context, to, push);
    if (alignedScroll !== null && Math.abs(alignedScroll - window.scrollY) > 1) {
      scrollInstant(alignedScroll);
    }

    if (push) history.pushState({ ftNav: true, scrollY: window.scrollY } satisfies HistoryMotionState, "", url.href);
    const target = nameIncoming(context);
    if (context.type === "project-exit" && !target.primaryRect) {
      // The logical target exists but is not in the restored viewport. Do not
      // make a shared object fly offscreen merely to preserve a technical match.
      clearTransitionNames();
      document.documentElement.dataset.motionType = "none";
    }
    setTiming(dynamicTiming(
      context.sourcePrimaryRect,
      target.primaryRect,
      context.type,
      context.sourceSharedRects,
      target.sharedRects
    ));
  };

  if (!document.startViewTransition || reduceMotion() || !context.type) {
    await update();
    clearTransitionNames();
    document.documentElement.dataset.motionType = "none";
    if (serial === navigationSerial) focusMainAfterNavigation();
    return;
  }

  const transition = document.startViewTransition(update);
  try { await transition.finished; } catch { /* superseded transitions are expected */ }
  if (serial === navigationSerial) {
    clearTransitionNames();
    document.documentElement.dataset.motionType = "none";
    focusMainAfterNavigation();
  }
}

function eligibleAnchor(event: MouseEvent): HTMLAnchorElement | null {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return null;
  const anchor = (event.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
  if (!anchor || anchor.target && anchor.target !== "_self" || anchor.hasAttribute("download") || anchor.hasAttribute("data-no-soft-nav")) return null;
  const url = toUrl(anchor.href);
  if (url.origin !== location.origin) return null;
  if (url.pathname === location.pathname && url.search === location.search && url.hash) return null;
  return anchor;
}

export function bindNavigation(): void {
  if (document.documentElement.dataset.navigationBound === "true") return;
  document.documentElement.dataset.navigationBound = "true";

  // Cross-document MPA view-transition events are still missing in Firefox,
  // whereas same-document startViewTransition is supported. Soft navigation
  // keeps the static pages as the no-JS fallback while making transition
  // pairing deterministic in all engines that implement the SPA API.
  if (!document.startViewTransition) return;

  history.scrollRestoration = "manual";
  if (!(history.state as HistoryMotionState | null)?.ftNav) {
    history.replaceState({ ...(history.state ?? {}), ftNav: true, scrollY: window.scrollY } satisfies HistoryMotionState, "", location.href);
  }

  document.addEventListener("click", (event) => {
    const anchor = eligibleAnchor(event);
    if (!anchor) return;
    const url = toUrl(anchor.href);
    event.preventDefault();
    void performNavigation(url, anchor, true, null).catch(() => { location.href = url.href; });
  });

  document.addEventListener("pointerover", (event) => {
    const anchor = (event.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
    if (!anchor || anchor.hasAttribute("data-no-soft-nav")) return;
    const url = toUrl(anchor.href);
    if (url.origin === location.origin) void fetchDocument(url).catch(() => {});
  }, { passive: true });

  addEventListener("popstate", (event) => {
    const url = new URL(location.href);
    void performNavigation(url, null, false, event.state as HistoryMotionState | null).catch(() => location.reload());
  });
}
