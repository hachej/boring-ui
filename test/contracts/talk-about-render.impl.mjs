import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { Window } from 'happy-dom';

const project = fileURLToPath(new URL('../../', import.meta.url));
const out = `${project}.cache/talk-about-render-test`;
mkdirSync(out, { recursive: true });
writeFileSync(`${out}/entry.tsx`, `export { AgentLayerProvider, AgentLayer, AgentDockLayout, useAgentLayer } from '${project}registry/app-shell/agent-layer.tsx';`);
const TOKEN = '@repas:2026-10-27/dejeuner', LABEL = 'Déjeuner · mardi', WORDS = 'Je mange une salade';
let sequence = 0;
async function fixture(t, options = {}) {
  const window = new Window({ url: 'https://fictional.invalid/' });
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: options.width ?? 390 });
  const names = ['window', 'document', 'navigator', 'history', 'location', 'HTMLElement', 'Element', 'Node', 'Event', 'EventTarget', 'KeyboardEvent', 'MouseEvent', 'PointerEvent', 'MutationObserver', 'ResizeObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'matchMedia', 'getSelection', 'IS_REACT_ACT_ENVIRONMENT', 'MediaRecorder'];
  const saved = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  for (const name of names) Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: name === 'window' ? window : name === 'IS_REACT_ACT_ENVIRONMENT' ? true : /^(getComputedStyle|requestAnimationFrame|cancelAnimationFrame|matchMedia|getSelection)$/.test(name) ? window[name].bind(window) : window[name] });
  let permission = 0;
  const tracks = [];
  Object.defineProperty(window.navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: async () => {
    permission++;
    const track = { stopped: false, stop() { this.stopped = true; } }; tracks.push(track);
    return { getTracks: () => [track], getAudioTracks: () => [track] };
  } } });
  class Recorder extends window.EventTarget {
    static isTypeSupported() { return true; }
    constructor() { super(); this.state = 'inactive'; this.mimeType = 'audio/webm'; }
    start() { this.state = 'recording'; }
    stop() { if (this.state === 'inactive') return; this.state = 'inactive'; const event = new window.Event('dataavailable'); event.data = new Blob(['fictional audio']); this.dispatchEvent(event); this.dispatchEvent(new window.Event('stop')); }
  }
  globalThis.MediaRecorder = Recorder;
  const outfile = `${out}/layer-${++sequence}.mjs`;
  await build({ entryPoints: [`${out}/entry.tsx`], outfile, bundle: true, format: 'esm', platform: 'node', jsx: 'automatic', packages: 'external', alias: { '@': `${project}examples/app-shell` }, logLevel: 'silent', plugins: process.env.TALK_MUTATION ? [{ name: 'mutation', setup(builder) { const mutation = JSON.parse(readFileSync(process.env.TALK_MUTATION, 'utf8')); builder.onLoad({ filter: /registry\/.*\.(ts|tsx)$/ }, args => { if (!args.path.endsWith(mutation.file)) return; const source = readFileSync(args.path, 'utf8'); assert.ok(source.includes(mutation.before), 'mutation guard exists'); return { contents: source.replace(mutation.before, mutation.after), loader: args.path.endsWith('tsx') ? 'tsx' : 'ts' }; }); } }] : [] });
  const layer = await import(pathToFileURL(outfile).href);
  const { Harness, MemoryStorage, createRegistry } = await import('@earendil-works/pi-durable');
  const { BACKGROUND_CONTEXT: context } = await import('@earendil-works/chord/context');
  const { createNativeChatController } = await import('@hachej/boring-ui-kit/native-chat');
  const { createFakeChatModel } = await import('@hachej/boring-testing/model');
  const { createElement: h, act } = await import('react');
  const { createRoot } = await import('react-dom/client');
  const fake = createFakeChatModel();
  const native = await Harness.open(new MemoryStorage(), { registry: createRegistry(), models: fake.models }, context);
  const conversation = await native.createConversation({ ownership: { kind: 'ownerless' }, agent: { model: fake.model } }, context);
  const controller = createNativeChatController({ conversation, context, identity: { runtimeId: 'fictional', scopeId: 'fictional', principalId: 'fictional' }, ...(options.refuse ? { validate: () => { throw new Error('Fictional refusal'); } } : {}) });
  await controller.connect();
  let api;
  const sent = [], realSend = controller.send;
  controller.send = (...args) => { sent.push(args); return realSend(...args); };
  const mentions = { search: async () => [], kinds: { repas: { label: path => path === '2026-10-27/dejeuner' ? LABEL : path, icon: h('span', { 'data-testid': 'meal-icon' }, 'meal') } } };
  const spec = { controller, chatProps: { mentions, locale: 'fr' }, ...(options.send ? { voice: { send: options.send, transcribe: async () => WORDS, upload: async () => [{ path: 'uploads/voice-fictional.webm', name: 'voice-fictional.webm' }] } } : {}) };
  function Content() { api = layer.useAgentLayer(); return h(layer.AgentDockLayout, null, h('main', null, 'Fictional meal'), h(layer.AgentLayer)); }
  const mount = document.createElement('div'); document.body.append(mount);
  const ui = createRoot(mount);
  await act(async () => ui.render(h(layer.AgentLayerProvider, { agent: options.noAgent ? undefined : spec, locale: 'fr', agentLink: false }, h(Content))));
  const find = selector => document.querySelector(selector);
  const until = async (predicate, label) => { for (let n = 0; n < 100 && !predicate(); n++) await act(async () => new Promise(resolve => setTimeout(resolve, 15))); assert.ok(predicate(), label); };
  const click = selector => act(async () => find(selector).dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true })));
  t.after(async () => { await act(async () => ui.unmount()); await controller.dispose(); await native.close(context); for (const [name, descriptor] of saved) descriptor ? Object.defineProperty(globalThis, name, descriptor) : delete globalThis[name]; window.close(); });
  const talk = async (token = TOKEN, options = {}) => { let result; await act(async () => { result = api.talkAbout(token, options); }); return result; };
  return { controller, find, until, click, act, talk, api: () => api, permission: () => permission, tracks, sent };
}

