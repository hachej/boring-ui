// End-to-end journey for the bot in headless Chromium, through the real UI and HTTP server.
//   CHROMIUM=/path/to/chrome-headless-shell npm run bot:journey                          # scripted model, no key needed
//   CHROMIUM=... OPENAI_API_KEY=... BOT_JOURNEY=live npm run bot:journey                 # a real model
// It tells the bot facts, asks for two of them in a later turn (the request holds no old message, so they can only come
// from the OptChat view), has it zoom to one message, write an ability, redeploy itself and use it in the same run, runs
// the summarizer, restarts the server, and rolls back from the panel. Evidence (screenshots, journey.json) goes to
// .cache/evidence/bot.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launch } from '@hachej/boring-testing/browser';
import { startBot } from './server.mjs';
import { createScriptedModel } from './scripted-model.mjs';

const live = process.env.BOT_JOURNEY === 'live';
const evidence = process.env.BOT_EVIDENCE ?? '.cache/evidence/bot';
mkdirSync(evidence, { recursive: true });
const directory = mkdtempSync(join(tmpdir(), 'boring-bot-'));

const FACTS = [
  "Hi! I'm Robin. My sister Maya's birthday is 2026-12-24.",
  "I'm vegetarian, and I really dislike cilantro.",
  'My dog is called Biscuit, a three-year-old beagle.',
  'The Q4 launch at work is codenamed Lantern.',
  'I promised to call the plumber on Thursday.',
  "I'm learning Portuguese, 20 minutes a day.",
  'My favourite tea is genmaicha.',
  'I run on Tuesdays and Saturdays.',
  'Book club picked "The Fictional Lighthouse" for November.',
  'Biscuit has a vet visit on 2026-10-20.',
];
const RECALL = 'Quick check: what is my dog called, and what is the codename of the Q4 launch? Answer in one line.';
const ZOOM = 'Use zoom to reopen message 4 exactly.';
// A small view budget, so the ten facts are folded into coarser lines while the journey runs.
const MEMORY = { viewBytes: 700 };
const ABILITY_REQUEST = 'I often ask how many days until things. Write yourself an ability called countdowns that takes items (a list of {label, date}) and returns the days until each, soonest first. Deploy it, then use it for Maya\'s birthday (2026-12-24) and New Year (2027-01-01).';
const COUNTDOWNS = `// description: Days until each {label, date}, soonest first.
// args: { items: { label: string, date: string }[] }
const today = Date.parse((await tools.today({})).date + 'T00:00:00Z');
return args.items.map(item => ({ label: item.label, days: Math.round((Date.parse(item.date + 'T00:00:00Z') - today) / 86400000) })).sort((a, b) => a.days - b.days);
`;

/** The scripted bot: answers only from what each request contains. */
function decide(messages, request) {
  const textOf = message => typeof message.content === 'string' ? message.content : (message.content ?? []).filter(part => part.type === 'text').map(part => part.text).join('\n');
  // The summarizer (the compactor's protocol: context block, then the step): keep what the person said.
  if (request.messages.some(message => message.role === 'system' && typeof message.content === 'string' && message.content.startsWith('You write the memory of'))) {
    const step = messages[0].content.at(-1).text.split(/in at most \d+ bytes:\n/)[1] ?? '';
    const said = [...step.matchAll(/user: (.*?)(?= talk: | tool: | echo: |$)/gm)].map(match => match[1]).join(' | ');
    return { text: (said || step.replace(/\s+/g, ' ')).slice(0, 400) };
  }
  const last = messages.at(-1);
  if (last.role === 'toolResult') {
    const result = textOf(last);
    if (last.toolName === 'write') return { tool: { name: 'redeploy', arguments: { note: 'countdowns for several dates' } } };
    if (last.toolName === 'redeploy') return { tool: { name: 'run_code', arguments: { code: "return await abilities.countdowns({ items: [{ label: 'New Year', date: '2027-01-01' }, { label: 'Maya birthday', date: '2026-12-24' }] })" } } };
    if (last.toolName === 'run_code') return { text: `Done. ${JSON.parse(result).map(item => `${item.label}: ${item.days} days`).join(', ')}.` };
    return { text: result.slice(0, 200) };
  }
  const said = textOf(last).split('</chat>').at(-1); // what the person just wrote, after the view
  if (said.includes('Write yourself an ability')) return { tool: { name: 'write', arguments: { path: '/workspace/self/abilities/countdowns.js', content: COUNTDOWNS } } };
  if (said.includes('Use zoom')) return { tool: { name: 'zoom', arguments: { id: 4, n: 1 } } };
  if (said.includes('Quick check')) {
    // The facts are older than this turn: answer only if the view carried them.
    const memory = /<chat>[\s\S]*?<\/chat>/.exec(messages.map(textOf).join('\n'))?.[0] ?? '';
    const dog = /dog is called (\w+)/.exec(memory)?.[1], launch = /codenamed (\w+)/.exec(memory)?.[1];
    return { text: dog && launch ? `Your dog is ${dog} and the launch is ${launch}.` : 'I do not remember.' };
  }
  return { text: 'Noted.' };
}

