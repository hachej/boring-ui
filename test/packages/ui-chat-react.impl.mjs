import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';
import { useArtifactFollow } from '@hachej/boring-ui-kit/chat-react';

const window = new Window({ url: 'https://fictional.invalid/' });
for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Text', 'MutationObserver']) {
  Object.defineProperty(globalThis, name, { configurable: true, value: name === 'window' ? window : window[name] });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { act, createElement: h, StrictMode, useLayoutEffect, useState } = await import('react');
const { createRoot } = await import('react-dom/client');
test.after(() => window.happyDOM.close());
const descriptor = revision => ({ schema: 'boring.artifact', version: 1, id: 'plan', title: 'Plan', type: 'code', mediaType: 'text/plain', ordinal: 1,
  target: { resource: { providerId: 'fictional', path: 'plan.txt' }, view: { kind: 'published' } }, revision });
const entry = (id, revision) => ({ id, model: [
  { role: 'assistant', content: [{ type: 'toolCall', id: 'retry', name: 'present', arguments: { path: 'plan.txt' } }] },
  { role: 'toolResult', toolCallId: 'retry', toolName: 'present', content: [{ type: 'text', text: JSON.stringify({ artifact: descriptor(revision) }) }] },
] });
const pending = { id: 9, model: [{ role: 'assistant', content: [{ type: 'toolCall', id: 'waiting', name: 'present', arguments: { path: 'plan.txt' } }] }] };
const viewOf = (entries, live = false) => ({ entries, docs: live ? { 'pi.live': { run: { id: 1 } } } : {} });
function controller(view) {
  const listeners = new Set(); let snapshot = { view };
  return { subscribe: change => { listeners.add(change); return () => listeners.delete(change); }, getSnapshot: () => snapshot,
    update: next => { snapshot = { view: next }; for (const change of listeners) change(); }, listeners };
}
async function mount(t, initial) {
  const element = document.createElement('div'); document.body.append(element);
  const root = createRoot(element); const opened = []; let api;
  const Probe = props => {
    const [active, setActive] = useState(null);
    api = useArtifactFollow({ ...props, active, onOpen: selection => { opened.push(selection); setActive(selection); },
      openPresent: props.openPresent ?? (() => false), showing: props.showing ?? (() => false) });
    return h('p', null, api.shown?.revision ?? 'closed');
  };
  const render = props => act(async () => root.render(h(StrictMode, null, h(Probe, props))));
  await render(initial);
  t.after(async () => { await act(async () => root.unmount()); element.remove(); });
  return { get api() { return api; }, opened, render, element };
}

test('follow uses newest result order, pins equal ordinals and selects latest through the public hook', async t => {
  const chat = controller(viewOf([entry(1, 'old'), entry(2, 'new')]));
  const page = await mount(t, { controller: chat, conversationId: '1' });
  await act(async () => page.api.open(descriptor('old')));
  assert.equal(page.api.shown.revision, 'old');
  assert.equal(page.api.isOpen(descriptor('new')), false);
  assert.deepEqual(page.api.known.map(item => item.revision), ['new', 'old']);
  await act(async () => page.api.select('latest'));
  assert.equal(page.api.shown.revision, 'new');
  assert.equal(page.api.isOpen(descriptor('old')), false);
  assert.equal(page.api.isOpen(descriptor('new')), true);
  assert.equal(chat.listeners.size, 1, 'one native subscription for all artifact derivations');
});

test('auto-open skips initial results, uses the latest fresh result and respects close, turn and host guards', async t => {
  const entries = [entry(1, 'old')]; const chat = controller(viewOf(entries));
  let unsaved = false, narrow = false;
  const page = await mount(t, { controller: chat, conversationId: '1', autoOpen: true, unsaved: () => unsaved, narrow: () => narrow });
  assert.deepEqual(page.opened, []);
  entries.push(entry(2, 'new'), entry(3, 'newest'));
  await act(async () => chat.update(viewOf([...entries])));
  assert.equal(page.opened.at(-1).descriptor.revision, 'newest');
  await act(async () => page.api.recordClosed());
  entries.push(entry(4, 'closed-turn'));
  await act(async () => chat.update(viewOf([...entries])));
  assert.equal(page.opened.length, 1);
  entries.push({ id: 5, model: [{ role: 'user', content: 'Next turn', timestamp: 5 }] }, entry(6, 'next-turn'));
  await act(async () => chat.update(viewOf([...entries])));
  assert.equal(page.opened.at(-1).descriptor.revision, 'next-turn');
  for (const guard of ['unsaved', 'narrow']) {
    unsaved = guard === 'unsaved'; narrow = guard === 'narrow';
    entries.push(entry(entries.length + 1, guard));
    await act(async () => chat.update(viewOf([...entries])));
    assert.equal(page.opened.length, 2, `${guard} blocks opening`);
  }
});

test('present reports only observed revisions, clears hidden mounts and does not borrow evidence across conversations', async t => {
  const chat = controller(viewOf([pending], true)); const sent = [];
  const answer = async (id, body) => { sent.push({ id, ...JSON.parse(body) }); return { kind: 'denied' }; };
  const props = { controller: chat, conversationId: '1', answer, showing: () => true };
  const page = await mount(t, props);
  assert.deepEqual(sent, []);
  await act(async () => page.api.onShown({ path: './plan.txt', revision: 'observed' }));
  assert.equal(sent.at(-1).revision, 'observed');
  const oldReport = page.api.onShown;
  await act(async () => page.api.onShown({ path: 'plan.txt', revision: 'observed', hidden: true }));
  await page.render({ ...props, conversationId: '2' });
  assert.equal(sent.length, 1, 'new conversation has no mount evidence');
  await act(async () => oldReport({ path: 'plan.txt', revision: 'late-old-mount' }));
  assert.equal(sent.length, 1, 'old callback cannot acknowledge in the new conversation');
  await act(async () => page.api.onFailed({ path: 'plan.txt', revision: 'wanted', reason: 'fictional failure' }));
  assert.equal(sent.at(-1).kind, 'refused');
});


test('a host layout-effect mount report is observed before the parent passive present scan', async t => {
  const chat = controller(viewOf([pending], true)); const sent = [];
  const answer = async (id, body) => { sent.push(JSON.parse(body)); return { kind: 'answered' }; };
  function Viewer({ onShown }) {
    useLayoutEffect(() => { onShown({ path: 'plan.txt', revision: 'mounted-in-layout' }); }, [onShown]);
    return h('p', null, 'Mounted');
  }
  function Page() {
    const api = useArtifactFollow({ controller: chat, conversationId: '1', active: null, onOpen() {}, answer,
      openPresent: () => false, showing: () => true });
    return h(Viewer, { onShown: api.onShown });
  }
  const element = document.createElement('div'); document.body.append(element); const root = createRoot(element);
  t.after(async () => { await act(async () => root.unmount()); element.remove(); });
  await act(async () => root.render(h(Page)));
  assert.equal(sent.length, 1, 'committed child layout effect is real mount evidence');
  assert.equal(sent[0].revision, 'mounted-in-layout');
});
