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

function syncThemeColor(theme: Theme): void {
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  const color = meta?.dataset[theme === "dark" ? "themeColorDark" : "themeColorLight"];
  if (meta && color) meta.content = color;
}

export function applyInitialTheme(): void {
  const theme = storedTheme() ?? systemTheme();
  document.documentElement.dataset.theme = theme;
  syncThemeColor(theme);
}

export function bindThemeToggle(selector = "[data-theme-toggle]"): void {
  const button = document.querySelector<HTMLButtonElement>(selector);
  if (!button || button.dataset.themeBound === "true") return;
  button.dataset.themeBound = "true";

  button.addEventListener("click", () => {
    const current = (document.documentElement.dataset.theme as Theme | undefined) ?? systemTheme();
    const next: Theme = current === "dark" ? "light" : "dark";
    document.documentElement.classList.add("theme-transition");
    document.documentElement.dataset.theme = next;
    syncThemeColor(next);
    try { localStorage.setItem(STORAGE_KEY, next); } catch { /* storage may be blocked */ }
    window.setTimeout(() => document.documentElement.classList.remove("theme-transition"), 220);
  });
}
