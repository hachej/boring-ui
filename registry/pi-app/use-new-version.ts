import { useEffect, useState } from 'react';

export interface NewVersionOptions {
  /** The build this page runs, as the host bakes it into its bundle. `undefined`, empty or `dev` means no check. */
  readonly current: string | undefined;
  /** Where the deployed build is served, as `{ "build": "<id>" }`. Default `/version.json`. */
  readonly url?: string;
  /** How often to check, in milliseconds (default one minute). The check also runs when the tab becomes visible again. */
  readonly everyMs?: number;
}

/**
 * True once the served build differs from `current`: a tab left open keeps running the JavaScript it loaded, so a long-open page
 * learns that a newer deploy exists and offers a reload (`NewVersionNotice`). A failed check (offline, a bad response) is retried
 * on the next tick and never flips the result. Once true it stays true; the page is expected to reload.
 */
export function useNewVersion({ current, url = '/version.json', everyMs = 60_000 }: NewVersionOptions): boolean {
  const [stale, setStale] = useState(false);
  useEffect(() => {
    if (!current || current === 'dev') return undefined;
    let done = false;
    const check = async () => {
      if (done) return;
      try {
        const response = await fetch(url, { cache: 'no-store', credentials: 'same-origin' });
        if (response.ok && (await response.json()).build !== current) { done = true; setStale(true); }
      } catch { /* offline or not deployed yet: try again on the next check */ }
    };
    const visible = () => { if (document.visibilityState === 'visible') void check(); };
    const timer = setInterval(check, everyMs);
    document.addEventListener('visibilitychange', visible);
    return () => { done = true; clearInterval(timer); document.removeEventListener('visibilitychange', visible); };
  }, [current, url, everyMs]);
  return stale;
}
