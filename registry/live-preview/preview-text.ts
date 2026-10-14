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
  /** In the banner when the overlay's key matches no mounted Replaceable. */
  readonly absent: string;
  /** A share refused with `file_changed`: the file moved on since the PM wrote this version. */
  readonly fileChanged: string;
  /** The heading of the context lines that tell the PM which parts it can replace. */
  readonly replaceables: string;
  readonly intent: (name: string, args: string) => string;
}

const en: PreviewText = { banner: 'Preview', close: 'Close', share: 'Share', proposed: 'Proposed — visible once deployed', seeProposal: 'See the proposal', preview: 'Preview', absent: "This part isn't on screen", fileChanged: 'The file changed since this version — ask the PM to regenerate it', replaceables: 'Replaceable parts:', intent: (name, args) => `Intent: ${name}(${args.slice(1, -1)})` };
const fr: PreviewText = { banner: 'Prévisualisation', close: 'Fermer', share: 'Partager', proposed: 'Proposé — visible après mise en ligne', seeProposal: 'Voir la proposition', preview: 'Prévisualiser', absent: 'Cette partie n’est pas à l’écran', fileChanged: 'Le fichier a changé depuis cette version — demande au PM de régénérer', replaceables: 'Parties remplaçables:', intent: (name, args) => `Intention : ${name}(${args.slice(1, -1)})` };

export function previewText(locale: PreviewLocale): PreviewText {
  return locale === 'fr' ? fr : en;
}
