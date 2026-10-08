import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';
import {
  createPicker, createOverlay, pickerLabel, componentOf, pickRefusal, createPrivacyPolicy, serializePage, runPrivacyCanaries,
  FEEDBACK_OVERLAY_ATTRIBUTE, FEEDBACK_IGNORE_ATTRIBUTE,
} from '@hachej/boring-feedback/page';

// Fictional pages only. HappyDOM has no layout, so the tests pass a hit test that names the elements "under the pointer".
const policy = createPrivacyPolicy();
const PAGE = `<div id="app"><header data-feedback-visible=""><nav><a href="#">Projects</a></nav></header>
  <main data-feedback-visible=""><form id="profile"><div class="actions"><button type="submit" id="save" data-feedback-id="save-profile">Save profile</button>
  <button type="button" id="other">Other</button></div><input id="name" value="Fictional Studio"></form>
  <div id="host"></div><section id="data"><p id="secret">Private fictional row</p></section></main>
  <aside data-feedback-ignore=""><button id="chrome">Agent</button></aside></div><div id="portal"><button id="ported">Portal</button></div><button id="outside">Outside</button>`;

function page(t, html = PAGE) {
  const window = new Window({ url: 'https://fictional.invalid/settings/profile', settings: { disableJavaScriptFileLoading: true, disableCSSFileLoading: true, disableIframePageLoading: true } });
  window.document.body.innerHTML = html;
  t.after(() => window.happyDOM.close());
  const { document } = window;
  return { window, document, root: document.getElementById('app'), $: id => document.getElementById(id) };
}

/** A picker whose hit test returns `under.current` (topmost first), and the window's listener bookkeeping. */
function picking(t, context, options = {}) {
  const under = { current: [] };
  const live = new Map();
  const { window } = context;
  const add = window.addEventListener.bind(window), remove = window.removeEventListener.bind(window);
  window.addEventListener = (type, listener, opts) => { if (opts?.capture) live.set(`${type}`, (live.get(type) ?? 0) + 1); return add(type, listener, opts); };
  window.removeEventListener = (type, listener, opts) => { if (opts?.capture) live.set(`${type}`, (live.get(type) ?? 0) - 1); return remove(type, listener, opts); };
  const picker = createPicker({ root: context.root, policy, hitTest: () => under.current, ...options });
  t.after(() => picker.dispose());
  const listening = () => [...live.entries()].filter(([, count]) => count > 0).map(([type]) => type).sort();
  return { picker, under, listening };
}

