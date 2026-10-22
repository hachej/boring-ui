'use client';

// The revisions of one file: what the workspace's history retains for it (`provider.history`, newest first), each with when it was saved and
// who wrote it (`source`). Every row opens that exact revision read-only; going back to editing is a separate control in the documents
// screen. The operation id is not shown: the public history carries none (a follow-up for the files seam).
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { RevisionProvider, SavedRevision } from '@hachej/boring-files/revision';
import type { DocumentsLabels } from './documents-labels';

interface Loaded { readonly provider: RevisionProvider; readonly path: string; readonly saves: readonly SavedRevision[] }

/**
 * The retained revisions of `path` read from `provider`, read again when `version` changes. The answer is kept with the provider and the
 * path it was read for: another provider or path gets `undefined` at once, and a late answer for one of them is dropped.
 */
export function useRevisions(provider: RevisionProvider, path: string, version: number): readonly SavedRevision[] | undefined {
  const [loaded, setLoaded] = useState<Loaded>();
  useEffect(() => {
    const abort = new AbortController();
    const save = (saves: readonly SavedRevision[]) => { if (!abort.signal.aborted) setLoaded({ provider, path, saves }); };
    provider.history(path, abort.signal).then(save, () => save([]));
    return () => abort.abort();
  }, [provider, path, version]);
  return loaded && loaded.provider === provider && loaded.path === path ? loaded.saves : undefined;
}

/** When a revision was saved, in the page's language; `savedAt` 0 means the journal did not record a time. */
export function whenSaved(savedAt: number, locale: string, unknown: string): string {
  if (!savedAt) return unknown;
  return new Date(savedAt).toLocaleString(locale === 'fr' ? 'fr-FR' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' });
}

/** The panel's list: one row per retained revision, newest first. Each row opens its own revision read-only. */
export function Revisions({ provider, path, version, selected, locale, labels, onOpen }: {
  readonly provider: RevisionProvider;
  readonly path: string;
  /** Bumped when the workspace's change feed moves, so the list is read again. */
  readonly version: number;
  /** The revision on show in the read-only view, if any. */
  readonly selected: string | undefined;
  readonly locale: string;
  readonly labels: DocumentsLabels;
  readonly onOpen: (revision: string) => void;
}) {
  const saves = useRevisions(provider, path, version);
  return <section data-testid="revisions" aria-label={labels.revisions} className="flex min-h-0 flex-col">
    <h2 className="m-0 px-3 py-2 text-sm font-semibold">{labels.revisions}</h2>
    {saves === undefined ? <p role="status" className="m-0 px-3 pb-3 text-sm text-muted-foreground">{labels.revisionsLoading}</p>
      : saves.length === 0 ? <p role="status" className="m-0 px-3 pb-3 text-sm text-muted-foreground">{labels.noRevisions}</p>
      : <ScrollArea className="min-h-0 flex-1"><ol className="m-0 list-none p-1">
        {saves.map((save, index) => {
          const current = index === 0;
          const on = selected === save.revision;
          const when = whenSaved(save.savedAt, locale, labels.unknownTime);
          const who = (save.source ? labels.savedBy[save.source] : undefined) ?? labels.savedBy.observed;
          return <li key={save.revision}>
            <Button type="button" variant={on ? 'secondary' : 'ghost'} data-testid="revision-item" data-revision={save.revision} data-current={current ? 'true' : undefined}
              aria-current={on ? 'true' : undefined} aria-label={labels.openRevision(when)} onClick={() => onOpen(save.revision)}
              className="h-auto min-h-11 w-full flex-col items-start justify-start gap-0.5 whitespace-normal text-left">
              <span className="font-medium">{current ? labels.latest : when}</span>
              <span className="text-xs text-muted-foreground">{current ? `${when}, ${who}` : who}</span>
            </Button>
          </li>;
        })}
      </ol></ScrollArea>}
  </section>;
}
