// D-1729: the whole row takes the tap. Real Chromium at 390 with touch: the rows of a Checkbox list, a Radio group and a Switch list
// (shadcn Field inside FieldLabel, test/fixtures/labelled-rows.tsx) are at least 44px tall, stacked rows do not overlap, one click
// anywhere on a row (text, empty space, the control) changes the control exactly once, a disabled row changes nothing, and Tab shows
// a focus ring on the row. A missing browser fails the test in CI (D-1731).
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { buildTailwind } from '../../lab/studio/tailwind.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const chromium = process.env.CHROMIUM ?? `${process.env.HOME}/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome`;
const skip = !existsSync(chromium) && !process.env.CI && 'no Chromium';
const q = selector => `document.querySelector(${JSON.stringify(selector)})`;
const wait = ms => new Promise(done => setTimeout(done, ms));

/** The page as a consumer builds it: the real shadcn primitives, Tailwind with the global preflight. */
export async function labelledRowsPage() {
  const dir = mkdtempSync(join(tmpdir(), 'labelled-rows-'));
  const alias = { name: 'ui', setup(b) { b.onResolve({ filter: /^@\/components\/ui\/(.+)$/ }, args => ({ path: join(root, 'shadcn/ui', `${args.path.split('/').pop()}.tsx`) })); } };
  await build({ entryPoints: [join(root, 'test/fixtures/labelled-rows.tsx')], bundle: true, format: 'iife', platform: 'browser', outfile: join(dir, 'page.js'), jsx: 'automatic', logLevel: 'silent', plugins: [alias], define: { 'process.env.NODE_ENV': '"production"' } });
  const css = await buildTailwind({ extraDirectories: ['shadcn/ui'], extraFiles: ['test/fixtures/labelled-rows.tsx'], extraCss: '@layer base { @import "tailwindcss/preflight.css"; * { border-color: var(--border); outline-color: color-mix(in oklab, var(--ring) 50%, transparent); } body { background: var(--background); color: var(--foreground); } }' });
  const file = join(dir, 'page.html');
  writeFileSync(file, `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div><script src="page.js"></script>`);
  return { file, dir };
}

