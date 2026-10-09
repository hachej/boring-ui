import { locator, reference, parsePublicationResult, publicationDigest } from '@hachej/boring-files/publication';
import { encode, equal, paths } from './bindings.mjs';

export function domainPaths(instanceId, subject, itemId) {
  paths(instanceId, subject);
  const at = path => ({ resource: { providerId: 'redaction', path: `${instanceId}/${subject}/${path}` }, view: { kind: 'published' } });
  if (itemId !== undefined && (typeof itemId !== 'string' || !/^[0-9a-f-]{36}$/.test(itemId))) throw new TypeError('Invalid host item identity');
  return { record: at('record.json'), letter: at('letter.md'),
    ...(itemId === undefined ? {} : { correction: at(`corrections/${itemId}.json`) }) };
}

export function requestId(value) {
  if (typeof value !== 'string' || !/^[a-z0-9-]{1,80}$/.test(value)) throw new TypeError('Invalid request identity');
  return value;
}

export function expectation(value, target) {
  if (value?.kind !== 'absent' && value?.kind !== 'revision') throw new TypeError('Expected revision or absence');
  const selected = value.kind === 'revision' ? reference(value.target) : locator(value.target);
  if (!equal(locator(selected), target)) throw new TypeError('Wrong resource expectation');
  return { kind: value.kind, target: selected };
}

export const expected = (read, target) => read.kind === 'available'
  ? { kind: 'revision', target: read.snapshot.ref } : { kind: 'absent', target };
export const readable = read => read.kind === 'available' || read.kind === 'missing';
export const correctionRequestTarget = (instanceId, subject, id) => ({ resource: { providerId: 'redaction',
  path: `${instanceId}/${subject}/correction-requests/${requestId(id)}.json` }, view: { kind: 'published' } });
export function textValue(value) {
  if (typeof value !== 'string' || encode(value).length > 4096 || new TextDecoder('utf-8', { ignoreBOM: true }).decode(encode(value)) !== value) throw new TypeError('Invalid correction text');
  return value;
}
export function change(base, value, mediaType) {
  const bytes = encode(value);
  return base.kind === 'absent' ? { kind: 'create', target: base.target, expected: { kind: 'absent' }, bytes, mediaType }
    : { kind: 'replace', target: base.target, bytes, mediaType };
}

export async function checkedPublication(value, request, actor) {
  const unknown = () => ({ kind: 'unknown', operationId: request.operationId, reason: 'Publication evidence does not match the original request' });
  const result = parsePublicationResult(value);
  if (result.kind === 'partial' || (result.kind === 'unknown' && result.operationId !== request.operationId)) return unknown();
  if (result.kind !== 'committed') return result;
  const receipt = result.receipt;
  if (receipt.operationId !== request.operationId || receipt.argumentDigest !== await publicationDigest(request)
    || receipt.principalId !== actor.principalId || receipt.initiatorId !== actor.initiatorId || receipt.scopeId !== actor.scopeId
    || receipt.changes.length !== request.changes.length) return unknown();
  for (const [index, change] of request.changes.entries()) {
    const actual = receipt.changes[index];
    const before = change.kind === 'create' ? null : change.target;
    if (actual?.kind !== change.kind || !equal(actual.before, before) || !actual.after
      || !equal(locator(actual.after), locator(change.target)) || actual.after.revision === before?.revision) return unknown();
  }
  return result;
}
