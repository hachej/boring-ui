import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { Window } from 'happy-dom';

const project = fileURLToPath(new URL('../../', import.meta.url));
const out = `${project}.cache/agent-target-render-test`;
mkdirSync(out, { recursive: true });
writeFileSync(`${out}/entry.tsx`, `export { AgentLayerProvider, useAgentLayer } from '${project}registry/app-shell/agent-layer.tsx';\nexport { AgentTargetMode } from '${project}registry/agent-target/agent-target.tsx';`);
let bundles = 0;
const SPEECH = 'remplace le riz par 150 g de pâtes';
const TARGET = { meal: 'm-42', slot: 'lunch' };
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

async function fixture(t, options = {}) {
  const window = new Window({ url: 'https://fictional.invalid/' });
  const names = ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Event', 'EventTarget', 'KeyboardEvent', 'MouseEvent', 'PointerEvent', 'MutationObserver', 'ResizeObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'matchMedia', 'IS_REACT_ACT_ENVIRONMENT', 'MediaRecorder'];
  const saved = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  for (const name of names) Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: name === 'window' ? window : name === 'IS_REACT_ACT_ENVIRONMENT' ? true : /^(getComputedStyle|requestAnimationFrame|cancelAnimationFrame|matchMedia)$/.test(name) ? window[name].bind(window) : window[name] });
  const tracks = [], opens = [];
  Object.defineProperty(window.navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: async () => {
    const gate = options.mediaGate;
    if (options.mediaError) throw new window.DOMException('Fictional refusal', 'NotAllowedError');
    if (gate) await gate.promise;
    const track = { stopped: false, stop() { this.stopped = true; } }; tracks.push(track);
    return { getTracks: () => [track], getAudioTracks: () => [track] };
  } } });
  class Recorder extends window.EventTarget {
    static isTypeSupported() { return true; }
    constructor() { super(); this.state = 'inactive'; this.mimeType = 'audio/webm'; opens.push(this); }
    start() { this.state = 'recording'; }
    stop() { if (this.state === 'inactive') return; this.state = 'inactive'; const event = new window.Event('dataavailable'); event.data = new Blob(['fictional audio']); this.dispatchEvent(event); this.dispatchEvent(new window.Event('stop')); }
  }
  globalThis.MediaRecorder = Recorder;
  const id = ++bundles, outfile = `${out}/target-${id}.mjs`;
  await build({ entryPoints: [`${out}/entry.tsx`], outfile, bundle: true, format: 'esm', platform: 'node', jsx: 'automatic', packages: 'external', alias: { '@': `${project}examples/app-shell`, '@hachej/boring-ui-kit/file-tree.css': `${project}packages/ui/styles/file-tree.css` }, logLevel: 'silent', plugins: process.env.BEFORE_TARGET_SOURCE ? [{ name: 'before-target', setup(builder) { builder.onLoad({ filter: /registry\/agent-target\/agent-target\.tsx$/ }, () => ({ contents: readFileSync(process.env.BEFORE_TARGET_SOURCE, 'utf8'), loader: 'tsx', resolveDir: `${project}registry/agent-target` })); } }] : [] });
  const { AgentLayerProvider, AgentTargetMode, useAgentLayer } = await import(pathToFileURL(outfile).href);
  const { Harness, MemoryStorage, createRegistry } = await import('@earendil-works/pi-durable');
  const { BACKGROUND_CONTEXT: context } = await import('@earendil-works/chord/context');
  const { createNativeChatController } = await import('@hachej/boring-ui-kit/native-chat');
  const { createFakeChatModel } = await import('@hachej/boring-testing/model');
  const { createElement: h, act, StrictMode } = await import('react');
  const { createRoot } = await import('react-dom/client');
  const fake = createFakeChatModel();
  const native = await Harness.open(new MemoryStorage(), { registry: createRegistry(), models: fake.models }, context);
  const conversation = await native.createConversation({ ownership: { kind: 'ownerless' }, agent: { model: fake.model } }, context);
  const controller = createNativeChatController({ conversation, context, identity: { runtimeId: 'fictional', scopeId: 'fictional', principalId: 'fictional' }, ...options.controller });
  const sent = [], settled = [], transcribed = [], replacements = [];
  const realSend = controller.send;
  controller.send = async (...args) => { sent.push(structuredClone(args)); return realSend(...args); };
  let api, normal = 0;
  const transcribe = async (audio, signal) => { transcribed.push({ audio, signal }); if (options.transcribeGate) await options.transcribeGate.promise; if (options.transcribeError) throw new Error('Fictional transcription failure'); return SPEECH; };
  function Content({ enabled }) {
    api = useAgentLayer();
    return h('main', null,
      h('button', { 'data-testid': 'outside', onClick: () => normal++ }, 'Normal page action'),
      h('button', { 'data-testid': 'meal', 'data-agent-target': options.attribute ?? JSON.stringify(TARGET), 'data-private': 'not-sent', onClick: () => normal++ }, h('span', { 'data-testid': 'meal-child' }, 'Fictional rice')),
      h(AgentTargetMode, { enabled, transcribe, labels: options.labels, onSettled: result => settled.push(result) }));
  }
  const mount = document.createElement('div'); document.body.append(mount);
  const ui = createRoot(mount);
  let mounted = true;
  const render = (enabled, selectedController = controller) => act(async () => ui.render(h(StrictMode, null, h(AgentLayerProvider, { agent: { controller: selectedController } }, h(Content, { enabled })))));
  const unmount = async () => { if (mounted) { mounted = false; await act(async () => ui.unmount()); } };
  const find = selector => document.querySelector(selector);
  window.document.elementsFromPoint = () => [find('[data-testid=meal-child]')].filter(Boolean);
  const fire = async (selector, type, init = {}) => act(async () => { find(selector).dispatchEvent(new window.PointerEvent(type, { bubbles: true, cancelable: true, button: 0, pointerType: 'mouse', clientX: 20, clientY: 20, ...init })); });
  const tap = async selector => { await fire(selector, 'pointerdown'); await fire(selector, 'click', { detail: 1 }); };
  const until = async (predicate, label) => { for (let n = 0; n < 100 && !predicate(); n++) await act(async () => new Promise(resolve => setTimeout(resolve, 20))); assert.ok(predicate(), label); };
  t.after(async () => { await unmount(); await controller.dispose(); for (const replacement of replacements) await replacement.dispose(); await native.close(context); for (const [name, descriptor] of saved) descriptor ? Object.defineProperty(globalThis, name, descriptor) : delete globalThis[name]; window.close(); });
  const replace = async () => {
    const next = await native.createConversation({ ownership: { kind: 'ownerless' }, agent: { model: fake.model } }, context);
    const replacement = createNativeChatController({ conversation: next, context, identity: { runtimeId: 'fictional', scopeId: 'fictional', principalId: 'fictional' } });
    replacements.push(replacement);
    await render(true, replacement);
    return replacement;
  };
  await render(true);
  return { replace, window, controller, conversation, context, native, fake, sent, settled, transcribed, tracks, opens, find, tap, fire, until, render, unmount, api: () => api, normal: () => normal, act };
}

