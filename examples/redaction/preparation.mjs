import { randomUUID } from 'node:crypto';
import { AssistantEntry, GenerationTask, configure, defineDocFamily, defineExtension, defineTask, defineTool, hook } from '@earendil-works/pi-durable';
import { Type } from '@earendil-works/pi-ai';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { createOutputValidation } from '@hachej/boring-agent/validation';
import { locator, reference } from '@hachej/boring-files/publication';
import { actorSnapshot, decode, equal, encode } from './bindings.mjs';
import { expectation, expected, readable, change, checkedPublication, requestId } from './adoption-bindings.mjs';
import { preparationTargets, parsePreparation, parsePreparationDossier, preparationDeliveryOperation } from './preparation-schema.mjs';
import { preparationDossier, preparationConfig } from './preparation-fixtures.mjs';
import { installPreparationModel } from './preparation-model.mjs';

const bindings = defineDocFamily({ kind: 'fixture.redaction.preparation.requests', version: 1, scope: 'session', family: true, initial: () => ({ binding: null }) });
const evidence = defineDocFamily({ kind: 'fixture.redaction.preparation.evidence', version: 1, scope: 'session', family: true, initial: () => ({ entries: [] }) });
const denied = () => ({ kind: 'denied', reason: 'Preparation access denied' });
const unavailable = () => ({ kind: 'unavailable', reason: 'Preparation is unavailable' });
const unknown = operationId => ({ kind: 'unknown', ...(operationId ? { operationId } : {}), reason: 'Original preparation outcome is uncertain' });
const conflict = () => ({ kind: 'conflict', current: [], reason: 'Preparation input changed' });
const key = request => JSON.stringify([request.instanceId, request.requestId]);
const recordTarget = request => ({ resource: { providerId: 'redaction', path: `${request.instanceId}/preparation/requests/${requestId(request.requestId)}.json` }, view: { kind: 'published' } });
const operation = request => JSON.stringify(['fictional.preparation.reserve.v1', request.instanceId, request.requestId]);

