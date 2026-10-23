// looks@1 format, shadcn theme parsing, the frame's theme override and the kind through the real ArtifactPanel. Browser rendering is
// exercised by `npm run looks:journey`.
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('../../', import.meta.url));
const out = join(root, '.cache/looks-viewer-test');
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'entry.tsx'), `export { ArtifactPanel } from '${root}registry/pi-app/artifact-panel.tsx';
export { createLooksKind, parseLooks, parseShadcnTheme, swatches } from '${root}registry/looks-viewer/looks-viewer.tsx';
export { themeDeclarations } from '${root}registry/mockup-viewer/mockup-viewer.tsx';`);
await build({ entryPoints: [join(out, 'entry.tsx')], outfile: join(out, 'kit.mjs'), bundle: true, format: 'esm', platform: 'node', jsx: 'automatic', packages: 'external', logLevel: 'silent' });
const fixture = name => readFileSync(join(root, 'test/fixtures/looks', name), 'utf8');
const LOOKS = fixture('missing-receipts.looks.json'), LAYOUTS = fixture('missing-receipts-layouts.looks.json');
let kit;

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
  const settle = async () => { for (let i = 0; i < 12; i++) await act(async () => new Promise(resolve => setTimeout(resolve, 5))); };
  return { act, container, settle, h: createElement, $: s => document.querySelector(s), $$: s => [...document.querySelectorAll(s)], render: async element => act(async () => ui.render(element)) };
}

