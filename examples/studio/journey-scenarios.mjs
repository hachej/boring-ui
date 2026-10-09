// Executes scenario files (./scenarios/*.mjs) through the real UI, the way a person would: click the scenario in the empty chat,
// type or use the suggested next step, attach files with the paperclip, answer questions, press Stop. Then the declarative
// `expect` checks, then the scenario's own `verify(t)` if it has one. Works against the studio and against a remote deployment.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { q, qa, pause } from '@hachej/boring-testing/browser';
import { unavailableReason } from './scenario-availability.mjs';

const CARDS = '[data-testid=artifact-card][data-state=ready]';
const PANEL = '[data-testid=artifact-panel]';

/** The scenarios a run covers: the selected variant offers what they require (or the run is told to include them anyway). */
export function applicable(scenario, variant) {
  return unavailableReason(scenario, variant) === null;
}

async function waitSettled(t, answers, { timeout = 300000 } = {}) {
  const { browser } = t;
  const queue = [...answers];
  const deadline = Date.now() + timeout;
  for (;;) {
    const state = await browser.evaluate(`({ idle: ${t.idle}, pending: ${qa('[data-testid=question-card][data-state=pending], [data-testid=approval-card][data-state=pending]')}.length })`);
    if (state.pending && queue.length) {
      assert.equal(await browser.evaluate(`${t.SUBMIT}.dataset.state`), 'stop', 'the run is waiting on the person');
      if (!t.answered.length) await browser.screenshot('chatui-question.png');
      const answer = queue.shift();
      const pending = `${qa('[data-testid=question-card][data-state=pending], [data-testid=approval-card][data-state=pending]')}.length`;
      const before = await browser.evaluate(pending);
      if (answer === 'approve' || answer === 'deny') {
        // An approval card (requireApproval): its own Approve or Deny button.
        t.answered.push(answer);
        const decide = q(`[data-testid=approval-card][data-state=pending] [data-testid=approval-${answer}]`);
        await browser.until('the approval can be answered', `${decide} && !${decide}.disabled`, 30000);
        await browser.click(decide);
        await browser.until('the approval was sent', `${pending} < ${before}`, 30000);
        continue;
      }
      // A pending card is the finished call (a card the model is still writing is `writing`). What it offers is the model's choice:
      // too few options or no free-text field is a model miss, reported as such rather than as a UI failure.
      const card = q('[data-testid=question-card][data-state=pending]');
      if (/^option:\d+$/.test(answer)) {
        const index = Number(answer.slice(7));
        const offered = await browser.evaluate(`[...${card}.querySelectorAll('[data-testid=question-option]')].map(e => e.dataset.option)`);
        assert.ok(index < offered.length, `model miss: ask_user offered ${offered.length} option(s) ${JSON.stringify(offered)}; the scenario answers option ${index}`);
        t.answered.push(offered[index]);
        await browser.click(`${card}.querySelectorAll('[data-testid=question-option]')[${index}]`);
      } else {
        assert.ok(await browser.evaluate(`!!${card}.querySelector('[data-testid=question-input]')`), `model miss: ask_user did not allow a free-text answer (question: ${await browser.evaluate(`${card}.querySelector('[data-testid=question-text]')?.textContent`)})`);
        t.answered.push(answer);
        await browser.type(q('[data-testid=question-card][data-state=pending] [data-testid=question-input]'), answer);
        await browser.click(q('[data-testid=question-card][data-state=pending] [data-testid=question-submit]'));
      }
      await browser.until('the card shows the answer', `${pending} < ${before} || ${qa('[data-testid=question-answer]')}.some(e => e.textContent === ${JSON.stringify(t.answered.at(-1))})`, 30000);
      continue;
    }
    if (state.idle && !state.pending) return;
    assert.ok(Date.now() < deadline, `the agent did not settle within ${Math.round(timeout / 1000)} s (pending questions: ${state.pending}, answers left: ${queue.length})`);
    await pause(250);
  }
}

async function userCount(t) { return t.browser.evaluate(`${t.userMessages}.length`); }

