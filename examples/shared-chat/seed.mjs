export const sharedChatSeed = {
  me: { id: 'mira', name: 'Mira', kind: 'person', role: 'owner', presence: 'here' },
  members: [
    { id: 'mira', name: 'Mira', kind: 'person', role: 'owner', presence: 'here' },
    { id: 'leo', name: 'Leo', kind: 'person', role: 'validator', presence: 'here' },
    { id: 'pm', name: 'PM', kind: 'agent', role: 'agent:pm', presence: 'here' },
    { id: 'worker', name: 'Builder', kind: 'agent', role: 'agent:worker', presence: 'away' },
    { id: 'julien', name: 'Julien (admin)', kind: 'admin', role: 'admin', presence: 'here' },
  ],
  conversations: [
    { id: 'main', title: 'Main', kind: 'main', members: ['mira', 'leo', 'pm', 'worker', 'julien'] },
    { id: 'admin', title: 'Admin', kind: 'admin', members: ['mira', 'pm', 'julien'] },
    { id: 'direct', title: 'Mira and Leo', kind: 'direct', members: ['mira', 'leo'] },
  ],
  messages: [
    { id: 'one', conversationId: 'main', author: 'leo', at: '2026-10-19T10:00:00Z', text: 'The fictional garden plan is ready for review.' },
    { id: 'two', conversationId: 'main', author: 'leo', at: '2026-10-19T10:01:00Z', text: 'I checked the planting dates too.' },
    { id: 'three', conversationId: 'main', author: 'mira', at: '2026-10-19T10:02:00Z', text: 'Thanks! Let’s review it together.' },
    { id: 'four', conversationId: 'main', author: 'julien', at: '2026-10-19T10:03:00Z', text: 'I am here if the team needs help.' },
    { id: 'five', conversationId: 'main', author: 'worker', at: '2026-10-19T10:04:00Z', text: 'The layout is ready.' },
    { id: 'six', conversationId: 'main', author: 'pm', at: '2026-10-19T10:05:00Z', card: { requestId: 'review-plan', title: 'Review the garden plan', line: 'The team is waiting for your review.', since: '2026-10-19T10:05:00Z', action: { id: 'review', label: 'Review' } } },
    { id: 'seven', conversationId: 'main', author: 'pm', at: '2026-10-19T10:06:00Z', card: { requestId: 'approve-colors', title: 'Choose the labels', line: 'Two fictional label options are ready.', since: '2026-10-19T10:06:00Z', action: { id: 'choose', label: 'Choose' } } },
    { id: 'admin-one', conversationId: 'admin', author: 'julien', at: '2026-10-19T10:07:00Z', text: 'This conversation is supplied by the host.' },
    { id: 'direct-one', conversationId: 'direct', author: 'leo', at: '2026-10-19T10:08:00Z', text: 'Would you like to review the seed list?' },
  ],
};
