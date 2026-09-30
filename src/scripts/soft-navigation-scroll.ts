export interface NavigationHistoryState {
  ftNav?: true;
  scrollY?: number;
}

const reduceMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
let smoothScrollGeneration = 0;
let smoothScrollActive = false;

function trackSmoothScroll(): void {
  const generation = ++smoothScrollGeneration;
  smoothScrollActive = true;

  const settle = () => {
    if (smoothScrollGeneration === generation) smoothScrollActive = false;
  };
  addEventListener("scrollend", settle, { once: true, passive: true });
  window.setTimeout(settle, 1800);
}

export async function cancelActiveSmoothScroll(): Promise<void> {
  if (!smoothScrollActive) return;

  smoothScrollActive = false;
  smoothScrollGeneration += 1;

  const root = document.documentElement;
  const previousBehavior = root.style.scrollBehavior;
  root.style.scrollBehavior = "auto";
  window.scrollTo({ left: window.scrollX, top: window.scrollY, behavior: "auto" });

  // A native smooth-scroll step may already be queued for this frame. Let it
  // land, then freeze that final position before a navigation owns the viewport.
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  window.scrollTo({ left: window.scrollX, top: window.scrollY, behavior: "auto" });
  root.style.scrollBehavior = previousBehavior;
}

export function initializeNavigationHistory(): void {
  history.scrollRestoration = "manual";
  if (!(history.state as NavigationHistoryState | null)?.ftNav) {
    history.replaceState(
      { ...(history.state ?? {}), ftNav: true, scrollY: window.scrollY } satisfies NavigationHistoryState,
      "",
      location.href
    );
  }
}

export function saveCurrentScroll(): void {
  const state: NavigationHistoryState = {
    ...(history.state ?? {}),
    ftNav: true,
    scrollY: window.scrollY
  };
  history.replaceState(state, "", location.href);
}

export function destinationScroll(push: boolean, state: NavigationHistoryState | null): number {
  return push ? 0 : Math.max(0, state?.scrollY ?? 0);
}

export function scrollInstant(top: number): void {
  const clamped = Math.max(0, top);
  // User-driven anchor jumps may be smooth, but route preparation must settle
  // the destination viewport before the new View Transition snapshot is captured.
  window.scrollTo({
    top: clamped,
    left: 0,
    behavior: "instant"
  });
  // Flush layout so geometry reads in the same update callback see the new scroll.
  void document.documentElement.getBoundingClientRect();
}

export function clampDocumentScroll(top: number): number {
  const max = Math.max(
    0,
    (document.scrollingElement?.scrollHeight ?? document.documentElement.scrollHeight) - innerHeight
  );
  return Math.min(max, Math.max(0, top));
}

export function fragmentTarget(hash: string): HTMLElement | null {
  if (!hash || hash === "#") return null;
  let id: string;
  try {
    id = decodeURIComponent(hash.slice(1));
  } catch {
    id = hash.slice(1);
  }
  return document.getElementById(id);
}

export function fragmentScrollTop(hash: string): number | null {
  const target = fragmentTarget(hash);
  if (!target) return null;
  return clampDocumentScroll(window.scrollY + target.getBoundingClientRect().top);
}

export function scrollToFragment(hash: string, smooth: boolean): boolean {
  const target = fragmentTarget(hash);
  if (!target) return false;

  if (!smooth || reduceMotion()) {
    const top = fragmentScrollTop(hash);
    if (top !== null) scrollInstant(top);
  } else {
    trackSmoothScroll();
    target.scrollIntoView({ block: "start", behavior: "smooth" });
  }
  return true;
}