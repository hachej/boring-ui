// pi-chat file cards (the sent `@uploads/<path>` mention as a card above the bubble), the optional onOpenFile and mentions.preview
// props, and paste-to-file in the composer. Fictional names and text only. Renders the real PiChat over a native controller.
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('../../', import.meta.url));
const out = join(root, '.cache/pi-chat-file-cards-test');
mkdirSync(out, { recursive: true });
async function load(name, contents) {
  writeFileSync(join(out, `${name}-entry.tsx`), contents);
  await build({ entryPoints: [join(out, `${name}-entry.tsx`)], outfile: join(out, `${name}.mjs`), bundle: true, format: 'esm', platform: 'node', jsx: 'automatic', packages: 'external', logLevel: 'silent' });
  return import(pathToFileURL(join(out, `${name}.mjs`)).href);
}
const { PiChat, frenchChatLabels } = await load('pi-chat', `export { PiChat, frenchChatLabels } from '${root}registry/pi-chat/pi-chat.tsx';`);
const { AmbientChat } = await load('pi-ambient', `export { AmbientChat } from '${root}registry/pi-ambient/ambient.tsx';`);

const SENT = 'Read @uploads/report-1a2b3c4d.pdf please';
const LONG = `# Notes\n\n${'Fictional paragraph line.\n'.repeat(120)}`;

async function harness(t, { attachments, mentions, onOpenFile, pasteToFile, locale, component, beforeSubmit, lostAdmission = false, admissionGate, stagedFailure, extra = {} } = {}) {
  const { Window } = await import('happy-dom');
  const window = new Window({ url: 'https://fictional.invalid/', settings: { disableIframePageLoading: true } });
  const names = ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Text', 'addEventListener', 'removeEventListener', 'MutationObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'IS_REACT_ACT_ENVIRONMENT', 'ResizeObserver', 'localStorage', 'sessionStorage'];
  const globals = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  for (const name of names) {
    const value = name === 'window' ? window : name === 'IS_REACT_ACT_ENVIRONMENT' ? true : name === 'ResizeObserver' ? class { observe() {} unobserve() {} disconnect() {} } : window[name];
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: typeof value === 'function' && /^[a-z]/.test(name) ? value.bind(window) : value });
  }
  const { Harness: NativeHarness, MemoryStorage, createRegistry } = await import('@earendil-works/pi-durable');
  const { BACKGROUND_CONTEXT: context } = await import('@earendil-works/chord/context');
  const { createNativeChatController } = await import('@hachej/boring-ui-kit/native-chat');
  const { createFakeChatModel } = await import('@hachej/boring-testing/model');
  const { act, createElement } = await import('react');
  const { createRoot } = await import('react-dom/client');
  const fake = createFakeChatModel();
  const staged = stagedFailure === undefined ? undefined : await import('../../examples/staged-chat/host.mjs').then(async ({ createStagedHost, withDemoFailure }) => {
    const host = await createStagedHost(); return { host, conversation: withDemoFailure(host.threads.Questions, () => stagedFailure) };
  });
  const native = staged?.host.harness ?? await NativeHarness.open(new MemoryStorage(), { registry: createRegistry(), models: fake.models }, context);
  const container = document.createElement('div'); document.body.append(container);
  const ui = createRoot(container);
  const conversation = staged?.conversation ?? await native.createConversation({ ownership: { kind: 'ownerless' }, agent: { model: fake.model } }, context);
  let submissions = 0;
  const selected = lostAdmission ? { id: conversation.id, watch: conversation.watch.bind(conversation), abort: conversation.abort.bind(conversation), entries: conversation.entries.bind(conversation), commit: conversation.commit.bind(conversation), submit: async (...args) => { if (admissionGate) await admissionGate; const result = await conversation.submit(...args); submissions++; if (lostAdmission === true || submissions === lostAdmission) throw new Error('Fictional lost admission response'); return result; } } : conversation;
  const controller = createNativeChatController({ identity: { runtimeId: 'fixture', scopeId: 'fixture', principalId: 'person' }, context, conversation: selected, beforeSubmit, restoreOnError: Boolean(staged) });
  await controller.connect();
  t.after(async () => {
    await act(async () => ui.unmount()); container.remove();
    await controller.dispose(); await native.close(context);
    await window.happyDOM.close();
    for (const [name, descriptor] of globals) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; }
  });
  const props = { controller, historyList: false, showHistory: false, ...(attachments ? { attachments } : {}), ...(mentions ? { mentions } : {}),
    ...(onOpenFile ? { onOpenFile } : {}), ...(pasteToFile ? { pasteToFile } : {}), ...(locale ? { locale } : {}), ...extra };
  const Component = component ?? PiChat;
  const renderWith = async next => { Object.assign(props, next); await act(async () => ui.render(createElement(Component, props))); };
  await renderWith({});
  return { window, controller, container, act, context, rerender: renderWith, unmount: () => act(async () => ui.unmount()), write: async model => {
    await act(async () => { await conversation.submit({ type: 'write', entry: { kind: 'message', model } }, context); });
    await act(async () => new Promise(resolve => setTimeout(resolve, 30)));
  } };
}

/** A paste as the browser delivers it: the event carries the clipboard text; `prevented` says whether the composer took it. */
function paste(window, element, text) {
  const event = new window.Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', { value: { files: [], types: ['text/plain'], getData: () => text } });
  return { prevented: !element.dispatchEvent(event) };
}

test('conversation files omit rows with no opener, including draft and native images', async t => {
  const ui = await harness(t);
  const image = { type: 'image', mimeType: 'image/png', data: 'AAAA' };
  await ui.act(async () => ui.controller.setAttachments([{ id: 'fictional', name: 'fictional.png', content: image }]));
  await ui.write([{ role: 'user', content: [{ type: 'text', text: '@uploads/fictional.md' }, image], timestamp: 0 }]);
  assert.equal(Boolean(ui.container.querySelector('[data-testid=conversation-files]')), false, 'there is nothing the person can open');
});

test('an inline upload uses one native image, one files entry and the image opener, not a second path mention', async t => {
  const opened = [], filesOpened = [];
  const image = { mimeType: 'image/png', data: 'AAAA' };
  const ui = await harness(t, { onOpenFile: path => filesOpened.push(path), extra: { onOpenImage: value => opened.push(value) }, attachments: { upload: async () => [{ name: 'fictional.png', path: 'uploads/fictional.png', image }] } });
  const input = ui.container.querySelector('[data-testid=composer-file]');
  await ui.act(async () => {
    Object.defineProperty(input, 'files', { configurable: true, value: [new File(['fictional'], 'fictional.png', { type: 'image/png' })] });
    input.dispatchEvent(new ui.window.Event('change', { bubbles: true }));
  });
  assert.equal(ui.controller.getSnapshot().draft.text, '', 'the native image does not add a path for the host to resolve again');
  assert.equal(ui.controller.getSnapshot().draft.attachments.length, 1);
  assert.match(ui.container.querySelector('[data-testid=conversation-files]').textContent, /· 1$/);
  await ui.act(async () => ui.container.querySelector('[data-testid=composer-submit]').click());
  const messages = ui.controller.getSnapshot().view.entries.flatMap(entry => entry.model ?? []).filter(message => message.role === 'user');
  assert.equal(messages.at(-1).content.filter(part => part.type === 'image').length, 1);
  assert.doesNotMatch(JSON.stringify(messages), /@uploads\/fictional.png/);
  assert.equal(ui.container.querySelectorAll('[data-testid=message-image]').length, 1);
  assert.equal(ui.container.querySelectorAll('[data-testid=message-file]').length, 0);
  assert.match(ui.container.querySelector('[data-testid=conversation-files]').textContent, /· 1$/);
  await ui.act(async () => ui.container.querySelector('[data-testid=message-image]').click());
  assert.deepEqual(opened, [{ type: 'image', ...image }]);
  assert.deepEqual(filesOpened, []);
});

