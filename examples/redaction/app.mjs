import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Harness, createRegistry, defineDoc, defineDocFamily, defineExtension, defineTask } from '@earendil-works/pi-durable';
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { createDocumentDelivery } from '@hachej/boring-agent/delivery';
import { openSqliteWorkspaces } from '../shared/sqlite-workspaces.mjs';
import { actorSnapshot, decode, equal, paths, requestSnapshot, reservationTarget, reservationOperation, reservationPublication } from './bindings.mjs';
import { createReservations } from './reservation.mjs';
import { createRedactionProposals } from './proposals.mjs';
import { createCorrections } from './corrections.mjs';
import { createAdoption } from './adoption.mjs';
import { domainPaths } from './adoption-bindings.mjs';
import { publicationDigest, parsePublicationResult } from '@hachej/boring-files/publication';
export { redactionActor } from './bindings.mjs';

const installation = defineDoc({ kind: 'fixture.redaction.instance', version: 1, scope: 'session', initial: () => ({ instanceId: randomUUID() }) });
const requests = defineDocFamily({ kind: 'fixture.redaction.requests', version: 1, scope: 'session', family: true, initial: () => ({ binding: null }) });

export async function openRedactionFixture({ directory, policy = () => true, beforeProduce = async () => {},
  afterReservationCommit = async () => {}, afterAdmission = async () => {}, afterDeliveryCommit = async () => {},
  afterRepairDecision = async () => {}, beforeAdoptionPublish = async () => {}, afterAdoptionCommit = async () => {}, preparation }) {
  mkdirSync(directory, { recursive: true });
  let closed = false, closing, instanceId, harness;
  const allowed = (actor, action, target) => {
    try { return !closed && policy(actorSnapshot({ principalId: actor?.principalId, initiatorId: actor?.initiatorId, scopeId: actor?.scopeId }),
      action, target === undefined ? undefined : structuredClone(target)) === true; }
    catch { return false; }
  };
  const provider = openSqliteWorkspaces({ filename: join(directory, 'resources.sqlite'), providerId: 'redaction',
    authorize: (action, target, actor) => target.resource.path.startsWith(`${instanceId}/`)
      && !(['/requests/', '/correction-requests/'].some(part => target.resource.path.includes(part)) && ['replace', 'delete'].includes(action))
      && !(actor.authorizationRef === 'fictional.redaction.correct.v1' && !allowed(actor, 'correct', target))
      && !(actor.authorizationRef === 'fictional.redaction.adopt.v1' && !allowed(actor, 'adopt', target))
      && !(target.resource.path.includes('/requests/') && action === 'create' && !allowed(actor, 'admit'))
      && allowed(actor, action === 'lookup' ? 'read' : action === 'read' ? 'read' : 'publish', target) });
  const reservations = createReservations({ provider, publish: async (request, actor) => {
    const result = await provider.publication.publish(request, actor);
    if (result.kind === 'committed') await afterReservationCommit(structuredClone(result));
    return result;
  } });
  const producer = defineTask({ name: 'fixture.redaction.produce', version: 1, initial: () => ({ phase: 'produce' }), phases: {
    produce: async (task, runtime, ctx) => {
      await beforeProduce(structuredClone(task.input));
      const permitted = allowed(task.input.actor, 'execute');
      await runtime.commit(() => ({ status: 'terminal', outcome: permitted
        ? { status: 'completed', result: `# Fictional ${task.input.request.subject}\n${task.input.text}` }
        : { status: 'failed', error: { name: 'AccessDenied', message: 'Fictional production is not authorized' } } }), ctx);
    },
  }, abort: async (_task, runtime, ctx) => runtime.commit(() => ({ status: 'terminal', outcome: { status: 'aborted' } }), ctx) });
  const proposals = createRedactionProposals({ harness: () => harness, allowed, beforeProduce, afterRepairDecision });
  const preparing = preparation ? (await import('./preparation.mjs')).createPreparation({ harness: () => harness, provider, models: proposals.models, allowed, options: preparation }) : null;
  const registry = createRegistry();
  if (preparing) { registry.install(preparing.extension); registry.install(preparing.validation); }
  registry.install(proposals.extension);
  registry.install(proposals.validation.extension);
  registry.install(defineExtension({ name: 'fixture.redaction', tasks: [producer] }));
  let storage;
  try {
    storage = await openNodeSqliteStorage(join(directory, 'native.sqlite'));
    harness = await Harness.open(storage, { registry, models: proposals.models }, context);
    const conversation = await harness.root(context);
    instanceId = await conversation.commit(async tx => (await tx.doc(installation)).instanceId, context);
    await preparing?.initialize(instanceId, conversation);
    const delivery = createDocumentDelivery({ operationNamespace: `fictional.redaction:${instanceId}`, validationVersion: 'fictional-heading-v1',
      lookup: provider.reconciliation, publisher: { publish: async (...args) => {
        const result = await provider.publication.publish(...args);
        if (result.kind === 'committed') await afterDeliveryCommit(structuredClone(result));
        return result;
      } },
      resolveAccess: async (_target, producerId, ctx) => {
        const task = await harness.getTask(producerId, ctx);
        if (!task || ![producer.definition.name, proposals.format.definition.name].includes(task.kind)) throw new Error('Original producer is unavailable');
        return actorSnapshot(task.input.actor);
      }, validate: text => text.startsWith('# Fictional ') ? [] : ['Fictional heading required'] });
    registry.install(delivery.extension);

    const capture = async (subject, requestId, value) => {
      let actor, targets;
      try { actor = actorSnapshot(value); targets = paths(instanceId, subject); }
      catch { return { kind: 'denied' }; }
      if (!allowed(actor, 'admit')) return { kind: 'denied' };
      const reads = await Promise.all(Object.values(targets).map(target => provider.read({ target, revision: { kind: 'latest' } }, actor)));
      if (!allowed(actor, 'admit') || Object.values(targets).some(target => !allowed(actor, 'read', target))) return { kind: 'denied' };
      const [source, config, generation, edit, output] = reads;
      if (source.kind !== 'available' || config.kind !== 'available'
        || reads.some(read => !['available', 'missing'].includes(read.kind))) return { kind: 'unavailable' };
      const expected = (read, target) => read.kind === 'available' ? { kind: 'revision', target: read.snapshot.ref } : { kind: 'absent', target };
      try { return { kind: 'captured', request: requestSnapshot({ instanceId, subject, requestId, source: source.snapshot.ref, config: config.snapshot.ref,
        generation: expected(generation, targets.generation), edit: expected(edit, targets.edit), output: expected(output, targets.output) }, instanceId) }; }
      catch { return { kind: 'denied' }; }
    };
    const readInputs = async (request, actor, mode) => {
      const source = await provider.read({ target: request.source, revision: { kind: 'exact', value: request.source.revision } }, actor);
      const config = await provider.read({ target: request.config, revision: { kind: 'exact', value: request.config.revision } }, actor);
      if (source.kind !== 'available' || config.kind !== 'available' || !equal(source.snapshot.ref, request.source) || !equal(config.snapshot.ref, request.config)) throw new Error('Original input is unavailable');
      const settings = JSON.parse(decode(config.snapshot, 'application/json', 1024));
      if (mode === 'text') {
        if (!equal(settings, { format: 'fictional.redaction', version: 1, prefix: '# Fictional' })) throw new Error('Unsupported fictional config');
      } else {
        const proposal = settings.proposal;
        if (settings.format !== 'fictional.redaction' || settings.version !== 2 || settings.prefix !== '# Fictional'
          || Object.keys(settings).sort().join(',') !== 'format,prefix,proposal,version'
          || !proposal || Object.keys(proposal).sort().join(',') !== 'maxRepairs,order,scenario'
          || !Array.isArray(proposal.order) || proposal.order.length < 1 || proposal.order.length > 2
          || new Set(proposal.order).size !== proposal.order.length || proposal.order.some(item => !['source', 'calculation'].includes(item))
          || !Number.isInteger(proposal.maxRepairs) || proposal.maxRepairs < 0 || proposal.maxRepairs > 8
          || !['repair', 'missing', 'forged', 'exhausted'].includes(proposal.scenario)) throw new Error('Unsupported fictional proposal config');
      }
      return { text: decode(source.snapshot, 'text/markdown', 4096), settings };
    };
    const revoked = new Error('Admission revoked');
    const admitNative = async (value, identity, mode) => {
      let request, actor;
      try { request = requestSnapshot(value, instanceId); actor = actorSnapshot(identity); }
      catch { return { kind: 'denied' }; }
      if (!allowed(actor, 'admit')) return { kind: 'denied' };
      let inputs;
      try { inputs = await readInputs(request, actor, mode); } catch { return { kind: 'unavailable' }; }
      let reserved;
      try { reserved = await reservations.reserve(request, actor); } catch { return { kind: 'unknown' }; }
      if (reserved.kind !== 'ready') return { kind: reserved.kind };
      const base = { instanceId, subject: request.subject, requestId: request.requestId, generationId: reserved.record.generationId,
        reservation: reserved.reservation, guard: reserved.guard, actor };
      if (!allowed(actor, 'admit')) return { kind: 'reserved' };
      try {
        const ref = await conversation.commit(async tx => {
          const record = await tx.doc(requests, JSON.stringify([instanceId, request.subject, request.requestId]), null);
          if (!allowed(actor, 'admit') || !allowed(actor, 'read', request.source) || !allowed(actor, 'read', request.config)) throw revoked;
          if (record.binding) {
            if ((record.binding.mode ?? 'text') !== mode) return null;
            if (!equal(record.binding.request, request) || !equal(record.binding.ref.actor, actor)
              || !equal(record.binding.ref.reservation, reserved.reservation) || !equal(record.binding.ref.guard, reserved.guard)) throw new Error('Native request binding changed');
            return JSON.parse(JSON.stringify(record.binding.ref));
          }
          const catalog = mode === 'proposal' ? await proposals.catalog(tx, request.subject) : undefined;
          let graph;
          const binding = await delivery.admit(tx, async inner => {
            if (mode === 'text') return inner.createTask(producer, { request, actor, text: inputs.text }, { ownership: { kind: 'conversation' } });
            graph = await proposals.admit(inner, { request, actor, ...inputs, catalog, model: proposals.model });
            return graph.formatter;
          },
            { ...request.output, preconditions: [{ kind: 'revision', target: reserved.guard }, request.edit,
              { kind: 'revision', target: request.source }, { kind: 'revision', target: request.config }] }, { ownership: { kind: 'conversation' } }, context, actor);
          if (!allowed(actor, 'admit') || !allowed(actor, 'read', request.source) || !allowed(actor, 'read', request.config)) throw revoked;
          const admitted = { ...base, ...binding, ...graph };
          record.binding = { request, mode, ref: admitted };
          return structuredClone(admitted);
        }, context);
        if (ref === null) return { kind: 'conflict' };
        harness.resume();
        await afterAdmission(structuredClone(ref));
        return allowed(actor, 'admit') && allowed(actor, 'read', reserved.reservation) && allowed(actor, 'read', reserved.guard)
          ? { kind: 'admitted', ref } : { kind: 'unknown' };
      } catch (error) { return error === revoked ? { kind: 'reserved' } : { kind: 'unknown' }; }
    };
    const getProposal = async (value, identity) => {
      let ref, actor;
      try { ref = structuredClone(value); actor = actorSnapshot(identity); paths(instanceId, ref.subject); }
      catch { return { kind: 'denied' }; }
      if (ref.instanceId !== instanceId || !allowed(actor, 'read', ref.reservation) || !allowed(actor, 'read', ref.guard)) return { kind: 'denied' };
      const stored = await harness.snapshot(requests, JSON.stringify([instanceId, ref.subject, ref.requestId]), context);
      if (!stored?.binding || stored.binding.mode !== 'proposal' || !equal(stored.binding.ref, ref)) return { kind: 'denied' };
      const request = stored.binding.request;
      const permitted = () => [request.source, request.config, ref.guard, ref.reservation].every(target => allowed(actor, 'read', target));
      if (!permitted()) return { kind: 'denied' };
      const [produced, validated] = await Promise.all([harness.getTask(ref.producer, context), harness.getTask(ref.validation, context)]);
      if (!permitted()) return { kind: 'denied' };
      if (!produced || produced.kind !== proposals.producer.definition.name || !validated || validated.kind !== proposals.validation.task.definition.name
        || validated.input.producer !== ref.producer || !equal(produced.input.request, request)) return { kind: 'unavailable' };
      if (validated.state.status !== 'terminal') return { kind: 'pending' };
      const result = validated.state.outcome.status === 'completed' ? validated.state.outcome.result : undefined;
      if (result?.kind !== 'valid') return { kind: 'invalid' };
      return { kind: 'ready', request, value: structuredClone(result.value), catalog: structuredClone(produced.input.catalog) };
    };
    const latest = async (subject, identity) => {
      let actor, selected;
      try { actor = actorSnapshot(identity); selected = paths(instanceId, subject); } catch { return { kind: 'denied' }; }
      const permitted = targets => targets.every(target => allowed(actor, 'read', target));
      if (!permitted([selected.generation])) return { kind: 'denied' };
      try {
        const generation = await provider.read({ target: selected.generation, revision: { kind: 'latest' } }, actor);
        if (!permitted([selected.generation])) return { kind: 'denied' };
        if (generation.kind !== 'available') return { kind: generation.kind };
        const guard = JSON.parse(decode(generation.snapshot, 'application/json', 4096));
        if (guard.format !== 'fictional.redaction.generation' || guard.version !== 1 || typeof guard.requestId !== 'string' || !/^[a-z0-9-]{1,80}$/.test(guard.requestId)) return { kind: 'unavailable' };
        const target = reservationTarget({ instanceId, subject, requestId: guard.requestId });
        const saved = await provider.read({ target, revision: { kind: 'latest' } }, actor);
        if (saved.kind !== 'available') return { kind: 'unavailable' };
        const record = JSON.parse(decode(saved.snapshot, 'application/json', 16384));
        const request = requestSnapshot(record.request, instanceId), originalActor = actorSnapshot(record.actor);
        if (!equal(originalActor, actor)) return { kind: 'denied' };
        if (request.subject !== subject || request.requestId !== guard.requestId || record.generationId !== guard.generationId
          || !equal(record, { format: 'fictional.redaction.request', version: 1, generationId: guard.generationId, actor, request })) return { kind: 'unavailable' };
        const visible = [target, selected.generation, request.source, request.config, request.edit.target, request.output.target];
        const observed = await provider.reconciliation.lookup(reservationOperation(request), actor);
        if (!permitted(visible)) return { kind: 'denied' };
        if (observed.kind !== 'committed') return { kind: 'unknown' };
        const found = parsePublicationResult(observed);
        const receipt = found.receipt, publication = reservationPublication(record);
        if (receipt.operationId !== publication.operationId || receipt.argumentDigest !== await publicationDigest(publication)
          || receipt.principalId !== actor.principalId || receipt.initiatorId !== actor.initiatorId || receipt.scopeId !== actor.scopeId
          || receipt.changes.length !== 2 || !equal(receipt.changes[0].after, saved.snapshot.ref) || !equal(receipt.changes[1].after, generation.snapshot.ref)) return { kind: 'unavailable' };
        const stored = await harness.snapshot(requests, JSON.stringify([instanceId, subject, request.requestId]), context);
        if (!permitted(visible)) return { kind: 'denied' };
        if (!stored?.binding) return { kind: 'reserved', request };
        const binding = stored.binding;
        if (binding.mode !== 'proposal' || !equal(binding.request, request) || !equal(binding.ref.actor, actor)
          || !equal(binding.ref.reservation, saved.snapshot.ref) || !equal(binding.ref.guard, generation.snapshot.ref)) return { kind: 'unavailable' };
        return { kind: 'admitted', request, ref: structuredClone(binding.ref) };
      } catch { return { kind: 'unavailable' }; }
    };
    const corrections = createCorrections({ provider, allowed, getProposal, instanceId });
    const adoption = createAdoption({ provider, harness, conversation, instanceId, allowed, getProposal,
      readCorrection: corrections.readCorrection, beforeAdoptionPublish, afterAdoptionCommit });
    registry.install(adoption.extension);
    return { instanceId, paths: subject => paths(instanceId, subject), capture, latest, ...(preparing ? { preparation: preparing.service } : {}),
      admit: (value, actor) => admitNative(value, actor, 'text'), admitProposal: (value, actor) => admitNative(value, actor, 'proposal'),
      domainPaths: (subject, itemId) => domainPaths(instanceId, subject, itemId),
      viewProposal: corrections.viewProposal, correctItem: corrections.correctItem,
      captureAdoption: adoption.captureAdoption, adopt: adoption.adopt, adoptionResult: adoption.adoptionResult,
      local: { provider, harness, conversation, proposals },
      close: () => {
        if (!closing) { closed = true; closing = (async () => { try { await harness.close(context); } finally { provider.close(); } })(); }
        return closing;
      } };
  } catch (error) {
    if (harness) await harness.close(context); else if (storage) await storage.close();
    provider.close(); throw error;
  }
}
