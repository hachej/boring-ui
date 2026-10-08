import assert from 'node:assert/strict';
import test from 'node:test';
import { experimental_createEvaluator } from '@json-render/core';
import { composeExperience, validateExperience } from '@hachej/boring-ui-kit/experience/compose';

const cell = { ref: 'fictional/summary', kind: 'fictional/card', version: 1, maxUses: 1 };
const fallback = () => ({
  format: 'boring.experience', version: 1, name: 'fictional-page', source: 'fixed',
  kinds: { 'boring/stack': 1, 'boring/cell': 1, 'fictional/card': 1 }, root: 'page',
  elements: {
    page: { type: 'boring/stack', props: {}, children: ['summary'] },
    summary: { type: 'boring/cell', props: { ref: cell.ref }, children: [] },
  },
});
const chooseOffered = async request => ({ answers: Object.fromEntries(Object.entries(request.questions).map(([name, question]) => {
  const offered = Object.keys(question.criteria);
  const choice = name === 'root' ? offered[0] : offered.find(key => key.startsWith('use:')) ?? (offered.includes('0') ? '0' : offered[0]);
  return [name, { choice }];
})) });
function options(overrides = {}) {
  const abort = new AbortController();
  return {
    cells: [cell], canView: () => true,
    definition: { name: 'fictional-page', title: 'Fictional page', intents: { morning: 'Arrange the registered cards.' },
      kinds: [{ kind: cell.kind, description: 'Registered summary card', metadata: { urgency: ['ordinary', 'time-bound'] } }] },
    candidates: [{ ref: cell.ref, metadata: { urgency: 'ordinary' }, resource: 'private-resource-identifier', root: false }],
    intent: 'morning', fallback: fallback(), evaluate: chooseOffered, signal: abort.signal,
    limits: { maxElements: 12, maxDepth: 8, maxEvaluations: 8 }, ...overrides,
  };
}
function twoCells(overrides = {}) {
  const input = options(overrides), second = { ...cell, ref: 'fictional/details' };
  return { ...input, cells: [cell, second], candidates: [...input.candidates,
    { ref: second.ref, metadata: { urgency: 'time-bound' }, resource: 'private-resource-details', root: false },
  ] };
}
const collect = async value => { const snapshots = []; for await (const snapshot of composeExperience(value)) snapshots.push(snapshot); return snapshots; };
async function within(promise, label) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(label)), 2000); })]); }
  finally { clearTimeout(timer); }
}

test('native deterministic composer yields a validated default and detached generated snapshots', async () => {
  const input = options();
  const snapshots = await collect(input);
  assert.equal(snapshots[0].kind, 'default');
  assert.equal(snapshots[0].reason, 'pending');
  assert.equal(snapshots[0].descriptor.source, 'fixed');
  assert.equal(snapshots.at(-1).kind, 'final');
  assert.equal(snapshots.at(-1).descriptor.source, 'generated');
  assert.ok(snapshots.some(snapshot => snapshot.kind === 'partial'));
  assert.ok(snapshots.every((snapshot, index) => snapshot.sequence === index));
  assert.equal(new Set(snapshots.map(snapshot => snapshot.compositionId)).size, 1);
  for (const snapshot of snapshots) {
    assert.ok(Object.isFrozen(snapshot));
    if (snapshot.descriptor) {
      assert.ok(Object.isFrozen(snapshot.descriptor));
      assert.notEqual(snapshot.descriptor, input.fallback);
      validateExperience(snapshot.descriptor, input);
      assert.equal('state' in snapshot.descriptor, false);
      assert.equal('initialState' in snapshot.descriptor, false);
    }
  }
  const final = snapshots.at(-1).descriptor;
  const refs = Object.values(final.elements).filter(element => element.type === 'boring/cell').map(element => element.props.ref);
  assert.ok(refs.includes(cell.ref));
  assert.ok(refs.every(ref => ref === cell.ref));
  assert.equal(final.kinds[cell.kind], cell.version);
});

test('evaluator receives only registered static descriptions, metadata and opaque candidate identities', async () => {
  const sentinel = {
    props: 'SENTINEL-PROPS-31', state: 'SENTINEL-STATE-32', binding: 'SENTINEL-BINDING-33',
    action: 'SENTINEL-ACTION-34', id: 'SENTINEL-ID-35', context: 'SENTINEL-CONTEXT-36',
    resource: 'SENTINEL-RESOURCE-37', error: 'SENTINEL-ERROR-38',
  };
  const input = options();
  input.candidates[0] = { ...input.candidates[0], resource: sentinel.resource,
    props: { body: sentinel.props }, state: { body: sentinel.state }, binding: sentinel.binding,
    on: { press: sentinel.action }, id: sentinel.id, description: 'unregistered private description' };
  input.context = sentinel.context;
  input.initialState = { body: sentinel.state };
  input.instructions = sentinel.binding;
  const requests = [];
  input.evaluate = async request => {
    requests.push(structuredClone({ state: request.state, questions: request.questions }));
    return chooseOffered(request);
  };
  assert.equal((await collect(input)).at(-1).kind, 'final');
  const sent = JSON.stringify(requests);
  assert.ok(requests.length > 0);
  assert.ok(sent.includes('Registered summary card'));
  assert.ok(sent.includes('urgency: ordinary'));
  assert.ok(sent.includes('Arrange the registered cards.'));
  assert.ok(!sent.includes(cell.ref));
  assert.ok(!sent.includes('unregistered private description'));
  for (const value of Object.values(sentinel)) assert.ok(!sent.includes(value), `${value} reached evaluator`);
});

