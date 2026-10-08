import { identifier, locator, reference } from '@hachej/boring-files/publication';
import { randomUUID } from '@hachej/boring-files/platform';
import type { ReadResult, ResourceExpectation, ResourceLocator } from '@hachej/boring-files';
import type { SaveSelection } from './resources.js';
import type { TextBufferState } from './text-buffer-state.js';
import type { TextDraft, TextDraftActions, TextDraftBinding, TextDraftCheckpointResult, TextDraftChoiceFailure, TextDraftChoiceSelection, TextDraftDiscovery, TextDraftFailure, TextDraftKey, TextDraftRecoveryState, TextDraftRef } from './text-draft-types.js';

interface Owner {
  readonly binding: TextDraftBinding | undefined;
  readonly emptyText: string;
  readonly snapshot: () => TextBufferState;
  readonly selection: () => SaveSelection;
  readonly selected: (selection: SaveSelection) => boolean;
  readonly sameBase: (left: ResourceExpectation, right: ResourceExpectation) => boolean;
  readonly sameLocator: (left: ResourceLocator, right: ResourceLocator) => boolean;
  readonly pending: () => boolean;
  readonly read: () => Promise<ReadResult>;
  readonly sync: () => void;
  readonly changed: (state: TextDraftRecoveryState) => void;
  readonly restore: (text: string, guard: () => boolean) => boolean;
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Invalid recovery record');
  return Object.fromEntries(Object.entries(value));
}
function integer(value: unknown, minimum = 1): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) throw new TypeError('Invalid recovery bound');
  return value;
}
function expectation(value: unknown): ResourceExpectation {
  const input = object(value);
  if (input.kind === 'absent') return { kind: 'absent', target: locator(input.target) };
  if (input.kind === 'revision') return { kind: 'revision', target: reference(input.target) };
  throw new TypeError('Invalid recovery base');
}
function key(value: unknown): TextDraftKey {
  const input = object(value), identity = object(input.identity);
  return { identity: { principalId: identifier(identity.principalId), scopeId: identifier(identity.scopeId), initiatorId: identifier(identity.initiatorId) },
    providerInstanceId: identifier(input.providerInstanceId), target: locator(input.target), format: identifier(input.format) };
}
function draftRef(value: unknown): TextDraftRef {
  const input = object(value);
  return { key: key(input.key), base: expectation(input.base), writerId: identifier(input.writerId), sequence: integer(input.sequence) };
}
function sameRef(left: TextDraftRef, right: TextDraftRef): boolean { return JSON.stringify(left) === JSON.stringify(right); }
function failure(value: unknown): TextDraftFailure {
  const input = object(value);
  if (input.kind !== 'denied' && input.kind !== 'expired' && input.kind !== 'unavailable' && input.kind !== 'unknown') throw new TypeError('Invalid recovery result');
  return { kind: input.kind, reason: typeof input.reason === 'string' ? input.reason.slice(0, 1024) : 'Draft storage failed' };
}
function unavailable(reason: string): TextDraftFailure { return { kind: 'unavailable', reason }; }
function conflict(): TextDraftChoiceFailure { return { kind: 'conflict', reason: 'The recovery choice, current document, or local buffer changed' }; }
function validateText(text: unknown, maxBytes: number): string {
  if (typeof text !== 'string' || text.length > maxBytes) throw new TypeError('Recovery text exceeds its limit');
  const bytes = new TextEncoder().encode(text);
  if (bytes.length > maxBytes || new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes) !== text) throw new TypeError('Recovery text is not bounded valid Unicode');
  return text;
}

