import assert from 'node:assert/strict';
import test from 'node:test';
import { validateExperience } from '@hachej/boring-ui-kit/experience/compose';
import { composeExperienceRegion } from '@hachej/boring-ui-kit/experience/regions';

const cards = [
  { ref: 'fictional/header', kind: 'fictional/card', version: 1 },
  { ref: 'fictional/default', kind: 'fictional/card', version: 1 },
  { ref: 'fictional/summary', kind: 'fictional/card', version: 1 },
  { ref: 'fictional/hidden', kind: 'fictional/secret', version: 1 },
];
const access = (overrides = {}) => ({ cells: cards, canView: () => true, ...overrides });
const regionProps = (overrides = {}) => ({ region: 'main', candidates: ['fictional/default', 'fictional/summary'],
  kinds: ['boring/stack', 'boring/cell', 'fictional/card'], maxElements: 5, minWidth: 280,
  regenerate: ['request', 'phase'], prompt: 'Arrange registered cards.', ...overrides });
function page(overrides = {}) {
  return { format: 'boring.experience', version: 1, name: 'fictional-page', source: 'fixed',
    kinds: { 'boring/stack': 1, 'boring/cell': 1, 'boring/generated': 1, 'fictional/card': 1 },
    root: 'page', elements: {
      page: { type: 'boring/stack', props: {}, children: ['heading', 'region'] },
      heading: { type: 'boring/cell', props: { ref: 'fictional/header' }, children: [] },
      region: { type: 'boring/generated', props: regionProps(), children: ['default'] },
      default: { type: 'boring/cell', props: { ref: 'fictional/default' }, children: [] },
    }, ...overrides };
}
const choice = async request => ({ answers: Object.fromEntries(Object.entries(request.questions).map(([name, question]) => {
  const offered = Object.keys(question.criteria);
  return [name, { choice: name === 'root' ? offered[0]
    : offered.find(key => key.startsWith('use:')) ?? (offered.includes('0') ? '0' : offered[0]) }];
})) });
function composeOptions(overrides = {}) {
  const abort = new AbortController();
  return { ...access(), definition: { name: 'fictional-page', intents: { cards: 'Arrange registered cards.' },
      kinds: [{ kind: 'fictional/card', description: 'Registered card', metadata: { urgency: ['ordinary', 'soon'] } },
        { kind: 'fictional/secret', description: 'Registered secret card', metadata: { urgency: ['private'] } }] },
    candidates: [{ ref: 'fictional/summary', metadata: { urgency: 'ordinary' }, resource: 'SENTINEL-PRIVATE-RESOURCE' }],
    intent: 'cards', descriptor: page(), region: 'main', trigger: 'request', evaluate: choice,
    signal: abort.signal, limits: { maxElements: 12, maxDepth: 8, maxEvaluations: 8 }, ...overrides };
}
const collect = async options => { const result = []; for await (const snapshot of composeExperienceRegion(options)) result.push(snapshot); return result; };

test('generated region validates defaults and refuses out-of-region cells, kinds and sizes', () => {
  const valid = validateExperience(page(), access());
  assert.equal(valid.elements.region.props.region, 'main');
  assert.equal(valid.elements.region.props.minWidth, 280);
  assert.deepEqual(valid.elements.page.children, ['heading', 'region']);
  const changed = edit => { const value = structuredClone(page()); edit(value); return value; };
  for (const invalid of [
    changed(value => { value.elements.region.props.candidates = ['fictional/summary']; }),
    changed(value => { value.elements.region.props.candidates = ['fictional/default', 'fictional/default']; }),
    changed(value => { value.elements.region.props.regenerate = ['request', 'request']; }),
    changed(value => { value.elements.region.props.kinds = ['boring/stack']; }),
    changed(value => { value.elements.region.props.maxElements = 0; }),
    changed(value => { value.elements.region.props.maxElements = 1; value.elements.region.children = ['wrapper'];
      value.elements.wrapper = { type: 'boring/stack', props: {}, children: ['default'] }; }),
    changed(value => { value.elements.region.props.minWidth = -1; }),
    changed(value => { value.elements.region.children = ['default', 'secret']; value.elements.secret = { type: 'boring/cell', props: { ref: 'fictional/hidden' } }; value.kinds['fictional/secret'] = 1; }),
    changed(value => { value.elements.region.children = ['default', 'second']; value.elements.second = { type: 'boring/generated', props: regionProps({ region: 'main' }), children: [] }; }),
  ]) assert.throws(() => validateExperience(invalid, access()));
});

