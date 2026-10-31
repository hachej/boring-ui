export type AudienceLocale = 'en' | 'fr';

export const defaultAudienceLabels = {
  title: 'Audience', visitsTitle: 'Landing page visits', visitsLast: (days: number) => `Last ${days} days`, total: 'Visits', day: 'Day', visits: 'Visits',
  outreachTitle: 'Outreach links', outreachHint: 'Visits through a link ending in ?ref=<id>', ref: 'Link', outreachShare: (percent: number) => `${percent}% of visits came through an outreach link`,
  noVisits: 'No visit yet', noVisitsDescription: 'Visits appear here once the landing page is shared.', noRefs: 'No outreach link visited yet',
  unavailable: 'Visit totals are not available on this host yet.', totalsOnly: 'Totals only: no address and no browser are kept.',
  requestsTitle: 'Access requests', requestsEmpty: 'No pending request', requestsInHub: 'Access requests are handled in the hub, on the app card.',
  email: 'Address', note: 'Note', since: 'Since', grant: 'Grant access', dismiss: 'Dismiss', revokedBefore: 'Had access before',
  usageTitle: 'Usage', usageHint: 'Counts only, never the data', sample: 'Tried the sample', ownFile: 'Used their own file', noUsage: 'This app does not count its usage yet.',
  formatDay: (day: string) => day,
  loading: 'Loading', failed: 'The audience could not be loaded.', retry: 'Try again',
};
export type AudienceLabels = typeof defaultAudienceLabels;

const dayFormat = (locale: string) => {
  const formatter = new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  return (day: string) => { const date = new Date(`${day}T00:00:00Z`); return Number.isNaN(date.getTime()) ? day : formatter.format(date); };
};

export const frenchAudienceLabels: AudienceLabels = {
  title: 'Audience', visitsTitle: 'Visites de la page d’accueil', visitsLast: (days) => `${days} derniers jours`, total: 'Visites', day: 'Jour', visits: 'Visites',
  outreachTitle: 'Liens de prospection', outreachHint: 'Visites par un lien terminé par ?ref=<id>', ref: 'Lien', outreachShare: (percent) => `${percent} % des visites viennent d’un lien de prospection`,
  noVisits: 'Aucune visite pour l’instant', noVisitsDescription: 'Les visites apparaissent ici dès que la page d’accueil est partagée.', noRefs: 'Aucun lien de prospection visité',
  unavailable: 'Les totaux de visites ne sont pas encore disponibles sur cet hébergeur.', totalsOnly: 'Des totaux uniquement : ni adresse ni navigateur ne sont conservés.',
  requestsTitle: 'Demandes d’accès', requestsEmpty: 'Aucune demande en attente', requestsInHub: 'Les demandes d’accès se traitent dans le hub, sur la carte de l’app.',
  email: 'Adresse', note: 'Note', since: 'Depuis', grant: 'Donner l’accès', dismiss: 'Écarter', revokedBefore: 'Avait déjà eu accès',
  usageTitle: 'Usage', usageHint: 'Des comptes uniquement, jamais les données', sample: 'Ont essayé l’exemple', ownFile: 'Ont utilisé leur propre fichier', noUsage: 'Cette app ne compte pas encore son usage.',
  formatDay: dayFormat('fr'),
  loading: 'Chargement', failed: 'L’audience n’a pas pu être chargée.', retry: 'Réessayer',
};

export function audienceLabelsFor(locale: AudienceLocale | undefined, overrides: Partial<AudienceLabels> = {}): AudienceLabels {
  const base = locale === 'fr' ? frenchAudienceLabels : { ...defaultAudienceLabels, formatDay: dayFormat('en') };
  return { ...base, ...overrides };
}
