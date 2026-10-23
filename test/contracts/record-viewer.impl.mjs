// Fictional records through the public ArtifactPanel and standalone record blocks.
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('../../', import.meta.url));
const out = join(root, '.cache/record-viewer-test');
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'entry.tsx'), `export { ArtifactPanel } from '${root}registry/pi-app/artifact-panel.tsx'; export { createRecordsKind, recordsKind } from '${root}registry/record-viewer/records-kind.tsx'; export { RecordTable, RecordList, RecordsViewer } from '${root}registry/record-viewer/record-viewer.tsx';`);
await build({ entryPoints: [join(out, 'entry.tsx')], outfile: join(out, 'kit.mjs'), bundle: true, format: 'esm', platform: 'node', jsx: 'automatic', packages: 'external', logLevel: 'silent' });
// Imported once the first test's DOM globals exist: Base UI decides at load time whether it runs in a browser.
let kit;
const WORKSHOP = readFileSync(join(root, 'test/fixtures/records/inventaire-atelier.records.json'), 'utf8');

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

test('the built-in records kind groups all thirty workshop rows with app statuses', async t => {
  const page = await panel(t, WORKSHOP, { path: 'inventaire-atelier.records.json' });
  assert.equal(page.$('[data-testid=artifact-panel-type]').textContent, 'Records');
  assert.equal(page.$$('[data-boring=record-table] [data-record-row]').length, 30);
  assert.deepEqual(page.$$('[data-record-group]').map(e => e.textContent), ['Rayon: Bois', 'Rayon: Métal', 'Rayon: Finition']);
  assert.deepEqual([...new Set(page.$$('[data-record-status]').map(e => e.dataset.recordStatus))], ['ok', 'warn', 'error']);
});

