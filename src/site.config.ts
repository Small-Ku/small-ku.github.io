export interface SiteConfig {
  name: string;
  title: string;
  description: string;
  url: string;
  language: string;
  locale: string;
  locales: {
    en: LocaleConfig;
    zh: LocaleConfig;
  };
  themeColor: {
    light: string;
    dark: string;
  };
  ogImage: string | null;
  hero: {
    title: string;
    lede: string;
  };
  navigation: Array<{ label: string; href: string }>;
  social: Array<{ label: string; href: string }>;
  home: {
    selectedProjects: number;
    latestWriting: number;
  };
  footer: {
    note: string;
  };
}

export interface LocaleConfig {
  language: string;
  locale: string;
  hreflang: string;
  path: string;
  label: string;
  title: string;
  description: string;
  hero: {
    title: string;
    lede: string;
  };
  navigation: Array<{ label: string; path: string }>;
  footerNote: string;
  primaryNavLabel: string;
  skipLinkLabel: string;
  themeToggleLabel: string;
  darkLabel: string;
  lightLabel: string;
  rssLabel: string;
}

export const siteConfig: SiteConfig = {
  name: "Chun Hei Ku",
  title: "Chun Hei Ku — Design & Engineering",
  description: "A personal site of Small-Ku for selected work and writing.",
  url: "https://kwoo.de",
  language: "en",
  locale: "en_US",
  locales: {
    en: {
      language: "en",
      locale: "en_US",
      hreflang: "en",
      path: "",
      label: "English",
      title: "Chun Hei Ku — Design & Engineering",
      description: "A personal site of Small-Ku for selected work and writing.",
      hero: {
        title: "Designing interfaces for the real world.",
        lede: "I work across software engineering and interface design: interfaces for people, and interfaces between systems."
      },
      navigation: [{ label: "Timeline", path: "timeline" }],
      footerNote: "Personal work and writing of KU Chun Hei, @Small-Ku.",
      primaryNavLabel: "Primary",
      skipLinkLabel: "Skip to content",
      themeToggleLabel: "Toggle color theme",
      darkLabel: "Dark",
      lightLabel: "Light",
      rssLabel: "RSS"
    },
    zh: {
      language: "zh-Hant",
      locale: "zh_TW",
      hreflang: "zh-Hant",
      path: "zh",
      label: "中文",
      title: "Chun Hei Ku — 設計與工程",
      description: "Small-Ku 的個人網站，展示精選作品與文章。",
      hero: {
        title: "為真實世界設計介面。",
        lede: "我在軟件工程與介面設計之間工作：為人設計介面，也設計系統之間的介面。"
      },
      navigation: [{ label: "時間線", path: "timeline" }],
      footerNote: "KU Chun Hei（@Small-Ku）的個人作品與文章。",
      primaryNavLabel: "主要導覽",
      skipLinkLabel: "跳至內容",
      themeToggleLabel: "切換色彩主題",
      darkLabel: "深色",
      lightLabel: "淺色",
      rssLabel: "RSS"
    }
  },
  themeColor: { light: "#ffffff", dark: "#171717" },
  ogImage: null,
  hero: {
    title: "Designing interfaces for the real world.",
    lede: "I work across software engineering and interface design: interfaces for people, and interfaces between systems."
  },
  navigation: [{ label: "Timeline", href: "/timeline/" }],
  social: [],
  home: {
    selectedProjects: 3,
    latestWriting: 3
  },
  footer: { note: "Personal work and writing of KU Chun Hei, @Small-Ku." }
};