test('invalid bounds, metadata and unknown intent refuse before evaluator work', async () => {
  for (const change of [
    input => { input.limits.maxElements = 0; },
    input => { input.limits.maxDepth = 25; },
    input => { input.limits.maxEvaluations = 33; },
    input => { input.intent = 'unregistered'; },
    input => { input.candidates[0].metadata.urgency = 'unregistered'; },
    input => { input.candidates[0].metadata.privateValue = 'fictional record'; },
    input => { input.candidates[0].ref = 'other/private'; },
    input => { input.candidates.push({ ...input.candidates[0] }); },
  ]) {
    let evaluations = 0;
    const input = options({ evaluate: async request => { evaluations++; return chooseOffered(request); } });
    change(input);
    const snapshots = await collect(input);
    assert.equal(snapshots[0].kind, 'default');
    assert.equal(snapshots.at(-1).kind, 'default');
    assert.equal(snapshots.at(-1).reason, 'unavailable');
    assert.equal(evaluations, 0);
  }
});

test('malformed native choice and evaluator errors retain the original fallback without leaking details', async () => {
  for (const evaluate of [
    async () => ({ answers: { root: { choice: 'not-offered' } } }),
    async () => { throw new Error('SENTINEL-PRIVATE-EVALUATOR-ERROR'); },
  ]) {
    const snapshots = await collect(options({ evaluate }));
    assert.equal(snapshots[0].kind, 'default');
    assert.equal(snapshots.at(-1).kind, 'default');
    assert.equal(snapshots.at(-1).reason, 'unavailable');
    assert.deepEqual(snapshots.at(-1).descriptor, snapshots[0].descriptor);
    assert.ok(!JSON.stringify(snapshots).includes('SENTINEL-PRIVATE-EVALUATOR-ERROR'));
  }
});

test('revoked current visibility prevents a generated snapshot and never reuses another cell', async () => {
  let visible = true;
  const input = options({ canView: () => visible, evaluate: async request => {
    visible = false;
    return chooseOffered(request);
  } });
  const snapshots = await collect(input);
  assert.equal(snapshots[0].kind, 'default');
  assert.equal(snapshots.at(-1).kind, 'default');
  assert.equal(snapshots.at(-1).reason, 'unavailable');
  assert.equal(snapshots.at(-1).descriptor, null);
  assert.ok(snapshots.every(snapshot => snapshot.kind === 'default'));
});

test('revocation after a valid partial stops before another evaluator delegation', async () => {
  let visible = true, evaluations = 0;
  const iterator = composeExperience(twoCells({ canView: () => visible, evaluate: async request => {
    evaluations++;
    return chooseOffered(request);
  } }));
  assert.equal((await iterator.next()).value.kind, 'default');
  let partial;
  for (let count = 0; count < 12 && !partial; count++) {
    const item = await iterator.next();
    assert.equal(item.done, false);
    if (item.value.kind === 'partial') partial = item.value;
  }
  assert.equal(partial.kind, 'partial');
  assert.ok(evaluations > 0);
  const before = evaluations;
  visible = false;
  const denied = await iterator.next();
  assert.equal(denied.value.kind, 'default');
  assert.equal(denied.value.reason, 'unavailable');
  assert.equal(denied.value.descriptor, null);
  assert.equal(evaluations, before);
  assert.equal((await iterator.next()).done, true);
});

test('a host budget denial makes no fake-provider request and returns a sanitized default', async () => {
  let providerRequests = 0;
  const fakeProvider = async request => { providerRequests++; return chooseOffered(request); };
  const hostEvaluator = async request => {
    const budgetApproved = false;
    if (!budgetApproved) throw new Error('SENTINEL-PRIVATE-BUDGET-REASON');
    return fakeProvider(request);
  };
  const snapshots = await collect(options({ evaluate: hostEvaluator }));
  assert.equal(providerRequests, 0);
  assert.equal(snapshots[0].kind, 'default');
  assert.equal(snapshots.at(-1).kind, 'default');
  assert.equal(snapshots.at(-1).reason, 'unavailable');
  assert.deepEqual(snapshots.at(-1).descriptor, snapshots[0].descriptor);
  assert.ok(!JSON.stringify(snapshots).includes('SENTINEL-PRIVATE-BUDGET-REASON'));
});

