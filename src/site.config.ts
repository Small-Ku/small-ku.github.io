export interface SiteConfig {
  name: string;
  title: string;
  description: string;
  url: string;
  language: string;
  locale: string;
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

export const siteConfig: SiteConfig = {
  name: "Chun Hei Ku",
  title: "Chun Hei Ku — Design & Engineering",
  description: "A personal site of Small-Ku for selected work and writing.",
  url: "https://kwoo.de",
  language: "en",
  locale: "en_US",
  themeColor: { light: "#ffffff", dark: "#171717" },
  ogImage: null,
  hero: {
    title: "Designing interfaces for the real world.",
    lede: "I work across software engineering and interface design: interfaces for people, and interfaces between systems."
  },
  navigation: [
    { label: "Timeline", href: "/timeline/" }
  ],
  social: [],
  home: {
    selectedProjects: 3,
    latestWriting: 3
  },
  footer: {
    note: "Personal work and writing of KU Chun Hei, @Small-Ku."
  }
};
