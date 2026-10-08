
import type { ResourceIdentity } from './remote-protocol.js';
import { identifier, locator } from './publication-input.js';
import type { WorkspaceKey } from './workspace.js';
import type { FileEntry, FilePage, SavedRevision } from './revision-contracts.js';
import { RevisionError } from './revision-contracts.js';
const catalogPath = (path: string) => locator({ resource: { providerId: 'catalog', path }, view: { kind: 'published' } }).resource.path;

export const bindingHeader = 'x-boring-workspace';
export const catalogHeader = 'x-boring-catalog';
export interface RevisionBinding { readonly identity: ResourceIdentity; readonly workspace: WorkspaceKey }
export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new RevisionError('invalid', 'Invalid revision response');
  return value as Record<string, unknown>;
}
export function binding(value: unknown): RevisionBinding {
  const data = record(value), workspace = record(data.workspace), person = record(data.identity);
  return { identity: { principalId: identifier(person.principalId), scopeId: identifier(person.scopeId), initiatorId: identifier(person.initiatorId) }, workspace: {
    providerId: identifier(workspace.providerId), instanceId: identifier(workspace.instanceId),
    incarnation: identifier(workspace.incarnation), viewId: identifier(workspace.viewId),
  } };
}
export const bindingValue = (value: RevisionBinding): string => encodeURIComponent(JSON.stringify(binding(value)));
export function filePage(value: unknown): FilePage {
  const data = record(value);
  if (!Array.isArray(data.entries) || data.entries.length > 500 || (data.cursor !== undefined && (typeof data.cursor !== 'string' || data.cursor.length > 16384))) throw new RevisionError('invalid', 'Invalid file page');
  const entries = data.entries.map((item): FileEntry => {
    const entry = record(item);
    if ((entry.kind !== 'file' && entry.kind !== 'directory') || typeof entry.size !== 'number' || !Number.isSafeInteger(entry.size) || entry.size < 0 || typeof entry.path !== 'string') throw new RevisionError('invalid', 'Invalid file entry');
    return { path: catalogPath(entry.path), kind: entry.kind, size: entry.size };
  });
  if (new Set(entries.map(entry => entry.path)).size !== entries.length) throw new RevisionError('invalid', 'Duplicate file entries');
  return { entries, ...(typeof data.cursor === 'string' ? { cursor: data.cursor } : {}) };
}
export function savedRevisions(value: unknown): readonly SavedRevision[] {
  if (!Array.isArray(value) || value.length > 100_000) throw new RevisionError('invalid', 'Invalid file history');
  return value.map(item => {
    const entry = record(item);
    if (typeof entry.savedAt !== 'number' || !Number.isSafeInteger(entry.savedAt) || entry.savedAt < 0) throw new RevisionError('invalid', 'Invalid save timestamp');
    return { revision: identifier(entry.revision), savedAt: entry.savedAt };
  });
}
