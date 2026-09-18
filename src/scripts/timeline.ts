import type { FilterSwitchChangeDetail } from "./filter-switch";

export function bindTimelineFilter(): void {
  const section = document.querySelector<HTMLElement>("[data-timeline]");
  if (!section) return;

  const filter = section.querySelector<HTMLElement>("[data-filter-switch]");
  const list = section.querySelector<HTMLElement>("[data-timeline-list]");
  if (!filter || !list) return;

  const items = Array.from(list.querySelectorAll<HTMLElement>("[data-timeline-type]"));

  const updateBoundaries = (): void => {
    const visible = items.filter((item) => !item.hidden);
    for (const item of items) item.removeAttribute("data-first-visible");
    visible[0]?.setAttribute("data-first-visible", "true");
  };

  updateBoundaries();

  filter.addEventListener("filter-switch-change", (event) => {
    const detail = (event as CustomEvent<FilterSwitchChangeDetail>).detail;
    const target = detail?.value || "all";

    for (const item of items) {
      item.hidden = target !== "all" && item.dataset.timelineType !== target;
    }
    updateBoundaries();
  });
}
