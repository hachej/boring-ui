import type { CommittedChange, NonEmpty, PublicationOutcome, PublicationReceipt, PublicationRequest, PublicationResult, ResourceAccess, ResourceChange, ResourceExpectation, ResourceLocator, ResourceRef } from './contracts.js';
import { sha256 } from './platform.js';

/** This invocation did not dispatch. Earlier attempts with the same ID may still have effects. */
export class PublicationNotDispatchedError extends Error {
  readonly operationId: string;
  constructor(operationId: string) {
    super('Publication request could not be prepared and was not dispatched');
    this.name = 'PublicationNotDispatchedError';
    this.operationId = identifier(operationId);
  }
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Expected an object');
  return Object.fromEntries(Object.entries(value));
}

export function identifier(value: unknown): string {
  if (typeof value !== 'string' || !value.length || value.length > 1024 || /[\u0000-\u001f]/u.test(value) || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(value)) {
    throw new TypeError('Expected a nonempty well-formed identifier without control characters');
  }
  return value;
}

/** Human-readable refusal text from a provider: normalized and bounded rather than rejected, so a long or multi-line reason cannot downgrade the outcome. */
function reason(value: unknown): string {
  if (typeof value !== 'string') throw new TypeError('Expected a refusal reason');
  const text = value.replace(/[\u0000-\u001f]+/g, ' ').trim().slice(0, 1024).replace(/[\uD800-\uDBFF]$/, '');
  return identifier(text.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '\uFFFD') || 'No reason given');
}

export function locator(value: unknown): ResourceLocator {
  const input = object(value);
  const resource = object(input.resource);
  const path = identifier(resource.path);
  if (path.includes('\\') || path.includes('%') || path.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new TypeError('Expected a relative canonical resource path');
  }
  const view = object(input.view);
  if (view.kind !== 'published' && view.kind !== 'working') throw new TypeError('Invalid resource view');
  return {
    resource: { providerId: identifier(resource.providerId), path },
    view: view.kind === 'published' ? { kind: 'published' } : { kind: 'working', viewId: identifier(view.viewId) },
  };
}

export function reference(value: unknown): ResourceRef {
  return { ...locator(value), revision: identifier(object(value).revision) };
}

export function accessSnapshot(value: ResourceAccess): ResourceAccess {
  return {
    principalId: identifier(value.principalId), scopeId: identifier(value.scopeId), initiatorId: identifier(value.initiatorId),
    ...(value.authorizationRef === undefined ? {} : { authorizationRef: identifier(value.authorizationRef) }),
    ...(value.signal === undefined ? {} : { signal: value.signal }),
  };
}

function expectation(value: unknown): ResourceExpectation {
  const input = object(value);
  if (input.kind === 'absent') return { kind: 'absent', target: locator(input.target) };
  if (input.kind === 'revision') return { kind: 'revision', target: reference(input.target) };
  throw new TypeError('Invalid resource expectation');
}

function change(value: unknown): ResourceChange {
  const input = object(value);
  if (input.kind === 'delete') return { kind: 'delete', target: reference(input.target) };
  if (input.kind !== 'create' && input.kind !== 'replace') throw new TypeError('Invalid resource change');
  if (!(input.bytes instanceof Uint8Array)) throw new TypeError('Resource bytes must be Uint8Array');
  const bytes = Uint8Array.from(input.bytes);
  const mediaType = identifier(input.mediaType);
  if (input.kind === 'replace') return { kind: 'replace', target: reference(input.target), bytes, mediaType };
  if (object(input.expected).kind !== 'absent') throw new TypeError('Create requires explicit absence');
  return { kind: 'create', target: locator(input.target), expected: { kind: 'absent' }, bytes, mediaType };
}

