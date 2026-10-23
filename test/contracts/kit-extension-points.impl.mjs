// Run by kit-extension-points.test.mjs in its own process. The kit's extension points, driven through the real blocks: the multi-question ask_user form and its `skipped` label (EN, FR),
// the question card on its own (a host popover), artifact kinds (label, icon and renderer, without editing artifact.ts), the CSV table,
// and the `belowComposer` slot (the `boring-ui-blocks` command: test/packages/ui-blocks-check.test.mjs). Fictional data only.
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('../../', import.meta.url));
const out = join(root, '.cache/kit-extension-points-test');
mkdirSync(out, { recursive: true });
async function load(name, contents) {
  writeFileSync(join(out, `${name}-entry.tsx`), contents);
  await build({ entryPoints: [join(out, `${name}-entry.tsx`)], outfile: join(out, `${name}.mjs`), bundle: true, format: 'esm', platform: 'node', jsx: 'automatic', packages: 'external', logLevel: 'silent' });
  return import(pathToFileURL(join(out, `${name}.mjs`)).href);
}
const kit = await load('pi-chat', `export * from '${root}registry/pi-chat/pi-chat.tsx'; export { ArtifactPanel } from '${root}registry/pi-app/artifact-panel.tsx'; export { markdownText } from '${root}registry/pi-chat-markdown/markdown.tsx';`);

const DOM = ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Text', 'Event', 'addEventListener', 'removeEventListener', 'MutationObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'IS_REACT_ACT_ENVIRONMENT', 'ResizeObserver', 'localStorage', 'sessionStorage'];
async function dom(t) {
  const { Window } = await import('happy-dom');
  const window = new Window({ url: 'https://fictional.invalid/', settings: { disableIframePageLoading: true } });
  const globals = new Map(DOM.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  for (const name of DOM) {
    const value = name === 'window' ? window : name === 'IS_REACT_ACT_ENVIRONMENT' ? true : name === 'ResizeObserver' ? class { observe() {} unobserve() {} disconnect() {} } : window[name];
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: typeof value === 'function' && /^[a-z]/.test(name) ? value.bind(window) : value });
  }
  const { act, createElement } = await import('react');
  const { createRoot } = await import('react-dom/client');
  const container = document.createElement('div'); document.body.append(container);
  const ui = createRoot(container);
  t.after(async () => {
    await act(async () => ui.unmount()); container.remove();
    await window.happyDOM.close();
    for (const [name, descriptor] of globals) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; }
  });
  return { window, act, container, render: async element => act(async () => ui.render(element)), h: createElement };
}

/** The real PiChat over a native controller; `write` appends a model message to the conversation. */
async function chat(t, props = {}, Component = kit.PiChat, model) {
  const page = await dom(t);
  const { Harness, MemoryStorage, createRegistry } = await import('@earendil-works/pi-durable');
  const { BACKGROUND_CONTEXT: context } = await import('@earendil-works/chord/context');
  const { createNativeChatController } = await import('@hachej/boring-ui-kit/native-chat');
  const { createFakeChatModel } = await import('@hachej/boring-testing/model');
  const fake = model ?? createFakeChatModel();
  const native = await Harness.open(new MemoryStorage(), { registry: createRegistry(), models: fake.models }, context);
  const conversation = await native.createConversation({ ownership: { kind: 'ownerless' }, agent: { model: fake.model } }, context);
  const controller = createNativeChatController({ identity: { runtimeId: 'fixture', scopeId: 'fixture', principalId: 'person' }, context, conversation });
  await controller.connect();
  t.after(async () => { await controller.dispose(); await native.close(context); });
  const all = { controller, historyList: false, showHistory: false, ...props };
  await page.render(page.h(Component, all));
  return { ...page, controller, rerender: async next => { Object.assign(all, next); await page.render(page.h(Component, all)); },
    write: async model => {
      await page.act(async () => { await conversation.submit({ type: 'write', entry: { kind: 'message', model } }, context); });
      await page.act(async () => new Promise(resolve => setTimeout(resolve, 30)));
    } };
}

