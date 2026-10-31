import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { Window } from 'happy-dom';

const project = fileURLToPath(new URL('../../', import.meta.url));
const out = `${project}.cache/talk-about-render-test`;
mkdirSync(out, { recursive: true });
writeFileSync(`${out}/entry.tsx`, `export { AgentLayerProvider, AgentLayer, AgentDockLayout, useAgentLayer } from '${project}registry/app-shell/agent-layer.tsx'; export { PiChat } from '${project}registry/pi-chat/pi-chat.tsx'; export { voiceMessagePlugin } from '${project}registry/pi-chat-voice/voice-message.tsx';`);
const TOKEN = '@repas:2026-10-27/dejeuner', LABEL = 'Déjeuner · mardi', WORDS = 'Je mange une salade';
let sequence = 0;
async function fixture(t, options = {}) {
  const window = new Window({ url: 'https://fictional.invalid/' });
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: options.width ?? 390 });
  const names = ['window', 'document', 'navigator', 'history', 'location', 'HTMLElement', 'Element', 'Node', 'Event', 'EventTarget', 'KeyboardEvent', 'MouseEvent', 'PointerEvent', 'MutationObserver', 'ResizeObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'matchMedia', 'getSelection', 'IS_REACT_ACT_ENVIRONMENT', 'MediaRecorder', 'AudioContext'];
  const saved = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  for (const name of names) Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: name === 'window' ? window : name === 'IS_REACT_ACT_ENVIRONMENT' ? true : /^(getComputedStyle|requestAnimationFrame|cancelAnimationFrame|matchMedia|getSelection)$/.test(name) ? window[name].bind(window) : window[name] });
  let permission = 0;
  const tracks = [];
  Object.defineProperty(window.navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: async () => {
    permission++;
    if (options.permission) await options.permission;
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
  let audioNode;
  const contexts = [];
  if (options.pcm) globalThis.AudioContext = class {
    constructor() { this.sampleRate = 48000; this.state = 'suspended'; this.destination = {}; contexts.push(this); }
    resume() { this.state = 'running'; return Promise.resolve(); }
    close() { this.state = 'closed'; return Promise.resolve(); }
    createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
    createScriptProcessor() { audioNode = { onaudioprocess: null, connect() {}, disconnect() {} }; return audioNode; }
  };

  const outfile = `${out}/layer-${++sequence}.mjs`;
  await build({ entryPoints: [`${out}/entry.tsx`], outfile, bundle: true, format: 'esm', platform: 'node', jsx: 'automatic', packages: 'external', alias: { '@': `${project}examples/app-shell`, '@hachej/boring-ui-kit/file-tree.css': `${project}packages/ui/styles/file-tree.css` }, logLevel: 'silent', plugins: process.env.TALK_MUTATION ? [{ name: 'mutation', setup(builder) { const mutation = JSON.parse(readFileSync(process.env.TALK_MUTATION, 'utf8')); builder.onLoad({ filter: /registry\/.*\.(ts|tsx)$/ }, args => { if (!args.path.endsWith(mutation.file)) return; const source = readFileSync(args.path, 'utf8'); assert.ok(source.includes(mutation.before), 'mutation guard exists'); return { contents: source.replace(mutation.before, mutation.after), loader: args.path.endsWith('tsx') ? 'tsx' : 'ts' }; }); } }] : [] });
  const layer = await import(pathToFileURL(outfile).href);
  const { Harness, MemoryStorage, createRegistry } = await import('@earendil-works/pi-durable');
  const { BACKGROUND_CONTEXT: context } = await import('@earendil-works/chord/context');
  const { createNativeChatController } = await import('@hachej/boring-ui-kit/native-chat');
  const { createFakeChatModel } = await import('@hachej/boring-testing/model');
  const { createElement: h, act, StrictMode, Fragment } = await import('react');
  const { createRoot } = await import('react-dom/client');
  const fake = createFakeChatModel();
  const native = await Harness.open(new MemoryStorage(), { registry: createRegistry(), models: fake.models }, context);
  const conversation = await native.createConversation({ ownership: { kind: 'ownerless' }, agent: { model: fake.model } }, context);
  const controller = createNativeChatController({ conversation, context, identity: { runtimeId: 'fictional', scopeId: 'fictional', principalId: 'fictional' }, ...(options.refuse ? { beforeSubmit: async () => 'Fictional refusal' } : {}) });
  await controller.connect();
  let api;
  const sent = [], realSend = controller.send;
  controller.send = (...args) => { sent.push(args); if (options.throwSend) throw new Error('Fictional thrown send'); return realSend(...args); };
  const opened = [], captured = [];
  const transcribe = async audio => { captured.push(audio); return WORDS; };
  const upload = async () => [{ path: 'uploads/voice-fictional.webm', name: 'voice-fictional.webm' }];
  const mentions = { search: async () => [], kinds: { repas: { label: path => path === '2026-10-27/dejeuner' ? LABEL : path, icon: h('span', { 'data-testid': 'meal-icon' }, 'meal'), ...(options.open ? { open: path => opened.push(path) } : {}), ...(options.renderSent ? { renderSent: path => h('em', { 'data-testid': 'custom-meal' }, path) } : {}) } } };
  const spec = { controller, chatProps: { mentions, locale: 'fr', voiceReplay: options.replay,  ...(options.upload ? { attachments: { upload: options.upload }, pasteToFile: { minChars: 4 } } : {}), ...(options.slash ? { slash: options.slash } : {}) }, ...(options.send ? { voice: { send: options.send, transcribe, upload } } : {}) };
  function Content() { api = layer.useAgentLayer(); if (options.nativeVoice) return h(layer.PiChat, { controller, locale: 'fr', mentions, voiceMessage: { ...layer.voiceMessagePlugin, transcribe, upload } }); return h(layer.AgentDockLayout, null, h('main', null, 'Fictional meal'), h(layer.AgentLayer)); }
  const mount = document.createElement('div'); document.body.append(mount);
  const ui = createRoot(mount);
  await act(async () => ui.render(h(options.strict ? StrictMode : Fragment, null, h(layer.AgentLayerProvider, { agent: options.noAgent ? undefined : spec, locale: 'fr', agentLink: false }, h(Content)))));
  const find = selector => document.querySelector(selector);
  const until = async (predicate, label) => { for (let n = 0; n < 100 && !predicate(); n++) await act(async () => new Promise(resolve => setTimeout(resolve, 15))); assert.ok(predicate(), label); };
  const input = value => act(async () => { const element = find('[data-testid=composer-input]'); Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(element, value); element.setSelectionRange(value.length, value.length); element.dispatchEvent(new window.Event('input', { bubbles: true })); element.dispatchEvent(new window.Event('change', { bubbles: true })); });
  const click = selector => act(async () => find(selector).dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true })));
  t.after(async () => { await act(async () => window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))); await act(async () => ui.unmount()); await controller.dispose(); await native.close(context); for (const [name, descriptor] of saved) descriptor ? Object.defineProperty(globalThis, name, descriptor) : delete globalThis[name]; window.close(); });
  const talk = async (token = TOKEN, options = {}) => { let result; await act(async () => { result = api.talkAbout(token, options); }); return result; };
  const paste = (value, start, end) => act(async () => {
    const element = find('[data-testid=composer-input]'); element.setSelectionRange(start, end);
    const event = new window.Event('paste', { bubbles: true, cancelable: true });
    event.clipboardData = { files: [], getData: () => value }; element.dispatchEvent(event);
  });
  const feed = async (value, length = 48000) => {
    await until(() => audioNode?.onaudioprocess, 'PCM node ready');
    await act(async () => audioNode.onaudioprocess({ inputBuffer: { getChannelData: () => new Float32Array(length).fill(value) } }));
  };
  return { controller, find, until, click, act, talk, feed, contexts, captured, api: () => api, permission: () => permission, tracks, sent, opened, input, paste };
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
for (const send of ['draft', 'auto', 'message']) test(`${send}: synchronous gesture capture, composer mic cancel and tap finish, native mention delivery`, async t => {
  const f = await fixture(t, { send });
  await f.act(async () => {
    assert.equal(f.api().talkAbout(TOKEN, { voice: true }), true);
    assert.equal(f.permission(), 1, 'permission requested before talkAbout returns');
  });
  await f.until(() => f.find('[data-testid=agent-talk]')?.getAttribute('data-state') === 'recording', 'composer recording status');
  assert.match(f.find('[data-testid=voice-recording]').textContent, /Enregistrement 0:00/);
  assert.equal(Boolean(f.find('[data-testid=agent-recording]')), false, 'no separate recording bar');
  assert.ok(f.find('[data-testid=composer]').contains(f.find('[data-testid=voice-recording]')));
  assert.ok(f.find('[data-testid=composer]').contains(f.find('[data-testid=composer-voice-cancel]')));
  await f.click('[data-testid=composer-voice-cancel]');
  assert.equal(f.sent.length, 0); assert.ok(f.tracks.every(track => track.stopped));
  await f.talk(TOKEN, { voice: true, at: 'full' });
  await f.act(async () => f.controller.setText(`${f.controller.getSnapshot().draft.text}@docs/plan.md `));
  await f.until(() => f.find('[data-testid=agent-talk]')?.getAttribute('data-state') === 'recording', 'recording again');
  assert.equal(f.api().state, 'full');
  await f.click('[data-testid=agent-talk]');
  if (send === 'draft') {
    await f.until(() => f.controller.getSnapshot().draft.text.includes(WORDS), 'dictation fills draft');
    assert.match(f.controller.getSnapshot().draft.text, /@repas:/);
    await f.click('[data-testid=composer-submit]');
  }
  await f.until(() => f.sent.length === 1 && f.controller.getSnapshot().send.kind === 'admitted', 'native admission');
  assert.equal(f.controller.getSnapshot().draft.text, '');
  assert.ok(f.sent[0][1].text.includes('@docs/plan.md'), 'draft file mentions travel alongside card mentions');
  await f.until(() => f.find('[data-testid=message-mention]')?.textContent.includes(LABEL), 'sent kind mention');
  assert.ok(f.find('[data-testid=user-text]')?.textContent.includes(WORDS));
  if (send === 'message') {
    assert.ok(f.find('[data-testid=voice-bubble]'), 'retained voice renders its transcript');
    assert.equal(Boolean(f.find('[data-testid=voice-play], [data-testid=voice-duration], [data-testid=voice-bubble] audio')), false, 'default voice has no player');
  }
});
test('voice replay renders only with explicit presentation opt-in', async t => {
  const f = await fixture(t, { send: 'message', replay: true });
  await f.talk(TOKEN, { voice: true });
  await f.until(() => f.find('[data-testid=agent-talk]')?.dataset.state === 'recording', 'recording');
  await f.click('[data-testid=agent-talk]');
  await f.until(() => f.find('[data-testid=voice-bubble]'), 'retained voice message');
  assert.ok(f.find('[data-testid=user-text]').textContent.includes(WORDS));
  assert.ok(f.find('[data-testid=voice-play]'));
  assert.ok(f.find('[data-testid=voice-duration]'));
  assert.ok(f.find('[data-testid=voice-bubble] audio'));
});