export function createPreparation({ harness, provider, models, allowed, options }) {
  const fake = installPreparationModel(models);
  let instanceId, conversation;
  const visible = (actor, request, action = 'read') => allowed(actor, action) && [request.notes, request.dossier, request.config, request.generation.target, request.output.target, recordTarget(request)].every(target => allowed(actor, 'read', target));
  const snapshot = value => {
    if (!value || Object.keys(value).sort().join(',') !== 'config,dossier,generation,instanceId,notes,output,requestId' || value.instanceId !== instanceId) throw new TypeError('Invalid preparation request');
    requestId(value.requestId); const targets = preparationTargets(instanceId);
    const selected = name => { const ref = reference(value[name]); if (!equal(locator(ref), targets[name])) throw new TypeError('Wrong preparation source'); return ref; };
    return { instanceId, requestId: value.requestId, notes: selected('notes'), dossier: selected('dossier'), config: selected('config'), generation: expectation(value.generation, targets.generation), output: expectation(value.output, targets.output) };
  };
  const reservationPublication = record => ({ operationId: operation(record.request), atomicity: 'all-or-nothing', preconditions: [record.request.output, ...['notes', 'dossier', 'config'].map(name => ({ kind: 'revision', target: record.request[name] }))],
    changes: [change({ kind: 'absent', target: recordTarget(record.request) }, record, 'application/json'), change(record.request.generation, { requestId: record.request.requestId, generationId: record.generationId }, 'application/json')] });
  const retained = async (request, actor) => {
    const saved = await provider.read({ target: recordTarget(request), revision: { kind: 'latest' } }, actor);
    if (saved.kind === 'missing') return saved;
    if (saved.kind !== 'available') return unavailable();
    const value = JSON.parse(decode(saved.snapshot, 'application/json', 32768));
    if (!equal(value.request, request) || !equal(value.actor, actor)) return conflict();
    if (Object.keys(value).sort().join(',') !== 'actor,generationId,request' || typeof value.generationId !== 'string' || !/^[0-9a-f-]{36}$/.test(value.generationId)) return unavailable();
    const publication = reservationPublication(value), found = await provider.reconciliation.lookup(publication.operationId, actor);
    if (!visible(actor, request)) return denied();
    if (found.kind !== 'committed') return unknown(publication.operationId);
    const checked = await checkedPublication(found, publication, actor);
    if (checked.kind !== 'committed' || !equal(checked.receipt.changes[0].after, saved.snapshot.ref)) return unknown(publication.operationId);
    if (!visible(actor, request)) return denied();
    return { kind: 'reserved', record: value, reservation: saved.snapshot.ref, guard: checked.receipt.changes[1].after };
  };
  const original = async conversationId => {
    const child = await harness().commit(tx => tx.conversation(conversationId), context);
    const task = child?.owner?.taskId && await harness().getTask(child.owner.taskId, context);
    if (!task || task.kind !== producer.definition.name) throw new Error('Original preparation producer unavailable');
    return task;
  };
  const permitted = input => visible(input.actor, input.request, 'execute');
  const source = defineTool({ name: 'read_preparation_source', description: 'Read the exact fictional preparation sources.', replay: 'safe', parameters: Type.Object({ resource: Type.Literal('captured') }, { additionalProperties: false }),
    execute: async (_args, api) => {
      const task = await original(api.conversationId);
      return permitted(task.input) ? { content: [{ type: 'text', text: JSON.stringify({ notes: task.input.notes, dossier: task.input.dossier }) }] }
        : { isError: true, content: [{ type: 'text', text: 'Preparation source denied' }] };
    } });
  const producer = defineTask({ name: 'fixture.redaction.preparation.produce', version: 1, initial: () => ({ phase: 'start' }), phases: {
    start: async (task, runtime, ctx) => {
      await options.beforeProduce?.(structuredClone(task.input));
      if (!permitted(task.input)) throw new Error('Preparation execution denied');
      await runtime.commit(async tx => {
        const child = await tx.createConversation({ ownership: { kind: 'task', taskId: runtime.taskId } });
        await configure(tx, child.id, { model: fake.model, tools: [source], extensions: [extension] });
        return { status: 'running', checkpoint: { phase: 'generate', child: child.id } };
      }, ctx);
    },
    generate: async (task, runtime, ctx) => {
      if (!permitted(task.input)) throw new Error('Preparation execution denied');
      const child = await runtime.conversation(task.state.checkpoint.child, ctx);
      const submitted = await child.submit({ type: 'input', requestId: `preparation:${runtime.taskId}`, content: JSON.stringify({ request: task.input.request, generationId: task.input.generationId, scenario: task.input.settings.scenario }) }, ctx);
      const settled = await submitted.wait(ctx);
      if (settled.status !== 'done') throw new Error('Preparation generation failed');
      const entry = await harness().commit(tx => tx.entry(AssistantEntry, settled.answer), ctx);
      const text = entry.model[0].content.filter(item => item.type === 'text').map(item => item.text).join('');
      const stored = await runtime.snapshot(evidence, String(child.id), ctx);
      const entries = task.input.settings.scenario === 'missing-evidence' ? [] : task.input.settings.scenario === 'forged-evidence' ? [999999] : stored.entries;
      await runtime.commit(() => ({ status: 'terminal', outcome: { status: 'completed', result: { text, evidence: entries } } }), ctx);
    },
  } });
  const validation = createOutputValidation({ name: 'fixture.redaction.preparation.validate', version: 1, harness,
    authorize: async owner => { const task = await harness().getTask(owner, context); return !!task && task.kind === producer.definition.name && allowed(task.input.actor, 'validate') && permitted(task.input); },
    validate: async (text, returns) => {
      try {
        if (returns.length !== 1 || returns[0].call.name !== 'read_preparation_source' || !equal(returns[0].call.arguments, { resource: 'captured' })) throw new Error();
        const task = await original(returns[0].conversationId), input = task.input;
        if (!equal(returns[0].result.content, [{ type: 'text', text: JSON.stringify({ notes: input.notes, dossier: input.dossier }) }])) throw new Error();
        const parsed = parsePreparation(JSON.parse(text));
        const expected = parsePreparation({ format: 'fictional.redaction.preparation', version: 1, instanceId: input.request.instanceId, requestId: input.request.requestId, generationId: input.generationId,
          sources: { notes: input.request.notes, dossier: input.request.dossier, config: input.request.config }, header: input.dossier.header, synthesis: input.dossier.synthesis, schedule: input.dossier.schedule, cards: input.dossier.cards });
        if (!equal(parsed, expected)) throw new Error();
        return { kind: 'valid', value: parsed };
      } catch { return { kind: 'invalid', errors: ['Preparation must match its complete captured fictional source and actual tool evidence'] }; }
    } });
  const publication = (input, taskId, document) => ({ operationId: preparationDeliveryOperation(input.request.instanceId, taskId), atomicity: 'all-or-nothing', preconditions: [{ kind: 'revision', target: input.guard }, ...['notes', 'dossier', 'config'].map(name => ({ kind: 'revision', target: input.request[name] }))], changes: [change(input.request.output, document, 'application/json')] });
  const deliver = defineTask({ name: 'fixture.redaction.preparation.deliver', version: 1, initial: () => ({ phase: 'wait' }), phases: {
    wait: (task, runtime, ctx) => runtime.commit(() => ({ status: 'waiting', on: [task.input.validation], policy: 'allSettled', checkpoint: { phase: 'publish' } }), ctx),
    publish: async (task, runtime, ctx) => {
      const [outcome] = await runtime.outcomes([task.input.validation], ctx);
      let result;
      if (outcome?.status !== 'completed' || outcome.result.kind !== 'valid') result = outcome?.status === 'completed' ? outcome.result : { kind: 'producer-failed' };
      else {
        const request = publication(task.input, runtime.taskId, outcome.result.value), attempted = await runtime.memo('preparation.publication.attempted', ctx);
        const can = () => visible(task.input.actor, task.input.request, 'publish') && allowed(task.input.actor, 'execute');
        try {
          if (!can()) result = attempted ? unknown(request.operationId) : denied();
          else if (attempted) {
            const found = await provider.reconciliation.lookup(request.operationId, task.input.actor);
            result = found.kind === 'committed' ? await checkedPublication(found, request, task.input.actor) : unknown(request.operationId);
          } else {
            await runtime.memo('preparation.publication.attempted', true, ctx);
            await options.beforePublish?.(structuredClone(task.input));
            if (!can()) result = unknown(request.operationId);
            else {
              result = await checkedPublication(await provider.publication.publish(request, { ...task.input.actor, signal: runtime.signal }), request, task.input.actor);
              if (result.kind === 'committed') await options.afterCommit?.(structuredClone(result));
            }
          }
          if (!can()) result = ['committed', 'unknown'].includes(result.kind) || attempted ? unknown(request.operationId) : denied();
        } catch { result = unknown(request.operationId); }
      }
      await runtime.commit(() => ({ status: 'terminal', outcome: { status: 'completed', result } }), ctx);
    },
  } });
  const extension = defineExtension({ name: 'fixture.redaction.preparation', tasks: [producer, deliver], tools: [source], hooks: [hook(GenerationTask, { afterTools: async (_assistant, results, api) => {
    const child = await harness().conversation(api.conversationId, context);
    await child.commit(async tx => { (await tx.doc(evidence, String(api.conversationId), null)).entries = [...results]; }, context);
  } })] });
  const read = async actor => {
    actor = actorSnapshot(actor); const target = preparationTargets(instanceId).output;
    if (!allowed(actor, 'read', target)) return denied();
    const value = await provider.read({ target, revision: { kind: 'latest' } }, actor);
    if (!allowed(actor, 'read', target)) return denied();
    if (value.kind === 'available') { try { if (parsePreparation(JSON.parse(decode(value.snapshot, 'application/json', 65536))).instanceId !== instanceId) throw new Error('Wrong preparation owner'); } catch { return unavailable(); } }
    return value;
  };
  const admit = async (value, identity) => {
    let request, actor; try { request = snapshot(value); actor = actorSnapshot(identity); } catch { return denied(); }
    if (!visible(actor, request, 'admit')) return denied();
    try {
      let reservation = await retained(request, actor);
      if (reservation.kind === 'missing') {
        const record = { actor, request, generationId: randomUUID() }, result = await provider.publication.publish(reservationPublication(record), actor);
        if (result.kind === 'committed') await options.afterReservationCommit?.(structuredClone(result));
        if (!['committed', 'conflict'].includes(result.kind)) return result;
        reservation = await retained(request, actor);
      }
      if (reservation.kind !== 'reserved') return reservation;
      if (!visible(actor, request, 'admit')) return { kind: 'reserved' };
      const prior = await harness().snapshot(bindings, key(request), context);
      if (!visible(actor, request, 'admit')) return unknown();
      if (prior?.binding) return equal(prior.binding.request, request) && equal(prior.binding.ref.actor, actor) ? { kind: 'admitted', ref: structuredClone(prior.binding.ref) } : conflict();
      const reads = await Promise.all(['notes', 'dossier', 'config'].map(name => provider.read({ target: request[name], revision: { kind: 'exact', value: request[name].revision } }, actor)));
      if (reads.some(value => value.kind !== 'available')) return { kind: 'reserved' };
      const notes = decode(reads[0].snapshot, 'text/markdown', 4096), dossier = parsePreparationDossier(JSON.parse(decode(reads[1].snapshot, 'application/json', 65536))), settings = JSON.parse(decode(reads[2].snapshot, 'application/json', 4096));
      if (Object.keys(settings).sort().join(',') !== 'format,scenario,version' || settings.format !== 'fictional.redaction.preparation-config' || settings.version !== 1 || !['valid', 'malformed', 'incomplete', 'altered', 'missing-evidence', 'forged-evidence'].includes(settings.scenario)) return unavailable();
      const ref = await conversation.commit(async tx => {
        if (!visible(actor, request, 'admit')) throw new Error('Preparation admission revoked');
        const record = await tx.doc(bindings, key(request), null);
        if (record.binding) { if (!equal(record.binding.request, request) || !equal(record.binding.ref.actor, actor)) throw new Error('Preparation binding changed'); return JSON.parse(JSON.stringify(record.binding.ref)); }
        const input = { request, actor, notes, dossier, settings, generationId: reservation.record.generationId, guard: reservation.guard };
        const producing = await tx.createTask(producer, input, { ownership: { kind: 'conversation' } });
        const validating = await tx.createTask(validation.task, { producer: producing }, { ownership: { kind: 'conversation' } });
        const delivering = await tx.createTask(deliver, { request, actor, guard: reservation.guard, validation: validating }, { ownership: { kind: 'conversation' } });
        const ref = { instanceId, requestId: request.requestId, generationId: reservation.record.generationId, actor, reservation: reservation.reservation, guard: reservation.guard, producer: producing, validation: validating, delivery: delivering, operationId: preparationDeliveryOperation(instanceId, delivering) };
        record.binding = { request, ref };
        if (!visible(actor, request, 'admit')) throw new Error('Preparation admission revoked');
        return structuredClone(ref);
      }, context);
      harness().resume(); await options.afterAdmission?.(structuredClone(ref));
      return visible(actor, request, 'admit') ? { kind: 'admitted', ref } : unknown();
    } catch { return unknown(); }
  };
  return { extension, validation: validation.extension, fake,
    initialize: async (id, owner) => {
      instanceId = id; conversation = owner;
      const actor = actorSnapshot({ principalId: 'fictional-editor', initiatorId: 'fictional-human', scopeId: 'fictional-team' }), targets = preparationTargets(instanceId), workspace = provider.workspace(actor.scopeId);
      const changes = [];
      for (const [target, document] of [[targets.dossier, preparationDossier()], [targets.config, preparationConfig()], [targets.layout, options.layout]]) {
        const saved = await workspace.read({ target, revision: { kind: 'latest' } }, actor);
        if (saved.kind === 'missing') changes.push(change({ kind: 'absent', target }, document, 'application/json'));
        else if (saved.kind !== 'available') throw new Error('Preparation initialization unavailable');
      }
      if (changes.length && (await workspace.publication.publish({ operationId: `preparation-init-${randomUUID()}`, atomicity: 'all-or-nothing', changes }, actor)).kind !== 'committed') throw new Error('Preparation initialization failed');
    },
    service: {
      capture: async (value, identity) => {
        let actor; try { actor = actorSnapshot(identity); requestId(value.requestId); if (Object.keys(value).sort().join(',') !== 'notes,requestId') throw new Error(); } catch { return denied(); }
        const targets = preparationTargets(instanceId), selected = structuredClone(value);
        const reads = await Promise.all(['notes', 'dossier', 'config', 'generation', 'output'].map(name => provider.read({ target: targets[name], revision: { kind: 'latest' } }, actor)));
        if (reads.slice(0, 3).some(value => value.kind !== 'available') || !reads.every(readable)) return unavailable();
        const request = snapshot({ instanceId, requestId: selected.requestId, notes: reads[0].snapshot.ref, dossier: reads[1].snapshot.ref, config: reads[2].snapshot.ref, generation: expected(reads[3], targets.generation), output: expected(reads[4], targets.output) });
        if (!visible(actor, request, 'admit')) return denied();
        return equal(request.notes, selected.notes) ? { kind: 'captured', request } : conflict();
      }, admit, read,
      latest: async identity => {
        let actor; try { actor = actorSnapshot(identity); } catch { return denied(); }
        try {
          const target = preparationTargets(instanceId).generation;
          const generation = await provider.read({ target, revision: { kind: 'latest' } }, actor);
          if (!allowed(actor, 'read', target)) return denied();
          if (generation.kind !== 'available') return generation;
          const guard = JSON.parse(decode(generation.snapshot, 'application/json', 4096));
          const saved = await provider.read({ target: recordTarget({ instanceId, requestId: guard.requestId }), revision: { kind: 'latest' } }, actor);
          if (saved.kind !== 'available') return unavailable();
          const record = JSON.parse(decode(saved.snapshot, 'application/json', 32768)), request = snapshot(record.request);
          if (!equal(record.actor, actor)) return denied();
          const found = await retained(request, actor);
          if (found.kind !== 'reserved') return found;
          if (!equal(found.guard, generation.snapshot.ref) || found.record.generationId !== guard.generationId) return unavailable();
          const prior = await harness().snapshot(bindings, key(request), context);
          if (!visible(actor, request)) return denied();
          return prior?.binding && equal(prior.binding.request, request) && equal(prior.binding.ref.actor, actor) ? { kind: 'admitted', request, ref: structuredClone(prior.binding.ref) } : { kind: 'reserved', request };
        } catch { return unavailable(); }
      },
      result: async (value, identity) => {
        let ref, actor; try { ref = structuredClone(value); actor = actorSnapshot(identity); if (ref.instanceId !== instanceId) throw new Error(); } catch { return denied(); }
        try {
          const prior = await harness().snapshot(bindings, key(ref), context);
          if (!prior?.binding || !equal(prior.binding.ref, ref) || !equal(ref.actor, actor) || !visible(actor, prior.binding.request)) return denied();
          const task = await harness().getTask(ref.delivery, context), validationResult = await harness().getTask(ref.validation, context);
          if (!task || task.kind !== deliver.definition.name || !visible(actor, prior.binding.request)) return denied();
          if (validationResult?.state.status === 'terminal' && validationResult.state.outcome.status === 'completed' && validationResult.state.outcome.result.kind === 'valid') {
            const request = publication(task.input, ref.delivery, validationResult.state.outcome.result.value), found = await provider.reconciliation.lookup(ref.operationId, actor);
            if (!visible(actor, prior.binding.request)) return unknown(ref.operationId);
            if (found.kind === 'committed') { const result = await checkedPublication(found, request, actor); return visible(actor, prior.binding.request) ? result : unknown(ref.operationId); }
          }
          if (task.state.status !== 'terminal') return { kind: 'pending' };
          return task.state.outcome.status === 'completed' ? structuredClone(task.state.outcome.result) : unknown(ref.operationId);
        } catch { return unknown(ref.operationId); }
      },
    },
  };
}