test('no agent returns false without changing the layer or requesting a microphone', async t => {
  const f = await fixture(t, { noAgent: true });
  assert.equal(await f.talk(TOKEN, { voice: true }), false);
  assert.equal(f.api().state, 'closed'); assert.equal(f.api().showing, null); assert.equal(f.permission(), 0);
});
for (const width of [390, 1280]) test(`talkAbout at ${width}: half sheet or panel, kind chip, replacement and removal`, async t => {
  const f = await fixture(t, { width });
  assert.equal(await f.talk(), true);
  assert.equal(f.api().state, width === 390 ? 'half' : 'open');
  assert.equal(f.controller.getSnapshot().draft.text.trim(), TOKEN);
  assert.equal(f.find('[data-testid=mention-chip]')?.textContent.includes(LABEL), true);
  assert.ok(f.find('[data-testid=mention-chip] [data-testid=meal-icon]'));
  await f.act(async () => f.controller.setText(`${TOKEN} my words @docs/plan.md`));
  await f.talk('@repas:2026-10-28/diner');
  assert.equal(f.controller.getSnapshot().draft.text.includes(TOKEN), false);
  assert.match(f.controller.getSnapshot().draft.text, /my words @docs\/plan.md/);
  await f.click('[data-testid=mention-chip] button');
  assert.equal(f.controller.getSnapshot().draft.text.includes('@repas:'), false);
});
for (const send of ['draft', 'auto', 'message']) test(`${send}: synchronous gesture capture, recording bar cancel and finish, native mention delivery`, async t => {
  const f = await fixture(t, { send });
  await f.act(async () => {
    assert.equal(f.api().talkAbout(TOKEN, { voice: true }), true);
    assert.equal(f.permission(), 1, 'permission requested before talkAbout returns');
  });
  await f.until(() => f.find('[data-testid=agent-recording]')?.getAttribute('data-phase') === 'recording', 'recording bar');
  assert.match(f.find('[data-testid=agent-recording]').textContent, /Enregistrement 0:00/);
  await f.click('[data-testid=agent-recording-cancel]');
  assert.equal(f.sent.length, 0); assert.ok(f.tracks.every(track => track.stopped));
  await f.talk(TOKEN, { voice: true, at: 'full' });
  await f.until(() => f.find('[data-testid=agent-recording]')?.getAttribute('data-phase') === 'recording', 'recording again');
  assert.equal(f.api().state, 'full');
  await f.click('[data-testid=agent-recording-send]');
  if (send === 'draft') {
    await f.until(() => f.controller.getSnapshot().draft.text.includes(WORDS), 'dictation fills draft');
    assert.match(f.controller.getSnapshot().draft.text, /@repas:/);
    await f.click('[data-testid=composer-submit]');
  }
  await f.until(() => f.sent.length === 1 && f.controller.getSnapshot().send.kind === 'admitted', 'native admission');
  assert.equal(f.controller.getSnapshot().draft.text, '');
  await f.until(() => f.find('[data-testid=message-mention]')?.textContent.includes(LABEL), 'sent kind mention');
  assert.ok(f.find('[data-testid=user-text]')?.textContent.includes(WORDS));
  if (send === 'message') assert.ok(f.find('[data-testid=voice-play]'), 'mention prefix preserves audio rendering');
});
for (const send of ['typed', 'draft', 'auto', 'message']) test(`${send}: failed native send restores words without the card token`, async t => {
  const f = await fixture(t, { send: send === 'typed' ? undefined : send, refuse: true });
  await f.talk(TOKEN, { voice: send !== 'typed' });
  if (send === 'typed') await f.act(async () => f.controller.setText(`${TOKEN} ${WORDS}`));
  else {
    await f.until(() => f.find('[data-testid=agent-recording]')?.getAttribute('data-phase') === 'recording', 'recording');
    await f.click('[data-testid=agent-recording-send]');
    if (send === 'draft') await f.until(() => f.controller.getSnapshot().draft.text.includes(WORDS), 'dictation');
  }
  if (send === 'typed' || send === 'draft') await f.click('[data-testid=composer-submit]');
  await f.until(() => f.sent.length === 1 && f.controller.getSnapshot().draft.text.includes(WORDS), 'words restored');
  assert.equal(f.controller.getSnapshot().draft.text.includes('@repas:'), false);
  assert.equal(f.find('[data-testid=mention-chip]'), null);
});
