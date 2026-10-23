import type { PublicationRequest, PublicationResult, ResourceRef } from '@hachej/boring-files';
import { parsePublicationResult, PublicationNotDispatchedError, publicationDigest, publicationSnapshot } from '@hachej/boring-files/publication';
import { randomUUID } from '@hachej/boring-files/platform';
import type { FileEntry, FilePage, RevisionProvider, SavedRevision } from '@hachej/boring-files/revision';

export type FileListing = { readonly kind: 'loading'; readonly entries: readonly FileEntry[] }
  | { readonly kind: 'ready'; readonly entries: readonly FileEntry[]; readonly cursor?: string }
  | { readonly kind: 'error'; readonly entries: readonly FileEntry[]; readonly reason: string };
export interface FileUpload {
  readonly operationId: string;
  readonly path: string;
  readonly size: number;
  readonly state: { readonly kind: 'pending' } | { readonly kind: 'settled'; readonly result: PublicationResult };
}
/** A rename (a move is a rename to another folder) or a delete of one file, as its row shows it. */
export interface FileMutation {
  readonly operationId: string;
  readonly kind: 'rename' | 'delete';
  readonly path: string;
  /** The new path of a rename. */
  readonly to?: string;
  readonly state: { readonly kind: 'pending' } | { readonly kind: 'settled'; readonly result: PublicationResult };
}
export interface FileTreeState {
  readonly lifecycle: 'active' | 'disposed';
  readonly directories: ReadonlyMap<string, FileListing>;
  readonly expanded: ReadonlySet<string>;
  readonly query: string;
  readonly search: FileListing;
  readonly uploads: readonly FileUpload[];
  /** The latest rename or delete of each path, until it is dismissed or the path changes again. */
  readonly mutations: readonly FileMutation[];
}
export interface FileTreeController {
  readonly revisionProvider: RevisionProvider;
  readonly getSnapshot: () => FileTreeState;
  readonly subscribe: (listener: () => void) => () => void;
  readonly refresh: (directory?: string) => Promise<void>;
  readonly more: (directory?: string) => Promise<void>;
  readonly toggle: (directory: string) => Promise<void>;
  readonly search: (query: string) => Promise<void>;
  readonly moreSearch: () => Promise<void>;
  readonly upload: (input: { readonly path: string; readonly bytes: Uint8Array; readonly mediaType?: string; readonly replace?: ResourceRef; readonly signal?: AbortSignal }) => Promise<FileUpload>;
  readonly reconcile: (operationId: string) => Promise<FileUpload>;
  /** Retry a refused upload with its captured bytes. Unconfirmed uploads only reconcile the original operation. */
  readonly retry: (operationId: string) => Promise<FileUpload>;
  readonly history: (path: string, signal?: AbortSignal) => Promise<readonly SavedRevision[]>;
  /** What the client can do: a client without `rename` or `delete` offers neither (the host's capabilities may narrow it further). */
  readonly actions: { readonly rename: boolean; readonly delete: boolean };
  /** Learn the revision of a file as its row shows it (on opening its menu, renaming, dragging): a later rename or delete is conditional on it. */
  readonly prepare: (path: string, signal?: AbortSignal) => Promise<string | undefined>;
  /** Rename a file through the client's conditional rename. `to` is a full path; its folder must exist. */
  readonly rename: (path: string, to: string) => Promise<FileMutation>;
  /** Move a file into `folder` (`''` is the workspace root): a rename that keeps its name. */
  readonly move: (path: string, folder: string) => Promise<FileMutation>;
  /** Delete a file through the client's conditional delete. */
  readonly remove: (path: string) => Promise<FileMutation>;
  /** Forget a settled rename or delete (its row's message). */
  readonly dismiss: (operationId: string) => void;
  readonly dispose: () => void;
}

