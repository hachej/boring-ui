import type { ResourceAccess, ResourceClient, ResourceLocator, ResourceSnapshot } from '@hachej/boring-files';
import { randomUUID } from '@hachej/boring-files/platform';
import { createTextBuffer, freeze } from './text-buffer.js';
import type { TextBufferState } from './text-buffer-state.js';
import type { SaveResult } from './resources.js';
import { markdownQuoteResolution, type MarkdownQuoteAnchor } from './markdown-quote.js';

export type MarkColour = 'accent' | 'primary' | 'muted';
export interface DocumentMark {
  readonly id: string;
  readonly anchor: MarkdownQuoteAnchor;
  readonly colour: MarkColour;
  readonly note: string;
  readonly author: string;
  readonly time: string;
}
export interface MarkStoreSnapshot {
  readonly marks: readonly DocumentMark[];
  readonly save: TextBufferState['save'];
  readonly dirty: boolean;
  readonly lifecycle: 'active' | 'disposed';
}
export interface MarkStore {
  readonly getSnapshot: () => MarkStoreSnapshot;
  readonly subscribe: (notify: () => void) => () => void;
  readonly add: (mark: DocumentMark) => Promise<SaveResult>;
  readonly edit: (id: string, change: Partial<Pick<DocumentMark, 'anchor' | 'colour' | 'note'>>) => Promise<SaveResult>;
  readonly remove: (id: string) => Promise<SaveResult>;
  readonly reconcile: () => Promise<SaveResult>;
  /** Explicitly discard a refused local change and load current marks. Unknown writes must be reconciled first. */
  readonly reload: () => Promise<void>;
  readonly dispose: () => void;
}
export interface MarkResource {
  readonly client: ResourceClient;
  /** Expected receipt identity, never authentication authority. */
  readonly identity: Pick<ResourceAccess, 'scopeId' | 'principalId' | 'initiatorId'>;
}
function mark(value: unknown): DocumentMark {
  if (!value || typeof value !== 'object') throw new TypeError('Invalid document mark');
  const m = value as Record<string, unknown>;
  if (typeof m['id'] !== 'string' || !m['id'] || !['accent', 'primary', 'muted'].includes(String(m['colour']))
    || typeof m['note'] !== 'string' || typeof m['author'] !== 'string' || !m['author'] || typeof m['time'] !== 'string' || !Number.isFinite(Date.parse(m['time']))) throw new TypeError('Invalid document mark');
  return { id: m['id'], anchor: markdownQuoteResolution.schema.parse(m['anchor']), colour: m['colour'] as MarkColour, note: m['note'], author: m['author'], time: m['time'] };
}
function decode(text: string): readonly DocumentMark[] {
  const data: unknown = JSON.parse(text);
  if (!data || typeof data !== 'object' || !('format' in data) || data.format !== 'document.marks@1' || !('marks' in data) || !Array.isArray(data.marks)) throw new TypeError('Unsupported marks file');
  const marks = data.marks.map(mark);
  if (new Set(marks.map(m => m.id)).size !== marks.length) throw new TypeError('Duplicate mark id');
  return marks;
}
const encode = (marks: readonly DocumentMark[]) => JSON.stringify({ format: 'document.marks@1', marks }, null, 2) + '\n';
const readText = (snapshot: ResourceSnapshot) => {
  const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(snapshot.bytes);
  decode(text); return text;
};

/** Host data/presentation concern; uses the workspace's existing resource publication seam, not Pi execution state. */
export async function createMarkStore(resource: MarkResource, locator: ResourceLocator): Promise<MarkStore> {
  const client = resource.client;
  const identity = structuredClone(resource.identity);
  const target: ResourceLocator = { resource: { ...locator.resource, path: `${locator.resource.path}.marks.json` }, view: structuredClone(locator.view) };
  const read = await client.read({ target, revision: { kind: 'latest' } });
  if (read.kind !== 'available' && read.kind !== 'missing') throw new Error('Marks are unavailable');
  if (read.kind === 'available' && (read.snapshot.ref.resource.providerId !== target.resource.providerId || read.snapshot.ref.resource.path !== target.resource.path
    || JSON.stringify(read.snapshot.ref.view) !== JSON.stringify(target.view))) throw new Error('Marks read returned another resource');
  const buffer = createTextBuffer({ client, identity, instanceId: randomUUID(), epoch: randomUUID(),
    source: read.kind === 'available' ? { kind: 'saved', snapshot: read.snapshot } : { kind: 'new', target, text: encode([]) },
    mediaType: 'application/json', emptyText: encode([]), readText });
  let snapshot: MarkStoreSnapshot;
  const update = () => { const s = buffer.getSnapshot(); snapshot = freeze({ marks: decode(s.text), save: s.save, dirty: s.dirty, lifecycle: s.lifecycle }); };
  update();
  const listeners = new Set<() => void>();
  const unsubscribe = buffer.subscribe(() => { update(); for (const notify of [...listeners]) notify(); });
  let preparing = false;
  const mutate = (transform: (marks: readonly DocumentMark[]) => readonly DocumentMark[]): Promise<SaveResult> => {
    const s = buffer.getSnapshot();
    if (s.lifecycle === 'disposed') return Promise.resolve({ kind: 'unavailable', reason: 'Marks store is disposed' });
    if (preparing || s.save.kind === 'pending' || s.save.kind === 'settled' && s.save.result.kind !== 'saved') return Promise.resolve({ kind: 'unavailable', reason: 'Reconcile or reload marks before another change' });
    preparing = true;
    try {
      buffer.edit(encode(transform(snapshot.marks)));
      return buffer.flush(buffer.selection());
    } finally { preparing = false; }
  };
  return {
    getSnapshot: () => snapshot,
    subscribe: notify => { listeners.add(notify); return () => { listeners.delete(notify); }; },
    add: input => { const captured = mark(input); return mutate(marks => { if (marks.some(m => m.id === captured.id)) throw new TypeError('Duplicate mark id'); return [...marks, captured]; }); },
    edit: (id, change) => { const captured = structuredClone(change); return mutate(marks => { if (!marks.some(m => m.id === id)) throw new TypeError('Unknown mark id'); return marks.map(m => m.id === id ? mark({ ...m, ...captured }) : m); }); },
    remove: id => mutate(marks => { if (!marks.some(m => m.id === id)) throw new TypeError('Unknown mark id'); return marks.filter(m => m.id !== id); }),
    reconcile: buffer.reconcile,
    reload: async () => { const s = buffer.getSnapshot(); if (s.save.kind === 'pending' || s.save.kind === 'settled' && s.save.result.kind === 'unknown') throw new Error('Reconcile the unconfirmed save first');
      const result = await buffer.refresh(true); if (result.kind !== 'available' && result.kind !== 'missing') throw new Error('Marks reload failed'); },
    dispose: () => { buffer.dispose(); unsubscribe(); listeners.clear(); },
  };
}
