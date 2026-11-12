// The UX harness and its showcase site show invented data only: no real e-mail address, no key or token, no private name.
// Scanned: the one-composer fixtures, ux/fixtures, ux/scenarios, and a site generated here from a tiny synthetic capture.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { site } from '../ux/runner/site.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const SAFE_DOMAINS = /^(example\.test|example\.com|example\.org|invalid|example\.invalid)$/i;
// The kit's own public names are not private: its npm scope and its public repository.
const PUBLIC = /@hachej\/boring-[\w-]+|hachej\/boring-ui/gi;
const DENY = ['sumeo', 'sofrudel', 'hachej', 'huraultj', 'julien.hurault'];
const SECRETS = [/\bsk-[A-Za-z0-9_-]{16,}/, /\bghp_[A-Za-z0-9]{16,}/, /\bxox[abprs]-[A-Za-z0-9-]{8,}/, /BEGIN [A-Z ]*PRIVATE KEY/, /[A-Za-z0-9+/=]{32,}/];

const files = directory => readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
  const path = join(directory, entry.name);
  return entry.isDirectory() ? files(path) : [path];
});
const exists = path => { try { return statSync(path).isDirectory(); } catch { return false; } };

export function problems(text) {
  const found = [];
  for (const [address] of text.matchAll(/[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g)) if (!SAFE_DOMAINS.test(address.split('@')[1])) found.push(`e-mail address ${address}`);
  const cleaned = text.replace(PUBLIC, '');
  for (const word of DENY) if (cleaned.toLowerCase().includes(word)) found.push(`denied word "${word}"`);
  for (const pattern of SECRETS) { const hit = text.match(pattern); if (hit) found.push(`looks like a key or token: ${hit[0].slice(0, 12)}...`); }
  return found;
}

const scan = list => list.flatMap(path => problems(readFileSync(path, 'utf8')).map(p => `${relative(root, path)}: ${p}`));

test('the scanner catches what it must and lets the invented through', () => {
  assert.ok(problems('write to jane@acme.io').length);
  assert.ok(problems('write to jeanne@example.test').length === 0);
  assert.ok(problems(`key ${'sk-'}${'a'.repeat(24)}`).length);
  assert.ok(problems(`token ${'ghp_'}${'b'.repeat(30)}`).length);
  assert.ok(problems(`${'-----BEGIN'} PRIVATE KEY-----`).length);
  assert.ok(problems('f'.repeat(40)).length);
  assert.ok(problems('Sumeo invoice').length);
  assert.deepEqual(problems("import x from '@hachej/boring-ui-kit/markdown'"), []);
});

test('fixtures and scenarios hold invented data only', () => {
  const themes = join(root, 'test/fixtures/themes');
  const list = [...readdirSync(themes).filter(f => /^one-composer.*\.jsx$/.test(f)).map(f => join(themes, f)),
    ...['ux/fixtures', 'ux/scenarios'].map(d => join(root, d)).filter(exists).flatMap(files)];
  assert.ok(list.length > 2, 'the fixtures to scan were found');
  assert.deepEqual(scan(list), []);
});

test('a site generated from a synthetic capture holds invented data only', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'ux-site-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const from = join(dir, 'cap'), out = join(dir, 'site'), name = 'component-demo-card';
  mkdirSync(join(from, name, 'flows/F01'), { recursive: true });
  mkdirSync(join(from, name, 'states'), { recursive: true });
  mkdirSync(join(from, name, 'videos'), { recursive: true });
  mkdirSync(join(from, '_pages'), { recursive: true });
  writeFileSync(join(from, '_pages', `${name}.html`), '<!doctype html><title>Demo</title>');
  writeFileSync(join(from, name, 'states/390-01-rest.png'), 'png');
  writeFileSync(join(from, name, 'flows/F01/strip-390.png'), 'png');
  writeFileSync(join(from, name, 'videos/F01-390.webm'), 'webm');
  const step = { say: 'Tap the card', expect: 'The card opens', gap: null, ok: true, firstChangeMs: 80, settledMs: 200, cls: 0, repeats: 0, target: { x: 0, y: 0, w: 48, h: 48 }, focusAfter: 'field', expectFocus: 'field', moved: { field: { dx: 0, dy: 0, dh: 0 } }, offscreen: [], overlaps: [], truncated: [], horizontalScroll: false, scrollBefore: {}, scrollAfter: {} };
  writeFileSync(join(from, name, 'result.json'), JSON.stringify({ target: 'component:demo-card', states: [], stateFailures: [], errors: [], flows: [{ id: 'F01', name: 'Open the card', viewport: '390', steps: [step, { ...step, say: 'Swipe', gap: 'No swipe yet', ok: false }], consoleErrors: [], failedRequests: [] }] }));
  writeFileSync(join(from, name, 'target.json'), JSON.stringify({ target: 'component:demo-card', title: 'Demo card', purpose: 'A card for Cedar Works, a fictional bakery.', level: 'component', kitVersion: '0.0.0', commit: 'abc1234', capturedAt: '2026-01-01T00:00:00.000Z' }));
  const scenario = { target: 'component:demo-card', title: 'Demo card', purpose: 'A card.', fixture: { entry: 'x.jsx', query: 'tabs=1', install: 'npx shadcn@4.23.0 add card', usage: '<Card title="Hello" />' }, viewports: [{ name: '390', width: 390, height: 844, touch: true }], thresholds: {}, states: [], flows: [], watch: [] };
  await site({ from, out, scenarios: [scenario] });
  const html = files(out).filter(f => /\.(html|css)$/.test(f));
  assert.ok(html.some(f => f.endsWith(join(name, 'index.html'))));
  const page = readFileSync(join(out, name, 'index.html'), 'utf8');
  assert.match(page, /Reply|First visible change after 80 ms/);
  assert.match(page, /Not in the kit yet:<\/span> No swipe yet/);
  assert.match(page, /npx shadcn@4\.23\.0 add card/);
  assert.doesNotMatch(page, /verdict|grade|scoreboard/i);
  assert.deepEqual(scan(html), []);
});
