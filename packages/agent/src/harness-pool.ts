import type { Harness } from '@earendil-works/pi-durable';
import type { Context } from '@earendil-works/chord';

/*
 * One harness per owner, for hosts that prefer isolation to one shared harness with per-call workspaces
 * (`@hachej/boring-agent/workspaces`). The pool opens an owner's harness on first use, routes each operation to it, and closes it once
 * nothing holds it, it has no live task or unsettled submission, and it has been idle for `idleMs`. It shares nothing between
 * owners: every owner's harness, storage, registry and environment come from the host's `create(owner)`.
 *
 * Choose one shared harness with per-call resolution when many people use the same agent and the host wants one storage, one
 * scheduler and one recovery pass; choose the pool when each owner needs its own storage file (a single-writer SQLite per person,
 * an AgentCore session per conversation key), its own registry (a self-evolving agent installs per-workspace extensions), or
 * crash isolation between owners.
 */

/** What `create` returns: the owner's harness, anything else the host keeps with it, and how to close it (default `harness.close`). */
export interface PooledHarness {
  readonly harness: Harness;
  readonly close?: () => Promise<void>;
}

export interface HarnessPoolOptions<T extends PooledHarness = PooledHarness> {
  /** Open the harness of `owner`. Called once per owner while it stays open; must not share storage with another owner. */
  readonly create: (owner: string) => Promise<T>;
  /** Long-lived context for `inspect` and `close`. */
  readonly context: Context;
  /** Close an owner's harness this long after its last use (default 10 minutes; `Infinity`: never). */
  readonly idleMs?: number;
  /** A close that failed. Must not throw. */
  readonly onError?: (error: unknown, owner: string) => void;
}

export interface HarnessLease<T extends PooledHarness = PooledHarness> {
  readonly owned: T;
  /** Return the hold. It never closes the harness; the pool does that once idle. Idempotent. */
  readonly release: () => void;
}

export interface HarnessPool<T extends PooledHarness = PooledHarness> {
  /** Hold the harness of `owner`, opening it when needed. */
  readonly acquire: (owner: string) => Promise<HarnessLease<T>>;
  /** Run `operation` on the owner's harness, held for its duration. */
  readonly use: <R>(owner: string, operation: (owned: T) => Promise<R>) => Promise<R>;
  /** A transport operation: the harness stays held until the response body ends or is cancelled (a watch stream). */
  readonly respond: (owner: string, operation: (owned: T) => Promise<Response>) => Promise<Response>;
  /** The owners whose harness is open now. */
  readonly owners: () => string[];
  /** What `create` returned for every harness open now, without holding any (a health check reads them). */
  readonly opened: () => Promise<T[]>;
  /** Close every harness (host shutdown). */
  readonly close: () => Promise<void>;
}

type Entry<T> = { readonly opening: Promise<T>; leases: number; lastUsed: number; timer?: ReturnType<typeof setTimeout> | undefined; closing?: Promise<void> };

export function createHarnessPool<T extends PooledHarness = PooledHarness>(options: HarnessPoolOptions<T>): HarnessPool<T> {
  const { context } = options;
  const idleMs = options.idleMs ?? 10 * 60_000;
  if (!(idleMs > 0)) throw new TypeError('idleMs must be positive');
  const entries = new Map<string, Entry<T>>();
  let closed = false;

  function arm(owner: string, entry: Entry<T>) {
    if (entry.timer !== undefined) clearTimeout(entry.timer);
    if (!Number.isFinite(idleMs)) return;
    entry.timer = setTimeout(() => { void sweep(owner, entry); }, Math.max(0, entry.lastUsed + idleMs - Date.now()));
    (entry.timer as { unref?: () => void }).unref?.();
  }
  async function sweep(owner: string, entry: Entry<T>) {
    entry.timer = undefined;
    if (entries.get(owner) !== entry || entry.leases > 0) return;
    if (Date.now() - entry.lastUsed < idleMs) return arm(owner, entry);
    // Background work (a subagent, a queued follow-up) keeps the harness open: closing it would stop a task nobody is watching.
    let busy = true;
    try { const inspection = await (await entry.opening).harness.inspect(context); busy = inspection.tasks.length > 0 || inspection.submissions.length > 0; } catch { /* keep it */ }
    if (entries.get(owner) !== entry || entry.leases > 0) return;
    if (busy) { entry.lastUsed = Date.now(); return arm(owner, entry); }
    await dispose(owner, entry);
  }
  function dispose(owner: string, entry: Entry<T>): Promise<void> {
    if (entries.get(owner) === entry) entries.delete(owner);
    if (entry.timer !== undefined) clearTimeout(entry.timer);
    entry.closing ??= entry.opening.then(owned => owned.close ? owned.close() : owned.harness.close(context), () => undefined).catch(error => { options.onError?.(error, owner); });
    return entry.closing;
  }
  async function acquire(owner: string): Promise<HarnessLease<T>> {
    if (closed) throw new Error('The harness pool is closed');
    if (typeof owner !== 'string' || owner === '') throw new TypeError('An owner key is required');
    let entry = entries.get(owner);
    if (entry === undefined) {
      const opening = Promise.resolve().then(() => options.create(owner));
      const created: Entry<T> = { opening, leases: 0, lastUsed: Date.now() };
      entries.set(owner, created);
      opening.catch(() => { if (entries.get(owner) === created) entries.delete(owner); });
      entry = created;
    }
    const held = entry;
    held.leases++;
    held.lastUsed = Date.now();
    let owned: T;
    try { owned = await held.opening; } catch (error) { held.leases--; throw error; }
    let released = false;
    return { owned, release: () => {
      if (released) return;
      released = true;
      held.leases--;
      held.lastUsed = Date.now();
      if (held.leases === 0 && entries.get(owner) === held) arm(owner, held);
    } };
  }
  return {
    acquire,
    use: async (owner, operation) => {
      const lease = await acquire(owner);
      try { return await operation(lease.owned); } finally { lease.release(); }
    },
    respond: async (owner, operation) => {
      const lease = await acquire(owner);
      let response: Response;
      try { response = await operation(lease.owned); } catch (error) { lease.release(); throw error; }
      if (response.body === null) { lease.release(); return response; }
      const reader = response.body.getReader();
      const body = new ReadableStream<Uint8Array>({
        async pull(controller) {
          try {
            const { done, value } = await reader.read();
            if (done) { lease.release(); controller.close(); } else controller.enqueue(value);
          } catch (error) { lease.release(); controller.error(error); }
        },
        async cancel(reason) { lease.release(); await reader.cancel(reason); },
      });
      return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
    },
    owners: () => [...entries.keys()],
    opened: async () => (await Promise.all([...entries.values()].map(entry => entry.opening.catch(() => undefined)))).filter((owned): owned is Awaited<T> => owned !== undefined),
    close: async () => {
      closed = true;
      await Promise.all([...entries].map(([owner, entry]) => dispose(owner, entry)));
    },
  };
}
