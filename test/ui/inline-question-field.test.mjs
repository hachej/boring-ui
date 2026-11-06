// D-1732: InlineQuestion's free-text answer is one box: the field with the send as a trailing icon button inside it (the kit's InputGroup),
// the real component rendered in happy-dom. And the field's edge is the one the multi-question form's fields have (same --input edge,
// same --card fill). Layout and the 44px target are shown by the screenshots in the PR (evidence/d-1744), not here. Fictional text only.
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync } from 'node:fs';
import { build } from 'esbuild';
import { Window } from 'happy-dom';

const tokens = element => String(element?.getAttribute('class') ?? '').split(/\s+/).filter(Boolean);
const has = (element, name) => tokens(element).includes(name);

test('InlineQuestion free text is one input group with a trailing Answer icon button', { timeout: 60000 }, async t => {
  const window = new Window({ url: 'https://fictional.invalid/' });
  const names = ['window', 'document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'Element', 'Node', 'Text', 'MutationObserver', 'ResizeObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'matchMedia', 'KeyboardEvent', 'Event', 'IS_REACT_ACT_ENVIRONMENT'];
  const globals = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  for (const name of names) {
    const given = name === 'window' ? window : name === 'IS_REACT_ACT_ENVIRONMENT' ? true : window[name];
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: typeof given === 'function' && /^[a-z]/.test(name) ? given.bind(window) : given });
  }
  const { createElement, act } = await import('react'); const { createRoot } = await import('react-dom/client');
  const out = new URL('../../.cache/inline-question-field/', import.meta.url); mkdirSync(out, { recursive: true });
  const output = new URL('cards.mjs', out);
  await build({ stdin: { contents: `export { InlineQuestion } from './inline-question/inline-question.tsx'; export { QuestionCard } from './pi-chat-question/question-card.tsx';`, resolveDir: new URL('../../registry/', import.meta.url).pathname, loader: 'tsx' }, outfile: output.pathname, bundle: true, format: 'esm', platform: 'node', jsx: 'automatic', packages: 'external', loader: { '.css': 'empty' } });
  const { InlineQuestion, QuestionCard } = await import(output.href);
  const element = document.createElement('div'); document.body.append(element); const root = createRoot(element);
  t.after(async () => {
    await act(async () => root.unmount()); await window.happyDOM.close();
    for (const [name, descriptor] of globals) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; }
  });
  const answers = [];
  const draw = async view => { await act(async () => root.render(view)); };
  const type = async (input, value) => { await act(async () => { Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(input, value); input.dispatchEvent(new window.Event('input', { bubbles: true })); }); };
  const base = { id: 'q1', kind: 'question', text: 'Which fictional archive should be cleaned first?', onAnswer: (id, value) => answers.push([id, value]) };

  await draw(createElement(InlineQuestion, { ...base, options: ['archive-2019', 'archive-2020'] }));
  let input = element.querySelector('[data-testid=question-input]');
  const group = input?.closest('[data-slot=input-group]');
  assert.ok(group, 'the field sits in an InputGroup');
  const button = group.querySelector('button');
  assert.ok(button, 'the send button is inside the same group as the field');
  assert.equal(element.querySelectorAll('[data-slot=input-group]').length, 1, 'one box');
  assert.equal(button.getAttribute('aria-label'), 'Answer', 'the button is named Answer, not Send');
  assert.equal(button.textContent.trim(), '', 'an icon button: no visible text');
  assert.equal(button.querySelector('svg') !== null, true, 'with an arrow icon');
  assert.equal(button.disabled, true, 'disabled until there is text');
  assert.equal(input.getAttribute('placeholder'), 'Or type an answer', 'with options');
  assert.equal(has(input, 'text-base') && has(input, 'md:text-sm'), true, '16px on a phone (iOS zooms under 16px), 14px on a computer');

  await type(input, '  archive-2018  ');
  await act(async () => { const ime = new window.KeyboardEvent('keydown', { key: 'Enter', keyCode: 229, bubbles: true, cancelable: true }); input.dispatchEvent(ime); });
  assert.equal(answers.length, 0, 'an Enter with keyCode 229 (IME candidate) does not send');
  assert.equal(button.disabled, false, 'enabled once there is text');
  await act(async () => { input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); });
  assert.equal(JSON.stringify(answers), JSON.stringify([['q1', 'archive-2018']]), 'Enter sends the trimmed text');

  await draw(createElement(InlineQuestion, { ...base, key: 'none' }));
  input = element.querySelector('[data-testid=question-input]');
  assert.equal(input.getAttribute('placeholder'), 'Type your answer', 'with no options');
  await type(input, 'archive-2017');
  await act(async () => { input.closest('[data-slot=input-group]').querySelector('button').click(); });
  assert.equal(answers.length, 2, 'the button sends too');
  assert.equal(answers[1][1], 'archive-2017');

  // The same edge as the form's fields: the form's Input draws `border-input` on `bg-card` itself; the group must draw the same edge and fill.
  const fieldGroup = element.querySelector('[data-slot=input-group]');
  const wrap = fieldGroup.closest('form');
  assert.equal(has(fieldGroup, 'border-input') && has(wrap, '[&_[data-slot=input-group]]:bg-card'), true, 'the single field has the --input edge (the primitive\'s own) on --card (set by the form, not by restyling the primitive)');
  assert.equal(has(wrap, 'dark:[&_[data-slot=input-group]]:bg-card'), true, 'dark fill is --card too (the group\'s own dark:bg-input/30 would be translucent)');
  assert.equal(has(wrap, 'pointer-coarse:[&_[data-slot=input-group]]:h-11') && has(wrap, 'pointer-coarse:[&_button]:size-11') && has(wrap, 'pointer-coarse:[&_button]:-my-px') && has(wrap, 'pointer-coarse:[&_[data-slot=input-group-addon]]:py-0'), true, 'a coarse pointer at md+ fits the group to the 44px button');
  assert.equal(has(wrap, 'max-md:[&_[data-slot=input-group]]:h-11') && has(wrap, 'max-md:[&_button]:size-11'), true, '44px group and button at touch');
  assert.equal(tokens(fieldGroup).some(name => /^(dark:)?border-(?!input$)[a-z]/.test(name) && !name.startsWith('border-b') && !name.startsWith('border-t') && !name.startsWith('border-l') && !name.startsWith('border-r')), false, 'and no other edge colour');
  await draw(createElement(QuestionCard, { call: { type: 'toolCall', id: 'c', name: 'ask_user', arguments: { question: 'Two questions', questions: [{ question: 'Which?', options: ['a', 'b'] }] } }, answer: async () => ({ kind: 'answered' }), questionId: 'q' }));
  const formInput = element.querySelector('[data-testid=question-input]');
  assert.equal(has(formInput, 'border-input'), true, 'the form field draws the same --input edge (its fill is the primitive\'s own)');
  assert.equal(element.querySelector('[data-slot=input-group]'), null, 'the form keeps a plain field and its own full-width Answer');
  assert.ok(element.querySelector('[data-testid=question-submit]'), 'and its Answer below the questions');
});
