// Run by diagram-viewer.test.mjs in its own process. The built-in diagram kind driven through the real pi-app ArtifactPanel, as a presented
// `*.diagram.json` opens in it: nodes, numbered edges and their legend, the highlighted path, groups, the note, format v1 and its versioning,
// the maquette workflow aliases, errors, an app kind overriding the built-in, the French kind, and a maquette whose workflow links to a
// diagram file. Fictional data only (test/fixtures/diagram/booking.diagram.json).
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('../../', import.meta.url));
const out = join(root, '.cache/diagram-viewer-test');
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'entry.tsx'), `export { ArtifactPanel } from '${root}registry/pi-app/artifact-panel.tsx'; export { createDiagramKind, diagramKind } from '${root}registry/diagram-viewer/diagram-viewer.tsx';`);
await build({ entryPoints: [join(out, 'entry.tsx')], outfile: join(out, 'kit.mjs'), bundle: true, format: 'esm', platform: 'node', jsx: 'automatic', packages: 'external', logLevel: 'silent' });
// Imported once the first test's DOM globals exist: Base UI decides at load time whether it runs in a browser.
let kit;
const BOOKING = readFileSync(join(root, 'test/fixtures/diagram/booking.diagram.json'), 'utf8');
const MAQUETTE = readFileSync(join(root, 'test/fixtures/maquette/booking.maquette.json'), 'utf8');

const DOM = ['window', 'document', 'navigator', 'location', 'HTMLElement', 'HTMLButtonElement', 'Element', 'Node', 'Text', 'Event', 'KeyboardEvent', 'MouseEvent', 'PointerEvent', 'addEventListener', 'removeEventListener', 'MutationObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'IS_REACT_ACT_ENVIRONMENT', 'ResizeObserver', 'localStorage', 'sessionStorage'];
async function dom(t) {
  const { Window } = await import('happy-dom');
  const window = new Window({ url: 'https://fictional.invalid/', settings: { disableIframePageLoading: true } });
  const globals = new Map(DOM.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  for (const name of DOM) {
    const value = name === 'window' ? window : name === 'IS_REACT_ACT_ENVIRONMENT' ? true : name === 'ResizeObserver' ? class { observe() {} unobserve() {} disconnect() {} } : window[name];
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: typeof value === 'function' && /^[a-z]/.test(name) ? value.bind(window) : value });
  }
  kit ??= await import(pathToFileURL(join(out, 'kit.mjs')).href);
  const { act, createElement } = await import('react');
  const { createRoot } = await import('react-dom/client');
  const container = document.createElement('div'); document.body.append(container);
  const ui = createRoot(container);
  t.after(async () => {
    await act(async () => ui.unmount()); container.remove();
    await window.happyDOM.close();
    for (const [name, descriptor] of globals) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; }
  });
  const settle = async () => { for (let i = 0; i < 10; i++) await act(async () => new Promise(resolve => setTimeout(resolve, 5))); };
  const $ = selector => document.querySelector(selector);
  const $$ = selector => [...document.querySelectorAll(selector)];
  const click = async selector => { const element = typeof selector === 'string' ? $(selector) : selector; assert.ok(element, `missing ${selector}`); await act(async () => element.click()); };
  return { window, act, container, $, $$, click, settle, h: createElement, render: async element => act(async () => ui.render(element)) };
}

/** The real ArtifactPanel showing `text` as a presented file at `path`; `files` are the workspace's other files (path → text), read by kinds. */
async function panel(t, text, { path = 'flows/booking.diagram.json', kinds, files = {} } = {}) {
  const page = await dom(t);
  const artifact = { schema: 'boring.artifact', version: 1, title: 'Booking', type: 'code', mediaType: 'application/json', language: 'json',
    target: { resource: { providerId: 'workspace', path }, view: { kind: 'published' } }, revision: 'rev-1' };
  const reads = [];
  const client = {
    read: async ({ target }) => {
      const asked = target.resource.path;
      reads.push(asked);
      const body = asked === path ? text : files[asked];
      return body === undefined ? { kind: 'missing' } : { kind: 'available', snapshot: { bytes: new TextEncoder().encode(body), ref: { revision: 'rev-1', providerId: 'workspace', path: asked } } };
    },
    saves: async () => [], search: async () => [],
  };
  await page.render(page.h(kit.ArtifactPanel, { active: { descriptor: artifact, follow: false }, versions: [artifact], options: { client, identity: { runtimeId: 'fixture' }, ...(kinds ? { kinds } : {}) }, onSelect: () => {}, onClose: () => {} }));
  await page.settle();
  const lit = selector => page.$$(`${selector}[data-lit]`);
  return { ...page, reads, lit };
}

