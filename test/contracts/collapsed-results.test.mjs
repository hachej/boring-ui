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

// A result the agent produces while the composer is collapsed must be seen: a final message, a tool outcome with no text, a failed tool, a file it shows, a failed turn, an approval,
// a question, a host notice. Every collapsed place (the bottom bar and the floating bar with the chat closed, the round icon, the phone's bar and icon, the standalone
// FloatingComposer) is driven with each event, and something must be visible (the folded card, the unread mark, the needs-you ring, the failure mark, a notice). Real Chromium. In CI a missing browser fails the test (D-1731).
const root = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(import.meta.url);
const registry = JSON.parse(readFileSync(join(root, 'registry.json'), 'utf8'));
const item = name => registry.items.find(entry => entry.name === name);
const block = vars => Object.entries(vars).map(([key, value]) => `--${key}: ${value};`).join('\n');
const skip = !process.env.CHROMIUM && !process.env.CI;
const shots = process.env.COLLAPSED_RESULTS_EVIDENCE ?? join(root, '.cache/evidence/collapsed-results');

let server, browser, port;
before(async () => {
  if (skip) return;
  assert.ok(process.env.CHROMIUM, 'CHROMIUM must be set when CI is set');
  mkdirSync(shots, { recursive: true });
  mkdirSync(join(root, '.cache'), { recursive: true });
  const work = mkdtempSync(join(root, '.cache/collapsed-results-'));
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
  const bundle = await build({ entryPoints: [join(root, 'test/fixtures/themes/collapsed-results.jsx')], bundle: true, write: false, metafile: true, format: 'esm', platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' }, loader: { '.css': 'empty', '.excalidraw': 'text', '.drawio': 'text', '.html': 'text' }, plugins: [kit], logLevel: 'silent' });
  const js = bundle.outputFiles[0].text;
  const sources = Object.keys(bundle.metafile.inputs).filter(path => /\.(tsx?|jsx)$/.test(path) && !path.includes('node_modules')).map(path => readFileSync(join(root, path), 'utf8'));
  const vars = item('theme').cssVars;
  const cssSource = `@import "tailwindcss";\n@custom-variant dark (&:is(.dark *));\n:root {${block(vars.light)}}\n.dark {${block(vars.dark)}}\n@theme inline {${block(vars.theme)}}\n@layer base { * { @apply border-border; } body { @apply bg-background text-foreground font-sans text-xs; } }\n${['theme', 'app-shell', 'pi-chat', 'pi-chat-mentions', 'pi-chat-attachments', 'pi-chat-slash', 'agent-bar'].map(name => registryCss(item(name))).join('\n')}`;
  const compiler = await compile(cssSource, { base: root, loadStylesheet: async id => {
    const path = require.resolve(id === 'tailwindcss' ? 'tailwindcss/index.css' : id);
    return { path, base: dirname(path), content: readFileSync(path, 'utf8') };
  } });
  const css = compiler.build(sources.flatMap(source => source.split(/[\s"'`]+/)));
  const html = '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>';
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
const js = value => JSON.stringify(value);
const open = async (width, query = '') => {
  const phone = width < 768;
  await browser.send('Page.navigate', { url: 'about:blank' });
  await browser.until('previous page left', `location.href === 'about:blank'`);
  await browser.send('Emulation.setDeviceMetricsOverride', { width, height: phone ? 844 : 900, deviceScaleFactor: 1, mobile: phone });
  await browser.send('Emulation.setTouchEmulationEnabled', { enabled: phone, maxTouchPoints: 5 });
  await browser.send('Page.navigate', { url: `http://127.0.0.1:${port}/?${query}` });
  await browser.until('mounted', `!!document.querySelector('[data-testid=page-button]') && document.readyState === 'complete'${query.includes('standalone') ? '' : ' && !!window.__layer'}`);
  await wait(400);
};
const ICON = '[data-testid=composer-icon]';
const place = name => browser.evaluate(`window.__layer.setPlace(${js(name)})`);

// What a person can see of the agent from where the composer is collapsed: each visible thing by name, empty when they are told nothing.
const told = () => browser.evaluate(`(() => {
  const seen = element => { if (!element) return false; const r = element.getBoundingClientRect(); const s = getComputedStyle(element); return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth && s.visibility !== 'hidden' && s.display !== 'none'; };
  const all = selector => [...document.querySelectorAll(selector)].filter(seen);
  const found = [];
  for (const card of all('[data-testid=agent-card]')) found.push('card:' + card.dataset.state);
  if (all('[data-testid=agent-bar-unread]').length) found.push('unread');
  if (all('[data-testid=composer-icon][data-needs-you=true]').length) found.push('ring');
  if (all('[data-testid=notice]').length) found.push('notice');
  return found.join(' ');
})()`);
const idle = () => browser.until('turn over', `window.__idle()`, 10000);
// The signal that matters is the one that stays when the turn is over (the working card is not a result).
const afterTurn = async event => {
  await browser.evaluate(`window.__say(${js(event)})`);
  await wait(500);
  if (event !== 'approval' && event !== 'question') await idle();
  await wait(400);
  return told();
};

// [name, query, width, how the composer is collapsed]
const PLACES = [
  ['bottom bar, chat closed (1440)', 'plain=1', 1440, async () => {}],
  ['floating bar, chat closed (1440)', '', 1440, async () => { await place('float'); await browser.until('floating', `!!document.querySelector('[data-testid=composer-floating]')`); }],
  ['round icon (1440)', '', 1440, async () => { await place('float'); await place('icon'); await browser.until('icon', `!!document.querySelector(${js(ICON)})`); }],
  ['phone bar, chat closed (390)', '', 390, async () => {}],
  ['phone round icon (390)', '', 390, async () => { await place('icon'); await browser.until('icon', `!!document.querySelector(${js(ICON)})`); }],
  ['standalone floating bar (1440)', 'standalone=1', 1440, async () => {}],
  ['standalone round icon (1440)', 'standalone=1&start=icon', 1440, async () => { await browser.until('icon', `!!document.querySelector(${js(ICON)})`); }],
  ['standalone round icon (390)', 'standalone=1&start=icon', 390, async () => { await browser.until('icon', `!!document.querySelector(${js(ICON)})`); }],
];
const EVENTS = [
  ['final', 'the assistant\'s final message'],
  ['tool only', 'a tool outcome with no closing text'],
  ['tool error', 'a tool that failed, no closing text'],
  ['file', 'a file the agent shows (present), no closing text'],
  ['file text', 'a file the agent shows, and a closing message citing it'],
  ['fail', 'a turn that ends in an error'],
  ['approval', 'a tool that waits for an approval'],
  ['question', 'a question that waits for an answer'],
];

for (const [name, query, width, collapse] of PLACES) {
  test(`${name}: every kind of agent result tells the person something`, { skip, timeout: 400000 }, async () => {
    const silent = [];
    for (const [event, what] of EVENTS) {
      await open(width, query);
      await collapse();
      assert.equal(await told(), '', `${name}: nothing to tell before the agent does anything`);
      const signal = await afterTurn(event);
      await browser.screenshot(`collapsed-${width}-${name.replace(/[^a-z0-9]+/gi, '-')}-${event.replace(/ /g, '-')}.png`);
      if (signal === '') silent.push(`${what} ("${event}")`);
    }
    assert.deepEqual(silent, [], `${name}: nothing visible for these results`);
  });
}

for (const [name, query, width, collapse] of PLACES.filter(([, query]) => !query.includes('standalone'))) {
  test(`${name}: a host notice stays visible`, { skip, timeout: 60000 }, async () => {
    await open(width, query);
    await collapse();
    await browser.evaluate(`window.__notify('error', 'Sync failed (fictional)')`);
    await wait(300);
    assert.match(await told(), /notice/, 'the notice shows above the collapsed composer');
    assert.equal(await browser.evaluate(`document.querySelector('[data-testid=notice-text]')?.textContent`), 'Sync failed (fictional)');
    await browser.evaluate(`document.querySelector('[data-testid=notice-dismiss]').click()`);
    await wait(200);
    assert.doesNotMatch(await told(), /notice/, 'dismiss clears it');
  });
}

test('a reply that came while collapsed is marked, and it clears when the person opens the conversation (bar, icon)', { skip, timeout: 120000 }, async () => {
  await open(1440, 'plain=1');
  await afterTurn('final');
  assert.match(await told(), /card:reply/);
  assert.match(await told(), /unread/);
  await browser.evaluate(`document.querySelector('[data-testid=composer-controller] [data-action=chevron]').click()`);
  await browser.until('window open', `!!document.querySelector('[data-testid=agent-tray]')`);
  await wait(300);
  assert.doesNotMatch(await told(), /unread|card:reply/, 'seen: no mark, no card');
  await open(1440);
  await place('float'); await place('icon');
  await browser.until('icon', `!!document.querySelector(${js(ICON)})`);
  await afterTurn('final');
  assert.match(await told(), /unread/, 'the icon carries the mark');
  await browser.evaluate(`document.querySelector(${js(ICON)}).click()`);
  await browser.until('bar back', `!!document.querySelector('[data-testid=composer-floating]')`);
  await wait(300);
  await browser.evaluate(`document.querySelector('[data-testid=composer-controller] [data-action=chevron]').click()`);
  await browser.until('window open', `!!document.querySelector('[data-testid=agent-tray]')`);
  await wait(300);
  assert.doesNotMatch(await told(), /unread/, 'opening the conversation clears the mark');
});

test('a decision that waits rings the icon and is answered from the open conversation; the ring clears', { skip, timeout: 120000 }, async () => {
  await open(1440);
  await place('float'); await place('icon');
  await browser.until('icon', `!!document.querySelector(${js(ICON)})`);
  assert.match(await afterTurn('approval'), /ring/);
  await browser.evaluate(`document.querySelector(${js(ICON)}).click()`);
  await browser.until('card', `!!document.querySelector('[data-testid=agent-approval-approve]')`);
  await browser.evaluate(`document.querySelector('[data-testid=agent-approval-approve]').click()`);
  await browser.until('ring gone', `!document.querySelector('[data-needs-you=true]')`, 8000);
});
