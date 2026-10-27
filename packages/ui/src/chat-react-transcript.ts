'use client';

import { startTransition, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ChatHistoryState } from './native-chat.js';

export interface ChatPaging { readonly first?: number; readonly more?: number }
export const PAGE_FIRST = 60, PAGE_MORE = 40, CHUNK = 20;

/**
 * Rows grouped into runs of at most `size` keys, kept stable across renders. Rows already placed never change run: rows revealed
 * above form new runs (the run nearest the old top is the full one), rows added below fill the last run, then start new ones.
 */
export function chunkKeys(previous: readonly (readonly string[])[], keys: readonly string[], size = CHUNK): string[][] {
  const owner = new Map<string, number>();
  previous.forEach((run, index) => { for (const key of run) owner.set(key, index); });
  const known = keys.findIndex(key => owner.has(key));
  const lead = known < 0 ? keys.length : known;
  const runs: string[][] = [];
  for (let end = lead; end > 0; end -= size) runs.unshift(keys.slice(Math.max(0, end - size), end));
  let current: string[] = [], from: number | undefined;
  for (const key of keys.slice(lead)) {
    const placed = owner.get(key);
    if (!current.length || (placed !== undefined ? placed !== from : current.length >= size)) { current = []; runs.push(current); from = placed; }
    current.push(key);
  }
  return runs;
}

/**
 * The scroller measures every one of its items on each scroll event and frame (@shadcn/react 0.3.1), so a long transcript gives it
 * runs of `CHUNK` rows instead of single rows: 500 messages are 25 measurements, not 500. A run keeps its element while rows are
 * revealed above it, so the scroller's prepend anchor still holds; a run's array is reused while its rows are unchanged.
 */
export function useRowChunks<T extends { readonly key: string }>(rows: readonly T[], size = CHUNK): readonly (readonly T[])[] {
  // A derived cache of the last runs, read and replaced inside the memo only: the same rows always give the same runs.
  const previous = useRef<{ readonly keys: readonly (readonly string[])[]; readonly runs: ReadonlyMap<string, readonly T[]> }>({ keys: [], runs: new Map() });
  return useMemo(() => {
    const byKey = new Map(rows.map(row => [row.key, row]));
    // eslint-disable-next-line react-hooks/refs -- reads the run cache to keep run boundaries and arrays stable; no setState, no render loop
    const keys = chunkKeys(previous.current.keys, rows.map(row => row.key), size);
    // eslint-disable-next-line react-hooks/refs -- the mapper reuses the cached array of an unchanged run (see above)
    const runs = keys.map(run => {
      const items = run.map(key => byKey.get(key)!);
      const before = previous.current.runs.get(run[0]!);
      return before && before.length === items.length && before.every((item, index) => item === items[index]) ? before : items;
    });
    // eslint-disable-next-line react-hooks/refs -- stores the runs for the next rows; a cache write, not state, so it triggers no render
    previous.current = { keys, runs: new Map(runs.map(run => [run[0]!.key, run])) };
    return runs;
  }, [rows, size]);
}

/** One scroll root for current and archived rows. Native paging stays in the borrowed controller. */
export function useTranscriptWindow(rows: readonly { readonly key: string }[], page = PAGE_FIRST, more = PAGE_MORE, history?: { readonly state: ChatHistoryState; readonly connected: boolean; readonly load: () => Promise<void> }, automatic = true) {
  if (!Number.isSafeInteger(page) || page < 1) throw new TypeError('Chat displayLimit must be a positive integer');
  if (!Number.isSafeInteger(more) || more < 1) throw new TypeError('Chat paging.more must be a positive integer');
  const [limit, setLimit] = useState(page);
  const [sentinel, setSentinel] = useState<HTMLDivElement | null>(null);
  const [loaded, setLoaded] = useState(0);
  const pending = useRef(false);
  const anchor = useRef<{ readonly length: number; readonly limit: number } | undefined>(undefined);
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const hidden = Math.max(0, rows.length - limit);
  const historyState = history?.state, historyConnected = history?.connected, historyLoad = history?.load;
  const reveal = useCallback(() => {
    if (pending.current || anchor.current) return;
    const state = historyState;
    if (hidden === 0 && (!historyConnected || !state || state.kind === 'disabled' || state.kind === 'loading' || state.kind === 'ready' && !state.hasMore)) return;
    anchor.current = { length: rows.length, limit };
    // A revealed page renders as a transition: React mounts it in small slices, so scrolling stays responsive meanwhile.
    if (hidden > 0) startTransition(() => setLimit(value => value + more));
    else if (historyLoad) {
      pending.current = true;
      void Promise.resolve().then(historyLoad).catch(() => { anchor.current = undefined; }).finally(() => { pending.current = false; });
    }
  }, [hidden, historyState, historyConnected, historyLoad, rows.length, limit, more]);
  useLayoutEffect(() => {
    const saved = anchor.current;
    if (!scroller || !saved || history?.state.kind === 'loading') return;
    const added = Math.max(0, rows.length - saved.length);
    if (limit < saved.limit + added) { startTransition(() => setLimit(saved.limit + added)); return; }
    anchor.current = undefined;
    setLoaded(count => count + Math.max(0, Math.min(rows.length, limit) - Math.min(saved.length, saved.limit)));
  }, [rows, limit, scroller, history?.state]);
  // Automatic paging: the sentinel near the top, once the reader has been away from the top (so the mount, which starts at the
  // top before the scroller settles at the end, loads nothing). A fast scroll lands on 0 before the sentinel is seen: the scroll
  // listener and every new observer (after each page) check again, instead of the reader's distance at that one moment.
  const near = useRef(false), away = useRef(false), revealNow = useRef(reveal);
  useLayoutEffect(() => { revealNow.current = reveal; });
  useEffect(() => {
    if (!automatic || !scroller) return;
    const onScroll = () => { if (scroller.scrollTop > 8) away.current = true; if (near.current && away.current) revealNow.current(); };
    scroller.addEventListener('scroll', onScroll, { passive: true });
    return () => scroller.removeEventListener('scroll', onScroll);
  }, [automatic, scroller]);
  useEffect(() => {
    if (!automatic || !scroller || !sentinel || typeof IntersectionObserver === 'undefined' || history?.state.kind === 'loading' || history?.state.kind === 'error') return;
    const observer = new IntersectionObserver(entries => {
      near.current = entries.at(-1)?.isIntersecting ?? near.current;
      if (near.current && (scroller.scrollHeight <= scroller.clientHeight || away.current)) reveal();
    }, { root: scroller, rootMargin: '240px 0px 0px' });
    observer.observe(sentinel);
    return () => { observer.disconnect(); near.current = false; };
  }, [automatic, scroller, sentinel, reveal, history?.state]);
  const revealTo = (key: string) => { const index = rows.findIndex(row => row.key === key); if (index >= 0) setLimit(value => Math.max(value, rows.length - index)); };
  return { scrollRef: setScroller, hidden, reveal, revealTo, sentinelRef: setSentinel, loaded, visible: <T,>(items: readonly T[]): readonly T[] => hidden ? items.slice(hidden) : items, reset: () => { anchor.current = undefined; setLimit(page); } };
}

/** Compatibility spelling for headless consumers; presentation supplies the actual scroll owner. */
export const useTranscript = useTranscriptWindow;