test('a sent upload mention is a card above the bubble, the raw mention is hidden and the message content keeps it', async t => {
  const { controller, container, act } = await harness(t, { mentions: { search: async () => [] }, onOpenFile: () => {} });
  await act(async () => { controller.setText(SENT); });
  await act(async () => { container.querySelector('[data-testid=composer-submit]').click(); });
  const card = container.querySelector('[data-testid=message-mention]');
  assert.ok(card, 'the card renders for the mention');
  assert.equal(card.getAttribute('data-path'), 'uploads/report-1a2b3c4d.pdf');
  assert.match(card.closest('[data-slot=attachment]').textContent, /report\.pdf/, 'the card shows the file name without the upload suffix');
  assert.match(card.closest('[data-slot=attachment]').textContent, /PDF/, 'the card shows the type line');
  const bubble = container.querySelector('[data-testid=user-text]');
  assert.ok(bubble, 'the text bubble is still there');
  assert.equal(bubble.textContent.includes('@uploads'), false, 'the raw mention is not shown');
  assert.match(bubble.textContent, /Read .*please/);
  assert.ok(card.compareDocumentPosition(bubble) & 4, 'the card comes above the bubble');
  const sent = JSON.stringify(controller.getSnapshot());
  assert.ok(sent.includes('@uploads/report-1a2b3c4d.pdf'), 'the content still carries the mention');
});

test('a voice upload renders a replayable bubble with its transcript, while ordinary audio stays a card', async t => {
  const reads = [];
  const { container, write, rerender } = await harness(t, { mentions: { search: async () => [], preview: async path => { reads.push(path); return { mimeType: 'audio/webm', data: 'ZmFrZQ==' }; } } });
  await write([{ role: 'user', content: '@uploads/voice-20261020-101500.webm Je mange une salade', timestamp: 0 }]);
  const bubble = container.querySelector('[data-testid=voice-bubble]');
  assert.ok(bubble, 'voice recordings are one replayable bubble');
  assert.match(bubble.textContent, /Je mange une salade/);
  assert.ok(bubble.querySelector('[data-testid=voice-play]'));
  assert.deepEqual(reads, [], 'replay bytes are lazy');
  assert.equal(container.querySelector('[data-testid=message-file]'), null, 'no duplicate file card');
  await write([{ role: 'user', content: '@uploads/song.mp3 An ordinary upload', timestamp: 1 }]);
  assert.match(container.querySelector('[data-testid=message-file]').textContent, /Audio/);
  await rerender({ locale: 'fr' });
  assert.equal(frenchChatLabels.fileKind.audio, 'Audio');
});

test('a card with onOpenFile is a button that opens the path; without it the card is not clickable', async t => {
  const opened = [];
  const { controller, container, act } = await harness(t, { mentions: { search: async () => [] }, onOpenFile: path => opened.push(path) });
  await act(async () => { controller.setText(SENT); });
  await act(async () => { container.querySelector('[data-testid=composer-submit]').click(); });
  const card = container.querySelector('[data-testid=message-mention]');
  assert.equal(card.tagName, 'BUTTON');
  await act(async () => card.click());
  assert.deepEqual(opened, ['uploads/report-1a2b3c4d.pdf']);
});

test('without onOpenFile the card is a plain element', async t => {
  const { controller, container, act } = await harness(t, { mentions: { search: async () => [] } });
  await act(async () => { controller.setText(SENT); });
  await act(async () => { container.querySelector('[data-testid=composer-submit]').click(); });
  assert.equal(container.querySelector('[data-testid=message-mention]').tagName, 'DIV');
});

test('the type line and the card label are localised (fr: Tableur, ’ typography)', async t => {
  assert.equal(frenchChatLabels.fileKind.sheet, 'Tableur');
  const { controller, container, act } = await harness(t, { mentions: { search: async () => [] }, onOpenFile: () => {}, locale: 'fr' });
  await act(async () => { controller.setText('Voir @uploads/budget-0a1b2c3d.xlsx'); });
  await act(async () => { container.querySelector('[data-testid=composer-submit]').click(); });
  const card = container.querySelector('[data-testid=message-mention]');
  assert.match(card.closest('[data-slot=attachment]').textContent, /Tableur/);
  assert.match(card.getAttribute('aria-label') ?? '', /budget\.xlsx/);
});

test('an image card shows the thumbnail read through the host provider', async t => {
  const read = [];
  const preview = async (path, signal) => { read.push({ path, signal }); return { mimeType: 'image/png', data: 'iVBORw0KGgo=' }; };
  const { controller, container, act } = await harness(t, { mentions: { search: async () => [], preview }, onOpenFile: () => {} });
  await act(async () => { controller.setText('See @uploads/photo-5e6f7a8b.png'); });
  await act(async () => { container.querySelector('[data-testid=composer-submit]').click(); });
  await act(async () => new Promise(resolve => setTimeout(resolve, 0)));
  assert.deepEqual(read.map(item => item.path), ['uploads/photo-5e6f7a8b.png']);
  assert.ok(container.querySelector('[data-testid=message-file] [data-slot=attachment-media] img')?.getAttribute('src')?.startsWith('data:image/png;base64,'));
});

test('a large paste becomes a pending upload, named as pasted text, and small pastes stay inline', async t => {
  const uploads = [];
  const attachments = { upload: (files, signal) => new Promise((resolve, reject) => { uploads.push({ files, signal, resolve, reject }); signal.addEventListener('abort', () => reject(new Error('aborted'))); }) };
  const { container, act, window, controller } = await harness(t, { attachments });
  const field = container.querySelector('[data-testid=composer-input]');
  const small = paste(window, field, 'A short fictional line');
  assert.equal(small.prevented, false, 'a short paste is left to the browser');
  assert.equal(uploads.length, 0);
  let big;
  await act(async () => { big = paste(window, field, LONG); });
  assert.equal(big.prevented, true, 'a long paste is taken by the composer');
  assert.equal(uploads.length, 1);
  const [file] = uploads[0].files;
  assert.match(file.name, /^(Texte collé|Pasted text) .*\.md$/, 'markdown text is named .md');
  assert.equal(file.type, 'text/markdown');
  assert.ok(container.querySelector('[data-testid=upload-chip][data-state=uploading]'), 'the pending card shows in the composer');
  assert.equal(controller.getSnapshot().draft.text, '', 'the text is not inline while it uploads');
});

