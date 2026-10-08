// Credits: in the local variant every message is metered (@hachej/boring-agent/metering, examples/studio/server.mjs): it is reserved against the
// person's fictional balance before it reaches the conversation and charged its usage when it ends. An exhausted balance refuses the next
// message with the ledger's own words, and the model is never called. Admission is model-aware: with a low balance the fictional
// premium model (which holds more) is refused with the reason while the default model still answers. The scenario tops the balance
// back up at the end.
import assert from 'node:assert/strict';

const credits = async t => (await t.api('/api/credits')).json();
const setCredits = (t, body = {}) => t.api('/api/credits', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
/** Chooses a model in the composer's picker, as a person does, and waits until the conversation is configured. */
async function chooseModel(t, modelId, label) {
  await t.browser.click(t.q('[data-testid=composer-model]'));
  await t.browser.until('the model menu', `${t.qa('[data-testid=composer-model-option]')}.some(e => e.dataset.value.endsWith(${JSON.stringify(`/${modelId}`)}))`, 5000);
  await t.browser.click(`${t.qa('[data-testid=composer-model-option]')}.find(e => e.dataset.value.endsWith(${JSON.stringify(`/${modelId}`)}))`);
  await t.browser.until(`${label} is selected`, `${t.q('[data-testid=composer-model-label]')}?.textContent.startsWith(${JSON.stringify(label)}) && !${t.q('[data-testid=composer-model]')}.disabled`, 10000);
}
let before, spent, low;

export default {
  id: 'chat-credits', group: 'Chat basics', title: 'Spend credits until refused', variants: ['local'],
  description: 'Messages spend fictional credits; when they run out the next message is refused with a clear notice, and a low balance refuses the premium model only.',
  steps: [
    { async run(t) { before = await credits(t); assert.ok(before.availableMicros > before.holdMicros, 'the scenario starts with credits'); } },
    { prompt: 'Reply with exactly: CREDITS-ONE' },
    { async run(t) {
      spent = await credits(t);
      assert.ok(spent.balanceMicros < before.balanceMicros, `the message was charged (${before.balanceMicros} -> ${spent.balanceMicros})`);
      assert.equal(spent.heldMicros, 0, 'nothing is held once the message is answered');
    } },
    // The scripted model reports a billion input tokens for this turn: more than the whole fictional balance.
    { prompt: 'Spend all my credits: reply with exactly: CREDITS-DRAINED' },
    { async run(t) {
      try {
        const drained = await credits(t);
        assert.ok(drained.availableMicros < drained.holdMicros, `the balance is exhausted (${drained.availableMicros})`);
        const users = await t.browser.evaluate(`${t.userMessages}.length`);
        await t.say('Reply with exactly: CREDITS-REFUSED');
        await t.browser.until('the refusal is shown', `/Not enough credits/.test(${t.q('[data-testid=send-blocked]')}?.textContent ?? '')`, 20000);
        await t.pause(1000);
        assert.equal(await t.browser.evaluate(`${t.userMessages}.length`), users, 'the refused message never reached the conversation');
        assert.equal(await t.browser.evaluate(t.idle), true, 'nothing runs');
        await t.shots?.('chatui-credits-refused');
      } finally {
        await setCredits(t);
        await t.clear();
      }
    } },
    // A low balance: enough for the default model's hold, not for the premium model's. Choosing premium refuses the message with the
    // reason before it reaches the conversation (the ledger saw the model the run would use).
    { async run(t) {
      await setCredits(t, { balanceMicros: 1_000_000 });
      low = await credits(t);
      assert.ok(low.availableMicros >= low.holdMicros && low.availableMicros < low.premiumHoldMicros, `a low balance (${low.availableMicros})`);
      try {
        await chooseModel(t, 'premium', 'Premium (fictional)');
        const users = await t.browser.evaluate(`${t.userMessages}.length`);
        await t.say('Reply with exactly: CREDITS-PREMIUM');
        await t.browser.until('the premium refusal is shown', `/Not enough credits for the premium model/.test(${t.q('[data-testid=send-blocked]')}?.textContent ?? '')`, 20000);
        await t.pause(1000);
        assert.equal(await t.browser.evaluate(`${t.userMessages}.length`), users, 'the refused message never reached the conversation');
        assert.equal(await t.browser.evaluate(t.idle), true, 'nothing runs');
        await t.shots?.('chatui-credits-premium-refused');
      } finally {
        await t.clear();
        await chooseModel(t, 'gpt-5-mini', 'GPT-5 mini');
      }
    } },
    // Back on the default model, the same low balance still admits the message.
    { prompt: 'Reply with exactly: CREDITS-DEFAULT' },
    { async run(t) {
      try {
        const after = await credits(t);
        assert.ok(after.balanceMicros < low.balanceMicros, `the default model's message was admitted and charged (${low.balanceMicros} -> ${after.balanceMicros})`);
        assert.equal(after.heldMicros, 0, 'nothing is held once the message is answered');
      } finally {
        await setCredits(t);
      }
    } },
  ],
  script: { 3: [{ text: 'CREDITS-DRAINED', usage: { input: 1_000_000_000, output: 1 } }] },
  expect: [{ reply: /CREDITS-ONE/ }, { reply: /CREDITS-DRAINED/ }, { replyNot: /CREDITS-REFUSED/ }, { replyNot: /CREDITS-PREMIUM/ }, { reply: /CREDITS-DEFAULT/ }],
};
