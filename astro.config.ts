import { defineConfig } from "astro/config";
import { siteConfig } from "./src/site.config";

export default defineConfig({
  site: siteConfig.url,
  trailingSlash: "always",
  i18n: {
    // `zh` is the static URL token. The document language is mapped to
    // `zh-Hant` by SiteLayout because custom `path` + `codes` mappings require
    // server output and cannot be used by this GitHub Pages SSG.
    locales: ["en", "zh"],
    defaultLocale: "en",
    routing: {
      prefixDefaultLocale: false
    }
  }
});
