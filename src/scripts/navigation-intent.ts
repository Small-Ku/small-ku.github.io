interface PendingNavigationIntent {
  serial: number;
  anchor: HTMLAnchorElement;
  busyTimer: number;
  announceTimer: number;
}

let pendingIntent: PendingNavigationIntent | null = null;
let pressedAnchor: HTMLAnchorElement | null = null;

const reduceMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function hasPendingNavigationIntent(): boolean {
  return pendingIntent !== null;
}

export function clearNavigationPress(anchor?: HTMLAnchorElement): void {
  if (!pressedAnchor || anchor && pressedAnchor !== anchor) return;
  pressedAnchor.removeAttribute("data-nav-pressed");
  pressedAnchor = null;
}

export function beginNavigationPress(anchor: HTMLAnchorElement): void {
  if (pressedAnchor === anchor) return;
  clearNavigationPress();
  pressedAnchor = anchor;
  anchor.dataset.navPressed = "true";
}

export function navigationIntentPaint(): Promise<void> {
  if (document.visibilityState !== "visible" || reduceMotion()) return Promise.resolve();

  return new Promise((resolve) => {
    let remainingFrames = 3;
    const settleFrame = () => {
      remainingFrames -= 1;
      if (remainingFrames === 0) resolve();
      else requestAnimationFrame(settleFrame);
    };
    requestAnimationFrame(settleFrame);
  });
}

export function clearNavigationIntent(serial?: number): void {
  if (!pendingIntent || serial !== undefined && pendingIntent.serial !== serial) return;

  window.clearTimeout(pendingIntent.busyTimer);
  window.clearTimeout(pendingIntent.announceTimer);
  pendingIntent.anchor.removeAttribute("data-nav-pending");
  pendingIntent.anchor.removeAttribute("aria-busy");
  delete document.documentElement.dataset.navigationState;
  pendingIntent = null;
}

function navigationIntentLabel(anchor: HTMLAnchorElement): string {
  const explicit = anchor.getAttribute("aria-label")?.trim();
  if (explicit) return explicit;

  const identity = anchor.querySelector<HTMLElement>(
    "[data-vt-writing-title], [data-vt-project-title], h1, h2, h3"
  );
  const raw = identity?.textContent ?? anchor.textContent ?? "";
  return raw.replace(/\s+/g, " ").trim();
}

export function beginNavigationIntent(anchor: HTMLAnchorElement, serial: number): void {
  clearNavigationIntent();
  clearNavigationPress(anchor);
  anchor.dataset.navPending = "true";
  document.documentElement.dataset.navigationState = "pending";

  const busyTimer = window.setTimeout(() => {
    if (!pendingIntent || pendingIntent.serial !== serial) return;
    pendingIntent.anchor.setAttribute("aria-busy", "true");
    document.documentElement.dataset.navigationState = "busy";
  }, 300);

  const announceTimer = window.setTimeout(() => {
    if (!pendingIntent || pendingIntent.serial !== serial) return;
    const announcer = document.querySelector<HTMLElement>("[data-route-announcer]");
    if (!announcer) return;

    const label = navigationIntentLabel(pendingIntent.anchor);
    const zh = document.documentElement.lang.toLowerCase().startsWith("zh");
    announcer.textContent = zh
      ? (label ? "正在載入「" + label + "」…" : "正在載入頁面…")
      : (label ? "Loading " + label + "…" : "Loading page…");
  }, 500);

  pendingIntent = { serial, anchor, busyTimer, announceTimer };
}