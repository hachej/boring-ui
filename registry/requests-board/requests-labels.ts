import type { RequestFilter, RequestLink, RequestState } from './requests';

export type RequestsLocale = 'en' | 'fr';
export const defaultRequestsLabels = {
  title: 'Requests', search: 'Search requests', repositories: 'Repositories', allRepos: 'All repositories',
  filters: { yours: 'For you', active: 'In progress', live: 'Live', abandoned: 'Abandoned' } as Record<RequestFilter, string>,
  states: { question: 'Question', try: 'To try', validation: 'Approval', building: 'Building', checking: 'Checking', live: 'Live', abandoned: 'Abandoned' } as Record<RequestState, string>,
  links: { parent: 'Parent', child: 'Child', blocked_by: 'Blocked by' } as Record<RequestLink['kind'], string>,
  openAll: (count: number) => `See all ${count} requests`,
  changed: (number: string, state: string) => `${number}: ${state.toLocaleLowerCase()}`,
  back: 'Back', choose: 'Choose a request', empty: 'No requests', emptyDescription: 'Try another filter or search.',
  since: 'Since', waitsOn: 'Waiting on', history: 'History', related: 'Related requests', master: 'Master',
  tryVersion: 'Try this version', answer: 'Answer', yourAnswer: 'Your answer', approve: 'Approve', later: 'Later',
};
export type RequestsLabels = typeof defaultRequestsLabels;
export const frenchRequestsLabels: RequestsLabels = {
  title: 'Demandes', search: 'Rechercher une demande', repositories: 'Dépôts', allRepos: 'Tous les dépôts',
  filters: { yours: 'À vous', active: 'En cours', live: 'En ligne', abandoned: 'Abandonnées' },
  states: { question: 'Question', try: 'À essayer', validation: 'Validation', building: 'En construction', checking: 'En vérification', live: 'En ligne', abandoned: 'Abandonnée' },
  links: { parent: 'Parente', child: 'Enfant', blocked_by: 'Bloquée par' },
  openAll: count => `Voir les ${count} demandes`, changed: (number, state) => `${number} : ${state.toLocaleLowerCase('fr')}`,
  back: 'Retour', choose: 'Choisissez une demande', empty: 'Aucune demande', emptyDescription: 'Essayez un autre filtre ou une autre recherche.',
  since: 'Depuis', waitsOn: 'Attend', history: 'Historique', related: 'Demandes liées', master: 'Master',
  tryVersion: 'Essayer cette version', answer: 'Répondre', yourAnswer: 'Votre réponse', approve: 'Approuver', later: 'Plus tard',
};
export const requestsLabelsFor = (locale: RequestsLocale | undefined, labels?: Partial<RequestsLabels>): RequestsLabels =>
  ({ ...(locale === 'fr' ? frenchRequestsLabels : defaultRequestsLabels), ...labels });
