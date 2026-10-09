import type { PublicationReceipt, PublicationRequest, PublicationResult, ReadResult, ResourceClient, ResourceExpectation, ResourceLocator, ResourceRef, ResourceSnapshot } from '@hachej/boring-files';
import { PublicationNotDispatchedError, parsePublicationResult, publicationDigest } from '@hachej/boring-files/publication';
import type { SaveResult, SaveSelection } from './resources.js';
import { createTextDrafts } from './text-drafts.js';
import type { TextDraftBinding, TextDraftRef } from './text-draft-types.js';
import { randomUUID } from '@hachej/boring-files/platform';
import type { TextBufferState } from './text-buffer-state.js';
export type { TextBufferState } from './text-buffer-state.js';

export type TextBufferSource = { readonly kind: 'saved'; readonly snapshot: ResourceSnapshot }
  | { readonly kind: 'new'; readonly target: ResourceLocator; readonly text?: string };
export interface TextBufferOptions {
  readonly identity: TextBufferState['identity'];
  readonly instanceId: string;
  readonly epoch: string;
  readonly source: TextBufferSource;
  readonly client: ResourceClient;
  readonly readOnly?: boolean;
  readonly onListenerError?: (error: unknown) => void;
  readonly mediaType: string;
  readonly emptyText?: string;
  readonly drafts?: TextDraftBinding;
  readonly replaceText?: (text: string) => void;
  readonly sync?: () => void;
  readonly readText: (snapshot: ResourceSnapshot) => string;
}

interface SaveAttempt {
  readonly selection: SaveSelection;
  readonly text: string;
  readonly request: PublicationRequest;
  readonly digest: Promise<string>;
  readonly draft: TextDraftRef | undefined;
  promise: Promise<SaveResult>;
}

export function freeze<Value>(value: Value): Value {
  if (value !== null && typeof value === 'object') {
    Object.freeze(value);
    for (const nested of Object.values(value)) freeze(nested);
  }
  return value;
}

function sameLocator(left: ResourceLocator, right: ResourceLocator): boolean {
  return left.resource.providerId === right.resource.providerId && left.resource.path === right.resource.path
    && left.view.kind === right.view.kind
    && (left.view.kind === 'published' || (right.view.kind === 'working' && left.view.viewId === right.view.viewId));
}

export function sameBase(left: ResourceExpectation, right: ResourceExpectation): boolean {
  return sameLocator(left.target, right.target) && left.kind === right.kind
    && (left.kind === 'absent' || (right.kind === 'revision' && left.target.revision === right.target.revision));
}

