import { applyCanvasEdits, canvasMediaType, parseCanvasDocument, parseCanvasEdits } from './canvas-document.js';
import { parseCanvasRecords } from './canvas-records.js';
import { loadSnapshot } from '@tldraw/editor';
import type { TLStore, TLStoreSnapshot } from '@tldraw/editor';
import { Store } from '@tldraw/store';
import type { ResourceAccess, ResourceClient, ResourceLocator, ResourceSnapshot } from '@hachej/boring-files';
import type { CanvasEdit } from './canvas-document.js';
import type { PresentationCommand, PresentationResult } from './contracts.js';
import { randomUUID } from '@hachej/boring-files/platform';
import type { SaveResult, SaveSelection } from './resources.js';
import { createTextBuffer, freeze, sameBase, type TextBufferState } from './text-buffer.js';
import type { TextDraftOptions } from './text-draft-types.js';

export { canvasMediaType } from './canvas-document.js';
export type CanvasSource = { readonly kind: 'saved'; readonly snapshot: ResourceSnapshot }
  | { readonly kind: 'new'; readonly target: ResourceLocator };
export interface CanvasOptions {
  readonly drafts?: TextDraftOptions;
  /** Borrow one editor's store; the host owns its lifetime and native schema. */
  readonly store: TLStore;
  readonly source: CanvasSource;
  readonly client: ResourceClient;
  readonly identity: Pick<ResourceAccess, 'scopeId' | 'principalId' | 'initiatorId'>;
  readonly instanceId: string;
  readonly epoch: string;
  readonly readOnly?: boolean;
  readonly onListenerError?: (error: unknown) => void;
}
export interface CanvasProposal {
  readonly id: string;
  readonly base: SaveSelection;
  readonly before: TLStoreSnapshot;
  readonly after: TLStoreSnapshot;
  readonly edits: readonly CanvasEdit[];
  readonly summary: string;
  readonly adopted: boolean;
}
type CanvasSubject = SaveSelection['target']['subject'];
export interface CanvasInspection {
  readonly selection: SaveSelection;
  readonly document: TLStoreSnapshot;
  readonly dirty: boolean;
}
export interface CanvasProposalInput { readonly expiresAt: number; readonly edits: readonly CanvasEdit[]; readonly summary: string }
export interface CanvasTools {
  readonly inspect: PresentationCommand<{ readonly expiresAt: number }, CanvasInspection, CanvasSubject>;
  readonly propose: PresentationCommand<CanvasProposalInput, void, CanvasSubject>;
}
export type CanvasState = Omit<TextBufferState, 'text'> & {
  readonly document: TLStoreSnapshot;
  readonly problem: string | null;
  readonly proposals: readonly CanvasProposal[];
};
function documentText(document: TLStoreSnapshot): string {
  return JSON.stringify({ schema: document.schema, store: document.store });
}
function documentFrom(value: unknown, owner: TLStore): TLStoreSnapshot {
  const records = parseCanvasRecords(value, owner.schema);
  const scratch = new Store({ schema: owner.schema, props: owner.props });
  try {
    scratch.loadStoreSnapshot(records);
    return parseCanvasDocument(scratch.getStoreSnapshot('document'), owner.schema);
  } finally { scratch.dispose(); }
}

