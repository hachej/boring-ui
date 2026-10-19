import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';
import { Window } from 'happy-dom';
import { createSharedChat, createFakeChannelSource } from '@hachej/boring-ui-kit/shared-chat';
import { sharedChatSeed } from '../../examples/shared-chat/seed.mjs';

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
  await build({ entryPoints: [new URL('../../registry/pi-chat/pi-chat.tsx', import.meta.url).pathname], outfile: output.pathname, bundle: true, format: 'esm', platform: 'node', jsx: 'automatic', packages: 'external', tsconfig: new URL('../../tsconfig.json', import.meta.url).pathname,
    plugins: process.env.SHARED_CHAT_OLD_RENDERER ? [{ name: 'pre-shared-renderer', setup(builder) {
      builder.onLoad({ filter: /registry\/pi-chat\/.*\.(ts|tsx)$/ }, ({ path }) => {
        const relative = path.slice(new URL('../../', import.meta.url).pathname.length);
        return { contents: execFileSync('git', ['show', `${process.env.SHARED_CHAT_BASE ?? '97bea0756'}:${relative}`], { encoding: 'utf8' }), loader: path.endsWith('.tsx') ? 'tsx' : 'ts' };
      });
    } }] : [] });
  const { PiChat } = await import(output.href);
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

  await t.test('author grouping, avatars, agent and admin badges; own bubble stays unchanged', async () => {
    assert.equal(q('[data-shared-message="one"] [data-testid=message-author]')?.textContent, 'Leo');
    assert.ok(q('[data-shared-message="one"] [data-testid=member-avatar]'));
    assert.equal(q('[data-shared-message="two"] [data-testid=message-author]'), null);
    assert.equal(q('[data-shared-message="four"] [data-testid=author-badge]')?.textContent, 'Admin');
    assert.equal(q('[data-shared-message="five"] [data-testid=author-badge]')?.textContent, 'Agent');
    assert.ok(q('[data-shared-message="three"] [data-testid=user-text]'));
    assert.equal(q('[data-shared-message="three"] [data-testid=message-author]'), null);
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
    await act(async () => q('[data-testid=shared-members]').click());
    await settle(() => q('[data-testid=member-list]'));
    assert.match(q('[data-testid=member-list]').textContent, /Julien \(admin\)/);
    assert.equal(q('[data-member-id=leo] [data-testid=presence]')?.dataset.presence, 'here');
    await act(async () => source.emit({ type: 'presence', members: [{ id: 'leo', presence: 'away' }] }));
    assert.equal(q('[data-member-id=leo] [data-testid=presence]')?.dataset.presence, 'away');
    await act(async () => source.setStatus('reconnecting'));
    assert.equal(q('[data-testid=shared-status]')?.dataset.status, 'reconnecting');
    await act(async () => source.setStatus('offline'));
    assert.equal(q('[data-testid=shared-status]')?.dataset.status, 'offline');
    await act(async () => { source.setStatus('live'); q('[data-testid=shared-members]').click(); });
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
    assert.deepEqual([...document.querySelectorAll('[data-testid=mention-item]')].map(item => item.dataset.path).slice(0, 2), ['pm', 'worker']);
    await act(async () => textarea.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
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
    assert.match(pm().textContent, /PM is writing/);
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
  await t.test('the latest card drives the agent avatar and tooltip; missing state is neutral', async () => {
    const latest = controller.getSnapshot().shared.messages.find(message => message.id === 'six');
    for (const [state, expected] of [['building', 'working'], ['asked', 'thinking'], ['review', 'waiting'], ['fixing', 'blocked'], ['live', 'done'], ['unrecognized', 'neutral'], [undefined, 'neutral']]) {
      const card = { ...latest.card, state, line: 'Je prépare votre version.' };
      await act(async () => source.emit({ type: 'message', message: { ...latest, card } }));
      const avatar = q('[data-testid=agent-avatar-pm]');
      assert.equal(avatar.dataset.state, expected);
      assert.equal(Boolean(avatar.querySelector('[data-testid=avatar-indicator]')), expected !== 'neutral');
      assert.equal(Boolean(avatar.querySelector('[data-slot=spinner]')), expected === 'working' || expected === 'thinking');
    }
    // Real hover/focus visibility belongs to the Chromium journey. The DOM realm drives the phone's native tap disclosure.
    await act(async () => window.happyDOM.setWindowSize({ width: 390, height: 844 }));
    await act(async () => q('[data-testid=agent-avatar-pm]').click());
    await settle(() => q('[data-slot=popover-content]'));
    assert.match(q('[data-slot=popover-content]').textContent, /Je prépare votre version/);
    await act(async () => q('[data-testid=agent-avatar-pm]').click());
    await act(async () => window.happyDOM.setWindowSize({ width: 1024, height: 768 }));
  });
  await t.test('personal-agent attribution stays on the person, including my own user bubble', async () => {
    await act(async () => {
      source.emit({ type: 'message', message: { id: 'before-via', conversationId: 'main', author: 'leo', at: '2026-10-20T12:03:00Z', text: 'A manual message.' } });
      source.emit({ type: 'message', message: { id: 'via-person', conversationId: 'main', author: 'leo', at: '2026-10-20T12:04:00Z', via: 'Claude', text: 'A fictional suggestion from my personal agent.' } });
      source.emit({ type: 'message', message: { id: 'via-me', conversationId: 'main', author: 'mira', at: '2026-10-20T12:05:00Z', via: 'ChatGPT', text: 'My fictional message.' } });
      source.emit({ type: 'message', message: { id: 'after-via', conversationId: 'main', author: 'mira', at: '2026-10-20T12:06:00Z', text: 'My manual message.' } });
    });
    for (const [id, name, via] of [['via-person', 'Leo', 'Claude'], ['via-me', 'Mira', 'ChatGPT']]) {
      const row = q(`[data-shared-message="${id}"]`);
      assert.equal(row.querySelector('[data-testid=message-author]')?.textContent, name);
      assert.ok(row.querySelector('[data-testid=member-avatar]'));
      assert.equal(row.querySelector('[data-testid=message-via]')?.textContent, `via ${via}`);
      assert.ok(row.querySelector('[data-testid=message-via]')?.classList.contains('text-muted-foreground'));
      assert.equal(row.querySelector('[data-testid=author-badge]'), null);
      assert.equal(row.querySelector('[data-testid=avatar-indicator]'), null);
      assert.equal(row.querySelector('[data-slot=spinner]'), null);
    }
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
