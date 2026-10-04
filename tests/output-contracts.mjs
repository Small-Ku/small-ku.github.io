import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { relative, join, extname } from 'node:path';
import { parse } from 'parse5';
import { filesUnder } from '../build/name-mangling.mjs';

const [baseline, output] = process.argv.slice(2);
const beforeFiles = await filesUnder(baseline);
const afterFiles = await filesUnder(output);
const assets = new Map();
for (const extension of ['.css', '.js']) {
  const before = beforeFiles.filter((file) => extname(file) === extension);
  const after = afterFiles.filter((file) => extname(file) === extension);
  assert.equal(before.length, 1);
  assert.equal(after.length, 1);
  assets.set('/' + relative(baseline, before[0]).replaceAll('\\', '/'),
    '/' + relative(output, after[0]).replaceAll('\\', '/'));
}
const classes = new Map();
let pages = 0;
let unchanged = 0;
function compare(before, after) {
  for (const key of ['nodeName', 'tagName', 'namespaceURI', 'value', 'name', 'publicId', 'systemId']) {
    assert.equal(after[key], before[key], key);
  }
  assert.equal(after.attrs?.length, before.attrs?.length);
  for (let index = 0; index < (before.attrs?.length ?? 0); index++) {
    const old = before.attrs[index];
    const current = after.attrs[index];
    assert.equal(current.name, old.name);
    assert.equal(current.namespace, old.namespace);
    assert.equal(current.prefix, old.prefix);
    if (old.name === 'class') {
      const oldTokens = old.value.split(/[\t\n\f\r ]+/);
      const newTokens = current.value.split(/[\t\n\f\r ]+/);
      assert.equal(newTokens.length, oldTokens.length);
      oldTokens.forEach((name, index) => {
        if (classes.has(name)) assert.equal(newTokens[index], classes.get(name), name);
        else classes.set(name, newTokens[index]);
      });
    } else assert.equal(current.value, assets.get(old.value) ?? old.value, old.name);
  }
  assert.equal(after.childNodes?.length, before.childNodes?.length);
  before.childNodes?.forEach((child, index) => compare(child, after.childNodes[index]));
  if (before.content) compare(before.content, after.content);
}
for (const file of beforeFiles) {
  const extension = extname(file);
  if (['.js', '.css'].includes(extension)) continue;
  const after = join(output, relative(baseline, file));
  if (extension === '.html') {
    compare(parse(await readFile(file, 'utf8')), parse(await readFile(after, 'utf8')));
    pages++;
  } else {
    assert.deepEqual(await readFile(after), await readFile(file), file);
    unchanged++;
  }
}
assert.equal(new Set(classes.values()).size, classes.size, 'Class mapping is injective');
for (const name of ['site-header', 'site-nav', 'site-footer', 'skip-link']) assert.equal(classes.get(name), name);
assert.ok([...classes].some(([before, after]) => before !== after));
console.log(`Verified ${pages} HTML trees: only class names and hashed asset references differ; ${unchanged} other files are byte-identical.`);
