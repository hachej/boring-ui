import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { Window } from 'happy-dom';
import { createPicker, createPrivacyPolicy } from '@hachej/boring-feedback/page';
import { createFeedbackSession, isPointing } from '@hachej/boring-feedback/ui';

// Point mode for phones (FEEDBACK.md, "Point mode") on fictional HappyDOM pages. HappyDOM has no layout, so the picker gets a hit test
// that names the element "under the finger".
const root = fileURLToPath(new URL('../../', import.meta.url));
const policy = createPrivacyPolicy({ routeOf: ({ pathname }) => pathname.startsWith('/settings/') ? '/settings/:section' : pathname });
const PAGE = `<div id="app"><main data-feedback-visible=""><form id="profile"><button type="submit" id="save" data-feedback-id="save-profile">Save profile</button>
  <button type="button" id="plan" data-feedback-id="change-plan">Change plan</button></form><h2 id="heading">Notifications</h2></main></div>
  <nav id="tabs" data-feedback-ignore=""><button id="tab">Billing</button></nav><div id="ui" data-feedback-ignore=""></div>`;

function page(t) {
  const window = new Window({ url: 'https://fictional.invalid/settings/profile', settings: { disableJavaScriptFileLoading: true, disableCSSFileLoading: true, disableIframePageLoading: true } });
  window.document.body.innerHTML = PAGE;
  t.after(() => window.happyDOM.close());
  const { document } = window;
  return { window, document, root: document.getElementById('app'), $: id => document.getElementById(id) };
}

const pointer = (window, type, target, init = {}) => target.dispatchEvent(new window.PointerEvent(type, { bubbles: true, cancelable: true, composed: true, clientX: 10, clientY: 10, pointerType: 'touch', ...init }));
const touch = (window, type, target, x = 10, y = 10) => {
  const event = new window.Event(type, { bubbles: true, cancelable: true, composed: true });
  Object.defineProperty(event, 'changedTouches', { value: [{ clientX: x, clientY: y }] });
  return target.dispatchEvent(event);
};
/** A finger tap as a browser delivers it: pointerdown, touchstart, pointerup, touchend (and no click, the touchend is cancelled). */
function tap(window, target, { to } = {}) {
  pointer(window, 'pointerdown', target);
  touch(window, 'touchstart', target);
  const end = to ?? { x: 10, y: 10 };
  pointer(window, 'pointerup', target, { clientX: end.x, clientY: end.y });
  return touch(window, 'touchend', target, end.x, end.y);
}

test("picker tap: 'pick' hands one tap to onPick once, with no toolbar; a moved finger is a scroll, not a pick", t => {
  const context = page(t);
  const { window, $ } = context;
  const under = { current: [] };
  const picked = [];
  const picker = createPicker({ root: context.root, policy, hitTest: () => under.current, onPick: element => picked.push(element), tap: 'pick', wheel: false, keys: 'outside-ignored' });
  t.after(() => picker.dispose());
  void picker.start();
  under.current = [$('save')];
  const clicked = [];
  $('save').addEventListener('click', () => clicked.push('save'));
  assert.equal(tap(window, $('save')), false, 'the touchend is cancelled, so no click is synthesized');
  assert.deepEqual(picked, [$('save')], 'pointerup and touchend of one tap pick once');
  assert.deepEqual(clicked, []);
  assert.equal(picker.overlay.host.shadowRoot.querySelector('.toolbar').hidden, true, 'no Parent/Child/Pin toolbar');
  under.current = [$('plan')];
  tap(window, $('plan'), { to: { x: 10, y: 60 } });
  assert.deepEqual(picked, [$('save')], 'a finger that moved 50px scrolled the page');
  pointer(window, 'pointerdown', $('plan'));
  pointer(window, 'pointercancel', $('plan'));
  touch(window, 'touchend', $('plan'));
  assert.deepEqual(picked, [$('save')], 'a gesture the browser cancelled (a scroll) is no tap');
  // Out and back on a touch-action: none surface: no scroll cancels it, the finger ends 2px from where it started, but it moved 50px.
  pointer(window, 'pointerdown', $('plan'));
  touch(window, 'touchstart', $('plan'));
  pointer(window, 'pointermove', $('plan'), { clientX: 10, clientY: 60 });
  touch(window, 'touchmove', $('plan'), 10, 60);
  pointer(window, 'pointermove', $('plan'), { clientX: 10, clientY: 12 });
  touch(window, 'touchmove', $('plan'), 10, 12);
  pointer(window, 'pointerup', $('plan'), { clientX: 10, clientY: 12 });
  touch(window, 'touchend', $('plan'), 10, 12);
  assert.deepEqual(picked, [$('save')], 'a finger that went 50px out and came back is a drag, not a tap');
  tap(window, $('tab'));
  assert.deepEqual(picked, [$('save')], 'the tab bar is data-feedback-ignore: its taps reach it');
  tap(window, $('plan'));
  assert.deepEqual(picked, [$('save'), $('plan')]);
});

