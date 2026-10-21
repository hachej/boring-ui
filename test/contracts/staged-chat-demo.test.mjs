import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { Window } from 'happy-dom';
import { demoLabels } from '../../examples/staged-chat/presentation.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const source = process.env.STAGED_DEMO_ROOT ?? root;
const out = `${root}.cache/staged-chat-demo-test`;
mkdirSync(out, { recursive: true });
await build({ entryPoints: [`${source}/examples/staged-chat/page.jsx`], outfile: `${out}/page.mjs`, bundle: true, format: 'esm', platform: 'node', jsx: 'automatic', packages: 'external', alias: { '@': `${root}examples/app-shell` }, logLevel: 'silent', plugins: [{ name: 'borrowed-demo-controllers', setup(builder) {
  builder.onResolve({ filter: /^@hachej\/boring-ui-kit\/(native-chat|remote-chat)$/ }, args => ({ path: args.path, namespace: 'demo-controllers' }));
  builder.onLoad({ filter: /.*/, namespace: 'demo-controllers' }, () => ({ contents: `export const createNativeChatController = options => globalThis.__DEMO_CONTROLLERS__[options.identity.scopeId]; export const createRemoteChat = async () => ({ close: async () => {} });`, loader: 'js' }));
  builder.onResolve({ filter: /^react-dom\/client$/ }, args => args.namespace === 'demo-root' ? { path: args.path, external: true } : { path: 'root', namespace: 'demo-root' });
  builder.onLoad({ filter: /.*/, namespace: 'demo-root' }, () => ({ contents: `import { createRoot as create } from 'react-dom/client'; export const createRoot = element => { const root = create(element); globalThis.__DEMO_ROOTS__.push(root); return root; };`, loader: 'js' }));
} }] });
const assistant = (text, durationMs = 0, stopReason = 'stop') => ({ role: 'assistant', content: text ? [{ type: 'text', text }] : [], api: 'fictional', provider: 'fictional', model: 'fictional', usage: {}, stopReason, timestamp: 1, durationMs });
const entry = (id, model) => ({ id, kind: 'message', byTaskId: 100, model: [model] });
const user = id => entry(id, { role: 'user', content: 'Quelle dose pour un adulte ?', timestamp: 0 });
const stage = (id, taskId, number, state) => ({ id, kind: 'fictional.triage.stage', data: { taskId, stage: number, state } });
function controller(name, entries) {
  let snapshot = { identity: { runtimeId: 'fictional', scopeId: name, principalId: 'fictional-reader' }, conversationId: name, connection: { kind: 'connected' }, view: { entries, docs: {} }, draft: { text: '', attachments: [], version: 0 }, outbox: [], history: { kind: 'disabled' }, send: { kind: 'idle' }, stop: 'idle', disposed: false };
  const listeners = new Set(), sent = [];
  const publish = change => { snapshot = { ...snapshot, ...change }; for (const listener of listeners) listener(); };
  return { getSnapshot: () => snapshot, subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); }, publish, sent,
    setText: text => publish({ draft: { ...snapshot.draft, text, version: snapshot.draft.version + 1 } }), setAttachments() {}, connect: async () => {}, send: async (_kind, options) => { sent.push(options); }, stop: async () => {}, dispose: async () => {}, clearHistory() {}, loadEarlier: async () => {}, reconcile: async () => {}, retrySameRequest: async () => {} };
}
async function fixture(t, entries, locale = 'fr') {
  const window = new Window({ url: `https://fictional.invalid/?lang=${locale}` });
  window.document.body.innerHTML = '<div id="root"></div>';
  const names = ['window', 'document', 'location', 'navigator', 'HTMLElement', 'Element', 'Node', 'Text', 'MutationObserver', 'ResizeObserver', 'IntersectionObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'addEventListener', 'removeEventListener', 'fetch', 'IS_REACT_ACT_ENVIRONMENT', '__DEMO_CONTROLLERS__', '__DEMO_ROOTS__'];
  const globals = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const controllers = { Questions: controller('Questions', entries), Senior: controller('Senior', [user(1), entry(2, assistant('Ancienne note.'))]) }, roots = [];
  const values = { window, fetch: async () => ({ ok: true, json: async () => ({ seen: [], offers: 1 }) }), IS_REACT_ACT_ENVIRONMENT: true, __DEMO_CONTROLLERS__: controllers, __DEMO_ROOTS__: roots };
  for (const name of names) { const value = Object.hasOwn(values, name) ? values[name] : window[name]; Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: typeof value === 'function' && /^[a-z]/.test(name) ? value.bind(window) : value }); }
  const { act } = await import('react');
  t.after(async () => { await act(async () => roots.forEach(root => root.unmount())); await window.happyDOM.close(); for (const [name, descriptor] of globals) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; } });
  await act(async () => { await import(`${pathToFileURL(`${out}/page.mjs`).href}?${t.name}`); await new Promise(resolve => setTimeout(resolve, 20)); });
  return { act, controllers, questions: document.querySelector('[data-thread="Questions"]'), senior: document.querySelector('[data-thread="Senior"]') };
}

