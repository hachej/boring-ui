import { locator, reference } from '@hachej/boring-files/publication';

export const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export const encode = value => new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(value));
export const redactionActor = (overrides = {}) => ({ principalId: 'fictional-editor', initiatorId: 'fictional-human', scopeId: 'fictional-team', ...overrides });

export function actorSnapshot(value) {
  if (!value || Object.keys(value).sort().join(',') !== 'initiatorId,principalId,scopeId'
    || !['fictional-editor', 'fictional-editor-2'].includes(value.principalId)
    || !['fictional-human', 'fictional-human-2'].includes(value.initiatorId) || value.scopeId !== 'fictional-team') throw new TypeError('Invalid fictional actor');
  return { principalId: value.principalId, initiatorId: value.initiatorId, scopeId: value.scopeId };
}

export function paths(instanceId, subject) {
  if (!['A', 'B', 'C'].includes(subject)) throw new TypeError('Unknown subject');
  const at = path => ({ resource: { providerId: 'redaction', path: `${instanceId}/${path}` }, view: { kind: 'published' } });
  return { source: at('source.md'), config: at('config.json'), generation: at(`${subject}/generation.json`),
    edit: at(`${subject}/human.md`), output: at(`${subject}/output.md`) };
}

function selected(value, expected, exact) {
  const result = exact ? reference(value) : locator(value);
  if (!equal(locator(result), expected)) throw new TypeError('Wrong resource binding');
  return result;
}

function expectation(value, expected) {
  if (value?.kind !== 'absent' && value?.kind !== 'revision') throw new TypeError('Expected revision or absence');
  return { kind: value.kind, target: selected(value.target, expected, value.kind === 'revision') };
}

export function requestSnapshot(value, instanceId) {
  if (!value || Object.keys(value).sort().join(',') !== 'config,edit,generation,instanceId,output,requestId,source,subject'
    || value.instanceId !== instanceId || typeof value.requestId !== 'string' || !/^[a-z0-9-]{1,80}$/.test(value.requestId)) throw new TypeError('Invalid fictional request');
  const targets = paths(instanceId, value.subject);
  return { instanceId, subject: value.subject, requestId: value.requestId,
    source: selected(value.source, targets.source, true), config: selected(value.config, targets.config, true),
    generation: expectation(value.generation, targets.generation), edit: expectation(value.edit, targets.edit), output: expectation(value.output, targets.output) };
}

export function decode(snapshot, mediaType, maxBytes) {
  if (snapshot.mediaType !== mediaType || snapshot.bytes.length > maxBytes) throw new TypeError('Invalid fictional resource');
  return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(snapshot.bytes);
}

export const reservationTarget = request => ({ resource: { providerId: 'redaction', path: `${request.instanceId}/${request.subject}/requests/${request.requestId}.json` }, view: { kind: 'published' } });
export const reservationOperation = request => JSON.stringify(['fictional.redaction.reserve.v1', request.instanceId, request.subject, request.requestId]);

export function reservationPublication(record) {
  const request = record.request;
  const guardBytes = encode({ format: 'fictional.redaction.generation', version: 1, generationId: record.generationId, requestId: request.requestId });
  return { operationId: reservationOperation(request), atomicity: 'all-or-nothing',
    preconditions: [{ kind: 'revision', target: request.source }, { kind: 'revision', target: request.config }, request.edit, request.output],
    changes: [
      { kind: 'create', target: reservationTarget(request), expected: { kind: 'absent' }, bytes: encode(record), mediaType: 'application/json' },
      request.generation.kind === 'absent'
        ? { kind: 'create', target: request.generation.target, expected: { kind: 'absent' }, bytes: guardBytes, mediaType: 'application/json' }
        : { kind: 'replace', target: request.generation.target, bytes: guardBytes, mediaType: 'application/json' },
    ] };
}
