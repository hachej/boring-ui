import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync } from 'node:fs';
import { build } from 'esbuild';
import { Window } from 'happy-dom';
import { inboxViews, requestViews } from '../../examples/workspace-app/requests-fixture.mjs';

mkdirSync('.cache/requests-board-test', { recursive: true });
await build({ entryPoints: ['registry/requests-board/requests-board.tsx'], outfile: '.cache/requests-board-test/board.mjs', bundle: true, format: 'esm', platform: 'node', jsx: 'automatic', packages: 'external', alias: { '@': `${process.cwd()}/examples/app-shell` }, logLevel: 'silent' });
const window = new Window({ url: 'https://fictional.invalid/' });
for (const name of ['document', 'navigator', 'HTMLElement', 'HTMLButtonElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'Element', 'Node', 'MutationObserver', 'ResizeObserver', 'Event', 'MouseEvent', 'KeyboardEvent', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame']) {
  const value = window[name];
  Object.defineProperty(globalThis, name, { configurable: true, value: typeof value === 'function' && /^[a-z]/.test(name) ? value.bind(window) : value });
}
Object.assign(globalThis, { window, IS_REACT_ACT_ENVIRONMENT: true });
const { createElement: h, act } = await import('react');
const { createRoot } = await import('react-dom/client');
const { RequestsBoard } = await import('../../.cache/requests-board-test/board.mjs');
const click = async element => { assert.ok(element, 'control exists'); await act(() => element.click()); };
const button = (element, text) => [...element.querySelectorAll('button')].find(value => value.textContent === text);
async function mount(t, extra = {}) {
  const element = document.createElement('div'); document.body.append(element);
  const root = createRoot(element), actions = [];
  let props = { views: inboxViews, mode: 'full', locale: 'fr', onOpenAll: () => actions.push(['all']), onOpen: id => actions.push(['open', id]), onAnswer: (id, text) => actions.push(['answer', id, text]), onDecide: (id, decision) => actions.push(['decide', id, decision]), onTry: (id, action) => actions.push(['try', id, action]), ...extra };
  const render = async changes => { props = { ...props, ...changes }; await act(() => root.render(h(RequestsBoard, props))); };
  await render({});
  t.after(async () => { await act(() => root.unmount()); element.remove(); });
  return { element, actions, render };
}

