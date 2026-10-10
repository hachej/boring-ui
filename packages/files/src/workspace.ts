import type { Context } from '@earendil-works/chord';
import type { FileSystem, FileWatcher, WatchChange } from '@earendil-works/pi-durable/env';
import type { CommittedChange, PublicationLookupResult, PublicationReceipt, PublicationResult, ReadResult, ResourceAccess, ResourceCapabilities, ResourceExpectation, ResourceLocator, ResourceProvider, ResourceRead, ResourceRef, ResourceChange } from './contracts.js';
import { createWorkspaceCatalog } from './workspace-catalog.js';
import type { WorkspaceCatalogOptions } from './workspace-catalog.js';
import type { ChangeFeedRequest, WorkspaceCatalog, WorkspaceChangeEvent } from './revision-contracts.js';
export type { ChangeFeedRequest, WorkspaceChangeEvent } from './revision-contracts.js';
export type { WorkspaceCatalogOptions } from './workspace-catalog.js';
import { committedChanges } from './journal.js';
import type { HistorySource, OperationKey, StoredOperation, WorkspaceJournal } from './journal.js';
import { randomUUID, sha1 } from './platform.js';
import { accessSnapshot, identifier, locator, publicationDigest, publicationSnapshot } from './publication-input.js';
import { journalConnectionOf, sqliteBatchOf } from './sqlite-batch.js';

const sameBytes = (left: Uint8Array, right: Uint8Array) => left.length === right.length && left.every((byte, index) => byte === right[index]);

import type { WorkspaceKey } from './workspace-identity.js';
export type { WorkspaceKey } from './workspace-identity.js';

export interface WorkspaceChange {
  readonly path: string;
  /** `null` when the file is absent (or, from a watcher, when the path is a directory). */
  readonly revision: string | null;
  /** `publish`: a conditional write. `agent`: `record` (a Pi `write` or `edit`). `poll`: found by hashing. `watch`: the file system reported it. */
  readonly source: 'publish' | 'agent' | 'poll' | 'watch';
}

/** What `record` is told about an agent write (ruling 2: observed, never receipted). */
export interface AgentWrite {
  readonly path: string;
  /** The file before the write, when it existed: its revision and the bytes of that revision (kept in history as the replaced version). */
  readonly before?: { readonly revision: string; readonly bytes: Uint8Array } | null | undefined;
  /** The revision the write produced, as the caller observed it right after. */
  readonly after: string;
  readonly source: 'agent';
  /** The Pi conversation that wrote it, carried on the change event. */
  readonly conversationId?: string | undefined;
}

/** Runs one piece of work at a time, in order. A failed piece does not stop the ones behind it. */
export interface WorkspaceQueue {
  readonly run: <Value>(work: () => Promise<Value>) => Promise<Value>;
}

export interface WorkspaceResourceProvider extends ResourceProvider {
  readonly identity: WorkspaceKey;
  readonly catalog: WorkspaceCatalog;
  readonly publication: { readonly publish: (request: Parameters<NonNullable<ResourceProvider['publication']>['publish']>[0], access: ResourceAccess) => Promise<PublicationResult> };
  readonly reconciliation: { readonly lookup: (operationId: string, access: ResourceAccess) => Promise<PublicationLookupResult> };
  /** The workspace's mutation queue. Native tool calls that must not interleave with a conditional write run through it. */
  readonly queue: WorkspaceQueue;
  /**
   * Record a write the agent already made through the native tools (Pi `write`/`edit`, called by the file guard right after the
   * tool succeeded): the file's history gains the written revision (source `agent`, and the replaced one when `before` carries its
   * bytes) and the change feed an `agent` event. It never touches the publication journal and never mints a receipt: agent writes
   * are observed, not published. It does not enter `queue` (the guard already runs inside it), so it is safe to call from queued work.
   * When the bytes there no longer have the `after` revision (a shell wrote in between), only the change event is recorded.
   */
  readonly record: (write: AgentWrite, access: ResourceAccess) => Promise<void>;
  /**
   * The change feed: every write this provider makes or records, every change `poll` finds and, while someone is listening, every
   * change the file system's `watch` reports (the SQLite file system reports its own connection's writes at once). Ordered by
   * `seq` and replayable from `since` within a bounded window; a gap yields a `resnapshot` event. The iterator ends when
   * `request.signal` or `access.signal` aborts. Events are invalidation hints: read the bytes again.
   */
  readonly changes: (request: ChangeFeedRequest, access: ResourceAccess) => AsyncIterable<WorkspaceChangeEvent>;
  /** The seq of the newest change event (the cursor of "now" for `changes({ since })`). */
  readonly changeHead: () => number;
  /** Revisions still retained for a file, newest first. */
  readonly history: (path: string) => string[];
  /** The same revisions with the time each was saved (milliseconds since the epoch; 0 when unknown), newest first. */
  readonly saves: (path: string) => { readonly revision: string; readonly savedAt: number; readonly source: HistorySource }[];
  /** Read the file as it is now and retain that revision in its history (what `present` shows). Serialised with writes. */
  readonly keep: (path: string, access: ResourceAccess) => Promise<ReadResult>;
  /** Provider writes and polled detections. The listener must not throw. */
  readonly onChange: (listener: (change: WorkspaceChange) => void) => () => void;
  /**
   * Hash each path now and report those that differ from the last revision this provider wrote or polled. Finds shell writes.
   * Without `paths`, every file of the workspace (except `.git` and `node_modules`): the first such call takes the baseline and
   * reports nothing; later calls also report new and removed files. A host whose file system cannot `watch` calls it at the end of
   * each agent turn (after `bash`), so the change feed still sees shell writes.
   */
  readonly poll: (paths?: readonly string[], signal?: AbortSignal) => Promise<WorkspaceChange[]>;
}

