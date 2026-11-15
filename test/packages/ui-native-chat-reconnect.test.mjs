// What the chat controller does with a send when the connection drops and comes back (the host restarted). Real controller, real remote
// client, real transport handler and native conversation; the "network" is a fetch the test can cut, take down and bring back.
import assert from 'node:assert/strict';
import test from 'node:test';
import { Harness, MemoryStorage, createRegistry } from '@earendil-works/pi-durable';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { createChatTransportHandler } from '@hachej/boring-agent/chat-transport';
import { createRemoteChat } from '@hachej/boring-ui-kit/remote-chat';
import { createNativeChatController } from '@hachej/boring-ui-kit/native-chat';
import { createFakeChatModel } from '@hachej/boring-testing/model';

const identity = { runtimeId: 'fictional-runtime', scopeId: 'fictional-scope', principalId: 'fictional-person' };
const endpoint = 'https://fixture.invalid/chat';
const until = async (label, check) => { const deadline = Date.now() + 5000; while (!check()) { assert.ok(Date.now() < deadline, label); await new Promise(resolve => setTimeout(resolve, 10)); } };
const called = fake => Promise.race([fake.nextCall(), new Promise((_, reject) => setTimeout(() => reject(new Error('the model was never called')), 4000))]);
const messages = view => view.entries.flatMap(entry => entry.model ?? []);
const said = (view, role) => messages(view).filter(message => message.role === role).map(message => typeof message.content === 'string' ? message.content : message.content.map(part => part.text ?? '').join(''));

async function host(t, options = {}) {
  const fake = createFakeChatModel();
  const harness = await Harness.open(new MemoryStorage(), { registry: createRegistry(), models: fake.models }, context);
  t.after(() => harness.close(context));
  const conversation = await harness.createConversation({ ownership: { kind: 'ownerless' }, agent: { model: fake.model } }, context);
  const handler = createChatTransportHandler({ heartbeatMs: 40, authenticate: async () => ({ conversation, context }) });
  const network = { down: false, watches: [], submits: [], lookups: 0, ackedButLost: 0, replyLost: 0 };
  const fetch = async request => {
    const op = new URL(request.url).searchParams.get('op');
    if (op === 'submit') network.submits.push((await request.clone().json()).requestId);
    if (network.down) throw new TypeError('fetch failed');
    if (op === 'submit') {
      // The host confirmed the message and then restarted before it kept it.
      if (network.ackedButLost > 0) { network.ackedButLost--; return Response.json({ submissionId: 4000 + network.submits.length }); }
      if (network.replyLost > 0) { network.replyLost--; await handler(request); network.down = true; throw new TypeError('fetch failed'); }
    }
    if (op === 'submission') network.lookups++;
    const response = await handler(request);
    if (op !== 'watch') return response;
    let cut;
    const body = response.body.pipeThrough(new TransformStream({ start: stream => { cut = () => stream.error(new TypeError('Fictional host restarted')); } }));
    network.watches.push(() => cut());
    return new Response(body, { headers: response.headers });
  };
  /** The host restarts: open streams die, requests fail for `ms`, then it is back. */
  network.restart = async (ms = 60) => { network.down = true; for (const cut of network.watches.splice(0)) cut(); await new Promise(resolve => setTimeout(resolve, ms)); network.down = false; };
  const remote = await createRemoteChat({ endpoint, fetch, pollMs: 10, reconnect: { baseDelayMs: 10, maxDelayMs: 40 } });
  const controller = createNativeChatController({ identity, ...remote, ...options });
  t.after(() => controller.dispose());
  await controller.connect();
  const connected = () => controller.getSnapshot().connection.kind === 'connected';
  return { fake, conversation, network, remote, controller, connected };
}

test('a send confirmed by a stream that dropped, with the turn lost by the restart, is sent again on the same controller with the same request', { timeout: 15000 }, async t => {
  const { fake, network, controller, connected } = await host(t);
  network.ackedButLost = 1;
  controller.setText('First fictional message'); await controller.send();
  assert.equal(controller.getSnapshot().send.kind, 'admitted');
  await network.restart();
  controller.setText('Typed while the host was away');
  await until('connected again', () => connected() && network.watches.length > 0);
  await until('the lost turn reaches the host', () => network.submits.length === 2);
  assert.equal(network.submits[0], network.submits[1], 'the same request ID, so the host runs it once');
  (await called(fake)).respond('Fictional reply.');
  await until('the turn is in the view', () => said(controller.getSnapshot().view, 'assistant').length === 1);
  assert.deepEqual(said(controller.getSnapshot().view, 'user'), ['First fictional message'], 'the turn appears once');
  assert.equal(controller.getSnapshot().draft.text, 'Typed while the host was away', 'the typed draft is never lost');
  assert.equal(controller.getSnapshot().send.kind, 'admitted');
  const next = await controller.send();
  assert.ok(next, 'the same controller sends again');
  (await called(fake)).respond('Second fictional reply.');
  await until('both turns', () => said(controller.getSnapshot().view, 'user').length === 2);
  assert.deepEqual(said(controller.getSnapshot().view, 'user'), ['First fictional message', 'Typed while the host was away']);
});

