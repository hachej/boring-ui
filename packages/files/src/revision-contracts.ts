import type { ResourceClient } from './client.js';
import type { ResourceAccess, ResourceLocator } from './contracts.js';
import type { ResourceIdentity } from './remote-protocol.js';
import type { WorkspaceKey } from './workspace-identity.js';

/** What a viewer or a listing shows for a blob pointer (`./blob`): never the pointer itself. */
export interface BlobItem {
  readonly name: string;
  readonly size: number;
  readonly type: string;
  /** Same-origin URL of the bytes: `<blobBase><encodeURIComponent(id)>`. */
  readonly url: string;
}

/** A blob pointer written in a newer format than `./blob` reads: show it as its JSON file, and say it is a newer format. */
export interface UnsupportedBlobPointer { readonly kind: 'unsupported-version'; readonly version: number }

export interface FileEntry {
  readonly path: string;
  readonly kind: 'file' | 'directory';
  readonly size: number;
  /** A pointer file (`*.blob.json`) as a listing shows it: the item it stands for, or its unsupported version. Set by `withBlobPointers` (`./blob`), never by the protocol. */
  readonly blob?: BlobItem | UnsupportedBlobPointer;
}

export interface FilePage {
  readonly entries: readonly FileEntry[];
  readonly cursor?: string;
}

export interface FileListRequest {
  readonly directory?: string;
  readonly cursor?: string;
  readonly limit?: number;
}

export interface FileSearchRequest {
  readonly query: string;
  readonly cursor?: string;
  readonly limit?: number;
}

export interface SavedRevision {
  readonly revision: string;
  readonly savedAt: number;
  /** `publish`, `agent` or `observed` bytes; `rename`/`delete` retain the affected version. Receipts record each operation. */
  readonly source?: 'publish' | 'agent' | 'observed' | 'rename' | 'delete';
}

/**
 * One entry of a workspace's change feed (ruling 2 of 2026-10-10): an invalidation hint, never content or a receipt. Bytes and
 * the publication journal stay authoritative; a viewer that receives one reads again.
 *
 * - `change`: something at `path` changed. `revision` is the Git blob id now there, or `null` when the path is absent or is a
 *   directory (`directory: true`: something below it may have changed). `source`: `publish` (a conditional write), `agent` (a Pi
 *   `write` or `edit`), `poll` (found by hashing, for example after a `bash` command) or `watch` (reported by the file system).
 * - `resnapshot`: events were lost (the cursor is older than the retained window, from another provider lifetime, or the watcher
 *   overflowed or restarted). Reload everything shown, then continue after this `seq`.
 *
 * `seq` increases strictly within one provider lifetime; `at` is milliseconds since the epoch.
 */
export type WorkspaceChangeEvent =
  | { readonly kind: 'change'; readonly path: string; readonly revision: string | null; readonly source: 'publish' | 'agent' | 'poll' | 'watch'; readonly seq: number; readonly at: number; readonly directory?: true; readonly conversationId?: string }
  | { readonly kind: 'resnapshot'; readonly seq: number; readonly at: number };

export interface ChangeFeedRequest {
  /** The last `seq` already seen: only later events are delivered (a gap is a `resnapshot`). Absent: live events only. */
  readonly since?: number | undefined;
  /** The provider lifetime `since` came from (`ready` event). A cursor from another lifetime is a `resnapshot`, whatever its number. */
  readonly incarnation?: string | undefined;
  readonly signal?: AbortSignal | undefined;
}

export interface WorkspaceCatalog {
  readonly list: (request: FileListRequest, access: ResourceAccess) => Promise<FilePage>;
  readonly search: (request: FileSearchRequest, access: ResourceAccess) => Promise<FilePage>;
  readonly history: (path: string, access: ResourceAccess) => Promise<readonly SavedRevision[]>;
}

export class RevisionError extends Error {
  constructor(readonly kind: 'denied' | 'unavailable' | 'invalid' | 'aborted', message: string) {
    super(message);
    this.name = 'RevisionError';
  }
}

/** One authenticated binding for viewers, file browsing and publication. */
export interface RevisionProvider extends ResourceClient {
  readonly identity: ResourceIdentity;
  readonly workspace: WorkspaceKey;
  readonly locate: (path: string) => ResourceLocator;
  readonly publish: NonNullable<ResourceClient['publish']>;
  readonly lookup: NonNullable<ResourceClient['lookup']>;
  readonly list: (request: FileListRequest, signal?: AbortSignal) => Promise<FilePage>;
  readonly search: (request: FileSearchRequest, signal?: AbortSignal) => Promise<FilePage>;
  readonly history: (path: string, signal?: AbortSignal) => Promise<readonly SavedRevision[]>;
  /**
   * The host's largest file content per write, in bytes, when the binding names one (`createRevisionHandler({ maxFileBytes })`). The
   * server answers a larger file with the typed `file_too_large` result; a UI may refuse it before sending (the file tree does).
   * Absent: the host named no limit.
   */
  readonly maxFileBytes?: number;
  /**
   * The workspace's change feed (`GET ?op=changes`, server-sent events), reconnecting after the last `seq` seen until `signal`
   * aborts; a refused binding (another workspace, revoked access) ends it with a `RevisionError`, and so does a route that serves no feed:
   * it answers 501 (the intended signal) or 400 to `?op=changes`, and the views then keep their own refresh. Optional: a hand-built provider
   * may have none, and a viewer then refreshes on its own schedule.
   */
  readonly changes?: (request?: ChangeFeedRequest) => AsyncIterable<WorkspaceChangeEvent>;
}
