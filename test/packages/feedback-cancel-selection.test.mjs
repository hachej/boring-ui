import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { Window } from 'happy-dom';
import { parseFeedback, FEEDBACK_FORMAT, feedbackText } from '@hachej/boring-feedback/format';
import { createPrivacyPolicy } from '@hachej/boring-feedback/page';
import { captureAnnotation, captureGeneral, createAnnotation, createFeedbackSession } from '@hachej/boring-feedback/ui';

// Cancelling a selection and asking a general question (no element): a person who clicked a zone is never forced to comment on it.
// State transitions first (headless), then the registry components (HappyDOM). Fictional page and notes only.
const root = fileURLToPath(new URL('../../', import.meta.url));
const policy = createPrivacyPolicy({ routeOf: ({ pathname }) => pathname.startsWith('/settings/') ? '/settings/:section' : pathname });
const PAGE = `<div id="app"><main data-feedback-visible=""><form id="profile"><button type="submit" id="save" data-feedback-id="save-profile">Save profile</button>
  <button type="button" id="plan" data-feedback-id="change-plan">Change plan</button></form><h2 id="heading">Notifications</h2></main></div><div id="ui" data-feedback-ignore=""></div>`;

function page(t) {
  const window = new Window({ url: 'https://fictional.invalid/settings/profile', settings: { disableJavaScriptFileLoading: true, disableCSSFileLoading: true, disableIframePageLoading: true } });
  window.document.body.innerHTML = PAGE;
  t.after(() => window.happyDOM.close());
  const { document } = window;
  return { window, document, root: document.getElementById('app'), $: id => document.getElementById(id) };
}
const host = context => ({ app: 'fictional-settings', build: 'dev-fixture', root: context.root, policy });
const parse = text => parseFeedback(new TextEncoder().encode(text));
const mouse = (window, type, target, init = {}) => target.dispatchEvent(new window.MouseEvent(type, { bubbles: true, cancelable: true, composed: true, clientX: 10, clientY: 10, detail: 1, ...init }));
const pointer = (window, type, target) => target.dispatchEvent(new window.PointerEvent(type, { bubbles: true, cancelable: true, composed: true, clientX: 10, clientY: 10, pointerType: 'mouse' }));
const keydown = (window, target, key) => target.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, composed: true }));
const press = (window, target) => { for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup']) (type.startsWith('pointer') ? pointer : mouse)(window, type, target); mouse(window, 'click', target); };

// --- the annotation (standalone sheet state) ---------------------------------------------------------------------------------------------

test('annotation: Cancel selection makes a general note with no anchor, keeps the typed text, and the report is feedback@1', async t => {
  const context = page(t);
  const copied = [];
  const annotation = createAnnotation({ capture: await captureAnnotation(host(context), [context.$('save')]), copyText: async text => { copied.push(text); return true; }, now: () => new Date('2026-10-05T10:00:00Z') });
  assert.equal(annotation.getSnapshot().selected, true);
  assert.equal(annotation.getSnapshot().targets.length, 1);
  annotation.setSaid('Est-ce que je peux changer de forfait ?');
  assert.equal(annotation.clearSelection(), true);
  const state = annotation.getSnapshot();
  assert.deepEqual([state.selected, state.anchors.length, state.targets.length, state.refused.length], [false, 0, 0, 0]);
  assert.equal(state.said, 'Est-ce que je peux changer de forfait ?', 'typed text is kept');
  assert.equal(annotation.clearSelection(), false, 'nothing left to cancel');
  assert.equal((await annotation.copy()).kind, 'copied');
  const parsed = parse(copied[0]);
  assert.equal(parsed.ok, true, JSON.stringify(parsed.problems));
  assert.equal(parsed.report.format, FEEDBACK_FORMAT);
  assert.deepEqual(parsed.report.anchors, []);
  assert.equal(parsed.report.notes, undefined);
  assert.equal(parsed.report.said, 'Est-ce que je peux changer de forfait ?');
  assert.ok(!copied[0].includes('[anchor'), 'no note points at an anchor');
});

test('annotation: a general note from the start (captureGeneral); an empty one is refused; a failed pin is not silently turned into a general note', async t => {
  const context = page(t);
  const copied = [];
  const general = createAnnotation({ capture: await captureGeneral(host(context)), copyText: async text => { copied.push(text); return true; } });
  assert.equal(general.getSnapshot().selected, false);
  assert.equal((await general.copy()).kind, 'refused', 'nothing said yet');
  general.setSaid('A general question about billing.');
  assert.equal((await general.copy()).kind, 'copied');
  assert.deepEqual(parse(copied[0]).report.anchors, []);
  // An element outside the root cannot be anchored: that is still an error (the zone would be lost), until the selection is cancelled.
  const outside = context.document.getElementById('ui');
  const failed = createAnnotation({ capture: await captureAnnotation(host(context), [outside]), said: 'About that zone', copyText: async text => { copied.push(text); return true; } });
  assert.equal(failed.getSnapshot().selected, true);
  const refused = await failed.copy();
  assert.equal(refused.kind, 'refused');
  assert.equal(failed.clearSelection(), true);
  assert.equal((await failed.copy()).kind, 'copied');
});

test('annotation: cancelling takes a fresh Save operation id, unless the old one may have reached the store; a saved draft cannot be cancelled', async t => {
  const context = page(t);
  let outcome = { kind: 'unknown', reason: 'no answer' };
  const requests = [];
  const annotation = createAnnotation({ capture: await captureAnnotation(host(context), [context.$('save')]), said: 'x',
    save: async request => { requests.push(request); return outcome; } });
  const first = annotation.getSnapshot().operationId;
  annotation.clearSelection();
  assert.notEqual(annotation.getSnapshot().operationId, first, 'nothing was sent: the changed draft gets a fresh id');

  const sent = createAnnotation({ capture: await captureAnnotation(host(context), [context.$('save')]), said: 'x', save: async request => { requests.push(request); return outcome; } });
  await sent.save();
  assert.equal(sent.getSnapshot().save.kind, 'unknown');
  const kept = sent.getSnapshot().operationId;
  assert.equal(sent.clearSelection(), true);
  assert.equal(sent.getSnapshot().operationId, kept, 'it may have reached the store: the id is kept and the store answers honestly');
  outcome = { kind: 'saved', id: 'fb_1111111111111111', revision: 'r1' };
  const done = createAnnotation({ capture: await captureAnnotation(host(context), [context.$('save')]), said: 'x', save: async () => outcome });
  await done.save();
  assert.equal(done.clearSelection(), false, 'a saved report is not rewritten');
  assert.equal(done.getSnapshot().selected, true);
});

// --- the session (feedback mode) ---------------------------------------------------------------------------------------------------

function sessionOn(t, context, options = {}) {
  const under = { current: [] };
  const session = createFeedbackSession({ ...host(context), hitTest: () => under.current, ...options });
  t.after(() => session.dispose());
  const pinAt = element => { under.current = [element]; pointer(context.window, 'pointermove', context.document.body); press(context.window, element); };
  return { session, pinAt };
}
const pinned = context => [...context.document.querySelectorAll('[data-feedback-overlay]')].flatMap(host => [...host.shadowRoot.querySelectorAll('.label')].filter(label => label.dataset.tone === 'pinned'));

test('session: select, then cancel by Esc, by clicking the zone again, or by the button; each leaves nothing selected and the person can pin again', async t => {
  const context = page(t);
  const { session, pinAt } = sessionOn(t, context);
  session.start();

  // Esc on the page closes the bubble of a new pin and drops the pin.
  pinAt(context.$('save'));
  assert.equal(session.getSnapshot().bubble.number, 1);
  keydown(context.window, context.document.body, 'Escape');
  assert.equal(session.getSnapshot().bubble, undefined);
  assert.equal(session.getSnapshot().notes.length, 0);
  assert.equal(pinned(context).length, 0);
  assert.equal(session.getSnapshot().phase, 'active', 'Esc never ends feedback mode');

  // Clicking the selected zone again clears the selection (no note is made, the pin is gone).
  pinAt(context.$('save'));
  assert.equal(session.getSnapshot().notes.length, 1);
  assert.equal(pinned(context).length, 1);
  pinAt(context.$('save'));
  assert.equal(session.getSnapshot().bubble, undefined);
  assert.equal(session.getSnapshot().notes.length, 0);
  assert.equal(pinned(context).length, 0);

  // The explicit button: even a pin with a note already typed is removed, and the text is kept for a general question.
  pinAt(context.$('plan'));
  session.setBubbleText('Peut-on payer par mois ?');
  session.cancelSelection();
  assert.equal(session.getSnapshot().bubble, undefined);
  assert.equal(session.getSnapshot().notes.length, 0);
  assert.equal(pinned(context).length, 0);
  session.askGeneral();
  assert.equal(session.getSnapshot().generalOpen, true);
  assert.equal(session.getSnapshot().general, 'Peut-on payer par mois ?', 'the typed text was kept');

  // Not stuck: another zone can be pinned; that closes the general field (the text stays in the draft).
  pinAt(context.$('heading'));
  assert.equal(session.getSnapshot().generalOpen, false);
  assert.equal(session.getSnapshot().bubble.number, 1);
  assert.equal(session.getSnapshot().general, 'Peut-on payer par mois ?');
  session.cancelSelection();
  assert.equal(session.getSnapshot().notes.length, 0);
});

test('session: a reopened pin whose bubble is closed reopens on click; Esc then leaves its note as it was; cancelSelection removes it', async t => {
  const context = page(t);
  const { session, pinAt } = sessionOn(t, context);
  session.start();
  pinAt(context.$('save'));
  session.setBubbleText('Say what it saves.');
  session.saveBubble();
  pinAt(context.$('save'));
  assert.equal(session.getSnapshot().bubble.fresh, false, 'closed bubble: the click reopens it');
  session.setBubbleText('changed');
  keydown(context.window, context.document.body, 'Escape');
  assert.equal(session.getSnapshot().notes[0].text, 'Say what it saves.', 'Esc leaves a written note as it was');
  pinAt(context.$('save'));
  pinAt(context.$('save'));
  assert.equal(session.getSnapshot().notes.length, 0, 'second click on the open zone cancels the selection, note included');
  assert.equal(session.getSnapshot().general, '');
});

test('session: a general question has no element: Done gives a report with no anchor, and the pin text typed before Esc is not lost', async t => {
  const context = page(t);
  const { session, pinAt } = sessionOn(t, context);
  session.start();
  pinAt(context.$('save'));
  session.setBubbleText('Est-ce que je peux exporter mes données ?');
  keydown(context.window, context.document.body, 'Escape');
  assert.equal(session.getSnapshot().notes.length, 0);
  session.askGeneral();
  assert.equal(session.getSnapshot().generalOpen, true);
  assert.equal(session.getSnapshot().general, 'Est-ce que je peux exporter mes données ?');
  session.setGeneral('Est-ce que je peux exporter mes données ?\nEn CSV de préférence.');
  // Esc on the page closes the general field, keeping the text.
  keydown(context.window, context.document.body, 'Escape');
  assert.equal(session.getSnapshot().generalOpen, false);
  assert.match(session.getSnapshot().general, /CSV/);
  session.askGeneral();
  session.closeGeneral();
  assert.equal(session.getSnapshot().generalOpen, false);

  await session.done();
  assert.equal(session.getSnapshot().phase, 'review');
  const draft = session.draft();
  assert.deepEqual(draft.anchors, []);
  assert.equal(draft.notes, undefined);
  const text = session.reportText();
  const parsed = parse(text);
  assert.equal(parsed.ok, true, JSON.stringify(parsed.problems));
  assert.deepEqual(parsed.report.anchors, []);
  assert.equal(parsed.report.said, 'Est-ce que je peux exporter mes données ?\nEn CSV de préférence.');
  assert.equal(feedbackText(parsed.report).includes('[anchor'), false);
});

test('session: with nothing typed anywhere, Done after a cancelled selection leaves feedback mode without a draft', async t => {
  const context = page(t);
  const { session, pinAt } = sessionOn(t, context);
  session.start();
  pinAt(context.$('save'));
  session.cancelSelection();
  session.askGeneral();
  session.closeGeneral();
  await session.done();
  assert.equal(session.getSnapshot().phase, 'idle');
});

// --- the registry components --------------------------------------------------------------------------------------------------------

async function registry(t, entry, name) {
  const out = join(root, '.cache/feedback-cancel-test');
  mkdirSync(out, { recursive: true });
  await build({ entryPoints: [join(root, 'registry/feedback', entry)], outfile: join(out, `${name}.mjs`), bundle: true, format: 'esm', platform: 'node', jsx: 'automatic', packages: 'external', logLevel: 'silent' });
  const window = new Window({ url: 'https://fictional.invalid/settings/profile', settings: { disableJavaScriptFileLoading: true, disableCSSFileLoading: true, disableIframePageLoading: true } });
  const globals = new Map();
  for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Text', 'MutationObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'IS_REACT_ACT_ENVIRONMENT']) {
    globals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    const value = key === 'IS_REACT_ACT_ENVIRONMENT' ? true : key === 'window' ? window : window[key];
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: typeof value === 'function' && /^[a-z]/.test(key) ? value.bind(window) : value });
  }
  t.after(async () => {
    await window.happyDOM.close();
    for (const [key, descriptor] of globals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; }
  });
  const components = await import(pathToFileURL(join(out, `${name}.mjs`)).href);
  await build({ entryPoints: [join(root, 'registry/feedback/feedback-labels.ts')], outfile: join(out, 'labels.mjs'), bundle: true, format: 'esm', platform: 'node', logLevel: 'silent' });
  const labels = await import(pathToFileURL(join(out, 'labels.mjs')).href);
  const { createElement, act } = await import('react');
  const { createRoot } = await import('react-dom/client');
  return { window, document: window.document, components, labels, createElement, act, createRoot };
}
const setValue = (window, element, value) => { Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(element, value); element.dispatchEvent(new window.Event('input', { bubbles: true })); };

