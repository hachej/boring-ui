'use client';
// The preview's state, in memory only (React state, no storage, no expiry): the overlay that is active, which replaceable parts are mounted,
// the last share's note and the current error. A reload or « Fermer » ends it. Host concern: Pi has no UI; the host's callbacks carry ids
// and messages, never source.
import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { previewText } from './preview-text';
import type { PreviewLocale } from './preview-text';

/** What a `boring.preview` tool result carries. `previewId` is opaque (the PM's); `key` names the Replaceable it replaces. */
export interface PreviewOverlay {
  readonly previewId: string;
  readonly key: string;
  readonly title: string;
  readonly source: string;
}

export interface PreviewSettings {
  /** The kill switch: false renders the cards disabled and replaces nothing. */
  readonly enabled: boolean;
  readonly locale: PreviewLocale;
  /** The build SHA, sent with a share so the PM knows which release was looked at. */
  readonly release: string;
  /** Where the host serves preview-frame.html (same origin as the app, next to preview-frame.js). */
  readonly frameUrl: string;
  /** « Partager » shows only when this is given. It may resolve `{ prUrl }`; a rejection with `code: 'already_open'` and a `prUrl` counts as shared. */
  readonly onSharePreview?: ((preview: { key: string; previewId: string; release: string }) => Promise<{ prUrl?: string } | void>) | undefined;
  /** A compile or render error in the frame, so the host can tell the PM. */
  readonly onPreviewError?: ((error: { previewId: string; message: string }) => void) | undefined;
}

export interface PreviewState extends PreviewSettings {
  readonly overlay: PreviewOverlay | null;
  readonly open: (overlay: PreviewOverlay) => void;
  readonly close: () => void;
  readonly share: () => Promise<void>;
  /** The keys of the Replaceable parts that are mounted now. */
  readonly mounted: ReadonlySet<string>;
  readonly register: (key: string) => () => void;
  /** Set after a share: the change is proposed. */
  readonly note: { readonly prUrl?: string | undefined } | null;
  readonly dismissNote: () => void;
  /** The last error of the frame (the part then shows its original again). */
  readonly error: string | null;
  /** The last refused share (the preview stays). */
  readonly shareError: string | null;
  readonly report: (message: string) => void;
  /** The last intent the frame reported (a component callback that was called, never run), for the banner. */
  readonly intent: string | null;
  readonly setIntent: (text: string) => void;
}

const NONE: PreviewState = { enabled: false, locale: 'en', release: '', frameUrl: '', overlay: null, open() {}, close() {}, async share() {}, mounted: new Set(), register: () => () => {}, note: null, dismissNote() {}, error: null, shareError: null, report() {}, intent: null, setIntent() {} };
export const PreviewContext = createContext<PreviewState>(NONE);
export const usePreview = (): PreviewState => useContext(PreviewContext);

export function PreviewProvider({ settings, children }: { readonly settings: PreviewSettings; readonly children: ReactNode }) {
  const { enabled, locale, release, frameUrl, onSharePreview, onPreviewError } = settings;
  const [overlay, setOverlay] = useState<PreviewOverlay | null>(null);
  const [mounted, setMounted] = useState<ReadonlySet<string>>(new Set());
  const [note, setNote] = useState<PreviewState['note']>(null);
  const [error, setError] = useState<string | null>(null);
  const [shareError, setShareError] = useState<string | null>(null);
  const [intent, setIntent] = useState<string | null>(null);
  const open = useCallback((next: PreviewOverlay) => { if (!enabled) return; setNote(null); setError(null); setShareError(null); setIntent(null); setOverlay(next); }, [enabled]);
  const close = useCallback(() => { setOverlay(null); setError(null); setShareError(null); }, []);
  const dismissNote = useCallback(() => setNote(null), []);
  const register = useCallback((key: string) => {
    setMounted(current => new Set(current).add(key));
    return () => setMounted(current => { const next = new Set(current); next.delete(key); return next; });
  }, []);
  const report = useCallback((message: string) => {
    setError(message);
    if (overlay) onPreviewError?.({ previewId: overlay.previewId, message });
  }, [overlay, onPreviewError]);
  const shared = (prUrl: string | undefined) => { setOverlay(null); setError(null); setShareError(null); setNote({ prUrl }); };
  const share = useCallback(async () => {
    if (!overlay || !onSharePreview) return;
    try {
      const result = await onSharePreview({ key: overlay.key, previewId: overlay.previewId, release });
      shared(result?.prUrl);
    } catch (failure) {
      const { code, prUrl, message } = failure as { code?: unknown; prUrl?: unknown; message?: unknown };
      // A change by this person is already open: it counts as shared, with its link.
      if (code === 'already_open' && typeof prUrl === 'string') { shared(prUrl); return; }
      // The file moved on since the PM wrote this version: the PM must regenerate it. Any other refusal shows its own message.
      setShareError(code === 'file_changed' ? previewText(locale).fileChanged : typeof message === 'string' ? message : String(failure));
    }
  }, [overlay, onSharePreview, release, locale]);
  const value = useMemo<PreviewState>(() => ({ enabled, locale, release, frameUrl, onSharePreview, onPreviewError, overlay, open, close, share, mounted, register, note, dismissNote, error, shareError, report, intent, setIntent }),
    [enabled, locale, release, frameUrl, onSharePreview, onPreviewError, overlay, open, close, share, mounted, register, note, dismissNote, error, shareError, report, intent]);
  return <PreviewContext.Provider value={value}>{children}</PreviewContext.Provider>;
}
