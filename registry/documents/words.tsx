'use client';

// The words the documents block shows: its own, and the viewers' (the pi-app labels the file viewer and the artifact panel read). One
// locale for both: `fr` takes the French sets, anything else English, and a `labels` object overrides any word of the block's own.
import type { ReactNode } from 'react';
import { defaultAppIcons, defaultAppLabels, AppTextProvider } from '../pi-app/app-labels';
import { frenchAppLabels } from '../pi-app/app-labels-fr';
import { defaultDocumentsLabels, frenchDocumentsLabels } from './documents-labels';
import type { DocumentsLabels } from './documents-labels';

export type DocumentsLocale = 'en' | 'fr';

/** The block's own words for `locale`, with the host's overrides. */
export function documentsLabels(locale: DocumentsLocale | undefined, given: Partial<DocumentsLabels> | undefined): DocumentsLabels {
  return { ...(locale === 'fr' ? frenchDocumentsLabels : defaultDocumentsLabels), ...given };
}

/** Provides the viewers' words for `locale` to the file viewer and the artifact panel below it. */
export function DocumentsWords({ locale, children }: { readonly locale: DocumentsLocale | undefined; readonly children: ReactNode }) {
  const labels = locale === 'fr' ? frenchAppLabels : defaultAppLabels;
  return <AppTextProvider value={{ labels, icons: defaultAppIcons }}>{children}</AppTextProvider>;
}