const mouse = (window, type, target, init = {}) => target.dispatchEvent(new window.MouseEvent(type, { bubbles: true, cancelable: true, composed: true, clientX: 10, clientY: 10, detail: 1, ...init }));
const pointer = (window, type, target, init = {}) => target.dispatchEvent(new window.PointerEvent(type, { bubbles: true, cancelable: true, composed: true, clientX: 10, clientY: 10, pointerType: 'mouse', ...init }));
const key = (window, target, value, init = {}) => target.dispatchEvent(new window.KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true, ...init }));
const press = (window, target, init) => { for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup']) (type.startsWith('pointer') ? pointer : mouse)(window, type, target, init); mouse(window, 'click', target, init); };

test('the overlay is a shadow-root host marked data-feedback-overlay, never takes pointer events and is never serialized', t => {
  const context = page(t);
  const overlay = createOverlay({ document: context.document, styles: '.box { outline: 1px solid red; }' });
  t.after(() => overlay.dispose());
  assert.equal(overlay.host.hasAttribute(FEEDBACK_OVERLAY_ATTRIBUTE), true);
  assert.equal(overlay.host.getAttribute('data-boring'), 'feedback');
  assert.ok(overlay.host.shadowRoot);
  const style = overlay.host.shadowRoot.querySelector('style').textContent;
  assert.match(style, /:host \{[^}]*pointer-events: none/);
  assert.match(style, /outline: 1px solid red/, 'the registry styles are appended in the shadow root');
  assert.equal(context.root.contains(overlay.host), false);
  overlay.highlight(context.$('save'), 'Fictional note');
  assert.deepEqual(overlay.drawn(), [{ label: 'Fictional note', tone: 'reveal' }]);
  assert.equal(overlay.host.shadowRoot.querySelector('.label').textContent, 'Fictional note');
  const snapshot = JSON.stringify(serializePage(context.document.body, policy));
  assert.ok(!snapshot.includes('Fictional note'), 'the overlay never enters a snapshot');
  overlay.dispose();
  assert.equal(overlay.host.isConnected, false);
});

test('hover skips the overlay and ignored subtrees; anything else outside the root refuses the point', async t => {
  const context = page(t);
  const { picker, under } = picking(t, context);
  void picker.start();
  under.current = [picker.overlay.host, context.$('chrome'), context.$('save'), context.root];
  pointer(context.window, 'pointermove', context.document.body);
  assert.equal(picker.state().current, context.$('save'));
  assert.equal(picker.state().label, 'button «Save profile»');
  assert.deepEqual(picker.overlay.drawn(), [{ label: 'button «Save profile»', tone: 'hover' }]);
  under.current = [context.$('ported'), context.$('save')];
  pointer(context.window, 'pointermove', context.document.body);
  assert.equal(picker.state().current, undefined, 'a portal on top is not looked through');
  assert.match(picker.state().refusal, /outside the application root/);
  assert.equal(picker.select(context.$('outside')), false);
  assert.equal(picker.select(context.$('chrome')), false);
  const shadow = context.$('host').attachShadow({ mode: 'open' });
  shadow.innerHTML = '<button>Inside</button>';
  assert.match(pickRefusal(shadow.querySelector('button'), context.root), /shadow root/);
  assert.equal(picker.select(shadow.querySelector('button')), false);
});

test('keys: ↑ parent, ↓ back along the same path, Tab moves between elements, Enter pins, Esc cancels', async t => {
  const context = page(t);
  const { picker } = picking(t, context);
  const done = picker.start();
  assert.equal(picker.select(context.$('save')), true);
  key(context.window, context.document.body, 'ArrowUp');
  assert.equal(picker.state().current, context.$('save').parentElement);
  key(context.window, context.document.body, 'ArrowUp');
  assert.equal(picker.state().current, context.$('profile'));
  key(context.window, context.document.body, 'ArrowDown');
  key(context.window, context.document.body, 'ArrowDown');
  assert.equal(picker.state().current, context.$('save'), '↓ returns to the child ↑ left');
  key(context.window, context.document.body, 'Tab');
  assert.equal(picker.state().current, context.$('other'));
  key(context.window, context.document.body, 'Tab', { shiftKey: true });
  assert.equal(picker.state().current, context.$('save'));
  key(context.window, context.document.body, 'Enter');
  const result = await done;
  assert.equal(result.kind, 'pinned');
  assert.deepEqual(result.elements, [context.$('save')]);
  assert.deepEqual(picker.overlay.drawn(), [{ label: 'button «Save profile»', tone: 'pinned' }], 'the pin stays drawn for the sheet');

  const again = picker.start();
  picker.select(context.$('other'));
  key(context.window, context.document.body, 'Escape');
  assert.deepEqual(await again, { kind: 'cancelled' });
  assert.deepEqual(picker.overlay.drawn(), []);
});

test('picking a button never activates it: no click handler, no submit, no default action', async t => {
  const context = page(t);
  const { window, $ } = context;
  const seen = [];
  $('save').addEventListener('click', () => seen.push('button click'));
  $('profile').addEventListener('submit', event => { event.preventDefault(); seen.push('submit'); });
  context.document.addEventListener('click', () => seen.push('document click'));
  context.document.addEventListener('keydown', () => seen.push('document key'));
  for (const type of ['pointerdown', 'mousedown']) $('save').addEventListener(type, () => seen.push(type));
  const { picker, under } = picking(t, context);
  const done = picker.start();
  under.current = [$('save')];
  press(window, $('save'));
  const result = await done;
  assert.deepEqual(result.elements, [$('save')]);
  // Enter in a text field would submit the form implicitly; the key is the picker's, and a submit event is stopped too.
  const second = picker.start();
  key(window, $('name'), 'x');
  const submit = new window.Event('submit', { bubbles: true, cancelable: true });
  $('profile').dispatchEvent(submit);
  assert.equal(submit.defaultPrevented, true);
  key(window, $('name'), 'Escape');
  await second;
  assert.deepEqual(seen, [], 'the page saw nothing while picking');
  // After pick mode the same button works normally again.
  mouse(window, 'click', $('save'));
  assert.ok(seen.includes('button click') && seen.includes('submit'), seen.join());
});

test('Shift-click pins several; a plain click finishes with all of them', async t => {
  const context = page(t);
  const { window, $ } = context;
  const { picker, under } = picking(t, context);
  const done = picker.start();
  under.current = [$('save')];
  press(window, $('save'), { shiftKey: true });
  under.current = [$('other')];
  press(window, $('other'), { shiftKey: true });
  assert.equal(picker.state().mode, 'picking');
  assert.deepEqual(picker.state().pins, [$('save'), $('other')]);
  under.current = [$('secret')];
  press(window, $('secret'));
  assert.deepEqual((await done).elements, [$('save'), $('other'), $('secret')]);
});

test('touch: a tap selects and the overlay toolbar replaces the keys', async t => {
  const context = page(t);
  const { window, $ } = context;
  const { picker, under } = picking(t, context);
  const done = picker.start();
  under.current = [$('save')];
  pointer(window, 'pointerdown', $('save'), { pointerType: 'touch' });
  pointer(window, 'pointerup', $('save'), { pointerType: 'touch' });
  mouse(window, 'click', $('save'));
  assert.equal(picker.state().mode, 'picking', 'a tap selects, it does not pin');
  assert.equal(picker.state().touch, true);
  assert.equal(picker.state().current, $('save'));
  const bar = picker.overlay.host.shadowRoot.querySelector('.toolbar');
  assert.equal(bar.hidden, false);
  const action = name => bar.querySelector(`[data-action=${name}]`);
  assert.deepEqual([...bar.querySelectorAll('button')].map(button => button.textContent), ['Parent', 'Child', 'Pin', 'Cancel']);
  // Toolbar presses come from inside the overlay, so the picker lets them through.
  mouse(window, 'click', action('parent'));
  assert.equal(picker.state().current, $('save').parentElement);
  mouse(window, 'click', action('child'));
  assert.equal(picker.state().current, $('save'));
  mouse(window, 'click', action('pin'));
  assert.deepEqual((await done).elements, [$('save')]);
  assert.equal(bar.hidden, true);
});

test('focus returns where it was and every listener is removed on finish, cancel and dispose', async t => {
  const context = page(t);
  const { window, $ } = context;
  const { picker, listening } = picking(t, context);
  $('name').focus();
  const pinned = picker.start();
  assert.ok(listening().includes('click') && listening().includes('keydown') && listening().includes('submit') && listening().includes('wheel'));
  picker.select($('save'));
  key(window, context.document.body, 'Enter');
  await pinned;
  assert.deepEqual(listening(), ['scroll'], 'only the overlay keeps following the drawn pin');
  picker.overlay.clear();
  assert.deepEqual(listening(), []);
  assert.equal(context.document.activeElement, $('name'));

  $('other').focus();
  const cancelled = picker.start();
  key(window, context.document.body, 'Escape');
  await cancelled;
  assert.deepEqual(listening(), []);
  assert.equal(context.document.activeElement, $('other'));

  const disposed = picker.start();
  picker.dispose();
  assert.deepEqual(await disposed, { kind: 'cancelled' });
  assert.deepEqual(listening(), []);
  assert.equal(picker.overlay.host.isConnected, false, 'an overlay the picker made is removed with it');
});

test('scrolling up selects the parent, down the child again; wheel events never reach the page', async t => {
  const context = page(t);
  const { window, $ } = context;
  const { picker } = picking(t, context);
  void picker.start();
  picker.select($('save'));
  const wheel = deltaY => { const event = new window.WheelEvent('wheel', { deltaY, bubbles: true, cancelable: true }); $('save').dispatchEvent(event); return event.defaultPrevented; };
  assert.equal(wheel(-100), true);
  assert.equal(picker.state().current, $('save').parentElement);
  wheel(100);
  assert.equal(picker.state().current, $('save'));
  picker.cancel();
});

test('labels come only from the policy: component from data-source, role and allowed name, else masked', t => {
  const context = page(t, `<div id="app"><main data-feedback-visible=""><button id="a" data-source="src/settings/SaveBar.tsx:42">Save</button>
    <button id="b" data-source="/abs/Secret.tsx:1">Go</button><button id="c" data-source="src/panels/index.tsx:3">Open</button></main>
    <section><button id="d">Private fictional name</button><input id="e" value="Fictional value"></section></div>`);
  const { $ } = context;
  assert.equal(pickerLabel($('a'), policy), 'SaveBar · button «Save»');
  assert.equal(pickerLabel($('b'), policy), 'button «Go»', 'a refused source path is dropped');
  assert.equal(pickerLabel($('c'), policy), 'panels · button «Open»');
  assert.equal(pickerLabel($('d'), policy), 'button · masked');
  assert.equal(pickerLabel($('e'), policy), 'textbox · masked');
  assert.equal(componentOf('a/b/Widget.jsx:9'), 'Widget');
});

test('the privacy canary kit finds nothing in picker labels, hover and pinned overlay text', async t => {
  const context = page(t, '<div id="app"><main></main></div>');
  const result = await runPrivacyCanaries({
    page: { document: context.document, root: context.root.querySelector('main') },
    run: async ({ root: section }, emit) => {
      const elements = [section, ...section.querySelectorAll('*')];
      const under = { current: [] };
      const picker = createPicker({ root: context.root, policy, hitTest: () => under.current });
      const done = picker.start();
      for (const element of elements) {
        emit('label', pickerLabel(element, policy));
        under.current = [element];
        pointerHover(context.window);
        emit('state', { label: picker.state().label, refusal: picker.state().refusal });
        emit('overlay', picker.overlay.drawn());
        emit('overlay-text', picker.overlay.host.shadowRoot.textContent);
        picker.pin({ add: true });
      }
      picker.finish();
      emit('pinned', (await done).kind);
      emit('pinned-overlay', picker.overlay.host.shadowRoot.textContent);
      picker.dispose();
      return elements.length;
    },
  });
  assert.deepEqual(result.hits, []);
  assert.ok(result.scanned > 100);
  function pointerHover(window) { window.document.body.dispatchEvent(new window.PointerEvent('pointermove', { bubbles: true, clientX: 1, clientY: 1, pointerType: 'mouse' })); }
});

test('ignored subtrees keep their pointer events while picking (the point button and the agent bar)', async t => {
  const context = page(t);
  const { window, $ } = context;
  let clicks = 0;
  $('chrome').addEventListener('click', () => clicks++);
  const { picker } = picking(t, context);
  void picker.start();
  mouse(window, 'click', $('chrome'));
  assert.equal(clicks, 1);
  assert.equal(picker.state().mode, 'picking');
  assert.ok($('chrome').closest(`[${FEEDBACK_IGNORE_ATTRIBUTE}]`));
  picker.cancel();
});