test('caller inputs are captured before yielding default while visibility remains live', async () => {
  const requests = [];
  const input = options({ evaluate: async request => {
    requests.push(structuredClone({ state: request.state, questions: request.questions }));
    return chooseOffered(request);
  } });
  const iterator = composeExperience(input);
  const first = await iterator.next();
  assert.equal(first.value.kind, 'default');
  input.definition.name = 'mutated-name';
  input.definition.intents.morning = 'SENTINEL-MUTATED-INTENT';
  input.candidates[0].metadata.urgency = 'time-bound';
  input.candidates[0].ref = 'other/private';
  const rest = [];
  for await (const item of iterator) rest.push(item);
  assert.equal(rest.at(-1).kind, 'final');
  assert.equal(rest.at(-1).descriptor.name, 'fictional-page');
  const sent = JSON.stringify(requests);
  assert.ok(sent.includes('Arrange the registered cards.'));
  assert.ok(sent.includes('urgency: ordinary'));
  assert.ok(!sent.includes('SENTINEL-MUTATED-INTENT'));
  assert.ok(!sent.includes('time-bound'));
});

test('pre-abort and mid-evaluation abort produce sanitized defaults with no claimed termination', async () => {
  const pre = new AbortController(); pre.abort();
  let evaluations = 0;
  const before = await collect(options({ signal: pre.signal, evaluate: async request => { evaluations++; return chooseOffered(request); } }));
  assert.equal(before.at(-1).kind, 'default');
  assert.equal(before.at(-1).reason, 'cancelled');
  assert.equal(evaluations, 0);

  const mid = new AbortController(), entered = Promise.withResolvers(), never = Promise.withResolvers();
  const iterator = composeExperience(options({ signal: mid.signal, evaluate: () => { entered.resolve(); return never.promise; } }));
  assert.equal((await iterator.next()).value.kind, 'default');
  const pending = iterator.next();
  await within(entered.promise, 'Native evaluator was not called');
  mid.abort();
  const outcome = await within(pending, 'Abort did not settle native composition');
  assert.equal(outcome.value.kind, 'default');
  assert.equal(outcome.value.reason, 'cancelled');
  never.resolve({ answers: {} });
  await iterator.return();
});


test('native Gateway evaluator composes through fictional fetch with host admission before each request', async () => {
  const bodies = [], usage = [];
  let admitted = true;
  const native = experimental_createEvaluator({ apiKey: 'fictional-key', model: 'typesafe-ai/jev', fetch: async (url, init) => {
    assert.equal(url, 'https://ai-gateway.vercel.sh/v4/ai/evaluation-model');
    assert.equal(init.method, 'POST');
    const request = JSON.parse(init.body);
    bodies.push(request);
    const selected = await chooseOffered(request);
    return Response.json({ answers: Object.fromEntries(Object.entries(selected.answers).map(([key, answer]) => [key, { ...answer, type: 'choice' }])), usage: { inputTokens: 7 } });
  } });
  const evaluate = async request => {
    if (!admitted) throw new Error('SENTINEL-PRIVATE-BUDGET-REASON');
    const result = await native(request);
    usage.push(result.usage.inputTokens);
    return result;
  };
  const success = await collect(twoCells({ evaluate }));
  assert.equal(success.at(-1).kind, 'final');
  assert.equal(bodies.length, 2);
  assert.deepEqual(usage, [7, 7]);
  assert.ok(!JSON.stringify(bodies).includes(cell.ref));
  assert.ok(!JSON.stringify(bodies).includes('private-resource-identifier'));
  const iterator = composeExperience(twoCells({ evaluate }));
  await iterator.next();
  assert.equal((await iterator.next()).value.kind, 'partial');
  assert.equal(bodies.length, 3);
  admitted = false;
  const denied = (await iterator.next()).value;
  assert.equal(denied.kind, 'default');
  assert.equal(denied.reason, 'unavailable');
  assert.equal(bodies.length, 3);
  assert.ok(!JSON.stringify(denied).includes('SENTINEL-PRIVATE-BUDGET-REASON'));
  await iterator.return();
});

test('evaluation limit and cancellation after a partial retain the default without a final layout', async () => {
  let calls = 0;
  const limited = await collect(twoCells({ limits: { maxElements: 12, maxDepth: 8, maxEvaluations: 1 }, evaluate: async request => { calls++; return chooseOffered(request); } }));
  assert.equal(calls, 1);
  assert.equal(limited.at(-1).kind, 'default');
  assert.equal(limited.at(-1).reason, 'limit');
  assert.deepEqual(limited.at(-1).descriptor, limited[0].descriptor);
  const abort = new AbortController();
  calls = 0;
  const iterator = composeExperience(twoCells({ signal: abort.signal, evaluate: async request => { calls++; return chooseOffered(request); } }));
  await iterator.next();
  assert.equal((await iterator.next()).value.kind, 'partial');
  abort.abort();
  const cancelled = (await iterator.next()).value;
  assert.equal(cancelled.kind, 'default');
  assert.equal(cancelled.reason, 'cancelled');
  assert.equal(calls, 1);
  await iterator.return();
});
