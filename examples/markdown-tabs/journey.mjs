// Real Chromium, two pages of one browser profile (so one real BroadcastChannel), one fictional SQLite note store behind the real
// HTTP resource handler with conditional writes. Proves what test/packages/ui-markdown-conflicts.test.mjs shows in a DOM
// environment: cross-tab refresh, the three conflict choices, the saved revision receipt and a ~1 MB note. Fictional text only.
// Prints `ok N - ...` / `not ok N - ...` lines with numbers; the process fails when any line is not ok.
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';
import { launch, pause } from '@hachej/boring-testing/browser';
import { webRequest, sendWebResponse } from '@hachej/boring-files/node-http';
import { createResourceHandler } from '@hachej/boring-files/remote';
import { openSqliteWorkspaces } from '../../shared/sqlite-workspaces.mjs';

const evidence = resolve(process.env.APP_EVIDENCE ?? '.cache/evidence/markdown-tabs'); mkdirSync(evidence, { recursive: true });
const directory = mkdtempSync(join(tmpdir(), 'boring-markdown-tabs-'));
const identity = Object.freeze({ principalId: 'fictional-editor', scopeId: 'fictional-notes-project', initiatorId: 'fictional-person' });
const encode = text => new TextEncoder().encode(text), decode = bytes => new TextDecoder().decode(bytes);
const target = path => ({ resource: { providerId: 'fictional-notes', path }, view: { kind: 'published' } });

