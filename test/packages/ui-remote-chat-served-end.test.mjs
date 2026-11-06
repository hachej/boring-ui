// The host ends each op=watch stream every 25 s with {kind:'end',reason:'session_closed'} (D-1638). The page must close that finished
// response without aborting it (the browser logs an abort as net::ERR_ABORTED), reopen the watch, and never hold two streams open.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createRemoteChat } from '@hachej/boring-ui-kit/remote-chat';

const endpoint = 'https://fixture.invalid/chat';
const view = { conversation: { id: 'c' }, entries: [], docs: {} };
const line = frame => new TextEncoder().encode(JSON.stringify(frame) + '\n');

test('a served session_closed end frame is not aborted or cancelled, and one new watch opens at a time', async () => {
  const watches = [];
  let open = 0, mostOpen = 0;
  const fetch = async request => {
    if (!request.url.includes('op=watch')) return Response.json({});
    const record = { aborted: false, cancelled: false, number: watches.length };
    watches.push(record);
    request.signal.addEventListener('abort', () => { record.aborted = true; });
    open += 1; mostOpen = Math.max(mostOpen, open);
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(line({ kind: 'view', view }));
        // The first stream is ended by the host after a moment; later ones stay open.
        if (record.number === 0) setTimeout(() => { controller.enqueue(line({ kind: 'end', reason: 'session_closed' })); setTimeout(() => { controller.close(); open -= 1; }, 20); }, 30);
      },
      cancel() { record.cancelled = true; open -= 1; },
    });
    return new Response(body, { headers: { 'content-type': 'application/x-ndjson' } });
  };
  const remote = await createRemoteChat({ endpoint, fetch, reconnect: { baseDelayMs: 10, maxDelayMs: 20 } });
  const watch = await remote.conversation.watch();
  watch.start(async () => {});
  const until = async (ok, ms = 3000) => { const stop = Date.now() + ms; while (!ok() && Date.now() < stop) await new Promise(resolve => setTimeout(resolve, 10)); };
  await until(() => watches.length >= 2);
  assert.ok(watches.length >= 2, 'the watch is reopened after the end frame');
  assert.equal(watches[0].aborted, false, 'the finished response is not aborted');
  assert.equal(watches[0].cancelled, false, 'the finished response is not cancelled');
  assert.equal(mostOpen, 1, 'at most one watch stream is open at any moment');
  await watch.stop();
  await remote.close();
});

// An explicit stop (the page hidden, or the chat disposed) while a served end is draining aborts that drain at once; a new watch opens only after.
for (const how of ['hidden', 'disposed']) test(`a ${how} page interrupts a draining served end, then opens one new watch`, async t => {
  const page = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  const saved = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, writable: true, value: page });
  t.after(() => { if (saved) Object.defineProperty(globalThis, 'document', saved); else delete globalThis.document; });
  const watches = [];
  let open = 0, mostOpen = 0;
  const fetch = async request => {
    if (!request.url.includes('op=watch')) return Response.json({});
    const record = { aborted: false, number: watches.length };
    watches.push(record);
    open += 1; mostOpen = Math.max(mostOpen, open);
    let controller;
    request.signal.addEventListener('abort', () => { record.aborted = true; open -= 1; try { controller.error(new Error('aborted')); } catch { /* closed */ } });
    const body = new ReadableStream({
      start(c) {
        controller = c;
        c.enqueue(line({ kind: 'view', view }));
        // The host sends its end frame and then keeps the body open: the page drains it for up to 2 s.
        if (record.number === 0) setTimeout(() => c.enqueue(line({ kind: 'end', reason: 'session_closed' })), 30);
      },
    });
    return new Response(body, { headers: { 'content-type': 'application/x-ndjson' } });
  };
  const remote = await createRemoteChat({ endpoint, fetch, reconnect: { baseDelayMs: 10, maxDelayMs: 20 } });
  const watch = await remote.conversation.watch();
  watch.start(async () => {});
  const until = async (ok, ms = 3000) => { const stop = Date.now() + ms; while (!ok() && Date.now() < stop) await new Promise(resolve => setTimeout(resolve, 10)); };
  await new Promise(resolve => setTimeout(resolve, 150)); // the end frame arrived, the drain is waiting
  const started = Date.now();
  if (how === 'hidden') {
    page.visibilityState = 'hidden'; page.dispatchEvent(new Event('visibilitychange'));
    await until(() => watches[0].aborted, 1000);
    assert.equal(watches[0].aborted, true, 'hiding the page aborts the draining response at once');
    page.visibilityState = 'visible'; page.dispatchEvent(new Event('visibilitychange'));
    await until(() => watches.length >= 2);
    assert.equal(watches.length >= 2, true, 'the return opens a new watch');
    assert.equal(mostOpen, 1, 'the old body is closed before the new one opens');
  } else {
    await watch.stop();
    await until(() => watches[0].aborted, 1000);
    assert.equal(watches[0].aborted, true, 'disposing aborts the draining response at once');
  }
  assert.ok(Date.now() - started < 1500, 'not after the 2 s drain wait');
  await remote.close();
});
