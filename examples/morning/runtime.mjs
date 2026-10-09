import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { Harness, createRegistry, defineExtension, defineTask, defineTool, defineDoc, AssistantEntry, ToolTask, ToolResultEntry } from '@earendil-works/pi-durable';
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node';
import { createModels } from '@earendil-works/pi-ai/models';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { accessSnapshot, publicationSnapshot, publicationDigest, parsePublicationResult } from '@hachej/boring-files/publication';
import { openSqliteWorkspaces } from '../shared/sqlite-workspaces.mjs';
import { morningIdentity, emailSchema, calendarSchema, todoSchema, actionSchemas } from './documents.mjs';
import { privateCanaries, initialEmail, initialCalendar, initialTodo } from './fixtures.mjs';

const encoder = new TextEncoder(), decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const fields = ['principalId', 'initiatorId', 'scopeId', 'authorizationRef'];
const sameActor = (left, right) => fields.every(field => left?.[field] === right?.[field]);
const schemas = { email: emailSchema, calendar: calendarSchema, todo: todoSchema };
const actionApp = { send_email: 'email', snooze_email: 'email', accept_calendar_slot: 'calendar', complete_todo: 'todo' };
const refusal = reason => ({ kind: 'denied', reason });
const unknown = (operationId, reason = 'Publication outcome is uncertain; reconcile the original operation') => ({ kind: 'unknown', operationId, reason });
const locator = (app, path = `${app}.json`) => ({ resource: { providerId: `morning-${app}`, path }, view: { kind: 'published' } });
const sameLocator = (left, right) => left?.resource.providerId === right.resource.providerId && left.resource.path === right.resource.path && left.view.kind === 'published';
const jsonBytes = value => encoder.encode(JSON.stringify(value));
const requestMemo = 'fictional.morning.action.v1', attemptedMemo = 'fictional.morning.attempted.v1';
const runtimeIdentity = defineDoc({ kind: 'fictional.morning.identity', version: 1, scope: 'session', initial: () => ({ id: globalThis.crypto.randomUUID() }) });

