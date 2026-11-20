import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { Window } from 'happy-dom';
import { createDemoController } from '../../ux/fixtures/demo-controller.mjs';

// `launcher: 'circle'` driven through the public path: the real FloatingComposer and AppShell, rendered in happy-dom over a scripted fake agent (fictional), with the person's own actions
// (a click on a control's test id, a key, a resize). Each test is one thing the spec promises; the ones that were written against the code before the circle existed fail there (a config
// object did nothing). Its own process (see composer-circle.test.mjs): DOM globals and timers stay here.
const root = fileURLToPath(new URL('../../', import.meta.url));
const script = JSON.parse(readFileSync(`${root}ux/scenarios/scripts/design-system.json`, 'utf8'));

let fresh = 0, built;
async function bundle() {
  if (built) return import(`${built}?fresh=${++fresh}`);
  const out = `${root}.cache/circle-test`;
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

test('a tap on the circle opens the panel directly: no folded bar, the strip is only Open in full and Close', async t => {
  const demo = createDemoController({ script, pace: 1 });
  const agent = { controller: demo.controller, label: 'Assistant' };
  const opened = [];
  const page = await mount(t, 1280, kit => standalone(kit, agent, circle({ handoff: { openFull: (id, context) => opened.push([id, context]) } })));
  assert.ok(page.find('[data-testid=composer-circle]'), 'the circle is drawn');
  assert.ok(page.find('[data-testid=composer-circle-panel]') === null, 'closed at rest');
  assert.equal(page.all('[data-testid=agent-bar-conversation], [data-testid=composer-floating], [data-testid=composer-icon]').length, 0, 'no bar, no icon');
  await page.click('composer-circle');
  assert.ok(page.find('[data-testid=composer-circle-panel]'), 'one tap: the conversation window');
  assert.ok(page.find('[data-testid=composer-circle]') === null, 'the circle gives way to the panel');
  assert.ok(page.find('[data-testid=composer-input]'), 'the thread and its field are in the panel');
  assert.deepEqual(ids(page), ['open-full', 'close'], 'only what the levels allow');
  assert.equal(page.all('[data-testid=agent-tray-grow], [data-testid=agent-tray-full], [data-testid=agent-tray-dock], [data-testid=composer-float], [data-testid=composer-minimise]').length, 0, 'no grow, full, dock, float or minimise');
  await page.click('agent-layer-close');
  assert.ok(page.find('[data-testid=composer-circle-panel]') === null, 'Close goes back to the circle');
  assert.ok(page.find('[data-testid=composer-circle]'), 'the circle is back');
  assert.deepEqual(opened, [], 'nothing was handed off');
});

test('Open in full hands the conversation id to the app, the panel closes after; it is disabled on an empty conversation unless allowEmpty', async t => {
  const demo = createDemoController({ script, pace: 1 });
  const agent = { controller: demo.controller, label: 'Assistant' };
  const calls = [];
  const handoff = { openFull: (id, context) => calls.push([id, context]) };
  const page = await mount(t, 1280, kit => standalone(kit, agent, circle({ handoff })));
  await page.click('composer-circle');
  const button = () => page.find('[data-testid=composer-open-full]');
  assert.equal(button().disabled, true, 'nothing to continue on an empty chat');
  await page.click('composer-open-full');
  assert.deepEqual(calls, [], 'a disabled control hands nothing off');
  await page.set(standalone(page.kit, agent, circle({ handoff: { ...handoff, allowEmpty: true } })));
  assert.equal(button().disabled, false, 'allowEmpty');
  await page.click('composer-open-full');
  assert.deepEqual(calls, [['demo', { empty: true }]], 'the id and the empty flag');
  assert.ok(page.find('[data-testid=composer-circle-panel]') === null, 'the panel closes after the hand-off');
  assert.ok(page.find('[data-testid=composer-circle]'), 'the circle is back until the app says the page is on show');
  await page.click('composer-circle');
  await page.act(async () => { say(demo, 'How do I export?'); await wait(300); });
  await page.set(standalone(page.kit, agent, circle({ handoff })));
  assert.equal(button().disabled, false, 'a message was sent');
  await page.click('composer-open-full');
  assert.deepEqual(calls.at(-1), ['demo', { empty: false }]);
  const shorthand = [];
  await page.click('composer-circle');
  await page.set(standalone(page.kit, agent, circle({ on: { openFull: id => shorthand.push(id) } })));
  await page.click('composer-open-full');
  assert.deepEqual(shorthand, ['demo'], 'on.openFull is the same hand-off, with the id');
  const stay = [];
  await page.click('composer-circle');
  await page.set(standalone(page.kit, agent, circle({ handoff: { openFull: id => stay.push(id), then: 'stay' } })));
  await page.click('composer-open-full');
  assert.equal(stay.length, 1);
  assert.ok(page.find('[data-testid=composer-circle-panel]'), 'then: stay keeps the panel');
});

test('suspended hides the circle and clears the unread mark, in every instance mounted on the conversation', async t => {
  const demo = createDemoController({ script, pace: 1 });
  const agent = { controller: demo.controller, label: 'Assistant' };
  const two = (kit, suspended) => h('div', null, standalone(kit, agent, circle({ id: 'a', suspended })), standalone(kit, agent, circle({ id: 'b' })));
    const page = await mount(t, 1280, kit => two(kit, false));
    await page.act(async () => { say(demo, 'answer'); await wait(1600); });
    const unread = id => page.find(`[data-composer=${id}] [data-testid=agent-bar-unread]`);
  assert.ok(unread('a') && unread('b'), 'a reply that came while folded is unread on both');
    await page.set(two(page.kit, true));
    assert.ok(page.find('[data-composer=a]') === null, 'the full page is on show: the launcher is hidden');
  assert.ok(unread('b') === null, 'and the conversation is read in the other instance too');
    await page.set(two(page.kit, false));
    assert.ok(unread('a') === null, 'back from the page, nothing is unread');
  // The hand-off clears it everywhere too: a second reply, read from B's panel after A's hand-off.
  await page.act(async () => { say(demo, 'answer'); await wait(1600); });
  assert.ok(unread('a') && unread('b'));
  let opened;
  await page.set(h('div', null, standalone(page.kit, agent, circle({ id: 'a', handoff: { openFull: id => { opened = id; } } })), standalone(page.kit, agent, circle({ id: 'b' }))));
  await page.act(async () => { page.find('[data-composer=a] [data-testid=composer-circle]').dispatchEvent(new page.window.MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 })); await wait(150); });
  assert.ok(unread('b'), 'reading in A\'s panel is A\'s own: B still counts the reply');
  await page.act(async () => { say(demo, 'How do I export?'); await wait(300); });
  await page.click('composer-open-full');
  assert.equal(opened, 'demo');
  assert.ok(unread('b') === null, 'Open in full clears the mark in the instances still folded');
});

