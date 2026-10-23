export function formatTimestamp(at: string, locale: string) {
  const date = new Date(at);
  if (!Number.isFinite(date.getTime())) return at;
  return `${new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'short' }).format(date)}, ${new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(date)}`;
}
type RoleOf = { readonly kind: 'person' | 'agent' | 'admin'; readonly role?: string | undefined };
/** owner, validator and member read as themselves; every agent is the app's agent; the admin keeps its badge instead. */
export function roleLine(member: RoleOf, words: { readonly owner: string; readonly validator: string; readonly member: string; readonly agent: string }): string | undefined {
  if (member.kind === 'admin' || member.role === 'admin') return undefined;
  if (member.kind === 'agent' || member.role?.startsWith('agent:')) return words.agent;
  return member.role === 'owner' || member.role === 'validator' || member.role === 'member' ? words[member.role] : undefined;
}
export const defaultSharedLabels = {
  sharedTimestamp: (at: string) => formatTimestamp(at, 'en'),
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