const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
const assistant = content => ({ role: 'assistant', content, api: 'fixture', provider: 'fixture', model: 'fixture', usage, stopReason: 'toolUse', timestamp: 1 });
const call = (id, name, args) => ({ type: 'toolCall', id, name, arguments: args });
const FORM = { question: 'A few details for the picnic', questions: [
  { question: 'Where do we meet?', options: ['Park', 'Lake'] }, { question: 'How many people?' }, { question: 'Anything to avoid?', options: ['Nuts', 'Gluten'] }] };

async function answerForm(page, input = 'Twelve') {
  const { container, act, window } = page;
  const items = [...container.querySelectorAll('[data-testid=question-item]')];
  assert.equal(items.length, 3, 'one form, one fieldset per question');
  assert.equal(container.querySelectorAll('[data-testid=question-form]').length, 1);
  assert.equal(container.querySelectorAll('[data-testid=question-input]').length, 3, 'each question has a free-text field');
  await act(async () => items[0].querySelector('[data-option=Lake]').click());
  const field = items[1].querySelector('[data-testid=question-input]');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  await act(async () => { setter.call(field, input); field.dispatchEvent(new window.Event('input', { bubbles: true })); });
  await act(async () => container.querySelector('[data-testid=question-submit]').click());
}

test('ask_user with questions is one form; Answer sends one text, a blank question as `skipped`', async t => {
  const sent = [];
  const page = await chat(t, { actions: { answer: async (id, text) => { sent.push(text); return { kind: 'answered' }; } } });
  await page.write([assistant([call('form-1', 'ask_user', FORM)])]);
  assert.equal(page.container.querySelector('[data-testid=question-text]').textContent, FORM.question);
  await answerForm(page);
  assert.deepEqual(sent, ['1. Where do we meet?\n→ Lake\n\n2. How many people?\n→ Twelve\n\n3. Anything to avoid?\n→ (no answer)']);
  const card = page.container.querySelector('[data-testid=question-card]');
  assert.equal(card.dataset.state, 'sent');
  assert.deepEqual([...card.querySelectorAll('[data-testid=question-answer-item]')].map(item => item.textContent), ['Where do we meet?Lake', 'How many people?Twelve', 'Anything to avoid?(no answer)'], 'every answer is listed under its question');
  assert.deepEqual([...card.querySelectorAll('[data-testid=question-answer]')].map(answer => answer.dataset.skipped ?? ''), ['', '', 'true'], 'only the blank question is marked skipped');
});

test('the form speaks French with locale="fr": a skipped question is « (pas de réponse) »', async t => {
  const sent = [];
  const page = await chat(t, { locale: 'fr', actions: { answer: async (id, text) => { sent.push(text); return { kind: 'answered' }; } } });
  await page.write([assistant([call('form-2', 'ask_user', FORM)])]);
  await answerForm(page, 'Douze');
  assert.equal(kit.frenchChatLabels.skipped, '(pas de réponse)');
  assert.equal(kit.defaultChatLabels.skipped, '(no answer)');
  assert.match(sent[0], /3\. Anything to avoid\?\n→ \(pas de réponse\)$/);
});

