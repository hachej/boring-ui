import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { Window } from 'happy-dom';

const root = fileURLToPath(new URL('../../', import.meta.url));
const source = process.env.TARGET_CHIP_SOURCE_ROOT ?? root;
const out = `${root}.cache/pi-chat-target-chip-test`;
mkdirSync(out, { recursive: true });
await build({ entryPoints: [`${source}registry/pi-chat/pi-chat.tsx`], outfile: `${out}/chat.mjs`, bundle: true, format: 'esm', platform: 'node', jsx: 'automatic', packages: 'external', logLevel: 'silent' });
const { PiChat } = await import(pathToFileURL(`${out}/chat.mjs`).href);
await build({ entryPoints: [`${source}registry/pi-chat/history.tsx`], outfile: `${out}/history.mjs`, bundle: true, format: 'esm', platform: 'node', jsx: 'automatic', packages: 'external', logLevel: 'silent' });
const { ConversationList } = await import(pathToFileURL(`${out}/history.mjs`).href);
await build({ entryPoints: [`${source}registry/shared-chat/shared-chat.tsx`], outfile: `${out}/shared.mjs`, bundle: true, format: 'esm', platform: 'node', jsx: 'automatic', packages: 'external', logLevel: 'silent' });
const { SharedChat, useSharedChat } = await import(pathToFileURL(`${out}/shared.mjs`).href);
const { createFakeChannelSource } = await import('@hachej/boring-ui-kit/shared-chat');

// A point-and-speak message (D-509): the target block carries machine fields the person must never meet, on hover or in the accessibility tree.
const target = { kind: 'créneau', slot: 'snack', label: 'Encas conseillé', date: '2026-10-29', mealId: 'm-fictional-42' };
const sent = `<target>${JSON.stringify(target)}</target>\n\nun yaourt grec et une poignée d'amandes`;
const RAW = /mealId|m-fictional-42|créneau|snack|"slot"|"kind"|<target>/;
const view = { entries: [{ id: 1, kind: 'message', model: [{ role: 'user', content: sent, timestamp: 1 }] }], docs: { 'pi.inbox': { items: [{ id: 'queued-fictional', mode: 'followUp', content: sent }] } } };

