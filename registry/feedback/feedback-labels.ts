// The words of the feedback controls that cancel a selection, ask a general question and drive point mode, as data. The defaults are English, like the
// rest of the copied components; `feedbackLabelsFr` is the French set (pass it as `labels` to AnnotateSheet, FeedbackBar,
// NoteBubble and PointMode). A host may pass any subset: what it leaves out keeps the default.
export interface FeedbackLabels {
  /** The annotate sheet's title for a selected zone, and the bubble's accessible name prefix is `note`. */
  readonly title: string;
  readonly close: string;
  /** The button that drops the selected zone and keeps what was typed. */
  readonly cancelSelection: string;
  /** The entry point (bar button, sheet button, general sheet title): a note with no element attached. */
  readonly askGeneral: string;
  /** The sheet's field label for a selected zone / for a general question. */
  readonly changeField: string;
  readonly generalField: string;
  readonly copyReport: string;
  readonly save: string;
  readonly saveAgain: string;
  readonly saving: string;
  readonly saved: string;
  readonly bubblePlaceholder: string;
  /** The pin's field label, its Add button, and the mic inside the field (record, stop, transcribing, nothing heard, failed). */
  readonly add: string;
  readonly voiceRecord: string;
  readonly voiceStop: string;
  readonly voiceTranscribing: string;
  readonly voiceNothing: string;
  readonly voiceFailed: string;
  /** Announced when the selection was cancelled, so a screen reader hears that the zone is gone. */
  readonly selectionCancelled: string;
  /**
   * The comment-mode banner (CommentBanner): its title, the count of notes, the on/off switch's name, what to do while on (a tap on a
   * phone, a click with a mouse), what to do while off (use the app, then switch back on: the notes stay), and Done.
   */
  readonly commentMode: string;
  readonly pointCount: (count: number) => string;
  readonly commentSwitch: string;
  readonly commentTap: string;
  readonly commentClick: string;
  readonly commentPaused: string;
  /** Once notes went to the agent one by one (`useSendEachNote`): how many, and that the reply comes in the conversation. */
  readonly commentSent: (count: number) => string;
  readonly pointDone: string;
  /** The picked element in the note bubble, in plain words: its kind (by ARIA role or tag) and its visible name when it has one. */
  readonly element: (kind: string | undefined, name: string | undefined) => string;
}

/** The roles and tags people can name; anything else is « this element ». */
const KINDS_EN: Record<string, string> = { button: 'Button', link: 'Link', a: 'Link', heading: 'Title', img: 'Image', textbox: 'Field', input: 'Field', checkbox: 'Checkbox',
  combobox: 'List', listbox: 'List', option: 'Choice', tab: 'Tab', row: 'Row', listitem: 'Row', li: 'Row', cell: 'Cell', dialog: 'Window', navigation: 'Menu', menuitem: 'Menu item',
  article: 'Card', region: 'Card', group: 'Card', meter: 'Gauge', progressbar: 'Gauge', list: 'List', paragraph: 'Text', p: 'Text', span: 'Text' };
const KINDS_FR: Record<string, string> = { button: 'Bouton', link: 'Lien', a: 'Lien', heading: 'Titre', img: 'Image', textbox: 'Champ', input: 'Champ', checkbox: 'Case à cocher',
  combobox: 'Liste', listbox: 'Liste', option: 'Choix', tab: 'Onglet', row: 'Ligne', listitem: 'Ligne', li: 'Ligne', cell: 'Cellule', dialog: 'Fenêtre', navigation: 'Menu', menuitem: 'Entrée du menu',
  article: 'Carte', region: 'Carte', group: 'Carte', meter: 'Jauge', progressbar: 'Jauge', list: 'Liste', paragraph: 'Texte', p: 'Texte', span: 'Texte' };
const named = (kinds: Record<string, string>, unknown: string) => (kind: string | undefined, name: string | undefined): string => {
  const word = kind ? kinds[kind] : undefined;
  return name ? `${word ?? unknown} « ${name} »` : word ?? unknown;
};

