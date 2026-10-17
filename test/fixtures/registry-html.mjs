import './registry-html-dom.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { Window } from 'happy-dom';
import { createHtmlController } from '@hachej/boring-ui-kit/html';
import { openSqliteWorkspaces } from '../../shared/sqlite-workspaces.mjs';

test('installed HTML source recipe uses host shadcn controls and preserves its concrete controller', async t => {
  const window = new Window({ url: 'https://fictional.invalid/', settings: { enableJavaScriptEvaluation: false, disableIframePageLoading: true } });
  const globals = new Map();
  for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'MutationObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame']) {
    globals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: name === 'window' ? window : typeof window[name] === 'function' && /^[a-z]/.test(name) ? window[name].bind(window) : window[name] });
  }
  globals.set('IS_REACT_ACT_ENVIRONMENT', Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT'));
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const { createElement, act } = await import('react');
  const { createRoot } = await import('react-dom/client');
  const { HtmlViewer } = await import('../../dist/html-viewer.js');
  const provider = openSqliteWorkspaces({ filename: ':memory:', providerId: 'fictional-html-registry', authorize: () => true });
  const identity = { scopeId: 'fictional-project', principalId: 'editor', initiatorId: 'alice' };
  const target = { resource: { providerId: provider.providerId, path: 'page.html' }, view: { kind: 'published' } };
  const controller = createHtmlController({ identity, source: { kind: 'new', target, text: '<p>Fictional HTML</p>' }, instanceId: 'installed-html', epoch: 'page', client: {
    read: request => provider.read(request, identity), publish: request => provider.publication.publish(request, identity), lookup: operationId => provider.reconciliation.lookup(operationId, identity),
  } });
  const unrelated = document.createElement('button'); unrelated.textContent = 'Host control'; document.body.append(unrelated);
  document.body.style.setProperty('--background', 'rgb(16, 24, 32)');
  document.body.style.setProperty('--foreground', 'rgb(248, 250, 252)');
  const baseline = window.getComputedStyle(unrelated).cssText;
  const stylesheet = document.createElement('style');
  stylesheet.textContent = await readFile(new URL('../../src/index.css', import.meta.url), 'utf8'); document.head.append(stylesheet);
  const container = document.createElement('div'); document.body.append(container);
  const root = createRoot(container);
  let mounted = true;
  t.after(async () => {
    if (mounted) await act(async () => root.unmount());
    controller.dispose(); provider.close();
    await window.happyDOM.close();
    for (const [name, descriptor] of globals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name];
    }
  });
  await act(async () => root.render(createElement(HtmlViewer, { controller, title: 'Installed HTML', className: 'host-extra-class' })));
  const section = container.querySelector('[data-boring="html-viewer"]');
  assert.ok(section.classList.contains('boring-html-recipe'));
  assert.ok(section.classList.contains('host-extra-class'));
  assert.equal(section.style.cssText, '', 'the wrapper adds no visual overrides');
  assert.equal(section.classList.contains('host-installed-html'), false, 'rebranding changes core tokens, not copied source');
  if (process.env.BORING_REGISTRY_RESTYLED === 'true') assert.equal(window.getComputedStyle(document.documentElement).getPropertyValue('--radius').trim(), '1.25rem');
  for (const button of container.querySelectorAll('button')) assert.ok(['button', 'toggle'].includes(button.dataset.slot), 'actions use the host shadcn components');
  assert.equal(window.getComputedStyle(unrelated).cssText, baseline);
  const source = [...container.querySelectorAll('button')].find(button => button.textContent === 'HTML source');
  await act(async () => source.click());
  assert.equal(container.querySelector('textarea').value, '<p>Fictional HTML</p>');
  assert.equal(container.querySelector('textarea').dataset.slot, 'textarea');
  assert.equal(source.getAttribute('aria-pressed'), 'true', 'source remains a controlled native Toggle');
  let saved;
  await act(async () => { saved = await controller.flush(controller.actions.selection()); });
  assert.equal(saved.kind, 'saved');
  assert.deepEqual(await provider.reconciliation.lookup(saved.receipt.operationId, identity), { kind: 'committed', receipt: saved.receipt });
  await act(async () => root.unmount());
  mounted = false;
  assert.equal(controller.getSnapshot().lifecycle, 'active');
});
