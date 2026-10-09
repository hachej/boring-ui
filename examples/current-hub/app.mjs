import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Harness, createRegistry, defineDoc, defineDocFamily, defineExtension, defineTask, defineTool, configure, AgentDoc, AssistantEntry, ToolTask, ToolResultEntry } from '@earendil-works/pi-durable';
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node';
import { Type } from '@earendil-works/pi-ai';
import { loadAgentDefinition } from '@hachej/boring-agent/definitions';
import { createModels } from '@earendil-works/pi-ai/models';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { createDocumentDelivery } from '@hachej/boring-agent/delivery';
import { openSqliteWorkspaces } from '../shared/sqlite-workspaces.mjs';

export const PRIVATE_MARKERS = Object.freeze({
  amber: Object.freeze({ input: 'FICTIONAL_PRIVATE_AMBER_INPUT_81b3', result: 'FICTIONAL_PRIVATE_AMBER_RESULT_a927', definition: 'FICTIONAL_PRIVATE_AMBER_DEFINITION_441d' }),
  blue: Object.freeze({ input: 'FICTIONAL_PRIVATE_BLUE_INPUT_931d', result: 'FICTIONAL_PRIVATE_BLUE_RESULT_721c', definition: 'FICTIONAL_PRIVATE_BLUE_DEFINITION_b985' }),
});
export const fixtureActor = appId => ({ principalId: 'fictional-member', initiatorId: 'fictional-requester',
  scopeId: 'fictional-team', installationId: `${appId}-installation-v1` });
export const fixtureRequest = (appId, requestId = 'request-1', inputVersion = 1) => ({ requestId,
  inputRef: `${appId}:input:v${inputVersion}`, capabilityVersion: '1' });
const actorFields = ['principalId', 'initiatorId', 'scopeId', 'installationId'];
const refFields = ['appId', 'runtimeId', 'instanceId', 'capabilityVersion', ...actorFields, 'requestId', 'producer', 'delivery', 'operationId'];
const same = (left, right, fields) => fields.every(key => left?.[key] === right?.[key]);
const requests = defineDocFamily({ kind: 'fixture.hub.app-requests', version: 1, scope: 'session', family: true,
  initial: () => ({ binding: null }) });
const incarnation = defineDoc({ kind: 'fixture.hub.app-instance', version: 2, scope: 'session',
  initial: () => ({ instanceId: randomUUID(), definition: null }),
  migrate: () => { throw new Error('Fixture v1 storage has no qualified definition binding'); } });
const sameDefinition = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const assistantCall = requestId => ({ role: 'assistant',
  content: [{ type: 'toolCall', id: 'prepare-report', name: 'prepare_report', arguments: { requestId } }],
  api: 'fixture', provider: 'fixture', model: 'fictional-no-model', timestamp: 1, stopReason: 'toolUse',
  usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } });

