import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { Window } from 'happy-dom';
import { createMarkdownController } from '@hachej/boring-ui-kit/markdown';
import { createMarkStore } from '@hachej/boring-ui-kit/mark-store';
import { captureMarkdownQuote } from '@hachej/boring-ui-kit/markdown-quote';
import { openSqliteWorkspaces } from '../../shared/sqlite-workspaces.mjs';

const out = resolve('.cache/highlights-test'); mkdirSync(out, { recursive: true });
await build({ entryPoints: ['registry/highlights/highlights.tsx'], outfile: join(out, 'block.mjs'), bundle: true, format: 'esm', platform: 'node', jsx: 'automatic', packages: 'external', alias: { '@': resolve('examples/app-shell') }, logLevel: 'silent' });
const window = new Window({ url: 'https://fictional.invalid/' });
for (const name of ['document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'HTMLButtonElement', 'Element', 'Node', 'Text', 'DOMParser', 'MutationObserver', 'Event', 'KeyboardEvent', 'MouseEvent', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame']) {
  const value = window[name]; Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: typeof value === 'function' && /^[a-z]/.test(name) ? value.bind(window) : value });
}
Object.assign(globalThis, { window, IS_REACT_ACT_ENVIRONMENT: true });
const { createElement: h, act } = await import('react');
const { createRoot } = await import('react-dom/client');
const { Highlights } = await import(pathToFileURL(join(out, 'block.mjs')));
const identity = { scopeId: 'fictional', principalId: 'reviewer', initiatorId: 'reviewer' };
const target = { resource: { providerId: 'documents', path: 'kite.md' }, view: { kind: 'published' } };
const anchor = (source, start = 0, end = source.length) => captureMarkdownQuote(source, { start, end }).anchor;
const mark = (id, quote) => ({ id, anchor: quote, colour: 'accent', note: '', author: 'reviewer', time: '2026-10-10T10:00:00Z' });
async function until(predicate, message) {
  const end = Date.now() + 10000;
  while (!predicate()) { assert.ok(Date.now() < end, message); await act(async () => { await new Promise(r => setTimeout(r, 10)); }); }
}
async function fixture(t, source = 'A fictional kite.\n') {
  const files = openSqliteWorkspaces({ filename: ':memory:', providerId: 'documents', authorize: () => true });
  const client = { read: r => files.read(r, identity), publish: r => files.publication.publish(r, identity), lookup: id => files.reconciliation.lookup(id, identity) };
  await client.publish({ operationId: 'seed', atomicity: 'all-or-nothing', changes: [{ kind: 'create', target, expected: { kind: 'absent' }, bytes: new TextEncoder().encode(source), mediaType: 'text/markdown' }] });
  const controller = createMarkdownController({ identity, client, instanceId: 'viewer', epoch: 'one', source: { kind: 'saved', snapshot: (await client.read({ target, revision: { kind: 'latest' } })).snapshot } });
  const store = await createMarkStore({ client, identity }, target);
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  const render = async props => { await act(async () => root.render(h(Highlights, { controller, store, ...props }))); await until(() => host.querySelector('.tiptap') || host.querySelector('textarea.boring-markdown-source'), 'editor ready'); };
  const button = label => [...document.querySelectorAll('button,[role=menuitem]')].find(el => (el.getAttribute('aria-label') || el.textContent) === label);
  const click = async label => { const el = button(label); assert.ok(el, `Missing ${label}`); await act(async () => el.click()); };
  t.after(async () => { await act(async () => root.unmount()); assert.equal(controller.getSnapshot().lifecycle, 'active', 'controller borrowed'); assert.equal(store.getSnapshot().lifecycle, 'active', 'store borrowed'); store.dispose(); controller.dispose(); files.close(); host.remove(); });
  return { host, root, controller, store, client, render, click, button };
}

test('exact decorations leave the document unchanged and context actions use the mark id', async t => {
  const f = await fixture(t); let activated;
  await f.render({ marks: [{ id: 'exact', anchor: anchor('A fictional kite.\n', 2, 11), colour: 'primary', actions: [{ id: 'inspect', label: 'Inspect mark', run: id => { activated = id; } }] }] });
  await until(() => f.host.querySelector('[data-mark-id="exact"]'), 'exact rich decoration');
  assert.equal(f.host.querySelector('[data-mark-id="exact"]').textContent, 'fictional');
  assert.equal(f.controller.getSnapshot().text, 'A fictional kite.\n'); assert.equal(f.controller.getSnapshot().dirty, false);
  await act(async () => f.host.querySelector('[data-mark-id="exact"]').click());
  await f.click('Highlight actions'); await f.click('Inspect mark'); assert.equal(activated, 'exact');
  assert.equal((await f.client.read({ target: { ...target, resource: { ...target.resource, path: 'kite.md.marks.json' } }, revision: { kind: 'latest' } })).kind, 'missing');
});

