export interface FilterSwitchChangeDetail {
  value: string;
}

export function bindFilterSwitch(root: ParentNode = document): void {
  const switches = Array.from(root.querySelectorAll<HTMLElement>("[data-filter-switch]"));

  for (const control of switches) {
    if (control.dataset.filterSwitchBound === "true") continue;
    control.dataset.filterSwitchBound = "true";

    const buttons = Array.from(control.querySelectorAll<HTMLButtonElement>("[data-filter]"));
    for (const button of buttons) {
      button.addEventListener("click", () => {
        const value = button.dataset.filter ?? "";

        for (const candidate of buttons) {
          const active = candidate === button;
          candidate.classList.toggle("is-active", active);
          candidate.setAttribute("aria-pressed", active ? "true" : "false");
        }

        control.dispatchEvent(new CustomEvent<FilterSwitchChangeDetail>("filter-switch-change", {
          bubbles: true,
          detail: { value }
        }));
      });
    }
  }
}