test('staged recipe updates a single stage marker in place and keeps repeated stage numbers distinct', async t => {
  const start = [user(1), entry(2, assistant('', 10)), stage(3, 20, 1, 'running')];
  const f = await fixture(t, start);
  const marker = [...f.questions.querySelectorAll('[data-slot="badge"]')].find(node => node.textContent.includes('Étape 1'));
  assert.ok(marker);
  await f.act(async () => f.controllers.Questions.publish({ view: { entries: [...start, entry(4, assistant('Première note.', 1600)), stage(5, 20, 1, 'validated')], docs: {} } }));
  const markers = [...f.questions.querySelectorAll('[data-slot="badge"]')].filter(node => node.textContent.includes('Étape 1'));
  assert.equal(markers.length, 1); assert.equal(markers[0], marker); assert.match(marker.textContent, /validée/);
  await f.act(async () => f.controllers.Questions.publish({ view: { entries: [...start, entry(4, assistant('Première note.', 1600)), stage(5, 20, 1, 'validated'), user(6), entry(7, assistant('', 10)), stage(8, 30, 1, 'running')], docs: {} } }));
  assert.equal([...f.questions.querySelectorAll('[data-slot="badge"]')].filter(node => node.textContent.includes('Étape 1')).length, 2);
});

test('staged recipe hides zero history timing and formats recorded timing with Intl', async t => {
  const f = await fixture(t, [user(1), entry(2, assistant('Note mesurée.', 1600))]);
  assert.deepEqual({ recorded: f.questions.querySelector('[data-testid="total-duration"]').textContent, zeroHistory: f.senior.querySelectorAll('[data-testid="total-duration"]').length }, {
    recorded: `Durée : ${new Intl.NumberFormat('fr', { style: 'unit', unit: 'second', unitDisplay: 'short', maximumFractionDigits: 1 }).format(1.6)}`, zeroHistory: 0,
  });
});

for (const number of [1, 2]) test(`staged recipe shows one tailored error without stale running markers (stage ${number})`, async t => {
  const entries = [user(1), entry(2, assistant('', 10)), stage(3, 20, 1, 'running')];
  if (number === 2) entries.push(entry(4, assistant('Première note conservée.', 1600)), stage(5, 20, 1, 'validated'), entry(6, assistant('', 10)), stage(7, 30, 2, 'running'));
  entries.push(stage(8, number === 1 ? 20 : 30, number, 'failed'), entry(9, assistant('', 15, 'error')));
  const f = await fixture(t, entries), alerts = f.questions.querySelectorAll('[role="alert"]');
  assert.deepEqual({ errors: alerts.length, running: [...f.questions.querySelectorAll('[data-slot="badge"]')].filter(node => node.textContent.includes('en cours')).length }, { errors: 1, running: 0 });
  assert.match(alerts[0].textContent, number === 1 ? /question.*saisie/i : /note précédente reste disponible/);
  if (number === 1) assert.doesNotMatch(alerts[0].textContent, /note précédente/);
  assert.doesNotMatch(f.questions.textContent, /en cours/);
  assert.equal(f.questions.querySelector('[data-testid="preparing"]'), null);
});

test('staged recipe uses singular French offer labels and one heading per conversation', async t => {
  const f = await fixture(t, [user(1), entry(2, assistant('Note.'))]);
  assert.equal(f.questions.querySelector('[data-testid="offer-count"]').textContent, '1 offre utilisée');
  for (const [name, section] of [['Questions', f.questions], ['Senior', f.senior]]) assert.equal([...section.querySelectorAll('h2')].filter(node => node.textContent === name).length, 1);
});

test('staged recipe uses English singular labels and localized timing through the same view', async t => {
  const f = await fixture(t, [user(1), entry(2, assistant('Fictional note.', 1600))], 'en');
  assert.equal(f.questions.querySelector('[data-testid="offer-count"]').textContent, '1 offer used');
  assert.equal(f.questions.querySelector('[data-testid="total-duration"]').textContent, `Duration: ${new Intl.NumberFormat('en', { style: 'unit', unit: 'second', unitDisplay: 'short', maximumFractionDigits: 1 }).format(1.6)}`);
});

test('host labels use Intl plural categories and omit missing or unrecorded timing', () => {
  assert.deepEqual([0, 1, 2].map(demoLabels('fr').offers), ['0 offre utilisée', '1 offre utilisée', '2 offres utilisées']);
  assert.deepEqual([0, 1, 2].map(demoLabels('en').offers), ['0 offers used', '1 offer used', '2 offers used']);
  for (const locale of ['fr', 'en']) for (const duration of [undefined, 0, -1, NaN, Infinity]) assert.equal(demoLabels(locale).duration(duration), undefined);
});

test('staged recipe submits the real question without a visible test trigger', async t => {
  const f = await fixture(t, [user(1), entry(2, assistant('Note.'))]);
  await f.act(async () => { f.questions.querySelector('[data-testid="fail-first"]').click(); await new Promise(resolve => setTimeout(resolve, 10)); });
  assert.equal(f.controllers.Questions.sent[0].text, 'Quelle dose pour un adulte ?');
  assert.equal(f.controllers.Questions.sent[0].restore.text, 'Quelle dose pour un adulte ?');
});