export async function openFixtureApp({ directory, appId, definitionRef, implementationVersion = 'fixture-app-v2',
  toolImplementationVersion = 'prepare-report-v1', policy = () => true, beforeProduce = async () => {}, beforeReport = async () => {}, afterAdmission = async () => {} }) {
  if (!Object.hasOwn(PRIVATE_MARKERS, appId)) throw new TypeError('Unknown fictional app');
  mkdirSync(directory, { recursive: true });
  const runtimeId = `${appId}-runtime-v1`, expectedActor = fixtureActor(appId);
  let closed = false, instanceId;
  const allowed = (actor, action) => !closed && same(actor, expectedActor, actorFields)
    && policy(structuredClone(actor), action) === true;
  const access = actor => ({ principalId: actor.principalId, initiatorId: actor.initiatorId, scopeId: actor.scopeId,
    authorizationRef: actor.installationId });
  const selectedDefinition = definitionRef === undefined ? undefined : structuredClone(definitionRef);
  const key = requestId => JSON.stringify([appId, expectedActor.installationId, expectedActor.scopeId, requestId]);
  const provider = openSqliteWorkspaces({ filename: join(directory, 'resources.sqlite'), providerId: appId,
    authorize: (action, target, actor) => {
      const definition = target.resource.path === 'agent.json';
      if (definition && ['create', 'replace', 'delete'].includes(action)) return false;
      const permission = action === 'read' ? (definition ? 'read-definition' : 'read')
        : action === 'lookup' ? 'lookup' : 'publish';
      return allowed({ ...actor, installationId: actor.authorizationRef }, permission);
    } });
  const qualifyDefinition = async (expected, ref = expected?.ref) => {
    if (!ref || ref.resource?.providerId !== appId || ref.resource?.path !== 'agent.json' || ref.view?.kind !== 'published') {
      throw new Error('No pinned app definition');
    }
    const loaded = await loadAgentDefinition({ reader: provider, ref, access: access(expectedActor), implementationVersion,
      resolveTool: name => name === report.name && allowed(expectedActor, 'execute') ? { tool: report, implementationVersion: toolImplementationVersion } : undefined,
      ...(expected ? { expectedBinding: expected } : {}) });
    if (!allowed(expectedActor, 'execute') || loaded.change.tools?.length !== 1 || loaded.change.tools[0] !== report) {
      throw new Error('Definition does not select the app capability');
    }
    return loaded;
  };
  const report = defineTool({ name: 'prepare_report', description: 'Prepare a fictional report inside its owning app.',
    parameters: Type.Object({ requestId: Type.String({ pattern: '^[a-z0-9-]{1,80}$' }) }, { additionalProperties: false }),
    replay: 'safe', outputLimits: { maxBytes: 131072, maxLines: 131072 },
    execute: async (args, api, ctx) => {
      const admitted = (await api.snapshot(requests, key(args.requestId), ctx))?.binding;
      const task = await api.getTask(api.taskId, ctx);
      const owner = admitted && task?.owner === admitted.ref.producer ? await api.getTask(task.owner, ctx) : undefined;
      if (!admitted?.definition || !owner || owner.input.requestId !== args.requestId
        || !sameDefinition(owner.input.definition, admitted.definition)) throw new Error('App request binding is unavailable');
      await beforeReport({ requestId: args.requestId, taskId: api.taskId });
      const loaded = await qualifyDefinition(admitted.definition);
      const agent = await api.agent(ctx);
      if (agent.instructions !== loaded.change.instructions || agent.tools.length !== 1 || agent.tools[0] !== report
        || !allowed(expectedActor, 'execute')) throw new Error('App configuration is unavailable');
      return { content: [{ type: 'text', text: `# Fictional ${appId}\n${agent.instructions}\n${owner.input.privateInput}\n${PRIVATE_MARKERS[appId].result}\n` }] };
    } });
  const producer = defineTask({ name: 'fixture.hub.produce', version: 2, initial: () => ({ phase: 'produce' }), phases: {
    produce: async (task, runtime, ctx) => {
      await beforeProduce(structuredClone(task.input));
      if (!task.input.definition) throw new Error('Legacy producer has no pinned definition');
      await qualifyDefinition(task.input.definition);
      await runtime.commit(async tx => {
        if (!allowed(expectedActor, 'execute')) throw new Error('App execution is not authorized');
        const entry = await tx.appendEntry(AssistantEntry, runtime.conversationId, { model: [assistantCall(task.input.requestId)] });
        const child = await tx.createTask(ToolTask, { assistant: entry.id, callId: 'prepare-report' }, { ownership: { kind: 'task', taskId: task.id } });
        return { status: 'waiting', on: [child], policy: 'allSettled', checkpoint: { phase: 'collect', child } };
      }, ctx);
    },
    collect: async (task, runtime, ctx) => {
      const [outcome] = await runtime.outcomes([task.state.checkpoint.child], ctx);
      if (outcome?.status !== 'completed') throw new Error('App tool did not complete');
      const entry = await runtime.entry(ToolResultEntry, outcome.result.entryId, ctx);
      const result = entry?.model?.[0];
      if (result?.role !== 'toolResult' || result.isError || result.toolName !== report.name || result.content.length !== 1
        || result.content[0].type !== 'text') throw new Error('App tool did not return report text');
      await runtime.commit(() => ({ status: 'terminal', outcome: { status: 'completed', result: result.content[0].text } }), ctx);
    },
  }, abort: async (_task, runtime, ctx) => runtime.commit(() => ({ status: 'terminal', outcome: { status: 'aborted' } }), ctx) });
  const registry = createRegistry();
  registry.install(defineExtension({ name: 'fixture.hub.app', tasks: [producer], tools: [report] }));
  let storage, harness;
  try {
    storage = await openNodeSqliteStorage(join(directory, 'native.sqlite'));
    harness = await Harness.open(storage, { registry, models: createModels() }, context);
    const conversation = await harness.root(context);
    instanceId = await conversation.commit(async tx => (await tx.doc(incarnation)).instanceId, context);
    const delivery = createDocumentDelivery({ operationNamespace: `${runtimeId}:${instanceId}`, validationVersion: 'fictional-heading-v1',
      publisher: provider.publication, lookup: provider.reconciliation,
      resolveAccess: () => access(expectedActor), validate: text => text.startsWith('# Fictional ') ? [] : ['Heading required'] });
    registry.install(delivery.extension);
    const admissionRevoked = new Error('Admission authorization changed');
    const invoke = async (request, identity) => {
      if (closed) return { kind: 'unavailable' };
      try {
        const input = structuredClone(request), actor = structuredClone(identity);
        if (!allowed(actor, 'invoke')) return { kind: 'denied' };
        if (!input || typeof input !== 'object' || Array.isArray(input)
          || Object.keys(input).sort().join(',') !== 'capabilityVersion,inputRef,requestId'
          || typeof input.requestId !== 'string' || !/^[a-z0-9-]{1,80}$/.test(input.requestId)) return { kind: 'denied' };
        if (input.capabilityVersion !== '1') return { kind: 'unsupported' };
        if (![`${appId}:input:v1`, `${appId}:input:v2`].includes(input.inputRef)) return { kind: 'denied' };
        const canonical = JSON.stringify([input.capabilityVersion, input.inputRef]);
        const retainedDefinition = (await harness.snapshot(incarnation, context))?.definition;
        let loaded;
        try { loaded = await qualifyDefinition(retainedDefinition, retainedDefinition?.ref ?? selectedDefinition); }
        catch { return { kind: 'unavailable' }; }
        const result = await conversation.commit(async tx => {
          const doc = await tx.doc(requests, key(input.requestId), null);
          if (!allowed(actor, 'invoke')) return { kind: 'denied' };
          const installation = await tx.doc(incarnation);
          if (installation.definition) {
            if (!sameDefinition(installation.definition, loaded.binding)) return { kind: 'unavailable' };
            const configured = await tx.doc(AgentDoc, conversation.id);
            if (configured.instructions !== loaded.change.instructions || JSON.stringify(configured.tools) !== JSON.stringify([report.name])) {
              return { kind: 'unavailable' };
            }
          }
          if (!allowed(actor, 'read-definition') || !allowed(actor, 'execute')) return { kind: 'unavailable' };
          if (doc.binding) {
            if (!sameDefinition(doc.binding.definition, loaded.binding)) return { kind: 'unavailable' };
            if (!same(doc.binding.ref, actor, actorFields)) return { kind: 'denied' };
            return doc.binding.canonical === canonical
              ? { kind: 'admitted', ref: Object.fromEntries(refFields.map(field => [field, doc.binding.ref[field]])) } : { kind: 'conflict' };
          }
          if (!installation.definition) {
            await configure(tx, conversation.id, loaded.change);
            installation.definition = loaded.binding;
          }
          const binding = await delivery.admit(tx, inner => inner.createTask(producer, {
            requestId: input.requestId, definition: loaded.binding,
            privateInput: `${PRIVATE_MARKERS[appId].input}:${input.inputRef}`, inputRef: input.inputRef,
          }, { ownership: { kind: 'conversation' } }), { kind: 'absent', target: {
            resource: { providerId: appId, path: `${instanceId}/${input.requestId}.md` }, view: { kind: 'published' },
          } }, { ownership: { kind: 'conversation' } }, context);
          if (!allowed(actor, 'invoke') || !allowed(actor, 'read-definition') || !allowed(actor, 'execute')) throw admissionRevoked;
          const ref = { appId, runtimeId, instanceId, capabilityVersion: '1',
            ...Object.fromEntries(actorFields.map(field => [field, actor[field]])), requestId: input.requestId, ...binding };
          doc.binding = { canonical, ref, definition: loaded.binding };
          return { kind: 'admitted', ref: structuredClone(ref) };
        }, context);
        if (result.kind === 'admitted') {
          harness.resume();
          await afterAdmission(structuredClone(result.ref));
          if (!allowed(actor, 'invoke')) return { kind: 'unknown' };
        }
        return result;
      } catch (error) { return { kind: error === admissionRevoked ? 'unavailable' : 'unknown' }; }
    };
    const observe = async (reference, identity) => {
      if (closed) return { kind: 'unavailable' };
      try {
        const ref = structuredClone(reference), actor = structuredClone(identity);
        if (!allowed(actor, 'observe') || !same(ref, { appId, runtimeId, instanceId, capabilityVersion: '1', ...actor },
          ['appId', 'runtimeId', 'instanceId', 'capabilityVersion', ...actorFields])
          || typeof ref.requestId !== 'string' || !/^[a-z0-9-]{1,80}$/.test(ref.requestId)
          || Object.keys(ref).sort().join(',') !== [...refFields].sort().join(',')) return { kind: 'denied' };
        const doc = await harness.snapshot(requests, key(ref.requestId), context);
        if (!doc?.binding || !same(ref, doc.binding.ref, refFields)) return { kind: 'denied' };
        const task = await harness.getTask(ref.delivery, context);
        if (!allowed(actor, 'observe')) return { kind: 'denied' };
        if (!task) return { kind: 'unavailable' };
        if (task.state.status !== 'terminal') return { kind: 'observed', ref, status: task.state.status };
        const outcome = task.state.outcome;
        const result = { kind: 'observed', ref, status: outcome.status };
        if (outcome.status === 'completed') {
          const publication = outcome.result?.kind;
          result.publication = ['committed', 'denied', 'conflict', 'invalid', 'producer-failed', 'unknown'].includes(publication)
            ? publication : 'unknown';
        }
        return result;
      } catch { return { kind: 'unavailable' }; }
    };
    let closing;
    return { invoke, observe, identity: Object.freeze({ appId, runtimeId, instanceId }), local: { harness, conversation, storage, provider,
      definitionBinding: async () => structuredClone((await harness.snapshot(incarnation, context))?.definition ?? null) },
      close: () => {
        if (!closing) {
          closed = true;
          closing = harness.close(context).finally(() => provider.close());
        }
        return closing;
      } };
  } catch (error) {
    if (harness) await harness.close(context); else if (storage) await storage.close(context);
    provider.close();
    throw error;
  }
}
