// The live preview's own words, one fixed set of keys per language (as the app shell's text.ts).
export type PreviewLocale = 'en' | 'fr';

export interface PreviewText {
  /** The banner's title. */
  readonly banner: string;
  /** The toggle that hides or shows the overlays. */
  readonly show: string;
  readonly hide: string;
  /** Removes every overlay at once. */
  readonly cancelAll: string;
  /** Proposes the change for review (shown only when the host gives `onShare`). */
  readonly share: string;
  /** Shown after a share: the change is proposed, not applied. */
  readonly proposed: string;
  readonly seeProposal: string;
  /** The neutral box a replaced component shows in its slot. */
  readonly unavailable: string;
  /** The chat card's button label. */
  readonly preview: string;
  readonly closeKey: (key: string) => string;
}

const en: PreviewText = {
  banner: 'Preview',
  show: 'Show',
  hide: 'Hide',
  cancelAll: 'Cancel all',
  share: 'Share',
  proposed: 'Proposed — visible once deployed',
  seeProposal: 'See the proposal',
  unavailable: 'Preview unavailable',
  preview: 'Preview',
  closeKey: key => `Close the preview of ${key}`,
};

const fr: PreviewText = {
  banner: 'Prévisualisation',
  show: 'Afficher',
  hide: 'Masquer',
  cancelAll: 'Tout annuler',
  share: 'Partager',
  proposed: 'Proposé — visible après mise en ligne',
  seeProposal: 'Voir la proposition',
  unavailable: 'Aperçu indisponible',
  preview: 'Prévisualiser',
  closeKey: key => `Fermer la prévisualisation de ${key}`,
};

export function previewText(locale: PreviewLocale): PreviewText {
  return locale === 'fr' ? fr : en;
}
