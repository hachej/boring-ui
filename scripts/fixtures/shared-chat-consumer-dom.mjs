import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
const window = new Window({ url: 'https://fictional.invalid/' });
for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Text', 'DOMParser', 'MutationObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'ResizeObserver', 'sessionStorage', 'localStorage', 'matchMedia']) {
  const value = name === 'window' ? window : window[name];
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: typeof value === 'function' && /^[a-z]/.test(name) ? value.bind(window) : value });
}
document.body.innerHTML = '<div id="root"></div>';
const { fixture, view } = await import('./dist/page.js');
const q = selector => document.querySelector(selector);
async function until(ready) { for (let n = 0; n < 300 && !ready(); n++) await new Promise(resolve => setTimeout(resolve, 10)); assert.ok(ready()); }
try {
  await until(() => q('[data-shared-message=hello] [data-slot=bubble]'));
  assert.equal(q('[data-shared-message=hello] [data-slot=bubble]').dataset.variant, 'muted');
  const textarea = q('[data-testid=composer-input]');
  Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(textarea, 'A fictional reply');
  textarea.dispatchEvent(new window.Event('input', { bubbles: true }));
  await until(() => !q('[data-testid=composer-submit]').disabled);
  q('[data-testid=composer-submit]').click();
  await until(() => fixture.sends.length === 1);
  await until(() => document.body.textContent.includes('A fictional reply'));
  fixture.emit({ type: 'message', message: { id: 'card', author: 'pm', conversationId: 'main', at: new Date().toISOString(), card: { requestId: 'pdf', title: 'Export PDF', line: 'On attend votre essai', action: { id: 'try', label: 'Try version' } } } });
  await until(() => q('[data-testid=request-card] button'));
  q('[data-testid=request-card] button').click();
  await until(() => fixture.actions.length === 1);
  assert.equal(fixture.actions[0].actionId, 'try');
  console.log('PASS: installed optional item renders colleague bubbles, sends through the fake source and drives the host card action');
} finally { view.unmount(); await window.happyDOM.close(); }
