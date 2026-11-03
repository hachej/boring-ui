// D-1433: a host keeps the first view small by sending photos as links (an image part with `data: ''` and a `url`). The remote chat
// resolves each link against the chat endpoint, so a relative link names the endpoint's own route wherever the page is. Fictional data.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createRemoteChat } from '@hachej/boring-ui-kit/remote-chat';
import { createNativeChatController } from '@hachej/boring-ui-kit/native-chat';

const endpoint = 'https://fixture.invalid/api/agents/coach/chat';
const identity = { runtimeId: 'fictional-runtime', scopeId: 'fictional-scope', principalId: 'fictional-person' };
const pixel = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
const view = { conversation: { id: 7 }, docs: {}, entries: [{ id: 3, conversationId: 7, kind: 'message', model: [{ role: 'user', timestamp: 0, content: [
  { type: 'text', text: 'Fictional lunch' },
  { type: 'image', mimeType: 'image/jpeg', data: '', url: '?op=image&conversation=7&entry=3&part=0.1' },
  { type: 'image', mimeType: 'image/jpeg', data: '', url: 'https://images.fixture.invalid/meal.jpg' },
  { type: 'image', mimeType: 'image/png', data: pixel },
] }] }] };

test('photo links in the view are resolved against the chat endpoint; absolute links and inline bytes are kept', async t => {
  const fetch = async request => new URL(request.url).searchParams.get('op') === 'watch'
    ? new Response(JSON.stringify({ kind: 'view', view }) + '\n', { headers: { 'content-type': 'application/x-ndjson' } })
    : new Response('{}', { status: 404 });
  const remote = await createRemoteChat({ endpoint, fetch });
  const controller = createNativeChatController({ identity, ...remote });
  t.after(async () => { await controller.dispose(); await remote.close(); });
  await controller.connect();
  const parts = controller.getSnapshot().view.entries[0].model[0].content.filter(part => part.type === 'image');
  assert.deepEqual(parts.map(part => part.url ?? part.data), [
    'https://fixture.invalid/api/agents/coach/chat?op=image&conversation=7&entry=3&part=0.1',
    'https://images.fixture.invalid/meal.jpg',
    pixel,
  ]);
  assert.ok(parts.every(part => part.mimeType), 'the parts keep their shape');
});

/** A watch stream that stays open: the given frames, one per line, then nothing until the test ends. */
function stream(t, frames) {
  let close;
  const body = new ReadableStream({ start(controller) {
    for (const frame of frames) controller.enqueue(new TextEncoder().encode(frame + '\n'));
    close = () => { try { controller.close(); } catch { /* closed */ } };
  } });
  t.after(() => close());
  return new Response(body, { headers: { 'content-type': 'application/x-ndjson' } });
}
const settle = () => new Promise(resolve => setTimeout(resolve, 30));
const urls = controller => controller.getSnapshot().view.entries[0].model[0].content.filter(part => part.type === 'image').map(part => part.url);

test('a later operation that sets only a photo link, written with spaces, is resolved too; the replica replays the host values', async t => {
  // The host writes `"data": ""` with spaces and later changes only the first link: neither frame carries the compact `"data":""`.
  const spaced = JSON.stringify({ kind: 'view', view }, null, 0).replaceAll('"data":""', '"data": ""');
  const path = ['entries', 0, 'model', 0, 'content', 1, 'url'];
  const frames = [spaced,
    JSON.stringify({ kind: 'ops', ops: [['s', path, '?op=image&conversation=7&entry=3&part=0.1&v=2']] }),
    JSON.stringify({ kind: 'ops', ops: [['a', path, '&w=3']] })];
  const fetch = async request => new URL(request.url).searchParams.get('op') === 'watch' ? stream(t, frames) : new Response('{}', { status: 404 });
  const remote = await createRemoteChat({ endpoint, fetch });
  const controller = createNativeChatController({ identity, ...remote });
  t.after(async () => { await controller.dispose(); await remote.close(); });
  await controller.connect();
  await settle();
  assert.deepEqual(urls(controller), [
    'https://fixture.invalid/api/agents/coach/chat?op=image&conversation=7&entry=3&part=0.1&v=2&w=3',
    'https://images.fixture.invalid/meal.jpg',
    undefined,
  ], 'the set and the append replay on the host link, then resolve against the endpoint');
});

test('photos in earlier pages are resolved against the chat endpoint', async t => {
  const older = { id: 1, conversationId: 7, kind: 'message', model: [{ role: 'user', timestamp: 0, content: [
    { type: 'text', text: 'Fictional breakfast' },
    { type: 'image', mimeType: 'image/jpeg', data: '', url: '?op=image&conversation=7&entry=1&part=0.1' },
  ] }] };
  const fetch = async request => {
    const op = new URL(request.url).searchParams.get('op');
    if (op === 'watch') return stream(t, [JSON.stringify({ kind: 'view', view: { ...view, hasEarlier: true } })]);
    if (op === 'entries') return Response.json({ page: { items: [older] } });
    return new Response('{}', { status: 404 });
  };
  const remote = await createRemoteChat({ endpoint, fetch });
  const controller = createNativeChatController({ identity, ...remote });
  t.after(async () => { await controller.dispose(); await remote.close(); });
  await controller.connect();
  await controller.loadEarlier();
  const { history } = controller.getSnapshot();
  assert.equal(history.kind, 'ready');
  assert.equal(history.entries[0].model[0].content[1].url, 'https://fixture.invalid/api/agents/coach/chat?op=image&conversation=7&entry=1&part=0.1');
});
