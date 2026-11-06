import { useEffect, useRef, useState } from 'react';
import type { RevisionProvider } from '@hachej/boring-files/revision';

/**
 * A number that moves when the provider's files change (`RevisionProvider.changes`), coalesced over `settleMs` so a burst (a shell
 * writing many files) reloads once. `live` is false without a feed or after the feed was refused; views then keep their own refresh.
 * A hidden tab holds no feed: a browser allows few connections per host, and every tab of a share link holding a stream starves the
 * others (remote chat releases its stream the same way); `live` is false meanwhile. Shown again, it reconnects after the last event it
 * acted on (`since`; 0 when it had none, which the feed answers with a `resnapshot`), so a change made while hidden or while reconnecting
 * arrives on the new feed and moves the number then, after the feed is connected.
 */
export function useWorkspaceChangeFeed(provider: RevisionProvider | undefined, settleMs = 150): { readonly seq: number | undefined; readonly live: boolean } {
  const [state, setState] = useState<{ readonly provider: RevisionProvider | undefined; readonly seq: number | undefined; readonly live: boolean }>({ provider, seq: undefined, live: false });
  const shown = usePageShown();
  // The provider connected last, and the protocol seq of the last event the views reloaded for.
  const connected = useRef<{ readonly provider: RevisionProvider; seen: number | undefined } | undefined>(undefined);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the feed's state is reset for the new provider when this effect subscribes to it
    if (!provider?.changes) { setState({ provider, seq: undefined, live: false }); return; }
    if (!shown) { setState(current => current.provider === provider && current.live ? { ...current, live: false } : current); return; }
    const stop = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined, latest: number | undefined;
    // A second connection to the same provider follows a hidden period: it resumes after the last event acted on. A first connection has nothing to catch up.
    const since = connected.current?.provider === provider ? connected.current.seen ?? 0 : undefined;
    const cursor = connected.current?.provider === provider ? connected.current : { provider, seen: undefined };
    connected.current = cursor;
    const move = () => { cursor.seen = latest; setState(current => ({ provider, seq: current.provider === provider ? (current.seq ?? 0) + 1 : 1, live: true })); };
    setState(current => ({ provider, seq: current.provider === provider ? current.seq : undefined, live: true }));
    void (async () => {
      try {
        for await (const event of provider.changes!({ ...(since === undefined ? {} : { since }), signal: stop.signal })) {
          latest = event.seq;
          // An event still settling when the feed closes is not acted on, so the next connection asks for it again.
          timer ??= setTimeout(() => { timer = undefined; if (!stop.signal.aborted) move(); }, settleMs);
        }
      } catch { /* refused: the views fall back to their own refresh */ }
      clearTimeout(timer);
      timer = undefined;
      if (!stop.signal.aborted) setState(current => ({ provider, seq: current.provider === provider ? current.seq : undefined, live: false }));
    })();
    return () => { stop.abort(); clearTimeout(timer); };
  }, [provider, settleMs, shown]);
  return state.provider === provider ? state : { seq: undefined, live: false };
}

/** Whether the page is shown (`document.visibilityState`); true where there is no document. */
function usePageShown(): boolean {
  const [shown, setShown] = useState(() => typeof document === 'undefined' || document.visibilityState !== 'hidden');
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const update = () => setShown(document.visibilityState !== 'hidden');
    update();
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);
  return shown;
}