test('real native region composition returns full validated snapshots and leaves fixed siblings untouched', async () => {
  const input = composeOptions();
  const base = validateExperience(input.descriptor, input);
  const snapshots = await collect(input);
  assert.equal(snapshots[0].kind, 'default');
  assert.deepEqual(snapshots[0].descriptor, base);
  assert.equal(snapshots.at(-1).kind, 'final');
  assert.equal(new Set(snapshots.map(snapshot => snapshot.compositionId)).size, 1);
  assert.ok(snapshots.every((snapshot, index) => snapshot.sequence === index));
  for (const snapshot of snapshots) {
    assert.ok(Object.isFrozen(snapshot));
    if (!snapshot.descriptor) continue;
    validateExperience(snapshot.descriptor, input);
    assert.equal(JSON.stringify(snapshot.descriptor.elements.page), JSON.stringify(base.elements.page));
    assert.equal(JSON.stringify(snapshot.descriptor.elements.heading), JSON.stringify(base.elements.heading));
    assert.equal(JSON.stringify(snapshot.descriptor.elements.region.props), JSON.stringify(base.elements.region.props));
  }
  const final = snapshots.at(-1).descriptor;
  const refs = Object.values(final.elements).filter(element => element.type === 'boring/cell').map(element => element.props.ref);
  assert.ok(refs.includes('fictional/header'));
  assert.ok(refs.includes('fictional/summary'));
  assert.ok(!refs.includes('fictional/hidden'));
  assert.equal(final.elements.region.type, 'boring/generated');
});

test('allowlist narrowing and opaque resource markers prevent hidden candidate data reaching evaluator', async () => {
  const input = composeOptions();
  input.candidates.push({ ref: 'fictional/hidden', metadata: { urgency: 'private' }, resource: 'SENTINEL-HIDDEN-RESOURCE',
    props: { body: 'SENTINEL-HIDDEN-PROPS' }, state: 'SENTINEL-HIDDEN-STATE' });
  const requests = [];
  input.evaluate = async request => { requests.push(structuredClone({ state: request.state, questions: request.questions })); return choice(request); };
  const snapshots = await collect(input);
  const sent = JSON.stringify(requests);
  assert.ok(!sent.includes('fictional/hidden'));
  assert.ok(!sent.includes('SENTINEL-HIDDEN-RESOURCE'));
  assert.ok(!sent.includes('SENTINEL-HIDDEN-PROPS'));
  assert.ok(!sent.includes('SENTINEL-HIDDEN-STATE'));
  assert.ok(!sent.includes('SENTINEL-PRIVATE-RESOURCE'));
  assert.ok(!JSON.stringify(snapshots).includes('fictional/hidden'));
  assert.equal(snapshots.at(-1).kind, 'final');
});

test('wrong trigger or unregistered prompt refuses before evaluator work and retains default', async () => {
  for (const modify of [
    input => { input.trigger = 'open'; },
    input => { input.descriptor.elements.region.props.prompt = 'SENTINEL-UNREGISTERED-PROMPT'; },
    input => { input.region = 'missing'; },
    input => { input.intent = 'missing'; },
  ]) {
    let evaluated = 0;
    const input = composeOptions({ evaluate: async request => { evaluated++; return choice(request); } });
    modify(input);
    const snapshots = await collect(input);
    assert.equal(snapshots[0].kind, 'default');
    assert.equal(snapshots.at(-1).kind, 'default');
    assert.equal(evaluated, 0);
  }
});

