// Grey on grey cannot return to PiChat (D-1733): the real PiChat rendered in happy-dom (empty, with messages and a tool block, with
// attachments), every `bg-*` token class it carries resolved to the `theme` item's light and dark values (registry.json). The panel sits on
// --card and differs from the canvas it sits on (white over the designer's 0.97 grey is 1.09:1: the panel check is "differs", the 1.1:1
// floor is for surfaces inside the panel). Every surface inside the panel differs from the one it sits on by at least 1.1:1, translucent
// fills composited. The composer field is the one card-on-card surface: it is told apart by its --input edge, and its --card fill is
// asserted in every state. A paint rule must not out-rank a state fill (hover, aria-expanded...) the primitive has: its selector's
// specificity is compared with the state classes the element renders (an estimate of Tailwind's; the cascade itself needs a browser).
// Needs no browser, so it runs in the required `tests` job.
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
/** An `oklch(L C H)` colour as gamma-encoded sRGB in 0..1 (OKLab to linear sRGB, clipped, then the sRGB transfer curve). */
function encoded(colour) {
  const match = /^oklch\(([\d.]+) ([\d.]+) ([\d.]+)\)$|^oklch\(([\d.]+) 0 0\)$/.exec(colour);
  assert.ok(match, `a plain oklch() colour, got ${colour}`);
  const [L, C, H] = match[1] !== undefined ? [Number(match[1]), Number(match[2]), Number(match[3])] : [Number(match[4]), 0, 0];
  const a = C * Math.cos(H * Math.PI / 180), b = C * Math.sin(H * Math.PI / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3, m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3, s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3;
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s]
    .map(x => Math.min(1, Math.max(0, x))).map(x => x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055);
}
/** WCAG relative luminance of a gamma-encoded sRGB colour. */
const luminance = rgb => { const [r, g, b] = rgb.map(x => x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (p, q) => { const [x, y] = [luminance(p), luminance(q)].sort((u, v) => v - u); return (x + 0.05) / (y + 0.05); };
const contrast = (a, b, mode) => ratio(encoded(value(a, mode)), encoded(value(b, mode)));

/** The fill an element paints: `{ token, alpha }` from `bg-x` or `bg-x/NN` (`dark:` in dark), the bubble variant its parent hands down, or the block's own paint rules. */
function paint(element, mode) {
  const painted = paints.filter(({ selector }) => element.matches(selector)).pop();
  if (painted) return { token: painted.token, alpha: 1 };
  const own = String(element.getAttribute('class') ?? '').split(/\s+/);
  const via = String(element.parentElement?.getAttribute('class') ?? '').split(/\s+/).filter(name => name.startsWith('*:data-[slot=bubble-content]:bg-')).map(name => name.replace('*:data-[slot=bubble-content]:', ''));
  const classes = element.dataset?.slot === 'bubble-content' ? via : own;
  // A neutral surface token, opaque or translucent (`/NN`), paints a surface here; transparent and status fills are not judged.
  const pick = prefix => { for (const name of classes) { const found = name.startsWith(`${prefix}bg-`) && !name.includes(':', prefix.length) && /^([a-z-]+)(?:\/(\d+))?$/.exec(name.slice(prefix.length + 3)); if (found && TOKENS.includes(found[1])) return { token: found[1], alpha: found[2] === undefined ? 1 : Number(found[2]) / 100 }; } return undefined; };
  return (mode === 'dark' && pick('dark:')) || pick('');
}
const surface = (element, mode) => paint(element, mode)?.token;
/** CSS specificity [ids, classes+attributes+pseudo-classes, types] of a selector, `:where()` counting nothing. */
function specificity(selector) {
  let rest = selector.replace(/:where\((?:[^()]|\((?:[^()]|\([^()]*\))*\))*\)/g, ''); const attributes = rest.match(/\[[^\]]*\]/g)?.length ?? 0; rest = rest.replace(/\[[^\]]*\]/g, '');
  const types = rest.split(/[\s>+~,]+/).filter(part => /^[a-z]/i.test(part)).length;
  return [rest.match(/#[\w-]+/g)?.length ?? 0, attributes + (rest.match(/\.[\w-]+/g)?.length ?? 0) + (rest.match(/(?<!:):(?!:|where)[a-z-]+/g)?.length ?? 0), types];
}
const outranks = (a, b) => { for (let i = 0; i < 3; i += 1) if (a[i] !== b[i]) return a[i] > b[i]; return true; };
/** The state fills an element's classes carry (`hover:bg-x`, `aria-expanded:bg-x`, `has-[...]:hover:bg-x`...), with an estimate of their specificity: one class, plus one per variant (two for `group-*` and `has-*`). */
function stateFills(element, mode) {
  const found = [];
  for (const name of String(element.getAttribute('class') ?? '').split(/\s+/)) {
    const parts = name.split(/:(?![^\[]*\])/); const variants = parts.slice(0, -1);
    // `has-disabled` is left out: the field is card whenever its Send is disabled (an empty draft), by the designer's spec.
    if (variants.length === 0 || !parts[parts.length - 1].startsWith('bg-') || variants.includes('dark') || variants.includes('has-disabled') || (variants.includes('[a]') && element.tagName !== 'A')) continue;
    found.push({ name, specificity: [0, 1 + variants.reduce((sum, variant) => sum + (/^(group-|has-)/.test(variant) ? 2 : 1), 0), 0] });
  }
  return found;
}
/** The colour seen on an element's box: its fills composited over the ones under it, down to the canvas (--background), in sRGB as the browser paints it. */
function seen(element, mode) {
  const chain = []; for (let up = element; up; up = up.parentElement) { const fill = paint(up, mode); if (fill) chain.unshift(fill); }
  return chain.reduce((under, { token, alpha }) => encoded(value(token, mode)).map((c, i) => alpha * c + (1 - alpha) * under[i]), encoded(value('background', mode)));
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
const approval = { entries: [message(1, { role: 'user', content: 'Tidy the fictional folder', timestamp: 0 }), { id: 2, kind: 'message', byTaskId: 1, model: [assistant([{ type: 'toolCall', id: 'g', name: 'delete_all', arguments: { path: 'fictional/x' } }])] }],
  docs: { 'pi.live': { run: { taskId: 1 }, tools: [{ callId: 'g', details: { 'boring.approval': { summary: 'Delete fictional files?' } } }] } } };
const FEEDBACK_ID = 'fb_' + 'abcdefghjkmnpqrs';
const feedback = { entries: [message(1, { role: 'user', content: 'What did the reviewers say?', timestamp: 0 }),
  { id: 2, kind: 'message', byTaskId: 1, model: [assistant([{ type: 'toolCall', id: 'f1', name: 'feedback', arguments: { action: 'list' } }])] },
  { id: 3, kind: 'message', byTaskId: 1, model: [{ role: 'toolResult', toolCallId: 'f1', toolName: 'feedback', content: [{ type: 'text', text: JSON.stringify({ action: 'list', kind: 'available', items: [{ id: FEEDBACK_ID, title: 'The fictional heading is cut off', status: 'open', author: 'Mira', age: '2d', subject: 'Picnic page', anchors: [] }] }) }], isError: false, timestamp: 2 }, assistant([{ type: 'text', text: 'One note is open.' }])] }], docs: {} };
const artifact = { schema: 'boring.artifact', version: 1, id: 'plan', title: 'Fictional plan', type: 'markdown', mediaType: 'text/markdown', target: { resource: { providerId: 'fictional', path: 'plan.md' }, view: { kind: 'published' } }, revision: 'r1' };
const presented = { entries: [message(1, { role: 'user', content: 'Show the plan', timestamp: 0 }),
  { id: 2, kind: 'message', byTaskId: 1, model: [assistant([{ type: 'toolCall', id: 'p', name: 'present', arguments: { path: 'plan.md' } }])] },
  { id: 3, kind: 'message', byTaskId: 1, model: [{ role: 'toolResult', toolCallId: 'p', toolName: 'present', content: [{ type: 'text', text: JSON.stringify({ 'boring.artifact': true, artifact }) }], isError: false, timestamp: 2 }, assistant([{ type: 'text', text: 'Plan ready.' }])] }], docs: {} };
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
  await build({ stdin: { contents: `export { PiChat } from './pi-chat/pi-chat.tsx'; export { ApprovalCard } from './pi-chat-approval/approval-card.tsx'; export { feedbackRenderTool } from './feedback/feedback-card.tsx'; export { artifactCards } from './pi-artifacts/artifact-card.tsx';`, resolveDir: new URL('../../registry/', import.meta.url).pathname, loader: 'tsx' }, outfile: output.pathname, bundle: true, format: 'esm', platform: 'node', jsx: 'automatic', packages: 'external', loader: { '.css': 'empty' }, plugins: [{ name: 'file-tree-css', setup(builder) { builder.onResolve({ filter: /^@hachej\/boring-ui-kit\/file-tree\.css$/ }, () => ({ path: new URL(import.meta.resolve('@hachej/boring-ui-kit/file-tree.css')).pathname, external: false })); } }] });
  const { PiChat, ApprovalCard, feedbackRenderTool, artifactCards } = await import(output.href);
  const element = document.createElement('div'); document.body.append(element); const root = createRoot(element);
  t.after(async () => {
    await act(async () => root.unmount()); await window.happyDOM.close();
    for (const [name, descriptor] of globals) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; }
  });
  let snapshot, drawn = 0;
  const controller = new Proxy({ getSnapshot: () => snapshot, subscribe: () => () => {} }, { get: (target, key) => key in target ? target[key] : async () => {} });
  const draw = async (view, attachments = [], extra = {}) => {
    snapshot = { identity: {}, conversationId: 'fictional', connection: { kind: 'connected' }, view, draft: { text: '', attachments, version: 0 }, outbox: [], history: { kind: 'disabled' }, send: { kind: 'idle' }, stop: 'idle', disposed: false };
    await act(async () => root.render(createElement(PiChat, { key: drawn++, controller, header: false, mode: 'developer', onFiles: () => {}, mentions: undefined, ...(view === withAttachments ? { attachments: {} } : {}), ...extra })));
    // Open the activity block and then the tool card inside it, so the tool's argument and result blocks are on the page.
    for (let pass = 0; pass < 3; pass += 1) for (const trigger of element.querySelectorAll('[data-slot=trace-collapsible][data-closed] > [data-slot=trace-collapsible-trigger]')) await act(async () => trigger.click());
  };
  const q = selector => element.querySelector(selector), all = selector => [...element.querySelectorAll(selector)];

  /** Every surface under the panel, but the composer field (card on card by design), against the one it sits on. */
  const checkTree = mode => {
    const panel = q('[data-boring=pi-chat]');
    assert.equal(surface(panel, mode), 'card', `${mode}: the panel is --card`);
    assert.equal(surface(panel, mode) === parentSurface(panel, mode), false, `${mode}: the panel differs from the canvas it sits on`);
    // The composer field is card on card by design and must say so in every state, so a reverted rule cannot hide behind a skipped node.
    const field = q('[data-slot=input-group]');
    assert.equal(surface(field, mode), 'card', `${mode}: the composer field is --card`);
    assert.equal(String(field.getAttribute('class')).split(/\s+/).includes('border-input'), true, `${mode}: the composer field has the --input edge`);
    const checked = [];
    for (const node of all('[data-boring=pi-chat] *')) {
      const rule = paints.filter(({ selector }) => node.matches(selector)).pop();
      if (rule) for (const state of stateFills(node, mode)) assert.equal(outranks(specificity(rule.selector), state.specificity), false, `${mode}: the rule ${rule.selector} (${specificity(rule.selector)}) out-ranks the primitive's ${state.name} (${state.specificity}) and would kill it`);
      const token = surface(node, mode); if (!token) continue;
      const under = parentSurface(node, mode), alpha = paint(node, mode).alpha, label = `${mode}: <${node.tagName.toLowerCase()} ${node.dataset.slot ?? node.dataset.testid ?? ''}> ${token}${alpha < 1 ? `/${Math.round(alpha * 100)}` : ''} on ${under}`;
      if (node.dataset.slot === 'input-group') {
        assert.equal(token, 'card', `${label}: the field is --card`);
        assert.equal(String(node.getAttribute('class')).split(/\s+/).includes('border-input'), true, `${label}: told apart by the --input edge`);
        continue;
      }
      // An outline control (the Deny and artifact-card buttons) is told apart by its edge, like the composer field, not by a fill.
      if (node.tagName === 'BUTTON' && /(^|\s)border-(input|border)(\s|$)/.test(String(node.getAttribute('class')))) { checked.push('outline-button'); continue; }
      assert.equal(token === under && alpha === 1, false, `${label}: a surface never equals the one under it`);
      const measured = ratio(seen(node, mode), seen(node.parentElement, mode));
      assert.equal(measured >= MIN, true, `${label}: contrast ${measured.toFixed(3)} is under ${MIN}:1`);
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
    await t.test(`${mode}: approval card and feedback card (Item variant muted, translucent) read as --secondary on the card`, async () => {
      for (const [view, extra, id] of [[approval, { cards: { approval: ApprovalCard }, answer: async () => ({ kind: 'answered' }) }, 'approval-card'], [feedback, { renderTool: feedbackRenderTool() }, 'feedback-item']]) {
        await draw(view, [], extra);
        const card = q(`[data-testid=${id}]`);
        assert.ok(card, `${mode}: the ${id} is drawn`);
        const checked = checkTree(mode);
        assert.equal(checked.includes('item'), true, `${mode}: the ${id} Item was judged`);
        assert.equal(surface(card, mode), 'secondary', `${mode}: the ${id} is --secondary, not a translucent --muted`);
        assert.equal(paint(card, mode).alpha, 1, `${mode}: the ${id} is opaque`);
      }
    });
    for (const open of [false, true]) await t.test(`${mode}: artifact card, ${open ? 'open' : 'closed'}: the thumbnail differs from the card it sits on`, async () => {
      await draw(presented, [], { artifacts: { ...artifactCards, open: () => {}, isOpen: () => open } });
      const card = q('[data-testid=artifact-card]');
      assert.ok(card, `${mode}: the artifact card is drawn`);
      const thumbnail = card.querySelector('[data-slot=item]');
      assert.ok(thumbnail, `${mode}: the thumbnail is drawn`);
      const checked = checkTree(mode);
      assert.equal(checked.includes('item'), true, `${mode}: the thumbnail was judged`);
      assert.equal(card.dataset.open === 'true', open);
      // Open: the card is --secondary, so the thumbnail is --card; closed: the card is --card, so the thumbnail is --secondary.
      assert.equal(surface(thumbnail, mode), open ? 'card' : 'secondary', `${mode}: the thumbnail of the ${open ? 'open' : 'closed'} card`);
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

  await t.test('the specificity estimate: a :where() rule sits between a utility class and its state variant, an attribute chain does not', () => {
    assert.deepEqual(specificity(':where(.pi-chat [data-slot="item"]) button[data-testid="approval-deny"]'), [0, 1, 1]);
    assert.deepEqual(specificity(':where(.pi-chat) button[data-testid="artifact-card"]:where(:not([data-open="true"]))'), [0, 1, 1]);
    assert.deepEqual(specificity('.pi-chat [data-slot="item"][data-variant="muted"] [data-testid="approval-deny"]'), [0, 4, 0]);
    assert.equal(outranks([0, 4, 0], [0, 2, 0]), true); assert.equal(outranks([0, 1, 1], [0, 2, 0]), false); assert.equal(outranks([0, 1, 1], [0, 1, 0]), true);
  });
  await t.test('the contrast function itself: card over canvas and secondary over card pass, a token over itself does not', () => {
    for (const mode of ['light', 'dark']) { assert.equal(contrast('secondary', 'card', mode) >= MIN, true, `${mode} secondary on card`); assert.equal(contrast('card', 'card', mode) >= MIN, false); }
    assert.equal(contrast('muted', 'background', 'light') >= MIN, false, 'the old bubble on the old panel is the failure this test catches');
  });
});
