import type { ReadResult, ResourceAccess, ResourceClient, ResourceExpectation, ResourceLocator, ResourceSnapshot } from '@hachej/boring-files';
import { applyTextEdits, parseTextEdits, type TextEdit } from '@hachej/boring-files/text';
import type { PresentationCommand, PresentationResult } from './contracts.js';
import { createTextBuffer, freeze, sameBase } from './text-buffer.js';
import type { EditableViewerController, SaveResult, SaveSelection } from './resources.js';
import { randomUUID } from '@hachej/boring-files/platform';
import type { TextDraftActions, TextDraftOptions, TextDraftRecoveryState } from './text-draft-types.js';

export type MarkdownSource = { readonly kind: 'saved'; readonly snapshot: ResourceSnapshot }
  | { readonly kind: 'new'; readonly target: ResourceLocator; readonly text?: string };

export interface MarkdownProposal {
  readonly id: string;
  readonly base: SaveSelection;
  readonly before: string;
  readonly after: string;
  readonly edits: readonly TextEdit[];
  readonly summary: string;
  readonly adopted: boolean;
}

type MarkdownSubject = SaveSelection['target']['subject'];
export interface MarkdownInspection {
  readonly selection: SaveSelection;
  readonly text: string;
  readonly dirty: boolean;
}
export interface MarkdownTools {
  readonly inspect: PresentationCommand<{ readonly expiresAt: number }, MarkdownInspection, MarkdownSubject>;
  readonly propose: PresentationCommand<{ readonly expiresAt: number; readonly edits: readonly TextEdit[]; readonly summary: string }, void, MarkdownSubject>;
}

export interface MarkdownState {
  readonly recovery: TextDraftRecoveryState;
  readonly identity: Pick<ResourceAccess, 'scopeId' | 'principalId' | 'initiatorId'>;
  readonly text: string;
  readonly base: ResourceExpectation;
  readonly proposals: readonly MarkdownProposal[];
  readonly readOnly: boolean;
  readonly bufferVersion: number;
  readonly dirty: boolean;
  readonly lifecycle: 'active' | 'disposed';
  readonly save: { readonly kind: 'idle' } | { readonly kind: 'pending'; readonly operationId: string }
    | { readonly kind: 'settled'; readonly result: SaveResult };
  readonly remote: ResourceExpectation | null;
}

export interface MarkdownActions extends TextDraftActions {
  readonly propose: (base: SaveSelection, edits: readonly TextEdit[], summary?: string) => PresentationResult<void, MarkdownSubject>;
  readonly accept: (proposalId: string) => Promise<SaveResult>;
  readonly reject: (proposalId: string) => void;
  readonly edit: (text: string) => void;
  readonly selection: () => SaveSelection;
  readonly refresh: () => Promise<ReadResult>;
  readonly reconcile: () => Promise<SaveResult>;
  /** For an unconfirmed save: stop reconciling and refresh, keeping the draft. The save is never reported committed or replayed. */
  readonly abandon: () => Promise<ReadResult>;
  readonly discardToRemote: () => Promise<ReadResult>;
}

export interface MarkdownOptions {
  readonly drafts?: TextDraftOptions;
  /** Expected authenticated identity is comparison metadata, never a grant. */
  readonly identity: Pick<ResourceAccess, 'scopeId' | 'principalId' | 'initiatorId'>;
  readonly instanceId: string;
  readonly epoch: string;
  readonly source: MarkdownSource;
  readonly client: ResourceClient;
  readonly readOnly?: boolean;
  readonly onListenerError?: (error: unknown) => void;
}

export type MarkdownController = EditableViewerController<MarkdownState, MarkdownActions, MarkdownTools>;

