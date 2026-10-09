// Runs inside the installed-recipe consumer (scripts/test-feedback-registry-consumer.mjs): the CLI-installed feedback components,
// bundled from the consumer's own src/components/feedback/, over the packed @hachej/boring-feedback. Fictional page and notes only.
import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';
import { parseFeedback } from '@hachej/boring-feedback/format';
import { createPrivacyPolicy, createOverlay } from '@hachej/boring-feedback/page';
import { captureAnnotation, createAnnotation } from '@hachej/boring-feedback/ui';

const restyled = process.env.BORING_REGISTRY_RESTYLED === 'true';

test('installed feedback recipe: pick, annotate, copy, save, list and show through the copied source', { timeout: 30000 }, async t => {
  const window = new Window({ url: 'https://fictional.invalid/settings/profile', settings: { disableJavaScriptFileLoading: true, disableCSSFileLoading: true, disableIframePageLoading: true } });
  const globals = new Map();
  for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Text', 'MutationObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame']) {
    globals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    const value = name === 'window' ? window : window[name];
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: typeof value === 'function' && /^[a-z]/.test(name) ? value.bind(window) : value });
  }
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  t.after(async () => {
    await window.happyDOM.close();
    for (const [name, descriptor] of globals) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; }
  });
  const { createElement, act } = await import('react');
  const { createRoot } = await import('react-dom/client');
  const { AnnotateSheet, FeedbackList, FeedbackReport, PointButton } = await import('../../dist/feedback.js');
  const { document } = window;
  document.body.innerHTML = `<div id="app"><main data-feedback-visible=""><form id="form"><button type="submit" id="save" data-feedback-id="save-profile">Save profile</button></form>
    <p id="private" hidden>never</p></main></div><div id="ui"></div>`;
  let submitted = 0;
  document.getElementById('form').addEventListener('submit', event => { event.preventDefault(); submitted++; });
  const app = document.getElementById('app');
  const policy = createPrivacyPolicy();
  const overlay = createOverlay({ document });
  const ui = createRoot(document.getElementById('ui'));
  const pinned = [];
  await act(async () => ui.render(createElement(PointButton, { root: () => app, policy, overlay, onPinned: elements => pinned.push(...elements) })));
  const point = document.querySelector('[data-testid=feedback-point]');
  assert.equal(point.closest('[data-boring="feedback"]').hasAttribute('data-feedback-ignore'), true);
  await act(async () => point.click());
  assert.equal(point.getAttribute('aria-pressed'), 'true');
  // Keyboard pick: Tab to the button, Enter pins it, and the form is never submitted.
  await act(async () => { window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Tab', cancelable: true })); });
  await act(async () => { window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', cancelable: true })); });
  assert.deepEqual(pinned, [document.getElementById('save')]);
  assert.equal(submitted, 0);

  const copied = [];
  const annotation = createAnnotation({ capture: await captureAnnotation({ app: 'fictional-settings', root: app, policy }, pinned), copyText: async text => { copied.push(text); return true; },
    save: async () => ({ kind: 'saved', id: 'fb_1111111111111111', revision: 'r1' }) });
  await act(async () => ui.render(createElement(AnnotateSheet, { annotation, onClose: () => {}, protection: 'unprotected', ...(restyled ? { title: 'Restyled feedback' } : {}) })));
  const sheet = document.querySelector('[data-testid=feedback-sheet]');
  assert.equal(sheet.getAttribute('data-boring'), 'feedback');
  if (restyled) assert.ok(sheet.classList.contains('host-installed-feedback'), 'the copied source is the host\'s to edit');
  const note = document.querySelector('[data-testid=feedback-note]');
  await act(async () => { const set = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set; set.call(note, 'Fictional note'); note.dispatchEvent(new window.Event('input', { bubbles: true })); });
  await act(async () => document.querySelector('[data-testid=feedback-copy]').click());
  await act(async () => document.querySelector('[data-testid=feedback-save]').click());
  assert.equal(parseFeedback(new TextEncoder().encode(copied[0])).ok, true);
  assert.equal(document.querySelector('[data-testid=feedback-status]').dataset.save, 'saved');
  assert.ok(document.querySelector('[data-testid=feedback-protection]'));

  const report = parseFeedback(new TextEncoder().encode(copied[0])).report;
  await act(async () => ui.render(createElement('div', null,
    createElement(FeedbackList, { items: [{ id: report.id, path: `feedback/${report.id}.md`, status: 'open', subject: 'host:app-page:fictional-settings:%2F', created: report.created, title: 'Fictional note', author: 'p_fictional_ada' }], protection: 'protected', onOpen: () => {} }),
    createElement(FeedbackReport, { report, page: { root: () => app, policy, overlay } }))));
  assert.equal(document.querySelectorAll('[data-testid=feedback-item]').length, 1);
  await act(async () => document.querySelector('[data-testid=feedback-show]').click());
  await act(async () => new Promise(resolve => setTimeout(resolve, 50)));
  assert.equal(document.querySelector('[data-testid=feedback-show-result]').dataset.kind, 'revealed');
  assert.deepEqual(overlay.drawn().map(item => item.tone), ['reveal']);
  await act(async () => ui.unmount());
  overlay.dispose();
});
