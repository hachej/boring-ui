'use client';
// The live-preview provider: the overlays of one app and release, the shown toggle and the share note. The shell mounts it (AppShell's
// `preview` prop); without it nothing is previewed. Nothing is sent over the network: a share goes only to the host's `onShare`.
import { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { fresh, nextExpiry, readOverlays, sessionStorageOf, writeOverlays } from './store';
import type { PreviewOverlay } from './store';
import type { PreviewLocale } from './preview-text';

export interface PreviewShare {
  readonly key: string;
  /** The tool call id of the change's `boring.preview` result, when the overlay came from one. */
  readonly previewId: string | undefined;
  /** The build SHA the overlay was made against (the app's `preview.release`). */
  readonly release: string;
}

export interface PreviewShared {
  readonly prUrl?: string | undefined;
}

export interface PreviewSettings {
  readonly appId: string;
  readonly release: string;
  readonly enabled: boolean;
  readonly locale?: PreviewLocale | undefined;
  /** Proposes the change. The overlay is cleared once it resolves; a rejection keeps it, so the viewer can close it. */
  readonly onShare?: ((share: PreviewShare) => Promise<PreviewShared | void>) | undefined;
}

export interface PreviewStore {
  readonly enabled: boolean;
  readonly locale: PreviewLocale;
  /** The live overlays (expired ones are gone). Empty while disabled. */
  readonly overlays: readonly PreviewOverlay[];
  readonly shown: boolean;
  readonly setShown: (shown: boolean) => void;
  readonly add: (overlay: { readonly key: string; readonly source: string; readonly previewId?: string }) => void;
  readonly remove: (key: string) => void;
  readonly clearAll: () => void;
  readonly canShare: boolean;
  readonly share: (key: string) => Promise<void>;
  readonly note: PreviewShared | undefined;
}

const none: PreviewStore = {
  enabled: false, locale: 'en', overlays: [], shown: true, setShown: () => {}, add: () => {}, remove: () => {}, clearAll: () => {},
  canShare: false, share: () => Promise.resolve(), note: undefined,
};

export const PreviewContext = createContext<PreviewStore>(none);

/** The live-preview store of the nearest provider: `add`, `remove`, `clearAll`, `shown`, `setShown`, plus the overlays. */
export function usePreviewOverlays(): PreviewStore {
  return useContext(PreviewContext);
}

// setTimeout takes a 32-bit delay; a later expiry is re-armed when the timer fires.
const MAX_DELAY = 2_147_483_647;

export function PreviewProvider({ settings, children }: { readonly settings: PreviewSettings; readonly children: ReactNode }) {
  const { appId, release, enabled, onShare } = settings;
  const locale = settings.locale ?? 'en';
  const [stored, setStored] = useState<readonly PreviewOverlay[]>(() => enabled ? readOverlays(sessionStorageOf(), appId, release, Date.now()) : []);
  const [shown, setShown] = useState(true);
  const [note, setNote] = useState<PreviewShared | undefined>();

  useEffect(() => {
    setStored(enabled ? readOverlays(sessionStorageOf(), appId, release, Date.now()) : []);
  }, [appId, release, enabled]);

  // Expiry: the overlays drop out at render, and a timer re-reads them at the earliest end, so an idle page loses them on time too.
  useEffect(() => {
    const at = nextExpiry(stored);
    if (at === undefined) return;
    const timer = setTimeout(() => setStored(current => fresh(current, Date.now())), Math.min(Math.max(at - Date.now(), 0) + 1, MAX_DELAY));
    return () => clearTimeout(timer);
  }, [stored]);

  const overlays = enabled ? fresh(stored, Date.now()) : [];

  // Every change writes the storage from the current list (a no-op write when the storage is blocked) and then updates the state.
  const mutate = (change: (current: readonly PreviewOverlay[]) => PreviewOverlay[]) => setStored(current => {
    const next = change(fresh(current, Date.now()));
    writeOverlays(sessionStorageOf(), appId, release, next);
    return next;
  });

  const add: PreviewStore['add'] = overlay => {
    if (!enabled) return;
    setNote(undefined);
    setShown(true);
    mutate(current => [...current.filter(item => item.key !== overlay.key), { key: overlay.key, source: overlay.source, createdAt: Date.now(), previewId: overlay.previewId }]);
  };

  const remove: PreviewStore['remove'] = key => mutate(current => current.filter(item => item.key !== key));

  const clearAll: PreviewStore['clearAll'] = () => {
    setNote(undefined);
    mutate(() => []);
  };

  const share: PreviewStore['share'] = async key => {
    const overlay = overlays.find(item => item.key === key);
    if (!overlay || !onShare) return;
    let result: PreviewShared | void;
    try {
      result = await onShare({ key, previewId: overlay.previewId, release });
    } catch {
      return;
    }
    remove(key);
    setNote({ prUrl: result?.prUrl });
  };

  const value: PreviewStore = {
    enabled, locale, overlays, shown, setShown, add, remove, clearAll, canShare: Boolean(onShare), share, note,
  };
  return <PreviewContext.Provider value={value}>{children}</PreviewContext.Provider>;
}
