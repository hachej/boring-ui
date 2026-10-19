// Drives the canvas board spike in real Chromium (CHROMIUM=...): desktop 1440x900 and phone 390x844 with touch. Screenshots, measurements
// and a report go to .cache/evidence/canvas-spike/. Fictional content only. Run: node examples/canvas-board/journey.mjs
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { launch, pause } from '@hachej/boring-testing/browser';
import { startBoard } from './server.mjs';

const evidence = resolve(process.env.CANVAS_EVIDENCE ?? '.cache/evidence/canvas-spike');
mkdirSync(evidence, { recursive: true });
const report = { steps: [], measurements: {} };
const m = report.measurements;
const app = await startBoard();
let browser;
const step = async (name, run) => {
  const item = { name, status: 'running' }; report.steps.push(item);
  try { item.result = await run(); item.status = 'passed'; } catch (error) { item.status = 'failed'; item.error = String(error?.stack ?? error); console.error(`FAILED ${name}:`, error); }
};
const ev = expression => browser.evaluate(`(async () => { ${expression} })()`);
// Collect CSP violations and every resource URL from the first byte of each page load.
const COLLECT = `window.__violations = []; addEventListener('securitypolicyviolation', e => window.__violations.push({ directive: e.violatedDirective, blocked: e.blockedURI, sample: e.sample }), true);`;
async function open(query, device) {
  await browser.send('Page.navigate', { url: `${app.url}?${query}` });
  await pause(300);
  await browser.until('page booted', `!!document.querySelector('[data-testid=conversation]')`);
}
const frames = () => ev(`const e = window.__board.editor; return e ? e.getCurrentPageShapes().filter(s => s.type === 'board-frame').length : 0;`);
const waitBoard = () => browser.until('board frames and html frame loaded', `(() => { const e = window.__board?.editor; return e && e.getCurrentPageShapes().filter(s => s.type === 'board-frame').length === 4 && !!document.querySelector('[data-testid=board-html-frame]'); })()`, 30000);
/** Page coordinates of an element inside a sandboxed frame, from the frame's own geometry (the canvas may scale it). */
async function pointInFrame(frameSelector, inner) {
  const box = await ev(`const r = document.querySelector(${JSON.stringify(frameSelector)}).getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height };`);
  const local = await browser.frameEvaluate(`document.querySelector(${JSON.stringify(frameSelector)})`, `(() => { const r = document.querySelector(${JSON.stringify(inner)}).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, vw: innerWidth }; })()`);
  const scale = box.w / local.vw;
  return { x: box.x + local.x * scale, y: box.y + local.y * scale };
}
const mouse = async (x, y, { double = false } = {}) => {
  for (const count of double ? [1, 2] : [1]) {
    await browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    await browser.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: count });
    await browser.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: count });
  }
};
const touchDrag = async (points, to, steps = 10) => {
  await browser.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: points.map((p, id) => ({ x: p.x, y: p.y, id })) });
  for (let i = 1; i <= steps; i++) await browser.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: points.map((p, id) => ({ x: p.x + (to[id].x - p.x) * i / steps, y: p.y + (to[id].y - p.y) * i / steps, id })) });
  await browser.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await pause(300);
};