test('global use limits and region element budgets apply to merged output', async () => {
  const tooSmall = composeOptions();
  tooSmall.limits.maxElements = 1;
  const bounded = await collect(tooSmall);
  for (const snapshot of bounded.filter(item => item.kind !== 'default')) {
    const region = snapshot.descriptor.elements.region;
    const child = snapshot.descriptor.elements[region.children[0]];
    assert.equal(child.type, 'boring/stack');
    assert.equal(child.children.length, 0);
  }
  const usedOutside = composeOptions();
  usedOutside.descriptor.elements.heading.props.ref = 'fictional/summary';
  const result = await collect(usedOutside);
  for (const snapshot of result) {
    if (!snapshot.descriptor) continue;
    const refs = Object.values(snapshot.descriptor.elements).filter(element => element.type === 'boring/cell').map(element => element.props.ref);
    assert.equal(refs.filter(ref => ref === 'fictional/summary').length, 1);
  }
});

test('outside use exhaustion refuses before the native evaluator sees a candidate', async () => {
  let evaluations = 0;
  const input = composeOptions({ evaluate: async request => { evaluations++; return choice(request); } });
  input.descriptor.elements.heading.props.ref = 'fictional/summary';
  const snapshots = await collect(input);
  assert.equal(snapshots[0].kind, 'default');
  assert.equal(snapshots.at(-1).kind, 'default');
  assert.equal(snapshots.at(-1).reason, 'unavailable');
  assert.equal(evaluations, 0);
});

test('the region arrays are captured before an earlier fixed cell visibility callback mutates input', async () => {
  const input = composeOptions();
  let mutated = false, evaluations = 0;
  input.canView = ref => {
    if (ref === 'fictional/header' && !mutated) {
      mutated = true;
      input.descriptor.elements.region.props.candidates.splice(0, 2, 'fictional/hidden');
      input.descriptor.elements.region.props.regenerate.splice(0, 2, 'open');
    }
    return true;
  };
  input.evaluate = async request => { evaluations++; return choice(request); };
  const snapshots = await collect(input);
  assert.equal(mutated, true);
  assert.ok(evaluations > 0);
  assert.equal(snapshots.at(-1).kind, 'final');
  assert.deepEqual(snapshots[0].descriptor.elements.region.props.candidates, ['fictional/default', 'fictional/summary']);
  assert.deepEqual(snapshots.at(-1).descriptor.elements.region.props.regenerate, ['request', 'phase']);
});

function deepPage(regionDepth) {
  const descriptor = page();
  descriptor.root = 'level_0';
  descriptor.elements = { region: { type: 'boring/generated', props: regionProps(), children: [] } };
  for (let index = 0; index < regionDepth; index++) descriptor.elements[`level_${index}`] = {
    type: 'boring/stack', props: {}, children: [index === regionDepth - 1 ? 'region' : `level_${index + 1}`],
  };
  return descriptor;
}

test('a region at depth 24 refuses before evaluation; depth 23 can place one leaf at 24', async () => {
  let blockedCalls = 0;
  const blocked = composeOptions({ descriptor: deepPage(24), evaluate: async request => { blockedCalls++; return choice(request); } });
  assert.equal(validateExperience(blocked.descriptor, blocked).elements.region.type, 'boring/generated');
  const denied = await collect(blocked);
  assert.equal(denied.at(-1).kind, 'default');
  assert.equal(blockedCalls, 0);

  const allowed = composeOptions({ descriptor: deepPage(23), candidates: [{ ref: 'fictional/summary', metadata: { urgency: 'ordinary' }, root: true }] });
  const choices = async request => ({ answers: Object.fromEntries(Object.entries(request.questions).map(([name, question]) => {
    const offered = Object.keys(question.criteria);
    return [name, { choice: name === 'root' ? offered.find(key => key.includes('candidate_0')) ?? offered.at(-1)
      : offered.find(key => key.startsWith('use:')) ?? (offered.includes('0') ? '0' : offered[0]) }];
  })) });
  allowed.evaluate = choices;
  const snapshots = await collect(allowed);
  assert.equal(snapshots.at(-1).kind, 'final');
  const final = snapshots.at(-1).descriptor;
  const child = final.elements[final.elements.region.children[0]];
  assert.equal(child.type, 'boring/cell');
  assert.equal(child.props.ref, 'fictional/summary');
  validateExperience(final, allowed);
});

