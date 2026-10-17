import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync } from 'node:fs';
import { build } from 'esbuild';
import { Window } from 'happy-dom';
import { Harness, MemoryStorage, createRegistry } from '@earendil-works/pi-durable';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { createFakeChatModel } from '@hachej/boring-testing/model';
import { createNativeChatController } from '@hachej/boring-ui-kit/native-chat';

// The kit's History column: AgentWorkspace's sessions column (per-viewer memory, steps aside for a panel, `history="popover"`) and the
// `useHistoryColumn` piece a hand-built agent pane uses, through the public pi-app entry.
test('History is a side column where it fits, the popover otherwise', { timeout: 60000 }, async t => {
  const window = new Window({ url: 'https://fictional.invalid/' });
  const names = ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Text', 'MutationObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'ResizeObserver', 'sessionStorage', 'localStorage', 'addEventListener', 'removeEventListener', 'matchMedia', 'innerWidth', 'innerHeight', 'IS_REACT_ACT_ENVIRONMENT'];
  const globals = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  for (const name of names) {
    const value = name === 'window' ? window : name === 'IS_REACT_ACT_ENVIRONMENT' ? true : window[name];
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: typeof value === 'function' && /^[a-z]/.test(name) ? value.bind(window) : value });
  }
  let measured = 1400;
  window.HTMLElement.prototype.getBoundingClientRect = () => ({ width: measured, height: 800, left: 0, right: measured, top: 0, bottom: 800, x: 0, y: 0 });
  const { createElement, act } = await import('react'); const { createRoot } = await import('react-dom/client');
  const out = new URL('../../.cache/history-column/', import.meta.url); mkdirSync(out, { recursive: true });
  const output = new URL('history-column.mjs', out);
  await build({ entryPoints: [new URL('../../registry/pi-app/agent-workspace.tsx', import.meta.url).pathname], outfile: output.pathname, bundle: true, format: 'esm', platform: 'node', jsx: 'automatic', packages: 'external', loader: { '.css': 'empty' },
    plugins: [{ name: 'file-tree-css', setup(builder) { builder.onResolve({ filter: /^@hachej\/boring-ui-kit\/file-tree\.css$/ }, () => ({ path: new URL(import.meta.resolve('@hachej/boring-ui-kit/file-tree.css')).pathname, external: false })); } }] });
  const { AgentWorkspace, HistoryColumnToggle, useHistoryColumn } = await import(output.href);
  const fake = createFakeChatModel();
  const harness = await Harness.open(new MemoryStorage(), { registry: createRegistry(), models: fake.models }, context);
  const conversation = await harness.createConversation({ ownership: { kind: 'ownerless' }, agent: { model: fake.model } }, context);
  const controller = createNativeChatController({ identity: { runtimeId: 'fictional', scopeId: 'fictional', principalId: 'alice' }, conversation, context });
  await controller.connect();
  const element = document.createElement('div'); document.body.append(element); let root = createRoot(element);
  t.after(async () => {
    await act(async () => root.unmount()); await controller.dispose(); await harness.close(context); await window.happyDOM.close();
    for (const [name, descriptor] of globals) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; }
  });
  const id = String(conversation.id);
  const conversations = { items: [{ id, title: 'Fictional chat' }, { id: 'other', title: 'Another fictional chat' }], activeId: id, onSelect() {}, onNew() {} };
  const q = selector => element.querySelector(selector);
  const resources = { identity: { scopeId: 'fictional', principalId: 'alice', initiatorId: 'alice' }, endpoint: 'https://fictional.invalid/resources', fetch: async () => new Response('Fictional notes', { headers: { 'content-type': 'text/plain' } }) };
  const workspace = extra => act(async () => root.render(createElement(AgentWorkspace, { controller, conversationId: id, conversations, resources, storageKey: 'proof', ...extra })));
  const remount = async () => { await act(async () => root.unmount()); root = createRoot(element); };
  const sessions = () => q('[data-boring=agent-workspace]').dataset.sessions;

  await t.test('AgentWorkspace: the column is open by default and remembered per viewer', async () => {
    localStorage.clear();
    await workspace({});
    assert.equal(sessions(), 'docked');
    assert.equal(q('[data-testid=conversations]').id, 'proof-sessions', 'the column has the id its toggle controls');
    assert.equal(q('[data-testid=history-open]'), null, 'no History popover beside the column');
    await act(async () => q('[data-testid=conversations] [data-testid=sessions-toggle]').click());
    assert.equal(sessions(), 'hidden');
    assert.equal(localStorage.getItem('proof.history-column'), 'closed', 'the viewer\'s choice is kept in localStorage');
    const toggle = q('[data-testid=sessions-toggle]');
    assert.equal(toggle.getAttribute('aria-expanded'), 'false');
    assert.equal(toggle.getAttribute('aria-controls'), 'proof-sessions');
    await remount(); await workspace({});
    assert.equal(sessions(), 'hidden', 'a new mount opens the column as this viewer left it');
    await act(async () => q('[data-testid=sessions-toggle]').click());
    assert.equal(sessions(), 'docked');
    assert.equal(localStorage.getItem('proof.history-column'), 'open');
  });

  await t.test('AgentWorkspace: an open panel that leaves the chat too narrow puts the column aside and History becomes the popover', async () => {
    localStorage.clear();
    measured = 1400;
    await workspace({ opened: { kind: 'file', path: 'notes.txt' } });
    assert.equal(sessions(), 'docked', 'column, viewer and chat fit at 1400px');
    await remount(); measured = 900;
    await workspace({ opened: { kind: 'file', path: 'notes.txt' } });
    assert.equal(sessions(), 'hidden', 'the column steps aside');
    assert.equal(q('[data-testid=sessions-toggle]'), null, 'no column toggle while it is aside');
    assert.ok(q('[data-testid=history-open]'), 'History falls back to the popover');
    await workspace({ opened: null });
    assert.equal(sessions(), 'docked', 'closing the panel brings the column back');
    assert.equal(q('[data-testid=history-open]'), null);
    assert.equal(localStorage.getItem('proof.history-column'), null, 'stepping aside is not the viewer\'s choice');
    measured = 1400;
  });

  await t.test('AgentWorkspace history="popover" keeps conversations out of the pane', async () => {
    localStorage.clear();
    await remount(); await workspace({ history: 'popover' });
    assert.equal(q('[data-testid=conversations]'), null);
    assert.ok(q('[data-testid=history-open]'), 'History opens the popover');
  });

  await t.test('useHistoryColumn: a hand-built pane gets the column where it fits', async () => {
    localStorage.clear();
    function Pane({ enabled = true, beside = 0 }) {
      const history = useHistoryColumn({ id: 'pane-history', storageKey: 'pane.history', conversations, enabled, beside, title: 'Conversations' });
      return createElement('div', { ref: history.ref, 'data-testid': 'pane' }, history.column, history.toggle ? createElement(HistoryColumnToggle, { toggle: history.toggle }) : createElement('span', { 'data-testid': 'popover-fallback' }));
    }
    const pane = props => act(async () => root.render(createElement(Pane, props)));
    await remount(); measured = 800; await pane({});
    const toggle = () => q('[data-testid=chat-action-history]');
    assert.equal(toggle().getAttribute('aria-expanded'), 'false', 'closed until this viewer opens it');
    assert.equal(toggle().getAttribute('aria-controls'), 'pane-history');
    assert.equal(toggle().getAttribute('aria-label'), 'History');
    await act(async () => toggle().click());
    assert.equal(toggle().getAttribute('aria-expanded'), 'true');
    assert.ok(q('#pane-history[data-testid=history-column] [data-testid=conversations]'), 'the column is the sessions pane');
    assert.equal(localStorage.getItem('pane.history'), 'open');
    await act(async () => window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    assert.ok(q('#pane-history'), 'Escape leaves the column open');
    await remount(); measured = 700; await pane({});
    assert.ok(q('[data-testid=popover-fallback]'), 'below 720px History is the popover');
    assert.equal(q('#pane-history'), null);
    await remount(); measured = 1000; await pane({ beside: 560 });
    assert.ok(q('[data-testid=popover-fallback]'), 'with a 560px artifact the column needs room for a 360px chat');
    await remount(); measured = 1200; await pane({ beside: 560 });
    assert.ok(q('#pane-history'), 'the column returns where column, artifact and chat fit');
    await remount(); await pane({ enabled: false });
    assert.ok(q('[data-testid=popover-fallback]'), 'floating panes and phones keep the popover');
    measured = 1400;
  });
});