export function createMarkdownController(options: MarkdownOptions): MarkdownController {
  const { drafts, ...bufferOptions } = options;
  const buffer = createTextBuffer({ ...bufferOptions, ...(drafts ? { drafts: { ...drafts, format: 'markdown/v1' } } : {}), mediaType: 'text/markdown', readText: snapshot => {
    if (snapshot.mediaType !== 'text/markdown' && snapshot.mediaType !== 'text/plain') throw new TypeError('Expected Markdown or plain text');
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(snapshot.bytes);
  } });
  let state: MarkdownState = freeze({ ...buffer.getSnapshot(), proposals: [] });
  const listeners = new Set<() => void>();
  const update = (next: MarkdownState) => {
    state = freeze(next);
    for (const listener of [...listeners]) {
      try { listener(); }
      catch (error) { queueMicrotask(() => { if (options.onListenerError) options.onListenerError(error); else throw error; }); }
    }
  };
  const unsubscribe = buffer.subscribe(() => update({ ...buffer.getSnapshot(), proposals: state.proposals }));
  const selection = buffer.selection;
  const selected = (value: SaveSelection): boolean => {
    const current = selection().target, supplied = value.target;
    return current.instanceId === supplied.instanceId && current.epoch === supplied.epoch
      && current.subject.scopeId === supplied.subject.scopeId && current.subject.bufferVersion === supplied.subject.bufferVersion
      && sameBase(current.subject.base, supplied.subject.base);
  };
  function propose(base: SaveSelection, input: readonly TextEdit[], summary = ''): PresentationResult<void, MarkdownSubject> {
    if (state.lifecycle === 'disposed') return { kind: 'unavailable', reason: 'Viewer is disposed' };
    if (state.readOnly) return { kind: 'denied', reason: 'Viewer is read-only' };
    if (!selected(base)) return { kind: 'stale', reason: 'Proposal target has changed' };
    const edits = parseTextEdits(input);
    if (typeof summary !== 'string') throw new TypeError('Proposal summary must be text');
    const result = applyTextEdits(state.text, edits);
    if (result.kind === 'rejected') return { kind: 'denied', reason: result.reason };
    const proposal: MarkdownProposal = { id: randomUUID(), base: structuredClone(base), before: state.text, after: result.text, edits, summary, adopted: false };
    update({ ...state, proposals: [...state.proposals, proposal] });
    return { kind: 'proposed', proposalId: proposal.id, base: proposal.base.target };
  }

  function accept(proposalId: string): Promise<SaveResult> {
    if (state.lifecycle === 'disposed') return Promise.resolve({ kind: 'unavailable', reason: 'Viewer is disposed' });
    if (state.readOnly) return Promise.resolve({ kind: 'denied', reason: 'Viewer is read-only' });
    const unconfirmed = state.save.kind === 'pending' ? state.save.operationId
      : state.save.kind === 'settled' && state.save.result.kind === 'unknown' ? state.save.result.operationId : undefined;
    if (unconfirmed !== undefined) return Promise.resolve({ kind: 'unknown', operationId: unconfirmed, reason: 'Reconcile or await the earlier save before accepting a proposal' });
    const proposal = state.proposals.find(value => value.id === proposalId);
    if (!proposal || proposal.adopted || !selected(proposal.base)) return Promise.resolve({ kind: 'conflict', current: state.base.kind === 'revision' ? [state.base.target] : [], reason: 'Proposal base has changed or was already adopted' });
    const nextVersion = state.bufferVersion + 1;
    const adoptedSelection = freeze({ target: { ...proposal.base.target, subject: { ...proposal.base.target.subject, bufferVersion: nextVersion } } });
    state = freeze({ ...state, proposals: state.proposals.map(value => value.id === proposalId ? { ...value, adopted: true } : value) });
    buffer.edit(proposal.after, true);
    return buffer.flush(adoptedSelection);
  }

  function commandInput(value: unknown): { expiresAt: number } {
    if (!value || typeof value !== 'object' || !('expiresAt' in value) || typeof value.expiresAt !== 'number' || !Number.isSafeInteger(value.expiresAt)) throw new TypeError('Command expiry is required');
    return { expiresAt: value.expiresAt };
  }

  const tools: MarkdownTools = {
    inspect: {
      name: 'inspect_buffer', input: { jsonSchema: { type: 'object', properties: { expiresAt: { type: 'integer' } }, required: ['expiresAt'] }, parse: commandInput },
      invoke: async (target, input, signal) => {
        if (state.lifecycle === 'disposed') return { kind: 'unavailable', reason: 'Viewer is disposed' };
        if (signal?.aborted) return { kind: 'denied', reason: 'Command was cancelled' };
        if (commandInput(input).expiresAt <= Date.now() || !selected({ target })) return { kind: 'stale', reason: 'Command expired or its target changed' };
        return { kind: 'applied', value: { selection: selection(), text: state.text, dirty: state.dirty } };
      },
    },
    propose: {
      name: 'propose_patch', input: {
        jsonSchema: { type: 'object', properties: { expiresAt: { type: 'integer' }, summary: { type: 'string' }, edits: { type: 'array', minItems: 1, items: { type: 'object', properties: { find: { type: 'string', minLength: 1 }, replace: { type: 'string' } }, required: ['find', 'replace'], additionalProperties: false } } }, required: ['expiresAt', 'summary', 'edits'] },
        parse: value => {
          const expiry = commandInput(value);
          if (!value || typeof value !== 'object' || !('edits' in value) || !('summary' in value) || typeof value.summary !== 'string') throw new TypeError('Expected edits and summary');
          return { ...expiry, edits: parseTextEdits(value.edits), summary: value.summary };
        },
      },
      invoke: async (target, input, signal) => {
        if (signal?.aborted) return { kind: 'denied', reason: 'Command was cancelled' };
        if (commandInput(input).expiresAt <= Date.now()) return { kind: 'stale', reason: 'Command expired' };
        return propose({ target }, input.edits, input.summary);
      },
    },
  };

  return {
    getSnapshot: () => state,
    subscribe: listener => { if (state.lifecycle === 'disposed') return () => {}; listeners.add(listener); return () => { listeners.delete(listener); }; },
    actions: {
      edit: text => buffer.edit(text),
      propose, accept, reject: proposalId => { if (state.lifecycle !== 'disposed') update({ ...state, proposals: state.proposals.filter(value => value.id !== proposalId) }); },
      checkDrafts: buffer.checkDrafts, checkpointDraft: buffer.checkpointDraft, restoreDraft: buffer.restoreDraft, discardDraft: buffer.discardDraft,
      selection, refresh: () => buffer.refresh(false), discardToRemote: () => buffer.refresh(true), reconcile: buffer.reconcile, abandon: buffer.abandon,
    },
    tools: Object.freeze(tools), flush: buffer.flush,
    dispose: () => { buffer.dispose(); unsubscribe(); listeners.clear(); },
  };
}