/** Revision-checked document publication over a borrowed native tldraw store. */
export function createCanvasController(options: CanvasOptions) {
  const { store } = options;
  let loading = false, disposed = false, adopting = false;
  let proposals: readonly CanvasProposal[] = [];
  let problem: string | null = null;
  const readText = (snapshot: ResourceSnapshot): string => {
    if (snapshot.mediaType !== canvasMediaType) throw new TypeError('Expected a tldraw document media type');
    const input: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(snapshot.bytes));
    return documentText(documentFrom(parseCanvasDocument(input, store.schema), store));
  };
  const emptyText = documentText(documentFrom({ schema: store.schema.serialize(), store: {} }, store));
  const initialText = options.source.kind === 'saved' ? readText(options.source.snapshot)
    : documentText(documentFrom(store.getStoreSnapshot('document'), store));
  const existing = store.getStoreSnapshot('document');
  if (options.source.kind === 'saved' && Object.keys(existing.store).length > 0
    && documentText(documentFrom(existing, store)) !== initialText) throw new Error('Borrowed canvas store differs from the saved source; select an empty store or explicitly discard before mounting');
  let captured = initialText;
  const replaceText = (text: string): void => {
    const input: unknown = JSON.parse(text);
    const document = documentFrom(input, store);
    loading = true;
    try { loadSnapshot(store, { document }); captured = documentText(document); problem = null; }
    finally { loading = false; }
  };
  const { drafts, ...bufferOptions } = options;
  const buffer = createTextBuffer({ ...bufferOptions, ...(drafts ? { drafts: { ...drafts, format: 'canvas/v1', validateText: (text: string): void => { documentFrom(parseCanvasDocument(JSON.parse(text), store.schema), store); } } } : {}), source: options.source.kind === 'new' ? { ...options.source, text: initialText } : options.source,
    mediaType: canvasMediaType, emptyText, readText, replaceText, sync: () => capture() });
  replaceText(initialText);
  function snapshot(): CanvasState {
    const { text: _text, ...state } = buffer.getSnapshot();
    return freeze({ ...state, document: structuredClone(store.getStoreSnapshot('document')), problem, proposals });
  }
  let state = snapshot();
  const listeners = new Set<() => void>();
  const notify = () => {
    state = snapshot();
    for (const listener of [...listeners]) {
      try { listener(); }
      catch (error) { queueMicrotask(() => { if (options.onListenerError) options.onListenerError(error); else throw error; }); }
    }
  };
  const unsubscribe = buffer.subscribe(notify);
  const capture = (): void => {
    if (disposed || loading) return;
    const document = store.getStoreSnapshot('document'), text = documentText(document);
    if (text === captured) return;
    try { parseCanvasDocument(document, store.schema); problem = null; }
    catch (error) { problem = error instanceof Error ? error.message : 'Canvas document is invalid'; }
    captured = text;
    buffer.observe(text);
  };
  const cleanup = Object.values(store.schema.types).filter(type => type.scope === 'document').flatMap(type => [
    store.sideEffects.registerAfterCreateHandler(type.typeName, capture),
    store.sideEffects.registerAfterChangeHandler(type.typeName, capture),
    store.sideEffects.registerAfterDeleteHandler(type.typeName, capture),
  ]);
  cleanup.push(store.listen(capture, { scope: 'document', source: 'all' }));
  const selected = (value: SaveSelection): boolean => {
    const current = buffer.selection().target, supplied = value.target;
    return current.instanceId === supplied.instanceId && current.epoch === supplied.epoch
      && current.subject.scopeId === supplied.subject.scopeId && current.subject.bufferVersion === supplied.subject.bufferVersion
      && sameBase(current.subject.base, supplied.subject.base);
  };
  const conflict = (): SaveResult => ({ kind: 'conflict', current: state.base.kind === 'revision' ? [state.base.target] : [], reason: 'Proposal base changed or the proposal was already adopted' });
  function propose(base: SaveSelection, input: readonly CanvasEdit[], summary = '', command?: { readonly expiresAt: number; readonly signal?: AbortSignal }): PresentationResult<void, CanvasSubject> {
    const expected = structuredClone(base);
    capture();
    if (disposed) return { kind: 'unavailable', reason: 'Viewer is disposed' };
    if (loading || adopting) return { kind: 'unavailable', reason: 'Canvas document is being updated' };
    if (state.readOnly) return { kind: 'denied', reason: 'Viewer is read-only' };
    if (problem) return { kind: 'denied', reason: problem };
    if (!selected(expected)) return { kind: 'stale', reason: 'Proposal target has changed' };
    if (typeof summary !== 'string') throw new TypeError('Proposal summary must be text');
    const before = structuredClone(state.document), edits = parseCanvasEdits(input, store.schema);
    const result = applyCanvasEdits(before, edits, store.schema);
    if (result.kind === 'rejected') return { kind: 'denied', reason: result.reason };
    capture();
    if (disposed) return { kind: 'unavailable', reason: 'Viewer is disposed' };
    if (command?.signal?.aborted) return { kind: 'denied', reason: 'Command was cancelled' };
    if (command && command.expiresAt <= Date.now()) return { kind: 'stale', reason: 'Command expired' };
    if (!selected(expected)) return { kind: 'stale', reason: 'Proposal target changed during validation' };
    const proposal = freeze({ id: randomUUID(), base: expected, before, after: result.document, edits, summary, adopted: false });
    proposals = [...proposals, proposal]; notify();
    return { kind: 'proposed', proposalId: proposal.id, base: proposal.base.target };
  }
  function accept(proposalId: string): Promise<SaveResult> {
    capture();
    if (disposed) return Promise.resolve({ kind: 'unavailable', reason: 'Viewer is disposed' });
    if (loading || adopting) return Promise.resolve({ kind: 'unavailable', reason: 'Canvas document is being updated' });
    if (state.readOnly) return Promise.resolve({ kind: 'denied', reason: 'Viewer is read-only' });
    if (problem) return Promise.resolve({ kind: 'denied', reason: problem });
    const pending = state.save.kind === 'pending' ? state.save.operationId
      : state.save.kind === 'settled' && state.save.result.kind === 'unknown' ? state.save.result.operationId : undefined;
    if (pending !== undefined) return Promise.resolve({ kind: 'unknown', operationId: pending, reason: 'Reconcile or await the earlier save before accepting a proposal' });
    const proposal = proposals.find(value => value.id === proposalId);
    if (!proposal || proposal.adopted || !selected(proposal.base)) return Promise.resolve(conflict());
    adopting = true;
    try {
      proposals = proposals.map(value => value.id === proposal.id ? freeze({ ...value, adopted: true }) : value);
      loading = true;
      try { loadSnapshot(store, { document: structuredClone(proposal.after) }); }
      finally { loading = false; }
      capture();
      if (state.proposals !== proposals) notify();
      capture();
      if (disposed) return Promise.resolve({ kind: 'unavailable', reason: 'Viewer is disposed' });
      if (problem) return Promise.resolve({ kind: 'denied', reason: problem });
      if (documentText(store.getStoreSnapshot('document')) !== documentText(proposal.after)) return Promise.resolve(conflict());
      return buffer.flush(buffer.selection());
    } finally { adopting = false; }
  }
  function commandInput(value: unknown): { expiresAt: number } {
    if (!value || typeof value !== 'object' || !('expiresAt' in value) || typeof value.expiresAt !== 'number' || !Number.isSafeInteger(value.expiresAt)) throw new TypeError('Command expiry is required');
    return { expiresAt: value.expiresAt };
  }
  function proposalInput(value: unknown): CanvasProposalInput {
    const expiry = commandInput(value);
    if (!value || typeof value !== 'object' || !('edits' in value) || !('summary' in value) || typeof value.summary !== 'string') throw new TypeError('Expected edits and summary');
    return { ...expiry, edits: parseCanvasEdits(value.edits, store.schema), summary: value.summary };
  }
  const tools: CanvasTools = {
    inspect: {
      name: 'inspect_canvas_buffer', input: { jsonSchema: { type: 'object', properties: { expiresAt: { type: 'integer' } }, required: ['expiresAt'] }, parse: commandInput },
      invoke: async (target, input, signal) => {
        const base = structuredClone({ target }), expiry = commandInput(input);
        capture();
        if (disposed || loading) return { kind: 'unavailable', reason: 'Canvas document is unavailable' };
        if (signal?.aborted) return { kind: 'denied', reason: 'Command was cancelled' };
        if (expiry.expiresAt <= Date.now() || !selected(base)) return { kind: 'stale', reason: 'Command expired or its target changed' };
        if (problem) return { kind: 'unavailable', reason: problem };
        return { kind: 'applied', value: freeze({ selection: buffer.selection(), document: structuredClone(state.document), dirty: state.dirty }) };
      },
    },
    propose: {
      name: 'propose_canvas_edits', input: {
        jsonSchema: { type: 'object', properties: { expiresAt: { type: 'integer' }, summary: { type: 'string' }, edits: { type: 'array', minItems: 1, items: { oneOf: [
          { type: 'object', properties: { kind: { enum: ['create', 'update'] }, record: { type: 'object', description: 'Complete native TLShape or TLBinding record validated by the selected schema' } }, required: ['kind', 'record'], additionalProperties: false },
          { type: 'object', properties: { kind: { const: 'remove' }, id: { type: 'string' } }, required: ['kind', 'id'], additionalProperties: false },
        ] } } }, required: ['expiresAt', 'summary', 'edits'] }, parse: proposalInput,
      },
      invoke: async (target, input, signal) => {
        const base = structuredClone({ target }), parsed = proposalInput(input);
        if (signal?.aborted) return { kind: 'denied', reason: 'Command was cancelled' };
        if (parsed.expiresAt <= Date.now()) return { kind: 'stale', reason: 'Command expired' };
        return propose(base, parsed.edits, parsed.summary, { expiresAt: parsed.expiresAt, ...(signal ? { signal } : {}) });
      },
    },
  };
  return {
    store,
    getSnapshot: (): CanvasState => state,
    subscribe: (listener: () => void): (() => void) => { if (disposed) return () => {}; listeners.add(listener); return () => { listeners.delete(listener); }; },
    actions: {
      selection: (): SaveSelection => { capture(); if (problem) throw new Error(problem); return buffer.selection(); },
      refresh: () => { capture(); return buffer.refresh(false); },
      discardToRemote: () => { capture(); return buffer.refresh(true); },
      reconcile: buffer.reconcile, abandon: buffer.abandon,
      checkDrafts: buffer.checkDrafts, checkpointDraft: buffer.checkpointDraft, restoreDraft: buffer.restoreDraft, discardDraft: buffer.discardDraft,
      propose: (base: SaveSelection, edits: readonly CanvasEdit[], summary?: string) => propose(base, edits, summary), accept,
      reject: (proposalId: string): void => { if (!disposed) { proposals = proposals.filter(value => value.id !== proposalId); notify(); } },
    },
    tools: Object.freeze(tools),
    flush: (selection: SaveSelection, signal?: AbortSignal) => {
      capture();
      return problem ? Promise.resolve({ kind: 'denied' as const, reason: problem }) : buffer.flush(selection, signal);
    },
    dispose: (): void => {
      if (disposed) return;
      disposed = true;
      for (const remove of cleanup) remove();
      buffer.dispose(); unsubscribe(); listeners.clear();
    },
  };
}
export type CanvasController = ReturnType<typeof createCanvasController>;
