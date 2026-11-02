import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { Window } from 'happy-dom';
import { createSharedChat, createFakeChannelSource } from '@hachej/boring-ui-kit/shared-chat';

const root = fileURLToPath(new URL('../../', import.meta.url));
const out = `${root}.cache/evidence/room-mockups`;
mkdirSync(out, { recursive: true });
const artifact = name => ({ schema: 'boring.artifact', version: 1, title: `Idea ${name} — garden`, type: 'html', mediaType: 'text/html', target: { resource: { providerId: 'room-files', path: `ideas/${name}.html` }, view: { kind: 'published' } }, revision: `immutable-${name}` });
const descriptors = ['A', 'B', 'C'].map(artifact);
const question = { id: '2', conversationId: 'main', author: 'agent:pm', at: '2026-10-30T12:00:00Z', text: 'Which idea?', question: { callId: 'native-q', prompt: 'Which idea?', options: ['A', 'B', 'C'], allowFreeText: false, answered: false }, artifacts: descriptors };

for (const width of [375, 1280]) test(`public SharedChat uses ordinary artifact cards/panel, exact host reads and native answer at ${width}px`, async t => {
  const window = new Window({ url: 'https://fictional.invalid/', width, height: 844 });
  const names = ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Text', 'DOMParser', 'MutationObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'ResizeObserver', 'sessionStorage', 'localStorage', 'matchMedia', 'IS_REACT_ACT_ENVIRONMENT'];
  const globals = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  for (const name of names) {
    const value = name === 'window' ? window : name === 'IS_REACT_ACT_ENVIRONMENT' ? true : window[name];
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: typeof value === 'function' && /^[a-z]/.test(name) ? value.bind(window) : value });
  }
  await build({ entryPoints: [`${root}test/fixtures/shared-room-mockups.tsx`], outfile: `${out}/presentation-${width}.mjs`, bundle: true, format: 'esm', platform: 'node', jsx: 'automatic', packages: 'external', alias: { '@': `${root}examples/app-shell` } });
  const { RoomPresentation } = await import(pathToFileURL(`${out}/presentation-${width}.mjs`).href);
  const { act, createElement: h } = await import('react');
  const { createRoot } = await import('react-dom/client');
  const source = createFakeChannelSource({ me: { id: 'person:ana', name: 'Ana', kind: 'person' }, members: [{ id: 'person:ana', name: 'Ana', kind: 'person' }, { id: 'agent:pm', name: 'PM', kind: 'agent' }], conversations: [{ id: 'main', title: 'Team', kind: 'main', members: ['person:ana', 'agent:pm'] }], messages: [question] });
  const controller = createSharedChat(source, { conversationId: 'main' });
  const container = document.createElement('div'); document.body.append(container);
  const ui = createRoot(container), reads = [];
  const read = async descriptor => { reads.push(descriptor); return `<h1>Fictional ${descriptor.title}</h1>`; };
  t.after(async () => { await act(async () => ui.unmount()); assert.equal(controller.getSnapshot().disposed, false, 'viewer borrows the controller'); await controller.dispose(); await window.happyDOM.close(); for (const [name, descriptor] of globals) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; } });
  const render = (key = 'app:ana:controller-1') => act(async () => ui.render(h(RoomPresentation, { key, controller, read })));
  const until = async ready => { for (let n = 0; n < 100 && !ready(); n++) await act(async () => new Promise(resolve => setTimeout(resolve, 10))); assert.ok(ready(), 'expected public UI'); };
  const cards = () => container.querySelectorAll('[data-testid=artifact-card]');
  const open = async index => {
    await act(async () => cards()[index].click());
    await until(() => container.querySelector('[data-testid=artifact-run-frame]'));
    return container.querySelector('[data-testid=artifact-run-frame]');
  };
  const close = async () => {
    await act(async () => container.querySelector('[data-testid=artifact-close]').click());
    await until(() => !container.querySelector('[data-testid=workspace-panel]'));
  };
  await render();
  await until(() => container.querySelector('[data-testid=question-option]'));
  assert.deepEqual([...container.querySelectorAll('[data-testid=artifact-title]')].map(node => node.textContent), descriptors.map(item => item.title));
  assert.deepEqual(reads, [], 'stock cards do not prefetch private attachment bytes');
  for (let i = 0; i < 3; i++) {
    const frame = await open(i);
    assert.match(frame.getAttribute('srcdoc'), new RegExp(`Fictional ${descriptors[i].title}`));
    assert.equal(frame.getAttribute('sandbox'), 'allow-scripts');
    assert.doesNotMatch(frame.getAttribute('sandbox'), /allow-same-origin/);
    await close();
  }
  assert.deepEqual(reads, descriptors, 'the ordinary panel reads each selected exact descriptor');
  await act(async () => container.querySelectorAll('[data-testid=question-option]')[1].click());
  assert.equal(source.sends.length, 1);
  assert.equal(source.sends[0].text, 'B'); assert.equal(source.sends[0].replyTo, '2');
  await act(async () => source.emit({ type: 'message', message: { ...question, question: { ...question.question, answered: true } } }));
  assert.equal(container.querySelector('[data-testid=question-answered]'), null, 'no system-like Answered log');
  assert.equal(container.querySelector('[data-testid=question-prompt]'), null, 'no repeated prompt after choosing');
  assert.match(container.textContent, /B/, 'the person’s actual reply stays');
  assert.equal(container.querySelector('[data-testid=reply-quote]'), null, 'no assistant prompt quote on the answer');
  assert.equal(cards().length, 3, 'answered questions retain their artifacts');
  const final = { id: '3', conversationId: 'main', author: 'agent:pm', at: '2026-10-30T12:01:00Z', text: 'Selected B; launch not requested.', artifacts: descriptors };
  await act(async () => { source.emit({ type: 'message', message: final }); source.emit({ type: 'message', message: final }); });
  assert.equal(cards().length, 3, 'question/final/replay never duplicate the cards');
  await open(0);
  await render('app:ben:controller-2');
  assert.equal(container.querySelector('[data-testid=workspace-panel]'), null, 'host binding replacement clears opened resource');
  assert.equal(cards().length, 3);
  const otherProvider = { ...descriptors[0], title: 'Another provider', target: { ...descriptors[0].target, resource: { ...descriptors[0].target.resource, providerId: 'different-room-files' } } };
  await act(async () => source.emit({ type: 'message', message: { ...final, artifacts: [...descriptors, otherProvider] } }));
  await until(() => cards().length === 4);
  const otherFrame = await open(3);
  assert.match(otherFrame.getAttribute('srcdoc'), /Fictional Another provider/);
  assert.deepEqual(reads.at(-1), otherProvider, 'same path/revision in another provider reads that full target, never another provider’s bytes');
  await act(async () => { source.emit({ type: 'message', message: { ...question, artifacts: [], removed: { by: 'host', at: final.at } } }); source.emit({ type: 'message', message: { ...final, artifacts: [], removed: { by: 'host', at: final.at } } }); });
  assert.equal(cards().length, 0, 'redaction clears cards');
  assert.equal(container.querySelector('[data-testid=workspace-panel]'), null, 'redaction also closes the selected artifact');
});
