import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync } from 'node:fs';
import { build } from 'esbuild';
import { Window } from 'happy-dom';
import { Harness, MemoryStorage, createRegistry } from '@earendil-works/pi-durable';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { createFakeChatModel } from '@hachej/boring-testing/model';
import { createNativeChatController } from '@hachej/boring-ui-kit/native-chat';
import { createResourceHandler } from '@hachej/boring-files/remote';
import { openSqliteWorkspaces } from '../../shared/sqlite-workspaces.mjs';

test('AgentWorkspace opens conversation files and preserves host opener precedence', async t => {
  const window = new Window({ url: 'https://fictional.invalid/' });
  const names = ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Text', 'DOMParser', 'MutationObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'ResizeObserver', 'sessionStorage', 'matchMedia', 'IS_REACT_ACT_ENVIRONMENT'];
  const globals = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  for (const name of names) {
    const value = name === 'window' ? window : name === 'IS_REACT_ACT_ENVIRONMENT' ? true : window[name];
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: typeof value === 'function' && /^[a-z]/.test(name) ? value.bind(window) : value });
  }
  const { createElement, act } = await import('react'); const { createRoot } = await import('react-dom/client');
  const out = new URL('../../.cache/workspace-file-opener/', import.meta.url); mkdirSync(out, { recursive: true });
  const output = new URL('workspace.mjs', out);
  await build({ entryPoints: [new URL('../../registry/pi-app/agent-workspace.tsx', import.meta.url).pathname], outfile: output.pathname, bundle: true, format: 'esm', platform: 'node', jsx: 'automatic', packages: 'external', loader: { '.css': 'empty' }, plugins: [{ name: 'file-tree-css', setup(builder) { builder.onResolve({ filter: /^@hachej\/boring-ui-kit\/file-tree\.css$/ }, () => ({ path: new URL(import.meta.resolve('@hachej/boring-ui-kit/file-tree.css')).pathname, external: false })); } }] });
  const { AgentWorkspace } = await import(output.href);
  const fake = createFakeChatModel();
  const harness = await Harness.open(new MemoryStorage(), { registry: createRegistry(), models: fake.models }, context);
  const conversation = await harness.createConversation({ ownership: { kind: 'ownerless' }, agent: { model: fake.model } }, context);
  await conversation.submit({ type: 'write', entry: { kind: 'fictional.note', model: [{ role: 'user', content: '@uploads/fictional-notes.md', timestamp: 0 }] } }, context);
  const controller = createNativeChatController({ identity: { runtimeId: 'fictional', scopeId: 'fictional', principalId: 'alice' }, conversation, context });
  await controller.connect();
  const element = document.createElement('div'); document.body.append(element); const root = createRoot(element);
  t.after(async () => {
    await act(async () => root.unmount()); await controller.dispose(); await harness.close(context); await window.happyDOM.close();
    for (const [name, descriptor] of globals) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; }
  });
  for (const explicit of [false, true]) await t.test(explicit ? 'explicit onOpenFile wins' : 'host mentions.open remains the fallback', async () => {
    const opened = [], selections = [];
    const mentions = { search: async () => [], open: path => opened.push(['mention', path]) };
    await act(async () => root.render(createElement(AgentWorkspace, { key: String(explicit), controller, conversationId: String(conversation.id), layout: 'embedded', storageKey: false,
      resources: { identity: { scopeId: 'fictional', principalId: 'alice', initiatorId: 'alice' }, endpoint: 'https://fictional.invalid/resources', fetch: async () => new Response(null, { status: 404 }) },
      onOpenedChange: value => selections.push(value), chat: { mentions, ...(explicit ? { onOpenFile: path => opened.push(['explicit', path]) } : {}) } })));
    const mention = element.querySelector('[data-testid=message-mention]'); assert.ok(mention);
    await act(async () => mention.click());
    assert.deepEqual(opened, [[explicit ? 'explicit' : 'mention', 'uploads/fictional-notes.md']]);
    assert.deepEqual(selections, [], 'the workspace must not bypass the host opener');
  });
  const image = { type: 'image', mimeType: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a/OQAAAAASUVORK5CYII=' };
  for (const draft of [true, false]) await t.test(`workspace previews a ${draft ? 'draft' : 'sent'} image by default`, async () => {
    await act(async () => controller.setAttachments(draft ? [{ id: 'fictional-image', name: 'fictional.png', content: image }] : []));
    if (!draft) await act(async () => conversation.submit({ type: 'write', entry: { kind: 'fictional.note', model: [{ role: 'user', content: [image], timestamp: 1 }] } }, context));
    const props = { key: `preview-${draft}`, controller, conversationId: String(conversation.id), layout: 'embedded', storageKey: false,
      resources: { identity: { scopeId: 'fictional', principalId: 'alice', initiatorId: 'alice' }, endpoint: 'https://fictional.invalid/resources', fetch: async () => new Response(null, { status: 404 }) } };
    await act(async () => root.render(createElement(AgentWorkspace, props)));
    await act(async () => element.querySelector('[data-testid=conversation-files]').click());
    const row = document.querySelector(`[data-file^="${draft ? 'draft:' : 'image:'}"]`);
    assert.ok(row); assert.equal(row.hasAttribute('disabled') || row.getAttribute('aria-disabled') === 'true', false, `${row.dataset.file} must open`);
    await act(async () => row.click());
    const preview = document.querySelector('[data-testid=conversation-image-image]');
    assert.ok(preview, 'the workspace supplies an image viewer, not only an enabled row');
    assert.equal(preview.getAttribute('src'), `data:image/png;base64,${image.data}`);
    await act(async () => root.render(createElement(AgentWorkspace, { ...props, conversationId: 'another-fictional-conversation' })));
    assert.equal(Boolean(document.querySelector('[data-testid=conversation-image-image]')), false, 'a preview never follows a conversation switch');
  });
  await t.test('resources, uploads and chat attachments open uploaded Markdown, JSON and inline images through the file viewer', async () => {
    const identity = { scopeId: 'fictional', principalId: 'alice', initiatorId: 'alice' };
    const store = openSqliteWorkspaces({ filename: ':memory:', providerId: 'workspace', authorize: () => true });
    const handler = createResourceHandler({ authenticate: async () => identity, reader: store, publisher: store.publication, lookup: store.reconciliation });
    const files = [new File(['# Fictional picnic notes\n'], 'fictional.md', { type: 'text/markdown' }), new File(['{"fictional":"picnic"}\n'], 'fictional.json', { type: 'application/json' }), new File([Buffer.from(image.data, 'base64')], 'fictional.png', { type: 'image/png' })];
    const paths = files.map(file => `uploads/${file.name}`);
    const attachments = { upload: async picked => {
      const results = [];
      for (const file of picked) {
        const path = `uploads/${file.name}`;
        const result = await store.publication.publish({ operationId: path, atomicity: 'all-or-nothing', changes: [{ kind: 'create', target: { resource: { providerId: 'workspace', path }, view: { kind: 'published' } }, expected: { kind: 'absent' }, bytes: new Uint8Array(await file.arrayBuffer()), mediaType: file.type }] }, identity);
        assert.equal(result.kind, 'committed');
        results.push({ name: file.name, path, ...(file.type === 'image/png' ? { image } : {}) });
      }
      return results;
    } };
    await act(async () => { controller.setText(''); controller.setAttachments([]); root.render(createElement(AgentWorkspace, { key: 'resources-uploads', controller, conversationId: String(conversation.id), layout: 'embedded', storageKey: false,
      resources: { identity, endpoint: 'https://fictional.invalid/resources', fetch: handler }, uploads: { inlineImages: true }, chat: { attachments } })); });
    const input = element.querySelector('[data-testid=composer-file]');
    await act(async () => { Object.defineProperty(input, 'files', { configurable: true, value: files }); input.dispatchEvent(new window.Event('change', { bubbles: true })); });
    for (let n = 0; n < 100 && !controller.getSnapshot().draft.attachments.length; n++) await act(async () => new Promise(resolve => setTimeout(resolve, 10)));
    try {
      for (const sent of [false, true]) {
        if (sent) await act(async () => element.querySelector('[data-testid=composer-submit]').click());
        for (const path of paths) {
          await act(async () => element.querySelector('[data-testid=conversation-files]').click());
          const row = document.querySelector(`[data-file="file:${path}"]`);
          assert.ok(row, `${sent ? 'sent' : 'draft'}: ${path} is a workspace file`); assert.equal(row.hasAttribute('disabled') || row.getAttribute('aria-disabled') === 'true', false);
          await act(async () => row.click());
          for (let n = 0; n < 100 && !element.querySelector('[data-testid=viewer-image], [data-testid=file-viewer] .tiptap, [data-testid=file-viewer] pre'); n++) await act(async () => new Promise(resolve => setTimeout(resolve, 10)));
          assert.equal(element.querySelector('[data-testid=file-viewer]').dataset.path, path);
          if (path.endsWith('.png')) assert.ok(element.querySelector('[data-testid=viewer-image]'));
          else assert.match(element.querySelector('[data-testid=file-viewer]').textContent, /picnic/);
          await act(async () => element.querySelector('[data-testid=viewer-close]').click());
        }
      }
    } finally { await act(async () => root.render(null)); store.close(); }
  });
  await t.test('a host image opener takes precedence over the workspace preview', async () => {
    const opened = [];
    await act(async () => root.render(createElement(AgentWorkspace, { key: 'host-image', controller, conversationId: String(conversation.id), storageKey: false,
      resources: { identity: { scopeId: 'fictional', principalId: 'alice', initiatorId: 'alice' }, endpoint: 'https://fictional.invalid/resources', fetch: async () => new Response(null, { status: 404 }) }, chat: { onOpenImage: value => opened.push(value) } })));
    await act(async () => element.querySelector('[data-testid=conversation-files]').click());
    await act(async () => document.querySelector('[data-file^="image:"]').click());
    assert.deepEqual(opened, [image]);
    assert.equal(Boolean(document.querySelector('[data-testid=conversation-image-image]')), false);
  });
});
