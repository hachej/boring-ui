import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Window } from 'happy-dom';
import { build } from 'esbuild';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { fixtureActor, PRIVATE_MARKERS, openFixtureApp } from '../../examples/current-hub/app.mjs';
import { provisionFixtureDefinition } from '../../examples/current-hub/definition.mjs';
import { createFixtureHubView } from '../../examples/current-hub/fixed-view.mjs';

const gate = () => Promise.withResolvers();
const pause = () => new Promise(resolve => setTimeout(resolve, 5));
const markers = Object.values(PRIVATE_MARKERS).flatMap(value => Object.values(value));

test('fixed current-hub cells borrow two native apps and keep private payloads out of the DOM', { timeout: 30000 }, async t => {
  const window = new Window({ url: 'https://fictional.invalid/' }), globals = new Map();
  for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Text', 'DOMParser', 'MutationObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame']) {
    globals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    const value = name === 'window' ? window : window[name];
    Object.defineProperty(globalThis, name, { configurable: true, writable: true,
      value: typeof value === 'function' && /^[a-z]/.test(name) ? value.bind(window) : value });
  }
  globals.set('IS_REACT_ACT_ENVIRONMENT', Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT'));
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const { createElement: h, act, StrictMode } = await import('react');
  const { createRoot } = await import('react-dom/client');
  const directory = await mkdtemp(join(tmpdir(), 'boring-hub-cells-'));
  const definitions = {};
  for (const appId of ['amber', 'blue']) definitions[appId] = await provisionFixtureDefinition({ directory: join(directory, appId), appId });
  const apps = {};
  const blueProducing = gate(), blueRelease = gate();
  t.after(async () => { blueRelease.resolve(); for (const app of Object.values(apps)) await app.close(); await rm(directory, { recursive: true, force: true }); });
  for (const appId of ['amber', 'blue']) apps[appId] = await openFixtureApp({ directory: join(directory, appId), appId,
    definitionRef: definitions[appId], ...(appId === 'blue' ? { beforeProduce: async () => {
      blueProducing.resolve(); await blueRelease.promise;
    } } : {}) });
  const visibility = { amber: true, blue: false }, actors = { amber: fixtureActor('amber'), blue: fixtureActor('blue') };
  const View = createFixtureHubView({ apps, actorFor: id => actors[id], canView: ref => visibility[ref.split('/')[0]] });
  const container = document.createElement('div'); document.body.append(container);
  let root = createRoot(container);
  t.after(async () => {
    await act(async () => root.unmount()); container.remove(); await window.happyDOM.close();
    for (const [name, descriptor] of globals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name];
    }
  });
  const render = async () => { await act(async () => root.render(h(StrictMode, null, h(View)))); };
  const cell = id => { const found = container.querySelector(`[aria-label="${id} report"]`); assert.ok(found); return found; };
  const button = (id, label) => {
    const found = [...cell(id).querySelectorAll('button')].find(node => node.textContent === label);
    assert.ok(found); return found;
  };
  const click = async (id, label) => { await act(async () => button(id, label).click()); };
  const until = async predicate => {
    const deadline = Date.now() + 10000;
    while (!predicate()) { assert.ok(Date.now() < deadline, 'Cell did not settle'); await act(async () => { await pause(); }); }
  };
  const count = async id => (await apps[id].local.storage.scanTasks({}, 100, undefined, context)).items.length;
  const clean = () => { for (const value of markers) assert.equal(container.textContent.includes(value), false); };
  await render();
  assert.equal(await count('amber'), 0); assert.equal(await count('blue'), 0); clean();
  assert.equal(button('blue', 'Run report').disabled, true);
  assert.equal(button('amber', 'Run report').disabled, false);
  visibility.blue = true; await render();
  assert.equal(button('blue', 'Run report').disabled, false);
  await click('amber', 'Run report');
  await until(() => cell('amber').textContent.includes('admitted'));
  assert.equal(await count('blue'), 0);
  const delivery = JSON.parse(cell('amber').querySelector('[data-reference]').getAttribute('data-operation'))[1];
  await apps.amber.local.harness.waitForTask(delivery, context);
  assert.equal(await count('amber'), 3);
  await click('amber', 'Check status');
  await until(() => cell('amber').textContent.includes('completed: committed'));
  await click('blue', 'Run report');
  await until(() => cell('blue').textContent.includes('admitted'));
  await blueProducing.promise;
  assert.equal(await count('blue'), 2); clean();
  const prior = cell('amber').querySelector('[data-reference]').textContent;
  const blueDelivery = JSON.parse(cell('blue').querySelector('[data-reference]').getAttribute('data-operation'))[1];
  await act(async () => root.unmount());
  blueRelease.resolve(); await apps.blue.local.harness.waitForTask(blueDelivery, context);
  const blueRetry = await apps.blue.invoke({ requestId: 'blue-fixed-report', inputRef: 'blue:input:v1', capabilityVersion: '1' }, actors.blue);
  assert.equal(blueRetry.kind, 'admitted');
  const blueObserved = await apps.blue.observe(blueRetry.ref, actors.blue);
  assert.equal(blueObserved.status, 'completed'); assert.equal(blueObserved.publication, 'committed');
  root = createRoot(container); await render();
  assert.equal(await count('amber'), 3); assert.equal(await count('blue'), 3);
  await click('amber', 'Run report');
  await until(() => cell('amber').querySelector('[data-reference]')?.textContent === prior);
  assert.equal(await count('amber'), 3); clean();

  const originalInvoke = apps.amber.invoke;
  apps.amber.invoke = async (...args) => { await originalInvoke(...args); throw new Error(PRIVATE_MARKERS.amber.result); };
  await click('amber', 'Run report');
  await until(() => cell('amber').textContent.includes('unknown'));
  clean(); assert.equal(await count('amber'), 3);
  apps.amber.invoke = originalInvoke;
  await click('amber', 'Run report');
  await until(() => cell('amber').querySelector('[data-reference]')?.textContent === prior);
  assert.equal(await count('amber'), 3);

  const actorDelay = gate(), entered = gate();
  apps.amber.invoke = async (...args) => { const admitted = await originalInvoke(...args); entered.resolve(); await actorDelay.promise; return admitted; };
  await click('amber', 'Run report'); await entered.promise;
  actors.amber = { ...actors.amber, principalId: 'temporary-other-person' }; await render();
  actors.amber = fixtureActor('amber'); await render();
  actorDelay.resolve(); await act(async () => { await pause(); });
  assert.equal(cell('amber').querySelector('[data-reference]'), null);
  assert.equal(await count('amber'), 3);

  const delayed = gate();
  apps.amber.invoke = async (...args) => { const admitted = await originalInvoke(...args); await delayed.promise; return admitted; };
  await click('amber', 'Run report');
  assert.match(cell('amber').textContent, /pending/);
  visibility.amber = false; await render();
  delayed.resolve(); await act(async () => { await pause(); });
  assert.equal(cell('amber').querySelector('[data-reference]'), null);
  visibility.amber = true; await render();
  assert.equal(cell('amber').querySelector('[data-reference]'), null);
  assert.equal(await count('amber'), 3);
  apps.amber.invoke = originalInvoke;

  visibility.blue = false; await render();
  assert.equal(button('blue', 'Run report').disabled, true); assert.equal(button('amber', 'Run report').disabled, false);
  visibility.blue = true; await render(); assert.equal(button('blue', 'Run report').disabled, false);
  await click('amber', 'Run report');
  await until(() => cell('amber').querySelector('[data-reference]')?.textContent === prior);
  actors.amber = { ...actors.amber, principalId: 'different-person' }; await render();
  assert.equal(cell('amber').querySelector('[data-reference]'), null);
  actors.amber = fixtureActor('amber'); await render();
  assert.equal(cell('amber').querySelector('[data-reference]'), null);
  actors.amber = { ...actors.amber, principalId: 'different-person' }; await render();
  await click('amber', 'Run report');
  await until(() => cell('amber').textContent.includes('denied'));
  assert.equal(await count('amber'), 3); clean();
});