export interface WorkspaceProviderOptions {
  readonly identity: WorkspaceKey;
  readonly fs: FileSystem;
  readonly journal: WorkspaceJournal;
  readonly catalog?: WorkspaceCatalogOptions;
  /** How many change events the feed retains for replay (default 1024). An older cursor gets a `resnapshot`. */
  readonly changeBuffer?: number;
  /** How long the watcher stays open after the last change-feed listener leaves, in milliseconds (default 30 000). */
  readonly watchLingerMs?: number;
}

const queues = new WeakMap<object, WorkspaceQueue>();

/** One queue per file system object: two providers over the same `fs` share it. */
function queueFor(fs: object): WorkspaceQueue {
  const existing = queues.get(fs);
  if (existing) return existing;
  let tail: Promise<unknown> = Promise.resolve();
  const queue: WorkspaceQueue = {
    run: work => {
      const result = tail.then(work, work);
      tail = result.catch(() => undefined);
      return result;
    },
  };
  queues.set(fs, queue);
  return queue;
}

const hex = (bytes: Uint8Array) => Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');

/** The Git blob id of `bytes` (`sha1("blob <length>\0" + bytes)`), computed without Git. */
export async function blobRevision(bytes: Uint8Array): Promise<string> {
  const header = new TextEncoder().encode(`blob ${bytes.length}\0`);
  const whole = new Uint8Array(header.length + bytes.length);
  whole.set(header);
  whole.set(bytes, header.length);
  return hex(await sha1(whole));
}

const mediaTypes: Record<string, string> = {
  md: 'text/markdown', markdown: 'text/markdown', html: 'text/html', htm: 'text/html', json: 'application/json', svg: 'image/svg+xml', txt: 'text/plain', tldraw: 'application/vnd.tldraw+json',
};

function mediaTypeOf(path: string): string {
  return mediaTypes[path.slice(path.lastIndexOf('.') + 1).toLowerCase()] ?? 'application/octet-stream';
}

type Observed = { readonly kind: 'file'; readonly bytes: Uint8Array; readonly revision: string } | { readonly kind: 'missing' } | { readonly kind: 'error'; readonly reason: string }
  | { readonly kind: 'outside'; readonly reason: string };

/** The provider's own temporary files. They are removed when the provider opens and are never a resource. */
const temporaryPattern = /^\.boring-[0-9a-f-]{36}\.tmp$/;
/** Whether a path is one of the provider's temporary files (a lister hides them). */
export const isTemporary = (path: string) => temporaryPattern.test(path.slice(path.lastIndexOf('/') + 1));