const message = (error: unknown) => error instanceof Error ? error.message : 'Files could not be loaded';
const empty: FileListing = { kind: 'ready', entries: [] };
const parentOf = (path: string) => path.slice(0, Math.max(0, path.lastIndexOf('/')));
const nameOf = (path: string) => path.slice(path.lastIndexOf('/') + 1);
/** A file path the tree may write: relative segments, none empty, `.` or `..`, no surrounding space. */
function checkedPath(path: string): string {
  const segments = path.split('/');
  if (!path || segments.some(segment => !segment || segment === '.' || segment === '..' || segment.trim() !== segment)) throw new TypeError(`${JSON.stringify(path)} is not a file name the tree can use`);
  return path;
}
const sameBytes = (left: Uint8Array, right: Uint8Array) => left.length === right.length && left.every((byte, index) => byte === right[index]);
const sameTarget = (left: ResourceRef, right: PublicationRequest['changes'][number]['target']) =>
  left.resource.providerId === right.resource.providerId && left.resource.path === right.resource.path
  && left.view.kind === right.view.kind && (left.view.kind !== 'working' || (right.view.kind === 'working' && left.view.viewId === right.view.viewId));

/** Browsing state belongs to one borrowed binding. Disposal fences late results; it never closes the workspace. */
export function createFileTreeController({ revisionProvider }: { readonly revisionProvider: RevisionProvider }): FileTreeController {
  let state: FileTreeState = { lifecycle: 'active', directories: new Map(), expanded: new Set(), query: '', search: empty, uploads: [], mutations: [] };
  // The revision each row last learned (`prepare`): a rename or delete is refused if the file changed since.
  const revisions = new Map<string, string>();
  const listeners = new Set<() => void>();
  const lifetime = new AbortController();
  const loads = new Map<string, AbortController>();
  const attempts = new Map<string, { readonly request: PublicationRequest; readonly digest: string; readonly bytes: Uint8Array; current: FileUpload; reconciling?: Promise<FileUpload> }>();
  const update = (next: FileTreeState) => { if (state.lifecycle === 'active') { state = next; for (const listener of [...listeners]) { try { listener(); } catch { /* A subscriber cannot interrupt publication or other subscribers. */ } } } };
  const active = () => { if (state.lifecycle !== 'active') throw new Error('The file tree is disposed'); };
  const directory = (path: string, listing: FileListing) => update({ ...state, directories: new Map(state.directories).set(path, listing) });

  async function load(path: string, append: boolean, search = false): Promise<void> {
    active();
    const key = search ? 'search' : `directory:${path}`;
    const previous = search ? state.search : state.directories.get(path) ?? empty;
    const cursor = append && previous.kind === 'ready' ? previous.cursor : undefined;
    if (append && cursor === undefined) return;
    loads.get(key)?.abort();
    const abort = new AbortController(); loads.set(key, abort);
    const signal = AbortSignal.any([abort.signal, lifetime.signal]);
    const query = state.query;
    const set = (value: FileListing) => search ? update({ ...state, search: value }) : directory(path, value);
    set({ kind: 'loading', entries: previous.entries });
    try {
      const page: FilePage = await (search ? revisionProvider.search({ query, ...(cursor ? { cursor } : {}) }, signal)
        : revisionProvider.list({ directory: path, ...(cursor ? { cursor } : {}) }, signal));
      if (signal.aborted || loads.get(key) !== abort) return;
      const entries = append ? [...new Map([...previous.entries, ...page.entries].map(entry => [entry.path, entry])).values()] : [...page.entries];
      set({ kind: 'ready', entries, ...(page.cursor === undefined ? {} : { cursor: page.cursor }) });
    } catch (error) {
      if (!signal.aborted && loads.get(key) === abort) set({ kind: 'error', entries: previous.entries, reason: message(error) });
    } finally { if (loads.get(key) === abort) loads.delete(key); }
  }
  const refresh = (path = '') => load(path, false);
  function uploadState(operationId: string, result: PublicationResult): FileUpload {
    const attempt = attempts.get(operationId);
    if (!attempt) throw new Error('Unknown upload operation');
    const current: FileUpload = { ...attempt.current, state: { kind: 'settled', result } };
    attempt.current = current;
    update({ ...state, uploads: state.uploads.map(item => item.operationId === operationId ? current : item) });
    if (result.kind === 'committed' && state.lifecycle === 'active') {
      let path = parentOf(current.path);
      const parents = new Set<string>(['', path]);
      while (path.includes('/')) { path = parentOf(path); parents.add(path); }
      update({ ...state, expanded: new Set([...state.expanded, ...[...parents].filter(Boolean)]) });
      for (const parent of parents) void refresh(parent);
    }
    return current;
  }
  const unknown = (operationId: string, reason: string): PublicationResult => ({ kind: 'unknown', operationId, reason });
  function checked(operationId: string, input: unknown): PublicationResult {
    const attempt = attempts.get(operationId);
    if (!attempt) throw new Error('Unknown upload operation');
    let result: PublicationResult;
    try { result = parsePublicationResult(input); } catch { return unknown(operationId, 'The upload acknowledgement was invalid; check its status'); }
    if (result.kind === 'partial' || (result.kind === 'unknown' && result.operationId !== operationId)) return unknown(operationId, 'The upload acknowledgement did not match its operation');
    if (result.kind !== 'committed') return result;
    const receipt = result.receipt, change = receipt.changes[0], expected = attempt.request.changes[0], identity = revisionProvider.identity;
    if (receipt.operationId !== operationId || receipt.argumentDigest !== attempt.digest || !receipt.evidenceRef
      || receipt.principalId !== identity.principalId || receipt.scopeId !== identity.scopeId || receipt.initiatorId !== identity.initiatorId
      || receipt.changes.length !== 1 || !change?.after || !sameTarget(change.after, expected.target)
      || (expected.kind === 'create' ? change.kind !== 'create' || change.before !== null
        : expected.kind !== 'replace' || change.kind !== 'replace' || !change.before || !sameTarget(change.before, expected.target) || change.before.revision !== expected.target.revision)) {
      return unknown(operationId, 'The upload receipt did not match its request');
    }
    return result;
  }

  const unavailableResult = (reason: string): PublicationResult => ({ kind: 'unavailable', reason });
  async function latest(path: string, signal: AbortSignal): Promise<string | PublicationResult> {
    const read = await revisionProvider.read({ target: revisionProvider.locate(path), revision: { kind: 'latest' } }, signal);
    if (read.kind === 'available') return read.snapshot.ref.revision;
    if (read.kind === 'missing') return { kind: 'conflict', current: [], reason: `${path} is no longer there` };
    return read;
  }
  function settle(current: FileMutation, result: PublicationResult): FileMutation {
    const settled: FileMutation = { ...current, state: { kind: 'settled', result } };
    update({ ...state, mutations: state.mutations.map(item => item.operationId === current.operationId ? settled : item) });
    if (state.lifecycle !== 'active') return settled;
    // Whatever the outcome, the folders involved are read again, so the tree shows what is there now.
    const folders = new Set([parentOf(current.path), ...(current.to === undefined ? [] : [parentOf(current.to)])]);
    if (result.kind === 'committed' && current.to !== undefined && parentOf(current.to)) update({ ...state, expanded: new Set([...state.expanded, parentOf(current.to)]) });
    for (const folder of folders) void refresh(folder);
    if (state.query) void load('', false, true);
    return settled;
  }
  async function mutate(kind: FileMutation['kind'], path: string, to?: string): Promise<FileMutation> {
    active();
    if (kind === 'rename' ? !revisionProvider.rename : !revisionProvider.delete) throw new Error(`This workspace cannot ${kind} files`);
    if (state.mutations.some(item => item.path === path && item.state.kind === 'pending')) throw new Error(`${path} is already being changed; wait for it to finish`);
    const operationId = randomUUID();
    const current: FileMutation = { operationId, kind, path, ...(to === undefined ? {} : { to }), state: { kind: 'pending' } };
    update({ ...state, mutations: [...state.mutations.filter(item => item.path !== path), current] });
    let result: PublicationResult;
    try {
      const known = revisions.get(path) ?? await latest(path, lifetime.signal);
      if (typeof known !== 'string') result = known;
      else {
        const from = revisionProvider.locate(path);
        const answer = kind === 'rename' && to !== undefined
          ? await revisionProvider.rename!({ from, to: revisionProvider.locate(to), expectedRevision: known, operationId }, lifetime.signal)
          : await revisionProvider.delete!({ path: from, expectedRevision: known, operationId }, lifetime.signal);
        try { result = parsePublicationResult(answer); } catch { result = unknown(operationId, 'The acknowledgement was invalid; read the folder again before retrying'); }
        if (result.kind === 'partial' || (result.kind === 'unknown' && result.operationId !== operationId)) result = unknown(operationId, 'The acknowledgement did not match its operation');
      }
    } catch (error) {
      result = error instanceof PublicationNotDispatchedError && error.operationId === operationId ? unavailableResult(`${nameOf(path)} was not changed: the request was not sent`)
        : unknown(operationId, `The outcome is unconfirmed; read the folder again before retrying`);
    }
    revisions.delete(path);
    return settle(current, result);
  }

  const controller: FileTreeController = {
    revisionProvider, getSnapshot: () => state,
    subscribe: listener => { if (state.lifecycle === 'disposed') return () => {}; listeners.add(listener); return () => { listeners.delete(listener); }; },
    refresh, more: (path = '') => load(path, true),
    toggle: async path => {
      active(); const expanded = new Set(state.expanded);
      if (expanded.has(path)) expanded.delete(path); else expanded.add(path);
      update({ ...state, expanded });
      if (expanded.has(path) && !state.directories.has(path)) await refresh(path);
    },
    search: async query => {
      active(); loads.get('search')?.abort();
      update({ ...state, query, search: empty });
      if (query) await load('', false, true);
    },
    moreSearch: () => load('', true, true),
    upload: async input => {
      active();
      // An unresolved upload of the same path answers a new one, so nothing is published twice: an unconfirmed one must be checked
      // first, and a pending one answers a repeat of its bytes (a double click or drop). Different bytes while one is still pending
      // are refused outright: answering with the earlier upload would report them as saved when they were not.
      const bytes = input.bytes.slice();
      const unresolved = () => {
        const attempt = [...attempts.values()].find(item => item.current.path === input.path
          && (item.current.state.kind === 'pending' || item.current.state.result.kind === 'unknown'));
        if (attempt?.current.state.kind === 'pending' && !sameBytes(attempt.bytes, bytes)) throw new Error(`${input.path} is already being uploaded; wait for it to finish`);
        return attempt?.current;
      };
      const earlier = unresolved();
      if (earlier) return earlier;
      const operationId = randomUUID();
      const target = revisionProvider.locate(input.path);
      if (input.replace && !sameTarget(input.replace, target)) throw new TypeError('The replacement revision belongs to another file');
      const request = publicationSnapshot({ operationId, atomicity: 'all-or-nothing', changes: [input.replace
        ? { kind: 'replace', target: input.replace, bytes, mediaType: input.mediaType ?? 'application/octet-stream' }
        : { kind: 'create', target, expected: { kind: 'absent' }, bytes, mediaType: input.mediaType ?? 'application/octet-stream' }] });
      const current: FileUpload = { operationId, path: input.path, size: bytes.byteLength, state: { kind: 'pending' } };
      const digest = await publicationDigest(request);
      active();
      const concurrent = unresolved();
      if (concurrent) return concurrent;
      attempts.set(operationId, { request, digest, bytes, current });
      update({ ...state, uploads: [...state.uploads, current] });
      const signal = input.signal ? AbortSignal.any([input.signal, lifetime.signal]) : lifetime.signal;
      if (signal.aborted) return uploadState(operationId, { kind: 'unavailable', reason: 'Upload cancelled before publication' });
      try { return uploadState(operationId, checked(operationId, await revisionProvider.publish(request, signal))); }
      catch (error) {
        return uploadState(operationId, error instanceof PublicationNotDispatchedError && error.operationId === operationId
          ? { kind: 'unavailable', reason: 'Upload was not sent' }
          : unknown(operationId, 'Upload outcome is unconfirmed; check its status before trying again'));
      }
    },
    reconcile: operationId => {
      active(); const attempt = attempts.get(operationId);
      if (!attempt) return Promise.reject(new Error('Unknown upload operation'));
      if (attempt.current.state.kind === 'pending') return Promise.reject(new Error('Upload is still in progress'));
      if (attempt.current.state.result.kind !== 'unknown') return Promise.resolve(attempt.current);
      if (attempt.reconciling) return attempt.reconciling;
      const run = async () => {
        try {
          const result = await revisionProvider.lookup(operationId, lifetime.signal);
          return uploadState(operationId, result.kind === 'not-found' ? unknown(operationId, 'No retained receipt. Keep the local file; do not replay this upload blindly.') : checked(operationId, result));
        } catch { return uploadState(operationId, unknown(operationId, 'The upload status could not be confirmed')); }
        finally { delete attempt.reconciling; }
      };
      return attempt.reconciling = run();
    },
    retry: operationId => {
      active(); const attempt = attempts.get(operationId);
      if (!attempt) return Promise.reject(new Error('Unknown upload operation'));
      if (attempt.current.state.kind === 'pending' || attempt.current.state.result.kind === 'committed') return Promise.resolve(attempt.current);
      if (attempt.current.state.result.kind === 'unknown') return controller.reconcile(operationId);
      const change = attempt.request.changes[0];
      if (change.kind === 'delete') return Promise.reject(new Error('An upload cannot delete a file'));
      return controller.upload({ path: attempt.current.path, bytes: attempt.bytes, mediaType: change.mediaType,
        ...(change.kind === 'replace' ? { replace: change.target } : {}) });
    },
    actions: { rename: typeof revisionProvider.rename === 'function', delete: typeof revisionProvider.delete === 'function' },
    prepare: async (path, signal) => {
      active();
      try {
        const known = await latest(path, signal ? AbortSignal.any([signal, lifetime.signal]) : lifetime.signal);
        if (typeof known !== 'string') { revisions.delete(path); return undefined; }
        revisions.set(path, known); return known;
      } catch { return undefined; }
    },
    rename: async (path, to) => {
      checkedPath(path); checkedPath(to);
      if (to === path) throw new TypeError('The new name is the current name');
      return mutate('rename', path, to);
    },
    move: async (path, folder) => {
      checkedPath(path); if (folder) checkedPath(folder);
      const to = folder ? `${folder}/${nameOf(path)}` : nameOf(path);
      if (to === path) throw new TypeError(`${nameOf(path)} is already in that folder`);
      if (folder === path || folder.startsWith(`${path}/`)) throw new TypeError('A file cannot move into itself');
      return mutate('rename', path, to);
    },
    remove: async path => mutate('delete', checkedPath(path)),
    dismiss: operationId => { if (state.mutations.some(item => item.operationId === operationId && item.state.kind === 'settled')) update({ ...state, mutations: state.mutations.filter(item => item.operationId !== operationId) }); },
    history: (path, signal) => { active(); return revisionProvider.history(path, signal ? AbortSignal.any([signal, lifetime.signal]) : lifetime.signal); },
    dispose: () => { if (state.lifecycle === 'disposed') return; lifetime.abort(); for (const load of loads.values()) load.abort(); loads.clear(); state = { ...state, lifecycle: 'disposed' }; listeners.clear(); },
  };
  return controller;
}