/** Attaches an upload step's file with the composer's file input and waits for the chip. */
async function attach(t, upload) {
  const directory = resolve('.cache/evidence/scenario-fixtures'); mkdirSync(directory, { recursive: true });
  const file = `${directory}/${upload.name}`;
  writeFileSync(file, typeof upload.content === 'string' ? upload.content : Buffer.from(upload.content));
  await t.browser.attachFiles(q('[data-testid=composer-file]'), [file]);
  if (upload.mimeType?.startsWith('image/')) { await t.browser.until('the image is attached', `${qa('[data-testid=attachment]')}.length === 1`, 20000); return; }
  const escape = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const extension = /(\.[^.]*)?$/.exec(upload.name)[0], stem = upload.name.slice(0, upload.name.length - extension.length);
  const pattern = `^uploads/${escape(stem)}(-\\d+)?${escape(extension)}$`;
  await t.browser.until('the upload became a mention chip', `new RegExp(${JSON.stringify(pattern)}).test(${q('[data-testid=mention-chip]')}?.dataset.path ?? '')`, 20000);
}

const ACTIONS = {
  /** Waits until the agent is visibly working with a long answer under way. */
  streaming: async t => { const before = await t.browser.evaluate(`${t.logText}.length`); await t.browser.until('an answer is streaming', `${t.logText}.length > ${before + 300} && !(${t.idle})`, 120000); },
  idle: async t => { await t.browser.until('idle', t.idle, 300000); },
  /** Stop: the one primary button; the chat is idle again and no more text arrives. */
  stop: async t => {
    await t.browser.click(t.button('Stop'));
    await t.browser.until('back to Send', t.idle, 30000);
    const stoppedAt = await t.browser.evaluate(`${t.logText}.length`);
    await pause(2500);
    assert.equal(await t.browser.evaluate(`${t.logText}.length`), stoppedAt, 'no text arrives after stop');
  },
  reload: async t => {
    await t.reload();
    await t.browser.until('conversation restored after reload', `${t.logText}.length > 0`, 60000);
  },
  restart: async t => {
    await t.restartHost();
    await t.reload();
    await t.browser.until('the transcript is back', `${t.logText}.length > 0`, 60000);
  },
  openPanel: async t => { await t.openPanel(); },
  closePanel: async t => { await t.closePanel(); },
};

async function runStep(t, scenario, step, at, state) {
  const { browser } = t;
  if (step.run) return void await step.run(t);
  if (step.action) return void await ACTIONS[step.action](t);
  const before = await userCount(t);
  const first = at === scenario.steps.findIndex(item => item.prompt);
  const plain = !step.mention && !step.upload;
  if (first) {
    await browser.until('the scenario is in the list', `!!${q(`[data-testid=scenario][data-scenario=${scenario.id}]`)}`, 30000);
    await t.press(q(`[data-testid=scenario][data-scenario=${scenario.id}]`));
    state.started = true;
    if (plain) await browser.until('the prompt was sent', `${t.userMessages}.length > ${before}`, 30000);
    else if (step.mention) {
      await browser.until('the composer is filled with the mention and the prompt', `${t.MESSAGE}.value === ${JSON.stringify(`@${step.mention} ${step.prompt}`)}`, 15000);
      await t.press(t.button('Send'));
    }
  } else if (state.started) {
    // The next step is suggested one tap away; use it like a person would.
    await browser.until('the next step is suggested', `${q('[data-testid=scenario-next] [data-testid=scenario-use]')}?.textContent.includes(${JSON.stringify(step.prompt.slice(0, 40))})`, 20000);
    if (step.upload) await attach(t, step.upload);
    await t.press(q('[data-testid=scenario-use]'));
    await browser.until('the composer holds the step', step.upload ? `${t.MESSAGE}.value.endsWith(${JSON.stringify(step.prompt)})` : `${t.MESSAGE}.value === ${JSON.stringify(step.mention ? `@${step.mention} ${step.prompt}` : step.prompt)}`, 10000);
    await t.press(t.button('Send'));
  }
  if (step.upload && first) {
    // The scenario waits for the person to attach the file; the suggested prompt follows.
    await attach(t, step.upload);
    await t.press(q('[data-testid=scenario-use]'));
    await browser.until('the composer holds the prompt after the mention', `${t.MESSAGE}.value.endsWith(${JSON.stringify(step.prompt)}) && (${JSON.stringify(Boolean(step.upload.mimeType?.startsWith('image/')))} || ${t.MESSAGE}.value.startsWith('@uploads/'))`, 10000)
      .catch(async error => { throw new Error(`${error.message.split('\n')[0]}; composer: ${JSON.stringify(await browser.evaluate(`${t.MESSAGE}.value`))}`); });
    await t.press(t.button('Send'));
  }
  await browser.until('the message was sent', `${t.userMessages}.length > ${before}`, 30000);
  if (step.wait !== false) await waitSettled(t, step.answers ?? []);
}