test('plain text over the threshold is named .txt', async t => {
  const uploads = [];
  const attachments = { upload: (files, signal) => new Promise(() => { uploads.push(files); }) };
  const { container, act, window } = await harness(t, { attachments, pasteToFile: { minLines: 3 } });
  await act(async () => paste(window, container.querySelector('[data-testid=composer-input]'), 'one\ntwo\nthree\nfour'));
  assert.match(uploads[0][0].name, /^(Texte collé|Pasted text) .*\.txt$/);
});

test('the card × puts the pasted text back inline and removes the pending card', async t => {
  const signals = [];
  const attachments = { upload: (files, signal) => new Promise((resolve, reject) => { signals.push(signal); signal.addEventListener('abort', () => reject(new Error('aborted'))); }) };
  const { container, act, window, controller } = await harness(t, { attachments });
  const field = container.querySelector('[data-testid=composer-input]');
  await act(async () => { controller.setText('Before '); });
  await act(async () => paste(window, field, LONG));
  await act(async () => container.querySelector('[data-testid=upload-chip][data-state=uploading] button').click());
  assert.equal(container.querySelector('[data-testid=upload-chip]'), null, 'the pending card is removed');
  assert.equal(signals[0].aborted, true, 'the upload is abandoned');
  assert.equal(controller.getSnapshot().draft.text, `Before ${LONG}`, 'the text is back inline after what was typed');
});

test('Ctrl+Z right after the paste puts the text back inline', async t => {
  const attachments = { upload: (files, signal) => new Promise((resolve, reject) => { signal.addEventListener('abort', () => reject(new Error('aborted'))); }) };
  const { container, act, window, controller } = await harness(t, { attachments });
  const field = container.querySelector('[data-testid=composer-input]');
  await act(async () => paste(window, field, LONG));
  const undo = new window.KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true });
  await act(async () => { field.dispatchEvent(undo); });
  assert.equal(container.querySelector('[data-testid=upload-chip]'), null);
  assert.equal(controller.getSnapshot().draft.text, LONG);
});

test('a finished paste is sent as an attachment: its mention is in the composer', async t => {
  const pending = [];
  const attachments = { upload: (files, signal) => new Promise(resolve => { pending.push(resolve); }) };
  const { container, act, window, controller } = await harness(t, { attachments });
  await act(async () => paste(window, container.querySelector('[data-testid=composer-input]'), LONG));
  await act(async () => pending[0]([{ path: 'uploads/Texte_colle-9a8b7c6d.md', name: 'Texte collé.md' }]));
  assert.match(controller.getSnapshot().draft.text, /@uploads\/Texte_colle-9a8b7c6d\.md/);
  assert.equal(container.querySelector('[data-testid=upload-chip]'), null);
  assert.ok(container.querySelector('[data-testid=mention-chip][data-path="uploads/Texte_colle-9a8b7c6d.md"]'));
});

test('without attachments a large paste stays inline exactly as before', async t => {
  const { container, act, window, controller } = await harness(t, { pasteToFile: { minLines: 3 } });
  const field = container.querySelector('[data-testid=composer-input]');
  let result;
  await act(async () => { result = paste(window, field, LONG); });
  assert.equal(result.prevented, false);
  assert.equal(container.querySelector('[data-testid=upload-chip]'), null);
  assert.equal(controller.getSnapshot().draft.text, '');
});

test('a host can omit PiChat’s header without losing its composer', async t => {
  const { container, rerender } = await harness(t);
  assert.ok(container.querySelector('[data-boring=pi-chat] > header'));
  await rerender({ header: false });
  assert.equal(Boolean(container.querySelector('[data-boring=pi-chat] > header')), false);
  assert.ok(container.querySelector('[data-testid=composer-input]'));
});

const toolCall = (id, name, path) => ({ type: 'toolCall', id, name, arguments: { path } });
const modelReply = content => ({ role: 'assistant', content, api: 'fictional', provider: 'fictional', model: 'fictional', usage: {}, stopReason: 'stop', timestamp: 0 });
const toolResult = (id, toolName, isError = false) => ({ role: 'toolResult', toolCallId: id, toolName, content: [{ type: 'text', text: isError ? 'Refused' : 'Saved' }], isError, timestamp: 0 });

test('native write/edit results reuse file cards below the reply, deduplicate paths and open through onOpenFile', async t => {
  const opened = [];
  const { container, write, act, rerender } = await harness(t, { onOpenFile: path => opened.push(path), extra: { fileChanges: true } });
  await write([
    modelReply([toolCall('w1', 'write', 'tt.md'), toolCall('e1', 'edit', './tt.md'), toolCall('e2', 'edit', 'budget.xlsx'), toolCall('bad', 'write', 'failed.md'), toolCall('read', 'read', 'read.md'), toolCall('pending', 'write', 'pending.md')]),
    toolResult('w1', 'write'), toolResult('e1', 'edit'), toolResult('e2', 'edit'), toolResult('bad', 'write', true), toolResult('read', 'read'),
    modelReply([{ type: 'text', text: 'The fictional files are ready.' }]),
  ]);
  const cards = [...container.querySelectorAll('[data-testid=reply-files] [data-testid=message-mention]')];
  assert.deepEqual(cards.map(card => card.dataset.path), ['tt.md', 'budget.xlsx']);
  assert.match(cards[0].closest('[data-slot=attachment]').textContent, /tt.md.*Created/s, 'a write followed by edits is one created file');
  assert.match(cards[1].closest('[data-slot=attachment]').textContent, /budget.xlsx.*Edited/s);
  const prose = [...container.querySelectorAll('[data-role=assistant] p')].find(node => node.textContent === 'The fictional files are ready.');
  assert.ok(prose.compareDocumentPosition(container.querySelector('[data-testid=reply-files]')) & 4, 'file cards follow the reply text');
  await act(async () => cards[0].click());
  assert.deepEqual(opened, ['tt.md']);
  await rerender({ locale: 'fr' });
  assert.match(container.querySelector('[data-testid=reply-files]').textContent, /Créé|Modifié/);
  await rerender({ fileChanges: false });
  assert.equal(container.querySelector('[data-testid=reply-files]'), null, 'opt-in, so unrelated tools named write never gain file semantics by default');
});

const flush = () => new Promise(resolve => setTimeout(resolve, 0));
const undoEvent = window => new window.KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true });

test('a paste over a selection replaces it at once, and cancelling deletes nothing typed since', async t => {
  const attachments = { upload: (files, signal) => new Promise((resolve, reject) => { signal.addEventListener('abort', () => reject(new Error('aborted'))); }) };
  const { container, act, window, controller } = await harness(t, { attachments });
  await act(async () => { controller.setText('OLD TEXT'); });
  const field = container.querySelector('[data-testid=composer-input]');
  field.setSelectionRange(0, 8);
  await act(async () => { paste(window, field, LONG); });
  assert.equal(controller.getSnapshot().draft.text.includes('OLD'), false, 'the selection is removed when the paste is accepted');
  await act(async () => { controller.setText('KEEP'); });
  await act(async () => container.querySelector('[data-testid=upload-chip][data-state=uploading] button').click());
  assert.equal(controller.getSnapshot().draft.text, `${LONG}KEEP`, 'the text goes back and what was typed since is kept');
});

