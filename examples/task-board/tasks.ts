import type { TaskRecord } from '@hachej/boring-ui-kit/task-board';

/** Fictional host projection. Real hosts authorize records before handing them to the component. */
export const tasks: readonly TaskRecord[] = [
  { id: 'D-201', number: 201, title: 'Choose the picnic route', state: 'waiting', status: 'On you', requesterId: 'alice', waiting_on_you: true,
    waiting_on: { who: 'Alice' }, risk: 'high', screen: 'Outings', capture: 'Route preview',
    spec: 'The riverside path is shorter. The hill route has more shade. Choose the route before the fictional team prepares the map.',
    questions: [{ id: 'route', text: 'Which route should we prepare?', options: [{ label: 'Riverside path', value: 'river' }, { label: 'Hill route', value: 'hill' }] }, { id: 'supplies', text: 'What should we bring?', options: ['water', 'snacks'] },
      ...Array.from({ length: 4 }, (_, index) => ({ id: `planning-${index}`, text: `Planning question ${index + 1}: ${'A fictional long question. '.repeat(12)}`, answer: 'A fictional detailed planning answer. '.repeat(2000), answeredBy: 'Alice' })),
      { id: 'time', text: 'When do we meet?', answer: 'Noon', answeredBy: 'Sam' }],
    files: [{ path: 'docs/tasks/D-201/brief.md' }, { path: 'docs/tasks/D-201/mockup.html' }, { path: 'docs/tasks/D-201/evidence.png' }],
    history: [{ id: 'created', at: '2026-10-27T09:00:00Z', actor: 'Alice', note: 'Asked for a picnic route.' }, { id: 'question', at: '2026-10-28T09:00:00Z', actor: 'PM', note: 'Two routes are ready for review.' }], updated_at: '2026-10-28T09:00:00Z' },
  { id: 'D-202', number: 202, title: 'Add a packing checklist', state: 'working', status: 'En cours', requesterId: 'alice', spec: 'A short checklist for the imaginary village outing.', updated_at: '2026-10-28T08:00:00Z' },
  { id: 'D-203', number: 203, title: 'Make the garden map easier to read', state: 'open', status: 'À essayer', requesterId: 'alice', screen: 'Garden', capture: 'Map preview', updated_at: '2026-10-27T14:00:00Z' },
  { id: 'D-204', number: 204, title: 'Check the meeting point', state: 'waiting', waiting_on: { who: 'Sam', question: 'Is the west gate open?' }, requesterId: 'sam', updated_at: '2026-10-27T13:00:00Z' },
  { id: 'D-205', number: 205, title: 'Label the kite boxes', state: 'done', requesterId: 'alice', updated_at: '2026-10-26T11:00:00Z' },
  { id: 'D-206', number: 206, title: 'Reserve an imaginary bus', state: 'closed', requesterId: 'sam', updated_at: '2026-10-25T11:00:00Z' },
];
