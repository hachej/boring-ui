import { randomUUID } from '@hachej/boring-files/platform';
import type {
  ProviderGuarantees, PublicationLookup, PublicationReceipt, PublicationRequest, PublicationResult, ResourceAccess, ResourcePublisher,
  ResourceReader, ResourceRef, ResourceView,
} from '@hachej/boring-files';
import {
  FEEDBACK_ID, FeedbackFormatError, checkFeedback, createRequest, draftProblems, draftReport, draftBody,
  listItemOf, parseFeedback, reportLocator, reportPath, resolveRequest, serializeFeedback, subjectKeyOf,
} from '../format/index.js';
import type { FeedbackDraft, FeedbackListItem, FeedbackReport, FeedbackRoot, Observed } from '../format/index.js';

/*
 * The feedback store (FEEDBACK.md, "Storage"): one file per report at `<root><id>.md` in a workspace and nothing else (no index).
 * Create and resolve are each ONE conditional single-file publication under the caller's stable operation identity; `list` reads
 * the root folder through the host's `listFolder` and every report in it. Deleting a report is a file operation of the host.
 *
 * Recovery keeps nothing in memory. The provider operation id is `JSON.stringify([operationNamespace, operation.id])`, so a
 * replay reaches the same receipt. Every mutation first looks that id up: a committed receipt is reconciled against the
 * call's own arguments (the committed report is re-read at the exact revision the receipt names and compared in canonical
 * form), so the exact prepared request (its random id, its timestamps) never has to be kept or rebuilt. `not-found`
 * before any publication means the provider, which must declare `atomicMutationAndReceipt`, holds no commit for the id,
 * and the call proceeds; a publication racing under the same id is refused by the provider's digest binding. After an
 * uncertain outcome inside a call, the id is looked up once and `not-found` is `unknown`, never retried as fresh.
 */

export type FeedbackProtection = 'protected' | 'unprotected';
export type FeedbackPermission = 'annotate' | 'read';
export type FeedbackAction = 'create' | 'resolve';

/** What the host authorizes. `key` is the subject key (`subjectKeyOf`): list, read and resolve decide on it alone, so a
 * decision must be a function of `key`. `observed` is supplied on create only. */
export interface FeedbackSubject { readonly key: string; readonly observed?: Observed }

/** `id` is the caller's stable operation id (the browser's per-draft id, or the agent's admitted `[namespace, taskId]`).
 * `key` is the binding admitted with it, computed by `store.operationKey` when the operation was first admitted. */
export interface FeedbackOperation { readonly id: string; readonly key: string }

export interface FeedbackStoreOptions<Context = void> {
  readonly providerId: string;
  readonly view: ResourceView;
  readonly reader: ResourceReader;
  readonly publisher: ResourcePublisher;
  readonly lookup: PublicationLookup;
  /** The provider's declared capabilities (a `ResourceCapabilities` satisfies this). */
  readonly capabilities: { readonly guarantees: ProviderGuarantees };
  /** The names of the files in one folder of the view (`''` is the view's root), or a refusal. The host lists its workspace's file
   * system here (Pi's `listDir`); a missing folder is an empty list. */
  readonly listFolder: (folder: string, access: ResourceAccess) => Promise<readonly string[] | FeedbackRefusal>;
  /** The folder of the reports: empty or a relative path ending with `/`. */
  readonly root: string;
  /** Stable identity of the storage partition and this binding. */
  readonly operationNamespace: string;
  /** The host's access resolution, kept for the routes and tools built on this store. The store itself never calls it:
   * every method takes the access the caller resolved for this request or tool call. */
  readonly resolveAccess: (context: Context) => ResourceAccess | Promise<ResourceAccess>;
  readonly authorizeSubject: (access: ResourceAccess, subject: FeedbackSubject, permission: FeedbackPermission) => boolean | Promise<boolean>;
  readonly displayName: (principalId: string) => string | Promise<string>;
  /** `'protected'`: native working tools, shell and Git cannot write the root. `'unprotected'` must be chosen explicitly,
   * and every surface states it. */
  readonly protection: FeedbackProtection;
  /** Time source for `created`, and resolutions. Defaults to the system clock. */
  readonly now?: () => Date;
}