const french = { title: 'Parler de cet élément', opening: 'Ouverture du microphone…', listening: seconds => `J’écoute… ${seconds} s`, transcribing: 'Transcription…', waiting: 'Réponse en cours…', answered: 'Demande traitée.', stop: 'Arrêter et envoyer', cancel: 'Annuler', close: 'Fermer', invalidContext: 'Contexte JSON invalide.', contextTooLarge: 'Contexte trop volumineux.', observationFailed: 'Réponse non confirmée.', unanswered: 'Aucune réponse.', unavailable: 'Discussion indisponible.', sendFailed: 'Envoi impossible.', unconfirmed: 'Envoi non confirmé.', voiceTranscribeFailed: 'Transcription impossible.', voiceDenied: 'Microphone refusé.' };

test('host labels cover the title, accessible name, recording, transcription, waiting and close controls', async t => {
  const mediaGate = deferred(), transcribeGate = deferred();
  const f = await fixture(t, { labels: french, mediaGate, transcribeGate });
  await f.tap('[data-testid=meal-child]');
  const bar = () => f.find('[data-testid=agent-target-bar]');
  assert.equal(bar().getAttribute('aria-label'), french.title);
  assert.ok(bar().textContent.includes(french.opening));
  assert.equal(f.find('[data-testid=agent-target-stop]').textContent, french.stop);
  assert.equal(f.find('[data-testid=agent-target-close]').textContent, french.cancel);
  await f.act(async () => mediaGate.resolve());
  await f.until(() => bar()?.dataset.phase === 'recording', 'recording');
  assert.ok(bar().textContent.includes(french.listening(0)));
  await f.tap('[data-testid=agent-target-stop]');
  await f.until(() => f.transcribed.length === 1, 'transcribing');
  assert.ok(bar().textContent.includes(french.transcribing));
  await f.act(async () => transcribeGate.resolve());
  const call = await f.fake.nextCall();
  assert.ok(bar().textContent.includes(french.waiting));
  await f.act(async () => call.respond('Réponse fictive.'));
  await f.until(() => f.settled.length === 1, 'settled');
  assert.equal(f.find('[data-testid=agent-target-close]').textContent, french.close);
  assert.equal(f.find('[data-testid=agent-target-reply]').closest('[data-slot=bubble]').dataset.variant, 'secondary');
});

