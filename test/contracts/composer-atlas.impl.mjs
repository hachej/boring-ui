import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { Window } from 'happy-dom';
import { createDemoController } from '../../ux/fixtures/demo-controller.mjs';
import { controlled } from '../../ux/atlas/connection.mjs';
import { isIn, runSteps } from '../../ux/atlas/steps.mjs';
import { STRIPS } from './composer-strips.mjs';

// The Atlas (ux/atlas/composer-atlas.json) driven through the public path: for every state, the real component is rendered in happy-dom over a scripted fake agent (fictional), taken to
// the state by the state's own `reach` steps, and the state's marker is read; for every transition, the from-state is reached, the trigger is done on the real control (a click on its
// test id, a key, a drag of the grip, a word the agent receives, a resize) and the to-state's marker must be there. Its own process (see atlas.test.mjs): DOM globals and timers stay here.
const root = fileURLToPath(new URL('../../', import.meta.url));
const atlas = JSON.parse(readFileSync(`${root}ux/atlas/composer-atlas.json`, 'utf8'));
const script = JSON.parse(readFileSync(`${root}ux/scenarios/scripts/design-system.json`, 'utf8'));

let fresh = 0, built;
// The bundle is built once and imported anew for each scene: its libraries read the window when they load (the phone drawer does), so the DOM must exist first.
async function bundle() {
  if (built) return import(`${built}?fresh=${++fresh}`);
  const out = `${root}.cache/atlas-test`;
  mkdirSync(out, { recursive: true });
  writeFileSync(`${out}/entry.ts`, ['app-shell/app-shell.tsx:AppShell', 'app-shell/floating-composer.tsx:FloatingComposer', 'agent-card/agent-card.tsx:AgentCard', 'agent-chat/agent-chat.tsx:AgentChat']
    .map(item => { const [file, name] = item.split(':'); return `export { ${name} } from '${root}registry/${file}';`; }).join('\n'));
  await build({ entryPoints: [`${out}/entry.ts`], outfile: `${out}/entry.mjs`, bundle: true, format: 'esm', platform: 'node', jsx: 'automatic', packages: 'external',
    alias: { '@': `${root}examples/app-shell`, '@hachej/boring-ui-kit/file-tree.css': `${root}packages/ui/styles/file-tree.css` } });
  built = pathToFileURL(`${out}/entry.mjs`).href;
  return import(`${built}?fresh=${++fresh}`);
}
const { createElement: h, act: reactAct } = await import('react');
const { createRoot } = await import('react-dom/client');

const NAMES = ['window', 'document', 'navigator', 'history', 'location', 'HTMLElement', 'Element', 'Node', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'matchMedia', 'getSelection', 'MutationObserver', 'ResizeObserver', 'Event', 'CustomEvent', 'EventTarget', 'KeyboardEvent', 'MouseEvent', 'PointerEvent', 'FocusEvent', 'DOMRect', 'localStorage', 'IS_REACT_ACT_ENVIRONMENT'];
function dom(t, width, height = 800) {
  const saved = new Map(NAMES.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const window = new Window({ url: 'https://fictional.invalid/' });
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width });
  for (const name of NAMES) Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: name === 'window' ? window : name === 'IS_REACT_ACT_ENVIRONMENT' ? true : /^(?:getComputedStyle|requestAnimationFrame|cancelAnimationFrame|matchMedia|getSelection)$/.test(name) ? window[name].bind(window) : window[name] });
  window.document.fonts = { addEventListener() {}, removeEventListener() {}, ready: Promise.resolve() };
  t.after(() => { for (const [name, descriptor] of saved) descriptor ? Object.defineProperty(globalThis, name, descriptor) : delete globalThis[name]; window.close(); });
  return window;
}

const Icon = () => null;
const nav = ['Orders', 'Customers'].map(label => ({ id: label, label, icon: Icon, render: () => null }));
const NOTICES = { warning: { kind: 'warning', text: 'Two rows of open-gaps.csv have no amount.', action: { label: 'Review', onSelect() {} } } };

