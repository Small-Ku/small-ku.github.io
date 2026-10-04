import assert from 'node:assert/strict';
import test from 'node:test';
import { transform } from 'lightningcss';
import { minify, build as viteBuild } from 'vite';
import nameMangling, {
  classPlan, classVisitor, rewriteHtml, shortName, scriptStrings, propertyOptions, classContracts, astroScriptStrings,
} from '../build/name-mangling.mjs';

test('frequency order, deterministic ties, and occupied short names', () => {
  assert.deepEqual([0, 25, 26, 51, 52, 53, 103, 104].map(shortName),
    ['a', 'z', 'A', 'Z', 'aa', 'ab', 'aZ', 'ba']);
  const css = '.a,.frequent {color:red}.frequent {color:blue}.zebra,.alpha{color:green}';
  const first = classPlan(css, new Set(['a']));
  assert.equal(first.mapping.get('frequent'), 'b');
  assert.equal(first.mapping.get('alpha'), 'c');
  assert.deepEqual([...first.mapping], [...classPlan(css, new Set(['a'])).mapping]);
});

test('nested selector grammar, escaped classes, and reserved namespaces', () => {
  const css = '#fragment .long-name:is(.inner-name,:not(.last-name)):has(>.child-name),'
    + '.escaped\\:name {view-transition-name:long-name;--contract:long-name;content:"long-name"}'
    + '@media(width>1px){.long-name{color:red}}';
  const { mapping } = classPlan(css);
  assert.equal(mapping.size, 5);
  const result = transform({ filename: 'nested.css', code: Buffer.from(css),
    visitor: classVisitor((name) => mapping.get(name) ?? name) }).code.toString();
  for (const name of ['inner-name', 'last-name', 'child-name', 'escaped\\:name']) {
    assert.ok(!result.includes(name), name);
  }
  assert.ok(result.includes('#fragment'));
  assert.ok(result.includes('view-transition-name: long-name'));
  assert.ok(result.includes('--contract: long-name'));
  const attributePlan = classPlan('.owned-name,.owned-other,[class~="owned-name"],[class^="owned-"]{color:red}');
  assert.equal(attributePlan.mapping.size, 0);
});

test('HTML edits only class attributes, including templates and quoted >', () => {
  const source = '<!DOCTYPE html><p title="x > y" class="owned-name untouched" id="owned-name" '
    + 'data-key="owned-name" aria-label="owned-name">owned-name</p>'
    + '<template><i class=owned-name></i></template><script>const text="untouched";</script>';
  assert.equal(rewriteHtml(source, new Map([['owned-name', 'a']])),
    source.replace('class="owned-name untouched"', 'class="a untouched"').replace('class=owned-name', 'class="a"'));
  assert.throws(() => rewriteHtml('<b class=a></b>', new Map([['owned-name', 'a']])), /collision/);
  assert.throws(() => rewriteHtml('<script>document.querySelector(".owned-name")</script>',
    new Map([['owned-name', 'a']])), /inline script class contract/);
  assert.throws(() => rewriteHtml('<style>.owned-name{color:red}</style>',
    new Map([['owned-name', 'a']])), /Untransformed class selector/);
  const json = '<script type="application/ld+json">{"sourceRoot":"owned-name"}</script>';
  assert.equal(rewriteHtml(json, new Map([['owned-name', 'a']])), json);
});

test('literal/template runtime strings preserve dynamic selector fragments', () => {
  assert.deepEqual(scriptStrings('const s=`.owned-${kind}`; node.className="runtime-class";'),
    ['.owned-', '', 'runtime-class']);
  assert.deepEqual([...classContracts(['owned-card', 'other-card'], ['.owned-'])], ['owned-card']);
  assert.deepEqual(astroScriptStrings('---\nconst s="source-class";\n---\n'
    + '<p class:list={["source-class"]}>字</p><script is:inline>node.className="runtime-class"</script>'), ['runtime-class']);
});

test('installed Oxc already mangles lexical names; native positive property set works', async () => {
  const source = 'export const internalRecord=(longParameter)=>({'
    + 'sourcePrimaryRect:longParameter,externalContract:longParameter,"quotedContract":longParameter});';
  const baseline = await minify('fixture.js', source);
  const mangled = await minify('fixture.js', source, { mangleProps: propertyOptions });
  assert.deepEqual(mangled.errors, []);
  assert.ok(!baseline.code.includes('longParameter'));
  assert.ok(baseline.code.includes('sourcePrimaryRect'));
  assert.ok(!mangled.code.includes('sourcePrimaryRect'));
  assert.ok(mangled.code.includes('externalContract'));
  assert.ok(mangled.code.includes('quotedContract'));
  const quoted = await minify('fixture.js', 'export const a={"sourceRoot":1};console.log(a["sourceRoot"]);',
    { mangleProps: propertyOptions });
  assert.ok(quoted.code.includes('sourceRoot'));
  assert.deepEqual(mangled, await minify('fixture.js', source, { mangleProps: propertyOptions }));
});

test('Rolldown refuses unsafe multiple output chunks', async () => {
  await assert.rejects(viteBuild({ configFile: false, logLevel: 'silent',
    plugins: [{ name: 'fixture', resolveId: (id) => id,
      load: (id) => `export const record={sourceRoot:${JSON.stringify(id)}};` }],
    build: { write: false, rolldownOptions: { input: ['one.js', 'two.js'],
      output: { minify: { mangleProps: propertyOptions } } } },
  }), /single|multiple|chunk/i);
});

test('development bypasses mangling; published source maps fail closed', async () => {
  let changed = false;
  await nameMangling().hooks['astro:config:setup']({ command: 'dev', config: {},
    updateConfig: () => { changed = true; } });
  assert.equal(changed, false);
  for (const sourcemap of [true, 'hidden', 'inline']) {
    await assert.rejects(nameMangling().hooks['astro:config:setup']({ command: 'build',
      config: { vite: { build: { sourcemap } } }, updateConfig: () => {} }), /source maps/);
  }
});
