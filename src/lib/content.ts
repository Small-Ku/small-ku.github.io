import { getCollection, type CollectionEntry } from "astro:content";
import { localizedPath, type SiteLocale } from "./i18n";

export type ProjectEntry = CollectionEntry<"projects">;
export type WritingEntry = CollectionEntry<"writing">;

export type TimelineItem =
  | { type: "project"; date: string; id: string; project: ProjectEntry; href: string }
  | { type: "writing"; date: string; id: string; writing: WritingEntry; href: string };

export interface ContentIndex {
  projects: ProjectEntry[];
  listedProjects: ProjectEntry[];
  writing: WritingEntry[];
}

export const contentKey = <T extends { id: string; data: { translationKey?: string } }>(entry: T) =>
  entry.data.translationKey ?? entry.id.split("/").at(-1) ?? entry.id;

export const contentLocale = <T extends { data: { locale: SiteLocale } }>(entry: T): SiteLocale => entry.data.locale;

export const projectHref = (id: string, locale: SiteLocale = "en") => localizedPath(locale, `/projects/${id}/`);
export const writingHref = (id: string, locale: SiteLocale = "en") => localizedPath(locale, `/writing/${id}/`);

export const displayDate = (value: string) => value.length >= 7 ? value.slice(0, 7) : value.slice(0, 4);
export const displayYear = (value: string) => value.slice(0, 4);
export const htmlDate = (value: string): string | undefined => value.length >= 7 ? value : undefined;

const byDateDesc = <T extends { data: { date: string }; id: string }>(a: T, b: T) =>
  b.data.date.localeCompare(a.data.date) || a.id.localeCompare(b.id);

const includeDrafts = !import.meta.env.PROD;
const indexPromises = new Map<SiteLocale, Promise<ContentIndex>>();

function fail(message: string): never {
  throw new Error(`[content] ${message}`);
}

function validateContent(projects: ProjectEntry[], writing: WritingEntry[]): void {
  const projectByKey = new Map<string, ProjectEntry>();
  const writingByKey = new Map<string, WritingEntry>();
  const selectedOrders = new Map<number, string>();
  const canonicalOwners = new Map<string, string>();

  for (const project of projects) {
    const key = contentKey(project);
    if (projectByKey.has(key)) fail(`Projects in locale "${contentLocale(project)}" share translationKey "${key}".`);
    projectByKey.set(key, project);
    const { selected, selectedOrder, visibility, draft, canonicalUrl } = project.data;

    if (selectedOrder !== undefined && !selected) {
      fail(`Project "${project.id}" has selectedOrder but selected is false.`);
    }
    if (selected && visibility !== "public") {
      fail(`Project "${project.id}" is selected but visibility is "${visibility}". Only public projects may be selected.`);
    }
    if (selected && selectedOrder !== undefined) {
      const previous = selectedOrders.get(selectedOrder);
      if (previous) fail(`Projects "${previous}" and "${project.id}" both use selectedOrder ${selectedOrder}.`);
      selectedOrders.set(selectedOrder, project.id);
    }
    if (canonicalUrl) {
      const key = new URL(canonicalUrl).href;
      const previous = canonicalOwners.get(key);
      if (previous) fail(`Duplicate canonicalUrl "${canonicalUrl}" on ${previous} and project:${project.id}.`);
      canonicalOwners.set(key, `project:${project.id}`);
    }

    // This deliberately does not reject a draft unlisted project. Draft state is
    // publication state; visibility is discovery state.
    void draft;
  }

  for (const entry of writing) {
    const key = contentKey(entry);
    if (writingByKey.has(key)) fail(`Writing entries in locale "${contentLocale(entry)}" share translationKey "${key}".`);
    writingByKey.set(key, entry);
    if (new Set(entry.data.relatedProjects).size !== entry.data.relatedProjects.length) {
      fail(`Writing "${entry.id}" contains duplicate relatedProjects IDs.`);
    }
    for (const projectId of entry.data.relatedProjects) {
      const project = projectByKey.get(projectId);
      if (!project) fail(`Writing "${entry.id}" references unknown project translationKey "${projectId}".`);
      if (!entry.data.draft && project.data.draft) {
        fail(`Published writing "${entry.id}" references draft project "${projectId}".`);
      }
      if (!entry.data.draft && project.data.visibility !== "public") {
        fail(`Published writing "${entry.id}" references unlisted project "${projectId}". Public writing may only expose public projects.`);
      }
    }

    const { canonicalUrl } = entry.data;
    if (canonicalUrl) {
      const key = new URL(canonicalUrl).href;
      const previous = canonicalOwners.get(key);
      if (previous) fail(`Duplicate canonicalUrl "${canonicalUrl}" on ${previous} and writing:${entry.id}.`);
      canonicalOwners.set(key, `writing:${entry.id}`);
    }
  }
}