export function createWorkspaceProvider(options: WorkspaceProviderOptions): WorkspaceResourceProvider {
  const { fs, journal } = options;
  const identity = options.identity as Partial<WorkspaceKey> | undefined;
  if (!identity || typeof identity !== 'object') throw new TypeError('A workspace provider needs the host workspace identity');
  const key: WorkspaceKey = {
    providerId: identifier(identity.providerId), instanceId: identifier(identity.instanceId),
    incarnation: identifier(identity.incarnation), viewId: identifier(identity.viewId),
  };
  if (!fs || typeof fs.readBinaryFile !== 'function' || typeof fs.renameFile !== 'function') throw new TypeError('A workspace provider needs a Pi FileSystem');
  const providerId = key.providerId;
  const root = fs.cwd;
  if (typeof root !== 'string' || !root.startsWith('/')) throw new TypeError('The file system needs an absolute working directory');
  const queue = queueFor(fs);
  /** Present when `fs` is the SQLite file system (`@hachej/boring-files/sqlite-filesystem`): multi-file batches then commit in one transaction. */
  const batch = sqliteBatchOf(fs);
  const historyScope = JSON.stringify([key.providerId, key.instanceId, key.incarnation, key.viewId]);
  const listeners = new Set<(change: WorkspaceChange) => void>();
  const known = new Map<string, string | null>();
  const startedAt = Date.now();

  const fsContext = (signal?: AbortSignal): Context => ({ abortSignal: signal, value: () => undefined, toString: () => 'boring-workspace' });
  const absolute = (path: string) => root.endsWith('/') ? root + path : `${root}/${path}`;
  const ref = (path: string, revision: string): ResourceRef => ({ resource: { providerId, path }, view: { kind: 'published' }, revision });
  const supported = (value: ResourceLocator) => value.resource.providerId === providerId && value.view.kind === 'published';
  const operationKey = (operationId: string, access: ResourceAccess): OperationKey => ({
    scope: JSON.stringify([key.providerId, key.instanceId, key.viewId, access.scopeId]),
    principal: access.principalId, initiator: access.initiatorId, operation: operationId,
  });
  const ownEvidence = (evidence: string) => evidence.startsWith(`${key.incarnation}:`);

  // ---- The change feed: a bounded, seq-ordered buffer of invalidation hints ----------------------------------------------------
  const bufferLimit = options.changeBuffer ?? 1024;
  if (!Number.isSafeInteger(bufferLimit) || bufferLimit < 1) throw new RangeError('The change buffer must be a positive integer');
  const lingerMs = options.watchLingerMs ?? 30_000;
  // Sequence numbers start from the clock (microseconds), so a cursor from an earlier provider lifetime is older than this one's
  // first event and reads as a gap, never as a position in this lifetime.
  const firstSeq = Date.now() * 1000;
  let head = firstSeq;
  const buffer: WorkspaceChangeEvent[] = [];
  const waiting = new Set<() => void>();
  function append(event: { readonly kind: 'change'; readonly path: string; readonly revision: string | null; readonly source: WorkspaceChange['source']; readonly directory?: true; readonly conversationId?: string } | { readonly kind: 'resnapshot' }): void {
    head += 1;
    buffer.push(Object.freeze({ ...event, seq: head, at: Date.now() }));
    if (buffer.length > bufferLimit) buffer.shift();
    for (const wake of [...waiting]) wake();
  }

  function emit(change: WorkspaceChange, extra: { readonly directory?: true; readonly conversationId?: string } = {}): void {
    if (!extra.directory) known.set(change.path, change.revision);
    for (const listener of [...listeners]) {
      try { listener(change); } catch { /* a listener failure cannot undo a write */ }
    }
    append({ kind: 'change', ...change, ...extra });
  }

  const dirname = (path: string) => path.slice(0, path.lastIndexOf('/')) || '/';
  const inside = (base: string, path: string) => path === base || path.startsWith(base === '/' ? '/' : `${base}/`);
  let rootReal: Promise<string | undefined> | undefined;
  const realRoot = () => rootReal ??= fs.canonicalPath(root, fsContext()).then(result => result.ok ? result.value : undefined);

  /**
   * Refuses a path whose real location, after resolving symbolic links, is outside the workspace root. The target is checked when it
   * exists, else its deepest existing ancestor. `forWrite` also refuses a symbolic link as the target itself, so a replacement never
   * writes through a link. Returns a reason, or undefined when the path is contained.
   */
  async function escape(path: string, forWrite: boolean, signal?: AbortSignal): Promise<string | undefined> {
    const base = await realRoot();
    if (base === undefined) return 'The workspace root could not be resolved';
    const target = absolute(path);
    if (forWrite) {
      const info = await fs.fileInfo(target, fsContext(signal));
      if (info.ok && info.value.kind === 'symlink') return 'A symbolic link cannot be written through';
    }
    let candidate = target;
    for (;;) {
      const real = await fs.canonicalPath(candidate, fsContext(signal));
      if (real.ok) return inside(base, real.value) ? undefined : 'The path resolves outside the workspace';
      if (real.error.code !== 'not_found' && real.error.code !== 'not_directory') return real.error.message;
      // A dangling link has no canonical path but lstat finds it: never treat it as a missing file.
      const link = await fs.fileInfo(candidate, fsContext(signal));
      if (link.ok && link.value.kind === 'symlink') return 'The path is a dangling symbolic link';
      if (candidate === root || candidate === '/') return 'The path resolves outside the workspace';
      candidate = dirname(candidate);
    }
  }

  /** When the file was last modified, or now when the file system cannot say. */
  const savedAtOf = async (path: string, signal?: AbortSignal): Promise<number> => {
    const info = await fs.fileInfo(absolute(path), fsContext(signal));
    return info.ok && Number.isFinite(info.value.mtimeMs) ? Math.round(info.value.mtimeMs) : Date.now();
  };

  /** Read the bytes and hash exactly those bytes. */
  async function observe(path: string, signal?: AbortSignal): Promise<Observed> {
    if (isTemporary(path)) return { kind: 'missing' };
    const reason = await escape(path, false, signal);
    if (reason !== undefined) return { kind: 'outside', reason };
    const result = await fs.readBinaryFile(absolute(path), fsContext(signal));
    if (!result.ok) {
      return result.error.code === 'not_found' || result.error.code === 'not_directory' ? { kind: 'missing' } : { kind: 'error', reason: result.error.message };
    }
    const bytes = Uint8Array.from(result.value);
    return { kind: 'file', bytes, revision: await blobRevision(bytes) };
  }

  /** Once per provider, before its first operation: remove temporary files that an earlier process left behind. */
  let swept: Promise<void> | undefined;
  const sweep = () => swept ??= (async () => {
    const walk = async (directory: string): Promise<void> => {
      const listing = await fs.listDir(directory, fsContext());
      if (!listing.ok) return;
      for (const entry of listing.value) {
        if (entry.kind === 'directory') { if (entry.name !== '.git' && entry.name !== 'node_modules') await walk(entry.path); }
        else if (entry.kind === 'file' && isTemporary(entry.path) && entry.mtimeMs < startedAt) await fs.remove(entry.path, { force: true }, fsContext());
      }
    };
    await walk(root);
  })();

  const read = async (request: ResourceRead, context: ResourceAccess): Promise<ReadResult> => {
    const access = accessSnapshot(context);
    const selected = locator(request.target);
    if (request.revision.kind !== 'exact' && request.revision.kind !== 'latest') throw new TypeError('Invalid read revision');
    const wanted = request.revision.kind === 'exact' ? identifier(request.revision.value) : undefined;
    if (!supported(selected)) return { kind: 'unavailable', reason: 'This provider serves its published view only' };
    const path = selected.resource.path;
    await sweep();
    const current = await observe(path, access.signal);
    if (current.kind === 'outside') return { kind: 'denied', reason: current.reason };
    if (current.kind === 'error') return { kind: 'unavailable', reason: current.reason };
    if (current.kind === 'file' && (wanted === undefined || wanted === current.revision)) {
      const mediaType = journal.version(historyScope, path, current.revision)?.mediaType ?? mediaTypeOf(path);
      return { kind: 'available', snapshot: { ref: ref(path, current.revision), bytes: current.bytes, mediaType } };
    }
    if (wanted === undefined) return { kind: 'missing' };
    const retained = journal.version(historyScope, path, wanted);
    if (!retained) return { kind: 'unavailable', reason: 'The requested revision is not retained' };
    return { kind: 'available', snapshot: { ref: ref(path, wanted), bytes: retained.bytes, mediaType: retained.mediaType } };
  };

  const keep: WorkspaceResourceProvider['keep'] = (path, access) => queue.run(async () => {
    const result = await read({ target: { resource: { providerId, path }, view: { kind: 'published' } }, revision: { kind: 'latest' } }, access);
    if (result.kind === 'available') {
      const path = result.snapshot.ref.resource.path;
      journal.remember(historyScope, path, { revision: result.snapshot.ref.revision, bytes: result.snapshot.bytes, mediaType: result.snapshot.mediaType, savedAt: await savedAtOf(path), source: 'observed' });
    }
    return result;
  });

  function receipt(operationId: string, access: ResourceAccess, stored: StoredOperation): PublicationReceipt {
    return {
      operationId, argumentDigest: stored.digest, evidenceRef: stored.evidence,
      principalId: access.principalId, scopeId: access.scopeId, initiatorId: access.initiatorId,
      changes: committedChanges(stored.changes, ref),
    };
  }

  const publish: WorkspaceResourceProvider['publication']['publish'] = async (input, context) => {
    const request = publicationSnapshot(input);
    const access = accessSnapshot(context);
    const digest = await publicationDigest(request);
    if (request.atomicity !== 'all-or-nothing') return { kind: 'unavailable', reason: 'This provider accepts all-or-nothing publication only' };
    if (request.changes.length !== 1 && !batch) return { kind: 'unavailable', reason: 'This provider cannot apply a multi-file batch atomically; only a single-file change is accepted' };
    const changes: Exclude<ResourceChange, { kind: 'delete' }>[] = [];
    for (const change of request.changes) {
      if (change.kind === 'delete') return { kind: 'unavailable', reason: 'This provider does not delete files through publication' };
      changes.push(change);
    }
    const expectations: ResourceExpectation[] = [
      ...changes.map((change): ResourceExpectation => change.kind === 'create' ? { kind: 'absent', target: change.target } : { kind: 'revision', target: change.target }),
      ...(request.preconditions ?? []),
    ];
    if (expectations.some(item => !supported(item.target))) return { kind: 'unavailable', reason: 'This provider serves its published view only' };
    if (access.signal?.aborted) return { kind: 'unavailable', reason: 'The save was cancelled before it began' };
    const operation = operationKey(request.operationId, access);
    await sweep();

    return queue.run(async (): Promise<PublicationResult> => {
      const stored = journal.operation(operation);
      if (stored) {
        if (stored.digest !== digest) return { kind: 'conflict', current: [], reason: 'Operation ID is already bound to different arguments' };
        return ownEvidence(stored.evidence)
          ? { kind: 'committed', receipt: receipt(request.operationId, access, stored) }
          : { kind: 'unknown', operationId: request.operationId, reason: 'The workspace was recreated since this operation; its outcome cannot be confirmed' };
      }
      if (journal.intent(operation)) return { kind: 'unknown', operationId: request.operationId, reason: 'An earlier attempt of this operation began and has no recorded outcome' };

      journal.begin(operation, digest);
      let applying = false;
      const refuse = (reason: string): PublicationResult => { journal.cancel(operation); return { kind: 'unavailable', reason }; };
      try {
        // Every expectation is checked against the bytes as they are now, before any effect.
        const observed = new Map<string, Observed>();
        const conflicts: ResourceRef[] = [];
        let stale = false;
        for (const item of expectations) {
          const target = item.target.resource.path;
          let now = observed.get(target);
          if (!now) { now = await observe(target, access.signal); observed.set(target, now); }
          if (now.kind === 'outside') { journal.cancel(operation); return { kind: 'denied', reason: now.reason }; }
          if (now.kind === 'error') return refuse(now.reason);
          if (item.kind === 'absent' ? now.kind !== 'missing' : now.kind !== 'file' || now.revision !== item.target.revision) {
            stale = true;
            if (now.kind === 'file') conflicts.push(ref(target, now.revision));
          }
        }
        if (stale) { journal.cancel(operation); return { kind: 'conflict', current: conflicts, reason: 'Publication precondition failed' }; }

        if (expectations.some(item => isTemporary(item.target.resource.path))) return refuse('That name is reserved for the provider\'s temporary files');
        const plans: { change: typeof changes[number]; path: string; before: Observed | undefined; after: string; unchanged: boolean; beforeSavedAt: number }[] = [];
        for (const change of changes) {
          const path = change.target.resource.path;
          const forbidden = await escape(path, true, access.signal);
          if (forbidden !== undefined) { journal.cancel(operation); return { kind: 'denied', reason: forbidden }; }
          const after = await blobRevision(change.bytes);
          const unchanged = change.kind === 'replace' && after === change.target.revision;
          // The replaced revision was saved when its file was last modified, before this write changes that.
          plans.push({ change, path, before: observed.get(path), after, unchanged, beforeSavedAt: change.kind === 'replace' && !unchanged ? await savedAtOf(path, access.signal) : 0 });
        }

        const evidence = `${key.incarnation}:${randomUUID()}`;
        const versions = plans.flatMap(({ change, path, before, after, unchanged, beforeSavedAt }) => {
          const kept = (revision: string, bytes: Uint8Array, mediaType: string, savedAt: number, source: HistorySource) => ({ scope: historyScope, path, version: { revision, bytes, mediaType, savedAt, source } });
          return unchanged ? [] : [
            ...(change.kind === 'replace' && before?.kind === 'file'
              ? [kept(before.revision, before.bytes, journal.version(historyScope, path, before.revision)?.mediaType ?? mediaTypeOf(path), beforeSavedAt, 'observed')] : []),
            kept(after, change.bytes, change.mediaType, Date.now(), 'publish'),
          ];
        });
        const record: StoredOperation = {
          digest, evidence,
          changes: plans.map(({ change, path, after }) => change.kind === 'create' ? { kind: 'create', path, before: null, after } : { kind: 'replace', path, before: change.target.revision, after }),
        };

        if (access.signal?.aborted) return refuse('The save was cancelled before any change');
        if (batch) {
          // SQLite: every file, and the receipt when the journal shares the database, in one transaction. The expectations are
          // checked again inside it against the bytes they were hashed from, so a shell write in between is a conflict, not lost.
          const together = journalConnectionOf(journal) === batch.connection;
          const moved = batch.connection.transaction('write', () => {
            const changed = [...observed].filter(([path, seen]) => {
              const now = batch.bytes(absolute(path));
              return seen.kind === 'missing' ? now !== null : seen.kind !== 'file' || !(now instanceof Uint8Array) || !sameBytes(now, seen.bytes);
            }).map(([path]) => path);
            if (changed.length) return changed;
            for (const plan of plans) if (!plan.unchanged) batch.write(absolute(plan.path), plan.change.bytes);
            if (together) journal.complete(operation, record, versions);
            return [];
          });
          if (moved.length) {
            journal.cancel(operation);
            const current = await Promise.all(moved.map(async path => { const now = await observe(path, access.signal); return now.kind === 'file' ? [ref(path, now.revision)] : []; }));
            return { kind: 'conflict', current: current.flat(), reason: 'Publication precondition failed' };
          }
          applying = true;
          if (!together) journal.complete(operation, record, versions);
        } else {
          const { change, path, unchanged } = plans[0]!;
          if (!unchanged) {
            applying = true;
            const target = absolute(path);
            const temporary = `${target.slice(0, target.lastIndexOf('/'))}/.boring-${randomUUID()}.tmp`;
            const ctx = fsContext(access.signal);
            const failure = async (reason: string) => { await fs.remove(temporary, { force: true }, fsContext()); return refuse(reason); };
            if (change.kind === 'create') {
              const made = await fs.createDir(target.slice(0, target.lastIndexOf('/')) || '/', { recursive: true }, ctx);
              if (!made.ok) return refuse(made.error.message);
            }
            const written = await fs.writeFile(temporary, change.bytes, ctx);
            if (!written.ok) return await failure(written.error.message);
            const renamed = await fs.renameFile(temporary, target, ctx);
            if (!renamed.ok) {
              if (renamed.error.code === 'unknown' || renamed.error.code === 'aborted') throw renamed.error;
              return await failure(`The file could not be replaced atomically: ${renamed.error.message}`);
            }
          }
          journal.complete(operation, record, versions);
        }
        for (const { path, after, unchanged } of plans) if (!unchanged) emit({ path, revision: after, source: 'publish' });
        return { kind: 'committed', receipt: receipt(request.operationId, access, record) };
      } catch (error) {
        // Before the first effect nothing happened. After it, the outcome is unknown and the intent stays.
        if (!applying) return refuse(error instanceof Error ? error.message : 'The save failed before any change');
        return { kind: 'unknown', operationId: request.operationId, reason: error instanceof Error ? `The save was interrupted: ${error.message}` : 'The save was interrupted' };
      }
    });
  };

  const lookup = async (operationId: string, context: ResourceAccess): Promise<PublicationLookupResult> => {
    const id = identifier(operationId);
    const access = accessSnapshot(context);
    const operation = operationKey(id, access);
    await sweep();
    const stored = journal.operation(operation);
    if (stored) {
      return ownEvidence(stored.evidence)
        ? { kind: 'committed', receipt: receipt(id, access, stored) }
        : { kind: 'unknown', operationId: id, reason: 'The workspace was recreated since this operation; its outcome cannot be confirmed' };
    }
    return journal.intent(operation)
      ? { kind: 'unknown', operationId: id, reason: 'The operation began and has no recorded outcome' }
      : { kind: 'not-found' };
  };

  /** Every file of the workspace, relative to the root (not `.git`, `node_modules` or the provider's temporary files). */
  async function everyFile(signal?: AbortSignal): Promise<string[] | undefined> {
    const found: string[] = [];
    let scanned = 0;
    const walk = async (directory: string): Promise<boolean> => {
      const listing = await fs.listDir(directory ? absolute(directory) : root, fsContext(signal));
      if (!listing.ok) return true;
      for (const entry of listing.value) {
        if (++scanned > 100_000) return false;
        const path = directory ? `${directory}/${entry.name}` : entry.name;
        if (entry.kind === 'directory') { if (entry.name !== '.git' && entry.name !== 'node_modules' && !await walk(path)) return false; }
        else if (entry.kind === 'file' && !isTemporary(path)) found.push(path);
      }
      return true;
    };
    return await walk('') ? found : undefined;
  }

  let baselined = false;
  const poll: WorkspaceResourceProvider['poll'] = async (paths, signal) => {
    const changed: WorkspaceChange[] = [];
    await sweep();
    let inputs: readonly string[];
    let report = (path: string) => known.has(path);
    if (paths === undefined) {
      const files = await everyFile(signal);
      // Too many files to hash on each turn: say so to every listener instead of reporting a partial picture.
      if (files === undefined) { append({ kind: 'resnapshot' }); return changed; }
      const present = new Set(files);
      const removed = [...known].filter(([path, revision]) => revision !== null && !present.has(path)).map(([path]) => path);
      inputs = [...files, ...removed];
      if (baselined) report = () => true;
      baselined = true;
    } else inputs = paths;
    for (const input of inputs) {
      const path = locator({ resource: { providerId, path: input }, view: { kind: 'published' } }).resource.path;
      const now = await observe(path, signal);
      if (now.kind === 'error' || now.kind === 'outside' || isTemporary(path)) continue;
      const revision = now.kind === 'file' ? now.revision : null;
      if (known.has(path) && known.get(path) === revision) continue;
      if (!known.has(path) && revision === null && paths === undefined) continue;
      const change: WorkspaceChange = { path, revision, source: 'poll' };
      if (!report(path)) known.set(path, revision);
      else { emit(change); changed.push(change); }
    }
    return changed;
  };

  const record: WorkspaceResourceProvider['record'] = async (write, context) => {
    const access = accessSnapshot(context);
    if (write.source !== 'agent') throw new TypeError('Only agent writes are recorded');
    const path = locator({ resource: { providerId, path: write.path }, view: { kind: 'published' } }).resource.path;
    const after = identifier(write.after);
    const conversationId = write.conversationId === undefined ? undefined : identifier(write.conversationId);
    // Deliberately not `queue.run`: the file guard calls this from inside the queue, and the queue runs one piece at a time.
    const now = await observe(path, access.signal);
    if (now.kind === 'outside' || now.kind === 'error') return;
    if (now.kind === 'file' && now.revision === after) {
      const mediaType = journal.version(historyScope, path, after)?.mediaType ?? mediaTypeOf(path);
      const before = write.before ?? undefined;
      // The replaced bytes are kept only when they really are that revision.
      if (before && before.revision !== after && before.bytes instanceof Uint8Array && await blobRevision(before.bytes) === identifier(before.revision)) {
        journal.remember(historyScope, path, { revision: before.revision, bytes: Uint8Array.from(before.bytes), mediaType: journal.version(historyScope, path, before.revision)?.mediaType ?? mediaType, savedAt: 0, source: 'observed' });
      }
      journal.remember(historyScope, path, { revision: after, bytes: now.bytes, mediaType, savedAt: Date.now(), source: 'agent' });
    }
    emit({ path, revision: now.kind === 'file' ? now.revision : null, source: 'agent' }, conversationId === undefined ? {} : { conversationId });
  };

  // ---- The watcher: open while someone listens to the feed (and `lingerMs` after), when the file system can watch ----------------
  let listening = 0;
  let watcher: Promise<FileWatcher | undefined> | undefined;
  let watchUnsupported = false, watchedBefore = false;
  let linger: ReturnType<typeof setTimeout> | undefined;
  let watchWork: Promise<void> = Promise.resolve();
  const relativeTo = (absolutePath: string, base: string): string | undefined => {
    base = base.replace(/\/+$/, '') || '/';
    if (absolutePath === base) return '';
    const prefix = base === '/' ? '/' : `${base}/`;
    return absolutePath.startsWith(prefix) ? absolutePath.slice(prefix.length) : undefined;
  };
  async function watched(input: string): Promise<void> {
    // The watcher may name the root as given or as resolved (a symbolic link on the way to the workspace).
    const real = await realRoot();
    const path = relativeTo(input, root) ?? (real === undefined ? undefined : relativeTo(input, real));
    if (path === undefined || isTemporary(path) || path.split('/').some(name => name === '.git' || name === 'node_modules')) return;
    if (path === '') { emit({ path, revision: null, source: 'watch' }, { directory: true }); return; }
    const info = await fs.fileInfo(absolute(path), fsContext());
    if (info.ok && info.value.kind === 'directory') { emit({ path, revision: null, source: 'watch' }, { directory: true }); return; }
    const now = await observe(path);
    if (now.kind === 'error' || now.kind === 'outside') return;
    const revision = now.kind === 'file' ? now.revision : null;
    if (known.has(path) && known.get(path) === revision) return;
    emit({ path, revision, source: 'watch' });
  }
  function onWatch(change: WatchChange): void {
    if ('paths' in change) {
      const paths = [...change.paths];
      watchWork = watchWork.then(async () => { for (const path of paths) await watched(path).catch(() => undefined); });
      return;
    }
    // Overflow or a failed watcher: what changed is unknown, so every listener reloads. A failed watcher is not reopened (it would
    // fail again, for example on a tree past the environment's limit); the host's `poll()` at turn end remains.
    if ('error' in change) { watcher = undefined; watchUnsupported = true; }
    append({ kind: 'resnapshot' });
  }
  function startWatching(): void {
    if (linger !== undefined) { clearTimeout(linger); linger = undefined; }
    if (watcher || watchUnsupported) return;
    // Changes made while nobody watched were not seen: a listener resuming from before that reloads.
    if (watchedBefore) append({ kind: 'resnapshot' });
    watchedBefore = true;
    watcher = fs.watch([{ path: root, recursive: true, exclude: { names: ['.git', 'node_modules'] } }], onWatch, fsContext()).then(result => {
      if (result.ok) return result.value;
      watchUnsupported = true;
      return undefined;
    }, () => { watchUnsupported = true; return undefined; });
  }
  function stopWatching(): void {
    const current = watcher;
    watcher = undefined;
    void current?.then(value => value?.close(fsContext()));
  }

  async function* changes(request: ChangeFeedRequest, context: ResourceAccess): AsyncGenerator<WorkspaceChangeEvent> {
    const access = accessSnapshot(context);
    identifier(access.scopeId);
    const since = request.since;
    if (since !== undefined && (!Number.isSafeInteger(since) || since < 0)) throw new TypeError('Invalid change cursor');
    const signals = [request.signal, access.signal].filter((value): value is AbortSignal => value !== undefined);
    const signal = signals.length ? AbortSignal.any(signals) : new AbortController().signal;
    listening += 1;
    startWatching();
    try {
      let cursor = head;
      if (since !== undefined) {
        const oldest = buffer[0]?.seq ?? head + 1;
        if (since > head || since < firstSeq || since < oldest - 1) yield { kind: 'resnapshot', seq: head, at: Date.now() };
        else cursor = since;
      }
      while (!signal.aborted) {
        const oldest = buffer[0];
        // This listener fell behind the retained window: it reloads, then continues with what is retained.
        if (oldest && oldest.seq > cursor + 1) { cursor = oldest.seq - 1; yield { kind: 'resnapshot', seq: cursor, at: Date.now() }; continue; }
        const next = buffer.find(event => event.seq > cursor);
        if (next) {
          cursor = next.seq;
          // The access projection: nothing after revocation, never the provider's temporary files.
          if (signal.aborted) return;
          if (next.kind === 'change' && isTemporary(next.path)) continue;
          yield next;
          continue;
        }
        await new Promise<void>(resolve => {
          const wake = () => { waiting.delete(wake); signal.removeEventListener('abort', wake); resolve(); };
          waiting.add(wake);
          signal.addEventListener('abort', wake, { once: true });
        });
      }
    } finally {
      listening -= 1;
      if (listening === 0 && watcher) {
        linger = setTimeout(() => { linger = undefined; if (listening === 0) stopWatching(); }, lingerMs);
        (linger as { unref?: () => void }).unref?.();
      }
    }
  }

  return {
    providerId, read, queue, keep, identity: Object.freeze(key),
    catalog: createWorkspaceCatalog({ fs, ...(options.catalog ? { config: options.catalog } : {}), saves: path => journal.saves(historyScope, path) }),
    publication: { publish }, reconciliation: { lookup }, poll, record, changes, changeHead: () => head,
    history: path => journal.revisions(historyScope, locator({ resource: { providerId, path }, view: { kind: 'published' } }).resource.path),
    saves: path => journal.saves(historyScope, locator({ resource: { providerId, path }, view: { kind: 'published' } }).resource.path),
    onChange: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    capabilities: async (input): Promise<ResourceCapabilities> => {
      const selected = locator(input);
      const ok = supported(selected);
      const actions = ['read', 'create', 'replace', 'lookup'] as const;
      return {
        supported: ok ? actions : [], effective: ok ? actions : [], availability: ok ? 'available' : 'unavailable', observedAt: new Date().toISOString(),
        guarantees: { pinnedReads: true, conditionalPublication: true, atomicMutationAndReceipt: batch !== undefined && journalConnectionOf(journal) === batch.connection, atomicBatch: batch !== undefined, operationLookup: true, revocationFencing: false },
      };
    },
  };
}