test('the question card stands alone (a host popover): free text by default, none when allowFreeText is false', async t => {
  const page = await dom(t);
  const sent = [];
  const card = args => page.h(kit.ChatTextProvider, { value: kit.chatTextFor('fr') }, page.h(kit.QuestionCard, {
    call: { type: 'toolCall', id: 'req-1', name: kit.ASK_USER_TOOL, arguments: args }, result: undefined, questionId: 'req-1',
    answer: async (id, text) => { sent.push([id, text]); return { kind: 'answered' }; } }));
  await page.render(card({ question: 'D-12 · Which day?', options: ['Monday', 'Friday'] }));
  assert.ok(page.container.querySelector('[data-testid=question-input]'), 'options alone still take free text');
  assert.equal(page.container.querySelector('[data-testid=question-input]').getAttribute('placeholder'), 'Ou écrivez votre propre réponse');
  await page.act(async () => page.container.querySelector('[data-option=Friday]').click());
  assert.deepEqual(sent, [['req-1', 'Friday']]);
  await page.render(page.h('div'));
  await page.render(card({ question: 'Strict?', options: ['Yes', 'No'], allowFreeText: false }));
  assert.equal(page.container.querySelector('[data-testid=question-input]'), null);
});

const answeredResult = (id, answer) => ({ role: 'toolResult', toolCallId: id, toolName: 'ask_user', isError: false, content: [{ type: 'text', text: JSON.stringify({ kind: 'answered', answer }) }], timestamp: 2 });
const OWNER_QUESTION = 'Pour la première version, sans accès automatique aux plateformes pour l’instant, quel périmètre valides-tu ?';
const OWNER_ANSWER = 'Attendre les accès pour inclure la découverte automatique dès la première version';

test('an answered question is a quiet recap: the answer outweighs the question, one answered signal, no badge', async t => {
  const page = await chat(t, { locale: 'fr' });
  await page.write([assistant([call('owner-1', 'ask_user', { question: OWNER_QUESTION, options: ['Commencer sans', OWNER_ANSWER] })]), answeredResult('owner-1', OWNER_ANSWER)]);
  const card = page.container.querySelector('[data-testid=question-card]');
  assert.equal(card.dataset.state, 'answered');
  const question = card.querySelector('[data-testid=question-text]'), answer = card.querySelector('[data-testid=question-answer]');
  assert.equal(question.textContent, OWNER_QUESTION);
  assert.equal(answer.textContent, OWNER_ANSWER);
  assert.equal(question.closest('[data-slot]').dataset.slot, 'item-description', 'the question is the muted description');
  assert.equal(answer.closest('[data-slot]').dataset.slot, 'item-title', 'the answer is the title');
  assert.equal(card.dataset.slot, 'item', 'a stock Item');
  assert.equal(card.querySelector('[data-slot=item-media] svg')?.getAttribute('aria-label'), 'Répondu');
  assert.equal(card.querySelectorAll('svg').length, 1, 'one answered signal');
  assert.equal(card.querySelector('svg').getAttribute('aria-label'), 'Répondu');
  assert.equal(card.querySelector('[data-slot=badge]'), null, 'no pill');
  assert.equal(card.querySelectorAll('button, input').length, 0, 'nothing left to act on');
});

test('an answered form lists every answer tightly, the skipped one discreetly', async t => {
  const page = await chat(t);
  await page.write([assistant([call('form-3', 'ask_user', FORM)]), answeredResult('form-3', '1. Where do we meet?\n→ Park\n\n2. How many people?\n→ (no answer)\n\n3. Anything to avoid?\n→ Nuts')]);
  const card = page.container.querySelector('[data-testid=question-card][data-state=answered]');
  assert.deepEqual([...card.querySelectorAll('[data-testid=question-answer]')].map(answer => answer.textContent), ['Park', '(no answer)', 'Nuts']);
  const skipped = card.querySelector('[data-testid=question-answer][data-skipped=true]');
  assert.equal(skipped.textContent, '(no answer)');
  assert.equal(skipped.dataset.slot, 'item-description', 'a skipped question is a description, quieter than an answer');
  assert.deepEqual([...card.querySelectorAll('[data-testid=question-answer]:not([data-skipped])')].map(answer => answer.dataset.slot), ['item-title', 'item-title']);
  assert.equal(card.querySelectorAll('svg').length, 1, 'one answered signal for the whole form');
});

