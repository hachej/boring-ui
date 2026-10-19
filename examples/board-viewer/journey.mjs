// Ported from the canvas spike. Real ArtifactPanel, native tldraw, pointer input and the workspace conditional-write boundary.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { launch, pause } from '@hachej/boring-testing/browser';
import { startBoard } from './server.mjs';

const evidence = resolve('.cache/evidence/feat-board-viewer');
mkdirSync(evidence, { recursive: true });
const report = { steps: [] };
const app = await startBoard();
const target = { resource: { providerId: 'workspace', path: 'mockups/booking.board.json' }, view: { kind: 'published' } };
let browser;
const step = async (name, run) => {
  const item = { name }; report.steps.push(item);
  try { await run(); item.status = 'passed'; console.log(`PASS ${name}`); }
  catch (error) { item.status = 'failed'; item.error = String(error.stack ?? error); throw error; }
};
const ev = body => browser.evaluate(`(async () => { ${body} })()`);
const waitBoard = () => browser.until('four projected frames', `window.__board?.editor?.getCurrentPageShapes().filter(s => s.type === 'board-frame').length === 4`, 30000);
const saved = () => browser.until('board saved', `document.querySelector('[data-testid=board-save]')?.textContent === 'Saved'`, 15000);
const read = async () => {
  const result = await app.files.read({ target, revision: { kind: 'latest' } }, app.person);
  assert.equal(result.kind, 'available');
  return { board: JSON.parse(new TextDecoder().decode(result.snapshot.bytes)), ref: result.snapshot.ref };
};
const rewrite = async change => {
  const before = await read();
  const board = change(before.board);
  const result = await app.files.publication.publish({ operationId: `journey-${Date.now()}`, atomicity: 'all-or-nothing', changes: [{ kind: 'replace', target: before.ref, bytes: new TextEncoder().encode(JSON.stringify(board)), mediaType: 'application/json' }] }, app.person);
  assert.equal(result.kind, 'committed');
};
const history = () => app.files.saves(target.resource.path).length;
const moveNative = async (dy = 60) => ev(`const e = window.__board.editor; const s = e.getCurrentPageShapes().find(s => s.type === 'board-frame'); e.updateShape({ id: s.id, type: s.type, y: s.y + ${dy} }); return true;`);
const mouseDrag = async (from, to) => {
  await browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...from });
  await browser.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...from, button: 'left', buttons: 1, clickCount: 1 });
  for (let i = 1; i <= 10; i++) await browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x + (to.x - from.x) * i / 10, y: from.y + (to.y - from.y) * i / 10, buttons: 1, button: 'left' });
  await browser.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...to, button: 'left', buttons: 0, clickCount: 1 });
};
const snapshotPositions = () => ev(`return window.__board.editor.getCurrentPageShapes().filter(s => s.type === 'board-frame').map(s => [s.id, s.x, s.y]);`);
const theme = async dark => { await ev(`document.documentElement.classList.toggle('dark', ${dark}); return true;`); await pause(200); };
const open = async query => { await browser.send('Page.navigate', { url: `${app.url}?${query}` }); await waitBoard(); await pause(900); };