test('a stored float or icon place does not apply to a circle: it opens as the circle (the stored place is clamped on read)', async t => {
  const demo = createDemoController({ script, pace: 1 });
  const agent = { controller: demo.controller, label: 'Assistant' };
  for (const place of ['float', 'icon:float', 'icon:bottom']) {
    const page = await mount(t, 1280, kit => { globalThis.localStorage.setItem('boring-ui:sidebar-composer-place', place); return standalone(kit, agent, circle()); });
    assert.ok(page.find('[data-testid=composer-circle]'), `${place}: the circle`);
    assert.equal(page.all('[data-testid=composer-floating], [data-testid=composer-icon]').length, 0, `${place}: no floating bar, no icon`);
    await page.unmount();
  }
});

test('Esc closes the panel; a handled key, a menu or a note bubble keeps its own Esc', async t => {
  const demo = createDemoController({ script, pace: 1 });
  const agent = { controller: demo.controller, label: 'Assistant' };
  const page = await mount(t, 1280, kit => standalone(kit, agent, circle()));
  await page.click('composer-circle');
  await page.act(async () => { const event = new page.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }); event.preventDefault(); page.window.document.dispatchEvent(event); });
  assert.ok(page.find('[data-testid=composer-circle-panel]'), 'a handled Esc is not the panel\'s');
  await page.key('Escape');
  assert.ok(page.find('[data-testid=composer-circle-panel]') === null, 'Esc closes it');
  await page.key('j', page.window.document).catch(() => {});
  await page.act(async () => { page.window.document.dispatchEvent(new page.window.KeyboardEvent('keydown', { key: 'j', ctrlKey: true, bubbles: true, cancelable: true })); });
  await page.act(() => wait(100));
  assert.ok(page.find('[data-testid=composer-circle-panel]'), 'Ctrl+J opens it (the first launcher answers)');
});

