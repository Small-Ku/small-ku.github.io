import { bindFilterSwitch } from "./filter-switch";
import { bindTimelineFilter } from "./timeline";
import { bindThemeControls } from "./theme";
import {
  fetchNavigationDocument,
  installNavigationDocument
} from "./soft-navigation-document";
import {
  beginNavigationIntent,
  beginNavigationPress,
  clearNavigationIntent,
  clearNavigationPress,
  hasPendingNavigationIntent,
  navigationIntentPaint
} from "./navigation-intent";
import {
  cancelActiveSmoothScroll,
  destinationScroll,
  fragmentScrollTop,
  fragmentTarget,
  initializeNavigationHistory,
  saveCurrentScroll,
  scrollInstant,
  scrollToFragment,
  type NavigationHistoryState
} from "./soft-navigation-scroll";
import {
  runViewTransition,
  skipActiveViewTransition
} from "./view-transition";
import {
  alignedRouteTargetScroll,
  cleanupActiveRouteMotion,
  cleanupRouteMotion,
  configureIncomingRouteMotion,
  createRouteMotionContext,
  hasRouteMotion,
  onRouteMotionReady,
  prepareIncomingRouteMotion,
  prepareOutgoingRouteMotion,
  prepareRouteMotionBeforeCapture,
  relinquishOpenSiteMenus,
  routeMeta,
  routeMotionAnimated
} from "./route-motion";

let navigationSerial = 0;
const toUrl = (value: string | URL) => value instanceof URL ? value : new URL(value, location.href);
function softNavigationAnchor(anchor: HTMLAnchorElement | null): HTMLAnchorElement | null {
  if (!anchor || anchor.target && anchor.target !== "_self" || anchor.hasAttribute("download") || anchor.hasAttribute("data-no-soft-nav")) return null;
  const url = toUrl(anchor.href);
  if (url.origin !== location.origin) return null;
  if (url.pathname === location.pathname && url.search === location.search && url.hash) return null;
  return anchor;
}

function prefetchAnchor(anchor: HTMLAnchorElement): void {
  const eligible = softNavigationAnchor(anchor);
  if (!eligible) return;
  const url = toUrl(eligible.href);
  if (url.pathname === location.pathname && url.search === location.search) return;
  void fetchNavigationDocument(url).catch(() => {});
}

function prefetchPrimaryNavigation(): void {
  document.querySelectorAll<HTMLAnchorElement>(".site-nav a[href]").forEach(prefetchAnchor);
}

function schedulePrimaryNavigationPrefetch(): void {
  const idle = (window as unknown as { requestIdleCallback?: typeof window.requestIdleCallback }).requestIdleCallback;
  if (typeof idle === "function") {
    idle.call(window, prefetchPrimaryNavigation, { timeout: 1500 });
  } else {
    window.setTimeout(prefetchPrimaryNavigation, 800);
  }
}

function focusMainAfterNavigation(): void {
  document.querySelector<HTMLElement>("main")?.focus({ preventScroll: true });
}

async function performNavigation(url: URL, anchor: HTMLAnchorElement | null, push: boolean, state: NavigationHistoryState | null): Promise<void> {
  cleanupActiveRouteMotion();
  const serial = ++navigationSerial;
  if (push && anchor) beginNavigationIntent(anchor, serial);
  else {
    clearNavigationIntent();
    clearNavigationPress();
  }

  await cancelActiveSmoothScroll();
  if (serial !== navigationSerial) return;

  const acknowledgement = push && anchor ? navigationIntentPaint() : Promise.resolve();
  const from = routeMeta(document);
  let nextDocument: Document;
  try {
    nextDocument = await fetchNavigationDocument(url);
  } catch (error) {
    clearNavigationIntent(serial);
    throw error;
  }
  if (serial !== navigationSerial) return;
  const to = routeMeta(nextDocument);

  const syntheticAnchor = anchor ?? document.createElement("a");
  if (!anchor) syntheticAnchor.href = url.href;
  const context = createRouteMotionContext(syntheticAnchor, from, to, push);
  if (!hasRouteMotion(context)) await acknowledgement;
  if (serial !== navigationSerial) return;
  clearNavigationIntent(serial);
  prepareRouteMotionBeforeCapture(context);
  const targetScroll = destinationScroll(push, state);

  if (push) saveCurrentScroll();
  skipActiveViewTransition();
  prepareOutgoingRouteMotion(context, nextDocument);

  const update = async () => {
    const currentMain = installNavigationDocument(nextDocument);
    bindThemeControls();
    bindFilterSwitch(currentMain);
    bindTimelineFilter();
    schedulePrimaryNavigationPrefetch();
    scrollInstant(targetScroll);

    const hashScroll = fragmentScrollTop(url.hash);
    if (hashScroll !== null && Math.abs(hashScroll - window.scrollY) > 1) {
      scrollInstant(hashScroll);
    } else if (hashScroll === null) {
      const alignedScroll = alignedRouteTargetScroll(context, to, push);
      if (alignedScroll !== null && Math.abs(alignedScroll - window.scrollY) > 1) {
        scrollInstant(alignedScroll);
      }
    }

    if (push) history.pushState({ ftNav: true, scrollY: window.scrollY } satisfies NavigationHistoryState, "", url.href);
    const target = prepareIncomingRouteMotion(context);
    configureIncomingRouteMotion(context, target);
  };

  const animated = await runViewTransition({
    update,
    animate: routeMotionAnimated(context),
    onReady: () => onRouteMotionReady(context)
  });

  if (!animated) {
    cleanupRouteMotion(context);
    if (serial === navigationSerial) focusMainAfterNavigation();
    return;
  }

  if (serial === navigationSerial) {
    cleanupRouteMotion(context);
    focusMainAfterNavigation();
  }
}