test('ordinary composer tap uses the same replacement row as card-started capture and Escape discards', async t => {
  const f = await fixture(t, { send: 'message' });
  await f.talk(); await f.click('[data-testid=agent-talk]');
  await f.until(() => f.find('[data-testid=agent-talk]')?.dataset.state === 'recording', 'ordinary tap recording');
  assert.ok(f.find('[data-testid=voice-recording-bar]'));
  assert.equal(Boolean(f.find('[data-testid=composer-input]')), false);
  assert.ok(f.find('[data-testid=composer-voice-cancel]'));
  await f.act(async () => window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  assert.ok(f.tracks.every(track => track.stopped)); assert.equal(f.sent.length, 0);
});

for (const throwSend of [false, true]) for (const send of ['typed', 'draft', 'auto', 'message']) test(`${send}: ${throwSend ? 'thrown' : 'refused'} native send restores words without the card token`, async t => {
  const f = await fixture(t, { send: send === 'typed' ? undefined : send, refuse: !throwSend, throwSend });
  await f.talk(TOKEN, { voice: send !== 'typed' });
  if (send === 'typed') await f.act(async () => f.controller.setText(`${TOKEN} ${WORDS}`));
  else {
    await f.until(() => f.find('[data-testid=agent-talk]')?.getAttribute('data-state') === 'recording', 'recording');
    await f.click('[data-testid=agent-talk]');
    if (send === 'draft') await f.until(() => f.controller.getSnapshot().draft.text.includes(WORDS), 'dictation');
  }
  if (send === 'typed' || send === 'draft') await f.click('[data-testid=composer-submit]');
  await f.until(() => f.sent.length === 1 && f.controller.getSnapshot().draft.text.includes(WORDS), 'words restored');
  assert.equal(f.controller.getSnapshot().draft.text.includes('@repas:'), false);
  assert.equal(Boolean(f.find('[data-testid=mention-chip]')), false);
});

for (const reason of ['Escape', 'blur', 'hidden']) test(`card-started composer recording keeps ${reason} cancellation`, async t => {
  const f = await fixture(t, { send: 'message' });
  await f.talk(TOKEN, { voice: true });
  await f.until(() => f.find('[data-testid=agent-talk]')?.getAttribute('data-state') === 'recording', 'recording');
  await f.act(async () => {
    if (reason === 'Escape') window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    else if (reason === 'blur') window.dispatchEvent(new window.Event('blur'));
    else { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new window.Event('visibilitychange')); }
  });
  assert.ok(f.tracks.every(track => track.stopped));
  assert.equal(f.sent.length, 0);
  assert.equal(Boolean(f.find('[data-testid=composer-voice-cancel]')), false);
});

