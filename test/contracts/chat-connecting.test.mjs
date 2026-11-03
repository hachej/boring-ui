import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { Window } from 'happy-dom';

// D-1434 (Agent usable while chat connects): `useRemoteChat` hands out its controller while connecting, the PiChat composer takes
// messages before the host's first view lands, shows them as the person's own and sends them, in order, once connected.
const root = fileURLToPath(new URL('../../', import.meta.url));
const out = `${root}.cache/chat-connecting-test`;
mkdirSync(out, { recursive: true });
writeFileSync(`${out}/entry.tsx`, `
  import { createElement as h } from 'react';
  import { PiChat } from '${root}registry/pi-chat/pi-chat.tsx';
  import { useRemoteChat } from '${root}registry/pi-chat/use-remote-chat.ts';
  // A host that shows the chat as soon as it has a controller (the new contract), and its status beside it.
  export function Host({ fetch, onState }) {
    const chat = useRemoteChat({ conversationId: 'c1', endpoint: id => new URL('https://fixture.invalid/chat?c=' + id), fetch,
      identity: { runtimeId: 'r', scopeId: 's', principalId: 'p' } });
    onState(chat);
    return h('main', { 'data-status': chat.status }, chat.controller ? h(PiChat, { controller: chat.controller, actions: chat.actions }) : null);
  }`);
await build({ entryPoints: [`${out}/entry.tsx`], outfile: `${out}/entry.mjs`, bundle: true, format: 'esm', platform: 'node', jsx: 'automatic', packages: 'external', logLevel: 'silent' });

const user = (id, text) => ({ id, kind: 'message', byTaskId: id, model: [{ role: 'user', content: text, timestamp: id }] });
const reply = (id, text) => ({ id, kind: 'message', byTaskId: id, model: [{ role: 'assistant', content: [{ type: 'text', text }], api: 'fictional', provider: 'fictional', model: 'fictional', usage: {}, stopReason: 'stop', timestamp: id }] });
const view = entries => ({ conversation: { id: 'c1' }, entries, docs: {} });
const line = frame => new TextEncoder().encode(JSON.stringify(frame) + '\n');

async function fixture(t) {
  const window = new Window({ url: 'https://fictional.invalid/', width: 1200, height: 800 });
  const names = ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Text', 'MutationObserver', 'ResizeObserver', 'IntersectionObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'addEventListener', 'removeEventListener', 'localStorage', 'IS_REACT_ACT_ENVIRONMENT'];
  const saved = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  for (const name of names) {
    const value = name === 'window' ? window : name === 'IS_REACT_ACT_ENVIRONMENT' ? true : window[name];
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: typeof value === 'function' && /^[a-z]/.test(name) ? value.bind(window) : value });
  }
  const { Host } = await import(`${pathToFileURL(`${out}/entry.mjs`).href}?${Date.now()}`);
  const { act, createElement: h } = await import('react');
  const { createRoot } = await import('react-dom/client');
  const element = window.document.createElement('div'); window.document.body.append(element);
  const ui = createRoot(element);
  t.after(async () => { await act(async () => ui.unmount()); await window.happyDOM.close(); for (const [name, descriptor] of saved) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; } });
  const settle = (ms = 20) => act(async () => { await new Promise(resolve => setTimeout(resolve, ms)); });
  return { act, h, element, ui, settle };
}
/** Types in the composer the way a person does (React reads the native input event) and presses Send. */
async function type(f, text) {
  const textarea = f.element.querySelector('[data-testid="composer-input"]');
  assert.ok(textarea, 'the composer is there');
  assert.equal(textarea.disabled, false, 'the composer is enabled');
  await f.act(async () => {
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(textarea), 'value').set.call(textarea, text);
    textarea.dispatchEvent(new globalThis.window.Event('input', { bubbles: true }));
  });
  const submit = f.element.querySelector('[data-testid="composer-submit"]');
  assert.equal(submit.disabled, false, `Send is enabled for « ${text} »`);
  await f.act(async () => { submit.closest('form').requestSubmit(); });
}
/** The person's rows on screen: their send state, and which expected text each one shows (a row also holds clocks and actions). */
const userRows = (element, texts) => [...element.querySelectorAll('[data-role="user"]')].map(row => ({ text: texts.find(text => row.textContent.includes(text)) ?? row.textContent, state: row.getAttribute('data-send-state') }));
const asked = ['Deuxième question', 'Message important', 'Bonjour'];

