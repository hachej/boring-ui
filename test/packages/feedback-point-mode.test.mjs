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
  writeFileSync(join(out, 'entry.tsx'), `export { CommentBanner, useCommenting, usePointing } from '${root}registry/feedback/point-mode.tsx';
export { NoteBubble, FeedbackChip, useComposerFeedback, useSendEachNote } from '${root}registry/feedback/feedback-session.tsx';
export { feedbackLabels, feedbackLabelsFr, plainElement } from '${root}registry/feedback/feedback-labels.ts';`);
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

function phone(t, coarse) {
  const media = Object.getOwnPropertyDescriptor(globalThis, 'matchMedia');
  Object.defineProperty(globalThis, 'matchMedia', { configurable: true, writable: true, value: () => ({ matches: coarse }) });
  t.after(() => { if (media) Object.defineProperty(globalThis, 'matchMedia', media); else delete globalThis.matchMedia; });
}

test('registry: the annotate toggle on touch starts point mode, the host panel binds usePointing, CommentBanner counts notes, the switch pauses, Terminé brings the panel back with the chip', { timeout: 30000 }, async t => {
  const { window, document, components, createElement, act, createRoot } = await registry(t);
  const { CommentBanner, usePointing, NoteBubble, FeedbackChip, useComposerFeedback, feedbackLabelsFr } = components;
  document.body.innerHTML = PAGE;
  const $ = id => document.getElementById(id);
  const under = { current: [] };
  const session = createFeedbackSession({ app: 'fictional-settings', build: 'dev-fixture', root: $('app'), policy, hitTest: () => under.current,
    save: async () => ({ kind: 'saved', id: 'fb_7Q2mK9xRt4vW1cZp', revision: 'r1' }), mention: id => `feedback/${id}.md` });
  t.after(() => session.dispose());
  // A phone: a coarse pointer, so the one annotate toggle enters point mode.
  phone(t, true);
  let composer;
  function Host() {
    composer = useComposerFeedback(session);
    const pointing = usePointing(session);
    return createElement('div', null,
      createElement('section', { 'data-testid': 'panel', hidden: pointing }, createElement(FeedbackChip, { session })),
      createElement(NoteBubble, { session, labels: feedbackLabelsFr }),
      createElement(CommentBanner, { session, labels: feedbackLabelsFr, bottomOffset: '64px' }));
  }
  const ui = createRoot($('ui'));
  await act(async () => ui.render(createElement(Host)));
  assert.equal(typeof composer.annotate, 'function');
  assert.equal(composer.point, undefined, 'one toggle: no separate point action');
  assert.equal(document.querySelector('[data-testid=feedback-point-bar]'), null);

  await act(async () => composer.annotate());
  const bar = () => document.querySelector('[data-testid=feedback-point-bar]');
  const hint = () => document.querySelector('[data-testid=feedback-point-hint]').textContent;
  const count = () => document.querySelector('[data-testid=feedback-point-count]')?.textContent;
  assert.ok(bar(), 'the banner shows');
  assert.equal(bar().parentElement, document.body, 'portalled to the body, outside the hidden panel');
  assert.ok(bar().hasAttribute('data-feedback-ignore'));
  assert.equal(bar().getAttribute('aria-label'), 'Mode commentaire');
  assert.equal(bar().dataset.feedbackPointBar, 'bottom', 'on a phone the banner sits at the bottom');
  assert.match(bar().getAttribute('style'), /bottom: calc\(64px \+ env\(safe-area-inset-bottom, 0px\) \+ 8px\)/);
  assert.equal($('ui').querySelector('[data-testid=panel]').hidden, true, 'the host panel is hidden while pointing');
  assert.equal(composer.active, true);
  assert.equal(hint(), 'Touchez un élément pour le commenter');
  assert.equal(count(), undefined, 'no count before a note says something');
  assert.equal(document.querySelector('[data-testid=feedback-point-cancel]'), null, 'no Cancel in the banner: a note is removed on its own');

  under.current = [$('save')];
  await act(async () => { tap(window, $('save')); });
  assert.match(document.querySelector('[data-testid=feedback-bubble-label]').textContent, /^Bouton\b/, 'the element is named in plain words');
  assert.doesNotMatch(document.querySelector('[data-testid=feedback-bubble-label]').textContent, /masked|button/, 'nothing technical');
  assert.equal(count(), undefined, 'a pin still being typed is not a note yet');
  await act(async () => setValue(window, document.querySelector('[data-testid=feedback-bubble-input]'), 'Dites ce qui est enregistré.'));
  under.current = [$('plan')];
  await act(async () => { tap(window, $('plan')); });
  await act(async () => setValue(window, document.querySelector('[data-testid=feedback-bubble-input]'), 'Montrer le prix.'));
  assert.equal(count(), ' · 1 note');
  await act(async () => document.querySelector('[data-testid=feedback-bubble-save]').click());
  assert.equal(count(), ' · 2 notes');
  const toggle = () => document.querySelector('[data-testid=feedback-comment-switch]');
  assert.equal(toggle().getAttribute('aria-checked'), 'true', 'the switch is on while commenting');
  await act(async () => toggle().click());
  assert.equal(bar().dataset.commenting, 'false');
  assert.equal(session.getSnapshot().useToggle, true, 'off: taps reach the app');
  assert.equal(hint(), 'En pause : utilisez l’app, puis réactivez');
  assert.equal(count(), ' · 2 notes', 'the notes stay while paused');
  await act(async () => toggle().click());
  assert.equal(bar().dataset.commenting, 'true');

  await act(async () => { document.querySelector('[data-testid=feedback-point-done]').click(); await new Promise(resolve => setTimeout(resolve, 10)); });
  assert.equal(bar(), null);
  assert.equal($('ui').querySelector('[data-testid=panel]').hidden, false, 'Terminé: the panel is back');
  assert.equal(composer.count, 2);
  assert.match(document.querySelector('[data-testid=feedback-chip-open]').textContent, /2 notes/, 'the picks are the composer chip');
  assert.deepEqual(await composer.attach('Regardez.'), { kind: 'ok', text: 'Regardez.\n\n@feedback/fb_7Q2mK9xRt4vW1cZp.md' }, 'Send attaches as feedback always does');
  await act(async () => composer.sent());
  await act(async () => ui.unmount());
});

