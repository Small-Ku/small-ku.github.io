type Theme = "light" | "dark";

const STORAGE_KEY = "personal-site-theme";

function systemTheme(): Theme {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function storedTheme(): Theme | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === "light" || value === "dark" ? value : null;
  } catch {
    return null;
  }
}

function currentTheme(): Theme {
  const value = document.documentElement.dataset.theme;
  return value === "light" || value === "dark" ? value : storedTheme() ?? systemTheme();
}

function syncThemeColor(theme: Theme): void {
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  const color = meta?.dataset[theme === "dark" ? "themeColorDark" : "themeColorLight"];
  if (meta && color) meta.content = color;
}

function syncThemeControls(theme: Theme): void {
  document.querySelectorAll<HTMLInputElement>("[data-theme-option]").forEach((input) => {
    input.checked = input.value === theme;
  });

  document.querySelectorAll<HTMLButtonElement>("[data-theme-trigger]").forEach((button) => {
    const controlLabel = button.dataset.themeControlLabel ?? "Appearance";
    const valueLabel = theme === "dark" ? button.dataset.themeDarkLabel : button.dataset.themeLightLabel;
    button.setAttribute("aria-label", valueLabel ? `${controlLabel}: ${valueLabel}` : controlLabel);
  });
}

function applyTheme(theme: Theme, persist: boolean): void {
  document.documentElement.classList.add("theme-transition");
  document.documentElement.dataset.theme = theme;
  syncThemeColor(theme);
  syncThemeControls(theme);
  if (persist) {
    try { localStorage.setItem(STORAGE_KEY, theme); } catch { /* storage may be blocked */ }
  }
  window.setTimeout(() => document.documentElement.classList.remove("theme-transition"), 220);
}

export function applyInitialTheme(): void {
  const theme = storedTheme() ?? systemTheme();
  document.documentElement.dataset.theme = theme;
  syncThemeColor(theme);
  syncThemeControls(theme);
}

export function bindThemeControls(root: ParentNode = document): void {
  const theme = currentTheme();
  syncThemeColor(theme);
  syncThemeControls(theme);

  root.querySelectorAll<HTMLInputElement>("[data-theme-option]").forEach((input) => {
    if (input.dataset.themeBound === "true") return;
    input.dataset.themeBound = "true";
    input.addEventListener("change", () => {
      if (!input.checked || (input.value !== "light" && input.value !== "dark")) return;
      applyTheme(input.value, true);
    });
  });
}