const maquette = { schema: 'boring.artifact', version: 1, title: 'Onboarding', type: 'code', mediaType: 'application/json', language: 'json',
  target: { resource: { providerId: 'workspace', path: 'flows/onboarding.maquette.json' }, view: { kind: 'published' } }, revision: 'rev-1' };
const presented = (id, artifact) => [assistant([call(id, 'present', { path: artifact.target.resource.path })]),
  { role: 'toolResult', toolCallId: id, toolName: 'present', content: [{ type: 'text', text: JSON.stringify({ artifact }) }], isError: false, timestamp: 2 }];

for (const [locale, names] of [['en', ['Document', 'HTML page', 'SVG image', 'Code · json', 'Canvas']], ['fr', ['Document', 'Page HTML', 'Image SVG', 'Code · json', 'Canevas']]]) {
  test(`artifact cards use ${locale} type labels, a media square and no action text`, async t => {
    const opened = [];
    const page = await chat(t, { locale, artifacts: { open: artifact => opened.push(artifact) } });
    const artifacts = ['markdown', 'html', 'svg', 'code', 'canvas'].map(type => ({ ...maquette, type, title: `Fictional ${type} guide`, ordinal: 3,
      target: { ...maquette.target, resource: { providerId: 'workspace', path: `guides/${type}.txt` } } }));
    await page.write(artifacts.flatMap((artifact, at) => presented(`show-${at}`, artifact)));
    const cards = [...page.container.querySelectorAll('[data-testid=artifact-card]')];
    assert.deepEqual(cards.map(card => card.querySelector('[data-testid=artifact-type]').textContent), names);
    for (const [at, card] of cards.entries()) {
      assert.equal(card.querySelector('[data-testid=artifact-title]').textContent, artifacts[at].title);
      assert.equal(card.querySelector('[data-testid=artifact-version]').textContent, 'Version 3');
      assert.equal(card.getAttribute('aria-label'), `${locale === 'fr' ? 'Ouvrir' : 'Open'} ${artifacts[at].title}, version 3`);
      assert.equal(card.getAttribute('aria-pressed'), 'false');
      assert.doesNotMatch(card.textContent, /Open|Ouvrir/);
      assert.equal(card.querySelector('[data-testid=artifact-hint]'), null, 'no duplicate action hint');
      assert.ok(card.querySelector('[data-slot=item-media][data-variant=image] [data-slot=item][data-variant=muted] svg[aria-hidden=true]'), 'the icon sits in stock tinted square media');
      assert.equal(card.querySelectorAll('svg').length, 2, 'type icon and one action cue');
      assert.ok(card.querySelector('svg.lucide-chevron-right[aria-hidden=true]'));
      assert.equal(card.querySelector('svg.lucide-check'), null);
    }
    await page.act(async () => cards[1].click());
    assert.deepEqual(opened, [artifacts[1]], 'clicking the card sends the exact descriptor to the host');
  });
}

test('an open artifact has a check and pressed state; a disabled card has no action and unversioned names stay concise', async t => {
  const opened = [];
  const artifact = { ...maquette, title: 'Fictional HTML guide', type: 'html', ordinal: 2 };
  const page = await chat(t, { artifacts: { open: artifact => opened.push(artifact), isOpen: () => true } });
  await page.write(presented('show-open', artifact));
  const card = () => page.container.querySelector('[data-testid=artifact-card]');
  assert.equal(card().getAttribute('aria-pressed'), 'true');
  assert.equal(card().dataset.open, 'true');
  assert.equal(card().getAttribute('aria-label'), 'Open Fictional HTML guide, version 2');
  assert.ok(card().querySelector('svg.lucide-check[aria-hidden=true]'));
  assert.equal(card().querySelector('svg.lucide-chevron-right'), null);
  assert.doesNotMatch(card().textContent, /Open|Ouvrir/);
  assert.ok(card().classList.contains('bg-secondary'), 'the open card uses the host secondary variant');
  await page.act(async () => card().click());
  assert.deepEqual(opened, [artifact]);
  await page.rerender({ artifacts: { open: artifact => opened.push(artifact), isOpen: () => false } });
  assert.equal(card().getAttribute('aria-pressed'), 'false');
  assert.equal(card().hasAttribute('data-open'), false);
  assert.ok(card().querySelector('svg.lucide-chevron-right'));
  assert.equal(card().querySelector('svg.lucide-check'), null);
  await page.rerender({ artifacts: {} });
  assert.equal(card().disabled, true);
  assert.equal(card().hasAttribute('aria-pressed'), false);
  await page.act(async () => card().click());
  assert.equal(opened.length, 1, 'a card without a host action cannot open');
  await page.write(presented('show-unversioned', { ...artifact, ordinal: undefined }));
  assert.equal(card().querySelector('[data-testid=artifact-version]'), null);
  assert.equal(card().getAttribute('aria-label'), 'Open Fictional HTML guide');
});

