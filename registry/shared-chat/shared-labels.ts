export const defaultSharedLabels = {
  sharedMembers: 'Members', sharedMemberCount: (count: number) => `${count} members`,
  sharedAgent: 'Agent', sharedVia: (name: string) => `via ${name}`,
  sharedWorking: (name: string) => `${name} is working…`,
  sharedReply: 'Reply', sharedCancelReply: 'Cancel reply', sharedEarlierMessage: 'Earlier message',
  sharedAdmin: 'Admin', sharedHere: 'Here', sharedAway: 'Away', sharedOffline: 'Offline',
  sharedRemoved: 'Message removed', sharedSince: (time: string) => `Since ${time}`,
};
export type SharedLabels = typeof defaultSharedLabels;