test('compact renders five prioritized rows and opens all twelve through the host callback', async t => {
  const { element, actions } = await mount(t, { mode: 'compact' });
  assert.deepEqual([...element.querySelectorAll('[data-request]')].map(row => row.dataset.request), ['D-902', 'D-901', 'D-908', 'D-904', 'D-912']);
  await click(button(element, 'Voir les 12 demandes'));
  await click(element.querySelector('[data-request="D-902"]'));
  assert.deepEqual(actions, [['all'], ['open', 'D-902']]);
});
test('full filters two questions, searches devis, opens timeline, links, preview and decisions', async t => {
  const { element, actions } = await mount(t);
  await click(element.querySelector('[data-filter=yours]'));
  assert.equal(element.querySelectorAll('[data-request]').length, 2);
  await click(element.querySelector('[data-request="D-902"]'));
  await click(button(element, 'Approuver'));
  await click(button(element, 'Plus tard'));
  assert.deepEqual(actions.slice(-2), [['decide', 'D-902', 'approve'], ['decide', 'D-902', 'later']]);
  await click(element.querySelector('[data-filter=active]'));
  const input = element.querySelector('input');
  await act(() => { Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(input, 'devis'); input.dispatchEvent(new window.Event('input', { bubbles: true })); });
  assert.equal(element.querySelectorAll('[data-request]').length, 3);
  await click(element.querySelector('[data-request="D-905"]'));
  const detail = element.querySelector('[data-testid=requests-detail-pane]');
  assert.match(detail.textContent, /En vérification/); assert.match(detail.textContent, /la vérification/); assert.match(detail.textContent, /D-905 créée/);
  await click(button(element, 'Parente · D-904'));
  assert.deepEqual(actions.at(-1), ['open', 'D-904']);
  await click(button(element, 'Essayer cette version'));
  assert.deepEqual(actions.at(-1), ['try', 'D-904', inboxViews[3].action]);
});
test('answers use the selected request and host updates alone settle the open question', async t => {
  const { element, actions, render } = await mount(t);
  await click(element.querySelector('[data-request="D-901"]'));
  const textarea = element.querySelector('textarea');
  await act(() => { Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(textarea, 'Un total'); textarea.dispatchEvent(new window.Event('input', { bubbles: true })); });
  await click(button(element, 'Répondre'));
  assert.deepEqual(actions.at(-1), ['answer', 'D-901', 'Un total']);
  assert.ok(element.querySelector('[data-testid=request-question]'), 'no fabricated acknowledgement');
  await render({ views: inboxViews.map(view => view.number === 'D-901' ? { ...view, question: undefined } : view) });
  assert.equal(element.querySelector('[data-testid=request-question]'), null);
});
test('release approval is hidden without permission and ordinary approval stays available', async t => {
  const { element, render } = await mount(t, { views: requestViews });
  await click(element.querySelector('[data-request="D-906"]'));
  assert.equal(element.querySelector('[data-testid=request-question]'), null);
  await render({ canApproveRelease: true });
  assert.match(element.querySelector('[data-testid=request-question]').textContent, /Mettre cette version en ligne/);
  await render({ canApproveRelease: false });
  assert.equal(element.querySelector('[data-testid=request-question]'), null);
  await click(element.querySelector('[data-request="D-902"]'));
  assert.ok(button(element, 'Approuver'));
});
test('keyboard arrows focus without opening; token changes announce moved views only', async t => {
  const { element, actions, render } = await mount(t, { changeToken: 0 });
  const rows = element.querySelectorAll('[data-request]'); rows[0].focus();
  await act(() => rows[0].dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })));
  assert.equal(document.activeElement, rows[1]); assert.equal(actions.length, 0);
  const moved = inboxViews.map(view => view.number === 'D-903' ? { ...view, state: 'try' } : view);
  await render({ views: moved });
  assert.equal(element.querySelector('[role=status]').textContent, '');
  await render({ changeToken: 1 });
  assert.equal(element.querySelector('[role=status]').textContent, 'D-903 : à essayer');
  await render({ locale: 'en', labels: { search: 'Find requests' }, changeToken: 2 });
  assert.equal(element.querySelector('input').getAttribute('aria-label'), 'Find requests');
  assert.equal(element.querySelector('[role=status]').textContent, '');
});

test('repository chips scope both counts and rows; empty state and absent callback controls stay usable', async t => {
  const { element, render } = await mount(t, { repos: ['Atelier Exemple', 'Atelier Exemple — vitrine'], onAnswer: undefined, onDecide: undefined, onTry: undefined });
  await click(button(element, 'Atelier Exemple — vitrine'));
  assert.deepEqual([...element.querySelectorAll('[data-request]')].map(row => row.dataset.request), ['D-912']);
  assert.equal(button(element, 'À vous · 0').getAttribute('aria-pressed'), 'false');
  await click(button(element, 'À vous · 0'));
  assert.match(element.querySelector('[data-testid=requests-list]').textContent, /Aucune demande/);
  await click(button(element, 'Tous les dépôts'));
  await click(element.querySelector('[data-request="D-901"]'));
  assert.equal(element.querySelector('textarea').disabled, true);
  assert.equal(button(element, 'Répondre').disabled, true);
  assert.equal(button(element, 'Plus tard').disabled, true);
  await render({ locale: 'en', views: [] });
  assert.match(element.textContent, /No requests/);
  assert.equal(element.querySelectorAll('[data-request]').length, 0);
});
