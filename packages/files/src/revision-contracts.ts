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
}
