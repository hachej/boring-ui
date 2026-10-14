// The live-preview overlay store, pure: the storage is injected, so a test runs it without a DOM. Overlays live in sessionStorage, one key
// per app and release, and never leave the browser. Each lasts two hours from its creation; a new release is a new key, so the old
// overlays are not served. Every storage access is guarded: a blocked or throwing storage reads as empty and writes report false.
export const PREVIEW_TTL_MS = 2 * 60 * 60 * 1000;

export interface PreviewOverlay {
  readonly key: string;
  readonly source: string;
  readonly createdAt: number;
  /** The tool call id of the `boring.preview` result it came from (the PM's record of the change). */
  readonly previewId?: string | undefined;
}

export interface OverlayStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function storageKey(appId: string, release: string): string {
  return `boring.preview:${appId}:${release}`;
}

export function fresh(overlays: readonly PreviewOverlay[], now: number): PreviewOverlay[] {
  return overlays.filter(overlay => now - overlay.createdAt < PREVIEW_TTL_MS);
}

function valid(value: unknown): value is PreviewOverlay {
  if (typeof value !== 'object' || value === null) return false;
  const overlay = value as Record<string, unknown>;
  return typeof overlay.key === 'string' && typeof overlay.source === 'string' && typeof overlay.createdAt === 'number'
    && (overlay.previewId === undefined || typeof overlay.previewId === 'string');
}

export function readOverlays(storage: OverlayStorage | undefined, appId: string, release: string, now: number): PreviewOverlay[] {
  try {
    const raw = storage?.getItem(storageKey(appId, release));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? fresh(parsed.filter(valid), now) : [];
  } catch {
    return [];
  }
}

/** An empty list removes the key. Returns false when nothing could be stored (no storage, or it throws). */
export function writeOverlays(storage: OverlayStorage | undefined, appId: string, release: string, overlays: readonly PreviewOverlay[]): boolean {
  if (!storage) return false;
  try {
    const key = storageKey(appId, release);
    if (overlays.length === 0) storage.removeItem(key);
    else storage.setItem(key, JSON.stringify(overlays));
    return true;
  } catch {
    return false;
  }
}

/** The moment the earliest overlay expires, or undefined with none. */
export function nextExpiry(overlays: readonly PreviewOverlay[]): number | undefined {
  if (overlays.length === 0) return undefined;
  return Math.min(...overlays.map(overlay => overlay.createdAt)) + PREVIEW_TTL_MS;
}

export function sessionStorageOf(): OverlayStorage | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.sessionStorage;
  } catch {
    return undefined;
  }
}
