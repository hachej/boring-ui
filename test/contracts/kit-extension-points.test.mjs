// The kit's extension points, driven through the real blocks: the multi-question ask_user form and its `skipped` label (EN, FR),
// the question card on its own (a host popover), artifact kinds (label, icon and renderer, without editing artifact.ts), the CSV table,
// the `belowComposer` slot, and the `boring-ui-blocks` drift check and update command. Fictional data only.
import assert from 'node:assert/strict';
import test from 'node:test';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
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
const kit = await load('pi-chat', `export * from '${root}registry/pi-chat/pi-chat.tsx'; export { ArtifactPanel } from '${root}registry/pi-app/artifact-panel.tsx';`);

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
async function chat(t, props = {}, Component = kit.PiChat) {
  const page = await dom(t);
  const { Harness, MemoryStorage, createRegistry } = await import('@earendil-works/pi-durable');
  const { BACKGROUND_CONTEXT: context } = await import('@earendil-works/chord/context');
  const { createNativeChatController } = await import('@hachej/boring-ui-kit/native-chat');
  const { createFakeChatModel } = await import('@hachej/boring-testing/model');
  const fake = createFakeChatModel();
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
  assert.match(page.container.querySelector('[data-testid=question-answer]').textContent, /→ Lake/);
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

const maquette = { schema: 'boring.artifact', version: 1, title: 'Onboarding', type: 'code', mediaType: 'application/json', language: 'json',
  target: { resource: { providerId: 'workspace', path: 'flows/onboarding.maquette.json' }, view: { kind: 'published' } }, revision: 'rev-1' };
const presented = (id, artifact) => [assistant([call(id, 'present', { path: artifact.target.resource.path })]),
  { role: 'toolResult', toolCallId: id, toolName: 'present', content: [{ type: 'text', text: JSON.stringify({ artifact }) }], isError: false, timestamp: 2 }];

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

const bin = join(root, 'packages/ui/bin/boring-ui-blocks.mjs');
const runBin = (app, ...args) => spawnSync(process.execPath, [bin, ...args], { cwd: app, encoding: 'utf8' });

test('boring-ui-blocks check lists an edited block file; update reinstalls every installed block at the pinned CLI', t => {
  const app = mkdtempSync(join(tmpdir(), 'kit-blocks-'));
  t.after(() => rmSync(app, { recursive: true, force: true }));
  // An app with the kit installed (its registry items in r/) and pi-chat copied as `shadcn add` writes it.
  const kitDir = join(app, 'node_modules/@hachej/boring-ui-kit');
  mkdirSync(kitDir, { recursive: true });
  cpSync(join(root, 'public/r'), join(kitDir, 'r'), { recursive: true });
  writeFileSync(join(kitDir, 'package.json'), JSON.stringify({ name: '@hachej/boring-ui-kit', version: '9.9.9' }));
  const item = JSON.parse(readFileSync(join(root, 'public/r/pi-chat.json'), 'utf8'));
  for (const file of item.files) {
    const path = join(app, 'src', file.target);
    mkdirSync(join(path, '..'), { recursive: true });
    // The CLI drops 'use client' in a non-RSC app; that is not an edit.
    writeFileSync(path, file.content.replace(/^'use client';\n\n?/, ''));
  }
  const clean = runBin(app, 'check');
  assert.equal(clean.status, 0, clean.stdout + clean.stderr);
  assert.match(clean.stdout, /1 block\(s\) match @hachej\/boring-ui-kit@9\.9\.9: pi-chat/);

  const edited = join(app, 'src/components/pi-chat/artifact.ts');
  writeFileSync(edited, readFileSync(edited, 'utf8').replace("svg: 'SVG image'", "svg: 'SVG image', maquette: 'Maquette'"));
  const drift = runBin(app, 'check');
  assert.equal(drift.status, 1);
  assert.match(drift.stdout, new RegExp(`edited  pi-chat  ${edited.replaceAll('/', '\\/')}`));
  assert.equal(drift.stdout.match(/^edited/gm).length, 1, 'only the edited file is listed');

  const update = runBin(app, 'update', '--version', '9.9.10', '--dry-run');
  assert.equal(update.status, 0, update.stdout + update.stderr);
  assert.equal(update.stdout.trim(), 'npx -y shadcn@4.21.5 add https://cdn.jsdelivr.net/npm/@hachej/boring-ui-kit@9.9.10/r/pi-chat.json --overwrite --yes');
  const architecture = JSON.parse(readFileSync(join(root, 'ARCHITECTURE.json'), 'utf8'));
  assert.equal(architecture.sourceDistribution.format, 'shadcn@4.21.5', 'the command pins the CLI the registry is built for');
  const manifest = JSON.parse(readFileSync(join(root, 'packages/ui/package.json'), 'utf8'));
  assert.equal(manifest.bin['boring-ui-blocks'], './bin/boring-ui-blocks.mjs', 'shipped as the kit\'s bin');
});

test('the run card follows a headless run: title, status badge, spinner and elapsed time, then duration and output as Markdown, or the error', async t => {
  const page = await dom(t);
  const states = [{ id: 'run-7', status: 'running', agent: 'Fictional planner', startedAt: 1_000 },
    { id: 'run-7', status: 'completed', agent: 'Fictional planner', startedAt: 1_000, finishedAt: 66_000, text: '**Plan** ready' }];
  const fetched = [];
  const fetchRun = async id => { fetched.push(id); return states[Math.min(fetched.length, states.length - 1)]; };
  await page.render(page.h(kit.RunCard, { run: { id: 'run-7', status: 'queued', agent: 'Fictional planner', startedAt: 1_000 }, fetchRun, pollMs: 20, now: () => 43_000 }));
  const card = () => page.container.querySelector('[data-testid=run-card]');
  assert.equal(card().getAttribute('aria-label'), 'Fictional planner');
  assert.ok(page.container.querySelector('[data-testid=run-spinner]'), 'a spinner while queued or running');
  assert.equal(page.container.querySelector('[data-testid=run-time]').textContent, 'Running for 42 s');
  for (let i = 0; i < 20 && card().dataset.state !== 'completed'; i++) await page.act(async () => new Promise(resolve => setTimeout(resolve, 20)));
  assert.equal(card().dataset.state, 'completed');
  assert.equal(page.container.querySelector('[data-testid=run-status]').textContent, 'Completed');
  assert.equal(page.container.querySelector('[data-testid=run-spinner]'), null);
  assert.equal(page.container.querySelector('[data-testid=run-time]').textContent, 'Took 1 min 5 s');
  assert.equal(page.container.querySelector('[data-testid=run-output] strong')?.textContent, 'Plan', 'text renders as Markdown');
  const polls = fetched.length;
  await page.act(async () => new Promise(resolve => setTimeout(resolve, 80)));
  assert.equal(fetched.length, polls, 'a settled run is not polled');

  await page.render(page.h(kit.ChatTextProvider, { value: kit.chatTextFor('fr') }, page.h(kit.RunCard, { run: kit.parseRun({ id: 'run-8', status: 'failed', error: 'Quota dépassé', output: { rows: 2 } }) })));
  assert.equal(page.container.querySelector('[data-testid=run-status]').textContent, 'Échouée');
  assert.equal(page.container.querySelector('[data-testid=run-error]').textContent, 'Quota dépassé');
  assert.match(page.container.querySelector('[data-testid=run-output]').textContent, /"rows": 2/, 'structured output as JSON');
  assert.equal(kit.parseRun({ id: 'x', status: 'paused' }), undefined, 'an unknown status is refused');
});