let count = 0, failures = 0;
const report = (ok, name, detail = '') => { if (!ok) failures++; console.log(`${ok ? 'ok' : 'not ok'} ${++count} - ${name}${detail ? ` # ${detail}` : ''}`); };
const check = (name, condition, detail) => report(Boolean(condition), name, detail);
const short = revision => String(revision).slice(0, 8);

const SMALL = 'harbour.md', LARGE = 'survey.md';
const smallText = '# Fictional harbour notes\n\nThe lantern keeper counts nine boats.\n';
let largeText = '# Fictional survey\n\n';
for (let index = 0; largeText.length < 1_048_576; index++) largeText += `Line ${index} of a fictional cedar forest survey, with nothing true in it.\n`;

const provider = openSqliteWorkspaces({ filename: join(directory, 'notes.sqlite'), providerId: 'fictional-notes', authorize: () => true });
for (const [path, text] of [[SMALL, smallText], [LARGE, largeText]]) {
  const seeded = await provider.publication.publish({ operationId: `seed-${path}`, atomicity: 'all-or-nothing', changes: [{ kind: 'create', target: target(path), expected: { kind: 'absent' }, bytes: encode(text), mediaType: 'text/markdown' }] }, identity);
  if (seeded.kind !== 'committed') throw new Error(`Could not seed ${path}: ${seeded.kind}`);
}
let writes = 0;
const handler = createResourceHandler({ authenticate: async () => identity, reader: provider,
  publisher: { publish: (request, access) => { writes++; return provider.publication.publish(request, access); } }, lookup: provider.reconciliation });
/** What the store holds right now: the one place both pages share. */
const stored = async path => {
  const read = await provider.read({ target: target(path), revision: { kind: 'latest' } }, identity);
  if (read.kind !== 'available') throw new Error(`Store read of ${path}: ${read.kind}`);
  return { revision: read.snapshot.ref.revision, text: decode(read.snapshot.bytes), bytes: read.snapshot.bytes.byteLength };
};
const storeUntil = async (path, label, predicate, timeout = 20000) => {
  const deadline = Date.now() + timeout;
  for (;;) {
    const now = await stored(path);
    if (predicate(now)) return now;
    if (Date.now() > deadline) throw new Error(`Timed out: ${label} (store revision ${short(now.revision)}, ${now.bytes} bytes)`);
    await pause(50);
  }
};

const bundle = await build({ entryPoints: [resolve('examples/markdown-tabs/browser.jsx')], outfile: join(directory, 'view.js'), platform: 'browser', format: 'esm', bundle: true, target: 'es2022', metafile: true, loader: { '.woff2': 'dataurl', '.woff': 'dataurl', '.ttf': 'dataurl', '.svg': 'dataurl', '.png': 'dataurl' } });
if (Object.keys(bundle.metafile.inputs).some(path => /pi-durable|packages\/agent\/|node-http|sqlite-workspaces/.test(path))) throw new Error('Browser bundle includes server or native runtime');
const server = createServer(async (incoming, outgoing) => {
  const abort = new AbortController(); outgoing.on('close', () => { if (!outgoing.writableFinished) abort.abort(); });
  try {
    const url = new URL(incoming.url, 'http://127.0.0.1');
    if (url.pathname === '/view.js' || url.pathname === '/view.css') {
      const file = join(directory, url.pathname.slice(1));
      await sendWebResponse(new Response(existsSync(file) ? readFileSync(file) : '', { headers: { 'content-type': url.pathname.endsWith('.js') ? 'text/javascript' : 'text/css' } }), outgoing);
    } else if (url.pathname === '/resource') {
      const request = await webRequest(incoming, url, { signal: abort.signal });
      await sendWebResponse(request ? await handler(request) : new Response(null, { status: 413 }), outgoing);
    } else await sendWebResponse(new Response('<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/view.css"><style>body{font:16px sans-serif;margin:20px}textarea{width:95%;min-height:160px}</style><div id="root"></div><script type="module" src="/view.js"></script>', { headers: { 'content-type': 'text/html' } }), outgoing);
  } catch { if (!outgoing.headersSent) outgoing.writeHead(500); outgoing.end(); }
});
await new Promise((done, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', done); });
const origin = `http://127.0.0.1:${server.address().port}`;

const SOURCE = `document.querySelector('textarea[aria-label="Notes Markdown source"]')`;
const STRIP = '[data-boring="conflict-choices"]';
const named = (scope, label) => `[...document.querySelectorAll(${JSON.stringify(scope)})].find(b => b.textContent.trim() === ${JSON.stringify(label)})`;
const SAVE = named('button', 'Save');
const choice = label => named(`${STRIP} button`, label);
const CHOICES = `[...document.querySelectorAll(${JSON.stringify(`${STRIP} button`)})].map(b => b.textContent.trim()).join('|')`;

/** Real pointer and key input on any page of the browser. `page` is the browser (first page) or a tab: both have send, evaluate and until. */
function driver(page, name) {
  const click = async selector => {
    await page.send('Page.bringToFront');
    const box = await page.until(`${name}: clickable ${selector}`, `(() => { const e = (${selector}); if (!e || e.disabled) return null; e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null; })()`);
    await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y });
    for (const type of ['mousePressed', 'mouseReleased']) await page.send('Input.dispatchMouseEvent', { type, x: box.x, y: box.y, button: 'left', clickCount: 1 });
  };
  const keys = async text => {
    for (const ch of text) {
      const base = ch === '\n' ? { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 } : ch === ' ' ? { key: ' ', code: 'Space', windowsVirtualKeyCode: 32 } : { key: ch };
      await page.send('Input.dispatchKeyEvent', { type: 'keyDown', ...base, text: ch === '\n' ? '\r' : ch });
      await page.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
    }
  };
  /** Click into the source box, put the caret at its end and type. */
  const edit = async text => { await click(SOURCE); await page.evaluate(`(() => { const e = ${SOURCE}; e.focus(); e.selectionStart = e.selectionEnd = e.value.length; })()`); await keys(text); };
  const value = () => page.evaluate(`${SOURCE}?.value ?? null`);
  const receipt = () => page.evaluate(`(() => { const e = document.querySelector('[data-testid="markdown-save-receipt"]'); return e ? { revision: e.dataset.revision, text: e.textContent } : null; })()`);
  const ready = () => page.until(`${name}: editor ready`, `window.md?.ready && !!${SOURCE}`);
  const state = () => page.evaluate('(() => { const s = window.md.controller.getSnapshot(); return { dirty: s.dirty, saved: s.save.result?.kind ?? null }; })()');
  const shot = async file => writeFileSync(join(evidence, file), Buffer.from((await page.send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
  return { name, click, edit, value, receipt, ready, state, shot, until: page.until, evaluate: page.evaluate };
}

const scenario = async (name, run) => { try { await run(); } catch (error) { report(false, name, String(error?.message ?? error).split('\n')[0].slice(0, 300)); } };
let browser;
try {
  browser = await launch(`${origin}/?note=${SMALL}`, { evidence });
  const tab1 = driver(browser, 'tab 1');
  const tab2Page = await browser.openTab(`${origin}/?note=${SMALL}`);
  for (const page of [browser, tab2Page]) await page.send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => {});
  const tab2 = driver(tab2Page, 'tab 2');
  await tab1.ready(); await tab2.ready();
  await pause(500); // both pages have mounted and joined the channel
  const loadedAt = await tab2.evaluate('performance.timeOrigin');

  await scenario('1 save in tab 1 refreshes tab 2', async () => {
    const start = await stored(SMALL);
    const added = 'Tab one adds a gull.';
    await tab1.edit(added);
    const typed = smallText + added;
    check('1 tab 1 shows what was typed, store still on the first revision', await tab1.value() === typed && (await stored(SMALL)).revision === start.revision, `store ${short(start.revision)}`);
    check('1 tab 2 has no unsaved edits before the save', (await tab2.state()).dirty === false);
    await tab1.click(SAVE);
    const now = await storeUntil(SMALL, 'tab 1 save reaches the store', s => s.revision !== start.revision);
    check('1 store holds tab 1 text on a new revision', now.text === typed, `${short(start.revision)} -> ${short(now.revision)}, ${now.bytes} bytes`);
    const waited = Date.now();
    await tab2.until('tab 2 shows the new text', `${SOURCE}?.value === ${JSON.stringify(typed)}`, 20000);
    check('1 tab 2 shows tab 1 text without a reload', await tab2.evaluate('performance.timeOrigin') === loadedAt && (await tab2.state()).dirty === false, `${Date.now() - waited} ms after the store changed`);
    const receipt = await tab1.receipt();
    check('4 receipt shows after the save in tab 1', receipt && receipt.revision === now.revision && /^Saved revision /.test(receipt.text), receipt ? `"${receipt.text}"` : 'no receipt');
    await tab1.shot('1-saved-in-tab-1.png'); await tab2.shot('1-refreshed-tab-2.png');
  });

  /** Both tabs hold the stored text. Tab 2 types its line, tab 1 types another and saves, then tab 2 saves and is refused. */
  async function disagree(label, lineMine, lineTheirs) {
    const before = await stored(SMALL);
    await tab1.until('tab 1 on the stored text', `${SOURCE}?.value === ${JSON.stringify(before.text)}`);
    await tab2.until('tab 2 on the stored text', `${SOURCE}?.value === ${JSON.stringify(before.text)}`);
    await tab2.edit(`\n${lineMine}`);
    await tab1.edit(`\n${lineTheirs}`);
    const mine = await tab2.value();
    check(`2 ${label}: both tabs have unsaved edits`, (await tab1.state()).dirty && (await tab2.state()).dirty && mine === `${before.text}\n${lineMine}`);
    await tab1.click(SAVE);
    const theirs = await storeUntil(SMALL, 'tab 1 save reaches the store', s => s.revision !== before.revision);
    check(`2 ${label}: tab 1 saved`, theirs.text === `${before.text}\n${lineTheirs}`, `${short(before.revision)} -> ${short(theirs.revision)}`);
    const writesBefore = writes;
    await tab2.click(SAVE);
    await tab2.until('tab 2 shows the choices', `${CHOICES} === 'Keep mine|Take theirs|Review diff'`);
    await pause(300);
    const after = await stored(SMALL);
    check(`2 ${label}: tab 2 save refused, strip shows Keep mine, Take theirs, Review diff`, after.revision === theirs.revision && after.text === theirs.text && await tab2.value() === mine,
      `store ${short(after.revision)}, tab 2 result=${(await tab2.state()).saved}, publish attempts ${writes - writesBefore}`);
    return { mine, theirs };
  }

  await scenario('2 keep mine', async () => {
    const { mine, theirs } = await disagree('keep mine', 'Tab two keeps this line.', 'Tab one wrote this first.');
    await tab2.click(choice('Keep mine'));
    const now = await storeUntil(SMALL, 'keep mine reaches the store', s => s.revision !== theirs.revision);
    check('2 keep mine: store holds tab 2 text over the new revision', now.text === mine, `${short(theirs.revision)} -> ${short(now.revision)}, ${now.bytes} bytes`);
    await tab2.until('tab 2 clean', `${CHOICES} === ''`);
    const receipt = await tab2.receipt();
    check('4 receipt shows in tab 2 after keep mine', receipt && receipt.revision === now.revision, receipt ? `"${receipt.text}"` : 'no receipt');
    await tab1.until('tab 1 follows', `${SOURCE}?.value === ${JSON.stringify(mine)}`);
    check('2 keep mine: tab 1 follows without a reload', (await tab1.state()).dirty === false);
    await tab2.shot('2-keep-mine.png');
  });

  await scenario('2 take theirs', async () => {
    const { mine, theirs } = await disagree('take theirs', 'Tab two drops this line.', 'Tab one wins this line.');
    await tab2.click(choice('Take theirs'));
    await tab2.until('tab 2 shows tab 1 text', `${SOURCE}?.value === ${JSON.stringify(theirs.text)}`);
    await pause(500);
    const now = await stored(SMALL);
    check('2 take theirs: tab 2 text is tab 1 text and not what tab 2 typed', await tab2.value() === theirs.text && mine !== theirs.text && (await tab2.state()).dirty === false);
    check('2 take theirs: store unchanged', now.revision === theirs.revision && now.text === theirs.text, `store ${short(now.revision)}, ${now.bytes} bytes`);
    check('2 take theirs: strip closed', await tab2.evaluate(`${CHOICES} === ''`));
    await tab2.shot('2-take-theirs.png');
  });

  await scenario('2 review diff', async () => {
    const { mine, theirs } = await disagree('review diff', 'Tab two reviews this line.', 'Tab one saved this line.');
    const attempts = writes;
    await tab2.click(choice('Review diff'));
    await tab2.until('diff panel', `!!document.querySelector('${STRIP} [data-boring="proposal-diff"]')`);
    const panel = await tab2.evaluate(`document.querySelector('${STRIP} [data-boring="proposal-diff"]').innerText`);
    check('2 review diff: panel shows both texts', panel.includes('Tab one saved this line.') && panel.includes('Tab two reviews this line.'), `${panel.length} characters`);
    await pause(500);
    const now = await stored(SMALL);
    check('2 review diff: nothing saved, nothing lost', await tab2.value() === mine && (await tab2.state()).dirty === true && now.revision === theirs.revision && now.text === theirs.text && writes === attempts,
      `store ${short(now.revision)}, publish attempts ${writes - attempts}, tab 2 text ${mine.length} characters`);
    const buttons = await tab2.evaluate(CHOICES);
    check('2 review diff: strip stays with its three choices', buttons.startsWith('Keep mine|Take theirs|Review diff'), `buttons in the strip: ${buttons}`);
    await tab2.shot('2-review-diff.png');
  });

  await scenario('3 large note', async () => {
    const page = await browser.openTab(`${origin}/?note=${LARGE}&rich`);
    await page.send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => {});
    const big = driver(page, 'large tab');
    await big.ready();
    const limit = await big.evaluate('window.md.limit');
    const start = await stored(LARGE);
    const mode = await big.evaluate(`document.querySelector('[data-boring="markdown-editor"]').dataset.mode`);
    const notice = await big.evaluate(`document.querySelector('[data-testid="markdown-source-only"]')?.textContent ?? null`);
    check('3 note over the size limit opens as source with a visible reason', mode === 'source' && !!notice, `note ${start.bytes} bytes, rich-size limit ${limit} bytes (512 KiB), mode ${mode}, "${notice}"`);
    check('3 the page shows the whole note', await big.evaluate(`${SOURCE}.value.length`) === largeText.length, `${largeText.length} characters`);
    const added = 'Tail line typed in the large note.';
    await big.edit(`\n${added}`);
    await big.click(SAVE);
    const now = await storeUntil(LARGE, 'large save reaches the store', s => s.revision !== start.revision, 30000);
    check('3 an edit saves and the store holds the whole note', now.text === `${largeText}\n${added}` && now.bytes === start.bytes + 1 + added.length, `${start.bytes} -> ${now.bytes} bytes, ${short(start.revision)} -> ${short(now.revision)}`);
    const receipt = await big.receipt();
    check('4 receipt shows after the large save', receipt && receipt.revision === now.revision, receipt ? `"${receipt.text}"` : 'no receipt');
    await big.shot('3-large-note.png');
    await page.close();
  });

  check('no page errors in any tab', browser.problems.length === 0, browser.problems.slice(0, 3).join(' | ').slice(0, 300));
} catch (error) {
  report(false, 'journey setup', String(error?.stack ?? error).split('\n').slice(0, 3).join(' / ').slice(0, 400));
} finally {
  if (browser) await browser.close().catch(() => {});
  server.closeAllConnections(); await new Promise(done => server.close(done));
  provider.close(); rmSync(directory, { recursive: true, force: true });
}
console.log(`1..${count}`);
console.log(failures ? `${failures} not ok` : 'all ok');
process.exitCode = failures ? 1 : 0;
