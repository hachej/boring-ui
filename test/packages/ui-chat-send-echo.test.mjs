// Instant send: the message the person sends is on screen at once (the echo), before validation or the network, without a duplicate when
// the server's copy arrives; a failed send keeps it with a failed state; the steps of a send are timed. Drives the real remote client
// and the real controller over a fake host with realistic latency.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createRemoteChat } from '@hachej/boring-ui-kit/remote-chat';
import { createNativeChatController } from '@hachej/boring-ui-kit/native-chat';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';

const identity = { runtimeId: 'fictional-runtime', scopeId: 'fictional-scope', principalId: 'fictional-person' };
const endpoint = 'https://fixture.invalid/chat';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const until = async (label, check) => { const deadline = Date.now() + 3000; while (!check()) { assert.ok(Date.now() < deadline, label); await sleep(5); } };
const userEntry = (id, text) => ({ id, conversationId: 'c', kind: 'message', model: [{ role: 'user', content: text, timestamp: 1 }] });
const assistantEntry = (id, text) => ({ id, conversationId: 'c', kind: 'message', byTaskId: 1, model: [{ role: 'assistant', content: [{ type: 'text', text }], stopReason: 'stop', timestamp: 2 }] });
const view = (entries, live) => ({ conversation: { id: 'c' }, entries, docs: live ? { 'pi.live': live } : {} });

/** A host: the watch stream is kept open and fed by `push`; `submit` takes `submitMs`, then places the message `placeMs` later. */
function host({ submitMs = 600, placeMs = 300, fail = false } = {}) {
  let entries = [], controllerOfStream, next = 1;
  const encoder = new TextEncoder();
  const push = (live) => controllerOfStream?.enqueue(encoder.encode(JSON.stringify({ kind: 'view', view: view(entries, live) }) + '\n'));
  const submits = [];
  const fetch = async request => {
    const op = new URL(request.url).searchParams.get('op');
    if (op === 'watch') return new Response(new ReadableStream({ start(c) { controllerOfStream = c; push(); } }), { headers: { 'content-type': 'application/x-ndjson' } });
    if (op === 'submit') {
      const body = await request.json(); submits.push(body);
      await sleep(submitMs);
      if (fail) throw new TypeError('network down');
      setTimeout(() => { entries = [...entries, userEntry(next++, body.content)]; push({ run: { taskId: 1, inputs: [1] } }); }, placeMs);
      return Response.json({ submissionId: submits.length });
    }
    return new Response('{}', { status: 404 });
  };
  return { fetch, submits, reply: text => { entries = [...entries, assistantEntry(next++, text)]; push(); }, finish: () => push(), stream: text => push({ run: { taskId: 1, inputs: [1] }, generation: { message: { content: [{ type: 'text', text }] } } }) };
}

async function chat(options, controllerOptions = {}) {
  const fake = host(options);
  const remote = await createRemoteChat({ endpoint, fetch: fake.fetch, pollMs: 20 });
  const controller = createNativeChatController({ identity, ...remote, ...controllerOptions });
  await controller.connect();
  return { fake, controller, snapshot: () => controller.getSnapshot() };
}

test('the message is in the snapshot the moment send is called, long before the server shows it', async t => {
  const { controller, snapshot } = await chat({ submitMs: 600, placeMs: 300 });
  t.after(() => controller.dispose());
  controller.setText('Que faire des factures ?');
  const started = performance.now();
  const sent = controller.send();
  // Synchronously after send(): the composer is empty and the message is the person's, sending.
  assert.equal(snapshot().draft.text, '');
  assert.deepEqual(snapshot().echo.map(item => [item.draft.text, item.state]), [['Que faire des factures ?', 'sending']]);
  assert.ok(performance.now() - started < 100, 'under 100 ms');
  assert.equal(snapshot().view.entries.length, 0, 'the server has not shown it');
  await sent;
});

test('no duplicate: the echo is dropped when the server\'s own copy arrives', async t => {
  const { controller, snapshot } = await chat({ submitMs: 50, placeMs: 100 });
  t.after(() => controller.dispose());
  controller.setText('Bonjour');
  await controller.send();
  await until('server copy', () => snapshot().view.entries.length === 1);
  assert.deepEqual(snapshot().echo, []);
  // Two identical messages in a row: each echo is dropped by its own copy.
  controller.setText('Bonjour'); await controller.send();
  controller.setText('Bonjour'); void controller.send();
  await until('both copies', () => snapshot().view.entries.length === 3);
  await until('echo gone', () => snapshot().echo.length === 0);
});

test('the working state shows with the message, and a refused message goes back to the composer without an echo', async t => {
  const { controller, snapshot } = await chat({}, { beforeSubmit: async draft => draft.text === 'non' ? 'Refusé' : undefined });
  t.after(() => controller.dispose());
  controller.setText('non');
  await controller.send();
  assert.deepEqual(snapshot().echo, []);
  assert.equal(snapshot().draft.text, 'non');
  assert.equal(snapshot().send.kind, 'blocked');
});

test('a send that fails keeps the message with a failed state; retry shows it sending again', async t => {
  const { fake, controller, snapshot } = await chat({ submitMs: 20, fail: true });
  t.after(() => controller.dispose());
  controller.setText('Important');
  await controller.send();
  assert.equal(snapshot().send.kind, 'unknown');
  assert.deepEqual(snapshot().echo.map(item => item.state), ['failed']);
  fake.submits.length = 0;
  const retry = controller.retrySameRequest();
  await sleep(5);
  assert.deepEqual(snapshot().echo.map(item => item.state), ['sending'], 'retry shows sending again');
  await retry;
  assert.deepEqual(snapshot().echo.map(item => item.state), ['failed']);
});

test('the steps are timed: input ready, enter, shown, first words, done', async t => {
  const { fake, controller, snapshot } = await chat({ submitMs: 30, placeMs: 30 });
  t.after(() => controller.dispose());
  assert.equal(typeof snapshot().timing.inputReady, 'number');
  controller.setText('Question');
  await controller.send();
  const [only] = snapshot().timing.sends;
  controller.markShown(snapshot().echo.map(item => item.key));
  await until('placed', () => snapshot().view.entries.length === 1);
  fake.stream('Voici');
  await until('first words', () => snapshot().timing.sends[0].firstWords !== undefined);
  fake.reply('Voici la réponse');
  fake.finish();
  await until('done', () => snapshot().timing.sends[0].done !== undefined);
  const [timing] = snapshot().timing.sends;
  assert.equal(timing.key, only.key);
  assert.ok(timing.enter <= timing.shown && timing.shown <= timing.firstWords && timing.firstWords <= timing.done, JSON.stringify(timing));
  assert.ok(performance.getEntriesByName('boring-chat:enter').length >= 1);
});
