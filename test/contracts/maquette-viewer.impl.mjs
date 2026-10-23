// Run by maquette-viewer.test.mjs in its own process. The built-in maquette kind driven through the real pi-app ArtifactPanel, as a
// presented `*.maquette.json` opens in it: format v1 and its versioning, the stepper and arrow keys, goto links and their hint, Back and the
// breadcrumb, guided tours, the device frame, `#screen=` deep links, the collapsed workflow, errors, an app kind overriding the built-in, and
// comment pins: the feedback item's point mode entered from the viewer, with the note sent to the conversation naming the screen and block.
// Fictional data only (test/fixtures/maquette/booking.maquette.json).
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('../../', import.meta.url));
const out = join(root, '.cache/maquette-viewer-test');
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'entry.tsx'), `export { ArtifactPanel } from '${root}registry/pi-app/artifact-panel.tsx'; export { createMaquetteKind, maquetteKind } from '${root}registry/maquette-viewer/maquette-kind.tsx';
export { useComposerFeedback, usePointComments } from '${root}registry/feedback/feedback-session.tsx';`);
await build({ entryPoints: [join(out, 'entry.tsx')], outfile: join(out, 'kit.mjs'), bundle: true, format: 'esm', platform: 'node', jsx: 'automatic', packages: 'external', logLevel: 'silent' });
// Imported once the first test's DOM globals exist: Base UI decides at load time whether it runs in a browser.
let kit;
const BOOKING = readFileSync(join(root, 'test/fixtures/maquette/booking.maquette.json'), 'utf8');

