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
  /** The pin's one-line desktop hint: holding Alt passes clicks to the app. */
  readonly altHint: string;
  /** The pin's field label, its Add button, and the mic inside the field (record, stop, transcribing, nothing heard, failed). */
  readonly add: string;
  readonly voiceRecord: string;
  readonly voiceStop: string;
  readonly voiceTranscribing: string;
  readonly voiceNothing: string;
  readonly voiceFailed: string;
  /** Announced when the selection was cancelled, so a screen reader hears that the zone is gone. */
  readonly selectionCancelled: string;
  /** Point mode's bar (phones): the hint, the count of picks, Done, Cancel and the "use the app" toggle with its hint. */
  readonly pointHint: string;
  readonly pointCount: (count: number) => string;
  readonly pointDone: string;
  readonly pointCancel: string;
  readonly pointUseApp: string;
  readonly pointUsing: string;
  readonly pointBar: string;
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
  altHint: 'Hold ⌥ to use the app',
  add: 'Add note',
  voiceRecord: 'Speak your note',
  voiceStop: 'Stop recording',
  voiceTranscribing: 'Transcribing…',
  voiceNothing: 'Nothing was heard. Your text is kept.',
  voiceFailed: 'The recording could not be transcribed. Your text is kept.',
  selectionCancelled: 'Selection cancelled.',
  pointHint: 'Tap an element to comment',
  pointCount: count => `${count} ${count === 1 ? 'selection' : 'selections'}`,
  pointDone: 'Done',
  pointCancel: 'Cancel',
  pointUseApp: 'Use the app',
  pointUsing: 'Use the app, then come back to comment',
  pointBar: 'Point mode',
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
  bubblePlaceholder: "Qu'est-ce qui ne va pas ici ?",
  altHint: 'Maintenez ⌥ pour utiliser l’app',
  add: 'Ajouter la note',
  voiceRecord: 'Dicter votre note',
  voiceStop: 'Arrêter l’enregistrement',
  voiceTranscribing: 'Transcription…',
  voiceNothing: 'Rien n’a été entendu. Votre texte est conservé.',
  voiceFailed: 'L’enregistrement n’a pas pu être transcrit. Votre texte est conservé.',
  selectionCancelled: 'Sélection annulée.',
  pointHint: 'Touchez un élément à commenter',
  pointCount: count => `${count} ${count <= 1 ? 'sélection' : 'sélections'}`,
  pointDone: 'Terminé',
  pointCancel: 'Annuler',
  pointUseApp: 'Utiliser l’app',
  pointUsing: 'Utilisez l’app, puis revenez commenter',
  pointBar: 'Mode pointage',
};

/** The default labels with the host's overrides on top. */
export const withLabels = (labels?: Partial<FeedbackLabels>): FeedbackLabels => (labels ? { ...feedbackLabels, ...labels } : feedbackLabels);