export function publicationSnapshot(value: unknown): PublicationRequest {
  const input = object(value);
  if (!Array.isArray(input.changes) || !input.changes.length) throw new TypeError('Publication requires changes');
  if (input.atomicity !== 'all-or-nothing' && input.atomicity !== 'per-change') throw new TypeError('Invalid atomicity');
  const [first, ...rest] = input.changes;
  const changes: NonEmpty<ResourceChange> = [change(first), ...rest.map(change)];
  const targets = changes.map(item => JSON.stringify(item.target.resource) + JSON.stringify(item.target.view));
  if (new Set(targets).size !== targets.length) throw new TypeError('A publication cannot change the same target twice');
  if (input.preconditions !== undefined && !Array.isArray(input.preconditions)) throw new TypeError('Invalid preconditions');
  return {
    operationId: identifier(input.operationId), changes, atomicity: input.atomicity,
    ...(input.preconditions === undefined ? {} : { preconditions: input.preconditions.map(expectation) }),
  };
}

export async function publicationDigest(input: PublicationRequest): Promise<string> {
  const request = publicationSnapshot(input);
  const canonical = JSON.stringify({
    format: 'boring-publication-v1',
    atomicity: request.atomicity,
    changes: request.changes.map(item => item.kind === 'delete' ? item : { ...item, bytes: Array.from(item.bytes) }),
    preconditions: request.preconditions ?? [],
  });
  const digest = await sha256(new TextEncoder().encode(canonical));
  return 'boring-publication-v1:sha256:' + Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('');
}

function committedChange(value: unknown): CommittedChange {
  const input = object(value);
  if (input.kind === 'create' && input.before === null) return { kind: 'create', before: null, after: reference(input.after) };
  if (input.kind === 'delete' && input.after === null) return { kind: 'delete', before: reference(input.before), after: null };
  if (input.kind === 'replace') {
    const before = reference(input.before), after = reference(input.after);
    if (JSON.stringify(locator(before)) !== JSON.stringify(locator(after))) throw new TypeError('Invalid replacement receipt');
    return { kind: 'replace', before, after };
  }
  throw new TypeError('Invalid committed change');
}

function publicationReceipt(value: unknown): PublicationReceipt {
  const input = object(value);
  if (!Array.isArray(input.changes) || !input.changes.length) throw new TypeError('Receipt requires changes');
  const [first, ...rest] = input.changes;
  return {
    operationId: identifier(input.operationId), argumentDigest: identifier(input.argumentDigest),
    principalId: identifier(input.principalId), scopeId: identifier(input.scopeId), initiatorId: identifier(input.initiatorId),
    evidenceRef: identifier(input.evidenceRef), changes: [committedChange(first), ...rest.map(committedChange)],
  };
}

function publicationOutcome(value: unknown): PublicationOutcome {
  const input = object(value);
  switch (input.kind) {
    case 'committed': return { kind: 'committed', receipt: publicationReceipt(input.receipt) };
    case 'denied': case 'unavailable': return { kind: input.kind, reason: reason(input.reason) };
    case 'unknown': return { kind: 'unknown', operationId: identifier(input.operationId), reason: reason(input.reason) };
    case 'conflict': {
      if (!Array.isArray(input.current)) throw new TypeError('Conflict requires current references');
      return { kind: 'conflict', current: input.current.map(reference), reason: reason(input.reason) };
    }
    default: throw new TypeError('Invalid publication outcome');
  }
}

/** Parse transport/provider output before treating it as acknowledgement. */
export function parsePublicationResult(value: unknown): PublicationResult {
  const input = object(value);
  if (input.kind !== 'partial') return publicationOutcome(input);
  if (!Array.isArray(input.items) || !input.items.length) throw new TypeError('Partial publication requires items');
  const items = input.items.map(value => {
    const item = object(value);
    if (typeof item.changeIndex !== 'number' || !Number.isSafeInteger(item.changeIndex) || item.changeIndex < 0) throw new TypeError('Invalid change index');
    return { changeIndex: item.changeIndex, target: locator(item.target), outcome: publicationOutcome(item.outcome) };
  });
  const [first, ...rest] = items;
  if (!first || new Set(items.map(item => item.changeIndex)).size !== items.length) throw new TypeError('Invalid partial publication coverage');
  return { kind: 'partial', operationId: identifier(input.operationId), items: [first, ...rest] };
}