test('StrictMode keeps the first card-gesture recording alive until explicit cancel', async t => {
  const f = await fixture(t, { send: 'message', strict: true });
  await f.talk(TOKEN, { voice: true });
  await f.until(() => f.find('[data-testid=agent-talk]')?.getAttribute('data-state') === 'recording', 'recording survives effect replay');
  assert.equal(f.permission(), 1);
  assert.ok(f.tracks.every(track => !track.stopped));
  await f.click('[data-testid=composer-voice-cancel]');
  assert.ok(f.tracks.every(track => track.stopped));
});

for (const send of ['auto', 'message']) for (const refuse of [false, true]) test(`${send}: repeated draft tokens are consumed on ${refuse ? 'refusal' : 'admission'}`, async t => {
  const f = await fixture(t, { send, refuse });
  await f.talk(TOKEN, { voice: true });
  await f.act(async () => f.controller.setText(`${TOKEN} ${TOKEN} @docs/plan.md @docs/plan.md `));
  await f.until(() => f.find('[data-testid=agent-talk]')?.getAttribute('data-state') === 'recording', 'recording');
  await f.click('[data-testid=agent-talk]');
  await f.until(() => f.sent.length === 1 && f.controller.getSnapshot().send.kind === (refuse ? 'blocked' : 'admitted'), 'native send settles');
  assert.equal(f.controller.getSnapshot().draft.text.trim(), refuse ? WORDS : '');
  assert.equal(Boolean(f.find('[data-testid=mention-chip]')), false, 'no duplicate card chip survives');
});