/**
 * The picker's label (`button «Save»`, `button · masked`, `Form.tsx · link «Help»`, `masked`) in plain words: `Button « Save »`,
 * `Button`, `Link « Help »`, `This element`. Nothing technical (no component, no « masked »): what the policy hides stays hidden.
 */
export function plainElement(label: string, words: Pick<FeedbackLabels, 'element'>): string {
  const match = /(?:^|· )([a-z][a-z0-9-]*)(?: · masked| «(.*)»)$/.exec(label.trim());
  return words.element(match?.[1], match?.[2]?.trim() || undefined);
}

export const feedbackLabels: FeedbackLabels = {
  title: 'Feedback',
  close: 'Close',
  cancelSelection: 'Cancel selection',
  askGeneral: 'Ask a general question',
  changeField: 'What should change?',
  generalField: 'Your question',
  copyReport: 'Copy report',
  save: 'Save',
  saveAgain: 'Save again',
  saving: 'Saving…',
  saved: 'Saved',
  bubblePlaceholder: "What's wrong here?",
  add: 'Add note',
  voiceRecord: 'Hold to speak, release to send',
  voiceStop: 'Stop recording',
  voiceTranscribing: 'Transcribing…',
  voiceNothing: 'Nothing was heard. Your text is kept.',
  voiceFailed: 'The recording could not be transcribed. Your text is kept.',
  selectionCancelled: 'Selection cancelled.',
  commentMode: 'Comment mode',
  pointCount: count => `${count} ${count === 1 ? 'note' : 'notes'}`,
  commentSwitch: 'Comment',
  commentTap: 'Tap an element to comment on it',
  commentClick: 'Click an element to comment on it',
  commentPaused: 'Paused: use the app, then switch back on',
  commentSent: count => `${count === 1 ? 'Note sent' : `${count} notes sent`}: the reply comes in the conversation (Done)`,
  pointDone: 'Done',
  element: named(KINDS_EN, 'This element'),
};

export const feedbackLabelsFr: FeedbackLabels = {
  title: 'Retour',
  close: 'Fermer',
  cancelSelection: 'Annuler la sélection',
  askGeneral: 'Poser une question générale',
  changeField: 'Que faut-il changer ?',
  generalField: 'Votre question',
  copyReport: 'Copier le rapport',
  save: 'Enregistrer',
  saveAgain: 'Enregistrer à nouveau',
  saving: 'Enregistrement…',
  saved: 'Enregistré',
  bubblePlaceholder: "Qu’est-ce qui ne va pas ici ?",
  add: 'Ajouter la note',
  voiceRecord: 'Maintenez pour parler, relâchez pour envoyer',
  voiceStop: 'Arrêter l’enregistrement',
  voiceTranscribing: 'Transcription…',
  voiceNothing: 'Rien n’a été entendu. Votre texte est conservé.',
  voiceFailed: 'L’enregistrement n’a pas pu être transcrit. Votre texte est conservé.',
  selectionCancelled: 'Sélection annulée.',
  commentMode: 'Mode commentaire',
  pointCount: count => `${count} note${count > 1 ? 's' : ''}`,
  commentSwitch: 'Commenter',
  commentTap: 'Touchez un élément pour le commenter',
  commentClick: 'Cliquez sur un élément pour le commenter',
  commentPaused: 'En pause : utilisez l’app, puis réactivez',
  commentSent: count => `${count === 1 ? 'Note envoyée' : `${count} notes envoyées`} : la réponse arrive dans la conversation (Terminé)`,
  pointDone: 'Terminé',
  element: named(KINDS_FR, 'Cet élément'),
};

/** The default labels with the host's overrides on top. */
export const withLabels = (labels?: Partial<FeedbackLabels>): FeedbackLabels => (labels ? { ...feedbackLabels, ...labels } : feedbackLabels);