test('a send whose answer was lost with the connection is checked and settled when the connection returns, with no second turn if the host has it', { timeout: 15000 }, async t => {
  const { fake, network, controller, connected } = await host(t);
  network.replyLost = 1;
  controller.setText('Fictional message the host took'); await controller.send();
  assert.equal(controller.getSnapshot().send.kind, 'unknown', 'the send is not confirmed while the host is away');
  for (const cut of network.watches.splice(0)) cut();
  await new Promise(resolve => setTimeout(resolve, 60)); network.down = false;
  await until('settled by itself', () => connected() && controller.getSnapshot().send.kind === 'admitted');
  assert.equal(network.submits.length, 1, 'the host already had the turn: nothing is sent twice');
  (await called(fake)).respond('Fictional reply.');
  await until('the turn is in the view', () => said(controller.getSnapshot().view, 'assistant').length === 1);
  assert.deepEqual(said(controller.getSnapshot().view, 'user'), ['Fictional message the host took']);
  controller.setText('And another'); assert.ok(await controller.send(), 'the same controller sends again');
});

test('a send that never reached the host is retried through the same request when the connection returns', { timeout: 15000 }, async t => {
  const { fake, network, controller, connected } = await host(t);
  network.down = true; for (const cut of network.watches.splice(0)) cut();
  controller.setText('Fictional message sent into the outage'); await controller.send();
  assert.equal(controller.getSnapshot().send.kind, 'unknown');
  network.down = false;
  await until('retried by itself', () => connected() && controller.getSnapshot().send.kind === 'admitted');
  assert.equal(network.submits.length, 2); assert.equal(network.submits[0], network.submits[1]);
  (await called(fake)).respond('Fictional reply.');
  await until('the turn is in the view', () => said(controller.getSnapshot().view, 'assistant').length === 1);
  assert.deepEqual(said(controller.getSnapshot().view, 'user'), ['Fictional message sent into the outage']);
});

test('a drop while nothing was sent changes nothing and asks the host nothing', { timeout: 15000 }, async t => {
  const { network, controller, connected } = await host(t);
  controller.setText('A draft in the field');
  const states = []; controller.subscribe(() => { const { send, draft } = controller.getSnapshot(); states.push(`${send.kind}:${draft.text}`); });
  await network.restart();
  await until('connected again', () => connected() && network.watches.length > 0);
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(controller.getSnapshot().send.kind, 'idle');
  assert.equal(controller.getSnapshot().draft.text, 'A draft in the field');
  assert.equal(network.lookups, 0); assert.equal(network.submits.length, 0);
  assert.ok(states.every(state => state === 'idle:A draft in the field'), states.join(', '));
});

test('two drops in a row: each turn appears once and the controller keeps sending', { timeout: 15000 }, async t => {
  const { fake, network, controller, connected } = await host(t);
  controller.setText('First'); await controller.send(); (await called(fake)).respond('One.');
  await network.restart(); await until('back once', () => connected() && network.watches.length > 0);
  controller.setText('Second'); await controller.send(); (await called(fake)).respond('Two.');
  await network.restart(); await until('back twice', () => connected() && network.watches.length > 0);
  controller.setText('Third'); assert.ok(await controller.send()); (await called(fake)).respond('Three.');
  await until('three turns', () => said(controller.getSnapshot().view, 'assistant').length === 3);
  assert.deepEqual(said(controller.getSnapshot().view, 'user'), ['First', 'Second', 'Third']);
  assert.equal(new Set(network.submits).size, 3, 'no request was repeated');
});

test('a message sent while the lost turn is being sent again waits behind it and goes in order', { timeout: 15000 }, async t => {
  const { fake, network, controller, connected } = await host(t);
  network.ackedButLost = 1;
  controller.setText('Lost one'); await controller.send();
  await network.restart();
  await until('connected again', () => connected() && network.watches.length > 0);
  controller.setText('Typed after'); const second = controller.send();
  (await called(fake)).respond('First reply.');
  await second; (await called(fake)).respond('Second reply.');
  await until('both turns', () => said(controller.getSnapshot().view, 'assistant').length === 2);
  assert.deepEqual(said(controller.getSnapshot().view, 'user'), ['Lost one', 'Typed after']);
});

test('a submission handle waits through a host restart instead of failing with the connection', { timeout: 15000 }, async t => {
  const { fake, network, remote } = await host(t);
  const submission = await remote.conversation.submit({ type: 'input', requestId: 'fictional-request', content: 'Fictional message' }, context);
  const call = await called(fake);
  const waiting = submission.wait(remote.context);
  await network.restart(80);
  call.respond('Fictional reply.');
  assert.equal((await waiting).status, 'done');
});