test('Ctrl+Z stops restoring once the person has typed after the paste', async t => {
  const attachments = { upload: (files, signal) => new Promise((resolve, reject) => { signal.addEventListener('abort', () => reject(new Error('aborted'))); }) };
  const { container, act, window, controller } = await harness(t, { attachments });
  const field = container.querySelector('[data-testid=composer-input]');
  await act(async () => { paste(window, field, LONG); });
  await act(async () => { controller.setText('typed after'); });
  let notPrevented;
  await act(async () => { notPrevented = field.dispatchEvent(undoEvent(window)); });
  assert.equal(notPrevented, true, 'Ctrl+Z is left to the textarea');
  assert.ok(container.querySelector('[data-testid=upload-chip][data-state=uploading]'), 'the pending card stays');
});

test('a failed pasted-text upload keeps a button that puts the text back', async t => {
  const attachments = { upload: () => Promise.reject(new Error('Fictional refusal')) };
  const { container, act, window, controller } = await harness(t, { attachments });
  await act(async () => { paste(window, container.querySelector('[data-testid=composer-input]'), LONG); });
  await act(async () => flush());
  const chip = container.querySelector('[data-testid=upload-chip][data-state=failed]');
  assert.ok(chip, 'the upload failed');
  const restore = [...chip.querySelectorAll('button')].find(button => button.getAttribute('aria-label') === 'Put the pasted text back in the message');
  assert.ok(restore, 'the failed chip offers the restore');
  await act(async () => restore.click());
  assert.equal(controller.getSnapshot().draft.text, LONG);
  assert.equal(container.querySelector('[data-testid=upload-chip]'), null);
});

test('an upload mention is a card when only attachments is set (no mentions search config)', async t => {
  const { controller, container, act } = await harness(t, { attachments: { upload: async () => [] }, onOpenFile: () => {} });
  await act(async () => { controller.setText(SENT); });
  await act(async () => { container.querySelector('[data-testid=composer-submit]').click(); });
  assert.ok(container.querySelector('[data-testid=message-mention][data-path="uploads/report-1a2b3c4d.pdf"]'), 'the card renders');
  assert.equal(container.querySelector('[data-testid=user-text]').textContent.includes('@uploads'), false);
});

test('AmbientChat forwards onOpenFile and pasteToFile', async t => {
  const opened = [];
  const uploads = [];
  const attachments = { upload: (files, signal) => new Promise(() => { uploads.push(files); }) };
  const { controller, container, act, window } = await harness(t, { component: AmbientChat, attachments, onOpenFile: path => opened.push(path), pasteToFile: { minLines: 3 },
    extra: { defaultState: 'expanded' } });
  await act(async () => { controller.setText(SENT); });
  await act(async () => { container.querySelector('[data-testid=composer-submit]').click(); });
  const card = container.querySelector('[data-testid=message-mention]');
  assert.equal(card?.tagName, 'BUTTON', 'the card is clickable through the ambient chat');
  await act(async () => card.click());
  assert.deepEqual(opened, ['uploads/report-1a2b3c4d.pdf']);
  await act(async () => { paste(window, container.querySelector('[data-testid=composer-input]'), 'one\ntwo\nthree\nfour'); });
  assert.equal(uploads.length, 1, 'the custom threshold applies through the ambient chat');
});

test('a thumbnail is dropped when its provider changes and when a read is unavailable', async t => {
  const good = async () => ({ mimeType: 'image/png', data: 'iVBORw0KGgo=' });
  const { controller, container, act, rerender } = await harness(t, { mentions: { search: async () => [], preview: good }, onOpenFile: () => {} });
  await act(async () => { controller.setText('See @uploads/photo-5e6f7a8b.png'); });
  await act(async () => { container.querySelector('[data-testid=composer-submit]').click(); });
  await act(async () => flush());
  const image = () => container.querySelector('[data-testid=message-file] [data-slot=attachment-media] img');
  assert.ok(image(), 'the thumbnail shows');
  await rerender({ mentions: { search: async () => [], preview: async () => undefined } });
  await act(async () => flush());
  assert.equal(image(), null, 'an unavailable read shows the icon');
  await rerender({ mentions: { search: async () => [], preview: good } });
  await act(async () => flush());
  assert.ok(image());
  await rerender({ mentions: { search: async () => [], preview: async () => { throw new Error('Fictional read failure'); } } });
  await act(async () => flush());
  assert.equal(image(), null, 'a failed read shows the icon');
  await rerender({ mentions: { search: async () => [] } });
  await act(async () => flush());
  assert.equal(image(), null, 'a removed provider shows the icon');
});

test('without onOpenFile a card opens through mentions.open, as the chip it replaces did', async t => {
  const opened = [];
  const { controller, container, act } = await harness(t, { mentions: { search: async () => [], open: path => opened.push(path) } });
  await act(async () => { controller.setText(SENT); });
  await act(async () => { container.querySelector('[data-testid=composer-submit]').click(); });
  const card = container.querySelector('[data-testid=message-mention][data-path="uploads/report-1a2b3c4d.pdf"]');
  assert.equal(card?.tagName, 'BUTTON', 'the card is clickable through mentions.open');
  await act(async () => card.click());
  assert.deepEqual(opened, ['uploads/report-1a2b3c4d.pdf']);
});

