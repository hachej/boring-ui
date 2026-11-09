import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { mkdirSync, mkdtempSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { buildGallery } from '../../scripts/gallery-build.mjs';

// D-2012: the kit gallery (demos/gallery) is one self-contained file. A real Chromium opens that file, visits each section in light and dark and
// finds its landmark with no console error and no network request. CI uploads the shots as `kit-gallery-shots`; `npm run gallery:build` is the file itself.
// In CI a missing browser fails the test; it never skips (D-1731).
const root = fileURLToPath(new URL('../../', import.meta.url));
const skip = !process.env.CHROMIUM && !process.env.CI;
const shots = process.env.EVIDENCE_DIR ?? join(root, '.cache/evidence/gallery');
// Each section: its cards, in order, and for some a check that the card's content is really there (a card emptied of its specimen must fail).
const SECTIONS = {
  bases: ['button-variants', 'button-sizes', 'button-states', 'badges', 'fields', 'choices', 'tooltip', 'overlays', 'tabs', 'toast', 'skeleton'],
  blocs: ['page-header', 'kpi-stat', 'list-row', 'empty-state', 'data-table', 'space-card', 'wiring-chips', 'file-pick', 'inline-question', 'status-narrative'],
  chat: ['pi-chat', 'agent-bar'],
  visionneuses: ['viewer-image', 'viewer-svg', 'viewer-csv', 'viewer-markdown', 'viewer-text'],
  coquille: ['shell', 'phone'],
};
const CONTENT = {
  'button-variants': ['button', 4],
  fields: ['input', 1],
  tabs: ['[role=tab]', 2],
  'data-table': ['tbody tr', 4],
  'pi-chat': ['[data-testid=composer-input]', 1],
  'viewer-image': ['img[src^="blob:"]', 1],
  'viewer-svg': ['[data-testid=artifact-svg]', 1],
  'viewer-csv': ['[data-testid=artifact-csv] tbody tr', 3],
  'viewer-markdown': ['iframe', 1],
  phone: ['[data-testid=phone-frame]', 1],
};

let browser, file;
before(async () => {
  if (skip) return;
  assert.ok(process.env.CHROMIUM, 'CHROMIUM must be set when CI is set');
  mkdirSync(join(root, '.cache'), { recursive: true });
  mkdirSync(shots, { recursive: true });
  const work = mkdtempSync(join(root, '.cache/gallery-test-'));
  file = join(work, 'index.html');
  await buildGallery({ outFile: file });
  await build({ entryPoints: [join(root, 'packages/testing/src/browser.ts')], bundle: true, platform: 'node', format: 'esm', outfile: join(work, 'browser.mjs') });
  const { launch } = await import(pathToFileURL(join(work, 'browser.mjs')));
  browser = await launch('about:blank', { evidence: shots });
});
after(async () => { await browser?.close(); });

const open = async (hash, theme) => {
  await browser.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await browser.send('Page.navigate', { url: `${pathToFileURL(file).href}${theme === 'dark' ? '?theme=dark' : ''}#${hash}` });
  await browser.until('shell mounted', `!!document.querySelector('[data-testid=app-shell]') && !!document.querySelector('[data-testid^=gallery-]') && document.readyState === 'complete'`);
};
const visible = id => browser.evaluate(`(() => { const e = document.querySelector('[data-testid=${id}]'); if (!e) return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; })()`);

test('the built file carries its script and style inline', { skip }, () => {
  assert.ok(statSync(file).size > 100_000, 'the bundle is inlined');
});

for (const theme of ['light', 'dark']) {
  test(`every section renders with no console error and no network, ${theme}`, { skip, timeout: 240000 }, async () => {
    await open('bases', theme);
    assert.equal(await browser.evaluate(`document.documentElement.classList.contains('dark')`), theme === 'dark');
    for (const [id, specimens] of Object.entries(SECTIONS)) {
      await browser.evaluate(`document.querySelector('[data-testid=nav-${id}]').click()`);
      await browser.until(`${id} on show`, `(() => { const e = document.querySelector('[data-testid=gallery-${id}]'); return !!e && e.getBoundingClientRect().width > 0; })()`);
      assert.equal(await visible(`gallery-${id}`), true, `${id} is on show`);
      assert.deepEqual(await browser.evaluate(`[...document.querySelectorAll('[data-testid=gallery-${id}] [data-testid^=specimen-]')].map(e => e.dataset.testid.slice('specimen-'.length))`), specimens, `${id}: its cards, in order`);
      for (const specimen of specimens) {
        // Every card has a usage line, a feature reference and content with a size and something in it.
        const card = await browser.evaluate(`(() => { const c = document.querySelector('[data-testid=specimen-${specimen}]'); const body = c.querySelector('[data-slot=card-content]'); const r = body.getBoundingClientRect(); return { size: r.width > 0 && r.height > 0, filled: body.children.length > 0 && body.textContent.trim().length + body.querySelectorAll('img,svg,iframe,canvas,input,table').length > 0, usage: !!c.querySelector('[data-testid=usage-code]')?.textContent.trim(), feature: !!c.querySelector('[data-testid=feature-ref]')?.textContent.trim() }; })()`);
        assert.deepEqual(card, { size: true, filled: true, usage: true, feature: true }, `${id}/${specimen}: the card shows its specimen`);
        const [selector, least] = CONTENT[specimen] ?? [];
        if (selector) assert.ok(await browser.evaluate(`document.querySelectorAll('[data-testid=specimen-${specimen}] ${selector}').length >= ${least}`), `${id}/${specimen}: ${least} x ${selector}`);
      }
      await browser.screenshot(`gallery-${id}-${theme}`);
    }
    assert.deepEqual(await browser.evaluate(`performance.getEntriesByType('resource').map(entry => entry.name).filter(name => /^https?:/.test(name))`), [], 'no network request');
    assert.deepEqual(browser.problems, [], 'no console error');
  });
}

test('the header switches the theme and the density; the phone entry opens the 390px frame, which shows the same page compact', { skip, timeout: 120000 }, async () => {
  await open('bases', 'light');
  await browser.evaluate(`document.querySelector('[aria-label="Thème sombre"]').click()`);
  await browser.until('dark', `document.documentElement.classList.contains('dark')`);
  await browser.evaluate(`document.querySelector('[aria-label="Densité compacte"]').click()`);
  await browser.until('compact', `document.documentElement.dataset.density === 'compact'`);
  await browser.evaluate(`document.querySelector('[data-testid=nav-coquille]').click()`);
  await browser.until('phone frame', `!!document.querySelector('[data-testid=phone-frame]')?.contentDocument?.querySelector('[data-testid=gallery-bases]')`);
  // The bezel is 390px wide with an 8px padding and a 1px border either side, so the iframe is 390 - 18 = 372px and its own viewport is that wide: not scaled.
  const phone = await browser.evaluate(`(() => { const f = document.querySelector('[data-testid=phone-frame]'); return { bezel: f.parentElement.getBoundingClientRect().width, frame: f.getBoundingClientRect().width, inner: f.contentWindow.innerWidth }; })()`);
  assert.deepEqual(phone, { bezel: 390, frame: 372, inner: 372 }, 'a 390px phone frame, shown at its own size');
  assert.equal(await browser.evaluate(`document.querySelector('[data-testid=phone-frame]').contentDocument.documentElement.classList.contains('dark')`), true, 'the frame follows the theme');
  await browser.screenshot('gallery-phone');
  assert.deepEqual(browser.problems, [], 'no console error');
});

test('a card anchor opens its section and shows the usage line and the feature id', { skip, timeout: 120000 }, async () => {
  await open('data-table', 'light');
  await browser.until('the blocs section', `(() => { const e = document.querySelector('[data-testid=gallery-blocs]'); return !!e && e.getBoundingClientRect().width > 0; })()`);
  assert.equal(await visible('specimen-data-table'), true, 'the card is on show');
  assert.match(await browser.evaluate(`document.querySelector('#data-table [data-testid=usage-code]').textContent`), /boring-ui-blocks add data-table/);
  assert.match(await browser.evaluate(`document.querySelector('#data-table [data-testid=feature-ref]').textContent`), /pattern-data-table/);
  assert.deepEqual(browser.problems, [], 'no console error');
});

test('a malformed fragment is an unknown anchor: the page renders on its first section', { skip, timeout: 120000 }, async () => {
  for (const hash of ['%', '%E0%A4%A', 'no-such-card']) {
    await open(hash, 'light');
    assert.equal(await visible('gallery-bases'), true, `#${hash} opens the first section`);
  }
  assert.deepEqual(browser.problems, [], 'no console error');
});

test('a message sent in the chat is answered by the fake reply', { skip, timeout: 120000 }, async () => {
  await open('chat', 'light');
  await browser.until('the composer', `!!document.querySelector('[data-testid=gallery-chat-frame] [data-testid=composer-input]')`);
  await browser.type(`document.querySelector('[data-testid=gallery-chat-frame] [data-testid=composer-input]')`, 'Que faire jeudi ?');
  await browser.until('send enabled', `document.querySelector('[data-testid=gallery-chat-frame] [data-testid=composer-submit]')?.disabled === false`);
  await browser.evaluate(`document.querySelector('[data-testid=gallery-chat-frame] [data-testid=composer-submit]').click()`);
  await browser.until('the reply', `document.querySelector('[data-testid=gallery-chat-frame]').textContent.includes('réponse fictive')`);
  assert.match(await browser.evaluate(`document.querySelector('[data-testid=gallery-chat-frame]').textContent`), /Que faire jeudi \?/, 'the sent message is in the thread');
  assert.deepEqual(browser.problems, [], 'no console error');
});

test('the fake data answers: the toast shows, the question and the approval are answered, the chat answers a message', { skip, timeout: 120000 }, async () => {
  await open('bases', 'light');
  await browser.evaluate(`[...document.querySelectorAll('[data-testid=specimen-toast] button')].find(b => b.textContent === 'Succès').click()`);
  await browser.until('a toast', `document.querySelector('[data-testid=toast-stack]').textContent.includes('Enregistré')`);
  await browser.evaluate(`document.querySelector('[data-testid=nav-chat]').click()`);
  await browser.until('the question', `document.querySelector('[data-testid=gallery-chat-frame]')?.textContent.includes('Quel jour fait-on le marché ?')`);
  await browser.evaluate(`document.querySelector('[data-testid=gallery-chat-frame] [data-testid=question-option][data-option=Samedi]').click()`);
  await browser.until('answer enabled', `document.querySelector('[data-testid=gallery-chat-frame] [data-testid=question-submit]')?.disabled === false`);
  await browser.evaluate(`document.querySelector('[data-testid=gallery-chat-frame] [data-testid=question-submit]').click()`);
  await browser.until('the approval', `!!document.querySelector('[data-testid=gallery-chat-frame] [data-testid=approval-approve]')`);
  await browser.evaluate(`document.querySelector('[data-testid=gallery-chat-frame] [data-testid=approval-approve]').click()`);
  await browser.until('the end', `document.querySelector('[data-testid=gallery-chat-frame]').textContent.includes('La semaine est prête.')`);
  assert.deepEqual(browser.problems, [], 'no console error');
});
