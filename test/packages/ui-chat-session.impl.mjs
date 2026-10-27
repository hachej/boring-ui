import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';
import * as hooks from '@hachej/boring-ui-kit/chat-react';
import { createNativeChatController } from '@hachej/boring-ui-kit/native-chat';
import { Harness, MemoryStorage, createRegistry } from '@earendil-works/pi-durable';
import { createModels } from '@earendil-works/pi-ai';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';

const window = new Window({ url: 'https://fictional.invalid/' });
for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Text', 'MutationObserver', 'localStorage']) {
  Object.defineProperty(globalThis, name, { configurable: true, value: name === 'window' ? window : window[name] });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { act, createElement: h, StrictMode } = await import('react');
const { createRoot } = await import('react-dom/client');
test.after(() => window.happyDOM.close());
const deferred = () => { let resolve, reject; const promise = new Promise((done, fail) => { resolve = done; reject = fail; }); return { promise, resolve, reject }; };
async function mount(t, hook, initial) {
  const element = document.createElement('div'); document.body.append(element);
  const root = createRoot(element); let api;
  const Probe = props => { api = hook(props); return h('p', null, api?.status ?? 'mounted'); };
  const render = props => act(async () => root.render(h(StrictMode, null, h(Probe, props))));
  await render(initial);
  let mounted = true;
  const unmount = async () => { if (mounted) { mounted = false; await act(async () => root.unmount()); element.remove(); } };
  t.after(unmount);
  return { get api() { return api; }, render, element, unmount };
}

function controller() {
  let snapshot = { identity: { runtimeId: 'fictional', scopeId: 'team', principalId: 'alice' }, conversationId: 1,
    view: { conversation: { id: 1 }, entries: [], docs: {} }, history: { kind: 'disabled' },
    draft: { text: '', attachments: [], version: 0 }, connection: { kind: 'connected' }, send: { kind: 'idle' }, stop: 'idle', disposed: false };
  const listeners = new Set(), sends = [];
  const update = next => { snapshot = { ...snapshot, ...next }; for (const fn of listeners) fn(); };
  const chat = { getSnapshot: () => snapshot, subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn); }, listeners, sends, update,
    connect: async () => {}, stop: async () => {}, dispose: () => { throw new Error('borrowed controller must not be disposed'); },
    setText: text => update({ draft: { ...snapshot.draft, text, version: snapshot.draft.version + 1 } }),
    setAttachments: attachments => update({ draft: { ...snapshot.draft, attachments, version: snapshot.draft.version + 1 } }),
    send: async (mode, content) => { sends.push({ mode, content }); if (!content) { chat.setText(''); chat.setAttachments([]); } return { id: 'accepted' }; },
  };
  return chat;
}
const labels = { connectionFailed: 'Connection failed', actionFailedShort: 'Action failed', imageAttachment: 'Image', queueLocked: 'Locked', tooLate: 'Too late',
  waitToSteer: 'Wait', steerRefused: 'Refused', steerFailed: 'Steer failed', uploadFailedShort: 'Upload failed', pastedFileName: stamp => `Paste ${stamp}`, changeRefused: 'Change refused' };
const options = chat => ({ controller: chat, activeController: { current: chat }, mode: 'expert', labels });

test('public useChatSession derives state and sends without owning the native controller', async t => {
  const chat = controller();
  const page = await mount(t, hooks.useChatSession, options(chat));
  assert.equal(page.api.empty, true);
  await act(async () => chat.setText('fictional draft'));
  await act(async () => page.api.send());
  assert.equal(chat.sends.length, 1);
  assert.equal(chat.sends[0].mode, 'followUp');
  assert.equal(page.api.state.draft.text, '');
});

const image = { id: 'image', name: 'fictional.png', content: { type: 'image', data: 'AA==', mimeType: 'image/png' } };

test('feedback refusal restores the captured text/images ahead of later typing; unknown send and disconnect stay blocked', async t => {
  const chat = controller(), gate = deferred(); let accepted = 0;
  const opts = { ...options(chat), feedback: { count: 1, attach: () => gate.promise, sent: () => { accepted++; } } };
  const page = await mount(t, hooks.useChatSession, opts);
  await act(async () => { chat.setText('original'); chat.setAttachments([image]); });
  await act(async () => page.api.send());
  assert.equal(chat.getSnapshot().draft.text, '');
  await act(async () => chat.setText('later'));
  await act(async () => gate.resolve({ kind: 'refused', reason: 'Not ready' }));
  assert.equal(chat.getSnapshot().draft.text, 'original\nlater');
  assert.deepEqual(chat.getSnapshot().draft.attachments, [image]);
  assert.equal(page.api.error, 'Not ready'); assert.equal(accepted, 0); assert.equal(chat.sends.length, 0);
  for (const patch of [{ send: { kind: 'unknown' } }, { send: { kind: 'idle' }, connection: { kind: 'closed' } }]) {
    await act(async () => chat.update(patch));
    assert.equal(page.api.sendBlocked, true);
    await act(async () => page.api.send()); assert.equal(chat.sends.length, 0);
  }
});

