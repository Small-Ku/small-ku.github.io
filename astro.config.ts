import { defineConfig } from "astro/config";
import { unified } from "@astrojs/markdown-remark";
import nameMangling from "./build/name-mangling.mjs";
import rehypeEnglishRuns from "./src/lib/rehype-english-runs";
import { siteConfig } from "./src/site.config";

export default defineConfig({
  integrations: [nameMangling()],
  site: siteConfig.url,
  trailingSlash: "always",
  i18n: {
    // `zh` is the static URL token. The document language is mapped to
    // `zh-HK` by SiteLayout because custom `path` + `codes` mappings require
    // server output and cannot be used by this GitHub Pages SSG.
    locales: ["en", "zh"],
    defaultLocale: "en",
    routing: {
      prefixDefaultLocale: false
    }
  },
  markdown: {
    processor: unified({ rehypePlugins: [rehypeEnglishRuns] })
  }
});