test('registry: with a mouse the banner sits at the top, useCommenting is true while usePointing stays false, and a click picks', { timeout: 30000 }, async t => {
  const { document, components, createElement, act, createRoot } = await registry(t);
  const { CommentBanner, useCommenting, usePointing, useComposerFeedback, feedbackLabels } = components;
  document.body.innerHTML = PAGE;
  const $ = id => document.getElementById(id);
  const session = createFeedbackSession({ app: 'fictional-settings', build: 'dev-fixture', root: $('app'), policy, hitTest: () => [$('save')],
    save: async () => ({ kind: 'saved', id: 'fb_7Q2mK9xRt4vW1cZp', revision: 'r1' }), mention: id => `feedback/${id}.md` });
  t.after(() => session.dispose());
  phone(t, false);
  let composer, flags;
  function Host() {
    composer = useComposerFeedback(session);
    flags = { commenting: useCommenting(session), pointing: usePointing(session) };
    return createElement(CommentBanner, { session, labels: feedbackLabels });
  }
  const ui = createRoot($('ui'));
  await act(async () => ui.render(createElement(Host)));
  assert.deepEqual(flags, { commenting: false, pointing: false });
  await act(async () => composer.annotate());
  assert.deepEqual(flags, { commenting: true, pointing: false }, 'comment mode, not point mode');
  const bar = document.querySelector('[data-testid=feedback-point-bar]');
  assert.equal(bar.dataset.feedbackPointBar, 'top');
  assert.match(bar.getAttribute('style'), /top: 8px/);
  assert.equal(bar.getAttribute('aria-label'), 'Comment mode');
  assert.equal(document.querySelector('[data-testid=feedback-point-hint]').textContent, 'Click an element to comment on it');
  await act(async () => { document.querySelector('[data-testid=feedback-point-done]').click(); await new Promise(resolve => setTimeout(resolve, 10)); });
  assert.deepEqual(flags, { commenting: false, pointing: false });
  await act(async () => ui.unmount());
});

test('registry: an inline banner stays where it is mounted (over one surface, such as a side panel), not portalled to the body', { timeout: 30000 }, async t => {
  const { document, components, createElement, act, createRoot } = await registry(t);
  const { CommentBanner, useComposerFeedback, feedbackLabels } = components;
  document.body.innerHTML = PAGE;
  const $ = id => document.getElementById(id);
  const session = createFeedbackSession({ app: 'fictional-settings', build: 'dev-fixture', root: $('app'), policy, hitTest: () => [$('save')],
    save: async () => ({ kind: 'saved', id: 'fb_7Q2mK9xRt4vW1cZp', revision: 'r1' }), mention: id => `feedback/${id}.md` });
  t.after(() => session.dispose());
  phone(t, false);
  let composer;
  function Host() {
    composer = useComposerFeedback(session);
    return createElement('div', { id: 'surface' }, createElement(CommentBanner, { session, labels: feedbackLabels, inline: true }));
  }
  const ui = createRoot($('ui'));
  await act(async () => ui.render(createElement(Host)));
  await act(async () => composer.annotate());
  const bar = document.querySelector('[data-testid=feedback-point-bar]');
  assert.equal(bar.parentElement, $('surface'), 'mounted in the surface it comments');
  assert.equal(bar.dataset.feedbackPointBar, 'top');
  await act(async () => { document.querySelector('[data-testid=feedback-point-done]').click(); await new Promise(resolve => setTimeout(resolve, 10)); });
  assert.equal(document.querySelector('[data-testid=feedback-point-bar]'), null);
  await act(async () => ui.unmount());
});