test('typed send renders a quoted kind beside an unchanged file mention, and its opener receives the kind path', async t => {
  const f = await fixture(t, { open: true });
  const path = 'Meeting "notes"';
  await f.talk('@"repas:Meeting \\"notes\\""');
  assert.ok(f.find('[data-testid=mention-chip]').textContent.includes(path));
  await f.act(async () => f.controller.setText(`${f.controller.getSnapshot().draft.text} ${WORDS} @docs/plan.md`));
  await f.click('[data-testid=composer-submit]');
  await f.until(() => f.find('[data-testid="message-mention"][data-path="docs/plan.md"]'), 'file mention still rendered');
  assert.equal(f.find('[data-testid="message-mention"][data-path="docs/plan.md"]').textContent, '@docs/plan.md');
  const kind = [...document.querySelectorAll('[data-testid=message-mention]')].find(element => element.dataset.path.startsWith('repas:'));
  const file = f.find('[data-testid="message-mention"][data-path="docs/plan.md"]');
  for (const mention of [kind, file]) {
    assert.ok(mention.classList.contains('inline-flex') && mention.classList.contains('align-middle'), 'sent card and file mentions share text-line alignment');
    assert.equal(mention.tagName, 'SPAN', 'inline mentions do not add a padded control height');
  }
  await f.act(async () => kind.click());
  assert.deepEqual(f.opened, [path]);
  assert.equal(f.controller.getSnapshot().draft.text, '');
});

test('a kind renderSent overrides only sent presentation, not the composer chip', async t => {
  const f = await fixture(t, { renderSent: true });
  await f.talk();
  assert.ok(f.find('[data-testid=mention-chip]').textContent.includes(LABEL));
  assert.equal(Boolean(f.find('[data-testid=custom-meal]')), false);
  await f.click('[data-testid=composer-submit]');
  await f.until(() => f.find('[data-testid=custom-meal]'), 'custom sent renderer');
  assert.equal(f.find('[data-testid=custom-meal]').textContent, '2026-10-27/dejeuner');
});