for (const [name, options, expected] of [
  ['invalid context', { attribute: 'not-json' }, french.invalidContext],
  ['oversized context', { attribute: JSON.stringify({ note: 'x'.repeat(1100) }) }, french.contextTooLarge],
  ['transcription failure', { transcribeError: true }, french.voiceTranscribeFailed],
  ['microphone refusal', { mediaError: true }, french.voiceDenied],
]) test(`host labels cover ${name}`, async t => {
  const f = await fixture(t, { ...options, labels: french });
  await f.tap('[data-testid=meal-child]');
  if (options.transcribeError) {
    await f.until(() => f.find('[data-testid=agent-target-bar]')?.dataset.phase === 'recording', 'recording');
    await f.tap('[data-testid=agent-target-stop]');
    await f.until(() => f.settled.length === 1, 'failure');
  }
  await f.until(() => !!f.find('[data-testid=agent-target-problem]'), 'localized error');
  assert.equal(f.find('[data-testid=agent-target-problem]').textContent, expected);
});

test('English defaults remain available when the host supplies no labels', async t => {
  const f = await fixture(t);
  await f.tap('[data-testid=meal-child]');
  await f.until(() => f.find('[data-testid=agent-target-bar]')?.dataset.phase === 'recording', 'recording');
  assert.equal(f.find('[data-testid=agent-target-bar]').getAttribute('aria-label'), 'Talk about this item');
  assert.equal(f.find('[data-testid=agent-target-stop]').textContent, 'Stop and send');
  assert.equal(f.find('[data-testid=agent-target-close]').textContent, 'Cancel');
});

