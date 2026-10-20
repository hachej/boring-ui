export function formatTimestamp(at: string, locale: string) {
  const date = new Date(at);
  if (!Number.isFinite(date.getTime())) return at;
  return `${new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'short' }).format(date)}, ${new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(date)}`;
}
export const defaultSharedLabels = {
  sharedTimestamp: (at: string) => formatTimestamp(at, 'en'),
  sharedMembers: 'Members', sharedMemberCount: (count: number) => `${count} members`,
  sharedAgent: 'Agent', sharedVia: (name: string) => `via ${name}`,
  sharedWorking: (name: string) => `${name} is working…`,
  sharedReply: 'Reply', sharedCancelReply: 'Cancel reply', sharedEarlierMessage: 'Earlier message',
  sharedAdmin: 'Admin', sharedHere: 'Here', sharedAway: 'Away', sharedOffline: 'Offline',
  sharedRemoved: 'Message removed', sharedSince: (time: string) => `Since ${time}`,
};
export type SharedLabels = typeof defaultSharedLabels;