test('missing and ambiguous marks stay in the tray until a person chooses an exact candidate', async t => {
  const f = await fixture(t, 'echo echo\n');
  await f.store.add(mark('duplicate', anchor('echo'))); await f.store.add(mark('gone', anchor('vanished')));
  await f.render({ locale: 'fr' });
  assert.equal(f.host.querySelectorAll('[data-testid=lost-mark]').length, 2);
  assert.equal(f.host.querySelector('[data-mark-id]'), null);
  const candidates = [...f.host.querySelectorAll('button')].filter(b => b.textContent.startsWith('Choisir ce passage'));
  assert.equal(candidates.length, 2);
  await act(async () => candidates[1].click());
  await until(() => f.store.getSnapshot().save.kind === 'settled' && f.store.getSnapshot().save.result.kind === 'saved', 'candidate persisted');
  assert.equal(f.store.getSnapshot().marks.find(m => m.id === 'duplicate').anchor.start, 5);
  assert.equal(f.host.querySelectorAll('[data-testid=lost-mark]').length, 1);
  assert.equal(f.host.querySelector('[data-mark-id="duplicate"]').textContent, 'echo');
  const note = f.host.querySelector('[data-testid=highlight-context] textarea');
  await act(async () => { const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set; setter.call(note, 'A fictional note.'); note.dispatchEvent(new window.Event('input', { bubbles: true })); });
  await f.click('Enregistrer le commentaire');
  await until(() => !f.store.getSnapshot().dirty, 'comment saved');
  assert.equal(f.store.getSnapshot().marks.find(m => m.id === 'duplicate').note, 'A fictional note.');
  await f.click('Actions du surlignage'); await f.click('Supprimer le surlignage');
  await until(() => f.store.getSnapshot().marks.length === 1, 'removed');
});

test('default store captures source selections, writes the sidecar, and never writes document text', async t => {
  const f = await fixture(t, 'A fictional kite.\n');
  await f.render({ store: undefined, resource: { client: f.client, identity }, locator: target });
  await until(() => f.button('Highlight selection'), 'default store loaded');
  await f.click('Markdown source');
  const input = f.host.querySelector('textarea.boring-markdown-source');
  await act(async () => { input.focus(); input.setSelectionRange(2, 11); input.dispatchEvent(new window.KeyboardEvent('keyup', { key: 'ArrowRight', bubbles: true })); document.dispatchEvent(new window.Event('selectionchange')); });
  await until(() => !f.button('Highlight selection').disabled, 'source capture');
  await f.click('Highlight selection');
  await until(() => f.host.querySelector('summary') && !f.button('Highlight selection').disabled && !f.host.querySelector('[role=alert]'), 'save settled');
  const reopened = await createMarkStore({ client: f.client, identity }, target); t.after(() => reopened.dispose());
  assert.equal(reopened.getSnapshot().marks.length, 1); assert.equal(reopened.getSnapshot().marks[0].anchor.exact, 'fictional');
  assert.equal(f.controller.getSnapshot().text, 'A fictional kite.\n'); assert.equal(f.controller.getSnapshot().dirty, false);
});

test('public editor captures a literal rich span and refuses a cross-syntax projection', async t => {
  const f = await fixture(t, 'A **fictional** kite.\n');
  const { MarkdownEditor } = await import('@hachej/boring-ui-kit/markdown-editor');
  let tools, captured;
  await act(async () => f.root.render(h(MarkdownEditor, { controller: f.controller, autosave: false, onMountedTools: value => { tools = value; }, onQuoteSelection: value => { captured = value; } })));
  await until(() => tools?.getTarget(), 'mounted rich selection tools');
  const select = async (anchor, head) => {
    await act(async () => { const result = await tools.select.invoke(tools.getTarget(), { selection: { kind: 'rich', anchor, head }, expiresAt: Date.now() + 5000 }); assert.equal(result.kind, 'applied'); });
  };
  await select(3, 12); assert.equal(captured.kind, 'captured'); assert.equal(captured.anchor.exact, 'fictional'); assert.equal(captured.anchor.start, 4);
  await select(1, 5); assert.equal(captured.kind, 'refused'); assert.match(captured.reason, /source projection/);
  assert.equal(f.controller.getSnapshot().dirty, false);
});

test('invalid supplied colour tokens cannot introduce CSS or decorations', async t => {
  const f = await fixture(t);
  await f.render({ marks: [{ id: 'invalid', anchor: anchor('A fictional kite.\n', 2, 11), colour: 'accent);background-image:url(https://fictional.invalid/x)' }] });
  assert.equal(f.host.querySelector('[data-mark-id=invalid]'), null);
  assert.equal(f.host.querySelector('details mark'), null);
});

test('rich capture refuses selections crossing syntax rather than guessing source offsets', async t => {
  const f = await fixture(t, 'A **fictional** kite.\n');
  await f.render();
  await f.click('Markdown source'); await f.click('Markdown source');
  const rich = f.host.querySelector('.tiptap');
  assert.ok(rich);
  await act(async () => { const selection = window.getSelection(); selection.setBaseAndExtent(rich.querySelector('p').firstChild, 0, rich.querySelector('strong').firstChild, 4); rich.dispatchEvent(new window.MouseEvent('mouseup', { bubbles: true })); document.dispatchEvent(new window.Event('selectionchange')); });
  assert.equal(f.button('Highlight selection').disabled, true);
  assert.equal(f.controller.getSnapshot().dirty, false);
});
