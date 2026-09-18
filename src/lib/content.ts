import { getCollection, type CollectionEntry } from "astro:content";

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

export const projectHref = (id: string) => `/projects/${id}/`;
export const writingHref = (id: string) => `/writing/${id}/`;

export const displayDate = (value: string) => value.length >= 7 ? value.slice(0, 7) : value.slice(0, 4);
export const displayYear = (value: string) => value.slice(0, 4);
export const htmlDate = (value: string): string | undefined => value.length >= 7 ? value : undefined;

const byDateDesc = <T extends { data: { date: string }; id: string }>(a: T, b: T) =>
  b.data.date.localeCompare(a.data.date) || a.id.localeCompare(b.id);

const includeDrafts = !import.meta.env.PROD;
let indexPromise: Promise<ContentIndex> | undefined;

function fail(message: string): never {
  throw new Error(`[content] ${message}`);
}

function validateContent(projects: ProjectEntry[], writing: WritingEntry[]): void {
  const projectById = new Map(projects.map((entry) => [entry.id, entry]));
  const selectedOrders = new Map<number, string>();
  const canonicalOwners = new Map<string, string>();

  for (const project of projects) {
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
    if (new Set(entry.data.relatedProjects).size !== entry.data.relatedProjects.length) {
      fail(`Writing "${entry.id}" contains duplicate relatedProjects IDs.`);
    }
    for (const projectId of entry.data.relatedProjects) {
      const project = projectById.get(projectId);
      if (!project) fail(`Writing "${entry.id}" references unknown project "${projectId}".`);
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

async function loadContent(): Promise<ContentIndex> {
  const [allProjects, allWriting] = await Promise.all([
    getCollection("projects"),
    getCollection("writing")
  ]);

  const projects = allProjects
    .filter((entry) => includeDrafts || !entry.data.draft)
    .sort(byDateDesc);
  const writing = allWriting
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

export function getContentIndex(): Promise<ContentIndex> {
  if (import.meta.env.DEV) return loadContent();
  return indexPromise ??= loadContent();
}

export async function getProjects(): Promise<ProjectEntry[]> {
  return (await getContentIndex()).projects;
}

export async function getListedProjects(): Promise<ProjectEntry[]> {
  return (await getContentIndex()).listedProjects;
}

export async function getWriting(): Promise<WritingEntry[]> {
  return (await getContentIndex()).writing;
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

export function timelineItems(projects: ProjectEntry[], writing: WritingEntry[]): TimelineItem[] {
  const typeOrder: Record<TimelineItem["type"], number> = { writing: 0, project: 1 };
  return [
    ...writing.map((entry) => ({
      type: "writing" as const,
      date: entry.data.date,
      id: entry.id,
      writing: entry,
      href: writingHref(entry.id)
    })),
    ...projects.map((entry) => ({
      type: "project" as const,
      date: entry.data.date,
      id: entry.id,
      project: entry,
      href: projectHref(entry.id)
    }))
  ].sort((a, b) =>
    b.date.localeCompare(a.date)
    || typeOrder[a.type] - typeOrder[b.type]
    || a.id.localeCompare(b.id)
  );
}

export function projectTitleMap(projects: ProjectEntry[]): Record<string, string> {
  return Object.fromEntries(projects.map((entry) => [entry.id, entry.data.title]));
}

export function relatedWriting(projectId: string, writing: WritingEntry[]): WritingEntry[] {
  return writing.filter((entry) => entry.data.relatedProjects.includes(projectId));
}
