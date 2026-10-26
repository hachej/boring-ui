// `messageStyle` of PiChat (registry/pi-chat/message.tsx, rows.ts) in happy-dom: `default` is today's look (muted user bubble, plain reply, no tail,
// no time); `messaging` makes my message a primary bubble, the reply a muted bubble on the left, a tail on the first bubble of a run only and the
// time inside. Fictional French text only.
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync } from 'node:fs';
import { build } from 'esbuild';
import { Window } from 'happy-dom';

const names = ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Text', 'DOMParser', 'MutationObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'ResizeObserver', 'matchMedia', 'IS_REACT_ACT_ENVIRONMENT'];
const at = minutes => Date.parse('2026-10-25T14:00:00Z') + minutes * 60_000;
const user = (key, text, minutes) => ({ key, type: 'user', message: { role: 'user', content: text, timestamp: at(minutes) } });
const reply = (key, text, minutes) => ({ key, type: 'assistant', parts: [{ kind: 'text', key: `${key}:t`, text }], streaming: false, text, timestamp: at(minutes) });
const rows = [
  user('u1', 'Bonjour Max, que manger avant la séance de ce soir ?', 0),
  reply('a1', 'Une banane et du yaourt grec, deux heures avant.', 1),
  reply('a2', 'Bois aussi un grand verre d’eau.', 2),
  user('u2', 'Merci, et après la séance ?', 3),
  user('u3', 'Plutôt riz et poulet ?', 4),
  reply('a3', 'Oui, avec des légumes.', 40),
];

test('messageStyle: default is unchanged; messaging gives bubbles, tails on the first of a run and the time inside', async t => {
  const window = new Window({ url: 'https://fictional.invalid/' });
  const globals = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  for (const name of names) {
    const value = name === 'IS_REACT_ACT_ENVIRONMENT' ? true : window[name];
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: typeof value === 'function' && /^[a-z]/.test(name) ? value.bind(window) : value });
  }
  const { createElement, act } = await import('react'); const { createRoot } = await import('react-dom/client');
  const out = new URL('../../.cache/pi-chat-message-style-test/', import.meta.url); mkdirSync(out, { recursive: true });
  const bundle = async name => {
    const output = new URL(`${name}.mjs`, out);
    await build({ entryPoints: [new URL(`../../registry/pi-chat/${name}.${name === 'message' ? 'tsx' : 'ts'}`, import.meta.url).pathname], outfile: output.pathname, bundle: true, format: 'esm', platform: 'node', jsx: 'automatic', packages: 'external', tsconfig: new URL('../../tsconfig.json', import.meta.url).pathname, logLevel: 'silent' });
    return import(output.href);
  };
  const { RowView } = await bundle('message'), { markLeads } = await bundle('rows');
  const host = window.document.createElement('div'); window.document.body.append(host); const root = createRoot(host);
  t.after(async () => { await act(async () => root.unmount()); await window.happyDOM.close(); for (const [name, descriptor] of globals) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; } });
  const context = style => ({ developer: false, groupTool: undefined, commandMentions: undefined, onOpenImage: undefined, onCopy: undefined, pieces: undefined, answer: undefined, artifacts: undefined, ...(style ? { messageStyle: style } : {}) });
  const draw = async (list, style) => { await act(async () => root.render(createElement('div', null, list.map(row => createElement(RowView, { key: row.key, row, context: context(style) }))))); };
  const q = selector => host.querySelector(selector), all = selector => [...host.querySelectorAll(selector)];

  await t.test('markLeads flags the first row of each run, and a gap of more than 15 minutes starts a new one', () => {
    const marked = markLeads(rows);
    assert.deepEqual(marked.map(row => row.lead), [true, true, false, true, false, true]);
    assert.equal(markLeads(rows)[0], marked[0], 'a row keeps its identity while its flag does not change');
  });

  await t.test('default: muted user bubble, plain reply, no tail and no time', async () => {
    await draw(rows);
    assert.equal(all('[data-testid=bubble-tail]').length, 0);
    assert.equal(all('[data-testid=message-time]').length, 0);
    assert.equal(q('[data-row-id=u1] [data-slot=bubble]').dataset.variant, 'muted');
    assert.equal(q('[data-row-id=a1] [data-slot=bubble]').dataset.variant, 'ghost');
  });

  await t.test('messaging: primary on the right, muted on the left, a tail only on the first of a run, the time inside', async () => {
    await draw(markLeads(rows), 'messaging');
    const bubble = id => q(`[data-row-id=${id}] [data-slot=bubble]`), tail = id => q(`[data-row-id=${id}] [data-testid=bubble-tail]`);
    assert.equal(bubble('u1').dataset.variant, 'default'); assert.equal(bubble('u1').dataset.align, 'end');
    assert.equal(bubble('a1').dataset.variant, 'muted'); assert.equal(bubble('a1').dataset.align, 'start');
    assert.equal(tail('u1')?.dataset.side, 'end'); assert.equal(tail('a1')?.dataset.side, 'start');
    assert.equal(tail('a2'), null, 'a second reply in the run has no tail'); assert.equal(tail('u3'), null);
    assert.equal(tail('u2')?.dataset.side, 'end'); assert.equal(tail('a3')?.dataset.side, 'start', 'a long pause starts a new run');
    assert.equal(all('[data-testid=bubble-tail]').length, 4);
    for (const id of ['u1', 'a1', 'a2', 'u2', 'u3', 'a3']) {
      const time = q(`[data-row-id=${id}] [data-testid=message-time]`);
      assert.ok(time, `${id} shows its time`); assert.ok(bubble(id).contains(time), `${id}: the time is inside the bubble`);
    }
    assert.match(q('[data-row-id=u1] [data-testid=message-time]').getAttribute('datetime'), /^2026-10-25T14:00/);
    assert.doesNotMatch(host.innerHTML, /#[0-9a-f]{3,8}\b|rgb\(|oklch\(|hsl\(/i, 'tokens only: no raw colour in the markup');
  });

  await t.test('a reply still streaming has no time', async () => {
    const streaming = { ...reply('s1', 'Je regarde…', 5), streaming: true, lead: true }; delete streaming.timestamp;
    await draw([streaming], 'messaging');
    assert.equal(all('[data-testid=message-time]').length, 0);
    assert.equal(all('[data-testid=bubble-tail]').length, 1);
  });
});
