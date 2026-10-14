'use client';

// The revisions of one file: what the workspace's history retains for it (`provider.history`, newest first), each with when it was saved and
// who wrote it (`source`). Choosing an older one opens it read-only (the documents screen shows that revision); the newest opens the latest.
import { useEffect, useState } from 'react';
import type { RevisionProvider, SavedRevision } from '@hachej/boring-files/revision';
import { cn } from '../utils/utils';
import type { DocumentsLabels } from './documents-labels';

/** The retained revisions of `path`, reloaded when `version` changes (the workspace's change feed moved). `undefined` until the first read. */
export function useRevisions(provider: RevisionProvider, path: string, version: number): { readonly path: string; readonly saves: readonly SavedRevision[] } | undefined {
  const [state, setState] = useState<{ readonly path: string; readonly saves: readonly SavedRevision[] }>();
  useEffect(() => {
    const abort = new AbortController();
    const save = (saves: readonly SavedRevision[]) => { if (!abort.signal.aborted) setState({ path, saves }); };
    provider.history(path, abort.signal).then(save, () => save([]));
    return () => abort.abort();
  }, [provider, path, version]);
  return state;
}

/** When a revision was saved, in the page's language; `savedAt` 0 means the journal did not record a time. */
export function whenSaved(savedAt: number, locale: string, unknown: string): string {
  if (!savedAt) return unknown;
  return new Date(savedAt).toLocaleString(locale === 'fr' ? 'fr-FR' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' });
}

/** The panel's list: one row per retained revision, newest first. The newest row is the latest; an older one is opened read-only. */
export function Revisions({ provider, path, version, selected, locale, labels, onOpen }: {
  readonly provider: RevisionProvider;
  readonly path: string;
  /** Bumped when the workspace's change feed moves, so the list is read again. */
  readonly version: number;
  /** The revision on show when it is an older one (`undefined`: the latest). */
  readonly selected: string | undefined;
  readonly locale: string;
  readonly labels: DocumentsLabels;
  /** Opens an older revision read-only; `undefined` opens the latest. */
  readonly onOpen: (revision: string | undefined) => void;
}) {
  const state = useRevisions(provider, path, version);
  const saves = state?.path === path ? state.saves : undefined;
  return <section data-testid="revisions" aria-label={labels.revisions} className="flex min-h-0 flex-col">
    <h2 className="m-0 px-3 py-2 text-sm font-semibold">{labels.revisions}</h2>
    {saves === undefined ? <p role="status" className="m-0 px-3 pb-3 text-sm text-muted-foreground">{labels.revisionsLoading}</p>
      : saves.length === 0 ? <p role="status" className="m-0 px-3 pb-3 text-sm text-muted-foreground">{labels.noRevisions}</p>
      : <ol className="m-0 min-h-0 list-none overflow-y-auto p-1">
        {saves.map((save, index) => {
          const current = index === 0;
          const on = current ? selected === undefined : selected === save.revision;
          const when = whenSaved(save.savedAt, locale, labels.unknownTime);
          const who = save.source ? labels.savedBy[save.source] : labels.savedBy.observed;
          return <li key={save.revision}>
            <button type="button" data-testid="revision-item" data-revision={save.revision} data-current={current ? 'true' : undefined}
              aria-current={on ? 'true' : undefined} aria-label={labels.openRevision(when)} onClick={() => onOpen(current ? undefined : save.revision)}
              className={cn('flex min-h-11 w-full flex-col items-start gap-0.5 rounded-md px-2 py-1.5 text-left text-sm outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/60',
                on && 'bg-accent')}>
              <span className="font-medium">{current ? labels.latest : when}</span>
              <span className="text-xs text-muted-foreground">{current ? `${when}, ${who}` : who} · {labels.revisionId} {save.revision.slice(0, 8)}</span>
            </button>
          </li>;
        })}
      </ol>}
  </section>;
}