export function createTextDrafts(owner: Owner) {
  const binding = owner.binding;
  const maxBytes = integer(binding?.maxBytes ?? 8 * 1024 * 1024), maxDrafts = integer(binding?.maxDrafts ?? 20);
  if (binding) { identifier(binding.providerInstanceId); identifier(binding.format); integer(binding.expiresAt); integer(binding.retentionMs); }
  const writerId = randomUUID();
  let sequence = 0, checkSequence = 0, closed = false;
  let recovery: TextDraftRecoveryState = binding ? { kind: 'active', checkpoint: { kind: 'idle' }, discovery: { kind: 'idle' } } : { kind: 'disabled' };
  let current: { draft: TextDraft; version: number; promise: Promise<TextDraftCheckpointResult> } | undefined;
  let restored: TextDraft | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const activeKey: TextDraftKey | undefined = binding ? key({ identity: owner.snapshot().identity, providerInstanceId: binding.providerInstanceId, target: owner.snapshot().base.target, format: binding.format }) : undefined;

  function emit(next: TextDraftRecoveryState): void { recovery = next; owner.changed(next); }
  function stop(kind: 'revoked' | 'expired' | 'disposed'): void {
    checkSequence++;
    current = undefined;
    if (kind !== 'disposed') restored = undefined;
    if (timer !== undefined) clearTimeout(timer);
    binding?.signal.removeEventListener('abort', revoke);
    emit({ kind });
  }
  function revoke(): void { if (!closed) stop('revoked'); }
  function access(allowDisposed = false): TextDraftFailure | undefined {
    if (!binding) return unavailable('Draft recovery is disabled');
    if (binding.signal.aborted) { if (!closed && recovery.kind !== 'revoked') stop('revoked'); return { kind: 'denied', reason: 'Draft access was revoked' }; }
    if (binding.expiresAt <= Date.now()) { if (!closed && recovery.kind !== 'expired') stop('expired'); return { kind: 'expired', reason: 'Draft access expired' }; }
    if (closed && !allowDisposed) return unavailable('Viewer is disposed');
    if (owner.snapshot().readOnly) return { kind: 'denied', reason: 'Viewer is read-only' };
    return undefined;
  }
  function scheduleExpiry(): void {
    if (!binding || closed || recovery.kind !== 'active') return;
    if (timer !== undefined) clearTimeout(timer);
    let expiry = binding.expiresAt;
    if (current && current.draft.expiresAt > Date.now()) expiry = Math.min(expiry, current.draft.expiresAt);
    if (recovery.discovery.kind === 'offered') for (const choice of recovery.discovery.choices) expiry = Math.min(expiry, choice.expiresAt);
    timer = setTimeout(() => {
      if (access()) return;
      if (current && current.draft.expiresAt <= Date.now()) checkpointFailure(current.draft.ref, 'write', { kind: 'expired', reason: 'The recovery checkpoint expired' });
      if (recovery.kind === 'active' && recovery.discovery.kind === 'offered') {
        const choices = recovery.discovery.choices.filter(choice => choice.expiresAt > Date.now());
        emit({ ...recovery, discovery: choices.length ? { ...recovery.discovery, choices } : { kind: 'empty' } });
      }
      scheduleExpiry();
    }, Math.min(2_147_483_647, Math.max(1, expiry - Date.now())));
    if (typeof timer === 'object' && 'unref' in timer) timer.unref();
  }
  function discovery(value: TextDraftDiscovery): TextDraftDiscovery {
    if (recovery.kind === 'active') { emit({ ...recovery, discovery: value }); scheduleExpiry(); }
    return value;
  }
  function parseDraft(value: unknown): TextDraft {
    const input = object(value), ref = draftRef(input.ref);
    if (input.version !== 1 || !activeKey || JSON.stringify(ref.key) !== JSON.stringify(activeKey) || !owner.sameLocator(ref.base.target, activeKey.target)) throw new TypeError('Draft belongs to a different identity, provider, resource, view, or format');
    const createdAt = integer(input.createdAt, 0), expiresAt = integer(input.expiresAt);
    if (expiresAt <= createdAt) throw new TypeError('Invalid draft retention');
    return { version: 1, ref, text: validateText(input.text, maxBytes), createdAt, expiresAt };
  }
  async function list(): Promise<{ kind: 'available'; drafts: TextDraft[]; truncated: boolean } | TextDraftFailure> {
    if (!binding || !activeKey) return unavailable('Draft recovery is disabled');
    try {
      const value = object(await binding.store.list(structuredClone(activeKey), maxDrafts));
      if (value.kind !== 'available') return failure(value);
      if (!Array.isArray(value.drafts) || value.drafts.length > maxDrafts || typeof value.truncated !== 'boolean') return unavailable('Draft storage returned an unbounded listing');
      const drafts = value.drafts.map(parseDraft);
      if (new Set(drafts.map(item => JSON.stringify(item.ref))).size !== drafts.length) return unavailable('Draft storage returned duplicate records');
      return { kind: 'available', drafts: drafts.filter(item => item.expiresAt > Date.now()), truncated: value.truncated };
    } catch { return unavailable('Draft storage could not be read or validated'); }
  }
  function checkpointFailure(ref: TextDraftRef, operation: 'write' | 'remove', result: TextDraftFailure): void {
    if (!access() && recovery.kind === 'active' && (operation === 'remove' || current && sameRef(current.draft.ref, ref))) emit({ ...recovery, checkpoint: { kind: 'failed', ref, operation, result } });
  }
  async function write(draft: TextDraft): Promise<TextDraftCheckpointResult> {
    const denied = access(); if (denied || !binding) return denied ?? unavailable('Draft recovery is disabled');
    let result: TextDraftCheckpointResult;
    try {
      const value = object(await binding.store.write(structuredClone(draft)));
      result = value.kind === 'stored' ? { kind: 'stored', ref: draft.ref } : value.kind === 'superseded' ? { kind: 'superseded' } : failure(value);
    } catch { result = { kind: 'unknown', reason: 'Draft storage acknowledgement was lost' }; }
    const revoked = access(); if (revoked) return revoked;
    if (result.kind === 'stored' && draft.expiresAt <= Date.now()) result = { kind: 'expired', reason: 'The recovery checkpoint expired before acknowledgement' };
    if (result.kind === 'stored' && current && sameRef(current.draft.ref, draft.ref) && recovery.kind === 'active') emit({ ...recovery, checkpoint: { kind: 'stored', ref: draft.ref } });
    else if (result.kind === 'superseded' && current && sameRef(current.draft.ref, draft.ref) && recovery.kind === 'active') emit({ ...recovery, checkpoint: { kind: 'idle' } });
    else if ('reason' in result) checkpointFailure(draft.ref, 'write', result);
    return result;
  }
  function capture(): TextDraftRef | undefined {
    const state = owner.snapshot();
    if (access() || !binding || !activeKey || !state.dirty) return undefined;
    if (current && current.version === state.bufferVersion && owner.sameBase(current.draft.ref.base, state.base) && current.draft.text === state.text && current.draft.expiresAt > Date.now()) return current.draft.ref;
    const now = Date.now();
    const draft: TextDraft = { version: 1, ref: { key: activeKey, base: structuredClone(state.base), writerId, sequence: ++sequence }, text: state.text, createdAt: now, expiresAt: Math.min(binding.expiresAt, now + binding.retentionMs) };
    const item = { draft, version: state.bufferVersion, promise: Promise.resolve<TextDraftCheckpointResult>({ kind: 'superseded' }) };
    current = item;
    try { validateText(draft.text, maxBytes); }
    catch { const result = unavailable('The current text cannot be stored as a recovery draft'); item.promise = Promise.resolve(result); checkpointFailure(draft.ref, 'write', result); return draft.ref; }
    item.promise = Promise.resolve().then(() => write(draft));
    if (recovery.kind === 'active') emit({ ...recovery, checkpoint: { kind: 'pending', ref: draft.ref } });
    scheduleExpiry();
    return draft.ref;
  }
  async function remove(ref: TextDraftRef): Promise<TextDraftChoiceFailure | undefined> {
    const denied = access(true); if (denied || !binding) return denied ?? unavailable('Draft recovery is disabled');
    let result: TextDraftFailure | undefined;
    try {
      const value = object(await binding.store.remove(structuredClone(ref)));
      if (value.kind !== 'removed' && value.kind !== 'missing' && value.kind !== 'superseded') result = failure(value);
    } catch { result = { kind: 'unknown', reason: 'Draft removal acknowledgement was lost' }; }
    if (result) checkpointFailure(ref, 'remove', result);
    else if (!access() && current && sameRef(current.draft.ref, ref) && recovery.kind === 'active') emit({ ...recovery, checkpoint: { kind: 'idle' } });
    return access(true) ?? result;
  }
  async function latest(): Promise<ResourceExpectation | TextDraftFailure> {
    try {
      const read = await owner.read();
      if (read.kind === 'missing') return { kind: 'absent', target: locator(owner.snapshot().base.target) };
      if (read.kind !== 'available') return unavailable('The current document could not be checked');
      const ref = reference(read.snapshot.ref);
      if (!activeKey || !owner.sameLocator(ref, activeKey.target)) return unavailable('The current read returned a different resource');
      return { kind: 'revision', target: ref };
    } catch { return unavailable('The current document could not be checked'); }
  }
  function guarded(selection: SaveSelection): boolean {
    if (access()) return false;
    owner.sync();
    return !access() && owner.selected(selection) && !owner.pending();
  }
  async function choose(input: TextDraftChoiceSelection, restore: boolean): Promise<{ kind: 'restored'; selection: SaveSelection } | { kind: 'discarded' } | TextDraftChoiceFailure> {
    const denied = access(); if (denied) return denied;
    let selected: TextDraftChoiceSelection;
    try {
      selected = structuredClone(input);
      selected = { ...selected, draft: draftRef(selected.draft) };
    } catch { return conflict(); }
    const offer = recovery.kind === 'active' && recovery.discovery.kind === 'offered' ? recovery.discovery.choices.find(choice => JSON.stringify(choice.selection) === JSON.stringify(selected)) : undefined;
    if (!offer || offer.expiresAt <= Date.now() || !guarded(selected.viewer)) return conflict();
    const serial = checkSequence;
    const guard = () => serial === checkSequence && offer.expiresAt > Date.now() && guarded(selected.viewer);
    if (restore && owner.snapshot().dirty && !(owner.snapshot().base.kind === 'absent' && owner.snapshot().text === owner.emptyText && owner.snapshot().bufferVersion === 0)) return conflict();
    const remote = await latest();
    if (!guard()) return access() ?? conflict();
    if (remote.kind !== 'revision' && remote.kind !== 'absent') return remote;
    if (!owner.sameBase(remote, selected.observedCurrent)) return conflict();
    const records = await list();
    if (!guard()) return access() ?? conflict();
    if (records.kind !== 'available') return records;
    const draft = records.drafts.find(item => sameRef(item.ref, selected.draft));
    if (!draft || draft.text !== offer.text || draft.expiresAt !== offer.expiresAt) return conflict();
    if (!restore) {
      const result = await remove(draft.ref);
      if (result) return result;
      if (guard()) discovery({ kind: 'idle' });
      return { kind: 'discarded' };
    }
    if (!owner.sameBase(remote, draft.ref.base) || !owner.sameBase(remote, owner.snapshot().base)) return conflict();
    try { binding?.validateText?.(draft.text); }
    catch { return unavailable('The recovered document is not valid for this viewer'); }
    if (!guard()) return access() ?? conflict();
    if (!owner.restore(draft.text, guard)) return conflict();
    restored = draft;
    checkSequence++;
    discovery({ kind: 'idle' });
    return { kind: 'restored', selection: owner.selection() };
  }
  const actions: TextDraftActions = {
    checkDrafts: async () => {
      const denied = access(); if (denied) return denied;
      owner.sync();
      const selection = owner.selection(), serial = ++checkSequence;
      if (!guarded(selection)) return unavailable('A save must be settled before checking recovery drafts');
      discovery({ kind: 'checking' });
      const remote = await latest();
      if (serial !== checkSequence || !guarded(selection)) {
        const result = access() ?? unavailable('The viewer changed during recovery discovery');
        return serial === checkSequence ? discovery(result) : result;
      }
      if (remote.kind !== 'revision' && remote.kind !== 'absent') return discovery(remote);
      const records = await list();
      if (serial !== checkSequence || !guarded(selection)) {
        const result = access() ?? unavailable('The viewer changed during recovery discovery');
        return serial === checkSequence ? discovery(result) : result;
      }
      if (records.kind !== 'available') return discovery(records);
      const offerId = randomUUID();
      return discovery(records.drafts.length ? { kind: 'offered', truncated: records.truncated, choices: records.drafts.map(draft => ({ selection: { offerId, draft: draft.ref, viewer: selection, observedCurrent: remote }, text: draft.text, createdAt: draft.createdAt, expiresAt: draft.expiresAt, compatibility: owner.sameBase(draft.ref.base, remote) ? 'exact' : 'conflict' })) } : { kind: 'empty' });
    },
    checkpointDraft: async () => {
      const denied = access(); if (denied) return denied;
      owner.sync();
      const retry = recovery.kind === 'active' && recovery.checkpoint.kind === 'failed' && recovery.checkpoint.operation === 'write' ? recovery.checkpoint.ref : undefined;
      const ref = capture();
      if (!ref || !current) return { kind: 'clean' };
      const item = current;
      if (retry && sameRef(retry, ref)) item.promise = write(item.draft);
      return item.promise;
    },
    restoreDraft: async choice => {
      const result = await choose(choice, true);
      return result.kind === 'discarded' ? conflict() : result;
    },
    discardDraft: async choice => {
      const result = await choose(choice, false);
      return result.kind === 'restored' ? conflict() : result;
    },
  };
  if (binding) {
    binding.signal.addEventListener('abort', revoke, { once: true });
    if (!access()) scheduleExpiry();
  }
  return {
    actions, capture, remove, currentRef: () => current?.draft.ref, state: () => recovery,
    acknowledge: (ref: TextDraftRef | undefined, text: string): void => {
      if (ref) void remove(ref);
      if (restored?.text === text) { void remove(restored.ref); restored = undefined; }
    },
    dispose: (): void => { if (!closed) { stop('disposed'); closed = true; } },
  };
}
