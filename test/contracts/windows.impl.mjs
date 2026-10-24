import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { Window } from 'happy-dom';

const out = resolve('.cache/windows-test'); mkdirSync(out, { recursive: true });
let sequence = 0;
async function fixture(t, { width = 1440, persist = 'session', saved, storageKey = 'fictional.windows', ids = ['notes', 'calculator', 'planning'] } = {}) {
  const outfile = `${out}/windows-${++sequence}.mjs`;
  await build({ entryPoints: ['registry/windows/windows.tsx'], outfile, bundle: true, format: 'esm', platform: 'node', jsx: 'automatic', packages: 'external', alias: { '@': resolve('examples/app-shell') }, logLevel: 'silent' });
  const window = new Window({ url: 'https://fictional.invalid/' });
  const names = ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Text', 'MutationObserver', 'ResizeObserver', 'Event', 'KeyboardEvent', 'MouseEvent', 'PointerEvent', 'FocusEvent', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'IS_REACT_ACT_ENVIRONMENT'];
  const previous = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  for (const name of names) Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: name === 'window' ? window : name === 'IS_REACT_ACT_ENVIRONMENT' ? true : /^(getComputedStyle|requestAnimationFrame|cancelAnimationFrame)$/.test(name) ? window[name].bind(window) : window[name] });
  window.innerWidth = width; window.innerHeight = 900;
  if (saved) for (const [key, value] of Object.entries(saved)) window[persist === 'local' ? 'localStorage' : 'sessionStorage'].setItem(key, value);
  const { createElement: h, act } = await import('react'); const { createRoot } = await import('react-dom/client');
  const { WindowLayer, FloatingWindow, WindowLauncher, useWindow } = await import(pathToFileURL(outfile));
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  const apis = Object.create(null);
  function Controls({ id }) { apis[id] = useWindow(id); return null; }
  const titles = ['Notes', 'Calculatrice', 'Planning'];
  const windows = ids.map((id, index) => ({ id, title: titles[index] }));
  await act(async () => root.render(h(WindowLayer, { storageKey, persist }, h(WindowLauncher, { windows }), ...windows.map(item => h(Controls, { id: item.id, key: `api-${item.id}` })), ...windows.map((item, index) => h(FloatingWindow, { ...item, key: item.id, defaultRect: { x: 60 + index * 70, y: 80 + index * 50, width: 400, height: 300 } }, h('input', { 'aria-label': `${item.id} content` }))))));
  const panel = id => document.querySelector(`[data-window="${id}"]`);
  const click = async selector => { const element = typeof selector === 'string' ? document.querySelector(selector) : selector; assert.ok(element, `Missing ${selector}`); await act(async () => element.click()); };
  const run = async fn => { await act(async () => fn()); };
  const pointer = async (element, type, x, y, extra = {}) => run(() => element.dispatchEvent(new window.PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, button: 0, clientX: x, clientY: y, ...extra })));
  const open = id => run(() => apis[id].open());
  let disposed = false;
  const dispose = async () => { if (disposed) return; disposed = true; await act(async () => root.unmount()); host.remove(); window.close(); for (const [name, descriptor] of previous) descriptor ? Object.defineProperty(globalThis, name, descriptor) : delete globalThis[name]; };
  t.after(dispose);
  return { window, panel, apis, click, run, pointer, open, storageKey, dispose };
}

