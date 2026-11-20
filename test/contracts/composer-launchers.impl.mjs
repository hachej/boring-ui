import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { Window } from 'happy-dom';
import { createDemoController } from '../../ux/fixtures/demo-controller.mjs';

// The common options of the composer config on EVERY launcher (the bar, the tab, the header trigger, the circle, FloatingComposer), driven through the public path: the real FloatingComposer and AppShell in
// happy-dom over a scripted fake agent (fictional), with the person's own actions. Before this change a bar given `level`, `avoid`, `note`, `handoff`... threw, and `NavItem.composer` and the feedback
// slot did not exist. Its own process (see composer-launchers.test.mjs): DOM globals and timers stay here.
const root = fileURLToPath(new URL('../../', import.meta.url));
const script = JSON.parse(readFileSync(`${root}ux/scenarios/scripts/design-system.json`, 'utf8'));

let fresh = 0, built;
async function bundle() {
  if (built) return import(`${built}?fresh=${++fresh}`);
  const out = `${root}.cache/launchers-test`;
  mkdirSync(out, { recursive: true });
  writeFileSync(`${out}/entry.ts`, ['app-shell/app-shell.tsx:AppShell', 'app-shell/floating-composer.tsx:FloatingComposer', 'app-shell/agent-layer.tsx:useAgentLayer']
    .map(item => { const [file, name] = item.split(':'); return `export { ${name} } from '${root}registry/${file}';`; }).join('\n'));
  await build({ entryPoints: [`${out}/entry.ts`], outfile: `${out}/entry.mjs`, bundle: true, format: 'esm', platform: 'node', jsx: 'automatic', packages: 'external', logLevel: 'silent',
    alias: { '@': `${root}examples/app-shell`, '@hachej/boring-ui-kit/file-tree.css': `${root}packages/ui/styles/file-tree.css` } });
  built = pathToFileURL(`${out}/entry.mjs`).href;
  return import(`${built}?fresh=${++fresh}`);
}
const { createElement: h, act: reactAct, Component } = await import('react');
const { createRoot } = await import('react-dom/client');

const NAMES = ['window', 'document', 'navigator', 'history', 'location', 'HTMLElement', 'Element', 'Node', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'matchMedia', 'getSelection', 'MutationObserver', 'ResizeObserver', 'Event', 'CustomEvent', 'EventTarget', 'KeyboardEvent', 'MouseEvent', 'PointerEvent', 'FocusEvent', 'DOMRect', 'localStorage', 'sessionStorage', 'IS_REACT_ACT_ENVIRONMENT'];
function dom(t, width) {
  const saved = new Map(NAMES.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const window = new Window({ url: 'https://fictional.invalid/' });
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width });
  for (const name of NAMES) Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: name === 'window' ? window : name === 'IS_REACT_ACT_ENVIRONMENT' ? true : /^(?:getComputedStyle|requestAnimationFrame|cancelAnimationFrame|matchMedia|getSelection)$/.test(name) ? window[name].bind(window) : window[name] });
  window.document.fonts = { addEventListener() {}, removeEventListener() {}, ready: Promise.resolve() };
  t.after(() => { for (const [name, descriptor] of saved) descriptor ? Object.defineProperty(globalThis, name, descriptor) : delete globalThis[name]; window.close(); });
  return window;
}

const wait = ms => new Promise(done => setTimeout(done, ms));
const Icon = () => null;
const nav = ['Orders', 'Support'].map(label => ({ id: label, label, icon: Icon, render: () => null }));
const say = (demo, text) => { void demo.controller.send('followUp', { text, attachments: [], restore: { text: '', attachments: [] } }); };

