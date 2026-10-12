// The page side of the view-open acknowledgement (registry/pi-chat/artifact.ts `pendingPresents`, registry/pi-app/artifact-panel.tsx
// `useReportShown`): the page finds the `present` calls still waiting, and it reports a revision only after a viewer has mounted it.
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { Window } from 'happy-dom';

const root = fileURLToPath(new URL('../../', import.meta.url));
const out = `${root}.cache/present-ack-test`;
mkdirSync(out, { recursive: true });
async function load(name, entry) {
  await build({ entryPoints: [`${root}registry/${entry}`], outfile: `${out}/${name}.mjs`, bundle: true, format: 'esm', platform: 'node', jsx: 'automatic',
    packages: 'external', logLevel: 'silent' });
  return import(pathToFileURL(`${out}/${name}.mjs`).href);
}

const call = (id, name, args) => ({ type: 'toolCall', id, name, arguments: args });
const assistant = content => ({ role: 'assistant', content });
const result = toolCallId => ({ role: 'toolResult', toolCallId, content: [{ type: 'text', text: '{}' }] });
const view = (messages, live = true) => ({ entries: [{ id: 3, model: messages }, { id: 5, model: [assistant([call('c2', 'present', { path: 'b.md' })])] }],
  docs: live ? { 'pi.live': { run: { id: 'fictional' } } } : {} });

test('pendingPresents lists the present calls with no result, while the run is live, with the answer ID the server binds', async () => {
  const { pendingPresents } = await load('artifact', 'pi-chat/artifact.ts');
  const messages = [assistant([call('c1', 'present', { path: './a.md' }), call('c9', 'read', { path: 'x' })])];
  assert.deepEqual(pendingPresents(view(messages)), [{ id: '[3,"c1"]', callId: 'c1', path: 'a.md' }, { id: '[5,"c2"]', callId: 'c2', path: 'b.md' }]);
  assert.deepEqual(pendingPresents(view(messages, false)), [], 'nothing waits once the run is not live');
  assert.deepEqual(pendingPresents(view([...messages, result('c1')])).map(item => item.callId), ['c2'], 'a call with a result is no longer pending');
  assert.deepEqual(pendingPresents(view([assistant([call('c3', 'present', { path: 7 })])])).map(item => item.callId), ['c2'], 'a non-text path is ignored');
  assert.deepEqual(pendingPresents(undefined), []);
});

test('useReportShown reports the revision once its viewer has mounted it, and not for an unknown revision', async () => {
  const { useReportShown } = await load('artifact-panel', 'pi-app/artifact-panel.tsx');
  const { createElement, act } = await import('react');
  const { createRoot } = await import('react-dom/client');
  const window = new Window({ url: 'https://fictional.invalid/' });
  globalThis.window = window; globalThis.document = window.document; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const container = window.document.createElement('div');
  window.document.body.appendChild(container);
  const reports = [];
  const onShown = shown => reports.push(shown);
  const Probe = ({ revision }) => { useReportShown(onShown, 'a.md', revision); return null; };
  const root = createRoot(container);
  await act(async () => { root.render(createElement(Probe, { revision: undefined })); });
  assert.deepEqual(reports, [], 'nothing is reported while the viewer has no revision');
  await act(async () => { root.render(createElement(Probe, { revision: 'rev-1' })); });
  assert.deepEqual(reports, [{ path: 'a.md', revision: 'rev-1' }]);
  await act(async () => { root.render(createElement(Probe, { revision: 'rev-1' })); });
  assert.equal(reports.length, 1, 'the same revision is not reported again');
  await act(async () => { root.unmount(); });
  delete globalThis.window; delete globalThis.document; delete globalThis.IS_REACT_ACT_ENVIRONMENT;
});