test('artifact type labels accept host wording while a matching kind still wins', async t => {
  const page = await chat(t, { locale: 'fr', labels: { artifactTypes: { ...kit.frenchChatLabels.artifactTypes, code: 'Extrait' } }, artifacts: { open: () => {} } });
  await page.write(presented('show-custom-word', maquette));
  assert.equal(page.container.querySelector('[data-testid=artifact-type]').textContent, 'Extrait · json');
  await page.rerender({ artifacts: { open: () => {}, kinds: [{ match: () => true, label: 'Maquette' }] } });
  assert.equal(page.container.querySelector('[data-testid=artifact-type]').textContent, 'Maquette');
});

test('a running present remains a French noninteractive busy card until its native result arrives', { timeout: 10000 }, async t => {
  const { createScriptedModel } = await import('@hachej/boring-testing/model');
  const model = createScriptedModel({ script: { 'Prepare a fictional guide': [{ tools: [{ name: 'present', args: { path: 'guides/guide.html' } }], hold: 60000 }] } });
  const page = await chat(t, { locale: 'fr', artifacts: { open: () => assert.fail('a pending card cannot open') } }, kit.PiChat, model);
  await page.act(async () => { page.controller.setText('Prepare a fictional guide'); await page.controller.send(); });
  const card = () => page.container.querySelector('[data-testid=artifact-card][data-state=presenting]');
  for (let at = 0; at < 100 && !card(); at++) await page.act(async () => new Promise(resolve => setTimeout(resolve, 10)));
  assert.ok(card());
  assert.equal(card().getAttribute('role'), 'status');
  assert.equal(card().getAttribute('aria-busy'), 'true');
  assert.equal(card().querySelector('[data-testid=artifact-title]').textContent, 'guide.html');
  assert.match(card().textContent, /Ouverture…/);
  assert.equal(card().querySelector('button'), null);
  assert.equal(card().tagName, 'DIV');
  assert.equal(card().hasAttribute('aria-pressed'), false);
});