function eligibleAnchor(event: MouseEvent): HTMLAnchorElement | null {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return null;
  const anchor = (event.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
  return softNavigationAnchor(anchor);
}

export function bindNavigation(): void {
  if (document.documentElement.dataset.navigationBound === "true") return;
  document.documentElement.dataset.navigationBound = "true";

  // Cross-document MPA view-transition events are still missing in Firefox,
  // whereas same-document startViewTransition is supported. Soft navigation
  // keeps the static pages as the no-JS fallback while making transition
  // pairing deterministic in all engines that implement the SPA API.
  if (!document.startViewTransition) return;

  initializeNavigationHistory();

  document.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const anchor = softNavigationAnchor((event.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null);
    if (anchor) beginNavigationPress(anchor);
  }, { passive: true });

  document.addEventListener("pointerup", () => {
    requestAnimationFrame(() => {
      if (!hasPendingNavigationIntent()) clearNavigationPress();
    });
  }, { passive: true });

  document.addEventListener("pointercancel", () => clearNavigationPress(), { passive: true });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const anchor = softNavigationAnchor((event.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null);
    if (anchor) beginNavigationPress(anchor);
  });

  document.addEventListener("keyup", (event) => {
    if (event.key !== "Enter") return;
    requestAnimationFrame(() => {
      if (!hasPendingNavigationIntent()) clearNavigationPress();
    });
  });

  document.addEventListener("click", (event) => {
    const rawAnchor = (event.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
    if (rawAnchor && !event.defaultPrevented && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
      const rawUrl = toUrl(rawAnchor.href);
      const sameDocumentFragment = rawUrl.origin === location.origin
        && rawUrl.pathname === location.pathname
        && rawUrl.search === location.search
        && Boolean(rawUrl.hash);

      if (sameDocumentFragment && fragmentTarget(rawUrl.hash)) {
        event.preventDefault();
        if (rawUrl.hash !== location.hash) {
          saveCurrentScroll();
          const targetScroll = fragmentScrollTop(rawUrl.hash) ?? window.scrollY;
          history.pushState({ ftNav: true, scrollY: targetScroll } satisfies NavigationHistoryState, "", rawUrl.href);
        }
        scrollToFragment(rawUrl.hash, true);
        return;
      }
    }

    const anchor = eligibleAnchor(event);
    if (!anchor) return;
    const url = toUrl(anchor.href);
    event.preventDefault();
    if (anchor.dataset.motionIntent === "representation") relinquishOpenSiteMenus();
    void performNavigation(url, anchor, true, null).catch(() => { location.href = url.href; });
  });

  document.addEventListener("pointerover", (event) => {
    const anchor = (event.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
    if (anchor) prefetchAnchor(anchor);
  }, { passive: true });

  document.addEventListener("focusin", (event) => {
    const anchor = (event.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
    if (anchor) prefetchAnchor(anchor);
  });

  schedulePrimaryNavigationPrefetch();

  addEventListener("hashchange", () => {
    scrollToFragment(location.hash, true);
  });

  // Fragment restoration is browser-dependent once scrollRestoration is manual.
  // Re-assert the fragment after initial layout so direct /#fragment URLs work
  // consistently without relying on browser-specific timing.
  if (location.hash) {
    requestAnimationFrame(() => requestAnimationFrame(() => scrollToFragment(location.hash, false)));
  }

  addEventListener("popstate", (event) => {
    const url = new URL(location.href);
    void performNavigation(url, null, false, event.state as NavigationHistoryState | null).catch(() => location.reload());
  });
}
