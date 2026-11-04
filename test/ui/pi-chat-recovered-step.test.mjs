// A step the agent got past raises no alarm for a person (D-1473): the real PiChat over a native view at the controller boundary.
// Red and open stay for developer mode and for a run that ends on the failure. Fictional text only.
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync } from 'node:fs';
import { build } from 'esbuild';
import { Window } from 'happy-dom';

const call = id => ({ type: 'toolCall', id, name: 'bash', arguments: { command: `fictional-${id}` } });
const assistant = content => ({ role: 'assistant', content, api: 'fictional', provider: 'fictional', model: 'fictional', usage: {}, stopReason: 'stop', timestamp: 1 });
const result = (id, isError = false) => ({ role: 'toolResult', toolCallId: id, toolName: 'bash', content: [{ type: 'text', text: isError ? 'Fictional command refused' : 'fictional output' }], isError, timestamp: 2 });
const user = { id: 1, kind: 'message', model: [{ role: 'user', content: 'Quel est le nom du port ?', timestamp: 0 }] };
const round = (id, ...model) => ({ id, kind: 'message', byTaskId: 1, model });
const answer = assistant([{ type: 'text', text: 'Port-Imaginaire.' }]);

const recoveredBySteps = { entries: [user, round(2, assistant([call('a')])), round(3, result('a', true), assistant([call('b')])), round(4, result('b'), assistant([call('c')])), round(5, result('c'), answer)], docs: {} };
const recoveredByWriting = { entries: [user, round(2, assistant([call('a')])), round(3, result('a', true), answer)], docs: {} };
const endsOnFailure = { entries: [user, round(2, assistant([call('a')])), round(3, result('a', true))], docs: {} };
const failsAgainLast = { entries: [user, round(2, assistant([call('a')])), round(3, result('a', true), assistant([call('b')])), round(4, result('b'), assistant([call('c')])), round(5, result('c', true))], docs: {} };
const stillWorking = { entries: [user, round(2, assistant([call('a')])), round(3, result('a', true), assistant([call('b')]))], docs: { 'pi.live': { run: { taskId: 1 } } } };

test('a failed step the agent got past is quiet for a person, and still there to open', { timeout: 30000 }, async t => {
  const window = new Window({ url: 'https://fictional.invalid/' });
  const names = ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Text', 'MutationObserver', 'ResizeObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'sessionStorage', 'localStorage', 'addEventListener', 'removeEventListener', 'matchMedia', 'innerWidth', 'innerHeight', 'IS_REACT_ACT_ENVIRONMENT'];
  const globals = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  for (const name of names) {
    const value = name === 'window' ? window : name === 'IS_REACT_ACT_ENVIRONMENT' ? true : window[name];
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: typeof value === 'function' && /^[a-z]/.test(name) ? value.bind(window) : value });
  }
  const { createElement, act } = await import('react'); const { createRoot } = await import('react-dom/client');
  const out = new URL('../../.cache/pi-chat-recovered-step/', import.meta.url); mkdirSync(out, { recursive: true });
  const output = new URL('chat.mjs', out);
  await build({ entryPoints: [new URL('../../registry/pi-chat/pi-chat.tsx', import.meta.url).pathname], outfile: output.pathname, bundle: true, format: 'esm', platform: 'node', jsx: 'automatic', packages: 'external', loader: { '.css': 'empty' }, plugins: [{ name: 'file-tree-css', setup(builder) { builder.onResolve({ filter: /^@hachej\/boring-ui-kit\/file-tree\.css$/ }, () => ({ path: new URL(import.meta.resolve('@hachej/boring-ui-kit/file-tree.css')).pathname, external: false })); } }] });
  const { PiChat } = await import(output.href);
  const element = document.createElement('div'); document.body.append(element); const root = createRoot(element);
  t.after(async () => {
    await act(async () => root.unmount()); await window.happyDOM.close();
    for (const [name, descriptor] of globals) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; }
  });
  let snapshot;
  const controller = new Proxy({ getSnapshot: () => snapshot, subscribe: () => () => {} }, { get: (target, key) => key in target ? target[key] : async () => {} });
  let drawn = 0;
  const draw = async (view, mode = 'expert') => {
    snapshot = { identity: {}, conversationId: 'fictional', connection: { kind: 'connected' }, view, draft: { text: '', attachments: [], version: 0 }, outbox: [], history: { kind: 'disabled' }, send: { kind: 'idle' }, stop: 'idle', disposed: false };
    await act(async () => root.render(createElement(PiChat, { key: drawn++, controller, header: false, mode })));
    return element.querySelector('[data-testid=activity]');
  };
  const headerStatus = block => block.querySelector('[data-testid=activity-label]').closest('[data-slot=trace-line]').getAttribute('data-status');
  const quiet = (block, state = 'done') => {
    assert.equal(block.dataset.state, state);
    assert.equal(block.dataset.open, 'false', 'not opened by itself');
    assert.notEqual(headerStatus(block), 'error', 'not red');
    assert.equal(element.querySelector('[role=alert]'), null, 'no failure text on the page');
    assert.doesNotMatch(element.textContent, /fictional-a|Fictional command refused/, 'no shell text on the page');
  };
  const alarmed = block => {
    assert.equal(block.dataset.state, 'failed');
    assert.equal(block.dataset.open, 'true');
    assert.equal(headerStatus(block), 'error');
  };

  await t.test('later steps finished and the reply ended: quiet, and opening it shows the failure', async () => {
    const block = await draw(recoveredBySteps);
    quiet(block);
    assert.match(element.textContent, /Port-Imaginaire\./);
    await act(async () => block.querySelector('[data-slot=trace-collapsible-trigger]').click());
    assert.equal(block.dataset.open, 'true');
    assert.ok(block.querySelector('[data-testid=activity-step][data-status=failed]'), 'the failed step is still there');
    assert.match(block.querySelector('[role=alert]').textContent, /Fictional command refused/);
  });
  await t.test('the agent went on to write the answer: quiet', async () => { quiet(await draw(recoveredByWriting)); });
  await t.test('still working after a failed step: no flash of red', async () => { quiet(await draw(stillWorking), 'running'); });
  await t.test('a run that ends on the failure still says so', async () => { alarmed(await draw(endsOnFailure)); });
  await t.test('a step that went well, then a last one that failed: still says so', async () => { alarmed(await draw(failsAgainLast)); });
  await t.test('developer mode stays red and open', async () => {
    alarmed(await draw(recoveredBySteps, 'developer'));
    alarmed(await draw(stillWorking, 'developer'));
  });
});
