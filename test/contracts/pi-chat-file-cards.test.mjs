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

async function harness(t, { attachments, mentions, onOpenFile, pasteToFile, locale, component, extra = {} } = {}) {
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
  const native = await NativeHarness.open(new MemoryStorage(), { registry: createRegistry(), models: fake.models }, context);
  const container = document.createElement('div'); document.body.append(container);
  const ui = createRoot(container);
  const conversation = await native.createConversation({ ownership: { kind: 'ownerless' }, agent: { model: fake.model } }, context);
  const controller = createNativeChatController({ identity: { runtimeId: 'fixture', scopeId: 'fixture', principalId: 'person' }, context, conversation });
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
  return { window, controller, container, act, rerender: renderWith };
}

/** A paste as the browser delivers it: the event carries the clipboard text; `prevented` says whether the composer took it. */
function paste(window, element, text) {
  const event = new window.Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', { value: { files: [], types: ['text/plain'], getData: () => text } });
  return { prevented: !element.dispatchEvent(event) };
}

test('a sent upload mention is a card above the bubble, the raw mention is hidden and the message content keeps it', async t => {
  const { controller, container, act } = await harness(t, { mentions: { search: async () => [] }, onOpenFile: () => {} });
  await act(async () => { controller.setText(SENT); });
  await act(async () => { container.querySelector('[data-testid=composer-submit]').click(); });
  const card = container.querySelector('[data-testid=message-file]');
  assert.ok(card, 'the card renders for the mention');
  assert.equal(card.getAttribute('data-path'), 'uploads/report-1a2b3c4d.pdf');
  assert.match(card.textContent, /report\.pdf/, 'the card shows the file name without the upload suffix');
  assert.match(card.textContent, /PDF/, 'the card shows the type line');
  const bubble = container.querySelector('[data-testid=user-text]');
  assert.ok(bubble, 'the text bubble is still there');
  assert.equal(bubble.textContent.includes('@uploads'), false, 'the raw mention is not shown');
  assert.match(bubble.textContent, /Read .*please/);
  assert.ok(card.compareDocumentPosition(bubble) & 4, 'the card comes above the bubble');
  const sent = JSON.stringify(controller.getSnapshot());
  assert.ok(sent.includes('@uploads/report-1a2b3c4d.pdf'), 'the content still carries the mention');
});

test('a card with onOpenFile is a button that opens the path; without it the card is not clickable', async t => {
  const opened = [];
  const { controller, container, act } = await harness(t, { mentions: { search: async () => [] }, onOpenFile: path => opened.push(path) });
  await act(async () => { controller.setText(SENT); });
  await act(async () => { container.querySelector('[data-testid=composer-submit]').click(); });
  const card = container.querySelector('[data-testid=message-file]');
  assert.equal(card.tagName, 'BUTTON');
  await act(async () => card.click());
  assert.deepEqual(opened, ['uploads/report-1a2b3c4d.pdf']);
});

test('without onOpenFile the card is a plain element', async t => {
  const { controller, container, act } = await harness(t, { mentions: { search: async () => [] } });
  await act(async () => { controller.setText(SENT); });
  await act(async () => { container.querySelector('[data-testid=composer-submit]').click(); });
  assert.equal(container.querySelector('[data-testid=message-file]').tagName, 'DIV');
});

test('the type line and the card label are localised (fr: Tableur, ’ typography)', async t => {
  assert.equal(frenchChatLabels.fileKind.sheet, 'Tableur');
  const { controller, container, act } = await harness(t, { mentions: { search: async () => [] }, onOpenFile: () => {}, locale: 'fr' });
  await act(async () => { controller.setText('Voir @uploads/budget-0a1b2c3d.xlsx'); });
  await act(async () => { container.querySelector('[data-testid=composer-submit]').click(); });
  const card = container.querySelector('[data-testid=message-file]');
  assert.match(card.textContent, /Tableur/);
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
  assert.ok(container.querySelector('[data-testid=message-file] img')?.getAttribute('src')?.startsWith('data:image/png;base64,'));
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
  assert.ok(container.querySelector('[data-testid=message-file][data-path="uploads/report-1a2b3c4d.pdf"]'), 'the card renders');
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
  const card = container.querySelector('[data-testid=message-file]');
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
  assert.ok(container.querySelector('[data-testid=message-file] img'), 'the thumbnail shows');
  await rerender({ mentions: { search: async () => [], preview: async () => undefined } });
  await act(async () => flush());
  assert.equal(container.querySelector('[data-testid=message-file] img'), null, 'an unavailable read shows the icon');
  await rerender({ mentions: { search: async () => [], preview: good } });
  await act(async () => flush());
  assert.ok(container.querySelector('[data-testid=message-file] img'));
  await rerender({ mentions: { search: async () => [], preview: async () => { throw new Error('Fictional read failure'); } } });
  await act(async () => flush());
  assert.equal(container.querySelector('[data-testid=message-file] img'), null, 'a failed read shows the icon');
  await rerender({ mentions: { search: async () => [] } });
  await act(async () => flush());
  assert.equal(container.querySelector('[data-testid=message-file] img'), null, 'a removed provider shows the icon');
});