test('registry bubble: Annuler la sélection, Esc, a second click on the zone, with French labels and announcements; no general-question entry anywhere in the UI', { timeout: 30000 }, async t => {
  const { window, document, components, labels, createElement, act, createRoot } = await registry(t, 'feedback-session.tsx', 'feedback-session');
  const { FeedbackBar, NoteBubble } = components;
  const fr = labels.feedbackLabelsFr;
  assert.equal(fr.cancelSelection, 'Annuler la sélection');
  assert.equal(fr.askGeneral, 'Poser une question générale', 'the label stays for the Release 1 sheet');
  document.body.innerHTML = PAGE;
  const context = { window, document, root: document.getElementById('app'), $: id => document.getElementById(id) };
  const { session, pinAt } = sessionOn(t, context);
  const ui = createRoot(document.getElementById('ui'));
  await act(async () => ui.render(createElement('div', null, createElement(FeedbackBar, { session, labels: fr }), createElement(NoteBubble, { session, labels: fr }))));
  const q = id => document.querySelector(`[data-testid=${id}]`);
  assert.equal(q('feedback-general'), null, 'no bar before feedback mode');
  await act(async () => session.start());
  assert.equal(q('feedback-general'), null, 'the bar has no general-question entry');

  // Button.
  await act(async () => pinAt(context.$('save')));
  assert.equal(document.activeElement, q('feedback-bubble-input'), 'focus goes into the note');
  assert.equal(q('feedback-bubble-input').getAttribute('placeholder'), fr.bubblePlaceholder);
  await act(async () => setValue(window, q('feedback-bubble-input'), 'Une question ?'));
  assert.equal(q('feedback-cancel-selection').textContent, 'Annuler la sélection');
  await act(async () => q('feedback-cancel-selection').click());
  assert.equal(q('feedback-bubble'), null);
  assert.equal(session.getSnapshot().notes.length, 0);
  assert.equal(q('feedback-bubble-announce').textContent, 'Sélection annulée.', 'the cancellation is announced');

  // Esc inside the field.
  await act(async () => pinAt(context.$('plan')));
  await act(async () => { keydown(window, q('feedback-bubble-input'), 'Escape'); });
  assert.equal(q('feedback-bubble'), null);
  assert.equal(session.getSnapshot().notes.length, 0);

  // Second click on the zone.
  await act(async () => pinAt(context.$('plan')));
  assert.ok(q('feedback-bubble'));
  await act(async () => pinAt(context.$('plan')));
  assert.equal(q('feedback-bubble'), null);

  // No general question in the pin: a general note is the plain chat (the session API keeps captureGeneral/askGeneral).
  await act(async () => pinAt(context.$('heading')));
  assert.equal(q('feedback-bubble-general'), null);
  assert.equal(q('feedback-general-bubble'), null);
  assert.equal(document.body.textContent.includes('Poser une question générale'), false);
  await act(async () => setValue(window, q('feedback-bubble-input'), 'Comment annuler mon abonnement ?'));
  assert.equal(q('feedback-bubble-save').textContent, 'Ajouter la note');
  assert.match(q('feedback-bubble-hint').textContent, /Maintenez ⌥ pour utiliser l’app/);
  await act(async () => q('feedback-bubble-save').click());
  assert.equal(q('feedback-bubble'), null);
  assert.equal(q('feedback-bar-count').textContent, '1 note');
  await act(async () => { q('feedback-done').click(); await new Promise(resolve => setTimeout(resolve, 10)); });
  assert.equal(session.getSnapshot().phase, 'review');
  await act(async () => ui.unmount());
});

