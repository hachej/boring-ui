'use client';
// The preview's state, in memory only: the view that is open, the last share's note and the current error. A reload or a close ends it.
// Host concern: Pi has no UI; the host's callbacks carry ids and messages, never source.
import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { PreviewLocale } from './preview-text';

/** What a `boring.preview` tool result carries. `previewId` is opaque (the PM's). */
export interface PreviewSource {
  readonly previewId: string;
  readonly title: string;
  readonly source: string;
  readonly sampleProps?: unknown;
}

export interface PreviewSettings {
  /** The kill switch: false renders the cards disabled and never opens a view. */
  readonly enabled: boolean;
  readonly locale: PreviewLocale;
  /** Where the host serves preview-frame.html (same origin as the app, next to preview-frame.js). */
  readonly frameUrl: string;
  /** « Partager » shows only when this is given. It may resolve `{ prUrl }`; a rejection with `code: 'already_open'` and a `prUrl` counts as shared. */
  readonly onSharePreview?: ((preview: { previewId: string }) => Promise<{ prUrl?: string } | void>) | undefined;
  /** A compile or render error in the frame, so the host can tell the PM. */
  readonly onPreviewError?: ((error: { previewId: string; message: string }) => void) | undefined;
}

export interface PreviewState extends PreviewSettings {
  readonly view: PreviewSource | null;
  readonly open: (view: PreviewSource) => void;
  readonly close: () => void;
  readonly share: () => Promise<void>;
  /** Set after a share: the change is proposed. */
  readonly note: { readonly prUrl?: string | undefined } | null;
  readonly dismissNote: () => void;
  /** The last error of the open view (a frame error or a refused share). */
  readonly error: string | null;
  readonly report: (message: string) => void;
}

const NONE: PreviewState = { enabled: false, locale: 'en', frameUrl: '', view: null, open() {}, close() {}, async share() {}, note: null, dismissNote() {}, error: null, report() {} };
export const PreviewContext = createContext<PreviewState>(NONE);
export const usePreview = (): PreviewState => useContext(PreviewContext);

export function PreviewProvider({ settings, children }: { readonly settings: PreviewSettings; readonly children: ReactNode }) {
  const { enabled, locale, frameUrl, onSharePreview, onPreviewError } = settings;
  const [view, setView] = useState<PreviewSource | null>(null);
  const [note, setNote] = useState<PreviewState['note']>(null);
  const [error, setError] = useState<string | null>(null);
  const open = useCallback((next: PreviewSource) => { if (!enabled) return; setNote(null); setError(null); setView(next); }, [enabled]);
  const close = useCallback(() => { setView(null); setError(null); }, []);
  const dismissNote = useCallback(() => setNote(null), []);
  const report = useCallback((message: string) => {
    setError(message);
    if (view) onPreviewError?.({ previewId: view.previewId, message });
  }, [view, onPreviewError]);
  const share = useCallback(async () => {
    if (!view || !onSharePreview) return;
    try {
      const result = await onSharePreview({ previewId: view.previewId });
      setView(null); setError(null); setNote({ prUrl: result?.prUrl });
    } catch (failure) {
      const { code, prUrl, message } = failure as { code?: unknown; prUrl?: unknown; message?: unknown };
      // A change by this person is already open: it counts as shared, with its link.
      if (code === 'already_open' && typeof prUrl === 'string') { setView(null); setError(null); setNote({ prUrl }); return; }
      setError(typeof message === 'string' ? message : String(failure));
    }
  }, [view, onSharePreview]);
  const value = useMemo<PreviewState>(() => ({ enabled, locale, frameUrl, onSharePreview, onPreviewError, view, open, close, share, note, dismissNote, error, report }),
    [enabled, locale, frameUrl, onSharePreview, onPreviewError, view, open, close, share, note, dismissNote, error, report]);
  return <PreviewContext.Provider value={value}>{children}</PreviewContext.Provider>;
}
