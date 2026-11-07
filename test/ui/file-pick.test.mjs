// D-1783: FilePick (registry/file-pick) rendered for real in happy-dom: a Button over a hidden file input, optionally a dashed drop strip.
// Fictional file names only. Booleans and strings are compared, never elements.
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync } from 'node:fs';
import { build } from 'esbuild';
import { Window } from 'happy-dom';

const mount = async (t, initial) => {
  const window = new Window({ url: 'https://fictional.invalid/' });
  const names = ['window', 'document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'Element', 'Node', 'Text', 'MutationObserver', 'ResizeObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'matchMedia', 'KeyboardEvent', 'Event', 'File', 'IS_REACT_ACT_ENVIRONMENT'];
  const globals = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  for (const name of names) {
    const given = name === 'window' ? window : name === 'IS_REACT_ACT_ENVIRONMENT' ? true : window[name];
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: typeof given === 'function' && /^[a-z]/.test(name) ? given.bind(window) : given });
  }
  const { createElement, act } = await import('react'); const { createRoot } = await import('react-dom/client');
  const out = new URL('../../.cache/file-pick-test/', import.meta.url); mkdirSync(out, { recursive: true });
  const output = new URL('file-pick.mjs', out);
  await build({ stdin: { contents: `export { FilePick } from './file-pick/file-pick.tsx';`, resolveDir: new URL('../../registry/', import.meta.url).pathname, loader: 'tsx' }, outfile: output.pathname, bundle: true, format: 'esm', platform: 'node', jsx: 'automatic', packages: 'external' });
  const { FilePick } = await import(output.href);
  const element = document.createElement('div'); document.body.append(element); const root = createRoot(element);
  t.after(async () => {
    await act(async () => root.unmount()); await window.happyDOM.close();
    for (const [name, descriptor] of globals) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; }
  });
  const got = { files: [], refused: [] };
  const draw = async props => { await act(async () => root.render(createElement(FilePick, { onFiles: f => got.files.push(f.map(x => x.name)), onRefused: r => got.refused.push(r.map(x => `${x.file.name}:${x.reason}`)), children: 'Choose a file', ...props }))); };
  await draw(initial);
  const input = () => element.querySelector('[data-testid=file-pick-input]');
  const button = () => element.querySelector('button');
  const strip = () => element.querySelector('[data-boring=file-pick-drop]');
  const file = (name, type, size = 10) => { const f = new window.File(['x'.repeat(size)], name, { type }); return f; };
  const pick = async files => {
    // happy-dom's input.files is read-only; stand in a list, as a browser fills it, then fire change.
    Object.defineProperty(input(), 'files', { configurable: true, get: () => files });
    let valueSet = null;
    Object.defineProperty(input(), 'value', { configurable: true, get: () => '', set: v => { valueSet = v; } });
    await act(async () => { input().dispatchEvent(new window.Event('change', { bubbles: true })); });
    return valueSet;
  };
  const drag = async (type, files = [], items) => {
    const event = new window.Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'dataTransfer', { value: { types: ['Files'], files, items } });
    await act(async () => { strip().dispatchEvent(event); });
    return event.defaultPrevented;
  };
  return { got, draw, input, button, strip, file, pick, drag, act, window, element };
};

test('a pick delivers the files and resets the input so the same file can be picked twice', async t => {
  const ui = await mount(t, { multiple: true });
  const a = ui.file('bilan-fictif.pdf', 'application/pdf');
  assert.equal(await ui.pick([a]), '');
  await ui.pick([a]);
  assert.equal(JSON.stringify(ui.got.files), JSON.stringify([['bilan-fictif.pdf'], ['bilan-fictif.pdf']]));
});

test('accept and maxSize refuse with a reason code and the accepted files still arrive', async t => {
  const ui = await mount(t, { multiple: true, accept: 'image/*,.pdf', maxSize: 100 });
  await ui.pick([ui.file('a.png', 'image/png'), ui.file('b.PDF', ''), ui.file('c.csv', 'text/csv'), ui.file('d.png', 'image/png', 500)]);
  assert.equal(JSON.stringify(ui.got.files), JSON.stringify([['a.png', 'b.PDF']]));
  assert.equal(JSON.stringify(ui.got.refused), JSON.stringify([['c.csv:type', 'd.png:size']]));
});

test('without multiple only the first accepted file is delivered, the rest are refused as count', async t => {
  const ui = await mount(t, { drop: true });
  await ui.drag('drop', [ui.file('one.txt', 'text/plain'), ui.file('two.txt', 'text/plain')]);
  assert.equal(JSON.stringify(ui.got.files), JSON.stringify([['one.txt']]));
  assert.equal(JSON.stringify(ui.got.refused), JSON.stringify([['two.txt:count']]));
});

test('a drop delivers and refuses like a pick, and the drop is taken over by the app (default prevented)', async t => {
  const ui = await mount(t, { drop: true, multiple: true, accept: '.csv', maxSize: 50 });
  const prevented = await ui.drag('drop', [ui.file('ok.csv', 'text/csv'), ui.file('big.csv', 'text/csv', 80), ui.file('no.png', 'image/png')]);
  assert.equal(prevented, true);
  assert.equal(JSON.stringify(ui.got.files), JSON.stringify([['ok.csv']]));
  assert.equal(JSON.stringify(ui.got.refused), JSON.stringify([['big.csv:size', 'no.png:type']]));
});

