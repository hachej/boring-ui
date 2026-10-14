'use client';

// The words the documents block shows: its own, and the viewers' (the pi-app labels the file viewer and the artifact panel read, and the
// viewer window's labels the viewer bars read). One locale for all of them: `fr` takes the French sets, anything else English, and a
// `labels` object overrides any word of the block's own.
import type { ReactNode } from 'react';
import { defaultAppIcons, defaultAppLabels, AppTextProvider } from '../pi-app/app-labels';
import { frenchAppLabels } from '../pi-app/app-labels-fr';
import { defaultViewerIcons, defaultViewerLabels, ViewerWindowProvider } from '../viewers/viewer-window';
import { frenchViewerLabels } from '../viewers/viewer-labels-fr';
import { defaultDocumentsLabels, frenchDocumentsLabels } from './documents-labels';
import type { DocumentsLabels } from './documents-labels';

export type DocumentsLocale = 'en' | 'fr';

/** The block's own words for `locale`, with the host's overrides. */
export function documentsLabels(locale: DocumentsLocale | undefined, given: Partial<DocumentsLabels> | undefined): DocumentsLabels {
  return { ...(locale === 'fr' ? frenchDocumentsLabels : defaultDocumentsLabels), ...given };
}

/** Provides the app's and the viewers' words for `locale` to everything below (the file viewer, the artifact panel, the viewer bars). */
export function DocumentsWords({ locale, children }: { readonly locale: DocumentsLocale | undefined; readonly children: ReactNode }) {
  const fr = locale === 'fr';
  return <AppTextProvider value={{ labels: fr ? frenchAppLabels : defaultAppLabels, icons: defaultAppIcons }}>
    <ViewerWindowProvider value={{ labels: fr ? frenchViewerLabels : defaultViewerLabels, icons: defaultViewerIcons }}>{children}</ViewerWindowProvider>
  </AppTextProvider>;
}