/** One scene: the component of `scene.kind` rendered with the scene's props, and the hooks the steps reach it by. */
async function render(t, sceneId) {
  const scene = atlas.scenes[sceneId];
  assert.ok(scene, `scene ${sceneId}`);
  const window = dom(t, scene.width);
  const kit = await bundle();
  const demo = createDemoController({ script, pace: 1 });
  const link = controlled(demo, scene.connection);
  const agent = { controller: link.controller, label: 'Assistant', chatProps: { actions: demo.actions } };
  const container = window.document.createElement('div');
  window.document.body.append(container);
  const act = async run => { await reactAct(async () => { await run(); }); };
  let notices = [];
  let dock = null;
  const draw = () => {
    const props = scene.props ?? {};
    const element = scene.kind === 'shell' ? h(kit.AppShell, { layout: 'screen', title: 'Orders app', nav, route: { id: 'Orders', onChange() {} }, agent, notices, ...props })
      : scene.kind === 'standalone' ? h(kit.FloatingComposer, { agent, ...props })
      : scene.kind === 'card' ? h('div', null, h(kit.AgentCard, { controller: link.controller, agent: { name: 'Reader', color: 'chart-2' }, title: 'Read the supplier invoices', dock, chatProps: { actions: demo.actions }, ...props }), h('div', { 'data-testid': 'atlas-dock', ref: node => { if (node && node !== dock) { dock = node; setTimeout(() => { void act(async () => rootNode.render(draw())); }, 0); } } }))
      : h('div', { style: { height: 400 } }, h(kit.AgentChat, { controller: link.controller, agent: { name: 'Reader', color: 'chart-2' }, title: 'Read the supplier invoices', chatProps: { actions: demo.actions }, ...props }));
    return element;
  };
  const rootNode = createRoot(container);
  await act(async () => rootNode.render(draw()));
  await act(async () => new Promise(done => setTimeout(done, 80)));
  const hooks = {
    say: text => { void demo.controller.send('followUp', { text, attachments: [], restore: { text: '', attachments: [] } }); },
    notify: kind => { const id = `${kind}-${Date.now()}`; notices = [{ ...NOTICES[kind], id, onDismiss: () => { notices = []; } }]; rootNode.render(draw()); },
    connection: kind => link.set(kind),
    // happy-dom's media query list starts each listener at "does not match", so a first resize at the current width brings it to the real state before the width changes.
    resize: width => { window.dispatchEvent(new window.Event('resize')); window.innerWidth = width; window.dispatchEvent(new window.Event('resize')); },
  };
  return { env: { root: window.document, win: window, act, hooks }, window };
}

/** The scene, taken to the state: the state's own steps from the scene's rest. */
async function reach(t, state, { scene = state.scene, steps = state.reach } = {}) {
  const ui = await render(t, scene);
  await runSteps(ui.env, steps);
  return ui;
}
const byId = new Map(atlas.states.map(state => [state.id, state]));
const where = (ui, state) => isIn(ui.env.root, state.detect);
/** Waits (up to 3 s) for the state's marker: a drawer or a lazy part may mount a few frames after the step. */
async function arrive(ui, state) {
  for (let tries = 0; tries < 120 && !where(ui, state); tries++) await ui.env.act(() => new Promise(done => setTimeout(done, 25)));
  return where(ui, state);
}
const seen = ui => [...ui.env.root.querySelectorAll('[data-testid]')].map(element => element.dataset.testid).join(' ').slice(0, 1500);

for (const state of atlas.states) {
  test(`state ${state.id}: reached by its steps, its marker is on the page`, async t => {
    const ui = await reach(t, state);
    assert.equal(await arrive(ui, state), true, `${state.id} (${JSON.stringify(state.detect)}) is not on the page; the page has: ${seen(ui)}`);
    const others = atlas.states.filter(other => other.scene === state.scene && other.id !== state.id && other.excludes?.includes(state.id));
    for (const other of others) assert.equal(where(ui, other), false, `${state.id} must not look like ${other.id}`);
  });
}

for (const transition of atlas.transitions) {
  // The trigger's own steps, then each alternative way to the same result (another key, another button).
  const ways = [transition.trigger.do, ...(transition.trigger.alt ?? [])];
  ways.forEach((steps, way) => test(`transition ${transition.id}: ${transition.from} to ${transition.to} by ${transition.trigger.label}${way ? ` (alternative ${way})` : ''}`, async t => {
    const from = byId.get(transition.from), to = byId.get(transition.to);
    assert.ok(from && to, 'both states exist');
    const ui = await reach(t, from, { scene: transition.scene ?? from.scene, steps: transition.setup ?? from.reach });
    assert.equal(await arrive(ui, from), true, `before: ${from.id} (${JSON.stringify(from.detect)}) is not on the page; the page has: ${seen(ui)}`);
    await runSteps(ui.env, steps);
    assert.equal(await arrive(ui, to), true, `after ${transition.trigger.label}: ${to.id} (${JSON.stringify(to.detect)}) is not on the page; the page has: ${seen(ui)}`);
    if (transition.after) assert.equal(isIn(ui.env.root, { has: transition.after.has ?? [], lacks: transition.after.lacks ?? [] }), true, `after ${transition.trigger.label}: ${JSON.stringify(transition.after)}`);
  }));
}

// The strip the real component draws in each wide state is the table's (composer-strips.mjs): the ids, the test ids and their order, as they were before the composer was a config.
for (const [id, { wide, actions }] of Object.entries(STRIPS)) {
  if (!wide) continue;
  test(`strip ${id}: the real component's actions are the table's`, async t => {
    const state = byId.get(id);
    const ui = await reach(t, state);
    assert.equal(await arrive(ui, state), true, `${id} is not on the page; the page has: ${seen(ui)}`);
    const drawn = [...ui.env.root.querySelectorAll('[data-testid=composer-controller] [data-action]')].map(element => [element.getAttribute('data-action'), element.getAttribute('data-testid')]);
    assert.deepEqual(drawn, actions, `${id}: the strip drawn`);
  });
}
