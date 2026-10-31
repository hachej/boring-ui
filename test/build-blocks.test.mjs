// The compiled blocks an app imports instead of copying: the built package, not a re-implementation of the build.
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { blocksCss, moduleTarget } from '../scripts/build-blocks.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const dist = join(root, 'packages/ui/dist');
const walk = directory => readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? walk(join(directory, entry.name)) : [join(directory, entry.name)]);
const compiled = () => [...walk(join(dist, 'blocks')), ...walk(join(dist, 'ui'))].filter(path => path.endsWith('.js'));

test('an app specifier maps to the kit\'s layout', () => {
  assert.equal(moduleTarget('@/components/ui/button'), 'ui/button');
  assert.equal(moduleTarget('@/hooks/use-mobile'), 'ui/use-mobile');
  assert.equal(moduleTarget('@/components/pi-chat/rows'), 'blocks/pi-chat/rows');
  assert.equal(moduleTarget('@hachej/boring-ui-kit/pi'), null);
});

test('every registry source file and shadcn primitive has a compiled module with types', () => {
  const { items } = JSON.parse(readFileSync(join(root, 'registry.json'), 'utf8'));
  for (const file of items.flatMap(item => item.files ?? []).filter(file => /\.tsx?$/.test(file.path))) {
    const base = join(dist, file.path.replace(/^registry\//, 'blocks/').replace(/\.tsx?$/, ''));
    assert.ok(existsSync(`${base}.js`), `${base}.js`);
    assert.ok(existsSync(`${base}.d.ts`), `${base}.d.ts`);
  }
  for (const name of readdirSync(join(root, 'shadcn/ui'))) assert.ok(existsSync(join(dist, 'ui', name.replace(/\.tsx?$/, '.js'))), name);
});

test('no compiled module still imports an app alias or a stylesheet, and every relative import resolves', () => {
  const statement = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)["']([^"'\n]+)["']/g;
  for (const path of compiled()) for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (/^\s*(?:\*|\/\/|\/\*)/.test(line)) continue;
    for (const [, spec] of line.matchAll(statement)) {
      assert.ok(!spec.startsWith('@/'), `${path}: ${spec}`);
      assert.ok(!spec.endsWith('.css'), `${path}: ${spec}`);
      if (spec.startsWith('.')) assert.ok(existsSync(join(path, '..', spec)), `${path}: ${spec}`);
    }
  }
});

test('a viewer stays a lazy split point: the kind module imports its pane only dynamically', () => {
  const kind = readFileSync(join(dist, 'blocks/viewer-pdf/pdf-kind.js'), 'utf8');
  assert.match(kind, /import\('\.\/pdf-pane\.js'\)/);
  assert.doesNotMatch(kind, /from ['"]\.\/pdf-pane/);
});

test('blocks.css carries every item\'s rules and the file tree, and the package exports the entries', () => {
  const css = blocksCss(root);
  assert.match(css, /\.pi-chat :where\(button\)/);
  assert.match(css, /@layer base/);
  assert.match(css, /boring-file-tree|file-tree/);
  const { exports } = JSON.parse(readFileSync(join(root, 'packages/ui/package.json'), 'utf8'));
  assert.equal(exports['./blocks/*'].import, './dist/blocks/*.js');
  assert.equal(exports['./ui/*'].import, './dist/ui/*.js');
  assert.equal(exports['./blocks.css'], './styles/blocks.css');
});

test('the Audience block\'s derived rows and parsers (moved from the app template)', async () => {
  const { dayRows, outreachShare, readAudience, refRows, usageOf } = await import('../packages/ui/dist/blocks/audience/audience-model.js');
  const landing = { days: [{ day: '2026-10-24', visits: 0, refs: {} }, { day: '2026-10-25', visits: 2, refs: { beta: 1 } }, { day: '2026-10-26', visits: 4, refs: { 'acme-1': 3 } }], total: 6, refs: { 'acme-1': 3, beta: 1 } };
  assert.deepEqual(refRows(landing), [{ ref: 'acme-1', visits: 3, share: 100 }, { ref: 'beta', visits: 1, share: 33 }]);
  assert.deepEqual(dayRows(landing, 2).map(day => [day.day, day.share]), [['2026-10-26', 100], ['2026-10-25', 50]]);
  assert.equal(outreachShare(landing), 67);
  assert.deepEqual([refRows(null), outreachShare(null), dayRows(null)], [[], 0, []]);
  assert.equal(usageOf([{ kind: 'own_file', n: 2 }], 'sample'), 0);
  assert.deepEqual(readAudience(undefined), { landing: null, usage: null });
});

test('the Outreach block\'s draft, recipient and quota rules (moved from the app template)', async () => {
  const { alreadySent, footerReady, parseDraft, parseRecipients, readOutreach, refFor, replySubject, sentToday } = await import('../packages/ui/dist/blocks/audience/outreach-model.js');
  const NOW = Date.parse('2026-10-26T10:00:00Z');
  const row = over => ({ id: 'o1', to: 'a@b.test', at: NOW - 1000, draft: 'intro', ref: 'a', subject: 's', status: 'sent', ...over });
  assert.deepEqual(parseDraft('intro', 'Subject: Hello\n\nHi {{link}}\n'), { id: 'intro', subject: 'Hello', text: 'Hi {{link}}' });
  assert.equal(parseDraft('c', 'Subject: only'), null);
  assert.deepEqual(parseRecipients('# list\nAda@Acme.fr, acme-1\nnot an address\nada@acme.fr\n\nbob@beta.test\n'), [{ email: 'ada@acme.fr', ref: 'acme-1' }, { email: 'bob@beta.test', ref: 'bob-beta-test' }]);
  assert.match(refFor(`${'x'.repeat(60)}@y.test`), /^[a-z0-9-]{1,32}$/);
  assert.equal(footerReady({ name: 'A', company: 'B', postal: ' ' }), false);
  assert.equal(sentToday([row({}), row({ id: 'o2', status: 'failed' }), row({ id: 'o3', at: NOW - 90_000_000 })], NOW), 1);
  assert.deepEqual([...alreadySent([row({})], 'intro')], ['a@b.test']);
  assert.equal(replySubject('Hi'), 'Re: Hi');
  assert.equal(readOutreach({ available: true, log: [{ id: 1 }, row({})] }).log.length, 1);
});
