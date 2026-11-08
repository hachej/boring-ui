import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { compile } from 'tailwindcss';
import { registryCss } from '../../lab/studio/tailwind.mjs';

// D-1900: shots of a youtubevisual-like AppShell (a fake controller, fictional data) at 390 and 1280, in en and fr: the empty chat, and at 390 the account sheet.
// A real Chromium mounts the real AppShell; the shots go to .cache/evidence/app-shell-locale (or EVIDENCE_DIR), which CI uploads as `app-shell-locale-shots`.
// In CI a missing browser fails the test; it never skips (D-1731). The strings themselves are asserted in app-shell-render.impl.mjs.
const root = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(import.meta.url);
const registry = JSON.parse(readFileSync(join(root, 'registry.json'), 'utf8'));
const item = name => registry.items.find(entry => entry.name === name);
const block = vars => Object.entries(vars).map(([key, value]) => `--${key}: ${value};`).join('\n');
const skip = !process.env.CHROMIUM && !process.env.CI;
const shots = process.env.EVIDENCE_DIR ?? join(root, '.cache/evidence/app-shell-locale');

let server, browser, port;
before(async () => {
  if (skip) return;
  assert.ok(process.env.CHROMIUM, 'CHROMIUM must be set when CI is set');
  mkdirSync(shots, { recursive: true });
  const work = mkdtempSync(join(root, '.cache/app-shell-locale-'));
  const exported = JSON.parse(readFileSync(join(root, 'packages/ui/package.json'), 'utf8')).exports;
  const kit = { name: 'kit-sources', setup(builder) {
    builder.onResolve({ filter: /^@\/hooks\/use-mobile$/ }, () => ({ path: join(root, 'shadcn/ui/use-mobile.ts') }));
    builder.onResolve({ filter: /^@\/components\/ui\// }, args => ({ path: join(root, 'shadcn/ui', `${args.path.split('/').at(-1)}.tsx`) }));
    builder.onResolve({ filter: /^@hachej\/boring-ui-kit\// }, args => {
      const target = exported[`./${args.path.slice('@hachej/boring-ui-kit/'.length)}`]?.import;
      const base = join(root, 'packages/ui/src', String(target).replace(/^\.\/dist\//, '').replace(/\.js$/, ''));
      return { path: ['.ts', '.tsx'].map(ext => base + ext).find(existsSync) };
    });
    builder.onResolve({ filter: /^@hachej\/boring-feedback\/ui$/ }, () => ({ path: join(root, 'packages/feedback/src/ui/index.ts') }));
  } };
  const bundle = await build({ entryPoints: [join(root, 'test/fixtures/themes/app-shell-locale.jsx')], bundle: true, write: false, metafile: true, format: 'esm', platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' }, loader: { '.css': 'empty' }, plugins: [kit], logLevel: 'silent' });
  const js = bundle.outputFiles[0].text;
  const sources = Object.keys(bundle.metafile.inputs).filter(path => /\.(tsx?|jsx)$/.test(path) && !path.includes('node_modules')).map(path => readFileSync(join(root, path), 'utf8'));
  const vars = item('theme').cssVars;
  const cssSource = `@import "tailwindcss";\n@custom-variant dark (&:is(.dark *));\n:root {${block(vars.light)}}\n.dark {${block(vars.dark)}}\n@theme inline {${block(vars.theme)}}\n@layer base { * { @apply border-border; } body { @apply bg-background text-foreground font-sans text-xs; } }\n${['theme', 'app-shell', 'pi-chat', 'viewer-frame', 'feedback'].map(name => registryCss(item(name))).join('\n')}`;
  const compiler = await compile(cssSource, { base: root, loadStylesheet: async id => {
    const path = require.resolve(id === 'tailwindcss' ? 'tailwindcss/index.css' : id);
    return { path, base: dirname(path), content: readFileSync(path, 'utf8') };
  } });
  const css = compiler.build(sources.flatMap(source => source.split(/[\s"'`]+/)));
  const html = '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>';
  server = createServer((req, res) => {
    const path = req.url.split('?')[0];
    res.setHeader('content-type', path.endsWith('.js') ? 'text/javascript' : path.endsWith('.css') ? 'text/css' : 'text/html');
    res.end(path === '/app.js' ? js : path === '/app.css' ? css : html);
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  port = server.address().port;
  await build({ entryPoints: [join(root, 'packages/testing/src/browser.ts')], bundle: true, platform: 'node', format: 'esm', outfile: join(work, 'browser.mjs') });
  const { launch } = await import(pathToFileURL(join(work, 'browser.mjs')));
  browser = await launch('about:blank', { evidence: shots });
});
after(async () => { await browser?.close(); await new Promise(done => server ? server.close(done) : done()); });

const wait = ms => new Promise(done => setTimeout(done, ms));
for (const locale of ['en', 'fr']) {
  for (const [width, height, touch] of [[390, 844, true], [1280, 800, false]]) {
    test(`${locale} at ${width}x${height}: shoot the empty chat${touch ? ' and the account sheet' : ''}`, { skip, timeout: 120000 }, async () => {
      await browser.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: touch });
      await browser.send('Emulation.setTouchEmulationEnabled', { enabled: touch, maxTouchPoints: 5 });
      await browser.send('Page.navigate', { url: `http://127.0.0.1:${port}/?locale=${locale}` });
      await browser.until('shell mounted', `window.__layer && document.querySelector('[data-testid=app-shell]') && document.readyState === 'complete'`);
      await wait(300);
      await browser.evaluate(`window.__layer.open('agent', '${touch ? 'half' : 'open'}')`);
      await browser.until('chat open', `document.querySelector('[data-boring=pi-chat]')`);
      await wait(900);
      await browser.screenshot(`app-shell-${locale}-${width}-chat.png`);
      if (touch) {
        await browser.evaluate(`window.__layer.close()`);
        await wait(900);
        await browser.evaluate(`document.querySelector('[data-testid=account-button]').click()`);
        await browser.until('account sheet', `document.querySelector('[data-testid=app-sheet]')`);
        await wait(900);
        await browser.screenshot(`app-shell-${locale}-${width}-account.png`);
      }
    });
  }
}
