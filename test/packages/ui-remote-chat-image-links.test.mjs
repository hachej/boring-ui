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
