// A projected watch (the PM's member view) sends one complete view, then the operation batch between projected views: an update costs the same
// whatever the conversation holds, the client's replica equals the projected view, and nothing the projection removed reaches it.
import assert from 'node:assert/strict';
import test from 'node:test';
import { Harness, MemoryStorage, createRegistry } from '@earendil-works/pi-durable';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { createChatTransportHandler, routeSubmissions } from '@hachej/boring-agent/chat-transport';
import { createRemoteChat } from '@hachej/boring-ui-kit/remote-chat';
import { createNativeChatController } from '@hachej/boring-ui-kit/native-chat';
import { createFakeChatModel } from '@hachej/boring-testing/model';

const identity = { runtimeId: 'fictional-runtime', scopeId: 'fictional-scope', principalId: 'fictional-person' };
const SECRET = 'fictional model-only note';
const project = view => ({ ...view, entries: view.entries.map(entry => ({ ...entry, data: entry.data === undefined ? undefined : { ...entry.data, diagnostics: undefined } })),
  docs: { ...view.docs, 'pi.note': { text: SECRET.repeat(0) } } });

async function stream(t, earlier) {
  const fake = createFakeChatModel();
  const harness = await Harness.open(new MemoryStorage(), { registry: createRegistry(), models: fake.models }, context);
  t.after(() => harness.close(context));
  const conversation = await harness.createConversation({ ownership: { kind: 'ownerless' }, agent: { model: fake.model } }, context);
  const routed = routeSubmissions(conversation, async draft => { await conversation.submit(draft, context); });
  for (let i = 0; i < earlier; i++) {
    const submission = await conversation.submit({ type: 'input', requestId: `earlier-${i}`, content: `Question ${i} `.repeat(8) }, context);
    (await fake.nextCall()).respond(`Réponse ${i} `.repeat(30));
    await submission.wait(context);
  }
  const frames = [];
  const fetch = async request => {
    const response = await createChatTransportHandler({ authenticate: async () => ({ conversation: routed, context, project }) })(request);
    if (new URL(request.url).searchParams.get('op') !== 'watch') return response;
    const [read, pass] = response.body.tee();
    (async () => { const reader = read.getReader(), decoder = new TextDecoder(); let rest = ''; for (;;) { const { value, done } = await reader.read(); if (done) break; rest += decoder.decode(value, { stream: true }); const lines = rest.split('\n'); rest = lines.pop(); for (const line of lines) if (line) frames.push(JSON.parse(line)); } })();
    return new Response(pass, { headers: response.headers });
  };
  const remote = await createRemoteChat({ endpoint: 'https://fixture.invalid/chat', fetch, pollMs: 10 });
  const controller = createNativeChatController({ identity, ...remote });
  t.after(() => controller.dispose());
  await controller.connect();
  frames.length = 0;
  controller.setText('Nouvelle question');
  const sending = controller.send();
  const call = await fake.nextCall();
  for (let i = 0; i < 20; i++) { call.append('mot '.repeat(5)); await new Promise(resolve => setTimeout(resolve, 30)); }
  call.respond('fin');
  await sending;
  await new Promise(resolve => setTimeout(resolve, 300));
  return { frames, controller, conversation };
}

test('after the first view a projected watch sends operation batches, whose size does not depend on the conversation', async t => {
  const small = await stream(t, 2), large = await stream(t, 30);
  for (const { frames } of [small, large]) {
    assert.ok(frames.length > 5);
    assert.ok(frames.slice(1).every(frame => frame.kind === 'ops'), 'updates are batches');
  }
  const bytes = frames => Math.max(...frames.slice(1).map(frame => JSON.stringify(frame).length));
  assert.ok(bytes(large.frames) < 2000, `an update is ${bytes(large.frames)} bytes`);
  assert.ok(Math.abs(bytes(large.frames) - bytes(small.frames)) < 400, 'the same size with 2 or 30 earlier turns');
});

test('the client replica equals the projected view', async t => {
  const { controller, conversation } = await stream(t, 6);
  const native = await conversation.watch(context);
  t.after(() => native.stop());
  assert.equal(JSON.stringify(controller.getSnapshot().view), JSON.stringify(JSON.parse(JSON.stringify(project(native.value)))));
});