test('open focuses, pointer or keyboard focus raises, minimize restores and Escape closes only its window', async t => {
  const f = await fixture(t); await f.open('notes');
  assert.ok(f.panel('notes').contains(document.activeElement));
  await f.open('calculator');
  const z = id => Number(f.panel(id).style.zIndex);
  assert.ok(z('calculator') > z('notes'));
  await f.pointer(f.panel('notes'), 'pointerdown', 100, 100); assert.ok(z('notes') > z('calculator'));
  await f.run(() => f.panel('calculator').querySelector('input').focus()); assert.ok(z('calculator') > z('notes'));
  await f.click('[aria-label="Minimize Calculatrice"]'); assert.equal(f.panel('calculator').hidden, true);
  await f.open('calculator'); assert.equal(f.panel('calculator').hidden, false);
  await f.run(() => f.panel('calculator').dispatchEvent(new f.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
  assert.equal(f.apis.calculator.status, 'closed'); assert.equal(f.apis.notes.status, 'open');
  assert.ok(f.panel('notes').contains(document.activeElement));
});

test('drag uses pointer capture, ignores controls and non-primary presses, clamps and ends on cancellation', async t => {
  const f = await fixture(t); await f.open('notes'); const panel = f.panel('notes'), handle = panel.querySelector('[data-window-drag]');
  panel.getBoundingClientRect = () => ({ left: parseFloat(panel.style.left), top: parseFloat(panel.style.top), width: 400, height: 300 });
  let captured; handle.setPointerCapture = id => { captured = id; };
  await f.pointer(handle, 'pointerdown', 80, 100, { button: 2 }); await f.pointer(handle, 'pointermove', 180, 200); assert.equal(panel.style.left, '60px');
  await f.pointer(panel.querySelector('button'), 'pointerdown', 80, 100); await f.pointer(handle, 'pointermove', 180, 200); assert.equal(panel.style.left, '60px');
  await f.pointer(handle, 'pointerdown', 80, 100); assert.equal(captured, 1);
  await f.pointer(handle, 'pointermove', 180, 200); assert.equal(panel.style.left, '160px'); assert.equal(panel.style.top, '180px');
  await f.pointer(handle, 'pointermove', 5000, -100); assert.equal(panel.style.left, '1040px'); assert.equal(panel.style.top, '0px');
  await f.pointer(handle, 'pointercancel', 5000, -100); await f.pointer(handle, 'pointermove', 100, 100); assert.equal(panel.style.left, '1040px');
});

test('resize is pointer and keyboard operable, bounded by the viewport and re-clamped after viewport changes', async t => {
  const f = await fixture(t); await f.open('notes'); const panel = f.panel('notes'), handle = panel.querySelector('[data-window-resize]');
  await f.pointer(handle, 'pointerdown', 460, 380); await f.pointer(handle, 'pointermove', 560, 430); await f.pointer(handle, 'pointerup', 560, 430);
  assert.equal(panel.style.width, '500px'); assert.equal(panel.style.height, '350px');
  await f.run(() => handle.dispatchEvent(new f.window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })));
  assert.equal(panel.style.width, '524px');
  await f.run(() => { f.window.innerWidth = 700; f.window.innerHeight = 400; f.window.dispatchEvent(new f.window.Event('resize')); });
  assert.ok(parseFloat(panel.style.left) + parseFloat(panel.style.width) <= 700); assert.ok(parseFloat(panel.style.top) + parseFloat(panel.style.height) <= 400);
});

test('every edge and corner resizes from the opposite side, keeping the minimum and the viewport', async t => {
  const f = await fixture(t); await f.open('notes'); const panel = f.panel('notes');
  const box = () => ({ x: parseFloat(panel.style.left), y: parseFloat(panel.style.top), w: parseFloat(panel.style.width), h: parseFloat(panel.style.height) });
  const edges = [...panel.querySelectorAll('[data-window-resize]')].map(handle => handle.getAttribute('data-window-resize')).sort();
  assert.deepEqual(edges, ['e', 'n', 'ne', 'nw', 's', 'se', 'sw', 'w']);
  const drag = async (edge, dx, dy) => { const handle = panel.querySelector(`[data-window-resize="${edge}"]`); await f.pointer(handle, 'pointerdown', 300, 300); await f.pointer(handle, 'pointermove', 300 + dx, 300 + dy); await f.pointer(handle, 'pointerup', 300 + dx, 300 + dy); };
  const start = box();
  await drag('w', -40, 0); assert.deepEqual(box(), { ...start, x: start.x - 40, w: start.w + 40 });
  const a = box(); await drag('n', 0, -20); assert.deepEqual(box(), { ...a, y: a.y - 20, h: a.h + 20 });
  const b = box(); await drag('e', 30, 0); assert.deepEqual(box(), { ...b, w: b.w + 30 });
  const c = box(); await drag('s', 0, 25); assert.deepEqual(box(), { ...c, h: c.h + 25 });
  const d = box(); await drag('nw', 10, 10); assert.deepEqual(box(), { x: d.x + 10, y: d.y + 10, w: d.w - 10, h: d.h - 10 });
  const e = box(); await drag('ne', 10, -10); assert.deepEqual(box(), { ...e, y: e.y - 10, w: e.w + 10, h: e.h + 10 });
  const g = box(); await drag('sw', -10, 10); assert.deepEqual(box(), { ...g, x: g.x - 10, w: g.w + 10, h: g.h + 10 });
  // the minimum holds and the opposite edge stays fixed
  const h = box(); await drag('w', 2000, 0); assert.equal(box().w, 240); assert.equal(box().x + box().w, h.x + h.w);
  const i = box(); await drag('n', 0, 2000); assert.equal(box().h, 160); assert.equal(box().y + box().h, i.y + i.h);
  // the viewport bounds it
  await drag('w', -5000, 0); assert.equal(box().x, 0); await drag('n', 0, -5000); assert.equal(box().y, 0);
  await drag('e', 5000, 0); assert.equal(box().x + box().w, 1440); await drag('s', 0, 5000); assert.equal(box().y + box().h, 900);
});

