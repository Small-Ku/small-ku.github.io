import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile } from 'sass';
import { transform } from 'lightningcss';
import { parse } from 'parse5';
import { parse as parseAstro } from '@astrojs/compiler-rs';
import ts from 'typescript';

// These records never cross the browser, content, JSON, or storage boundary.
// Audit: MotionContext/MotionMeasurements (route-motion), WritingLineMorph
// (writing-line-transition); direct access only, including across their imports.
export const privateProperties = [
  'sourceRoot', 'sourcePrimaryRect', 'sourceSharedRects', 'writingLineMorph',
  'primaryRect', 'sharedRects', 'sourceTitle', 'targetTitle',
];
export const propertyOptions = {
  include: new RegExp(`^(${privateProperties.join('|')})$`),
  quoted: false,
};

export async function filesUnder(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((a, b) => a.name < b.name ? -1 : 1)) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await filesUnder(path));
    else files.push(path);
  }
  return files;
}

export function shortName(index) {
  const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let name = '';
  do {
    name = alphabet[index % alphabet.length] + name;
    index = Math.floor(index / alphabet.length) - 1;
  } while (index >= 0);
  return name;
}

// Recurse into :is/:not/:has arguments; Lightning CSS supplies the outer AST.
// Touch only class AST nodes: never IDs, attributes, declarations, or VT names.
export function classVisitor(visit, attribute = () => {}) {
  return {
    Selector(selector) {
      function walk(part) {
        if (!part || typeof part !== 'object') return;
        if (part.type === 'class') part.name = visit(part.name);
        if (part.type === 'attribute' && part.name === 'class') attribute(part);
        for (const child of Object.values(part)) {
          if (Array.isArray(child)) child.forEach(walk);
          else if (child && typeof child === 'object') walk(child);
        }
      }
      selector.forEach(walk);
      return selector;
    },
  };
}

export function classPlan(css, reserved = new Set()) {
  const counts = new Map();
  const attributeValues = [];
  transform({
    filename: 'name-mangling-plan.css', code: Buffer.from(css),
    visitor: classVisitor((name) => {
      counts.set(name, (counts.get(name) ?? 0) + 1);
      return name;
    }, (part) => { if (part.operation) attributeValues.push(part.operation.value.toLowerCase()); }),
  });
  reserved = new Set(reserved);
  for (const name of counts.keys()) {
    if (attributeValues.some((value) => name.toLowerCase().includes(value)
      || value.includes(name.toLowerCase()))) reserved.add(name);
  }
  const occupied = new Set([...counts.keys(), ...reserved]);
  const candidates = [...counts].filter(([name]) => !reserved.has(name));
  candidates.sort(([a, x], [b, y]) => y - x || (a < b ? -1 : a > b ? 1 : 0));
  const mapping = new Map();
  let index = 0;
  for (const [name] of candidates) {
    let replacement;
    do { replacement = shortName(index++); } while (occupied.has(replacement));
    mapping.set(name, replacement);
    occupied.add(replacement);
  }
  return { counts, mapping, reserved };
}

export function scriptStrings(code, filename = 'script.ts') {
  const strings = [];
  const tree = ts.createSourceFile(filename, code, ts.ScriptTarget.Latest, true);
  function walk(node) {
    if (ts.isStringLiteralLike(node) || ts.isTemplateHead(node)
      || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) strings.push(node.text);
    ts.forEachChild(node, walk);
  }
  walk(tree);
  return strings;
}

export function astroScriptStrings(source) {
  const strings = [];
  const { ast, diagnostics } = parseAstro(source);
  if (diagnostics.some((diagnostic) => diagnostic.severity === 1)) {
    throw new Error('Cannot audit scripts in invalid Astro source');
  }
  function walk(node, script = false) {
    if (!node || typeof node !== 'object') return;
    script ||= node.type === 'AstroScript';
    if (script && node.type === 'Literal' && typeof node.value === 'string') strings.push(node.value);
    if (script && node.type === 'TemplateElement') strings.push(node.value.cooked ?? node.value.raw);
    for (const child of Object.values(node)) {
      if (Array.isArray(child)) child.forEach((part) => walk(part, script));
      else if (child && typeof child === 'object') walk(child, script);
    }
  }
  walk(ast);
  return strings;
}

export function classContracts(names, strings) {
  return new Set([...names].filter((name) => strings.some((value) => value.includes(name)
    || (/^\.?[a-zA-Z][\w-]*[-_]$/.test(value) && name.startsWith(value.replace(/^\./, ''))))));
}

export function assertCssContracts(css, mapping, filename) {
  transform({ filename, code: Buffer.from(css), visitor: classVisitor((name) => {
    if (mapping.has(name)) throw new Error(`Untransformed class selector: ${name} in ${filename}`);
    return name;
  }) });
}

