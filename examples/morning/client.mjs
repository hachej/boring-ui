import { createResourceClient } from '@hachej/boring-files/remote';
import { readJsonBody } from '@hachej/boring-files/request-guard';
import { parsePublicationResult } from '@hachej/boring-files/publication';
import { emailSchema, calendarSchema, todoSchema, morningActionDigest } from './documents.mjs';
import { randomUUID, sha256 } from '@hachej/boring-files/platform';

export function createMorningClient({ origin, identity, fetch: transport }) {
  const endpoint = path => new URL(path, origin), retained = new Map();
  const actor = Object.freeze({ principalId: identity.principalId, scopeId: identity.scopeId, initiatorId: identity.initiatorId });
  const schemas = { email: emailSchema, calendar: calendarSchema, todo: todoSchema };
  const uncertain = operationId => ({ kind: 'unknown', operationId, reason: 'Application evidence unconfirmed; reconcile without replay' });
  const target = (ref, app, path) => ref?.resource.providerId === `morning-${app}` && ref.resource.path === path && ref.view.kind === 'published' && !!ref.revision;
  async function evidence(value, entry) {
    const { intent, app, path } = entry;
    let result; try { result = parsePublicationResult(value); } catch { return uncertain(intent.operationId); }
    if (result.kind === 'partial' || result.kind === 'unknown' && result.operationId !== intent.operationId) return uncertain(intent.operationId);
    if (result.kind !== 'committed') return result;
    const receipt = result.receipt;
    if (receipt.operationId !== intent.operationId || !receipt.evidenceRef || !receipt.argumentDigest || ['principalId', 'scopeId', 'initiatorId'].some(field => receipt[field] !== actor[field])) return uncertain(intent.operationId);
    const state = receipt.changes.filter(change => change.kind === 'replace' && target(change.before, app, `${app}.json`) && target(change.after, app, `${app}.json`) && change.before.revision === intent.expected);
    if (state.length !== 1) return uncertain(intent.operationId);
    if (path !== '/email/send') return receipt.changes.length === 1 ? result : uncertain(intent.operationId);
    const hash = Array.from(await sha256(new TextEncoder().encode(intent.operationId)), byte => byte.toString(16).padStart(2, '0')).join('');
    return receipt.changes.length === 2 && receipt.changes.some(change => change.kind === 'create' && change.before === null && target(change.after, app, `outbox/${hash}.json`)) ? result : uncertain(intent.operationId);
  }
  async function call(path, value = {}, signal) {
    const response = await transport(new Request(endpoint(path), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value), redirect: 'error', signal }));
    if (response.status === 403) return { kind: 'denied', reason: 'Morning host refused this request' };
    if (response.status !== 200) throw new Error('Morning response unconfirmed');
    if (response.redirected) throw new Error('Morning response redirected');
    return readJsonBody(response, 1048576, signal);
  }
  const app = name => ({
    read: async () => {
      try {
        const result = await call(`/${name}/read`);
        if (result.kind === 'available') {
          if (Object.keys(result).sort().join(',') !== 'document,kind,revision' || typeof result.revision !== 'string' || !result.revision) throw new Error('Invalid read association');
          return { kind: 'available', revision: result.revision, document: schemas[name].parse(result.document) };
        }
        if (result.kind === 'missing' && Object.keys(result).length === 1 || ['denied', 'unavailable'].includes(result.kind) && typeof result.reason === 'string') return result;
      } catch {}
      return { kind: 'unavailable', reason: 'Morning read unconfirmed' };
    },
    lookup: async operationId => {
      const entry = retained.get(operationId); if (!entry || entry.app !== name) return uncertain(operationId);
      try { const result = await call(`/${name}/lookup`, { operationId }); return result.kind === 'committed' ? await evidence(result, entry) : uncertain(operationId); }
      catch { return uncertain(operationId); }
    },
  });
  async function action(path, args) {
    const input = { ...structuredClone(args), operationId: randomUUID() };
    let intent;
    try { intent = Object.freeze({ ...input, operationId: `${input.operationId}:${await morningActionDigest(path, input)}` }); }
    catch { return { intent: Object.freeze(input), result: { kind: 'denied', reason: 'Invalid morning action arguments' } }; }
    if (retained.size >= 128) return { intent, result: { kind: 'unavailable', reason: 'Open a new morning client after reviewing retained outcomes' } };
    const entry = { intent, app: path.split('/')[1], path }; retained.set(intent.operationId, entry);
    try { return { intent, result: await evidence(await call(path, intent), entry) }; }
    catch { return { intent, result: uncertain(intent.operationId) }; }
  }
  const resource = path => createResourceClient({ identity, endpoint: endpoint(path), publication: true, reconciliation: true, fetch: transport });
  return {
    email: { ...app('email'), send: args => action('/email/send', args), snooze: args => action('/email/snooze', args) },
    calendar: { ...app('calendar'), acceptSlot: args => action('/calendar/slot', args) },
    todo: { ...app('todo'), setCompleted: args => action('/todo/tick', args) },
    draft: resource('/draft'), layout: resource('/layout'),
    configuration: () => call('/configuration'),
    compose: (descriptor, trigger, signal) => call('/compose', { descriptor, trigger }, signal),
  };
}