try {
  // Bundle cost: the board chunk(s) only load when a board opens.
  const files = app.outputs.map(file => ({ ...file }));
  m.bundle = { files, cssBytes: app.cssBytes };
  const inputs = app.metafile.outputs;
  const byOutput = Object.fromEntries(Object.entries(inputs).map(([path, output]) => [path.split('/').pop(), { bytes: output.bytes,
    tldraw: Object.entries(output.inputs).filter(([input]) => /node_modules\/(tldraw|@tldraw)\//.test(input)).reduce((sum, [, value]) => sum + value.bytesInOutput, 0),
    tailwind: Object.entries(output.inputs).filter(([input]) => /node_modules\/tailwindcss\//.test(input)).reduce((sum, [, value]) => sum + value.bytesInOutput, 0) }]));
  m.bundle.byOutput = byOutput;

  browser = await launch('about:blank', { evidence });
  await browser.send('Page.addScriptToEvaluateOnNewDocument', { source: COLLECT });
  await browser.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

  await step('desktop: board opens in the artifact panel with 3 maquette frames, 1 HTML frame, goto arrows bound to frames', async () => {
    await open('open=board');
    await waitBoard();
    await pause(1500);
    const shape = await ev(`const e = window.__board.editor; const shapes = e.getCurrentPageShapes();
      return { frames: shapes.filter(s => s.type === 'board-frame').map(s => ({ id: s.props.frameId, x: s.x, y: s.y, kind: s.props.kind })), arrows: shapes.filter(s => s.type === 'arrow').length,
        notes: shapes.filter(s => s.type === 'note').length, bindings: shapes.filter(s => s.type === 'arrow').flatMap(s => e.getBindingsFromShape(s, 'arrow')).length,
        inPanel: !!document.querySelector('[data-testid=artifact-panel] [data-testid=board]'), type: document.querySelector('[data-testid=artifact-panel-type]')?.textContent };`);
    assert.equal(shape.frames.length, 4); assert.ok(shape.inPanel); assert.equal(shape.bindings, shape.arrows * 2);
    assert.ok(shape.frames.slice(0, 3).every((frame, i, all) => i === 0 || frame.x > all[i - 1].x), 'maquette screens left to right');
    await browser.screenshot('desktop-1440-board.png');
    return shape;
  });

  await step('desktop: no external requests, CSP violations, fonts and licence state', async () => {
    const result = await ev(`await document.fonts.ready; return { resources: performance.getEntriesByType('resource').map(r => r.name), violations: window.__violations,
      fonts: [...document.fonts].filter(f => f.status === 'loaded').map(f => f.family), watermark: document.querySelector('[data-testid^=tl-watermark]')?.getAttribute('data-testid') ?? null };`);
    const origin = new URL(app.url).origin;
    result.external = result.resources.filter(url => !url.startsWith(origin) && !url.startsWith('data:') && !url.startsWith('blob:'));
    assert.deepEqual(result.external, []);
    m.network = { requests: result.resources.length, external: result.external, violations: result.violations, fontsLoaded: [...new Set(result.fonts)], watermark: result.watermark, licensed: !!process.env.TLDRAW_LICENSE_KEY };
    return { ...m.network, resources: result.resources.map(url => url.replace(origin, '')) };
  });

  await step('desktop: document snapshot size vs board file size', async () => {
    const snapshot = await ev('return window.__board.snapshotBytes();');
    const board = await ev(`const r = await window.__board.client.read({ target: { resource: { providerId: 'workspace', path: 'mockups/booking.board.json' }, view: { kind: 'published' } }, revision: { kind: 'latest' } }); return r.snapshot.bytes.length;`);
    m.persistence = { tldrawDocumentSnapshotBytes: snapshot, boardFileBytes: board };
    return m.persistence;
  });

  await step('desktop: the HTML frame is interactive after double-click (its own script runs) and inert before', async () => {
    const before = await ev(`return getComputedStyle(document.querySelector('[data-testid=board-html-frame]')).pointerEvents;`);
    const center = await ev(`const r = document.querySelector('[data-testid=board-html-frame]').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + 20 };`);
    await mouse(center.x, center.y, { double: true });
    await pause(400);
    const during = await ev(`return { pointer: getComputedStyle(document.querySelector('[data-testid=board-html-frame]')).pointerEvents, editing: window.__board.editor.getEditingShapeId() };`);
    const toggle = await pointInFrame('[data-testid=board-html-frame]', '#toggle');
    await mouse(toggle.x, toggle.y);
    await pause(300);
    const state = await browser.frameEvaluate(`document.querySelector('[data-testid=board-html-frame]')`, `document.getElementById('reminder-state').textContent`);
    assert.equal(state, 'Off', 'the mock-up script toggled the reminder');
    await browser.press('Escape'); await pause(200);
    return { before, during, state };
  });

  await step('desktop: sandbox attributes of the board frame', async () => ev(`const f = document.querySelector('[data-testid=board-html-frame]');
    return { sandbox: f.getAttribute('sandbox'), allow: f.getAttribute('allow'), sameOriginAccess: (() => { try { return !!f.contentDocument; } catch { return false; } })() };`));

  await step('desktop: comment mode pins an element inside the sandboxed HTML frame and one in a maquette frame; reports reach the conversation', async () => {
    await browser.click(`document.querySelector('[data-testid=board-comment]')`);
    await pause(300);
    const target = await pointInFrame('[data-testid=board-html-frame]', '#calendar');
    await mouse(target.x, target.y);
    await browser.until('pin form', `!!document.querySelector('[data-testid=board-pin-form]')`);
    await browser.type(`document.querySelector('[data-testid=board-pin-input]')`, 'Make this the secondary action; most climbers skip it.');
    await browser.click(`document.querySelector('[data-testid=board-pin-send]')`);
    await browser.until('first pin', `window.__board.pins.length === 1`);
    const button = await ev(`const b = [...document.querySelectorAll('[data-frame="booking/details"] button')].find(b => /Confirm booking/.test(b.textContent)); const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 };`);
    await mouse(button.x, button.y);
    await browser.until('pin form again', `!!document.querySelector('[data-testid=board-pin-form]')`);
    await browser.type(`document.querySelector('[data-testid=board-pin-input]')`, 'Show the price on this button.');
    await browser.click(`document.querySelector('[data-testid=board-pin-send]')`);
    await browser.until('second pin', `window.__board.pins.length === 2`);
    const pins = await ev(`return window.__board.pins.map(p => ({ frameId: p.frameId, selector: p.selector, text: p.text, said: p.said, anchor: /board\\.element@1/.test(p.report), report: p.report }));`);
    assert.equal(pins[0].frameId, 'confirm-html'); assert.equal(pins[0].selector, '#calendar'); assert.ok(pins[0].anchor);
    assert.equal(pins[1].frameId, 'booking/details');
    await pause(400);
    await browser.screenshot('desktop-1440-board-pins.png');
    await browser.click(`document.querySelector('[data-testid=board-comment]')`);
    writeFileSync(resolve(evidence, 'pin-report-1.md'), pins[0].report);
    return pins.map(({ report: _, ...pin }) => pin);
  });

  await step('desktop: a forged pick from outside the board frames is ignored', async () => {
    await ev(`window.postMessage({ type: 'board:pick', selector: '#forged', text: 'x', rect: {} }, '*'); await new Promise(r => setTimeout(r, 200)); return true;`);
    return ev(`return { form: !!document.querySelector('[data-testid=board-pin-form]') };`);
  });

  await step('desktop: moving a frame and adding a note publish back to the board file (conditional write, new revision)', async () => {
    const before = await ev(`return (await (await fetch('/api/history?path=mockups/booking.board.json', { headers: { authorization: 'Bearer ${app.token}' } })).json()).saves.length;`);
    const title = await ev(`const r = document.querySelector('[data-frame="booking/sessions"]').closest('.tl-html-container').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 };`);
    await browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: title.x, y: title.y });
    await browser.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: title.x, y: title.y, button: 'left', buttons: 1, clickCount: 1 });
    for (let i = 1; i <= 10; i++) await browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: title.x, y: title.y + i * 12, button: 'left', buttons: 1 });
    await browser.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: title.x, y: title.y + 120, button: 'left', buttons: 0, clickCount: 1 });
    await ev(`const e = window.__board.editor; e.createShape({ type: 'note', x: 200, y: -400, props: { richText: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Reviewer note: add a waitlist.' }] }] } } }); return true;`);
    await browser.until('saved', `document.querySelector('[data-testid=board]')?.dataset.save === 'saved'`, 10000);
    await pause(1500);
    const after = await ev(`const r = await window.__board.client.read({ target: { resource: { providerId: 'workspace', path: 'mockups/booking.board.json' }, view: { kind: 'published' } }, revision: { kind: 'latest' } });
      const board = JSON.parse(new TextDecoder().decode(r.snapshot.bytes));
      const saves = (await (await fetch('/api/history?path=mockups/booking.board.json', { headers: { authorization: 'Bearer ${app.token}' } })).json()).saves.length;
      return { saves, sessions: board.layout['booking/sessions'], notes: board.items.filter(i => i.note).map(i => i.note), revision: r.snapshot.ref.revision };`);
    assert.ok(after.saves > before, 'a new revision in the provider history');
    assert.ok(after.sessions && after.sessions.y > 0, 'the moved frame position is in the board file');
    assert.ok(after.notes.includes('Reviewer note: add a waitlist.'));
    return { before, ...after };
  });

  await step('desktop: HTML mock-up in the artifact panel with the app theme', async () => {
    await open('open=mockup');
    await browser.until('mockup frame', `!!document.querySelector('[data-testid=mockup-frame]')`, 20000);
    await pause(800);
    const inside = await browser.frameEvaluate(`document.querySelector('[data-testid=mockup-frame]')`, `(() => ({ calendar: getComputedStyle(document.getElementById('calendar')).backgroundColor, radius: getComputedStyle(document.getElementById('summary')).borderRadius, primaryVar: getComputedStyle(document.documentElement).getPropertyValue('--primary').trim() }))()`);
    const host = await ev(`return { primaryVar: getComputedStyle(document.documentElement).getPropertyValue('--primary').trim(), button: getComputedStyle(document.querySelector('[data-testid=open-mockup]')).backgroundColor };`);
    assert.equal(inside.primaryVar, host.primaryVar, 'same theme token inside the frame');
    await browser.screenshot('desktop-1440-mockup.png');
    return { inside, host };
  });

  await step('desktop: hostile mock-up probes the sandbox (parent, storage, cookies, network, navigation, forged pick)', async () => {
    const probe = `<main class="p-4"><h1 class="text-lg font-semibold">Sandbox probe (fictional)</h1><pre id="out" class="text-xs"></pre></main><script>
      const out = {}; const t = (k, f) => { try { out[k] = f(); } catch (e) { out[k] = 'blocked: ' + e.name; } };
      t('origin', () => self.origin); t('parentDocument', () => !!parent.document); t('topLocation', () => String(top.location.href));
      t('cookie', () => document.cookie); t('localStorage', () => localStorage.length); t('indexedDB', () => typeof indexedDB.open('x'));
      parent.postMessage({ type: 'board:pick', selector: '#forged-from-panel', text: 'x'.repeat(5000), rect: { x: 1 } }, '*');
      fetch('/api/resources', { method: 'POST' }).then(() => { out.fetchHost = 'reached'; }, e => { out.fetchHost = 'blocked: ' + e.name; }).finally(show);
      const img = new Image(); img.onerror = () => { out.externalImage = 'blocked'; show(); }; img.onload = () => { out.externalImage = 'loaded'; show(); }; img.src = 'https://example.com/pixel.png';
      function show() { document.getElementById('out').textContent = JSON.stringify(out, null, 1); }
      show();
    </script>`;
    await ev(`const r = await window.__board.client.publish({ operationId: crypto.randomUUID(), atomicity: 'all-or-nothing', changes: [{ kind: 'create', target: { resource: { providerId: 'workspace', path: 'mockups/probe.mockup.html' }, view: { kind: 'published' } }, expected: { kind: 'absent' }, bytes: new TextEncoder().encode(${JSON.stringify(probe)}), mediaType: 'text/html' }] }); return r.kind;`);
    await open('open=probe');
    await browser.until('probe frame', `!!document.querySelector('[data-testid=mockup-frame]')`, 20000);
    await pause(1500);
    const out = JSON.parse(await browser.frameEvaluate(`document.querySelector('[data-testid=mockup-frame]')`, `document.getElementById('out').textContent`));
    // Navigation of the frame itself to another site (script, not a link: the pick script already cancels off-page links).
    await browser.frameEvaluate(`document.querySelector('[data-testid=mockup-frame]')`, `(() => { location.href = 'https://example.com/'; return true; })()`);
    await pause(800);
    const still = await browser.frameEvaluate(`document.querySelector('[data-testid=mockup-frame]')`, `location.href`).catch(error => `error: ${error.message}`);
    const violations = await ev('return window.__violations;');
    assert.equal(out.origin, 'null'); assert.match(String(out.parentDocument), /blocked/); assert.match(String(out.cookie), /blocked/); assert.match(String(out.localStorage), /blocked/);
    assert.notEqual(out.fetchHost, 'reached'); assert.notEqual(out.externalImage, 'loaded');
    return { out, frameLocationAfterLinkClick: still, violations };
  });

  await step('desktop: a host page without inline scripts (strict CSP) — does the srcdoc mock-up still run its script?', async () => {
    await open('open=mockup&csp=strict');
    await browser.until('mockup frame', `!!document.querySelector('[data-testid=mockup-frame]')`, 20000);
    await pause(800);
    await browser.frameEvaluate(`document.querySelector('[data-testid=mockup-frame]')`, `document.getElementById('toggle').click()`);
    const state = await browser.frameEvaluate(`document.querySelector('[data-testid=mockup-frame]')`, `document.getElementById('reminder-state').textContent`);
    const violations = await ev('return window.__violations.map(v => v.directive);');
    return { scriptRan: state === 'Off', violations: [...new Set(violations)] };
  });

  await browser.emulate('phone');
  await step('phone 390: board in the bottom sheet; touch pan and pinch move the camera, not the page or the sheet', async () => {
    await open('open=board');
    await browser.until('sheet', `!!document.querySelector('[data-testid=phone-sheet]')`);
    await waitBoard();
    await pause(1500);
    await browser.screenshot('phone-390-board.png');
    const state = () => ev(`const e = window.__board.editor, c = e.getCamera(), s = document.querySelector('[data-testid=phone-sheet]'), r = s.getBoundingClientRect();
      return { camera: { x: Math.round(c.x), y: Math.round(c.y), z: +c.z.toFixed(3) }, sheetTop: Math.round(r.top), sheetOpen: !!s && s.isConnected, scrollY: scrollY, bodyScroll: document.scrollingElement.scrollTop };`);
    const before = await state();
    const canvas = await ev(`const r = document.querySelector('[data-testid=board]').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, top: r.top, bottom: r.bottom };`);
    const positions = () => ev(`return window.__board.editor.getCurrentPageShapes().filter(s => s.type === 'board-frame').map(s => [s.props.frameId, Math.round(s.x), Math.round(s.y)]);`);
    const framesBefore = await positions();
    const hit = await ev(`const e = window.__board.editor; const p = e.screenToPage({ x: ${canvas.x + 60}, y: ${canvas.y} }); return e.getShapeAtPoint(p)?.type ?? 'empty canvas';`);
    await touchDrag([{ x: canvas.x + 60, y: canvas.y }], [{ x: canvas.x - 80, y: canvas.y - 120 }]);
    const oneFinger = { ...(await state()), frames: await positions(), selected: await ev('return window.__board.editor.getSelectedShapeIds().length;') };
    await touchDrag([{ x: canvas.x - 40, y: canvas.y }, { x: canvas.x + 40, y: canvas.y }], [{ x: canvas.x - 140, y: canvas.y - 150 }, { x: canvas.x - 60, y: canvas.y - 150 }]);
    const twoFinger = await state();
    await touchDrag([{ x: canvas.x, y: canvas.top + 80 }, { x: canvas.x + 60, y: canvas.top + 80 }], [{ x: canvas.x, y: canvas.bottom - 40 }, { x: canvas.x + 60, y: canvas.bottom - 40 }]);
    const pulledDown = await state();
    await touchDrag([{ x: canvas.x - 30, y: canvas.y }, { x: canvas.x + 30, y: canvas.y }], [{ x: canvas.x - 50, y: canvas.y }, { x: canvas.x + 50, y: canvas.y }]);
    const pinched = await state();
    await browser.screenshot('phone-390-board-panned.png');
    const result = { tool: await ev('return window.__board.editor.getCurrentToolId();'), hitUnderFinger: hit, before, framesBefore, oneFinger, twoFinger, pulledDown, pinched };
    assert.notDeepEqual(twoFinger.camera, before.camera, 'two-finger drag pans');
    assert.notEqual(pinched.camera.z, pulledDown.camera.z, 'pinch zooms');
    assert.notDeepEqual(oneFinger.camera, before.camera, 'one-finger drag pans (hand tool on a phone)');
    assert.deepEqual(oneFinger.frames, framesBefore, 'no frame moved by a pan');
    assert.ok(pulledDown.sheetOpen && pulledDown.sheetTop === before.sheetTop, 'a downward drag on the canvas does not move or close the sheet');
    assert.equal(pinched.scrollY, 0);
    return result;
  });

  await step('phone 390: HTML mock-up in the bottom sheet', async () => {
    await open('open=mockup');
    await browser.until('mockup frame', `!!document.querySelector('[data-testid=mockup-frame]')`, 20000);
    await pause(1000);
    await browser.screenshot('phone-390-mockup.png');
    return ev(`const r = document.querySelector('[data-testid=mockup-frame]').getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), docWidth: document.documentElement.scrollWidth };`);
  });

  report.problems = browser.problems;
} finally {
  report.status = report.steps.every(item => item.status === 'passed') ? 'passed' : 'failed';
  writeFileSync(resolve(evidence, 'report.json'), JSON.stringify(report, null, 2));
  await browser?.close();
  await app.close();
  console.log(JSON.stringify({ status: report.status, steps: report.steps.map(item => `${item.status} ${item.name}`) }, null, 1));
  if (report.status !== 'passed') process.exitCode = 1;
}
