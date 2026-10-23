import { createFakeChannelSource } from '@hachej/boring-ui-kit/shared-chat';

/**
 * The block's story: one fictional app channel, as a phone shows it. Dates are relative to now so the day separators read
 * « Yesterday » and « Today ». No agent, model or real person; every name is fictional.
 */
export function storySeed(now = Date.now()) {
  const day = 86_400_000;
  const today = new Date(now); today.setHours(9, 0, 0, 0);
  const at = (base, minutes) => new Date(base + minutes * 60_000).toISOString();
  const yesterday = today.getTime() - day, morning = today.getTime();
  const members = [
    { id: 'me', name: 'Mira', kind: 'person', role: 'owner', presence: 'here' },
    { id: 'lea', name: 'Léa', kind: 'person', role: 'member', presence: 'here' },
    { id: 'assistant', name: 'Your assistant', kind: 'agent', role: 'agent:pm', presence: 'here' },
  ];
  const message = (id, author, minutes, fields, base = morning) => ({ id, conversationId: 'room', author, at: at(base, minutes), ...fields });
  return {
    me: members[0], members,
    conversations: [{ id: 'room', title: '#missing-receipts', kind: 'main', members: members.map(member => member.id) }],
    messages: [
      message('joined', 'lea', 580, { kind: 'system', text: 'Léa joined the channel' }, yesterday),
      message('lea-1', 'lea', 582, { text: 'Hi! The receipts list misses a due date.' }, yesterday),
      message('lea-2', 'lea', 583, { text: 'Could it sort by it too?' }, yesterday),
      message('mine-1', 'me', 590, { text: 'Good idea, @assistant can you add a Due date column?' , mentions: ['assistant'] }, yesterday),
      message('shipped-1', 'assistant', 0, { kind: 'system', text: 'Shipped: Stop when uploaded' }),
      message('shipped-2', 'assistant', 1, { kind: 'system', text: 'Shipped: Client list from Coach Max' }),
      message('reverted', 'assistant', 2, { kind: 'system', text: 'Reverted: Reminder wording' }),
      message('card', 'assistant', 5, { card: { requestId: 'due-date', title: 'Due date column', line: 'A preview is ready to try', state: 'preview',
        actions: [{ id: 'try', label: 'Try' }, { id: 'later', label: 'Later', variant: 'secondary' }] } }),
      message('pin', 'me', 9, { card: { requestId: 'pin-1', kind: 'pin', title: 'White bg', line: 'Preview of Due date column' } }),
      message('reply', 'assistant', 10, { text: 'Added to Due date column. A new preview in about a minute.' }),
      message('lea-3', 'lea', 12, { text: 'Looks great on my phone 👍' }),
      message('mine-2', 'me', 14, { text: 'Thanks both!' }),
    ],
  };
}

export const createStorySource = () => createFakeChannelSource(storySeed());