export interface FeedbackDenied { readonly kind: 'denied'; readonly reason: string }
export interface FeedbackUnavailable { readonly kind: 'unavailable'; readonly reason: string }
export interface FeedbackMissing { readonly kind: 'missing' }
/** `current` is the report's current revision when the conflict is on the report, `null` when it has none or the
 * conflict is not on a report revision. */
export interface FeedbackConflict { readonly kind: 'conflict'; readonly current: string | null; readonly reason: string }
/** The effect is not known: reconcile `operationId` later. Never a success. */
export interface FeedbackUnknown { readonly kind: 'unknown'; readonly operationId: string; readonly reason: string }
export type FeedbackRefusal = FeedbackDenied | FeedbackUnavailable;

export interface FeedbackStored { readonly report: FeedbackReport; readonly revision: string }
export interface FeedbackApplied extends FeedbackStored { readonly kind: 'applied'; readonly operationId: string }

export type FeedbackCreateResult = FeedbackApplied | FeedbackConflict | FeedbackRefusal | FeedbackUnknown;
export type FeedbackResolveResult = FeedbackApplied | FeedbackConflict | FeedbackMissing | FeedbackRefusal | FeedbackUnknown;
export type FeedbackReadResult = ({ readonly kind: 'available' } & FeedbackStored) | FeedbackMissing | FeedbackRefusal;
export type { FeedbackListItem };
export type FeedbackListResult =
  | { readonly kind: 'available'; readonly items: readonly FeedbackListItem[]; readonly cursor: string | null; readonly protection: FeedbackProtection }
  | FeedbackRefusal;

export interface FeedbackListQuery { readonly status?: 'open' | 'addressed'; readonly subject?: string; readonly cursor?: string }
export interface FeedbackResolveInput { readonly expectedRevision: string; readonly note: string }

export interface FeedbackStore<Context = void> {
  readonly root: FeedbackRoot;
  readonly resolveAccess: (context: Context) => ResourceAccess | Promise<ResourceAccess>;
  /** The binding to admit with an operation id: namespace, root, provider, view, access fields, action and arguments. */
  readonly operationKey: (action: FeedbackAction, args: unknown, access: ResourceAccess) => string;
  readonly create: (draft: FeedbackDraft, access: ResourceAccess, operation: FeedbackOperation) => Promise<FeedbackCreateResult>;
  readonly read: (id: string, access: ResourceAccess) => Promise<FeedbackReadResult>;
  readonly list: (query: FeedbackListQuery, access: ResourceAccess) => Promise<FeedbackListResult>;
  readonly resolve: (id: string, input: FeedbackResolveInput, access: ResourceAccess, operation: FeedbackOperation) => Promise<FeedbackResolveResult>;
  readonly guarantees: () => { readonly protection: FeedbackProtection };
}

export const FEEDBACK_PAGE_SIZE = 50;
/** The most report files `list` reads in one call; a folder holding more is refused, never silently truncated. */
export const FEEDBACK_LIST_LIMIT = 5000;

const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
/** `fb_` and 16 base-58 characters from the platform's cryptographic source (rejection sampling, no modulo bias). */
export function feedbackId(): string {
  let out = '';
  while (out.length < 16) {
    const hex = randomUUID().replace(/-/g, '');
    // Skip the UUID's version and variant nibbles, which are not random.
    const random = hex.slice(0, 12) + hex.slice(13, 16) + hex.slice(17);
    for (let at = 0; at + 2 <= random.length && out.length < 16; at += 2) {
      const byte = Number.parseInt(random.slice(at, at + 2), 16);
      if (byte < 232) out += BASE58[byte % 58];
    }
  }
  return `fb_${out}`;
}

/** JSON with object keys sorted, so equal values give equal keys whatever their property order. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(item => canonical(item === undefined ? null : item)).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).filter(([, item]) => item !== undefined).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

const problemsText = (error: FeedbackFormatError) => error.problems.map(problem => `${problem.at}: ${problem.message}`).join('; ');
const sameBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((byte, index) => byte === b[index]);
const time = (value: string) => { const parsed = Date.parse(value); return Number.isNaN(parsed) ? 0 : parsed; };
/** Newest first; ties by id, so the order is total and a cursor is stable. */
const order = (a: Pick<FeedbackListItem, 'created' | 'id'>, b: Pick<FeedbackListItem, 'created' | 'id'>) =>
  (time(b.created) - time(a.created)) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);