test('launchers stack on one corner by mount order or at.stack, each with its own storage and Ctrl+J; the page reserve is published', async t => {
  const first = createDemoController({ script, pace: 1 }), second = createDemoController({ script, pace: 1 });
  const a = { controller: first.controller, label: 'Support' }, b = { controller: second.controller, label: 'Ideas' };
  const page = await mount(t, 1280, kit => h('div', null, standalone(kit, a, circle({ id: 'support' })), standalone(kit, b, circle({ id: 'ideas' }))));
  const slot = id => page.find(`[data-composer=${id}]`)?.dataset.slotIndex;
  assert.deepEqual([slot('support'), slot('ideas')], ['0', '1'], 'auto: by mount order, nearest the corner first');
  const box = id => page.find(`[data-composer=${id}]`).style.insetBlockEnd;
  assert.ok(/^calc\(.*\+ 0px\)$/.test(box('support')) && /\+ 64px\)$/.test(box('ideas')), `the second sits one circle and a 12 px gap higher: ${box('support')} / ${box('ideas')}`);
  const root = page.window.document.documentElement.style;
  assert.ok(root.getPropertyValue('--composer-reserve-block').includes('116px'), `the footprint of the stack is published: ${root.getPropertyValue('--composer-reserve-block')}`);
  assert.ok(root.getPropertyValue('--composer-reserve-inline').includes('52px'), 'and its inline end');
  await page.set(h('div', null, standalone(page.kit, a, circle({ id: 'support', at: { stack: 2 } })), standalone(page.kit, b, circle({ id: 'ideas', at: { stack: 1 } }))));
  assert.deepEqual([slot('support'), slot('ideas')], ['1', '0'], 'at.stack orders them');
  await page.set(h('div', null, standalone(page.kit, a, circle({ id: 'support', reserve: 'none' })), standalone(page.kit, b, circle({ id: 'ideas', reserve: 'none' }))));
  assert.equal(root.getPropertyValue('--composer-reserve-block'), '', 'reserve: none publishes nothing');
  await page.click('composer-circle').catch(() => {});
  const keys = Object.keys(page.window.localStorage);
  assert.ok(keys.every(key => !key.includes('composer-place') || key.includes('#')), `a launcher with an id has its own keys: ${keys}`);
});

test('controlled level: the app owns it, on.level hears every change, defaultLevel only starts it', async t => {
  const demo = createDemoController({ script, pace: 1 });
  const agent = { controller: demo.controller, label: 'Assistant' };
  const heard = [];
  const on = { level: level => heard.push(level) };
  const page = await mount(t, 1280, kit => standalone(kit, agent, circle({ level: 'folded', on })));
  await page.click('composer-circle');
  assert.deepEqual(heard, ['open'], 'the tap asks the app');
  assert.ok(page.find('[data-testid=composer-circle-panel]') === null, 'and the panel waits for the app');
  await page.set(standalone(page.kit, agent, circle({ level: 'open', on })));
  assert.ok(page.find('[data-testid=composer-circle-panel]'), 'the app set the level');
  await page.click('agent-layer-close');
  assert.deepEqual(heard, ['open', 'folded']);
  assert.ok(page.find('[data-testid=composer-circle-panel]'), 'still open until the app says otherwise');
  const started = await mount(t, 1280, kit => standalone(kit, agent, circle({ defaultLevel: 'open', on })));
  assert.ok(started.find('[data-testid=composer-circle-panel]'), 'defaultLevel opens it');
  await started.click('agent-layer-close');
  assert.ok(started.find('[data-testid=composer-circle-panel]') === null, 'and the person can close it');
  assert.equal(heard.at(-1), 'folded');
});