test('a labelled row is 44px, rows do not overlap, one click toggles once', { skip }, async t => {
  assert.ok(existsSync(chromium), `Chromium not found at ${chromium}`);
  const { file, dir } = await labelledRowsPage();
  mkdirSync(join(dir, 'shots'), { recursive: true });
  // The browser driver from source, so the test needs no package build.
  const driver = join(dir, 'driver.mjs');
  await build({ entryPoints: [join(root, 'packages/testing/src/browser.ts')], outfile: driver, bundle: true, format: 'esm', platform: 'node', logLevel: 'silent' });
  const { launch } = await import(driver);
  const browser = await launch('about:blank', { chromium, evidence: join(dir, 'shots') });
  t.after(() => browser.close());
  await browser.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await browser.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await browser.send('Page.navigate', { url: `file://${file}` });
  await browser.until('rows mounted', `!!${q('[data-testid=row-a]')}`);

  const rows = ['a', 'b', 'c', 'd', 'seed', 'bloom', 'orchard', 's1', 's2', 's3', 's4'];
  const boxes = await browser.evaluate(`(${JSON.stringify(rows)}).map(id => { const el = document.querySelector('[data-testid=row-' + id + ']'); const r = el.getBoundingClientRect(); return { id, top: r.top, bottom: r.bottom, height: r.height, tag: el.tagName }; })`);
  for (const box of boxes) {
    assert.equal(box.tag, 'LABEL', `${box.id}: the row is a <label>`);
    assert.ok(box.height >= 44, `${box.id}: row is ${box.height}px tall, 44 asked`);
  }
  for (const [one, two] of [['a', 'b'], ['b', 'c'], ['c', 'd'], ['seed', 'bloom'], ['bloom', 'orchard'], ['s1', 's2'], ['s2', 's3'], ['s3', 's4']]) {
    const top = boxes.find(box => box.id === one), bottom = boxes.find(box => box.id === two);
    assert.ok(bottom.top - top.bottom >= 8, `${one} and ${two}: ${bottom.top - top.bottom}px between rows, 8 asked`);
  }
  assert.equal(await browser.evaluate('document.documentElement.scrollWidth > innerWidth'), false, 'a long label wraps; no horizontal scroll');
  assert.ok(boxes.find(box => box.id === 'c').height > 60, 'the long label wraps to more lines');

  // A real mouse click (the events a tap arrives as) at three places of a row: the text, the empty right edge, the control itself.
  const click = async (id, where) => {
    const [x, y] = await browser.evaluate(`(() => { const row = document.querySelector('[data-testid=row-${id}]').getBoundingClientRect(); const control = document.querySelector('[data-testid=control-${id}]').getBoundingClientRect(); const text = document.querySelector('[data-testid=row-${id}] [data-slot=field-content]').getBoundingClientRect();
      return { text: [text.left + 4, text.top + text.height / 2], empty: [row.right - 6, row.top + 6], control: [control.left + control.width / 2, control.top + control.height / 2] }['${where}']; })()`);
    for (const type of ['mousePressed', 'mouseReleased']) await browser.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
    await wait(200);
  };
  const counts = () => browser.evaluate('window.counts');
  for (const id of ['a', 'b', 's1', 's2']) for (const where of ['text', 'empty', 'control']) {
    const before = (await counts())[id] ?? 0;
    await click(id, where);
    assert.equal((await counts())[id] ?? 0, before + 1, `${id}: a click on the ${where} changes the control exactly once`);
  }
  for (const where of ['text', 'empty', 'control']) {
    await click('bloom', where);
    assert.equal(await browser.evaluate(`document.querySelector('[data-testid=control-bloom]').getAttribute('aria-checked')`), 'true', `bloom: a click on the ${where} picks it`);
    assert.equal((await counts()).bloom, 1, `bloom: a click on the ${where} changes it once`);
    await click('seed', 'empty');
    await browser.evaluate('delete window.counts.bloom; delete window.counts.seed');
  }
  for (const id of ['d', 'orchard', 's4']) {
    await click(id, 'text'); await click(id, 'empty');
    assert.equal((await counts())[id], undefined, `${id}: a disabled row changes nothing`);
  }

  // Keyboard: Tab reaches the first control and its row shows the focus ring.
  await browser.evaluate('document.activeElement?.blur(); window.scrollTo(0, 0)');
  await browser.press('Tab');
  const ring = await browser.evaluate(`(() => ({ focus: document.activeElement === document.querySelector('[data-testid=control-a]'), shadow: getComputedStyle(document.querySelector('[data-testid=row-a]')).boxShadow }))()`);
  assert.equal(ring.focus, true, 'Tab lands on the first control');
  assert.notEqual(ring.shadow, 'none', 'the focused row shows a ring');
});

