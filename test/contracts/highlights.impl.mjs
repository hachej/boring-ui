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

test('the tray explains unplaced quotes and selection hints in plain English and French', async t => {
  const f = await fixture(t, 'echo echo\n');
  await f.store.add(mark('duplicate', anchor('echo'))); await f.store.add(mark('gone', anchor('vanished')));
  for (const [locale, title, repeated, missing, hint] of [
    ['en', '2 highlights could not be placed', 'This passage appears several times — pick the right one', 'This passage is no longer in the document', 'Select a passage in the document first.'],
    ['fr', "2 surlignages n'ont pas pu être placés", 'Ce passage apparaît plusieurs fois — choisissez le bon.', "Ce passage n'est plus dans le document.", "Sélectionnez d'abord un passage dans le document."],
  ]) {
    await f.render({ locale });
    const tray = f.host.querySelector('aside');
    assert.equal(tray.querySelector('h3').textContent, title);
    assert.deepEqual([...tray.querySelectorAll('q')].map(q => q.textContent), ['echo', 'vanished']);
    assert.ok(tray.textContent.includes(repeated)); assert.ok(tray.textContent.includes(missing));
    assert.doesNotMatch(f.host.textContent, /uncertain projections|rich view refuses|projections incertaines/);
    const attach = [...tray.querySelectorAll('button')].find(b => /Attach to selection|Rattacher à la sélection/.test(b.textContent));
    assert.equal(attach.disabled, true);
    assert.equal(document.getElementById(attach.getAttribute('aria-describedby')).textContent, hint);
    const add = f.button(locale === 'en' ? 'Highlight selection' : 'Surligner la sélection');
    assert.equal(document.getElementById(add.getAttribute('aria-describedby')).textContent, hint);
  }
});

test('a selection enables compact highlight and reattach buttons without disabled hints', async t => {
  const f = await fixture(t, 'echo echo\n'); await f.store.add(mark('gone', anchor('vanished'))); await f.render();
  await f.click('Markdown source');
  const input = f.host.querySelector('textarea.boring-markdown-source');
  await act(async () => { input.focus(); input.setSelectionRange(0, 4); input.dispatchEvent(new window.KeyboardEvent('keyup', { key: 'ArrowRight', bubbles: true })); document.dispatchEvent(new window.Event('selectionchange')); });
  await until(() => !f.button('Highlight selection').disabled, 'selection enables highlighting');
  for (const button of [f.button('Highlight selection'), f.button('Attach to selection')]) {
    assert.equal(button.disabled, false); assert.equal(button.getAttribute('aria-describedby'), null);
    assert.match(button.className, /\bh-7\b/); assert.doesNotMatch(button.className, /\bw-full\b|min-h-11/);
  }
});

test('candidate excerpts trim whole words, disclose omissions and mark the matching text', async t => {
  const source = 'A fictional kite rises above the orchard. echo beside a narrow stream and a wooden bridge.\nA fictional kite turns above the meadow. echo beside a winding path and a small gate.\n';
  const f = await fixture(t, source); await f.store.add(mark('duplicate', anchor('echo'))); await f.render();
  const buttons = [...f.host.querySelectorAll('button')].filter(b => b.textContent.startsWith('Choose passage'));
  assert.equal(buttons.length, 2);
  const preview = buttons[0].closest('[data-testid=highlight-candidate]') ?? buttons[0];
  assert.match(preview.textContent, /… kite rises above the orchard\./);
  assert.match(preview.textContent, /beside a narrow stream and …/);
  assert.equal(preview.querySelector('mark').textContent, 'echo');
  assert.doesNotMatch(preview.textContent, /… e the orchard|… ises above/);
});

test('commented marks use soft theme markers and a separate comment indicator', async t => {
  const f = await fixture(t); await f.store.add({ ...mark('commented', anchor('A fictional kite.\n', 2, 11)), note: 'A fictional note.', colour: 'primary' }); await f.render();
  await until(() => f.host.querySelector('[data-mark-id=commented]'), 'commented decoration');
  const decoration = f.host.querySelector('[data-mark-id=commented]');
  assert.match(decoration.getAttribute('style'), /color:\s*var\(--foreground\)/);
  assert.ok(f.host.querySelector('[data-mark-comment=commented][aria-label="Has a comment"]'));
  await act(async () => decoration.click());
  assert.equal(f.host.querySelector('[data-mark-id=commented]').getAttribute('data-mark-active'), 'true');
  assert.equal(f.controller.getSnapshot().text, 'A fictional kite.\n'); assert.equal(f.controller.getSnapshot().dirty, false);
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
