import { composeExperienceRegion } from '@hachej/boring-ui-kit/experience/regions';
import { validateExperience } from '@hachej/boring-ui-kit/experience/compose';
import { z } from 'zod';

export const morningCells = Object.freeze([
  { ref: 'morning/header', kind: 'fictional/header', version: 1 },
  { ref: 'morning/reply', kind: 'fictional/reply-editor', version: 1 },
  { ref: 'email/reply', kind: 'fictional/email-reply', version: 1 },
  { ref: 'calendar/conflict', kind: 'fictional/calendar-conflict', version: 1 },
  { ref: 'todo/morning', kind: 'fictional/todo', version: 1 },
].map(Object.freeze));

export const morningLayout = validateExperience({
  format: 'boring.experience', version: 1, name: 'morning', title: 'Fictional morning workspace', source: 'fixed',
  kinds: { 'boring/stack': 1, 'boring/row': 1, 'boring/grid': 1, 'boring/cell': 1, 'boring/generated': 1,
    ...Object.fromEntries(morningCells.map(cell => [cell.kind, cell.version])) },
  root: 'page', elements: {
    page: { type: 'boring/stack', props: {}, children: ['header', 'reply', 'decisions'] },
    header: { type: 'boring/cell', props: { ref: 'morning/header' }, children: [] },
    reply: { type: 'boring/cell', props: { ref: 'morning/reply' }, children: [] },
    decisions: { type: 'boring/generated', props: { region: 'decisions',
      candidates: ['email/reply', 'calendar/conflict', 'todo/morning'], maxElements: 16, minWidth: 260,
      regenerate: ['open', 'phase', 'request'], prompt: 'morning' }, children: ['email', 'calendar', 'todo'] },
    email: { type: 'boring/cell', props: { ref: 'email/reply' }, children: [] },
    calendar: { type: 'boring/cell', props: { ref: 'calendar/conflict' }, children: [] },
    todo: { type: 'boring/cell', props: { ref: 'todo/morning' }, children: [] },
  },
}, { cells: morningCells, canView: () => true });

const metadataSchema = z.object({
  email: z.enum(['pending', 'queued', 'snoozed']),
  calendar: z.enum(['needs-decision', 'settled']),
  todo: z.enum(['incomplete', 'complete']),
}).strict();
const definition = {
  name: 'morning', title: 'Fictional morning workspace',
  intents: { morning: 'Arrange the registered decision cards in a readable vertical morning workspace.' },
  kinds: [
    { kind: 'fictional/email-reply', description: 'Email reply decision', metadata: { state: ['pending', 'queued', 'snoozed'] } },
    { kind: 'fictional/calendar-conflict', description: 'Calendar conflict decision', metadata: { state: ['needs-decision', 'settled'] } },
    { kind: 'fictional/todo', description: 'Morning checklist', metadata: { state: ['incomplete', 'complete'] } },
  ],
};

export function morningMetadata({ email, calendar, todo }) {
  const status = z.enum(['pending', 'queued', 'snoozed']).parse(email.status);
  const selected = z.string().min(1).nullable().parse(calendar.selected);
  const completed = z.array(z.boolean()).max(100).parse(todo.items.map(item => item.completed));
  return Object.freeze({ email: status, calendar: selected === null ? 'needs-decision' : 'settled',
    todo: completed.every(Boolean) ? 'complete' : 'incomplete' });
}

export async function* composeMorning({ descriptor, metadata, trigger = 'request', canView, evaluate, signal }) {
  const approved = metadataSchema.parse(metadata);
  yield* composeExperienceRegion({ descriptor, region: 'decisions', trigger, definition,
    candidates: [
      { ref: 'email/reply', metadata: { state: approved.email } },
      { ref: 'calendar/conflict', metadata: { state: approved.calendar } },
      { ref: 'todo/morning', metadata: { state: approved.todo } },
    ],
    intent: 'morning', cells: morningCells, canView, evaluate, signal,
    layouts: ['boring/stack'], limits: { maxElements: 16, maxDepth: 6, maxEvaluations: 8 },
  });
}

export async function fakeMorningEvaluator({ questions }) {
  return { answers: Object.fromEntries(Object.entries(questions).map(([name, question]) => {
    const choices = Object.keys(question.criteria);
    const choice = name === 'root' && choices.includes('layout_stack') ? 'layout_stack'
      : choices.find(key => key.startsWith('use:')) ?? choices[0];
    if (!choice) throw new TypeError('The fictional evaluator received no choice');
    return [name, { choice }];
  })) };
}
