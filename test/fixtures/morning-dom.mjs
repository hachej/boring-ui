import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Window } from 'happy-dom';
import { openMorningRuntime } from '../../examples/morning/runtime.mjs';
import { morningIdentity, morningActionDigest } from '../../examples/morning/documents.mjs';
import { privateCanaries } from '../../examples/morning/fixtures.mjs';
import { morningLayout, fakeMorningEvaluator } from '../../examples/morning/composition.mjs';
import { createMorningHandler } from '../../examples/morning/server.mjs';
import { createMorningClient } from '../../examples/morning/client.mjs';

const modulePath = process.env.MORNING_DOM_MODULE ?? '../../dist/morning-view.js';
test('fictional morning real native/SQLite owner actions and stable experience DOM', { timeout: 60000 }, async t => {
  const directory = mkdtempSync(join(tmpdir(), 'boring-morning-dom-')), window = new Window({ url: 'https://fictional.invalid/' }), globals = new Map();
  let runtime, root, session, act, revoked = false, calendarFailed = false, failEvaluator = false, releaseComposition, heldSignal, delayComposition = false, delayEvaluation = false, releaseEvaluation, dropReply = false, mutateReply, mutateRequest, denyLookup = false;
  const evaluated = [], requests = [];
  for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Text', 'DOMParser', 'MutationObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame']) {
    globals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: name === 'window' ? window : typeof window[name] === 'function' && /^[a-z]/.test(name) ? window[name].bind(window) : window[name] });
  }
  globals.set('IS_REACT_ACT_ENVIRONMENT', Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT')); globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  t.after(async () => { releaseComposition?.(); releaseEvaluation?.(); if (root) await act(async () => root.unmount()); await session?.dispose(); await runtime?.close(); await window.happyDOM.close(); rmSync(directory, { recursive: true, force: true }); for (const [name, descriptor] of globals) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; } });
  const react = await import('react'); act = react.act; const { createRoot } = await import('react-dom/client');
  const { MorningView, createMorningSession } = await import(modulePath);
  runtime = await openMorningRuntime({ directory, layout: morningLayout, authorize: (app, permission) => !(revoked && app === 'email' && ['write', 'execute'].includes(permission)) && !(calendarFailed && app === 'calendar') });
  const prepared = await runtime.prepare(); assert.ok(prepared); const counts = structuredClone(runtime.local.publicationCounts);
  const handler = createMorningHandler({ runtime, getOrigin: () => 'https://fictional.invalid', evaluate: async input => { evaluated.push(structuredClone(input)); if (delayEvaluation) { delayEvaluation = false; await new Promise(resolve => { releaseEvaluation = resolve; }); } if (failEvaluator) throw new Error('Fictional evaluator unavailable'); return fakeMorningEvaluator(input); }, beforeCompose: async signal => { if (delayComposition) { delayComposition = false; heldSignal = signal; await new Promise(resolve => { releaseComposition = resolve; }); } } });
  const transport = async request => {
    requests.push(new URL(request.url).pathname);
    const headers = new Headers(request.headers); headers.set('authorization', denyLookup && new URL(request.url).pathname === '/todo/lookup' ? 'Bearer foreign' : 'Bearer fictional-morning'); headers.set('origin', 'https://fictional.invalid');
    if (mutateRequest && new URL(request.url).pathname === mutateRequest.path) {
      const mutation = mutateRequest; mutateRequest = undefined;
      const input = await request.clone().json(); await mutation.change(input);
      request = new Request(request.url, { method: request.method, headers: request.headers, body: JSON.stringify(input) });
    }
    const response = await handler(new Request(request, { headers }));
    if (mutateReply && new URL(request.url).pathname === mutateReply.path) {
      const mutation = mutateReply; mutateReply = undefined;
      const value = await response.json(); mutation.change(value);
      return new Response(JSON.stringify(value), { status: response.status, headers: response.headers });
    }
    if (dropReply && new URL(request.url).pathname === '/todo/tick') { dropReply = false; throw new Error('Lost response after effect'); }
    return response;
  };
  const client = createMorningClient({ origin: 'https://fictional.invalid', identity: morningIdentity, fetch: transport });
  session = await createMorningSession(client); const container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  await act(async () => root.render(react.createElement(MorningView, { session }))); assert.deepEqual(runtime.local.publicationCounts, counts);
  const button = label => { const found = [...container.querySelectorAll('button')].find(node => node.textContent === label); assert.ok(found, label); return found; };
  const click = async label => act(async () => button(label).click());
  const wait = async predicate => { for (let i = 0; i < 200 && !predicate(); i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); }); assert.ok(predicate()); };
  const structure = () => [...container.querySelector('[data-boring=experience]').querySelectorAll('[data-boring], [data-cell], h1, h2, button')].map(node => [node.tagName, node.getAttribute('data-boring'), node.getAttribute('data-cell'), ['H1', 'H2', 'BUTTON'].includes(node.tagName) ? node.textContent : null]);
  const appStructure = structure(), sameDescriptor = session.experience.getSnapshot().descriptor;
  await act(async () => root.render(react.createElement('section', { 'data-host': 'embedded' }, react.createElement(MorningView, { session }))));
  assert.deepEqual(structure(), appStructure); assert.equal(session.experience.getSnapshot().descriptor, sameDescriptor); assert.deepEqual(runtime.local.publicationCounts, counts);
  const draftNode = container.querySelector('[data-fixed-reply] textarea'); assert.ok(draftNode);
  await act(async () => { Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(draftNode, 'Private local reply draft'); draftNode.dispatchEvent(new window.Event('input', { bubbles: true })); draftNode.focus(); draftNode.setSelectionRange(3, 9); });
  assert.equal(session.reply.getSnapshot().dirty, true); assert.equal(button('Send saved reply').disabled, true);
  delayComposition = true; await click('Regenerate decisions'); await wait(() => typeof releaseComposition === 'function');
  draftNode.focus(); draftNode.setSelectionRange(3, 9); const beforeLayout = session.experience.getSnapshot().text;
  await act(async () => { releaseComposition(); await new Promise(resolve => setTimeout(resolve, 20)); }); await wait(() => !!session.experience.getSnapshot().proposal);
  assert.equal(session.experience.getSnapshot().text, beforeLayout); assert.equal(container.querySelector('[data-fixed-reply] textarea'), draftNode); assert.equal(document.activeElement, draftNode); assert.equal(draftNode.selectionStart, 3); assert.equal(draftNode.value, 'Private local reply draft');
  await click('Use proposed region'); assert.equal(container.querySelector('[data-fixed-reply] textarea'), draftNode); assert.equal(session.reply.getSnapshot().dirty, true);
  assert.deepEqual(session.experience.getSnapshot().descriptor.elements.header, morningLayout.elements.header); assert.deepEqual(session.experience.getSnapshot().descriptor.elements.reply, morningLayout.elements.reply);
  await click('Pin this region'); await wait(() => session.experience.getSnapshot().save.kind === 'settled'); assert.equal(session.experience.getSnapshot().save.result.kind, 'saved');
  const beforePhase = session.experience.getSnapshot().text;
  await act(async () => { const started = session.experience.actions.beginRegion(session.experience.actions.selection(), 'decisions', 'phase'); assert.equal(started.kind, 'applied'); await session.regenerate(started.value); });
  assert.ok(session.experience.getSnapshot().proposal); assert.equal(session.experience.getSnapshot().text, beforePhase); await click('Dismiss proposed region');
  const captured = JSON.stringify(evaluated), descriptor = session.experience.getSnapshot().text;
  for (const marker of [...Object.values(privateCanaries), 'Private local reply draft']) { assert.ok(!captured.includes(marker)); assert.ok(!descriptor.includes(marker)); }
  const noLocalWrites = structuredClone(runtime.local.publicationCounts), beforeLocalRequests = requests.length; await click('Expand email'); await click('Focus reply'); assert.deepEqual(runtime.local.publicationCounts, noLocalWrites); assert.equal(requests.length, beforeLocalRequests);
  failEvaluator = true; const evaluationsBeforeFailure = evaluated.length; const beforeFailure = session.experience.getSnapshot().text; await click('Regenerate decisions'); await wait(() => evaluated.length > evaluationsBeforeFailure && session.inspect().compositionStatus.includes('retained') && !session.inspect().compositionStatus.startsWith('Composing')); assert.equal(session.experience.getSnapshot().proposal, null); assert.equal(session.experience.getSnapshot().text, beforeFailure); assert.equal(draftNode.value, 'Private local reply draft'); failEvaluator = false;
  delayComposition = true; releaseComposition = undefined; session.compositionAbort = new AbortController();
  const beforeCancel = session.experience.getSnapshot().text, evaluationCount = evaluated.length;
  await click('Regenerate decisions'); await wait(() => typeof releaseComposition === 'function');
  const cancelledSignal = heldSignal; await act(async () => { session.compositionAbort.abort(); }); await wait(() => cancelledSignal.aborted);
  await act(async () => { releaseComposition(); await new Promise(resolve => setTimeout(resolve, 10)); });
  await wait(() => session.inspect().compositionStatus.includes('cancelled')); assert.equal(session.experience.getSnapshot().text, beforeCancel); assert.equal(evaluated.length, evaluationCount); session.compositionAbort = undefined;
  await act(async () => { await session.reply.flush(session.reply.actions.selection()); }); assert.equal(session.reply.getSnapshot().dirty, false);
  revoked = true; const beforeDenied = structuredClone(runtime.local.publicationCounts); await click('Send saved reply'); await wait(() => session.inspect().outcomes.email?.result.kind === 'denied'); assert.deepEqual(runtime.local.publicationCounts, beforeDenied); revoked = false;
  const unchangedRequests = [
    ['/email/send', async () => client.email.send({ expected: (await runtime.email.read(morningIdentity)).revision, draftRevision: session.reply.getSnapshot().base.target.revision }), input => { input.draftRevision = 'different-draft-revision'; }],
    ['/email/snooze', async () => client.email.snooze({ expected: (await runtime.email.read(morningIdentity)).revision, option: 'later' }), input => { input.expected = 'different-email-revision'; }],
    ['/calendar/slot', async () => client.calendar.acceptSlot({ expected: (await runtime.calendar.read(morningIdentity)).revision, optionId: 'early' }), input => { input.optionId = 'late'; }],
    ['/todo/tick', async () => client.todo.setCompleted({ expected: (await runtime.todo.read(morningIdentity)).revision, itemId: 'reply', completed: true }), input => { input.completed = false; }],
  ];
  for (const [path, operation, change] of unchangedRequests) {
    const before = structuredClone(runtime.local.publicationCounts); mutateRequest = { path, change };
    const result = await operation(); assert.equal(mutateRequest, undefined); assert.equal(result.result.kind, 'denied'); assert.deepEqual(runtime.local.publicationCounts, before);
  }
  const email = await runtime.email.read(morningIdentity);
  const forged = await client.email.send({ expected: email.revision, draftRevision: session.reply.getSnapshot().base.target.revision, app: 'calendar' }); assert.equal(forged.result.kind, 'denied');
  await click('Snooze'); await wait(() => session.inspect().outcomes.email?.result.kind === 'committed'); assert.equal((await runtime.email.read(morningIdentity)).document.status, 'snoozed');
  await click('Send saved reply'); await wait(() => (session.inspect().outcomes.email?.result.kind === 'committed' && session.inspect().apps.email.document.status === 'queued')); assert.match(container.textContent, /Queued in fictional outbox/); assert.equal((await runtime.email.read(morningIdentity)).document.status, 'queued');
  const calendar = await runtime.calendar.read(morningIdentity); await click(`Accept ${calendar.document.options[0].label}`); await wait(() => session.inspect().outcomes.calendar?.result.kind === 'committed'); assert.equal((await runtime.calendar.read(morningIdentity)).document.selected, calendar.document.options[0].id);
  dropReply = true; await act(async () => container.querySelector('input[aria-label="Tick reply"]').click()); await wait(() => session.inspect().outcomes.todo?.result.kind === 'unknown'); const afterLost = structuredClone(runtime.local.publicationCounts), lostId = session.inspect().outcomes.todo.intent.operationId;
  assert.equal((await runtime.todo.lookup(lostId, morningIdentity)).kind, 'committed');
  denyLookup = true; await click('Reconcile todo'); await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
  assert.equal(session.inspect().outcomes.todo.result.kind, 'unknown'); assert.equal(session.inspect().outcomes.todo.result.operationId, lostId); assert.equal(container.querySelector('input[aria-label="Tick reply"]').disabled, true); assert.deepEqual(runtime.local.publicationCounts, afterLost);
  denyLookup = false; await click('Reconcile todo'); await wait(() => session.inspect().outcomes.todo?.result.kind === 'committed'); assert.deepEqual(runtime.local.publicationCounts, afterLost);
  const beforeRebound = structuredClone(runtime.local.publicationCounts), todoBeforeRebound = await runtime.todo.read(morningIdentity);
  mutateRequest = { path: '/todo/tick', change: async input => { input.completed = !input.completed; input.operationId = `${input.operationId.split(':')[0]}:${await morningActionDigest('/todo/tick', input)}`; } };
  const rebound = await client.todo.setCompleted({ expected: todoBeforeRebound.revision, itemId: 'reply', completed: !todoBeforeRebound.document.items.find(item => item.id === 'reply').completed });
  assert.equal(rebound.result.kind, 'unknown'); assert.equal(runtime.local.publicationCounts.todo, beforeRebound.todo + 1);
  const afterRebound = structuredClone(runtime.local.publicationCounts); assert.equal((await client.todo.lookup(rebound.intent.operationId)).kind, 'unknown'); assert.deepEqual(runtime.local.publicationCounts, afterRebound);
  for (const change of [value => { delete value.receipt; }, value => { value.receipt.principalId = 'foreign'; }, value => { value.receipt.operationId = 'another-operation'; }, value => { value.receipt.changes[0].after.resource.providerId = 'morning-calendar'; }, value => { value.receipt.changes[0].before.revision = 'another-base'; }]) {
    mutateReply = { path: '/todo/tick', change };
    await act(async () => container.querySelector('input[aria-label="Tick reply"]').click()); await wait(() => session.inspect().outcomes.todo?.result.kind === 'unknown');
    const afterMutated = structuredClone(runtime.local.publicationCounts);
    mutateReply = { path: '/todo/lookup', change }; await click('Reconcile todo'); await wait(() => mutateReply === undefined); assert.equal(session.inspect().outcomes.todo.result.kind, 'unknown'); assert.deepEqual(runtime.local.publicationCounts, afterMutated);
    await click('Reconcile todo'); await wait(() => session.inspect().outcomes.todo?.result.kind === 'committed'); assert.deepEqual(runtime.local.publicationCounts, afterMutated);
  }
  await click('Regenerate decisions'); await wait(() => !!session.experience.getSnapshot().proposal); await click('Use proposed region');
  const layoutClient = runtime.layoutClient(morningIdentity), savedLayout = await layoutClient.read({ target: runtime.layoutTarget, revision: { kind: 'latest' } });
  const anotherLayout = await layoutClient.publish({ operationId: 'another-layout', atomicity: 'all-or-nothing', changes: [{ kind: 'replace', target: savedLayout.snapshot.ref, mediaType: 'application/json', bytes: new TextEncoder().encode(JSON.stringify({ ...JSON.parse(new TextDecoder().decode(savedLayout.snapshot.bytes)), title: 'Other fixed morning' })) }] }); assert.equal(anotherLayout.kind, 'committed');
  await click('Keep this layout'); await wait(() => session.experience.getSnapshot().save.kind === 'settled' && session.experience.getSnapshot().save.result.kind === 'conflict'); assert.equal((await layoutClient.read({ target: runtime.layoutTarget, revision: { kind: 'latest' } })).snapshot.ref.revision, anotherLayout.receipt.changes[0].after.revision);
  delayEvaluation = true; const evaluationsBeforeRevocation = evaluated.length;
  const duringEvaluation = client.compose(session.experience.getSnapshot().descriptor, 'request'); await wait(() => typeof releaseEvaluation === 'function');
  calendarFailed = true; releaseEvaluation(); const revokedComposition = await duringEvaluation; assert.equal(revokedComposition.kind, 'denied'); assert.equal(evaluated.length, evaluationsBeforeRevocation + 1);
  for (const marker of Object.values(privateCanaries)) assert.ok(!JSON.stringify(evaluated).includes(marker));
  calendarFailed = true; await act(async () => session.removeCell('calendar/conflict')); assert.equal(container.querySelector('[data-cell=calendar]'), null); assert.equal((await runtime.calendar.read(morningIdentity)).kind, 'denied'); assert.equal((await runtime.todo.read(morningIdentity)).kind, 'available');
  await act(async () => root.render(null)); assert.equal(session.reply.getSnapshot().lifecycle, 'active'); assert.equal(session.experience.getSnapshot().lifecycle, 'active');
  const todo = await runtime.todo.read(morningIdentity), native = await runtime.invokeTool('complete_todo', { expected: todo.revision, itemId: 'calendar', completed: true }, morningIdentity); assert.ok(native.taskId); assert.equal(native.result.kind, 'committed');
});
