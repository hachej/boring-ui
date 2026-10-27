/** The draft-recovery panel's words. English is the default; `locale="fr"` selects the French set; a host overrides any key. */
export interface TextDraftLabels {
  readonly draftRecovery: string;
  /** `kind` is the recovery state when recovery is not active, e.g. `disabled`. */
  readonly draftRecoveryState: (kind: string) => string;
  readonly draftChecking: string;
  readonly draftStoring: string;
  readonly draftStored: string;
  readonly draftStorageUnavailable: string;
  readonly draftEnabled: string;
  readonly checkStoredDrafts: string;
  readonly storeDraft: string;
  readonly noStoredDrafts: string;
  readonly moreStoredDrafts: string;
  readonly storedDraft: string;
  readonly draftConflict: string;
  readonly draftMatches: string;
  readonly reviewStoredDraft: string;
  readonly restoreDraft: string;
  readonly discardStoredDraft: string;
  readonly draftRestored: string;
  readonly draftDiscarded: string;
  readonly draftStorageFailed: string;
}

export const textDraftLabels: Record<'en' | 'fr', TextDraftLabels> = {
  en: {
    draftRecovery: 'Draft recovery',
    draftRecoveryState: kind => `Draft recovery ${kind}`,
    draftChecking: 'Checking stored drafts',
    draftStoring: 'Storing draft',
    draftStored: 'Draft stored for recovery. Storage is not a save receipt.',
    draftStorageUnavailable: 'Draft recovery storage unavailable',
    draftEnabled: 'Draft recovery enabled',
    checkStoredDrafts: 'Check stored drafts',
    storeDraft: 'Store draft for recovery',
    noStoredDrafts: 'No stored drafts',
    moreStoredDrafts: 'More stored drafts exist than this listing shows.',
    storedDraft: 'Stored draft',
    draftConflict: 'Saved revision changed. Review this draft separately.',
    draftMatches: 'Stored draft matches the checked saved revision.',
    reviewStoredDraft: 'Review stored draft',
    restoreDraft: 'Restore draft',
    discardStoredDraft: 'Discard stored draft',
    draftRestored: 'Draft restored locally. Save to publish it.',
    draftDiscarded: 'Stored draft discarded. Current edits are unchanged.',
    draftStorageFailed: 'Draft storage unavailable. Current edits are unchanged.',
  },
  fr: {
    draftRecovery: 'Récupération de brouillon',
    draftRecoveryState: kind => `Récupération de brouillon : ${kind}`,
    draftChecking: 'Recherche des brouillons enregistrés',
    draftStoring: 'Enregistrement du brouillon',
    draftStored: 'Brouillon conservé pour récupération. Ce n’est pas un enregistrement du document.',
    draftStorageUnavailable: 'Stockage des brouillons indisponible',
    draftEnabled: 'Récupération de brouillon activée',
    checkStoredDrafts: 'Chercher les brouillons enregistrés',
    storeDraft: 'Conserver le brouillon pour récupération',
    noStoredDrafts: 'Aucun brouillon enregistré',
    moreStoredDrafts: 'Il existe d’autres brouillons que ceux listés ici.',
    storedDraft: 'Brouillon enregistré',
    draftConflict: 'La version enregistrée a changé. Examinez ce brouillon à part.',
    draftMatches: 'Ce brouillon correspond à la version enregistrée vérifiée.',
    reviewStoredDraft: 'Examiner le brouillon',
    restoreDraft: 'Restaurer le brouillon',
    discardStoredDraft: 'Supprimer le brouillon',
    draftRestored: 'Brouillon restauré localement. Enregistrez pour le publier.',
    draftDiscarded: 'Brouillon supprimé. Vos modifications actuelles sont inchangées.',
    draftStorageFailed: 'Stockage des brouillons indisponible. Vos modifications actuelles sont inchangées.',
  },
};
