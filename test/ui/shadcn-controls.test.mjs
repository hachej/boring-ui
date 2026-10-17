import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, readFileSync } from 'node:fs';
import { build } from 'esbuild';
import { Window } from 'happy-dom';

async function mount(t) {
  const window = new Window({ url: 'https://fictional.invalid/' });
  const names = ['window', 'document', 'navigator', 'HTMLElement', 'HTMLButtonElement', 'Element', 'Node', 'Text', 'MutationObserver', 'getComputedStyle', 'IS_REACT_ACT_ENVIRONMENT'];
  const saved = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  for (const name of names) {
    const value = name === 'window' ? window : name === 'IS_REACT_ACT_ENVIRONMENT' ? true : window[name];
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: typeof value === 'function' && /^[a-z]/.test(name) ? value.bind(window) : value });
  }
  const out = new URL('../../.cache/shadcn-controls-test/', import.meta.url); mkdirSync(out, { recursive: true });
  const before = process.env.BEFORE_BUTTON_SOURCE;
  const output = new URL(before ? 'before.mjs' : 'after.mjs', out);
  await build({ stdin: { contents: "export { Composer } from './registry/pi-chat/composer'; export { ActionButton } from './registry/button/actions'; export { EmptyState } from './registry/pi-chat/empty-state';", resolveDir: new URL('../../', import.meta.url).pathname, loader: 'tsx' }, outfile: output.pathname, bundle: true, format: 'esm', platform: 'node', jsx: 'automatic', packages: 'external', logLevel: 'silent',
    plugins: before ? [{ name: 'pre-migration-button', setup(builder) { builder.onLoad({ filter: /examples\/app-shell\/components\/ui\/button\.tsx$/ }, () => ({ contents: readFileSync(before, 'utf8'), loader: 'tsx', resolveDir: new URL('../../registry/button/', import.meta.url).pathname })); } }] : [] });
  const components = await import(output.href);
  const { createElement: h, act } = await import('react');
  const { createRoot } = await import('react-dom/client');
  const container = window.document.createElement('div'); window.document.body.append(container);
  const root = createRoot(container);
  t.after(async () => { await act(async () => root.unmount()); await window.happyDOM.close(); for (const [name, descriptor] of saved) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; } });
  return { ...components, h, act, q: selector => container.querySelector(selector), render: node => act(async () => root.render(node)), click: node => act(async () => node.click()) };
}

const props = () => ({ text: 'Fictional notes', onText() {}, attachments: [], onRemoveAttachment() {}, working: false, sendBlocked: false, disabled: false, stopRequested: false, onSend() {}, onStop() {}, uploading: false, canAttach: true, fileAccept: '', onPickFiles() {}, textareaRef: { current: null } });

test('composer actions use the host Button, preserve submit/stop and never submit from the attach trigger', async t => {
  const ui = await mount(t); const events = [];
  const value = { ...props(), onSend: () => events.push('send'), onStop: () => events.push('stop') };
  await ui.render(ui.h(ui.Composer, value));
  assert.equal(ui.q('[data-testid=composer-submit]').dataset.slot, 'button');
  assert.equal(ui.q('[data-testid=composer-plus]').dataset.slot, 'button');
  assert.equal(ui.q('[data-testid=composer-plus]').type, 'button');
  assert.equal(ui.q('[data-testid=composer-submit]').type, 'submit');
  await ui.click(ui.q('[data-testid=composer-plus]'));
  assert.deepEqual(events, [], 'opening Attach cannot submit the form');
  await ui.click(ui.q('[data-testid=composer-submit]'));
  assert.deepEqual(events, ['send']);
  await ui.render(ui.h(ui.Composer, { ...value, working: true }));
  assert.equal(ui.q('[data-testid=composer-submit]').type, 'button');
  await ui.click(ui.q('[data-testid=composer-submit]'));
  assert.deepEqual(events, ['send', 'stop']);
  await ui.render(ui.h(ui.Composer, { ...value, working: true, stopRequested: true }));
  await ui.click(ui.q('[data-testid=composer-submit]'));
  assert.deepEqual(events, ['send', 'stop'], 'a second stop is disabled');
});

test('the annotate control is a controlled native Toggle and retains its accessible name', async t => {
  const ui = await mount(t); let calls = 0;
  const feedback = { active: false, count: 0, annotate: () => { calls++; }, clear() {}, attach: async text => ({ kind: 'ok', text }), sent() {} };
  await ui.render(ui.h(ui.Composer, { ...props(), feedback }));
  const button = ui.q('[data-testid=composer-annotate]');
  assert.equal(button.dataset.slot, 'toggle');
  assert.equal(button.getAttribute('aria-pressed'), 'false');
  assert.ok(button.getAttribute('aria-label'));
  await ui.click(button); assert.equal(calls, 1);
  await ui.render(ui.h(ui.Composer, { ...props(), feedback: { ...feedback, active: true } }));
  assert.equal(ui.q('[data-testid=composer-annotate]').getAttribute('aria-pressed'), 'true');
});

test('host pressed actions use native Toggle while ordinary icon actions use native Button', async t => {
  const ui = await mount(t); let calls = 0;
  const action = { id: 'fictional-pin', label: 'Pin fictional document', onSelect: () => { calls++; } };
  await ui.render(ui.h(ui.ActionButton, { action: { ...action, pressed: false }, testId: 'host', iconOnly: true }));
  assert.equal(ui.q('button').dataset.slot, 'toggle');
  await ui.click(ui.q('button')); assert.equal(calls, 1);
  await ui.render(ui.h(ui.ActionButton, { action, testId: 'host', iconOnly: true }));
  assert.equal(ui.q('button').dataset.slot, 'button');
  assert.equal(ui.q('button').getAttribute('aria-label'), action.label);
  await ui.click(ui.q('button')); assert.equal(calls, 2);
});
