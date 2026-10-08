import { defineTool } from '@earendil-works/pi-durable';
import { Type } from '@earendil-works/pi-ai';
import { changeActorFields, changeIdentityFields, pickChangeReference } from './change-path.mjs';

const text = Type.String({ minLength: 1, maxLength: 160 });
const requestId = Type.String({ pattern: '^[a-z0-9-]{1,80}$' });
const source = Type.Object({ resource: Type.Object({ providerId: text, path: text }, { additionalProperties: false }),
  view: Type.Object({ kind: Type.Literal('published') }, { additionalProperties: false }),
  revision: Type.String({ pattern: '^[0-9a-f]{40}$' }),
}, { additionalProperties: false });
const context = Type.Object({ appId: text, runtimeId: text, instanceId: text, capabilityVersion: Type.Literal('1'),
  ...Object.fromEntries(changeActorFields.map(field => [field, text])), requestId,
  producer: Type.Integer({ minimum: 1 }), delivery: Type.Integer({ minimum: 1 }), operationId: Type.String({ maxLength: 512 }),
}, { additionalProperties: false });
const parameters = Type.Object({ requestId, source, context }, { additionalProperties: false });
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
        const respond = result => ({ content: [{ type: 'text', text: JSON.stringify(result) }] });
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
