import type { SharedLabels } from './shared-labels';
import { formatTimestamp, roleLine } from './shared-labels';
export const frenchSharedLabels: SharedLabels = {
  sharedTimestamp: (at: string) => formatTimestamp(at, 'fr'),
  sharedMembers: 'Membres', sharedMemberCount: (count: number) => `${count} membres`,
  sharedAgent: 'Agent', sharedVia: (name: string) => `via ${name}`,
  sharedWorking: (name: string) => `${name} travaille…`,
  sharedReply: 'Répondre', sharedCancelReply: 'Annuler la réponse', sharedEarlierMessage: 'Message précédent',
  sharedAdmin: 'Admin', sharedHere: 'Présent', sharedAway: 'Absent', sharedOffline: 'Hors ligne',
  sharedRemoved: 'Message supprimé', sharedSince: (time: string) => `Depuis ${time}`,
  sharedRole: member => roleLine(member, { owner: 'propriétaire', validator: 'validateur', member: 'membre', agent: 'l\u2019agent de l\u2019app' }),
};