test('removing the card while recording removes it from the eventual audio message', async t => {
  const f = await fixture(t, { send: 'message' });
  await f.talk(TOKEN, { voice: true });
  await f.until(() => f.find('[data-testid=agent-talk]')?.getAttribute('data-state') === 'recording', 'recording');
  await f.click('[data-testid=mention-chip] button');
  await f.click('[data-testid=agent-talk]');
  await f.until(() => f.find('[data-testid=voice-bubble]'), 'audio message');
  assert.equal(Boolean(f.find('[data-testid=message-mention]')), false, 'removed chip cannot travel in the send');
  assert.equal(f.sent[0][1].text.includes(TOKEN), false);
});

for (const send of [undefined, 'message']) test(`focus without capture when ${send ? 'voice option is off' : 'agent has no voice config'}`, async t => {
  const f = await fixture(t, { send });
  await f.talk(TOKEN, { voice: !send });
  await f.until(() => document.activeElement?.getAttribute('data-testid') === 'composer-input', 'composer focused');
  assert.equal(f.permission(), 0);
});

for (const width of [390, 1280]) test(`kind tokens at ${width} are chip-only while edits and file tokens reach native send`, async t => {
  const f = await fixture(t, { width });
  await f.talk();
  assert.equal(f.find('[data-testid=composer-input]').value, '', 'kind code hidden from textarea value');
  assert.equal(f.find('[data-testid=composer]').textContent.includes(TOKEN), false);
  assert.equal(f.controller.getSnapshot().draft.text.trim(), TOKEN);
  await f.input('My words @docs/plan.md');
  assert.equal(f.find('[data-testid=composer-input]').value, 'My words @docs/plan.md', 'file text unchanged');
  assert.ok(f.controller.getSnapshot().draft.text.includes(TOKEN), 'editing preserves hidden token in native draft');
  await f.click('[data-testid=composer-submit]');
  await f.until(() => f.controller.getSnapshot().send.kind === 'admitted', 'native send');
  assert.ok(f.sent[0][1].text.includes(TOKEN));
  assert.ok(f.sent[0][1].text.includes('My words @docs/plan.md'));
});

test('hidden kind tokens preserve IME input and native send', async t => {
  const f = await fixture(t);
  await f.talk();
  const element = f.find('[data-testid=composer-input]');
  await f.act(async () => element.dispatchEvent(new window.Event('compositionstart', { bubbles: true })));
  await f.input('déjeuner 😀');
  await f.act(async () => element.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', keyCode: 229, isComposing: true, bubbles: true })));
  assert.equal(f.sent.length, 0);
  assert.equal(element.value, 'déjeuner 😀');
  await f.act(async () => element.dispatchEvent(new window.Event('compositionend', { bubbles: true })));
  await f.click('[data-testid=composer-submit]');
  await f.until(() => f.controller.getSnapshot().send.kind === 'admitted', 'native send');
  assert.ok(f.sent[0][1].text.includes('déjeuner 😀'));
  assert.ok(f.sent[0][1].text.includes(TOKEN));
});

test('async slash edits use current hidden kind tokens and never restore a removed chip', async t => {
  let command;
  const f = await fixture(t, { slash: { commands: [{ name: 'revise', run: api => new Promise(resolve => { command = { api, resolve }; }) }] } });
  await f.talk();
  await f.input('/rev');
  await f.until(() => f.find('[data-testid=slash-item]'), 'slash menu uses projected text');
  await f.act(async () => f.find('[data-testid=slash-item]').dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, cancelable: true })));
  assert.ok(command);
  assert.ok(f.controller.getSnapshot().draft.text.includes(TOKEN));
  await f.click('[data-testid=mention-chip] button');
  await f.act(async () => { command.api.setText('Late fictional words'); command.resolve(); });
  assert.equal(f.find('[data-testid=composer-input]').value, 'Late fictional words');
  assert.equal(f.controller.getSnapshot().draft.text, 'Late fictional words');
  assert.equal(Boolean(f.find('[data-testid=mention-chip]')), false);
});

test('a selected registered skill stays leading with hidden kind tokens in the native submission', async t => {
  const f = await fixture(t, { slash: { skills: [{ name: 'plan', description: 'Fictional planning' }] } });
  await f.talk('@"repas:Meeting notes"');
  await f.input('/pla');
  await f.until(() => f.find('[data-testid=slash-item]'), 'registered skill is offered');
  await f.act(async () => f.find('[data-testid=slash-item]').dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, cancelable: true })));
  assert.equal(f.find('[data-testid=composer-input]').value, '/plan ');
  await f.input('/plan @docs/plan.md @"');
  await f.click('[data-testid=composer-submit]');
  await f.until(() => f.controller.getSnapshot().send.kind === 'admitted', 'native skill submission');
  const { pieces, mentionedPaths } = await import('@hachej/boring-ui-kit/chat-text');
  const text = f.sent[0][1].text;
  assert.equal(pieces(text, { mentions: true, skills: ['plan'] })[0].kind, 'skill', 'the selected skill remains an explicit leading request');
  assert.deepEqual(mentionedPaths(text), ['repas:Meeting notes', 'docs/plan.md']);
  await f.until(() => f.find('[data-testid=message-skill]'), 'sent skill remains styled');
});