/** The page: `draw()` gives the element; `set(next)` draws another; `find`, `all`, `click`, `key` are a person's hands. */
async function mount(t, width, draw) {
  const window = dom(t, width);
  const kit = await bundle();
  const container = window.document.createElement('div');
  window.document.body.append(container);
  const rootNode = createRoot(container);
  const act = async run => { await reactAct(async () => { await run(); }); };
  const page = {
    window, kit, act,
    find: selector => [...window.document.querySelectorAll(selector)].find(element => !element.closest('[hidden]')) ?? null,
    all: selector => [...window.document.querySelectorAll(selector)].filter(element => !element.closest('[hidden]')),
    async set(element) { await act(async () => rootNode.render(element)); await act(() => wait(80)); },
    async click(testId) { const element = page.find(`[data-testid=${testId}]`); assert.ok(element, `no ${testId}; the page has: ${page.all('[data-testid]').map(e => e.dataset.testid).join(' ').slice(0, 900)}`); await act(async () => { element.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 })); }); await act(() => wait(120)); },
    async key(key, target = window.document) { await act(async () => { target.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })); }); await act(() => wait(80)); },
    async resize(next) { window.dispatchEvent(new window.Event('resize')); window.innerWidth = next; window.dispatchEvent(new window.Event('resize')); await act(() => wait(120)); },
    async unmount() { await act(async () => rootNode.unmount()); },
  };
  await page.set(draw(kit, page));
  t.after(async () => { try { await page.unmount(); } catch { /* gone */ } });
  return page;
}
const standalone = (kit, agent, composer, extra = {}) => h(kit.FloatingComposer, { agent, composer, ...extra });
const circle = (extra = {}) => ({ launcher: 'circle', ...extra });
const ids = page => page.all('[data-testid=composer-controller] [data-action]').map(element => element.dataset.action);
const caught = async (t, make) => {
  const window = dom(t, 1280);
  const kit = await bundle();
  const demo = createDemoController({ script, pace: 1 });
  const messages = [];
  class Boundary extends Component { constructor(props) { super(props); this.state = { failed: false }; } static getDerivedStateFromError(error) { messages.push(error.message); return { failed: true }; } render() { return this.state.failed ? null : this.props.children; } }
  const container = window.document.createElement('div'); window.document.body.append(container);
  const rootNode = createRoot(container);
  const quiet = console.error; console.error = () => {};
  try { await reactAct(async () => rootNode.render(h(Boundary, null, make(kit, { controller: demo.controller, label: 'Assistant' })))); await reactAct(() => wait(40)); } finally { console.error = quiet; }
  await reactAct(async () => rootNode.unmount());
  return messages[0];
};

const demoOf = () => createDemoController({ script, pace: 1 });
const shell = (kit, agent, composer, extra = {}) => h(kit.AppShell, { layout: 'screen', title: 'Orders app', nav, route: { id: 'Orders', onChange() {} }, agent, composer, ...extra });
const BAR = { launcher: 'bar', sizes: ['open', 'grown', 'full'], dock: true };
const TRAY = '[data-testid=agent-tray]';
/** A feedback session reduced to what the composer reads: a phase, the notes and a bubble. `set` changes it as the real session would. */
function fakeSession(first = {}) {
  let snapshot = { phase: 'idle', mode: 'feedback', using: false, useToggle: false, notes: [], general: '', generalOpen: false, route: '/orders', stepCount: 0, bubble: null, voiceAvailable: false, send: { kind: 'idle' }, ...first };
  const listeners = new Set();
  return { getSnapshot: () => snapshot, subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); },
    set(next) { snapshot = { ...snapshot, ...next }; for (const listener of [...listeners]) listener(); },
    resume() { this.set({ phase: 'active' }); }, async done() { this.set({ phase: 'idle' }); }, discard() {}, highlight() {}, sent() {}, cancelSelection() {}, async attach() { return { kind: 'refused', reason: 'none' }; }, dispose() {} };
}
const settle = page => page.act(() => wait(120));