test("picker tap defaults to 'select': a tap still only selects (the touch toolbar pins)", t => {
  const context = page(t);
  const { window, $ } = context;
  const under = { current: [$('save')] };
  const picked = [];
  const picker = createPicker({ root: context.root, policy, hitTest: () => under.current, onPick: element => picked.push(element) });
  t.after(() => picker.dispose());
  void picker.start();
  tap(window, $('save'));
  assert.deepEqual(picked, []);
  assert.equal(picker.state().current, $('save'));
  assert.equal(picker.overlay.host.shadowRoot.querySelector('.toolbar').hidden, false);
});

test('session point mode: start({ mode: point }), one tap opens the bubble, a re-tap deselects, several picks, Done leaves the draft and ends pointing; Cancel leaves nothing', async t => {
  const context = page(t);
  const { window, $ } = context;
  const under = { current: [] };
  const session = createFeedbackSession({ app: 'fictional-settings', build: 'dev-fixture', root: context.root, policy, hitTest: () => under.current });
  t.after(() => session.dispose());
  assert.equal(session.getSnapshot().mode, 'feedback');
  assert.equal(isPointing(session.getSnapshot()), false);
  session.start({ mode: 'point' });
  assert.equal(session.getSnapshot().mode, 'point');
  assert.equal(isPointing(session.getSnapshot()), true);

  under.current = [$('save')];
  tap(window, $('save'));
  assert.equal(session.getSnapshot().bubble?.element, $('save'), 'one tap: the bubble opens on the element');
  tap(window, $('save'));
  assert.equal(session.getSnapshot().bubble, undefined, 're-tapping the selection deselects it');
  assert.equal(session.getSnapshot().notes.length, 0);

  tap(window, $('save'));
  session.setBubbleText('Say what it saves.');
  under.current = [$('plan')];
  tap(window, $('plan'));
  session.setBubbleText('Show the price first.');
  assert.equal(session.getSnapshot().notes[0].text, 'Say what it saves.', 'tapping another element keeps the first note');
  await session.done();
  assert.deepEqual(session.getSnapshot().notes.map(note => note.text), ['Say what it saves.', 'Show the price first.'], 'Done keeps the open note');
  assert.equal(session.getSnapshot().phase, 'review');
  assert.equal(isPointing(session.getSnapshot()), false, 'Done: the host shows its panel again');
  assert.equal(session.draft().notes.length, 2);
  assert.equal(session.draft().anchors.length, 2);
  session.sent();

  session.start({ mode: 'point' });
  under.current = [$('heading')];
  tap(window, $('heading'));
  session.setBubbleText('never mind');
  session.discard();
  assert.equal(session.getSnapshot().phase, 'idle');
  assert.equal(isPointing(session.getSnapshot()), false, 'Cancel: the panel comes back');
  assert.equal(session.getSnapshot().notes.length, 0, 'with no picks');
  session.start();
  assert.equal(session.getSnapshot().mode, 'feedback', 'a plain start is feedback mode again');
});

async function registry(t) {
  const out = join(root, '.cache/feedback-point-mode-test');
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'entry.tsx'), `export { PointBar, usePointing } from '${root}registry/feedback/point-mode.tsx';
export { NoteBubble, FeedbackChip, useComposerFeedback } from '${root}registry/feedback/feedback-session.tsx';
export { feedbackLabelsFr } from '${root}registry/feedback/feedback-labels.ts';`);
  await build({ entryPoints: [join(out, 'entry.tsx')], outfile: join(out, 'point-mode.mjs'), bundle: true, format: 'esm', platform: 'node', jsx: 'automatic', packages: 'external', logLevel: 'silent' });
  const window = new Window({ url: 'https://fictional.invalid/settings/profile', settings: { disableJavaScriptFileLoading: true, disableCSSFileLoading: true, disableIframePageLoading: true } });
  const globals = new Map();
  for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Text', 'MutationObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'IS_REACT_ACT_ENVIRONMENT']) {
    globals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    const value = name === 'IS_REACT_ACT_ENVIRONMENT' ? true : name === 'window' ? window : window[name];
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: typeof value === 'function' && /^[a-z]/.test(name) ? value.bind(window) : value });
  }
  t.after(async () => {
    await window.happyDOM.close();
    for (const [name, descriptor] of globals) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; }
  });
  const components = await import(pathToFileURL(join(out, 'point-mode.mjs')).href);
  const { createElement, act } = await import('react');
  const { createRoot } = await import('react-dom/client');
  return { window, document: window.document, components, createElement, act, createRoot };
}
const setValue = (window, element, value) => { Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(element, value); element.dispatchEvent(new window.Event('input', { bubbles: true })); };

