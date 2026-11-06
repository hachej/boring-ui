// Grey on grey cannot return to PiChat (D-1733): the real PiChat rendered in happy-dom (empty, with messages and a tool block, with
// attachments), every `bg-*` token class it carries resolved to the `theme` item's light and dark values (registry.json). The panel sits on
// --card (never the canvas), and every other surface differs from the one it sits on, by at least 1.1:1. The composer field is the one
// card-on-card surface: it is told apart by its --input edge, not by a fill. Needs no browser, so it runs in the required `tests` job.
// Fictional text only.
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, readFileSync } from 'node:fs';
import { build } from 'esbuild';
import { Window } from 'happy-dom';

const items = JSON.parse(readFileSync(new URL('../../registry.json', import.meta.url), 'utf8')).items;
const theme = items.find(item => item.name === 'theme').cssVars;
// The block's own stylesheet paints the shadcn primitives it cannot restyle through className (design policy): `.pi-chat <selector>` { background-color: var(--token) }.
const paints = Object.entries(items.find(item => item.name === 'pi-chat').css['@layer utilities']).flatMap(([selector, rule]) => /^var\(--([a-z-]+)\)$/.test(rule?.['background-color'] ?? '') ? [{ selector, token: /^var\(--([a-z-]+)\)$/.exec(rule['background-color'])[1] }] : []);
const TOKENS = ['background', 'card', 'secondary', 'muted', 'primary', 'accent', 'popover'];
const MIN = 1.1;