test('French locale formats numeric and date columns and invokes the captured row action', async t => {
  const calls = [];
  const page = await panel(t, WORKSHOP, { path: 'inventaire-atelier.records.json', kinds: [kit.createRecordsKind({ locale: 'fr', onAction: (action, row) => calls.push([action.id, row.id]) })] });
  assert.equal(page.$('[data-testid=artifact-panel-type]').textContent, 'Données');
  assert.ok(page.container.textContent.includes(new Intl.NumberFormat('fr').format(1234.5)));
  assert.ok(page.container.textContent.includes(new Intl.DateTimeFormat('fr', { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date('2026-10-01'))));
  await page.click('[data-boring=record-table] button');
  assert.deepEqual(calls, [['order', 'stock-2']]);
});

test('file actions without a host handler are disabled, and an app kind takes precedence', async t => {
  const page = await panel(t, WORKSHOP, { path: 'inventaire-atelier.records.json' });
  assert.equal(page.$('[data-boring=record-table] button').disabled, true);
  await page.render(page.h(kit.RecordList, { items: [{ id: 'one', title: 'Brush', detail: 'Fictional workshop', status: { label: 'Ready', tone: 'info' }, action: { id: 'inspect', label: 'Inspect' } }] }));
  assert.equal(page.$('[data-boring=record-list] button').disabled, true);
});

test('RecordList preserves title, detail, status and optional action', async t => {
  const page = await dom(t); const calls = [];
  await page.render(page.h(kit.RecordList, { items: [{ id: 'one', title: 'Brush', detail: 'Fictional workshop', status: { label: 'Ready', tone: 'info' }, action: { id: 'inspect', label: 'Inspect' } }], onAction: (action, item) => calls.push([action.id, item.id]) }));
  assert.match(page.container.textContent, /Brush.*Fictional workshop.*Ready.*Inspect/);
  await page.click('button'); assert.deepEqual(calls, [['inspect', 'one']]);
});

test('all status tones use host Badge variants without interpreting the app label', async t => {
  const page = await dom(t);
  await page.render(page.h(kit.RecordTable, { columns: [{ key: 'status', label: 'Status', type: 'status' }], rows: ['ok', 'warn', 'error', 'info', 'neutral'].map(tone => ({ id: tone, values: { status: { label: `App ${tone}`, tone } } })) }));
  assert.deepEqual(page.$$('[data-record-status]').map(e => [e.textContent, e.dataset.variant]), [['App ok', 'default'], ['App warn', 'secondary'], ['App error', 'destructive'], ['App info', 'outline'], ['App neutral', 'secondary']]);
});

test('malformed records show exact source text and a localized note through the panel', async t => {
  const raw = '  {"kind":"records@1", "columns": [<script>fictional</script>\n';
  const page = await panel(t, raw, { path: 'broken.records.json', kinds: [kit.createRecordsKind({ locale: 'fr' })] });
  assert.equal(page.$('[data-testid=records-raw]').textContent, raw);
  assert.match(page.$('[data-testid=records-invalid]').textContent, /texte brut/);
  assert.equal(page.$('script'), null);
});

test('invalid cell types, dates, groups, IDs and versions refuse the entire file without hiding rows', async t => {
  const page = await dom(t); const valid = JSON.parse(WORKSHOP);
  const invalid = [
    { ...valid, kind: 'records@2' }, { ...valid, groupBy: 'missing' },
    { ...valid, columns: [...valid.columns, valid.columns[0]] },
    { ...valid, rows: [valid.rows[0], valid.rows[0]] },
    { ...valid, rows: [{ ...valid.rows[0], actions: [{ id: 'order', label: 'Order' }, { id: 'order', label: 'Again' }] }] },
    { ...valid, rows: [{ ...valid.rows[0], values: { ...valid.rows[0].values, unknown: 'Not silently discarded' } }] },
    ...[{ quantity: 'many' }, { checked: '2026-02-30' }, { checked: 'yesterday' }, { status: { tone: 'danger', label: 'App' } }, { name: { nested: 'bad' } }].map(values => ({ ...valid, rows: [{ ...valid.rows[0], values: { ...valid.rows[0].values, ...values } }] })),
  ];
  for (const value of invalid) {
    const text = JSON.stringify(value);
    await page.render(page.h(kit.RecordsViewer, { text }));
    assert.equal(page.$('[data-testid=records-raw]').textContent, text);
    assert.ok(page.$('[data-testid=records-invalid]'));
  }
});

test('empty rows, missing values and prototype-like keys stay usable', async t => {
  const page = await dom(t);
  await page.render(page.h(kit.RecordsViewer, { text: JSON.stringify({ kind: 'records@1', columns: [{ key: '__proto__', label: 'Name', type: 'text' }], rows: [{ id: 'one', values: JSON.parse('{"__proto__":"Brush"}') }] }) }));
  assert.match(page.$('[data-boring=record-table]').textContent, /Brush/);
  await page.render(page.h(kit.RecordsViewer, { text: JSON.stringify({ kind: 'records@1', columns: [{ key: 'name', label: 'Name', type: 'text' }], rows: [{ id: 'one', values: {} }, { id: 'two', values: { name: null } }] }), labels: { missing: 'Missing' } }));
  assert.equal(page.$$('[data-boring=record-table] td').map(e => e.textContent).join(' '), 'Missing Missing');
  await page.render(page.h(kit.RecordTable, { columns: [{ key: 'name', label: 'Name', type: 'text' }], rows: [], locale: 'fr' }));
  assert.match(page.container.textContent, /Aucune donnée/);
});

test('an app kind for records wins over the built-in', async t => {
  const page = await panel(t, WORKSHOP, { path: 'inventaire-atelier.records.json', kinds: [{ match: target => target.resource.path.endsWith('.records.json'), label: 'Stock', renderer: () => 'Host stock' }] });
  assert.equal(page.$('[data-testid=artifact-panel-type]').textContent, 'Stock');
  assert.equal(page.$('[data-boring=records-viewer]'), null);
  assert.match(page.container.textContent, /Host stock/);
});

test('phone status columns render once as labelled badges, including a leading status column', async t => {
  const value = JSON.parse(WORKSHOP);
  value.rows = [value.rows[0]];
  value.columns = [value.columns[4], ...value.columns.slice(0, 4), { key: 'review', label: 'Contrôle', type: 'status' }];
  value.rows[0].values.review = { label: 'À vérifier', tone: 'info' };
  const page = await panel(t, JSON.stringify(value), { path: 'workshop.records.json' });
  const item = page.$('[data-boring=record-list] [data-record-item]');
  assert.equal(item.textContent.split('Disponible').length - 1, 1);
  assert.equal(item.textContent.split('À vérifier').length - 1, 1);
  assert.deepEqual([...item.querySelectorAll('[data-record-status]')].map(e => [e.textContent, e.getAttribute('aria-label')]),
    [['Disponible', 'État: Disponible'], ['À vérifier', 'Contrôle: À vérifier']]);
  assert.match(item.textContent, /Article 01/);
});

test('grouping omits its column from table headers, row cells and phone cards, even when first', async t => {
  const value = JSON.parse(WORKSHOP);
  value.columns = [value.columns[1], value.columns[0], ...value.columns.slice(2)];
  const page = await panel(t, JSON.stringify(value), { path: 'workshop.records.json' });
  assert.deepEqual(page.$$('[data-boring=record-table] thead th').map(e => e.textContent), ['Article', 'Quantité', 'Vérifié', 'État', 'Actions']);
  assert.ok(page.$$('[data-record-group]').every(e => e.colSpan === 5));
  for (const row of page.$$('[data-record-row]')) {
    assert.equal(row.querySelectorAll('td').length, 5);
    assert.doesNotMatch(row.textContent, /Bois|Métal|Finition/);
  }
  for (const item of page.$$('[data-record-item]')) assert.doesNotMatch(item.textContent, /Rayon|Bois|Métal|Finition/);
  assert.equal(page.$('[data-record-item]').firstElementChild.firstElementChild.textContent, 'Article 01');
  assert.deepEqual(page.$$('[data-record-list-group]').map(e => e.textContent), ['Rayon: Bois', 'Rayon: Métal', 'Rayon: Finition']);
  delete value.groupBy;
  await page.render(page.h(kit.RecordsViewer, { text: JSON.stringify(value) }));
  assert.deepEqual(page.$$('[data-boring=record-table] thead th').map(e => e.textContent), ['Rayon', 'Article', 'Quantité', 'Vérifié', 'État', 'Actions']);
  assert.match(page.$('[data-record-row]').textContent, /Bois/);
  assert.match(page.$('[data-record-item]').textContent, /Bois/);
  assert.equal(page.$('[data-record-group]'), null);
});

test('the phone list projection retains fields through group headings and badges and preserves multiple row actions', async t => {
  const value = JSON.parse(WORKSHOP), calls = [];
  value.rows = [value.rows[0]];
  value.rows[0].actions = [{ id: 'inspect', label: 'Inspect' }, { id: 'order', label: 'Order' }];
  const page = await dom(t);
  await page.render(page.h(kit.RecordsViewer, { text: JSON.stringify(value), onAction: (action, row) => calls.push([action.id, row.id, row.values.name]) }));
  const item = page.$('[data-boring=record-list] [data-record-item]');
  for (const word of ['Article 01', 'Quantité: 1,234.5', 'Vérifié: Oct 1, 2026', 'Disponible']) assert.ok(item.textContent.includes(word), word);
  assert.doesNotMatch(item.textContent, /Rayon: Bois|État: Disponible/);
  assert.equal(item.querySelector('[data-record-status]').getAttribute('aria-label'), 'État: Disponible');
  for (const button of item.querySelectorAll('button')) await page.click(button);
  assert.deepEqual(calls, [['inspect', 'stock-1', 'Article 01'], ['order', 'stock-1', 'Article 01']]);
  assert.equal(page.$('[data-record-list-group]').textContent, 'Rayon: Bois');
});