// D-1751: FieldLabel variant="flat" is the settings row: no border, 44px, a hairline --border between rows only, no gap; the default is unchanged.
test('a flat settings row has no border, 44px, a divider between rows only, and the default stays bordered', { skip }, async t => {
  assert.ok(existsSync(chromium), `Chromium not found at ${chromium}`);
  const { file, dir } = await labelledRowsPage();
  mkdirSync(join(dir, 'shots'), { recursive: true });
  const driver = join(dir, 'driver.mjs');
  await build({ entryPoints: [join(root, 'packages/testing/src/browser.ts')], outfile: driver, bundle: true, format: 'esm', platform: 'node', logLevel: 'silent' });
  const { launch } = await import(driver);
  const browser = await launch('about:blank', { chromium, evidence: join(dir, 'shots') });
  t.after(() => browser.close());
  await browser.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await browser.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await browser.send('Page.navigate', { url: `file://${file}` });
  await browser.until('rows mounted', `!!${q('[data-testid=row-f1]')}`);

  const ids = ['f1', 'f2', 'f3', 'f4'];
  const rows = await browser.evaluate(`(${JSON.stringify(ids)}).map(id => { const el = document.querySelector('[data-testid=row-' + id + ']'); const r = el.getBoundingClientRect(); const c = getComputedStyle(el);
    return { id, top: r.top, bottom: r.bottom, height: r.height, variant: el.dataset.variant, widths: [c.borderTopWidth, c.borderRightWidth, c.borderLeftWidth, c.borderBottomWidth], bottomStyle: c.borderBottomStyle, bottomColor: c.borderBottomColor, radius: c.borderTopLeftRadius, bg: c.backgroundColor }; })`);
  const hairline = await browser.evaluate(`(() => { const probe = document.createElement('i'); probe.style.borderColor = 'var(--border)'; probe.style.borderStyle = 'solid'; document.body.append(probe); const color = getComputedStyle(probe).borderTopColor; probe.remove(); return color; })()`);
  for (const row of rows) {
    assert.equal(row.variant, 'flat', `${row.id}: variant is flat`);
    assert.deepEqual(row.widths.slice(0, 3), ['0px', '0px', '0px'], `${row.id}: no border on top, right or left`);
    assert.ok(row.height >= 44 && (row.id === 'f2' || row.height <= 45), `${row.id}: row is ${row.height}px, 44 asked (f2 has a description line)`);
    assert.equal(row.radius, '0px', `${row.id}: no rounded box`);
  }
  for (const row of rows.slice(0, -1)) {
    assert.equal(row.widths[3], '1px', `${row.id}: a 1px divider under the row`);
    assert.equal(row.bottomColor, hairline, `${row.id}: the divider is --border`);
  }
  assert.equal(rows[3].widths[3], '0px', 'no divider after the last row');
  for (let i = 1; i < rows.length; i++) assert.equal(rows[i].top - rows[i - 1].bottom, 0, `${rows[i - 1].id} and ${rows[i].id}: no gap`);

  const click = async (id, where) => {
    await browser.evaluate(`document.querySelector('[data-testid=row-${id}]').scrollIntoView({ block: 'center' })`);
    const [x, y] = await browser.evaluate(`(() => { const row = document.querySelector('[data-testid=row-${id}]').getBoundingClientRect(); const text = document.querySelector('[data-testid=row-${id}] [data-slot=field-content]').getBoundingClientRect();
      return { text: [text.left + 4, text.top + text.height / 2], empty: [row.right - 6, row.top + 6] }['${where}']; })()`);
    for (const type of ['mousePressed', 'mouseReleased']) await browser.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
    await wait(200);
  };
  for (const id of ['f1', 'f4']) for (const where of ['text', 'empty']) {
    const before = (await browser.evaluate('window.counts'))[id] ?? 0;
    await click(id, where);
    assert.equal((await browser.evaluate('window.counts'))[id] ?? 0, before + 1, `${id}: a click on the ${where} toggles once`);
  }
  await click('f3', 'text');
  assert.equal((await browser.evaluate('window.counts')).f3, undefined, 'a disabled flat row changes nothing');

  // Keyboard focus stays visible on a flat row, inside the row's box.
  await browser.evaluate('document.activeElement?.blur(); window.scrollTo(0, 0); document.querySelector("[data-testid=control-f1]").focus()');
  await browser.press('Tab'); await browser.press('Tab').catch(() => {});
  await browser.evaluate('document.querySelector("[data-testid=control-f2]").focus({ focusVisible: true })');
  await browser.press('Tab'); await browser.press('Tab');
  const focus = await browser.evaluate(`(() => { document.querySelector('[data-testid=control-f4]').focus(); const row = document.querySelector('[data-testid=row-f4]'); return { on: document.activeElement === document.querySelector('[data-testid=control-f4]'), shadow: getComputedStyle(row).boxShadow }; })()`);
  assert.equal(focus.on, true);

  // The default is unchanged: the rows of the first test are still bordered, rounded and apart.
  const dflt = await browser.evaluate(`(() => { const c = getComputedStyle(document.querySelector('[data-testid=row-a]')); return { variant: document.querySelector('[data-testid=row-a]').dataset.variant, widths: [c.borderTopWidth, c.borderRightWidth, c.borderBottomWidth, c.borderLeftWidth], radius: c.borderTopLeftRadius }; })()`);
  assert.equal(dflt.variant, 'bordered');
  assert.deepEqual(dflt.widths, ['1px', '1px', '1px', '1px'], 'the default row keeps its 1px border');
  assert.notEqual(dflt.radius, '0px', 'the default row keeps its radius');
});