test('PiChat draws a sent target as its chip, with no raw field on hover and the host\'s words through targetLabel', async t => {
  const window = new Window({ url: 'https://fictional.invalid/' });
  const names = ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Text', 'MutationObserver', 'ResizeObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'IS_REACT_ACT_ENVIRONMENT'];
  const globals = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  for (const name of names) {
    const value = name === 'window' ? window : name === 'IS_REACT_ACT_ENVIRONMENT' ? true : window[name];
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: typeof value === 'function' && /^[a-z]/.test(name) ? value.bind(window) : value });
  }
  const { act, createElement } = await import('react');
  const { createRoot } = await import('react-dom/client');
  const container = document.createElement('div'); document.body.append(container);
  const ui = createRoot(container);
  t.after(async () => {
    await act(async () => ui.unmount()); await window.happyDOM.close();
    for (const [name, descriptor] of globals) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; }
  });
  let snapshot = { identity: {}, conversationId: 'fictional', connection: { kind: 'connected' }, view, draft: { text: '', attachments: [], version: 0 }, outbox: [], history: { kind: 'disabled' }, send: { kind: 'idle' }, stop: 'idle', disposed: false };
  const controller = new Proxy({ getSnapshot: () => snapshot, subscribe: () => () => {} }, { get: (base, key) => key in base ? base[key] : async () => {} });
  const render = async props => act(async () => ui.render(createElement(PiChat, { controller, ...props })));
  const chip = () => container.querySelector('[data-testid="message-target"]');
  // Every attribute of the chip and its subtree: title, aria-label, aria-description and the like.
  const attributes = node => [node, ...node.querySelectorAll('*')].flatMap(element => [...element.attributes].map(attribute => attribute.value)).join(' ');

  await render({});
  assert.ok(chip(), 'the target is drawn as a chip');
  assert.equal(chip().textContent, 'Encas conseillé', 'by default the target\'s own label');
  assert.doesNotMatch(attributes(chip()), RAW, 'no attribute of the chip carries the raw target');
  assert.match(container.textContent, /un yaourt grec/);
  assert.doesNotMatch(container.textContent, RAW, 'neither the chip, the bubble nor the queued row prints a raw field');
  assert.equal(container.querySelector('[data-testid="queue-text"]').textContent, "un yaourt grec et une poignée d'amandes", 'a queued message shows its speech');

  const seen = [];
  await render({ targetLabel: value => { seen.push(value); return `${value.label} · 29 oct.`; } });
  assert.equal(chip().textContent, 'Encas conseillé · 29 oct.');
  assert.deepEqual(seen.at(-1), target, 'the host reads the block as sent, its JSON shape unchanged');
  assert.doesNotMatch(container.textContent, /mealId|m-fictional-42|slot: snack/);
  assert.doesNotMatch(attributes(chip()), /mealId|m-fictional-42/);

  await render({ targetLabel: () => undefined });
  assert.equal(chip().textContent, 'Encas conseillé', 'undefined keeps the default label');

  // Without a label field: the display keys the app wrapped its fields under, else « Target »; never a raw value.
  for (const [block, words] of [[{ 'Encas conseillé · 29 oct.': target }, 'Encas conseillé · 29 oct.'], [{ mealId: 'm-fictional-42', slot: 'snack' }, 'Target']]) {
    snapshot = { ...snapshot, view: { entries: [{ id: 2, kind: 'message', model: [{ role: 'user', content: `<target>${JSON.stringify(block)}</target>\n\nencore`, timestamp: 2 }] }], docs: {} } };
    await render({});
    assert.equal(chip().textContent, words);
    assert.doesNotMatch(container.textContent, RAW);
  }

  // The conversation list's tooltip is the last message without its target block.
  // c3: a title stored before titles dropped the block.
  const items = [{ id: 'c1', title: 'Fictional chat', lastMessage: sent, updatedAt: 1 }, { id: 'c2', title: 'Clipped', lastMessage: sent.slice(0, 40), updatedAt: 1 }, { id: 'c3', title: sent.slice(0, 80), lastMessage: null, updatedAt: 1 }];
  await act(async () => ui.render(createElement(ConversationList, { conversations: { items, onSelect: () => {} } })));
  const rows = [...container.querySelectorAll('[data-testid="conversation-row"]')];
  assert.equal(rows.length, 3);
  assert.doesNotMatch(rows.map(row => row.textContent).join(' '), RAW, 'no title shows a raw field');
  assert.equal(rows[0].getAttribute('title'), "un yaourt grec et une poignée d'amandes");
  assert.equal(rows[1].getAttribute('title'), null, 'a preview clipped inside the block has no tooltip');

  // SharedChat draws its own timeline: the same chip and the same targetLabel.
  const me = { id: 'me', name: 'Me', kind: 'person' };
  const source = createFakeChannelSource({ me, members: [me], conversations: [{ id: 'main', title: 'Main', kind: 'main', members: ['me'] }], messages: [{ id: 'm1', conversationId: 'main', author: 'me', text: sent, at: '2026-10-29T08:00:00Z', mentions: [] }] });
  const calls = [];
  function Room({ targetLabel }) {
    const shared = useSharedChat(source);
    return shared.controller ? createElement(SharedChat, { controller: shared.controller, conversations: shared.conversations, targetLabel }) : null;
  }
  await act(async () => ui.render(createElement(Room, { targetLabel: value => { calls.push(value); return 'Selected snack'; } })));
  for (let n = 0; n < 50 && !chip(); n++) await act(async () => new Promise(resolve => setTimeout(resolve, 10)));
  assert.equal(chip()?.textContent, 'Selected snack', 'SharedChat hands targetLabel to its timeline');
  assert.deepEqual(calls.at(-1), target);
  assert.doesNotMatch(attributes(chip()), RAW);
  // A new callback, or none then one, takes effect on the rows already drawn.
  await act(async () => ui.render(createElement(Room, { targetLabel: () => 'Replacement label' })));
  assert.equal(chip().textContent, 'Replacement label');
  await act(async () => ui.render(createElement(Room, {})));
  assert.equal(chip().textContent, 'Encas conseillé');
  await act(async () => ui.render(createElement(Room, { targetLabel: () => 'Enabled label' })));
  assert.equal(chip().textContent, 'Enabled label');
});
