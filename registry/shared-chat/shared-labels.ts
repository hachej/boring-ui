export function formatTimestamp(at: string, locale: string) {
  const date = new Date(at);
  if (!Number.isFinite(date.getTime())) return at;
  return `${new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'short' }).format(date)}, ${new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(date)}`;
}
/** The time inside a bubble (« 14:02 », « 2:02 PM »). */
export function formatClock(at: string, locale: string) {
  const date = new Date(at);
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' }).format(date) : '';
}
/** A day separator: today and yesterday by name, otherwise « Tue 22 Oct » (with the year when it is not this year). */
export function formatDay(at: string, locale: string, words: { readonly today: string; readonly yesterday: string }, now = Date.now()) {
  const date = new Date(at);
  if (!Number.isFinite(date.getTime())) return at;
  const start = (time: number) => { const day = new Date(time); day.setHours(0, 0, 0, 0); return day.getTime(); };
  const days = Math.round((start(now) - start(date.getTime())) / 86_400_000);
  if (days === 0) return words.today;
  if (days === 1) return words.yesterday;
  const sameYear = new Date(now).getFullYear() === date.getFullYear();
  return new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) }).format(date).replace(/,/g, '');
}
type RoleOf = { readonly kind: 'person' | 'agent' | 'admin'; readonly role?: string | undefined };
/** owner, validator and member read as themselves; every agent is the app's agent; the admin keeps its badge instead. */
export function roleLine(member: RoleOf, words: { readonly owner: string; readonly validator: string; readonly member: string; readonly agent: string }): string | undefined {
  if (member.kind === 'admin' || member.role === 'admin') return undefined;
  if (member.kind === 'agent' || member.role?.startsWith('agent:')) return words.agent;
  return member.role === 'owner' || member.role === 'validator' || member.role === 'member' ? words[member.role] : undefined;
}
export const defaultSharedLabels = {
  /** The full date and time, as the tooltip of a bubble's time. */
  sharedTimestamp: (at: string) => formatTimestamp(at, 'en'),
  /** The time inside a bubble, bottom right. */
  sharedClock: (at: string) => formatClock(at, 'en'),
  /** The centred day pill before the first message of each day. */
  sharedDay: (at: string) => formatDay(at, 'en-GB', { today: 'Today', yesterday: 'Yesterday' }),
  sharedNewMessages: (count: number) => count === 1 ? '1 new message' : `${count} new messages`,
  sharedMoreUpdates: (count: number) => count === 1 ? '1 more update' : `${count} more updates`, sharedFewerUpdates: 'Show less',
  sharedPinned: 'Pinned comment',
  sharedMembers: 'Members', sharedMemberCount: (count: number) => `${count} members`,
  sharedAgent: 'Agent', sharedVia: (name: string) => `via ${name}`,
  sharedWorking: (name: string) => `${name} is working…`,
  sharedReply: 'Reply', sharedCancelReply: 'Cancel reply', sharedEarlierMessage: 'Earlier message',
  sharedAdmin: 'Admin', sharedHere: 'Here', sharedAway: 'Away', sharedOffline: 'Offline',
  sharedRemoved: 'Message removed', sharedSince: (time: string) => `Since ${time}`,
  /** The line beside an author (« Léa · member »). Return undefined for none; a member's own `roleLabel` wins. */
  sharedRole: (member: RoleOf): string | undefined => roleLine(member, { owner: 'owner', validator: 'validator', member: 'member', agent: 'the app\u2019s agent' }),
};
export type SharedLabels = typeof defaultSharedLabels;
