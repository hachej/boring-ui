import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

// The theme item gives buttons 44px on a phone or coarse pointer; `data-density="compact"` (a container or the control) opts out by setting
// --control-min to 0 (D-1741; it replaces `data-dense`). The published registry item's rule and the theme's token are applied by a real browser:
// the default still applies, the opt-out works. The browser part is skipped where no Chromium is installed.
const registry = JSON.parse(readFileSync(new URL('../../registry.json', import.meta.url), 'utf8'));
const rules = registry.items.find(item => item.name === 'theme').css['@layer utilities']['@media (width < 768px), (pointer: coarse)'];
const [selector, declaration] = Object.entries(rules)[0];
const tokens = registry.items.find(item => item.name === 'theme').css['@layer base'];
const tokenCss = `:root { ${Object.entries(tokens[':root']).map(([k, v]) => `${k}: ${v}`).join('; ')} }
  @media (width < 768px), (pointer: coarse) { :root { ${Object.entries(tokens['@media (width < 768px), (pointer: coarse)'][':root']).map(([k, v]) => `${k}: ${v}`).join('; ')} } }
  [data-density="compact"] { ${Object.entries(tokens['[data-density="compact"]']).map(([k, v]) => `${k}: ${v}`).join('; ')} }`;
const chromium = process.env.CHROMIUM ?? `${process.env.HOME}/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome`;

test('the 44px rule reads --control-min, so data-density="compact" opts out', () => {
  assert.deepEqual(declaration, { 'min-height': 'var(--control-min, 2.75rem)', 'min-width': 'var(--control-min, 2.75rem)' });
  assert.match(selector, /^:root :is\(\[data-slot="button"\], /);
  assert.match(selector, /data-size="inline"/, 'a Button size="inline" keeps its text height');
  assert.ok(!selector.includes('data-dense'), 'the data-dense escape is replaced by the token');
});

test('in a phone-width browser, buttons are 44px by default and data-density="compact" keeps its own size', { skip: !existsSync(chromium) && !process.env.CI && 'no Chromium' }, () => {
  // In CI a missing browser fails the test; it never skips (D-1731).
  assert.ok(existsSync(chromium), `Chromium not found at ${chromium}`);
  const page = `<style>${tokenCss}
    @media (width < 768px), (pointer: coarse) { ${selector} { min-height: ${declaration['min-height']}; min-width: ${declaration['min-width']}; } }
    button { all: unset; display: block; height: 10px; width: 10px; box-sizing: border-box; }</style>
    <div><button id="plain" data-slot="button"></button>
      <div data-density="compact"><button id="inside" data-slot="button"></button><div><button id="deep" data-slot="button"></button></div></div>
      <button id="self" data-slot="button" data-density="compact"></button></div><button id="inline" data-slot="button" data-size="inline"></button>
    <pre id="out"></pre><script>out.textContent = JSON.stringify(Object.fromEntries([...document.querySelectorAll('button')].map(b => [b.id, b.getBoundingClientRect().height])));</script>`;
  const file = join(mkdtempSync(join(tmpdir(), 'dense-')), 'page.html');
  writeFileSync(file, page);
  const run = spawnSync(chromium, ['--headless=new', '--no-sandbox', '--disable-gpu', '--window-size=390,800', '--dump-dom', `file://${file}`], { encoding: 'utf8', timeout: 60000 });
  const heights = JSON.parse(/<pre id="out">(.*?)<\/pre>/s.exec(run.stdout)?.[1].replaceAll('&quot;', '"') ?? 'null');
  assert.ok(heights, run.stderr.slice(0, 300));
  assert.equal(heights.plain, 44, 'default: 44px');
  assert.deepEqual([heights.inside, heights.deep, heights.self, heights.inline], [10, 10, 10, 10], 'opted out (compact) or inline');
});
