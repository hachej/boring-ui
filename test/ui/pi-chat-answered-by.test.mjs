// Developer mode's « answered by » line of PiChat (registry/pi-chat/message.tsx) in happy-dom, D-1222: the host's per-turn `answeredBy`
// first, else the reply's own message provider/model, « fallback: reason » only with a fallback, no line without model info, never on a
// user message, and expert mode unchanged. Fictional French text only.
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync } from 'node:fs';
import { build } from 'esbuild';
import { Window } from 'happy-dom';

const names = ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Text', 'DOMParser', 'MutationObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'ResizeObserver', 'matchMedia', 'IS_REACT_ACT_ENVIRONMENT'];
const at = minutes => Date.parse('2026-10-25T14:00:00Z') + minutes * 60_000;
const user = (key, text, minutes) => ({ key, type: 'user', message: { role: 'user', content: text, timestamp: at(minutes) } });
const reply = (key, text, minutes, model) => ({ key, type: 'assistant', parts: [{ kind: 'text', key: `${key}:t`, text }], streaming: false, text, timestamp: at(minutes), ...(model ? { model } : {}) });
const records = {
  a1: { provider: 'anthropic', model: 'claude-sonnet-4-5' },
  a2: { provider: 'workers-ai', model: 'llama-3.3-70b', fallback: 'hub_llm_off' },
};
const rows = [
  user('u1', 'Bonjour Max, que manger avant la séance ?', 0),
  reply('a1', 'Une banane, deux heures avant.', 1, { provider: 'openai', modelId: 'gpt-5' }),
  reply('a2', 'Bois aussi de l’eau.', 2, { provider: 'anthropic', modelId: 'claude-sonnet-4-5' }),
  reply('a3', 'Et du riz après.', 3, { provider: 'openai', modelId: 'gpt-5-mini' }),
  reply('a4', 'Bonne séance.', 4),
];

test('answered by: developer mode names the model under each reply; expert mode is unchanged', async t => {
  const window = new Window({ url: 'https://fictional.invalid/' });
  const globals = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  for (const name of names) {
    const value = name === 'IS_REACT_ACT_ENVIRONMENT' ? true : window[name];
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: typeof value === 'function' && /^[a-z]/.test(name) ? value.bind(window) : value });
  }
  const { createElement, act } = await import('react'); const { createRoot } = await import('react-dom/client');
  const out = new URL('../../.cache/pi-chat-answered-by-test/', import.meta.url); mkdirSync(out, { recursive: true });
  const output = new URL('message.mjs', out);
  await build({ entryPoints: [new URL('../../registry/pi-chat/message.tsx', import.meta.url).pathname], outfile: output.pathname, bundle: true, format: 'esm', platform: 'node', jsx: 'automatic', packages: 'external', tsconfig: new URL('../../tsconfig.json', import.meta.url).pathname, logLevel: 'silent' });
  const { RowView } = await import(output.href);
  const host = window.document.createElement('div'); window.document.body.append(host); const root = createRoot(host);
  t.after(async () => { await act(async () => root.unmount()); await window.happyDOM.close(); for (const [name, descriptor] of globals) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; } });
  const answeredBy = reply => records[reply.key];
  const context = (developer, extra) => ({ developer, groupTool: undefined, commandMentions: undefined, onOpenImage: undefined, onCopy: undefined, pieces: undefined, answer: undefined, artifacts: undefined, ...extra });
  const draw = async (list, developer, extra = {}) => { await act(async () => root.render(createElement('div', null, list.map(row => createElement(RowView, { key: row.key, row, context: context(developer, extra) }))))); };
  const line = id => host.querySelector(`[data-row-id=${id}] [data-testid=answered-by]`);

  await t.test('normal: the host record names the model, over the message own model', async () => {
    await draw(rows, true, { answeredBy });
    assert.equal(line('a1')?.textContent, 'answered by anthropic/claude-sonnet-4-5');
    assert.equal(line('a1').querySelector('[data-testid=answered-fallback]'), null, 'no fallback, no fallback text');
    assert.match(line('a1').className, /\btext-xs\b/); assert.match(line('a1').className, /\btext-muted-foreground\b/);
    assert.doesNotMatch(host.innerHTML, /#[0-9a-f]{3,8}\b|rgb\(|oklch\(|hsl\(/i, 'tokens only: no raw colour in the markup');
  });

  await t.test('fallback: the reason follows the model', async () => {
    await draw(rows, true, { answeredBy });
    assert.equal(line('a2')?.querySelector('[data-testid=answered-fallback]')?.textContent, ' · fallback: hub_llm_off');
    assert.match(line('a2').textContent, /^answered by workers-ai\/llama-3\.3-70b · fallback: hub_llm_off$/);
  });

  await t.test('missing data: no record falls back to the message provider/model; no model info shows no line', async () => {
    await draw(rows, true, { answeredBy });
    assert.equal(line('a3')?.textContent, 'answered by openai/gpt-5-mini');
    assert.equal(line('a4'), null);
    await draw(rows, true);
    assert.equal(line('a1')?.textContent, 'answered by openai/gpt-5', 'without the prop, the message own model');
    assert.equal(line('a4'), null);
    assert.equal(host.querySelectorAll('[data-testid=answered-by]').length, 3);
  });

  await t.test('a user message never shows the line', async () => {
    await draw(rows, true, { answeredBy: () => records.a2 });
    assert.equal(line('u1'), null);
    assert.equal(host.querySelectorAll('[data-role=user] [data-testid=answered-by]').length, 0);
  });

  await t.test('expert mode renders exactly as before', async () => {
    const bare = rows.map(row => row.type === 'assistant' ? { ...row, model: undefined } : row);
    await draw(bare, false);
    const before = host.innerHTML;
    await draw(rows, false, { answeredBy });
    assert.equal(host.querySelectorAll('[data-testid=answered-by]').length, 0);
    assert.equal(host.innerHTML, before);
  });
});