try {
  browser = await launch(app.url, { evidence });
  await browser.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await step('opening an artifact lazy-loads the canvas and sandboxed frames without an initialization save', async () => {
    await browser.until('page', `!!document.querySelector('[data-testid=open-board]')`);
    assert.equal(await ev(`return [...document.styleSheets].some(s => [...s.cssRules].some(r => r.selectorText === '.tl-container'));`), false);
    const before = history();
    await browser.click(`document.querySelector('[data-testid=open-board]')`);
    await waitBoard(); await pause(1200);
    assert.equal(history(), before);
    const result = await ev(`const e = window.__board.editor; const arrows = e.getCurrentPageShapes().filter(s => s.type === 'arrow'); return { inPanel: !!document.querySelector('[data-testid=artifact-panel] [data-testid=board]'), arrows: arrows.length, bindings: arrows.flatMap(s => e.getBindingsFromShape(s, 'arrow')).length, sandbox: document.querySelector('[data-boring=mockup-viewer] iframe')?.getAttribute('sandbox'), css: getComputedStyle(document.querySelector('.tl-container')).getPropertyValue('--tl-space-1').trim() };`);
    assert.equal(result.inPanel, true); assert.ok(result.arrows > 0); assert.equal(result.bindings, result.arrows * 2);
    assert.equal(result.sandbox, 'allow-scripts'); assert.equal(result.css, '2px');
    await browser.screenshot('desktop-1440-light-board.png');
    await theme(true); await browser.screenshot('desktop-1440-dark-board.png'); await theme(false);
  });
  await step('desktop pointer moves a frame and autosaves board@1, never the native store', async () => {
    const before = await snapshotPositions();
    const point = await ev(`const r = document.querySelector('[data-frame="booking/sessions"]').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 };`);
    await mouseDrag(point, { x: point.x, y: point.y + 70 });
    await pause(1000); await saved();
    const after = await snapshotPositions();
    assert.notDeepEqual(after, before, 'real pointer input must move a frame');
    const { board } = await read();
    assert.equal(board.format, 'board@1'); assert.ok(board.layout['booking/sessions']);
    assert.equal(board.layout['booking/sessions'].y, Math.round(after[0][2]));
    assert.equal(board.store, undefined); assert.equal(board.document, undefined);
    await browser.screenshot('desktop-1440-light-selected.png');
    await theme(true); await browser.screenshot('desktop-1440-dark-selected.png'); await theme(false);
  });
  await step('desktop hand tool pans without moving or saving frames', async () => {
    const before = await snapshotPositions(), count = history();
    const camera = await ev('return window.__board.editor.getCamera();');
    await browser.click(`document.querySelector('[aria-label="Pan board"]')`);
    await mouseDrag({ x: 1000, y: 480 }, { x: 1080, y: 530 });
    await pause(200);
    assert.deepEqual(await snapshotPositions(), before);
    assert.notDeepEqual(await ev('return window.__board.editor.getCamera();'), camera);
    await pause(800); assert.equal(history(), count);
    await browser.click(`document.querySelector('[aria-label="Select frames"]')`);
  });
  await step('a lost acknowledgement is reconciled using the original operation without a second write', async () => {
    const before = history(); app.faults.lose = true;
    await moveNative();
    await browser.until('uncertain save', `document.querySelector('[data-testid=board-save]')?.textContent === 'Save unconfirmed'`);
    assert.equal(history(), before + 1);
    await browser.click(`[...document.querySelectorAll('button')].find(b => b.textContent === 'Check save outcome')`);
    await saved(); assert.equal(history(), before + 1);
  });
  await step('edits during an in-flight save get a later conditional save, not a stale acknowledgement', async () => {
    const before = history(); app.faults.hold = true; app.faults.dispatched = false;
    await moveNative(30);
    for (let i = 0; !app.faults.release && i < 100; i++) await pause(50);
    assert.ok(app.faults.release, 'held a real committed save response');
    await moveNative(40);
    const positions = await snapshotPositions();
    app.faults.release(); app.faults.release = null;
    await pause(1800); await saved();
    assert.equal(history(), before + 2);
    assert.equal((await read()).board.layout['booking/sessions'].y, Math.round(positions[0][2]));
  });
  await step('stale saves retain the local frame and show the shared conflict state until deliberate discard', async () => {
    const count = history();
    await rewrite(board => ({ ...board, title: 'Changed by the fictional PM', layout: { ...board.layout, 'booking/sessions': { x: 50, y: 100 } } }));
    await moveNative(70);
    const local = await snapshotPositions();
    await browser.until('conditional conflict', `!!document.querySelector('[data-testid=board-conflict]')`);
    assert.equal(history(), count + 1, 'stale save wrote nothing');
    assert.deepEqual(await snapshotPositions(), local);
    await moveNative(20); await pause(1000); assert.equal(history(), count + 1, 'typing is not overwrite consent');
    await browser.click(`[...document.querySelectorAll('button')].find(b => b.textContent === 'Discard local changes and reload')`);
    await saved();
    const remote = await snapshotPositions();
    assert.equal(remote[0][1], 50); assert.equal(remote[0][2], 100);
  });
  await step('a clean external rewrite reprojects without an initialization save', async () => {
    const count = history();
    await rewrite(board => ({ ...board, layout: { ...board.layout, 'booking/sessions': { x: 90, y: 110 } } }));
    await browser.until('fresh projection', `window.__board.editor.getCurrentPageShapes().find(s => s.type === 'board-frame')?.x === 90`, 15000);
    await pause(900); assert.equal(history(), count + 1);
  });
  await step('pinned historical board is read-only and cannot publish edits', async () => {
    await open('open=board&pinned');
    const before = await snapshotPositions(), count = history();
    assert.equal(await ev('return window.__board.editor.getIsReadonly();'), true);
    await moveNative();
    assert.deepEqual(await snapshotPositions(), before);
    assert.equal(await ev(`return !!document.querySelector('[aria-label="Add note"]');`), false);
    await pause(800); assert.equal(history(), count);
  });
  await step('phone 390: hand tool, no drawing controls, zoom to first frame, one-finger pan never edits', async () => {
    await browser.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await browser.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await open('open=board');
    const before = await snapshotPositions(), count = history();
    const mode = await ev(`const e = window.__board.editor; const frame = document.querySelector('[data-frame="booking/sessions"]').getBoundingClientRect(); return { readonly: e.getIsReadonly(), tool: e.getCurrentToolId(), drawing: !!document.querySelector('[aria-label="Add note"]'), nativeChrome: !!document.querySelector('.tlui-layout__top'), width: frame.width, sheetTop: document.querySelector('[data-testid=phone-sheet]').getBoundingClientRect().top, scrollWidth: document.documentElement.scrollWidth };`);
    assert.equal(mode.readonly, true); assert.equal(mode.tool, 'hand'); assert.equal(mode.drawing, false); assert.equal(mode.nativeChrome, false);
    assert.ok(mode.width > 200 && mode.width < 390, 'first frame fits the phone'); assert.equal(mode.scrollWidth, 390);
    await browser.screenshot('phone-390-light-board.png');
    const camera = await ev('return window.__board.editor.getCamera();');
    await browser.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 195, y: 450, id: 0 }] });
    for (let i = 1; i <= 10; i++) await browser.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 195 + i * 6, y: 450 + i * 5, id: 0 }] });
    await browser.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await pause(700);
    assert.notDeepEqual(await ev('return window.__board.editor.getCamera();'), camera);
    assert.deepEqual(await snapshotPositions(), before);
    await moveNative(); assert.deepEqual(await snapshotPositions(), before, 'native readonly also refuses frame updates');
    assert.equal(history(), count);
    assert.equal(await ev('return scrollY;'), 0);
    assert.equal(await ev(`return document.querySelector('[data-testid=phone-sheet]').getBoundingClientRect().top;`), mode.sheetTop);
    await ev(`window.__board.editor.setCamera(${JSON.stringify(camera)}); return true;`);
    await theme(true); await browser.screenshot('phone-390-dark-board.png');
  });
  await step('all requested resources stay on the host origin', async () => {
    const resources = await ev("return performance.getEntriesByType('resource').map(r => r.name);");
    assert.deepEqual(resources.filter(url => !url.startsWith(app.url) && !url.startsWith('data:') && !url.startsWith('blob:')), []);
  });
} finally {
  app.faults.release?.();
  if (browser) await browser.close();
  await app.close();
  writeFileSync(resolve(evidence, 'report.json'), JSON.stringify(report, null, 2));
}