for (const outcome of ['unavailable', 'sendFailed', 'unconfirmed', 'unanswered', 'observationFailed']) test(`host labels cover ${outcome}`, async t => {
  const f = await fixture(t, { labels: french });
  if (outcome === 'sendFailed') f.controller.connect = async () => { throw new Error('Fictional connection failure'); };
  if (outcome === 'unconfirmed') f.controller.send = async () => undefined;
  if (outcome === 'unanswered' || outcome === 'observationFailed') f.controller.submissionStatus = async submission => {
    if (outcome === 'observationFailed') throw new Error('Fictional status failure');
    return { id: submission.id, conversationId: f.conversation.id, type: 'input', status: 'unanswered', reason: 'Fictional unanswered' };
  };
  await f.tap('[data-testid=meal-child]');
  await f.until(() => f.find('[data-testid=agent-target-bar]')?.dataset.phase === 'recording', 'recording');
  if (outcome === 'unavailable') await f.controller.dispose();
  await f.tap('[data-testid=agent-target-stop]');
  if (outcome === 'unanswered' || outcome === 'observationFailed') { const call = await f.fake.nextCall(); await f.act(async () => call.respond('Réponse fictive.')); }
  await f.until(() => f.settled.length === 1, 'localized outcome');
  assert.equal(f.find('[data-testid=agent-target-problem]').textContent, french[outcome]);
});

test('the target bar matches the pointed item width and left edge', async t => {
  const f = await fixture(t);
  f.find('[data-testid=meal]').getBoundingClientRect = () => ({ left: 16, right: 374, top: 100, bottom: 144, width: 358, height: 44 });
  await f.tap('[data-testid=meal-child]');
  const bar = f.find('[data-testid=agent-target-bar]');
  assert.equal(bar.style.left, '16px');
  assert.equal(bar.style.width, '358px');
});

test('nearest marked ancestor sends only captured JSON plus speech once, streams exact native reply, chat stays closed', { timeout: 20000 }, async t => {
  const f = await fixture(t);
  assert.equal(f.controller.getSnapshot().connection.kind, 'idle', 'the chat has never been opened or connected');
  await f.tap('[data-testid=outside]');
  assert.equal(f.normal(), 1); assert.equal(f.opens.length, 0);
  await f.tap('[data-testid=meal-child]');
  await f.until(() => f.find('[data-testid=agent-target-bar]')?.dataset.phase === 'recording', 'recording from the tap');
  assert.equal(f.normal(), 1, 'marked page action was not activated');
  f.find('[data-testid=meal]').setAttribute('data-agent-target', '{"meal":"different"}');
  const stop = f.find('[data-testid=agent-target-stop]');
  await f.act(async () => { for (let n = 0; n < 2; n++) stop.dispatchEvent(new f.window.MouseEvent('click', { bubbles: true })); });
  await f.until(() => f.sent.length === 1, 'one send');
  assert.equal(f.sent[0][1].text, `<target>${JSON.stringify(TARGET)}</target>\n\n${SPEECH}`);
  assert.deepEqual(f.sent[0][1].restore, { text: SPEECH });
  const call = await f.fake.nextCall();
  const user = call.transcript.messages.filter(message => message.role === 'user').at(-1);
  const delivered = typeof user.content === 'string' ? user.content : user.content.filter(part => part.type === 'text').map(part => part.text).join('\n');
  assert.equal(delivered, `<target>{"meal":"m-42","slot":"lunch"}</target>\n\n${SPEECH}`, 'the real native model receives the marked context in its user message');
  call.append('Fictional meal');
  await f.until(() => f.find('[data-testid=agent-target-reply]')?.textContent.includes('Fictional meal'), 'reply streams in the bubble');
  call.respond(' updated.');
  await f.until(() => f.settled.length === 1, 'settled once');
  assert.deepEqual(f.settled[0], { target: TARGET, reply: 'Fictional meal updated.', ok: true });
  assert.equal(f.api().state, 'closed');
  assert.equal(f.find('[data-testid=agent-target-reply]').closest('[data-slot=bubble]').dataset.variant, 'secondary', 'the reply uses the host’s secondary bubble surface');
  assert.equal(f.tracks.every(track => track.stopped), true);
  assert.equal(f.sent.length, 1);
});

