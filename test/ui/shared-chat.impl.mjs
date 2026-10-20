import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';
import { Window } from 'happy-dom';
import { createSharedChat, createFakeChannelSource } from '@hachej/boring-ui-kit/shared-chat';
import { sharedChatSeed } from '../../examples/shared-chat/seed.mjs';
import { createPdfDemo } from '../../examples/shared-chat/pdf-flow.mjs';

test('PiChat renders and operates the host shared conversation', { timeout: 60000 }, async t => {
  const window = new Window({ url: 'https://fictional.invalid/' });
  const names = ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Text', 'DOMParser', 'MutationObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'ResizeObserver', 'sessionStorage', 'localStorage', 'matchMedia', 'IS_REACT_ACT_ENVIRONMENT'];
  const globals = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  for (const name of names) {
    const value = name === 'window' ? window : name === 'IS_REACT_ACT_ENVIRONMENT' ? true : window[name];
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: typeof value === 'function' && /^[a-z]/.test(name) ? value.bind(window) : value });
  }
  const { createElement, act } = await import('react'); const { createRoot } = await import('react-dom/client');
  mkdirSync(new URL('../../.cache/shared-chat-test/', import.meta.url), { recursive: true });
  const output = new URL('../../.cache/shared-chat-test/chat.mjs', import.meta.url);
  await build({ entryPoints: [new URL('../../registry/shared-chat/shared-chat.tsx', import.meta.url).pathname], outfile: output.pathname, bundle: true, format: 'esm', platform: 'node', jsx: 'automatic', packages: 'external', tsconfig: new URL('../../tsconfig.json', import.meta.url).pathname,
    plugins: process.env.SHARED_CHAT_OLD_RENDERER ? [{ name: 'pre-shared-renderer', setup(builder) {
      builder.onLoad({ filter: /registry\/(?:pi-chat|shared-chat)\/.*\.(ts|tsx)$/ }, ({ path }) => {
        const relative = path.slice(new URL('../../', import.meta.url).pathname.length);
        return { contents: execFileSync('git', ['show', `${process.env.SHARED_CHAT_BASE ?? '97bea0756'}:${relative}`], { encoding: 'utf8' }), loader: path.endsWith('.tsx') ? 'tsx' : 'ts' };
      });
    } }] : [] });
  const { SharedChat: PiChat } = await import(output.href);
  const source = createFakeChannelSource(sharedChatSeed);
  let controller = createSharedChat(source, { conversationId: 'main' });
  const controllers = [controller];
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  const q = selector => document.querySelector(selector);
  const settle = async ready => { for (let n = 0; n < 200 && !ready(); n++) await act(async () => new Promise(resolve => setTimeout(resolve, 10))); assert.ok(ready(), 'expected UI appeared'); };
  const draw = () => root.render(createElement(PiChat, { controller, mentions: { search: async () => [] }, conversations: { items: sharedChatSeed.conversations, activeId: controller.getSnapshot().conversationId, onSelect(id) { controller = createSharedChat(source, { conversationId: id }); controllers.push(controller); draw(); } } }));
  const render = () => act(async () => draw());
  t.after(async () => { await act(async () => { root.unmount(); for (const controller of controllers) await controller.dispose(); }); await window.happyDOM.close(); for (const [name, descriptor] of globals) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; } });
  await render();
  await settle(() => q('[data-shared-message="one"]'));

  await t.test('the fictional host exposes PM and Data, never Builder, including its mention catalog', async () => {
    assert.deepEqual((await source.members('main')).filter(member => member.kind === 'agent').map(member => member.id), ['pm', 'data']);
    assert.doesNotMatch(q('[data-testid=transcript]').textContent, /Builder/);
    const demo = createPdfDemo({ manual: true });
    const messages = []; const unsubscribe = demo.subscribe('main', event => { if (event.type === 'message') messages.push(event.message); });
    try {
      await demo.send({ conversationId: 'main', text: '@pm export PDF', mentions: ['pm'], clientId: 'room-test' });
      demo.build(); demo.finish();
      assert.deepEqual((await demo.members('main')).filter(member => member.kind === 'agent').map(member => member.id), ['pm', 'data']);
      assert.equal(messages.filter(message => message.author !== 'mira').every(message => message.author === 'pm'), true);
      assert.ok(messages.some(message => message.author === 'pm' && message.steps?.length === 3));
      assert.doesNotMatch(messages.map(message => message.text).join(' '), /Builder/);
    } finally { unsubscribe(); }
  });
  await t.test('author grouping, avatars, agent bubbles; own bubble stays unchanged', async () => {
    assert.equal(q('[data-shared-message="one"] [data-testid=message-author]')?.textContent, 'Leo');
    assert.equal(Boolean(q('[data-shared-message="one"] [data-testid=member-avatar]')), false);
    assert.equal(q('[data-shared-message="two"] [data-testid=member-avatar]')?.dataset.size, 'sm');
    for (const id of ['one', 'two']) {
      const bubble = q(`[data-shared-message="${id}"] [data-slot=bubble]`);
      assert.equal(bubble?.dataset.variant, 'muted'); assert.equal(bubble?.dataset.align, 'start');
      assert.equal(q(`[data-shared-message="${id}"] [data-slot=message]`)?.dataset.align, 'start');
    }
    assert.ok(q('[data-shared-message="one"] [data-testid=message-author]')?.classList.contains('text-sm'));
    assert.ok(q('[data-shared-message="one"] [data-testid=message-author]')?.classList.contains('text-muted-foreground'));
    assert.equal(q('[data-shared-message="two"] [data-testid=message-author]'), null);
    assert.equal(q('[data-shared-message="four"] [data-testid=author-badge]')?.textContent, 'Admin');
    assert.equal(q('[data-shared-message="five"] [data-testid=author-badge]'), null);
    assert.ok(q('[data-shared-message="three"] [data-testid=user-text]'));
    assert.equal(q('[data-shared-message="three"] [data-slot=bubble]')?.dataset.align, 'end');
    assert.equal(q('[data-shared-message="five"] [data-slot=bubble]')?.dataset.variant, 'muted');
    assert.equal(q('[data-shared-message="three"] [data-testid=message-author]'), null);
  });
  await t.test('people and agents place their avatar beside the last item, including a final request card', async () => {
    for (const id of ['two', 'seven']) {
      const row = q(`[data-shared-message="${id}"]`);
      assert.ok(row.querySelector('[data-testid=message-avatar] [data-testid=member-avatar]'));
      assert.equal(Boolean(row.querySelector('[data-testid=message-author-row] [data-testid=member-avatar]')), false);
    }
    assert.ok(q('[data-shared-message=seven] [data-testid=member-avatar] svg[data-lucide=bot]'));
    assert.equal(Boolean(q('[data-shared-message=five] [data-testid=message-avatar] [data-testid=member-avatar]')), false);
    assert.equal(q('[data-shared-message=three] [data-testid=member-avatar]'), null);
    for (const id of ['one', 'two', 'five', 'six']) assert.ok(q(`[data-shared-message="${id}"] [data-testid=shared-message-content]`));
    assert.equal(q('[data-shared-message=two] [data-testid=message-author-row]'), null);
    assert.equal(q('[data-shared-message=three] [data-testid=message-author-row]'), null);
    assert.equal(q('[data-shared-message=three] [data-testid=shared-message-content]')?.classList.contains('ml-8'), false);
    assert.equal(q('[data-shared-message=three] [data-slot=bubble]')?.dataset.align, 'end');
    assert.ok(q('[data-testid=transcript]').classList.contains('gap-0'));
    assert.ok(q('[data-shared-message=two]').closest('[data-slot=message-scroller-item]').classList.contains('mt-2'));
    assert.ok(q('[data-shared-message=three]').closest('[data-slot=message-scroller-item]').classList.contains('mt-6'));
  });
  await t.test('agent chart tokens match across name, avatar, mention and independent viewers; people have none', async () => {
    await act(async () => {
      source.emit({ type: 'members', conversationId: 'main', members: [...controller.getSnapshot().shared.members.filter(member => member.id !== 'data'), { id: 'data', name: 'Data', kind: 'agent' }] });
      for (const [id, author, text] of [['colour-pm', 'pm', '@data ready'], ['colour-data', 'data', '@pm ready'], ['colour-person', 'leo', '@leo ready']]) source.emit({ type: 'message', message: { id, author, text, conversationId: 'main', at: '2026-10-20T15:00:00Z' } });
    });
    const pm = q('[data-shared-message=colour-pm] [data-testid=message-author]')?.dataset.agentColor;
    const data = q('[data-shared-message=colour-data] [data-testid=message-author]')?.dataset.agentColor;
    assert.match(pm ?? '', /^chart-[1-5]$/); assert.match(data ?? '', /^chart-[1-5]$/); assert.notEqual(pm, data);
    for (const [id, token, target] of [['colour-pm', pm, data], ['colour-data', data, pm]]) {
      const row = q(`[data-shared-message="${id}"]`);
      assert.equal(row.querySelector('[data-testid=message-avatar] [data-testid=member-avatar]').dataset.agentColor, token);
      assert.equal(row.querySelector('[data-testid=message-mention]').dataset.agentColor, target);
      assert.equal(row.querySelector('[data-testid=message-mention] [data-testid=member-avatar]').dataset.agentColor, target);
      assert.ok(row.querySelector('[data-testid=message-mention]').classList.contains('items-baseline'));
    }
    for (const selector of ['[data-testid=message-author]', '[data-testid=message-avatar] [data-testid=member-avatar]', '[data-testid=message-mention]']) assert.equal(q(`[data-shared-message=colour-person] ${selector}`).getAttribute('data-agent-color'), null);
    const viewer = document.createElement('div'); document.body.append(viewer); const other = createRoot(viewer);
    const independent = createSharedChat(source, { conversationId: 'main' });
    try {
      await act(async () => other.render(createElement(PiChat, { controller: independent })));
      await settle(() => viewer.querySelector('[data-shared-message=colour-data] [data-testid=message-author]'));
      assert.equal(viewer.querySelector('[data-shared-message=colour-pm] [data-testid=message-author]').dataset.agentColor, pm);
      assert.equal(viewer.querySelector('[data-shared-message=colour-data] [data-testid=message-author]').dataset.agentColor, data);
    } finally { await act(async () => other.unmount()); await independent.dispose(); viewer.remove(); }
  });
  await t.test('request action and replacement through the timeline', async () => {
    await act(async () => q('[data-shared-message="six"] [data-testid=request-card] button').click());
    assert.deepEqual(source.actions, [{ conversationId: 'main', requestId: 'review-plan', actionId: 'review' }]);
    await act(async () => source.emit({ type: 'message', message: { ...sharedChatSeed.messages.find(message => message.id === 'six'), card: { requestId: 'review-plan', title: 'Review complete', line: 'Accepted by the host.' } } }));
    assert.match(q('[data-shared-message="six"]').textContent, /Review complete/);
    assert.equal(document.querySelectorAll('[data-shared-message="six"]').length, 1);
  });
  await t.test('delta keeps the existing assistant streaming row identity', async () => {
    await act(async () => source.emit({ type: 'message', message: { id: 'stream', conversationId: 'main', author: 'pm', at: new Date().toISOString(), text: 'Checking', streaming: true } }));
    const row = q('[data-shared-message="stream"] [data-role=assistant]');
    assert.equal(row?.dataset.streaming, 'true');
    await act(async () => source.emit({ type: 'delta', messageId: 'stream', conversationId: 'main', text: ' the plan.' }));
    assert.equal(q('[data-shared-message="stream"] [data-role=assistant]'), row);
    assert.match(row.textContent, /Checking the plan\./);
  });
  await t.test('member presence and live connection status', async () => {
    assert.equal(q('[data-testid=shared-status]'), null, 'live has no status dot');
    assert.equal(q('[data-testid=shared-connection-announcement]')?.getAttribute('aria-live'), 'polite');
    await act(async () => q('[data-testid=shared-members]').click());
    await settle(() => q('[data-testid=member-list]'));
    assert.match(q('[data-testid=member-list]').textContent, /Julien \(admin\)/);
    assert.equal(q('[data-member-id=leo] [data-testid=presence]')?.dataset.presence, 'here');
    await act(async () => source.emit({ type: 'presence', members: [{ id: 'leo', presence: 'away' }] }));
    assert.equal(q('[data-member-id=leo] [data-testid=presence]')?.dataset.presence, 'away');
    await act(async () => source.setStatus('reconnecting'));
    assert.equal(q('[data-testid=shared-status]')?.dataset.status, 'reconnecting');
    assert.ok(q('[data-testid=shared-status] svg')?.classList.contains('text-muted-foreground'));
    await act(async () => source.setStatus('offline'));
    assert.equal(q('[data-testid=shared-status]')?.dataset.status, 'offline');
    assert.ok(q('[data-testid=shared-status] svg')?.classList.contains('text-destructive'));
    await act(async () => { source.setStatus('live'); q('[data-testid=shared-members]').click(); });
    assert.equal(q('[data-testid=shared-status]'), null);
  });
  await t.test('existing composer mention picker sends member ids', async () => {
    const textarea = q('textarea');
    await act(async () => {
      textarea.focus();
      Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(textarea, '@Le');
      textarea.setSelectionRange(3, 3);
      textarea.dispatchEvent(new window.Event('input', { bubbles: true }));
    });
    await settle(() => q('[data-testid=mention-item]'));
    assert.match(q('[data-testid=mention-item]').textContent, /Leo/);
    await act(async () => textarea.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })));
    assert.match(controller.getSnapshot().draft.text, /@leo/);
    await act(async () => q('[data-testid=composer-submit]').click());
    await settle(() => source.sends.length > 0);
    assert.deepEqual(source.sends.at(-1).mentions, ['leo']);
  });
  await t.test('sent mentions are inline in own, colleague and agent messages', async () => {
    await act(async () => {
      for (const [id, author] of [['mention-own', 'mira'], ['mention-other', 'leo'], ['mention-agent', 'pm']]) source.emit({ type: 'message', message: { id, author, conversationId: 'main', at: new Date().toISOString(), text: '@leo hi?' } });
    });
    for (const id of ['mention-own', 'mention-other', 'mention-agent']) {
      const mention = q(`[data-shared-message="${id}"] [data-testid=message-mention]`);
      assert.equal(mention?.querySelector('[data-testid=mention-name]')?.textContent, 'Leo');
      assert.ok(mention.querySelector('[data-testid=member-avatar]'));
      assert.ok(mention.classList.contains('font-medium'));
      assert.equal(mention.textContent.includes('@'), false);
      assert.equal(mention.getAttribute('data-slot'), null, 'not a Badge or padded Button');
    }
  });
  await t.test('outbox retries exact clientId after reconnect and deduplicates the echo', async () => {
    await act(async () => { source.setStatus('offline'); controller.setText('Retained request'); });
    let sending;
    await act(async () => { sending = controller.send(); await Promise.resolve(); });
    const first = source.sends.at(-1);
    assert.equal(first.text, 'Retained request');
    // An event the page misses is recovered from history after the reconnect.
    source.emit({ type: 'message', message: { id: 'gap', conversationId: 'main', author: 'leo', at: new Date().toISOString(), text: 'Written while disconnected.' } });
    await act(async () => { source.setStatus('live'); await sending; });
    assert.equal(source.sends.at(-1).clientId, first.clientId);
    assert.equal(controller.getSnapshot().shared.messages.filter(message => message.clientId === first.clientId).length, 1);
    assert.match(q('[data-shared-message=gap]').textContent, /Written while disconnected/);
  });
  await t.test('agents lead the existing mention picker', async () => {
    const textarea = q('textarea');
    await act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(textarea, '@');
      textarea.setSelectionRange(1, 1); textarea.dispatchEvent(new window.Event('input', { bubbles: true }));
    });
    await settle(() => document.querySelectorAll('[data-testid=mention-item]').length === 5);
    assert.deepEqual([...document.querySelectorAll('[data-testid=mention-item]')].slice(0, 2).map(item => item.dataset.path), ['pm', 'data']);
    assert.equal(document.querySelector('[data-testid=mention-item][data-path=worker]'), null);
    assert.doesNotMatch([...document.querySelectorAll('[data-testid=mention-item]')].map(item => item.textContent).join(' '), /Builder/);
    await act(async () => textarea.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
  });
  await t.test('one working-agent spinner moves from the collapsed summary to the expanded running step', async () => {
    // Another host may explicitly expose a second agent; the kit does not prescribe PM-only policy.
    await act(async () => source.emit({ type: 'members', conversationId: 'main', members: [...controller.getSnapshot().shared.members, { id: 'worker', name: 'Second agent', kind: 'agent' }] }));
    const work = { id: 'one-spinner', conversationId: 'main', author: 'worker', at: '2026-10-20T11:59:00Z', text: 'Je prépare le PDF.', streaming: true, steps: [{ label: 'Lire', status: 'done' }, { label: 'Mise en page', status: 'running' }, { label: 'Vérifier', status: 'failed' }] };
    await act(async () => source.emit({ type: 'message', message: work }));
    const row = () => q('[data-shared-message=one-spinner]');
    assert.equal(row().querySelector('[data-testid=activity]').dataset.open, 'false');
    assert.equal(row().querySelectorAll('[data-slot=spinner]').length, 1);
    assert.match(row().querySelector('[data-testid=activity-label]').textContent, /Mise en page.*2\/3/);
    await act(async () => row().querySelector('[data-testid=activity] button').click());
    assert.equal(row().querySelectorAll('[data-slot=spinner]').length, 1);
    assert.ok(row().querySelector('[data-testid=activity-step][data-status=running] [data-slot=spinner]'));
    assert.equal(row().querySelector('[data-testid=activity] button [data-slot=spinner]'), null);
    assert.equal(q('[data-testid=request-card] [data-slot=spinner]'), null);
    await act(async () => source.emit({ type: 'step', conversationId: 'main', messageId: work.id, index: 4, step: { label: 'Nouvelle vérification', status: 'running' } }));
    assert.equal(row().querySelectorAll('[data-slot=spinner]').length, 1, 'sparse or overlapping step events still have one active icon');
    const newer = { ...work, id: 'newer-spinner', at: '2026-10-20T11:59:01Z' };
    await act(async () => source.emit({ type: 'message', message: newer }));
    assert.equal(row().querySelectorAll('[data-slot=spinner]').length, 0, 'one agent cannot acquire another loading indicator through a second message');
    assert.equal(q('[data-shared-message=newer-spinner]').querySelectorAll('[data-slot=spinner]').length, 1);
    await act(async () => { for (const message of [work, newer]) source.emit({ type: 'message', message: { ...message, streaming: false, steps: message.steps.map(step => ({ ...step, status: 'done' })) } }); });
    assert.equal(row().querySelector('[data-testid=activity]').dataset.open, 'false');
    assert.equal(row().querySelectorAll('[data-slot=spinner]').length, 0);
    assert.equal(q('[data-shared-message=newer-spinner]').querySelectorAll('[data-slot=spinner]').length, 0);
    assert.equal(row().querySelector('[data-testid=activity-label]').textContent, '3 steps');
  });
  await t.test('agent messages are participant bubbles; traces replace indexed steps and stay per-agent', async () => {
    const at = '2026-10-20T12:00:00Z';
    const plan = { id: 'pm-plan', conversationId: 'main', author: 'pm', at, text: 'Je vais ajouter un export PDF.\nJe vérifierai le document.', streaming: true, steps: [] };
    const worker = { id: 'worker-plan', conversationId: 'main', author: 'worker', at, text: 'Je regarde vos fichiers.', streaming: true, steps: [] };
    await act(async () => {
      source.emit({ type: 'message', message: plan }); source.emit({ type: 'message', message: worker });
      source.emit({ type: 'step', messageId: plan.id, conversationId: 'main', index: 0, step: { label: 'Lire les fichiers', status: 'running', detail: 'read docs/fictional.md' } });
      source.emit({ type: 'step', messageId: worker.id, conversationId: 'main', index: 0, step: { label: 'Préparer les données', status: 'running' } });
    });
    const pm = () => q('[data-shared-message=pm-plan]'); const builder = () => q('[data-shared-message=worker-plan]');
    assert.match(pm().textContent, /PM is working/);
    for (const message of [pm(), builder()]) {
      assert.equal(message.querySelector('[data-testid=activity]').dataset.open, 'false');
      assert.equal(message.querySelectorAll('[data-slot=spinner]').length, 1, 'one collapsed summary spinner per working agent');
      assert.equal(message.querySelector('[data-testid=activity-step]'), null);
      assert.equal(message.querySelector('[data-testid=member-avatar] [data-slot=spinner]'), null);
      assert.equal(message.querySelector('[data-testid=request-card] [data-slot=spinner]'), null);
    }
    await act(async () => { pm().querySelector('[data-testid=activity] button').click(); builder().querySelector('[data-testid=activity] button').click(); });
    for (const message of [pm(), builder()]) {
      assert.equal(message.querySelectorAll('[data-slot=spinner]').length, 1, 'the expanded running step owns the only spinner');
      assert.ok(message.querySelector('[data-testid=activity-step] [data-slot=spinner]'));
    }
    assert.equal(pm().querySelector('[data-testid=activity-step]').dataset.status, 'running');
    assert.match(pm().querySelector('[data-testid=activity-steps]').textContent, /read docs\/fictional.md/);
    assert.match(builder().textContent, /Préparer les données/);
    assert.doesNotMatch(builder().textContent, /Lire les fichiers/);
    assert.equal(pm().querySelector('button[aria-label="Copy response"]'), null, 'no assistant-panel actions on a participant');
    const existing = pm();
    await act(async () => {
      source.emit({ type: 'delta', messageId: plan.id, conversationId: 'main', text: '\nLe plan est partagé.' });
      source.emit({ type: 'step', messageId: plan.id, conversationId: 'main', index: 0, step: { label: 'Fichiers lus', status: 'done', detail: 'read docs/fictional.md' } });
      source.emit({ type: 'step', messageId: plan.id, conversationId: 'main', index: 1, step: { label: 'Vérifier le PDF', status: 'running' } });
    });
    assert.equal(pm(), existing); assert.match(pm().textContent, /Le plan est partagé/);
    assert.deepEqual([...pm().querySelectorAll('[data-testid=activity-step]')].map(step => step.dataset.status), ['completed', 'running']);
    assert.equal(builder().querySelectorAll('[data-testid=activity-step]').length, 1);
    await act(async () => source.emit({ type: 'step', messageId: worker.id, conversationId: 'main', index: 0, step: { label: 'Vérification refusée', status: 'failed' } }));
    assert.equal(builder().querySelector('[data-testid=host-step]').dataset.status, 'error');
    const complete = { ...controller.getSnapshot().shared.messages.find(message => message.id === plan.id), streaming: false };
    await act(async () => source.emit({ type: 'message', message: complete }));
    assert.equal(pm().querySelector('[data-testid=activity]').dataset.open, 'false');
    assert.equal(pm().querySelectorAll('[data-slot=spinner]').length, 0);
    assert.equal(pm().querySelector('[data-testid=activity-label]').textContent, '2 steps');
    await act(async () => pm().querySelector('[data-testid=activity] button').click());
    assert.equal(pm().querySelector('[data-testid=activity]').dataset.open, 'true');
    assert.match(pm().querySelector('[data-testid=activity-steps]').textContent, /read docs\/fictional.md/);
  });
  await t.test('one card becomes the result, quoted Reply is sent and the parent quote scrolls to the same card', async () => {
    const card = { ...sharedChatSeed.messages.find(message => message.id === 'six'), at: '2026-10-20T12:02:00Z', card: { requestId: 'review-plan', title: 'Export PDF', line: 'Construction en cours', state: 'building', action: { id: 'progress', label: 'Voir la demande' } } };
    await act(async () => source.emit({ type: 'message', message: card }));
    const old = q('[data-shared-message=six]');
    const ready = { ...card, card: { ...card.card, state: 'preview', line: 'Une version à essayer', action: { id: 'try', label: 'Essayer cette version' } } };
    await act(async () => source.emit({ type: 'message', message: ready }));
    assert.equal(q('[data-shared-message=six]'), old);
    assert.equal(document.querySelectorAll('[data-shared-message=six] [data-testid=request-card]').length, 1);
    assert.match(old.textContent, /Une version à essayer/); assert.match(old.textContent, /Essayer cette version/);
    await act(async () => old.querySelector('[data-testid=shared-reply]').click());
    assert.match(q('[data-testid=composer-reply]').textContent, /PM.*Export PDF/);
    await act(async () => controller.setText('Ajoute la date, merci.'));
    await act(async () => q('[data-testid=composer-submit]').click());
    await settle(() => source.sends.at(-1)?.replyTo === 'six');
    const sent = controller.getSnapshot().shared.messages.find(message => message.clientId === source.sends.at(-1).clientId);
    const row = q(`[data-shared-message="${sent.id}"]`);
    assert.match(row.querySelector('[data-testid=message-quote]').textContent, /PM.*Export PDF/);
    let scrolled = false; old.scrollIntoView = () => { scrolled = true; };
    await act(async () => row.querySelector('[data-testid=message-quote] button').click());
    assert.equal(scrolled, true);
    assert.equal(q('[data-testid=composer-reply]'), null);
    await act(async () => old.querySelector('[data-testid=shared-reply]').click());
    await act(async () => q('[data-testid=composer-reply-remove]').click());
    assert.equal(controller.getSnapshot().shared.replyTo, undefined);
  });
  await t.test('request actions surface the host error message', async () => {
    const action = source.action;
    source.action = async () => { throw new Error('Action refusée par le projet.'); };
    try {
      await act(async () => q('[data-shared-message=six] [data-testid=request-card] button').click());
      assert.equal(q('[data-shared-message=six] [role=alert]')?.textContent, 'Action refusée par le projet.');
    } finally { source.action = action; }
  });
  await t.test('the latest card drives the agent avatar and tooltip; missing state is neutral', async () => {
    const latest = controller.getSnapshot().shared.messages.find(message => message.id === 'six');
    for (const [state, expected] of [['building', 'working'], ['asked', 'thinking'], ['review', 'waiting'], ['fixing', 'blocked'], ['live', 'done'], ['unrecognized', 'neutral'], [undefined, 'neutral']]) {
      const card = { ...latest.card, state, line: 'Je prépare votre version.' };
      await act(async () => source.emit({ type: 'message', message: { ...latest, card } }));
      const avatar = q('[data-testid=agent-avatar-pm]');
      assert.equal(avatar.dataset.state, expected);
      assert.equal(Boolean(avatar.querySelector('[data-testid=avatar-indicator]')), expected !== 'neutral');
      assert.equal(Boolean(avatar.querySelector('[data-slot=spinner]')), false, 'avatar states use only a corner dot');
    }
  });
  await t.test('the phone state disclosure closes when the transcript scrolls', async () => {
    const latest = controller.getSnapshot().shared.messages.find(message => message.id === 'six');
    await act(async () => source.emit({ type: 'message', message: { ...latest, card: { ...latest.card, state: 'preview', line: 'Je prépare votre version.' } } }));
    await act(async () => window.happyDOM.setWindowSize({ width: 390, height: 844 }));
    await act(async () => q('[data-testid=agent-avatar-pm]').click());
    await settle(() => q('[data-slot=popover-content]'));
    assert.match(q('[data-slot=popover-content]').textContent, /Je prépare votre version/);
    await act(async () => q('[data-testid=transcript-scroll]').dispatchEvent(new window.Event('scroll')));
    await settle(() => !q('[data-slot=popover-content][data-open]'));
    assert.equal(q('[data-testid=agent-avatar-pm]').getAttribute('aria-expanded'), 'false');
    await act(async () => window.happyDOM.setWindowSize({ width: 1024, height: 768 }));
  });
  await t.test('Reply reuses desktop hover/focus actions and a phone long-press exposes the same button', async () => {
    const row = q('[data-shared-message=six]');
    const actions = () => row.querySelector('[data-testid=shared-message-actions]');
    assert.ok(actions().className.includes('group-hover/shared-message:opacity-100'));
    assert.ok(actions().className.includes('group-focus-within/shared-message:opacity-100'));
    await act(async () => window.happyDOM.setWindowSize({ width: 390, height: 844 }));
    assert.equal(actions().hidden, true);
    await act(async () => row.dispatchEvent(new window.PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch', clientX: 10, clientY: 10 })));
    await act(async () => new Promise(resolve => setTimeout(resolve, 500)));
    await act(async () => row.dispatchEvent(new window.PointerEvent('pointerup', { bubbles: true, pointerType: 'touch' })));
    assert.equal(actions().hidden, false);
    await act(async () => row.querySelector('[data-testid=shared-reply]').click());
    assert.equal(controller.getSnapshot().shared.replyTo, 'six');
    assert.equal(actions().hidden, true);
    await act(async () => controller.setReplyTo(undefined));
    await act(async () => window.happyDOM.setWindowSize({ width: 1024, height: 768 }));
  });
  await t.test('narrow-screen keyboard users can reach Reply without a long-press', async () => {
    const row = q('[data-shared-message=six]');
    await act(async () => window.happyDOM.setWindowSize({ width: 390, height: 844 }));
    assert.equal(row.tabIndex, 0);
    await act(async () => { row.focus(); row.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'F10', shiftKey: true, bubbles: true, cancelable: true })); });
    assert.equal(row.querySelector('[data-testid=shared-message-actions]').hidden, false);
    await act(async () => row.querySelector('[data-testid=shared-reply]').click());
    assert.equal(controller.getSnapshot().shared.replyTo, 'six');
    await act(async () => { controller.setReplyTo(undefined); window.happyDOM.setWindowSize({ width: 1024, height: 768 }); });
  });
  await t.test('localized separators precede the first message and gaps over fifteen minutes, not two minutes', async () => {
    await act(async () => {
      for (const [id, at] of [['timed-first', '2026-10-20T13:00:00Z'], ['timed-close', '2026-10-20T13:02:00Z'], ['timed-boundary', '2026-10-20T13:17:00Z'], ['timed-late', '2026-10-20T13:33:00Z']]) source.emit({ type: 'message', message: { id, at, conversationId: 'main', author: 'pm', text: id } });
    });
    assert.equal(q('[data-testid=time-separator] time')?.dateTime, sharedChatSeed.messages[0].at);
    assert.doesNotMatch(q('[data-testid=transcript-scroll]').textContent, /Beginning of conversation|Début de la conversation/);
    assert.equal(q('[data-shared-message=timed-close]').closest('[data-slot=message-scroller-item]').querySelector('[data-testid=time-separator]'), null);
    assert.equal(q('[data-shared-message=timed-boundary]').closest('[data-slot=message-scroller-item]').querySelector('[data-testid=time-separator]'), null);
    assert.equal(q('[data-shared-message=timed-late]').closest('[data-slot=message-scroller-item]').querySelector('[data-testid=time-separator] time')?.dateTime, '2026-10-20T13:33:00Z');
    assert.equal(q('[data-shared-message=timed-first] [data-testid=message-author]')?.textContent, 'PM');
    assert.equal(q('[data-shared-message=timed-close] [data-testid=message-author]'), null);
    assert.equal(q('[data-shared-message=timed-boundary] [data-testid=message-author]'), null);
    assert.equal(q('[data-shared-message=timed-late] [data-testid=message-author]')?.textContent, 'PM');
  });
  await t.test('personal-agent attribution stays on the person, including my own user bubble', async () => {
    await act(async () => {
      source.emit({ type: 'message', message: { id: 'before-via', conversationId: 'main', author: 'leo', at: '2026-10-20T12:03:00Z', text: 'A manual message.' } });
      source.emit({ type: 'message', message: { id: 'via-person', conversationId: 'main', author: 'leo', at: '2026-10-20T12:04:00Z', via: 'Claude', text: 'A fictional suggestion from my personal agent.' } });
      source.emit({ type: 'message', message: { id: 'via-me', conversationId: 'main', author: 'mira', at: '2026-10-20T12:05:00Z', via: 'ChatGPT', text: 'My fictional message.' } });
      source.emit({ type: 'message', message: { id: 'after-via', conversationId: 'main', author: 'mira', at: '2026-10-20T12:06:00Z', text: 'My manual message.' } });
    });
    for (const [id, name, via] of [['via-person', 'Leo', 'Claude']]) {
      const row = q(`[data-shared-message="${id}"]`);
      assert.equal(row.querySelector('[data-testid=message-author]')?.textContent, name);
      assert.ok(row.querySelector('[data-testid=member-avatar]'));
      assert.equal(row.querySelector('[data-testid=message-via]')?.textContent, `via ${via}`);
      assert.ok(row.querySelector('[data-testid=message-via]')?.classList.contains('text-muted-foreground'));
      assert.equal(row.querySelector('[data-testid=author-badge]'), null);
      assert.equal(row.querySelector('[data-testid=avatar-indicator]'), null);
      assert.equal(row.querySelector('[data-slot=spinner]'), null);
    }
    assert.equal(Boolean(q('[data-shared-message=via-me] [data-testid=message-author]')), false);
    assert.equal(Boolean(q('[data-shared-message=via-me] [data-testid=member-avatar]')), false);
    assert.equal(q('[data-shared-message=via-me] [data-testid=user-text]')?.textContent, 'My fictional message.');
    assert.equal(q('[data-shared-message=after-via] [data-testid=message-author]'), null, 'my manual message keeps the existing bubble-only presentation');
    assert.equal(q('[data-shared-message=before-via] [data-testid=message-via]'), null);
  });
  await t.test('a quote reveals an older parent through the existing transcript window', async () => {
    await act(async () => {
      for (let index = 0; index < 65; index++) source.emit({ type: 'message', message: { id: `later-${index}`, conversationId: 'main', author: 'leo', at: new Date(Date.UTC(2026, 9, 21, 10, index)).toISOString(), text: `Fictional line ${index}` } });
      source.emit({ type: 'message', message: { id: 'distant-reply', conversationId: 'main', author: 'mira', at: '2026-10-22T10:00:00Z', text: 'Follow-up', replyTo: 'six' } });
    });
    assert.equal(q('[data-shared-message=six]'), null, 'the parent is outside the mounted transcript window');
    await act(async () => q('[data-shared-message=distant-reply] [data-testid=message-quote] button').click());
    await settle(() => q('[data-shared-message=six]'));
  });
  await t.test('History lists every supplied conversation and selects a direct conversation', async () => {
    await act(async () => q('[data-testid=history-open]').click());
    await settle(() => q('[data-testid=conversation-row]'));
    assert.equal(document.querySelectorAll('[data-testid=conversation-row]').length, 3);
    const row = [...document.querySelectorAll('[data-testid=conversation-row]')].find(row => row.textContent.includes('Mira and Leo'));
    await act(async () => row.click());
    await settle(() => q('[data-shared-message=direct-one]'));
    assert.equal(q('[data-shared-message=one]'), null);
  });
});
