// D-1744: the approval and question cards at phone width, the real components rendered in happy-dom. Happy-dom measures nothing, so this
// asserts the classes that make the layout (the card is a container; below `md` of its own width the decision row is a full-width row
// of 44px buttons under the text; code wraps at word breaks, not anywhere). That the text is not squeezed and nothing overflows at 390
// is shown by the screenshots in the PR (evidence/d-1744), not here. Fictional text only.
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync } from 'node:fs';
import { build } from 'esbuild';
import { Window } from 'happy-dom';

const tokens = element => String(element?.getAttribute('class') ?? '').split(/\s+/).filter(Boolean);
const has = (element, name) => tokens(element).includes(name);

test('approval and question cards stack text over a full-width 44px decision row in a narrow container', { timeout: 60000 }, async t => {
  const window = new Window({ url: 'https://fictional.invalid/' });
  const names = ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Text', 'MutationObserver', 'ResizeObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'matchMedia', 'IS_REACT_ACT_ENVIRONMENT'];
  const globals = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  for (const name of names) {
    const given = name === 'window' ? window : name === 'IS_REACT_ACT_ENVIRONMENT' ? true : window[name];
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: typeof given === 'function' && /^[a-z]/.test(name) ? given.bind(window) : given });
  }
  const { createElement, act } = await import('react'); const { createRoot } = await import('react-dom/client');
  const out = new URL('../../.cache/approval-card-phone/', import.meta.url); mkdirSync(out, { recursive: true });
  const output = new URL('cards.mjs', out);
  await build({ stdin: { contents: `export { ApprovalCard } from './pi-chat-approval/approval-card.tsx'; export { QuestionCard } from './pi-chat-question/question-card.tsx';`, resolveDir: new URL('../../registry/', import.meta.url).pathname, loader: 'tsx' }, outfile: output.pathname, bundle: true, format: 'esm', platform: 'node', jsx: 'automatic', packages: 'external', loader: { '.css': 'empty' } });
  const { ApprovalCard, QuestionCard } = await import(output.href);
  const element = document.createElement('div'); document.body.append(element); const root = createRoot(element);
  t.after(async () => {
    await act(async () => root.unmount()); await window.happyDOM.close();
    for (const [name, descriptor] of globals) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; }
  });
  const answer = async () => ({ kind: 'answered' });
  const draw = async view => { await act(async () => root.render(view)); };
  const call = (name, args) => ({ type: 'toolCall', id: 'fictional-1', name, arguments: args });
  const command = 'delete_all --scope archive-2019 --confirm';

  for (const summary of ['Remove every archived record from the fictional records store, including the ones that other people are still reading', undefined]) {
    await draw(createElement(ApprovalCard, { call: call('delete_all', { command, scope: 'archive-2019' }), answer, questionId: 'q1', summary }));
    const card = element.querySelector('[data-testid=approval-card]');
    assert.ok(card, 'the approval card is rendered');
    assert.equal(has(card, '@container'), true, 'the card is the container its rows answer to');
    const actions = card.querySelector('[data-slot=item-actions]');
    assert.equal(has(actions, '@max-md:basis-full') && has(actions, '@max-md:w-full'), true, 'in a narrow card the decision row is a full-width row of its own');
    const buttons = [...actions.querySelectorAll('button')];
    assert.equal(buttons.length, 2, 'Approve and Deny');
    for (const button of buttons) assert.equal(has(button, '@max-md:min-h-11') && has(button, '@max-md:flex-1'), true, 'each decision button is 44px high and shares the row');
    // The text never breaks anywhere: long words wrap only when they cannot fit a line of their own.
    const wrapped = [...card.querySelectorAll('[data-testid=approval-summary],[data-testid=approval-tool],[data-testid=approval-args] dd')];
    assert.ok(wrapped.length >= 2, 'tool line and argument values are present');
    for (const text of wrapped) assert.equal(tokens(text).some(name => name.includes('overflow-wrap:anywhere')), false, 'no mid-word break: ' + text.getAttribute('data-testid'));
    for (const text of wrapped) assert.equal(has(text, 'break-words'), true, 'long words still wrap: ' + text.getAttribute('data-testid'));
    const dd = card.querySelector('dd');
    assert.equal(has(dd, 'font-mono') && has(dd, 'whitespace-pre-wrap'), true, 'the command is a wrapping mono block');
    assert.equal(has(card.querySelector('dl'), '@max-md:grid-cols-1'), true, 'name over value in a narrow card, so the command has the full width');
    if (summary) { const details = card.querySelector('[data-testid=approval-details]'); assert.equal(details?.tagName, 'DETAILS', 'Arguments stays a plain disclosure'); assert.equal(details.querySelector('summary')?.textContent, 'Arguments'); }
  }

  await draw(createElement(QuestionCard, { call: call('ask_user', { question: 'Which fictional archive should be cleaned first?', questions: [{ question: 'Which archive?', options: ['archive-2019', 'archive-2020'] }] }), answer, questionId: 'q2' }));
  const form = element.querySelector('[data-testid=question-card]');
  assert.ok(form?.querySelector('[data-testid=question-form]'), 'the form card is rendered');
  assert.equal(has(form, '@container'), true, 'the form card is a container');
  for (const option of form.querySelectorAll('[data-testid=question-option]')) assert.equal(has(option, '@max-md:min-h-11'), true, 'each option is 44px high in a narrow card');
  const submit = form.querySelector('[data-testid=question-submit]');
  assert.equal(has(submit, '@max-md:w-full') && has(submit, '@max-md:min-h-11'), true, 'Answer is a full-width 44px button in a narrow card');
});
