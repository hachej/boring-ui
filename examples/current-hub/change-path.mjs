import { mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { openSqliteWorkspaces } from '../shared/sqlite-workspaces.mjs';
import { fixtureActor } from './app.mjs';

export const changeActorFields = ['principalId', 'initiatorId', 'scopeId', 'installationId'];
export const changeIdentityFields = ['appId', 'runtimeId', 'instanceId', 'repositoryId', 'version'];
const contextFields = ['appId', 'runtimeId', 'instanceId', 'capabilityVersion', ...changeActorFields,
  'requestId', 'producer', 'delivery', 'operationId'];
const id = value => typeof value === 'string' && /^[a-z0-9-]{1,80}$/.test(value);
const uuid = value => typeof value === 'string' && /^[a-f0-9-]{36}$/.test(value);
// Workspace revisions are Git blob ids; evidence references are `<incarnation>:<uuid>`.
const revision = value => typeof value === 'string' && /^[0-9a-f]{40}$/.test(value);
const evidence = value => typeof value === 'string' && /^[\w-]{1,80}:[a-f0-9-]{36}$/.test(value);
const same = (a, b, fields) => fields.every(field => a?.[field] === b?.[field]);
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const actorCopy = actor => Object.fromEntries(changeActorFields.map(field => [field, actor?.[field]]));
const operation = (identity, requestId) => JSON.stringify([identity.repositoryId, identity.instanceId, 'change', requestId]);
const location = (identity, area, requestId) => ({ resource: { providerId: `${identity.appId}-changes`,
  path: `${identity.instanceId}/${area}/${requestId}.${area === 'issues' ? 'json' : 'txt'}` }, view: { kind: 'published' } });
const exactRef = (value, target) => value?.resource?.providerId === target.resource.providerId
  && value.resource.path === target.resource.path && value.view?.kind === 'published' && revision(value.revision)
  ? { ...target, revision: value.revision } : undefined;
const textBytes = text => {
  if (typeof text !== 'string' || text.length === 0) return undefined;
  const bytes = new TextEncoder().encode(text);
  return bytes.length <= 8192 && new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes) === text ? bytes : undefined;
};

function contextReference(value, identity, actor) {
  const ref = Object.fromEntries(contextFields.map(field => [field, value?.[field]]));
  return same(ref, { ...identity, ...actor, capabilityVersion: '1' },
    ['appId', 'runtimeId', 'instanceId', ...changeActorFields, 'capabilityVersion']) && id(ref.requestId)
    && [ref.producer, ref.delivery].every(value => Number.isSafeInteger(value) && value > 0)
    && ref.producer !== ref.delivery && ref.operationId === JSON.stringify([`${identity.runtimeId}:${identity.instanceId}`, ref.delivery])
    ? ref : undefined;
}
const issueRecord = (identity, actor, requestId, source, context, text) => ({
  format: 'fictional.issue', version: 1, repositoryId: identity.repositoryId,
  label: 'boring-factory:triage', backlink: 'fictional-hub:reports', requestId, actor, source, context, text, status: 'open',
});

export function pickChangeReference(value, expected) {
  const fields = [...changeIdentityFields, ...changeActorFields, 'requestId'];
  if (!id(expected.requestId) || !same(value, expected, fields) || value.operationId !== operation(expected, expected.requestId)
    || !evidence(value.evidenceRef)) return undefined;
  const issue = exactRef(value.issue, location(expected, 'issues', expected.requestId));
  return issue ? { ...Object.fromEntries(fields.map(field => [field, expected[field]])),
    operationId: value.operationId, issue, evidenceRef: value.evidenceRef } : undefined;
}

