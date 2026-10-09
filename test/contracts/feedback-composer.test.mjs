import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { composerCases } from '../fixtures/pi-chat-composer-cases.mjs';

// The pi-chat composer's optional Feedback button (FEEDBACK.md, "UX"). Fictional props and messages only.
const root = fileURLToPath(new URL('../../', import.meta.url));
const out = join(root, '.cache/feedback-composer-test');
mkdirSync(out, { recursive: true });
async function load(name, contents) {
  writeFileSync(join(out, `${name}-entry.tsx`), contents);
  await build({ entryPoints: [join(out, `${name}-entry.tsx`)], outfile: join(out, `${name}.mjs`), bundle: true, format: 'esm', platform: 'node', jsx: 'automatic', packages: 'external', logLevel: 'silent' });
  return import(pathToFileURL(join(out, `${name}.mjs`)).href);
}
const { createElement } = await import('react');
const { renderToStaticMarkup } = await import('react-dom/server');
const { Composer } = await load('composer', `export { Composer } from '${root}registry/pi-chat/composer.tsx';`);

test('pending feedback preserves the originating live controller after its presentation leaves', { timeout: 20000 }, async t => {
  const { Window } = await import('happy-dom');
  const window = new Window({ url: 'https://fictional.invalid/' });
  const globals = new Map();
  for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'IS_REACT_ACT_ENVIRONMENT']) {
    globals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: name === 'window' ? window : name === 'IS_REACT_ACT_ENVIRONMENT' ? true : window[name] });
  }
  t.after(async () => { await window.happyDOM.close(); for (const [name, descriptor] of globals) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; } });
  const { Harness: NativeHarness, MemoryStorage, createRegistry } = await import('@earendil-works/pi-durable');
  const { BACKGROUND_CONTEXT: context } = await import('@earendil-works/chord/context');
  const { createNativeChatController } = await import('@hachej/boring-ui-kit/native-chat');
  const { createFakeChatModel } = await import('@hachej/boring-testing/model');
  const { act } = await import('react');
  const { createRoot } = await import('react-dom/client');
  const { Surface } = await load('feedback-retarget', `
    import { createElement } from 'react';
    import { Composer } from '${root}registry/pi-chat/composer.tsx';
    import { useChatSession } from '${root}registry/pi-chat/session.tsx';
    export function Surface({ controller, activeController, feedback }) {
      const session = useChatSession({ controller, activeController, mode: 'expert', fileAccept: 'image/*', feedback });
      return createElement(Composer, session.composer);
    }`);
  for (const leave of ['retarget', 'unmount', 'dispose']) for (const result of ['ok', 'refused', 'throw']) {
    await t.test(`${leave}, attachment ${result}`, async () => {
      const fake = createFakeChatModel();
      const native = await NativeHarness.open(new MemoryStorage(), { registry: createRegistry(), models: fake.models }, context);
      const controllers = [], conversations = [];
      const container = document.createElement('div'); document.body.append(container);
      const ui = createRoot(container);
      try {
        for (let i = 0; i < 2; i++) {
          const conversation = await native.createConversation({ ownership: { kind: 'ownerless' }, agent: { model: fake.model } }, context);
          conversations.push(conversation);
          const controller = createNativeChatController({ identity: { runtimeId: 'fixture', scopeId: 'fixture', principalId: 'person' }, context, conversation });
          controllers.push(controller); await controller.connect();
        }
        const [origin, replacement] = controllers;
        const image = id => ({ id, name: `${id}.png`, content: { type: 'image', data: 'AA==', mimeType: 'image/png' } });
        const first = image('first'), second = image('second');
        origin.setText('Original text'); origin.setAttachments([first]); replacement.setText('Other conversation');
        let resolve, reject;
        const pending = new Promise((yes, no) => { resolve = yes; reject = no; });
        let sent = 0;
        const feedback = { start: () => {}, pending: true, attach: () => pending, sent: () => sent++ };
        const activeController = { current: origin };
        await act(async () => ui.render(createElement(Surface, { controller: origin, activeController, feedback })));
        await act(async () => container.querySelector('[data-testid=composer-submit]').click());
        assert.equal(origin.getSnapshot().draft.text, '');
        await act(async () => { origin.setText('Newer text'); origin.setAttachments([first, second]); });
        await act(async () => {
          if (leave === 'retarget') activeController.current = replacement;
          ui.render(leave === 'retarget' ? createElement(Surface, { key: 'replacement', controller: replacement, activeController }) : null);
        });
        if (leave === 'dispose') await origin.dispose();
        const beforeSettlement = origin.getSnapshot();
        await act(async () => {
          if (result === 'throw') reject(new Error('Fictional attachment failure'));
          else resolve(result === 'ok' ? { kind: 'ok', text: 'Original text\n@feedback/fictional' } : { kind: 'refused', reason: 'Fictional refusal' });
          await pending.catch(() => {});
        });
        if (leave === 'dispose') assert.equal(origin.getSnapshot(), beforeSettlement, 'a disposed controller is never mutated');
        else assert.equal(origin.getSnapshot().draft.text, 'Original text\nNewer text');
        assert.deepEqual(origin.getSnapshot().draft.attachments, [first, second]);
        assert.equal(replacement.getSnapshot().draft.text, 'Other conversation');
        assert.equal(sent, 0);
        for (const conversation of conversations) {
          const entries = (await conversation.context(context)).entries;
          assert.equal(entries.flatMap(entry => entry.model ?? []).filter(message => message.role === 'user').length, 0);
        }
        assert.equal(fake.calls.length, 0);
      } finally {
        await act(async () => ui.unmount()); container.remove();
        for (const controller of controllers) await controller.dispose();
        await native.close(context);
      }
    });
  }
});

