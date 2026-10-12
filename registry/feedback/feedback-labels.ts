// The words of the feedback controls that cancel a selection and ask a general question, as data. The defaults are English, like the
// rest of the copied components; `feedbackLabelsFr` is the French set (pass it as `labels` to AnnotateSheet, FeedbackBar and
// NoteBubble). A host may pass any subset: what it leaves out keeps the default.
export interface FeedbackLabels {
  /** The annotate sheet's title for a selected zone, and the bubble's accessible name prefix is `note`. */
  readonly title: string;
  readonly close: string;
  /** The button that drops the selected zone and keeps what was typed. */
  readonly cancelSelection: string;
  /** The entry point (bar button, sheet button, general sheet title): a note with no element attached. */
  readonly askGeneral: string;
  readonly generalPlaceholder: string;
  readonly generalHint: string;
  /** The sheet's field label for a selected zone / for a general question. */
  readonly changeField: string;
  readonly generalField: string;
  readonly copyReport: string;
  readonly save: string;
  readonly saveAgain: string;
  readonly saving: string;
  readonly saved: string;
  readonly bubblePlaceholder: string;
  readonly bubbleHint: string;
  /** Announced when the selection was cancelled, so a screen reader hears that the zone is gone. */
  readonly selectionCancelled: string;
  readonly generalOpened: string;
}

export const feedbackLabels: FeedbackLabels = {
  title: 'Feedback',
  close: 'Close',
  cancelSelection: 'Cancel selection',
  askGeneral: 'Ask a general question',
  generalPlaceholder: 'Your question (no element attached)',
  generalHint: 'Esc to close · Done to send',
  changeField: 'What should change?',
  generalField: 'Your question',
  copyReport: 'Copy report',
  save: 'Save',
  saveAgain: 'Save again',
  saving: 'Saving…',
  saved: 'Saved',
  bubblePlaceholder: "What's wrong here?",
  bubbleHint: 'Enter to save · Esc to discard',
  selectionCancelled: 'Selection cancelled.',
  generalOpened: 'General question: no element attached.',
};

export const feedbackLabelsFr: FeedbackLabels = {
  title: 'Retour',
  close: 'Fermer',
  cancelSelection: 'Annuler la sélection',
  askGeneral: 'Poser une question générale',
  generalPlaceholder: 'Votre question (sans zone)',
  generalHint: 'Échap pour fermer · Terminé pour envoyer',
  changeField: 'Que faut-il changer ?',
  generalField: 'Votre question',
  copyReport: 'Copier le rapport',
  save: 'Enregistrer',
  saveAgain: 'Enregistrer à nouveau',
  saving: 'Enregistrement…',
  saved: 'Enregistré',
  bubblePlaceholder: "Qu'est-ce qui ne va pas ici ?",
  bubbleHint: 'Entrée pour valider · Échap pour annuler',
  selectionCancelled: 'Sélection annulée.',
  generalOpened: 'Question générale : aucune zone sélectionnée.',
};

/** The default labels with the host's overrides on top. */
export const withLabels = (labels?: Partial<FeedbackLabels>): FeedbackLabels => (labels ? { ...feedbackLabels, ...labels } : feedbackLabels);