async function loadContent(locale: SiteLocale): Promise<ContentIndex> {
  const [allProjects, allWriting] = await Promise.all([
    getCollection("projects"),
    getCollection("writing")
  ]);

  const projects = allProjects
    .filter((entry) => contentLocale(entry) === locale)
    .filter((entry) => includeDrafts || !entry.data.draft)
    .sort(byDateDesc);
  const writing = allWriting
    .filter((entry) => contentLocale(entry) === locale)
    .filter((entry) => includeDrafts || !entry.data.draft)
    .sort(byDateDesc);

  // Drafts must never block a production deployment merely because they are
  // unfinished. Development includes them and therefore validates them too.
  validateContent(projects, writing);

  return {
    projects,
    listedProjects: projects.filter((entry) => entry.data.visibility === "public"),
    writing
  };
}

export function getContentIndex(locale: SiteLocale = "en"): Promise<ContentIndex> {
  if (import.meta.env.DEV) return loadContent(locale);
  const existing = indexPromises.get(locale);
  if (existing) return existing;
  const promise = loadContent(locale);
  indexPromises.set(locale, promise);
  return promise;
}

export async function getProjects(locale: SiteLocale = "en"): Promise<ProjectEntry[]> {
  return (await getContentIndex(locale)).projects;
}

export async function getListedProjects(locale: SiteLocale = "en"): Promise<ProjectEntry[]> {
  return (await getContentIndex(locale)).listedProjects;
}

export async function getWriting(locale: SiteLocale = "en"): Promise<WritingEntry[]> {
  return (await getContentIndex(locale)).writing;
}

export function selectedProjects(projects: ProjectEntry[], limit: number): ProjectEntry[] {
  return projects
    .filter((entry) => entry.data.selected)
    .sort((a, b) =>
      (a.data.selectedOrder ?? Number.MAX_SAFE_INTEGER) - (b.data.selectedOrder ?? Number.MAX_SAFE_INTEGER)
      || byDateDesc(a, b)
    )
    .slice(0, limit);
}

export function latestWriting(writing: WritingEntry[], limit: number): WritingEntry[] {
  return writing.slice().sort(byDateDesc).slice(0, limit);
}

export function timelineItems(projects: ProjectEntry[], writing: WritingEntry[], locale: SiteLocale = "en"): TimelineItem[] {
  const typeOrder: Record<TimelineItem["type"], number> = { writing: 0, project: 1 };
  return [
    ...writing.map((entry) => ({
      type: "writing" as const,
      date: entry.data.date,
      id: contentKey(entry),
      writing: entry,
      href: writingHref(contentKey(entry), locale)
    })),
    ...projects.map((entry) => ({
      type: "project" as const,
      date: entry.data.date,
      id: contentKey(entry),
      project: entry,
      href: projectHref(contentKey(entry), locale)
    }))
  ].sort((a, b) =>
    b.date.localeCompare(a.date)
    || typeOrder[a.type] - typeOrder[b.type]
    || a.id.localeCompare(b.id)
  );
}

export function projectTitleMap(projects: ProjectEntry[]): Record<string, string> {
  return Object.fromEntries(projects.map((entry) => [contentKey(entry), entry.data.title]));
}

export function relatedWriting(projectId: string, writing: WritingEntry[]): WritingEntry[] {
  return writing.filter((entry) => entry.data.relatedProjects.includes(projectId));
}