test('registry: the annotate toggle on touch starts point mode, the host panel binds usePointing, PointBar counts picks, Terminé brings the panel back with the chip; Annuler with nothing', { timeout: 30000 }, async t => {
  const { window, document, components, createElement, act, createRoot } = await registry(t);
  const { PointBar, usePointing, NoteBubble, FeedbackChip, useComposerFeedback, feedbackLabelsFr } = components;
  document.body.innerHTML = PAGE;
  const $ = id => document.getElementById(id);
  const under = { current: [] };
  const session = createFeedbackSession({ app: 'fictional-settings', build: 'dev-fixture', root: $('app'), policy, hitTest: () => under.current,
    save: async () => ({ kind: 'saved', id: 'fb_7Q2mK9xRt4vW1cZp', revision: 'r1' }), mention: id => `feedback/${id}.md` });
  t.after(() => session.dispose());
  // A phone: a coarse pointer, so the one annotate toggle enters point mode.
  const media = Object.getOwnPropertyDescriptor(globalThis, 'matchMedia');
  Object.defineProperty(globalThis, 'matchMedia', { configurable: true, writable: true, value: () => ({ matches: true }) });
  t.after(() => { if (media) Object.defineProperty(globalThis, 'matchMedia', media); else delete globalThis.matchMedia; });
  let composer;
  function Host() {
    composer = useComposerFeedback(session);
    const pointing = usePointing(session);
    return createElement('div', null,
      createElement('section', { 'data-testid': 'panel', hidden: pointing }, createElement(FeedbackChip, { session })),
      createElement(NoteBubble, { session, labels: feedbackLabelsFr }),
      createElement(PointBar, { session, labels: feedbackLabelsFr, bottomOffset: '64px' }));
  }
  const ui = createRoot($('ui'));
  await act(async () => ui.render(createElement(Host)));
  assert.equal(typeof composer.annotate, 'function');
  assert.equal(composer.point, undefined, 'one toggle: no separate point action');
  assert.equal(document.querySelector('[data-testid=feedback-point-bar]'), null);

  await act(async () => composer.annotate());
  const bar = () => document.querySelector('[data-testid=feedback-point-bar]');
  assert.ok(bar(), 'the bar shows');
  assert.equal(bar().parentElement, document.body, 'portalled to the body, outside the hidden panel');
  assert.ok(bar().hasAttribute('data-feedback-ignore'));
  assert.equal(bar().getAttribute('aria-label'), 'Mode pointage');
  assert.match(bar().getAttribute('style'), /bottom: calc\(64px \+ env\(safe-area-inset-bottom, 0px\) \+ 8px\)/);
  assert.equal($('ui').querySelector('[data-testid=panel]').hidden, true, 'the host panel is hidden while pointing');
  assert.equal(composer.active, true);
  assert.equal(document.querySelector('[data-testid=feedback-point-hint]').textContent, 'Touchez un élément à commenter');
  assert.equal(document.querySelector('[data-testid=feedback-point-count]').textContent, '0 sélection');

  under.current = [$('save')];
  await act(async () => { tap(window, $('save')); });
  assert.equal(document.querySelector('[data-testid=feedback-point-count]').textContent, '1 sélection');
  assert.equal(document.querySelector('[data-testid=feedback-cancel-selection]').textContent, 'Annuler la sélection');
  await act(async () => setValue(window, document.querySelector('[data-testid=feedback-bubble-input]'), 'Dites ce qui est enregistré.'));
  under.current = [$('plan')];
  await act(async () => { tap(window, $('plan')); });
  await act(async () => setValue(window, document.querySelector('[data-testid=feedback-bubble-input]'), 'Montrer le prix.'));
  assert.equal(document.querySelector('[data-testid=feedback-point-count]').textContent, '2 sélections');
  await act(async () => document.querySelector('[data-testid=feedback-point-use-app]').click());
  assert.equal(bar().dataset.using, 'true');
  assert.equal(document.querySelector('[data-testid=feedback-point-hint]').textContent, 'Utilisez l’app, puis revenez commenter');
  await act(async () => document.querySelector('[data-testid=feedback-point-use-app]').click());

  await act(async () => { document.querySelector('[data-testid=feedback-point-done]').click(); await new Promise(resolve => setTimeout(resolve, 10)); });
  assert.equal(bar(), null);
  assert.equal($('ui').querySelector('[data-testid=panel]').hidden, false, 'Terminé: the panel is back');
  assert.equal(composer.count, 2);
  assert.match(document.querySelector('[data-testid=feedback-chip-open]').textContent, /2 notes/, 'the picks are the composer chip');
  assert.deepEqual(await composer.attach('Regardez.'), { kind: 'ok', text: 'Regardez.\n\n@feedback/fb_7Q2mK9xRt4vW1cZp.md' }, 'Send attaches as feedback always does');
  await act(async () => composer.sent());

  await act(async () => composer.annotate());
  under.current = [$('heading')];
  await act(async () => { tap(window, $('heading')); });
  await act(async () => document.querySelector('[data-testid=feedback-point-cancel]').click());
  assert.equal(bar(), null);
  assert.equal($('ui').querySelector('[data-testid=panel]').hidden, false, 'Annuler: the panel is back');
  assert.equal(composer.count, 0);
  assert.equal(document.querySelector('[data-testid=feedback-chip]'), null, 'with no picks');
  await act(async () => ui.unmount());
});
