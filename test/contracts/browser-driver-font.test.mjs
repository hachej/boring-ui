// D-1974: the browser driver (packages/testing/src/browser.ts, built from source here) measures in the page's own font. A face that is
// not actually loaded fails the shot or measurement; a deliberate system font says so with data-system-font; the font list is parsed
// respecting quotes; a stalled font request cannot outlast the `until` timeout; and the driver finds its pinned font from any working
// directory. Real headless Chromium (CHROMIUM; missing in CI fails).
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { before } from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('../../', import.meta.url));
const skip = !process.env.CHROMIUM && !process.env.CI && 'no CHROMIUM';
const inter = readFileSync(join(root, 'node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2'));
let launch;

before(async () => {
  if (skip) return;
  assert.ok(process.env.CHROMIUM, 'CHROMIUM must be set when CI is set');
  // Inside the repository (ignored .cache), so the driver finds node_modules from its own location, as an installed package does.
  mkdirSync(join(root, '.cache'), { recursive: true });
  const dir = mkdtempSync(join(root, '.cache/driver-font-'));
  const outfile = join(dir, 'driver.mjs');
  await build({ entryPoints: [join(root, 'packages/testing/src/browser.ts')], outfile, bundle: true, format: 'esm', platform: 'node', logLevel: 'silent' });
  ({ launch } = await import(outfile));
});

async function withPage(t, html, run) {
  const server = createServer((request, response) => {
    if (request.url === '/font.woff2') return void response.writeHead(200, { 'content-type': 'font/woff2' }).end(inter);
    if (request.url === '/stall.woff2') return; // a font request that never answers
    response.writeHead(200, { 'content-type': 'text/html' }).end(html);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const evidence = mkdtempSync(join(tmpdir(), 'driver-font-'));
  const browser = await launch(`http://127.0.0.1:${server.address().port}/`, { chromium: process.env.CHROMIUM, evidence });
  t.after(async () => { await browser.close(); server.closeAllConnections(); server.close(); rmSync(evidence, { recursive: true, force: true }); });
  return run(browser);
}

test('a --font-sans family with no loaded face fails the measurement, never passes as a fallback', { skip }, async t => {
  await withPage(t, '<!doctype html><style>:root{--font-sans:"Acme Brand",sans-serif}</style><body>x', async browser => {
    await assert.rejects(browser.until('page', 'document.body.innerText === "x"'), /Font not ready.*Acme Brand/s);
  });
});

test('a fixture that opts into a system font says so explicitly', { skip }, async t => {
  await withPage(t, '<!doctype html><html data-system-font><style>:root{--font-sans:"Courier New",monospace}</style><body>x', async browser => {
    assert.ok(await browser.until('page', 'document.body.innerText === "x"'));
  });
});

test('the font list is parsed respecting quotes ("Acme, Inc" is one family)', { skip }, async t => {
  const html = `<!doctype html><style>:root{--font-sans:"Acme, Inc",sans-serif}</style><body>x<script>
    (async () => {
      const broken = new FontFace('Acme', 'url(/missing.woff2)'); document.fonts.add(broken); broken.load().catch(() => {});
      const loaded = new FontFace('Acme, Inc', await (await fetch('/font.woff2')).arrayBuffer()); document.fonts.add(loaded);
      await loaded.load(); window.ready = true;
    })();</script>`;
  await withPage(t, html, async browser => { assert.ok(await browser.until('face loaded', 'window.ready === true')); });
});

test('a stack that starts with a system keyword or generic needs no face', { skip }, async t => {
  for (const stack of ['-apple-system, BlinkMacSystemFont, sans-serif', 'System-UI, sans-serif', 'monospace']) {
    await withPage(t, `<!doctype html><style>:root{--font-sans:${stack}}</style><body>x`, async browser => {
      assert.ok(await browser.until(stack, 'document.body.innerText === "x"'));
    });
  }
});

test('family names compare case-insensitively, as CSS does', { skip }, async t => {
  await withPage(t, '<!doctype html><style>:root{--font-sans:"inter variable",sans-serif}</style><body>x', async browser => {
    assert.ok(await browser.until('page', 'document.body.innerText === "x"'));
  });
});

test('CSS escapes in a family name are decoded ("Inter\\20 Variable", "Acme\\" Brand" is one family)', { skip }, async t => {
  await withPage(t, '<!doctype html><style>:root{--font-sans:"Inter\\20 Variable",sans-serif}</style><body>x', async browser => {
    assert.ok(await browser.until('page', 'document.body.innerText === "x"'));
  });
  const quoted = `<!doctype html><style>:root{--font-sans:"Acme\\" Brand",sans-serif}</style><body>x<script>
    (async () => {
      const face = new FontFace('Acme" Brand', await (await fetch('/font.woff2')).arrayBuffer()); document.fonts.add(face);
      await face.load(); window.ready = true;
    })();</script>`;
  await withPage(t, quoted, async browser => { assert.ok(await browser.until('face loaded', 'window.ready === true')); });
});

test('a stalled font request cannot outlast the until timeout', { skip }, async t => {
  const html = '<!doctype html><style>@font-face{font-family:Stall;src:url(/stall.woff2)}:root{--font-sans:Stall,sans-serif}</style><body style="font-family:Stall">x';
  await withPage(t, html, async browser => {
    const started = Date.now();
    await assert.rejects(Promise.race([browser.until('page', 'true', 1000), new Promise((_, no) => setTimeout(() => no(new Error('until hung past its timeout')), 8000))]), /Font not ready.*Stall/s);
    assert.ok(Date.now() - started < 6000);
  });
});

test('launch finds the font from any working directory', { skip }, async t => {
  const before = process.cwd(), elsewhere = join(mkdtempSync(join(tmpdir(), 'driver-cwd-')), 'nested');
  mkdirSync(elsewhere);
  t.after(() => { process.chdir(before); rmSync(elsewhere, { recursive: true, force: true }); });
  process.chdir(elsewhere);
  await withPage(t, '<!doctype html><body>x', async browser => { assert.ok(await browser.until('page', 'document.body.innerText === "x"')); });
});