test('drag over turns the strip state on, leaving or dropping turns it off', async t => {
  const ui = await mount(t, { drop: true });
  const state = () => ui.strip().getAttribute('data-drag-over');
  assert.equal(state(), 'false');
  await ui.drag('dragenter'); assert.equal(state(), 'true');
  await ui.drag('dragleave'); assert.equal(state(), 'false');
  await ui.drag('dragover'); assert.equal(state(), 'true');
  await ui.drag('drop', [ui.file('x.txt', 'text/plain')]); assert.equal(state(), 'false');
});

test('disabled and busy refuse picks and drops; busy shows the spinner and aria-busy', async t => {
  const ui = await mount(t, { drop: true, disabled: true });
  await ui.pick([ui.file('a.txt', 'text/plain')]);
  await ui.drag('drop', [ui.file('b.txt', 'text/plain')]);
  await ui.drag('dragenter');
  assert.equal(ui.strip().getAttribute('data-drag-over'), 'false');
  assert.equal(ui.button().disabled, true);
  await ui.draw({ drop: true, busy: true });
  await ui.pick([ui.file('c.txt', 'text/plain')]);
  await ui.drag('drop', [ui.file('d.txt', 'text/plain')]);
  assert.equal(ui.got.files.length + ui.got.refused.length, 0);
  assert.equal(ui.button().getAttribute('aria-busy'), 'true');
  assert.equal(ui.strip().getAttribute('aria-busy'), 'true');
  assert.equal(ui.button().querySelector('[data-slot=spinner]') !== null, true);
  await ui.draw({ drop: true });
  assert.equal(ui.button().querySelector('[data-slot=spinner]') === null, true);
  assert.equal(ui.button().hasAttribute('aria-busy'), false);
});

test('the Button is the accessible control named by its label; the input is hidden from focus and the tree', async t => {
  const ui = await mount(t, { variant: 'outline', size: 'sm', hint: 'ou déposez ici' });
  assert.equal(ui.button().textContent, 'Choose a file');
  assert.equal(ui.button().getAttribute('type'), 'button');
  assert.equal(ui.input().getAttribute('aria-hidden'), 'true');
  assert.equal(ui.input().getAttribute('tabindex'), '-1');
  assert.equal(ui.element.querySelectorAll('button').length, 1);
  await ui.draw({ drop: true, hint: 'ou déposez ici' });
  assert.equal(ui.element.textContent.includes('ou déposez ici'), true);
  await ui.draw({ drop: true, multiple: true });
  assert.equal(ui.element.textContent.includes('or drop files here'), true);
});

test('a click on the Button opens the picker (the input is clicked), and not while busy', async t => {
  const ui = await mount(t, {});
  let clicks = 0;
  ui.input().click = () => { clicks += 1; };
  // Only the click is driven here; a native button turns Enter and Space into that click, which this test does not exercise.
  await ui.act(async () => { ui.button().click(); });
  assert.equal(clicks, 1);
  await ui.draw({ busy: true });
  await ui.act(async () => { ui.button().click(); });
  assert.equal(clicks, 1);
});

test('busy keeps the Button enabled-looking (aria-disabled, no disabled attribute) and ignores the click; disabled sets the attribute', async t => {
  const ui = await mount(t, { busy: true });
  let clicks = 0;
  ui.input().click = () => { clicks += 1; };
  assert.equal(ui.button().hasAttribute('disabled'), false);
  assert.equal(ui.button().getAttribute('aria-disabled'), 'true');
  assert.equal(ui.input().disabled, true);
  await ui.act(async () => { ui.button().click(); });
  await ui.pick([ui.file('a.txt', 'text/plain')]);
  assert.equal(clicks, 0);
  assert.equal(ui.got.files.length + ui.got.refused.length, 0);
  await ui.draw({ disabled: true });
  assert.equal(ui.button().hasAttribute('disabled'), true);
  assert.equal(ui.button().hasAttribute('aria-disabled'), false);
  assert.equal(ui.input().disabled, true);
  await ui.draw({});
  assert.equal(ui.button().hasAttribute('disabled') || ui.button().hasAttribute('aria-disabled'), false);
});

test('a dropped folder is skipped, not delivered and not refused; the files dropped with it arrive', async t => {
  const ui = await mount(t, { drop: true, multiple: true });
  const folder = ui.file('Photos', ''); const doc = ui.file('a.txt', 'text/plain');
  const items = [{ kind: 'file', webkitGetAsEntry: () => ({ isDirectory: true }) }, { kind: 'file', webkitGetAsEntry: () => ({ isDirectory: false }) }];
  await ui.drag('drop', [folder, doc], items);
  assert.deepEqual(ui.got.files, [['a.txt']]);
  assert.equal(ui.got.refused.length, 0);
  await ui.drag('drop', [folder], [items[0]]);
  assert.equal(ui.got.files.length, 1);
  assert.equal(ui.got.refused.length, 0);
});

test('the drag-over highlight clears when the component turns busy or disabled', async t => {
  const ui = await mount(t, { drop: true });
  await ui.drag('dragenter');
  assert.equal(ui.strip().getAttribute('data-drag-over'), 'true');
  await ui.draw({ drop: true, busy: true });
  assert.equal(ui.strip().getAttribute('data-drag-over'), 'false');
  await ui.draw({ drop: true });
  assert.equal(ui.strip().getAttribute('data-drag-over'), 'false');
  await ui.drag('dragenter');
  await ui.draw({ drop: true, disabled: true });
  assert.equal(ui.strip().getAttribute('data-drag-over'), 'false');
});
