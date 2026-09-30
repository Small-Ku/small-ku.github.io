import { createViewTransitionScrollGuard } from "./view-transition-scroll";

export type RectLike = Pick<
  DOMRect,
  "x" | "y" | "width" | "height" | "top" | "right" | "bottom" | "left"
>;

export type RectMap = Record<string, RectLike>;

export interface ViewTransitionTiming {
  duration: number;
  distance: number;
  areaRatio: number;
}

interface TimingOptions {
  multiplier?: number;
  fallbackDuration?: number;
  reducedMotion?: boolean;
}

interface RunViewTransitionOptions {
  update(): void | Promise<void>;
  animate: boolean;
  onReady?(): void;
}

export function clearTransitionNames(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>("[style*='view-transition-name']").forEach((element) => {
    element.style.removeProperty("view-transition-name");
  });
}

export function nameTransitionElement(element: Element | null, name: string): boolean {
  if (!(element instanceof HTMLElement)) return false;
  element.style.viewTransitionName = name;
  return true;
}

export function calculateViewTransitionTiming(
  from: RectLike | null,
  to: RectLike | null,
  fromShared: RectMap = {},
  toShared: RectMap = {},
  {
    multiplier = 1,
    fallbackDuration = 560,
    reducedMotion = false
  }: TimingOptions = {}
): ViewTransitionTiming {
  if (reducedMotion) return { duration: 1, distance: 0, areaRatio: 1 };

  const pairs: Array<[RectLike, RectLike]> = [];
  if (from && to) pairs.push([from, to]);
  for (const [name, fromRect] of Object.entries(fromShared)) {
    const toRect = toShared[name];
    if (toRect) pairs.push([fromRect, toRect]);
  }

  if (pairs.length === 0) {
    return { duration: fallbackDuration, distance: 0, areaRatio: 1 };
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

  // Both measurements are viewport-relative at capture time. Let the slowest
  // shared object, not only the primary surface, set the route clock.
  const duration = 320 + 240 * Math.sqrt(maxDistanceNorm) + 200 * maxAreaNorm;
  return {
    duration: Math.round(Math.min(820, Math.max(340, duration * multiplier))),
    distance: Math.round(maxDistance),
    areaRatio: maxAreaRatio
  };
}

export function applyViewTransitionTiming(timing: ViewTransitionTiming): void {
  const root = document.documentElement;
  root.style.setProperty("--ft-motion-route", timing.duration + "ms");
  root.style.setProperty("--ft-motion-distance", timing.distance + "px");
  root.style.setProperty("--ft-motion-area-ratio", timing.areaRatio.toFixed(3));
}

export function skipActiveViewTransition(): void {
  (document as Document & { activeViewTransition?: { skipTransition(): void } })
    .activeViewTransition?.skipTransition();
}

export async function runViewTransition({
  update,
  animate,
  onReady
}: RunViewTransitionOptions): Promise<boolean> {
  if (!animate || !document.startViewTransition) {
    await update();
    return false;
  }

  const transition = document.startViewTransition(update);
  const scrollGuard = createViewTransitionScrollGuard(transition);

  try {
    await transition.ready;
    scrollGuard.armPositionGuard();
    onReady?.();
  } catch {
    // A superseded transition may never become ready.
  }

  try {
    await transition.finished;
  } catch {
    // Superseded transitions are expected.
  } finally {
    scrollGuard.dispose();
  }

  return true;
}