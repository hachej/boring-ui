import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

// The app-shell item gives buttons 44px on a phone or coarse pointer; `data-dense` (a container or the control) opts out.
// The published registry item's rule is applied by a real browser (happy-dom cannot evaluate `:not([data-dense] *)`): the default
// still applies, the opt-out works. The browser part is skipped where no Chromium is installed.
const registry = JSON.parse(readFileSync(new URL('../../registry.json', import.meta.url), 'utf8'));
const rules = registry.items.find(item => item.name === 'app-shell').css['@layer utilities']['@media (max-width: 640px), (pointer: coarse)'];
const [selector, declaration] = Object.entries(rules)[0];
const chromium = process.env.CHROMIUM ?? `${process.env.HOME}/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome`;

test('the 44px rule is unchanged and names the data-dense opt-out', () => {
  assert.deepEqual(declaration, { 'min-height': '2.75rem', 'min-width': '2.75rem' });
  assert.match(selector, /^\.app-shell :is\(\[data-slot="button"\], /);
  assert.ok(selector.endsWith(':not([data-dense]):not([data-dense] *)'));
});

test('in a phone-width browser, buttons are 44px by default and data-dense keeps its own size', { skip: !existsSync(chromium) && 'no Chromium' }, () => {
  const page = `<style>@media (max-width: 640px), (pointer: coarse) { ${selector} { min-height: 2.75rem; min-width: 2.75rem; } }
    button { all: unset; display: block; height: 10px; width: 10px; box-sizing: border-box; }</style>
    <div class="app-shell"><button id="plain" data-slot="button"></button>
      <div data-dense><button id="inside" data-slot="button"></button><div><button id="deep" data-slot="button"></button></div></div>
      <button id="self" data-slot="button" data-dense></button></div><button id="outside" data-slot="button"></button>
    <pre id="out"></pre><script>out.textContent = JSON.stringify(Object.fromEntries([...document.querySelectorAll('button')].map(b => [b.id, b.getBoundingClientRect().height])));</script>`;
  const file = join(mkdtempSync(join(tmpdir(), 'dense-')), 'page.html');
  writeFileSync(file, page);
  const run = spawnSync(chromium, ['--headless=new', '--no-sandbox', '--disable-gpu', '--window-size=390,800', '--dump-dom', `file://${file}`], { encoding: 'utf8', timeout: 60000 });
  const heights = JSON.parse(/<pre id="out">(.*?)<\/pre>/s.exec(run.stdout)?.[1].replaceAll('&quot;', '"') ?? 'null');
  assert.ok(heights, run.stderr.slice(0, 300));
  assert.equal(heights.plain, 44, 'default: 44px');
  assert.deepEqual([heights.inside, heights.deep, heights.self, heights.outside], [10, 10, 10, 10], 'opted out or outside the shell');
});