test('refused send restores only speech in the existing composer and settles false', async t => {
  const f = await fixture(t, { controller: { beforeSubmit: () => 'Fictional refusal' } });
  await f.tap('[data-testid=meal-child]');
  await f.until(() => f.opens.length === 1, 'microphone opened');
  await f.tap('[data-testid=agent-target-stop]');
  await f.until(() => f.settled.length === 1, 'refusal settled');
  assert.equal(f.controller.getSnapshot().draft.text, SPEECH);
  assert.equal(f.settled[0].ok, false);
  assert.equal(f.fake.calls.length, 0);
});

for (const attribute of ['not json', '[]', JSON.stringify({ note: 'é'.repeat(550) })]) test(`invalid/over-1KB target refuses without microphone: ${attribute.slice(0, 15)}`, async t => {
  const f = await fixture(t, { attribute });
  await f.tap('[data-testid=meal-child]');
  assert.ok(f.find('[data-testid=agent-target-problem]'));
  assert.equal(f.opens.length, 0); assert.equal(f.sent.length, 0);
});

for (const cancel of ['outside', 'escape', 'disabled', 'unmount']) test(`${cancel} cancels pending permission and late tracks without sending`, async t => {
  const mediaGate = deferred();
  const f = await fixture(t, { mediaGate });
  await f.tap('[data-testid=meal-child]');
  if (cancel === 'outside') await f.fire('[data-testid=outside]', 'pointerdown');
  if (cancel === 'escape') await f.act(async () => window.dispatchEvent(new f.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  if (cancel === 'disabled') await f.render(false);
  if (cancel === 'unmount') await f.unmount();
  await f.act(async () => mediaGate.resolve());
  await f.until(() => f.tracks.length === 1 && f.tracks[0].stopped, 'late microphone released');
  assert.equal(f.sent.length, 0);
  assert.equal(f.settled.length, 0);
});

test('late transcription is aborted; disabled taps stay normal', async t => {
  const transcribeGate = deferred();
  const f = await fixture(t, { transcribeGate });
  await f.tap('[data-testid=meal-child]');
  await f.until(() => f.find('[data-testid=agent-target-bar]')?.dataset.phase === 'recording', 'recording');
  await f.tap('[data-testid=agent-target-stop]');
  await f.until(() => f.transcribed.length === 1, 'transcription pending');
  await f.render(false);
  assert.equal(f.transcribed[0].signal.aborted, true);
  await f.act(async () => transcribeGate.resolve());
  assert.equal(f.sent.length, 0);
  await f.tap('[data-testid=meal-child]');
  assert.equal(f.normal(), 1);
});

test('a queued identical target message never borrows an earlier submission reply', { timeout: 20000 }, async t => {
  const f = await fixture(t);
  const old = await f.controller.send(undefined, { text: `<target>${JSON.stringify(TARGET)}</target>\n\n${SPEECH}` });
  const firstCall = await f.fake.nextCall();
  await f.tap('[data-testid=meal-child]');
  await f.until(() => f.find('[data-testid=agent-target-bar]')?.dataset.phase === 'recording', 'recording');
  await f.tap('[data-testid=agent-target-stop]');
  await f.until(() => f.sent.length === 2, 'target queued once');
  await f.act(async () => firstCall.respond('An earlier unrelated answer.'));
  await old.wait(f.context);
  const secondCall = await f.fake.nextCall();
  assert.equal(f.settled.length, 0, 'first identical input did not settle the target');
  assert.ok(!f.find('[data-testid=agent-target-reply]')?.textContent.includes('unrelated'));
  await f.act(async () => secondCall.respond('The captured fictional meal was updated.'));
  await f.until(() => f.settled.length === 1, 'the correct submission settled');
  assert.equal(f.settled[0].reply, 'The captured fictional meal was updated.');
});

test('closing after admission stops only the bubble observation, not native execution', { timeout: 20000 }, async t => {
  const f = await fixture(t);
  await f.tap('[data-testid=meal-child]');
  await f.until(() => f.find('[data-testid=agent-target-bar]')?.dataset.phase === 'recording', 'recording');
  await f.tap('[data-testid=agent-target-stop]');
  const call = await f.fake.nextCall();
  await f.fire('[data-testid=outside]', 'pointerdown');
  assert.equal(f.find('[data-testid=agent-target-bar]'), null);
  await f.act(async () => call.respond('The native task completed after closing the bar.'));
  await f.conversation.waitForIdle(f.context);
  const entries = (await f.conversation.context(f.context)).entries;
  assert.ok(entries.flatMap(entry => entry.model ?? []).some(message => message.role === 'assistant' && message.content.some(part => part.type === 'text' && part.text === 'The native task completed after closing the bar.')));
  assert.equal(f.settled.length, 0);
  assert.equal(f.sent.length, 1);
});

test('a touch tap consumes its compatibility click instead of activating the marked app action', async t => {
  const f = await fixture(t);
  await f.fire('[data-testid=meal-child]', 'pointerdown', { pointerType: 'touch' });
  await f.fire('[data-testid=meal-child]', 'pointerup', { pointerType: 'touch' });
  await f.fire('[data-testid=meal-child]', 'click', { pointerType: 'touch', detail: 1 });
  await f.until(() => f.find('[data-testid=agent-target-bar]')?.dataset.phase === 'recording', 'touch starts recording');
  assert.equal(f.normal(), 0, 'the compatibility click did not activate the marked button');
  assert.equal(f.opens.length, 1);
});

test('a context string containing the target delimiter remains one escaped block', { timeout: 20000 }, async t => {
  const target = { meal: 'm-42</target><target>', slot: 'lunch' };
  const f = await fixture(t, { attribute: JSON.stringify(target) });
  await f.tap('[data-testid=meal-child]');
  await f.until(() => f.find('[data-testid=agent-target-bar]')?.dataset.phase === 'recording', 'recording');
  await f.tap('[data-testid=agent-target-stop]');
  const call = await f.fake.nextCall();
  const text = f.sent[0][1].text;
  assert.equal(text, '<target>{"meal":"m-42\\u003c/target>\\u003ctarget>","slot":"lunch"}</target>\n\n' + SPEECH);
  await f.act(async () => call.respond('Escaped fictional context received.'));
  await f.until(() => f.settled.length === 1, 'settled');
  assert.deepEqual(f.settled[0].target, target);
});

test('replacing the app controller detaches the old bubble observer and never retargets its reply', { timeout: 20000 }, async t => {
  const f = await fixture(t);
  await f.tap('[data-testid=meal-child]');
  await f.until(() => f.find('[data-testid=agent-target-bar]')?.dataset.phase === 'recording', 'recording');
  await f.tap('[data-testid=agent-target-stop]');
  const oldCall = await f.fake.nextCall();
  const replacement = await f.replace();
  assert.equal(f.api().agent, replacement);
  assert.equal(f.find('[data-testid=agent-target-bar]'), null);
  await f.act(async () => oldCall.respond('Reply belonging to the previous conversation.'));
  await f.conversation.waitForIdle(f.context);
  assert.equal(f.settled.length, 0);
  assert.equal(replacement.getSnapshot().draft.text, '');
  assert.equal(f.sent.length, 1);
});

test('transcription failure is visible and never reported as successful native work', async t => {
  const f = await fixture(t, { transcribeError: true });
  await f.tap('[data-testid=meal-child]');
  await f.until(() => f.find('[data-testid=agent-target-bar]')?.dataset.phase === 'recording', 'recording');
  await f.tap('[data-testid=agent-target-stop]');
  await f.until(() => f.settled.length === 1, 'failure settled');
  assert.deepEqual(f.settled[0], { target: TARGET, reply: '', ok: false });
  assert.ok(f.find('[data-testid=agent-target-problem]').textContent);
  assert.equal(f.sent.length, 0);
  assert.equal(f.tracks[0].stopped, true);
});

test('observation failure is unconfirmed, not a successful app mutation, and leaves native work alive', { timeout: 20000 }, async t => {
  const f = await fixture(t);
  f.controller.submissionStatus = async () => { throw new Error('Fictional status transport unavailable'); };
  await f.tap('[data-testid=meal-child]');
  await f.until(() => f.find('[data-testid=agent-target-bar]')?.dataset.phase === 'recording', 'recording');
  await f.tap('[data-testid=agent-target-stop]');
  const call = await f.fake.nextCall();
  await f.until(() => f.settled.length === 1, 'observation failed');
  assert.deepEqual(f.settled[0], { target: TARGET, reply: '', ok: false });
  assert.match(f.find('[data-testid=agent-target-problem]').textContent, /Could not confirm/);
  await f.act(async () => call.respond('Native work completed despite unavailable observation.'));
  await f.conversation.waitForIdle(f.context);
  assert.equal(f.sent.length, 1);
  assert.equal(f.settled.length, 1);
});

test('Escape stays an ordinary app key when targeting is enabled but no marked item is active', async t => {
  const f = await fixture(t);
  let escaped = 0;
  f.window.addEventListener('keydown', () => escaped++);
  const event = new f.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
  await f.act(async () => f.window.dispatchEvent(event));
  assert.equal(escaped, 1, 'unrelated app controls receive Escape');
  assert.equal(event.defaultPrevented, false);
  assert.equal(f.find('[data-testid=agent-target-bar]'), null);
});

test('owner disposal during recording reports unavailable without writing to a disposed composer', async t => {
  const f = await fixture(t);
  await f.tap('[data-testid=meal-child]');
  await f.until(() => f.find('[data-testid=agent-target-bar]')?.dataset.phase === 'recording', 'recording');
  await f.controller.dispose();
  await f.tap('[data-testid=agent-target-stop]');
  await f.until(() => f.settled.length === 1, 'disposed outcome settled');
  assert.deepEqual(f.settled[0], { target: TARGET, reply: '', ok: false });
  assert.match(f.find('[data-testid=agent-target-problem]').textContent, /no longer available/);
  assert.equal(f.sent.length, 0);
  assert.equal(f.tracks[0].stopped, true);
});

test('late transcription from A cannot send into a new target B session', { timeout: 20000 }, async t => {
  const transcribeGate = deferred();
  const f = await fixture(t, { transcribeGate });
  await f.tap('[data-testid=meal-child]');
  await f.until(() => f.find('[data-testid=agent-target-bar]')?.dataset.phase === 'recording', 'A recording');
  await f.tap('[data-testid=agent-target-stop]');
  await f.until(() => f.transcribed.length === 1, 'A transcription pending');
  await f.render(false);
  await f.render(true);
  const targetB = { meal: 'm-84', slot: 'dinner' };
  f.find('[data-testid=meal]').setAttribute('data-agent-target', JSON.stringify(targetB));
  await f.tap('[data-testid=meal-child]');
  await f.until(() => f.find('[data-testid=agent-target-bar]')?.dataset.phase === 'recording', 'B recording');
  await f.tap('[data-testid=agent-target-stop]');
  await f.until(() => f.transcribed.length === 2, 'B transcription pending');
  await f.act(async () => transcribeGate.resolve());
  const call = await f.fake.nextCall();
  assert.equal(f.sent.length, 1, 'A did not send after cancellation');
  assert.equal(f.sent[0][1].text, `<target>{"meal":"m-84","slot":"dinner"}</target>\n\n${SPEECH}`);
  await f.act(async () => call.respond('Only fictional dinner B was addressed.'));
  await f.until(() => f.settled.length === 1, 'B settled');
  assert.deepEqual(f.settled[0], { target: targetB, reply: 'Only fictional dinner B was addressed.', ok: true });
  assert.equal(f.tracks.every(track => track.stopped), true);
});