/** The real panel showing documents/<name>.looks.json; its client serves the fixtures next to it. */
async function panel(t, name, text, { onPick, onShown, onFailed } = {}) {
  const page = await dom(t);
  const path = `documents/${name}`;
  const artifact = { schema: 'boring.artifact', version: 1, title: 'Looks', type: 'code', mediaType: 'application/json', language: 'json',
    target: { resource: { providerId: 'workspace', path }, view: { kind: 'published' } }, revision: 'rev-1' };
  const reads = [];
  const client = { saves: async () => [], search: async () => [], read: async ({ target }) => {
    reads.push(target.resource.path);
    const file = target.resource.path === path ? text : (() => { try { return fixture(target.resource.path.replace(/^documents\//, '')); } catch { return undefined; } })();
    return file === undefined ? { kind: 'missing' } : { kind: 'available', snapshot: { bytes: new TextEncoder().encode(file), ref: { revision: 'rev-1', providerId: 'workspace', path: target.resource.path } } };
  } };
  const kinds = [kit.createLooksKind({ onPick })];
  await page.render(page.h(kit.ArtifactPanel, { active: { descriptor: artifact, follow: false }, versions: [artifact], options: { client, identity: { runtimeId: 'fixture' }, kinds, onShown, onFailed }, onSelect: () => {}, onClose: () => {} }));
  await page.settle();
  return { ...page, reads };
}

test('a looks file shows the key screen once per look, sandboxed, with swatches and Pick', async t => {
  const picks = [], shown = [];
  const page = await panel(t, 'missing-receipts.looks.json', LOOKS, { onPick: pick => picks.push(pick), onShown: value => shown.push(value) });
  const frames = page.$$('[data-testid=looks-frame] iframe');
  assert.equal(frames.length, 4);
  for (const frame of frames) assert.equal(frame.getAttribute('sandbox'), 'allow-scripts');
  assert.deepEqual(frames.map(frame => frame.getAttribute('title')), ['Calm look', 'Warm look', 'Bold look', 'Clinical look']);
  assert.ok(page.reads.includes('documents/missing-receipts.mockup.html'), 'the key screen is read next to the looks file');
  assert.match(page.$('[data-testid=look-warm]').textContent, /Friendly and human/);
  assert.equal(page.$$('[data-testid=look-warm] [data-testid=looks-swatches] circle').length, 4);
  assert.match(page.$('[data-testid=look-warm] [data-testid=looks-swatches]').textContent, /DM Sans/);
  assert.equal(page.$('[data-testid=layouts-grid]'), null);
  assert.ok(shown.some(value => value.path === 'documents/missing-receipts.looks.json'), 'presented once every frame loaded');
  await page.act(async () => page.$('[data-testid=look-warm-pick]').click());
  assert.deepEqual(picks, [{ kind: 'look', id: 'warm', label: 'Warm', path: 'documents/missing-receipts.looks.json' }]);
  assert.equal(page.$('[data-testid=look-warm]').hasAttribute('data-chosen'), true);
  assert.equal(page.$('[data-testid=look-warm-pick]').getAttribute('aria-pressed'), 'true');
});

test('a layouts file draws each layout in the chosen look', async t => {
  const picks = [];
  const page = await panel(t, 'missing-receipts-layouts.looks.json', LAYOUTS, { onPick: pick => picks.push(pick) });
  assert.equal(page.$('[data-testid=looks-grid]'), null, 'one look: no looks grid');
  assert.equal(page.$$('[data-testid=layouts-grid] iframe').length, 3);
  assert.match(page.$('[data-testid=layouts-grid]').textContent, /In the Warm look/);
  await page.act(async () => page.$('[data-testid=layout-board-pick]').click());
  assert.deepEqual(picks, [{ kind: 'layout', id: 'board', label: 'Board', path: 'documents/missing-receipts-layouts.looks.json' }]);
});

test('an unreadable looks file or a missing mock-up refuses the presentation', async t => {
  const failed = [];
  const page = await panel(t, 'broken.looks.json', JSON.stringify({ mockup: 'x.mockup.html', looks: [] }), { onFailed: value => failed.push(value) });
  assert.ok(page.$('[data-testid=looks-invalid]'));
  assert.ok(failed.some(value => /invalid looks file/.test(value.reason)));
});

test('a missing key screen is reported, never drawn empty', async t => {
  const failed = [];
  const spec = JSON.parse(LOOKS); spec.mockup = 'absent.mockup.html';
  const page = await panel(t, 'absent.looks.json', JSON.stringify(spec), { onFailed: value => failed.push(value) });
  assert.equal(page.$$('iframe').length, 0);
  assert.ok(failed.some(value => /cannot be read/.test(value.reason)));
});

test('parseShadcnTheme accepts the block shadcn apply writes and refuses anything else', async t => {
  await dom(t);
  const warm = JSON.parse(LOOKS).looks[1];
  const parsed = kit.parseShadcnTheme(warm.css);
  assert.equal(parsed.kind, 'ok');
  assert.match(parsed.theme.light.primary, /^oklch\(/);
  assert.match(parsed.theme.dark.background, /^oklch\(/);
  assert.equal(parsed.theme.theme['font-sans'], "'DM Sans Variable', sans-serif");
  for (const [css, why] of [
    [':root { --primary: red; --background: #fff; --foreground: #000; --primary-foreground: #fff }', 'a named colour'],
    [':root { --background: #fff; --foreground: #000; --primary: #00f; --primary-foreground: #fff; --brand: #f00 } .dark { --background: #000; --foreground: #fff; --primary: #00f; --primary-foreground: #fff }', 'a variable shadcn does not define'],
    [':root { --background: #fff; --foreground: #000; --primary: #00f; --primary-foreground: #fff } .dark { --background: #000; --foreground: #fff; --primary: #00f; --primary-foreground: #fff } body { color: red }', 'another selector'],
    [':root { --background: url(https://x.invalid/a.png); --foreground: #000; --primary: #00f; --primary-foreground: #fff }', 'a url'],
    [':root { --background: #fff; --foreground: #000; --primary: #00f; --primary-foreground: #fff }', 'no dark values'],
  ]) assert.equal(kit.parseShadcnTheme(css).kind, 'invalid', why);
});

test('parseLooks validates the looks@1 file', async t => {
  await dom(t);
  assert.equal(kit.parseLooks(LOOKS).kind, 'ok');
  assert.equal(kit.parseLooks(LAYOUTS).kind, 'ok');
  const spec = JSON.parse(LOOKS);
  const issues = value => { const result = kit.parseLooks(JSON.stringify(value)); return result.kind === 'invalid' ? result.issues.join('\n') : ''; };
  assert.match(issues({ ...spec, looks: spec.looks.slice(0, 1) }), /2 to 6 looks/);
  assert.match(issues({ ...spec, looks: [...spec.looks, ...spec.looks].map((look, i) => ({ ...look, id: `l${i}` })) }), /2 to 6 looks/);
  assert.match(issues({ ...spec, looks: [spec.looks[0], spec.looks[0]] }), /unique/);
  assert.match(issues({ ...spec, mockup: '../secret.mockup.html' }), /mockup/);
  assert.match(issues({ ...spec, mockup: 'screen.html' }), /mockup/);
  assert.match(issues({ ...spec, looks: spec.looks.map((look, i) => i ? look : { ...look, preset: 'https://evil.invalid/x' }) }), /preset/);
  assert.match(issues({ ...spec, look: 'missing' }), /look:/);
});

test('themeDeclarations: a look reaches the frame as shadcn variables, safely', async t => {
  await dom(t);
  const theme = { theme: { 'font-sans': "'DM Sans Variable', sans-serif" }, light: { primary: 'oklch(0.5 0.2 40)', radius: '0.875rem' }, dark: { primary: 'oklch(0.4 0.2 40)' } };
  const light = kit.themeDeclarations(theme, false), dark = kit.themeDeclarations(theme, true);
  assert.match(light, /--primary:oklch\(0\.5 0\.2 40\)/);
  assert.match(dark, /--primary:oklch\(0\.4 0\.2 40\)/);
  assert.match(light, /--font-sans:'DM Sans Variable', sans-serif/);
  assert.match(light, /--radius:0\.875rem/);
  const hostile = kit.themeDeclarations({ light: { primary: 'red;}</style><script>', 'Bad Name': '#fff', ring: '#123' } }, false);
  assert.equal(hostile, '--ring:#123');
});
