// Deterministic model turns, executed by the real native Harness. No model key or second conversation.
const present = subject => [{ tools: [{ name: 'present', args: subject }] }, ctx => ctx.last.json.opened === true ? 'Opened in the task stage.' : `Could not open: ${ctx.last.json.refused ?? ctx.last.json.opened}.`];
export const taskSources = [{ name: 'task-board', entries: [
  { match: 'Show D-201', turns: present({ task: 'D-201' }) },
  { match: 'Show waiting on me', turns: present({ tasks: { filter: 'waiting-on-me' } }) },
  { match: 'Show my requests', turns: present({ tasks: { filter: 'mine' } }) },
  { match: 'Show missing task', turns: present({ task: 'D-999' }) },
  { match: 'Show denied task', turns: present({ task: 'D-403' }) },
] }];