test('registry sheet: Esc, the button and a second click on the zone cancel the selection (focus stays in the note); a general sheet has no zone and Esc closes it', { timeout: 30000 }, async t => {
  const { window, document, components, labels, createElement, act, createRoot } = await registry(t, 'annotate-sheet.tsx', 'annotate-sheet');
  const { AnnotateSheet } = components;
  const fr = labels.feedbackLabelsFr;
  document.body.innerHTML = PAGE;
  const context = { window, document, root: document.getElementById('app'), $: id => document.getElementById(id) };
  const ui = createRoot(document.getElementById('ui'));
  const q = id => document.querySelector(`[data-testid=${id}]`);
  const copied = [];
  const make = async elements => createAnnotation({ capture: await captureAnnotation(host(context), elements), copyText: async text => { copied.push(text); return true; } });
  const render = async (annotation, props = {}) => act(async () => ui.render(createElement(AnnotateSheet, { annotation, onClose: () => closed.push('close'), labels: fr, ...props })));
  const closed = [];
  const clicks = [];
  context.$('save').addEventListener('click', () => clicks.push('save'));

  // The button.
  let annotation = await make([context.$('save')]);
  await render(annotation, { near: context.$('save'), onCancelSelection: () => closed.push('cancel') });
  assert.equal(q('feedback-sheet').dataset.selected, 'true');
  assert.equal(q('feedback-cancel-selection').textContent, 'Annuler la sélection');
  assert.equal(q('feedback-targets').children.length, 1);
  await act(async () => setValue(window, q('feedback-note'), 'Texte déjà saisi'));
  await act(async () => q('feedback-cancel-selection').click());
  assert.deepEqual(closed, ['cancel']);
  assert.equal(annotation.getSnapshot().selected, false);
  assert.equal(q('feedback-sheet').dataset.selected, 'false');
  assert.equal(q('feedback-cancel-selection'), null, 'no zone left to cancel');
  assert.equal(q('feedback-targets'), null);
  assert.equal(q('feedback-sheet').getAttribute('aria-label'), 'Poser une question générale');
  assert.equal(q('feedback-note').value, 'Texte déjà saisi', 'the typed text is kept');
  assert.match(q('feedback-status').textContent, /Sélection annulée/);
  assert.equal(document.activeElement, q('feedback-note'));
  await act(async () => q('feedback-copy').click());
  assert.deepEqual(parse(copied[0]).report.anchors, []);
  // Esc on a general sheet closes it.
  await act(async () => { keydown(window, q('feedback-note'), 'Escape'); });
  assert.deepEqual(closed, ['cancel', 'close']);

  // Esc on a selected zone: first Esc cancels the selection, the second closes.
  closed.length = 0;
  annotation = await make([context.$('save')]);
  await render(annotation, { near: context.$('save') });
  await act(async () => { keydown(window, q('feedback-note'), 'Escape'); });
  assert.equal(annotation.getSnapshot().selected, false);
  assert.deepEqual(closed, [], 'Esc cancelled the selection and did not close the sheet');
  await act(async () => { keydown(window, q('feedback-note'), 'Escape'); });
  assert.deepEqual(closed, ['close']);

  // A second click on the selected zone cancels instead of pressing it; elsewhere clicks are untouched.
  closed.length = 0;
  annotation = await make([context.$('save')]);
  await render(annotation, { near: context.$('save'), onCancelSelection: () => closed.push('cancel') });
  const other = new window.MouseEvent('click', { bubbles: true, cancelable: true, composed: true });
  await act(async () => { context.$('plan').dispatchEvent(other); });
  assert.equal(annotation.getSnapshot().selected, true);
  const again = new window.MouseEvent('click', { bubbles: true, cancelable: true, composed: true });
  await act(async () => { context.$('save').dispatchEvent(again); });
  assert.equal(again.defaultPrevented, true);
  assert.deepEqual(clicks, [], 'the zone was not pressed');
  assert.equal(annotation.getSnapshot().selected, false);
  assert.deepEqual(closed, ['cancel']);

  // A general note from the start.
  annotation = await createAnnotation({ capture: await captureGeneral(host(context)) });
  await render(annotation);
  assert.equal(q('feedback-sheet').getAttribute('aria-label'), 'Poser une question générale');
  assert.equal(q('feedback-cancel-selection'), null);
  assert.equal(q('feedback-close').getAttribute('aria-label'), 'Fermer');
  await act(async () => ui.unmount());
});
