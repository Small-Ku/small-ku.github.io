import { mkdtemp, readFile, writeFile, mkdir, rm, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:net';

const temporary = await mkdtemp(join(tmpdir(), 'site-mangling-browser-'));
const created = [];
async function freePort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}
function run(args, env = {}) {
  const result = spawnSync(process.execPath, args, { stdio: 'inherit',
    env: { ...process.env, ...env } });
  if (result.status !== 0) throw new Error(`Validation command failed (${result.status}): ${args.join(' ')}`);
}
try {
  const project = await readFile('templates/project.md', 'utf8');
  const writing = await readFile('templates/writing.md', 'utf8');
  for (const locale of ['en', 'zh']) {
    for (const [index, tone] of ['violet', 'teal', 'coral', 'neutral'].entries()) {
      const path = join('src/content/projects', locale === 'en' ? '' : 'zh', `mangling-fixture-${tone}.md`);
      await mkdir(join(path, '..'), { recursive: true });
      const content = project.replace('locale: en', `locale: ${locale}`)
        .replace('# translationKey: my-project', `translationKey: mangling-fixture-${tone}`)
        .replace('title: My Project', `title: Mangling Fixture ${tone}`)
        .replace('draft: true', 'draft: false').replace('selected: false', 'selected: true')
        .replace('# selectedOrder: 1', `selectedOrder: ${index + 101}`).replace('tone: violet', `tone: ${tone}`);
      await writeFile(path, content, { flag: 'wx' });
      created.push(path);
    }
    const path = join('src/content/writing', locale === 'en' ? '' : 'zh', 'mangling-fixture-note.md');
    await mkdir(join(path, '..'), { recursive: true });
    await writeFile(path, writing.replace('locale: en', `locale: ${locale}`)
      .replace('# translationKey: my-note', 'translationKey: mangling-fixture-note')
      .replace('title: My Note', 'title: A writing identity fixture with enough words to wrap across multiple lines')
      .replace('date: "YYYY-MM-DD"', 'date: "2026-09-01"')
      .replace('draft: true', 'draft: false')
      + '\n<p id="fixture-fragment" class="external-content-contract" data-fixture="schema-value">Content contract</p>\n',
    { flag: 'wx' });
    created.push(path);
  }
  run(['node_modules/astro/bin/astro.mjs', 'build'], { SITE_NAME_MANGLING: '0' });
  const baseline = join(temporary, 'baseline');
  await cp('dist', baseline, { recursive: true });
  run(['node_modules/astro/bin/astro.mjs', 'build', '--config', 'tests/integrity.config.mjs'],
    { SITE_NAME_MANGLING: '1' });
  run(['tests/output-contracts.mjs', baseline, 'dist']);
  run(['node_modules/@playwright/test/cli.js', 'test'], { MANGLING_BROWSER_BASELINE: baseline,
    MANGLING_BROWSER_ARTIFACTS: join(temporary, 'playwright'),
    MANGLING_BROWSER_PORT: String(await freePort()), MANGLING_BASELINE_PORT: String(await freePort()) });
} finally {
  for (const path of created) await rm(path);
  await rm(temporary, { recursive: true });
}