async function voiceHarness(t, config = {}) {
  const uploads = [], transcriptions = [], sends = [], tracks = [];
  let uploadError = false, transcribeError = false, spoken = 'Je mange une salade';
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let gated = config.gated ?? false;
  const voiceMessage = { transcribe: async (audio, signal) => {
    transcriptions.push({ audio, signal }); if (gated) await gate;
    if (transcribeError) throw new Error('fictional transcription failure'); return spoken;
  }, ...config.voiceMessage };
  const attachments = { upload: async (files, signal) => {
    uploads.push({ files, signal }); if (gated) await gate;
    if (uploadError) throw new Error('fictional upload failure');
    return [{ path: `uploads/${files[0].name}`, name: files[0].name }];
  } };
  const ui = await harness(t, { extra: { voiceMessage, ...config.extra }, attachments, beforeSubmit: config.beforeSubmit, lostAdmission: config.lostAdmission, admissionGate: config.admissionGate, stagedFailure: config.stagedFailure });
  const before = Object.getOwnPropertyDescriptor(globalThis, 'MediaRecorder');
  class Recorder extends EventTarget {
    static isTypeSupported(type) { return !config.mp4 || type === 'audio/mp4'; }
    constructor() { super(); this.mimeType = config.mp4 ? 'audio/mp4' : 'audio/webm'; this.state = 'inactive'; }
    start() { this.state = 'recording'; }
    stop() { this.state = 'inactive'; const event = new Event('dataavailable'); event.data = new Blob(['fictional audio'], { type: this.mimeType }); this.dispatchEvent(event); this.dispatchEvent(new Event('stop')); }
  }
  globalThis.MediaRecorder = Recorder;
  Object.defineProperty(ui.window.navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: async () => {
    const track = { stopped: false, stop() { this.stopped = true; } }; tracks.push(track);
    return { getTracks: () => [track] };
  } } });
  t.after(() => { if (before) Object.defineProperty(globalThis, 'MediaRecorder', before); else delete globalThis.MediaRecorder; });
  const real = ui.controller.send;
  ui.controller.send = async (...args) => { sends.push(args); return real(...args); };
  const button = () => ui.container.querySelector('[data-testid=voice-message-record]');
  const pointer = async type => ui.act(async () => button().dispatchEvent(new ui.window.PointerEvent(type, { bubbles: true, cancelable: true, button: 0, pointerId: 7 })));
  const key = async (type, key) => ui.act(async () => button().dispatchEvent(new ui.window.KeyboardEvent(type, { bubbles: true, cancelable: true, key })));
  const until = async predicate => { for (let n = 0; n < 200 && !predicate(); n++) await ui.act(async () => new Promise(resolve => setTimeout(resolve, 5))); assert.ok(predicate()); };
  return { ...ui, button, pointer, key, until, uploads, transcriptions, sends, tracks,
    release: async () => ui.act(async () => { gated = false; release(); }),
    failUpload: value => { uploadError = value; }, failTranscribe: value => { transcribeError = value; }, spoken: value => { spoken = value; },
    click: async id => ui.act(async () => ui.container.querySelector(`[data-testid=${id}]`).click()),
  };
}

test('voice release starts upload and transcription in parallel, then admits one text entry and preserves the draft', async t => {
  const ui = await voiceHarness(t, { gated: true });
  await ui.act(async () => ui.controller.setText('A later typed draft'));
  const field = ui.container.querySelector('[data-testid=composer-input]'); field.focus();
  await ui.pointer('pointerdown');
  assert.equal(ui.window.document.activeElement, field, 'holding never moves focus');
  assert.equal(ui.uploads.length, 0);
  await ui.pointer('pointerup');
  assert.equal(ui.uploads.length, 1); assert.equal(ui.transcriptions.length, 1);
  assert.ok(ui.container.querySelector('[data-testid=voice-pending]'));
  assert.equal(ui.sends.length, 0);
  assert.ok(ui.tracks.every(track => track.stopped));
  await ui.release();
  await ui.until(() => ui.sends.length === 1 && !ui.container.querySelector('[data-testid=voice-pending]') && !!ui.container.querySelector('[data-testid=voice-bubble]'));
  assert.match(ui.sends[0][1].text, /^@uploads\/voice-.*\.webm Je mange une salade$/);
  assert.deepEqual(ui.sends[0][1].restore, { text: 'Je mange une salade' });
  assert.equal(ui.controller.getSnapshot().draft.text, 'A later typed draft');
  assert.equal(ui.container.querySelector('[data-testid=voice-bubble]').textContent.includes('Je mange une salade'), true);
});

test('slide, Escape, blur and hidden document cancel without upload or send; pointercancel keeps audio', async t => {
  const ui = await voiceHarness(t);
  await ui.pointer('pointerdown');
  await ui.act(async () => ui.button().dispatchEvent(new ui.window.PointerEvent('pointermove', { bubbles: true, pointerId: 7, clientX: -100, clientY: -100 })));
  await ui.pointer('pointerup');
  await ui.pointer('pointerdown'); await ui.key('keydown', 'Escape'); await ui.pointer('pointerup');
  await ui.pointer('pointerdown'); await ui.act(async () => ui.window.dispatchEvent(new ui.window.Event('blur'))); await ui.pointer('pointerup');
  await ui.pointer('pointerdown');
  await ui.act(async () => { Object.defineProperty(ui.window.document, 'hidden', { configurable: true, value: true }); ui.window.document.dispatchEvent(new ui.window.Event('visibilitychange')); });
  await ui.pointer('pointerup');
  assert.equal(ui.uploads.length, 0); assert.equal(ui.sends.length, 0); assert.ok(ui.tracks.every(track => track.stopped));
  Object.defineProperty(ui.window.document, 'hidden', { configurable: true, value: false });
  await ui.pointer('pointerdown'); await ui.pointer('pointercancel');
  await ui.until(() => ui.sends.length === 1);
});

test('Escape cancels held audio even when a picker consumes the key in capture', async t => {
  const ui = await voiceHarness(t);
  // SlashMenu and host popovers consume Escape during the window capture phase.
  const picker = event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); } };
  ui.window.addEventListener('keydown', picker, { capture: true });
  t.after(() => ui.window.removeEventListener('keydown', picker, { capture: true }));
  await ui.pointer('pointerdown'); await ui.key('keydown', 'Escape');
  assert.ok(ui.tracks.length > 0 && ui.tracks.every(track => track.stopped), 'Escape releases this recording even when its bubble listener cannot run');
  await ui.pointer('pointerup');
  assert.equal(ui.uploads.length, 0); assert.equal(ui.transcriptions.length, 0); assert.equal(ui.sends.length, 0);
});

test('a failed transcription stays failed until Retry, reusing the uploaded audio', async t => {
  const ui = await voiceHarness(t); ui.failTranscribe(true);
  await ui.pointer('pointerdown'); await ui.pointer('pointerup');
  await ui.until(() => !!ui.container.querySelector('[data-testid=voice-retry]'));
  assert.equal(ui.sends.length, 0); assert.ok(ui.container.querySelector('[data-testid=voice-audio-only]'));
  assert.doesNotMatch(ui.container.querySelector('[data-testid=voice-pending]').textContent, /0:00/, 'a zero-second failure never claims a known duration');
  const pending = { id: 1, path: `uploads/${ui.uploads[0].files[0].name}`, phase: 'transcribe-failed', seconds: 10, retry() {}, audioOnly: undefined, discard() {} };
  await ui.rerender({ pendingVoice: [pending] });
  assert.equal(ui.container.querySelector('[data-testid=voice-pending-duration]')?.textContent, '0:10', 'a known positive duration stays visible');
  for (const seconds of [0, NaN, Infinity, -1]) {
    await ui.rerender({ pendingVoice: [{ ...pending, seconds }] });
    assert.equal(ui.container.querySelector('[data-testid=voice-pending-duration]'), null, 'zero or unknown duration is hidden');
    assert.doesNotMatch(ui.container.querySelector('[data-testid=voice-pending]').textContent, /0:00|NaN|Infinity/);
  }
  await ui.rerender({ pendingVoice: undefined });
  ui.failTranscribe(false); await ui.click('voice-retry'); await ui.until(() => ui.sends.length === 1);
  assert.equal(ui.uploads.length, 1); assert.equal(ui.transcriptions.length, 2);
});