/**
 * Runs one scenario on the shown variant: a fresh conversation, the steps, the declarative checks, then `verify`. The studio journey passes `retries: 0` in the
 * scripted layer (a failure there is a bug); other callers (the Cloudflare journey) keep the `STUDIO_RETRIES` default of 1. Against a real model, which sometimes answers in text where a tool call was asked for, the
 * caller allows a retry in a new conversation (the first failure is printed); a scenario that fails every time is a real failure.
 */
export async function runScenario(t, scenario, variant, expectations, { retries = Number(process.env.STUDIO_RETRIES ?? 1) } = {}) {
  for (let attempt = 0; ; attempt++) {
    try { return await runOnce(t, scenario, variant, expectations); }
    catch (error) {
      if (attempt >= retries) throw error;
      console.log(`retry ${scenario.id} (${variant.id}) after: ${String(error.message).split('\n')[0].slice(0, 200)}`);
    }
  }
}

async function runOnce(t, scenario, variant, expectations) {
  await t.step(`${scenario.id} (${variant.id}): ${scenario.title}`, async () => {
    if (scenario.viewport) await t.device(scenario.viewport);
    t.answered = [];
    try {
      await t.fresh();
      await t.browser.until('the scenario list', `!!${q('[data-testid=scenario-list]')}`, 20000);
      const listed = await t.browser.evaluate(`(${qa(`[data-testid=scenario][data-scenario=${scenario.id}]`)})[0]?.dataset.available`);
      assert.equal(listed, 'true', `${scenario.id} is listed as available on ${variant.id}`);
      const state = { started: false };
      if (scenario.steps.every(step => !step.prompt)) {
        await t.press(q(`[data-testid=scenario][data-scenario=${scenario.id}]`));
        state.started = true;
        await t.browser.until('the workspace panel opens', `!!${t.WORKSPACE}`, 20000);
      }
      for (const [at, step] of scenario.steps.entries()) await runStep(t, scenario, step, at, state);
      for (const expectation of scenario.expect ?? []) await expectations(t, expectation, scenario);
      if (scenario.verify) await scenario.verify(t, { scenario, variant });
      await t.browser.screenshot(`scenario-${scenario.id}-${variant.id}.png`);
    } finally {
      if (scenario.viewport) { await t.device('desktop'); await t.reload(); }
    }
  });
}

