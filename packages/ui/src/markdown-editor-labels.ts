import type { MarkdownEditorMenuLabels } from './viewer-components.js';
import { textDraftLabels, type TextDraftLabels } from './text-draft-labels.js';

/**
 * Every word the markdown editor draws itself. `locale` picks the English or French set; `labels` overrides single keys
 * (for example `{ saved: 'Enregistré', sourceName: title => title }`). Text a host supplies (`title`, `placeholder`, a save
 * result's `reason`) is shown as given.
 */
export interface MarkdownEditorLabels extends MarkdownEditorMenuLabels, TextDraftLabels {
  readonly formatting: string;
  readonly readOnly: string;
  readonly closed: string;
  readonly saving: string;
  readonly saveUnconfirmed: string;
  readonly changedElsewhere: string;
  readonly unsaved: string;
  readonly saved: string;
  readonly save: string;
  readonly defaultTitle: string;
  readonly defaultPlaceholder: string;
  /** Accessible name of the Markdown source box. */
  readonly sourceName: (title: string) => string;
  /** Accessible name of the rich text surface. */
  readonly richName: (title: string) => string;
  readonly textFormatting: string;
  readonly bold: string;
  readonly italic: string;
  readonly strike: string;
  readonly highlight: string;
  readonly code: string;
  readonly heading: (level: 1 | 2 | 3) => string;
  readonly bulletList: string;
  readonly numberedList: string;
  readonly taskList: string;
  readonly quote: string;
  readonly codeBlock: string;
  readonly link: string;
  readonly table: string;
  readonly horizontalRule: string;
  readonly addTableRow: string;
  readonly addTableColumn: string;
  readonly deleteTable: string;
  readonly linkAddress: string;
  readonly applyLink: string;
  readonly removeLink: string;
  readonly cancel: string;
  readonly documentOutline: string;
  readonly goToHeading: (text: string) => string;
  readonly untitledHeading: string;
  readonly headingNotSelected: string;
  readonly uncertainNotice: string;
  readonly checkSaveOutcome: string;
  readonly stopChecking: string;
  readonly conflictNotice: string;
  readonly checkSavedVersion: string;
  readonly discardLocal: string;
  readonly conflictFallback: string;
  readonly saveFallback: string;
  readonly saveFailed: string;
  readonly operationFailed: string;
  /** The source-only notice. `reasons` are the kit's English reason names; the French set translates the known ones. */
  readonly richOff: (reasons: readonly string[]) => string;
  readonly proposedEdit: string;
  readonly reviewChanges: string;
  readonly exactBeforeAfter: string;
  readonly before: string;
  readonly after: string;
  readonly adopted: string;
  readonly acceptAndSave: string;
  readonly dismissProposal: string;
}

export type MarkdownEditorLabelOverrides = Partial<MarkdownEditorLabels>;

const frenchReasons: Record<string, string> = {
  'bare carriage returns': 'des retours chariot isolés',
  'mixed line endings': 'des fins de ligne mélangées',
  'NUL characters': 'des caractères NUL',
  'blocks whose source spans the rich editor cannot retain': 'des blocs dont la source ne peut pas être conservée à l’identique',
  'content the rich editor cannot read': 'un contenu que l’éditeur mis en forme ne sait pas lire',
};

