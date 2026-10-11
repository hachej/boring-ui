
import type { ResourceIdentity } from './remote-protocol.js';
import { identifier, locator } from './publication-input.js';
import type { WorkspaceKey } from './workspace.js';
import type { FileEntry, FilePage, SavedRevision, WorkspaceChangeEvent } from './revision-contracts.js';
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
    const source = entry.source === 'publish' || entry.source === 'agent' || entry.source === 'observed' ? entry.source : undefined;
    return { revision: identifier(entry.revision), savedAt: entry.savedAt, ...(source ? { source } : {}) };
  });
}

const sources = new Set(['publish', 'agent', 'poll', 'watch']);
const sequence = (value: unknown, what: string): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new RevisionError('invalid', `Invalid ${what}`);
  return value;
};
/** One change-feed event as the server sent it, checked field by field (`data:` of `event: change | resnapshot`). */
export function changeEvent(value: unknown): WorkspaceChangeEvent {
  const data = record(value);
  const seq = sequence(data.seq, 'change sequence'), at = sequence(data.at, 'change time');
  if (data.kind === 'resnapshot') return { kind: 'resnapshot', seq, at };
  if (data.kind !== 'change' || typeof data.path !== 'string' || typeof data.source !== 'string' || !sources.has(data.source)) throw new RevisionError('invalid', 'Invalid change event');
  if (data.directory !== undefined && data.directory !== true) throw new RevisionError('invalid', 'Invalid change event');
  const path = data.path === '' && data.directory === true ? '' : catalogPath(data.path);
  const revision = data.revision === null ? null : identifier(data.revision);
  return {
    kind: 'change', path, revision, source: data.source as 'publish' | 'agent' | 'poll' | 'watch', seq, at,
    ...(data.directory === true ? { directory: true as const } : {}),
    ...(data.conversationId !== undefined ? { conversationId: identifier(data.conversationId) } : {}),
  };
}

/** Server-sent events from a response body: `{ event, data }` per message, comments skipped, a line longer than `limit` refused. */
export async function* serverEvents(body: ReadableStream<Uint8Array>, limit = 1_048_576): AsyncGenerator<{ readonly event: string; readonly data: string }> {
  const reader = body.getReader(), decoder = new TextDecoder();
  let pending = '', event = 'message', data: string[] = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      pending += decoder.decode(value, { stream: true });
      let newline: number;
      while ((newline = pending.search(/\r?\n/)) !== -1) {
        const line = pending.slice(0, newline);
        pending = pending.slice(pending[newline] === '\r' ? newline + 2 : newline + 1);
        if (line === '') { if (data.length) yield { event, data: data.join('\n') }; event = 'message'; data = []; continue; }
        if (line.startsWith(':')) continue;
        const colon = line.indexOf(':');
        const field = colon === -1 ? line : line.slice(0, colon);
        const content = colon === -1 ? '' : line.slice(colon + 1).replace(/^ /, '');
        if (field === 'event') event = content;
        else if (field === 'data') data.push(content);
      }
      if (pending.length > limit) throw new RevisionError('invalid', 'Change feed line exceeds the limit');
    }
  } finally {
    void reader.cancel().catch(() => {});
  }
}