test('native error and cancellation keep the full original descriptor with sanitized reason', async () => {
  const failed = await collect(composeOptions({ evaluate: async () => { throw new Error('SENTINEL-PRIVATE-EVALUATOR-ERROR'); } }));
  assert.equal(failed[0].kind, 'default');
  assert.equal(failed.at(-1).kind, 'default');
  assert.deepEqual(failed.at(-1).descriptor, failed[0].descriptor);
  assert.ok(!JSON.stringify(failed).includes('SENTINEL-PRIVATE-EVALUATOR-ERROR'));
  const aborted = new AbortController(); aborted.abort();
  let evaluated = 0;
  const cancelled = await collect(composeOptions({ signal: aborted.signal, evaluate: async request => { evaluated++; return choice(request); } }));
  assert.equal(cancelled.at(-1).kind, 'default');
  assert.equal(cancelled.at(-1).reason, 'cancelled');
  assert.equal(evaluated, 0);
});

test('nested region default validates intersection and inner generation preserves outer fixed members', async () => {
  const nested = page();
  nested.elements.region.props.candidates.push('fictional/header');
  nested.elements.region.props.kinds.push('boring/generated');
  nested.elements.region.children = ['outerFixed', 'inner'];
  delete nested.elements.default;
  nested.elements.outerFixed = { type: 'boring/cell', props: { ref: 'fictional/default' }, children: [] };
  nested.elements.inner = { type: 'boring/generated', props: regionProps({ region: 'inner', candidates: ['fictional/summary'], prompt: 'Arrange registered cards.' }), children: [] };
  const input = composeOptions({ descriptor: nested, region: 'inner' });
  const base = validateExperience(nested, input);
  const snapshots = await collect(input);
  assert.equal(snapshots.at(-1).kind, 'final');
  const final = snapshots.at(-1).descriptor;
  assert.equal(JSON.stringify(final.elements.heading), JSON.stringify(base.elements.heading));
  assert.equal(JSON.stringify(final.elements.outerFixed), JSON.stringify(base.elements.outerFixed));
  assert.equal(JSON.stringify(final.elements.region), JSON.stringify(base.elements.region));
  validateExperience(final, input);
});

test('candidate and descriptor inputs are captured before the first default yield', async () => {
  const requests = [];
  const input = composeOptions({ evaluate: async request => { requests.push(structuredClone({ state: request.state, questions: request.questions })); return choice(request); } });
  const iterator = composeExperienceRegion(input);
  assert.equal((await iterator.next()).value.kind, 'default');
  input.candidates[0].metadata.urgency = 'soon';
  input.candidates[0].ref = 'fictional/hidden';
  input.descriptor.elements.heading.props.ref = 'fictional/hidden';
  input.descriptor.elements.region.props.prompt = 'SENTINEL-MUTATED-PROMPT';
  const later = []; for await (const snapshot of iterator) later.push(snapshot);
  assert.equal(later.at(-1).kind, 'final');
  assert.equal(later.at(-1).descriptor.elements.heading.props.ref, 'fictional/header');
  const sent = JSON.stringify(requests);
  assert.ok(sent.includes('urgency: ordinary'));
  assert.ok(!sent.includes('urgency: soon'));
  assert.ok(!sent.includes('SENTINEL-MUTATED-PROMPT'));
});
