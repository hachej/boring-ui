import { defineTool } from '@earendil-works/pi-durable';
import { changeActorFields, changeIdentityFields, pickChangeReference } from './change-path.mjs';

const text = { type: 'string', minLength: 1, maxLength: 160 };
const requestId = { type: 'string', pattern: '^[a-z0-9-]{1,80}$' };
const source = { type: 'object', properties: { resource: { type: 'object', properties: { providerId: text, path: text }, required: ['providerId', 'path'], additionalProperties: false }, view: { type: 'object', properties: { kind: { type: 'string', const: 'published' } }, required: ['kind'], additionalProperties: false }, revision: { type: 'string', pattern: '^[0-9a-f]{40}$' } }, required: ['resource', 'view', 'revision'], additionalProperties: false };
const context = { type: 'object', properties: { appId: text, runtimeId: text, instanceId: text, capabilityVersion: { type: 'string', const: '1' },
  ...Object.fromEntries(changeActorFields.map(field => [field, text])), requestId,
  producer: { type: 'integer', minimum: 1 }, delivery: { type: 'integer', minimum: 1 }, operationId: { type: 'string', maxLength: 512 },
}, required: ['appId', 'runtimeId', 'instanceId', 'capabilityVersion', ...changeActorFields, 'requestId', 'producer', 'delivery', 'operationId'], additionalProperties: false };
const parameters = { type: 'object', properties: { requestId, source, context }, required: ['requestId', 'source', 'context'], additionalProperties: false };
const same = (a, b, fields) => fields.every(field => a?.[field] === b?.[field]);
const actorCopy = actor => Object.fromEntries(changeActorFields.map(field => [field, actor?.[field]]));
const validActor = actor => changeActorFields.every(field => typeof actor[field] === 'string' && actor[field].length > 0 && actor[field].length <= 160);

export function createFixtureChangeTools({ changePaths, actorFor }) {
  return ['amber', 'blue'].filter(appId => changePaths?.[appId]).map(appId => {
    const path = changePaths[appId], binding = Object.fromEntries(changeIdentityFields.map(field => [field, path.identity[field]]));
    if (binding.appId !== appId || binding.repositoryId !== `fictional/${appId}` || binding.version !== '1') {
      throw new TypeError('Change path differs from its pinned app repository');
    }
    return defineTool({ name: `request_change_${appId}`, description: `Hand off the pinned ${appId} app's staged change request by reference.`,
      parameters, replay: 'safe', execute: async (args, api, ctx) => {
        const respond = result => ({ output: [{ type: 'text', text: JSON.stringify(result) }] });
        try {
          let actor, request;
          try {
            actor = actorCopy(actorFor(appId));
            request = { requestId: args.requestId,
              source: { resource: { providerId: args.source.resource.providerId, path: args.source.resource.path },
                view: { kind: args.source.view.kind }, revision: args.source.revision },
              context: Object.fromEntries(Object.keys(context.properties).map(field => [field, args.context[field]])) };
          } catch { actor = undefined; }
          const retained = await api.memo('fixture.hub.change.v1', ctx);
          if (!actor || !request || !validActor(actor) || !same(path.identity, binding, changeIdentityFields)) return respond({ kind: retained ? 'unknown' : 'denied' });
          const capture = { identity: binding, actor, request };
          const original = retained ?? await api.memo('fixture.hub.change.v1', capture, ctx);
          if (JSON.stringify(original) !== JSON.stringify(capture)) return respond({ kind: 'unknown' });
          if (!same(actorFor(appId), actor, changeActorFields) || !same(path.identity, binding, changeIdentityFields)) {
            return respond({ kind: retained ? 'unknown' : 'denied' });
          }
          const answer = await path.request(structuredClone(request), actorCopy(actor));
          if (!same(actorFor(appId), actor, changeActorFields) || !same(path.identity, binding, changeIdentityFields)) return respond({ kind: 'unknown' });
          if (answer?.kind !== 'filed') return respond({ kind: !retained && ['denied', 'conflict', 'unavailable', 'unknown'].includes(answer?.kind)
            ? answer.kind : 'unknown' });
          const ref = pickChangeReference(answer.ref, { ...binding, ...actor, requestId: request.requestId });
          return respond(ref ? { kind: 'filed', ref } : { kind: 'unknown' });
        } catch { return respond({ kind: 'unknown' }); }
      } });
  });
}