test('empty transcription needs explicit audio-only confirmation, and Safari recordings keep mp4', async t => {
  const ui = await voiceHarness(t, { mp4: true }); ui.spoken('   ');
  await ui.key('keydown', ' '); await ui.key('keyup', ' ');
  await ui.until(() => !!ui.container.querySelector('[data-testid=voice-audio-only]'));
  assert.equal(ui.sends.length, 0); assert.equal(ui.uploads[0].files[0].type, 'audio/mp4');
  await ui.click('voice-audio-only'); await ui.until(() => ui.sends.length === 1);
  assert.match(ui.sends[0][1].text, /^@uploads\/voice-.*\.mp4$/);
});

test('upload failure retries only the upload, and Discard abandons pending work', async t => {
  const ui = await voiceHarness(t); ui.failUpload(true);
  await ui.pointer('pointerdown'); await ui.pointer('pointerup');
  await ui.until(() => !!ui.container.querySelector('[data-testid=voice-retry]'));
  assert.equal(ui.sends.length, 0); assert.equal(ui.container.querySelector('[data-testid=voice-audio-only]'), null);
  ui.failUpload(false); await ui.click('voice-retry'); await ui.until(() => ui.sends.length === 1 && !ui.container.querySelector('[data-testid=voice-pending]'));
  assert.equal(ui.transcriptions.length, 1); assert.equal(ui.uploads.length, 2);
  ui.failTranscribe(true); await ui.pointer('pointerdown'); await ui.pointer('pointerup');
  await ui.until(() => !!ui.container.querySelector('[data-testid=voice-discard]'));
  await ui.click('voice-discard'); assert.equal(ui.container.querySelector('[data-testid=voice-pending]'), null);
});

test('a stale controller or removed voice capability aborts pending work and never sends late results', async t => {
  const ui = await voiceHarness(t, { gated: true });
  await ui.pointer('pointerdown'); await ui.pointer('pointerup');
  const signal = ui.transcriptions[0].signal;
  await ui.rerender({ controller: { ...ui.controller } });
  await ui.release();
  assert.equal(signal.aborted, true); assert.equal(ui.sends.length, 0);
  await ui.rerender({ voiceMessage: undefined });
  assert.equal(ui.button(), null);
});

test('without the voiceMessage prop PiChat adds no microphone', async t => {
  const ui = await harness(t);
  assert.equal(ui.container.querySelector('[data-testid=voice-message-record]'), null);
  assert.equal(ui.container.querySelector('[data-testid=composer-tools]'), null, 'no empty tools wrapper changes the existing bar');
});

test('blocked voice admission restores only the transcript beside later typing, and offers no automatic resend', async t => {
  const ui = await voiceHarness(t, { beforeSubmit: async () => 'Fictional host refusal' });
  await ui.act(async () => ui.controller.setText('Keep this typed draft'));
  await ui.pointer('pointerdown'); await ui.pointer('pointerup');
  await ui.until(() => ui.controller.getSnapshot().send.kind === 'blocked');
  const draft = ui.controller.getSnapshot().draft.text;
  assert.ok(draft.includes('Keep this typed draft') && draft.includes('Je mange une salade'));
  assert.equal(draft.includes('@uploads/'), false, 'restoration does not insert the audio mention');
  assert.equal(ui.container.querySelector('[data-testid=voice-retry]'), null);
  assert.equal(ui.sends.length, 1);
});

test('unknown voice admission delegates reconciliation to the native controller, never fresh Retry', async t => {
  const ui = await voiceHarness(t, { lostAdmission: true });
  await ui.pointer('pointerdown'); await ui.pointer('pointerup');
  await ui.until(() => ui.container.querySelector('[data-testid=voice-pending]')?.dataset.state === 'unconfirmed');
  assert.equal(ui.sends.length, 1); assert.equal(ui.container.querySelector('[data-testid=voice-retry]'), null);
  await ui.act(async () => ui.controller.reconcile());
  await ui.until(() => !ui.container.querySelector('[data-testid=voice-pending]'));
  assert.equal(ui.sends.length, 1);
});

test('maxMs caps microphone capture but still waits for release; unmount aborts pending work', async t => {
  const ui = await voiceHarness(t, { gated: true, voiceMessage: { maxMs: 40 } });
  await ui.pointer('pointerdown');
  await ui.until(() => ui.tracks[0].stopped);
  assert.equal(ui.transcriptions.length, 0, 'the duration cap does not send before release');
  await ui.pointer('pointerup');
  await ui.until(() => ui.transcriptions.length === 1);
  assert.equal(ui.tracks[0].stopped, true);
  await ui.unmount(); await ui.release();
  assert.equal(ui.transcriptions[0].signal.aborted, true); assert.equal(ui.sends.length, 0);
});

test('voice replay fetches lazily, drives play/pause and duration, and revokes its Blob URL on provider replacement', async t => {
  const reads = [], revoked = [];
  const realRevoke = URL.revokeObjectURL;
  URL.revokeObjectURL = url => { revoked.push(url); realRevoke(url); };
  t.after(() => { URL.revokeObjectURL = realRevoke; });
  const ui = await harness(t, { mentions: { search: async () => [], preview: async path => { reads.push(path); return { mimeType: 'audio/webm', data: 'ZmFrZQ==' }; } } });
  await ui.write([{ role: 'user', content: '@uploads/voice-20261020-101500.webm A fictional transcript', timestamp: 0 }]);
  const audio = ui.container.querySelector('[data-testid=voice-bubble] audio');
  assert.ok(audio); assert.equal(reads.length, 0);
  let playing = false;
  Object.defineProperty(audio, 'paused', { get: () => !playing });
  audio.play = async () => { playing = true; audio.dispatchEvent(new ui.window.Event('play')); };
  audio.pause = () => { playing = false; audio.dispatchEvent(new ui.window.Event('pause')); };
  audio.load = () => {};
  const play = () => ui.container.querySelector('[data-testid=voice-play]');
  await ui.act(async () => { play().click(); play().click(); });
  assert.deepEqual(reads, ['uploads/voice-20261020-101500.webm'], 'rapid Play presses share one lazy read');
  assert.equal(play().getAttribute('aria-label'), 'Pause voice message');
  const src = audio.src; assert.ok(src.startsWith('blob:'));
  Object.defineProperty(audio, 'duration', { value: 12.3 });
  await ui.act(async () => audio.dispatchEvent(new ui.window.Event('loadedmetadata')));
  assert.equal(ui.container.querySelector('[data-testid=voice-duration]').textContent, '0:12');
  await ui.act(async () => play().click());
  assert.equal(play().getAttribute('aria-label'), 'Play voice message');
  await ui.rerender({ mentions: { search: async () => [], preview: async () => undefined } });
  assert.deepEqual(revoked, [src]);
});

test('Enter ignores repeat and a release while permission is opening discards the late microphone', async t => {
  const ui = await voiceHarness(t);
  await ui.key('keydown', 'Enter');
  await ui.act(async () => ui.button().dispatchEvent(new ui.window.KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Enter', repeat: true })));
  assert.equal(ui.tracks.length, 1);
  await ui.key('keyup', 'Enter'); await ui.until(() => ui.sends.length === 1);
  await ui.until(() => !ui.container.querySelector('[data-testid=voice-pending]'));
  let allow;
  const track = { stopped: false, stop() { this.stopped = true; } };
  Object.defineProperty(ui.window.navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: () => new Promise(resolve => { allow = () => resolve({ getTracks: () => [track] }); }) } });
  await ui.pointer('pointerdown'); await ui.pointer('pointerup');
  await ui.act(async () => allow());
  assert.equal(track.stopped, true); assert.equal(ui.sends.length, 1); assert.equal(ui.uploads.length, 1);
});