/** The token's value in a mode (dark overrides light), following `var(--other)` references. */
function value(token, mode) {
  let raw = (mode === 'dark' && theme.dark[token]) || theme.light[token];
  for (let hops = 0; hops < 5; hops += 1) { const ref = /^var\(--([a-z-]+)\)$/.exec(raw); if (!ref) break; raw = (mode === 'dark' && theme.dark[ref[1]]) || theme.light[ref[1]]; }
  return raw;
}
/** Relative luminance of an `oklch(L C H)` colour (OKLab to linear sRGB, then WCAG weights). */
function luminance(colour) {
  const match = /^oklch\(([\d.]+) ([\d.]+) ([\d.]+)\)$|^oklch\(([\d.]+) 0 0\)$/.exec(colour);
  assert.ok(match, `a plain oklch() colour, got ${colour}`);
  const [L, C, H] = match[1] !== undefined ? [Number(match[1]), Number(match[2]), Number(match[3])] : [Number(match[4]), 0, 0];
  const a = C * Math.cos(H * Math.PI / 180), b = C * Math.sin(H * Math.PI / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3, m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3, s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3;
  const rgb = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s].map(x => Math.min(1, Math.max(0, x)));
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
}
const contrast = (a, b, mode) => { const [x, y] = [luminance(value(a, mode)), luminance(value(b, mode))].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

/** The token an element paints, from the classes it renders: `bg-x` (`dark:bg-x` in dark), or the bubble variant its parent hands down. */
function surface(element, mode) {
  const painted = paints.find(({ selector }) => element.matches(selector));
  if (painted) return painted.token;
  const own = String(element.getAttribute('class') ?? '').split(/\s+/);
  const via = String(element.parentElement?.getAttribute('class') ?? '').split(/\s+/).filter(name => name.startsWith('*:data-[slot=bubble-content]:bg-')).map(name => name.replace('*:data-[slot=bubble-content]:', ''));
  const classes = element.dataset?.slot === 'bubble-content' ? via : own;
  // Only a plain surface token paints a surface here; transparent, translucent and status fills are not judged.
  const pick = prefix => classes.find(name => name.startsWith(`${prefix}bg-`) && !name.includes(':', prefix.length) && TOKENS.includes(name.slice(prefix.length + 3)));
  const name = (mode === 'dark' && pick('dark:')) || pick('');
  return name?.replace(/^(dark:)?bg-/, '');
}
const parentSurface = (element, mode) => { for (let up = element.parentElement; up; up = up.parentElement) { const token = surface(up, mode); if (token) return token; } return 'background'; };

const call = { type: 'toolCall', id: 'c1', name: 'bash', arguments: { command: 'fictional-list' } };
const assistant = content => ({ role: 'assistant', content, api: 'fictional', provider: 'fictional', model: 'fictional', usage: {}, stopReason: content.some(part => part.type === 'toolCall') ? 'toolUse' : 'stop', timestamp: 1 });
const message = (id, model) => ({ id, kind: 'message', model: [model] });
const withMessages = { entries: [
  message(1, { role: 'user', content: 'Quel est le nom du port ?', timestamp: 0 }),
  { id: 2, kind: 'message', byTaskId: 1, model: [assistant([call])] },
  { id: 3, kind: 'message', byTaskId: 1, model: [{ role: 'toolResult', toolCallId: 'c1', toolName: 'bash', content: [{ type: 'text', text: 'fictional output' }], isError: false, timestamp: 2 }, assistant([{ type: 'text', text: 'Port-Imaginaire.' }])] },
], docs: {} };
const withAttachments = { entries: [message(1, { role: 'user', content: 'Voici @uploads/plan.pdf', timestamp: 0 })], docs: {} };

test('PiChat surfaces: the panel is --card and no chat surface equals the one under it, light and dark', { timeout: 60000 }, async t => {
  const window = new Window({ url: 'https://fictional.invalid/' });
  const names = ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Text', 'MutationObserver', 'ResizeObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'sessionStorage', 'localStorage', 'addEventListener', 'removeEventListener', 'matchMedia', 'innerWidth', 'innerHeight', 'IS_REACT_ACT_ENVIRONMENT'];
  const globals = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  for (const name of names) {
    const given = name === 'window' ? window : name === 'IS_REACT_ACT_ENVIRONMENT' ? true : window[name];
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: typeof given === 'function' && /^[a-z]/.test(name) ? given.bind(window) : given });
  }
  const { createElement, act } = await import('react'); const { createRoot } = await import('react-dom/client');
  const out = new URL('../../.cache/pi-chat-surfaces/', import.meta.url); mkdirSync(out, { recursive: true });
  const output = new URL('chat.mjs', out);
  await build({ entryPoints: [new URL('../../registry/pi-chat/pi-chat.tsx', import.meta.url).pathname], outfile: output.pathname, bundle: true, format: 'esm', platform: 'node', jsx: 'automatic', packages: 'external', loader: { '.css': 'empty' }, plugins: [{ name: 'file-tree-css', setup(builder) { builder.onResolve({ filter: /^@hachej\/boring-ui-kit\/file-tree\.css$/ }, () => ({ path: new URL(import.meta.resolve('@hachej/boring-ui-kit/file-tree.css')).pathname, external: false })); } }] });
  const { PiChat } = await import(output.href);
  const element = document.createElement('div'); document.body.append(element); const root = createRoot(element);
  t.after(async () => {
    await act(async () => root.unmount()); await window.happyDOM.close();
    for (const [name, descriptor] of globals) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; }
  });
  let snapshot, drawn = 0;
  const controller = new Proxy({ getSnapshot: () => snapshot, subscribe: () => () => {} }, { get: (target, key) => key in target ? target[key] : async () => {} });
  const draw = async (view, attachments = []) => {
    snapshot = { identity: {}, conversationId: 'fictional', connection: { kind: 'connected' }, view, draft: { text: '', attachments, version: 0 }, outbox: [], history: { kind: 'disabled' }, send: { kind: 'idle' }, stop: 'idle', disposed: false };
    await act(async () => root.render(createElement(PiChat, { key: drawn++, controller, header: false, mode: 'developer', onFiles: () => {}, mentions: undefined, ...(view === withAttachments ? { attachments: {} } : {}) })));
    // Open the activity block and then the tool card inside it, so the tool's argument and result blocks are on the page.
    for (let pass = 0; pass < 3; pass += 1) for (const trigger of element.querySelectorAll('[data-slot=trace-collapsible][data-closed] > [data-slot=trace-collapsible-trigger]')) await act(async () => trigger.click());
  };
  const q = selector => element.querySelector(selector), all = selector => [...element.querySelectorAll(selector)];

  /** Every surface under the panel, but the composer field (card on card by design), against the one it sits on. */
  const checkTree = mode => {
    const panel = q('[data-boring=pi-chat]');
    assert.equal(surface(panel, mode), 'card', `${mode}: the panel is --card`);
    assert.equal(surface(panel, mode) === parentSurface(panel, mode), false, `${mode}: the panel differs from the canvas it sits on`);
    assert.ok(contrast('card', 'background', mode) >= 1.0);
    const checked = [];
    for (const node of all('[data-boring=pi-chat] *')) {
      const token = surface(node, mode); if (!token) continue;
      const under = parentSurface(node, mode), label = `${mode}: <${node.tagName.toLowerCase()} ${node.dataset.slot ?? node.dataset.testid ?? ''}> ${token} on ${under}`;
      if (node.dataset.slot === 'input-group') {
        assert.equal(token, 'card', `${label}: the field is --card`);
        assert.equal(String(node.getAttribute('class')).split(/\s+/).includes('border-input'), true, `${label}: told apart by the --input edge`);
        continue;
      }
      assert.equal(token === under, false, `${label}: a surface never equals the one under it`);
      const ratio = contrast(token, under, mode);
      assert.equal(ratio >= MIN, true, `${label}: contrast ${ratio.toFixed(3)} is under ${MIN}:1`);
      checked.push(node.dataset.slot ?? node.dataset.testid ?? node.tagName.toLowerCase());
    }
    return checked;
  };

  for (const mode of ['light', 'dark']) {
    await t.test(`${mode}: empty chat`, async () => { await draw({ entries: [], docs: {} }); checkTree(mode); assert.ok(q('[data-slot=input-group]'), 'the composer field is there'); });
    await t.test(`${mode}: user bubble, tool blocks`, async () => {
      await draw(withMessages);
      const checked = checkTree(mode);
      assert.equal(surface(q('[data-slot=bubble-content]'), mode), 'secondary', `${mode}: the user bubble is --secondary`);
      assert.ok(checked.includes('bubble-content'), 'the user bubble was checked');
      assert.ok(all('[data-testid=tool-details] [role=status], [data-testid=tool-details] pre').filter(block => surface(block, mode)).length >= 2, 'the tool argument and result blocks were drawn');
      for (const block of all('[data-testid=tool-details] [role=status], [data-testid=tool-details] pre').filter(block => surface(block, mode))) assert.equal(surface(block, mode), 'secondary', `${mode}: a tool block is --secondary on the card`);
    });
    await t.test(`${mode}: attachments in the composer and in a sent message`, async () => {
      await draw(withAttachments, [{ id: 'a1', name: 'plan.pdf', content: { mimeType: 'application/pdf', data: 'ZmljdGlvbg==' } }]);
      const checked = checkTree(mode);
      assert.ok(q('[data-testid=attachments] [data-slot=attachment]'), 'a composer chip is drawn');
      assert.ok(q('[data-testid=message-file] [data-slot=attachment]'), 'a sent file card is drawn');
      assert.ok(checked.filter(slot => slot === 'attachment').length >= 1, 'the chips were checked');
      for (const chip of all('[data-slot=attachment]')) assert.equal(surface(chip, mode), 'secondary', `${mode}: a chip is --secondary`);
    });
  }

  await t.test('the Send button is an icon button in the one field, disabled until there is text (44px on a phone comes from the block button rule)', async () => {
    await draw({ entries: [], docs: {} });
    const send = q('[data-testid=composer-submit]');
    assert.equal(send.getAttribute('aria-label'), 'Send');
    assert.equal(send.disabled, true);
    assert.equal(items.find(item => item.name === 'pi-chat').css['@layer utilities']['@media (width < 768px), (pointer: coarse)']['.pi-chat :is([data-slot="button"], [data-slot="toggle"], [class~="group/button"], [class~="group/toggle"])']['min-height'], '2.75rem');
    assert.equal(send.closest('[data-slot=input-group]') !== null, true, 'inside the one field');
    assert.equal(send.dataset.state, 'send');
  });

  await t.test('the contrast function itself: card over canvas and secondary over card pass, a token over itself does not', () => {
    for (const mode of ['light', 'dark']) { assert.equal(contrast('secondary', 'card', mode) >= MIN, true, `${mode} secondary on card`); assert.equal(contrast('card', 'card', mode) >= MIN, false); }
    assert.equal(contrast('muted', 'background', 'light') >= MIN, false, 'the old bubble on the old panel is the failure this test catches');
  });
});