const scripted = live ? undefined : createScriptedModel(decide);
const options = { directory, memory: MEMORY, ...(scripted ? { modelsOverride: scripted.models, model: scripted.model } : {}) };
let app = await startBot(options);
const { port, token } = app;
const steps = [];
const step = async (name, run) => { const started = Date.now(); await run(); steps.push({ name, ms: Date.now() - started }); console.log(`ok  ${name} (${Date.now() - started} ms)`); };
const state = async () => (await fetch(new URL('/api/bot/state', app.url), { headers: { authorization: `Bearer ${token}` } })).json();

const MESSAGE = `document.querySelector('[data-testid=composer-input]')`;
const SUBMIT = `document.querySelector('[data-testid=composer-submit]')`;
const idle = `${SUBMIT}?.dataset.state === 'send'`;
const logText = `(document.querySelector('[data-testid=transcript]')?.innerText ?? '')`;
const sinceRecall = `${logText}.split('Quick check').at(-1)`;

let browser;
try {
  browser = await launch(app.url, { evidence });
  const ready = `document.querySelector('[data-testid=connection]')?.dataset.state === 'connected'`;
  await browser.until('chat connected', ready);
  /** Type one message and wait until the run has finished and the log has grown. */
  const say = async (text, timeout = live ? 180000 : 20000) => {
    const before = (await state()).memory?.leaves ?? 0;
    await browser.type(MESSAGE, text);
    await browser.click(SUBMIT);
    await browser.until(`messages of "${text.slice(0, 30)}" logged`, `fetch('/api/bot/state', { headers: { authorization: 'Bearer ${token}' } }).then(r => r.json()).then(s => (s.memory?.leaves ?? 0) >= ${before + 2})`, timeout);
    await browser.until(`answer to "${text.slice(0, 30)}"`, `${idle} && document.querySelector('[data-testid=transcript]')?.innerText.length > 0`, timeout);
  };
  const textOf = message => typeof message.content === 'string' ? message.content : (message.content ?? []).filter(part => part.type === 'text').map(part => part.text).join('\n');

  await step('bot: OptChat is on for the one conversation; ten facts are logged and folded into a view under its budget', async () => {
    assert.equal((await state()).memory.enabled, true, 'the host opted the conversation in with configure');
    for (const fact of FACTS) await say(fact);
    // Merges that no longer fit in one line need a summary first; the view settles once the compactor is idle.
    await browser.until('compactor idle', `fetch('/api/bot/state', { headers: { authorization: 'Bearer ${token}' } }).then(r => r.json()).then(s => s.memory.compactor.idle && s.memory.view.open === 0)`, 30000);
    const { memory } = await state();
    assert.ok(memory.leaves >= FACTS.length * 2, `${memory.leaves} messages in the log`);
    assert.ok(memory.view.bytes <= memory.view.budget, `view ${memory.view.bytes} of ${memory.view.budget} bytes`);
    assert.ok(memory.view.parts.length < memory.leaves, 'older messages share lines');
    assert.ok(memory.view.parts.some(part => part.level >= 1), 'the view has coarser lines');
    await browser.until('view lines in panel', `document.querySelectorAll('[data-testid=bot-view] li[data-level]').length === ${memory.view.parts.length}`);
  });

  await step('bot: facts from earlier turns come back through the view only', async () => {
    await say(RECALL);
    await browser.until('recall answer', `/Biscuit[\\s\\S]*Lantern|Lantern[\\s\\S]*Biscuit/.test(${sinceRecall})`, live ? 180000 : 20000);
    if (scripted) {
      const request = scripted.requests.findLast(item => textOf(item.messages.findLast(message => message.role === 'user') ?? {}).endsWith(RECALL));
      const conversation = request.messages.filter(message => message.role !== 'system');
      assert.equal(conversation.length, 1, 'no old message is sent: only the current one');
      const [view, said] = textOf(conversation[0]).split('</chat>');
      assert.ok(view.startsWith('<chat>') && view.includes('My dog is called Biscuit') && view.includes('codenamed Lantern'), 'the facts are in the view');
      assert.ok(!said.includes('Biscuit') && said.trim() === RECALL, 'and the message itself arrives whole after it');
      const offered = request.messages.filter(message => message.role === 'system').flatMap(message => (message.toolsAdded ?? []).map(tool => tool.name));
      assert.ok(offered.includes('zoom') && offered.includes('date'), `zoom and date are offered: ${offered}`);
    }
    await browser.screenshot('bot-recall.png');
  });

  await step('bot: zoom returns the exact original message', async () => {
    await say(ZOOM);
    await browser.until('zoomed message', `/4\\+0\\|user: My dog is called Biscuit, a three-year-old beagle\\./.test(${logText})`);
  });

  await step('bot: writes an ability, redeploys itself and uses it in the same run', async () => {
    await say(ABILITY_REQUEST, live ? 300000 : 30000);
    const after = await state();
    assert.ok(after.self.current.version >= 2, `self v${after.self.current.version}`);
    assert.ok(after.self.current.abilities.length >= 2, 'a new ability is deployed next to the seeded one');
    await browser.until('panel shows new version', `document.querySelector('[data-testid=bot-version]')?.textContent === 'v${after.self.current.version}'`);
    if (scripted) {
      await browser.until('countdown answer', `/Maya birthday: \\d+ days, New Year: \\d+ days/.test(${logText})`);
      const resumed = scripted.requests.find(item => item.messages.some(message => message.role === 'toolResult' && message.toolName === 'redeploy'));
      assert.match(JSON.stringify(resumed.messages.filter(message => message.role === 'system')), /abilities\.countdowns/, 'the request after redeploy already offers the new ability');
      // Mid-turn requests keep the turn in progress verbatim (user message, tool call, result) after the view.
      assert.deepEqual(resumed.messages.filter(message => message.role !== 'system').map(message => message.role), ['user', 'assistant', 'toolResult', 'assistant', 'toolResult']);
    }
    await browser.screenshot('bot-redeployed.png');
  });

  await step('bot: the summarizer compacts long messages; every line of the view is a summary', async () => {
    await fetch(new URL('/api/bot/nap', app.url), { method: 'POST', headers: { authorization: `Bearer ${token}` } });
    const { memory } = await state();
    assert.equal(memory.view.open, 0, 'no line waits for a summary');
    assert.ok(memory.summaries > 0 && memory.compactor.calls > 0, JSON.stringify(memory.compactor));
    assert.equal(memory.compactor.idle, true);
    await browser.until('summaries in panel', `/${memory.summaries} summaries/.test(document.querySelector('[data-testid=bot-memory-stats]')?.textContent ?? '')`);
  });

  await step('bot: a restart reopens the same conversation, memory and deployed self', async () => {
    const before = await state();
    await app.close();
    app = await startBot({ ...options, port, token });
    await browser.evaluate('location.reload()');
    await browser.until('chat reconnected', ready);
    await browser.until('transcript restored', `/Biscuit/.test(${logText}) && /genmaicha/.test(${logText})`);
    const after = await state();
    assert.equal(after.memory.conversationId, before.memory.conversationId);
    assert.equal(after.memory.enabled, true);
    assert.equal(after.memory.leaves, before.memory.leaves);
    assert.equal(after.memory.summaries, before.memory.summaries, 'summaries come back from the conversation document');
    assert.equal(after.self.current.version, before.self.current.version);
  });

  await step('bot: rolling back from the panel restores the files and deploys the old self', async () => {
    const before = await state();
    await browser.click(`document.querySelector('[data-testid=bot-deploys] [data-version="1"] button')`);
    await browser.until('rolled back', `document.querySelector('[data-testid=bot-version]')?.textContent === 'v${before.self.current.version + 1}'`);
    const after = await state();
    assert.equal(after.self.drift, 'no change');
    assert.deepEqual(after.self.current.abilities.map(ability => ability.name), ['days_until']);
    await browser.screenshot('bot-rollback.png');
  });

  assert.deepEqual(browser.problems.filter(problem => !/Failed to load resource|ERR_CONNECTION|net::|TypeError: Failed to fetch|network error/i.test(problem)), []);
  const summary = { mode: live ? 'live' : 'scripted', model: app.model, steps };
  writeFileSync(join(evidence, 'journey.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
} catch (error) { console.error(error); process.exitCode = 1; }
finally {
  if (browser) { await browser.screenshot('last.png').catch(() => {}); await browser.close(); }
  await Promise.race([app.close().catch(() => {}), new Promise(resolve => setTimeout(resolve, 15000))]);
  process.exit(process.exitCode ?? 0);
}