test('a diagram file renders its nodes, numbered edges with a legend, the highlighted path, groups and the note, named Diagram', async t => {
  const page = await panel(t, BOOKING);
  assert.equal(page.$('[data-testid=artifact-panel-type]').textContent, 'Diagram');
  assert.equal(page.$('[data-boring=diagram-viewer]').getAttribute('aria-label'), 'Tidewater Studio: booking a class');
  assert.deepEqual(page.$$('[data-testid=diagram] g[data-node]').map(node => node.dataset.node), ['browse', 'pick', 'details', 'full', 'held', 'confirmed', 'attended', 'cancelled']);
  assert.equal(page.$$('[data-testid=diagram] g[data-edge]').length, 8, 'one arrow per edge');
  assert.equal(page.$$('[data-testid=diagram-legend] li').length, 8, 'a numbered legend line per edge');
  assert.match(page.$$('[data-testid=diagram-legend] li')[2].textContent, /^3Pick a class → Waiting list: class is full \(by app\)$/);
  assert.deepEqual(page.lit('[data-testid=diagram] g[data-node]').map(node => node.dataset.node), ['browse', 'pick', 'details', 'held', 'confirmed', 'attended'], 'the path is drawn stronger');
  assert.deepEqual(page.lit('[data-testid=diagram] g[data-edge]').map(edge => edge.dataset.edge), ['browse→pick', 'pick→details', 'details→held', 'held→confirmed', 'confirmed→attended'],
    'only the arrows between consecutive nodes of the path');
  assert.equal(page.$('[data-testid=diagram] g[data-node=held]').dataset.group, 'book');
  assert.match(page.$('[data-testid=diagram] g[data-node=held]').textContent, /Place held.*Book/, 'the group is the second line of the box');
  assert.match(page.$('[data-testid=diagram-note]').textContent, /first booking that goes well/);
  assert.equal(page.$('[data-testid=diagram-newer]'), null);
});

test('an unversioned diagram reads as v1, with the maquette workflow aliases (states, transitions, on, bare strings)', async t => {
  const page = await panel(t, JSON.stringify({ states: ['draft', { id: 'sent', label: 'Sent' }], transitions: [{ from: 'draft', to: 'sent', on: 'sends' }, { from: 'draft', to: 'nowhere' }] }));
  assert.equal(page.$('[data-boring=diagram-viewer]').dataset.state, 'ok');
  assert.equal(page.$('[data-testid=diagram-newer]'), null, 'no notice: an unversioned file is v1');
  assert.deepEqual(page.$$('[data-testid=diagram] g[data-node]').map(node => node.textContent), ['draftdraft', 'SentSent']);
  assert.deepEqual(page.$$('[data-testid=diagram-legend] li').map(item => item.textContent), ['1draft → Sent: sends'], 'an edge to an unknown node is dropped');
  assert.equal(page.lit('[data-testid=diagram] g').length, 0, 'no path: nothing highlighted');
});

test('invalid JSON shows the error state, not a crash', async t => {
  const page = await panel(t, '{ "nodes": ');
  assert.equal(page.$('[data-testid=diagram-error]').dataset.reason, 'json');
  assert.equal(page.$('[data-testid=diagram]'), null);
});

test('a file without nodes shows the shape error', async t => {
  const page = await panel(t, JSON.stringify({ version: 1, edges: [] }));
  assert.equal(page.$('[data-testid=diagram-error]').dataset.reason, 'shape');
});

test('a future version shows a notice and still draws what it can', async t => {
  const page = await panel(t, JSON.stringify({ ...JSON.parse(BOOKING), version: 2, lanes: true }));
  assert.match(page.$('[data-testid=diagram-newer]').textContent, /format version 2/);
  assert.equal(page.$$('[data-testid=diagram] g[data-node]').length, 8);
});

test('an app kind for .diagram.json wins over the built-in', async t => {
  const page = await panel(t, BOOKING, { kinds: [{ match: target => target.resource.path.endsWith('.diagram.json'), label: 'Flow', renderer: ({ text }) => JSON.parse(text).title }] });
  assert.equal(page.$('[data-testid=artifact-panel-type]').textContent, 'Flow');
  assert.equal(page.$('[data-testid=diagram]'), null);
});

test('createDiagramKind gives the French kind: « Diagramme » and French words', async t => {
  const page = await panel(t, BOOKING, { kinds: [kit.createDiagramKind({ locale: 'fr' })] });
  assert.equal(page.$('[data-testid=artifact-panel-type]').textContent, 'Diagramme');
  assert.match(page.$$('[data-testid=diagram-legend] li')[0].textContent, /\(par student\)$/);
});

test('a maquette whose workflow links to a *.diagram.json reads it from its folder for How it works', async t => {
  const linked = JSON.stringify({ ...JSON.parse(MAQUETTE), workflow: 'booking.diagram.json', cases: [{ name: 'Waiting list', path: ['browse', 'pick', 'full', 'held'] }] });
  const page = await panel(t, linked, { path: 'flows/booking.maquette.json', files: { 'flows/booking.diagram.json': BOOKING } });
  await page.click('[data-testid=maquette-menu]'); await page.settle();
  await page.click('[data-testid=maquette-how-open]'); await page.settle();
  assert.ok(page.reads.includes('flows/booking.diagram.json'), 'read next to the maquette');
  assert.equal(page.$$('[data-testid=maquette-how] [data-testid=diagram] g[data-node]').length, 8);
  assert.deepEqual(page.lit('[data-testid=diagram] g[data-node]').map(node => node.dataset.node), ['browse', 'pick', 'details', 'held', 'confirmed', 'attended'], 'the diagram\'s own path by default');
  await page.click(page.$$('[data-testid=maquette-case]').find(button => button.textContent === 'Waiting list')); await page.settle();
  assert.deepEqual(page.lit('[data-testid=diagram] g[data-edge]').map(edge => edge.dataset.edge), ['browse→pick', 'pick→full', 'full→held'], 'a case path still highlights the linked diagram');
});

test('a linked diagram that cannot be read says so in the dialog', async t => {
  const page = await panel(t, JSON.stringify({ ...JSON.parse(MAQUETTE), workflow: 'missing.diagram.json' }), { path: 'flows/booking.maquette.json' });
  await page.click('[data-testid=maquette-menu]'); await page.settle();
  await page.click('[data-testid=maquette-how-open]'); await page.settle();
  assert.ok(page.$('[data-testid=maquette-how-error]'));
});