test('paste-to-file and restoration keep a registered leading skill ahead of hidden kinds', async t => {
  const f = await fixture(t, { slash: { skills: [{ name: 'plan', description: 'Fictional planning' }] }, upload: async () => new Promise(() => {}) });
  await f.talk();
  const text = '/plan before REMOVE after @docs/plan.md';
  await f.input(text);
  await f.paste('pasted fictional text', text.indexOf('REMOVE'), text.indexOf('REMOVE') + 6);
  await f.until(() => f.find('[data-testid=upload-chip]'), 'paste upload pending');
  assert.match(f.controller.getSnapshot().draft.text, /^\/plan @repas:/, 'paste retains explicit skill');
  await f.click('[data-testid=upload-chip] button');
  assert.match(f.controller.getSnapshot().draft.text, /^\/plan @repas:/, 'restoration retains explicit skill');
  assert.equal(f.find('[data-testid=composer-input]').value, '/plan before pasted fictional text after @docs/plan.md');
});

test('recording trash remounts an unchanged multiline draft with textarea sizing initialized', async t => {
  const f = await fixture(t, { nativeVoice: true });
  const text = 'Fictional first line\nFictional second line\nFictional third line';
  await f.act(async () => f.controller.setText(text));
  const before = f.find('[data-testid=composer-input]');
  assert.notEqual(before.style.height, '', 'initial sizing is applied');
  await f.click('[data-testid=voice-message-record]');
  await f.until(() => f.find('[data-testid=voice-message-record]')?.dataset.state === 'recording', 'recording');
  await f.click('[data-testid=composer-voice-cancel]');
  const after = f.find('[data-testid=composer-input]');
  assert.notEqual(after, before, 'the textarea remounted');
  assert.equal(after.value, text);
  assert.equal(after.style.height, before.style.height, 'sizing initialized again without a text edit');
});

for (const send of ['draft', 'auto', 'native']) test(`${send}: capped public recording bar freezes after the last captured PCM samples and still sends`, async t => {
  const f = await fixture(t, { send: send === 'native' ? 'message' : send, pcm: true, nativeVoice: send === 'native' });
  const mic = send === 'native' ? '[data-testid=voice-message-record]' : '[data-testid=agent-talk]';
  if (send !== 'native') await f.talk();
  await f.click(mic); await f.feed(0.25);
  await f.until(() => f.find('[data-testid=voice-waveform] span')?.dataset.level === '0.25', 'initial captured level');
  await f.feed(0.5, 48000 * 301);
  await f.until(() => f.find('[data-testid=voice-recording]')?.textContent.includes('5:00'), 'sample cap is shown');
  assert.ok(f.tracks.every(track => track.stopped), 'cap releases the microphone');
  assert.equal(Boolean(f.find('[data-testid=voice-pause]')), false, 'ended capture cannot pause');
  const bars = f.find('[data-testid=voice-waveform]').innerHTML;
  await f.act(async () => new Promise(resolve => setTimeout(resolve, 350)));
  assert.equal(f.find('[data-testid=voice-waveform]').innerHTML, bars, 'no new waveform bars without new samples');
  assert.match(f.find('[data-testid=voice-recording]').textContent, /5:00/);
  await f.click(mic);
  if (send === 'draft') { await f.until(() => f.controller.getSnapshot().draft.text.includes(WORDS), 'capped draft transcribed'); await f.click('[data-testid=composer-submit]'); }
  await f.until(() => f.sent.length === 1 && f.controller.getSnapshot().send.kind === 'admitted', 'capped capture sends once');
  assert.equal(new DataView(await f.captured[0].arrayBuffer()).getUint32(40, true), 16000 * 300 * 2, 'only capped PCM bytes are sent');
});

