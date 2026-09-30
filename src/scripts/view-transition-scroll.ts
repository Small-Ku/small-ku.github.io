const scrollKeys = new Set(["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "]);

function ownsScrollKey(target: EventTarget | null): boolean {
  return target instanceof Element && !!target.closest(
    'input, textarea, select, button, [contenteditable]:not([contenteditable="false"])'
  );
}

export interface ViewTransitionScrollGuard {
  armPositionGuard(): void;
  dispose(): void;
}

export function createViewTransitionScrollGuard(transition: ViewTransition): ViewTransitionScrollGuard {
  let active = true;
  let baseline: { x: number; y: number } | null = null;

  function dispose(): void {
    if (!active) return;
    active = false;
    window.removeEventListener("wheel", onIntent, true);
    window.removeEventListener("touchmove", onIntent, true);
    window.removeEventListener("keydown", onKeyDown, true);
    window.removeEventListener("scroll", onScroll, true);
  }

  function skip(): void {
    if (!active) return;
    dispose();
    transition.skipTransition();
  }

  function onIntent(): void {
    skip();
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (!scrollKeys.has(event.key) || ownsScrollKey(event.target)) return;
    skip();
  }

  function onScroll(): void {
    if (!baseline) return;
    if (Math.abs(window.scrollX - baseline.x) > 0.5 || Math.abs(window.scrollY - baseline.y) > 0.5) {
      skip();
    }
  }

  window.addEventListener("wheel", onIntent, { capture: true, passive: true });
  window.addEventListener("touchmove", onIntent, { capture: true, passive: true });
  window.addEventListener("keydown", onKeyDown, true);

  return {
    armPositionGuard() {
      if (!active || baseline) return;
      baseline = { x: window.scrollX, y: window.scrollY };
      window.addEventListener("scroll", onScroll, { capture: true, passive: true });
    },
    dispose
  };
}