test('a signed audio URL is requested only on Play and superseded preview work is aborted', async t => {
  const urls = [], reads = [];
  const ui = await harness(t, { mentions: { search: async () => [], audioUrl: async path => { urls.push(path); return 'https://media.example.invalid/fictional-signed.webm'; }, preview: async path => { reads.push(path); } } });
  await ui.write([{ role: 'user', content: '@uploads/voice-20261020-101500.webm Signed replay', timestamp: 0 }]);
  assert.deepEqual(urls, []);
  const audio = ui.container.querySelector('[data-testid=voice-bubble] audio');
  audio.play = async () => { audio.dispatchEvent(new ui.window.Event('play')); }; audio.pause = () => {}; audio.load = () => {};
  await ui.act(async () => ui.container.querySelector('[data-testid=voice-play]').click());
  assert.equal(audio.src, 'https://media.example.invalid/fictional-signed.webm');
  assert.deepEqual(urls, ['uploads/voice-20261020-101500.webm']); assert.deepEqual(reads, []);
  let done, signal;
  await ui.rerender({ mentions: { search: async () => [], preview: (_path, selected) => { signal = selected; return new Promise(resolve => { done = resolve; }); } } });
  await ui.act(async () => ui.container.querySelector('[data-testid=voice-play]').click());
  await ui.rerender({ mentions: { search: async () => [], preview: async () => undefined } });
  assert.equal(signal.aborted, true);
  await ui.act(async () => done({ mimeType: 'audio/webm', data: 'ZmFrZQ==' }));
  assert.equal(audio.getAttribute('src'), null, 'late bytes never replace the new provider view');
});

test('a different uncertain submission cannot be mistaken for the pending recording', async t => {
  const ui = await voiceHarness(t, { gated: true, lostAdmission: true });
  await ui.pointer('pointerdown'); await ui.pointer('pointerup');
  await ui.act(async () => ui.controller.send(undefined, { text: 'An earlier fictional request' }));
  assert.equal(ui.controller.getSnapshot().send.kind, 'unknown');
  await ui.release();
  await ui.until(() => ui.container.querySelector('[data-testid=voice-pending]')?.dataset.state === 'blocked');
  assert.equal(ui.sends.length, 1, 'the recording is not sent against another uncertain request');
  assert.equal(ui.controller.getSnapshot().draft.text, 'Je mange une salade');
  await ui.act(async () => ui.controller.reconcile());
  assert.ok(ui.container.querySelector('[data-testid=voice-pending]'), 'reconciling another request never reports this recording as admitted');
});

test('changing the public principal fences late voice results on the same controller', async t => {
  const ui = await voiceHarness(t, { gated: true });
  const get = ui.controller.getSnapshot;
  let identity = { ...get().identity, principalId: 'fictional-first' }, cached, prior, actor;
  ui.controller.getSnapshot = () => {
    const next = get();
    if (next !== prior || actor !== identity) { prior = next; actor = identity; cached = { ...next, identity }; }
    return cached;
  };
  await ui.rerender({});
  await ui.pointer('pointerdown'); await ui.pointer('pointerup');
  identity = { ...identity, principalId: 'fictional-second' };
  await ui.rerender({}); await ui.release();
  assert.equal(ui.transcriptions[0].signal.aborted, true); assert.equal(ui.sends.length, 0);
});

test('a voice queued behind uncertain admission is restored, never bound to that older request', async t => {
  let release;
  const admissionGate = new Promise(resolve => { release = resolve; });
  const ui = await voiceHarness(t, { lostAdmission: true, admissionGate });
  let prior;
  await ui.act(async () => { prior = ui.controller.send(undefined, { text: 'An earlier fictional request' }); });
  await ui.until(() => ui.controller.getSnapshot().send.kind === 'submitting');
  await ui.pointer('pointerdown'); await ui.pointer('pointerup');
  await ui.until(() => ui.controller.getSnapshot().outbox.length === 1);
  await ui.act(async () => { release(); await prior; });
  await ui.until(() => ui.container.querySelector('[data-testid=voice-pending]')?.dataset.state === 'blocked');
  assert.equal(ui.controller.getSnapshot().draft.text, 'Je mange une salade');
  assert.equal(ui.sends.length, 2);
  await ui.act(async () => ui.controller.reconcile());
  assert.ok(ui.container.querySelector('[data-testid=voice-pending]'));
});

for (const lost of [true, 2]) test(`identical content behind earlier validation binds only its own request (lost ${lost === true ? 'earlier' : 'voice'} response)`, async t => {
  let unblock, first = true;
  const validation = new Promise(resolve => { unblock = resolve; });
  const ui = await voiceHarness(t, { gated: true, lostAdmission: lost, beforeSubmit: () => { if (first) { first = false; return validation; } } });
  await ui.pointer('pointerdown'); await ui.pointer('pointerup');
  const text = `@uploads/${ui.uploads[0].files[0].name} Je mange une salade`;
  let prior;
  await ui.act(async () => { prior = ui.controller.send(undefined, { text }); });
  assert.equal(ui.controller.getSnapshot().send.kind, 'validating');
  await ui.release(); await ui.until(() => ui.controller.getSnapshot().outbox.length === 1);
  await ui.act(async () => { unblock(); await prior; });
  await ui.until(() => ui.controller.getSnapshot().send.kind === 'unknown');
  assert.equal(ui.container.querySelector('[data-testid=voice-pending]')?.dataset.state, lost === true ? 'blocked' : 'unconfirmed', 'equal text is not request identity');
  await ui.act(async () => ui.controller.reconcile());
  if (lost === true) assert.ok(ui.container.querySelector('[data-testid=voice-pending]'), 'reconciling the older identical message never clears an unsent recording');
  else await ui.until(() => !ui.container.querySelector('[data-testid=voice-pending]'));
});

test('retained voice recognition works with slash-only configuration without styling ordinary uploads', async t => {
  const ui = await harness(t, { extra: { slash: { skills: [{ name: 'plan', description: 'Fictional planning' }] } } });
  await ui.write([{ role: 'user', content: '/plan @uploads/voice-20261020-101500.webm Spoken words @uploads/song.mp3', timestamp: 0 }]);
  const bubble = ui.container.querySelector('[data-testid=voice-bubble]');
  assert.ok(bubble); assert.match(bubble.textContent, /Spoken words @uploads\/song.mp3/);
  assert.equal(bubble.querySelector('[data-testid=message-skill]').textContent, '/plan');
  assert.equal(ui.container.querySelector('[data-testid=message-files]'), null, 'ordinary uploads keep their prior plain treatment');
});