test('fixed cells reject wrong app, forged results and late replies without owning native app lifetime', { timeout: 30000 }, async t => {
  const window = new Window({ url: 'https://fictional.invalid/' });
  const saved = new Map();
  for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Text', 'DOMParser', 'MutationObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame']) {
    saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: name === 'window' ? window : window[name] });
  }
  saved.set('IS_REACT_ACT_ENVIRONMENT', Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT'));
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  t.after(async () => { await window.happyDOM.close(); for (const [name, descriptor] of saved) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name];
  } });
  const { createElement: h, act } = await import('react');
  const { createRoot } = await import('react-dom/client');
  const held = gate(), identity = { appId: 'amber', runtimeId: 'amber-runtime-v1', instanceId: 'instance-1' };
  let calls = 0, closes = 0;
  const app = { identity, invoke: async () => { calls++; return held.promise; }, observe: async () => ({ kind: 'unknown' }), close: () => { closes++; } };
  const actor = fixtureActor('amber');
  const View = createFixtureHubView({ apps: { amber: app, blue: { ...app, identity: { ...identity, appId: 'amber' } } },
    actorFor: () => actor, canView: () => true });
  const container = document.createElement('div'); document.body.append(container);
  const root = createRoot(container);
  t.after(async () => { await act(async () => root.unmount()); container.remove(); });
  await act(async () => root.render(h(View)));
  assert.equal(container.querySelector('[aria-label="blue report"] button').disabled, true);
  const amber = container.querySelector('[aria-label="amber report"]');
  await act(async () => amber.querySelector('button').click());
  assert.equal(calls, 1);
  await act(async () => amber.querySelector('button').click()); assert.equal(calls, 1);
  await act(async () => root.unmount());
  held.resolve({ kind: 'admitted', ref: { ...identity, ...actor, requestId: 'amber-fixed-report', capabilityVersion: '1',
    producer: 1, delivery: 2, operationId: JSON.stringify(['wrong-namespace', 2]), privateResult: PRIVATE_MARKERS.amber.result } });
  await act(async () => { await pause(); });
  assert.equal(container.textContent, ''); assert.equal(closes, 0);

  const returned = { ...identity, ...actor, requestId: 'amber-fixed-report', capabilityVersion: '1',
    producer: 1, delivery: 2, operationId: JSON.stringify([`${identity.runtimeId}:${identity.instanceId}`, 2]),
    privateResult: PRIVATE_MARKERS.amber.result };
  let observed, cleanInvocations = 0;
  const cleanApp = { identity: { ...identity }, invoke: async () => { cleanInvocations++; return { kind: 'admitted', ref: returned }; },
    observe: async ref => { observed = ref; return { kind: 'observed', ref, status: 'completed', publication: 'committed',
      privateResult: PRIVATE_MARKERS.amber.result }; } };
  const Clean = createFixtureHubView({ apps: { amber: cleanApp }, actorFor: () => actor, canView: () => true });
  const another = createRoot(container);
  await act(async () => another.render(h(Clean)));
  let live = container.querySelector('[aria-label="amber report"]');
  await act(async () => live.querySelector('button').click());
  assert.equal(container.textContent.includes(PRIVATE_MARKERS.amber.result), false);
  returned.operationId = 'mutated-after-admission';
  await act(async () => live.querySelectorAll('button')[1].click());
  assert.equal(observed.privateResult, undefined);
  assert.equal(observed.operationId, JSON.stringify([`${identity.runtimeId}:${identity.instanceId}`, 2]));
  assert.match(live.textContent, /completed: committed/);
  cleanApp.observe = async ref => {
    ref.delivery = 3;
    ref.operationId = JSON.stringify([`${identity.runtimeId}:${identity.instanceId}`, 3]);
    return { kind: 'observed', ref, status: 'completed', publication: 'committed' };
  };
  await act(async () => live.querySelectorAll('button')[1].click());
  assert.equal(live.querySelector('[role="status"]').textContent, 'unavailable');
  assert.equal(live.querySelector('[data-reference]'), null);
  returned.operationId = JSON.stringify([`${identity.runtimeId}:${identity.instanceId}`, 2]);
  await act(async () => live.querySelector('button').click());
  cleanApp.observe = async ref => ({ kind: 'observed', ref: { ...ref, delivery: 3 }, status: 'completed', publication: 'committed' });
  await act(async () => live.querySelectorAll('button')[1].click());
  assert.match(live.textContent, /unavailable/);
  returned.operationId = JSON.stringify([`${identity.runtimeId}:${identity.instanceId}`, 2]);
  await act(async () => live.querySelector('button').click());
  cleanApp.observe = async ref => ({ kind: 'observed', ref, status: 'faulted', publication: 'committed' });
  await act(async () => live.querySelectorAll('button')[1].click());
  assert.match(live.textContent, /unavailable/);
  await act(async () => live.querySelector('button').click());
  cleanApp.observe = async ref => ({ kind: 'observed', ref, status: 'faulted' });
  await act(async () => live.querySelectorAll('button')[1].click());
  assert.match(live.textContent, /faulted/);
  for (const status of ['completing', 'orphaned']) {
    cleanApp.observe = async ref => ({ kind: 'observed', ref, status });
    await act(async () => live.querySelectorAll('button')[1].click());
    assert.equal(live.querySelector('[role="status"]').textContent, status);
  }
  for (const changed of [{ appId: 'blue' }, { instanceId: 'wrong-instance' }, { scopeId: 'wrong-scope' },
    { producer: 2 }, { operationId: 'wrong-operation' }]) {
    const original = { ...returned };
    Object.assign(returned, changed);
    await act(async () => live.querySelector('button').click());
    assert.equal(live.querySelector('[role="status"]').textContent, 'unknown');
    assert.equal(live.querySelector('[data-reference]'), null);
    Object.assign(returned, original);
  }
  const beforeChangedIdentity = cleanInvocations;
  cleanApp.identity.instanceId = 'different-incarnation';
  await act(async () => live.querySelector('button').click());
  assert.equal(cleanInvocations, beforeChangedIdentity);
  assert.equal(live.querySelector('[role="status"]').textContent, 'unavailable');
  await act(async () => another.render(h(Clean)));
  live = container.querySelector('[aria-label="amber report"]');
  assert.equal(live.querySelector('button').disabled, true);
  assert.equal(live.querySelector('[data-reference]'), null);
  await act(async () => another.unmount());
});

test('fixed view browser bundle excludes server and native packages', async () => {
  const entry = resolve(fileURLToPath(new URL('../../examples/current-hub/fixed-view.mjs', import.meta.url)));
  const result = await build({ entryPoints: [entry], bundle: true, write: false, platform: 'browser', format: 'esm',
    metafile: true, external: ['react', 'react/jsx-runtime'] });
  const paths = Object.keys(result.metafile.inputs);
  assert.ok(paths.some(path => path.endsWith('fixed-view.mjs')));
  const forbidden = /(?:^|\/)(?:app\.mjs|node:|@hachej\/boring-(?:agent|files|execution)|@earendil-works\/pi-durable)/;
  assert.equal(paths.some(path => forbidden.test(path)), false);
  assert.equal(Object.values(result.metafile.inputs).some(input => input.imports.some(item => forbidden.test(item.path))), false);
});
