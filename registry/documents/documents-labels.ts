/*
 * The words of the documents block as plain data: its own (the Library's title, the revisions panel, the sheet) in English and French. The
 * viewers it composes take their words from the pi-app block (`defaultAppLabels` / `frenchAppLabels`), which `Documents` provides.
 */
/** Who wrote a revision, as the history reports it. */
export type SavedByKind = 'publish' | 'agent' | 'observed';

export const defaultDocumentsLabels = {
  revisions: 'Revisions',
  noRevisions: 'No saved revisions yet.',
  revisionsLoading: 'Loading revisions…',
  latest: 'Latest',
  openRevision: (when: string) => `Open the version saved ${when}`,
  savedBy: { publish: 'saved', agent: 'written by the agent', observed: 'found in the workspace', rename: 'renamed', delete: 'deleted' } as Record<SavedByKind, string> & Partial<Record<'rename' | 'delete', string>>,
  unknownTime: 'time unknown',
  unsupportedPreview: 'Older versions of this kind have no preview here.',
  backToEditing: 'Back to editing',
  discardChanges: 'This document has unsaved changes. Leave without saving them?',
  readOnlyRevision: 'This version is read-only.',
  revisionLoadFailed: 'This version could not be read.',
  allDocuments: 'All documents',
  sheetTitle: 'Document',
};

export type DocumentsLabels = typeof defaultDocumentsLabels;

export const frenchDocumentsLabels: DocumentsLabels = {
  revisions: 'Versions',
  noRevisions: 'Aucune version enregistrée pour l’instant.',
  revisionsLoading: 'Chargement des versions…',
  latest: 'Dernière',
  openRevision: (when: string) => `Ouvrir la version enregistrée ${when}`,
  savedBy: { publish: 'enregistrée', agent: 'écrite par l’agent', observed: 'trouvée dans l’espace de travail', rename: 'renommée', delete: 'supprimée' },
  unknownTime: 'date inconnue',
  unsupportedPreview: 'Les anciennes versions de ce type ne s’affichent pas ici.',
  backToEditing: 'Revenir à la modification',
  discardChanges: 'Cette fiche contient des modifications non enregistrées. Quitter sans les enregistrer ?',
  readOnlyRevision: 'Cette version est en lecture seule.',
  revisionLoadFailed: 'Cette version n’a pas pu être lue.',
  allDocuments: 'Toutes les fiches',
  sheetTitle: 'Fiche',
};