/** One declarative check. Anything the page cannot show is read from the native conversation when the studio runs in this process. */
export async function expectations(t, expectation, scenario) {
  const [kind] = Object.keys(expectation);
  const value = expectation[kind];
  const label = `${scenario.id}: expect ${kind}`;
  switch (kind) {
    case 'reply': assert.match(await t.assistantText(), value, `${label} ${value}`); break;
    case 'replyNumbers': {
      // Digits only: "1,234" and "1 234" both read as 1234.
      const text = (await t.assistantText()).replace(/(\d)[,\u202f\u00a0 ](?=\d{3}\b)/g, '$1');
      for (const number of value) assert.ok(new RegExp(`(^|[^\\d.])${number}(?![\\d])`).test(text), `${label} ${number} in: ${text.slice(0, 400)}`);
      break;
    }
    case 'toolResult': {
      // The real output of a tool call, from the native messages (the page shows tool results collapsed).
      const text = (await t.messages()).filter(message => message.role === 'toolResult').map(message => message.content.map(part => part.text ?? '').join('')).join('\n');
      assert.match(text, value, `${label} ${value}`);
      break;
    }
    case 'replyNot': assert.doesNotMatch(await t.assistantText(), value, `${label} ${value}`); break;
    case 'noToolCalls': assert.deepEqual(await t.toolNames(), [], label); break;
    case 'toolCalled': assert.ok((await t.toolNames()).includes(value), `${label} ${value}; saw ${(await t.toolNames()).join(', ')}`); break;
    case 'toolNotCalled': assert.ok(!(await t.toolNames()).includes(value), `${label} ${value}`); break;
    case 'toolCalls': {
      const count = (await t.toolNames()).filter(name => name === value.name).length;
      assert.ok(count >= (value.min ?? 0) && count <= (value.max ?? Infinity), `${label} ${value.name} ${count} times, wanted ${value.min ?? 0}..${value.max ?? '∞'}`);
      break;
    }
    case 'userMessages': assert.equal(await t.browser.evaluate(`${t.userMessages}.length`), value, label); break;
    case 'panelOpen': assert.equal(await t.browser.evaluate(`!!${t.WORKSPACE}`), value, label); break;
    case 'question': {
      // Fewer ask_user calls than the scenario answers is the model not asking (a model miss), not the page losing a card.
      const asked = (await t.toolNames()).filter(name => name === 'ask_user').length;
      if (asked < value.answered) assert.fail(`model miss: ${label}: the model called ask_user ${asked} time(s), the scenario answers ${value.answered} (reply: ${(await t.assistantText()).slice(0, 300)})`);
      assert.equal(await t.browser.evaluate(`${qa('[data-testid=question-card][data-state=answered]')}.length`), value.answered, `${label} (ask_user calls: ${asked}; answered by the person: ${JSON.stringify(t.answered)}; reply: ${(await t.assistantText()).slice(0, 300)})`);
      break;
    }
    case 'artifact': await artifactExpectation(t, value, label); break;
    case 'fileExists': {
      const files = (await (await t.api('/api/files')).json()).files;
      assert.ok(files.some(path => path === `/workspace/${value}` || (value.endsWith('/') && path.startsWith(`/workspace/${value}`))), `${label} ${value}; files: ${files.join(', ')}`);
      break;
    }
    case 'fileContains': {
      const response = await t.api(`/api/file?path=${encodeURIComponent(`/workspace/${value.path}`)}`);
      assert.equal(response.status, 200, `${label} ${value.path} exists`);
      assert.match((await response.json()).text ?? '', value.text, `${label} ${value.path}`);
      break;
    }
    case 'nativeInputHasFile': {
      // The proof that a file reached the model without any file tool: the user message itself carries a <file> part.
      const sent = (await t.messages()).filter(message => message.role === 'user').at(-1);
      assert.ok(Array.isArray(sent.content) && sent.content.some(part => part.type === 'text' && part.text.startsWith(`<file path="${value.path}`) && (!value.includes || part.text.includes(value.includes))), `${label}: the file content was added to the native input`);
      break;
    }
    case 'nativeInputHasImage': {
      const sent = (await t.messages()).filter(message => message.role === 'user').at(-1);
      assert.ok(Array.isArray(sent.content) && sent.content.some(part => part.type === 'image' && part.mimeType === value), `${label}: a native image part was sent`);
      break;
    }
    default: throw new Error(`Unknown expectation ${kind} in ${scenario.id}`);
  }
}

async function artifactExpectation(t, want, label) {
  const { browser } = t;
  const cards = await browser.evaluate(`${qa(CARDS)}.map(c => ({ id: c.dataset.artifactId, revision: c.dataset.artifactRevision, type: c.dataset.artifactType, title: c.querySelector('[data-testid=artifact-title]').textContent }))`);
  const matching = cards.filter(card => (want.type === undefined || card.type === want.type));
  assert.ok(matching.length >= (want.count ?? 1), `${label}: ${JSON.stringify(want)}; cards: ${JSON.stringify(cards)}`);
  if (want.frameHas) {
    // Open the newest matching card; the sandboxed preview is a frame we look into through the browser's own protocol.
    const card = matching.at(-1);
    await browser.click(`${qa(CARDS)}.find(c => c.dataset.artifactId === ${JSON.stringify(card.id)} && c.dataset.artifactRevision === ${JSON.stringify(card.revision)})`);
    await browser.until(`${label}: the preview frame`, `!!${q(`${PANEL} iframe`)}`, 20000);
    const deadline = Date.now() + 40000;
    for (;;) {
      const found = await browser.frameEvaluate(`${q(`${PANEL} iframe`)}`, `document.querySelectorAll(${JSON.stringify(want.frameHas)}).length`).catch(() => 0);
      if (found > 0) break;
      assert.ok(Date.now() < deadline, `${label}: the preview frame never contained ${want.frameHas}`);
      await pause(500);
    }
  }
}