const DOM = ['window', 'document', 'navigator', 'location', 'HTMLElement', 'HTMLButtonElement', 'Element', 'Node', 'Text', 'Event', 'KeyboardEvent', 'MouseEvent', 'PointerEvent', 'addEventListener', 'removeEventListener', 'MutationObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'IS_REACT_ACT_ENVIRONMENT', 'ResizeObserver', 'localStorage', 'sessionStorage'];
async function dom(t, url = 'https://fictional.invalid/') {
  const { Window } = await import('happy-dom');
  const window = new Window({ url, settings: { disableIframePageLoading: true } });
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
  // The whole document: menus and dialogs render in a portal outside the panel.
  const $ = selector => document.querySelector(selector);
  const $$ = selector => [...document.querySelectorAll(selector)];
  const click = async selector => { const element = typeof selector === 'string' ? $(selector) : selector; assert.ok(element, `missing ${selector}`); await act(async () => element.click()); };
  return { window, act, container, $, $$, click, settle, h: createElement, render: async element => act(async () => ui.render(element)) };
}

/** The real ArtifactPanel showing `text` as a presented file at `path`, with the host's `kinds` (none: only the built-in maquette kind). */
async function panel(t, text, { path = 'documents/booking.maquette.json', kinds, url, follow = false } = {}) {
  const page = await dom(t, url);
  const artifact = { schema: 'boring.artifact', version: 1, title: 'Booking', type: 'code', mediaType: 'application/json', language: 'json',
    target: { resource: { providerId: 'workspace', path }, view: { kind: 'published' } }, revision: 'rev-1' };
  const bytes = new TextEncoder().encode(text);
  const client = { read: async () => ({ kind: 'available', snapshot: { bytes, ref: { revision: 'rev-1', providerId: 'workspace', path } } }), saves: async () => [], search: async () => [] };
  await page.render(page.h(kit.ArtifactPanel, { active: { descriptor: artifact, follow }, versions: [artifact], options: { client, identity: { runtimeId: 'fixture' }, ...(kinds ? { kinds } : {}) }, onSelect: () => {}, onClose: () => {} }));
  await page.settle();
  const screen = () => page.$('[data-testid=maquette-walk]')?.dataset.screen;
  const key = async (key, init = {}) => { const walk = page.$('[data-testid=maquette-walk]'); await page.act(async () => walk.dispatchEvent(new page.window.KeyboardEvent('keydown', { key, bubbles: true, ...init }))); };
  const menu = async item => { await page.click('[data-testid=artifact-more]'); await page.settle(); await page.click(item); await page.settle(); };
  return { ...page, screen, key, menu };
}

test('a v1 file renders its start screen in the panel, named Mock-up, with real blocks and a one-line note', async t => {
  const page = await panel(t, BOOKING);
  assert.equal(page.$('[data-testid=artifact-panel-type]').textContent, 'Mock-up');
  assert.equal(page.$('[data-boring=maquette-viewer]').getAttribute('aria-label'), 'Tidewater Studio: class booking');
  assert.equal(page.screen(), 'classes');
  assert.equal(page.$('[data-testid=maquette-screen-title]').textContent, "This week's classes");
  assert.deepEqual(page.$$('[data-testid=maquette-screen] th').map(cell => cell.textContent), ['Class', 'When', 'Places']);
  const note = page.$('[data-testid=maquette-note]');
  assert.match(note.textContent, /this week's classes and how many places/);
  assert.equal(note.getAttribute('title'), note.textContent, 'the full note in its tooltip');
  assert.ok(page.$('[data-testid=maquette-note-more]'), 'and behind the info button');
  assert.equal(page.$('[data-testid=maquette-position]').textContent, '1 / 3');
});

test('the stepper walks the screens with Previous, Next and the arrow keys', async t => {
  const page = await panel(t, BOOKING);
  assert.equal(page.$('[data-testid=maquette-previous]').disabled, true, 'nothing before the first screen');
  await page.click('[data-testid=maquette-next]');
  assert.equal(page.screen(), 'class');
  assert.equal(page.$('[data-testid=maquette-position]').textContent, '2 / 3');
  await page.key('ArrowRight');
  assert.equal(page.screen(), 'confirmed');
  assert.equal(page.$('[data-testid=maquette-next]').disabled, true, 'nothing after the last screen');
  await page.key('ArrowLeft');
  assert.equal(page.screen(), 'class');
  assert.equal(document.activeElement, page.$('[data-testid=maquette-screen-title]'), 'focus starts on the screen just opened');
});

test('a goto block names its screen, pulses on first view, opens its screen, and Back returns', async t => {
  const page = await panel(t, BOOKING);
  const goto = page.$('[data-testid=maquette-screen] [data-testid=maquette-goto][data-goto=class]');
  assert.equal(goto.getAttribute('title'), 'Opens “Wheel throwing, beginners”');
  assert.equal(goto.closest('[data-hint]')?.dataset.hint, 'pulse', 'goto blocks pulse the first time their screen is shown');
  assert.equal(page.$('[data-testid=maquette-back]'), null, 'no Back before a move');
  await page.click(goto);
  assert.equal(page.screen(), 'class');
  await page.click('[data-testid=maquette-goto][data-goto=confirmed]');
  assert.equal(page.screen(), 'confirmed');
  await page.click('[data-testid=maquette-back]');
  assert.equal(page.screen(), 'class');
  assert.equal(page.$('[data-testid=maquette-walk] [data-hint]')?.dataset.hint, undefined, 'a screen seen before does not pulse again');
  await page.click('[data-testid=maquette-back]');
  assert.equal(page.screen(), 'classes');
  assert.equal(page.$('[data-testid=maquette-back]'), null, 'back at the start of the path');
});

test('a case with steps is a guided tour from the menu: its screens in order, a caption and step dots', async t => {
  const page = await panel(t, BOOKING);
  await page.menu('[data-testid=maquette-tour]');
  assert.equal(page.$('[data-testid=maquette-walk]').dataset.tour, 'First booking');
  assert.match(page.$('[data-testid=maquette-caption]').textContent, /^Alex, a fictional student, opens/);
  assert.equal(page.$('[data-testid=maquette-dots]').getAttribute('aria-label'), 'Step 1 of 3');
  assert.equal(page.$('[data-testid=maquette-position]'), null, 'dots replace the counter');
  await page.click('[data-testid=maquette-next]');
  assert.equal(page.screen(), 'class');
  assert.match(page.$('[data-testid=maquette-caption]').textContent, /types a name and an email/);
  await page.key('ArrowRight');
  assert.equal(page.screen(), 'confirmed');
  assert.equal(page.$('[data-testid=maquette-dots]').getAttribute('aria-label'), 'Step 3 of 3');
  await page.click('[data-testid=maquette-end-tour]');
  assert.equal(page.$('[data-testid=maquette-caption]'), null);
  assert.ok(page.$('[data-testid=artifact-more]'), 'the panel menu stays');
});

test('the workflow is hidden by default and opens from the menu; a legacy case path still highlights it', async t => {
  const page = await panel(t, BOOKING);
  assert.equal(page.$('[data-testid=diagram]'), null, 'hidden: no diagram drawn');
  await page.menu('[data-testid=maquette-how-open]');
  assert.ok(page.$('[data-testid=maquette-how] [data-testid=diagram]'), 'in the How it works dialog, drawn by the diagram viewer');
  assert.equal(page.$$('[data-testid=diagram-legend] li').length, 5, 'a numbered legend line per transition');
  const cancellation = page.$$('[data-testid=maquette-case]').find(button => button.textContent === 'Cancellation');
  await page.click(cancellation);
  assert.deepEqual(page.$$('[data-testid=diagram] g[data-node][data-lit]').map(state => state.dataset.node), ['browsing', 'requested', 'confirmed', 'cancelled']);
});

test('inside the panel there is one "…" menu: the panel header\'s, holding the tours and How it works', async t => {
  const page = await panel(t, BOOKING);
  assert.equal(page.$$('[aria-label="More actions"], [data-testid=maquette-menu], [data-testid=artifact-more]').length, 1, 'one "…" trigger');
  assert.equal(page.$('[data-testid=maquette-menu]'), null, 'none beside the screen counter');
  await page.click('[data-testid=artifact-more]'); await page.settle();
  assert.ok(page.$('[data-testid=maquette-tour]') && page.$('[data-testid=maquette-how-open]'), 'the tours and How it works are in the panel menu');
});

test('the selected case in How it works uses the default button variant, not a muted one', async t => {
  const page = await panel(t, BOOKING);
  await page.menu('[data-testid=maquette-how-open]');
  const cancellation = () => page.$$('[data-testid=maquette-case]').find(button => button.textContent === 'Cancellation');
  await page.click(cancellation());
  assert.equal(cancellation().getAttribute('aria-pressed'), 'true');
  assert.match(cancellation().className, /\bbg-primary\b/);
  assert.doesNotMatch(cancellation().className, /\bbg-secondary\b/);
});

test('device: phone draws the phone frame', async t => {
  const page = await panel(t, BOOKING);
  assert.equal(page.$('[data-testid=maquette-frame]').dataset.device, 'phone');
});

test('without device the screen takes the panel width', async t => {
  const plain = JSON.parse(BOOKING); delete plain.device;
  const other = await panel(t, JSON.stringify(plain));
  assert.equal(other.$('[data-testid=maquette-frame]').dataset.device, 'panel');
});

test('#screen=<id> in the page URL opens that screen, and a later fragment moves to its screen', async t => {
  const page = await panel(t, BOOKING, { url: 'https://fictional.invalid/app#screen=confirmed' });
  assert.equal(page.screen(), 'confirmed');
  await page.act(async () => { page.window.location.hash = '#screen=class'; page.window.dispatchEvent(new page.window.Event('hashchange')); });
  await page.settle();
  assert.equal(page.screen(), 'class');
});

test('an unknown component is a named placeholder', async t => {
  const page = await panel(t, BOOKING);
  await page.click('[data-testid=maquette-next]');
  const placeholder = page.$('[data-testid=maquette-placeholder]');
  assert.equal(placeholder.dataset.type, 'studio map');
  assert.match(placeholder.textContent, /Studio map/);
  assert.match(placeholder.textContent, /Where the wheel room is/);
});

test('an unversioned file reads as v1 (legacy aliases included)', async t => {
  const legacy = { title: 'Old', screens: { home: { title: 'Home', blocks: [{ type: 'button', label: 'Go', goto: 'next' }] }, next: { title: 'Next', blocks: [{ type: 'text', text: 'Hello' }] } },
    workflow: { states: ['a', 'b'], transitions: [{ from: 'a', to: 'b', on: 'starts' }] }, cases: [{ name: 'Path', path: ['a', 'b'] }] };
  const page = await panel(t, JSON.stringify(legacy));
  assert.equal(page.$('[data-testid=maquette-newer]'), null);
  assert.equal(page.screen(), 'home');
  await page.click('[data-testid=maquette-goto]');
  assert.equal(page.screen(), 'next');
  // How it works on the old file: bare-string states, `on` labels and the legacy case `path`, unchanged.
  await page.menu('[data-testid=maquette-how-open]');
  assert.deepEqual(page.$$('[data-testid=maquette-how] [data-testid=diagram] g[data-node]').map(node => node.dataset.node), ['a', 'b']);
  assert.deepEqual(page.$$('[data-testid=diagram-legend] li').map(item => item.textContent), ['1a → b: starts']);
  await page.click('[data-testid=maquette-case]');
  assert.deepEqual(page.$$('[data-testid=diagram] g[data-lit]').map(node => node.dataset.node ?? node.dataset.edge), ['a→b', 'a', 'b'], 'the legacy path still highlights');
});

test('a future version shows a notice and still renders what it can', async t => {
  const future = await panel(t, JSON.stringify({ ...JSON.parse(BOOKING), version: 3, hologram: true }));
  assert.match(future.$('[data-testid=maquette-newer]').textContent, /format version 3/);
  assert.ok(future.$$('[data-testid=maquette-screen]').length > 0, 'what it can read is still drawn');
});

test('invalid JSON shows an inline error, not a crash', async t => {
  const broken = await panel(t, '{ "screens": ');
  assert.equal(broken.$('[data-testid=maquette-error]').dataset.reason, 'json');
});

test('a file without screens shows the shape error', async t => {
  const empty = await panel(t, JSON.stringify({ title: 'Nothing', screens: {} }));
  assert.equal(empty.$('[data-testid=maquette-error]').dataset.reason, 'shape');
});

test('an app kind for .maquette.json wins over the built-in', async t => {
  const page = await panel(t, BOOKING, { kinds: [{ match: target => target.resource.path.endsWith('.maquette.json'), label: 'Wireframe', renderer: ({ text }) => JSON.parse(text).title }] });
  assert.equal(page.$('[data-testid=artifact-panel-type]').textContent, 'Wireframe');
  assert.equal(page.$('[data-testid=maquette-walk]'), null, 'the built-in viewer is not drawn');
  assert.equal(page.$('[data-testid=artifact-kind-view]').textContent, 'Tidewater Studio: class booking');
});

test('an app kind gets the revision it shows and that it is pinned (read-only) when the panel pins a version', async t => {
  const seen = [];
  await panel(t, BOOKING, { kinds: [{ match: target => target.resource.path.endsWith('.maquette.json'), label: 'Wireframe', renderer: props => { seen.push({ revision: props.revision, pinned: props.pinned }); return 'x'; } }] });
  assert.deepEqual(seen.at(-1), { revision: 'rev-1', pinned: true });
});

test('an app kind following the latest version gets pinned false', async t => {
  const seen = [];
  await panel(t, BOOKING, { follow: true, kinds: [{ match: target => target.resource.path.endsWith('.maquette.json'), label: 'Wireframe', renderer: props => { seen.push({ revision: props.revision, pinned: props.pinned }); return 'x'; } }] });
  assert.deepEqual(seen.at(-1), { revision: 'rev-1', pinned: false });
});

test('createMaquetteKind gives the French kind: « Maquette » and French words', async t => {
  const french = await panel(t, BOOKING, { kinds: [kit.createMaquetteKind({ locale: 'fr' })] });
  assert.equal(french.$('[data-testid=artifact-panel-type]').textContent, 'Maquette');
  assert.equal(french.$('[data-testid=maquette-previous]').getAttribute('aria-label'), 'Écran précédent');
});

// ---- Comment pins: the feedback session's point mode, entered from the viewer's own icon.

const pointerAt = (window, type, target) => target.dispatchEvent(new window.PointerEvent(type, { bubbles: true, cancelable: true, composed: true, clientX: 10, clientY: 10, pointerType: 'touch' }));
const touchAt = (window, type, target) => { const event = new window.Event(type, { bubbles: true, cancelable: true, composed: true }); Object.defineProperty(event, 'changedTouches', { value: [{ clientX: 10, clientY: 10 }] }); return target.dispatchEvent(event); };

/** The panel inside a host that has a feedback session over the page (`createFeedbackSession`), wired as the feedback item says. */
async function commented(t, text = BOOKING) {
  const page = await dom(t);
  const { createFeedbackSession } = await import('@hachej/boring-feedback/ui');
  const { createPrivacyPolicy } = await import('@hachej/boring-feedback/page');
  const { useMemo } = await import('react');
  const under = { current: [] };
  const session = createFeedbackSession({ app: 'fictional-pm', root: page.container, policy: createPrivacyPolicy(), hitTest: () => under.current });
  t.after(() => session.dispose());
  const path = 'documents/booking.maquette.json';
  const artifact = { schema: 'boring.artifact', version: 1, title: 'Booking', type: 'code', mediaType: 'application/json', language: 'json',
    target: { resource: { providerId: 'workspace', path }, view: { kind: 'published' } }, revision: 'rev-1' };
  const bytes = new TextEncoder().encode(text);
  const client = { read: async () => ({ kind: 'available', snapshot: { bytes, ref: { revision: 'rev-1', providerId: 'workspace', path } } }), saves: async () => [], search: async () => [] };
  const composer = { current: undefined };
  function Host() {
    const comments = kit.usePointComments(session);
    composer.current = kit.useComposerFeedback(session);
    const kinds = useMemo(() => [kit.createMaquetteKind({ comments })], [comments]);
    return page.h(kit.ArtifactPanel, { active: { descriptor: artifact, follow: false }, versions: [artifact], options: { client, identity: { runtimeId: 'fixture' }, kinds }, onSelect: () => {}, onClose: () => {} });
  }
  await page.render(page.h(Host));
  await page.settle();
  /** A finger tap on `element` as the browser delivers it (the session's picker names it "under the finger"). */
  const tap = async element => {
    assert.ok(element, 'nothing to tap');
    under.current = [element];
    await page.act(async () => { pointerAt(page.window, 'pointerdown', element); touchAt(page.window, 'touchstart', element); pointerAt(page.window, 'pointerup', element); touchAt(page.window, 'touchend', element); });
  };
  /** Types a note in the open pin and keeps it (what NoteBubble's field and Enter do). */
  const note = async words => { await page.act(async () => { session.setBubbleText(words); session.saveBubble(); }); };
  const block = id => page.$(`[data-testid=maquette-screen] [data-testid=maquette-block][data-block="${id}"]`);
  return { ...page, session, composer, tap, note, block };
}

test('the comment icon enters point mode on the screen; a tapped block pins a note naming the maquette path, screen id and block id', async t => {
  const page = await commented(t);
  const icon = page.$('[data-testid=maquette-comment]');
  assert.equal(icon.getAttribute('aria-label'), 'Comment on this screen');
  assert.equal(icon.getAttribute('aria-pressed'), 'false');
  assert.equal(page.block('4').dataset.feedbackId, 'maquette:documents/booking.maquette.json#screen=classes&block=4', 'each block names itself');
  await page.click(icon);
  assert.equal(page.session.getSnapshot().phase, 'active');
  assert.equal(page.session.getSnapshot().mode, 'point', 'point mode, on any device');
  assert.equal(page.$('[data-testid=maquette-comment]').getAttribute('aria-pressed'), 'true');
  await page.tap(page.block('4').querySelector('button span'));
  await page.note('Make this button say "Book a place"');
  await page.tap(page.block('0').querySelector('h4'));
  await page.note('A friendlier heading, please');
  assert.deepEqual(page.session.getSnapshot().notes.map(item => [item.number, item.feedbackId]), [
    [1, 'maquette:documents/booking.maquette.json#screen=classes&block=4'],
    [2, 'maquette:documents/booking.maquette.json#screen=classes&block=0'],
  ], 'a pin on an element inside a block carries the block\'s id');
  assert.equal(page.$$('[data-testid=maquette-pin]').length, 0, 'while pointing the session draws its own pins');
  await page.click('[data-testid=maquette-comment]');
  await page.settle();
  assert.equal(page.session.getSnapshot().phase, 'review', 'the icon again is Done: the notes wait for Send in the existing review');
  assert.deepEqual(page.$$('[data-testid=maquette-pin]').map(pin => [pin.closest('[data-testid=maquette-block]').dataset.block, pin.textContent]), [['0', '2'], ['4', '1']],
    'small numbered markers on the pinned blocks of the current screen');
  await page.click('[data-testid=maquette-next]');
  assert.equal(page.$$('[data-testid=maquette-pin]').length, 0, 'another screen shows only its own pins');
  // Send: the composer attaches the report to the message, as with the composer's own toggle.
  const sent = await page.composer.current.attach('Two changes on the class list');
  assert.equal(sent.kind, 'ok');
  assert.match(sent.text, /^Two changes on the class list\n\n```markdown\n/);
  assert.match(sent.text, /Make this button say \\?"Book a place\\?"/);
  assert.match(sent.text, /A friendlier heading, please/);
  assert.match(sent.text, /maquette:documents\/booking\.maquette\.json#screen=classes&block=4/, 'the sent note names the maquette path, screen and block');
  assert.match(sent.text, /maquette:documents\/booking\.maquette\.json#screen=classes&block=0/);
  assert.match(sent.text, /Wheel throwing, beginners/, 'and the block\'s words (the screen is a visible region)');
});

test('without a feedback session the comment icon is hidden', async t => {
  const page = await panel(t, BOOKING);
  assert.ok(page.$('[data-testid=maquette-walk]'));
  assert.equal(page.$('[data-testid=maquette-comment]'), null, 'no comments prop: no icon');
  assert.ok(page.$('[data-testid=maquette-block][data-feedback-id]'), 'blocks stay marked, so a host\'s own feedback toggle still names them');
});

test('usePointComments without a session gives nothing, so the icon stays hidden', async t => {
  const page = await dom(t);
  const artifact = { schema: 'boring.artifact', version: 1, title: 'Booking', type: 'code', mediaType: 'application/json', language: 'json',
    target: { resource: { providerId: 'workspace', path: 'b.maquette.json' }, view: { kind: 'published' } }, revision: 'rev-1' };
  const client = { read: async () => ({ kind: 'available', snapshot: { bytes: new TextEncoder().encode(BOOKING), ref: { revision: 'rev-1', providerId: 'workspace', path: 'b.maquette.json' } } }), saves: async () => [], search: async () => [] };
  function Host() {
    const comments = kit.usePointComments(undefined);
    return page.h(kit.ArtifactPanel, { active: { descriptor: artifact, follow: false }, versions: [artifact], options: { client, identity: { runtimeId: 'fixture' }, kinds: [kit.createMaquetteKind({ comments })] }, onSelect: () => {}, onClose: () => {} });
  }
  await page.render(page.h(Host));
  await page.settle();
  assert.ok(page.$('[data-testid=maquette-walk]'));
  assert.equal(page.$('[data-testid=maquette-comment]'), null);
});