test('feedback restores the second captured draft when native unknown admission rejects its send', { timeout: 10000 }, async t => {
  const harness = await Harness.open(new MemoryStorage(), { registry: createRegistry(), models: createModels() }, context);
  const conversation = await harness.createConversation({ ownership: { kind: 'ownerless' } }, context);
  let original, submissions = 0;
  // Lose only the acknowledgement: the first input really enters the native store.
  const boundary = new Proxy(conversation, { get: (target, key) => {
    if (key === 'submit') return async (input, ctx) => {
      submissions++; original = await conversation.submit(input, ctx); throw new Error('Fictional acknowledgement lost');
    };
    const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value;
  } });
  const chat = createNativeChatController({ identity: { runtimeId: 'fictional', scopeId: 'team', principalId: 'alice' }, conversation: boundary, context, history: false });
  t.after(async () => { await chat.dispose(); await harness.close(context); });
  const first = deferred(), second = deferred(); let attachments = 0, sent = 0;
  const page = await mount(t, hooks.useChatSession, { ...options(chat), feedback: { count: 1,
    attach: () => (++attachments === 1 ? first : second).promise, sent: () => { sent++; } } });
  await act(async () => chat.setText('first'));
  await act(async () => page.api.send());
  await act(async () => { chat.setText('second'); chat.setAttachments([image]); });
  await act(async () => page.api.send());
  await act(async () => chat.setText('later'));
  const unknown = new Promise(resolve => {
    const unsubscribe = chat.subscribe(() => { if (chat.getSnapshot().send.kind === 'unknown') { unsubscribe(); resolve(); } });
  });
  await act(async () => { first.resolve({ kind: 'ok', text: 'first + note' }); await unknown; });
  assert.equal(chat.getSnapshot().send.kind, 'unknown'); assert.equal(submissions, 1); assert.ok(original);
  await act(async () => second.resolve({ kind: 'ok', text: 'second + note' }));
  assert.match(page.api.error, /Reconcile/);
  assert.equal(chat.getSnapshot().draft.text, 'second\nlater');
  assert.deepEqual(chat.getSnapshot().draft.attachments, [image]);
  assert.equal(sent, 0); assert.equal(submissions, 1, 'rejected second send never reaches native admission');
  await act(async () => { const record = await chat.reconcile(); assert.equal(record.id, original.id); });
  assert.equal(chat.getSnapshot().draft.text, 'second\nlater', 'reconciling the first send keeps the unsent second draft');
  assert.equal(submissions, 1);
  await page.unmount();
});

test('feedback sends exact restore content; queue edit and steer withdraw first without dropping a newer draft', async t => {
  const chat = controller(), withdrawn = []; let sent = 0;
  const opts = { ...options(chat), actions: { withdraw: async id => { withdrawn.push(id); } },
    feedback: { count: 1, attach: async text => ({ kind: 'ok', text: `${text} + note` }), sent: () => { sent++; } } };
  const page = await mount(t, hooks.useChatSession, opts);
  await act(async () => { chat.setText('original'); chat.setAttachments([image]); });
  await act(async () => page.api.send());
  assert.equal(sent, 1);
  assert.deepEqual(chat.sends[0], { mode: 'followUp', content: { text: 'original + note', attachments: [image], restore: { text: 'original', attachments: [image] } } });
  await act(async () => chat.setText('later'));
  const item = { id: 'queued', mode: 'followUp', content: [{ type: 'text', text: 'queued text' }, image.content] };
  await act(async () => page.api.queueActions.edit(item));
  assert.deepEqual(withdrawn, ['queued']); assert.equal(chat.getSnapshot().draft.text, 'queued text\nlater');
  const draft = chat.getSnapshot().draft;
  await act(async () => page.api.queueActions.steer(item));
  assert.equal(chat.sends.at(-1).mode, 'steer'); assert.equal(chat.sends.at(-1).content.text, 'queued text');
  assert.equal(chat.getSnapshot().draft, draft, 'steer never edits the current draft');
  await page.render({ ...opts, actions: { withdraw: async () => 'already_placed' } });
  await assert.rejects(() => page.api.queueActions.edit(item), /Too late/);
  assert.equal(chat.getSnapshot().draft, draft);
});