test('paste-to-file maps visible selections without deleting hidden kind tokens', async t => {
  const f = await fixture(t, { upload: async () => new Promise(() => {}) });
  await f.talk();
  await f.act(async () => f.controller.setText(`${TOKEN} before REMOVE after`));
  await f.paste('pasted fictional text', 7, 13);
  await f.until(() => f.find('[data-testid=upload-chip]'), 'upload pending');
  assert.equal(f.find('[data-testid=composer-input]').value, 'before  after');
  assert.ok(f.controller.getSnapshot().draft.text.includes(TOKEN));
  await f.click('[data-testid=upload-chip] button');
  assert.equal(f.find('[data-testid=composer-input]').value, 'before pasted fictional text after');
  assert.ok(f.controller.getSnapshot().draft.text.includes(TOKEN));
});

test('an unfinished quoted file mention cannot consume a hidden quoted kind token', async t => {
  const f = await fixture(t);
  const token = '@"repas:Meeting notes"';
  await f.talk(token);
  await f.input('@"');
  assert.equal(f.find('[data-testid=composer-input]').value, '@"');
  assert.ok(f.find('[data-testid=mention-chip]')?.textContent.includes('Meeting notes'));
  await f.click('[data-testid=composer-submit]');
  await f.until(() => f.controller.getSnapshot().send.kind === 'admitted', 'native send');
  const { mentionedPaths } = await import('@hachej/boring-ui-kit/chat-text');
  assert.ok(mentionedPaths(f.sent[0][1].text).includes('repas:Meeting notes'));
});

test('paste restoration after clearing editable text preserves hidden kind identity', async t => {
  const f = await fixture(t, { upload: async () => new Promise(() => {}) });
  await f.talk();
  await f.input('before REMOVE after');
  await f.paste('pasted fictional text', 7, 13);
  await f.until(() => f.find('[data-testid=upload-chip]'), 'upload pending');
  await f.input('');
  await f.click('[data-testid=upload-chip] button');
  assert.equal(f.find('[data-testid=composer-input]').value, 'pasted fictional text');
  const { mentionedPaths } = await import('@hachej/boring-ui-kit/chat-text');
  assert.ok(mentionedPaths(f.controller.getSnapshot().draft.text).includes(TOKEN.slice(1)));
  assert.ok(f.find('[data-testid=mention-chip]')?.textContent.includes(LABEL));
});

for (const send of ['auto', 'message']) test(`${send}: tap finish waits for microphone permission while inline cancel remains available`, async t => {
  let allow;
  const permission = new Promise(resolve => { allow = resolve; });
  t.after(() => allow());
  const f = await fixture(t, { send, permission });
  await f.talk(TOKEN, { voice: true });
  assert.equal(f.find('[data-testid=agent-talk]').dataset.state, 'starting');
  assert.equal(f.find('[data-testid=agent-talk]').disabled, true);
  assert.equal(f.find('[data-testid=composer-voice-cancel]').disabled, false);
  await f.act(async () => allow());
  await f.until(() => f.find('[data-testid=agent-talk]').dataset.state === 'recording', 'permission granted');
  assert.equal(f.find('[data-testid=agent-talk]').disabled, false);
  await f.click('[data-testid=composer-voice-cancel]');
  assert.equal(f.sent.length, 0);
});

test('kind removal preserves visible words and file text', async t => {
  const f = await fixture(t);
  await f.talk();
  await f.act(async () => f.controller.setText(`${TOKEN} ${WORDS} @docs/plan.md`));
  assert.equal(f.find('[data-testid=composer-input]').value, `${WORDS} @docs/plan.md`);
  await f.click('[data-testid=mention-chip] button');
  assert.equal(f.controller.getSnapshot().draft.text, `${WORDS} @docs/plan.md`);
  assert.equal(f.find('[data-testid=composer-input]').value, `${WORDS} @docs/plan.md`);
});

