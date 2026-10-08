import type { PublicationLookupResult, PublicationOutcome, PublicationRequest, PublicationResult, ReadResult, ResourceAccess, ResourceChange, ResourceLocator, ResourceRead } from './contracts.js';
import { accessSnapshot, identifier, locator, parsePublicationResult, publicationSnapshot, reference } from './publication-input.js';

export type ResourceIdentity = Pick<ResourceAccess, 'principalId' | 'scopeId' | 'initiatorId'>;
export type ResourceCall =
  | { readonly kind: 'read'; readonly value: ResourceRead }
  | { readonly kind: 'publish'; readonly value: PublicationRequest }
  | { readonly kind: 'lookup'; readonly value: string };

export const schema = 'boring-resource';
export const version = 2;
export const contentType = 'application/json';

export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Expected an object');
  return Object.fromEntries(Object.entries(value));
}

export function identity(value: ResourceIdentity): ResourceIdentity {
  const { principalId, scopeId, initiatorId } = accessSnapshot(value);
  return { principalId, scopeId, initiatorId };
}

export function sameIdentity(left: ResourceIdentity, right: ResourceIdentity): boolean {
  return left.principalId === right.principalId && left.scopeId === right.scopeId && left.initiatorId === right.initiatorId;
}

function wireIdentity(value: unknown): ResourceIdentity {
  const input = object(value);
  return { principalId: identifier(input.principalId), scopeId: identifier(input.scopeId), initiatorId: identifier(input.initiatorId) };
}

export function envelope(value: unknown): { requestId: string; identity: ResourceIdentity; kind: ResourceCall['kind']; value: unknown } {
  const input = object(value);
  if (input.schema !== schema || input.version !== version) throw new TypeError('Unsupported resource protocol');
  if (input.kind !== 'read' && input.kind !== 'publish' && input.kind !== 'lookup') throw new TypeError('Unsupported resource method');
  return { requestId: identifier(input.requestId), identity: wireIdentity(input.identity), kind: input.kind, value: input.value };
}

export function readSnapshot(value: unknown): ResourceRead {
  const input = object(value), revision = object(input.revision);
  if (revision.kind !== 'latest' && revision.kind !== 'exact') throw new TypeError('Invalid revision selector');
  return { target: locator(input.target), revision: revision.kind === 'latest' ? { kind: 'latest' } : { kind: 'exact', value: identifier(revision.value) } };
}

/** Bytes travel as canonical base64 text; JSON number arrays multiplied the size by three to four. */
function encodeBytes(value: Uint8Array): string {
  let text = '';
  for (let index = 0; index < value.length; index += 0x8000) text += String.fromCharCode(...value.subarray(index, index + 0x8000));
  return btoa(text);
}
function decodeBytes(value: string): Uint8Array {
  let text: string;
  try { text = atob(value); } catch { throw new TypeError('Invalid resource bytes'); }
  const result = new Uint8Array(text.length);
  for (let index = 0; index < text.length; index++) result[index] = text.charCodeAt(index);
  if (encodeBytes(result) !== value) throw new TypeError('Invalid resource bytes');
  return result;
}
function bytes(value: unknown): Uint8Array {
  if (typeof value !== 'string') throw new TypeError('Invalid resource bytes');
  return decodeBytes(value);
}

export function decodeCall(input: ReturnType<typeof envelope>): ResourceCall {
  if (input.kind === 'read') return { kind: 'read', value: readSnapshot(input.value) };
  if (input.kind === 'lookup') return { kind: 'lookup', value: identifier(input.value) };
  const value = object(input.value);
  if (!Array.isArray(value.changes)) throw new TypeError('Missing changes');
  const changes = value.changes.map(item => {
    const change = object(item);
    return change.kind === 'delete' ? change : { ...change, bytes: bytes(change.bytes) };
  });
  const request = publicationSnapshot({ ...value, changes });
  if (request.atomicity !== 'all-or-nothing') throw new TypeError('Remote per-change publication is not qualified');
  return { kind: 'publish', value: request };
}