export function rewriteHtml(html, mapping) {
  const document = parse(html, { sourceCodeLocationInfo: true });
  const edits = [];
  const targets = new Set(mapping.values());
  function walk(node) {
    const scriptType = node.attrs?.find((attr) => attr.name === 'type')?.value;
    if (node.tagName === 'script' && (!scriptType || scriptType === 'module'
      || scriptType === 'text/javascript' || scriptType === 'application/javascript')) {
      const code = node.childNodes.map((child) => child.value ?? '').join('');
      const strings = scriptStrings(code);
      const contracts = classContracts(mapping.keys(), strings);
      if (contracts.size) throw new Error(`Unreserved inline script class contract: ${[...contracts].join(', ')}`);
      for (const name of privateProperties) {
        if (strings.includes(name)) throw new Error(`Quoted private property contract: ${name}`);
      }
    }
    if (node.tagName === 'style') {
      assertCssContracts(node.childNodes.map((child) => child.value ?? '').join(''), mapping, 'inline.css');
    }
    const attribute = node.attrs?.find((attr) => attr.name === 'class');
    if (attribute) {
      const tokens = attribute.value.split(/[\t\n\f\r ]+/);
      // An authored short class could alias an unrelated renamed selector.
      // Fail before publication instead of silently changing its appearance.
      for (const token of tokens) {
        if (targets.has(token)) throw new Error(`Name mangling class collision: ${token}`);
      }
      const value = attribute.value.replace(/[^\t\n\f\r ]+/g, (name) => mapping.get(name) ?? name);
      if (value !== attribute.value) {
        const location = node.sourceCodeLocation?.attrs?.class;
        if (!location) throw new Error('Missing class attribute source location');
        const escaped = value.replaceAll('&', '&amp;').replaceAll('"', '&quot;');
        edits.push({ ...location, text: `class="${escaped}"` });
      }
    }
    // Includes template content, which parse5 stores separately.
    for (const child of node.childNodes ?? []) walk(child);
    if (node.content) walk(node.content);
  }
  walk(document);
  for (const edit of edits.sort((a, b) => b.startOffset - a.startOffset)) {
    html = html.slice(0, edit.startOffset) + edit.text + html.slice(edit.endOffset);
  }
  return html;
}

/** @returns {import('astro').AstroIntegration} */
export default function nameMangling({ enabled = process.env.SITE_NAME_MANGLING !== '0' } = {}) {
  let mapping = new Map();
  let active = false;
  return {
    name: 'site-name-mangling',
    hooks: {
      'astro:config:setup': async ({ command, config, updateConfig, logger }) => {
        active = enabled && command === 'build' && process.env.NODE_ENV !== 'development';
        if (!active) return;
        if (config.vite.build?.sourcemap) {
          throw new Error('Name mangling requires unpublished source maps; disable mangling for a debug build.');
        }
        const root = fileURLToPath(config.root);
        const sourceFiles = await filesUnder(join(root, 'src'));
        const runtimeStrings = [];
        for (const file of sourceFiles) {
          if (file.endsWith('.ts')) {
            const strings = scriptStrings(await readFile(file, 'utf8'), file);
            // Quoted property occurrences are per-occurrence reservations in Oxc.
            // Reject mixed quoted/unquoted contracts rather than breaking them.
            for (const name of privateProperties) {
              if (strings.includes(name)) throw new Error(`Quoted private property contract: ${name} in ${file}`);
            }
            if (file.includes(`${join('src', 'scripts')}`)) runtimeStrings.push(...strings);
          }
          if (file.endsWith('.astro')) {
            // Use Astro's parser for source expressions; parse5 only sees final
            // HTML. SSR class:list/tone templates are rewritten after rendering.
            runtimeStrings.push(...astroScriptStrings(await readFile(file, 'utf8')));
          }
        }
        const css = compile(join(root, 'src/styles/index.scss')).css;
        const { counts } = classPlan(css);
        // Deliberately reserve literal runtime contracts and conservative dynamic
        // selector fragments. No runtime JS class string needs rewriting in v1.
        const reserved = classContracts(counts.keys(), runtimeStrings);
        ({ mapping } = classPlan(css, reserved));
        logger.info(`Mangling ${mapping.size} style classes; reserving ${reserved.size} runtime classes.`);
        updateConfig({ vite: { css: {
          transformer: 'lightningcss',
          lightningcss: { visitor: classVisitor((name) => mapping.get(name) ?? name) },
        } } });
      },
      'astro:build:setup': ({ updateConfig }) => {
        if (!active) return;
        // Vite merges this after its normal Oxc minify setting. Native Rolldown
        // rejects >1 output chunk, protecting cross-chunk property contracts.
        // Astro 7 calls this hook once with target=server and builds all Vite
        // environments. Scope the option to client, never prerender/SSR.
        updateConfig({ environments: { client: { build: { rolldownOptions: { output: {
          minify: { mangleProps: propertyOptions },
        } } } } } });
      },
      'astro:build:generated': async ({ dir }) => {
        if (!active) return;
        // HTML has no content-hashed filenames. Hashed JS/CSS are already final
        // and are never touched here; all asset references remain byte-identical.
        for (const file of await filesUnder(fileURLToPath(dir))) {
          if (file.endsWith('.map')) throw new Error(`Unpublished source map required: ${file}`);
          if (file.endsWith('.css') || file.endsWith('.js')) {
            const code = await readFile(file, 'utf8');
            if (/sourceMappingURL\s*=/.test(code)) throw new Error(`Unpublished source map required: ${file}`);
            if (file.endsWith('.css')) assertCssContracts(code, mapping, file);
            else {
              const contracts = classContracts(mapping.keys(), scriptStrings(code, file));
              if (contracts.size) throw new Error(`Unreserved JS class contract in ${file}: ${[...contracts].join(', ')}`);
              for (const name of privateProperties) {
                if (code.includes(name)) throw new Error(`Unmangled private property: ${name} in ${file}`);
              }
            }
          }
          if (!file.endsWith('.html')) continue;
          const html = await readFile(file, 'utf8');
          const rewritten = rewriteHtml(html, mapping);
          if (rewritten !== html) await writeFile(file, rewritten);
        }
      },
    },
  };
}
