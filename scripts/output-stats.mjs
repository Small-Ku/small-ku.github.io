import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { gzipSync, brotliCompressSync, constants } from 'node:zlib';
import { createHash } from 'node:crypto';
import { filesUnder } from '../build/name-mangling.mjs';

const directory = process.argv[2] ?? 'dist';
const totals = Object.fromEntries(['js', 'css', 'html', 'other', 'total'].map((type) =>
  [type, { files: 0, raw: 0, gzip: 0, brotli: 0 }]));
const hashes = {};
for (const path of await filesUnder(directory)) {
  const data = await readFile(path);
  hashes[path.slice(directory.length).replaceAll('\\', '/')] = createHash('sha256').update(data).digest('hex');
  const extension = extname(path).slice(1);
  const type = ['js', 'css', 'html'].includes(extension) ? extension : 'other';
  const values = { files: 1, raw: data.length, gzip: gzipSync(data, { level: 9 }).length,
    brotli: brotliCompressSync(data, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length };
  for (const key of Object.keys(values)) {
    totals[type][key] += values[key];
    totals.total[key] += values[key];
  }
}
console.log(JSON.stringify({ directory, totals, hashes }, null, 2));