test('without the feedback prop the composer renders byte-identical markup to the composer of main', () => {
  const golden = JSON.parse(readFileSync(join(root, 'test/fixtures/pi-chat-composer-baseline.json'), 'utf8'));
  const cases = composerCases();
  assert.deepEqual(Object.keys(cases), Object.keys(golden));
  for (const [name, props] of Object.entries(cases)) {
    assert.equal(renderToStaticMarkup(createElement(Composer, props)), golden[name], name);
    assert.equal(renderToStaticMarkup(createElement(Composer, { ...props, feedback: undefined })), golden[name], `${name}, feedback: undefined`);
  }
});

test('with the feedback prop: one Feedback button beside the + menu in both layouts, pressed while active, and the chip; a pending draft allows Send with no text', () => {
  const cases = composerCases();
  for (const name of ['stacked-empty', 'inline-empty']) {
    const html = renderToStaticMarkup(createElement(Composer, { ...cases[name], feedback: { start: () => {} } }));
    const button = /<button type="button" data-testid="composer-feedback"[^>]*>/.exec(html)?.[0];
    assert.ok(button, name);
    assert.match(button, /aria-pressed="false"/);
    assert.ok(html.indexOf('data-attach="true"') < html.indexOf('data-testid="composer-feedback"'), 'after the file input and the + menu');
    assert.equal((html.match(/composer-feedback/g) ?? []).length, 1);
    assert.match(html, /data-testid="composer-submit"[^>]*disabled=""/, 'nothing to send yet');
  }
  const active = renderToStaticMarkup(createElement(Composer, { ...cases['stacked-empty'], feedback: { start: () => {}, active: true } }));
  assert.match(active, /data-testid="composer-feedback" aria-pressed="true" disabled=""/);
  const pending = renderToStaticMarkup(createElement(Composer, { ...cases['stacked-empty'], feedback: { start: () => {}, pending: true, chip: createElement('span', { 'data-testid': 'fictional-chip' }, 'Feedback · 2 notes') } }));
  assert.match(pending, /data-testid="fictional-chip"/);
  assert.doesNotMatch(pending, /data-testid="composer-submit"[^>]*disabled=""/, 'the pending feedback is something to send');
});

