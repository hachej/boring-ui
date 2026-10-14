// The live preview's own words, one fixed set of keys per language (as the app shell's text.ts).
export type PreviewLocale = 'en' | 'fr';

export interface PreviewText {
  /** The banner's title, followed by the preview's title. */
  readonly banner: string;
  readonly close: string;
  /** Proposes the change for review (shown only when the host gives `onSharePreview`). */
  readonly share: string;
  /** Shown after a share: the change is proposed, not applied. */
  readonly proposed: string;
  readonly seeProposal: string;
  /** The chat card's button label. */
  readonly preview: string;
  readonly loading: string;
  readonly intent: (name: string, args: string) => string;
}

const en: PreviewText = { banner: 'Preview', close: 'Close', share: 'Share', proposed: 'Proposed — visible once deployed', seeProposal: 'See the proposal', preview: 'Preview', loading: 'Loading the preview…', intent: (name, args) => `Intent: ${name}(${args.slice(1, -1)})` };
const fr: PreviewText = { banner: 'Prévisualisation', close: 'Fermer', share: 'Partager', proposed: 'Proposé — visible après mise en ligne', seeProposal: 'Voir la proposition', preview: 'Prévisualiser', loading: 'Chargement de la prévisualisation…', intent: (name, args) => `Intention : ${name}(${args.slice(1, -1)})` };

export function previewText(locale: PreviewLocale): PreviewText {
  return locale === 'fr' ? fr : en;
}
