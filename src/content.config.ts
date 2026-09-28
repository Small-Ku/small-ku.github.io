import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { z } from "astro/zod";
import { projectTones, projectVisibilities, projectVisualVariants } from "./lib/content-schema";

function validPartialDate(value: string): boolean {
  if (!/^\d{4}(?:-\d{2})?(?:-\d{2})?$/.test(value)) return false;
  const [yearText, monthText, dayText] = value.split("-");
  if (!monthText) return true;
  const year = Number(yearText);
  const month = Number(monthText);
  if (month < 1 || month > 12) return false;
  if (!dayText) return true;
  const day = Number(dayText);
  const maxDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day >= 1 && day <= maxDay;
}

const partialDate = z.string().refine(validPartialDate, "Use a real date in YYYY, YYYY-MM, or YYYY-MM-DD form");
const tags = z.array(z.string().trim().min(1)).default([]);
const locale = z.enum(["en", "zh"]).default("en");
const translationKey = z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).optional();

const projects = defineCollection({
  loader: glob({ base: "./src/content/projects", pattern: "**/*.md" }),
  schema: z.object({
    locale,
    translationKey,
    title: z.string().trim().min(1),
    kicker: z.string().trim().min(1).default("Project"),
    summary: z.string().trim().min(1),
    date: partialDate,
    updated: partialDate.optional(),
    draft: z.boolean().default(false),
    status: z.string().trim().min(1).default("Active"),
    selected: z.boolean().default(false),
    selectedOrder: z.number().int().nonnegative().optional(),
    visibility: z.enum(projectVisibilities).default("public"),
    sourceUrl: z.url().optional(),
    externalUrl: z.url().optional(),
    canonicalUrl: z.url().optional(),
    tags,
    tone: z.enum(projectTones).default("neutral"),
    visual: z.object({
      variant: z.enum(projectVisualVariants),
      label: z.string().trim().max(48).optional(),
      alt: z.string().trim().max(180).optional()
    }).optional(),
    facts: z.array(z.string().trim().min(1)).default([])
  })
});

const writing = defineCollection({
  loader: glob({ base: "./src/content/writing", pattern: "**/*.md" }),
  schema: z.object({
    locale,
    translationKey,
    title: z.string().trim().min(1),
    summary: z.string().trim().min(1),
    date: partialDate,
    updated: partialDate.optional(),
    draft: z.boolean().default(false),
    kind: z.string().trim().min(1).default("Note"),
    tags,
    relatedProjects: z.array(z.string().trim().min(1)).default([]),
    canonicalUrl: z.url().optional()
  })
});

export const collections = { projects, writing };