test('Send with pending feedback: the host attaches it to the text, the native send reads the draft, sent() follows; a refusal sends nothing', async t => {
  const { Window } = await import('happy-dom');
  const window = new Window({ url: 'https://fictional.invalid/' });
  const globals = new Map();
  for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'IS_REACT_ACT_ENVIRONMENT']) {
    globals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: name === 'window' ? window : name === 'IS_REACT_ACT_ENVIRONMENT' ? true : window[name] });
  }
  t.after(async () => { await window.happyDOM.close(); for (const [name, descriptor] of globals) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; } });
  const { Harness } = await load('session-harness', `
    import { createElement } from 'react';
    import { Composer } from '${root}registry/pi-chat/composer.tsx';
    import { useChatSession } from '${root}registry/pi-chat/session.tsx';
    export function Harness({ controller, feedback }) {
      const session = useChatSession({ controller, activeController: { current: controller }, mode: 'expert', fileAccept: 'image/*', feedback });
      return createElement('div', null, createElement(Composer, session.composer), session.error ? createElement('p', { 'data-testid': 'error' }, session.error) : null);
    }`);
  const { act } = await import('react');
  const { createRoot } = await import('react-dom/client');
  // A fictional native chat controller: the draft, connect and send, nothing else.
  const controller = () => {
    let snapshot = { identity: { runtimeId: 'fixture' }, conversationId: 'c1', connection: { kind: 'connected' }, draft: { text: '', attachments: [], version: 0 }, history: { kind: 'disabled' }, send: { kind: 'idle' }, stop: 'idle', disposed: false };
    const listeners = new Set();
    const publish = change => { snapshot = { ...snapshot, ...change }; for (const listener of listeners) listener(); };
    const sent = [];
    return { sent, subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); }, getSnapshot: () => snapshot, connect: async () => {},
      setText: text => publish({ draft: { ...snapshot.draft, text, version: snapshot.draft.version + 1 } }), setAttachments: attachments => publish({ draft: { ...snapshot.draft, attachments } }),
      // Like the native controller: explicit content leaves the composer alone, otherwise the draft is taken and the composer emptied.
      send: async (_whenBusy, input) => {
        sent.push(input ? input.text : snapshot.draft.text);
        if (!input) publish({ draft: { text: '', attachments: [], version: snapshot.draft.version + 1 } });
        return { id: `s${sent.length}` };
      }, stop: async () => {} };
  };
  const container = document.createElement('div'); document.body.append(container);
  const ui = createRoot(container);
  const chat = controller();
  const calls = [];
  const feedback = { start: () => {}, pending: true, sent: () => calls.push('sent'),
    attach: async text => { calls.push(`attach ${JSON.stringify(text)}`); return { kind: 'ok', text: `${text}\n\n@feedback/fb_7Q2mK9xRt4vW1cZp.md`.trim() }; } };
  await act(async () => ui.render(createElement(Harness, { controller: chat, feedback })));
  await act(async () => chat.setText('What do you think?'));
  await act(async () => { container.querySelector('[data-testid=composer-submit]').click(); await new Promise(resolve => setTimeout(resolve, 10)); });
  assert.deepEqual(chat.sent, ['What do you think?\n\n@feedback/fb_7Q2mK9xRt4vW1cZp.md'], 'the model input carries the mention the host resolves');
  assert.deepEqual(calls, ['attach "What do you think?"', 'sent']);
  assert.equal(chat.getSnapshot().draft.text, '', 'the composer is empty once the message is sent');

  const refusing = controller();
  const refusal = { start: () => {}, pending: true, sent: () => calls.push('never'), attach: async () => ({ kind: 'refused', reason: 'Not saved: the fictional store is unavailable.' }) };
  await act(async () => ui.render(createElement(Harness, { key: 'refusing', controller: refusing, feedback: refusal })));
  await act(async () => refusing.setText('Keep this text'));
  await act(async () => { container.querySelector('[data-testid=composer-submit]').click(); await new Promise(resolve => setTimeout(resolve, 10)); });
  assert.deepEqual(refusing.sent, [], 'nothing is sent');
  assert.equal(refusing.getSnapshot().draft.text, 'Keep this text', 'the refused text is back in the composer');
  assert.equal(container.querySelector('[data-testid=error]').textContent, 'Not saved: the fictional store is unavailable.');
  assert.ok(!calls.includes('never'));

  // Without pending feedback the send is the ordinary one.
  const plain = controller();
  await act(async () => ui.render(createElement(Harness, { key: 'plain', controller: plain, feedback: { start: () => {} } })));
  await act(async () => plain.setText('Just text.'));
  await act(async () => { container.querySelector('[data-testid=composer-submit]').click(); await new Promise(resolve => setTimeout(resolve, 10)); });
  assert.deepEqual(plain.sent, ['Just text.']);
  await act(async () => ui.unmount());
});
