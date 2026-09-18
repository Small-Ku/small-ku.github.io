export const projectTones = ["violet", "teal", "coral", "neutral"] as const;
export type ProjectTone = (typeof projectTones)[number];

export const projectVisualVariants = ["network", "matrix", "stack"] as const;
export type ProjectVisualVariant = (typeof projectVisualVariants)[number];

// Static output cannot provide access control. `unlisted` means the route exists
// but is omitted from discovery surfaces; use `draft` for unpublished work.
export const projectVisibilities = ["public", "unlisted"] as const;
export type ProjectVisibility = (typeof projectVisibilities)[number];
