export type Persistence = 'session' | 'local';

/** Viewer conveniences only: browser policy can deny the storage object or an individual operation. */
/** `none`: nothing is kept (a composer's `at.remember: false`). */
export function storageFor(persist: Persistence | 'none' = 'session'): Storage | undefined {
  if (persist === 'none') return undefined;
  try { return persist === 'local' ? globalThis.localStorage ?? globalThis.window?.localStorage : globalThis.sessionStorage ?? globalThis.window?.sessionStorage; }
  catch { return undefined; }
}

export function readPersisted(key: string, persist: Persistence | 'none' = 'session'): string | null {
  try { return storageFor(persist)?.getItem(key) ?? null; }
  catch { return null; }
}

export function writePersisted(key: string, value: string | null, persist: Persistence | 'none' = 'session'): void {
  try {
    const storage = storageFor(persist);
    if (value === null) storage?.removeItem(key);
    else storage?.setItem(key, value);
  } catch { /* persistence is a viewer convenience */ }
}

export function readPersistedJson(key: string, persist: Persistence | 'none' = 'session'): unknown {
  try { return JSON.parse(readPersisted(key, persist) ?? 'null'); }
  catch { return null; }
}

export function writePersistedJson(key: string, value: unknown, persist: Persistence | 'none' = 'session'): void {
  try { const text = JSON.stringify(value); if (text !== undefined) writePersisted(key, text, persist); }
  catch { /* malformed convenience data cannot interrupt the viewer */ }
}

export const readFlag = (key: string): boolean => readPersisted(key) === '1';
export const writeFlag = (key: string, on: boolean): void => writePersisted(key, on ? '1' : null);