export const markdownEditorLabels: Record<'en' | 'fr', MarkdownEditorLabels> = {
  en: {
    ...textDraftLabels.en,
    moreActions: 'More actions', editorMode: 'Editor mode', formatted: 'Formatted', markdown: 'Markdown', showOutline: 'Show outline',
    formatting: 'Formatting', readOnly: 'Read only', closed: 'Closed', saving: 'Saving…', saveUnconfirmed: 'Save unconfirmed',
    changedElsewhere: 'Changed elsewhere', unsaved: 'Unsaved changes', saved: 'Saved', save: 'Save',
    defaultTitle: 'Document', defaultPlaceholder: 'Start writing',
    sourceName: title => `${title} Markdown source`, richName: title => `${title} rich text`, textFormatting: 'Text formatting',
    bold: 'Bold', italic: 'Italic', strike: 'Strikethrough', highlight: 'Highlight', code: 'Code',
    heading: level => `Heading ${level}`, bulletList: 'Bullet list', numberedList: 'Numbered list', taskList: 'Task list',
    quote: 'Quote', codeBlock: 'Code block', link: 'Link', table: 'Table', horizontalRule: 'Horizontal rule',
    addTableRow: 'Add table row', addTableColumn: 'Add table column', deleteTable: 'Delete table',
    linkAddress: 'Link address', applyLink: 'Apply link', removeLink: 'Remove link', cancel: 'Cancel',
    documentOutline: 'Document outline', goToHeading: text => `Go to heading: ${text}`, untitledHeading: 'Untitled heading',
    headingNotSelected: 'The heading could not be selected',
    uncertainNotice: 'Save acknowledgement was lost. Keep editing while its outcome is checked.',
    checkSaveOutcome: 'Check save outcome', stopChecking: 'Stop checking and refresh, keeping my draft',
    conflictNotice: 'The saved document changed. Your local text has been kept.',
    checkSavedVersion: 'Check saved version', discardLocal: 'Discard local changes and reload',
    conflictFallback: 'The document changed elsewhere. Your text is still available.',
    saveFallback: 'The document could not be saved. Your text is still available.',
    saveFailed: 'The save could not be completed. Your text is still available.',
    operationFailed: 'The operation could not be completed. Your text is still available.',
    richOff: reasons => `Rich editing is off because this document contains ${reasons.join(', ')}, which it could not keep exactly. You can still edit the Markdown source.`,
    proposedEdit: 'Proposed edit', reviewChanges: 'Review text changes', exactBeforeAfter: 'Exact before and after', before: 'Before', after: 'After',
    adopted: 'Adopted', acceptAndSave: 'Accept and save', dismissProposal: 'Dismiss proposal',
  },
  fr: {
    ...textDraftLabels.fr,
    moreActions: 'Plus d’actions', editorMode: 'Mode d’édition', formatted: 'Mis en forme', markdown: 'Markdown', showOutline: 'Afficher le plan',
    formatting: 'Mise en forme', readOnly: 'Lecture seule', closed: 'Fermé', saving: 'Enregistrement…', saveUnconfirmed: 'Enregistrement non confirmé',
    changedElsewhere: 'Modifié ailleurs', unsaved: 'Modifications non enregistrées', saved: 'Enregistré', save: 'Enregistrer',
    defaultTitle: 'Document', defaultPlaceholder: 'Commencez à écrire',
    sourceName: title => `${title}, source Markdown`, richName: title => `${title}, texte mis en forme`, textFormatting: 'Mise en forme du texte',
    bold: 'Gras', italic: 'Italique', strike: 'Barré', highlight: 'Surligné', code: 'Code',
    heading: level => `Titre ${level}`, bulletList: 'Liste à puces', numberedList: 'Liste numérotée', taskList: 'Liste de tâches',
    quote: 'Citation', codeBlock: 'Bloc de code', link: 'Lien', table: 'Tableau', horizontalRule: 'Ligne de séparation',
    addTableRow: 'Ajouter une ligne', addTableColumn: 'Ajouter une colonne', deleteTable: 'Supprimer le tableau',
    linkAddress: 'Adresse du lien', applyLink: 'Appliquer le lien', removeLink: 'Retirer le lien', cancel: 'Annuler',
    documentOutline: 'Plan du document', goToHeading: text => `Aller au titre : ${text}`, untitledHeading: 'Titre sans nom',
    headingNotSelected: 'Le titre n’a pas pu être sélectionné',
    uncertainNotice: 'L’accusé d’enregistrement a été perdu. Continuez à écrire pendant que le résultat est vérifié.',
    checkSaveOutcome: 'Vérifier l’enregistrement', stopChecking: 'Arrêter la vérification et actualiser, en gardant mon brouillon',
    conflictNotice: 'Le document enregistré a changé. Votre texte local a été conservé.',
    checkSavedVersion: 'Vérifier la version enregistrée', discardLocal: 'Abandonner mes modifications et recharger',
    conflictFallback: 'Le document a été modifié ailleurs. Votre texte est toujours disponible.',
    saveFallback: 'Le document n’a pas pu être enregistré. Votre texte est toujours disponible.',
    saveFailed: 'L’enregistrement n’a pas pu aboutir. Votre texte est toujours disponible.',
    operationFailed: 'L’opération n’a pas pu aboutir. Votre texte est toujours disponible.',
    richOff: reasons => `La mise en forme est désactivée car ce document contient ${reasons.map(reason => frenchReasons[reason] ?? reason).join(', ')}, qu’elle ne saurait pas conserver à l’identique. Vous pouvez toujours modifier la source Markdown.`,
    proposedEdit: 'Modification proposée', reviewChanges: 'Examiner les changements', exactBeforeAfter: 'Avant et après, à l’identique', before: 'Avant', after: 'Après',
    adopted: 'Adoptée', acceptAndSave: 'Accepter et enregistrer', dismissProposal: 'Ignorer la proposition',
  },
};

export function resolveMarkdownEditorLabels(locale: 'en' | 'fr', overrides?: MarkdownEditorLabelOverrides): MarkdownEditorLabels {
  return overrides ? { ...markdownEditorLabels[locale], ...overrides } : markdownEditorLabels[locale];
}