export function openFixtureChangePath({ directory, app, policy = () => true, afterCommit = async () => {} }) {
  const selected = Object.fromEntries(['appId', 'runtimeId', 'instanceId'].map(field => [field, app.identity[field]]));
  if (!['amber', 'blue'].includes(selected.appId) || selected.runtimeId !== `${selected.appId}-runtime-v1` || !uuid(selected.instanceId)) {
    throw new TypeError('Invalid fictional app binding');
  }
  mkdirSync(directory, { recursive: true });
  const identity = Object.freeze({ ...selected, repositoryId: `fictional/${selected.appId}`, version: '1' });
  const expectedActor = fixtureActor(identity.appId);
  let closed = false;
  const allowed = (actor, action) => {
    try { return !closed && same(app.identity, selected, ['appId', 'runtimeId', 'instanceId'])
      && same(actor, expectedActor, changeActorFields) && policy(actorCopy(actor), action) === true; }
    catch { return false; }
  };
  const access = actor => ({ principalId: actor.principalId, initiatorId: actor.initiatorId,
    scopeId: actor.scopeId, authorizationRef: actor.installationId });
  const canRequest = actor => ['request-change', 'read-draft', 'use-context'].every(action => allowed(actor, action));
  const provider = openSqliteWorkspaces({ filename: join(directory, 'changes.sqlite'), providerId: `${identity.appId}-changes`,
    authorize: (action, target, credentials) => {
      const actor = { ...credentials, installationId: credentials.authorizationRef };
      const draft = target.resource.path.startsWith(`${identity.instanceId}/drafts/`);
      const issue = target.resource.path.startsWith(`${identity.instanceId}/issues/`);
      if (draft) return allowed(actor, action === 'read' ? 'read-draft' : 'stage');
      if (!issue) return false;
      if (action === 'create') return canRequest(actor);
      return allowed(actor, ['read', 'lookup'].includes(action) ? 'read-issue' : 'maintain');
    } });
  const stage = async (input, identityInput) => {
    try {
      const actor = actorCopy(identityInput), request = structuredClone(input);
      const bytes = textBytes(request.text);
      if (!id(request.requestId) || !bytes || !allowed(actor, 'stage')) return { kind: 'denied' };
      const target = location(identity, 'drafts', request.requestId);
      const expected = request.expected === undefined ? undefined : exactRef(request.expected, target);
      if (request.expected !== undefined && !expected) return { kind: 'denied' };
      const result = await provider.publication.publish({ operationId: `stage:${randomUUID()}`, atomicity: 'all-or-nothing',
        changes: [expected ? { kind: 'replace', target: expected, bytes, mediaType: 'text/plain' }
          : { kind: 'create', target, expected: { kind: 'absent' }, bytes, mediaType: 'text/plain' }],
      }, access(actor));
      return result.kind === 'committed' ? { kind: 'staged', source: result.receipt.changes[0].after } : { kind: result.kind };
    } catch { return { kind: 'unavailable' }; }
  };
  const request = async (input, identityInput) => {
    let publicationStarted = false;
    try {
      const actor = actorCopy(identityInput), offered = structuredClone(input);
      if (!offered || Object.keys(offered).sort().join(',') !== 'context,requestId,source'
        || !id(offered.requestId) || !canRequest(actor)) return { kind: 'denied' };
      const source = exactRef(offered.source, location(identity, 'drafts', offered.requestId));
      const context = contextReference(offered.context, identity, actor);
      if (!source || !context) return { kind: 'denied' };
      const observed = await app.observe(structuredClone(context), actorCopy(actor));
      if (observed?.kind !== 'observed' || !same(observed.ref, context, contextFields)) return { kind: 'denied' };
      const draft = await provider.read({ target: source, revision: { kind: 'exact', value: source.revision } }, access(actor));
      if (draft.kind !== 'available') return { kind: draft.kind === 'denied' ? 'denied' : 'unavailable' };
      const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(draft.snapshot.bytes);
      if (!textBytes(text) || !canRequest(actor)) return { kind: 'denied' };
      const issue = issueRecord(identity, actor, offered.requestId, source, context, text);
      publicationStarted = true;
      const result = await provider.publication.publish({ operationId: operation(identity, offered.requestId), atomicity: 'all-or-nothing',
        changes: [{ kind: 'create', target: location(identity, 'issues', offered.requestId), expected: { kind: 'absent' },
          bytes: new TextEncoder().encode(JSON.stringify(issue)), mediaType: 'application/json' }],
      }, access(actor));
      if (result.kind !== 'committed') return { kind: result.kind };
      const ref = { ...identity, ...actor, requestId: offered.requestId, operationId: result.receipt.operationId,
        issue: result.receipt.changes[0].after, evidenceRef: result.receipt.evidenceRef };
      await afterCommit(structuredClone(ref));
      return canRequest(actor) && allowed(actor, 'read-issue') ? { kind: 'filed', ref } : { kind: 'unknown' };
    } catch { return { kind: publicationStarted ? 'unknown' : 'unavailable' }; }
  };
  const readIssue = async (input, identityInput) => {
    try {
      const actor = actorCopy(identityInput), offered = structuredClone(input);
      if (!allowed(actor, 'read-issue')) return { kind: 'denied' };
      const ref = pickChangeReference(offered, { ...identity, ...actor, requestId: offered?.requestId });
      if (!ref) return { kind: 'denied' };
      const found = await provider.reconciliation.lookup(ref.operationId, access(actor));
      if (found.kind !== 'committed') return { kind: 'unavailable' };
      const created = found.receipt.changes[0];
      if (found.receipt.changes.length !== 1 || created.kind !== 'create' || !equal(created.after, ref.issue)
        || found.receipt.evidenceRef !== ref.evidenceRef) return { kind: 'denied' };
      const initial = await provider.read({ target: ref.issue, revision: { kind: 'exact', value: ref.issue.revision } }, access(actor));
      const current = await provider.read({ target: ref.issue, revision: { kind: 'latest' } }, access(actor));
      if (initial.kind !== 'available' || current.kind !== 'available') return { kind: 'unavailable' };
      const original = JSON.parse(new TextDecoder().decode(initial.snapshot.bytes));
      const latest = JSON.parse(new TextDecoder().decode(current.snapshot.bytes));
      const source = exactRef(original?.source, location(identity, 'drafts', ref.requestId));
      const context = contextReference(original?.context, identity, actor);
      if (!source || !context || !textBytes(original?.text)
        || !equal(original, issueRecord(identity, actor, ref.requestId, source, context, original.text))) return { kind: 'unavailable' };
      if (!['open', 'in-progress', 'shipped'].includes(latest.status) || !equal({ ...latest, status: 'open' }, original)
        || !allowed(actor, 'read-issue')) return { kind: 'unavailable' };
      return { kind: 'observed', ref, status: latest.status, revision: current.snapshot.ref.revision };
    } catch { return { kind: 'unavailable' }; }
  };
  return { identity, stage, request, readIssue, local: { provider }, close: () => { if (!closed) { closed = true; provider.close(); } } };
}