for (const width of [390, 1280]) test(`single tap starts the same replacement recording bar at ${width}, trash discards, Send uses native admission`, async t => {
  const f = await fixture(t, { width, send: 'message' });
  await f.talk();
  await f.click('[data-testid=agent-talk]');
  await f.until(() => f.find('[data-testid=agent-talk]')?.dataset.state === 'recording', 'a single click records without hold');
  assert.equal(f.permission(), 1);
  assert.ok(f.find('[data-testid=composer] [data-testid=voice-recording-bar]'));
  assert.equal(Boolean(f.find('[data-testid=composer-input]')), false, 'recording replaces editable row');
  assert.equal(Boolean(f.find('[data-testid=composer-submit]')), false, 'no competing Send');
  assert.equal(Boolean(f.find('[data-testid=composer-plus]')), false, 'ordinary controls are replaced');
  assert.equal(Boolean(f.find('[data-testid=voice-pause]')), false, 'fallback never invents pause');
  assert.equal(Boolean(f.find('[data-testid=voice-waveform]')), false, 'fallback never invents input levels');
  await f.click('[data-testid=composer-voice-cancel]');
  assert.equal(f.sent.length, 0); assert.ok(f.tracks.every(track => track.stopped));
  assert.ok(f.find('[data-testid=composer-input]'));
  await f.click('[data-testid=agent-talk]');
  await f.until(() => f.find('[data-testid=agent-talk]')?.dataset.state === 'recording', 'second tap records');
  await f.click('[data-testid=agent-talk]');
  await f.until(() => f.sent.length === 1 && f.controller.getSnapshot().send.kind === 'admitted', 'Send admits one native message');
});


for (const send of ['draft', 'auto', 'message', 'native']) test(`${send}: public recording bar uses real PCM levels, freezes paused time, resumes and sends without paused samples`, async t => {
  const f = await fixture(t, { send: send === 'native' ? 'message' : send, pcm: true, nativeVoice: send === 'native' });
  const mic = send === 'native' ? '[data-testid=voice-message-record]' : '[data-testid=agent-talk]';
  if (send !== 'native') await f.talk();
  await f.click(mic); await f.feed(0.25);
  await f.until(() => f.find('[data-testid=voice-waveform] span')?.dataset.level === '0.25', 'waveform comes from the real PCM level');
  assert.ok(f.find('[data-testid=voice-recording-bar]'));
  assert.equal(Boolean(f.find('[data-testid=composer-input]')), false);
  assert.match(f.find('[data-testid=voice-recording]').textContent, /0:01/);
  await f.click('[data-testid=voice-pause]');
  assert.equal(f.find('[data-testid=voice-recording-bar]').dataset.state, 'paused');
  assert.equal(f.find('[data-testid=voice-pause]').getAttribute('aria-label'), 'Reprendre l’enregistrement');
  const bars = f.find('[data-testid=voice-waveform]').innerHTML;
  await f.feed(0.9); await f.act(async () => new Promise(resolve => setTimeout(resolve, 250)));
  assert.match(f.find('[data-testid=voice-recording]').textContent, /0:01/);
  assert.equal(f.find('[data-testid=voice-waveform]').innerHTML, bars, 'waveform freezes while paused');
  await f.click('[data-testid=voice-pause]'); await f.feed(0.5);
  await f.until(() => f.find('[data-testid=voice-waveform]')?.lastElementChild?.dataset.level === '0.5', 'resumed level');
  assert.match(f.find('[data-testid=voice-recording]').textContent, /0:02/);
  await f.click(mic);
  if (send === 'draft') { await f.until(() => f.controller.getSnapshot().draft.text.includes(WORDS), 'draft transcribed'); await f.click('[data-testid=composer-submit]'); }
  await f.until(() => f.sent.length === 1 && f.controller.getSnapshot().send.kind === 'admitted', 'one native admission');
  assert.equal(new DataView(await f.captured[0].arrayBuffer()).getUint32(40, true), 64000, 'exactly two seconds of PCM, no paused samples');
  assert.ok(f.tracks.every(track => track.stopped)); assert.ok(f.contexts.every(context => context.state === 'closed'));
});

for (const action of ['send', 'trash']) test(`paused native capture: ${action} releases the microphone and excludes paused samples`, async t => {
  const f = await fixture(t, { send: 'message', pcm: true, nativeVoice: true });
  await f.click('[data-testid=voice-message-record]'); await f.feed(0.25);
  await f.until(() => f.find('[data-testid=voice-pause]'), 'PCM pause available');
  await f.click('[data-testid=voice-pause]'); await f.feed(0.9);
  await f.click(action === 'send' ? '[data-testid=voice-message-record]' : '[data-testid=composer-voice-cancel]');
  if (action === 'send') {
    await f.until(() => f.sent.length === 1 && f.controller.getSnapshot().send.kind === 'admitted', 'paused Send admits once');
    assert.equal(new DataView(await f.captured[0].arrayBuffer()).getUint32(40, true), 32000, 'one second kept, paused second excluded');
  } else { assert.equal(f.sent.length, 0); assert.equal(f.captured.length, 0); }
  assert.ok(f.tracks.every(track => track.stopped));
  assert.ok(f.contexts.every(context => context.state === 'closed'));
});