test('an artifact kind names and draws an app file type without editing artifact.ts', async t => {
  const page = await chat(t, { artifacts: { open: () => {} } });
  await page.write(presented('show-1', maquette));
  assert.equal(page.container.querySelector('[data-testid=artifact-type]').textContent, 'Code · json', 'without a kind, the built-in type name');
  const Icon = props => page.h('svg', { ...props, 'data-testid': 'maquette-icon' });
  const kinds = [{ match: target => target.resource.path.endsWith('.maquette.json'), label: 'Maquette', icon: Icon,
    renderer: ({ artifact, text }) => page.h('div', { 'data-testid': 'maquette-view' }, `${artifact.title}: ${JSON.parse(text).screens.length} screens`) }];
  await page.rerender({ artifacts: { open: () => {}, kinds } });
  const card = page.container.querySelector('[data-testid=artifact-card]');
  assert.equal(card.querySelector('[data-testid=artifact-type]').textContent, 'Maquette');
  assert.equal(card.getAttribute('data-artifact-kind'), 'Maquette');
  assert.ok(card.querySelector('[data-testid=maquette-icon]'), 'the kind icon replaces the type icon');
  assert.equal(kit.typeLabel(maquette, kinds), 'Maquette');
  assert.equal(kit.typeLabel(maquette, [{ match: () => { throw new Error('faulty'); }, label: 'Never' }]), 'Code · json', 'a throwing match is no match');

  // The same kinds draw the file in the artifact panel, at the card's revision, inside the standard viewer bar.
  const bytes = new TextEncoder().encode(JSON.stringify({ screens: [{}, {}, {}] }));
  const client = { read: async () => ({ kind: 'available', snapshot: { bytes, ref: { revision: 'rev-1', providerId: 'workspace', path: maquette.target.resource.path } } }), saves: async () => [], search: async () => [] };
  const shown = [];
  await page.render(page.h(kit.ArtifactPanel, { active: { descriptor: maquette, follow: false }, versions: [maquette], options: { client, identity: { runtimeId: 'fixture' }, kinds, onShown: report => shown.push(report) }, onSelect: () => {}, onClose: () => {} }));
  for (let i = 0; i < 10; i++) await page.act(async () => new Promise(resolve => setTimeout(resolve, 5)));
  assert.equal(page.container.querySelector('[data-testid=maquette-view]')?.textContent, 'Onboarding: 3 screens');
  assert.equal(page.container.querySelector('[data-testid=artifact-panel-type]').textContent, 'Maquette');
  assert.deepEqual(shown[0], { path: maquette.target.resource.path, revision: 'rev-1' }, 'a kind renderer confirms the presented revision like a built-in viewer');
});

test('the artifact panel uses the surrounding chat language for built-in types', async t => {
  const page = await dom(t);
  const artifact = { ...maquette, type: 'html', mediaType: 'text/html', target: { ...maquette.target, resource: { providerId: 'workspace', path: 'guide.html' } } };
  const bytes = new TextEncoder().encode('<p>A fictional guide.</p>');
  const client = { read: async () => ({ kind: 'available', snapshot: { bytes, ref: { revision: 'rev-1', providerId: 'workspace', path: 'guide.html' } } }), saves: async () => [], search: async () => [] };
  await page.render(page.h(kit.ChatTextProvider, { value: kit.chatTextFor('fr') }, page.h(kit.ArtifactPanel, { active: { descriptor: artifact, follow: false }, versions: [artifact], options: { client, identity: { runtimeId: 'fixture' } }, onSelect: () => {}, onClose: () => {} })));
  for (let i = 0; i < 10; i++) await page.act(async () => new Promise(resolve => setTimeout(resolve, 5)));
  assert.equal(page.container.querySelector('[data-testid=artifact-panel-type]').textContent, 'Page HTML');
});

test('a CSV artifact opens as a table', async t => {
  const page = await dom(t);
  const csv = { ...maquette, title: 'Guests', mediaType: 'text/csv', language: 'csv', target: { ...maquette.target, resource: { providerId: 'workspace', path: 'guests.csv' } } };
  const bytes = new TextEncoder().encode('name;diet\n"Ana, Jr";none\nBo;"no ""nuts"""\n');
  const client = { read: async () => ({ kind: 'available', snapshot: { bytes, ref: { revision: 'rev-1', providerId: 'workspace', path: 'guests.csv' } } }), saves: async () => [], search: async () => [] };
  await page.render(page.h(kit.ArtifactPanel, { active: { descriptor: csv, follow: false }, versions: [csv], options: { client, identity: { runtimeId: 'fixture' } }, onSelect: () => {}, onClose: () => {} }));
  for (let i = 0; i < 10; i++) await page.act(async () => new Promise(resolve => setTimeout(resolve, 5)));
  const table = page.container.querySelector('[data-testid=artifact-csv]');
  assert.ok(table, 'a table, not code');
  assert.deepEqual([...table.querySelectorAll('th')].map(cell => cell.textContent), ['name', 'diet']);
  assert.deepEqual([...table.querySelectorAll('tbody tr')].map(row => [...row.querySelectorAll('td')].map(cell => cell.textContent)), [['Ana, Jr', 'none'], ['Bo', 'no "nuts"']]);
});