test('session preserves upstream kind-mention send/feedback restore and excludes app cards from files', async t => {
  const chat = controller(), kinds = { meal: {} };
  const opts = { ...options(chat), mentions: { kinds } };
  const page = await mount(t, hooks.useChatSession, opts);
  const text = '/cook @meal:lunch @plan.txt words';
  await act(async () => { chat.setText(text); chat.setAttachments([image]); });
  await act(async () => page.api.send());
  assert.deepEqual(chat.sends[0], { mode: 'followUp', content: { text, attachments: [image], restore: { text: '/cook @plan.txt words', attachments: [image] } } });
  assert.equal(chat.getSnapshot().draft.text, '');
  await act(async () => { chat.setText('later'); page.api.putBack(text, [image]); });
  assert.equal(chat.getSnapshot().draft.text, '/cook @plan.txt words\nlater');
  await act(async () => chat.update({ view: { ...chat.getSnapshot().view,
    entries: [{ id: 1, model: [{ role: 'user', content: '@meal:lunch @plan.txt @unknown:card', timestamp: 1 }] }] } }));
  assert.deepEqual(page.api.files.map(file => file.name), ['fictional.png', 'plan.txt', 'unknown:card']);
  await page.render({ ...opts, feedback: { count: 1, attach: async value => ({ kind: 'ok', text: `${value} + feedback` }), sent: () => {} } });
  await act(async () => { chat.setText(text); chat.setAttachments([image]); });
  await act(async () => page.api.send());
  assert.deepEqual(chat.sends.at(-1).content, { text: `${text} + feedback`, attachments: [image], restore: { text: '/cook @plan.txt words', attachments: [image] } });
});

test('native refused kind-mention send restores words/images but not app chips', async t => {
  const view = { conversation: { id: 1 }, entries: [], docs: {} };
  const chat = createNativeChatController({ identity: { runtimeId: 'fictional', scopeId: 'team', principalId: 'alice' }, conversation: { id: 1 }, context, history: false,
    source: { open: async () => ({ value: view, start() {}, closed: new Promise(() => {}), stop: async () => ({ kind: 'stopped' }) }) },
    beforeSubmit: async () => 'Fictional refusal' });
  t.after(() => chat.dispose());
  const page = await mount(t, hooks.useChatSession, { ...options(chat), mentions: { kinds: { meal: {} } } });
  await act(async () => { chat.setText('@meal:lunch @plan.txt words'); chat.setAttachments([image]); });
  await act(async () => page.api.send());
  assert.equal(chat.getSnapshot().send.kind, 'blocked');
  assert.equal(chat.getSnapshot().draft.text, '@plan.txt words');
  assert.deepEqual(chat.getSnapshot().draft.attachments, [image]);
  await page.unmount();
});

test('paste uses editable coordinates, retains hidden tokens and leading registered skills through cancel', async t => {
  const chat = controller(), gate = deferred(); let signal;
  const opts = { ...options(chat), mentions: { kinds: { meal: {} } }, slash: { skills: [{ name: 'cook' }] },
    attachments: { upload: async (_files, abort) => { signal = abort; return gate.promise; } } };
  const page = await mount(t, hooks.useChatSession, opts);
  await act(async () => chat.setText('/cook @meal:lunch before selection after'));
  await act(async () => page.api.pasteText({ text: '# Fictional paste', start: 13, end: 22 }));
  assert.equal(chat.getSnapshot().draft.text, '/cook @meal:lunch before  after');
  const pending = page.api.pending[0]; assert.equal(pending.restoreWhile, chat.getSnapshot().draft.text);
  await act(async () => { chat.setText('/cook @meal:dinner before  after later'); pending.cancel(); });
  assert.equal(chat.getSnapshot().draft.text, '/cook @meal:dinner before # Fictional paste after later');
  assert.equal(signal.aborted, true);
  await act(async () => gate.resolve([]));
});

test('uploads become native images or mention paths; paste undo aborts and retains intervening text', async t => {
  const chat = controller(); let signal, saved;
  let gate = deferred();
  const opts = { ...options(chat), attachments: { upload: async (files, abort) => { saved = files; signal = abort; return gate.promise; } } };
  const page = await mount(t, hooks.useChatSession, opts);
  let uploading;
  await act(async () => { uploading = page.api.upload([new File(['fictional'], 'fixture.txt')]); });
  assert.equal(page.api.uploading, 1); assert.equal(page.api.pending[0].state, 'uploading'); assert.equal(page.api.sendBlocked, true);
  await act(async () => { gate.resolve([{ path: 'uploads/fixture.txt', name: 'fixture.txt' }, { name: image.name, image: image.content }]); await uploading; });
  assert.equal(page.api.uploading, 0); assert.deepEqual(page.api.pending, []);
  assert.equal(chat.getSnapshot().draft.text, '@uploads/fixture.txt '); assert.equal(chat.getSnapshot().draft.attachments.length, 1);
  assert.deepEqual(page.api.files.map(file => file.name), ['fixture.txt', 'fictional.png']);
  gate = deferred();
  await act(async () => { chat.setText('before selection after'); page.api.pasteText({ text: '# Fictional paste', start: 7, end: 16 }); });
  assert.match(saved[0].name, /\.md$/); assert.equal(saved[0].type, 'text/markdown');
  assert.equal(chat.getSnapshot().draft.text, 'before  after');
  const pending = page.api.pending[0]; assert.equal(pending.restoreWhile, 'before  after');
  await act(async () => { chat.setText('before  after later'); pending.cancel(); });
  assert.equal(signal.aborted, true); assert.equal(chat.getSnapshot().draft.text, 'before # Fictional paste after later');
  await act(async () => gate.resolve([{ path: 'uploads/aborted.md', name: 'aborted.md' }]));
  assert.equal(page.api.pending.length, 0); assert.doesNotMatch(chat.getSnapshot().draft.text, /aborted/);
});