test('a bar takes the common options: level controlled by the app, a refused change comes back, defaultLevel starts it, on.level hears the person', async t => {
  const demo = demoOf();
  const agent = { controller: demo.controller, label: 'Assistant' };
  const heard = [];
  const config = extra => ({ ...BAR, id: 'main', on: { level: next => heard.push(next) }, ...extra });
  const page = await mount(t, 1280, kit => shell(kit, agent, config({ level: 'folded' })));
  assert.equal(page.all(TRAY).length, 0, 'folded: no window');
  await page.set(shell(page.kit, agent, config({ level: 'open' })));
  assert.ok(page.find(TRAY), 'the app set open: the window is there');
  await page.set(shell(page.kit, agent, config({ level: 'grown' })));
  assert.equal(page.find(TRAY)?.getAttribute('data-expanded'), 'true', 'grown');
  assert.deepEqual(heard, [], 'the app\'s own changes are not echoed to on.level');
  await page.click('agent-tray-reduce');
  await settle(page);
  assert.deepEqual(heard, ['folded'], 'the person reduced it: the app hears folded');
  assert.equal(page.find(TRAY)?.getAttribute('data-expanded'), 'true', 'the app kept grown: a controlled level comes back');
  await page.set(shell(page.kit, agent, config({ level: 'folded' })));
  assert.equal(page.all(TRAY).length, 0, 'the app took it: folded');
  await page.unmount();
  const second = await mount(t, 1280, kit => shell(kit, agent, config({ defaultLevel: 'open' })));
  assert.ok(second.find(TRAY), 'defaultLevel open: it starts open');
  await second.click('agent-tray-reduce');
  await settle(second);
  assert.equal(second.all(TRAY).length, 0, 'uncontrolled: the person closes it');
  assert.equal(heard.at(-1), 'folded', 'and the app hears it');
});

test('a bar on a phone: the same level, as the sheet', async t => {
  const demo = demoOf();
  const agent = { controller: demo.controller, label: 'Assistant' };
  const heard = [];
  const config = level => ({ ...BAR, level, on: { level: next => heard.push(next) } });
  const page = await mount(t, 390, kit => shell(kit, agent, config('folded')));
  assert.equal(page.find('[data-testid=agent-layer]')?.getAttribute('data-peek'), 'true', 'folded: the peek');
  await page.set(shell(page.kit, agent, config('open')));
  await settle(page);
  assert.ok(page.find('[data-testid=agent-layer]') && page.find('[data-testid=agent-layer]').getAttribute('data-peek') !== 'true', 'open: the sheet at half');
});

test('a tab takes the common options: defaultLevel opens the panel, suspended hides the tab, Open in full is in the panel', async t => {
  const demo = demoOf();
  const agent = { controller: demo.controller, label: 'Assistant' };
  const calls = [];
  const tab = extra => ({ launcher: 'tab', id: 'ask', handoff: { openFull: (id, context) => calls.push([id, context]) }, ...extra });
  const page = await mount(t, 1280, kit => shell(kit, agent, tab({ defaultLevel: 'open' })));
  assert.ok(page.find('[data-testid=explore-panel]'), 'defaultLevel open: the panel is open');
  assert.equal(page.find('[data-testid=composer-open-full]')?.disabled, true, 'Open in full waits for a message');
  assert.equal(page.find('[data-testid=explore-panel]').getAttribute('data-composer'), 'ask', 'the id is on the panel');
  await page.set(shell(page.kit, agent, tab({ defaultLevel: 'open', handoff: { openFull: (id, context) => calls.push([id, context]), allowEmpty: true } })));
  await page.click('composer-open-full');
  assert.deepEqual(calls, [['demo', { empty: true }]], 'the hand-off gets the id');
  assert.equal(page.all('[data-testid=explore-panel]').length, 0, 'and the panel closes after it');
  assert.equal(page.find('[data-testid=explore-toggle]') !== null, true, 'the tab is back');
  await page.set(shell(page.kit, agent, tab({ suspended: true })));
  assert.equal(page.all('[data-testid=explore-toggle], [data-testid=explore-place]').length, 0, 'suspended: the tab is hidden');
});

