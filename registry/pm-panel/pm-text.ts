/** Spec 1 §9 and spec 2's strings, character for character: FR for the app, EN for Studio. */
export interface PmText {
  readonly locale: 'fr' | 'en';
  readonly connecting: string;
  readonly connectionFailed: string;
  readonly retry: string;
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
  readonly awaiting: string;
  readonly preparing: string;
  readonly verifying: string;
  readonly blocked: string;
  readonly inProgress: string;
  readonly technical: string;
  readonly back: string;
  readonly subtitle: (app: string) => string;
  /** Click to comment (desktop, spec 1 §3b). */
  readonly commentOn: (kind: string, label: string) => string;
  readonly commentPlaceholder: string;
  readonly addToMessage: string;
  readonly sendToPm: string;
  readonly sentToPm: string;
  /** The request card's two answers (C7): « Modifier » goes back to the composer, « Confirmer » is the viewer's answer to the task. */
  readonly modify: string;
  readonly confirm: string;
  readonly confirming: string;
  readonly confirmFailed: string;
  readonly answerFailed: string;
  /** The requester withdraws a request nobody started (« Mes demandes », decided 2026-10-29): the action, its confirm step and its error line. */
  readonly withdraw: string;
  readonly withdrawAsk: string;
  readonly cancel: string;
  readonly withdrawFailed: string;
  /** « Mes demandes »' collapsed section of finished requests and their muted labels (decided 2026-10-29): shipped or done, withdrawn, any other close. */
  readonly finished: (n: number) => string;
  readonly outcomeLive: string;
  readonly outcomeWithdrawn: string;
  readonly outcomeClosed: string;
  /** The app panel's one muted line when the PM's run ends in error without a reply: the member never sees a tool or a raw error (C7). */
  readonly failed: string;
  /** A presented mockup (C7): the card's action, the line while it loads, and the line when its file can't be read. */
}

/** `0:14`: whole seconds, never a fraction. */
export const clock = (seconds: number): string => {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
};
const captures = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export const pmTextFr: PmText = {
  locale: 'fr', connecting: 'Connexion…', connectionFailed: 'La conversation est momentanément indisponible. Réessayez.', retry: 'Réessayer',
  placeholderBefore: 'Décrivez le problème, ou ', placeholderAfter: ' pour me le montrer.',
  hintIdle: 'Touchez ce que vous voulez montrer', hintRec: 'Parlez et touchez ce que vous montrez', hintRecShort: 'Parlez et touchez',
  mode: 'Mode', select: 'Sélectionner', navigate: 'Naviguer', done: 'Terminer', doneLabel: 'Terminer : relire dans le composer', speak: 'Parler',
  recorder: "Ouvrir l'enregistreur", attach: 'Joindre un fichier', dictate: 'Dicter', send: 'Envoyer', remove: 'Retirer', show: 'Montrer', showTitle: 'Montrer',
  meta: (seconds, n) => seconds === undefined ? `Écrit · ${captures(n, 'capture', 'captures')}` : `Dicté · ${clock(seconds)} · ${captures(n, 'capture', 'captures')} · modifiable`,
  sentMeta: (seconds, n) => seconds === undefined ? `Écrit · ${captures(n, 'capture', 'captures')}` : `Dicté · ${clock(seconds)} · ${captures(n, 'capture', 'captures')}`,
  mentionHeader: query => `TÂCHES · ${query}`, onYou: 'À vous',
  added: (n, kind, label) => `Élément ${n} ajouté : ${kind} · ${label}`, removed: n => `Élément ${n} retiré`,
  title: "Améliorer l'app", openPanel: 'Ouvrir le panneau', close: 'Fermer', review: 'Relisez, puis envoyez', requests: 'Mes demandes', back: '‹ Retour',
  awaiting: 'Attend votre avis', preparing: 'En préparation', verifying: 'Vérification', blocked: 'Bloqué', inProgress: 'En cours', technical: 'Technique',
  subtitle: app => `Le chef de projet · ${app}`,
  commentOn: (kind, label) => `Commenter ${kind} · ${label}`, commentPlaceholder: 'Votre commentaire…', addToMessage: 'Ajouter au message', sendToPm: 'Envoyer au PM', sentToPm: 'Envoyé au PM',
  modify: 'Modifier', confirm: 'Confirmer', confirming: 'Confirmation…', confirmFailed: 'Impossible de confirmer pour le moment. Réessayez.', answerFailed: 'L’envoi de votre réponse n’a pas pu être confirmé. Votre texte est conservé. Réessayez.', failed: "Le chef de projet n'a pas pu terminer. Réessayez.",
  withdraw: 'Retirer', withdrawAsk: 'Retirer cette demande\u00a0?', cancel: 'Annuler', withdrawFailed: 'Impossible de retirer la demande.',
  finished: n => `Terminées (${n})`, outcomeLive: 'En ligne', outcomeWithdrawn: 'Retirée', outcomeClosed: 'Fermée',
};

export const pmTextEn: PmText = {
  locale: 'en', connecting: 'Connecting…', connectionFailed: 'The conversation is temporarily unavailable. Try again.', retry: 'Try again',
  placeholderBefore: 'Describe the problem, or ', placeholderAfter: ' to show me',
  hintIdle: 'Tap what you want to show', hintRec: 'Speak and tap what you show', hintRecShort: 'Speak and tap',
  mode: 'Mode', select: 'Select', navigate: 'Navigate', done: 'Done', doneLabel: 'Done: reread in the composer', speak: 'Speak',
  recorder: 'Open the recorder', attach: 'Attach a file', dictate: 'Dictate', send: 'Send', remove: 'Remove', show: 'Montrer', showTitle: 'Montrer: point at the app',
  meta: (seconds, n) => seconds === undefined ? `Written · ${captures(n, 'capture', 'captures')}` : `Dictated · ${clock(seconds)} · ${captures(n, 'capture', 'captures')} · editable`,
  sentMeta: (seconds, n) => seconds === undefined ? `Written · ${captures(n, 'capture', 'captures')}` : `Dictated · ${clock(seconds)} · ${captures(n, 'capture', 'captures')}`,
  mentionHeader: query => `TASKS · ${query}`, onYou: 'On you',
  added: (n, kind, label) => `Item ${n} added: ${kind} · ${label}`, removed: n => `Item ${n} removed`,
  title: 'Improve the app', openPanel: 'Open the panel', close: 'Close', review: 'Review, then send', requests: 'My requests', back: '‹ Back',
  awaiting: 'Needs your input', preparing: 'In preparation', verifying: 'Verification', blocked: 'Blocked', inProgress: 'In progress', technical: 'Technical',
  subtitle: app => `The project lead · ${app}`,
  commentOn: (kind, label) => `Comment on ${kind} · ${label}`, commentPlaceholder: 'Your comment…', addToMessage: 'Add to message', sendToPm: 'Send to the PM', sentToPm: 'Sent to the PM',
  modify: 'Modify', confirm: 'Confirm', confirming: 'Confirming…', confirmFailed: 'Could not confirm right now. Try again.', answerFailed: 'Your answer could not be confirmed. Your text is kept. Try again.', failed: "The PM couldn't finish. Try again.",
  withdraw: 'Withdraw', withdrawAsk: 'Withdraw this request?', cancel: 'Cancel', withdrawFailed: "Couldn't withdraw the request.",
  finished: n => `Finished (${n})`, outcomeLive: 'Live', outcomeWithdrawn: 'Withdrawn', outcomeClosed: 'Closed',
};

export const pmTextFor = (locale: string | undefined): PmText => locale?.startsWith('en') ? pmTextEn : pmTextFr;