test('an admission becoming uncertain during a hold cannot disable the release that stops the microphone', async t => {
  const ui = await voiceHarness(t, { lostAdmission: true });
  await ui.pointer('pointerdown');
  await ui.act(async () => ui.controller.send(undefined, { text: 'An earlier fictional request' }));
  assert.equal(ui.controller.getSnapshot().send.kind, 'unknown');
  assert.equal(ui.button().disabled, false, 'the held control still receives release');
  await ui.pointer('pointerup');
  await ui.until(() => ui.container.querySelector('[data-testid=voice-pending]')?.dataset.state === 'blocked');
  assert.equal(ui.tracks[0].stopped, true); assert.equal(ui.sends.length, 1);
  assert.equal(ui.controller.getSnapshot().draft.text, 'Je mange une salade');
});

test('failed voice is a transcript row and leaves the mic available for another retained recording', async t => {
  const ui = await voiceHarness(t, { extra: { onOpenFile: () => {} } }); ui.failTranscribe(true);
  await ui.pointer('pointerdown'); await ui.pointer('pointerup');
  await ui.until(() => !!ui.container.querySelector('[data-testid=voice-retry]'));
  const failed = ui.container.querySelector('[data-testid=voice-pending]');
  assert.equal(failed.closest('[data-testid=transcript]')?.getAttribute('data-testid'), 'transcript');
  assert.equal(failed.closest('[data-testid=composer-dock]'), null);
  const discard = failed.querySelector('[data-testid=voice-discard]');
  assert.equal(discard.tagName, 'BUTTON');
  assert.equal(discard.dataset.slot, 'button');
  assert.ok(discard.classList.contains('dark:hover:bg-muted/50'), 'the pinned native Button renders its actual ghost variant');
  assert.equal(ui.button().disabled, false);
  assert.equal(ui.button().dataset.state, 'idle');
  assert.match(ui.container.querySelector('[data-testid=conversation-files]').textContent, /· 1$/);
  await ui.pointer('pointerdown');
  assert.equal(ui.button().dataset.state, 'recording');
  assert.equal(ui.container.querySelector('[data-testid=voice-pending]'), failed);
  await ui.pointer('pointerup');
  await ui.until(() => ui.container.querySelectorAll('[data-testid=voice-retry]').length === 2);
  assert.equal(ui.uploads.length, 2); assert.equal(ui.sends.length, 0);
  await ui.click('voice-discard');
  assert.equal(ui.container.querySelectorAll('[data-testid=voice-pending]').length, 1, 'discard affects only its own recording');
  ui.failTranscribe(false); await ui.click('voice-retry'); await ui.until(() => ui.sends.length === 1);
  assert.equal(ui.uploads.length, 2, 'retry reuses the surviving recording');
});

test('an explicit display limit counts pending voice rows and Show earlier retains hidden failures and native messages', async t => {
  const ui = await voiceHarness(t, { extra: { displayLimit: 1 } });
  await ui.write([{ role: 'user', content: 'An earlier fictional message', timestamp: 0 }]);
  ui.failTranscribe(true);
  await ui.pointer('pointerdown'); await ui.pointer('pointerup');
  await ui.until(() => !!ui.container.querySelector('[data-testid=voice-retry]'));
  assert.equal(ui.container.querySelectorAll('[data-row-id], [data-local-voice]').length, 1, 'the pending message uses the same display-row budget as native rows');
  assert.doesNotMatch(ui.container.querySelector('[data-testid=transcript]').textContent, /An earlier fictional message/);
  await ui.pointer('pointerdown'); await ui.pointer('pointerup');
  await ui.until(() => ui.uploads.length === 2 && ui.container.querySelector('[data-testid=voice-pending]')?.dataset.state === 'transcribe-failed');
  assert.equal(ui.container.querySelectorAll('[data-row-id], [data-local-voice]').length, 1);
  assert.equal(ui.container.querySelector('[data-testid=voice-pending]').dataset.voiceId, '2', 'the newest pending row remains visible');
  await ui.click('transcript-history-load');
  assert.equal(ui.container.querySelectorAll('[data-testid=voice-pending]').length, 2, 'Show earlier restores the older failed row without dropping its actions');
  assert.match(ui.container.querySelector('[data-testid=transcript]').textContent, /An earlier fictional message/);
  assert.equal(ui.uploads.length, 2); assert.equal(ui.sends.length, 0);
});

for (const failure of [0, 1, 2]) test(`recorded voice composes with native staged answers and transcript-only restoration (stage failure ${failure})`, { timeout: 20000 }, async t => {
  const ui = await voiceHarness(t, { stagedFailure: failure, extra: {
    presentation: 'natural', displayLimit: 24, hideLine: line => line.startsWith('::meta '),
    renderEntry: entry => entry.kind === 'fictional.triage.stage' ? { inline: true, content: `Stage ${entry.data.stage}: ${entry.data.state}`, status: entry.data.state === 'running' ? 'Validating fictional note' : null } : undefined,
  } });
  await ui.act(async () => ui.controller.setText('A later typed draft'));
  await ui.pointer('pointerdown'); await ui.pointer('pointerup');
  await ui.until(() => ui.sends.length === 1 && ui.controller.getSnapshot().send.kind === 'admitted');
  await ui.act(async () => ui.controller.conversation.waitForIdle(ui.context));
  await ui.until(() => failure ? !!ui.container.querySelector('[data-testid=response-error]') : ui.container.textContent.includes('Synthèse fictive'));
  const input = ui.controller.getSnapshot().view.entries.find(entry => entry.kind === 'fictional.triage.question');
  assert.equal(input.model[0].content, ui.sends[0][1].text, 'the native staged input retains the exact audio reference and transcript');
  assert.match(input.model[0].content, /^@uploads\/voice-.*\.webm Je mange une salade$/);
  assert.deepEqual(ui.sends[0][1].restore, { text: 'Je mange une salade' });
  assert.equal(ui.uploads.length, 1); assert.equal(ui.transcriptions.length, 1); assert.equal(ui.sends.length, 1);
  assert.ok(ui.container.querySelector('[data-testid=voice-bubble]'), 'staged rendering keeps the retained voice bubble');
  assert.doesNotMatch(ui.container.textContent, /::meta/);
  assert.equal(ui.container.querySelectorAll('[data-role=assistant]').length, 1, 'validated stages retain one native answer');
  assert.equal(ui.container.querySelector('[data-testid=voice-pending]'), null);
  if (failure === 1) {
    await ui.until(() => ui.controller.getSnapshot().draft.text.includes('Je mange une salade'));
    assert.equal(ui.controller.getSnapshot().draft.text, 'Je mange une salade\nA later typed draft', 'empty first-stage failure restores only the transcript ahead of later typing');
  } else {
    assert.equal(ui.controller.getSnapshot().draft.text, 'A later typed draft');
    assert.match(ui.container.textContent, /Note de triage fictive/);
  }
  assert.equal(ui.controller.getSnapshot().draft.text.includes('@uploads/'), false);
  assert.equal(ui.container.querySelectorAll('[data-testid=response-error]').length, failure ? 1 : 0);
});
