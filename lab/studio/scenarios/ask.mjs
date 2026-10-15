// Human in the loop: the agent pauses on a native ask_user tool call until the person answers in the chat.
import assert from 'node:assert/strict';

export default {
  id: 'ask-picnic', smoke: true, group: 'Ask the user', title: 'Plan a picnic by asking', description: 'The agent asks you to choose among options, then for a free-text note, and continues with your answers.',
  steps: [{
    prompt: 'Plan a small fictional picnic for me. Before the plan, call ask_user twice, one call at a time: first let me choose the location from exactly three short options, then ask for any dietary note with allowFreeText true and no options. Do not give the plan before both answers are in; then give a short plan that uses both.',
    // The first question is answered by choosing its second option; the second by typing.
    answers: ['option:1', 'no nuts please'],
  }],
  // The arguments stream in chunks as a real provider's do, so the card is on screen while its options are still being written.
  script: { 0: [
    { tools: [{ name: 'ask_user', args: { question: 'Where should the picnic be?', options: ['By the lake', 'In the park', 'On the hill'] }, ms: 120 }] },
    { tools: [{ name: 'ask_user', args: { question: 'Any dietary note?', allowFreeText: true }, ms: 120 }] },
    ctx => `Plan: meet ${ctx.results[0].json.answer.toLowerCase()} at noon with a blanket and snacks. Noted: ${ctx.results[1].json.answer}, so every snack is nut free.`,
  ] },
  expect: [{ question: { answered: 2 } }, { toolCalled: 'ask_user' }, { reply: /nut/i }],
  async verify(t) {
    const { browser, q, qa } = t;
    assert.equal(t.answered.length, 2, 'both questions were answered by the person');
    const [choice] = t.answered;
    assert.ok(await browser.evaluate(`${qa('[data-testid=question-answer]')}.map(e => e.textContent).includes(${JSON.stringify('no nuts please')})`), 'the free-text answer is shown on its card');
    assert.ok(await browser.evaluate(`${qa('[data-testid=question-answer]')}.map(e => e.textContent).includes(${JSON.stringify(choice)})`), 'the chosen option is shown on its card');
    assert.ok(new RegExp(choice.split(/\s+/)[0], 'i').test(await t.assistantText()), 'the plan uses the chosen option');
    void q;
  },
};