export function encode(value: unknown, limit: number): string {
  const json = JSON.stringify(value, (_key, item: unknown) => item instanceof Uint8Array ? encodeBytes(item) : item);
  if (new TextEncoder().encode(json).byteLength > limit) throw new RangeError('Resource message exceeds byte limit');
  return json;
}

export function limit(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 67_108_864) throw new TypeError('Expected a byte limit between 1 and 67108864');
  return value;
}

export function observe<Value>(pending: Promise<Value>, signal?: AbortSignal): Promise<Value> {
  if (!signal) return pending;
  return new Promise((resolve, reject) => {
    const abort = () => { signal.removeEventListener('abort', abort); reject(new Error('Resource observation aborted')); };
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    pending.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

export { readJsonBody as jsonBody } from './request-guard.js';

function sameTarget(left: ResourceLocator, right: ResourceLocator): boolean {
  return JSON.stringify(locator(left)) === JSON.stringify(locator(right));
}

export function readResult(value: unknown, request: ResourceRead, wire = false): ReadResult {
  const input = object(value);
  if (input.kind === 'missing') return { kind: 'missing' };
  if (input.kind === 'denied' || input.kind === 'unavailable') return { kind: input.kind, reason: identifier(input.reason) };
  if (input.kind !== 'available') throw new TypeError('Invalid read result');
  const snapshot = object(input.snapshot), ref = reference(snapshot.ref);
  if (!sameTarget(ref, request.target) || (request.revision.kind === 'exact' && ref.revision !== request.revision.value)) throw new TypeError('Read reference mismatch');
  const content = wire ? bytes(snapshot.bytes) : snapshot.bytes;
  if (!(content instanceof Uint8Array)) throw new TypeError('Invalid snapshot bytes');
  return { kind: 'available', snapshot: { ref, bytes: Uint8Array.from(content), mediaType: identifier(snapshot.mediaType) } };
}

function outcomeAgreement(result: PublicationOutcome, operationId: string, selected: ResourceIdentity, changes?: readonly ResourceChange[], digest?: string): void {
  if (result.kind === 'unknown' && result.operationId !== operationId) throw new TypeError('Unknown operation mismatch');
  if (result.kind !== 'committed') return;
  const receipt = result.receipt;
  if (receipt.operationId !== operationId || !sameIdentity(receipt, selected) || (digest !== undefined && receipt.argumentDigest !== digest)) throw new TypeError('Receipt identity mismatch');
  const targets = receipt.changes.map(change => JSON.stringify(locator(change.after ?? change.before)));
  if (new Set(targets).size !== targets.length) throw new TypeError('Duplicate receipt target');
  if (!changes) return;
  if (receipt.changes.length !== changes.length) throw new TypeError('Receipt change count mismatch');
  const committedByTarget = new Map(receipt.changes.map(change => [JSON.stringify(locator(change.after ?? change.before)), change]));
  for (const change of changes) {
    const committed = committedByTarget.get(JSON.stringify(locator(change.target)));
    if (!committed || committed.kind !== change.kind) throw new TypeError('Receipt change mismatch');
    if (change.kind !== 'create' && JSON.stringify(committed.before) !== JSON.stringify(change.target)) throw new TypeError('Receipt base mismatch');
  }
}

export function publicationResult(value: unknown, operationId: string, selected: ResourceIdentity, request?: PublicationRequest, digest?: string): PublicationResult {
  const result = parsePublicationResult(value);
  if (result.kind === 'partial') throw new TypeError('Remote partial receipts are not qualified');
  outcomeAgreement(result, operationId, selected, request?.changes, digest);
  return result;
}

export function lookupResult(value: unknown, operationId: string, selected: ResourceIdentity): PublicationLookupResult {
  return object(value).kind === 'not-found' ? { kind: 'not-found' } : publicationResult(value, operationId, selected);
}