test('registry: useSendEachNote sends each note to the chat the moment it is added, keeps comment mode on, and the banner counts what was sent', { timeout: 30000 }, async t => {
  const { window, document, components, createElement, act, createRoot } = await registry(t);
  const { CommentBanner, NoteBubble, useComposerFeedback, useSendEachNote, feedbackLabelsFr } = components;
  document.body.innerHTML = PAGE;
  const $ = id => document.getElementById(id);
  const under = { current: [] };
  const session = createFeedbackSession({ app: 'fictional-settings', build: 'dev-fixture', root: $('app'), policy, hitTest: () => under.current });
  t.after(() => session.dispose());
  phone(t, true);
  const sent = [];
  const send = async text => { sent.push(text); return true; };
  let composer;
  function Host() {
    composer = useComposerFeedback(session);
    useSendEachNote(session, send);
    return createElement('div', null, createElement(NoteBubble, { session, labels: feedbackLabelsFr }), createElement(CommentBanner, { session, labels: feedbackLabelsFr }));
  }
  const ui = createRoot($('ui'));
  await act(async () => ui.render(createElement(Host)));
  await act(async () => composer.annotate());
  under.current = [$('save')];
  await act(async () => { tap(window, $('save')); });
  await act(async () => setValue(window, document.querySelector('[data-testid=feedback-bubble-input]'), 'Dites ce qui est enregistré.'));
  assert.equal(sent.length, 0, 'nothing is sent while the note is typed');
  await act(async () => { document.querySelector('[data-testid=feedback-bubble-save]').click(); await new Promise(resolve => setTimeout(resolve, 20)); });
  assert.equal(sent.length, 1, 'the note went at once');
  assert.match(sent[0], /Dites ce qui est enregistré\./);
  assert.equal(session.getSnapshot().phase, 'active', 'comment mode stays on for the next note');
  assert.equal(session.getSnapshot().notes.length, 0, 'nothing waits in a hidden batch');
  assert.equal(document.querySelector('[data-testid=feedback-point-hint]').textContent, 'Note envoyée : la réponse arrive dans la conversation (Terminé)');
  under.current = [$('plan')];
  await act(async () => { tap(window, $('plan')); });
  await act(async () => setValue(window, document.querySelector('[data-testid=feedback-bubble-input]'), 'Montrer le prix.'));
  await act(async () => { document.querySelector('[data-testid=feedback-bubble-save]').click(); await new Promise(resolve => setTimeout(resolve, 20)); });
  assert.equal(sent.length, 2);
  assert.match(sent[1], /Montrer le prix\./);
  assert.doesNotMatch(sent[1], /Dites ce qui est enregistré/, 'each message carries its own note only');
  assert.equal(document.querySelector('[data-testid=feedback-point-hint]').textContent, '2 notes envoyées : la réponse arrive dans la conversation (Terminé)');
  await act(async () => { document.querySelector('[data-testid=feedback-point-done]').click(); await new Promise(resolve => setTimeout(resolve, 10)); });
  assert.equal(session.getSnapshot().phase, 'idle');
  await act(async () => composer.annotate());
  assert.equal(document.querySelector('[data-testid=feedback-point-hint]').textContent, 'Touchez un élément pour le commenter', 'a new round starts at zero');
  await act(async () => ui.unmount());
});

test('plainElement names the picked element in plain words, never the policy\'s technical label', { timeout: 30000 }, async t => {
  const { plainElement, feedbackLabels, feedbackLabelsFr } = (await registry(t)).components;
  assert.equal(plainElement('button «Save»', feedbackLabels), 'Button « Save »');
  assert.equal(plainElement('button · masked', feedbackLabelsFr), 'Bouton');
  assert.equal(plainElement('Form.tsx · link «Help»', feedbackLabels), 'Link « Help »');
  assert.equal(plainElement('masked', feedbackLabelsFr), 'Cet élément');
  assert.equal(plainElement('section · masked', feedbackLabels), 'This element');
});