test('with a slow watch the composer is usable at once; messages queued before the first view are sent once connected, in order, and answered', async t => {
  const f = await fixture(t);
  const submits = [], states = [];
  let stream, openWatch;
  const watching = new Promise(resolve => { openWatch = resolve; });
  const fetch = async request => {
    const op = new URL(request.url).searchParams.get('op');
    if (op === 'watch') {
      openWatch();
      return new Response(new ReadableStream({ start(controller) { stream = controller; } }), { headers: { 'content-type': 'application/x-ndjson' } });
    }
    if (op === 'submit') { const body = await request.json(); submits.push(body.content); return Response.json({ submissionId: submits.length }); }
    return new Response('{}', { status: 404 });
  };
  const started = performance.now();
  await f.act(async () => f.ui.render(f.h(Host, { fetch, onState: state => states.push(state) })));
  await watching; await f.settle();
  // The host has not sent its view yet: the chat is connecting, yet it has its controller and its composer takes messages.
  assert.equal(f.element.querySelector('main').getAttribute('data-status'), 'connecting');
  assert.ok(states.at(-1).controller, 'the controller is handed out while connecting');
  assert.equal(f.element.querySelector('[data-boring="pi-chat"]').getAttribute('data-connection'), 'connecting');
  await type(f, 'Bonjour');
  await type(f, 'Deuxième question');
  const usable = performance.now() - started;
  assert.ok(usable < 2000, `composer usable and two messages queued within 2 s (took ${Math.round(usable)} ms)`);
  assert.deepEqual(userRows(f.element, asked), [{ text: 'Bonjour', state: 'sending' }, { text: 'Deuxième question', state: 'sending' }], 'queued messages show at once as the person\'s own');
  assert.equal(f.element.querySelector('[data-testid="loading"]'), null, 'no loading cover over the queued messages');
  assert.deepEqual(submits, [], 'nothing is sent before the connection is up');

  // The first view lands; it already holds an earlier « Bonjour » of this person, which must not swallow the new one.
  await f.act(async () => stream.enqueue(line({ kind: 'view', view: view([user(1, 'Bonjour'), reply(2, 'Salut !')]) })));
  await f.settle(50);
  assert.equal(states.at(-1).status, 'ready');
  assert.deepEqual(submits, ['Bonjour', 'Deuxième question'], 'sent exactly once each, in order, after connect');
  assert.match(f.element.querySelector('[data-testid="transcript"]').textContent, /Salut !/, 'the transcript renders from the first view');
  assert.deepEqual(userRows(f.element, asked).map(row => row.state), [null, 'sending', 'sending'], 'the new messages stay shown until the server has them');

  // The fake model answers: the server's copies replace the echoes, with no duplicate.
  await f.act(async () => stream.enqueue(line({ kind: 'view', view: view([user(1, 'Bonjour'), reply(2, 'Salut !'), user(3, 'Bonjour'), user(4, 'Deuxième question'), reply(5, 'Voici ma réponse.')]) })));
  await f.settle(50);
  assert.deepEqual(userRows(f.element, asked), [{ text: 'Bonjour', state: null }, { text: 'Bonjour', state: null }, { text: 'Deuxième question', state: null }]);
  assert.match(f.element.querySelector('[data-testid="transcript"]').textContent, /Voici ma réponse\./);
  assert.equal(submits.length, 2);
});

test('a failed connect keeps the queued message: never sent, it comes back in the next attempt\'s composer', async t => {
  const f = await fixture(t);
  const submits = [], states = [];
  let attempts = 0, refuse, openWatch;
  const watching = new Promise(resolve => { openWatch = resolve; });
  const fetch = async request => {
    const op = new URL(request.url).searchParams.get('op');
    if (op === 'watch') {
      attempts++; openWatch();
      // The first attempt waits, then the host fails; the next one connects at once.
      if (attempts > 1) return new Response(line({ kind: 'view', view: view([]) }), { headers: { 'content-type': 'application/x-ndjson' } });
      return new Promise(resolve => { refuse = () => resolve(new Response('{"reason":"fictional outage"}', { status: 503 })); });
    }
    if (op === 'submit') { submits.push(await request.json()); return Response.json({ submissionId: submits.length }); }
    return new Response('{}', { status: 404 });
  };
  await f.act(async () => f.ui.render(f.h(Host, { fetch, onState: state => states.push(state) })));
  await watching; await f.settle();
  await type(f, 'Message important');
  assert.deepEqual(userRows(f.element, asked), [{ text: 'Message important', state: 'sending' }]);
  await f.act(async () => refuse());
  await f.settle(50);
  assert.equal(states.at(-1).status, 'offline', 'a failed connect reads offline, as before');
  assert.equal(states.at(-1).controller, undefined);
  // The hook retries after a second with a new controller: the message is back in its composer, not sent, for the person to send again.
  await f.settle(1200);
  assert.equal(states.at(-1).status, 'ready'); assert.equal(attempts, 2);
  assert.equal(f.element.querySelector('[data-testid="composer-input"]').value, 'Message important');
  assert.deepEqual(userRows(f.element, asked), []);
  assert.deepEqual(submits, []);
});
