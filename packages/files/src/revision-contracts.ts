import type { ResourceClient } from './client.js';
import type { ResourceAccess, ResourceLocator } from './contracts.js';
import type { ResourceIdentity } from './remote-protocol.js';
import type { WorkspaceKey } from './workspace-identity.js';

export interface FileEntry {
  readonly path: string;
  readonly kind: 'file' | 'directory';
  readonly size: number;
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
  /** Who wrote it: `publish` (a conditional write), `agent` (a Pi `write` or `edit`: observed, never receipted) or `observed` (retained as found). */
  readonly source?: 'publish' | 'agent' | 'observed';
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
   * The workspace's change feed (`GET ?op=changes`, server-sent events), reconnecting after the last `seq` seen until `signal`
   * aborts; a refused binding (another workspace, revoked access) ends it with a `RevisionError`. Optional: a hand-built provider
   * may have none, and a viewer then refreshes on its own schedule.
   */
  readonly changes?: (request?: ChangeFeedRequest) => AsyncIterable<WorkspaceChangeEvent>;
}
