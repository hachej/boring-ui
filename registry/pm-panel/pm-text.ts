/** Spec 1 §9 and spec 2's strings, character for character: FR for the app, EN for Studio. */
export interface PmText {
  readonly locale: 'fr' | 'en';
  readonly placeholderBefore: string;
  readonly placeholderAfter: string;
  readonly hintIdle: string;
  readonly hintRec: string;
  /** The touch strip's C4 hint when the whole one would take more than two lines (spec 1 §2). */
  readonly hintRecShort: string;
  readonly mode: string;
  readonly select: string;
  readonly navigate: string;
  readonly done: string;
  readonly doneLabel: string;
  readonly speak: string;
  readonly recorder: string;
  readonly attach: string;
  readonly dictate: string;
  readonly send: string;
  readonly remove: string;
  readonly show: string;
  readonly showTitle: string;
  readonly meta: (seconds: number | undefined, captures: number) => string;
  readonly sentMeta: (seconds: number | undefined, captures: number) => string;
  readonly mentionHeader: (query: string) => string;
  readonly onYou: string;
  readonly added: (n: number, kind: string, label: string) => string;
  readonly removed: (n: number) => string;
  readonly title: string;
  readonly openPanel: string;
  readonly close: string;
  readonly review: string;
  readonly requests: string;
  readonly back: string;
  readonly subtitle: (app: string) => string;
  /** Click to comment (desktop, spec 1 §3b). */
  readonly commentOn: (kind: string, label: string) => string;
  readonly commentPlaceholder: string;
  readonly addToMessage: string;
  readonly sendToPm: string;
  readonly sentToPm: string;
}

/** `0:14`: whole seconds, never a fraction. */
export const clock = (seconds: number): string => {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
};
const captures = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export const pmTextFr: PmText = {
  locale: 'fr',
  placeholderBefore: 'Décrivez le problème, ou ', placeholderAfter: ' pour me le montrer.',
  hintIdle: 'Touchez ce que vous voulez montrer', hintRec: 'Parlez et touchez ce que vous montrez', hintRecShort: 'Parlez et touchez',
  mode: 'Mode', select: 'Sélectionner', navigate: 'Naviguer', done: 'Terminer', doneLabel: 'Terminer : relire dans le composer', speak: 'Parler',
  recorder: 'Ouvrir l’enregistreur', attach: 'Joindre un fichier', dictate: 'Dicter', send: 'Envoyer', remove: 'Retirer', show: 'Montrer', showTitle: 'Montrer',
  meta: (seconds, n) => seconds === undefined ? `Écrit · ${captures(n, 'capture', 'captures')}` : `Dicté · ${clock(seconds)} · ${captures(n, 'capture', 'captures')} · modifiable`,
  sentMeta: (seconds, n) => seconds === undefined ? `Écrit · ${captures(n, 'capture', 'captures')}` : `Dicté · ${clock(seconds)} · ${captures(n, 'capture', 'captures')}`,
  mentionHeader: query => `TÂCHES · ${query}`, onYou: 'À vous',
  added: (n, kind, label) => `Élément ${n} ajouté : ${kind} · ${label}`, removed: n => `Élément ${n} retiré`,
  title: 'Améliorer l’app', openPanel: 'Ouvrir le panneau', close: 'Fermer', review: 'Relisez, puis envoyez', requests: 'Mes demandes', back: '‹ Retour',
  subtitle: app => `Le chef de projet · ${app}`,
  commentOn: (kind, label) => `Commenter ${kind} · ${label}`, commentPlaceholder: 'Votre commentaire…', addToMessage: 'Ajouter au message', sendToPm: 'Envoyer au PM', sentToPm: 'Envoyé au PM',
};

export const pmTextEn: PmText = {
  locale: 'en',
  placeholderBefore: 'Describe the problem, or ', placeholderAfter: ' to show me',
  hintIdle: 'Tap what you want to show', hintRec: 'Speak and tap what you show', hintRecShort: 'Speak and tap',
  mode: 'Mode', select: 'Select', navigate: 'Navigate', done: 'Done', doneLabel: 'Done: reread in the composer', speak: 'Speak',
  recorder: 'Open the recorder', attach: 'Attach a file', dictate: 'Dictate', send: 'Send', remove: 'Remove', show: 'Montrer', showTitle: 'Montrer: point at the app',
  meta: (seconds, n) => seconds === undefined ? `Written · ${captures(n, 'capture', 'captures')}` : `Dictated · ${clock(seconds)} · ${captures(n, 'capture', 'captures')} · editable`,
  sentMeta: (seconds, n) => seconds === undefined ? `Written · ${captures(n, 'capture', 'captures')}` : `Dictated · ${clock(seconds)} · ${captures(n, 'capture', 'captures')}`,
  mentionHeader: query => `TASKS · ${query}`, onYou: 'On you',
  added: (n, kind, label) => `Item ${n} added: ${kind} · ${label}`, removed: n => `Item ${n} removed`,
  title: 'Improve the app', openPanel: 'Open the panel', close: 'Close', review: 'Review, then send', requests: 'My requests', back: '‹ Back',
  subtitle: app => `The project lead · ${app}`,
  commentOn: (kind, label) => `Comment on ${kind} · ${label}`, commentPlaceholder: 'Your comment…', addToMessage: 'Add to message', sendToPm: 'Send to the PM', sentToPm: 'Sent to the PM',
};

export const pmTextFor = (locale: string | undefined): PmText => locale?.startsWith('en') ? pmTextEn : pmTextFr;
