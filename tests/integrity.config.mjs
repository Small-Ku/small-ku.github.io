import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { parse } from 'parse5';
import { filesUnder } from '../build/name-mangling.mjs';
import base from '../astro.config.ts';

// Observe bytes at generateBundle (where content hashes/references are final),
// then compare to disk after the HTML integration. No production instrumentation.
const assets = new Map();
export default {
  ...base,
  vite: { ...base.vite, plugins: [{
    name: 'test-final-asset-integrity',
    enforce: 'post',
    generateBundle: { order: 'post', handler(_options, bundle) {
      for (const output of Object.values(bundle)) {
        if (!output.fileName.endsWith('.css') && !(this.environment.name === 'client' && output.type === 'chunk')) continue;
        const bytes = Buffer.from(output.type === 'chunk' ? output.code : output.source);
        const existing = assets.get(output.fileName);
        if (existing) assert.deepEqual(bytes, existing);
        assets.set(output.fileName, bytes);
      }
    } },
  }] },
  integrations: [...base.integrations, {
    name: 'test-final-asset-integrity',
    hooks: {
      'astro:build:done': async ({ dir, logger }) => {
        assert.ok(assets.size >= 2, 'Observed JS and CSS output');
        for (const [file, bytes] of assets) {
          assert.deepEqual(await readFile(join(fileURLToPath(dir), file)), bytes, file);
        }
        const referenced = new Set();
        for (const file of await filesUnder(fileURLToPath(dir))) {
          if (!file.endsWith('.html')) continue;
          function walk(node) {
            for (const attr of node.attrs ?? []) {
              if (['href', 'src'].includes(attr.name) && attr.value.startsWith('/_astro/')) {
                const name = attr.value.slice(1);
                assert.ok(assets.has(name), `Dangling HTML asset reference: ${name}`);
                referenced.add(name);
              }
            }
            for (const child of node.childNodes ?? []) walk(child);
          }
          walk(parse(await readFile(file, 'utf8')));
        }
        assert.equal(referenced.size, assets.size, 'Every observed asset has an HTML reference');
        logger.info(`Verified final bytes for ${assets.size} hashed assets.`);
      },
    },
  }],
};
