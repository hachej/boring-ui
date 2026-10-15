// Subagents, the two patterns Pi Durable documents: a foreground child owned by the tool call (its answer comes back, Stop reaches it) and
// background children that leave the parent usable, survive its Stop and post their report into the parent conversation on their own.
// The Tasks tab shows the children of the open conversation.
import assert from 'node:assert/strict';
import { NOTES } from '../fixtures/workspace-files.mjs';
import { call, story } from './_script.mjs';

const seed = { ...NOTES, 'README.md': '# Fictional workspace\n\nEverything here is invented demo content.\n' };
const common = { group: 'Subagents', requires: ['workspace', 'subagents'], seed, panel: 'tasks' };
const children = filter => `[...document.querySelectorAll('.studio-panel [data-testid=subagent]${filter}')]`;
const toolCalls = t => t.toolNames().then(names => names.join(' '));
const reports = t => `${t.userMessages}.filter(text => text.includes('Background subagent #'))`;

export default [
  {
    ...common, id: 'subagent-foreground', smoke: true, title: 'Delegate and wait', description: 'A tool call owns a child conversation, waits for its answer, and the Tasks tab shows the child done.',
    steps: [
      { prompt: 'What is the fictional identifier of the patient in notes/consultation.md? Delegate reading the file to a subagent, wait for it, and tell me the identifier.', wait: false },
      { async run(t) {
        await t.browser.until('child running in the panel', `${children('[data-status=running]')}.length === 1`, 120000);
        assert.equal(await t.browser.evaluate(t.idle), false, 'the parent is busy while its foreground child works');
      } },
      { action: 'idle' },
    ],
    script: {
      0: [call('subagent', { task: 'Read notes/consultation.md and report the patient\'s fictional identifier.' }), ctx => `The subagent reports: ${ctx.last.text}`],
      // The child works for a few seconds, so the Tasks tab can show it running while the parent is busy.
      'report the patient\'s fictional identifier': [call('read', { path: 'notes/consultation.md' }, { delay: 4000 }), ctx => `The fictional identifier is ${ctx.last.text.match(/EX-\d{4}/)?.[0]}.`],
    },
    expect: [{ toolCalled: 'subagent' }, { reply: /EX-0001/ }],
    async verify(t) {
      const { browser } = t;
      await browser.until('child done in the panel', `${children('[data-status=done]')}.length === 1 && /EX-0001/.test(${children('[data-status=done]')}[0].querySelector('[data-testid=subagent-answer]').textContent)`);
      assert.equal(await browser.evaluate(`${children('')}[0].dataset.mode`), 'foreground');
      assert.match(await browser.evaluate(`${children('')}[0].innerText`), /\bread\b/, 'the child used its own read tool');
      await t.panelControls('tasks');
      await browser.screenshot('subagents-fg.png');
    },
  },
  {
    ...common, id: 'subagent-foreground-stop', title: 'Stopping the parent stops its child', description: 'Stop on the parent reaches the foreground child owned by the call.',
    steps: [
      { prompt: 'Delegate this to a subagent and wait: read README.md, then write a fictional story of about 700 words about a tide-table printer.', wait: false },
      { async run(t) { await t.browser.until('child running', `${children('[data-status=running]')}.length === 1`, 120000); } },
      { action: 'stop' },
      { async run(t) {
        await t.browser.until('child stopped with the call', `${children('[data-status=stopped]')}.length === 1 && ${children('[data-status=running]')}.length === 0`, 30000);
        await t.browser.until('no live task left', `!!document.querySelector('.studio-panel [data-testid=task-graph-idle]')`, 30000);
      } },
    ],
    script: {
      0: [call('subagent', { task: 'Read README.md, then write a long fictional story about a tide-table printer.' }), 'The subagent finished.'],
      'long fictional story about a tide-table printer': [call('read', { path: 'README.md' }), story(60, 'THE END')],
    },
    expect: [{ toolCalled: 'subagent' }],
  },
  {
    ...common, id: 'subagent-background', title: 'Delegate in the background', description: 'The parent answers another message while its child works; the child\'s report arrives in the conversation on its own, once.',
    steps: [
      { prompt: 'Start a background subagent with this task: "Read notes/consultation.md, then write a fictional recovery diary of about 500 words for that patient. End with the exact line DIARY-COMPLETE."', wait: false },
      { async run(t) {
        await t.browser.until('child running and parent idle again', `${children('[data-status=running][data-mode=background]')}.length === 1 && ${t.idle}`, 120000);
        assert.ok((await toolCalls(t)).includes('subagent'), 'the spawn call is visible');
      } },
      { prompt: 'Reply with exactly: STILL-HERE' },
      { async run(t) {
        assert.equal(await t.browser.evaluate(`${children('[data-status=running]')}.length`), 1, 'the child was still running when the parent answered');
        assert.equal(await t.browser.evaluate(`${reports(t)}.length`), 0, 'no report yet');
      } },
    ],
    script: {
      0: [call('subagent', { task: 'Read notes/consultation.md, then write the fictional recovery diary of that patient. End with DIARY-COMPLETE.', background: true }), ctx => `Started background subagent: ${ctx.last.text.trim()}`],
      'fictional recovery diary of that patient': [call('read', { path: 'notes/consultation.md' }), story(25, 'DIARY-COMPLETE')],
      'Background subagent #': ['The diary subagent finished: DIARY-COMPLETE.'],
    },
    expect: [{ reply: /STILL-HERE/ }],
    async verify(t) {
      const { browser } = t;
      await browser.until('report posted into the parent', `${t.userMessages}.some(text => /\\[Background subagent #\\d+ finished\\]/.test(text) && /DIARY-COMPLETE/.test(text))`, 240000);
      await browser.until('parent reacted to the report', t.idle, 120000);
      await browser.until('child done in the panel', `${children('[data-status=done]')}.length === 1 && /DIARY-COMPLETE/.test(${children('[data-status=done]')}[0].innerText)`);
      await t.pause(3000);
      assert.equal(await browser.evaluate(`${reports(t)}.length`), 1, 'the report appears exactly once');
      assert.equal(await browser.evaluate(`${t.userMessages}.length`), 3, 'two typed messages and one report');
      await browser.screenshot('subagents-bg.png');
    },
  },
  {
    ...common, id: 'subagent-background-survives-stop', title: 'A background child survives Stop', description: 'Stopping the parent stops no background child; its report still arrives.',
    steps: [
      { prompt: 'Start a background subagent with this task: "Read README.md, then write a fictional story of about 1500 words about a lighthouse. End with the exact line POEM-COMPLETE."', wait: false },
      { async run(t) { await t.browser.until('child running and parent idle', `${children('[data-status=running]')}.length === 1 && ${t.idle}`, 120000); } },
      { prompt: 'Without using tools or artifacts, write the numbers from 1 to 400 in English words, one per line, directly in the chat.', wait: false },
      { action: 'streaming' },
      { async run(t) { assert.equal(await t.browser.evaluate(`${children('[data-status=running]')}.length`), 1, 'the child is running while the parent streams'); } },
      { action: 'stop' },
      { async run(t) { assert.equal(await t.browser.evaluate(`${children('[data-status=stopped]')}.length`), 0, 'stopping the parent stopped no child'); } },
    ],
    script: {
      0: [call('subagent', { task: 'Read README.md, then write the long fictional lighthouse story. End with POEM-COMPLETE.', background: true }), 'Started a background subagent.'],
      'long fictional lighthouse story': [call('read', { path: 'README.md' }), story(25, 'POEM-COMPLETE')],
      'Background subagent #': ['The lighthouse subagent finished: POEM-COMPLETE.'],
    },
    async verify(t) {
      const { browser } = t;
      await browser.until('the child finished after the stop', `${children('[data-status=done]')}.length === 1 && /POEM-COMPLETE/.test(${children('[data-status=done]')}[0].innerText)`, 240000);
      await browser.until('its report arrived and was handled', `${reports(t)}.filter(text => /POEM-COMPLETE/.test(text)).length === 1 && ${t.idle}`, 120000);
    },
  },
  {
    ...common, id: 'subagent-background-stop', title: 'Stop a background child on request', description: 'The parent lists and stops a running child when asked; a stopped child posts no report.',
    steps: [
      { prompt: 'Start a background subagent with this task: "Read README.md, then write a fictional story of about 900 words about a clockmaker."', wait: false },
      { async run(t) { await t.browser.until('child running and parent idle', `${children('[data-status=running]')}.length === 1 && ${t.idle}`, 120000); } },
      { prompt: 'Stop the subagent that is still running.' },
      { async run(t) {
        await t.browser.until('child stopped', `${children('[data-status=stopped]')}.length === 1 && ${children('[data-status=running]')}.length === 0 && ${t.idle}`, 120000);
        assert.ok((await toolCalls(t)).includes('stop_subagent'), 'the stop call is visible');
        await t.pause(3000);
        assert.equal(await t.browser.evaluate(`${reports(t)}.length`), 0, 'a stopped child posts no report');
      } },
    ],
    script: {
      0: [call('subagent', { task: 'Read README.md, then write the long fictional clockmaker story.', background: true }), 'Started a background subagent.'],
      'long fictional clockmaker story': [call('read', { path: 'README.md' }), story(120, 'THE END')],
      2: [call('list_subagents', {}), ctx => call('stop_subagent', { id: Number(/#(\d+) running/.exec(ctx.last.text)?.[1]) }), ctx => `Stopped: ${ctx.last.text}`],
    },
    expect: [{ toolCalled: 'stop_subagent' }],
  },
];
