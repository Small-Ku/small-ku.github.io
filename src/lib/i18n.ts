import { siteConfig } from "../site.config";

export type SiteLocale = keyof typeof siteConfig.locales;

export const defaultLocale: SiteLocale = "en";
export const supportedLocales = Object.keys(siteConfig.locales) as SiteLocale[];

export function localeFromPath(pathname: string): SiteLocale {
  const segment = pathname.split("/").filter(Boolean)[0];
  return segment === "zh" ? "zh" : defaultLocale;
}

export function stripLocalePath(pathname: string): string {
  const normalized = pathname.startsWith("/") ? pathname : `/${pathname}`;
  if (normalized === "/zh" || normalized.startsWith("/zh/")) {
    const remainder = normalized.slice(3);
    return remainder || "/";
  }
  return normalized || "/";
}

export function localizedPath(locale: SiteLocale, pathname: string): string {
  const base = stripLocalePath(pathname);
  const pagePath = base === "/" ? "/" : base.endsWith("/") ? base : `${base}/`;
  if (locale === defaultLocale) return pagePath;
  return pagePath === "/" ? `/${siteConfig.locales[locale].path}/` : `/${siteConfig.locales[locale].path}${pagePath}`;
}

export function localizedFilePath(locale: SiteLocale, pathname: string): string {
  const base = stripLocalePath(pathname);
  if (locale === defaultLocale) return base;
  return `/${siteConfig.locales[locale].path}${base}`;
}

export function localeLabel(locale: SiteLocale): string {
  return siteConfig.locales[locale].label;
}
