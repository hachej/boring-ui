import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, readFileSync } from 'node:fs';
import { build } from 'esbuild';
import { Window } from 'happy-dom';

async function mount(t) {
  const window = new Window({ url: 'https://fictional.invalid/' });
  const names = ['window', 'document', 'navigator', 'HTMLElement', 'HTMLButtonElement', 'HTMLTextAreaElement', 'Element', 'Node', 'Text', 'MutationObserver', 'requestAnimationFrame', 'cancelAnimationFrame', 'getComputedStyle', 'KeyboardEvent', 'MouseEvent', 'PointerEvent', 'ResizeObserver', 'IS_REACT_ACT_ENVIRONMENT'];
  const saved = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  for (const name of names) {
    const value = name === 'window' ? window : name === 'IS_REACT_ACT_ENVIRONMENT' ? true : window[name];
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: typeof value === 'function' && /^[a-z]/.test(name) ? value.bind(window) : value });
  }
  const directory = new URL('../../.cache/viewer-chrome-test/', import.meta.url); mkdirSync(directory, { recursive: true });
  const before = process.env.BEFORE_VIEWER_SOURCE;
  const output = new URL(before ? 'before.mjs' : 'after.mjs', directory);
  await build({ stdin: { contents: "export { ViewerToggle, ViewerFrame } from './registry/viewers/viewer-frame'; export { editorControls } from './registry/button/editor-controls';", resolveDir: new URL('../../', import.meta.url).pathname, loader: 'tsx' }, outfile: output.pathname, bundle: true, format: 'esm', platform: 'node', jsx: 'automatic', packages: 'external', logLevel: 'silent',
    plugins: before ? [{ name: 'pre-migration-viewer', setup(builder) { builder.onLoad({ filter: /registry\/viewers\/viewer-frame\.tsx$/ }, () => ({ contents: readFileSync(before, 'utf8'), loader: 'tsx', resolveDir: new URL('../../registry/viewers/', import.meta.url).pathname })); } }] : [] });
  const components = await import(output.href);
  const { createElement: h, act } = await import('react');
  const { createRoot } = await import('react-dom/client');
  const container = window.document.createElement('div'); window.document.body.append(container);
  const root = createRoot(container);
  t.after(async () => { await act(async () => root.unmount()); await window.happyDOM.close(); for (const [name, descriptor] of saved) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; } });
  return { ...components, h, act, window, q: selector => window.document.querySelector(selector), render: node => act(async () => root.render(node)), click: node => act(async () => node.click()) };
}

test('viewer modes use the host ToggleGroup, keep one selection and refuse disabled choices', async t => {
  const ui = await mount(t); const events = [];
  const options = [{ id: 'rich', label: 'Rich text', text: 'Rich', testId: 'rich' }, { id: 'source', label: 'Markdown source', text: 'Source', testId: 'source' }, { id: 'unavailable', label: 'Unavailable', text: 'Unavailable', disabled: true, testId: 'unavailable' }];
  const render = value => ui.render(ui.h(ui.ViewerToggle, { label: 'Editor mode', value, options, onChange: id => events.push(id) }));
  await render('rich');
  assert.equal(ui.q('[aria-label="Editor mode"]').dataset.slot, 'toggle-group');
  assert.equal(ui.q('[data-testid=rich]').dataset.slot, 'toggle-group-item');
  assert.equal(ui.q('[data-testid=rich]').getAttribute('aria-pressed'), 'true');
  await ui.click(ui.q('[data-testid=rich]'));
  assert.deepEqual(events, [], 'clicking the current mode cannot clear the selection');
  await ui.click(ui.q('[data-testid=source]'));
  assert.deepEqual(events, ['source']);
  await render('source');
  assert.equal(ui.q('[data-testid=source]').getAttribute('aria-pressed'), 'true');
  await ui.click(ui.q('[data-testid=unavailable]'));
  assert.deepEqual(events, ['source']);
});

test('editor action binding preserves native button types and controlled pressed state', async t => {
  const ui = await mount(t); const events = [];
  await ui.render(ui.h(ui.editorControls.button, { type: 'button', 'aria-label': 'Bold', 'aria-pressed': false, onClick: () => events.push('bold') }, 'Bold'));
  assert.equal(ui.q('button').dataset.slot, 'toggle');
  await ui.click(ui.q('button')); assert.deepEqual(events, ['bold']);
  await ui.render(ui.h(ui.editorControls.button, { type: 'button', 'aria-label': 'Bold', 'aria-pressed': true }, 'Bold'));
  assert.equal(ui.q('button').getAttribute('aria-pressed'), 'true');
  await ui.render(ui.h(ui.editorControls.button, { type: 'submit' }, 'Apply link'));
  assert.equal(ui.q('button').dataset.slot, 'button');
  assert.equal(ui.q('button').type, 'submit');
});

test('manual copy uses the host Dialog and Textarea and selects the exact text', async t => {
  const ui = await mount(t); const text = 'Fictional notes\nwith exact whitespace.\n';
  await ui.render(ui.h(ui.ViewerFrame, { title: 'Fictional notes', onCopy: () => { throw Object.assign(new Error('Manual copy'), { name: 'ManualCopyError', text }); } }));
  await ui.click(ui.q('[data-testid=viewer-more]'));
  await ui.click(ui.q('[data-testid=viewer-copy]'));
  await ui.act(async () => { await new Promise(resolve => setTimeout(resolve, 50)); });
  assert.equal(ui.q('[data-testid=viewer-manual-copy]').dataset.slot, 'dialog-content');
  const field = ui.q('[data-testid=viewer-manual-copy-text]');
  assert.equal(field.dataset.slot, 'textarea');
  assert.equal(field.value, text);
  assert.equal(field.selectionStart, 0); assert.equal(field.selectionEnd, text.length);
  await ui.click(ui.q('[data-testid=viewer-manual-copy-close]'));
  assert.equal(ui.q('[data-testid=viewer-manual-copy]'), null);
});

test('mainControl stays in the header beside the "…" menu while controls fold into it on a phone', async t => {
  const ui = await mount(t); const events = [];
  await ui.render(ui.h(ui.ViewerFrame, { title: 'Fictional notes', controls: ui.h('button', { 'data-testid': 'fictional-zoom' }, 'Zoom'), mainControl: ui.h('button', { 'data-testid': 'fictional-comment', onClick: () => events.push('comment') }, 'Comment') }));
  const main = ui.q('[data-testid=viewer-main]');
  assert.ok(main.querySelector('[data-testid=fictional-comment]'), 'the main control renders in its own slot');
  assert.equal(ui.q('[data-testid=viewer-controls]').contains(main), false, 'not inside the controls a phone hides');
  assert.doesNotMatch(main.className, /hidden/, 'visible at every width');
  assert.equal(main.closest('[data-testid=viewer-bar]') !== null, true);
  await ui.click(main.querySelector('button'));
  assert.deepEqual(events, ['comment']);
  await ui.click(ui.q('[data-testid=viewer-more]'));
  await ui.act(async () => { await new Promise(resolve => setTimeout(resolve, 50)); });
  assert.equal(ui.window.document.querySelectorAll('[data-testid=fictional-comment]').length, 1, 'never duplicated into the "…" menu');
});