test('belowComposer renders host content under the PiChat composer', async t => {
  const tray = page => page.h('p', { 'data-testid': 'requests-tray' }, '2 requests');
  const page = await chat(t);
  assert.equal(page.container.querySelector('[data-testid=below-composer]'), null, 'nothing without the slot');
  await page.rerender({ belowComposer: tray(page) });
  const slot = page.container.querySelector('[data-testid=below-composer]');
  assert.equal(slot.textContent, '2 requests');
  assert.ok(page.container.querySelector('[data-testid=composer-dock]').contains(slot));
  assert.ok(page.container.querySelector('[data-testid=composer-input]').compareDocumentPosition(slot) & 4, 'under the composer');
});

test('the run card follows a headless run: title, status badge, spinner and elapsed time, then duration and output as Markdown, or the error', async t => {
  const page = await dom(t);
  const states = [{ id: 'run-7', status: 'running', agent: 'Fictional planner', startedAt: 1_000 },
    { id: 'run-7', status: 'completed', agent: 'Fictional planner', startedAt: 1_000, finishedAt: 66_000, text: '**Plan** ready' }];
  const fetched = [];
  // The first poll still runs; later polls see it completed.
  const fetchRun = async id => { fetched.push(id); return states[Math.min(fetched.length - 1, states.length - 1)]; };
  await page.render(page.h(kit.RunCard, { run: { id: 'run-7', status: 'queued', agent: 'Fictional planner', startedAt: 1_000 }, fetchRun, pollMs: 60, now: () => 43_000, renderText: kit.markdownText }));
  const card = () => page.container.querySelector('[data-testid=run-card]');
  assert.equal(card().getAttribute('aria-label'), 'Fictional planner');
  assert.ok(page.container.querySelector('[data-testid=run-spinner]'), 'a spinner while queued or running');
  assert.equal(page.container.querySelector('[data-testid=run-time]').textContent, 'Running for 42 s');
  for (let i = 0; i < 20 && card().dataset.state !== 'completed'; i++) await page.act(async () => new Promise(resolve => setTimeout(resolve, 20)));
  assert.equal(card().dataset.state, 'completed');
  assert.equal(page.container.querySelector('[data-testid=run-status]').textContent, 'Completed');
  assert.equal(page.container.querySelector('[data-testid=run-spinner]'), null);
  assert.equal(page.container.querySelector('[data-testid=run-time]').textContent, 'Took 1 min 5 s');
  assert.equal(page.container.querySelector('[data-testid=run-output] strong')?.textContent, 'Plan', 'text renders as Markdown through the pi-chat-markdown renderer');
  const polls = fetched.length;
  await page.act(async () => new Promise(resolve => setTimeout(resolve, 80)));
  assert.equal(fetched.length, polls, 'a settled run is not polled');

  await page.render(page.h(kit.ChatTextProvider, { value: kit.chatTextFor('fr') }, page.h(kit.RunCard, { run: kit.parseRun({ id: 'run-8', status: 'failed', error: 'Quota dépassé', output: { rows: 2 } }) })));
  assert.equal(page.container.querySelector('[data-testid=run-status]').textContent, 'Échouée');
  assert.equal(page.container.querySelector('[data-testid=run-error]').textContent, 'Quota dépassé');
  assert.match(page.container.querySelector('[data-testid=run-output]').textContent, /"rows": 2/, 'structured output as JSON');
  assert.equal(kit.parseRun({ id: 'x', status: 'paused' }), undefined, 'an unknown status is refused');
});
