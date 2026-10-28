import type { TaskQuestion, TaskRecord } from '@hachej/boring-ui-kit/task-board';

/** Fictional Coach Max projection from the PM spec mockups (D-201…). Real hosts authorize records before handing them over. */
const answered = (id: string, text: string, answer: string, answeredAt: string, answeredBy = 'Alice'): TaskQuestion => ({ id, text, answer, answeredBy, answeredAt });
const older = [
  answered('plan-1', 'Planning question 1: which meals count as a meal card?', 'Breakfast, lunch, dinner and any logged snack.', '2026-10-27T09:01:00Z'),
  answered('plan-2', 'Planning question 2: does the day plan show photos?', 'Only when the meal has one.', '2026-10-27T09:02:00Z'),
  answered('plan-3', 'Planning question 3: round grams or keep decimals?', 'Round to whole grams.', '2026-10-27T09:03:00Z'),
  answered('plan-4', 'Planning question 4: should coaches see the same order?', 'Yes, the same order everywhere.', '2026-10-27T09:04:00Z'),
  answered('plan-5', 'Planning question 5: which colour marks protein?', 'The existing protein colour.', '2026-10-27T09:05:00Z'),
  ...Array.from({ length: 4 }, (_, index) => answered(`detail-${index + 1}`, `Detail question ${index + 1}: ${'A fictional long question about the meal card. '.repeat(8)}`, 'A fictional detailed answer about the meal card. '.repeat(2000), `2026-10-27T08:0${index}:00Z`)),
];
export const tasks: readonly TaskRecord[] = [
  { id: 'D-201', number: 201, title: 'Protein before calories on meal cards', state: 'waiting', age: '12m', requesterId: 'alice', requester: 'Alice', refiner: 'the PM', waiting_on_you: true,
    waiting_on: { who: 'Alice', type: 'person' }, screen: 'My day', captureCount: 2, folder: 'docs/tasks/D-201',
    questions: [
      { id: 'unit', text: 'Grams in large, or the percentage of the target?', askedBy: 'PM', askedAt: '10:14', options: [{ label: 'Grams', value: 'grams' }, { label: 'Percentage', value: 'percentage' }] },
      { id: 'gauge', text: 'Keep the protein gauge under the card?', askedBy: 'PM', askedAt: '10:15', options: [{ label: 'Remove it', value: 'remove' }, { label: 'Keep it', value: 'keep' }] },
      ...older,
      answered('every-card', 'On every meal card, or only lunch?', 'every card', '2026-10-28T10:12:00Z'),
      answered('no-target', 'What should the card show when no target is set yet? Keep it empty, show a hint, or…', 'Show a short hint that opens the targets screen, and never block logging a meal because of it', '2026-10-28T10:11:00Z'),
      answered('snacks', 'Should the weekly summary count snacks?', 'yes, as a separate line', '2026-10-28T10:10:00Z'),
    ],
    files: [{ path: 'docs/tasks/D-201/brief.md', kind: 'markdown' }, { path: 'docs/tasks/D-201/mockups/meal-card.html', kind: 'mockup' }, { path: 'docs/tasks/D-201/evidence/day-plan.png', kind: 'capture' }],
    updated_at: '2026-10-28T10:14:00Z' },
  { id: 'D-199', number: 199, title: 'Lunch photo on the day plan', state: 'waiting', age: '1d', requesterId: 'alice', requester: 'Alice', waiting_on: { who: 'the builder', type: 'builder' }, updated_at: '2026-10-27T10:00:00Z' },
  { id: 'D-196', number: 196, title: 'Swipe a row to talk to Max', state: 'working', age: '40m', requesterId: 'alice', requester: 'Alice', risk: 'high', updated_at: '2026-10-28T09:40:00Z' },
  { id: 'D-190', number: 190, title: 'Sunday weigh-in reminder', state: 'open', age: '2d', requesterId: 'alice', requester: 'Alice', updated_at: '2026-10-26T10:00:00Z' },
  { id: 'D-188', number: 188, title: 'Export the week as a PDF', state: 'open', age: '4d', requesterId: 'alice', requester: 'Alice', updated_at: '2026-10-24T10:00:00Z' },
  { id: 'D-202', number: 202, title: 'Water goal on the coach home', state: 'waiting', age: '3h', requesterId: 'sam', requester: 'Sam', waiting_on: { who: 'Sam', type: 'person', question: 'Litres or glasses?' }, updated_at: '2026-10-28T07:00:00Z' },
  ...['Dark mode for the meal log', 'Weekly protein streak', 'Rename « Snacks » to « Extras »', 'Bigger tap targets on the scale', 'Coach note under the day plan', 'Copy yesterday’s lunch', 'Calendar starts on Monday', 'Barcode scan for packaged food', 'Hide kcal for coached clients', 'Share the week with the coach', 'Units in the profile', 'Fibre on the summary'].map((title, index): TaskRecord => (
    { id: `D-${170 + index}`, number: 170 + index, title, state: 'done', age: `${index + 6}d`, requesterId: 'alice', requester: 'Alice', updated_at: `2026-10-${String(20 - index).padStart(2, '0')}T10:00:00Z` })),
  { id: 'D-160', number: 160, title: 'Recipe import from links', state: 'closed', age: '3w', requesterId: 'alice', requester: 'Alice', updated_at: '2026-10-07T10:00:00Z' },
];

/** The French app's request card (C7, R6: two captures attached to the request). */
export const confirmation: TaskRecord = { id: 'D-205', number: 205, title: 'Protéines avant les calories sur les cartes repas', state: 'waiting', age: '1m', requesterId: 'alice', requester: 'Alice', waiting_on_you: true,
  waiting_on: { who: 'Alice', type: 'person' }, screen: 'Ma journée', captureCount: 2, updated_at: '2026-10-28T10:20:00Z' };
