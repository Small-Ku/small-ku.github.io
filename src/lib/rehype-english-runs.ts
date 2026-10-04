import { compileEditorialText } from "./editorial-compiler";

type HastNode = {
  type: string;
  value?: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
};

const ENGLISH_TOKEN = /\p{Script=Latin}[\p{Script=Latin}\p{M}\p{N}]*(?:[’'\-][\p{Script=Latin}\p{M}\p{N}]+)*/gu;
const NO_SPLIT_PARENTS = new Set(["code", "pre", "kbd", "samp", "script", "style"]);

function languageNodes(value: string): HastNode[] {
  const output: HastNode[] = [];
  let cursor = 0;
  for (const match of value.matchAll(ENGLISH_TOKEN)) {
    const start = match.index ?? 0;
    if (start > cursor) output.push({ type: "text", value: value.slice(cursor, start) });
    output.push({
      type: "element",
      tagName: "span",
      properties: { lang: "en" },
      children: [{ type: "text", value: match[0] }]
    });
    cursor = start + match[0].length;
  }
  if (cursor < value.length) output.push({ type: "text", value: value.slice(cursor) });
  return output;
}

function plainParagraphText(node: HastNode): string | null {
  if (node.type !== "element" || node.tagName !== "p" || !node.children?.length) return null;
  let text = "";
  for (const child of node.children) {
    if (child.type !== "text") return null;
    text += child.value ?? "";
  }
  return text.trim() ? text : null;
}

function annotateChineseProse(node: HastNode): void {
  const text = plainParagraphText(node);
  if (text !== null) {
    const compiled = compileEditorialText(text, "zh", "prose");
    node.properties = {
      ...(node.properties ?? {}),
      "data-editorial-root": "",
      "data-editorial-role": "prose",
      "data-editorial-locale": "zh",
      "data-editorial-ir": JSON.stringify(compiled.ir)
    };
  }
  for (const child of node.children ?? []) annotateChineseProse(child);
}

function transformChildren(parent: HastNode, insideNoSplit: boolean): void {
  if (!parent.children) return;
  const blocked = insideNoSplit || (parent.type === "element" && NO_SPLIT_PARENTS.has(parent.tagName ?? ""));
  const children: HastNode[] = [];
  for (const child of parent.children) {
    if (!blocked && child.type === "text" && child.value && /\p{Script=Latin}/u.test(child.value)) {
      children.push(...languageNodes(child.value));
    } else {
      transformChildren(child, blocked);
      children.push(child);
    }
  }
  parent.children = children;
}

/** Keep English runs native while giving plain Traditional Chinese prose build-time editorial IR. */
export default function rehypeEnglishRuns() {
  return (tree: HastNode, file: { data?: { astro?: { frontmatter?: { locale?: string } } } }) => {
    if (file.data?.astro?.frontmatter?.locale !== "zh") return;
    annotateChineseProse(tree);
    transformChildren(tree, false);
  };
}