test('unmount aborts only session uploads; late connect failures read current labels and active binding', async t => {
  const chat = controller(), connection = deferred(), upload = deferred(); let signal;
  chat.connect = () => connection.promise;
  const opts = { ...options(chat), onFiles: async (_files, target) => { signal = target.signal; return upload.promise; } };
  const page = await mount(t, hooks.useChatSession, opts);
  await page.render({ ...opts, labels: { ...labels, connectionFailed: 'Localized connection' } });
  await act(async () => connection.reject('fictional offline'));
  assert.equal(page.api.error, 'Localized connection');
  await act(async () => { void page.api.upload([new File(['fictional'], 'fixture.txt')]); });
  await page.unmount();
  assert.equal(chat.listeners.size, 0);
  assert.equal(signal.aborted, true);
  await act(async () => upload.resolve([image]));
  assert.equal(chat.getSnapshot().draft.attachments.length, 0);
  assert.equal(chat.getSnapshot().disposed, false);
});

test('model/effort choices stay optimistic until native watch agrees and refused changes remain dismissible', async t => {
  const chat = controller(), changes = [], gate = deferred();
  const opts = { ...options(chat), model: { change: next => { changes.push(next); return gate.promise; } }, effort: { change: async () => { throw new Error('Fictional refusal'); } } };
  const page = await mount(t, hooks.useChatSession, opts);
  const next = { provider: 'fictional', modelId: 'model' };
  let changing;
  await act(async () => { changing = page.api.changeModel(next); }); assert.equal(page.api.changing, 'model');
  await act(async () => { gate.resolve(); await changing; });
  assert.deepEqual(changes, [next]); assert.deepEqual(page.api.currentModel, next);
  await act(async () => chat.update({ view: { ...chat.getSnapshot().view, docs: { 'pi.agent': { model: next, thinkingLevel: 'low' } } } }));
  assert.deepEqual(page.api.currentModel, next); assert.equal(page.api.currentEffort, 'low');
  await act(async () => page.api.changeEffort('high'));
  assert.equal(page.api.changeError, 'Fictional refusal'); assert.equal(page.api.currentEffort, 'low');
  await act(async () => page.api.dismissChangeError()); assert.equal(page.api.changeError, null);
});


test('session derives active/history rows and observed files through the host callback; inactive binding refuses commands', async t => {
  const chat = controller(), opened = [], commands = [];
  const opts = { ...options(chat), mentions: { open: path => opened.push(path) }, commandMentions: { commands: [{ name: 'known', behavior: 'insert' }], onActivate: item => commands.push(item) } };
  const page = await mount(t, hooks.useChatSession, opts);
  const row = (id, text) => ({ id, model: [{ role: 'user', content: text, timestamp: id }] });
  await act(async () => chat.update({ view: { ...chat.getSnapshot().view, entries: [row(2, '@./plan.txt @plan.txt')] }, history: { kind: 'ready', entries: [row(1, 'Earlier'), row(2, 'Duplicate')], hasMore: false } }));
  assert.equal(page.api.rows.length, 2); assert.equal(page.api.rows[0].historical, true);
  assert.equal(page.api.files.length, 1); assert.equal(page.api.files[0].name, 'plan.txt');
  page.api.files[0].open(); assert.deepEqual(opened, ['plan.txt']);
  await act(async () => { page.api.activateMention({ name: 'missing', behavior: 'insert' }); page.api.activateMention({ name: 'known', behavior: 'insert' }); });
  assert.deepEqual(commands, [{ name: 'known', behavior: 'insert' }]);
  opts.activeController.current = controller();
  await act(async () => { page.api.send(); page.api.activateMention({ name: 'known', behavior: 'insert' }); });
  assert.equal(chat.sends.length, 0); assert.equal(commands.length, 1);
});
