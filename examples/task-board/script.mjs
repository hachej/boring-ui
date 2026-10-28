// Deterministic model turns, executed by the real native Harness. No model key or second conversation.
const present = subject => [{ tools: [{ name: 'present', args: subject }] }, ctx => ctx.last.json.opened === true ? 'Opened in the task stage.' : `Could not open: ${ctx.last.json.refused ?? ctx.last.json.opened}.`];
export const taskSources = [{ name: 'task-board', entries: [
  { match: 'Grams in large, or the percentage of the target?', turns: [{ tools: [{ name: 'answer_task_question', args: { task: 'D-201', question: 'unit', value: 'grams' } }] }, 'Settled: grams in large.'] },
  { match: 'Keep the protein gauge under the card?', turns: [{ tools: [{ name: 'answer_task_question', args: { task: 'D-201', question: 'gauge', value: 'remove' } }] }, 'Settled: the gauge goes.'] },
  { match: "What's waiting on me?", turns: [{ tools: [{ name: 'present', args: { task: 'D-201' } }] }, ctx => ctx.last.json.opened === true ? 'One request waits on you. I opened D-201 on the right.' : `Could not open: ${ctx.last.json.refused ?? ctx.last.json.opened}.`] },
  { match: 'Show D-201', turns: present({ task: 'D-201' }) },
  { match: 'Show waiting on me', turns: present({ tasks: { filter: 'waiting-on-me' } }) },
  { match: 'Show my requests', turns: present({ tasks: { filter: 'mine' } }) },
  { match: 'Show missing task', turns: present({ task: 'D-999' }) },
  { match: 'Show denied task', turns: present({ task: 'D-403' }) },
] }];
