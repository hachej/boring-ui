/**
 * Tiny typed event bus. ~30 lines, no runtime deps.
 *
 * Design constraints (locked by reviewer feedback in
 * `docs/plans/UNIFIED_EVENT_BUS.md`):
 *
 * - Synchronous emit only. Slow subscribers fire-and-forget their own async work.
 * - Snapshot listeners before iterating so subscribe / unsubscribe
 *   during dispatch is safe.
 * - One thrown listener does not stop the chain. Errors go to console.error.
 * - Bus emits transitions only — no replay-on-subscribe.
 */

export interface EventBus<TMap extends object> {
  /** Subscribe to one event name. Returns an unsubscribe function. */
  on<K extends keyof TMap>(
    name: K,
    fn: (payload: TMap[K]) => void,
  ): () => void

  /** Synchronously dispatch to every matching listener. */
  emit<K extends keyof TMap>(name: K, payload: TMap[K]): void

  /** Test-only — never call from production code. Underscore-prefixed by convention. */
  _reset(): void
}

export function createEventBus<TMap extends object>(): EventBus<TMap> {
  const named = new Map<keyof TMap, Set<(payload: unknown) => void>>()

  function on<K extends keyof TMap>(
    name: K,
    fn: (payload: TMap[K]) => void,
  ): () => void {
    let bucket = named.get(name)
    if (!bucket) {
      bucket = new Set()
      named.set(name, bucket)
    }
    bucket.add(fn as (payload: unknown) => void)
    return () => bucket!.delete(fn as (payload: unknown) => void)
  }

  function emit<K extends keyof TMap>(name: K, payload: TMap[K]): void {
    const bucket = named.get(name)
    if (!bucket) return
    // Snapshot so unsubscribe-during-dispatch is safe.
    for (const listener of [...bucket]) {
      try {
        listener(payload)
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(`[events] listener for "${String(name)}" threw:`, err)
      }
    }
  }

  function _reset(): void {
    named.clear()
  }

  return { on, emit, _reset }
}
