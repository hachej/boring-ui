import assert from 'node:assert/strict';
import test from 'node:test';
import { createRemoteChat } from '@hachej/boring-ui-kit/remote-chat';

// createRemoteChat({ requestContext }): the submit body carries the current screen context, read at each submit.
const endpoint = 'https://fixture.invalid/chat';
const view = { conversation: { id: 'fictional-conversation' }, entries: [], docs: {} };

function host() {
  const submits = [];
  const fetch = async request => {
    const op = new URL(request.url).searchParams.get('op');
    if (op === 'watch') return new Response(JSON.stringify({ kind: 'view', view }) + '\n', { headers: { 'content-type': 'application/x-ndjson' } });
    if (op === 'submit') { submits.push(await request.json()); return Response.json({ submissionId: submits.length }); }
    return new Response('{}', { status: 404 });
  };
  return { fetch, submits };
}
const draft = requestId => ({ type: 'input', requestId, content: 'Hello' });

test('the submit body gains context from requestContext, read at each submit', async () => {
  const { fetch, submits } = host();
  let screen = { name: 'Progrès', params: { range: 30 } };
  const remote = await createRemoteChat({ endpoint, fetch, requestContext: () => screen });
  await remote.conversation.submit(draft('one'));
  screen = { name: 'Jour', params: {} };
  await remote.conversation.submit(draft('two'));
  assert.deepEqual(submits.map(body => body.context), [{ name: 'Progrès', params: { range: 30 } }, { name: 'Jour', params: {} }]);
  assert.deepEqual(Object.keys(submits[0]).sort(), ['content', 'context', 'requestId']);
});

test('without requestContext, or when it returns undefined, the body has no context field', async () => {
  for (const options of [{}, { requestContext: () => undefined }]) {
    const { fetch, submits } = host();
    const remote = await createRemoteChat({ endpoint, fetch, ...options });
    await remote.conversation.submit(draft('one'));
    assert.ok(!('context' in submits[0]), JSON.stringify(Object.keys(options)));
  }
});