test('session and local persistence restore rectangle and open/minimized status, reject malformed data and isolate keys', async t => {
  for (const persist of ['session', 'local']) {
    const f = await fixture(t, { persist, saved: { 'fictional.windows.notes': JSON.stringify({ status: 'open', rect: { x: 210, y: 120, width: 510, height: 380 } }), 'fictional.windows.calculator': JSON.stringify({ status: 'minimized', rect: { x: 90, y: 100, width: 400, height: 300 } }), 'fictional.windows.planning': '{broken' } });
    assert.equal(f.apis.notes.status, 'open'); assert.equal(f.panel('notes').style.left, '210px'); assert.equal(f.panel('notes').style.width, '510px');
    assert.equal(f.apis.calculator.status, 'minimized'); assert.equal(f.apis.planning.status, 'closed');
    await f.run(() => f.apis.notes.close());
    const storage = f.window[persist === 'local' ? 'localStorage' : 'sessionStorage']; assert.equal(JSON.parse(storage.getItem('fictional.windows.notes')).status, 'closed');
    assert.equal(f.window[persist === 'local' ? 'sessionStorage' : 'localStorage'].getItem('fictional.windows.notes'), null);
    await f.dispose();
  }
});

test('phone windows fill the viewport while preserving desktop rectangles through breakpoint changes', async t => {
  const f = await fixture(t, { width: 390 }); await f.open('notes');
  const phone = f.panel('notes'); assert.equal(phone.getAttribute('data-placement'), 'fullscreen'); assert.equal(parseFloat(phone.style.inset), 0); assert.ok(phone.contains(document.activeElement));
  await f.run(() => { f.window.innerWidth = 641; f.window.dispatchEvent(new f.window.Event('resize')); });
  const desktop = f.panel('notes'); assert.equal(desktop.getAttribute('data-placement'), 'floating'); assert.equal(desktop.style.left, '60px'); assert.equal(desktop.style.width, '400px');
});

test('window ids that match Object prototype names remain independent windows', async t => {
  const f = await fixture(t, { ids: ['__proto__', 'constructor', 'toString'] });
  for (const id of ['__proto__', 'constructor', 'toString']) {
    await f.open(id);
    assert.equal(f.apis[id].status, 'open');
    assert.equal(f.panel(id).hidden, false);
    assert.ok(f.panel(id).contains(document.activeElement));
  }
  await f.run(() => f.apis.constructor.close());
  assert.equal(f.apis.constructor.status, 'closed');
  assert.equal(f.apis.__proto__.status, 'open');
  assert.equal(f.apis.toString.status, 'open');
});

test('launcher lists available windows, indicates open status and focuses an already open window', async t => {
  const f = await fixture(t); await f.click('[data-window-launcher]');
  const items = [...document.querySelectorAll('[role=menuitem]')]; assert.equal(items.length, 3); assert.ok(items[0].textContent.includes('Notes'));
  await f.click(items[0]); assert.equal(f.apis.notes.status, 'open'); assert.ok(f.panel('notes').contains(document.activeElement));
  await f.click('[data-window-launcher]'); assert.ok(document.querySelector('[role=menuitem][data-window-open="true"]'));
  await f.click(document.querySelector('[role=menuitem][data-window-open="true"]')); assert.ok(f.panel('notes').contains(document.activeElement));
  await f.run(() => f.apis.notes.close()); assert.equal(document.activeElement, document.querySelector('[data-window-launcher]'));
});
