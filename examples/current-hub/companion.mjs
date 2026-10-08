import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { Harness, createRegistry, defineExtension, defineTool } from '@earendil-works/pi-durable';
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node';
import { createModels } from '@earendil-works/pi-ai/models';
import { Type } from '@earendil-works/pi-ai';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { fixtureActor } from './app.mjs';
import { createFixtureChangeTools } from './change-tools.mjs';

const actorFields = ['principalId', 'initiatorId', 'scopeId', 'installationId'];
const parameters = Type.Object({ requestId: Type.String({ pattern: '^[a-z0-9-]{1,80}$' }),
  inputRef: Type.String({ maxLength: 80 }), capabilityVersion: Type.String({ maxLength: 10 }),
}, { additionalProperties: false });

export async function openFixtureCompanion({ directory, apps, changePaths, actorFor = fixtureActor, models = createModels(), model }) {
  mkdirSync(directory, { recursive: true });
  const registry = createRegistry();
  const tools = ['amber', 'blue'].map(appId => {
    const app = apps[appId], binding = structuredClone(app.identity);
    if (binding.appId !== appId || binding.runtimeId !== `${appId}-runtime-v1` || typeof binding.instanceId !== 'string') {
      throw new TypeError('App binding differs from the pinned installation');
    }
    if (changePaths?.[appId] && ['appId', 'runtimeId', 'instanceId'].some(field => changePaths[appId].identity?.[field] !== binding[field])) {
      throw new TypeError('Change path binding differs from the installed app instance');
    }
    return defineTool({ name: `invoke_${appId}`, description: `Request the pinned ${appId} app capability using an input reference.`,
      parameters, replay: 'safe', execute: async (args, api, ctx) => {
        const respond = result => ({ content: [{ type: 'text', text: JSON.stringify(result) }] });
        try {
          const request = structuredClone(args), actor = structuredClone(actorFor(appId));
          const retained = await api.memo('fixture.hub.invocation.v1', ctx);
          if (!actor || !actorFields.every(field => typeof actor[field] === 'string' && actor[field].length > 0)) return respond({ kind: retained ? 'unknown' : 'denied' });
          const expected = { ...binding, capabilityVersion: request.capabilityVersion, requestId: request.requestId,
            ...Object.fromEntries(actorFields.map(field => [field, actor[field]])) };
          const capture = { ...expected, inputRef: request.inputRef };
          const original = retained ?? await api.memo('fixture.hub.invocation.v1', capture, ctx);
          if (Object.keys(capture).some(field => capture[field] !== original[field])) return respond({ kind: 'unknown' });
          const answer = await app.invoke(request, actor);
          const current = actorFor(appId);
          if (!actorFields.every(field => actor[field] === current?.[field])) return respond({ kind: 'unknown' });
          if (answer?.kind !== 'admitted') {
            return respond({ kind: !retained && ['denied', 'conflict', 'unsupported', 'unknown', 'unavailable'].includes(answer?.kind) ? answer.kind : 'unknown' });
          }
          const ref = answer.ref;
          if (!ref || Object.keys(expected).some(field => ref[field] !== expected[field])
            || ![ref.producer, ref.delivery].every(value => Number.isSafeInteger(value) && value > 0)
            || ref.producer === ref.delivery
            || ref.operationId !== JSON.stringify([`${binding.runtimeId}:${binding.instanceId}`, ref.delivery])) return respond({ kind: 'unknown' });
          return respond({ kind: 'admitted', ref: { ...expected, producer: ref.producer, delivery: ref.delivery, operationId: ref.operationId } });
        } catch { return respond({ kind: 'unknown' }); }
      } });
  });
  tools.push(...createFixtureChangeTools({ changePaths, actorFor }));
  registry.install(defineExtension({ name: 'fixture.hub.companion', tools }));
  const storage = await openNodeSqliteStorage(join(directory, 'native.sqlite'));
  let harness;
  try {
    harness = await Harness.open(storage, { registry, models }, context);
    const conversation = await harness.root(context, { agent: { tools, ...(model ? { model } : {}) } });
    let closing;
    return { harness, conversation, storage, close: () => closing ??= harness.close(context) };
  } catch (error) {
    if (harness) await harness.close(context); else await storage.close(context);
    throw error;
  }
}