export async function openMorningRuntime({ directory, identity = morningIdentity, layout, authorize = () => true, beforePublish, afterPublish }) {
  if (!layout || typeof layout !== 'object') throw new TypeError('A validated morning layout is required');
  mkdirSync(directory, { recursive: true });
  const actor = accessSnapshot(identity), initialLayout = structuredClone(layout);
  const providerBindings = {}, providers = {}, publicationCounts = { email: 0, calendar: 0, todo: 0, layout: 0 };
  let closed = false, harness, conversation, instanceId;
  function allowed(app, permission, access) {
    if (closed || access?.signal?.aborted || !sameActor(actor, access)) return false;
    try { return authorize(app, permission, { ...access }) === true && !closed && !access.signal?.aborted; } catch { return false; }
  }
  const immutableLocator = target => Object.freeze({ resource: Object.freeze(target.resource), view: Object.freeze(target.view) });
  const draftTarget = immutableLocator(locator('email', 'reply.md')), layoutTarget = immutableLocator(locator('layout', 'morning.json'));
  try {
    for (const app of ['email', 'calendar', 'todo', 'layout']) providers[app] = openSqliteWorkspaces({ filename: join(directory, `${app}.sqlite`), providerId: `morning-${app}`,
      authorize: (action, _target, access) => allowed(app, action === 'read' ? 'read' : action === 'lookup' ? 'lookup' : 'write', access) });
    for (const app of Object.keys(providers)) {
      const selected = locator(app, '.morning-instance.json'), provider = providers[app].workspace(actor.scopeId);
      let stored = await provider.read({ target: selected, revision: { kind: 'latest' } }, actor);
      if (stored.kind === 'missing') {
        const id = globalThis.crypto.randomUUID();
        await provider.publication.publish({ operationId: `initialize-${id}`, atomicity: 'all-or-nothing', changes: [{ kind: 'create', target: selected, expected: { kind: 'absent' }, bytes: jsonBytes({ id }), mediaType: 'application/json' }] }, actor);
        stored = await provider.read({ target: selected, revision: { kind: 'latest' } }, actor);
      }
      if (stored.kind !== 'available') throw new Error('Application instance identity is unavailable');
      const value = JSON.parse(decoder.decode(stored.snapshot.bytes));
      if (!value || Object.keys(value).join(',') !== 'id' || typeof value.id !== 'string' || !value.id) throw new Error('Invalid application instance identity');
      providerBindings[app] = value.id;
    }
    async function read(app, access, revision, selected = locator(app)) {
      if (!allowed(app, 'read', access)) return refusal('Current read access denied');
      const result = await providers[app].read({ target: selected, revision: revision ? { kind: 'exact', value: revision } : { kind: 'latest' } }, access);
      if (!allowed(app, 'read', access)) return refusal('Current read access denied');
      if (result.kind !== 'available') return result;
      try {
        if (result.snapshot.mediaType !== 'application/json' || !sameLocator(result.snapshot.ref, selected)) throw new Error('Invalid resource');
        return { kind: 'available', revision: result.snapshot.ref.revision, document: schemas[app].parse(JSON.parse(decoder.decode(result.snapshot.bytes))) };
      } catch { return { kind: 'unavailable', reason: 'Application document is invalid' }; }
    }
    async function lookup(app, operationId, access) {
      if (typeof operationId !== 'string' || !operationId || operationId.length > 256) return refusal('Invalid operation ID');
      if (!allowed(app, 'lookup', access)) return unknown(operationId, 'Current access does not permit lookup');
      try {
        const result = await providers[app].reconciliation.lookup(operationId, access);
        return allowed(app, 'lookup', access) ? result : unknown(operationId, 'Current access does not permit lookup');
      } catch { return unknown(operationId, 'Publication lookup is unavailable'); }
    }
    async function dispatch(app, input, access, execution = false) {
      const request = publicationSnapshot(input), granted = accessSnapshot(access);
      if (!allowed(app, 'write', granted) || execution && !allowed(app, 'execute', granted)) return unknown(request.operationId, 'Current publication access denied; prior effects are not ruled out');
      try {
        const previous = await providers[app].reconciliation.lookup(request.operationId, granted);
        await beforePublish?.({ app, request: structuredClone(request), access: { ...granted } });
        if (execution && !allowed(app, 'execute', granted)) return unknown(request.operationId, 'Native execution access changed before publication');
        const result = await providers[app].publication.publish(request, granted);
        if (result.kind === 'committed' && previous.kind !== 'committed') publicationCounts[app]++;
        if (result.kind === 'committed') await afterPublish?.({ app, request: structuredClone(request), access: { ...granted } });
        return allowed(app, 'write', granted) && (!execution || allowed(app, 'execute', granted)) ? result : unknown(request.operationId, 'Access changed while publication was in flight');
      } catch { return unknown(request.operationId); }
    }
    async function prepareAction(name, value, access) {
      const app = actionApp[name];
      let input;
      try { input = actionSchemas[name].parse(value); } catch { return { result: refusal('Invalid action request') }; }
      if (!allowed(app, 'write', access) || !allowed(app, 'read', access)) {
        if (sameActor(actor, access)) {
          const previous = await providers[app].workspace(actor.scopeId).reconciliation.lookup(input.operationId, actor);
          if (previous.kind !== 'not-found') return { result: unknown(input.operationId, 'Current access cannot reconcile the prior action') };
        }
        return { result: refusal('Current action access denied') };
      }
      const before = await read(app, access, input.expected);
      if (before.kind !== 'available') return { result: before.kind === 'missing' ? { kind: 'conflict', current: [], reason: 'Expected application revision is unavailable' } : before };
      let document = before.document, changes, preconditions;
      if (app === 'email' && document.status === 'queued') return { result: { kind: 'conflict', current: [{ ...locator(app), revision: input.expected }], reason: 'Queued email cannot be sent or snoozed again' } };
      if (name === 'send_email') {
        const draft = await providers.email.read({ target: draftTarget, revision: { kind: 'exact', value: input.draftRevision } }, access);
        if (draft.kind !== 'available') return { result: draft.kind === 'missing' ? { kind: 'conflict', current: [], reason: 'Expected draft revision is unavailable' } : draft };
        if (draft.snapshot.mediaType !== 'text/markdown') return { result: refusal('Expected a saved Markdown draft') };
        document = emailSchema.parse({ ...document, status: 'queued', snooze: null });
        preconditions = [{ kind: 'revision', target: { ...draftTarget, revision: input.draftRevision } }];
        const outbox = locator('email', `outbox/${createHash('sha256').update(input.operationId).digest('hex')}.json`);
        changes = [{ kind: 'create', target: outbox, expected: { kind: 'absent' }, bytes: jsonBytes({ kind: 'fictional.outbox', version: 1, draftRevision: input.draftRevision, text: decoder.decode(draft.snapshot.bytes) }), mediaType: 'application/json' }];
      } else if (name === 'snooze_email') document = emailSchema.parse({ ...document, status: 'snoozed', snooze: input.option });
      else if (name === 'accept_calendar_slot') {
        if (!document.options.some(option => option.id === input.optionId)) return { result: refusal('Unknown calendar option') };
        document = calendarSchema.parse({ ...document, selected: input.optionId });
      } else {
        if (!document.items.some(item => item.id === input.itemId)) return { result: refusal('Unknown todo item') };
        document = todoSchema.parse({ ...document, items: document.items.map(item => item.id === input.itemId ? { ...item, completed: input.completed } : item) });
      }
      return { request: { operationId: input.operationId, atomicity: 'all-or-nothing', changes: [{ kind: 'replace', target: { ...locator(app), revision: input.expected }, bytes: jsonBytes(document), mediaType: 'application/json' }, ...changes ?? []], ...(preconditions ? { preconditions } : {}) } };
    }
    const action = name => async (value, access) => {
      const captured = accessSnapshot(access), prepared = await prepareAction(name, structuredClone(value), captured);
      return prepared.result ?? dispatch(actionApp[name], prepared.request, captured);
    };
    function restrictedClient(app, selected, access) {
      const captured = accessSnapshot(access);
      return {
        read: async request => {
          if (!sameLocator(request.target, selected)) return refusal('Resource is outside this client');
          const result = await providers[app].read(request, captured);
          return allowed(app, 'read', captured) ? result : refusal('Current read access denied');
        },
        publish: input => {
          let request;
          try { request = publicationSnapshot(input); } catch { return Promise.resolve(refusal('Invalid publication request')); }
          if (request.changes.length !== 1 || request.changes.some(change => !sameLocator(change.target, selected) || change.kind === 'delete')
            || request.preconditions?.some(expected => !sameLocator(expected.target, selected))) return Promise.resolve(refusal('Publication is outside this client'));
          return dispatch(app, request, captured);
        },
        lookup: async operationId => {
          const result = await lookup(app, operationId, captured);
          if (!allowed(app, 'lookup', captured)) return unknown(operationId, 'Current access does not permit lookup');
          return result.kind === 'committed' && result.receipt.changes.some(change => !sameLocator(change.after ?? change.before, selected)) ? unknown(operationId, 'Receipt is outside this client') : result;
        },
      };
    }
    async function seed(app, documents, runtime, ctx) {
      const key = `fictional.morning.prepare.${app}`, actorRecord = Object.fromEntries(fields.filter(field => actor[field] !== undefined).map(field => [field, actor[field]]));
      let intent = await runtime.memo(key, ctx);
      if (!allowed(app, 'execute', actor) || !allowed(app, 'read', actor)) return intent?.request ? unknown(intent.request.operationId, 'Preparation authorization changed') : refusal('Preparation access denied');
      if (!intent) {
        const changes = [], sources = [];
        for (const [selected, bytes, mediaType] of documents) {
          const existing = await providers[app].read({ target: selected, revision: { kind: 'latest' } }, actor);
          if (existing.kind === 'missing') changes.push({ kind: 'create', target: selected, expected: { kind: 'absent' }, bytes, mediaType });
          else if (existing.kind === 'available') sources.push(existing.snapshot.ref);
          else throw new Error('Preparation read denied or unavailable');
        }
        const request = changes.length ? { operationId: JSON.stringify(['morning-prepare', runtime.taskId, app]), atomicity: 'all-or-nothing', changes } : null;
        intent = await runtime.memo(key, { providerBinding: providerBindings[app], actor: actorRecord, sources,
          request: request ? { ...request, changes: request.changes.map(change => ({ ...change, bytes: [...change.bytes] })) } : null,
          digest: request ? await publicationDigest(request) : null }, ctx);
      }
      if (intent.providerBinding !== providerBindings[app] || !sameActor(intent.actor, actor) || intent.request && !allowed(app, 'write', actor)) return intent.request ? unknown(intent.request.operationId, 'Original preparation binding is unavailable') : refusal('Preparation binding changed');
      if (!intent.request) return { kind: 'existing', sources: intent.sources, providerBinding: intent.providerBinding };
      let result;
      if (await runtime.memo(`${key}.attempted`, ctx)) {
        const found = await lookup(app, intent.request.operationId, actor);
        result = found.kind === 'committed' ? await evidence(intent, found) : unknown(intent.request.operationId);
      } else {
        await runtime.memo(`${key}.attempted`, true, ctx);
        result = await evidence(intent, await dispatch(app, restore(intent.request), actor, true));
        if (result.kind === 'unknown') { const found = await lookup(app, intent.request.operationId, actor); if (found.kind === 'committed') result = await evidence(intent, found); }
      }
      return result.kind === 'committed' ? { ...result, sources: [...intent.sources, ...result.receipt.changes.map(change => change.after)], providerBinding: intent.providerBinding } : result;
    }
    const preparation = (app, documents) => defineTask({ name: `fictional.morning.prepare-${app}`, version: 1, initial: () => ({ phase: 'prepare' }), phases: {
      prepare: async (_task, runtime, ctx) => {
        const result = await seed(app, documents(), runtime, ctx);
        await runtime.commit(() => ({ status: 'terminal', outcome: { status: 'completed', result } }), ctx);
      },
    } });
    const emailTask = preparation('email', () => [[locator('email'), jsonBytes(initialEmail()), 'application/json'], [draftTarget, encoder.encode(`# Fictional reply\n${privateCanaries.draft}\n`), 'text/markdown']]);
    const calendarTask = preparation('calendar', () => [[locator('calendar'), jsonBytes(initialCalendar()), 'application/json']]);
    const mergeTask = defineTask({ name: 'fictional.morning.merge', version: 1, initial: () => ({ phase: 'wait' }), phases: {
      wait: (task, runtime, ctx) => runtime.commit(() => ({ status: 'waiting', on: [task.input.email, task.input.calendar], policy: 'allSettled', checkpoint: { phase: 'merge' } }), ctx),
      merge: async (task, runtime, ctx) => {
        const outcomes = await runtime.outcomes([task.input.email, task.input.calendar], ctx);
        if (outcomes.some(outcome => outcome?.status !== 'completed')) throw new Error('Morning inputs unavailable');
        const source = (app, at) => {
          const result = outcomes[at].result;
          if (result.providerBinding !== providerBindings[app]) throw new Error('Preparation source binding changed');
          const ref = result.sources?.find(ref => sameLocator(ref, locator(app)));
          if (!ref) throw new Error('Preparation has no confirmed source');
          return ref;
        };
        let merge = await runtime.memo('fictional.morning.merge-input', ctx);
        if (!merge) {
          const sources = { email: source('email', 0), calendar: source('calendar', 1) };
          const email = await read('email', actor, sources.email.revision), calendar = await read('calendar', actor, sources.calendar.revision);
          if (email.kind !== 'available' || calendar.kind !== 'available') throw new Error('Morning inputs denied');
          const document = initialTodo();
          const derived = todoSchema.parse({ ...document, items: document.items.map(item => ({ ...item, completed: item.id === 'reply' ? email.document.status === 'queued' : calendar.document.selected !== null })) });
          merge = await runtime.memo('fictional.morning.merge-input', { sources, document: derived }, ctx);
        }
        const sources = merge.sources;
        const todo = await seed('todo', [[locator('todo'), jsonBytes(merge.document), 'application/json']], runtime, ctx);
        const layoutResult = await seed('layout', [[layoutTarget, jsonBytes(initialLayout), 'application/json']], runtime, ctx);
        await runtime.commit(() => ({ status: 'terminal', outcome: { status: 'completed', result: { todo, layout: layoutResult, sources, links: { reply: 'email/reply', calendar: 'calendar/conflict' } } } }), ctx);
      },
    } });
    async function evidence(intent, value) {
      let result;
      try { result = parsePublicationResult(value); } catch { return unknown(intent.request.operationId); }
      if (result.kind !== 'committed') return result.kind === 'unknown' || result.kind === 'partial' ? unknown(intent.request.operationId) : result;
      const receipt = result.receipt, request = restore(intent.request);
      if (receipt.operationId !== request.operationId || receipt.argumentDigest !== intent.digest || !sameActor(receipt, { ...intent.actor, authorizationRef: undefined }) || receipt.changes.length !== request.changes.length) return unknown(request.operationId);
      for (let at = 0; at < request.changes.length; at++) {
        const expected = request.changes[at], actual = receipt.changes[at];
        if (actual.kind !== expected.kind || !sameLocator(actual.after, expected.target) || (expected.kind === 'create' ? actual.before !== null : !sameLocator(actual.before, expected.target) || actual.before.revision !== expected.target.revision)) return unknown(request.operationId);
      }
      return result;
    }
    const restore = request => ({ ...request, changes: request.changes.map(change => ({ ...change, bytes: Uint8Array.from(change.bytes) })) });
    const tools = Object.keys(actionApp).map(name => defineTool({ name, description: `Apply the owning application's ${name} action to exact saved revisions.`,
      parameters: { ...actionSchemas[name].omit({ operationId: true }).toJSONSchema() }, replay: 'safe',
      execute: async (args, api, ctx) => {
        let intent = await api.memo(requestMemo, ctx);
        const app = actionApp[name];
        if (intent && (intent.instanceId !== instanceId || intent.providerBinding !== providerBindings[app] || intent.name !== name || !sameActor(intent.actor, actor))) return { content: [{ type: 'text', text: JSON.stringify(unknown(intent.request.operationId, 'Original action binding changed')) }] };
        const operationId = intent?.request.operationId ?? JSON.stringify(['fictional.morning', instanceId, api.taskId]);
        const respond = result => ({ content: [{ type: 'text', text: JSON.stringify(result) }] });
        if (!allowed(app, 'execute', actor)) return respond(intent ? unknown(operationId) : refusal('Native execution denied'));
        if (!intent) {
          const prepared = await prepareAction(name, { ...args, operationId }, actor);
          if (prepared.result) return respond(prepared.result);
          intent = await api.memo(requestMemo, { name, instanceId, providerBinding: providerBindings[app], actor: Object.fromEntries(fields.filter(field => actor[field] !== undefined).map(field => [field, actor[field]])),
            request: { ...prepared.request, changes: prepared.request.changes.map(change => ({ ...change, bytes: [...change.bytes] })) }, digest: await publicationDigest(prepared.request) }, ctx);
        }
        let result;
        if (await api.memo(attemptedMemo, ctx)) {
          const found = await lookup(app, operationId, actor);
          result = found.kind === 'committed' ? await evidence(intent, found) : unknown(operationId);
        } else {
          await api.memo(attemptedMemo, true, ctx);
          result = await evidence(intent, await dispatch(app, restore(intent.request), actor, true));
          if (result.kind === 'unknown') { const found = await lookup(app, operationId, actor); if (found.kind === 'committed') result = await evidence(intent, found); }
        }
        return respond(result);
      },
    }));
    const registry = createRegistry(); registry.install(defineExtension({ name: 'fictional.morning', docs: [runtimeIdentity], tasks: [emailTask, calendarTask, mergeTask], tools }));
    harness = await Harness.open(await openNodeSqliteStorage(join(directory, 'native.sqlite')), { registry, models: createModels() }, context);
    conversation = await harness.root(context);
    instanceId = await conversation.commit(async tx => (await tx.doc(runtimeIdentity)).id, context);
    return {
      canRead: (app, access) => Object.hasOwn(providers, app) && allowed(app, 'read', access),
      email: { read: access => read('email', access), send: action('send_email'), snooze: action('snooze_email'), lookup: (id, access) => lookup('email', id, access) },
      calendar: { read: access => read('calendar', access), acceptSlot: action('accept_calendar_slot'), lookup: (id, access) => lookup('calendar', id, access) },
      todo: { read: access => read('todo', access), setCompleted: action('complete_todo'), lookup: (id, access) => lookup('todo', id, access) },
      draftTarget, layoutTarget, draftClient: access => restrictedClient('email', draftTarget, access), layoutClient: access => restrictedClient('layout', layoutTarget, access),
      local: { harness, conversation, providers, publicationCounts },
      prepare: async () => {
        const ids = await conversation.commit(async tx => {
          const email = await tx.createTask(emailTask, {}, { ownership: { kind: 'conversation' } });
          const calendar = await tx.createTask(calendarTask, {}, { ownership: { kind: 'conversation' } });
          const merge = await tx.createTask(mergeTask, { email, calendar }, { ownership: { kind: 'conversation' } });
          return { email, calendar, merge };
        }, context);
        const results = Object.fromEntries(await Promise.all(Object.entries(ids).map(async ([name, id]) => [name, await harness.waitForTask(id, context)])));
        return { ids, results };
      },
      invokeTool: async (name, args, access) => {
        access = accessSnapshot(access);
        if (!Object.hasOwn(actionApp, name) || !allowed(actionApp[name], 'execute', access)) return { taskId: null, result: refusal('Native invocation denied') };
        const input = structuredClone(args);
        const taskId = await conversation.commit(async tx => {
          if (!allowed(actionApp[name], 'execute', access)) throw new Error('Native admission revoked');
          const entry = await tx.appendEntry(AssistantEntry, conversation.id, { model: [{ role: 'assistant', content: [{ type: 'toolCall', id: 'morning-action', name, arguments: input }], api: 'fixture', provider: 'fixture', model: 'fictional-no-model', timestamp: Date.now(), stopReason: 'toolUse', usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } }] });
          return tx.createTask(ToolTask, { assistant: entry.id, callId: 'morning-action' }, { ownership: { kind: 'conversation' } });
        }, context);
        const uncertain = () => ({ taskId, result: unknown(JSON.stringify(['fictional.morning', instanceId, taskId]), 'Native tool failed; publication outcome is not established') });
        try {
          const terminal = await harness.waitForTask(taskId, context);
          if (terminal.state.outcome?.status !== 'completed') return uncertain();
          const entry = await conversation.commit(tx => tx.entry(ToolResultEntry, terminal.state.outcome.result.entryId), context);
          const message = entry.model[0];
          return message.isError ? uncertain() : { taskId, result: JSON.parse(message.content.find(item => item.type === 'text').text) };
        } catch { return uncertain(); }
      },
      close: async () => { if (closed) return; closed = true; await harness.close(context); for (const provider of Object.values(providers)) provider.close(); },
    };
  } catch (error) { closed = true; if (harness) await harness.close(context); for (const provider of Object.values(providers)) provider.close(); throw error; }
}
