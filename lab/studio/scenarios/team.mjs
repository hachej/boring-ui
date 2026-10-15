// A specialised team on the one standard agent: a writer (the letter-style skill, file tools) and a reviewer (a subagent given the
// letter-review checklist). This replaces the separate Letter writer and Reviewer demos.
import assert from 'node:assert/strict';
import { NOTES } from '../fixtures/workspace-files.mjs';
import { call } from './_script.mjs';

export default {
  id: 'team-letter-review', group: 'Specialised team', title: 'A writer and a reviewer', requires: ['workspace', 'subagents'], seed: NOTES, panel: 'files',
  description: 'The agent writes a referral letter following a house-style skill, then has a subagent review it with a checklist skill.',
  steps: [
    { prompt: '/letter-style Write the physiotherapy referral letter for the patient in notes/consultation.md and save it as a file in the workspace with the write tool.' },
    { prompt: 'Now have a subagent review the letter against notes/consultation.md: load the letter-review skill first, then give the subagent the full checklist and the file paths.' },
  ],
  script: {
    0: [
      call('load_skill', { name: 'letter-style' }),
      call('write', { path: 'letters/knee-referral.md', content: 'Dear colleague,\n\nI am referring Mx. Avery Example (EX-0001) for physiotherapy. Three weeks of right knee pain followed a hiking trip.\n\nThe knee has mild swelling, full range of motion and no instability.\n\nPlease start a strengthening programme; we will review in six weeks.\n\nKind regards,\nFictional Clinic\n' }),
      'The letter is saved under letters/.',
    ],
    1: [
      call('load_skill', { name: 'letter-review' }),
      ctx => call('subagent', { task: `Review letters/knee-referral.md against notes/consultation.md with this checklist.\n\n${ctx.last.text}` }),
      ctx => `The reviewer says:\n${ctx.last.text}`,
    ],
    // The reviewer: a child conversation whose first message is the task above.
    'Review letters/knee-referral.md against notes/consultation.md': [
      call('read', { path: 'letters/knee-referral.md' }),
      call('read', { path: 'notes/consultation.md' }),
      '- OK every finding appears in the notes.\n- OK the house style is followed.\n- OK nothing is abbreviated.',
    ],
  },
  expect: [{ toolCalled: 'load_skill' }, { toolCalled: 'write' }, { fileExists: 'letters/' }, { toolCalled: 'subagent' }, { toolResult: /\b(OK|FIX)\b/ }],
  async verify(t) {
    const { browser } = t;
    // The skill loads by name, for the writer and for the reviewer's checklist.
    const loaded = (await t.messages()).flatMap(message => message.role === 'assistant' ? message.content.filter(part => part.type === 'toolCall' && part.name === 'load_skill').map(part => part.arguments.name) : []);
    assert.ok(loaded.includes('letter-style') && loaded.includes('letter-review'), `skills loaded: ${loaded.join(', ')}`);
    assert.equal(await browser.evaluate(`${t.q('[data-testid=message-skill]')}?.dataset.skill`), 'letter-style', 'the sent /letter-style token is styled');
    // The reviewer is a subagent with read-only tools: whatever it did, it neither wrote nor ran a command.
    await t.tab('tasks');
    await browser.until('the reviewer child is listed', `!!document.querySelector('.studio-panel [data-testid=subagent]')`, 20000);
    const steps = await browser.evaluate(`[...document.querySelectorAll('.studio-panel [data-testid=subagent]')].map(e => e.innerText).join('\\n')`);
    assert.ok(!/(^|→ )(write|edit|bash)( |$)/m.test(steps), `the reviewer subagent made no write, edit or bash call: ${steps.slice(0, 300)}`);
    // The letter follows the style skill.
    await t.tab('files');
    await browser.click(`[...document.querySelectorAll('.studio-panel li button')].find(b => b.textContent.startsWith('letters/'))`);
    await browser.until('letter preview follows the skill', `/Dear colleague/.test((() => { const e = document.querySelector('[data-testid=file-viewer] [role=textbox], [data-testid=file-viewer] textarea'); return e?.value ?? e?.innerText ?? ''; })())`, 20000);
  },
};