export function createTextBuffer(options: TextBufferOptions) {
  const { instanceId, epoch, client } = options;
  if (!instanceId || !epoch) throw new TypeError('Viewer instance and epoch are required');
  const identity = freeze({ ...options.identity });
  if ([identity.scopeId, identity.principalId, identity.initiatorId].some(value => typeof value !== 'string' || !value)) throw new TypeError('Expected authenticated identity is required');
  const initial = options.source;
  const base: ResourceExpectation = initial.kind === 'saved'
    ? { kind: 'revision', target: structuredClone(initial.snapshot.ref) }
    : { kind: 'absent', target: structuredClone(initial.target) };
  let savedText = initial.kind === 'saved' ? options.readText(initial.snapshot) : '';
  let state: TextBufferState = freeze({ identity, text: initial.kind === 'saved' ? savedText : initial.text ?? '', base, bufferVersion: 0, readOnly: options.readOnly === true, dirty: initial.kind === 'new', lifecycle: 'active', save: { kind: 'idle' }, remote: null, recovery: { kind: 'disabled' } });
  const listeners = new Set<() => void>();
  let attempt: SaveAttempt | undefined;
  /** A save whose lookup found no receipt. Refresh, Discard and Abandon may release it and keep the local text as a draft. */
  let unreceipted: SaveAttempt | undefined;
  let refreshSequence = 0;
  let drafts: ReturnType<typeof createTextDrafts> | undefined;

  function update(next: TextBufferState): void {
    state = freeze(next);
    drafts?.capture();
    notify();
  }

  function notify(): void {
    for (const listener of [...listeners]) {
      try { listener(); }
      catch (error) {
        queueMicrotask(() => { if (options.onListenerError) options.onListenerError(error); else throw error; });
      }
    }
  }

  function selection(): SaveSelection {
    return freeze({ target: { instanceId, epoch, subject: { scopeId: identity.scopeId, base: state.base, bufferVersion: state.bufferVersion } } });
  }

  function selected(value: SaveSelection): boolean {
    return value.target.instanceId === instanceId && value.target.epoch === epoch
      && value.target.subject.scopeId === identity.scopeId
      && value.target.subject.bufferVersion === state.bufferVersion && sameBase(value.target.subject.base, state.base);
  }

  function unknown(current: SaveAttempt, reason: string): Extract<PublicationResult, { kind: 'unknown' }> {
    return { kind: 'unknown', operationId: current.request.operationId, reason };
  }

  function acknowledged(receipt: PublicationReceipt, current: SaveAttempt, digest: string): ResourceRef | undefined {
    if (receipt.operationId !== current.request.operationId || receipt.argumentDigest !== digest || !receipt.evidenceRef
      || receipt.principalId !== identity.principalId || receipt.scopeId !== identity.scopeId
      || receipt.initiatorId !== identity.initiatorId || receipt.changes.length !== 1) return undefined;
    const change = receipt.changes[0];
    const expected = current.selection.target.subject.base;
    if (!change || !change.after || !change.after.revision || !sameLocator(change.after, expected.target)) return undefined;
    if (expected.kind === 'absent') return change.kind === 'create' && change.before === null ? change.after : undefined;
    return change.kind === 'replace' && change.before !== null && sameLocator(change.before, expected.target)
      && change.before.revision === expected.target.revision ? change.after : undefined;
  }

  async function settle(current: SaveAttempt, value: unknown): Promise<SaveResult> {
    let outcome: PublicationResult;
    try { outcome = parsePublicationResult(value); }
    catch { outcome = unknown(current, 'Publication returned a malformed acknowledgement'); }
    if (outcome.kind === 'partial' || (outcome.kind === 'unknown' && outcome.operationId !== current.request.operationId)) {
      outcome = unknown(current, 'Publication returned an outcome for a different operation or atomicity');
    }
    let result: SaveResult;
    if (outcome.kind === 'committed') {
      let ref: ResourceRef | undefined;
      try { ref = acknowledged(outcome.receipt, current, await current.digest); } catch { ref = undefined; }
      result = ref
        ? { kind: 'saved', selection: current.selection, ref: structuredClone(ref), receipt: structuredClone(outcome.receipt) }
        : unknown(current, 'Publication acknowledgement does not match the selected buffer');
    } else result = outcome;
    if (result.kind === 'saved') drafts?.acknowledge(current.draft, current.text);
    if (state.lifecycle !== 'disposed') options.sync?.();
    if (attempt !== current) return result;
    if (result.kind !== 'unknown') attempt = undefined;
    if (state.lifecycle === 'disposed') return result;
    if (result.kind === 'saved') {
      savedText = current.text;
      update({ ...state, base: { kind: 'revision', target: result.ref }, dirty: state.text !== savedText, save: { kind: 'settled', result }, remote: null });
    } else update({ ...state, save: { kind: 'settled', result } });
    return result;
  }

  const flush = (value: SaveSelection, signal?: AbortSignal): Promise<SaveResult> => {
    if (state.lifecycle === 'disposed') return Promise.resolve({ kind: 'unavailable', reason: 'Viewer is disposed' });
    if (state.readOnly) return Promise.resolve({ kind: 'denied', reason: 'Viewer is read-only' });
    if (attempt) {
      const previous = attempt.selection.target;
      if (previous.instanceId === value.target.instanceId && previous.epoch === value.target.epoch
        && previous.subject.scopeId === value.target.subject.scopeId
        && previous.subject.bufferVersion === value.target.subject.bufferVersion && sameBase(previous.subject.base, value.target.subject.base)) return attempt.promise;
      return Promise.resolve(unknown(attempt, 'Reconcile or await the earlier save before saving another buffer'));
    }
    if (!selected(value)) return Promise.resolve({ kind: 'conflict', current: state.base.kind === 'revision' ? [state.base.target] : [], reason: 'Save selection is stale or belongs to another viewer' });
    const publish = client.publish?.bind(client);
    if (!publish) return Promise.resolve({ kind: 'unavailable', reason: 'Publication is unavailable' });
    if (signal?.aborted) return Promise.resolve({ kind: 'denied', reason: 'Save was cancelled before publication' });
    const captured = structuredClone(value);
    const selectedBase = captured.target.subject.base;
    const bytes = new TextEncoder().encode(state.text);
    if (new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes) !== state.text) return Promise.resolve({ kind: 'denied', reason: 'Document text contains invalid Unicode' });
    const request: PublicationRequest = {
      operationId: randomUUID(), atomicity: 'all-or-nothing',
      changes: [selectedBase.kind === 'absent'
        ? { kind: 'create', target: selectedBase.target, expected: { kind: 'absent' }, bytes, mediaType: options.mediaType }
        : { kind: 'replace', target: selectedBase.target, bytes, mediaType: options.mediaType }],
    };
    const current: SaveAttempt = {
      selection: freeze(captured), text: state.text, request, digest: publicationDigest(request), draft: drafts?.capture(),
      promise: Promise.resolve().then(async () => {
        try { await current.digest; }
        catch { return settle(current, { kind: 'unavailable', reason: 'Publication request could not be prepared' }); }
        let outcome: PublicationResult;
        try { outcome = await publish(request, signal); }
        catch (error) {
          outcome = error instanceof PublicationNotDispatchedError && error.operationId === request.operationId
            ? { kind: 'unavailable', reason: error.message }
            : unknown(current, 'Publication acknowledgement was lost');
        }
        return settle(current, outcome);
      }),
    };
    attempt = current;
    update({ ...state, save: { kind: 'pending', operationId: request.operationId } });
    return current.promise;
  };

  const reconcile = async (): Promise<SaveResult> => {
    const current = attempt;
    if (!current) return state.save.kind === 'settled' ? state.save.result : { kind: 'unavailable', reason: 'No save needs reconciliation' };
    await current.promise;
    if (attempt !== current) return current.promise;
    if (!client.lookup) return unknown(current, 'Operation lookup is unavailable');
    let outcome: unknown;
    try { outcome = await client.lookup(current.request.operationId); }
    catch { return unknown(current, 'Operation lookup failed'); }
    if (outcome && typeof outcome === 'object' && 'kind' in outcome && outcome.kind === 'not-found') {
      if (attempt === current) unreceipted = current;
      return unknown(current, 'No retained receipt; the save must not be replayed blindly. Refresh or discard to keep the text as a draft.');
    }
    return settle(current, outcome);
  };

  async function refresh(discard: boolean): Promise<ReadResult> {
    if (state.lifecycle === 'disposed') return { kind: 'unavailable', reason: 'Viewer is disposed' };
    const released = attempt !== undefined && attempt === unreceipted ? attempt : undefined;
    if (attempt !== released) return { kind: 'unavailable', reason: 'A save must be acknowledged before refreshing' };
    const sequence = ++refreshSequence;
    const previousBase = state.base;
    const previousVersion = state.bufferVersion;
    const read = await client.read({ target: previousBase.target, revision: { kind: 'latest' } });
    if (!disposed()) options.sync?.();
    if (disposed() || sequence !== refreshSequence || attempt !== released || !sameBase(previousBase, state.base)) return read;
    if (read.kind !== 'available' && read.kind !== 'missing') return read;
    if (read.kind === 'available' && !sameLocator(read.snapshot.ref, previousBase.target)) return { kind: 'unavailable', reason: 'Read returned a different resource' };
    const remote: ResourceExpectation = read.kind === 'available' ? { kind: 'revision', target: structuredClone(read.snapshot.ref) } : { kind: 'absent', target: previousBase.target };
    if (released) { attempt = undefined; unreceipted = undefined; update({ ...state, save: { kind: 'idle' } }); }
    // A document that was saved and is now missing is deleted remotely. Never turn it into empty content.
    if (read.kind === 'missing' && previousBase.kind === 'revision') {
      update({ ...state, remote });
      return read;
    }
    if (sameBase(remote, state.base) && !discard) {
      if (state.remote !== null) update({ ...state, remote: null });
      return read;
    }
    if (state.dirty && (!discard || state.bufferVersion !== previousVersion)) {
      update({ ...state, remote });
      return read;
    }
    let decoded: string;
    try {
      decoded = read.kind === 'available' ? options.readText(read.snapshot) : options.emptyText ?? '';
      if (disposed() || sequence !== refreshSequence || attempt || !sameBase(previousBase, state.base) || state.bufferVersion !== previousVersion) return read;
      options.replaceText?.(decoded);
      if (disposed() || sequence !== refreshSequence || attempt || !sameBase(previousBase, state.base) || state.bufferVersion !== previousVersion) return read;
    }
    catch { return { kind: 'unavailable', reason: 'Remote document could not be decoded or validated' }; }
    const discardedDraft = discard ? drafts?.currentRef() : undefined;
    savedText = decoded;
    update({ ...state, text: savedText, base: remote, bufferVersion: state.bufferVersion + 1, dirty: remote.kind === 'absent', remote: null, save: { kind: 'idle' } });
    if (discardedDraft) drafts?.remove(discardedDraft);
    return read;
  }

  /** Give up waiting for an unknown save and refresh, keeping the draft. The save is never reported committed and never replayed. */
  const abandon = async (): Promise<ReadResult> => {
    const current = attempt;
    if (!current || state.save.kind !== 'settled' || state.save.result.kind !== 'unknown') return { kind: 'unavailable', reason: 'No unconfirmed save to abandon' };
    unreceipted = current;
    return refresh(false);
  };

  function disposed(): boolean { return state.lifecycle === 'disposed'; }
  function observe(text: string, force = false): void {
    if (disposed()) throw new Error('Viewer is disposed');
    if (typeof text !== 'string') throw new TypeError('Document text must be a string');
    if (force || text !== state.text) update({ ...state, text, bufferVersion: state.bufferVersion + 1, dirty: state.base.kind === 'absent' || text !== savedText });
  }
  drafts = createTextDrafts({
    binding: options.drafts, emptyText: options.emptyText ?? '', snapshot: () => state, selection, selected, sameBase, sameLocator,
    pending: () => attempt !== undefined, read: () => client.read({ target: state.base.target, revision: { kind: 'latest' } }),
    sync: () => options.sync?.(),
    changed: recovery => { state = freeze({ ...state, recovery }); notify(); },
    restore: (text, guard) => {
      options.replaceText?.(text);
      if (!guard()) return false;
      update({ ...state, text, bufferVersion: state.bufferVersion + 1, dirty: true, save: { kind: 'idle' }, remote: null });
      return true;
    },
  });
  state = freeze({ ...state, recovery: drafts.state() });
  if (state.dirty && state.text) drafts.capture();
  return {
    ...drafts.actions,
    getSnapshot: () => state,
    subscribe: (listener: () => void): (() => void) => { if (disposed()) return () => {}; listeners.add(listener); return () => { listeners.delete(listener); }; },
    edit: (text: string, force = false): void => {
      if (disposed()) throw new Error('Viewer is disposed');
      if (state.readOnly) throw new Error('Viewer is read-only');
      observe(text, force);
    },
    observe, selection, refresh, abandon, reconcile, flush,
    dispose: (): void => { if (!disposed()) { drafts?.dispose(); update({ ...state, lifecycle: 'disposed' }); listeners.clear(); } },
  };
}