test('the folded note and the signals: the status text beside the circle, and what the circle carries goes to on.signals', async t => {
  const demo = createDemoController({ script, pace: 1 });
  const agent = { controller: demo.controller, label: 'Assistant' };
  const heard = [];
  const page = await mount(t, 1280, kit => standalone(kit, agent, circle({ note: signals => signals.unread ? 'New reply' : 'Support', on: { signals: signals => heard.push(signals) } })));
  assert.equal(page.find('[data-testid=composer-circle-note]')?.textContent, 'Support');
  await page.act(async () => { say(demo, 'answer'); await wait(1600); });
  assert.equal(page.find('[data-testid=composer-circle-note]')?.textContent, 'New reply', 'the note follows the signals');
  assert.ok(heard.some(signals => signals.unread), 'on.signals heard the unread');
  await page.set(standalone(page.kit, agent, circle({ note: () => null })));
  assert.ok(page.find('[data-testid=composer-circle-note]') === null, 'null: no note');
});

test('the resolver throws, naming the fix, for a combination that would do nothing', async t => {
  const message = (make) => caught(t, make);
  assert.match(await message((kit, agent) => standalone(kit, agent, circle({ sizes: ['open', 'full'] }))), /handoff\.openFull/);
  assert.match(await message((kit, agent) => standalone(kit, agent, circle({ level: 'full', on: { level() {} } }))), /two levels.*handoff\.openFull/);
  assert.match(await message((kit, agent) => standalone(kit, agent, circle({ level: 'open' }))), /on\.level/);
  assert.match(await message((kit, agent) => standalone(kit, agent, { launcher: 'bar', sizes: ['open'], avoid: ['.x'] })), /circle launcher/);
  assert.match(await message((kit, agent) => standalone(kit, agent, { launcher: 'bar', dock: true })), /no side dock/);
  assert.match(await message((kit, agent) => standalone(kit, agent, circle({ at: { place: 'float' } }))), /corner/);
  assert.match(await message((kit, agent) => standalone(kit, agent, circle(), { start: 'icon' })), /replaces .start./);
  assert.match(await message((kit, agent) => standalone(kit, agent, circle(), { storage: 'session', onOpenFull() {} })), /storage.*onOpenFull|onOpenFull/);
  assert.match(await message((kit, agent) => h(kit.AppShell, { layout: 'screen', title: 'Orders app', nav, route: { id: 'Orders', onChange() {} }, agent, composer: circle(), floatingComposer: true })), /replaces .floatingComposer./);
});

test('AppShell: the circle takes the shell\'s composer prop, in a function of the viewport; no dock beside the page; the notice row keeps clear of the circle', async t => {
  const demo = createDemoController({ script, pace: 1 });
  const agent = { controller: demo.controller, label: 'Assistant' };
  const seen = [];
  const composer = env => { seen.push(env); return circle({ id: env.phone ? 'phone' : 'wide', handoff: { openFull() {} } }); };
  const notices = [{ id: 'n', kind: 'info', text: 'A newer version is online.' }];
  const page = await mount(t, 1280, kit => h(kit.AppShell, { layout: 'screen', title: 'Orders app', nav, route: { id: 'Orders', onChange() {} }, agent, composer, notices }));
  assert.ok(page.find('[data-composer=wide]'), 'wide: the circle');
  assert.equal(seen.at(-1).phone, false);
  assert.equal(seen.at(-1).route, 'Orders', 'the route is in the env');
  assert.equal(page.all('[data-testid=agent-layer], [data-testid=composer-floating]').length, 0, 'no dock, no bar');
  await page.click('composer-circle');
  assert.ok(page.find('[data-testid=composer-circle-panel]'));
  assert.equal(page.all('[data-testid=agent-layer]').length, 0, 'the panel is not the side dock');
  await page.click('agent-layer-close');
  await page.resize(390);
  assert.ok(page.find('[data-composer=phone]'), 'resized to a phone: the function is read again');
  assert.equal(seen.at(-1).phone, true);
  const row = page.find('[data-testid=notice]');
  assert.ok(row?.getAttribute('style')?.includes('--composer-reserve-inline'), `the notice row keeps the circle's footprint free: ${row?.getAttribute('style')}`);
  await page.click('composer-circle');
  assert.ok(page.find('[data-testid=agent-layer]'), 'on a phone the panel is the bottom sheet');
  assert.ok(page.find('[data-testid=agent-layer-close]') && page.find('[data-testid=composer-open-full]'), 'with Open in full and Close');
  assert.equal(page.all('[data-testid=agent-layer-expand], [data-testid=agent-layer-collapse]').length, 0, 'one size');
});