function encodeCursor(entry: FeedbackListItem): string {
  return btoa(JSON.stringify([entry.created, entry.id])).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function decodeCursor(cursor: string): { readonly created: string; readonly id: string } | undefined {
  try {
    const value: unknown = JSON.parse(atob(cursor.replace(/-/g, '+').replace(/_/g, '/')));
    if (Array.isArray(value) && value.length === 2 && typeof value[0] === 'string' && typeof value[1] === 'string' && FEEDBACK_ID.test(value[1]) && !Number.isNaN(Date.parse(value[0]))) return { created: value[0], id: value[1] };
  } catch { /* refused below */ }
  return undefined;
}

type Loaded<Value> = { readonly ok: true; readonly value: Value } | { readonly ok: false; readonly refusal: FeedbackRefusal | FeedbackMissing };
type Submitted = { readonly kind: 'committed'; readonly receipt: PublicationReceipt } | { readonly kind: 'conflict' } | FeedbackRefusal | { readonly kind: 'uncertain'; readonly reason: string };

/** Build a store over injected resource contracts. Refuses to start without conditional publication, operation lookup, an
 * atomic mutation and receipt, or an explicit protection declaration. */
export function createFeedbackStore<Context = void>(options: FeedbackStoreOptions<Context>): FeedbackStore<Context> {
  const { providerId, view, reader, publisher, lookup, listFolder, operationNamespace, authorizeSubject, displayName, protection } = options;
  const guarantees = options.capabilities?.guarantees;
  if (guarantees?.conditionalPublication !== true || guarantees.operationLookup !== true || guarantees.atomicMutationAndReceipt !== true) {
    throw new TypeError('The feedback store needs a provider that declares conditionalPublication, operationLookup and atomicMutationAndReceipt');
  }
  if (protection !== 'protected' && protection !== 'unprotected') throw new TypeError("The feedback store needs an explicit protection: 'protected' or 'unprotected'");
  if (!providerId) throw new TypeError('A resource provider id is required');
  if (!operationNamespace) throw new TypeError('A stable operation namespace is required');
  if (typeof options.root !== 'string' || (options.root && (!options.root.endsWith('/') || options.root.startsWith('/') || options.root.split('/').some(segment => segment === '..' || segment === '.')))) {
    throw new TypeError('The feedback root must be empty or a relative folder ending with /');
  }
  if (!view || (view.kind !== 'published' && view.kind !== 'working')) throw new TypeError('A resource view is required');
  for (const [name, value] of [['reader.read', reader?.read], ['publisher.publish', publisher?.publish], ['lookup.lookup', lookup?.lookup], ['listFolder', listFolder], ['authorizeSubject', authorizeSubject], ['displayName', displayName], ['resolveAccess', options.resolveAccess]] as const) {
    if (typeof value !== 'function') throw new TypeError(`${name} is required`);
  }
  const root: FeedbackRoot = Object.freeze({ providerId, view, path: options.root });
  const now = () => (options.now ?? (() => new Date()))().toISOString();

  const operationKey = (action: FeedbackAction, args: unknown, access: ResourceAccess) => canonical([
    'boring.feedback.operation.v1', operationNamespace, providerId, view, root.path, access.scopeId, access.principalId, access.initiatorId, access.authorizationRef ?? null, action, args,
  ]);

  async function allowed(access: ResourceAccess, subject: FeedbackSubject, permission: FeedbackPermission) {
    try { return await authorizeSubject({ ...access }, subject, permission) === true; } catch { return false; }
  }

  async function readReport(id: string, access: ResourceAccess, revision?: string): Promise<Loaded<{ readonly ref: ResourceRef; readonly report: FeedbackReport }>> {
    let read;
    try { read = await reader.read({ target: reportLocator(root, id), revision: revision === undefined ? { kind: 'latest' } : { kind: 'exact', value: revision } }, access); }
    catch { return { ok: false, refusal: { kind: 'unavailable', reason: 'The feedback report could not be read' } }; }
    if (read.kind !== 'available') return { ok: false, refusal: read };
    const parsed = parseFeedback(read.snapshot.bytes);
    if (!parsed.ok || parsed.report.id !== id) return { ok: false, refusal: { kind: 'unavailable', reason: `The feedback report ${id} is not valid` } };
    if (revision !== undefined && read.snapshot.ref.revision !== revision) return { ok: false, refusal: { kind: 'unavailable', reason: 'Expected the exact report revision' } };
    return { ok: true, value: { ref: read.snapshot.ref, report: parsed.report } };
  }

  async function submit(request: PublicationRequest, access: ResourceAccess): Promise<Submitted> {
    let result: PublicationResult;
    try { result = await publisher.publish(request, access); }
    catch { return { kind: 'uncertain', reason: 'The publication did not answer' }; }
    if (result.kind === 'committed') return result;
    if (result.kind === 'conflict') return { kind: 'conflict' };
    if (result.kind === 'denied' || result.kind === 'unavailable') return { kind: result.kind, reason: result.reason };
    return { kind: 'uncertain', reason: result.kind === 'unknown' ? result.reason : 'The publication reported a partial outcome' };
  }

  /** Reconcile a committed receipt against the call's own arguments. */
  type Matcher<Applied> = (receipt: PublicationReceipt) => Promise<Applied | FeedbackConflict | FeedbackUnknown | FeedbackRefusal>;
  const reportChangeOf = (receipt: PublicationReceipt) => {
    const [first, second] = receipt.changes;
    if (receipt.changes.length !== 1 || second) return undefined;
    return first;
  };
  const mismatch = (): FeedbackConflict => ({ kind: 'conflict', current: null, reason: 'The operation id is already bound to a different feedback change' });
  const unreconciled = (operationId: string, reason: string): FeedbackUnknown => ({ kind: 'unknown', operationId, reason });

  /** After an uncertain outcome: one lookup, never a fresh retry. */
  async function reconcile<Applied>(operationId: string, access: ResourceAccess, match: Matcher<Applied>): Promise<Applied | FeedbackConflict | FeedbackUnknown | FeedbackRefusal> {
    let found;
    try { found = await lookup.lookup(operationId, access); }
    catch { return unreconciled(operationId, 'The operation lookup did not answer; its effect is unknown'); }
    if (found.kind === 'committed') return match(found.receipt);
    if (found.kind === 'not-found') return unreconciled(operationId, 'No receipt is retained for the operation; its effect is unknown');
    if (found.kind === 'conflict') return { kind: 'conflict', current: null, reason: found.reason };
    if (found.kind === 'denied' || found.kind === 'unavailable') return { kind: found.kind, reason: found.reason };
    return unreconciled(operationId, found.kind === 'unknown' ? found.reason : 'The operation has a partial outcome');
  }

  /** Admission shared by create, resolve and remove: binding check, then a replay lookup before anything is prepared. */
  async function admit<Applied, Fresh>(action: FeedbackAction, args: unknown, access: ResourceAccess, operation: FeedbackOperation, match: Matcher<Applied>, fresh: (operationId: string) => Promise<Fresh>): Promise<Applied | Fresh | FeedbackConflict | FeedbackRefusal | FeedbackUnknown> {
    if (typeof operation?.id !== 'string' || !operation.id || typeof operation.key !== 'string') return { kind: 'denied', reason: 'A stable operation identity is required' };
    const operationId = JSON.stringify([operationNamespace, operation.id]);
    if (operation.key !== operationKey(action, args, access)) return unreconciled(operationId, 'The admitted feedback binding changed; reconcile the original operation');
    let prior;
    try { prior = await lookup.lookup(operationId, access); }
    catch { return unreconciled(operationId, 'The operation lookup did not answer'); }
    if (prior.kind === 'committed') return match(prior.receipt);
    if (prior.kind !== 'not-found') return unreconciled(operationId, prior.kind === 'unknown' ? prior.reason : 'The operation cannot be reconciled');
    return fresh(operationId);
  }

  const create: FeedbackStore<Context>['create'] = async (draft, access, operation) => {
    const problems = draftProblems(draft);
    if (problems.length) return { kind: 'denied', reason: problems.map(problem => `${problem.at}: ${problem.message}`).join('; ') };
    let checked: FeedbackReport;
    try { checked = draftReport(draft, { id: 'fb_1111111111111111', created: '2000-01-01T00:00:00Z' }); }
    catch (error) { if (error instanceof FeedbackFormatError) return { kind: 'denied', reason: problemsText(error) }; throw error; }
    // Notes and steps are part of the binding only when present, so a Release 1 draft keeps its operation key.
    const args: FeedbackDraft = draftBody(checked);
    const subject: FeedbackSubject = { key: subjectKeyOf(checked.observed), observed: checked.observed };

    const match: Matcher<FeedbackApplied> = async receipt => {
      const change = reportChangeOf(receipt);
      const path = change?.after?.resource.path ?? '';
      const id = path.slice(root.path.length, -'.md'.length);
      if (change?.kind !== 'create' || !path.startsWith(root.path) || !FEEDBACK_ID.test(id) || reportPath(root, id) !== path) return mismatch();
      const stored = await readReport(id, access, change.after.revision);
      if (!stored.ok) return unreconciled(receipt.operationId, 'The committed report could not be read to reconcile the operation');
      const { report } = stored.value;
      const { notes: _notes, steps: _steps, ...withoutBody } = report;
      const asCalled = checkFeedback({ ...withoutBody, ...args });
      if (!asCalled.ok || !sameBytes(serializeFeedback(asCalled.report), serializeFeedback(report)) || report.author?.principalId !== access.principalId) return mismatch();
      if (!await allowed(access, { key: subjectKeyOf(report.observed), observed: report.observed }, 'annotate')) return unreconciled(receipt.operationId, 'Current access does not permit reconciliation of this operation');
      return { kind: 'applied', operationId: receipt.operationId, report, revision: change.after.revision };
    };

    return admit('create', args, access, operation, match, async operationId => {
      if (!await allowed(access, subject, 'annotate')) return { kind: 'denied', reason: 'Annotating this subject is not authorized' };
      let display: string;
      try { display = String(await displayName(access.principalId)); } catch { display = ''; }
      if (!display.trim() || /[\n\r]/.test(display)) display = access.principalId;
      const author = { principalId: access.principalId, display };
      const id = feedbackId(), created = now();
      let built;
      try { built = createRequest({ operationId, root, draft: args, id, created, author }); }
      catch (error) { if (error instanceof FeedbackFormatError) return { kind: 'denied', reason: problemsText(error) }; throw error; }
      const outcome = await submit(built.request, access);
      if (outcome.kind === 'committed') return match(outcome.receipt);
      if (outcome.kind === 'uncertain') return reconcile(operationId, access, match);
      if (outcome.kind !== 'conflict') return outcome;
      const existing = await readReport(id, access);
      return { kind: 'conflict', current: existing.ok ? existing.value.ref.revision : null, reason: 'A report with this id already exists' };
    });
  };

  /** The current report, then authorization on its subject. */
  async function authorized(id: string, access: ResourceAccess, permission: FeedbackPermission): Promise<Loaded<{ readonly ref: ResourceRef; readonly report: FeedbackReport }>> {
    if (typeof id !== 'string' || !FEEDBACK_ID.test(id)) return { ok: false, refusal: { kind: 'missing' } };
    const current = await readReport(id, access);
    if (!current.ok) return current;
    if (!await allowed(access, { key: subjectKeyOf(current.value.report.observed) }, permission)) return { ok: false, refusal: { kind: 'denied', reason: permission === 'read' ? 'Reading this feedback is not authorized' : 'Annotating this subject is not authorized' } };
    return current;
  }

  const read: FeedbackStore<Context>['read'] = async (id, access) => {
    const found = await authorized(id, access, 'read');
    if (!found.ok) return found.refusal;
    return { kind: 'available', report: found.value.report, revision: found.value.ref.revision };
  };

  const list: FeedbackStore<Context>['list'] = async (query, access) => {
    const after = query.cursor === undefined ? undefined : decodeCursor(query.cursor);
    if (query.cursor !== undefined && !after) return { kind: 'unavailable', reason: 'The cursor is not valid' };
    let names;
    try { names = await listFolder(root.path, { ...access }); }
    catch { return { kind: 'unavailable', reason: 'The feedback folder could not be listed' }; }
    if (!Array.isArray(names)) return names as FeedbackRefusal;
    const ids = names.filter(name => name.endsWith('.md') && FEEDBACK_ID.test(name.slice(0, -'.md'.length))).map(name => name.slice(0, -'.md'.length));
    if (ids.length > FEEDBACK_LIST_LIMIT) return { kind: 'unavailable', reason: `The feedback folder holds more than ${FEEDBACK_LIST_LIMIT} reports` };
    const decisions = new Map<string, boolean>();
    const readable = async (key: string) => {
      let decision = decisions.get(key);
      if (decision === undefined) { decision = await allowed(access, { key }, 'read'); decisions.set(key, decision); }
      return decision;
    };
    const entries: FeedbackListItem[] = [];
    for (const id of ids) {
      const stored = await readReport(id, access);
      // A file that vanished or is not a valid report is not a report: it is not listed.
      if (stored.ok) entries.push(listItemOf(root, stored.value.report));
    }
    const items: FeedbackListItem[] = [];
    let more = false;
    for (const entry of entries.sort(order)) {
      if (after && order(after, entry) >= 0) continue;
      if (query.status !== undefined && entry.status !== query.status) continue;
      if (query.subject !== undefined && entry.subject !== query.subject) continue;
      if (!await readable(entry.subject)) continue;
      if (items.length === FEEDBACK_PAGE_SIZE) { more = true; break; }
      items.push(entry);
    }
    const last = items.at(-1);
    return { kind: 'available', items, cursor: more && last ? encodeCursor(last) : null, protection };
  };

  const resolve: FeedbackStore<Context>['resolve'] = async (id, input, access, operation) => {
    const args = { id, expectedRevision: input?.expectedRevision, note: input?.note };
    const match: Matcher<FeedbackApplied> = async receipt => {
      const change = reportChangeOf(receipt);
      if (change?.kind !== 'replace' || change.before.resource.path !== reportPath(root, id) || change.before.revision !== args.expectedRevision) return mismatch();
      const stored = await readReport(id, access, change.after.revision);
      if (!stored.ok) return unreconciled(receipt.operationId, 'The committed report could not be read to reconcile the operation');
      const { report } = stored.value;
      const last = report.resolutions.at(-1);
      if (last?.note !== args.note || last.by !== access.principalId) return mismatch();
      if (!await allowed(access, { key: subjectKeyOf(report.observed) }, 'annotate')) return unreconciled(receipt.operationId, 'Current access does not permit reconciliation of this operation');
      return { kind: 'applied', operationId: receipt.operationId, report, revision: change.after.revision };
    };
    return admit('resolve', args, access, operation, match, async operationId => {
      if (typeof args.expectedRevision !== 'string' || !args.expectedRevision) return { kind: 'denied', reason: 'An expected revision is required' };
      if (typeof args.note !== 'string') return { kind: 'denied', reason: 'A resolution note is required' };
      const current = await authorized(id, access, 'annotate');
      if (!current.ok) return current.refusal;
      if (current.value.ref.revision !== args.expectedRevision) return { kind: 'conflict', current: current.value.ref.revision, reason: 'The report changed' };
      let built;
      try { built = resolveRequest({ operationId, root, current: current.value, resolution: { at: now(), by: access.principalId, note: args.note } }); }
      catch (error) { if (error instanceof FeedbackFormatError) return { kind: 'denied', reason: problemsText(error) }; throw error; }
      const outcome = await submit(built.request, access);
      if (outcome.kind === 'committed') return match(outcome.receipt);
      if (outcome.kind === 'uncertain') return reconcile(operationId, access, match);
      if (outcome.kind !== 'conflict') return outcome;
      const latest = await readReport(id, access);
      return latest.ok ? { kind: 'conflict', current: latest.value.ref.revision, reason: 'The report changed' } : latest.refusal;
    });
  };

  return Object.freeze({ root, resolveAccess: options.resolveAccess, operationKey, create, read, list, resolve, guarantees: () => ({ protection }) });
}