test('the header trigger takes the common options: suspended hides it, the note is in its name, defaultLevel docks, Open in full is in the dock', async t => {
  const demo = demoOf();
  const agent = { controller: demo.controller, label: 'Assistant' };
  const calls = [];
  const dock = extra => ({ launcher: 'header', float: true, id: 'help', handoff: { openFull: (id, context) => calls.push([id, context]), allowEmpty: true }, ...extra });
  const page = await mount(t, 1280, kit => shell(kit, agent, dock({ note: () => 'thinking' })));
  assert.match(page.find('[data-testid=agent-trigger]')?.getAttribute('aria-label') ?? '', /Assistant · thinking/, 'the note is part of the trigger\'s name');
  assert.equal(page.find('[data-testid=agent-trigger]').getAttribute('data-composer'), 'help');
  await page.set(shell(page.kit, agent, dock({ suspended: true })));
  assert.equal(page.all('[data-testid=agent-trigger]').length, 0, 'suspended: no trigger');
  const docked = await mount(t, 1280, kit => shell(kit, agent, dock({ defaultLevel: 'docked' })));
  await settle(docked);
  assert.ok(docked.find('[data-testid=agent-layer][data-state=open]'), 'defaultLevel docked: the conversation is in the dock');
  await docked.click('composer-open-full');
  assert.deepEqual(calls, [['demo', { empty: true }]]);
});

test('a bar given a handoff has Open in full in its strip while the conversation is open', async t => {
  const demo = demoOf();
  const agent = { controller: demo.controller, label: 'Assistant' };
  const calls = [];
  const page = await mount(t, 1280, kit => shell(kit, agent, { ...BAR, handoff: { openFull: (id, context) => calls.push([id, context]), allowEmpty: true } }));
  assert.equal(page.all('[data-action=open-full]').length, 0, 'at rest: not offered');
  await page.click('agent-bar-conversation');
  await settle(page);
  assert.ok(page.find(TRAY), 'the window is open');
  await page.click('composer-open-full');
  assert.deepEqual(calls, [['demo', { empty: true }]], 'the strip hands the conversation to the app');
  assert.equal(page.all(TRAY).length, 0, 'and the window closes');
});

test('a bar that is suspended is hidden and the conversation closed; a string preset is not a config', async t => {
  const demo = demoOf();
  const agent = { controller: demo.controller, label: 'Assistant' };
  const page = await mount(t, 1280, kit => shell(kit, agent, { ...BAR, suspended: true }));
  assert.equal(page.all('[data-testid=agent-composer-box], [data-testid=composer-input]').length, 0, 'no bar');
  await page.set(shell(page.kit, agent, { ...BAR }));
  assert.ok(page.find('[data-testid=agent-composer-box]'), 'not suspended: the bar');
  const phone = await mount(t, 390, kit => shell(kit, agent, { ...BAR, suspended: true }));
  assert.equal(phone.all('[data-testid=agent-layer]').length, 0, 'a phone: no peek bar either');
});

