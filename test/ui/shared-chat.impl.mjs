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
  const { SharedChat: PiChat, defaultSharedLabels } = await import(output.href);
  const defaultLabels = () => ({ copyResponse: 'Copy response' });
  const source = createFakeChannelSource(sharedChatSeed);
  let controller = createSharedChat(source, { conversationId: 'main' });
  const controllers = [controller];
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  const q = selector => document.querySelector(selector);
  const settle = async ready => { for (let n = 0; n < 200 && !ready(); n++) await act(async () => new Promise(resolve => setTimeout(resolve, 10))); assert.ok(ready(), 'expected UI appeared'); };
  let pendingVoice, chatOptions = {};
  const draw = () => root.render(createElement(PiChat, { ...chatOptions, controller, pendingVoice, mentions: { search: async () => [] }, conversations: { items: sharedChatSeed.conversations, activeId: controller.getSnapshot().conversationId, onSelect(id) { controller = createSharedChat(source, { conversationId: id }); controllers.push(controller); draw(); } } }));
  const render = () => act(async () => draw());
  t.after(async () => { await act(async () => { root.unmount(); for (const controller of controllers) await controller.dispose(); }); await window.happyDOM.close(); for (const [name, descriptor] of globals) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; } });
  await render();
  await settle(() => q('[data-shared-message="one"]'));

  await t.test('local failed voice rows stay in the shared transcript, not in its composer', async () => {
    pendingVoice = [{ id: 41, path: 'uploads/voice-20261021-100000.webm', phase: 'transcribe-failed', seconds: 2,
      retry() {}, audioOnly() {}, discard: () => { pendingVoice = []; draw(); } }];
    await render();
    const pending = q('[data-testid=voice-pending]');
    assert.equal(pending?.closest('[data-testid=transcript]')?.dataset.testid, 'transcript');
    assert.equal(pending.closest('[data-testid=composer-dock]'), null);
    assert.ok(q('[data-shared-message=one]'), 'existing shared messages remain in their host timeline');
    await act(async () => pending.querySelector('[data-testid=voice-discard]').click());
    assert.equal(q('[data-testid=voice-pending]'), null);
    assert.ok(q('[data-shared-message=one]'));
    const viewport = q('[data-testid=transcript-scroll]'), navigation = q('[data-testid=transcript-navigation]');
    assert.equal(navigation, null, 'at the bottom there is no jump pill and no reserved row');
    assert.ok(q('[data-testid=transcript-bottom]').classList.contains('justify-end'), 'a short room hugs the bottom, by the composer');
    for (const element of viewport.querySelectorAll('*')) assert.doesNotMatch(element.getAttribute('class') ?? '', /(?:^|\s)(?:sticky|fixed)(?:\s|$)/, 'nothing in the room sticks over messages');
  });
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
  await t.test('a member avatar loads only https, data:image, blob and same-origin addresses; others keep the initials', async () => {
    const messages = new URL('../../.cache/shared-chat-test/messages.mjs', import.meta.url);
    await build({ entryPoints: [new URL('../../registry/shared-chat/messages.tsx', import.meta.url).pathname], outfile: messages.pathname, bundle: true, format: 'esm', platform: 'node', jsx: 'automatic', packages: 'external', tsconfig: new URL('../../tsconfig.json', import.meta.url).pathname });
    const { MemberAvatar } = await import(messages.href);
    const loaded = [];
    window.Image = class { set src(value) { loaded.push(value); setTimeout(() => this.onload?.(), 0); } addEventListener(type, listener) { if (type === 'load') setTimeout(listener, 0); } removeEventListener() {} };
    const shown = async avatarUrl => {
      const box = document.createElement('div'); document.body.append(box); const mounted = createRoot(box);
      await act(async () => mounted.render(createElement(MemberAvatar, { member: { id: 'x', name: 'Mira Fictional', kind: 'person', avatarUrl }, interactive: false })));
      await act(async () => new Promise(resolve => setTimeout(resolve, 30)));
      const img = box.querySelector('img')?.getAttribute('src') ?? null;
      const initials = box.textContent;
      await act(async () => mounted.unmount()); box.remove();
      return { img, initials };
    };
    const ok = await shown('https://cdn.invalid/a.png');
    assert.equal(ok.img, 'https://cdn.invalid/a.png', 'the stubbed image load shows an https avatar');
    for (const url of ['data:image/png;base64,AAAA', 'blob:https://fictional.invalid/id', '/avatars/mira.png']) assert.equal((await shown(url)).img, url, url);
    for (const url of ['http://tracker.invalid/p.png', '//tracker.invalid/p.png', 'javascript:alert(1)', 'data:text/html,x', 'ftp://x.invalid/a', 'avatar.png']) {
      const blocked = await shown(url);
      assert.equal(blocked.img, null, `${url} is not loaded`);
      assert.match(blocked.initials, /MF/, `${url} falls back to initials`);
    }
  });
  await t.test('author grouping, avatars, agent bubbles; my own bubble takes the theme primary', async () => {
    assert.equal(q('[data-shared-message="one"] [data-testid=message-author]')?.textContent, 'Leo');
    assert.equal(q('[data-shared-message="one"] [data-testid=message-author-row] [data-testid=member-avatar]')?.dataset.size, 'sm', 'the avatar rides with the name above the first bubble of a run');
    assert.equal(q('[data-shared-message="two"] [data-testid=member-avatar]'), null, 'the next bubbles of the run carry neither name nor avatar');
    for (const id of ['one', 'two']) {
      const bubble = q(`[data-shared-message="${id}"] [data-slot=bubble]`);
      assert.equal(bubble?.dataset.variant, 'muted'); assert.equal(bubble?.dataset.align, 'start');
      assert.equal(q(`[data-shared-message="${id}"] [data-slot=message]`)?.dataset.align, 'start');
    }
    assert.ok(q('[data-shared-message="one"] [data-testid=message-author]')?.classList.contains('text-xs'));
    assert.ok(q('[data-shared-message="one"] [data-testid=message-author]')?.classList.contains('text-muted-foreground'));
    assert.ok(q('[data-shared-message="one"] [data-testid=message-author-row] [data-testid=message-author]'), 'the name sits in the row above the first bubble');
    assert.equal(q('[data-shared-message="one"] [data-slot=bubble-content] [data-testid=message-author]'), null, 'and not inside the bubble');
    assert.ok(q('[data-shared-message="one"] [data-slot=bubble] > [data-testid=bubble-tail][data-side=start]'), 'the first bubble of a group has a tail');
    assert.equal(q('[data-shared-message="two"] [data-testid=bubble-tail]'), null, 'the next ones in the group have none');
    assert.ok(q('[data-shared-message="three"] [data-slot=bubble] > [data-testid=bubble-tail][data-side=end]'));
    for (const id of ['one', 'two', 'three', 'five']) {
      const time = q(`[data-shared-message="${id}"] [data-slot=bubble-content] [data-testid=message-time]`);
      assert.ok(time, `${id}: the time sits inside the bubble`);
      assert.equal(time.dateTime, sharedChatSeed.messages.find(message => message.id === id).at);
      assert.match(time.textContent, /^\d{1,2}:\d{2}(?:\s?[AP]M)?$/);
    }
    assert.equal(q('[data-shared-message="two"] [data-testid=message-author]'), null);
    assert.equal(q('[data-shared-message="four"] [data-testid=author-badge]')?.textContent, 'Admin');
    assert.equal(q('[data-shared-message="five"] [data-testid=author-badge]'), null);
    assert.ok(q('[data-shared-message="three"] [data-testid=user-text]'));
    assert.equal(q('[data-shared-message="three"] [data-slot=bubble]')?.dataset.align, 'end');
    assert.equal(q('[data-shared-message="three"] [data-slot=bubble]')?.dataset.variant, 'default', 'own messages use the primary bubble (primary / primary-foreground tokens)');
    assert.ok(q('[data-shared-message="three"] [data-slot=bubble]').className.includes('bg-primary'));
    assert.ok(q('[data-shared-message="three"] [data-slot=bubble]').className.includes('text-primary-foreground'));
    assert.equal(q('[data-shared-message="five"] [data-slot=bubble]')?.dataset.variant, 'muted');
    assert.equal(q('[data-shared-message="three"] [data-testid=message-author]'), null);
  });
  await t.test('people and agents place their avatar beside the last item, including a final request card', async () => {
    assert.equal(q('[data-testid=transcript] [data-testid=message-avatar]'), null, 'no avatar column beside the bubbles');
    for (const id of ['two', 'six', 'seven']) assert.equal(q(`[data-shared-message="${id}"] [data-testid=member-avatar]`), null, `${id}: not the first bubble of its run`);
    const five = q('[data-shared-message=five] [data-testid=message-author-row] [data-testid=member-avatar]');
    assert.ok(five, 'the first bubble of the assistant run carries its avatar above the bubble');
    assert.equal(five.dataset.agentKind, 'assistant');
    assert.ok(five.querySelector('svg[data-lucide=sparkle]'), 'agents show a clean glyph');
    assert.equal(q('[data-testid=transcript] [data-lucide=bot]'), null, 'no robot icon');
    assert.equal(q('[data-testid=transcript] [data-testid=avatar-indicator]'), null, 'no status dot on timeline avatars');
    assert.equal(q('[data-shared-message=three] [data-testid=member-avatar]'), null);
    for (const id of ['one', 'two', 'five', 'six']) assert.ok(q(`[data-shared-message="${id}"] [data-testid=shared-message-content]`));
    assert.equal(q('[data-shared-message=two] [data-testid=message-author-row]'), null);
    assert.equal(q('[data-shared-message=three] [data-testid=message-author-row]'), null);
    assert.equal(q('[data-shared-message=three] [data-testid=shared-message-content]')?.classList.contains('ml-8'), false);
    assert.equal(q('[data-shared-message=three] [data-slot=bubble]')?.dataset.align, 'end');
    assert.ok(q('[data-testid=transcript]').classList.contains('gap-0'));
    assert.ok(q('[data-shared-message=two]').closest('[data-row-key]').classList.contains('mt-0.5'), 'tight spacing inside a group');
    assert.ok(q('[data-shared-message=three]').closest('[data-row-key]').classList.contains('mt-3'), 'a little more between groups');
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
      assert.equal(row.querySelector('[data-testid=message-author-row] [data-testid=member-avatar]').dataset.agentColor, token);
      assert.equal(row.querySelector('[data-testid=message-mention]').getAttribute('data-agent-color'), null, 'the mention text shares the agents’ info colour; the avatar inside keeps the chart token');
      assert.equal(row.querySelector('[data-testid=message-mention] [data-testid=member-avatar]').dataset.agentColor, target);
      assert.ok(row.querySelector('[data-testid=message-mention]').classList.contains('items-baseline'));
    }
    for (const selector of ['[data-testid=message-author]', '[data-testid=message-author-row] [data-testid=member-avatar]', '[data-testid=message-mention]']) assert.equal(q(`[data-shared-message=colour-person] ${selector}`).getAttribute('data-agent-color'), null);
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
  // An independent viewer over its own fictional host, so these rows do not change the main fixture's later state.
  const isolated = async (seed, check) => {
    const own = createFakeChannelSource(seed), chat = createSharedChat(own, { conversationId: 'main' });
    const box = document.createElement('div'); document.body.append(box); const mounted = createRoot(box);
    try {
      await act(async () => mounted.render(createElement(PiChat, { controller: chat })));
      await settle(() => box.querySelector(`[data-shared-message="${seed.messages.at(-1).id}"]`));
      await check(box, own);
    } finally { await act(async () => mounted.unmount()); await chat.dispose(); box.remove(); }
  };
  await t.test('the author line carries the member role: owner, validator and member as words, agents as the app agent, the admin by its badge', async () => {
    assert.equal(q('[data-testid=transcript] [data-testid=message-role]'), null, 'no role line by default');
    const toggle = id => q(`[data-shared-message="${id}"] [data-testid=message-author-toggle]`);
    assert.equal(toggle('one')?.getAttribute('aria-label'), 'Leo · validator');
    assert.equal(toggle('five')?.getAttribute('aria-label'), 'Your assistant · the app’s agent');
    assert.equal(toggle('four'), null, 'the admin keeps its badge, no role to show');
    assert.equal(q('[data-shared-message="three"] [data-testid=message-author-row]'), null, 'my own messages have no author row');
    assert.ok(toggle('one').classList.contains('min-h-11'), 'the name is a 44px target');
    await act(async () => toggle('one').click());
    await settle(() => q('[data-testid=message-role]'));
    assert.equal(q('[data-testid=message-role]').textContent, 'Leo · validator', 'a tap on the name shows the role');
    await act(async () => document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    await settle(() => !q('[data-testid=message-role][data-open]'));
    const members = [...sharedChatSeed.members, { id: 'lea', name: 'Léa', kind: 'person', role: 'member' }, { id: 'reminder', name: 'Reminder agent', kind: 'agent', role: 'agent:reminder', roleLabel: 'the reminders' }, { id: 'guest', name: 'Guest', kind: 'person' }];
    const messages = [['role-lea', 'lea'], ['role-reminder', 'reminder'], ['role-guest', 'guest']].map(([id, author], n) => ({ id, author, conversationId: 'main', at: `2026-10-20T16:0${n}:00Z`, text: 'Hello' }));
    await isolated({ ...sharedChatSeed, members, conversations: [{ ...sharedChatSeed.conversations[0], members: members.map(member => member.id) }], messages }, async box => {
      const role = id => box.querySelector(`[data-shared-message="${id}"] [data-testid=message-author-toggle]`)?.getAttribute('aria-label') ?? null;
      assert.equal(role('role-lea'), 'Léa · member');
      assert.equal(role('role-reminder'), 'Reminder agent · the reminders', 'a host roleLabel wins over the derived line');
      assert.equal(role('role-guest'), null, 'no role, nothing to tap');
    });
  });
  await t.test('a card offers several actions: the first is primary, the others secondary, each sends its own id', async () => {
    const card = { requestId: 'reminders', title: 'Reminders by text', line: 'Léa asked for a text the day before.', state: 'question',
      actions: [{ id: 'build', label: 'Build it' }, { id: 'later', label: 'Not now' }] };
    const message = { id: 'multi', conversationId: 'main', author: 'pm', at: '2026-10-20T17:00:00Z', card };
    await isolated({ ...sharedChatSeed, messages: [message] }, async (box, own) => {
      const shown = () => [...box.querySelectorAll('[data-shared-message=multi] [data-testid=request-action]')].map(button => [button.textContent, button.dataset.actionVariant, button.parentElement.classList.contains('text-primary') ? 'text-primary' : 'inherit']);
      assert.deepEqual(shown(), [['Build it', 'primary', 'text-primary'], ['Not now', 'secondary', 'inherit']]);
      for (const button of box.querySelectorAll('[data-shared-message=multi] [data-testid=request-action]')) {
        assert.equal(button.dataset.variant ?? 'ghost', 'ghost', 'text buttons, WhatsApp style');
        assert.ok(button.classList.contains('min-h-11'), '44px touch target');
      }
      assert.equal(box.querySelector('[data-shared-message=multi] [role=group]').parentElement.querySelector('[data-slot=separator]') !== null, true, 'a hairline above the buttons');
      await act(async () => box.querySelectorAll('[data-shared-message=multi] [data-testid=request-action]')[1].click());
      assert.deepEqual(own.actions, [{ conversationId: 'main', requestId: 'reminders', actionId: 'later' }]);
      await act(async () => own.emit({ type: 'message', message: { ...message, card: { ...card, actions: [{ id: 'later', label: 'Not now', variant: 'secondary' }, { id: 'build', label: 'Build it', variant: 'primary' }] } } }));
      assert.deepEqual(shown(), [['Not now', 'secondary', 'inherit'], ['Build it', 'primary', 'text-primary']], 'an explicit variant wins over the position');
    });
  });
  await t.test('a request card is a compact bubble: one title line, one muted line with the time, no border box', async () => {
    const card = q('[data-shared-message=six] [data-testid=request-card]');
    const bubble = card.closest('[data-slot=bubble]');
    assert.equal(bubble?.dataset.variant, 'muted'); assert.equal(bubble?.dataset.testid, 'card-bubble');
    assert.doesNotMatch(card.className, /(?:^|\s)(?:border|ring-1)(?:\s|$)/);
    assert.equal(card.querySelector('[data-testid=request-title]').textContent, 'Review complete');
    assert.ok(card.querySelector('[data-testid=request-title]').classList.contains('truncate'));
    assert.ok(card.querySelector('[data-testid=request-line]').classList.contains('truncate'));
    assert.ok(card.querySelector('[data-testid=request-line]').classList.contains('text-muted-foreground'));
    assert.ok(card.querySelector('[data-testid=message-time]'));
    assert.doesNotMatch(card.textContent, /Since/, 'no relative « since » line');
  });
  await t.test('delta keeps the existing assistant streaming row identity', async () => {
    await act(async () => source.emit({ type: 'message', message: { id: 'stream', conversationId: 'main', author: 'pm', at: new Date().toISOString(), text: 'Checking', streaming: true } }));
    const row = q('[data-shared-message="stream"] [data-role=assistant]');
    assert.equal(row?.dataset.streaming, 'true');
    await act(async () => source.emit({ type: 'delta', messageId: 'stream', conversationId: 'main', text: ' the plan.' }));
    assert.equal(q('[data-shared-message="stream"] [data-role=assistant]'), row);
    assert.match(row.textContent, /Checking the plan\./);
    // Complete this turn so later per-agent spinner fixtures do not inherit a wall-clock-dependent working message.
    await act(async () => source.emit({ type: 'message', message: { ...controller.getSnapshot().shared.messages.find(message => message.id === 'stream'), streaming: false } }));
    assert.equal(row.querySelectorAll('[data-slot=spinner]').length, 0);
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
    await settle(() => document.querySelectorAll('[data-testid=mention-item]').length === 4);
    assert.deepEqual([...document.querySelectorAll('[data-testid=mention-item]')].slice(0, 2).map(item => item.dataset.path), ['pm', 'data']);
    assert.equal(document.querySelector('[data-testid=mention-item][data-path=worker]'), null);
    assert.equal(document.querySelector('[data-testid=mention-item][data-path=mira]'), null, 'the reader is not offered to themselves');
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
    assert.match(pm().textContent, /Your assistant is working/);
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
    assert.match(q('[data-testid=composer-reply]').textContent, /Your assistant.*Export PDF/);
    await act(async () => controller.setText('Ajoute la date, merci.'));
    await act(async () => q('[data-testid=composer-submit]').click());
    await settle(() => source.sends.at(-1)?.replyTo === 'six');
    const sent = controller.getSnapshot().shared.messages.find(message => message.clientId === source.sends.at(-1).clientId);
    const row = q(`[data-shared-message="${sent.id}"]`);
    assert.match(row.querySelector('[data-testid=message-quote]').textContent, /Your assistant.*Export PDF/);
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
  await t.test('the latest card drives the agent state in the member list; timeline avatars stay a plain glyph', async () => {
    const latest = controller.getSnapshot().shared.messages.find(message => message.id === 'six');
    await act(async () => q('[data-testid=shared-members]').click());
    await settle(() => q('[data-testid=member-list]'));
    for (const [state, expected] of [['building', 'working'], ['asked', 'thinking'], ['review', 'waiting'], ['fixing', 'blocked'], ['live', 'done'], ['unrecognized', 'neutral'], [undefined, 'neutral']]) {
      const card = { ...latest.card, state, line: 'Je prépare votre version.' };
      await act(async () => source.emit({ type: 'message', message: { ...latest, card } }));
      const avatar = q('[data-testid=member-list] [data-testid=agent-avatar-pm]');
      assert.equal(avatar.dataset.state, expected);
      assert.equal(Boolean(avatar.querySelector('[data-testid=avatar-indicator]')), expected !== 'neutral');
      assert.equal(Boolean(avatar.querySelector('[data-slot=spinner]')), false, 'avatar states use only a corner dot');
      assert.equal(q('[data-testid=transcript] [data-testid=avatar-indicator]'), null, 'the timeline shows no state dot');
    }
    await act(async () => q('[data-testid=shared-members]').click());
  });
  await t.test('the phone state disclosure in the member list closes when the page scrolls', async () => {
    const latest = controller.getSnapshot().shared.messages.find(message => message.id === 'six');
    await act(async () => source.emit({ type: 'message', message: { ...latest, card: { ...latest.card, state: 'preview', line: 'Je prépare votre version.' } } }));
    await act(async () => window.happyDOM.setWindowSize({ width: 390, height: 844 }));
    await act(async () => q('[data-testid=shared-members]').click());
    await settle(() => q('[data-testid=member-list] [data-testid=agent-avatar-pm]'));
    await act(async () => q('[data-testid=member-list] [data-testid=agent-avatar-pm]').click());
    await settle(() => q('[data-testid=agent-state-popover]'));
    assert.match(q('[data-testid=agent-state-popover]').textContent, /Je prépare votre version/);
    await act(async () => q('[data-testid=transcript-scroll]').dispatchEvent(new window.Event('scroll')));
    await settle(() => !q('[data-testid=agent-state-popover][data-open]'));
    await act(async () => q('[data-testid=shared-members-close]').click());
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
  await t.test('a day pill starts each day; a group is one author within fifteen minutes; host notices collapse into one line', async () => {
    const now = new Date(), day = 86_400_000;
    const morning = new Date(now); morning.setHours(9, 0, 0, 0);
    const at = (base, minutes) => new Date(base + minutes * 60_000).toISOString();
    const yesterday = morning.getTime() - day, today = morning.getTime(), older = morning.getTime() - 5 * day;
    const messages = [
      ['old', 'leo', at(older, 0), {}], ['y-first', 'pm', at(yesterday, 0), {}], ['y-close', 'pm', at(yesterday, 2), {}], ['y-boundary', 'pm', at(yesterday, 17), {}], ['y-late', 'pm', at(yesterday, 33), {}],
      ['sys-1', 'pm', at(today, 0), { kind: 'system', text: 'Shipped: Stop when uploaded' }], ['sys-2', 'pm', at(today, 1), { kind: 'system', text: 'Shipped: Client list' }], ['sys-3', 'pm', at(today, 2), { kind: 'system', text: 'Reverted: Reminder wording' }],
      ['t-after', 'pm', at(today, 3), {}],
    ].map(([id, author, when, extra]) => ({ id, author, at: when, conversationId: 'main', text: id, ...extra }));
    await isolated({ ...sharedChatSeed, messages }, async box => {
      const days = [...box.querySelectorAll('[data-testid=day-separator]')];
      assert.deepEqual(days.map(element => element.textContent), [defaultSharedLabels.sharedDay(messages[0].at), 'Yesterday', 'Today']);
      assert.match(days[0].textContent, /^[A-Z][a-z]{2} \d{1,2} [A-Z][a-z]{2}$/, 'older days read « Tue 22 Oct »');
      assert.equal(days[0].querySelector('[data-slot=badge]') ? true : days[0].firstElementChild?.dataset.slot === 'badge', true, 'a centred pill');
      const author = id => box.querySelector(`[data-shared-message="${id}"] [data-testid=message-author]`)?.textContent ?? null;
      assert.equal(author('y-first'), 'Your assistant'); assert.equal(author('y-close'), null); assert.equal(author('y-boundary'), null); assert.equal(author('y-late'), 'Your assistant');
      const lines = box.querySelector('[data-testid=system-lines]');
      assert.equal(lines.dataset.count, '3');
      assert.deepEqual([...lines.querySelectorAll('[data-testid=system-line]')].map(line => line.textContent), ['Reverted: Reminder wording'], 'only the latest notice shows');
      assert.equal(lines.querySelector('[data-testid=system-lines-toggle]').textContent, '2 more updates');
      await act(async () => lines.querySelector('[data-testid=system-lines-toggle]').click());
      assert.equal(lines.querySelectorAll('[data-testid=system-line]').length, 3);
      assert.equal(lines.querySelector('[data-testid=system-lines-toggle]').getAttribute('aria-expanded'), 'true');
      assert.equal(box.querySelector('[data-testid=system-lines] [data-slot=bubble]'), null, 'notices are not bubbles');
      assert.equal(author('t-after'), 'Your assistant', 'a notice ends a group');
    });
  });
  await t.test('a two-person channel shows neither avatars nor names; a pinned comment is a quoted bubble with a pin', async () => {
    const members = sharedChatSeed.members.filter(member => ['mira', 'pm'].includes(member.id));
    const messages = [
      { id: 'duo-1', conversationId: 'main', author: 'pm', at: '2026-10-20T10:00:00Z', text: 'Hello' },
      { id: 'duo-2', conversationId: 'main', author: 'pm', at: '2026-10-20T10:01:00Z', text: 'Still here' },
      { id: 'duo-pin', conversationId: 'main', author: 'mira', at: '2026-10-20T10:02:00Z', card: { requestId: 'pin-1', kind: 'pin', title: 'White bg', line: 'Preview of Due date column' } },
    ];
    await isolated({ ...sharedChatSeed, members, conversations: [{ ...sharedChatSeed.conversations[0], members: ['mira', 'pm'] }], messages }, async box => {
      assert.equal(box.querySelector('[data-testid=message-avatar]'), null);
      assert.equal(box.querySelector('[data-testid=message-author]'), null);
      const pin = box.querySelector('[data-shared-message=duo-pin] [data-testid=pinned-comment]');
      assert.ok(pin, 'pin cards render as a pinned comment');
      assert.equal(pin.closest('[data-slot=bubble]').dataset.align, 'end', 'mine, on the right');
      assert.equal(pin.closest('[data-slot=bubble]').dataset.variant, 'default');
      assert.match(pin.querySelector('[data-testid=pin-quote]').textContent, /Preview of Due date column/);
      assert.ok(pin.querySelector('[data-testid=pin-quote] svg[data-lucide], [data-testid=pin-quote] svg'));
      assert.match(pin.textContent, /White bg/);
      assert.equal(box.querySelector('[data-shared-message=duo-pin] [data-testid=request-card]'), null);
    });
  });
  await t.test('a question card: the choices answer with one tap (a reply to the question), a free reply opens the composer on it, an answered one has no choices', async () => {
    const members = sharedChatSeed.members.filter(member => ['mira', 'pm'].includes(member.id));
    const question = { callId: 'q1', prompt: 'Which format?', options: ['PDF', 'CSV'], allowFreeText: true, answered: false };
    const messages = [
      { id: 'q-1', conversationId: 'main', author: 'pm', at: '2026-10-20T10:00:00Z', text: 'Which format?', question },
      { id: 'q-2', conversationId: 'main', author: 'pm', at: '2026-10-20T10:01:00Z', text: 'Which size?', question: { callId: 'q2', prompt: 'Which size?', options: ['A4'], allowFreeText: false, answered: true } },
    ];
    await isolated({ ...sharedChatSeed, members, conversations: [{ ...sharedChatSeed.conversations[0], members: ['mira', 'pm'] }], messages }, async (box, own) => {
      const open = box.querySelector('[data-shared-message=q-1] [data-testid=question-card]');
      assert.ok(open, 'the question is a card');
      assert.deepEqual([...open.querySelectorAll('[data-testid=question-option]')].map(button => button.textContent), ['PDF', 'CSV']);
      assert.ok(open.querySelector('[data-testid=question-reply]'), 'free text is allowed: Reply');
      assert.match(open.querySelector('[data-testid=question-prompt]').textContent, /Which format\?/);
      const done = box.querySelector('[data-shared-message=q-2] [data-testid=question-card]');
      assert.equal(done, null, 'an answered card does not repeat the prompt or show an Answered log');
      assert.doesNotMatch(box.textContent, /Which size\?|Answered/);
      await act(async () => open.querySelector('[data-testid=question-reply]').click());
      assert.ok(box.querySelector('[data-testid=composer-reply]'), 'Reply puts the composer on the question');
      await act(async () => [...open.querySelectorAll('[data-testid=question-option]')].find(button => button.textContent === 'CSV').click());
      await settle(() => own.sends.length === 1);
      assert.deepEqual([own.sends[0].text, own.sends[0].replyTo, own.sends[0].conversationId], ['CSV', 'q-1', 'main']);
      assert.ok(box.querySelector('[data-testid=composer-reply]'), 'answering with a choice leaves the composer\u2019s reply alone');
    });
  });
  await t.test('WhatsApp composer: one pill row, the microphone in Send’s place while empty, an app control at the left edge', async () => {
    const own = createFakeChannelSource(sharedChatSeed), chat = createSharedChat(own, { conversationId: 'main' });
    const box = document.createElement('div'); document.body.append(box); const mounted = createRoot(box);
    const silent = { canStart: true, phase: 'idle', seconds: 0, captureSequence: 0, problem: undefined, pending: [], start() {}, finish() {}, cancel() {} };
    const VoiceButton = ({ primary }) => createElement('button', { type: 'button', 'data-testid': 'fake-voice', 'data-primary': String(Boolean(primary)) }, 'mic');
    try {
      await act(async () => mounted.render(createElement(PiChat, { controller: chat, voiceMessage: { transcribe: async () => '', useRecorder: () => silent, Button: VoiceButton },
        composerStart: createElement('button', { type: 'button', 'data-testid': 'app-start' }, 'app'), tools: createElement('button', { type: 'button', 'data-testid': 'app-tool' }, 'tool') })));
      await settle(() => box.querySelector('[data-testid=composer]'));
      const composer = box.querySelector('[data-testid=composer]');
      assert.equal(composer.dataset.layout, 'pill');
      const start = composer.querySelector('[data-testid=composer-start]');
      assert.ok(start?.querySelector('[data-testid=app-start]'), 'composerStart renders at the left edge');
      const plus = composer.querySelector('[data-testid=composer-plus]');
      if (plus) assert.ok(start.compareDocumentPosition(plus) & 4, 'before "+"');
      assert.ok(composer.querySelector('[data-testid=app-tool]'), 'app tools stay beside Send');
      assert.equal(composer.querySelector('[data-testid=composer-submit]'), null, 'empty: no Send');
      assert.equal(composer.querySelector('[data-testid=composer-when-empty] [data-testid=fake-voice]')?.dataset.primary, 'true', 'the microphone takes Send’s place and look');
      await act(async () => chat.setText('Hello'));
      assert.ok(composer.querySelector('[data-testid=composer-submit]'), 'text brings Send back');
      assert.equal(composer.querySelector('[data-testid=fake-voice]'), null);
      await act(async () => mounted.render(createElement(PiChat, { controller: chat, composerLayout: 'card', voiceReplacesSend: false, voiceMessage: { transcribe: async () => '', useRecorder: () => silent, Button: VoiceButton } })));
      assert.equal(box.querySelector('[data-testid=composer]').dataset.layout, 'card', 'a host can keep the card composer');
      await act(async () => chat.setText(''));
      assert.ok(box.querySelector('[data-testid=fake-voice]') && box.querySelector('[data-testid=composer-submit]'), 'and the microphone beside Send');
    } finally { await act(async () => mounted.unmount()); await chat.dispose(); box.remove(); }
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
    assert.equal(q('[data-shared-message=via-me] [data-testid=user-text] .whitespace-pre-wrap')?.textContent, 'My fictional message.');
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
  await t.test('production\u2019s plain chrome: presence off, steps hidden, copy, a footer and plain answers; defaults unchanged', async () => {
    const copied = [];
    Object.defineProperty(window.navigator, 'clipboard', { configurable: true, value: { writeText: async text => { copied.push(text); } } });
    const at = '2026-10-20T12:30:00Z';
    await act(async () => source.emit({ type: 'message', message: { id: 'plain-answer', conversationId: 'main', author: 'pm', at, text: 'La réponse sourcée.', steps: [{ label: 'Lire', status: 'done' }] } }));
    const row = () => q('[data-shared-message=plain-answer]');
    assert.ok(q('[data-testid=shared-members]'), 'default: the members control');
    assert.ok(row().querySelector('[data-testid=activity]'), 'default: the steps line');
    assert.ok(row().querySelector('[data-slot=bubble]') ?? row().querySelector('[data-testid=message-time]'), 'default: a bubble with its time');
    assert.equal(row().querySelector('[data-testid=message-copy]'), null, 'default: no copy action');
    assert.equal(row().querySelector('[data-testid=message-footer]'), null, 'default: no footer');
    chatOptions = { presence: false, steps: 'hidden', answerActions: ['copy'], answerStyle: 'plain', footer: message => createElement('span', { 'data-testid': 'generated' }, `Généré ${message.id}`) };
    await render();
    assert.equal(q('[data-testid=shared-members]'), null, 'presence off: no members control');
    assert.equal(q('[data-testid=message-avatar]'), null, 'presence off: no avatars');
    assert.equal(q('[data-testid=message-author]'), null, 'presence off: no author lines');
    assert.equal(row().querySelector('[data-testid=activity]'), null, 'steps hidden');
    assert.ok(row().querySelector('[data-testid=plain-answer]'), 'a plain answer');
    assert.equal(row().querySelector('[data-testid=message-time]'), null);
    assert.equal(row().querySelector('[data-testid=generated]').textContent, 'Généré plain-answer');
    const copy = row().querySelector('[data-testid=message-copy]');
    assert.equal(copy.textContent, defaultLabels().copyResponse);
    await act(async () => copy.click());
    assert.deepEqual(copied, ['La réponse sourcée.']);
    assert.equal(q('[data-testid=own-message]') === null, false, 'questions keep their bubble');
    chatOptions = {}; await render();
    assert.ok(q('[data-testid=shared-members]'), 'back to the defaults');
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