test('a floating bar takes at.offset, at.stack, layer, id, reserve and note; a string composer keeps the place it had', async t => {
  const demo = demoOf();
  const agent = { controller: demo.controller, label: 'Assistant' };
  const bar = extra => ({ launcher: 'bar', sizes: ['open', 'grown', 'full'], fold: 'circle', float: { movable: true }, ...extra });
  const root = () => globalThis.document.documentElement;
  const page = await mount(t, 1280, kit => standalone(kit, agent, bar({ id: 'main', at: { offset: { inline: 24, block: 20 } }, layer: 30, note: () => 'thinking' })));
  const frame = page.find('[data-testid=composer-floating]');
  assert.equal(frame.getAttribute('data-composer'), 'main', 'the id');
  assert.match(frame.getAttribute('style') ?? '', /inset-inline-end:\s*calc\(24px \+ 0px\)/, 'at.offset.inline');
  assert.match(frame.getAttribute('style') ?? '', /inset-block-end:\s*calc\(20px \+ 0px\)/, 'at.offset.block');
  assert.match(frame.getAttribute('style') ?? '', /z-index:\s*30/, 'layer');
  assert.equal(page.find('[data-testid=composer-launcher-note]')?.textContent, 'thinking', 'the note above the folded bar');
  assert.match(root().style.getPropertyValue('--composer-reserve-block'), /20px/, 'the footprint is published');
  await page.click('composer-minimise');
  const icon = page.find('[data-testid=composer-icon]')?.closest('span');
  assert.match(icon?.getAttribute('style') ?? '', /inset-inline-end:\s*calc\(24px/, 'the folded icon takes the offset too');
  assert.match(icon?.getAttribute('style') ?? '', /z-index:\s*30/);
  assert.equal(icon?.querySelector('[data-testid=composer-launcher-note]')?.textContent, 'thinking', 'and the note');
  assert.equal(icon?.getAttribute('data-composer'), 'main');
  await page.set(standalone(page.kit, agent, bar({ id: 'main', reserve: 'none' })));
  assert.equal(root().style.getPropertyValue('--composer-reserve-block'), '', 'reserve: none publishes nothing');
  const plain = await mount(t, 1280, kit => standalone(kit, agent, undefined));
  assert.equal(plain.find('[data-testid=composer-floating]')?.getAttribute('data-composer'), null, 'a string composer: no id, no new place');
  assert.doesNotMatch(plain.find('[data-testid=composer-floating]')?.getAttribute('style') ?? '', /inset-inline-end/, 'its own style');
});

test('two launchers with ids stack on one corner by at.stack: the second sits above the first and the reserve covers both', async t => {
  const demo = demoOf(), other = demoOf();
  const page = await mount(t, 1280, kit => h('div', null,
    standalone(kit, { controller: demo.controller, label: 'Assistant' }, { id: 'main', launcher: 'bar', sizes: ['open', 'grown'], fold: 'circle', float: { movable: true }, at: { stack: 0 } }),
    standalone(kit, { controller: other.controller, label: 'Ideas' }, { id: 'pm', launcher: 'circle', at: { stack: 1 } })));
  const first = page.find('[data-composer=main]'), second = page.find('[data-composer=pm]');
  assert.match(first.getAttribute('style') ?? '', /inset-block-end:\s*calc\(max\(16px, env\(safe-area-inset-bottom\)\) \+ 0px\)/, 'the bar is nearest the corner');
  assert.match(second.getAttribute('style') ?? '', /inset-block-end:\s*calc\(max\(16px, env\(safe-area-inset-bottom, 0px\)\) \+ 68px\)/, 'the circle is lifted by the bar\'s height and a gap');
});

test('at.remember: false keeps nothing, session keeps it for the tab', async t => {
  const demo = demoOf();
  const agent = { controller: demo.controller, label: 'Assistant' };
  const bar = remember => ({ launcher: 'bar', sizes: ['open', 'grown', 'full'], fold: 'circle', float: { movable: true }, at: { remember } });
  const page = await mount(t, 1280, kit => standalone(kit, agent, bar(false)));
  await page.click('composer-minimise');
  assert.equal(page.window.localStorage.getItem('boring-ui:sidebar-composer-place'), null, 'false: not in local storage');
  assert.equal(page.window.sessionStorage.getItem('boring-ui:sidebar-composer-place'), null, 'nor in session storage');
  const kept = await mount(t, 1280, kit => standalone(kit, agent, bar('session')));
  await kept.click('composer-minimise');
  assert.equal(kept.window.sessionStorage.getItem('boring-ui:sidebar-composer-place'), 'icon:float', 'session: in this tab');
  assert.equal(kept.window.localStorage.getItem('boring-ui:sidebar-composer-place'), null);
});

test('NavItem.composer: false hides the bubble on that screen, an object replaces the composer there, and the app\'s own is back elsewhere', async t => {
  const demo = demoOf();
  const agent = { controller: demo.controller, label: 'Assistant' };
  const pages = ['Orders', 'Support', 'Reports'];
  const items = pages.map(label => ({ id: label, label, icon: Icon, render: () => null, ...(label === 'Support' ? { composer: false } : label === 'Reports' ? { composer: { launcher: 'circle', id: 'reports' } } : {}) }));
  const draw = (kit, id) => h(kit.AppShell, { layout: 'screen', title: 'Orders app', nav: items, route: { id, onChange() {} }, agent, composer: { launcher: 'circle', id: 'support' } });
  const page = await mount(t, 1280, kit => draw(kit, 'Orders'));
  assert.ok(page.find('[data-composer=support][data-testid=composer-circle-box]'), 'Orders: the app\'s circle');
  await page.set(draw(page.kit, 'Support'));
  assert.equal(page.all('[data-testid=composer-circle-box]').length, 0, 'Support: the bubble is hidden');
  await page.set(draw(page.kit, 'Reports'));
  assert.ok(page.find('[data-composer=reports][data-testid=composer-circle-box]'), 'Reports: its own circle');
  await page.set(draw(page.kit, 'Orders'));
  assert.ok(page.find('[data-composer=support][data-testid=composer-circle-box]'), 'back on Orders: the app\'s circle');
  // A string composer hides too: the string is its preset with suspended.
  const items2 = pages.map(label => ({ id: label, label, icon: Icon, render: () => null, ...(label === 'Support' ? { composer: false } : {}) }));
  const draw2 = (kit, id) => h(kit.AppShell, { layout: 'screen', title: 'Orders app', nav: items2, route: { id, onChange() {} }, agent, composer: 'bar', floatingComposer: true });
  const strings = await mount(t, 1280, kit => draw2(kit, 'Orders'));
  assert.ok(strings.find('[data-testid=composer-floating], [data-testid=agent-composer-box]'), 'a string composer on Orders');
  await strings.set(draw2(strings.kit, 'Support'));
  assert.equal(strings.all('[data-testid=agent-composer-box], [data-testid=composer-input]').length, 0, 'hidden on Support too, with floatingComposer next to it');
});

test('AgentSpec.feedbackSlot: the app\'s control in a circle\'s title row and in a bar\'s field, given the level, the phase, the count and where it is drawn; the built-in toggle steps out', async t => {
  const demo = demoOf();
  const session = fakeSession({ phase: 'active', notes: [{ id: 1, number: 1, text: 'This total', recorded: false }] });
  const seen = [];
  const slot = context => { seen.push(context); return h('button', { 'data-testid': 'app-feedback', 'data-where': context.where, 'data-level': context.level, 'data-phase': context.phase, 'data-count': String(context.count) }, 'Show'); };
  const agent = { controller: demo.controller, label: 'Assistant', feedback: session, feedbackSlot: slot };
  const title = await mount(t, 1280, kit => standalone(kit, agent, { launcher: 'circle', id: 'support', defaultLevel: 'open', feedback: { while: 'open' } }));
  await settle(title);
  const control = title.find('[data-testid=composer-controller] [data-testid=app-feedback]');
  assert.ok(control, 'the circle\'s title row carries the app\'s control');
  assert.equal(control.dataset.where, 'title');
  assert.equal(control.dataset.level, 'open');
  assert.equal(control.dataset.phase, 'active');
  assert.equal(control.dataset.count, '1');
  assert.equal(title.all('[data-testid=composer-annotate-title]').length, 0, 'the built-in toggle steps out');
  await title.unmount();
  const field = await mount(t, 1280, kit => standalone(kit, { ...agent }, { ...BAR, dock: false, fold: 'circle', float: { movable: true }, defaultLevel: 'open' }));
  await settle(field);
  const inField = field.find('[data-testid=app-feedback]');
  assert.ok(inField, 'the bar\'s field carries the app\'s control');
  assert.equal(inField.dataset.where, 'field');
  assert.ok(seen.some(context => context.where === 'field' && typeof context.setLevel === 'function'), 'and a way to set the level');
  // A plain node works as before: it is drawn, with no function to call.
  const node = await mount(t, 1280, kit => standalone(kit, { ...agent, feedbackSlot: h('span', { 'data-testid': 'plain-slot' }, 'plain') }, { ...BAR, dock: false, fold: 'circle', float: { movable: true }, defaultLevel: 'open' }));
  await settle(node);
  assert.ok(node.find('[data-testid=plain-slot]'), 'a plain node as the slot');
});
